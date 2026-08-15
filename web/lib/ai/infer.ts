/**
 * One ladder, used by everything that needs a language model.
 *
 * THE PROBLEM THIS SOLVES. The stylist route built itself a careful four
 * provider chain — Cerebras, Gemini, Groq, NVIDIA, hedged and cooled down —
 * and nothing else in the codebase used it. Every other caller reached for
 * `groqChat`, which despite the name is the OpenRouter client: its default
 * model is `openrouter/free`, an auto-router over free models with a tight
 * daily cap, and it is the single least reliable pool we have.
 *
 * So the relevance judge — the layer that decides which shirt is the better
 * shirt, the whole difference between a keyword search and a fashion one —
 * was pinned to the flakiest provider, hedged against exactly one other, with
 * a six second timeout. Measured on production it returned `no-answer` on
 * every search while four providers reported healthy and unused. The same is
 * true of product names, of the shipping reader, of the cron jobs.
 *
 * THE ORDER, and why. Providers are tried best-first by what has actually been
 * measured on this deployment, not by preference:
 *
 *   1. Cerebras (gpt-oss-120b)  — consistently healthy and by far the fastest.
 *                                 Hard 8K context though, so a long prompt
 *                                 skips it rather than being truncated.
 *   2. Groq direct (gpt-oss)    — healthy, generous, same model family.
 *   3. NVIDIA (inkling)         — healthy but a reasoning model, so slower;
 *                                 fine as a net, wrong as a primary.
 *   4. Gemini (2.0-flash)       — has been failing for days. Kept in the
 *                                 ladder because it costs nothing to try last
 *                                 and it will come back.
 *   5. OpenRouter (free)        — LAST. It is the one that keeps running out.
 *
 * EVERY RUNG IS BOUNDED. Each attempt gets its own timeout, and a provider
 * that rate-limits or errors goes on cooldown so the next call skips it
 * without spending a round trip. A slow provider costs its own timeout and
 * never the whole request — which is the actual fix for "it takes forever and
 * then says try again".
 */

import { groqChat, groqDirectChat, GROQ_DIRECT_SMART_MODEL, GROQ_DIRECT_FAST_MODEL, GROQ_DIRECT_CONFIGURED } from '../groq'
import { cerebrasChat, CEREBRAS_CONFIGURED, CEREBRAS_MODEL } from '../cerebras'
import { nvidiaChat, NVIDIA_CONFIGURED } from '../nvidia'
import { geminiChat } from '../gemini'
import { isOnCooldown, markRateLimited } from '../providerCooldown'

export type Msg = { role: 'user' | 'assistant'; content: string }
export type Tier = 'fast' | 'smart'

export type InferResult = {
  text: string | null
  /** Which rung answered, or why none did. Callers log this; the search
   *  response carries it, so "the model is bad" and "no model answered" can
   *  never again be the same picture from outside. */
  provider: string
}

/** Cerebras' context is a hard 8,192 for prompt AND completion together, so a
 *  long system prompt does not get truncated — it gets skipped. Four
 *  characters to the token is the usual rough count and errs on the safe
 *  side. */
const CEREBRAS_CONTEXT = 8192
const estimateTokens = (s: string) => Math.ceil(s.length / 4)

/** Text out of whatever shape a provider returns. */
function readContent(res: any): string | null {
  const c = res?.content ?? res?.message?.content ?? res?.choices?.[0]?.message?.content
  return typeof c === 'string' && c.trim() ? c : null
}

type Rung = {
  name: string
  /** False when the key is missing — skipped silently rather than throwing. */
  ready: boolean
  fits: (promptTokens: number, maxTokens: number) => boolean
  run: () => Promise<any>
}

export async function infer(
  tier: Tier,
  messages: Msg[],
  system?: string,
  opts: { max_tokens?: number; temperature?: number; timeoutMs?: number; budgetMs?: number } = {},
): Promise<InferResult> {
  // A TOTAL budget for the whole ladder, not just per rung. Five rungs at six
  // seconds each is thirty seconds spent walking down a ladder that is not
  // going to answer — and measured on production that pushed a search past the
  // route's own deadline and returned an EMPTY page. Thirty-seven seconds, to
  // show nothing. Anyone waiting on a search would rather have keyword order
  // now than a judgement in half a minute, so the ladder gives up.
  const started = Date.now()
  const budget = opts.budgetMs ?? (tier === 'fast' ? 9000 : 16000)
  const spent = () => Date.now() - started
  const maxTokens = opts.max_tokens ?? 1200
  const temperature = opts.temperature ?? 0.3
  // A fast call is one somebody is waiting on mid-search; a smart one is doing
  // the actual thinking. Different patience is appropriate.
  const perAttempt = opts.timeoutMs ?? (tier === 'fast' ? 7000 : 14000)
  const promptTokens = estimateTokens(system ?? '') +
    messages.reduce((n, m) => n + estimateTokens(String(m?.content ?? '')), 0)

  const always = () => true
  const ladder: Rung[] = [
    {
      name: 'cerebras',
      ready: CEREBRAS_CONFIGURED,
      fits: (p, m) => p + m + 300 < CEREBRAS_CONTEXT,
      run: () => cerebrasChat(messages, system, {
        max_tokens: maxTokens, temperature,
        // Low effort on the fast tier: this model will otherwise spend its
        // whole budget reasoning and return nothing inside the timeout.
        reasoning_effort: tier === 'fast' ? 'low' : 'medium',
        model: CEREBRAS_MODEL,
      } as never),
    },
    {
      name: 'groq',
      ready: GROQ_DIRECT_CONFIGURED,
      fits: always,
      // Groq's own API, not groqChat — that wrapper tries OpenRouter first and
      // only falls back here, so this rung was paying a round trip to a key
      // production reports as `quota` before reaching the provider it names.
      // OpenRouter still gets its own rung at the bottom of this ladder.
      run: () => groqDirectChat(messages, system, {
        max_tokens: maxTokens, temperature,
        model: tier === 'fast' ? GROQ_DIRECT_FAST_MODEL : GROQ_DIRECT_SMART_MODEL,
      }),
    },
    {
      name: 'nvidia',
      ready: NVIDIA_CONFIGURED,
      fits: always,
      run: () => nvidiaChat(messages, system, { max_tokens: maxTokens, temperature } as never),
    },
    {
      name: 'gemini',
      ready: !!process.env.GOOGLE_AI_API_KEY,
      fits: always,
      run: () => geminiChat(messages, system, { max_tokens: maxTokens, temperature }),
    },
    // OpenRouter was the rung of last resort here. Its free tier is capped
    // account-wide at 50 requests a day across every ":free" model combined,
    // and production reported it `quota` — so it was a rung that always
    // failed, costing a round trip on the way past. Removed; the four above
    // are four independent free tiers and three of them report healthy.
  ]

  const skipped: string[] = []
  for (const rung of ladder) {
    if (!rung.ready) { skipped.push(`${rung.name}:no-key`); continue }
    if (isOnCooldown(rung.name)) { skipped.push(`${rung.name}:cooldown`); continue }
    if (!rung.fits(promptTokens, maxTokens)) { skipped.push(`${rung.name}:too-long`); continue }
    const left = budget - spent()
    // Not enough left to be worth a round trip: stop rather than start
    // something that will be cut off half way through anyway.
    if (left < 1200) { skipped.push(`${rung.name}:out-of-budget`); break }

    try {
      const res = await Promise.race([
        rung.run(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('attempt-timeout')), Math.min(perAttempt, left))),
      ])
      const text = readContent(res)
      if (text) return { text, provider: rung.name }
      skipped.push(`${rung.name}:empty`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // A quota or a rate limit is not worth retrying for minutes; anything
      // else might be transient, so only the former earns a cooldown.
      if (/429|rate.?limit|quota|exhaust/i.test(msg)) markRateLimited(rung.name)
      skipped.push(`${rung.name}:${msg.slice(0, 24)}`)
    }
  }

  console.warn(`[infer] no provider answered (${tier}) in ${spent()}ms — ${skipped.join(', ')}`)
  return { text: null, provider: `none(${skipped.join(',')})` }
}
