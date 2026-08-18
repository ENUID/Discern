/**
 * One photograph in, one shop query out.
 *
 * The stylist's vision step does a great deal at once: read the photograph,
 * work out whether the shopper wants advice or wants to buy, write prose, AND
 * remember to emit a [SEARCH: …] token in the right grammar so the search
 * pipeline fires. When any part of that misses, the shopper gets an answer with
 * no products — and measured on production, uploading a clean product
 * photograph with "find this exact shirt" produced the reply "What details can
 * you share about the shirt, colour, style, brand, or any key features?" and
 * searched for nothing at all. It asked the shopper to describe the thing they
 * had just photographed.
 *
 * This does one job. No branches, no prose, no token grammar to forget: look at
 * the garment and write the line a person would type into a shop. It is the
 * floor under the stylist rather than a replacement for it — when the stylist
 * emits a proper token, that is used; when it does not, this is why the search
 * still happens.
 *
 * The brand name is asked for FIRST and deliberately. A name embroidered on a
 * chest or woven into a label is the strongest identifier a photograph carries,
 * and this catalogue holds 458 brands — if the garment says FARDA and Farda is
 * in the registry, that one word does more than every adjective combined.
 */
import { groqVisionChat, type VisionMessage } from '@/lib/groq'

const TIMEOUT_MS = Number(process.env.DESCRIBE_GARMENT_TIMEOUT_MS ?? 9000)

function enabled(): boolean {
  return (process.env.DESCRIBE_GARMENT_VISION ?? 'on').toLowerCase() === 'on'
}

const SYSTEM =
  'You convert a photograph of a garment into a shop search query. You output one line and nothing else.'

const PROMPT =
  'Look at this garment and write the single line a person would type into a clothing shop to find it.\n\n' +
  'Include, in this order, only what you can actually see:\n' +
  '1. Any BRAND NAME on the garment — printed, embroidered, on a label, on a tag. Put it first.\n' +
  '2. Who it is for, if the cut makes it plain: men or women.\n' +
  '3. The colour, precisely — "ecru" not "white", "mid-wash indigo" not "blue".\n' +
  '4. The material, if the weave or drape shows it — linen, cotton, wool, leather, denim.\n' +
  '5. The garment: shirt, trousers, loafers, and so on.\n' +
  '6. At most two details that would narrow a search — short sleeve, camp collar, ' +
  'embroidered, pleated, wide leg, zip through.\n\n' +
  'Write it as a plain search line, lower case, no punctuation, no explanation, ' +
  'no quotes. Eight words at most. If the photograph is a screenshot of an app or a ' +
  'website, ignore every interface element and describe only the garment.\n\n' +
  'Example outputs:\n' +
  'farda men ecru cotton short sleeve embroidered shirt\n' +
  'men mid-wash indigo wide leg jeans\n' +
  'women black leather ankle boots'

/** A search line for the garment in the photograph, or null. */
export async function describeGarment(image: string): Promise<string | null> {
  if (!enabled() || !image) return null
  const content: VisionMessage['content'] = [
    { type: 'text', text: PROMPT },
    { type: 'image_url', image_url: { url: image, detail: 'high' as const } },
  ]
  try {
    const msg = await Promise.race([
      groqVisionChat([{ role: 'user', content }], SYSTEM, { max_tokens: 60, temperature: 0 }),
      new Promise<null>(r => setTimeout(() => r(null), TIMEOUT_MS)),
    ])
    if (!msg) return null
    const line = String((msg as { content?: string })?.content ?? '')
      .split('\n')[0]
      .replace(/^["'`\s]+|["'`\s.]+$/g, '')
      .replace(/\s+/g, ' ')
      .toLowerCase()
      .trim()
    // A refusal, a sentence, or an empty answer is not a search query.
    //
    // Anchoring this to the START of the line was not enough: "i'm sorry, i
    // can't identify people or brands in images" begins with "i'm", is nine
    // words long, and sailed through every check — straight into the catalogue
    // as a search. A refusal reads as a sentence about the model rather than a
    // description of a garment, and those words never appear in a real one.
    if (!line || line.length < 3 || line.split(' ').length > 14) return null
    if (/\b(sorry|apolog|cannot|can'?t|unable|as an ai|i'?m |i am |identify (people|individuals)|no image|not able)\b/.test(line)) return null
    // A search line names a garment. If none of the vocabulary of clothing is
    // in it, whatever came back is about something else.
    if (!/\b(shirt|t-?shirt|tee|top|blouse|kurta|jacket|blazer|coat|vest|trouser|pant|chino|short|jean|denim|dress|skirt|shoe|sneaker|trainer|boot|loafer|sandal|derby|oxford|sweater|knit|cardigan|hoodie|polo|suit|bag|belt|scarf|cap|hat)\b/.test(line)) return null
    return line
  } catch {
    return null
  }
}
