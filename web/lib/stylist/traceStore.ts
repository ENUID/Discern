/**
 * Keeping the trace, without making the shopper wait for it.
 *
 * Same doctrine as every other persistence layer here — best effort, time
 * boxed, failure silent. A trace that fails to save costs a diagnosis; a trace
 * that delays a reply costs a shopper. Those are not close.
 *
 * Written AFTER the response has flushed, via runAfterResponse, so the write
 * is not on the path the shopper is waiting on at all.
 */
import { ConvexHttpClient } from 'convex/browser'
import { anyApi } from 'convex/server'
import { redactSecrets } from '@/lib/redact'
import type { Trace } from '@/lib/stylist/trace'

const WRITE_TIMEOUT_MS = 3000
const READ_TIMEOUT_MS = 2500

/** Default ON. A trace is a few hundred bytes written once per request, and it
 *  is the only thing that makes a bad recommendation diagnosable rather than
 *  re-runnable-by-hand. Switch off with STYLIST_TRACE=off. */
export function tracingEnabled(): boolean {
  return (process.env.STYLIST_TRACE ?? 'on').toLowerCase() !== 'off'
}

function client(): ConvexHttpClient | null {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL
  return url ? new ConvexHttpClient(url) : null
}

/**
 * The trace as it is safe to store.
 *
 * The free-text fields are the ones that carry a provider's error verbatim —
 * modelTrace is literally the ladder's own account, which quotes the failing
 * request back at you, and that is where a key would live. Redacted with the
 * same tested function the public provider check uses.
 */
function safe(t: Trace): Trace {
  return {
    ...t,
    modelTrace: t.modelTrace ? redactSecrets(t.modelTrace) : undefined,
    outfitTrace: t.outfitTrace?.map(x => redactSecrets(x)),
    steps: t.steps.map(s => ({ ...s, detail: s.detail ? redactSecrets(s.detail) : undefined })),
  }
}

export async function saveTrace(t: Trace): Promise<void> {
  if (!tracingEnabled()) return
  const c = client()
  const secret = process.env.CONVEX_AUTH_SECRET
  if (!c || !secret) return
  try {
    await Promise.race([
      c.mutation(anyApi.recommendationTraces.record, {
        traceId: t.id,
        question: t.question,
        trace: JSON.stringify(safe(t)),
        degraded: t.degraded === true,
        serverSecret: secret,
      }),
      new Promise(resolve => setTimeout(resolve, WRITE_TIMEOUT_MS)),
    ])
  } catch { /* a lost trace is a lost diagnosis, never a lost answer */ }
}

export async function readTrace(traceId: string): Promise<unknown | null> {
  const c = client()
  const secret = process.env.CONVEX_AUTH_SECRET
  if (!c || !secret) return null
  try {
    return (await Promise.race([
      c.query(anyApi.recommendationTraces.get, { traceId, serverSecret: secret }),
      new Promise(resolve => setTimeout(() => resolve(null), READ_TIMEOUT_MS)),
    ])) ?? null
  } catch { return null }
}

export async function readRecentTraces(
  limit = 25, degradedOnly = false,
): Promise<unknown[]> {
  const c = client()
  const secret = process.env.CONVEX_AUTH_SECRET
  if (!c || !secret) return []
  try {
    const rows = (await Promise.race([
      c.query(anyApi.recommendationTraces.recent, { limit, degradedOnly, serverSecret: secret }),
      new Promise(resolve => setTimeout(() => resolve([]), READ_TIMEOUT_MS)),
    ])) as unknown[] | null
    return Array.isArray(rows) ? rows : []
  } catch { return [] }
}
