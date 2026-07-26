import { NextRequest, NextResponse } from 'next/server'
import { ConvexHttpClient } from 'convex/browser'
import { anyApi } from 'convex/server'

// Nightly retention sweep — drops analytics events older than the window the
// admin dashboard actually reads, so the events table stops growing without
// bound. See convex/retention.ts for why this is worth doing (storage is a
// live metric that drops when you prune; stale rows also inflate every
// dashboard read).
//
// Loops in bounded batches because a Convex mutation is transactional and
// time-limited — one call can't delete an arbitrarily large backlog.
export const runtime = 'nodejs'
export const maxDuration = 60

const RETAIN_DAYS = Number(process.env.EVENT_RETENTION_DAYS ?? 45)
const MAX_BATCHES = 40 // hard stop so a huge backlog drains over several nights

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const url = process.env.NEXT_PUBLIC_CONVEX_URL
  const serverSecret = process.env.CONVEX_AUTH_SECRET
  if (!url || !serverSecret) {
    return NextResponse.json({ error: 'not configured' }, { status: 503 })
  }

  const convex = new ConvexHttpClient(url.trim().replace(/\/+$/, ''))
  const olderThanMs = RETAIN_DAYS * 24 * 60 * 60 * 1000
  let deleted = 0
  let batches = 0
  let more = true
  const startedAt = Date.now()

  try {
    while (more && batches < MAX_BATCHES && Date.now() - startedAt < 45_000) {
      const res = await convex.mutation(anyApi.retention.pruneOldEvents, {
        serverSecret, olderThanMs, limit: 500,
      }) as { ok: boolean; deleted: number; more: boolean; reason?: string }
      if (!res?.ok) {
        console.error('[cron/retention] rejected:', res?.reason)
        return NextResponse.json({ error: res?.reason ?? 'failed', deleted }, { status: 500 })
      }
      deleted += res.deleted
      more = res.more
      batches++
    }
  } catch (e) {
    console.error('[cron/retention] failed:', e)
    return NextResponse.json({ error: 'prune failed', deleted }, { status: 500 })
  }

  return NextResponse.json({ ok: true, deleted, batches, more, retainDays: RETAIN_DAYS })
}
