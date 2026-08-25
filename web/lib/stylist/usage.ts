/**
 * What this route spent, and what it could not read.
 *
 * Two fire-and-forget observations and the Convex connection they share.
 * Extracted from the route in Phase E, step E2 — **moved, not rewritten**.
 * Every threshold, sample rate, length bound and property name below is
 * byte-identical to what it replaced.
 *
 * Both writes are diagnostics. Neither is on the path a shopper waits on, and
 * neither is awaited: a logging failure must never reach a reply. That is not
 * a nicety here — this app runs on free-tier quotas, and the whole reason for
 * the sampling below is that observing the system was itself becoming one of
 * the heaviest consumers of it.
 *
 * THE CONVEX CLIENT IS EXPORTED, and that is a compromise worth naming. It is
 * created here because usage logging is its main caller, but the wardrobe-scan
 * write in the route uses the same connection for something that is not usage
 * at all — persisting a shopper's wardrobe. That write belongs with a future
 * user/profile module, and moving it now would mean inventing that module in
 * a step that is supposed to move exactly three functions. So the connection
 * is shared and the seam is written down rather than hidden.
 */
import { ConvexHttpClient } from 'convex/browser'
import { anyApi } from 'convex/server'
import { api } from '@/convex/_generated/api'

// ── Usage visibility ─────────────────────────────────────────────────────────
// This app runs entirely on free-tier AI quotas shared across every request —
// there was previously no way to see consumption anywhere except after the
// fact, in a provider's own dashboard. Every exit point of this route logs an
// estimated token count (chars/4 — a standard rough approximation, not exact
// provider-reported usage) via the existing trackEvent/user_events pipeline.
// Read back through getAiUsageSummary, surfaced in /api/ai/stylist/health.
// Fire-and-forget: never awaited by the response, a logging failure never
// affects the shopper-facing reply.
export const convexUsageClient = process.env.NEXT_PUBLIC_CONVEX_URL
  ? new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL)
  : null

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

// Pure diagnostics — powers the admin dashboard's provider breakdown, nothing
// the shopper or Fabrics depends on. It used to fire a Convex write on EVERY
// LLM call, and a single request now makes several (reply + self-heal +
// tokenizer + retries), so it was one of the heaviest Convex-function-call
// drivers in the app. Sample it: a failure is ALWAYS written (that's the
// signal worth catching), successes are written ~1 in AI_USAGE_SAMPLE_N. The
// breakdown stays directionally correct at a fraction of the write volume, so
// this never pushes the free tier toward a paid upgrade. Set AI_USAGE_SAMPLE_N=1
// to log every call again.
const AI_USAGE_SAMPLE_N = Math.max(1, Number(process.env.AI_USAGE_SAMPLE_N ?? 5))
let aiUsageCounter = 0

export function logAiUsage(info: {
  path: 'fast' | 'llm-light' | 'llm-heavy' | 'vision' | 'refine' | 'load-more'
  provider: string
  estPromptTokens: number
  estCompletionTokensCap: number
  ok: boolean
}) {
  if (!convexUsageClient) return
  // Always keep failures; sample the (far more common) successes.
  if (info.ok) {
    aiUsageCounter = (aiUsageCounter + 1) % AI_USAGE_SAMPLE_N
    if (aiUsageCounter !== 0) return
  }
  convexUsageClient.mutation(api.users.trackEvent, {
    event: 'ai_usage',
    properties: info,
  }).catch(() => {}) // best-effort — never let logging affect the actual response
}

/**
 * Record a query the hand-curated vocabulary could not read — either it named
 * no garment we know, or a real search over it came back near-empty. This is
 * pure observation: the capture feeds a weekly cron and a human review page
 * (/admin/vocab), and nothing downstream reads it. The dictionaries stay
 * hand-edited, because a synonym auto-merged into the hot path is exactly the
 * kind of silent search regression that is miserable to trace.
 *
 * Fire-and-forget, like every other logging write here: a failure must never
 * touch the shopper's reply.
 */
export function recordVocabMiss(query: string, reason: 'no-results' | 'weak-match') {
  if (!convexUsageClient || !process.env.CONVEX_AUTH_SECRET) return
  const phrase = query.trim()
  // Sentences cluster badly and read as PII risk; only short, term-like
  // queries are worth proposing a dictionary entry for.
  if (phrase.length < 3 || phrase.length > 60 || phrase.split(/\s+/).length > 6) return
  // anyApi: the generated types only refresh on `npx convex dev/deploy`.
  convexUsageClient.mutation(anyApi.vocabCandidates.recordMiss, {
    phrase,
    reason,
    serverSecret: process.env.CONVEX_AUTH_SECRET,
  }).catch(() => {})
}

/** For the sampling test only — the counter is otherwise private. */
export const __usageState = {
  sampleN: () => AI_USAGE_SAMPLE_N,
  counter: () => aiUsageCounter,
}
