/**
 * Garment profiles that survive a cold start.
 *
 * enrichProduct.ts reads a garment once with a vision model and remembers what
 * it found. It remembered in a process-local Map — so on Vercel, where an
 * instance is torn down between shoppers, every cold start threw away every
 * profile and re-paid the vision cost. On a deployment where three of four
 * provider pools are out of quota, that is the most expensive line in the
 * system: paying repeatedly for an answer we already had.
 *
 * Same shape as persistentSearchCache and persistentRerankCache — best-effort,
 * time-boxed, failure-silent. A miss or an error here means the vision pass
 * runs exactly as it did before this existed, never worse.
 *
 * ON BY DEFAULT, unlike the rerank cache next door, and the difference is worth
 * stating because that file argues the opposite for itself. The rerank cache
 * costs a read on every SEARCH to save a call to a free judge. This costs a
 * read per BATCH of garments to save a vision call on a paid-or-exhausted
 * provider — and a garment is read once ever, so the write rate falls to
 * nothing as the catalogue warms. The Convex op is cheap and the thing it
 * buys is not.
 */
import { ConvexHttpClient } from 'convex/browser'
import { anyApi } from 'convex/server'
import { createHash } from 'crypto'
import {
  PROFILE_SCHEMA_VERSION, PROFILE_PROMPT_VERSION, type GarmentProfile,
} from '@/lib/fashion/garmentProfile'

const READ_TIMEOUT_MS = 1800
const WRITE_TIMEOUT_MS = 2500

function enabled(): boolean {
  return (process.env.PROFILE_PERSISTENT_CACHE ?? 'on').toLowerCase() === 'on'
}

function client(): ConvexHttpClient | null {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL
  return url ? new ConvexHttpClient(url) : null
}

/**
 * The cache identity §15 asks for: product, image, schema, prompt, model.
 *
 * The IMAGE URL is in here and it is doing real work — a brand that reshoots a
 * product publishes a new CDN path, so the profile of the old photograph stops
 * being addressed the moment the picture changes. That is the "image
 * content/version" the spec wants, available without hashing bytes we would
 * have to download to hash.
 *
 * Hashed rather than concatenated because a Shopify URL is long, and a key is
 * an index entry rather than a record of its own inputs.
 */
export function profileKey(productId: string, imageUrl: string, model: string): string {
  const identity = [
    productId,
    imageUrl,
    `schema:${PROFILE_SCHEMA_VERSION}`,
    `prompt:${PROFILE_PROMPT_VERSION}`,
    `model:${model}`,
  ].join('|')
  return createHash('sha1').update(identity).digest('hex')
}

/** Whatever of these we already hold. Always returns; an empty map is a normal
 *  answer and means only that the vision pass has work to do. */
export async function readProfiles(keys: string[]): Promise<Map<string, GarmentProfile>> {
  const out = new Map<string, GarmentProfile>()
  if (!enabled() || keys.length === 0) return out
  const c = client()
  const secret = process.env.CONVEX_AUTH_SECRET
  if (!c || !secret) return out

  try {
    const rows = (await Promise.race([
      c.query(anyApi.garmentProfiles.getMany, { keys: keys.slice(0, 64), serverSecret: secret }),
      new Promise(resolve => setTimeout(() => resolve(null), READ_TIMEOUT_MS)),
    ])) as { key: string; profile: string }[] | null
    if (!Array.isArray(rows)) return out
    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.profile) as GarmentProfile
        // A stored profile still has to look like one. A row written by an
        // older shape than its key claims is a bug somewhere; skipping it costs
        // one vision call and using it would cost a wrong outfit.
        if (parsed && typeof parsed.garment === 'string' && typeof parsed.formality === 'number') {
          out.set(row.key, parsed)
        }
      } catch { /* one unreadable row is not a failed batch */ }
    }
  } catch { /* the vision pass runs, as it always did */ }
  return out
}

/** Store what was just read. Never awaited by anything a shopper is waiting on. */
export async function writeProfiles(
  entries: { key: string; productId: string; profile: GarmentProfile }[],
): Promise<void> {
  if (!enabled() || entries.length === 0) return
  const c = client()
  const secret = process.env.CONVEX_AUTH_SECRET
  if (!c || !secret) return
  try {
    await Promise.race([
      c.mutation(anyApi.garmentProfiles.setMany, {
        entries: entries.slice(0, 64).map(e => ({
          key: e.key,
          productId: e.productId,
          profile: JSON.stringify(e.profile),
        })),
        serverSecret: secret,
      }),
      new Promise(resolve => setTimeout(resolve, WRITE_TIMEOUT_MS)),
    ])
  } catch { /* a profile that failed to save is a profile that will be read again */ }
}
