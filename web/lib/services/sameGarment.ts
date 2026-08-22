/**
 * Which of these IS the thing in the photograph?
 *
 * Everything else in this codebase that touches a shopper's photo does the
 * same one-way thing: look at the picture, write words, search the words. The
 * model never sees what came back. So "find me this exact one, not similar"
 * was answered by describing a blue denim clog as "men leather sandals" and
 * presenting eight leather sandals as the exact pair — and nothing anywhere
 * was in a position to notice, because nothing ever compared the shopper's
 * photograph with a product photograph.
 *
 * This does. One call, the shopper's picture and the candidates side by side,
 * one question: which of these is the same object, if any?
 *
 * WHAT IT IS NOT. It is not the way a visual search engine works. Lens and
 * Pinterest embed every catalogue image once into a vector index and answer
 * "find this" as a nearest-neighbour lookup over millions of items in
 * milliseconds. That finds pieces no text query would ever have retrieved.
 * This cannot: it only ever sees the handful of candidates the WORD search
 * already found, so if the piece is not in that shortlist nothing here can
 * conjure it. It is the verification step, not the retrieval step.
 *
 * What it is worth is the difference between "a denim sandal" and "THAT denim
 * sandal" — and, just as much, the ability to say no. An honest "none of these
 * is it" is a real answer to "find me the exact one". Eight near-misses under
 * a promise is not.
 */
import { wardrobeVisionChat } from '@/lib/groq'

const TIMEOUT_MS = Number(process.env.SAME_GARMENT_TIMEOUT_MS ?? 12_000)
/** Six plus the shopper's own is seven images in one prompt. Past that the
 *  call slows more than the extra coverage is worth, and the model's attention
 *  measurably thins across the later ones. */
const MAX_CANDIDATES = 6

export function sameGarmentEnabled(): boolean {
  return (process.env.SAME_GARMENT_VISION ?? 'on').toLowerCase() === 'on'
}

/** Big enough to read a buckle, a stitch line and a logo; small enough to send
 *  seven of. Shopify serves any width from the same URL. */
function thumb(src: string, px = 384): string {
  try {
    const u = new URL(src.startsWith('//') ? `https:${src}` : src)
    if (/cdn\.shopify|shopifycdn/.test(u.hostname) || u.pathname.includes('/cdn/shop/')) {
      u.searchParams.set('width', String(px))
      u.searchParams.delete('height')
    }
    return u.toString()
  } catch {
    return src
  }
}

const SYSTEM =
  'You compare garments in photographs and you are strict about sameness. You reply with JSON and nothing else.'

function prompt(n: number): string {
  return (
    `Image 1 is a garment a shopper is trying to find. Images 2 to ${n + 1} are ` +
    `products from a shop, in order.\n\n` +
    `Which of the shop products, if any, is THE SAME GARMENT as image 1?\n\n` +
    `The same garment means the same product, allowing for a different ` +
    `photograph of it: another angle, other lighting, on a foot or a body ` +
    `instead of held or flat, a screenshot instead of the original. Judge the ` +
    `object itself — its shape and construction, its material, its colour, ` +
    `where any pattern sits, its fastenings and trim, its sole or its collar, ` +
    `and any lettering or logo on it.\n\n` +
    `Two products of the same type and colour are NOT the same garment. A blue ` +
    `denim sandal is not a match for another blue denim sandal unless the ` +
    `details actually agree. Answer 0 unless you are genuinely confident: a ` +
    `wrong match is worse than admitting there is none, because the shopper ` +
    `asked for this exact piece and will believe you.\n\n` +
    `Reply with ONLY this JSON:\n` +
    `{"same": <1-${n} for the matching shop product, or 0 if none of them is>, ` +
    `"confidence": <0-100>, "closest": <1-${n}>, "why": "<up to 12 words>"}`
  )
}

export type SameGarmentVerdict = {
  /** Index into the candidates array of the product that IS the photographed
   *  piece, or null for an honest none. */
  sameIndex: number | null
  /** The nearest thing, whether or not it is a match. A soft ranking signal. */
  closestIndex: number | null
  confidence: number
  /** The model's own short reason, for the reply and the logs. */
  why: string
}

const NONE: SameGarmentVerdict = { sameIndex: null, closestIndex: null, confidence: 0, why: '' }

/** Below this a "yes" is not worth acting on. Set high on purpose: this exists
 *  to answer "is this the exact one", and a hedged yes to that question is a
 *  no dressed up. */
const CONFIDENT = 70

/**
 * Ask the model to pick the match. Never throws and never blocks a search:
 * every failure — no key, no quota, a timeout, unparseable JSON — comes back
 * as an honest "no verdict", which the caller treats exactly like not having
 * asked.
 */
export async function findSameGarment(
  wantedImage: string,
  candidateImages: string[],
): Promise<SameGarmentVerdict> {
  if (!sameGarmentEnabled() || !wantedImage) return NONE
  const cands = candidateImages.filter(Boolean).slice(0, MAX_CANDIDATES)
  if (cands.length === 0) return NONE

  try {
    const raw = await Promise.race([
      wardrobeVisionChat(
        SYSTEM,
        prompt(cands.length),
        [wantedImage, ...cands.map(u => thumb(u))],
        { max_tokens: 150, temperature: 0 },
      ),
      new Promise<null>(r => setTimeout(() => r(null), TIMEOUT_MS)),
    ])
    if (!raw) return NONE

    const m = String(raw).match(/\{[\s\S]*\}/)
    if (!m) return NONE
    const parsed = JSON.parse(m[0]) as Partial<{ same: number; confidence: number; closest: number; why: string }>

    const confidence = Math.max(0, Math.min(100, Number(parsed.confidence) || 0))
    const same = Number(parsed.same)
    const closest = Number(parsed.closest)
    // The model answers in 1-based image numbers among the CANDIDATES.
    const sameOk = Number.isInteger(same) && same >= 1 && same <= cands.length && confidence >= CONFIDENT
    const closestOk = Number.isInteger(closest) && closest >= 1 && closest <= cands.length

    return {
      sameIndex: sameOk ? same - 1 : null,
      closestIndex: closestOk ? closest - 1 : null,
      confidence,
      why: typeof parsed.why === 'string' ? parsed.why.slice(0, 90) : '',
    }
  } catch {
    return NONE
  }
}
