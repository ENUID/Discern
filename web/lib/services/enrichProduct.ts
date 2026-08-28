/**
 * Read every garment once, and remember it.
 *
 * The schema in lib/fashion/garmentProfile.ts says what a garment is. This is
 * the pass that actually looks at one and fills it in, and the store that means
 * it is only ever looked at once.
 *
 * WHERE IT RUNS, and why not everywhere. A vision call for all fifty-two
 * fetched products on every search would be unaffordable and slow. A vision
 * call for the dozen-odd pieces that are about to be COMPOSED INTO AN OUTFIT is
 * three or four batched calls, and after the first time a piece is seen it is
 * free forever. So enrichment sits exactly where the knowledge is used: at the
 * point where the app decides whether a shirt and a trouser belong together.
 *
 * FAILURE IS ORDINARY. A profile that does not arrive is not an error — the
 * composition falls back to the colour-and-formality reasoning it used before,
 * which is worse but perfectly serviceable. Nothing here is allowed to make a
 * search fail or a page wait.
 */
import { BoundedCache } from '@/lib/boundedCache'
import { profileKey, readProfiles, writeProfiles } from '@/lib/services/persistentProfileCache'
import { groqVisionChat, GROQ_DIRECT_VISION_MODEL, type VisionMessage } from '@/lib/groq'
import {
  PROFILE_SYSTEM, profilePrompt, parseProfile, type GarmentProfile,
} from '@/lib/fashion/garmentProfile'

/** Profiles are small and never change — a garment does not become a different
 *  garment. Ten thousand of them is a few megabytes and covers far more than
 *  any one instance will see.
 *
 *  KEYED BY profileKey, NOT BY PRODUCT ID. The store next door keys on product
 *  ⊕ image ⊕ schema ⊕ prompt ⊕ model, precisely so that changing any of those
 *  stops addressing the old answer. This map keyed on the bare product id, so
 *  it held a second opinion about what identifies a profile — and a warm
 *  instance went on serving the reading of a photograph the brand had already
 *  replaced, or a reading taken under a prompt or a model we had since moved
 *  off. Convex got it right and memory quietly overrode it, because memory is
 *  consulted first. One identity, decided in one place. */
const mem = new BoundedCache<string, GarmentProfile>(10_000)

const TIMEOUT_MS = Number(process.env.ENRICH_TIMEOUT_MS ?? 7000)
/** One product per call. Batching several garments into one prompt and asking
 *  for an array reads well and returns badly: the model blends them, and a
 *  linen shirt's collar turns up on the trousers. The parallelism below is what
 *  makes this fast, not the batching. */
const CONCURRENCY = 6

function enabled(): boolean {
  return (process.env.ENRICH_VISION ?? 'on').toLowerCase() === 'on'
}

function thumb(src: string, px = 512): string {
  try {
    const u = new URL(src.startsWith('//') ? `https:${src}` : src)
    if (/cdn\.shopify|shopifycdn/.test(u.hostname) || u.pathname.includes('/cdn/shop/')) {
      u.searchParams.set('width', String(px))
      u.searchParams.delete('height')
    }
    return u.toString()
  } catch { return src }
}

type Readable = { id: string; title: string; description?: string; image_url?: string }

async function readOne(p: Readable): Promise<GarmentProfile | null> {
  if (!p.image_url) return null
  const content: VisionMessage['content'] = [
    { type: 'text', text: profilePrompt(p.title || '', p.description || '') },
    { type: 'image_url', image_url: { url: thumb(p.image_url), detail: 'high' as const } },
  ]
  try {
    const msg = await groqVisionChat([{ role: 'user', content }], PROFILE_SYSTEM,
      { max_tokens: 400, temperature: 0 })
    const profile = parseProfile(String((msg as { content?: string })?.content ?? ''))
    // Which model read it, and when. `readBy` has been declared on
    // GarmentProfile since the type was written — "a profile is only as good as
    // the pass that produced it, and a bad batch has to be findable and
    // re-runnable" — and nothing had ever written it, so a bad batch was
    // findable only by its timestamp. The model name is already part of the
    // cache key; this is the same fact, stored where it can be read.
    if (profile) { profile.readAt = Date.now(); profile.readBy = GROQ_DIRECT_VISION_MODEL }
    return profile
  } catch {
    return null
  }
}

/** Profiles for these products, read where missing and remembered after.
 *  Always returns — an empty map is a normal answer. */
export async function profilesFor(products: Readable[]): Promise<Map<string, GarmentProfile>> {
  const out = new Map<string, GarmentProfile>()
  if (!enabled() || products.length === 0) return out

  // The identity FIRST, then the lookup. Computing it up front rather than
  // only for the misses is what lets memory and the store agree on what a
  // profile is a profile OF. One SHA-1 over a short string per garment.
  const keyOf = new Map<string, string>()
  const todo: Readable[] = []
  for (const p of products) {
    if (!p?.id) continue
    const key = profileKey(p.id, p.image_url || '', GROQ_DIRECT_VISION_MODEL)
    keyOf.set(p.id, key)
    const hit = mem.get(key)
    if (hit) out.set(p.id, hit)
    else if (p.image_url) todo.push(p)
  }
  if (todo.length === 0) return out

  // Then the store, before spending anything.
  //
  // The map above is process-local, so on a serverless deployment it is empty
  // for most of the requests that matter — a cold instance knew nothing and
  // re-read garments this app had already looked at hundreds of times. One
  // batched query stands between that and paying for a vision call on a
  // provider whose quota is gone.
  const stored = await readProfiles(todo.map(p => keyOf.get(p.id) || ''))
  const unseen: Readable[] = []
  for (const p of todo) {
    const key = keyOf.get(p.id) || ''
    const found = stored.get(key)
    if (found) { mem.set(key, found); out.set(p.id, found) }
    else unseen.push(p)
  }
  if (unseen.length === 0) return out

  /** What this pass actually had to look at, so it is only ever looked at once. */
  const learned: { key: string; productId: string; profile: GarmentProfile }[] = []

  const work = async () => {
    const queue = [...unseen]
    const runners = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (;;) {
        const next = queue.shift()
        if (!next) return
        const profile = await readOne(next)
        if (profile) {
          const key = keyOf.get(next.id) || ''
          mem.set(key, profile)
          out.set(next.id, profile)
          learned.push({ key, productId: next.id, profile })
        }
      }
    })
    await Promise.all(runners)
  }

  // Boxed. Whatever has been read by the deadline is used; the rest of the
  // pieces simply have no profile this time and are judged the old way.
  await Promise.race([
    work().catch(() => undefined),
    new Promise<void>(r => setTimeout(r, TIMEOUT_MS)),
  ])

  // Written AFTER the box, and never awaited. Whatever was read inside the
  // deadline is worth keeping even if the batch as a whole ran out of time —
  // and nobody waiting on a page should wait on a cache write.
  if (learned.length) {
    void writeProfiles(learned).catch(() => undefined)
  }
  return out
}

/** How many of these we already know, without reading anything. Lets a caller
 *  decide whether a profiled composition is even worth attempting. */
export function knownCount(products: Readable[]): number {
  let n = 0
  // Same key as profilesFor, or this would answer about a map it is not
  // reading — always zero, and silently.
  for (const p of products) {
    if (!p?.id) continue
    if (mem.get(profileKey(p.id, p.image_url || '', GROQ_DIRECT_VISION_MODEL))) n++
  }
  return n
}
