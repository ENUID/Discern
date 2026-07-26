// ── Cerebras — a 4th independent free-tier inference pool ───────────────────
// Mirrors lib/groq.ts's plain-fetch, OpenAI-compatible pattern deliberately
// (same retry/429/timeout shape) so every existing "fire-and-forget usage
// logging, graceful multi-tier fallback, isolated diagnostic ping" convention
// documented over there carries over here unchanged. This file only ever
// ADDS a fallback rung to an existing chain (stylistChat, relevanceRerank's
// LLM judge) — it never replaces OpenRouter/Gemini/Groq-direct, so a missing
// key or an exhausted free tier here degrades exactly like any other
// provider already does: silently, to the next one in line.
//
// Free tier (as of 2026): 1,000,000 tokens/day, 30 req/min, no credit card —
// but only an 8K token CONTEXT cap (not related to the daily volume number).
// Cerebras' custom chip hardware makes even their largest free model fast,
// so there's no speed reason to prefer a smaller model here the way there
// might be on GPU-hosted providers.
//
// Default model: gpt-oss-120b — OpenAI's open-weight reasoning model,
// already the trusted "smart tier" choice elsewhere in this codebase
// (GROQ_DIRECT_SMART_MODEL in lib/groq.ts is the same model family via
// Groq direct). Native context on Cerebras is 131K, well above what any
// prompt here needs; the free-tier account cap above still applies
// regardless of the model chosen.
//
// gpt-oss-120b supports a standard reasoning_effort param (low/medium/high,
// defaults to low) that trades latency for deeper chain-of-thought before
// answering — no other provider in this codebase exposes this knob, so
// callers opt in explicitly per call site rather than it being a blanket
// default. Cerebras' wafer-scale hardware is what makes "high" viable at
// all here — the same setting on a GPU-hosted endpoint would be far too
// slow for a live request.
//
// Requires CEREBRAS_API_KEY (https://cloud.cerebras.ai — free signup, no
// card). If unset, every call below throws immediately and the caller's
// existing fallback loop just moves on to the next provider.
import { chatCompletion } from './groq'

const CEREBRAS_BASE = process.env.CEREBRAS_BASE_URL ?? 'https://api.cerebras.ai/v1'
const CEREBRAS_API_KEY = process.env.CEREBRAS_API_KEY ?? ''
export const CEREBRAS_MODEL = process.env.CEREBRAS_MODEL ?? 'gpt-oss-120b'
export const CEREBRAS_CONFIGURED = !!CEREBRAS_API_KEY
// Cerebras also serves a VISION-capable model (gemma-4-31b: image input, up to
// 10 images/request, same generous free quota as gpt-oss-120b). Because Cerebras
// is the most reliable pool in the app, this becomes the primary photo-analysis
// provider — env-overridable if the preview model id changes.
export const CEREBRAS_VISION_MODEL = process.env.CEREBRAS_VISION_MODEL ?? 'gemma-4-31b'
export const CEREBRAS_VISION_CONFIGURED = !!CEREBRAS_API_KEY

type CerebrasMessage = {
  role: string
  content: string | null
  name?: string
}

type CerebrasOpts = {
  max_tokens?: number
  temperature?: number
  model?: string
  reasoning_effort?: 'low' | 'medium' | 'high'
}

// Delegates to lib/groq.ts's shared chatCompletion — one retry/429-backoff/
// timeout implementation for every OpenAI-compatible provider in the family,
// instead of a drift-prone copy here. Cerebras' one provider-specific field
// (reasoning_effort) rides in via extraPayload.
async function cerebrasCompletion(
  messages: CerebrasMessage[],
  system?: string,
  opts?: CerebrasOpts,
): Promise<any> {
  if (!CEREBRAS_API_KEY) throw new Error('CEREBRAS_API_KEY is not set. Get one at https://cloud.cerebras.ai and add it to .env.local / Vercel.')
  return chatCompletion(
    CEREBRAS_BASE,
    CEREBRAS_API_KEY,
    opts?.model ?? CEREBRAS_MODEL,
    messages as any,
    system,
    undefined,
    {
      max_tokens: opts?.max_tokens,
      temperature: opts?.temperature,
      extraPayload: opts?.reasoning_effort ? { reasoning_effort: opts.reasoning_effort } : undefined,
    },
  )
}

export async function cerebrasChat(
  messages: CerebrasMessage[],
  system?: string,
  opts?: CerebrasOpts,
): Promise<any> {
  return cerebrasCompletion(messages, system, opts)
}

// Multimodal (image + text) via Cerebras' gemma-4-31b — same OpenAI image_url
// content-part format the other vision providers use. Returns the raw reply
// text (matching geminiVisionChat), so it drops straight into the vision chain.
// Cerebras caps image input at 10 per request.
export async function cerebrasVisionChat(
  system: string,
  question: string,
  imageDataUrls: string[],
  opts?: CerebrasOpts,
): Promise<string> {
  if (!CEREBRAS_API_KEY) throw new Error('CEREBRAS_API_KEY is not set')
  const parts: any[] = [{ type: 'text', text: question }]
  for (const url of imageDataUrls.slice(0, 10)) parts.push({ type: 'image_url', image_url: { url } })
  const msg = await chatCompletion(
    CEREBRAS_BASE,
    CEREBRAS_API_KEY,
    opts?.model ?? CEREBRAS_VISION_MODEL,
    [{ role: 'user', content: parts }] as any,
    system,
    undefined,
    { max_tokens: opts?.max_tokens ?? 1100, temperature: opts?.temperature ?? 0.3 },
  )
  return (msg?.content ?? '') as string
}

// Isolated diagnostic seam — bypasses any fallback loop, same shape as
// pingOpenRouter/pingGroqDirect in lib/groq.ts, so /api/ai/stylist/health
// can report Cerebras' status independently.
export async function pingCerebras(): Promise<any> {
  if (!CEREBRAS_API_KEY) throw new Error('CEREBRAS_API_KEY is not set')
  return cerebrasCompletion([{ role: 'user', content: 'Reply with the single word ok.' }], undefined, { max_tokens: 10 })
}
