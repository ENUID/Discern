/**
 * The three things that protect this route from itself.
 *
 * A per-IP rate limit, a breaker that stops asking a model that is plainly
 * down, and the record of which providers have already told us their key is
 * spent. Extracted from the route in Phase E, step E1 — **moved, not
 * rewritten**. Every threshold, every comparison and every message below is
 * byte-identical to what it replaced.
 *
 * WHY THESE THREE TRAVEL TOGETHER, and why that matters more than tidiness:
 * all three are PROCESS-LEVEL SINGLETONS, and each one works precisely because
 * there is exactly one of it in the process.
 *
 *   two rate-limit maps      → double the effective limit
 *   two breakers             → neither ever reaches its threshold
 *   two provider-out maps    → every request re-discovers a dead provider
 *
 * None of those failures is visible: the code compiles, the tests pass, and
 * the protection is simply gone. So the rule for this module is narrow and
 * absolute — **it is imported, never instantiated, and never duplicated.**
 * There is no factory here on purpose. `scripts/limits.js` asserts exactly
 * that, by reaching the same counter through two different import paths.
 *
 * This is legitimate module-global state under §4 of the brief: shared
 * cooldown infrastructure, intentionally designed, with concurrency semantics
 * that are safe because every operation is a single synchronous read-modify-
 * write on a Map keyed by something request-specific. Nothing here describes
 * one shopper's request; a shopper's own state lives in the trace.
 */
import type { NextRequest } from 'next/server'

// ── Per-IP rate limit ───────────────────────────────────────────────────────

const stylistBuckets = new Map<string, { count: number; resetAt: number }>()
const STYLIST_MAX = 30   // requests per minute per IP
const STYLIST_WIN = 60_000
// Expired entries were only ever overwritten in place, never removed — on a
// long-lived instance the map grows with every distinct IP ever seen for the
// life of the process. Sweep it occasionally instead of on every request.
let lastStylistSweep = 0
const STYLIST_SWEEP_EVERY = 5 * 60_000

export function stylistRateLimited(req: NextRequest): boolean {
  const ip = req.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim()
    ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? 'unknown'
  const now = Date.now()
  if (now - lastStylistSweep > STYLIST_SWEEP_EVERY) {
    lastStylistSweep = now
    stylistBuckets.forEach((bucket, key) => {
      if (now > bucket.resetAt) stylistBuckets.delete(key)
    })
  }
  const b = stylistBuckets.get(ip)
  if (!b || now > b.resetAt) { stylistBuckets.set(ip, { count: 1, resetAt: now + STYLIST_WIN }); return false }
  if (b.count >= STYLIST_MAX) return true
  b.count++
  return false
}

// ── The model breaker ───────────────────────────────────────────────────────
// When a provider is down or a key has expired, every request rediscovers that
// from scratch: five providers, each with its own timeout, before anything is
// shown. The shopper waits the better part of a minute to be told nothing, and
// asking again waits the same again.

const BREAKER_TRIP_AT = 3
const BREAKER_COOLDOWN_MS = 60_000
let modelFailures = 0
let breakerOpenedAt = 0

export function modelLooksDown(): boolean {
  if (modelFailures < BREAKER_TRIP_AT) return false
  if (Date.now() - breakerOpenedAt > BREAKER_COOLDOWN_MS) {
    // Cooldown elapsed — let one request through to find out if it recovered.
    modelFailures = 0
    return false
  }
  return true
}

export function noteModelFailure() {
  modelFailures++
  if (modelFailures === BREAKER_TRIP_AT) {
    breakerOpenedAt = Date.now()
    console.warn('[stylist] model breaker OPEN — serving the catalogue directly for 60s')
  }
}

export function noteModelSuccess() {
  if (modelFailures > 0) console.log('[stylist] model breaker closed')
  modelFailures = 0
}

// ── Providers that have told us to stop asking ──────────────────────────────
// Providers whose key is spent or invalid, and when to bother with them again.
// Module scope, so one request's discovery spares every request after it.

const providerOut = new Map<string, number>()
/** Exported so the caller's log line stays byte-identical to the one it had
 *  before this module existed. */
export const PROVIDER_OUT_MS = 10 * 60_000

/** Remember that this provider is out, for the standard window. */
export function markProviderOut(name: string): void {
  providerOut.set(name, Date.now() + PROVIDER_OUT_MS)
}

/** When this provider becomes worth trying again, or undefined if it is fine. */
export function providerOutUntil(name: string): number | undefined {
  return providerOut.get(name)
}

/** True when a failure was caused by every model being rate-limited, so the UI
 *  can show a warm "we're busy" message instead of a generic error. */
export function isRateLimited(err: unknown): boolean {
  const msg = (err as Error)?.message || ''
  return /\b429\b|rate limit|too many requests|quota/i.test(msg)
}

/** Exposed for the module-identity test only. Not for application use — a
 *  caller that reads these is almost certainly about to reimplement one of the
 *  functions above. */
export const __state = {
  buckets: () => stylistBuckets,
  failures: () => modelFailures,
  providerOut: () => providerOut,
}
