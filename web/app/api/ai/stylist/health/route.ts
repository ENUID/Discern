import { NextRequest, NextResponse } from 'next/server'
import { geminiChat } from '@/lib/gemini'
import {
  CHAT_MODEL, FAST_MODEL, GROQ_DIRECT_SMART_MODEL, GROQ_DIRECT_FAST_MODEL, GROQ_DIRECT_VISION_MODEL, GROQ_DIRECT_CONFIGURED,
  pingOpenRouter, pingGroqDirect,
} from '@/lib/groq'
import { CEREBRAS_MODEL, CEREBRAS_CONFIGURED, pingCerebras } from '@/lib/cerebras'
import { NVIDIA_MODEL, NVIDIA_CONFIGURED, pingNvidia } from '@/lib/nvidia'
import { ConvexHttpClient } from 'convex/browser'
import { api } from '@/convex/_generated/api'

// Diagnostic for the "a lot of people are styling with me" busy message. That
// message only appears when EVERY model call fails with a rate-limit/quota
// error — so we need to see which provider is actually failing and why. This
// pings Gemini, OpenRouter, and the Groq-direct fallback IN ISOLATION (not
// through groqChat's automatic fallback, which would mask which one failed)
// and reports each result separately.
//
// Secret-gated (no API keys are ever returned — only booleans + error text).
// Pass the secret in the Authorization header, NOT the query string — query
// params leak into server/access logs, browser history, and Referer headers,
// which would expose the shared CRON_SECRET:
//   curl -H "Authorization: Bearer $CRON_SECRET" https://.../api/ai/stylist/health
export const maxDuration = 30
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const out: Record<string, unknown> = {
    env: {
      GOOGLE_AI_API_KEY_set: !!process.env.GOOGLE_AI_API_KEY,
      OPENROUTER_API_KEY_set: !!process.env.OPENROUTER_API_KEY,
      GROQ_DIRECT_configured: GROQ_DIRECT_CONFIGURED,
      gemini_model: process.env.GEMINI_STYLIST_MODEL ?? 'gemini-2.0-flash (default)',
      openrouter_smart_model: CHAT_MODEL,
      openrouter_fast_model: FAST_MODEL,
      groq_direct_smart_model: GROQ_DIRECT_SMART_MODEL,
      groq_direct_fast_model: GROQ_DIRECT_FAST_MODEL,
      groq_direct_vision_model: GROQ_DIRECT_VISION_MODEL,
      cerebras_configured: CEREBRAS_CONFIGURED,
      cerebras_model: CEREBRAS_MODEL,
      nvidia_configured: NVIDIA_CONFIGURED,
      nvidia_model: NVIDIA_MODEL,
    },
  }

  // Gemini test (primary for vision, first attempt for heavy Fabrics queries)
  try {
    const r = await geminiChat([{ role: 'user', content: 'Reply with the single word ok.' }], undefined, { max_tokens: 10 })
    out.gemini = { ok: true, reply: (r?.content ?? '').slice(0, 60) }
  } catch (e) {
    out.gemini = { ok: false, error: (e as Error).message?.slice(0, 300) ?? 'unknown' }
  }

  // OpenRouter test — smart tier, isolated (no fallback)
  try {
    const r = await pingOpenRouter(CHAT_MODEL)
    out.openrouter_smart = { ok: true, model: CHAT_MODEL, reply: (r?.content ?? '').slice(0, 60) }
  } catch (e) {
    out.openrouter_smart = { ok: false, model: CHAT_MODEL, error: (e as Error).message?.slice(0, 300) ?? 'unknown' }
  }

  // OpenRouter test — fast tier, isolated (no fallback)
  try {
    const r = await pingOpenRouter(FAST_MODEL)
    out.openrouter_fast = { ok: true, model: FAST_MODEL, reply: (r?.content ?? '').slice(0, 60) }
  } catch (e) {
    out.openrouter_fast = { ok: false, model: FAST_MODEL, error: (e as Error).message?.slice(0, 300) ?? 'unknown' }
  }

  // Groq-direct test — smart tier (second-line fallback, only if configured)
  if (GROQ_DIRECT_CONFIGURED) {
    try {
      const r = await pingGroqDirect(GROQ_DIRECT_SMART_MODEL)
      out.groq_direct_smart = { ok: true, model: GROQ_DIRECT_SMART_MODEL, reply: (r?.content ?? '').slice(0, 60) }
    } catch (e) {
      out.groq_direct_smart = { ok: false, model: GROQ_DIRECT_SMART_MODEL, error: (e as Error).message?.slice(0, 300) ?? 'unknown' }
    }

    // Groq-direct test — fast tier
    try {
      const r = await pingGroqDirect(GROQ_DIRECT_FAST_MODEL)
      out.groq_direct_fast = { ok: true, model: GROQ_DIRECT_FAST_MODEL, reply: (r?.content ?? '').slice(0, 60) }
    } catch (e) {
      out.groq_direct_fast = { ok: false, model: GROQ_DIRECT_FAST_MODEL, error: (e as Error).message?.slice(0, 300) ?? 'unknown' }
    }

    // Groq-direct test — vision tier (the new 3rd fallback for wardrobe
    // photo uploads; text-only ping, confirms the model id/auth are valid,
    // not actual image handling).
    try {
      const r = await pingGroqDirect(GROQ_DIRECT_VISION_MODEL)
      out.groq_direct_vision = { ok: true, model: GROQ_DIRECT_VISION_MODEL, reply: (r?.content ?? '').slice(0, 60) }
    } catch (e) {
      out.groq_direct_vision = { ok: false, model: GROQ_DIRECT_VISION_MODEL, error: (e as Error).message?.slice(0, 300) ?? 'unknown' }
    }
  } else {
    out.groq_direct_smart = { ok: false, error: 'GROQ_API_KEY not set — fallback not configured' }
    out.groq_direct_fast = { ok: false, error: 'GROQ_API_KEY not set — fallback not configured' }
    out.groq_direct_vision = { ok: false, error: 'GROQ_API_KEY not set — fallback not configured' }
  }

  // Cerebras test — 4th independent free-tier pool, isolated (no fallback)
  if (CEREBRAS_CONFIGURED) {
    try {
      const r = await pingCerebras()
      out.cerebras = { ok: true, model: CEREBRAS_MODEL, reply: (r?.content ?? '').slice(0, 60) }
    } catch (e) {
      out.cerebras = { ok: false, model: CEREBRAS_MODEL, error: (e as Error).message?.slice(0, 300) ?? 'unknown' }
    }
  } else {
    out.cerebras = { ok: false, error: 'CEREBRAS_API_KEY not set — 4th fallback not configured' }
  }

  // NVIDIA NIM test — 5th independent free-tier pool (multimodal: text + vision)
  if (NVIDIA_CONFIGURED) {
    try {
      const r = await pingNvidia()
      out.nvidia = { ok: true, model: NVIDIA_MODEL, reply: (r?.content ?? '').slice(0, 60) }
    } catch (e) {
      out.nvidia = { ok: false, model: NVIDIA_MODEL, error: (e as Error).message?.slice(0, 300) ?? 'unknown' }
    }
  } else {
    out.nvidia = { ok: false, error: 'NVIDIA_API_KEY not set — 5th fallback not configured' }
  }

  // Usage summary — trailing 24h and trailing 1h, from the ai_usage events
  // logged by every exit point of /api/ai/stylist (see logAiUsage there).
  // Estimated tokens (chars/4), not exact provider-reported usage.
  if (process.env.NEXT_PUBLIC_CONVEX_URL && process.env.CONVEX_AUTH_SECRET) {
    try {
      const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL)
      const serverSecret = process.env.CONVEX_AUTH_SECRET
      const [last24h, lastHour] = await Promise.all([
        convex.query(api.users.getAiUsageSummary, { windowMs: 24 * 60 * 60 * 1000, serverSecret }),
        convex.query(api.users.getAiUsageSummary, { windowMs: 60 * 60 * 1000, serverSecret }),
      ])
      out.usage = { last24h, lastHour }
    } catch (e) {
      out.usage = { error: (e as Error).message?.slice(0, 300) ?? 'unknown' }
    }
  } else {
    out.usage = { error: 'NEXT_PUBLIC_CONVEX_URL or CONVEX_AUTH_SECRET not set' }
  }

  return NextResponse.json(out)
}
