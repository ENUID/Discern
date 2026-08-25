/**
 * One boundary between what the model said and what the app believes.
 *
 * §44 of the build spec forbids `LLM prose → frontend regex`. The violation
 * here was one layer earlier and worse: the ROUTE recovered its structure from
 * prose with four separate regexes, and everything downstream — whether the
 * shopper sees any clothes at all — depended on a model remembering a bracket
 * grammar mid-sentence:
 *
 *   [SEARCH: men linen shirt]
 *   [OUTFIT: men linen shirt | men wide trousers | men tan loafers]
 *   [OUTFITS: a | b || c | d]
 *
 * When the bracket was missed the page came back empty, and three separate
 * fallbacks now exist because it was missed often: describeGarment, the
 * reply-garment surfacer, and suggestQuery. Each of those is a patch over the
 * same hole.
 *
 * WHAT THIS IS NOT: a rewrite of the prompt. Changing what a four-provider
 * chain is asked to emit, on a deployment where three of the four are out of
 * quota, is the most dangerous edit available in this repository — and the
 * token grammar carries dozens of specific fixes, each with a comment naming
 * the bug it prevents.
 *
 * So this is the boundary, not the format. Every strategy is TRIED IN TURN and
 * the first valid one wins:
 *
 *   1. json    a fenced or bare JSON object, validated
 *   2. tokens  the existing bracket grammar, unchanged
 *   3. prose   no structure at all — a conversational reply, which is a
 *              perfectly good answer and must not be treated as a failure
 *
 * Downstream reads one validated object and never a regex. The JSON path can
 * therefore be turned on in the prompt later, or per provider, or for one
 * model at a time, without touching a single consumer — and if it goes wrong
 * the tokens are still there, one line below.
 *
 * `via` is on the result on purpose. §14 of the audit: never hide a fallback
 * from observability. Which strategy answered is the number that tells you
 * whether moving to JSON is working, and it cannot be recovered afterwards.
 */
import { z } from 'zod'

/** A query string as the catalogue will receive it. Bounded here rather than
 *  at four separate call sites. */
const Query = z.string().trim().min(1).max(200)

/**
 * What the model may say. Every field optional: a reply with no structure at
 * all is the commonest and most legitimate answer there is.
 */
export const StylistAnswerSchema = z.object({
  /** The prose the shopper reads. */
  reply: z.string().default(''),
  /** One search. */
  search: Query.optional(),
  /** One outfit, as its slots in wear order. */
  /** One slot is a search — see normalise(). Accepted here so a model
   *  writing an outfit of one is understood rather than discarded. */
  outfit: z.array(Query).min(1).max(4).optional(),
  /** Several distinct looks, each as its own slots. */
  outfits: z.array(z.array(Query).min(2).max(4)).min(2).max(3).optional(),
})

export type StylistAnswer = z.infer<typeof StylistAnswerSchema> & {
  /** Which strategy produced this. Never hidden — see the header. */
  via: 'json' | 'tokens' | 'prose'
}

/** The instruction to add to a prompt when the JSON path is being used. Kept
 *  here beside the schema so the two cannot drift. */
export const JSON_ANSWER_INSTRUCTION =
  'You may reply with a single JSON object instead of prose plus tokens:\n' +
  '{"reply": "<what the shopper reads>", "search": "<one query>"}\n' +
  '{"reply": "...", "outfit": ["<slot 1>", "<slot 2>", "<slot 3>"]}\n' +
  '{"reply": "...", "outfits": [["a","b"],["c","d"]]}\n' +
  'Use "search" for one garment, "outfit" for one look, "outfits" for several. ' +
  'Omit all three when no products are needed. Output the object and nothing else.'

// ── strategy 1: JSON ────────────────────────────────────────────────────────

/** The first balanced {...} in the text, fenced or bare.
 *
 *  A lazy /\{[\s\S]*?\}/ stops at the first closing brace, which is inside the
 *  first nested object — the same trap the wardrobe token's own comment
 *  documents. Depth counting, and string-aware so a brace inside a quoted
 *  reply cannot close the object early. */
function firstObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (escaped) { escaped = false; continue }
    if (ch === '\\') { escaped = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

function fromJson(raw: string): StylistAnswer | null {
  const block = firstObject(raw)
  if (!block) return null
  let parsed: unknown
  try { parsed = JSON.parse(block) } catch { return null }
  const result = StylistAnswerSchema.safeParse(parsed)
  if (!result.success) return null
  const a = result.data
  // An object carrying no reply AND no instruction is not an answer — it is
  // some other JSON the model happened to emit (a wardrobe scan, a comparison).
  // Falling through to the tokens is right; claiming this as the answer is not.
  if (!a.reply.trim() && !a.search && !a.outfit && !a.outfits) return null
  return normalise({ ...a, via: 'json' })
}

// ── strategy 2: the bracket grammar, unchanged ──────────────────────────────

const SEARCH_RE = /\[SEARCH:\s*([^\]]+)\]/i
const OUTFIT_RE = /\[OUTFIT:\s*([^\]]+)\]/i
const OUTFITS_RE = /\[OUTFITS:\s*([^\]]+)\]/i

const slots = (s: string) =>
  s.split('|').map(q => q.trim().slice(0, 200)).filter(Boolean).slice(0, 4)

function fromTokens(raw: string): StylistAnswer | null {
  let reply = raw
  let search: string | undefined
  let outfit: string[] | undefined
  let outfits: string[][] | undefined

  // OUTFITS before OUTFIT: the shorter pattern is a prefix of the longer one,
  // and reading [OUTFITS: …] as an [OUTFIT: …] would silently collapse three
  // looks into one.
  const many = raw.match(OUTFITS_RE)
  if (many) {
    const sets = many[1].split('||').map(slots).filter(s => s.length > 0).slice(0, 3)
    if (sets.length > 0) outfits = sets
    reply = reply.replace(many[0], '')
  }
  const one = raw.match(OUTFIT_RE)
  if (one && !outfits) {
    const s = slots(one[1])
    if (s.length > 0) outfit = s
  }
  if (one) reply = reply.replace(one[0], '')

  const m = raw.match(SEARCH_RE)
  if (m) {
    const q = m[1].trim().slice(0, 200)
    if (q) search = q
    reply = reply.replace(m[0], '')
  }

  if (!search && !outfit && !outfits) return null
  return normalise({
    reply: reply.replace(/\n+$/, '').replace(/[ \t]{2,}/g, ' ').trim(),
    search, outfit, outfits, via: 'tokens',
  })
}

/** One garment is a search, whichever way it arrived.
 *
 *  The two strategies disagreed about this and neither was obviously wrong:
 *  the bracket grammar accepted [OUTFIT: men linen shirt] as an outfit of one,
 *  while the JSON schema requires two slots. Downstream that difference is
 *  real — an outfit of one renders as a look with a single piece in it, which
 *  is a search wearing the wrong clothes.
 *
 *  A contract that means different things depending on how it was written is
 *  not a contract, so it is settled in one place: a one-slot outfit IS a
 *  search, and both paths now say so. */
function normalise(a: StylistAnswer): StylistAnswer {
  if (a.outfit && a.outfit.length === 1) {
    return { ...a, outfit: undefined, search: a.search ?? a.outfit[0] }
  }
  return a
}

// ── the boundary ────────────────────────────────────────────────────────────

/**
 * What the model said, as something the app can act on. Never throws and never
 * returns null: prose with no structure is a valid answer, and the commonest
 * one.
 */
export function parseStylistAnswer(raw: string): StylistAnswer {
  const text = String(raw ?? '')
  return fromJson(text)
    ?? fromTokens(text)
    ?? { reply: text.trim(), via: 'prose' }
}
