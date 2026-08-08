import { NextRequest, NextResponse } from 'next/server'
import { ConvexHttpClient } from 'convex/browser'
import { anyApi } from 'convex/server'

/**
 * Admin surface for the vocabulary review queue.
 *
 * GET  → the queue (defaults to unreviewed, most frequent first)
 * POST → record an approve/reject decision on one row
 *
 * Approving does NOT change search behaviour. It records that a human agreed
 * the mapping is right, which is the evidence for a reviewed edit to the
 * dictionaries in lib/queryParser.ts. Live matching stays hand-curated on
 * purpose — see convex/vocabCandidates.ts.
 */

// anyApi (not the generated typed api): the generated types are only rebuilt by
// `npx convex dev/deploy`, which the Vercel build runs — same pattern as every
// other server-side caller of a new function.

// Lazily constructed at request time so a missing env var can't fail the build.
function getConvex(): ConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL
  if (!url) throw new Error('NEXT_PUBLIC_CONVEX_URL is not set')
  return new ConvexHttpClient(url.trim().replace(/\/+$/, ''))
}

function authorized(req: NextRequest): { ok: boolean; reason?: string } {
  const secret = process.env.ADMIN_SECRET
  if (!secret) return { ok: false, reason: 'not_configured' }
  const header = req.headers.get('x-admin-secret')
  return { ok: header === secret, reason: header !== secret ? 'wrong_secret' : undefined }
}

export async function GET(req: NextRequest) {
  const auth = authorized(req)
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized', reason: auth.reason }, { status: 401 })
  if (req.nextUrl.searchParams.get('check') === '1') {
    return NextResponse.json({ ok: true, authed: true })
  }
  const serverSecret = process.env.CONVEX_AUTH_SECRET
  if (!serverSecret) return NextResponse.json({ error: 'Not configured' }, { status: 503 })

  const status = req.nextUrl.searchParams.get('status') ?? 'new'
  try {
    const rows = await getConvex().query(anyApi.vocabCandidates.listCandidates, {
      status, limit: 200, serverSecret,
    })
    return NextResponse.json({ ok: true, status, candidates: rows ?? [] })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = authorized(req)
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized', reason: auth.reason }, { status: 401 })
  const serverSecret = process.env.CONVEX_AUTH_SECRET
  if (!serverSecret) return NextResponse.json({ error: 'Not configured' }, { status: 503 })

  try {
    const body = await req.json()
    const id = body?.id
    const status = body?.status
    if (!id || (status !== 'approved' && status !== 'rejected')) {
      return NextResponse.json({ error: 'id and status (approved|rejected) required' }, { status: 400 })
    }
    const res = await getConvex().mutation(anyApi.vocabCandidates.reviewCandidate, {
      id, status, reviewedBy: typeof body?.by === 'string' ? body.by : undefined, serverSecret,
    })
    return NextResponse.json(res)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
