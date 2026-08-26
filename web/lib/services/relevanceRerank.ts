import type { UcpProduct } from './GlobalCatalogService'
import { matchStyles, vocabPromptBlock } from '../styleVocabulary'
import { judgeKnowledge } from '../knowledgeModules'
import { decomposeQuery } from '../queryParser'
import { getRelevanceAdjustment } from './relevanceAdjustments'
import { readPersistentRerankCache, writePersistentRerankCache } from './persistentRerankCache'
import { trendContextLine } from './trendConcepts'
import { intentKey, planPromptBlock } from '../fashion/outfitKnowledge'
import { infer } from '../ai/infer'
import { houseTaste } from '../fashion/lookbook'
import { runAfterResponse } from '../afterResponse'
import { fenceUntrusted, untrustedBlock } from '../stylist/promptSafety'

// ── Feature flags ─────────────────────────────────────────────────────────────
// LLM rerank is ON by default — set RELEVANCE_RERANK=off to disable.
// Always graceful: timeout, silent fallback to BM25 order, 15-min cache.
export function isRerankEnabled(): boolean {
  return (process.env.RELEVANCE_RERANK ?? 'on').toLowerCase() === 'on'
}
// The fetched pool is 52 per call and this decides how much of it the judge
// ever sees; the rest is ordered by keyword alone. Twenty meant the judge was
// choosing the best of a shortlist that BM25 had already picked — so a piece
// the words missed and the judge would have loved was never shown to it. The
// cost of doubling is tokens in one already-hedged call, not a second call.
const RERANK_TOP_N   = Number(process.env.RELEVANCE_RERANK_TOP_N   ?? 40)
const DESC_CHARS     = Number(process.env.RELEVANCE_RERANK_DESC_CHARS ?? 220)
// 2000 was the value here while the comment above claimed 6s. Scoring twenty
// products with a reason each does not finish in two seconds on a cold
// provider, and every timeout silently falls back to keyword order — which is
// exactly the generic, samey result this judge exists to prevent. Failing back
// is still the right behaviour; failing back on almost every call was not.
//
// Then 6s was not enough either, and this is the measurement that says so:
// production reported groq, cerebras and nvidia all HEALTHY while the judge
// returned no-answer on every single search. Both of the models it reaches
// are REASONING models — they spend tokens thinking before emitting a visible
// character — and they were being asked to score forty products inside six
// seconds, with a total ladder budget of 8.5s. When the first rung used its
// six, 2.5s remained, which is not enough for a second. The ladder could not
// answer however healthy the providers were. The site has been a keyword
// search wearing the app's clothes for as long as that has been true.
//
// So: a realistic wall, and far less to say (see the output contract below —
// the 8-word reason per product was pure generation that nothing ever read).
// Still nowhere near the strip's own 38s ceiling, and the store fan-out
// dominates the wall clock regardless.
const TIMEOUT_MS     = Number(process.env.RELEVANCE_RERANK_TIMEOUT_MS ?? 11_000)
/** The whole ladder, not one rung — enough that a second provider gets a real
 *  attempt when the first comes back empty, which was the other half of the
 *  no-answer. */
const LADDER_MS      = Number(process.env.RELEVANCE_RERANK_LADDER_MS ?? 17_000)
// Cost guard: cap LLM judge calls per rolling minute. Over budget → BM25 order
// (still good, still free). 0 disables the cap. Default 120/min headroom.
const MAX_LLM_PER_MIN = Number(process.env.RELEVANCE_RERANK_MAX_PER_MIN ?? 120)

let llmWindowStart = Date.now()
let llmCallsThisWindow = 0
function llmBudgetAvailable(): boolean {
  if (MAX_LLM_PER_MIN <= 0) return true
  const now = Date.now()
  if (now - llmWindowStart >= 60_000) { llmWindowStart = now; llmCallsThisWindow = 0 }
  if (llmCallsThisWindow >= MAX_LLM_PER_MIN) return false
  llmCallsThisWindow++
  return true
}

// ── Simple cache ──────────────────────────────────────────────────────────────
type CacheEntry = { ts: number; ids: string[]; scores: Map<string, number> }
const cache = new Map<string, CacheEntry>()
const CACHE_TTL = 15 * 60 * 1000
const CACHE_MAX = 300

function evictCache() {
  if (cache.size < CACHE_MAX) return
  const cutoff = Date.now() - CACHE_TTL
  const keys = Array.from(cache.keys())
  for (const k of keys) {
    if ((cache.get(k)!).ts < cutoff) cache.delete(k)
  }
  // If still too large after TTL pass, drop oldest entries
  if (cache.size >= CACHE_MAX) {
    const entries = Array.from(cache.entries()).sort((a, b) => a[1].ts - b[1].ts)
    for (const [k] of entries.slice(0, 50)) cache.delete(k)
  }
}

function cheapHash(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return h.toString(36)
}

// ── Per-product judgements, keyed by intent rather than by sentence ──────────
// The order cache below can only be reused when the identical product set comes
// back for the identical wording, which on a live catalogue is close to never.
// What is genuinely reusable is the judgement itself: what this piece is worth
// FOR THIS INTENT. "Smart shoes for a wedding" and "wedding shoes" are the same
// question and deserve the same answer about the same loafer.
//
// So scores are memoised under intent|productId, and a later search that shares
// the intent inherits every score it already has and asks the model only about
// the pieces it has never seen. A judge call still happens — it is just a
// smaller one, on a pool that is mostly already understood.
type Judged = { ts: number; score: number; reason: string }
const judged = new Map<string, Judged>()
const JUDGED_MAX = 4000

function judgedKey(intent: string, productId: string): string {
  return intent + '\u0000' + productId
}

function readJudged(intent: string, products: UcpProduct[]): Map<string, LLMScore> {
  const out = new Map<string, LLMScore>()
  const cutoff = Date.now() - CACHE_TTL
  for (const p of products) {
    const hit = judged.get(judgedKey(intent, p.id))
    if (hit && hit.ts >= cutoff) out.set(p.id, { score: hit.score, reason: hit.reason })
  }
  return out
}

/** Judge after the response rather than in front of it. On by default; set
 *  RELEVANCE_RERANK_BLOCKING=on to go back to making the shopper wait. */
const JUDGE_IN_BACKGROUND =
  (process.env.RELEVANCE_RERANK_BLOCKING ?? 'off').toLowerCase() !== 'on'

/** How long the shopper will wait for taste before being handed the keyword
 *  page instead.
 *
 *  Pure background judging was the wrong trade and the wrong trade in a way
 *  that only showed up in use. It optimises for the SECOND person to ask a
 *  question: they get the judged page free, while the first gets keyword
 *  order. Every person looking at this app right now asks each question once,
 *  so in practice nobody was ever seeing a judged page — the ranking worked
 *  perfectly and was shown to no one. "The AI is getting dumber" was exactly
 *  right, and it was this.
 *
 *  So the judge gets a short window in front of the response. It is short
 *  because it is a promise to the shopper about the worst case, not an
 *  estimate of the normal one: measured, the catalogue answers in about five
 *  seconds and Cerebras scores forty products in two or three. Miss the
 *  window — a cold provider, a long tail — and the page still goes out, and
 *  the judging still completes behind it for next time. Nothing is wasted
 *  either way. */
const JUDGE_WAIT_MS = Number(process.env.RELEVANCE_RERANK_WAIT_MS ?? 6000)

/** Intents with a judge already running. Without this, ten shoppers asking the
 *  same thing in the same minute each spawn their own call — ten times the
 *  cost for one answer, and the rate limiter then denies the eleventh person
 *  something the first ten already paid for. */
const judging = new Set<string>()

/** Start the judge, give it a short head start, and hand back whatever it has
 *  when the window closes.
 *
 *  The promise is NOT abandoned when the window closes — it keeps running,
 *  writes its scores, and is kept alive past the response by `after` so a
 *  serverless freeze cannot kill it mid-call. So a miss costs the shopper
 *  nothing and still warms the next search. */
function judgeWithHeadStart(
  intent: string,
  run: () => Promise<Map<string, LLMScore> | null>,
): Promise<Map<string, LLMScore> | null> {
  // Already in flight for this intent: don't start a second one, and don't
  // wait on the first either — it will land in the memo shortly.
  if (judging.has(intent)) return Promise.resolve(null)
  judging.add(intent)

  const work = (async () => {
    try {
      const fresh = await run()
      if (fresh) writeJudged(intent, fresh)
      return fresh
    } catch {
      return null
    } finally {
      judging.delete(intent)
    }
  })()

  // Survive the response if the window closes first.
  runAfterResponse(async () => { await work })

  const missed = Symbol('missed')
  return Promise.race([
    work,
    new Promise<typeof missed>(r => setTimeout(() => r(missed), JUDGE_WAIT_MS)),
  ]).then(v => (v === missed ? null : (v as Map<string, LLMScore> | null)))
}

function writeJudged(intent: string, scores: Map<string, LLMScore>) {
  if (judged.size >= JUDGED_MAX) {
    // Oldest-first, in one pass. This map is a memo, not a source of truth —
    // dropping half of it costs one extra model call on some future search.
    const oldest = Array.from(judged.entries()).sort((a, b) => a[1].ts - b[1].ts)
    for (const [k] of oldest.slice(0, Math.floor(JUDGED_MAX / 2))) judged.delete(k)
  }
  const ts = Date.now()
  for (const [id, s] of Array.from(scores)) {
    judged.set(judgedKey(intent, id), { ts, score: s.score, reason: s.reason })
  }
}

function cacheKey(query: string, products: UcpProduct[], tasteProfile?: string): string {
  const ids = products.map(p => p.id).sort().join(',')
  // tasteProfile MUST be part of the key — it's injected into the judge prompt
  // (profileLine) and reorders the result, so a key without it would serve one
  // shopper's taste-biased ranking to every other shopper with the same
  // query+products. Shoppers with no memory share the "" bucket (still cached).
  return cheapHash(query.toLowerCase().trim() + '|' + ids + '|' + (tasteProfile?.toLowerCase().trim() || ''))
}

// ── Stage 1: BM25-lite ────────────────────────────────────────────────────────
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(t => t.length > 1)
}

function productDoc(p: UcpProduct): { titleTokens: string[]; bodyTokens: string[] } {
  const titleTokens = tokenize(p.title || '')

  const desc = (p.description || '').slice(0, DESC_CHARS).replace(/<[^>]+>/g, ' ')
  const tags  = (p.tags || []).join(' ')
  const opts  = (p.options || []).flatMap(o => [o.name, ...o.values]).join(' ')
  const body  = [desc, tags, opts, p.vendor || ''].join(' ')

  return { titleTokens, bodyTokens: tokenize(body) }
}

export function bm25Scores(query: string, products: UcpProduct[]): Map<string, number> {
  const qTokens = tokenize(query)
  if (!qTokens.length || !products.length) return new Map()

  const k1 = 1.2, b = 0.75
  const docs = products.map(p => productDoc(p))

  // Title is a separate field with 2.5× boost — treat as separate field BM25 then sum
  const titleLengths = docs.map(d => d.titleTokens.length)
  const bodyLengths  = docs.map(d => d.bodyTokens.length)
  const avgTitle = titleLengths.reduce((s, v) => s + v, 0) / (products.length || 1)
  const avgBody  = bodyLengths.reduce((s, v) => s + v, 0)  / (products.length || 1)

  // IDF per query term over the candidate set (body)
  const idf = new Map<string, number>()
  for (const t of Array.from(new Set(qTokens))) {
    const df = docs.filter(d => d.bodyTokens.includes(t) || d.titleTokens.includes(t)).length
    idf.set(t, Math.log((products.length - df + 0.5) / (df + 0.5) + 1))
  }

  const raw = products.map((p, i) => {
    const d = docs[i]
    let score = 0
    for (const t of qTokens) {
      const idfVal = idf.get(t) ?? 0

      // Body BM25
      const tfBody = d.bodyTokens.filter(x => x === t).length
      const bm25Body = idfVal * (tfBody * (k1 + 1)) / (tfBody + k1 * (1 - b + b * bodyLengths[i] / (avgBody || 1)))

      // Title BM25 (2.5× boost)
      const tfTitle = d.titleTokens.filter(x => x === t).length
      const bm25Title = idfVal * (tfTitle * (k1 + 1)) / (tfTitle + k1 * (1 - b + b * titleLengths[i] / (avgTitle || 1)))

      score += bm25Body + 2.5 * bm25Title
    }
    return { id: p.id, score }
  })

  // Normalize to 0–1
  const max = Math.max(...raw.map(r => r.score), 1e-9)
  // Feedback-loop demotion: products/vendors repeatedly flagged as a bad
  // match for this concept (web/app/api/cron/quality-feedback) get
  // suppressed here — the single insertion point that feeds every
  // downstream path (BM25-only fallback, the blended LLM score below, and
  // which candidates even make it into topN for the LLM judge to see).
  // Cheap synchronous lookup, zero added latency on the overwhelmingly
  // common case (no adjustment applies).
  const conceptKey = decomposeQuery(query).garmentKeys[0] || 'general'
  const result = new Map<string, number>()
  raw.forEach(({ id, score }, i) => {
    const adjustment = getRelevanceAdjustment(conceptKey, id, products[i]?.vendor)
    // Clamp to [0,1]: a demotion floors at 0 (dropped), a promotion can't push a
    // product above the normalized max (keeps the blended score well-defined).
    result.set(id, Math.max(0, Math.min(1, score / max - adjustment)))
  })
  return result
}

// ── Stage 2: LLM batch relevance scorer ──────────────────────────────────────
function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

/** One product, as the judge sees it. Every field is merchant-written, so each
 *  is reduced to a single inert line by the same function the stylist prompt
 *  uses — one sanitiser, not two. The shape, the order and the caps are
 *  unchanged. */
function compactProduct(p: UcpProduct, idx: number): string {
  const title    = fenceUntrusted(p.title, 160) || 'Untitled'
  const vendorRaw = p.vendor && p.vendor !== 'Independent Seller' ? fenceUntrusted(p.vendor, 60) : ''
  const vendor   = vendorRaw ? ` | ${vendorRaw}` : ''
  const tagList  = p.tags?.length ? p.tags.slice(0, 8).map(t => fenceUntrusted(t, 40)).filter(Boolean).join(',') : ''
  const tags     = tagList ? ` | tags: ${tagList}` : ''
  const opts     = p.options?.length
    ? ' | opts: ' + p.options.map(o => `${fenceUntrusted(o.name, 40)}[${o.values.slice(0, 4).map(v => fenceUntrusted(v, 40)).join(',')}]`).join(' ')
    : ''
  const descText = fenceUntrusted(p.description, DESC_CHARS)
  const desc     = descText ? ' | ' + descText : ''
  return `[${idx}] ${title}${vendor}${tags}${opts}${desc}`
}

type LLMScore = { score: number; reason: string }

async function llmRelevanceScores(
  query: string,
  products: UcpProduct[],
  tasteProfile?: string,
  /** Where to leave the ladder's account of this call. Belongs to ONE
   *  rerankByRelevance invocation — see the note on `onOutcome`. */
  detail?: { value: string },
): Promise<Map<string, LLMScore> | null> {
  if (!products.length) return null

  const productLines = untrustedBlock(products.map((p, i) => compactProduct(p, i)).join('\n'))
  // tasteProfile is assembled in the stylist route from, among other things,
  // the vendor names of the shopper's saved products — which arrive in the
  // request body from the browser. It is interpolated into the SYSTEM message
  // below, so it is fenced like any other untrusted field.
  const profileSafe = fenceUntrusted(tasteProfile, 400)
  const profileLine = profileSafe ? `\nShopper profile: ${profileSafe}\n` : ''

  const matched = matchStyles(query)
  const vocabBlock = vocabPromptBlock(matched)
  // What real shoppers are trending toward right now (style-signals cron →
  // trend_concepts table) — a step-5 tiebreaker nudge for the judge, worth
  // one short line. Empty string until the cron has produced data.
  const trendLine = trendContextLine()

  const system = `You are the buyer behind Discern — a curated independent fashion platform. Score how well each product actually answers the shopper, the way a stylist with thirty years on the floor would. Not a keyword matcher: the words overlapping is the least interesting thing about a piece.
${vocabBlock}${profileLine}${trendLine ? `${trendLine}\n` : ''}
━━━ WHAT YOU KNOW ━━━
${judgeKnowledge(query)}
${planPromptBlock(query, tasteProfile)}
${houseTaste()}

SCORING RUBRIC (0–100). Apply in strict order — a low score at any step caps the total:
1. GARMENT CATEGORY (0–30 pts): Is it the item type they asked for? Completely wrong category (homeware, book, candle when they want a shirt) → 0–5. Adjacent but not quite right → 10–15. Correct → 25–30.
2. GENDER (0–20 pts): Explicitly gendered request + wrong gender → 0–8. Unisex or ambiguous request → full pts.
3. FABRIC & COLOUR (0–20 pts): Judge against the rules above, not against the words. A fibre that suits the season and the use, and a colour that sits in one temperature family or is a proven pairing → 16–20. Named match with the wrong fibre for the climate, or a colour that fights the rest of the ask → 6–12. Marketing with no fibre named → cap at 10.
4. CUT & OCCASION (0–20 pts): The cut has to answer the ask and the formality has to clear its floor. Right category at the wrong formality — a sneaker for cocktail, a hoodie for an interview — is a failure however well the words match → 0–7. Silhouette, formality and vibe all land → 16–20.
5. QUALITY SIGNAL (0–10 pts): Named fibre grade, stated weight, real construction and hardware over generic filler. When intent is open this is the tie-breaker.

Two things separate a good answer from a merely matching one, and both are invisible to a keyword search: whether the fabric suits the season and the use, and whether the colour and formality suit the moment. Weigh them accordingly.

SPREAD THE SCORES. If everything lands in the seventies you have not judged anything — you have re-sorted a search. The best piece for this exact ask should clear the merely-plausible one by twenty points or more, and something that only shares vocabulary with the query belongs under 30.

Output ONLY a JSON array — one object per product, no prose, no markdown, no explanation outside the JSON:
[{"i":0,"s":87},{"i":1,"s":12},...]
- "i" = product index (integer, 0-based, exactly as given)
- "s" = relevance score 0–100 (integer)
Return an entry for EVERY index. No trailing text after the closing bracket.

Score only. This asked for an eight-word reason per product as well, which
is forty short sentences of generation on every search — written to a field
nothing in the app has ever read, while the call it was inflating ran out of
time and fell back to keyword order. The scores are the product.`

  const userMsg = `Query: "${query}"\n\nProducts:\n${productLines}`

  // One ladder, shared with everything else that needs a model — see
  // lib/ai/infer.ts. What was here instead was a bespoke two-provider hedge:
  // Cerebras leading, `groqChat` behind it, and nothing else.
  //
  // Both rungs were broken in the same invisible way. This prompt is the
  // rubric plus the fashion knowledge plus the house eye plus forty products;
  // it runs well past Cerebras' hard 8K context, so the LEAD provider could
  // never answer at all. And `groqChat` is the OpenRouter client, whose
  // default model is the free auto-router with a tight daily cap — so the
  // only fallback was the least reliable pool we have. Groq direct, healthy
  // and generous and running the same model family, was never tried. NVIDIA
  // and Gemini were never tried. Measured on production the judge returned
  // no-answer on every single search while four providers reported healthy.
  //
  // The ladder skips Cerebras when the prompt will not fit rather than
  // failing on it, and walks down through providers that can.
  // The judge is the one caller that must never cost the page: its fallback,
  // keyword order, is instant and perfectly serviceable. So the whole ladder
  // gets a budget barely larger than a single attempt — try the best provider,
  // try one more if it is quick about it, then stop and let the words decide.
  const judged = await infer('smart', [{ role: 'user', content: userMsg }], system, {
    // Forty scores is ~450 tokens of JSON. The cap is far above that ON
    // PURPOSE: both providers this reaches are reasoning models, and their
    // thinking is billed against the SAME completion budget as their answer.
    // At 600 the model could spend the lot deliberating and return an empty
    // string — which is precisely what production did, `no-answer` on every
    // search, inside its time budget, with three healthy providers. Cutting
    // tokens to make it fit made it fit less.
    //
    // So: room to think AND to answer, and an explicit instruction not to
    // think very hard. Scoring forty products against a written rubric is not
    // a task that improves with deliberation.
    max_tokens: 2400, temperature: 0, reasoningEffort: 'low',
    timeoutMs: TIMEOUT_MS, budgetMs: LADDER_MS,
  })
  const raw = judged.text
  // The provider string carries every rung's reason when none answered
  // ("none(cerebras:too-long,groq:empty,...)"). Kept where the outcome can
  // reach it: "the model has bad taste" and "no model answered, and here is
  // which one failed how" were the same picture from outside for two days.
  if (detail) detail.value = judged.provider
  if (raw) console.log(`[rerank] judged by ${judged.provider}`)
  else console.warn(`[rerank] no judgement — ${judged.provider}`)

  if (!raw) return null

  // Two-tier JSON parser: full array first, then per-object regex fallback
  const out = new Map<string, LLMScore>()
  try {
    const match = raw.match(/\[[\s\S]*\]/)
    if (match) {
      const arr = JSON.parse(match[0]) as any[]
      for (const item of arr) {
        const i = Number(item?.i)
        const s = Number(item?.s)
        if (!isNaN(i) && i >= 0 && i < products.length && !isNaN(s)) {
          out.set(products[i].id, { score: Math.min(100, Math.max(0, s)), reason: item?.r ?? '' })
        }
      }
    }
  } catch {
    // Fallback: per-object regex
    const objRe = /\{\s*"i"\s*:\s*(\d+)\s*,\s*"s"\s*:\s*(\d+)[^}]*\}/g
    let m: RegExpExecArray | null
    while ((m = objRe.exec(raw)) !== null) {
      const i = parseInt(m[1]), s = parseInt(m[2])
      if (i >= 0 && i < products.length) {
        out.set(products[i].id, { score: Math.min(100, Math.max(0, s)), reason: '' })
      }
    }
  }

  // Require at least 50% coverage — else treat as failure
  if (out.size < products.length * 0.5) return null
  return out
}

// ── Orchestrator ──────────────────────────────────────────────────────────────
/** Did the judge actually judge?
 *
 *  Every exit below that returns the keyword order is a SILENT fallback — no
 *  model reached, quota gone, timeout, unparseable reply — and each one leaves
 *  the page looking exactly like a keyword search with filters on it. Nothing
 *  anywhere recorded which had happened, so "the AI has bad taste" and "the
 *  taste layer did not run" were indistinguishable from the outside, on every
 *  kind of question. This is the difference, reported. */

export type JudgeOutcome =
  | 'judged'    // a model scored this page, now
  | 'cached'    // a model scored this intent earlier and the scores still hold
  | 'warming'   // keyword order, and the judge is running behind it for next time
  | 'disabled' | 'no-budget' | 'no-answer' | 'too-few'

export async function rerankByRelevance(
  query: string,
  products: UcpProduct[],
  tasteProfile?: string,
  /** How this judgement went, and the ladder's own account of it, verbatim
   *  ("none(cerebras:too-long,groq:empty,...)" when nobody answered).
   *
   *  BOTH VALUES BELONG TO THIS CALL. They used to be module-level `export
   *  let`s, which meant the value a request reported was whatever the last
   *  request to finish had written: a search whose judge said PROVIDER-A
   *  would report PROVIDER-B if B landed in between. "The AI has bad taste"
   *  and "the judge never ran" were already indistinguishable from outside;
   *  a value that belonged to somebody else's search made it worse.
   *  See `scripts/judge-scope.js`. */
  onOutcome?: (o: JudgeOutcome, detail: string) => void,
): Promise<UcpProduct[]> {
  /** This call's account, written by the judge below and read by `say`. */
  const detail = { value: '' }
  const say = (o: JudgeOutcome) => { try { onOutcome?.(o, detail.value) } catch { /* never break a search over telemetry */ } }
  if (products.length <= 1) { say('too-few'); return products }

  // Stage 1: BM25 — always runs, free, provides baseline and pre-filter
  const bm25 = bm25Scores(query, products)
  const byBm25 = [...products].sort((a, b) => (bm25.get(b.id) ?? 0) - (bm25.get(a.id) ?? 0))
  const topN  = byBm25.slice(0, RERANK_TOP_N)
  const rest  = byBm25.slice(RERANK_TOP_N)

  if (!isRerankEnabled()) {
    say('disabled')
    // BM25-only path: better than vendor-hash, zero cost
    return [...topN, ...rest]
  }

  // Cache check — in-memory first (fastest, but wiped on every serverless
  // cold start on Vercel), then the Convex-persisted cache (survives cold
  // starts, several-hour TTL — this is what actually makes repeat/similar
  // searches across different shoppers or instances skip the LLM judge
  // entirely). Either hit applies the exact same reorder-and-attach-scores
  // logic.
  const key = cacheKey(query, topN, tasteProfile)
  const applyCachedOrder = (ids: string[], scores: Map<string, number>): UcpProduct[] => {
    const reordered = ids
      .map(id => products.find(p => p.id === id))
      .filter(Boolean) as UcpProduct[]
    for (const p of reordered) {
      const s = scores.get(p.id)
      if (s !== undefined) (p as any).relevance_score = Math.round(s * 100)
    }
    const seenIds = new Set(ids)
    const remaining = products.filter(p => !seenIds.has(p.id))
    return [...reordered, ...remaining]
  }

  const cached = cache.get(key)
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    say('cached'); return applyCachedOrder(cached.ids, cached.scores)
  }

  const persisted = await readPersistentRerankCache(key)
  if (persisted) {
    // Warm the in-memory cache too, so the next request on this same
    // instance doesn't pay even the Convex round-trip. Evict first — on an
    // instance that mostly hits the persistent cache this write path would
    // otherwise never prune and the Map would grow for the process lifetime.
    evictCache()
    cache.set(key, { ts: Date.now(), ids: persisted.ids, scores: persisted.scores })
    say('cached'); return applyCachedOrder(persisted.ids, persisted.scores)
  }

  // Cost guard: if we're over the per-minute LLM budget, serve BM25 order.
  if (!llmBudgetAvailable()) {
    say('no-budget')
    return [...topN, ...rest]
  }

  // Stage 2: LLM batch score, minus whatever this intent has already judged.
  const intent = intentKey(query, tasteProfile)
  const known = readJudged(intent, topN)
  const unseen = topN.filter(p => !known.has(p.id))

  let llm: Map<string, LLMScore> | null
  if (unseen.length === 0) {
    llm = known
  } else if (JUDGE_IN_BACKGROUND) {
    // The shopper waits a few seconds for taste, and never more than that.
    //
    // Two failed positions preceded this one. Awaiting the judge outright: a
    // search over ninety stores took ~36s against the route's 26s budget, so
    // the deadline fired and the retry ran with the judge switched OFF — the
    // page was late AND unjudged. Then not awaiting it at all: the page was
    // fast, the judging worked perfectly, and it was shown to nobody, because
    // it only ever landed in time for the SECOND person to ask a question and
    // almost every question is asked once.
    //
    // A short window in front of the response is the only version that serves
    // the person actually looking at the screen. Miss it and the page still
    // goes out, and the judging still finishes behind it for next time.
    const inTime = await judgeWithHeadStart(intent, () => llmRelevanceScores(query, unseen, tasteProfile, detail))
    llm = inTime || known.size > 0
      ? new Map([...Array.from(known), ...Array.from(inTime ?? new Map())])
      : null
    if (!llm) {
      // Nothing known yet: keyword order, and honest about which of the two
      // reasons that is. 'warming' is not 'no-answer' — one is a judge that
      // has not run YET, the other a judge that could not run at all, and
      // treating them alike is how a working system looks broken.
      say('warming')
      return [...topN, ...rest]
    }
  } else {
    const fresh = await llmRelevanceScores(query, unseen, tasteProfile, detail)
    if (fresh) writeJudged(intent, fresh)
    // A failed judge on the unseen pieces does not throw away the scores we
    // already hold — those pieces keep their judgement and the rest fall back
    // to keyword order beneath them, which beats discarding both.
    llm = fresh || known.size > 0 ? new Map([...Array.from(known), ...Array.from(fresh ?? new Map())]) : null
  }

  if (!llm || llm.size === 0) {
    // Fallback to BM25 order — no model answered, so this page is a keyword
    // search wearing the app's clothes. The one exit that most needs saying
    // out loud, because it is indistinguishable from bad taste.
    say('no-answer')
    return [...topN, ...rest]
  }
  say('judged')

  // Blend scores: 0.7 * llm + 0.3 * bm25
  // Products with LLM score < 20 (wrong category entirely) are demoted below
  // all relevant products — BM25 cannot rescue a fundamentally wrong item.
  const MIN_LLM_SCORE = 20
  const blended = topN.map(p => {
    const llmEntry = llm.get(p.id)
    const bScore   = bm25.get(p.id) ?? 0             // 0–1
    // Coverage used to be all-or-nothing, so an absent entry could only mean a
    // parse gap and a neutral 50 was a fair guess. Now a judge call can be
    // skipped for pieces this intent already knows, and an absent entry means
    // genuinely unjudged — scoring those a flat 50 would float them above
    // pieces the model actually looked at and marked down. Unjudged rides on
    // its keyword score alone, which puts it where it belongs: below anything
    // judged good, above anything judged bad.
    if (!llmEntry) return { p, final: 0.3 * bScore, reason: '' }
    const lScore   = llmEntry.score / 100            // 0–1
    const demoted  = llmEntry.score < MIN_LLM_SCORE
    // Demoted items get a strongly negative offset so they sort after everything relevant
    const final    = demoted ? -(1 - lScore) : 0.7 * lScore + 0.3 * bScore
    return { p, final, reason: llmEntry.reason }
  })

  blended.sort((a, b) => b.final - a.final)

  // Attach scores for debug/UI
  for (const { p, final, reason } of blended) {
    ;(p as any).relevance_score  = Math.round(final * 100)
    ;(p as any).relevance_reason = reason
  }

  const reranked = blended.map(x => x.p)

  // Populate cache
  evictCache()
  const scoreMap = new Map<string, number>()
  for (const { p, final } of blended) scoreMap.set(p.id, final)
  cache.set(key, { ts: Date.now(), ids: reranked.map(p => p.id), scores: scoreMap })
  // Fire-and-forget — never let the persisted-cache write delay the reply.
  void writePersistentRerankCache(key, reranked.map(p => p.id), scoreMap)

  return [...reranked, ...rest]
}
