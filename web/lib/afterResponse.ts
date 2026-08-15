import { after } from 'next/server'

/**
 * Run work after the response has been sent, without it being killed.
 *
 * On serverless, a floating promise is frozen the instant the response is
 * flushed. Work started and not awaited therefore does not "finish in the
 * background" — it stops, usually mid-request, usually silently. Anything that
 * is meant to outlive a response has to say so, and `after` is Next's way of
 * saying it: the function stays alive until the work settles.
 *
 * Two callers rely on this, and both would look correct locally and do nothing
 * in production without it:
 *   - the relevance judge, when it misses its window in front of the response
 *     and finishes behind it instead
 *   - brand stores that answer after their round's soft deadline, whose pieces
 *     go into the cached pool for the next page
 *
 * Outside a request scope — a script, a test, a warm-up — `after` throws, and
 * there a plain promise is exactly right.
 */
export function runAfterResponse(work: () => Promise<unknown>): void {
  try {
    after(work)
  } catch {
    void work()
  }
}
