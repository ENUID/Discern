// Google Gemini via the OpenAI-compatible endpoint
// Docs: https://ai.google.dev/gemini-api/docs/openai

import { isOnCooldown, markRateLimited } from './providerCooldown'

export const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/openai'
/** Google retires models on its own schedule, and this one had been dead on
 *  production for long enough that the provider ladder was running on two rungs
 *  instead of four. The 404 said so in plain words the whole time; nothing was
 *  reading it. See retiredModelReplacement below — this default is now the
 *  starting guess rather than the only one. */
export const GEMINI_STYLIST_MODEL =
  process.env.GEMINI_STYLIST_MODEL ?? 'gemini-3.6-flash'

/** The model Google says to use instead, taken from its own 404.
 *
 *  "This model models/gemini-2.0-flash is no longer available. Please update
 *  your code to use models/gemini-3.6-flash for the latest features and
 *  improvements."
 *
 *  A retirement is not a transient failure and a redeploy is not always near.
 *  Google names the successor in the error; reading it costs one regex and
 *  turns a dead rung into a live one on the very next request. The name is
 *  taken only from the "use models/X" clause and only when it differs from
 *  what we just asked for, so this can never loop. */
const RETIRED_RE = /(?:no longer available|deprecated|not found)[\s\S]{0,200}?use\s+models\/([A-Za-z0-9][\w.-]{2,60})/i

export function retiredModelReplacement(body: string, asked: string): string | null {
  const m = RETIRED_RE.exec(body)
  const name = m?.[1]?.replace(/[.,"')\]}]+$/, '')
  return name && name !== asked ? name : null
}

/** Learned at runtime, so one request's discovery serves every request after
 *  it on this instance. */
let liveModel: string | null = null

export type GeminiMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string | null
}

export async function geminiChat(
  messages: GeminiMessage[],
  system?: string,
  opts?: { max_tokens?: number; temperature?: number },
  retryCount = 0,
  modelOverride?: string,
): Promise<{ role: string; content: string | null }> {
  const apiKey = process.env.GOOGLE_AI_API_KEY
  if (!apiKey) throw new Error('GOOGLE_AI_API_KEY is not set')
  if (isOnCooldown('gemini')) throw new Error('gemini is on rate-limit cooldown, skipping')

  const allMessages = system
    ? [{ role: 'system' as const, content: system }, ...messages]
    : messages

  const model = modelOverride ?? liveModel ?? GEMINI_STYLIST_MODEL
  const payload = {
    model,
    messages: allMessages,
    temperature: opts?.temperature ?? 0.4,
    max_tokens: opts?.max_tokens ?? 700,
  }

  try {
    const res = await fetch(`${GEMINI_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    })

    if (res.status === 429) {
      // Same reasoning as lib/groq.ts's chatCompletion: a free-tier cap
      // doesn't clear in a handful of seconds, so sleeping and retrying THIS
      // provider was wasted time that delayed reaching a fallback provider
      // that could actually answer. Fail fast; the caller's own fallback
      // chain (stylistChat) is what's supposed to absorb this.
      markRateLimited('gemini')
      const rlErr: any = new Error('Gemini HTTP 429 (rate limited)')
      rlErr.isRateLimit = true
      throw rlErr
    }

    if (!res.ok) {
      const err = await res.text()
      // Retired model: Google names its successor in the body. Adopt it for
      // this instance and answer the request that discovered it, rather than
      // failing every call until someone redeploys.
      const replacement = res.status === 404 ? retiredModelReplacement(err, model) : null
      if (replacement && retryCount < 1) {
        console.warn(`[gemini] ${model} is retired — trying ${replacement}`)
        try {
          const out = await geminiChat(messages, system, opts, retryCount + 1, replacement)
          // Remembered only once it has actually answered. Adopting a name that
          // then fails would leave every later request worse off than the
          // default it replaced.
          liveModel = replacement
          return out
        } catch (e: any) {
          // The successor failed too. The generic retry below must not now
          // spend two more seconds re-asking for a model we have just been
          // told does not exist.
          e.isRetired = true
          throw e
        }
      }
      throw new Error(`Gemini HTTP ${res.status}: ${err}`)
    }

    const data = await res.json()
    return data.choices?.[0]?.message ?? { role: 'assistant', content: null }
  } catch (err: any) {
    if (!err.isRateLimit && !err.isRetired && retryCount < 1 && !err.message?.includes('API key')) {
      await new Promise(r => setTimeout(r, 2_000))
      return geminiChat(messages, system, opts, retryCount + 1)
    }
    throw err
  }
}
