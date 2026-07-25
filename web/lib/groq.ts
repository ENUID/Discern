// ── AI text/vision client ────────────────────────────────────────────────────
// PRIMARY: OpenRouter (free-tier models — see below). FALLBACK: Groq direct,
// for when OpenRouter's free tier hits its request cap. Two independent
// providers so one running dry never takes text chat down.
//
// We moved the primary off Groq because it periodically retires hosted open
// models on short notice — llama-3.1-8b-instant, llama-3.3-70b-versatile and
// llama-4-scout-17b-16e-instruct (everything this file used to call) were all
// deprecated by Groq on 2026-06-17. OpenRouter proxies the same kind of open
// models (DeepSeek, Qwen, Llama, etc.) behind one stable OpenAI-compatible API,
// so when a model gets retired again it's an env var change, not a rewrite.
// Groq is kept as a SECOND, independent free tier behind it (Groq's own
// current model lineup — NOT the deprecated ones — see GROQ_SMART_MODEL /
// GROQ_FAST_MODEL below), so the two free tiers' request caps don't share a
// pool: if OpenRouter's free 50-100/day cap is exhausted, Groq picks up.
//
// Function/constant names below (groqChat, CHAT_MODEL, ...) are kept as-is on
// purpose — a dozen routes import them, and renaming would touch every call
// site for a cosmetic win. Only this file and the env vars matter if a
// provider or model changes again.
//
// Requires OPENROUTER_API_KEY (https://openrouter.ai/keys — no card needed for
// the free models below). GROQ_API_KEY / GROQ_BASE_URL are optional — reuses
// whatever was already configured before the OpenRouter migration; if unset,
// the Groq fallback is simply skipped and OpenRouter is the only provider.
//
// Defaulted to OpenRouter's own auto-router, openrouter/free (launched Feb
// 2026) — zero cost, and it picks a live free model per-request rather than
// pinning one hardcoded slug. This directly fixes a real recurring failure
// mode: this file used to default to a specific free model ID (first Groq's
// own lineup, then deepseek/deepseek-chat-v3.1:free), and BOTH were
// unilaterally pulled from free tier by their provider with no warning —
// health-checked in production as a live HTTP 404 ("This model is
// unavailable for free"). openrouter/free routes around exactly that: it
// filters live for whatever a request actually needs (tool calling, image
// understanding, structured output) and never goes stale as individual
// free models rotate in/out upstream. Override via the env vars below if a
// specific pinned model is ever genuinely preferred over the auto-router.
//
// Tradeoff: OpenRouter's free tier is capped account-wide (across every
// ":free" model combined, openrouter/free included) at 20 req/min and 50
// req/day with no credit purchased, or 1000/day once you've bought $10 of
// credit (one-time, doesn't need to be spent — it just raises the ceiling).
// Once that's exhausted, this file falls back to Groq's own current lineup
// automatically, then Cerebras (see cerebras.ts) behind that.
import { isOnCooldown, markRateLimited } from './providerCooldown'

const AI_BASE = process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1'
const AI_API_KEY = process.env.OPENROUTER_API_KEY ?? ''
// "Smart" tier — tool-calling capable, used for search planning + the Fabrics
// stylist's heavy path. Override with OPENROUTER_SMART_MODEL.
export const CHAT_MODEL = process.env.OPENROUTER_SMART_MODEL ?? 'openrouter/free'
export const STYLIST_MODEL = process.env.OPENROUTER_SMART_MODEL ?? 'openrouter/free'
// "Fast" tier — chitchat routing, rerank judging, descriptions, shipping
// parsing, memory compression. Defaults to the same model as the smart tier
// for safety (one fewer unverified model ID); point it at something cheaper/
// quicker via OPENROUTER_FAST_MODEL once you've picked one from the catalog.
export const FAST_MODEL = process.env.OPENROUTER_FAST_MODEL ?? CHAT_MODEL
// Vision FALLBACK only — Gemini is primary (see wardrobeVisionChat below);
// this only fires when Gemini is rate-limited or GOOGLE_AI_API_KEY is unset.
// openrouter/free's live capability filtering covers image understanding
// too, so the same "never goes stale" reasoning applies here.
export const VISION_MODEL = process.env.OPENROUTER_VISION_MODEL ?? 'openrouter/free'
// A LIST of free OpenRouter vision models tried in order (broadening the chain
// so a single model being deprecated/down doesn't drop the whole OpenRouter
// tier). They share OpenRouter's one free pool, so a 429 on the first
// short-circuits the rest via the base cooldown — but on a MODEL-specific
// failure (bad slug, refuses the image), the next model still gets a shot.
export const OPENROUTER_VISION_MODELS: string[] = (process.env.OPENROUTER_VISION_MODELS
  ?? 'openrouter/free,google/gemini-2.0-flash-exp:free,meta-llama/llama-3.2-11b-vision-instruct:free,qwen/qwen2.5-vl-72b-instruct:free')
  .split(',').map(s => s.trim()).filter(Boolean)

// ── Groq direct — second-line fallback when OpenRouter's free tier is dry ──
// Reuses GROQ_API_KEY / GROQ_BASE_URL from before the migration (they were
// never removed from Vercel). Deliberately does NOT reuse the old
// GROQ_CHAT_MODEL — that almost certainly still holds a now-dead model string
// (llama-3.3-70b-versatile). These are Groq's own current replacements for
// the deprecated models, as recommended in Groq's 2026-06-17 deprecation
// notice — verify at https://console.groq.com/docs/models if this ever
// starts erroring and override via GROQ_SMART_MODEL / GROQ_FAST_MODEL.
const GROQ_DIRECT_BASE = process.env.GROQ_BASE_URL ?? 'https://api.groq.com/openai/v1'
const GROQ_DIRECT_API_KEY = process.env.GROQ_API_KEY ?? ''
export const GROQ_DIRECT_SMART_MODEL = process.env.GROQ_SMART_MODEL ?? 'openai/gpt-oss-120b'
export const GROQ_DIRECT_FAST_MODEL = process.env.GROQ_FAST_MODEL ?? 'openai/gpt-oss-20b'
export const GROQ_DIRECT_CONFIGURED = !!GROQ_DIRECT_API_KEY
// Groq's current vision-capable model (GPT-OSS above is text-only). The
// text chain gets 3 fallback tiers (Gemini/OpenRouter → OpenRouter → Groq
// direct); vision only ever had 2 (Gemini → OpenRouter's vision model) with
// no Groq-direct tier at all — this closes that gap.
// Llama 4 Maverick (the original default here) was deprecated by Groq on
// 2026-02-20; Llama 4 Scout (its usual replacement) was ALSO deprecated on
// 2026-06-17 — Groq's free/dev tier has no Llama 4 vision model left at
// all. qwen/qwen3.6-27b is Groq's own current migration target and is
// multimodal (accepts image input, not just text). Verify at
// https://console.groq.com/docs/vision if this ever starts erroring and
// override via GROQ_VISION_MODEL.
export const GROQ_DIRECT_VISION_MODEL = process.env.GROQ_VISION_MODEL ?? 'qwen/qwen3.6-27b'

export type ChatMessage = {
  role: string
  content: string | null
  name?: string
  tool_calls?: any[]
  tool_call_id?: string
  products?: any[]
}

// Strips visible chain-of-thought leakage some "hybrid reasoning" models
// (e.g. Qwen3's <think> blocks, seen live from qwen/qwen3.6-27b on Groq
// direct — health-checked in production returning "<think>\nHere's a
// thinking process:...") emit inline in .content when thinking mode isn't
// explicitly disabled by the caller. A raw reasoning trace showing up in a
// shopper-facing reply reads as a broken product, not a stylist. Handles
// both a fully-closed block and one cut off mid-thought by max_tokens.
// Applied at the shared choke points every reply funnels through
// (stylistChat in route.ts for text, wardrobeVisionChat below for vision)
// rather than per-provider, so it protects against ANY current or future
// model in the fallback chain doing this — openrouter/free in particular
// can route to a different underlying model per request.
export function stripThinkTags(text: string): string {
  if (!text) return text
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/gi, '')
    .trim()
}

// Some free-tier / guarded models (Llama Guard-style wrappers, gpt-oss safety
// channels, and whatever openrouter/free's auto-router lands on) append an
// internal safety-classifier verdict to their output — e.g. a trailing
// "User Safety: safe\nResponse Safety: safe". It is scaffolding, never part of
// the stylist's answer, but it leaks straight into the shopper-facing reply
// (reported live as "usersafe" and similar). Strip any standalone line of that
// "<X> Safety: <verdict>" shape wherever it appears. Applied at the same shared
// choke points as stripThinkTags so it holds no matter which provider answered.
export function stripSafetyLabels(text: string): string {
  if (!text) return text
  return text
    .replace(/^[ \t>*_-]*(?:user|response|prompt|content|assistant|output|input|message|conversation|overall|final)\s+safety\s*[:=]\s*\S.*$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// Em/en dashes as clause separators are the single most recognizable
// "AI-generated" tell, and the system prompt already forbids them (see WRITE
// LIKE AN ACTUAL PERSON in stylist/route.ts) — but that instruction is only
// as reliable as whichever of the 4 fallback providers actually answered a
// given request, and smaller/free-tier models follow it far less
// consistently than the primary one. Applied at the same shared choke
// points as stripThinkTags so the promise holds no matter which model
// answered. Only touches the em dash (—) and en dash (–) Unicode
// characters, never the plain ASCII hyphen (-) real compound words use
// ("off-white", "wide-leg", "12-14oz").
export function stripAiDashes(text: string): string {
  if (!text) return text
  return text
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/,\s*,/g, ',')
    .replace(/,\s*([.!?])/g, '$1')
    .trim()
}

// Some models in this fallback chain — most often whichever underlying
// model openrouter/free's auto-router happens to pick, or gpt-oss with
// reasoning_effort set — narrate their internal deliberation as plain prose
// INSTEAD OF wrapping it in <think> tags, so stripThinkTags's tag-based
// approach can't catch it at all. The tell isn't a tag, it's the voice: a
// real Fabrics reply always addresses the shopper directly ("you", "your")
// in 1-4 short sentences; a leaked reasoning trace narrates ABOUT the
// shopper in the third person ("the user says/wants"), talks through its own
// rules ("we must", "check rules", "the rule says"), and runs for whole
// paragraphs. Length alone isn't enough (a comparison reply can legitimately
// run a few sentences longer) — this requires BOTH implausible length AND
// at least two distinct meta-commentary signals before flagging, so a
// merely-long real reply is never mistaken for a leak.
const REASONING_LEAK_SIGNALS: RegExp[] = [
  /\bthe user (says?|wants?|is asking|said|likely)\b/i,
  /\bwe (need to|must|can|should)\b/i,
  /\blet'?s (do|check|see|think|write|make sure)\b/i,
  /\bthe rules? (say|states?|is)\b/i,
  /\bcheck rules?:?/i,
  /\b(now\s+)?(the\s+)?final (response|answer):?/i,
  /\bshould we\b/i,
]
export function looksLikeLeakedReasoning(text: string): boolean {
  if (!text || text.length < 350) return false
  let hits = 0
  for (const re of REASONING_LEAK_SIGNALS) {
    if (re.test(text)) hits++
    if (hits >= 2) return true
  }
  return false
}

function headersFor(base: string, apiKey: string) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  }
  // OpenRouter uses these for attribution + per-app rate-limit tiering.
  // Optional, but recommended — a harmless no-op against Groq's own API.
  if (base.includes('openrouter.ai')) {
    headers['HTTP-Referer'] = process.env.OPENROUTER_SITE_URL ?? 'https://discern.enuid.com'
    headers['X-Title'] = 'Discern'
  }
  return headers
}

/**
 * Raw chat completion call against a given provider (base URL + key + model).
 * Parametrized so every OpenAI-compatible provider in the fallback family —
 * OpenRouter, Groq direct, and Cerebras (lib/cerebras.ts) — shares ONE
 * retry/429-backoff/self-heal implementation instead of near-identical
 * copies that would drift apart the first time one of them gets a fix.
 * opts.extraPayload carries provider-specific request fields (e.g.
 * Cerebras' reasoning_effort) without this shared core knowing about them.
 */
export async function chatCompletion(
  base: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  system?: string,
  tools?: any[],
  opts?: { max_tokens?: number; temperature?: number; extraPayload?: Record<string, unknown> },
  retryCount = 0,
): Promise<any> {
  if (!apiKey) throw new Error(`No API key configured for ${base}`)
  // A provider that just 429'd won't clear its free-tier cap in the next few
  // seconds — skip the network round trip entirely rather than pay for a
  // call that will almost certainly 429 again. See lib/providerCooldown.ts.
  if (isOnCooldown(base)) throw new Error(`${base} is on rate-limit cooldown, skipping`)

  const allMessages = system
    ? [{ role: 'system', content: system }, ...messages]
    : messages

  const payload: any = {
    model,
    messages: allMessages,
    temperature: opts?.temperature ?? 0.1,
    max_tokens: opts?.max_tokens ?? 1200,
    ...(opts?.extraPayload ?? {}),
  }

  if (tools && tools.length > 0) {
    payload.tools = tools
    payload.tool_choice = 'auto'
  }

  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: headersFor(base, apiKey),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(25000),
    })

    if (res.status === 429) {
      // A free-tier cap doesn't clear in a few seconds — sleeping and
      // retrying THIS SAME provider was mostly wasted time (up to ~16s
      // across 2 retries) that delayed ever reaching a fallback provider
      // that could actually answer. Mark it on cooldown and fail
      // immediately; stylistChat's/relevanceRerank's own fallback loop is
      // what's actually supposed to absorb this, not a retry loop here.
      markRateLimited(base)
      const rlErr: any = new Error(`AI Provider HTTP 429 (rate limited): ${base}`)
      rlErr.isRateLimit = true
      throw rlErr
    }

    if (!res.ok) {
      const errorText = await res.text();
      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.error?.code === 'tool_use_failed' && errorJson.error?.failed_generation) {
          console.warn("Caught tool_use_failed error. Self-healing via failed_generation parser...");
          return {
            role: 'assistant',
            content: errorJson.error.failed_generation
          };
        }
      } catch (e) {}

      throw new Error(`AI Provider HTTP ${res.status}: ${errorText}`);
    }

    const data = await res.json()
    return data.choices?.[0]?.message
  } catch (err: any) {
    // A rate limit already fails fast above (own cooldown, no local retry) —
    // retrying it again here would defeat that. Only a genuine transient
    // network error (timeout, connection reset) is worth one retry.
    if (!err.isRateLimit && retryCount < 2 && !err.message?.includes('API key')) {
      console.warn(`AI provider connection error on ${base}: ${err.message}. Retrying in 2000ms...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
      return chatCompletion(base, apiKey, model, messages, system, tools, opts, retryCount + 1);
    }
    throw err;
  }
}

/**
 * Chat completion with automatic provider fallback: OpenRouter first, then
 * Groq direct (if configured) on ANY OpenRouter failure — rate limit, out of
 * credits, network error, whatever. This is what makes hitting OpenRouter's
 * free-tier cap a non-event instead of an outage.
 */
export async function groqChat(
  messages: ChatMessage[],
  system?: string,
  tools?: any[],
  opts?: { max_tokens?: number; temperature?: number; model?: string },
): Promise<any> {
  const requestedModel = opts?.model ?? CHAT_MODEL
  if (!AI_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is not set. Get one at https://openrouter.ai/keys and add it to .env.local / Vercel.')
  }

  try {
    return await chatCompletion(AI_BASE, AI_API_KEY, requestedModel, messages, system, tools, opts)
  } catch (primaryErr: any) {
    if (!GROQ_DIRECT_API_KEY) throw primaryErr
    const fallbackModel = requestedModel === FAST_MODEL ? GROQ_DIRECT_FAST_MODEL : GROQ_DIRECT_SMART_MODEL
    console.warn(`[ai] OpenRouter failed (${primaryErr.message}) — falling back to Groq direct (${fallbackModel})`)
    try {
      return await chatCompletion(GROQ_DIRECT_BASE, GROQ_DIRECT_API_KEY, fallbackModel, messages, system, tools, opts)
    } catch (fallbackErr: any) {
      throw new Error(`OpenRouter: ${primaryErr.message} | Groq: ${fallbackErr.message}`)
    }
  }
}

// Diagnostic seams — call ONE provider in isolation, bypassing the automatic
// fallback in groqChat, so /api/ai/stylist/health can report exactly which
// provider is failing instead of the fallback silently masking it.
export async function pingOpenRouter(model: string = CHAT_MODEL): Promise<any> {
  if (!AI_API_KEY) throw new Error('OPENROUTER_API_KEY is not set')
  return chatCompletion(AI_BASE, AI_API_KEY, model, [{ role: 'user', content: 'Reply with the single word ok.' }], undefined, undefined, { max_tokens: 10 })
}
export async function pingGroqDirect(model: string = GROQ_DIRECT_SMART_MODEL): Promise<any> {
  if (!GROQ_DIRECT_API_KEY) throw new Error('GROQ_API_KEY is not set — Groq-direct fallback is not configured')
  return chatCompletion(GROQ_DIRECT_BASE, GROQ_DIRECT_API_KEY, model, [{ role: 'user', content: 'Reply with the single word ok.' }], undefined, undefined, { max_tokens: 10 })
}

/**
 * Robust wrapper that executes the chat and natively repairs any
 * open-source model tool syntax leaks (like Llama 3's <function> tags).
 */
export async function generateRobustAIResponse(
  messages: ChatMessage[],
  systemPrompt: string,
  tools: any[]
): Promise<ChatMessage> {
  const aiResponse = await groqChat(messages, systemPrompt, tools)

  // 1. If it properly outputted standard tool_calls, return it directly.
  if (aiResponse.tool_calls && aiResponse.tool_calls.length > 0) {
    return aiResponse;
  }

  // 2. If it leaked Llama-3 style <function> tags into content, repair it!
  if (aiResponse.content && aiResponse.content.includes('<function=')) {
    const match = aiResponse.content.match(/<function=(\w+)>(.*?)<\/function>/) ||
                  aiResponse.content.match(/<function=(\w+)>(.*)$/);
    if (match) {
      const toolCallName = match[1];
      let toolCallArgs = match[2];
      
      // Clean up closing tags if we matched the fallback pattern
      if (toolCallArgs.endsWith('</function>')) {
        toolCallArgs = toolCallArgs.substring(0, toolCallArgs.length - 11);
      }
      
      const toolCallId = 'call_' + Math.random().toString(36).slice(2, 10);
      
      // Clean the raw tags out of the visual content
      const finalContent = aiResponse.content.replace(match[0], '').trim();
      
      return {
        role: 'assistant',
        content: finalContent || null,
        tool_calls: [{
          id: toolCallId,
          type: "function",
          function: {
            name: toolCallName,
            arguments: toolCallArgs.trim()
          }
        }]
      };
    }
  }

  // 3. If it leaked bracket-style tool calls (e.g. [search_ucp: "query"])
  if (aiResponse.content && aiResponse.content.includes('[search_ucp:')) {
    const match = aiResponse.content.match(/\[(search_ucp):\s*"(.*?)"\]/);
    if (match) {
      const toolCallName = match[1];
      const query = match[2];
      const toolCallId = 'call_' + Math.random().toString(36).slice(2, 10);
      const finalContent = aiResponse.content.replace(match[0], '').trim();

      return {
        role: 'assistant',
        content: finalContent || null,
        tool_calls: [{
          id: toolCallId,
          type: "function",
          function: {
            name: toolCallName,
            arguments: JSON.stringify({ searchQuery: query })
          }
        }]
      };
    }
  }

  // 4. If it leaked search_ucp>{...} or similar malformed JSON tags
  if (aiResponse.content && aiResponse.content.includes('search_ucp')) {
    const match = aiResponse.content.match(/search_ucp>?\s*({.*})/);
    if (match) {
      const toolCallArgs = match[1];
      const toolCallId = 'call_' + Math.random().toString(36).slice(2, 10);
      const finalContent = aiResponse.content.replace(match[0], '').trim();

      return {
        role: 'assistant',
        content: finalContent || null,
        tool_calls: [{
          id: toolCallId,
          type: "function",
          function: {
            name: 'search_ucp',
            arguments: toolCallArgs
          }
        }]
      };
    }
  }

  // 5. Otherwise, it's just a normal text response
  return aiResponse;
}

/**
 * Second completion after a tool run. Models often return null content when only
 * emitting tool_calls; this turn produces the conversational reply for the UI.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>(resolve => setTimeout(() => resolve(null), ms)),
  ])
}

export async function generatePostToolReply(
  messages: ChatMessage[],
  systemPrompt: string,
  assistantMessage: ChatMessage,
  toolResult: string,
  timeoutMs = 5000,
): Promise<string | null> {
  const toolCall = assistantMessage.tool_calls?.[0]
  if (!toolCall?.id) return null

  const followUp: ChatMessage[] = [
    ...messages,
    {
      role: 'system',
      content: `The search tool returned the following results:\n${toolResult}\n\nPlease provide a conversational reply summarizing these results. Do NOT manually list the products, the UI will display them. Remember to append the [SUGGESTIONS: ...] block at the end.`,
    },
  ]

  try {
    const reply = await withTimeout(
      groqChat(followUp, systemPrompt, undefined, {
        max_tokens: 450,
        temperature: 0.5,
      }).catch(() => null),
      timeoutMs,
    )
    if (!reply) {
      console.warn(`Post-search AI reply timed out after ${timeoutMs}ms`)
      return null
    }
    return reply.content?.trim() || null
  } catch (error) {
    console.error('Post-search AI reply failed:', error)
    return null
  }
}

// ── Vision model ──────────────────────────────────────────────────────────────

type VisionPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } }

export type VisionMessage = {
  role: 'user' | 'assistant' | 'system'
  content: string | VisionPart[]
}

export async function groqVisionChat(
  messages: VisionMessage[],
  system: string,
  opts?: { max_tokens?: number; temperature?: number; model?: string },
  retryCount = 0
): Promise<any> {
  const allMessages: VisionMessage[] = [{ role: 'system', content: system }, ...messages]
  const payload = {
    model: opts?.model ?? VISION_MODEL,
    messages: allMessages,
    temperature: opts?.temperature ?? 0.2,
    max_tokens: opts?.max_tokens ?? 700,
  }
  try {
    const res = await fetch(`${AI_BASE}/chat/completions`, {
      method: 'POST',
      headers: headersFor(AI_BASE, AI_API_KEY),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    })
    if (res.status === 429 && retryCount < 2) {
      await new Promise(r => setTimeout(r, 3_000))
      return groqVisionChat(messages, system, opts, retryCount + 1)
    }
    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Vision AI HTTP ${res.status}: ${err}`)
    }
    const data = await res.json()
    return data.choices?.[0]?.message
  } catch (err: any) {
    if (retryCount < 1 && !err.message?.includes('API key')) {
      await new Promise(r => setTimeout(r, 2_000))
      return groqVisionChat(messages, system, opts, retryCount + 1)
    }
    throw err
  }
}

// Despite the name, groqVisionChat above hits OpenRouter (AI_BASE/AI_API_KEY),
// not Groq directly — same naming-kept-as-is situation as groqChat. This one
// is the actual Groq-direct vision call, the third tier wardrobeVisionChat
// was missing: the text chain gets Gemini/OpenRouter → OpenRouter → Groq
// direct (3 tiers), but vision only ever had Gemini → OpenRouter (2) with no
// Groq-direct fallback at all, despite GROQ_API_KEY already being configured
// and used for text. When both Gemini and OpenRouter's shared free-tier pool
// are dry — the pool every light-chat reply and utility call also draws
// from — vision had nowhere left to go and just failed.
async function groqDirectVisionChat(
  messages: VisionMessage[],
  system: string,
  opts?: { max_tokens?: number; temperature?: number },
  retryCount = 0
): Promise<any> {
  if (!GROQ_DIRECT_API_KEY) { const e: any = new Error('GROQ_API_KEY not set'); e.status = 0; throw e }
  const allMessages: VisionMessage[] = [{ role: 'system', content: system }, ...messages]
  const payload = {
    model: GROQ_DIRECT_VISION_MODEL,
    messages: allMessages,
    temperature: opts?.temperature ?? 0.2,
    max_tokens: opts?.max_tokens ?? 700,
  }
  try {
    const res = await fetch(`${GROQ_DIRECT_BASE}/chat/completions`, {
      method: 'POST',
      headers: headersFor(GROQ_DIRECT_BASE, GROQ_DIRECT_API_KEY),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    })
    if (res.status === 429 && retryCount < 1) {
      await new Promise(r => setTimeout(r, 3_000))
      return groqDirectVisionChat(messages, system, opts, retryCount + 1)
    }
    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Groq direct vision HTTP ${res.status}: ${err}`)
    }
    const data = await res.json()
    return data.choices?.[0]?.message
  } catch (err: any) {
    if (retryCount < 1 && !err.message?.includes('API key')) {
      await new Promise(r => setTimeout(r, 2_000))
      return groqDirectVisionChat(messages, system, opts, retryCount + 1)
    }
    throw err
  }
}

// ── Gemini Flash vision ───────────────────────────────────────────────────────
// Primary for wardrobe scans. Throws {status:429} on rate-limit so the caller
// can fall back to the Groq-vision-replacement model without wrapping in a try/catch everywhere.

async function geminiVisionChat(
  systemPrompt: string,
  question: string,
  imageDataUrls: string[],
  opts?: { max_tokens?: number; temperature?: number }
): Promise<string> {
  // Matches the rest of the codebase (lib/gemini.ts) — the key you add in Vercel.
  const apiKey = process.env.GOOGLE_AI_API_KEY
  if (!apiKey) { const e: any = new Error('GOOGLE_AI_API_KEY not set'); e.status = 0; throw e }

  const parts: any[] = [{ text: `${systemPrompt}\n\n${question}` }]
  for (const url of imageDataUrls) {
    const m = url.match(/^data:([^;]+);base64,(.+)$/)
    if (m) parts.push({ inline_data: { mime_type: m[1], data: m[2] } })
  }

  const body = JSON.stringify({
    contents: [{ role: 'user', parts }],
    generationConfig: { maxOutputTokens: opts?.max_tokens ?? 900, temperature: opts?.temperature ?? 0.3 },
  })
  // Gemini 2.0 Flash is the best vision model in the chain, but its free tier
  // has a per-minute request cap. A single burst used to 429 and immediately
  // trip the whole "we're busy" fallback (the exact "anything she can improve"
  // failure). Retry a 429 (and a transient 5xx) with backoff before giving up,
  // so a momentary spike doesn't kill an otherwise-working photo analysis.
  let last429 = false
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, attempt * 2_500))
    let res: Response
    try {
      res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(30_000) }
      )
    } catch (e) {
      if (attempt < 2) continue // network/timeout — try again
      throw e
    }
    if (res.status === 429) { last429 = true; if (attempt < 2) continue; const e: any = new Error('Gemini rate limit'); e.status = 429; throw e }
    if (res.status >= 500 && attempt < 2) continue // transient server error — retry
    if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${await res.text()}`)
    const data = await res.json()
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
  }
  const e: any = new Error(last429 ? 'Gemini rate limit' : 'Gemini failed'); if (last429) e.status = 429; throw e
}

// ── Wardrobe vision — Gemini → OpenRouter → Groq direct ─────────────────────
// Tries Gemini 2.0 Flash first (best clothing recognition), then OpenRouter's
// vision model, then Groq direct — three independent providers/pools, same
// "a single failure can never kill the reply" guarantee stylistChat gives
// text. Falls back on ANY failure at each tier, not just a clean 429 or
// missing key — a timeout or a malformed response gets the same treatment
// as a rate limit, since either way the next tier is worth trying.
export async function wardrobeVisionChat(
  systemPrompt: string,
  question: string,
  imageDataUrls: string[],
  opts?: { max_tokens?: number; temperature?: number }
): Promise<string> {
  const errors: { name: string; err: any }[] = []

  try {
    const content = stripSafetyLabels(stripAiDashes(stripThinkTags((await geminiVisionChat(systemPrompt, question, imageDataUrls, opts)).trim())))
    if (!content) throw new Error('empty content')
    if (looksLikeLeakedReasoning(content)) throw new Error('leaked reasoning')
    return content
  } catch (err: any) {
    errors.push({ name: 'gemini', err })
  }

  const imageParts = imageDataUrls.map(url => ({
    type: 'image_url' as const,
    image_url: { url, detail: 'low' as const },
  }))
  const visionMessages: VisionMessage[] = [{ role: 'user', content: [{ type: 'text', text: question }, ...imageParts] }]

  // Several concrete free vision models on OpenRouter, tried in order — not just
  // the auto-router. If one model is deprecated/down/refuses the image, the next
  // is tried; a 429 on the shared pool short-circuits the rest via the cooldown.
  // Env-overridable so the list can be retuned without a deploy.
  for (const model of OPENROUTER_VISION_MODELS) {
    try {
      const msg = await groqVisionChat(visionMessages, systemPrompt, { ...opts, model })
      const content = stripSafetyLabels(stripAiDashes(stripThinkTags((msg?.content ?? '').trim())))
      if (!content) throw new Error('empty content')
      if (looksLikeLeakedReasoning(content)) throw new Error('leaked reasoning')
      return content
    } catch (err: any) {
      errors.push({ name: `openrouter(${model})`, err })
    }
  }

  try {
    const msg = await groqDirectVisionChat(visionMessages, systemPrompt, opts)
    const content = stripSafetyLabels(stripAiDashes(stripThinkTags((msg?.content ?? '').trim())))
    if (!content) throw new Error('empty content')
    if (looksLikeLeakedReasoning(content)) throw new Error('leaked reasoning')
    return content
  } catch (err: any) {
    errors.push({ name: 'groq-direct', err })
  }

  // All three failed — surface whichever looks like a rate limit so the
  // route can show the warm "busy" message instead of a generic error.
  const err: any = new Error(`vision: ${errors.map(e => `${e.name}(${e.err?.message})`).join(' | ')}`)
  err.status = errors.find(e => e.err?.status === 429)?.err.status ?? errors[0]?.err?.status
  throw err
}
