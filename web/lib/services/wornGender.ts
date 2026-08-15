/**
 * Who is wearing it, read from the photograph.
 *
 * The catalogue's gender filter is a text filter: title, tags, product_type,
 * and the opening of the description. It is good, and it is measurably clean —
 * a men's search leaks nothing that SAYS women anywhere. What it cannot touch
 * is the piece that says nothing at all: a "Bunai Cotton Grace Coord Set", a
 * "Whispers of Flowers Shirt", listed with no department, no gendered tag, no
 * pronoun in the copy — and a photograph of a woman. To a text filter that is
 * an unknown and survives. To the shopper it is the app not listening.
 *
 * There is no text fix for a fact that was never written down. There is a
 * photograph, and we are already sending photographs to a vision model
 * elsewhere in this codebase for a smaller reason than this.
 *
 * WHAT THIS IS CAREFUL ABOUT
 *
 * It runs on the FINAL page — the dozen pieces about to be shown — and never
 * on the fetched pool of fifty-two. Vision is a model call; the palette read
 * next to it is arithmetic on pixels. Confusing the two is how a search starts
 * costing thirty seconds again.
 *
 * It DEMOTES rather than drops. A model shot is not a label: unisex pieces
 * exist, women model menswear in editorial, and a wrong read should cost a
 * piece its place at the top of the page, not its existence. And it never
 * empties a page — if everything reads as the other gender, the page stands as
 * it was, because that is far likelier to be a bad read than a catalogue with
 * nothing in it for you.
 *
 * It is failure-silent and time-boxed. No answer inside the box means the
 * order it was given, unchanged.
 */
import { createHash } from 'crypto'
import { BoundedCache } from '@/lib/boundedCache'
import { groqVisionChat, type VisionMessage } from '@/lib/groq'

export type Worn = 'man' | 'woman' | 'unclear'

const BATCH = 5                 // the vision endpoint caps images per request
const TIMEOUT_MS = Number(process.env.WORN_GENDER_TIMEOUT_MS ?? 3500)
const mem = new BoundedCache<string, Worn>(6000)

function enabled(): boolean {
  return (process.env.WORN_GENDER_VISION ?? 'on').toLowerCase() === 'on'
}

const keyFor = (url: string) => createHash('sha1').update(url).digest('hex')

/** A thumbnail is plenty to tell a man from a woman, and a 2048px photograph
 *  is a slow way to learn the same thing. */
function thumb(src: string, px = 320): string {
  try {
    const u = new URL(src.startsWith('//') ? `https:${src}` : src)
    if (/cdn\.shopify|shopifycdn/.test(u.hostname) || u.pathname.includes('/cdn/shop/')) {
      u.searchParams.set('width', String(px))
      u.searchParams.delete('height')
    }
    return u.toString()
  } catch { return src }
}

const SYSTEM = 'You classify who is modelling a garment. You only ever output JSON, no prose.'

function prompt(n: number): string {
  return (
    `These are ${n} photographs of ${n} DIFFERENT clothing products, numbered 0 to ${n - 1} in order.\n` +
    `For EACH photograph return an object with:\n` +
    `- "i": its index\n` +
    `- "worn": "man" if a man is wearing it, "woman" if a woman is wearing it, ` +
    `"unclear" if nobody is visible (flat lay, packshot, hanger, mannequin, close-up) ` +
    `or you genuinely cannot tell.\n` +
    `Judge only who is in the photograph. Do NOT infer from the garment's style — ` +
    `a man in a floral shirt is "man", a woman in a boxy blazer is "woman". ` +
    `When in doubt answer "unclear"; a wrong guess is worse than no guess.\n` +
    `Respond with ONLY a JSON array of ${n} such objects in order. No other text.`
  )
}

function parse(text: string, n: number): Worn[] {
  const out: Worn[] = new Array(n).fill('unclear')
  try {
    const m = text.match(/\[[\s\S]*\]/)
    if (!m) return out
    for (const item of JSON.parse(m[0]) as any[]) {
      const i = Number(item?.i)
      const w = String(item?.worn ?? '').toLowerCase()
      if (!Number.isInteger(i) || i < 0 || i >= n) continue
      out[i] = w === 'man' ? 'man' : w === 'woman' ? 'woman' : 'unclear'
    }
  } catch { /* the fill above is the answer */ }
  return out
}

async function classify(urls: string[]): Promise<Worn[]> {
  const parts: VisionMessage['content'] = [
    { type: 'text', text: prompt(urls.length) },
    ...urls.map(u => ({ type: 'image_url' as const, image_url: { url: thumb(u), detail: 'low' as const } })),
  ]
  const msg = await groqVisionChat([{ role: 'user', content: parts }], SYSTEM,
    { max_tokens: 400, temperature: 0 })
  return parse(String(msg?.content ?? ''), urls.length)
}

/** One read per image URL, cached for the life of the process. Returns
 *  'unclear' for anything it could not see or could not decide. */
export async function wornGenderFor(urls: string[]): Promise<Worn[]> {
  const out: Worn[] = urls.map(() => 'unclear')
  if (!enabled() || urls.length === 0) return out

  const todo: number[] = []
  urls.forEach((u, i) => {
    if (!u) return
    const hit = mem.get(keyFor(u))
    if (hit) out[i] = hit
    else todo.push(i)
  })
  if (todo.length === 0) return out

  const batches: number[][] = []
  for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH))

  try {
    const results = await Promise.race([
      Promise.all(batches.map(async idx => {
        try {
          const got = await classify(idx.map(i => urls[i]))
          return idx.map((i, k) => [i, got[k] ?? 'unclear'] as const)
        } catch { return idx.map(i => [i, 'unclear'] as const) }
      })),
      new Promise<null>(r => setTimeout(() => r(null), TIMEOUT_MS)),
    ])
    if (!results) return out
    for (const pairs of results) {
      for (const [i, w] of pairs) {
        out[i] = w
        if (urls[i]) mem.set(keyFor(urls[i]), w)
      }
    }
  } catch { /* silent: the order we were given is a fine answer */ }
  return out
}
