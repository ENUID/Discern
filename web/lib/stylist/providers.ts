/**
 * Five free tiers in a row, and the clock they share.
 *
 * Extracted from the route in Phase E, step E6 — **moved, not rewritten**.
 * Every provider name, every ordering branch, every millisecond of arithmetic
 * and every regex below is byte-identical to what it replaced.
 *
 * This is the smallest diff in Phase E and the largest blast radius. Nothing
 * here is arbitrary, and none of it is guessable from reading the code:
 *
 *   THE ORDER IS A SIZE DECISION. Cerebras leads when the prompt fits its 8K
 *     window and is demoted to last when it does not, because a prompt that
 *     overruns that window does not fail — it truncates mid-thought and
 *     returns raw reasoning as if it were the answer.
 *   THE BUDGET IS FRONT-LOADED, not even. An even split gave every rung 8.5s,
 *     floored to 11s, and eleven seconds cannot generate 1,200 tokens against
 *     a 5,000-token prompt on any of these providers. Four rungs each died
 *     mid-sentence and the shopper was told nothing was found, by a chain in
 *     which nothing had failed except the clock. The first rung takes 55%; a
 *     lone rung takes everything left.
 *   A QUOTA FAILURE IS REMEMBERED AND A TIMEOUT IS NOT. A spent key is still
 *     spent in ten seconds; a slow request may not be slow twice.
 *   `reasoning_effort` IS 'medium' ON THE HEAVY PATH, not 'high' — see the
 *     comment at the Cerebras attempt for the truncation incident that pins it.
 *
 * WHAT IS NOT HERE, deliberately: the breaker. `modelLooksDown` /
 * `noteModelFailure` / `noteModelSuccess` gate the ROUTE's heavy path, not
 * this ladder — an open breaker means the route never calls `stylistChat` at
 * all, rather than `stylistChat` refusing. `scripts/ladder.js` records that,
 * because "the breaker protects the ladder" is the obvious wrong guess and it
 * would send someone looking for a check in here that has never existed.
 *
 * `scripts/ladder.js` pins the ordering, the arithmetic, the cooldown and the
 * 429 path. Read it before changing a number in this file.
 */
import { groqChat, stripThinkTags, stripAiDashes, stripSafetyLabels, looksLikeLeakedReasoning, CHAT_MODEL, FAST_MODEL } from '@/lib/groq'
import { geminiChat } from '@/lib/gemini'
import { cerebrasChat } from '@/lib/cerebras'
import { nvidiaChat, NVIDIA_CONFIGURED } from '@/lib/nvidia'
import { markProviderOut, providerOutUntil, PROVIDER_OUT_MS } from '@/lib/stylist/limits'
import { estimateTokens } from '@/lib/stylist/usage'

// Gemini for queries that need fashion depth; OpenRouter for conversational
// replies. Both are tried as fallbacks for each other so a single provider/
// model failure can never kill the reply.
// Distinct model tiers in priority order: fast first (cheap, high throughput),
// then smart for depth. Deduped below so CHAT_MODEL isn't tried twice when
// FAST_MODEL defaults to the same value.
export const GROQ_8B = FAST_MODEL
export const GROQ_70B = CHAT_MODEL

export async function stylistChat(
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
