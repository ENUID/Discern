import { NextRequest, NextResponse } from 'next/server'
import { groqChat, wardrobeVisionChat, stripThinkTags, stripAiDashes, stripSafetyLabels, looksLikeLeakedReasoning, CHAT_MODEL, FAST_MODEL } from '@/lib/groq'
import { geminiChat } from '@/lib/gemini'
import { GlobalCatalogService, sameGarmentVerdictFor, lastJudgeOutcome, type CatalogProgress } from '@/lib/services/GlobalCatalogService'
import { normalizeFashionTypos, buildMandatoryConcepts, classifyQuerySlot, productMatchesSlot, productMatchesGarmentKey, decomposeQuery, GARMENT_VOCAB, GARMENT_CATEGORY, type SlotCategory } from '@/lib/queryParser'
import { matchStyles, vocabPromptBlock } from '@/lib/styleVocabulary'
import { detectBrandsInQuery } from '@/lib/stores'
import { compileIntent, continueIntent, compiledReplyText, parseBudget } from '@/lib/intentCompiler'
import { selectKnowledgeModules } from '@/lib/knowledgeModules'
import { outfitPlan, composeOutfit } from '@/lib/fashion/outfitKnowledge'
import { suggestQuery } from '@/lib/fashion/suggestQuery'
import { exactMatchNote, stripUnverifiableClaims } from '@/lib/fashion/exactMatch'
import { stripEmphasis } from '@/lib/plainText'
import { lastJudgeDetail } from '@/lib/services/relevanceRerank'
import {
  stylistRateLimited, modelLooksDown, noteModelFailure, noteModelSuccess,
  markProviderOut, providerOutUntil, isRateLimited, PROVIDER_OUT_MS,
} from '@/lib/stylist/limits'
import { logAiUsage, recordVocabMiss, estimateTokens, convexUsageClient } from '@/lib/stylist/usage'
import {
  outfitSlotInfo,
  isBareGreeting, isHeavyQuery, isReactionOnly, isProductIntent,
  isShoppingContinuation, isActionFollowThrough,
} from '@/lib/intent/routing'
import {
  SYSTEM, CHAT_SYSTEM, VISION_SYSTEM, GROUNDING_SYSTEM, WARDROBE_SYSTEM,
  enrichHistory, productBlock, compactProductLine,
  type StylistProduct, type StylistMessage,
} from '@/lib/stylist/prompts'
import {
  multiCategorySearch, looksFrom, multiCategoryReplyText, refineSearchQuery,
  brandNameOf, stripBrandNames, dedupeById,
  INITIAL_RESULT_CAP, MULTI_CATEGORY_PER_GROUP_CAP,
} from '@/lib/stylist/retrieval'
import { parseStylistAnswer } from '@/lib/stylist/answer'
import { startTrace, step, note, shown, finishTrace, type Trace } from '@/lib/stylist/trace'
import { saveTrace, tracingEnabled } from '@/lib/stylist/traceStore'
import { runAfterResponse } from '@/lib/afterResponse'
import { redactSecrets } from '@/lib/redact'
import { type SameGarmentVerdict } from '@/lib/services/sameGarment'
import { describeGarment } from '@/lib/services/describeGarment'
import { routeReason } from '@/lib/fashion/intentRouter'
import { cerebrasChat, cerebrasVisionChat, CEREBRAS_VISION_CONFIGURED } from '@/lib/cerebras'
import { nvidiaChat, nvidiaVisionChat, NVIDIA_CONFIGURED } from '@/lib/nvidia'
import { api } from '@/convex/_generated/api'

export const maxDuration = 60

// True when a query justifies the heavier Gemini model.
// Conversational messages (greetings, chitchat, emotional support) go straight to Groq.

// Gemini for queries that need fashion depth; OpenRouter for conversational
// replies. Both are tried as fallbacks for each other so a single provider/
// model failure can never kill the reply.
// Distinct model tiers in priority order: fast first (cheap, high throughput),
// then smart for depth. Deduped below so CHAT_MODEL isn't tried twice when
// FAST_MODEL defaults to the same value.
const GROQ_8B = FAST_MODEL
const GROQ_70B = CHAT_MODEL

async function stylistChat(
  messages: any[],
  system: string,
  opts?: { max_tokens?: number; temperature?: number },
  useGemini = false
): Promise<{ role: string; content: string | null; provider: string }> {
  const errors: string[] = []

  // Build an ordered list of every provider/model to try. Whatever the routing
  // preference, EVERY available model is a fallback — a single failure (bad
  // model name, transient error, one provider down) can never kill the reply.
  // Only when literally every provider fails do we surface an error.
  const hasGemini = !!process.env.GOOGLE_AI_API_KEY
  const groqOrder = useGemini
    ? [GROQ_70B, GROQ_8B]   // heavy: depth-first Groq fallback behind Gemini
    : [GROQ_8B, GROQ_70B]   // chitchat: fast 8b first, 70b as depth fallback
  const groqModels = groqOrder.filter((m, i, a): m is string => !!m && a.indexOf(m) === i)

  type Attempt = { name: string; run: () => Promise<{ role: string; content: string | null }> }
  const attempts: Attempt[] = []

  const geminiAttempt: Attempt = { name: 'gemini', run: () => geminiChat(messages, system, opts) }
  const groqAttempts: Attempt[] = groqModels.map(model => ({
    name: `groq(${model})`,
    run: () => groqChat(messages, system, undefined, { ...opts, model }),
  }))
  // Cerebras: a 4th free-tier pool, independent of OpenRouter/Gemini/Groq's
  // caps, and — per repeated real-world feedback — noticeably more reliable
  // output than whatever openrouter/free's auto-router happens to land on.
  // Its one hard constraint is an 8K TOKEN CONTEXT cap covering prompt +
  // completion together; see cerebrasFits below for how that's actually
  // accounted for per-request rather than assumed.
  // reasoning_effort is 'medium' on the heavy path, not 'high': the base heavy
  // prompt (slimmed SYSTEM ~3.5K + FASHION CORE ~1.4K = ~4.9K, plus any injected
  // knowledge modules) still leaves a bounded slice of the 8K window for BOTH the
  // model's internal chain-of-thought AND its final answer — 'high' effort
  // asks for more reasoning than that headroom reliably supports, and a
  // request that runs out of completion budget mid-thought returns its raw,
  // incomplete reasoning as if it were the answer (exactly what a real
  // leaked-reasoning incident looked like — the reply ended mid-token,
  // "[SEARCH: premium linen shirt beach" with no closing bracket, a
  // textbook truncation signature). 'medium' still asks for real depth,
  // just within a budget this prompt size can actually deliver on.
  const cerebrasAttempt: Attempt = {
    name: 'cerebras',
    run: () => cerebrasChat(messages, system, { ...opts, reasoning_effort: useGemini ? 'medium' : 'low' }),
  }

  // Cerebras leads whenever it genuinely can: its free tier is far more
  // generous than OpenRouter's (1M tokens/day, 30 req/min vs. ~20/min &
  // 50-1000/day) and openrouter/free's auto-router can land on a weak
  // underlying model on any given request, so quality is inconsistent where
  // Cerebras' gpt-oss-120b is not. Its one real constraint is a hard 8K
  // TOKEN CONTEXT cap (a window limit, not a volume limit, and it covers
  // prompt + completion TOGETHER) — the heavy path's base SYSTEM prompt
  // alone already runs ~5,500 tokens before contextBlock (shopper profile,
  // memory, wardrobe, style vocab, product context) is even added, so this
  // is a real, load-bearing check, not a rare edge case: a shopper with any
  // meaningful accumulated context routinely won't fit, and that's fine —
  // they correctly fall back to the Gemini-led order below rather than risk
  // truncation on Cerebras. A fresh/light-context conversation usually does
  // fit, and that's the case this exists to speed up and improve.
  const CEREBRAS_CONTEXT_CAP = 8192
  const promptTokenEstimate = estimateTokens(system) + messages.reduce((sum, m) => sum + estimateTokens(String(m?.content ?? '')), 0)
  const cerebrasFits = promptTokenEstimate + (opts?.max_tokens ?? 1200) + 300 < CEREBRAS_CONTEXT_CAP

  if (cerebrasFits) {
    attempts.push(cerebrasAttempt)
    if (useGemini && hasGemini) attempts.push(geminiAttempt)
    attempts.push(...groqAttempts)
    if (!useGemini && hasGemini) attempts.push(geminiAttempt)
  } else if (useGemini) {
    if (hasGemini) attempts.push(geminiAttempt)
    attempts.push(...groqAttempts, cerebrasAttempt)
  } else {
    attempts.push(...groqAttempts, cerebrasAttempt)
    if (hasGemini) attempts.push(geminiAttempt)
  }
  // NVIDIA NIM (thinkingmachines/inkling) — a 5th independent free pool, appended
  // LAST so it's a pure safety net: only reached when every other provider has
  // already failed. It's a reasoning model (slower, token-hungry), which is fine
  // for a last-resort fallback but not as a primary. Skipped when the key isn't set.
  if (NVIDIA_CONFIGURED) {
    attempts.push({ name: 'nvidia', run: () => nvidiaChat(messages, system, opts) })
  }

  // Per-attempt time cap. THIS is why a first query so often failed with "that
  // took me too long" and the very same query worked on resend: a single slow
  // provider could hold the whole request. chatCompletion allows 25s per call
  // and retries twice with backoff, so one unhealthy provider could burn ~79s
  // against a ~30s budget for the ENTIRE chain — the fallback never got a turn.
  // Meanwhile the failure marked that provider on cooldown, so the resend
  // skipped it instantly and a healthy provider answered. Capping each attempt
  // makes the FIRST request behave like that resend: a stalled provider is
  // abandoned quickly and the next one gets its shot inside the same budget.
  // ── Skip a provider that is known to be out ──────────────────────────────
  // lib/groq.ts keeps a cooldown for OpenRouter and Groq; Gemini, Cerebras and
  // NVIDIA had none, so a provider whose free tier was exhausted was tried
  // again on every single request — up to ATTEMPT_MS burnt each time before
  // failing over. With two of five pools out of quota that is most of a minute
  // spent rediscovering it, per shopper, forever.
  //
  // A quota or auth failure is not transient: the key is spent or wrong, and it
  // will still be spent in ten seconds. So it is remembered. A timeout is NOT
  // remembered — that really can be a one-off.
  const now = Date.now()
  const live = attempts.filter(a => {
    const until = providerOutUntil(a.name.split('(')[0])
    if (until && until > now) { console.log(`[stylist] skipping ${a.name} — out of quota until ${new Date(until).toISOString()}`); return false }
    return true
  })
  // Never skip everything: if every pool is marked out, try them all anyway
  // rather than fail without asking.
  const chain = live.length ? live : attempts

  const ATTEMPT_MS = Number(process.env.STYLIST_ATTEMPT_MS ?? 11_000)
  // What the whole ladder is allowed, matching the caller's own chat deadline
  // so the two cannot disagree about how long there is.
  const LADDER_MS = Number(process.env.STYLIST_LADDER_MS ?? 34_000)
  const ladderStart = Date.now()
  const attemptTimedOut = Symbol('attempt-timeout')
  for (let i = 0; i < chain.length; i++) {
    const a = chain[i]
    // 11 seconds is the right cap when there are five rungs below you and the
    // wrong one when there is nothing. Two of the four pools are out — cerebras
    // wants paying, gemini's free tier is spent — so the chain is often groq
    // then nvidia, and abandoning groq at 11s left twelve seconds of budget
    // unspent and served the shopper an apology instead of an answer. Give up
    // on a provider early only when giving up buys another real attempt.
    const rungsLeft = chain.length - i
    const budgetLeft = LADDER_MS - (Date.now() - ladderStart)
    // An even split starves the rung most likely to answer.
    //
    // With four pools healthy an even share is 34/4 = 8.5s, floored to 11s, so
    // every rung was cut off at eleven seconds — and eleven seconds is not
    // enough to generate twelve hundred tokens against a five-thousand-token
    // prompt on any of these providers. Four attempts each killed mid-sentence,
    // the deadline reached, and the shopper told "I could not think this one
    // through" by a chain in which nothing had gone wrong except the clock.
    // Four requests out of four for a summer wedding, with every provider
    // reporting ok, and modelTrace saying exactly this: the whole chain ran
    // past the reply deadline.
    //
    // The rungs are not equal. The first is the one chosen as best for this
    // request, and a first-rung success ends the request outright — so it gets
    // the share it actually needs and the rest divide what is left. A fallback
    // is worth having; it is not worth starving the primary to keep three of
    // them in reserve.
    // The last rung is checked FIRST, and it beats the first-rung rule when a
    // chain is one long. Nothing is being held in reserve for a fallback that
    // does not exist, so a lone provider gets everything that is left — which
    // is the case whenever three of the four pools are out of quota, and the
    // one this ordering existed to fix before.
    const FIRST_SHARE = 0.55
    const cap = rungsLeft === 1
      ? Math.max(ATTEMPT_MS, budgetLeft)
      : i === 0
        ? Math.max(ATTEMPT_MS, Math.floor(budgetLeft * FIRST_SHARE))
        : Math.max(ATTEMPT_MS, Math.floor(budgetLeft / rungsLeft))
    try {
      const result = await Promise.race([
        a.run(),
        new Promise<typeof attemptTimedOut>(resolve => setTimeout(() => resolve(attemptTimedOut), cap)),
      ])
      if (result === attemptTimedOut) {
        // Not an error, just too slow to be worth waiting on — try the next pool.
        console.error(`[stylist] ${a.name}: attempt exceeded ${cap}ms, moving on`)
        errors.push(`${a.name}: timeout`)
        continue
      }
      // Strip visible chain-of-thought leakage — some models in this chain
      // (gpt-oss with reasoning_effort set, or whatever openrouter/free
      // routes to on a given request) can emit a raw <think> block inline
      // in .content instead of a clean answer. See stripThinkTags in
      // lib/groq.ts — this is the shared choke point for the text-chat side.
      // stripAiDashes is the deterministic backstop for the "never use em
      // dashes" prompt rule — see its comment in lib/groq.ts for why prompt
      // compliance alone isn't enough across a 4-provider fallback chain.
      const cleaned = result?.content ? stripSafetyLabels(stripAiDashes(stripThinkTags(result.content))) : result?.content
      if (cleaned && looksLikeLeakedReasoning(cleaned)) {
        // Narrated chain-of-thought with no <think> tag to strip — showing
        // this to the shopper is strictly worse than trying the next
        // provider, and parsing [SEARCH:]/[OUTFIT:] tokens out of it is
        // unreliable (a stray token-format mention inside the reasoning
        // itself can get captured instead of the real one near the end).
        // Treat exactly like empty content: this attempt failed, move on.
        console.error(`[stylist] ${a.name}: discarded leaked-reasoning content (${cleaned.length} chars)`)
        errors.push(`${a.name}: leaked reasoning`)
        continue
      }
      if (cleaned) return { ...result, content: cleaned, provider: a.name }
      errors.push(`${a.name}: empty content`)
    } catch (err) {
      const msg = (err as Error).message || ''
      // Spent key or wrong key — do not pay for this again for a while.
      if (/\b429\b|rate limit|too many requests|quota|insufficient|billing|credit|\b401\b|\b403\b|unauthor|invalid api key/i.test(msg)) {
        const base = a.name.split('(')[0]
        markProviderOut(base)
        console.warn(`[stylist] ${base} marked out for ${PROVIDER_OUT_MS / 60000}min — ${msg.slice(0, 120)}`)
      }
      errors.push(`${a.name}: ${msg}`)
    }
  }

  // Everything failed — throw with the full diagnostic trail.
  throw new Error(errors.join(' | ') || 'all model calls failed')
}

const BUSY_REPLY = "I'm briefly stretched thin and couldn't finish that one. Give it a few seconds and try again, or tell me the vibe and I'll style you from there."

// ── Types ───────────────────────────────────────────────────────────────────

type Comparison = {
  rows: { label: string; values: string[] }[]
  pick?: { index: number; reason: string }
}

// Models routinely name a pinned pick in prose ("buy the navy shirt (product
// 6)") instead of emitting the [PRODUCT:N] token that renders its card, so the
// very piece they're recommending never shows — the reported "it shows just
// one product" when a combination was asked for. Deterministically convert any
// in-range "product N" mention (1-indexed, matching the PRODUCT N labels the
// prompt shows the model) into the real 0-indexed [PRODUCT:N-1] token so every
// numbered pick gets carded. Only runs when products are actually pinned;
// real [PRODUCT:N] tokens (colon after PRODUCT) never match and are untouched.
function linkPinnedProductMentions(text: string, pinnedCount: number): string {
  if (!text || pinnedCount <= 0) return text
  return text.replace(/\(?\bproducts?\s*#?\s*(\d{1,2})\b\)?/gi, (whole, numStr) => {
    const n = parseInt(numStr, 10)
    return (n >= 1 && n <= pinnedCount) ? `[PRODUCT:${n - 1}]` : whole
  })
}

// Coarse garment category of a pinned product, from its title (same vocab the
// search path uses). Null when the title carries no recognizable garment word.
function pinnedProductCategory(p: StylistProduct): SlotCategory | null {
  for (const k of decomposeQuery(String(p?.title || '')).garmentKeys) {
    const c = GARMENT_CATEGORY[k] as SlotCategory | undefined
    if (c) return c
  }
  return null
}

// HARD GUARANTEE that every piece the reply recommends shows as a card, placed
// RIGHT AFTER the sentence that describes it — no matter whether the model
// emitted a [PRODUCT:N] token, mis-placed it, or just named the piece in prose
// ("pick the navy half-sleeve shirt"). We re-derive card placement from scratch:
// pick ONE pinned product per garment category the reply recommends (the model's
// own carded pick for that category if it made one, else the best title match),
// strip every existing token, then re-insert each card immediately after the
// first sentence that mentions its category. This is what makes a pinned
// combination read cleanly: shirt sentence -> shirt card, shorts sentence ->
// shorts card, instead of the model's scrambled order.
function placePinnedCards(text: string, products: StylistProduct[]): string {
  if (!text || products.length === 0) return text
  const catOf = products.map(pinnedProductCategory)
  // Indices the model already carded, in the order it wrote them.
  const modelCarded: number[] = []
  const cardRe = /\[PRODUCT:(\d{1,2})\]/g
  let cm: RegExpExecArray | null
  while ((cm = cardRe.exec(text)) !== null) {
    const i = Number(cm[1])
    if (i >= 0 && i < products.length && modelCarded.indexOf(i) === -1) modelCarded.push(i)
  }
  // Prose with tokens stripped — but PRESERVE the model's paragraph breaks (only
  // collapse runs of spaces/tabs), so a rich multi-paragraph explanation keeps
  // its structure instead of flattening into one block.
  const clean = text
    .replace(/[ \t]*\[PRODUCT:\d{1,2}\][ \t]*/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .trim()
  // Categories the reply actually recommends (garment words present in prose).
  const recCats: SlotCategory[] = []
  decomposeQuery(clean).garmentKeys.forEach(k => {
    const c = GARMENT_CATEGORY[k] as SlotCategory | undefined
    if (c && recCats.indexOf(c) === -1) recCats.push(c)
  })
  // One product per recommended category: the model's pick for that category if
  // it carded one, otherwise the pinned piece whose title the reply mentions most.
  const lower = clean.toLowerCase()
  const chosen = new Map<SlotCategory, number>()
  recCats.forEach(cat => {
    const modelPick = modelCarded.filter(i => catOf[i] === cat)[0]
    if (modelPick !== undefined) { chosen.set(cat, modelPick); return }
    const cands = products.map((p, i) => ({ p, i })).filter(({ i }) => catOf[i] === cat)
    if (cands.length === 0) return
    let best = cands[0], bestScore = -1
    cands.forEach(c => {
      const toks = String(c.p.title || '').toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 3)
      const score = toks.reduce((n, t) => n + (lower.includes(t) ? 1 : 0), 0)
      if (score > bestScore) { bestScore = score; best = c }
    })
    chosen.set(cat, best.i)
  })
  // NEVER drop a card the model chose: any model-carded product we couldn't map
  // to a recommended category (e.g. a title with no garment word) is preserved
  // and appended, rather than silently removed by the re-placement.
  const chosenIdx = new Set<number>(Array.from(chosen.values()))
  const leftover = modelCarded.filter(i => !chosenIdx.has(i) && !(catOf[i] && recCats.indexOf(catOf[i] as SlotCategory) !== -1))
  if (chosen.size === 0 && leftover.length === 0) return text
  // Re-insert each card right after the first sentence that names its category,
  // walking paragraph by paragraph so the model's paragraph breaks survive.
  const placed = new Set<SlotCategory>()
  const paragraphs = clean.split(/\n+/).map(para => {
    const sentences = para.match(/[^.!?]+[.!?]*/g) || [para]
    const parts: string[] = []
    sentences.forEach(s => {
      const sentence = s.trim()
      if (sentence) parts.push(sentence)
      decomposeQuery(sentence).garmentKeys.forEach(k => {
        const c = GARMENT_CATEGORY[k] as SlotCategory | undefined
        if (c && chosen.has(c) && !placed.has(c)) { parts.push(`[PRODUCT:${chosen.get(c)}]`); placed.add(c) }
      })
    })
    return parts.join(' ')
  })
  // Any chosen card never matched to a sentence, plus preserved leftovers, go last.
  const tail: string[] = []
  Array.from(chosen.keys()).forEach(cat => { if (!placed.has(cat)) tail.push(`[PRODUCT:${chosen.get(cat)}]`) })
  leftover.forEach(i => tail.push(`[PRODUCT:${i}]`))
  let result = paragraphs.join('\n\n')
  if (tail.length > 0) result += `\n\n${tail.join(' ')}`
  return result
}

// ── Parse reply ─────────────────────────────────────────────────────────────
function parseReply(raw: string): { reply: string; comparison?: Comparison } {
  const compareStart = raw.indexOf('[COMPARE:')
  if (compareStart === -1) return { reply: raw.trim() }

  let depth = 0
  let jsonStart = -1
  let jsonEnd = -1
  for (let i = compareStart + 9; i < raw.length; i++) {
    const ch = raw[i]
    if (ch === '{') {
      if (jsonStart === -1) jsonStart = i
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0) { jsonEnd = i; break }
    }
  }

  const blockEnd = jsonEnd !== -1 ? raw.indexOf(']', jsonEnd) + 1 : raw.length
  const replyText = (raw.slice(0, compareStart) + raw.slice(blockEnd)).replace(/\s+$/, '').trim()

  if (jsonStart === -1 || jsonEnd === -1) return { reply: replyText || raw.trim() }

  try {
    const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1))
    if (Array.isArray(parsed?.rows) && parsed.rows.length > 0) {
      const rows = parsed.rows
        .filter((r: any) => r && typeof r.label === 'string' && Array.isArray(r.values))
        .slice(0, 4)
        .map((r: any) => ({ label: String(r.label), values: r.values.map((v: any) => String(v ?? '')) }))
      const comparison: Comparison = { rows }
      if (parsed.pick && typeof parsed.pick.index === 'number') {
        comparison.pick = { index: parsed.pick.index, reason: String(parsed.pick.reason ?? '') }
      }
      return { reply: replyText || 'Here is how they compare:', comparison }
    }
  } catch {}
  return { reply: replyText || raw.trim() }
}

// ── Search token ────────────────────────────────────────────────────────────

async function groundReplyInProducts(question: string, products: any[], history: StylistMessage[]): Promise<string | null> {
  if (!products || products.length === 0) return null
  const list = products.slice(0, 10).map((p, i) => compactProductLine(p, i)).join('\n')
  const userMsg = `The shopper's LATEST request: ${question}\n\nPRODUCTS FOUND for it (real data, numbered):\n${list}`
  // Include the recent conversation so the grounded reply stays context-aware
  // (occasion, budget, colours already discussed) instead of answering blind.
  const recent = (history || [])
    .slice(-6)
    .map(m => ({ role: (m.role === 'assistant' ? 'assistant' : 'user') as 'assistant' | 'user', content: String(m?.content || '').slice(0, 600) }))
    .filter(m => m.content)
  try {
    const msg = await stylistChat([...recent, { role: 'user', content: userMsg }], GROUNDING_SYSTEM, { max_tokens: 900, temperature: 0.4 }, false)
    let out = (msg?.content || '').trim()
    if (!out) return null
    // This pass must never trigger another search/outfit/compare — strip any.
    // OUTFITS? — the multi-outfit token has an S before the colon, so the old
    // pattern missed it and an [OUTFITS: ...] emitted here (after the parser has
    // already run) leaked into the chat bubble as literal bracket text.
    out = out.replace(/\[(SEARCH|OUTFITS?|COMPARE|WARDROBE):[^\]]*\]/gi, '').replace(/[ \t]{2,}/g, ' ').trim()
    return out || null
  } catch (e) {
    console.error('[stylist] grounding pass failed:', e)
    return null
  }
}

// ── Outfit token ─────────────────────────────────────────────────────────────

// ── Multi-outfit token ───────────────────────────────────────────────────────
// [OUTFITS: a|b|c || d|e|f || g|h|i] — several DISTINCT looks in one reply, each
// look separated by "||", each slot within a look by "|". This is what lets
// "create three outfits" render as three separate carded looks instead of prose.
// (The regex differs from [OUTFIT:] by the S, so the two never collide.)

// ── Wardrobe token ───────────────────────────────────────────────────────────
// Brace-depth scan rather than a lazy regex — a lazy `\{[\s\S]*?\}` only
// matches when the JSON's closing brace is immediately followed by `]` with
// nothing in between, so any pretty-printed whitespace before the `]` (common
// LLM output) made this silently fail and leak the raw [WARDROBE: {...}] JSON
// blob straight into the chat reply. Mirrors parseReply's [COMPARE:] handling.
function parseWardrobeToken(text: string): { reply: string; wardrobeScan?: any } {
  const tagStart = text.search(/\[WARDROBE:/i)
  if (tagStart === -1) return { reply: text.trim() }

  let depth = 0
  let jsonStart = -1
  let jsonEnd = -1
  for (let i = tagStart; i < text.length; i++) {
    const ch = text[i]
    if (ch === '{') {
      if (jsonStart === -1) jsonStart = i
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0) { jsonEnd = i; break }
    }
  }
  if (jsonStart === -1 || jsonEnd === -1) return { reply: text.trim() }

  const blockEnd = text.indexOf(']', jsonEnd) + 1
  const replyText = (text.slice(0, tagStart) + text.slice(blockEnd > 0 ? blockEnd : jsonEnd + 1)).replace(/\n+$/, '').trim()

  try {
    const data = JSON.parse(text.slice(jsonStart, jsonEnd + 1))
    return { reply: replyText || text.trim(), wardrobeScan: data }
  } catch {
    return { reply: replyText || text.trim() }
  }
}

// ── Per-IP rate limit (shared in-process; Vercel may have multiple instances) ─
// ── Route ───────────────────────────────────────────────────────────────────
// Streamed as newline-delimited JSON so the frontend's loading tracker can
// show REAL progress instead of a client-only guessed animation — each
// `{type:'progress', ...}` line fires at a genuine transition in the actual
// work below (about to hit the catalog, catalog resolved with N real
// candidates, about to call the model, etc.), and the single
// `{type:'result', ...}` line at the end carries exactly the same payload
// shape this route always returned, unchanged. This was the direct fix for
// three related, repeatedly-reported problems: the tracker's last step
// replaying the same canned lines 6-8 times while waiting (there was
// nothing real to show once the canned script ran out); no correlation
// between when the backend actually finished and when the frontend stopped
// animating (a fixed client-side schedule, not genuine sync); and the same
// staleness on the "See more" tracker. Every branch below is the exact same
// logic that ran before this change — only `NextResponse.json(X)` became
// `finish(X)`, and a handful of `send(...)` calls were inserted at points
// that were already real await boundaries.
export async function POST(req: NextRequest) {
  if (stylistRateLimited(req)) {
    return NextResponse.json({ reply: "Too many requests — please slow down.", busy: false }, { status: 429 })
  }

  const encoder = new TextEncoder()
  let streamClosed = false
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (obj: Record<string, unknown>) => {
        if (streamClosed) return
        try { controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n')) } catch { /* client disconnected */ }
      }
      // icon matches the existing StylistStepIcon set on the frontend
      // (read/search/filter/curate/outfit/...) so the visual language is
      // unchanged — only the SOURCE of each step is now real, not simulated.
      const send = (icon: string, main: string, detail?: string) => write({ type: 'progress', icon, main, detail })
      const finish = (result: Record<string, unknown>) => {
        write({ type: 'result', ...result })
        streamClosed = true
        try { controller.close() } catch {}
      }

      try {
        await runStylistRequest(req, send, finish)
      } catch (e) {
        console.error('[stylist] error:', e)
        if (isRateLimited(e)) { finish({ reply: BUSY_REPLY, busy: true, retryable: true, comparison: null }); return }
        finish({ reply: "Something went wrong on my end. Give it another go?", retryable: true, comparison: null })
      }
      // Safety net: every real code path below calls finish() itself, but if
      // one somehow falls through without it, the stream must still close —
      // an open stream with no final line hangs the frontend's reader forever.
      if (!streamClosed) finish({ reply: "Something went wrong on my end. Give it another go?", retryable: true, comparison: null })
    },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache, no-transform' },
  })
}

// Wall-clock budget for one request. The Vercel function is killed at
// maxDuration (60s) with NO final result line written, which the client can
// only render as a blank "something went wrong" — the worst possible outcome
// when we very likely already have the reply in hand and are only waiting on a
// slow catalog fetch or a free-tier provider hanging to its own 25-30s abort.
// This deadline sits comfortably under 60s so we always finish() ourselves,
// returning the best-effort reply (and whatever products we gathered) instead
// of getting force-killed mid-stream.
const REQUEST_BUDGET_MS = 52_000

// ── The model breaker ────────────────────────────────────────────────────────
// When a provider is down or a key has expired, every request rediscovers that
// from scratch: five providers, each with its own timeout, before anything is
// shown. The shopper waits the better part of a minute to be told nothing, and
// asking again waits the same again — which is what "I asked twice and it did
// not work" looks like from the outside.
//
// After a few consecutive failures the model is skipped entirely for a short
// window and the request goes straight to the catalogue. It costs a styled
// answer for a minute; it saves every shopper in that minute from a 50-second
// wait for an apology. One success closes it immediately.
// Race any awaited work against the remaining budget. On timeout it resolves to
// `fallback` (never rejects) and the outer flow proceeds to finish() with what
// it has; the orphaned promise settles harmlessly after the stream is closed.
function withDeadline<T>(work: Promise<T>, deadlineAt: number, fallback: T): Promise<T> {
  const remaining = deadlineAt - Date.now()
  if (remaining <= 400) return Promise.resolve(fallback)
  return new Promise<T>((resolve) => {
    let settled = false
    const timer = setTimeout(() => { if (!settled) { settled = true; resolve(fallback) } }, remaining)
    work.then(
      (v) => { if (!settled) { settled = true; clearTimeout(timer); resolve(v) } },
      () => { if (!settled) { settled = true; clearTimeout(timer); resolve(fallback) } },
    )
  })
}

/** Seal the trace and store it AFTER the response has gone out.
 *
 *  runAfterResponse survives the serverless freeze that follows a flush, which
 *  is the whole reason it exists — and it means a diagnostic write is never on
 *  the path a shopper is waiting on. */
function keepTrace(t: Trace | null): void {
  const sealed = finishTrace(t)
  if (!sealed) return
  runAfterResponse(() => saveTrace(sealed))
}

async function runStylistRequest(
  req: NextRequest,
  send: (icon: string, main: string, detail?: string) => void,
  finish: (result: Record<string, unknown>) => void,
): Promise<void> {
  const requestDeadline = Date.now() + REQUEST_BUDGET_MS
  /** Why did we show this? One per request, held in this closure — never a
   *  module global, which is what makes lastJudgeOutcome unusable for the
   *  question. See lib/stylist/trace.ts. */
  let trace: Trace | null = null
  try {
    const body = await req.json()
    const mode: string = typeof body?.mode === 'string' ? body.mode : 'default'
    const products: StylistProduct[] = Array.isArray(body?.products) ? body.products.slice(0, 8) : []
    const rawHistory: StylistMessage[] = Array.isArray(body?.messages) ? body.messages.slice(-20) : []
    const question: string = typeof body?.question === 'string' ? body.question.trim().slice(0, 500) : ''
    /** The same question with fashion and occasion words spell-corrected.
     *
     *  The model reads typos fine; the regex layers in this file do not, and
     *  they are the ones deciding whether a message can search at all and
     *  whether it names an occasion. "an intervew on friday" recognised nothing
     *  and quietly became a worse answer. The shopper's own wording still goes
     *  to the model — this copy exists only for the matchers. */
    const questionRead: string = normalizeFashionTypos(question)
    const images: string[] = Array.isArray(body?.images)
      ? (body.images as unknown[]).filter((x): x is string => typeof x === 'string' && x.startsWith('data:image/') && x.length <= 6_000_000).slice(0, 8)
      : []
    // Only used by mode:'wardrobe-scan' to persist the scan server-side —
    // Convex independently re-verifies authProof, this route never trusts it.
    const userEmail: string | undefined = typeof body?.userEmail === 'string' && body.userEmail.trim() ? body.userEmail.trim() : undefined
    const authProof = body?.authProof
    const buyerCurrency: string = typeof body?.buyerCurrency === 'string'
      ? body.buyerCurrency.toUpperCase()
      : 'USD'
    // Shopper's country, so Fabrics product searches geo-boost local brands first
    // (same as the main search). Prefer an explicit body value, else IP geolocation.
    const countryCode: string | null = (typeof body?.buyerCountry === 'string' && body.buyerCountry.trim()
      ? body.buyerCountry.trim().toUpperCase()
      : req.headers.get('x-vercel-ip-country') || req.headers.get('cf-ipcountry') || null)
    // Read the field that was tested, not a neighbouring one. This line
    // checked `memorySummary` and then returned `body.tasteProfile.trim()` —
    // a key the interface has never sent. So the moment a shopper HAD a
    // memory, the guard passed, `.trim()` ran on undefined, the TypeError
    // reached the handler's outer catch, and they were told "That did not get
    // through. Ask me again." Every message, permanently, for exactly the
    // returning shoppers the memory exists to serve. Asking again could not
    // help: the memory was still there the second time.
    if (tracingEnabled()) {
      trace = startTrace({
        question,
        gender: typeof body?.shopperGender === 'string' ? body.shopperGender : null,
        country: countryCode,
        currency: buyerCurrency,
      })
    }

    const memorySummary: string | undefined = typeof body?.memorySummary === 'string' && body.memorySummary.trim()
      ? body.memorySummary.trim()
      : undefined
    const shopperGender: string | undefined = typeof body?.shopperGender === 'string' && body.shopperGender.trim()
      ? body.shopperGender.trim()
      : undefined
    // Full profile string: "shops for: women | women's sizes: tops M, bottoms 28, shoes 7"
    const shopperProfile: string | undefined = typeof body?.shopperProfile === 'string' && body.shopperProfile.trim()
      ? body.shopperProfile.trim()
      : undefined
    // Formatted wardrobe summary from a prior scan (taste_profile.wardrobe,
    // client-derived same as shopperProfile) — was stored but never actually
    // reached the prompt before this; see wardrobeBlock below.
    const shopperWardrobe: string | undefined = typeof body?.shopperWardrobe === 'string' && body.shopperWardrobe.trim()
      ? body.shopperWardrobe.trim()
      : undefined
    // Structured sizes (not parsed back out of shopperProfile's prose string)
    // — used as a real soft ranking signal in GlobalCatalogService, not just
    // text the model reads. tops/outerwear/dresses share one size, bottoms
    // and shoes each have their own.
    const shopperSizes: { tops?: string; bottoms?: string; shoes?: string } =
      body?.shopperSizes && typeof body.shopperSizes === 'object'
        ? {
            tops: typeof body.shopperSizes.tops === 'string' ? body.shopperSizes.tops.trim() || undefined : undefined,
            bottoms: typeof body.shopperSizes.bottoms === 'string' ? body.shopperSizes.bottoms.trim() || undefined : undefined,
            shoes: typeof body.shopperSizes.shoes === 'string' ? body.shopperSizes.shoes.trim() || undefined : undefined,
          }
        : {}
    // Which stated size applies to a given search query, based on the garment
    // category it's actually searching for — a "shoes" query should never be
    // nudged by the shopper's top size. Returns null when the query names no
    // recognizable garment or the shopper hasn't set that size.
    const sizeForQuery = (q: string): string | null => {
      const slot = classifyQuerySlot(q)
      if (slot === 'top' || slot === 'outer' || slot === 'dress') return shopperSizes.tops || null
      if (slot === 'bottom') return shopperSizes.bottoms || null
      if (slot === 'shoes') return shopperSizes.shoes || null
      return null
    }

    /** Who is asking, in one line, for the ranker.
     *
     *  This slot used to carry `tasteProfile` alone — a premium feature that is
     *  undefined for almost everybody. So relevanceRerank was handed an empty
     *  profile: nothing about the shopper reached the judge's prompt, and its
     *  cache keys on that same value, which meant every shopper with the same
     *  query shared one cached ordering. Two people on two phones asking the
     *  same thing got the same list because the system had, quite literally,
     *  computed it once for nobody in particular.
     *
     *  Everything below already arrives with every request. Ordering matters:
     *  gender leads, so readGender finds it without parsing prose.
     */
    const bagVendors = Array.from(new Set(
      (Array.isArray(body?.savedProducts) ? body.savedProducts : [])
        .map((p: any) => (typeof p?.vendor === 'string' ? p.vendor.trim() : ''))
        .filter(Boolean),
    )).slice(0, 5)
    const bagPrices = (Array.isArray(body?.savedProducts) ? body.savedProducts : [])
      .map((p: any) => (typeof p?.price === 'number' ? p.price : null))
      .filter((n: number | null): n is number => n !== null)
    const tasteProfile: string | undefined = [
      shopperGender,
      shopperProfile && shopperProfile !== shopperGender ? shopperProfile : '',
      bagVendors.length ? `bag: ${bagVendors.join(', ')}` : '',
      // A price band beats a price: the point is the register they shop in, not
      // a filter, and one expensive coat should not raise the floor on knitwear.
      bagPrices.length
        ? `usual spend around ${Math.round(bagPrices.reduce((a: number, b: number) => a + b, 0) / bagPrices.length)}`
        : '',
      Array.isArray(body?.recentSearches) && body.recentSearches.length
        ? `recently looked for: ${body.recentSearches.slice(0, 4).join('; ')}`
        : '',
      memorySummary || '',
      countryCode ? `shopping from ${countryCode}` : '',
    ].filter(Boolean).join(' · ') || undefined

    /** The catalogue does not need the model.
     *
     *  Every failure path in this file used to end the same way: an apology and
     *  no products. Provider quota, a cold model, a timeout, a thrown
     *  exception — whatever the cause, the shopper got "Something went wrong on
     *  my end" and an empty screen, which is the app not working rather than
     *  the model not working. They are not the same thing and should not look
     *  the same.
     *
     *  Everything needed to search is deterministic and already here: the
     *  intent compiler, the occasion planner, the concept builder. So when the
     *  model layer fails, this runs the search the shopper asked for anyway.
     *  It is a worse answer than a styled one — no reasoning, no ranking prose —
     *  and it is enormously better than nothing.
     *
     *  Returns null only when the catalogue itself came back empty, which is
     *  the one case where an apology is the honest reply.
     */
    const rescueSearch = async (): Promise<Record<string, unknown> | null> => {
      const q = applyGenderDefault(questionRead.trim())
      try {
        // 1. An occasion implies a whole outfit and is the richest thing we can
        //    do without a model — four slots, retrieved separately.
        const plan = outfitPlan(q, shopperGender)
        if (plan && plan.slots.length >= 2) {
          const groups = await withDeadline(multiCategorySearch(
            q, undefined, countryCode, buyerCurrency, tasteProfile, sizeForQuery,
            onSearchProgress, shopperGender,
          ), requestDeadline, null)
          if (groups && groups.length) {
            return {
              foundProducts: dedupeById(groups.flatMap(g => g.products)),
              foundProductGroups: groups,
              looks: await looksFrom(groups),
              searchQuery: q,
            }
          }
        }

        // 2. A compilable request — a garment with modifiers — needs no model
        //    either. This is the same path a plain "navy linen shirt" takes on
        //    a good day.
        const compiled = compileIntent(q, buyerCurrency)
        const searchArgs = compiled?.args
        const term = searchArgs?.searchQuery || q
        const found = await withDeadline(GlobalCatalogService.search(
          term, searchArgs?.budgetMax, [], countryCode, true,
          searchArgs?.mandatoryConcepts || buildMandatoryConcepts(term),
          searchArgs?.sort || 'relevance', searchArgs?.budgetCurrency || buyerCurrency,
          { fastFirstPage: true, onProgress: onSearchProgress }, [],
          // The shopper's own photograph, when they held one up. The vision
          // model's words got us to the right shelf; this picks off it by
          // measuring each candidate's photograph against theirs.
          tasteProfile, question, sizeForQuery(term), images[0] ?? null,
        ), requestDeadline, [] as any[])
        if (found && found.length) {
          return {
            foundProducts: dedupeById(found).slice(0, INITIAL_RESULT_CAP),
            searchQuery: term,
          }
        }
      } catch (e) {
        console.error('[stylist] rescue search failed:', e)
      }
      return null
    }

    /** What to send when the model is unavailable. Products if we can get them,
     *  and a reply that says what actually happened rather than a shrug.
     *  `busy` is the honest word for a rate limit: it is not broken, there are
     *  simply more people asking than the quota allows this minute. */
    /** Started as soon as we know this is a shopping request, so it is already
     *  running — or finished — by the time the model gives up. It used to begin
     *  only after every provider had timed out, which added its own fetch to an
     *  already long wait. Nothing awaits it unless it is needed, and if the
     *  model answers well it is simply discarded. */
    let speculative: Promise<Record<string, unknown> | null> | null = null
    const beginSpeculativeSearch = () => {
      if (!speculative) speculative = rescueSearch().catch(() => null)
    }

    /** Why the model chain gave up, in its own words, redacted.
     *
     *  The provider check says every pool is "ok" and the occasion path
     *  degrades on four requests out of four. It cannot be otherwise: that
     *  check sends a one-token "ok" and this path sends a five-thousand-token
     *  system prompt with knowledge modules bolted on, so the two are asking
     *  different questions of the same provider. The ladder already builds a
     *  full account of what each rung said and then throws it away into a
     *  console nobody outside the deploy can read.
     *
     *  Same fix as the provider check's whatFailed, which named a retired
     *  Gemini model on its first run after months of "unknown". */
    let modelTrace: string | null = null

    const withoutTheModel = async (kind: 'busy' | 'error') => {
      beginSpeculativeSearch()
      const rescued = await speculative
      if (rescued) {
        console.log(`[stylist] model unavailable (${kind}) — served from the catalogue directly`)
        note(trace, { degraded: true, modelTrace: modelTrace ?? undefined, judge: lastJudgeOutcome, judgeDetail: lastJudgeDetail })
        step(trace, 'served without the model', kind)
        shown(trace, (rescued.foundProducts as unknown[]) ?? [])
        keepTrace(trace)
        return finish({
          reply: kind === 'busy'
            ? 'A lot of people are asking at once, so I went straight to the catalogue for this one. Ask again in a moment and I will style it properly.'
            : 'I could not think this one through, so here is what the catalogue has for it. Ask again and I will do it properly.',
          comparison: null, busy: kind === 'busy', degraded: true,
          // Present only on a degraded answer. The interface ignores it; it is
          // here so "the model failed" can be read from outside without the
          // deploy logs, which is the only reason the Gemini retirement was
          // ever found.
          modelTrace: modelTrace ?? undefined,
          traceId: trace?.id,
          ...rescued,
        })
      }
      return finish({
        reply: kind === 'busy'
          ? 'A lot of people are using this right now and I could not get to your question. Give it a few seconds and ask again.'
          : 'That did not get through. Ask me again.',
        busy: kind === 'busy', retryable: true, comparison: null,
      })
    }

    // Maps the catalog search's real internal boundaries (the parallel store
    // fetch, an optional broaden pass, the LLM relevance judge) into live status
    // lines. Because each phase's line stays on screen until the NEXT real event
    // fires, the animation is paced entirely by genuine backend work — the slow
    // fetch keeps "Searching…" up, the slow judge keeps "Judging…" up — instead
    // of a fixed set of steps flashing past. `label` (set only on multi-category
    // sub-searches) scopes a line to its garment ("…for tops").
    const onSearchProgress: CatalogProgress = (e) => {
      const forCat = 'label' in e && e.label ? ` ${e.label.toLowerCase()}` : ''
      if (e.kind === 'fetch') {
        const detail = e.sampleBrands.length > 0
          ? e.sampleBrands.join(', ') + (e.brandCount > e.sampleBrands.length ? ` +${e.brandCount - e.sampleBrands.length} more` : '')
          : `${e.brandCount} stores`
        send('search', `Searching ${e.brandCount} brand ${e.brandCount === 1 ? 'catalog' : 'catalogs'}${forCat ? ` for${forCat}` : ''}`, detail)
      } else if (e.kind === 'broaden') {
        send('filter', `Widening the${forCat} search`, `recall(${e.queries.map(q => `"${q}"`).join(', ')})`)
      } else if (e.kind === 'judge') {
        send('curate', `Judging${forCat} relevance with AI`, `rank.relevance(${e.candidates} candidates)`)
      }
    }

    // ── Gender default ────────────────────────────────────────────────────
    // A plain query like "linen shirt for a beach party" carries no gender
    // word of its own — without this, it searches ungendered even when the
    // shopper's profile says Male/Female. Deterministically prefix the
    // shopper's own gender onto ungendered queries, UNLESS the message
    // already names a gender or clearly refers to someone else (wife, her,
    // etc.) — in that case leave it alone and let the actual words win.
    const profileGenderWord: 'men' | 'women' | null = (() => {
      const src = `${shopperProfile || ''} ${shopperGender || ''}`.toLowerCase()
      if (/\bwomen\b/.test(src)) return 'women'
      if (/\bmen\b/.test(src)) return 'men'
      return null
    })()
    const GENDER_TERM_RE = /\b(men|women|man|woman|male|female|ladies|guys?|boys?|girls?|unisex|gender.neutral|wife|husband|girlfriend|boyfriend|sister|brother|daughter|son|her|his|him)\b/i
    const applyGenderDefault = (q: string): string => {
      if (!profileGenderWord || !q.trim()) return q
      if (GENDER_TERM_RE.test(q)) return q
      return `${profileGenderWord} ${q}`
    }
    // Free-tier personalization signals — the old grid-search sent these
    // unconditionally (not premium-gated); Fabrics needs the same so free
    // shoppers don't lose all personalization now that it's the only surface.
    const savedProductsCtx: { title: string; vendor?: string; price?: number; currency?: string }[] =
      Array.isArray(body?.savedProducts) ? body.savedProducts.slice(0, 12) : []
    const recentSearches: string[] = Array.isArray(body?.recentSearches)
      ? (body.recentSearches as unknown[]).filter((x): x is string => typeof x === 'string' && x.trim().length > 0).slice(0, 8)
      : []

    // ── Load-more mode: a "see more" tap re-runs the same reasoned search
    // (BM25 + LLM judge, same as a fresh query) excluding whatever's already
    // shown, and returns the next best-of-best batch — NOT a bulk dump of
    // the wider candidate pool. Was slicing to the old SEARCH_RESULT_CAP
    // (52, 4 rows of 13) — the same "everything roughly relevant" flood
    // the initial-search cap was fixed to move away from applies here too.
    if (mode === 'load-more') {
      const loadMoreQuery: string = typeof body?.query === 'string' ? body.query.trim().slice(0, 200) : ''
      const excludeIds: string[] = Array.isArray(body?.excludeIds)
        ? (body.excludeIds as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 300)
        : []
      if (!loadMoreQuery) return finish({ foundProducts: [], comparison: null })
      try {
        send('search', 'Searching for more', `catalog.search("${loadMoreQuery}")`)
        const concepts = buildMandatoryConcepts(loadMoreQuery)
        const results = await GlobalCatalogService.search(
          loadMoreQuery, undefined, excludeIds, countryCode, true, concepts,
          'relevance', buyerCurrency, { fastFirstPage: true, loadMore: true }, [],
          tasteProfile, undefined, sizeForQuery(loadMoreQuery),
        )
        send('curate', 'Ranking the next best picks', `rank.relevance(${results.length} candidates)`)
        // A category "See more" (single-garment query, e.g. the Shorts strip's
        // "men shorts") must return ONLY that garment — the unfiltered load-more
        // was appending shirts into the Shorts strip. Apply the same slot filter
        // the initial grouped search uses; a mixed multi-garment query is left
        // unfiltered.
        const lmKeys = decomposeQuery(loadMoreQuery).garmentKeys
        // Garment-key precise (t-shirt strip stays t-shirts on "See more"), not
        // the broad slot that let button-up shirts leak into the t-shirt strip.
        const lmKey = lmKeys.length === 1 ? lmKeys[0] : undefined
        const lmResults = lmKey ? results.filter(p => productMatchesGarmentKey(p, lmKey)) : results
        return finish({ reply: '', comparison: null, foundProducts: dedupeById(lmResults).slice(0, INITIAL_RESULT_CAP), outfitSlots: null })
      } catch (e) {
        console.error('[stylist] load-more error:', e)
        // loadMoreError distinguishes "the fetch broke" from "genuinely no
        // more matches" — without it the frontend treated a transient
        // failure as exhaustion and hid the See-more button permanently.
        return finish({ foundProducts: [], comparison: null, loadMoreError: true })
      }
    }

    if (!question) {
      return finish({ reply: null, comparison: null })
    }

    // ── Wardrobe scan mode ──────────────────────────────────────────────────
    if (mode === 'wardrobe-scan') {
      if (images.length === 0) {
        return finish({ reply: 'Please share photos of your wardrobe pieces to get started.', comparison: null })
      }

      send('read', 'Reading your wardrobe photos', `vision.analyze(${images.length} photo${images.length > 1 ? 's' : ''})`)
      const raw = await wardrobeVisionChat(
        WARDROBE_SYSTEM,
        question || 'Please analyze my wardrobe pieces.',
        images,
        { max_tokens: 1400, temperature: 0.3 }
      )
      const { reply, wardrobeScan } = parseWardrobeToken(raw)

      // Persist the scan so future turns (any conversation, not just this
      // one) can reference it — see wardrobeBlock below. Best-effort: a
      // save failure (bad authProof, Convex hiccup) never blocks the
      // shopper from seeing their scan result this turn.
      let saved = false
      if (wardrobeScan && Array.isArray(wardrobeScan.items) && userEmail && authProof && convexUsageClient) {
        try {
          await convexUsageClient.mutation(api.tasteProfile.upsertWardrobeAnalysis, {
            userEmail,
            wardrobe: {
              items: wardrobeScan.items.slice(0, 30).map((it: any) => ({
                type: String(it?.type ?? '').slice(0, 60),
                color: String(it?.color ?? '').slice(0, 60),
                style: String(it?.style ?? '').slice(0, 60),
                occasions: Array.isArray(it?.occasions) ? it.occasions.slice(0, 5).map((o: any) => String(o).slice(0, 40)) : [],
              })),
              summary: String(wardrobeScan.summary ?? '').slice(0, 500),
              gaps: Array.isArray(wardrobeScan.gaps) ? wardrobeScan.gaps.slice(0, 5).map((g: any) => String(g).slice(0, 100)) : [],
              analyzedAt: Date.now(),
            },
            authProof,
          })
          saved = true
        } catch (e) {
          console.error('[stylist] wardrobe-scan save failed:', e)
        }
      }
      return finish({ reply, wardrobeScan: wardrobeScan ?? null, wardrobeSaved: saved, comparison: null })
    }

    // ── Instant fast path: deterministic compile for plain garment queries ──
    // Skips the LLM entirely when the message is a clear, compilable product
    // search — the same zero-latency mechanism that powered the old grid
    // search, now centralized here so every plain query benefits, not just
    // the ones that used to go through the separate search endpoint. Only
    // applies to text-only messages with nothing pinned — images and pinned
    // products need the full conversational/vision path.
    if (images.length === 0 && products.length === 0) {
      const prevUserMessage = [...rawHistory].reverse().find(m => m.role === 'user')?.content || ''
      const genderedQuestion = applyGenderDefault(question)
      let compiled = compileIntent(genderedQuestion, buyerCurrency)
      if (!compiled && prevUserMessage) compiled = continueIntent(genderedQuestion, prevUserMessage, buyerCurrency)
      if (compiled) {
        send('read', 'Reading your request', `parse("${genderedQuestion.length > 60 ? genderedQuestion.slice(0, 57) + '…' : genderedQuestion}") → ${compiled.summary}`)
        try {
          const preferredSize = sizeForQuery(compiled.args.searchQuery)
          // No generic "Searching the catalog" line here — the real fetch/judge
          // boundaries stream up from inside the search via onSearchProgress, so
          // each status line reflects genuine work (real brand count, real
          // candidate count) instead of a placeholder that flashes past.
          // Decompose the shopper's ORIGINAL words, not compiled.args.searchQuery
          // — compileIntent keeps only ONE garment (it picks the single most
          // specific hit), so "shirts and trousers" reached here as just
          // "trousers" and could never split. The full sentence still carries
          // both garments, so multiCategorySearch can give each its own group.
          const multiGroups = await multiCategorySearch(
            genderedQuestion, compiled.args.budgetMax, countryCode,
            compiled.args.budgetCurrency || buyerCurrency, tasteProfile, sizeForQuery,
            onSearchProgress, shopperGender,
          )
          if (multiGroups) {
            const totalCount = multiGroups.reduce((sum, g) => sum + g.products.length, 0)
            send('curate', 'Assembling the picks', `merge(${multiGroups.length} categories) → ${totalCount} pieces`)
            logAiUsage({ path: 'fast', provider: 'none', estPromptTokens: 0, estCompletionTokensCap: 0, ok: true })
            return finish({
              reply: multiCategoryReplyText(multiGroups.map(g => g.label)),
              comparison: null,
              // Flat mirror of the groups above, each already capped at
              // MULTI_CATEGORY_PER_GROUP_CAP — the frontend renders
              // foundProductGroups directly when present and only falls back
              // to this flat field otherwise, so it needs no separate cap
              // here (re-slicing it would silently undo the per-group cap).
              foundProducts: dedupeById(multiGroups.flatMap(g => g.products)),
              foundProductGroups: multiGroups,
              looks: await looksFrom(multiGroups),
              outfitSlots: null,
              searchQuery: compiled.args.searchQuery,
            })
          }
          let results = await GlobalCatalogService.search(
            compiled.args.searchQuery, compiled.args.budgetMax, [], countryCode, true,
            compiled.args.mandatoryConcepts || [], compiled.args.sort || 'relevance',
            compiled.args.budgetCurrency || buyerCurrency, { fastFirstPage: true, onProgress: onSearchProgress }, [],
            tasteProfile, question, preferredSize,
          )
          // Agentic refine, bounded to exactly one extra round: a budget cap
          // is the single most common, and only confidently-safe-to-relax,
          // cause of a thin page — never guess at broadening anything else
          // here, that's what the LLM path's own refine step is for.
          let refineNote = ''
          if (results.length < 4 && compiled.args.budgetMax) {
            const widened = await GlobalCatalogService.search(
              compiled.args.searchQuery, undefined, [], countryCode, true,
              compiled.args.mandatoryConcepts || [], compiled.args.sort || 'relevance',
              compiled.args.budgetCurrency || buyerCurrency, { fastFirstPage: true }, [],
              tasteProfile, question, preferredSize,
            )
            if (widened.length > results.length) {
              results = widened
              refineNote = ` Nothing under ${compiled.args.budgetCurrency || buyerCurrency} ${compiled.args.budgetMax}, so here’s the closest without that cap.`
            }
          }
          // Zero LLM tokens spent — logged for traffic-volume visibility,
          // not budget consumption (compileIntent is the whole point of the
          // fast path: it costs nothing from the shared free-tier pool).
          logAiUsage({ path: 'fast', provider: 'none', estPromptTokens: 0, estCompletionTokensCap: 0, ok: true })
          // Only announce a final ranking step if the search didn't already
          // stream a "Judging relevance" event (rerank runs only at ≥4 results)
          // — otherwise it double-reports the same work.
          if (results.length < 4) send('curate', 'Ranking the best picks', `rank.relevance(${results.length} candidates) → page.slice(${INITIAL_RESULT_CAP})`)
          return finish({
            reply: compiledReplyText(compiled, results.length) + refineNote,
            comparison: null,
            foundProducts: dedupeById(results).slice(0, INITIAL_RESULT_CAP),
            outfitSlots: null,
            searchQuery: compiled.args.searchQuery,
          })
        } catch (e) {
          console.error('[stylist] fast-path search error:', e)
          // Fall through to the LLM path below — never dead-end the shopper.
        }
      }
    }

    // ── Style vocabulary context ────────────────────────────────────────────
    const matchedStyles = matchStyles(question)
    const styleVocab = vocabPromptBlock(matchedStyles)

    const hasImages = images.length > 0
    const history = enrichHistory(rawHistory)

    // Build context block shown to the model regardless of vision/text
    const productContext = products.length > 0
      ? `STORE PRODUCTS the shopper pinned to THIS message and is asking about (there are exactly ${products.length}; when they say "these" or "tell me about these" they mean these ${products.length} and nothing else). Describe ONLY these, using ONLY the real data below, never invent a name, brand, colour, or detail that isn't here:\n\n${products.map(productBlock).join('\n\n---\n\n')}`
      : rawHistory.length > 0
        ? 'The shopper has no new product pinned. Continue the styling conversation using prior context.'
        : isBareGreeting(question)
          // Nothing to answer yet, so the hello IS the reply.
          ? 'FIRST MESSAGE and they have only said hello, there is no request to act on. Introduce yourself as Fabrics, their personal stylist, in one warm sentence, then ask what they need. Vary your phrasing each time.'
          // They opened with a real request. Answering it IS the introduction.
          : 'FIRST MESSAGE of a new conversation, nothing pinned. They have ALREADY told you what they want, so do it: search, advise, or build the look exactly as you would mid-conversation. Do NOT open by introducing yourself and asking what they need, they have just said. A few words of greeting may sit in front of the real answer, but never in place of it.'

    const imageNote = hasImages
      ? `The shopper has shared ${images.length} photo${images.length > 1 ? 's' : ''}. READ their message and honour its intent — do NOT default to styling when they asked to shop: ` +
        `(A) SHOP THE ITEM — if they say anything like "find similar", "show me similar", "something like this", "where can I get this", "find this", "more like this", "other options", "other brands", "cheaper", or name a different type/colour they want instead, identify the garment precisely and emit [SEARCH: garment type + colour + material + key details]. ` +
        `READ ANY BRAND NAME ON THE GARMENT — a logo, a chest embroidery, a woven label — and put it FIRST in the query when they asked for THIS piece ("find this", "give me this", "where can I get this", "this exact"). A name printed on the cloth is the strongest identifier a photograph carries, and it is the difference between returning the shirt they are pointing at and returning a shirt of roughly that colour. ` +
        `Leave the brand OUT only when they asked for something LIKE it — "similar", "cheaper", "other brands", "other options" — because there the point is to look elsewhere. ` +
        `If they want several categories or a different type per category, use [OUTFIT: ...] instead. ` +
        `(B) STYLING ADVICE — only when they ask how to wear it or what goes with it: advise, no token. ` +
        `(C) COMPLETE OUTFIT — build the missing pieces with [OUTFIT: ...]. ` +
        `If they attached a garment photo and the intent is ambiguous, lean towards (A) find similar rather than styling. ` +
        `Always read every visual detail: exact colour (not just "blue" "mid-wash indigo"), material cues, cut/silhouette, collar/hem details, any brand identifiers.`
      : ''

    // Build the shopper profile block for Fabrics context.
    // shopperProfile is the richer string (gender + labeled sizes); shopperGender is the fallback.
    const profileSrc = shopperProfile || (shopperGender ? `shops for: ${shopperGender.toLowerCase()}` : '')
    const genderBlock = profileSrc
      ? (() => {
          const isWomen = /women/i.test(profileSrc)
          const isMen = /\bmen\b/i.test(profileSrc)
          const isBoth = shopperGender === 'Both'
          const genderNote = isWomen
            ? "Default all product searches and [SEARCH:] / [OUTFIT:] queries to women's. Never ask for their gender or sizes you already know."
            : isMen
              ? "Default all product searches and [SEARCH:] / [OUTFIT:] queries to men's. Never ask for their gender or sizes you already know."
              : isBoth
                ? 'They shop for both men\'s and women\'s read context clues. Never ask for their size you already know.'
                : 'Never ask for their size you already know.'
          return `SHOPPER PROFILE use this for every recommendation, search token, and size comment:\n${profileSrc}\n${genderNote}\nWhen discussing fit, use their listed size as the baseline and note if something runs small/large relative to it.`
        })()
      : ''
    const memoryBlock = tasteProfile
      ? `SHOPPER MEMORY (from previous Fabrics sessions):\n${tasteProfile}`
      : ''
    // Country grounds every recommendation in reality: climate-appropriate
    // materials, local dress norms and occasions (a festival query means
    // something specific THERE), and what's actually loved/available in that
    // market — without it the model styles for a generic nowhere.
    const localeBlock = countryCode
      ? `SHOPPER'S COUNTRY: ${countryCode}. Factor in its climate and season, local dress norms and occasions, and what reads well there — prices are shown in ${buyerCurrency}.`
      : ''
    const wardrobeBlock = shopperWardrobe
      ? `SHOPPER'S KNOWN WARDROBE (from a photo scan Fabrics already did):\n${shopperWardrobe}\nUse this to spot real gaps and avoid recommending near-duplicates of what they already own — reference specific pieces by name when it's genuinely relevant, don't force it into every reply.`
      : ''
    // Free-tier personalization — saved products + recent searches, available
    // to every shopper (not gated behind tasteProfile, which is premium-only).
    const personalLines: string[] = []
    if (savedProductsCtx.length > 0) {
      const summary = savedProductsCtx.map(p => `${p.title}${p.vendor ? ` by ${p.vendor}` : ''}`).join('; ')
      personalLines.push(`Saved / favorited by the shopper: ${summary}. These reveal the styles, price range and brands they're drawn to.`)
    }
    // Learned taste — a crisp behavioural read derived from what they've SAVED
    // (the strongest positive signal we have). Sharpens the raw list above into
    // an explicit steer: which brands they gravitate to, and the price band
    // they actually buy in — so Fabrics matches their real budget and labels
    // instead of re-inferring it from scratch every turn. Needs a few saves to
    // be meaningful; below that the raw list already says enough.
    if (savedProductsCtx.length >= 3) {
      const brandCount = new Map<string, number>()
      for (const p of savedProductsCtx) {
        const b = (p.vendor || '').trim()
        if (b) brandCount.set(b, (brandCount.get(b) ?? 0) + 1)
      }
      const topBrands = Array.from(brandCount.entries())
        .filter(([, n]) => n >= 2)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([b]) => b)
      const prices = savedProductsCtx
        .map(p => (typeof p.price === 'number' && p.price > 0 ? p.price : null))
        .filter((n): n is number => n !== null)
        .sort((a, b) => a - b)
      const learned: string[] = []
      if (topBrands.length > 0) learned.push(`gravitates toward ${topBrands.join(', ')}`)
      if (prices.length >= 3) {
        const lo = prices[Math.floor(prices.length * 0.15)]
        const hi = prices[Math.floor(prices.length * 0.85)]
        const fmt = (n: number) => `${Math.round(n)} ${buyerCurrency}`
        learned.push(lo === hi ? `typically spends around ${fmt(lo)}` : `typically spends ${fmt(lo)}–${fmt(hi)}`)
      }
      if (learned.length > 0) {
        personalLines.push(`Learned taste (from their saves): ${learned.join('; ')}. Lean toward this unless the current request clearly says otherwise.`)
      }
    }
    if (recentSearches.length > 0) {
      personalLines.push(`Recent searches (most recent first): ${recentSearches.map(q => `"${q}"`).join(', ')}. Infer their evolving taste, but follow the CURRENT request first.`)
    }
    const personalizationBlock = personalLines.length > 0 ? `SHOPPER SIGNALS:\n${personalLines.join('\n')}` : ''
    const contextBlock = [genderBlock, localeBlock, memoryBlock, wardrobeBlock, personalizationBlock, styleVocab ? `STYLE CONTEXT FOR THIS REQUEST:\n${styleVocab}` : '', productContext, imageNote].filter(Boolean).join('\n\n')

    let raw = ''

    if (hasImages) {
      // Vision path Gemini 2.0 Flash first (best garment recognition), Groq
      // Llama 4 Scout as automatic fallback on rate-limit. Context + prior turns
      // are flattened into the prompt so wardrobe pieces stay in scope across
      // the whole conversation (build an outfit, find gaps, restyle, etc.).
      const convo = history
        .map(m => `${m.role === 'assistant' ? 'Fabrics' : m.role === 'system' ? 'Context' : 'Shopper'}: ${m.content}`)
        .join('\n')
      const visionPrompt = [
        contextBlock,
        convo ? `CONVERSATION SO FAR:\n${convo}` : '',
        `Shopper's current message: ${question}`,
      ].filter(Boolean).join('\n\n')

      // Unlike the text branch below, this call had no try/catch at all — any
      // failure (both Gemini AND the OpenRouter vision fallback rate-limited
      // or erroring) fell all the way through to the outer catch-all and
      // showed the shopper a generic "something went wrong on my end" with no
      // indication it was a busy/rate-limit condition, and no retry framing.
      // Give the vision path the same on-demand expertise as the text path
      // (Gemini/Groq vision have ample context; unlike the 8K light path).
      const visionSystemFull = VISION_SYSTEM + selectKnowledgeModules(question, { hasPinned: products.length > 0, countryCode })
      // The vision chain (Gemini + several OpenRouter models + Groq + NVIDIA) is
      // TIME-BOUNDED as a whole, so a run of hung providers can't eat the entire
      // request budget and starve the text fallback — the exact "stretched thin"
      // failure. It always leaves ~18s for a guaranteed text answer.
      send('read', 'Reading your photos', `vision.analyze(${images.length} photo${images.length > 1 ? 's' : ''})`)
      // Ordered vision chain, tried until one returns a clean answer. Cerebras
      // (gemma-4-31b) LEADS because it's the most reliable pool in the app;
      // then the free vision pools (Gemini/OpenRouter/Groq), then NVIDIA. Each
      // attempt is time-bounded and the loop stops early if <18s remain, so the
      // text fallback below is always guaranteed a slot (no "stretched thin").
      const cleanVision = (s: string) => {
        const c = stripSafetyLabels(stripAiDashes(stripThinkTags((s || '').trim())))
        return (c && !looksLikeLeakedReasoning(c)) ? c : ''
      }
      const visionAttempts: { name: string; run: () => Promise<string> }[] = []
      if (CEREBRAS_VISION_CONFIGURED) visionAttempts.push({ name: 'cerebras-vision', run: () => cerebrasVisionChat(visionSystemFull, visionPrompt, images, { max_tokens: 1100, temperature: 0.3 }) })
      visionAttempts.push({ name: 'gemini-cerebras-or-groq-vision', run: () => wardrobeVisionChat(visionSystemFull, visionPrompt, images, { max_tokens: 1100, temperature: 0.3 }) })
      if (NVIDIA_CONFIGURED) visionAttempts.push({ name: 'nvidia-vision', run: () => nvidiaVisionChat(visionSystemFull, visionPrompt, images, { max_tokens: 1100, temperature: 0.3 }) })
      let visionThrew: any = null
      let visionProvider = ''
      for (const attempt of visionAttempts) {
        if (requestDeadline - Date.now() < 18_000) break // reserve time for the text fallback
        try {
          // Capture the rejection BEFORE withDeadline swallows it — it resolves
          // its fallback instead of rejecting, so the outer catch was unreachable
          // and visionThrew stayed null forever. That made the rate-limit branch
          // below dead code: a turn where every provider 429'd returned the
          // generic "couldn't read the photos" instead of the busy reply the
          // client keys its retry framing off.
          const out = await withDeadline(
            attempt.run().catch((e: unknown) => { visionThrew = e; return '' }),
            Math.min(requestDeadline - 16_000, Date.now() + 22_000),
            '',
          )
          const cleaned = cleanVision(out)
          if (cleaned) { raw = cleaned; visionProvider = attempt.name; break }
        } catch (err) { visionThrew = err }
      }
      if (raw) {
        logAiUsage({ path: 'vision', provider: visionProvider, estPromptTokens: estimateTokens(visionSystemFull + visionPrompt), estCompletionTokensCap: 1100, ok: true })
      } else {
        // Every image reader is down. Don't dead-end — the TEXT providers
        // (Cerebras etc.) are healthy and have reserved time. Answer the styling
        // question from the shopper's own description; honest that we couldn't
        // see the photos. Falls through to the shared parse+search below.
        try {
          const textFallbackSystem = SYSTEM + selectKnowledgeModules(question, { hasPinned: products.length > 0, countryCode })
            + `\n\n━━━ NOTE ━━━ The shopper shared photo(s) but the image reader is unavailable this turn, so you cannot see them. WORK WITH WHAT THEY GAVE YOU: they usually describe the pieces, what they like, and the occasion in their message. Give a genuine, decisive answer from THAT description, a real verdict and the because. Open with one brief, casual line that you're going off their description this time (not a big apology). NEVER ask them to share product links, more details, or to re-upload, and NEVER stall, they already told you enough to help. Only use [SEARCH:]/[OUTFIT:] if they want NEW pieces to buy; when they're asking your opinion on their OWN items (which dress suits me), just give the verdict, no token. Do NOT invent specifics you cannot know from their words.`
          const fb = await withDeadline(
            stylistChat([...history, { role: 'user', content: question }], textFallbackSystem, { max_tokens: 1500, temperature: 0.4 }, true),
            Math.min(requestDeadline - 3_000, Date.now() + 16_000),
            null,
          )
          raw = (fb?.content ?? '').trim()
          if (raw) logAiUsage({ path: 'vision', provider: `text-fallback:${fb?.provider ?? '?'}`, estPromptTokens: estimateTokens(textFallbackSystem + question), estCompletionTokensCap: 1500, ok: true })
        } catch (e) { console.error('[stylist] vision->text fallback failed:', e) }
        if (!raw) {
          logAiUsage({ path: 'vision', provider: 'all-failed', estPromptTokens: estimateTokens(visionSystemFull + visionPrompt), estCompletionTokensCap: 1100, ok: false })
          console.error('[stylist] vision + text fallback both failed:', visionThrew)
          if (isRateLimited(visionThrew)) {
            return finish({ reply: BUSY_REPLY, busy: true, retryable: true, comparison: null })
          }
          return finish({ reply: "I couldn't read the photos just now. Tell me the vibe you're going for, or a couple details about the pieces, and I'll style you from there.", retryable: true, comparison: null })
        }
      }

      // Self-heal: a photo of an item to find/buy (or "what do I wear with
      // this") routinely comes back as good prose that NAMES the garments but
      // carries no [SEARCH:]/[OUTFIT:] token, so nothing renders and the
      // shopper gets advice with no products to tap or buy — exactly the
      // reported failure. The vision models (Gemini/Groq-vision) are weak at
      // emitting the token grammar reliably, so instead of re-asking them, hand
      // the analysis to the TEXT model, which is far more consistent at it:
      // keep the vision reply's prose, and append the token it derives so the
      // shared search pipeline below surfaces the actual pieces.
      // [PHOTO:N] counts as a real token too: "which of my outfits?" is answered
      // by picking the shopper's own photo, not by searching the catalog, so it
      // must NOT trip the "you described clothing but emitted no token" self-heal.
      const hasVisionToken = /\[(SEARCH|OUTFIT|COMPARE|WARDROBE|PHOTO):/i.test(raw)
      const describesVisionProduct = /\b(shirt|t-?shirt|top|kurta|jacket|blazer|coat|trouser|pant|chino|short|jean|dress|shoe|sneaker|boot|loafer|sandal|skirt|sweater|knit|linen|cotton|wool|silk|leather|denim)\b/i.test(raw)
      if (raw && !hasVisionToken && describesVisionProduct && requestDeadline - Date.now() > 16_000) {
        try {
          const tokenizerSystem = `You turn a stylist's photo analysis into ONE product token so the shopper can actually see and buy the pieces. Read the analysis and the shopper's request, then output ONLY the token, nothing else, no other words.
• One single item they want to find or buy → [SEARCH: gender garment material colour] (e.g. [SEARCH: men navy linen shirt]).
• A pairing or a full look (the analysis pairs the item with other pieces, or they ask "what do I wear with it") → [OUTFIT: q1 | q2 | q3], one precise query per DISTINCT category, each naming gender + garment + colour/material (e.g. [OUTFIT: men navy linen shirt | men beige linen shorts | men tan leather sandal]).
Use concrete garment, colour, and material words only, never a brand or product name. Output the token and nothing else.`
          const tokenMsg = await withDeadline(
            stylistChat(
              [{ role: 'user' as const, content: `Analysis: ${raw}\n\nShopper asked: ${question || 'find this and what to wear with it'}` }],
              tokenizerSystem, { max_tokens: 140, temperature: 0.2 }, false,
            ),
            Math.min(requestDeadline - 12_000, Date.now() + 12_000),
            null,
          )
          const tok = (tokenMsg?.content || '').match(/\[(?:SEARCH|OUTFIT):[^\]]+\]/i)
          if (tok) raw = `${raw.trim()}\n${tok[0]}`
        } catch (e) {
          console.error('[stylist] vision token self-heal failed:', e)
          // Keep the original text-only reply — never block the response over this.
        }
      }

      // THE FLOOR. A photograph and "find this" must produce a search, whatever
      // else went wrong above.
      //
      // Everything before this depends on a model that is doing several things
      // at once — reading the picture, judging intent, writing prose, AND
      // remembering a token grammar — emitting [SEARCH: …] correctly. Measured
      // on production, uploading a clean product photograph from this app's own
      // catalogue with "find this exact shirt" returned the reply "What details
      // can you share about the shirt, colour, style, brand, or any key
      // features?" and searched for nothing. It asked the shopper to describe
      // the thing they had just photographed.
      //
      // The self-heal above is meant to catch that, and it is gated on having
      // 16 seconds left — which, after a vision call, it often does not.
      //
      // So when the shopper's words say they want the piece and no token
      // survived, one focused vision call does the only job that matters here:
      // look at the garment, write the line a person would type into a shop.
      // No branches and no grammar to forget.
      const wantsThePiece = /\b(find|get|buy|shop|where|source|similar|like this|this exact|same)\b/i.test(question)
      if (images.length > 0 && wantsThePiece
          && !/\[(SEARCH|OUTFIT|COMPARE|WARDROBE|PHOTO):/i.test(raw)
          && requestDeadline - Date.now() > 12_000) {
        const line = await describeGarment(images[0])
        if (line) {
          console.log(`[stylist] no token after vision — searching the photograph as "${line}"`)
          raw = `${raw}\n\n[SEARCH: ${line}]`
        }
      }
    } else {
      // Text-only path (no images).
      // Conversational messages use a short ~300-token prompt (avoids rate limits,
      // faster, and doesn't need color theory / outfit formulas for a greeting).
      // Heavy fashion queries get the full SYSTEM with contextBlock injected.
      const lastAssistant = [...rawHistory].reverse().find(m => m.role === 'assistant')?.content || ''
      // Pinned/attached products (the shopper tapped "Ask Fabrics" on one or
      // more items) always force the full prompt + contextBlock, regardless
      // of what isHeavyQuery's keyword regex thinks of the phrasing — a short
      // follow-up like "explain these two" or "compare them" has no garment/
      // material/occasion keyword to match, so without this the shopper's own
      // pinned items were invisible to the model and it would ask them to
      // re-specify what it could already see attached to the message.
      // Pure feedback/reactions never trigger a rebuild — force the short chat
      // path (unless the shopper pinned products, which is always a real ask).
      const feedbackOnly = products.length === 0 && isReactionOnly(question)
      const heavy = !feedbackOnly && (products.length > 0 || isHeavyQuery(questionRead) || isActionFollowThrough(question, lastAssistant) || isShoppingContinuation(question, lastAssistant))
      // Loggable, because a mis-route is invisible in the answer: it looks like
      // the model simply had nothing to say. This line is how you find it.
      console.log(`[stylist] route ${heavy ? 'heavy(can search)' : 'light(chat only)'} — ${routeReason(questionRead)} — "${question.slice(0, 60)}"`)
      note(trace, { route: heavy ? 'heavy' : 'light' })
      step(trace, 'routed', `${heavy ? 'heavy(can search)' : 'light(chat only)'} — ${routeReason(questionRead)}`)

      // The speculative catalogue search does NOT start here any more.
      //
      // Running it beside the model meant every shopping request fanned out to
      // the brand stores twice — the real search and the rescue, competing for
      // the same endpoints and the same per-store timeouts. The rescue is
      // supposed to be insurance; paying for it on every request made the
      // answer it was insuring against more likely, and the results thinner.
      // withoutTheModel starts it on demand, which is when it is actually
      // needed, and the breaker below covers the case where the model is known
      // to be down.

      // If the model has just failed for everyone else, do not spend this
      // shopper's minute rediscovering that.
      if (heavy && modelLooksDown()) {
        console.warn('[stylist] breaker open — skipping the model')
        return withoutTheModel('error')
      }
      // Deep expert knowledge, injected on-demand: the heavy path pulls in only
      // the modules this query actually needs (decision, color, fit, fabric,
      // occasion, agentic) plus the shopper's regional style intelligence, so
      // Fabrics reasons like a specialist for THIS request instead of running on
      // one generic block. Never on the light path (Cerebras 8K window).
      const knowledgeBlock = heavy ? selectKnowledgeModules(question, { hasPinned: products.length > 0, countryCode }) : ''
      const combinedSystem = heavy
        ? `${SYSTEM}${knowledgeBlock}${contextBlock ? `\n\n━━━ SHOPPER CONTEXT FOR THIS SESSION ━━━\n${contextBlock}` : ''}`
        : CHAT_SYSTEM
      const messages = [
        ...history,
        { role: 'user' as const, content: question },
      ]
      const promptTextForEstimate = combinedSystem + messages.map(m => m.content ?? '').join(' ')
      // gpt-oss's reasoning_effort (Cerebras, heavy path only) spends real
      // completion tokens on internal chain-of-thought BEFORE it ever starts
      // the final answer. Capping the whole exchange at the same 1100-token
      // budget used for a plain non-reasoning call risks the model getting
      // cut off mid-thought — this is the literal, verified cause of a real
      // leaked-reasoning incident: the truncated reply ended mid-token
      // ("[SEARCH: premium linen shirt beach", no closing bracket), a dead
      // giveaway of hitting the completion cap, not a formatting quirk —
      // and matches the "#1 failure mode" already documented below (model
      // ran long, got cut off before the trailing token). Reasoning tokens
      // are internal; the system prompt already caps the VISIBLE reply at
      // 1-4 sentences, so a larger ceiling here doesn't risk a bloated
      // answer, it just gives the model room to finish thinking before it
      // has to produce one. Light path is unaffected (no reasoning effort
      // there, CHAT_SYSTEM is small, 1100 was never the constraint).
      const replyMaxTokens = heavy ? 2000 : 1100
      // Small talk and casual chitchat (the light path) resolve in one quick
      // model call with no catalog work at all — a step tracker implying
      // real search/reasoning work is happening reads as theater for "hey"
      // or "thanks". Only the heavy path (real styling questions, product
      // search, outfit building) emits a progress event; the frontend's
      // default empty state is a plain, minimal typing indicator, which is
      // all a light reply ever shows since no event escalates it further.
      // Only show the styling-thinking indicator when there's a genuine product
      // intent. A conversational turn that merely routed heavy ("also I need
      // your help", a short off-topic aside) shows the plain typing dots
      // instead — a real search still streams its own progress when it starts.
      if (heavy && isProductIntent(question)) send('fabric', 'Thinking through the styling', 'reasoning.compose(style + fit + occasion)')
      try {
        // Bound the reply generation so a run of hung free-tier providers (each
        // can hang to its own 25-30s abort) can never eat the whole function
        // budget before search + finish. Reserve ~14s of the budget for the
        // catalog work that follows; if the model can't answer in what's left,
        // fail over to a graceful retry line rather than a mid-stream kill.
        const chatDeadline = Math.min(requestDeadline - 14_000, Date.now() + 34_000)
        const msg = await withDeadline(stylistChat(messages, combinedSystem, { max_tokens: replyMaxTokens, temperature: 0.4 }, heavy), chatDeadline, null)
        if (!msg) {
          console.error('[stylist] model call timed out within budget')
          noteModelFailure()
          modelTrace = 'the whole chain ran past the reply deadline'
          // `retryable` tells the client this produced NO answer, so re-sending
          // costs nothing and will very likely succeed (the slow provider is now
          // on cooldown and gets skipped). The client retries once silently, so
          // the shopper never sees this and never has to resend by hand.
          return withoutTheModel('error')
        }
        raw = (msg?.content ?? '').trim()
        noteModelSuccess()
        logAiUsage({ path: heavy ? 'llm-heavy' : 'llm-light', provider: msg.provider, estPromptTokens: estimateTokens(promptTextForEstimate), estCompletionTokensCap: replyMaxTokens, ok: !!raw })
      } catch (err) {
        logAiUsage({ path: heavy ? 'llm-heavy' : 'llm-light', provider: 'groq', estPromptTokens: estimateTokens(promptTextForEstimate), estCompletionTokensCap: replyMaxTokens, ok: false })
        console.error('[stylist] model call failed:', err)
        console.error('[stylist] all models failed:', (err as Error).message)
        noteModelFailure()
        modelTrace = redactSecrets((err as Error)?.message ?? String(err))
        return withoutTheModel(isRateLimited(err) ? 'busy' : 'error')
      }

      // Self-heal: the #1 failure mode is the model describing an outfit/item in
      // prose (garment names, materials) but never emitting the [SEARCH:]/
      // [OUTFIT:] token — usually because it ran long and got cut off before the
      // trailing token, or just didn't follow the instruction. Detect that
      // specific shape and retry ONCE with a short, forceful reminder before
      // giving up and showing bare text with no product cards.
      const hasToken = /\[(SEARCH|OUTFIT|COMPARE|WARDROBE):/i.test(raw)
      const describesProducts = /\b(shirt|jacket|blazer|coat|trouser|pant|jean|dress|shoe|sneaker|boot|loafer|sandal|skirt|sweater|knit|linen|cotton|wool|silk|leather|denim)\b/i.test(raw)
      // Also self-heal when the SHOPPER explicitly asked to SEE the pieces
      // ("show me them", "show those", "let me see the combos") but the reply
      // came back token-less — e.g. a bare "Here they are:" with nothing to
      // show. Without this the shopper is promised products and gets an empty
      // reply. The retry has the full conversation, so the model knows what
      // "them" refers to (the pieces it just described).
      const userWantsToSee = /\b(show|see|view|display|pull\s?up|find|link)\b/i.test(question)
        && /\b(them|these|those|it|me|combo|combination|combos|look|looks|outfit|option|options|product|products|piece|pieces|one|ones)\b/i.test(question)
      // Only worth a whole second LLM call if there's real time left for it AND
      // the search it feeds — skip when late so we never blow the function budget
      // chasing a token and get force-killed with nothing to show.
      if (heavy && raw && !hasToken && (describesProducts || userWantsToSee) && requestDeadline - Date.now() > 22_000) {
        try {
          const retryNudge = combinedSystem + `\n\n━━━ CORRECTION ━━━ Your last reply described clothing but did not include the required token. This time keep the lead-in to ONE short sentence and end the reply with either [SEARCH: precise query] for a single item or [OUTFIT: query1 | query2 | query3] for a full look — the token MUST be present, it is how the shopper actually sees and buys the pieces.`
          const retryMsg = await stylistChat(messages, retryNudge, { max_tokens: replyMaxTokens, temperature: 0.3 }, heavy)
          const retryRaw = (retryMsg?.content ?? '').trim()
          if (retryRaw && /\[(SEARCH|OUTFIT|COMPARE|WARDROBE):/i.test(retryRaw)) {
            raw = retryRaw
          }
        } catch (e) {
          console.error('[stylist] token self-heal retry failed:', e)
          // Keep the original text-only reply — never block the response over this.
        }
      }
    }

    if (!raw) return finish({ reply: "I missed that one, sorry. Try again?", retryable: true, comparison: null })

    const { reply: replyWithSearch, comparison } = parseReply(raw)
    // ONE boundary between what the model said and what this route believes.
    //
    // This was three regexes in a row over prose, and whether the shopper saw
    // any clothes depended on a model remembering a bracket grammar
    // mid-sentence. The grammar is still the second strategy inside — nothing
    // about what the model is asked for has changed — but it is now validated
    // into a typed answer at a single point, so the JSON path can be turned on
    // later without touching one line of what follows. See lib/stylist/answer.
    const answer = parseStylistAnswer(replyWithSearch)
    const parsedReply = answer.reply
    const rawSearchQuery = answer.search
    const rawOutfitQueries = answer.outfit
    const rawOutfitSets = answer.outfits
    note(trace, {
      answerVia: answer.via,
      searchQuery: answer.search,
      outfitQueries: answer.outfit,
    })
    step(trace, 'answer read', `via ${answer.via}${answer.search ? ` — search "${answer.search}"` : ''}${answer.outfit ? ` — outfit of ${answer.outfit.length}` : ''}${answer.outfits ? ` — ${answer.outfits.length} looks` : ''}`)
    // Now that SEARCH/OUTFIT/COMPARE tokens are stripped out, turn any leftover
    // "(product N)" prose references in the visible reply into real
    // [PRODUCT:N-1] cards, so every pinned piece the model recommends renders,
    // not just the ones it happened to token correctly. Safe here (a search
    // query that mentioned "product" was already extracted above).
    const reply = products.length > 0
      ? placePinnedCards(linkPinnedProductMentions(parsedReply, products.length), products)
      // Nothing pinned: any [PRODUCT:N] the model wrote points at products it
      // never saw (the reply is composed BEFORE the search runs), so it cards a
      // random found item that mismatches the prose. Strip them; the real pieces
      // show in the result strips / outfit slots below.
      : parsedReply.replace(/\s*\[PRODUCT:\d{1,2}\]\s*/g, ' ').replace(/[ \t]{2,}/g, ' ').trim()
    // Deterministic safety net: if the model forgot to gender the query
    // itself, the shopper's profile still wins rather than searching blind.
    const searchQuery = rawSearchQuery ? applyGenderDefault(rawSearchQuery) : rawSearchQuery
    const outfitQueries = rawOutfitQueries?.map(q => applyGenderDefault(q))

    let foundProducts: any[] | null = null
    let foundProductGroups: { label: string; products: any[]; query: string }[] | null = null
    let reply2 = reply
    // A disclosure the shopper must keep seeing (brand not in the roster, nothing
    // under their budget, search broadened) even if the grounding pass rewrites
    // the reply around it.
    let honestyNote = ''
    if (searchQuery) {
      // Real fetch/judge boundaries stream up from inside the search itself, so
      // no generic placeholder line here (see the fast-path call site).
      try {
        const concepts = buildMandatoryConcepts(searchQuery)
        // The shopper's actual stated budget — this path never parsed or
        // applied one before, so "something under $80" silently ignored the
        // $80 and showed items at any price. Read off the raw question, not
        // the model's [SEARCH:] text, which doesn't reliably carry numbers.
        const llmBudget = parseBudget(question, buyerCurrency)
        const preferredSize = sizeForQuery(searchQuery)

        const multiGroups = await withDeadline(multiCategorySearch(
          searchQuery, llmBudget.budgetMax, countryCode, buyerCurrency,
          tasteProfile, sizeForQuery, onSearchProgress, shopperGender,
        ), requestDeadline, null)
        if (multiGroups) {
          foundProductGroups = multiGroups
          // Each group is already capped at MULTI_CATEGORY_PER_GROUP_CAP; see
          // the matching comment at the fast-path call site above.
          foundProducts = dedupeById(multiGroups.flatMap(g => g.products))
          send('curate', 'Assembling the picks', `merge(${multiGroups.length} categories) → ${foundProducts.length} pieces`)
        } else {
        // 'relevance' engages the BM25 + LLM reranker; the shopper's actual
        // question is the judge query so occasion/aesthetic context ranks too.
        // Memory summary biases ranking toward their known taste. Falls back
        // to catalog order silently if the reranker errs never blocks.
        let results = await withDeadline(GlobalCatalogService.search(
          searchQuery,
          llmBudget.budgetMax, [], countryCode, true, concepts,
          'relevance', buyerCurrency,
          { fastFirstPage: true, onProgress: onSearchProgress }, [],
          tasteProfile,
          question, preferredSize,
        ), requestDeadline, [] as any[])
        let refineNote = ''
        // When we're already low on budget, don't chase extra refine/broaden
        // searches — return what we have (or an honest note) rather than risk
        // the function being killed before finish().
        let skipFurtherRefine = requestDeadline - Date.now() < 10_000

        if (results.length === 0) {
          // The query named a brand we can't reach (no UCP / not in roster) or
          // that had no match. Retry across the roster with the brand stripped
          // and tell the shopper honestly, then show the similar pieces. Most
          // informative possible miss — handled first, distinctly from the
          // generic refine below.
          const brands = detectBrandsInQuery(searchQuery)
          if (brands.length > 0) {
            const debranded = stripBrandNames(searchQuery, brands) || searchQuery
            const broad = await withDeadline(GlobalCatalogService.search(
              debranded, llmBudget.budgetMax, [], countryCode, true, buildMandatoryConcepts(debranded),
              'relevance', buyerCurrency, { fastFirstPage: true }, [],
              tasteProfile, question, preferredSize,
            ), requestDeadline, [] as any[])
            const names = brands.map(brandNameOf).filter(Boolean).join(' & ')
            if (broad.length > 0) {
              results = broad
              refineNote = ` I couldn't pull anything from ${names} just now, so here are some similar pieces that fit what you're after.`
            } else {
              reply2 = `${reply}${reply ? ' ' : ''}I don't have ${names} in the Discern roster yet — tell me the style or material you're drawn to and I'll find you a close match.`.trim()
            }
            skipFurtherRefine = true
          }
        }

        // Agentic refine: looks at the actual result count, decides what to
        // relax, retries once. Bounded to exactly one extra search — never a
        // loop, never stacked on top of the brand-fallback above.
        if (!skipFurtherRefine && results.length < 4) {
          if (llmBudget.budgetMax) {
            const widened = await withDeadline(GlobalCatalogService.search(
              searchQuery, undefined, [], countryCode, true, concepts,
              'relevance', buyerCurrency, { fastFirstPage: true }, [],
              tasteProfile, question, preferredSize,
            ), requestDeadline, [] as any[])
            if (widened.length > results.length) {
              results = widened
              refineNote = ` Nothing under ${llmBudget.budgetCurrency || buyerCurrency} ${llmBudget.budgetMax}, so here’s the closest without that cap.`
            }
          } else if (results.length === 0) {
            const rawBroadened = await refineSearchQuery(searchQuery, question)
            // The refine model is only told to relax color/material/occasion/fit —
            // never gender — but that isn't a hard constraint on its output, so
            // never trust it kept the word. `searchQuery` at this point is
            // already gender-resolved (profile default or the shopper's own
            // explicit words) — if the broadened version dropped that gender
            // term entirely, force it back in rather than fall back to only
            // the profile default, which would miss an explicitly-typed one.
            const originalGenderWord = /\bwomen\b/i.test(searchQuery) ? 'women' : /\bmen\b/i.test(searchQuery) ? 'men' : null
            const broadened = rawBroadened
              ? (originalGenderWord && !GENDER_TERM_RE.test(rawBroadened) ? `${originalGenderWord} ${rawBroadened}` : rawBroadened)
              : null
            if (broadened) {
              const retry = await withDeadline(GlobalCatalogService.search(
                broadened, undefined, [], countryCode, true, buildMandatoryConcepts(broadened),
                'relevance', buyerCurrency, { fastFirstPage: true }, [],
                tasteProfile, question, preferredSize,
              ), requestDeadline, [] as any[])
              if (retry.length > results.length) {
                results = retry
                refineNote = ' Nothing matched exactly, so I broadened the search a touch.'
              }
            }
          }
        }

        if (results.length > 0) {
          foundProducts = dedupeById(results).slice(0, INITIAL_RESULT_CAP)
          reply2 = `${reply2}${refineNote}`.trim()
          // Remember it: the grounding pass replaces reply2 wholesale, which was
          // silently deleting these disclosures — presenting non-Zara or
          // over-budget pieces as confident picks with the caveat gone. Honesty
          // about what we couldn't find must survive the rewrite.
          honestyNote = refineNote
        }
        // Skip when the search already streamed a "Judging relevance" event
        // (rerank runs only at ≥4 results) to avoid double-reporting the rank.
        if (results.length < 4) send('curate', 'Ranking the best picks', `rank.relevance(${results.length} candidates) → page.slice(${INITIAL_RESULT_CAP})`)
        }
      } catch (e) {
        console.error('[stylist] search error:', e)
      }
    }

    let outfitSlots: { query: string; slotCategory: string | null; products: any[] }[] | null = null
    /** Why an outfit came back with no pieces, when one was asked for. */
    let outfitTrace: string[] | null = null
    if (outfitQueries && outfitQueries.length > 0) {
      send('outfit', 'Assembling the complete look', `outfit.slots([${outfitQueries.join(', ')}])`)
      try {
        // Fetch every slot's candidates in parallel (speed), then pick
        // sequentially (correctness) — picking inside the parallel map raced
        // on usedProductIds, so two slots could both see it empty and both
        // grab the same top product before either had marked it used. A
        // shopper must never see the identical item in two outfit slots.
        const slotCandidates = await withDeadline(Promise.all(
          outfitQueries.map(async (q) => {
            const { label, slotCat } = outfitSlotInfo(q)
            const concepts = buildMandatoryConcepts(q)
            const results = await GlobalCatalogService.search(
              q, undefined, [], countryCode, true, concepts,
              'relevance', buyerCurrency, { fastFirstPage: true }, [],
              tasteProfile, undefined, sizeForQuery(q), images[0] ?? null,
            )
            const filtered = slotCat ? results.filter(p => productMatchesSlot(p, slotCat)) : results
            return { query: q, label, slotCat, filtered, results }
          })
        ), requestDeadline, [] as { query: string; label: string; slotCat: SlotCategory | null; filtered: any[]; results: any[] }[])
        const usedProductIds = new Set<string>()
        const usedSlots = new Set<SlotCategory>()
        const builtSlots: { query: string; slotCategory: string | null; products: any[] }[] = []
        for (const { query, label, slotCat, filtered, results } of slotCandidates) {
          // One piece per wardrobe slot — no two tops, two bottoms, two shoes.
          // A layer is 'outer', so it happily coexists with a 'top' base.
          // Accessories may repeat (belt AND bag), and an unknown slot never blocks.
          if (slotCat && slotCat !== 'accessory' && usedSlots.has(slotCat)) continue
          const unused = <T extends { id: string }>(arr: T[]) => arr.filter(p => !usedProductIds.has(p.id))
          // Tier 1: category-correct AND unused. Tier 2: ANY unused product,
          // even off-category, rather than ever repeating one already placed
          // in another slot — a unique-but-imperfect pick beats a duplicate.
          const deduped = unused(filtered)
          const best = deduped.length > 0 ? deduped : unused(results)
          const chosen = best.slice(0, 6)
          if (chosen.length === 0) continue
          // Reserve EVERY product shown in this slot, not just the headline
          // pick — otherwise a slot's alternative can reappear as the next
          // slot's primary, the exact duplicate this dedupe is meant to prevent.
          for (const p of chosen) usedProductIds.add(p.id)
          if (slotCat) usedSlots.add(slotCat)
          builtSlots.push({ query, slotCategory: label, products: chosen })
        }
        // Compose, rather than merely assemble. Up to here every slot holds
        // the piece that ranked best on its own and nothing has compared the
        // blazer with the trousers it will be worn with — four individually
        // excellent pieces are not an outfit. This re-picks which candidate
        // LEADS each slot so the leads read as one set: one accent colour
        // against neutrals, everything dressed to the same level, something
        // below echoing something above. Nothing is dropped, only reordered.
        const composed = composeOutfit(
          builtSlots,
          (p: any) => `${p?.title ?? ''} ${(p?.tags ?? []).join(' ')}`,
        )
        outfitSlots = composed.length > 0 ? composed as typeof builtSlots : null
        // WHICH empty this is. The model emitted a perfectly good four-slot
        // outfit — "men pastel linen kurta | men white linen trousers | men tan
        // leather loafers" — and the shopper got the paragraph with no clothes
        // under it. Every one of those slot queries returns twelve to sixteen
        // pieces when asked of the catalogue on its own, so the loss happened
        // in here, and nothing recorded where: an outfit that retrieved nothing
        // and an outfit whose every candidate was filtered out are the same
        // silence from the outside.
        //
        // Same reasoning as the judge's outcome and the provider check's
        // whatFailed. A count per slot is the whole diagnosis.
        if (!outfitSlots) {
          outfitTrace = slotCandidates.map(s =>
            `${s.query} → ${s.results.length} found, ${s.filtered.length} in slot${s.slotCat ? ` (${s.slotCat})` : ''}`)
          console.warn(`[stylist] outfit produced no slots — ${outfitTrace.join(' | ')}`)
        }
      } catch (e) {
        outfitTrace = [`threw: ${(e as Error)?.message?.slice(0, 200) ?? 'unknown'}`]
        console.error('[stylist] outfit search error:', e)
      }
    }

    // MULTIPLE OUTFITS ([OUTFITS:]) — "create three outfits" renders as three
    // separate carded looks. Fetch every slot of every look in one parallel
    // batch, then assemble each look picking one real product per slot (deduped
    // WITHIN a look; a piece may deliberately repeat across looks, e.g. the same
    // shorts styled two ways). Each look becomes its own labelled group.
    let outfitGroups: { label: string; products: any[] }[] | null = null
    if (rawOutfitSets && rawOutfitSets.length > 0) {
      send('outfit', 'Building the looks', `outfits(${rawOutfitSets.length})`)
      try {
        const sets = rawOutfitSets.map(set => set.map(q => applyGenderDefault(q)))
        const flat: { oi: number; q: string }[] = []
        sets.forEach((set, oi) => set.forEach(q => flat.push({ oi, q })))
        const candidates = await withDeadline(Promise.all(
          flat.map(async ({ oi, q }) => {
            const { slotCat } = outfitSlotInfo(q)
            const results = await GlobalCatalogService.search(
              q, undefined, [], countryCode, true, buildMandatoryConcepts(q),
              'relevance', buyerCurrency, { fastFirstPage: true }, [],
              tasteProfile, undefined, sizeForQuery(q), images[0] ?? null,
            )
            const filtered = slotCat ? results.filter(p => productMatchesSlot(p, slotCat)) : results
            return { oi, filtered, results }
          })
        ), requestDeadline, [] as { oi: number; filtered: any[]; results: any[] }[])
        const built: { label: string; products: any[] }[] = []
        for (let oi = 0; oi < sets.length; oi++) {
          const used = new Set<string>()
          const picks: any[] = []
          for (const c of candidates.filter(c => c.oi === oi)) {
            const pool = c.filtered.length > 0 ? c.filtered : c.results
            const pick = pool.find(p => !used.has(p.id)) || pool[0]
            if (pick && !used.has(pick.id)) { used.add(pick.id); picks.push(pick) }
          }
          if (picks.length > 0) built.push({ label: `Outfit ${oi + 1}`, products: picks })
        }
        outfitGroups = built.length > 0 ? built : null
      } catch (e) {
        console.error('[stylist] multi-outfit search error:', e)
      }
    }

    // GUARANTEE: a shopping reply must never promise products and show none.
    // If a search/outfit intent produced zero products (an outfit whose slots
    // all came back empty, or a search the broaden pass couldn't rescue), cast
    // one broad net; if that still finds nothing, be honest instead of leaving a
    // dangling "here they are" with an empty space beneath it.
    const nothingShown = (!foundProducts || foundProducts.length === 0) && !outfitSlots && !outfitGroups && (!foundProductGroups || foundProductGroups.length === 0)
    // Only worth one more search if there's genuine budget left — otherwise fall
    // straight to the honest note below rather than risk a mid-stream kill.
    // rawOutfitSets included: an [OUTFITS:]-only reply has no searchQuery and no
    // outfitQueries, so the guard never fired for it — the shopper got "here are
    // three looks for you" with a blank space underneath when the slot searches
    // came back empty or hit the deadline. That is exactly what this exists to
    // prevent.
    if ((searchQuery || (outfitQueries && outfitQueries.length > 0) || (rawOutfitSets && rawOutfitSets.length > 0)) && nothingShown && requestDeadline - Date.now() > 6_000) {
      try {
        const fallbackQ = searchQuery || (outfitQueries && outfitQueries[0]) || question
        send('search', 'Casting a wider net', `catalog.search("${fallbackQ}")`)
        const broad = await withDeadline(GlobalCatalogService.search(
          fallbackQ, undefined, [], countryCode, true, buildMandatoryConcepts(fallbackQ),
          'relevance', buyerCurrency, { fastFirstPage: true }, [],
          tasteProfile, question, sizeForQuery(fallbackQ),
        ), requestDeadline, [] as any[])
        if (broad.length > 0) foundProducts = dedupeById(broad).slice(0, INITIAL_RESULT_CAP)
      } catch (e) { console.error('[stylist] fallback broad search failed:', e) }
      const stillNothing = (!foundProducts || foundProducts.length === 0) && !outfitSlots
      // The primary search could not read this one — log it for review. The
      // reason distinguishes a hard miss from one the broad net rescued, since
      // the two justify very different dictionary edits.
      recordVocabMiss(searchQuery || question, stillNothing ? 'no-results' : 'weak-match')
      if (stillNothing) {
        reply2 = reply2.replace(/\bhere they are\b\s*:?/i, '').replace(/\s{2,}/g, ' ').trim()
        const honest = "I'm not pulling those up right now. Want me to try a different colour, brand, or price?"
        reply2 = reply2 ? `${reply2} ${honest}` : honest
      }
    }

    // SHOW THE OUTFIT'S PIECES even when the model wrote them as prose. Asking
    // for "three outfits" doesn't fit the single-[OUTFIT:] grammar, so the model
    // describes them in text and surfaces nothing — the shopper asked to SEE the
    // pieces, not read them. When a heavy reply names 2+ garments but no token
    // put anything on screen, extract the distinct garments it described and
    // search them so they render as labelled strips alongside the text.
    let surfacedFromReply = false
    if (!searchQuery && (!outfitQueries || outfitQueries.length === 0) && !outfitGroups
        && (!foundProducts || foundProducts.length === 0) && !foundProductGroups && !outfitSlots
        && requestDeadline - Date.now() > 10_000) {
      // Trigger on the REPLY describing 2+ garments (an outfit/looks reply),
      // regardless of how the question was phrased — a reply naming a shirt,
      // trousers and shoes clearly wants those pieces on screen.
      const replyGarmentKeys = Array.from(new Set(decomposeQuery(reply2).garmentKeys)).slice(0, 5)
      // Failing that, the question's own occasion. Everything above depends on
      // the model choosing to emit a search token or to name garments in its
      // prose, and neither is guaranteed — when it just answers warmly, the
      // shopper who asked what to wear to an interview gets a paragraph and no
      // clothes. The occasion is known deterministically from the question, so
      // this needs no model at all: whatever was said, an interview still means
      // a jacket, a shirt, trousers and shoes.
      const planned = replyGarmentKeys.length >= 2
        ? [] : (outfitPlan(questionRead, shopperGender)?.slots ?? [])
      const keysToSurface = replyGarmentKeys.length >= 2 ? replyGarmentKeys : planned
      if (keysToSurface.length >= 2) {
        const surfaceQuery = applyGenderDefault(keysToSurface.map(k => GARMENT_VOCAB[k]?.query[0] || k).join(' '))
        try {
          send('outfit', 'Pulling the pieces', `catalog.multi(${keysToSurface.join(', ')})`)
          const groups = await withDeadline(multiCategorySearch(
            surfaceQuery, undefined, countryCode, buyerCurrency, tasteProfile, sizeForQuery, onSearchProgress, shopperGender,
          ), requestDeadline, null)
          if (groups && groups.length > 0) {
            foundProductGroups = groups
            foundProducts = dedupeById(groups.flatMap(g => g.products))
            surfacedFromReply = true
          }
        } catch (e) { console.error('[stylist] outfit-surface fallback failed:', e) }
      }
    }

    // GROUND THE REPLY IN THE REAL PRODUCTS (accuracy fix). On a fresh search the
    // first reply was written before any results existed, so it was guessing.
    // Now that we have the actual products, rewrite the reply over their real
    // data so it names real pieces, explains why each, and cards the picks — no
    // hallucination. Only when the MODEL itself searched (searchQuery present) —
    // never for the describe-then-surface fallback above, whose multi-outfit
    // text we must keep intact. Pinned replies reason over real pinned data,
    // small talk has none. Bounded; on any failure keep reply2.
    // Also skipped for a MULTI-CATEGORY reply: the rewrite only sees the first 10
    // of the flattened union, so a 3-garment search (8 each) would hand it all the
    // shirts, two trousers and zero shoes — and the prompt forbids mentioning
    // anything not listed. It would confidently discuss one strip while three
    // render below. The original reply already covers every category.
    if (!!searchQuery && !surfacedFromReply && !foundProductGroups && products.length === 0 && foundProducts && foundProducts.length > 0 && isProductIntent(question)
        && requestDeadline - Date.now() > 12_000) {
      const grounded = await withDeadline(
        groundReplyInProducts(question, foundProducts, rawHistory),
        Math.min(requestDeadline - 4_000, Date.now() + 16_000),
        null,
      )
      // Re-attach the disclosure the rewrite would otherwise have dropped, unless
      // the model happened to say it itself.
      if (grounded) {
        const note = honestyNote.trim()
        reply2 = (note && !grounded.includes(note)) ? `${grounded} ${note}`.trim() : grounded
      }
    }

    // A reply with nothing under it leaves the shopper holding a paragraph.
    //
    // "outfits for a casual party" came back as three sentences of advice and
    // no clothes, and the only way forward was to press-and-hold the text,
    // drag the selection handles, copy it, paste it into the composer and send
    // it back. They did that. It worked. It is also not a thing anyone should
    // have to invent, so the reply now carries the query it should have been —
    // built from the garments the model just named, the occasion table, and
    // their own words, with no model call and no extra wait.
    // "Find me this EXACT one, not similar." Said out loud, and answered with
    // eight leather sandals under the sentence "let me pull up that exact pair
    // right here" — for a photograph of denim clogs.
    //
    // Nothing in this codebase compares the shopper's photograph against a
    // product photograph, so the app cannot know it found the exact piece. The
    // prompt now says not to claim it, and a prompt is not a guarantee across
    // a provider chain; this is the part that does not depend on the model
    // remembering. It only ever withholds the claim or contradicts it — it
    // never asserts a match, because that is the half no text can settle.
    // LOOK AT THE CANDIDATES, rather than only at the photograph — and read
    // the answer the catalogue already got, rather than asking twice.
    //
    // The comparison lives in GlobalCatalogService: when a photograph is
    // handed to search() it puts that picture and the best few candidates in
    // front of the vision model together, asks which is the same garment, and
    // promotes the match. I did not know that when I added a second call here,
    // so every photo search briefly paid for the same vision call twice — on
    // whichever provider still had quota — to learn the same thing.
    //
    // Keyed by the photograph, so a verdict about somebody else's picture can
    // never be read as this shopper's.
    const sameVerdict: SameGarmentVerdict | null = images[0]
      ? (() => {
          const v = sameGarmentVerdictFor(images[0])
          return v ? { sameIndex: v.sameIndex, closestIndex: null, confidence: v.confidence, why: v.why } : null
        })()
      : null
    if (sameVerdict) {
      console.log(`[stylist] same-garment: same=${sameVerdict.sameIndex} conf=${sameVerdict.confidence} — ${sameVerdict.why}`)
    }

    // Only speak about the catalogue if the catalogue was actually consulted.
    //
    // On a run where vision failed outright the model said "I can't see the
    // photo on my end right now" — true, and the right thing to say — and this
    // added "I could not find that exact piece in the brands I carry"
    // underneath it. Nothing had been searched. Reporting a search that never
    // ran is the same class of dishonesty as claiming a match that was never
    // checked, and this note exists to remove that, not to add another kind.
    const didLook = !!searchQuery || (foundProducts?.length ?? 0) > 0 || !!foundProductGroups?.length
    const exactNote = didLook
      ? exactMatchNote(question, searchQuery || question, foundProducts ?? [], sameVerdict)
      : ''
    if (exactNote && !reply2.includes(exactNote)) {
      // Take the claim out before adding the truth. Appending alone produced a
      // reply that argued with itself in consecutive sentences — "Here it is …
      // This is the exact style you're looking for. I cannot promise any of
      // these is the exact piece." The first half has to go, not just be
      // followed by a correction.
      //
      // A CONFIRMED match is the one case where the model's own words are
      // allowed to stand: something did look at both pictures and agree.
      const withoutClaim = sameVerdict?.sameIndex != null ? reply2 : stripUnverifiableClaims(reply2)
      reply2 = `${withoutClaim ? `${withoutClaim} ` : ''}${exactNote}`.trim()
    }

    // Markdown, gone once, for every surface.
    //
    // The shopper has now been shown "a sleek knit **elevated** baseline" and
    // "the orange side tag reads **Woodland**" — asterisks and all. The model
    // writes markdown; every pane that renders a reply renders plain text.
    // Fixing it at one render site only fixes that site, so it comes off here,
    // where every reply passes through. Brackets survive, which is what the
    // [PRODUCT:N] cards are parsed out of downstream.
    reply2 = stripEmphasis(reply2)

    const nothingUnderIt =
      (!foundProducts || foundProducts.length === 0) &&
      (!foundProductGroups || foundProductGroups.length === 0) &&
      !outfitSlots && !outfitGroups
    const suggest = nothingUnderIt && reply2
      ? suggestQuery(question, reply2, shopperGender)
      : null

    note(trace, {
      judge: lastJudgeOutcome, judgeDetail: lastJudgeDetail,
      outfitTrace: outfitTrace ?? undefined,
      sameGarment: sameVerdict
        ? { matched: sameVerdict.sameIndex != null, confidence: sameVerdict.confidence, why: sameVerdict.why }
        : undefined,
      degraded: false,
    })
    shown(trace, [
      ...(foundProducts ?? []),
      ...((outfitSlots ?? []).flatMap((sl: { products?: unknown[] }) => sl?.products ?? [])),
    ])
    keepTrace(trace)

    return finish({
      reply: reply2, comparison: comparison ?? null, foundProducts, foundProductGroups,
      // What leads the page: complete outfits, not three shelves.
      looks: foundProductGroups ? await looksFrom(foundProductGroups) : [],
      outfitSlots, outfitGroups, searchQuery: searchQuery || undefined,
      suggest: suggest ?? undefined,
      // The id that ties the judge's outcome, the answer strategy, the model
      // trace and the outfit trace to THIS request — and survives it. On the
      // response so a complaint can carry it.
      traceId: trace?.id,
      // Which strategy read the model's answer — json, tokens or prose. The
      // interface ignores it; it is the only way to see whether the move to a
      // JSON contract is actually happening, and it cannot be recovered after
      // the fact.
      answerVia: answer.via,
      // Present only when an outfit was requested and produced nothing. The
      // interface ignores it; it is here so the failure can be read from
      // outside without the deploy logs.
      outfitTrace: outfitTrace ?? undefined,
    })
  } catch (e) {
    console.error('[stylist] error:', e)
    // Not reachable for anything the model did — those are handled above with a
    // catalogue fallback. This is a genuine bug in this handler, and the one
    // case where there is nothing honest to show.
    return finish({
      reply: isRateLimited(e)
        ? 'A lot of people are using this right now. Give it a few seconds and ask again.'
        : 'That did not get through. Ask me again.',
      busy: isRateLimited(e), retryable: true, comparison: null,
    })
  }
}
