// ── NVIDIA NIM — a 5th independent free-tier inference pool (MULTIMODAL) ─────
// thinkingmachines/inkling: a multimodal (text + image) reasoning model served
// OpenAI-compatible at integrate.api.nvidia.com/v1. Mirrors lib/cerebras.ts's
// plain-fetch pattern via the shared chatCompletion, so every "graceful
// multi-tier fallback / isolated diagnostic ping" convention carries over. It
// only ever ADDS a rung to an existing chain — it never replaces a provider,
// so a missing key or an exhausted free tier degrades silently to the next one.
//
// Because it is MULTIMODAL, it is wired into BOTH the text chain (stylistChat)
// AND the vision chain (photo analysis) — giving the perpetually rate-limited
// free vision path a fresh, independent pool.
//
// It is a REASONING model, so its .content can carry a <think> block; the
// callers already run stripThinkTags/looksLikeLeakedReasoning on every reply,
// so leaked reasoning is cleaned or the attempt falls through to the next tier.
//
// Requires NVIDIA_API_KEY (https://build.nvidia.com — free, no card). If unset,
// every call throws immediately and the caller's fallback loop moves on.
import { chatCompletion } from './groq'

const NVIDIA_BASE = process.env.NVIDIA_BASE_URL ?? 'https://integrate.api.nvidia.com/v1'
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY ?? ''
export const NVIDIA_MODEL = process.env.NVIDIA_MODEL ?? 'thinkingmachines/inkling'
export const NVIDIA_CONFIGURED = !!NVIDIA_API_KEY

type NvidiaMessage = { role: string; content: any; name?: string }
type NvidiaOpts = { max_tokens?: number; temperature?: number; model?: string }

// Text chat — delegates to the shared chatCompletion (one retry/429/timeout
// implementation for every OpenAI-compatible provider in the family).
export async function nvidiaChat(
  messages: NvidiaMessage[],
  system?: string,
  opts?: NvidiaOpts,
): Promise<any> {
  if (!NVIDIA_API_KEY) throw new Error('NVIDIA_API_KEY is not set. Get one at https://build.nvidia.com and add it to Vercel.')
  return chatCompletion(
    NVIDIA_BASE,
    NVIDIA_API_KEY,
    opts?.model ?? NVIDIA_MODEL,
    messages as any,
    system,
    undefined,
    { max_tokens: opts?.max_tokens, temperature: opts?.temperature },
  )
}

// Multimodal vision — same OpenAI image_url content-part format the other
// vision providers use. Returns the raw reply text (matching geminiVisionChat),
// so it drops straight into the vision fallback chain.
export async function nvidiaVisionChat(
  system: string,
  question: string,
  imageDataUrls: string[],
  opts?: NvidiaOpts,
): Promise<string> {
  if (!NVIDIA_API_KEY) throw new Error('NVIDIA_API_KEY is not set')
  const parts: any[] = [{ type: 'text', text: question }]
  for (const url of imageDataUrls) parts.push({ type: 'image_url', image_url: { url } })
  const msg = await chatCompletion(
    NVIDIA_BASE,
    NVIDIA_API_KEY,
    opts?.model ?? NVIDIA_MODEL,
    [{ role: 'user', content: parts }] as any,
    system,
    undefined,
    { max_tokens: opts?.max_tokens ?? 1100, temperature: opts?.temperature ?? 0.3 },
  )
  return (msg?.content ?? '') as string
}

// Isolated diagnostic seam — bypasses any fallback loop, same shape as
// pingCerebras/pingGroqDirect, so /api/ai/stylist/health reports NVIDIA's
// status independently. A generous token cap so a reasoning model still leaves
// room for a visible word after its internal thinking.
export async function pingNvidia(): Promise<any> {
  if (!NVIDIA_API_KEY) throw new Error('NVIDIA_API_KEY is not set')
  return chatCompletion(
    NVIDIA_BASE,
    NVIDIA_API_KEY,
    NVIDIA_MODEL,
    [{ role: 'user', content: 'Reply with the single word ok.' }] as any,
    undefined,
    undefined,
    { max_tokens: 64 },
  )
}
