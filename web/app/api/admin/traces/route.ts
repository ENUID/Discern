import { NextRequest, NextResponse } from 'next/server'
import { readTrace, readRecentTraces, tracingEnabled } from '@/lib/stylist/traceStore'

/**
 * Why did we show this?
 *
 * §71 asks for an internal view onto the decision: the request, what was read
 * from it, what was searched, what came back, what the judge said, which model
 * answered and how, what fell back, and how long each part took. §3 says that
 * without it, improvement is guesswork — and this week proved the point, since
 * every quality question was answered by re-running the request by hand.
 *
 *   /api/admin/traces                  the last 25
 *   /api/admin/traces?degraded=1       only the ones that went wrong
 *   /api/admin/traces?id=r-...         one, in full
 *
 * Admin-only, by the same header the other admin endpoints use. A trace holds
 * the shopper's own question, which is not something to serve to the internet.
 */

export const dynamic = 'force-dynamic'

function authorized(req: NextRequest): boolean {
  const secret = process.env.ADMIN_SECRET
  if (!secret) return false
  return req.headers.get('x-admin-secret') === secret
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (!tracingEnabled()) {
    return NextResponse.json({ tracing: 'off', traces: [] })
  }

  const url = new URL(req.url)
  const id = url.searchParams.get('id')

  if (id) {
    const row = await readTrace(id)
    if (!row) return NextResponse.json({ error: 'not found', id }, { status: 404 })
    const r = row as { traceId: string; question: string; trace: string; createdAt: number }
    let parsed: unknown = null
    try { parsed = JSON.parse(r.trace) } catch { /* stored malformed; show what there is */ }
    return NextResponse.json({ traceId: r.traceId, createdAt: r.createdAt, trace: parsed ?? r.trace },
      { headers: { 'Cache-Control': 'no-store' } })
  }

  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 25) || 25, 1), 100)
  const degradedOnly = url.searchParams.get('degraded') === '1'
  const rows = await readRecentTraces(limit, degradedOnly)

  // A list is for finding the one worth opening, so it carries the shape of
  // each answer rather than the whole of it.
  const traces = rows.map((row) => {
    const r = row as { traceId: string; question: string; degraded: boolean; createdAt: number; trace: string }
    let t: Record<string, unknown> = {}
    try { t = JSON.parse(r.trace) } catch { /* summary still stands */ }
    return {
      traceId: r.traceId,
      at: new Date(r.createdAt).toISOString(),
      question: r.question,
      degraded: r.degraded,
      route: t.route,
      answerVia: t.answerVia,
      judge: t.judge,
      shown: Array.isArray(t.shown) ? t.shown.length : 0,
      ms: t.ms,
      // The one-line reason it went wrong, when it did — which is what makes a
      // list scannable rather than something to open twenty-five times.
      why: t.modelTrace ?? (Array.isArray(t.outfitTrace) ? t.outfitTrace[0] : undefined),
    }
  })

  return NextResponse.json({ count: traces.length, degradedOnly, traces },
    { headers: { 'Cache-Control': 'no-store' } })
}
