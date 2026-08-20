/**
 * The question the shopper should have been able to type.
 *
 * WHAT THIS IS FOR. Sometimes Fabrics answers in prose and shows nothing —
 * "outfits for a casual party" came back as "you want to look intentional
 * without looking like you tried too hard. Here are three distinct moods: an
 * easy layered look, a resort-leaning textured shirt, and a sleek knit
 * elevated baseline", with no clothes under it. The advice is good. It is also
 * unbuyable, and the shopper's only way forward was to press-and-hold the
 * paragraph, drag the selection handles, copy it, paste it into the composer
 * and send it back. That is not a feature, it is a workaround they invented
 * because the app left them stranded.
 *
 * So the reply now comes with the QUERY it should have been, ready to send.
 *
 * WHAT MAKES A GOOD QUERY HERE, since the whole point is to write one properly
 * rather than to hand the shopper back their own sentence. Every element below
 * is load-bearing in machinery that already exists in this codebase:
 *
 *   GARMENTS, NAMED.  Retrieval is garment-keyed: decomposeQuery reads the
 *     nouns, buildMandatoryConcepts turns them into the concept groups the
 *     catalogue filter runs on, and multiCategorySearch gives each one its own
 *     separately-ranked strip. A query with no garment noun in it has none of
 *     that and degrades to a flat keyword search over ninety stores. This is
 *     the single most important element and the one the shopper's own phrasing
 *     ("outfits for a casual party") most often lacks.
 *
 *   TWO OR MORE OF THEM, when the answer is an outfit. Two named garments is
 *     the threshold at which both search paths split into per-garment strips
 *     instead of merging into one list.
 *
 *   ONE MATERIAL, ONE COLOUR, AT MOST. Each becomes another MANDATORY concept
 *     group, and mandatory groups multiply: "men printed silk nehru jacket"
 *     compiles to four of them and retrieves almost nothing. Two adjectives
 *     narrow; four exclude.
 *
 *   THE OCCASION, IN THE SHOPPER'S OWN WORDS, kept at the end. It is not used
 *     to fetch — no listing says "casual party" — but it IS the rerank query,
 *     so it is what the relevance judge reads to decide which linen shirt is
 *     the right linen shirt.
 *
 *   THE GENDER, in front. Menswear and womenswear are different searches and
 *     an ungendered query is neither.
 *
 * WHERE THE WORDS COME FROM. The model's own reply, first — it has already
 * reasoned about the occasion, and the garments it named are its answer, just
 * trapped in prose. The occasion table second, which knows that a wedding
 * means a jacket, a shirt, trousers and shoes whatever anyone wrote. The
 * shopper's question last. No model call: this runs on the reply that already
 * arrived, so it costs nothing and cannot fail.
 */
import { decomposeQuery, GARMENT_VOCAB } from '@/lib/queryParser'
import { outfitPlan } from '@/lib/fashion/outfitKnowledge'
import { plainWords } from '@/lib/plainText'

export { plainWords }

/** Three garments read as a look; five read as a shopping list. The search
 *  splits up to four strips, so this is a readability bound, not a technical
 *  one. */
const MAX_GARMENTS = 3

/** The occasion as the shopper said it, not as a table key.
 *
 *  "outfits for a casual party" → "a casual party". Their words beat ours: the
 *  table's key is 'party-casual', which is not English and would read as the
 *  app talking to itself.
 *
 *  An occasion has to be CLAIMED, never salvaged. Stripping the filler out of
 *  "something in linen" leaves "in linen", and appending that produced "men
 *  linen shirts for in linen" — a fibre worn twice and read as an event. So
 *  the phrase is taken only where the sentence actually announces one, either
 *  by naming it after for/wear-to or by being an occasion the table recognises. */
function occasionPhrase(question: string, gender?: string | null): string {
  const q = plainWords(question).toLowerCase()
    .replace(/[?!.]+$/, '')
    .trim()

  const say = (s: string) => s
    // "what should I wear TO a job interview" hands back "to a job interview",
    // and the caller puts "for " in front of it.
    .replace(/^(?:to|at|in|on|for|with)\s+/, '')
    .replace(/\s+/g, ' ')
    .trim()

  // Announced: everything after for / wear to / going to / attending.
  const m = q.match(/\b(?:for|wear\s+(?:to|at|for|on)|going\s+to|attending|dress\s+for)\s+(.{3,60})$/)
  if (m) return say(m[1])

  // Not announced, but the occasion table knows this sentence names one —
  // "casual party outfits", "beach holiday". Then, and only then, is what is
  // left after the filler worth trusting as an occasion.
  if (!outfitPlan(q, gender)) return ''
  const stripped = say(q
    .replace(/\b(outfits?|looks?|something|anything|ideas?|suggestions?|what should i wear|what do i wear|help me|show me|find me|i need|i want)\b/g, ' '))
  return stripped.length >= 3 ? stripped : ''
}

/** The garment words to build the query from, most-trusted source first. */
function garmentKeys(question: string, reply: string, gender?: string | null): string[] {
  // 1. What the model itself named. It has already thought about the occasion;
  //    these ARE its answer, only unbuyable.
  const fromReply = Array.from(new Set(decomposeQuery(reply).garmentKeys))
  if (fromReply.length >= 2) return fromReply.slice(0, MAX_GARMENTS)

  // 2. What the occasion means, whatever was written. An interview is a jacket,
  //    a shirt, trousers and shoes even when the reply mentioned none of them.
  const planned = outfitPlan(question, gender)?.slots ?? []
  if (planned.length >= 2) return planned.slice(0, MAX_GARMENTS)

  // 3. The shopper's own nouns, and the model's single one, as a last resort.
  const fromQuestion = Array.from(new Set(decomposeQuery(question).garmentKeys))
  const single = fromQuestion.length ? fromQuestion : fromReply
  return single.slice(0, MAX_GARMENTS)
}

/** "shirt, trousers and loafers" — an English list, not a slash-separated one. */
function listOf(words: string[]): string {
  if (words.length <= 1) return words[0] ?? ''
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

/** A query the shopper can send as-is, or null when there is nothing better to
 *  offer than what they already typed. */
export function suggestQuery(
  question: string,
  reply: string,
  gender?: string | null,
): string | null {
  const q = plainWords(question || '')
  const r = plainWords(reply || '')
  if (!q && !r) return null

  const keys = garmentKeys(q, r, gender)
  // No garment anywhere — in their question, in the reply, or in the occasion
  // table. There is no better query to write than the one they sent, and
  // offering it back to them would be a insult dressed as a suggestion.
  if (keys.length === 0) return null

  const garments = keys
    .map(k => GARMENT_VOCAB[k]?.query[0] || k)
    // Plural, because they want to see several of each.
    .map(w => (/s$/.test(w) ? w : `${w}s`))

  // One each. See the header: every adjective is another mandatory concept
  // group, and four of them retrieve nothing. Taken from the reply first —
  // the model chose them for this occasion.
  const fromReply = decomposeQuery(r)
  const fromQuestion = decomposeQuery(q)
  const material = fromReply.materials[0] || fromQuestion.materials[0] || ''
  const colour = fromQuestion.colors[0] || fromReply.colors[0] || ''

  const g = /^w/i.test(gender || '') ? 'women' : /^m/i.test(gender || '') ? 'men' : ''
  const occasion = occasionPhrase(q, gender)

  const line = [
    g,
    colour,
    material,
    listOf(garments),
    occasion ? `for ${occasion}` : '',
  ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()

  // Never hand back the question they already asked.
  if (line.toLowerCase() === q.toLowerCase()) return null
  return line.slice(0, 160)
}
