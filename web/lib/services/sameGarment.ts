/**
 * Is one of these the garment in the photograph?
 *
 * WHY THIS EXISTS, and what it is a substitute for.
 *
 * The accurate visual search everyone has used — Google Lens, Pinterest Lens —
 * works by EMBEDDING: every catalogue image is passed through a vision model
 * once and stored as a vector, and "find this" becomes a nearest-neighbour
 * lookup in that space. It matches shape, texture, pattern and colour at the
 * same time, in milliseconds, over millions of items. That is a different
 * technique from anything else in this codebase and it needs an index we do
 * not have.
 *
 * What we have instead is text out of vision: a model looks at the shopper's
 * photograph, writes "cream embroidered short-sleeve shirt", and we search
 * those words — which returns any cream shirt. A shopper who screenshotted a
 * piece from THIS app, uploaded it, and asked for that piece got a different
 * shirt back. The words were right and far too coarse.
 *
 * So this closes the loop the only other way available: instead of describing
 * the photograph and hoping, it puts the photograph and the candidates in
 * front of the model TOGETHER and asks which is the same garment. One call,
 * one comparison, an answer or an honest none.
 *
 * It is not as good as an embedding index. It is bounded to whatever retrieval
 * already found — if the piece is not in the shortlist this cannot conjure it —
 * and it costs a model call per search with an image. It is, however, the
 * difference between "a cream shirt" and "that cream shirt".
 */
import { groqVisionChat, type VisionMessage } from '@/lib/groq'

const TIMEOUT_MS = Number(process.env.SAME_GARMENT_TIMEOUT_MS ?? 6000)
const MAX_CANDIDATES = 6

function enabled(): boolean {
  return (process.env.SAME_GARMENT_VISION ?? 'on').toLowerCase() === 'on'
}

/** Big enough to read a pattern and a collar, small enough to send seven of. */
function thumb(src: string, px = 384): string {
  try {
    const u = new URL(src.startsWith('//') ? `https:${src}` : src)
    if (/cdn\.shopify|shopifycdn/.test(u.hostname) || u.pathname.includes('/cdn/shop/')) {
      u.searchParams.set('width', String(px))
      u.searchParams.delete('height')
    }
    return u.toString()
  } catch { return src }
}

const SYSTEM =
  'You compare garments in photographs. You are precise about sameness and you only ever output JSON.'

function prompt(n: number): string {
  return (
    `Photograph 0 is a garment a shopper is looking for. Photographs 1 to ${n} are products from a shop.\n` +
    `Which of 1 to ${n}, if any, is THE SAME GARMENT as photograph 0?\n\n` +
    `The same garment means the same piece of clothing, allowing for a different ` +
    `photograph of it: a different angle, different lighting, on a body instead of ` +
    `flat, a screenshot rather than the original. Judge the garment itself — its cut, ` +
    `its pattern and where the pattern sits, its collar and closure, its stitching and ` +
    `trim, any lettering or logo on it, its colour and its cloth.\n\n` +
    `Two garments of the same colour and type are NOT the same garment. A cream shirt ` +
    `is not a match for another cream shirt unless the details agree.\n\n` +
    `Return ONLY this JSON:\n` +
    `{"same": <index 1-${n}, or 0 if none of them is the same garment>, ` +
    `"confidence": <0-100>, "closest": <index 1-${n} that most resembles it>}\n` +
    `Answer 0 for "same" unless you are genuinely confident. A wrong match is worse ` +
    `than admitting none.`
  )
}

export type SameGarment = { same: number; confidence: number; closest: number }

/** Index (into `candidateImages`) of the piece that IS the photographed garment,
 *  or null. `closest` is returned separately as a soft signal for ranking. */
export async function findSameGarment(
  wanted: string,
  candidateImages: string[],
): Promise<{ sameIndex: number | null; closestIndex: number | null; confidence: number }> {
  const none = { sameIndex: null, closestIndex: null, confidence: 0 }
  if (!enabled() || !wanted || candidateImages.length === 0) return none

  const cands = candidateImages.filter(Boolean).slice(0, MAX_CANDIDATES)
  if (cands.length === 0) return none

  const parts: VisionMessage['content'] = [
    { type: 'text', text: prompt(cands.length) },
    { type: 'image_url', image_url: { url: wanted, detail: 'high' as const } },
    ...cands.map(u => ({ type: 'image_url' as const, image_url: { url: thumb(u), detail: 'high' as const } })),
  ]

  try {
    const msg = await Promise.race([
      groqVisionChat([{ role: 'user', content: parts }], SYSTEM, { max_tokens: 120, temperature: 0 }),
      new Promise<null>(r => setTimeout(() => r(null), TIMEOUT_MS)),
    ])
    if (!msg) return none
    const raw = String((msg as { content?: string })?.content ?? '')
    const m = raw.match(/\{[\s\S]*\}/)
    if (!m) return none
    const parsed = JSON.parse(m[0]) as Partial<SameGarment>
    const same = Number(parsed.same)
    const closest = Number(parsed.closest)
    const confidence = Math.max(0, Math.min(100, Number(parsed.confidence) || 0))
    return {
      // The model answers in 1-based photograph numbers; 0 means "none of them".
      sameIndex: Number.isInteger(same) && same >= 1 && same <= cands.length && confidence >= 55
        ? same - 1 : null,
      closestIndex: Number.isInteger(closest) && closest >= 1 && closest <= cands.length
        ? closest - 1 : null,
      confidence,
    }
  } catch {
    return none
  }
}
