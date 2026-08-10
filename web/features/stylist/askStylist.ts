// ── Talking to Fabrics ───────────────────────────────────────────────────────
// The v1 UI wrapped /api/ai/stylist in a good deal more than a fetch: a stream
// reader, three attempts with backoff, explicit handling for 429 and 5xx, and a
// re-send for the server's own "I produced no answer" signal. v2 called the
// same endpoint with a bare fetch, so every one of those failures surfaced to
// the shopper as an empty boutique. This is that wrapper, shared.

export type StylistImage = string

export type StylistContext = {
  buyerCurrency?: string
  buyerCountry?: string
  memorySummary?: string
  shopperGender?: string
  shopperProfile?: string
  shopperSizes?: { tops?: string; bottoms?: string; shoes?: string }
  shopperWardrobe?: string
  savedProducts?: Array<{ title?: string; vendor?: string; price?: number; currency?: string }>
  recentSearches?: string[]
}

export type StylistMessage = { role: 'user' | 'assistant'; content: string }

export type AskStylistArgs = {
  question: string
  messages?: StylistMessage[]
  images?: StylistImage[]
  /** Pieces the shopper pinned for this turn. Present means "these ARE the
   *  answer" server-side, so only send them when that is true. */
  products?: unknown[]
  context?: StylistContext
  /** Progress lines the endpoint streams while it works. */
  onProgress?: (phase: string) => void
  signal?: AbortSignal
}

/** Reads the endpoint's newline-delimited JSON: many {type:'progress'} lines,
 *  then one {type:'result'}. A partial trailing line is normal and skipped. */
async function readStylistStream(res: Response, onProgress?: (p: string) => void): Promise<any> {
  if (!res.body) return null
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let out: any = null
  const take = (l: string) => {
    const t = l.trim()
    if (!t) return
    try {
      const o = JSON.parse(t)
      if (o.type === 'result') out = o
      // The endpoint writes { type:'progress', icon, main, detail }. This read
      // `o.phase`, which it has never sent, so every progress line was parsed
      // and dropped — the interface narrated the wait with a canned four-phrase
      // loop while the real one ("Searching 62 brands", "Comparing 40 pieces")
      // went in the bin. `phase` stays as a fallback in case anything older
      // still speaks it.
      else if (o.type === 'progress' && onProgress) {
        const line = typeof o.main === 'string' ? o.main : typeof o.phase === 'string' ? o.phase : null
        if (line) onProgress(line)
      }
    } catch { /* partial line — the next chunk completes it */ }
  }
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let i
    while ((i = buf.indexOf('\n')) >= 0) { take(buf.slice(0, i)); buf = buf.slice(i + 1) }
  }
  take(buf)
  return out
}

const MAX_ATTEMPTS = 3
/** Past this, an honest message beats another spin of the wheel. */
const TOTAL_BUDGET_MS = 60_000

export async function askStylist(args: AskStylistArgs): Promise<any> {
  const { question, messages = [], images = [], products, context = {}, onProgress, signal } = args

  const body = JSON.stringify({
    question,
    messages,
    images,
    ...(products && products.length ? { products } : {}),
    ...context,
  })

  const startedAt = Date.now()
  let data: any = null

  for (let attempt = 0; attempt < MAX_ATTEMPTS && !data; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 500 * attempt))
    if (signal?.aborted) return null
    try {
      const res = await fetch('/api/ai/stylist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal,
      })
      // fetch does not reject on an HTTP error. Without this a 429 or a 500
      // fell through as `data === null` and got retried — double-hitting the
      // rate limiter, or paying twice for AI work that had already completed.
      if (res.status === 429 || res.status >= 500) {
        return {
          reply: res.status === 429
            ? 'That was a lot of requests at once. Give it a few seconds and try again.'
            : 'Something went wrong on my end. Give it another go?',
          didSearch: false,
          // Marked as a failure, not as an answer that happened to contain
          // nothing. Without this the caller cannot tell a broken request from
          // a shopper who said hello, and those two want opposite things to
          // happen on screen.
          failed: true,
        }
      }
      data = await readStylistStream(res, onProgress)
      // The server answered but reported that it generated nothing — its model
      // call timed out. Re-sending costs nothing (no answer was produced) and
      // usually succeeds, because the provider that stalled is now on cooldown
      // and gets skipped. This is what makes a first send work rather than the
      // shopper having to ask twice.
      if (data?.retryable && attempt < MAX_ATTEMPTS - 1 && Date.now() - startedAt < TOTAL_BUDGET_MS) {
        data = null
      }
    } catch (e) {
      if (signal?.aborted) return null
      if (attempt === MAX_ATTEMPTS - 1) throw e
    }
  }

  // Three attempts and nothing on the wire: every one came back retryable, or
  // the stream carried no result line. Returning null read downstream as
  // "answered, with nothing to show" — indistinguishable from a greeting, which
  // is how a failed search quietly dropped the shopper back on the home page
  // with the question gone.
  if (!data) {
    return {
      reply: 'I could not get an answer just then. Ask me again.',
      didSearch: false,
      failed: true,
    }
  }

  return data
}
