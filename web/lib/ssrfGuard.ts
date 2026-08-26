// Block requests to private/internal/cloud-metadata hosts.
//
// A hostname-string blocklist alone is bypassable: http://2130706433/ (=
// 127.0.0.1 in decimal), http://0x7f000001/, dotted-octal 0177.0.0.1, IPv4-
// mapped IPv6 ([::ffff:127.0.0.1]), and 0.0.0.0 all point at loopback/internal
// but slip past naive /^127\./-style regexes. So we PARSE any IPv4 the hostname
// could represent — in decimal, hex, octal, or a single packed integer — and
// range-check the actual address, plus cover the IPv6 and internal-suffix forms.

// Parse a hostname as an IPv4 address in ANY inet_aton-style encoding
// (dotted a.b.c.d, a.b.c, a.b, or a single integer; each part decimal, 0x-hex,
// or 0-prefixed octal). Returns the 32-bit address, or null if it isn't one.
function parseIPv4(host: string): number | null {
  const parts = host.split('.')
  if (parts.length < 1 || parts.length > 4) return null
  const nums: number[] = []
  for (const p of parts) {
    if (p === '') return null
    let n: number
    if (/^0x[0-9a-f]+$/i.test(p)) n = parseInt(p.slice(2), 16)
    else if (/^0[0-7]+$/.test(p)) n = parseInt(p, 8)
    else if (/^[1-9]\d*$/.test(p) || p === '0') n = parseInt(p, 10)
    else return null
    if (!Number.isFinite(n) || n < 0) return null
    nums.push(n)
  }
  let ip: number
  if (nums.length === 1) {
    ip = nums[0]
  } else if (nums.length === 2) {
    if (nums[0] > 0xff || nums[1] > 0xffffff) return null
    ip = nums[0] * 0x1000000 + nums[1]
  } else if (nums.length === 3) {
    if (nums[0] > 0xff || nums[1] > 0xff || nums[2] > 0xffff) return null
    ip = nums[0] * 0x1000000 + nums[1] * 0x10000 + nums[2]
  } else {
    if (nums.some(n => n > 0xff)) return null
    ip = nums[0] * 0x1000000 + nums[1] * 0x10000 + nums[2] * 0x100 + nums[3]
  }
  if (ip < 0 || ip > 0xffffffff) return null
  return ip >>> 0
}

function isBlockedIPv4(ip: number): boolean {
  const a = (ip >>> 24) & 0xff
  const b = (ip >>> 16) & 0xff
  if (a === 0) return true                          // 0.0.0.0/8 ("this host")
  if (a === 127) return true                        // loopback
  if (a === 10) return true                         // private
  if (a === 172 && b >= 16 && b <= 31) return true  // private
  if (a === 192 && b === 168) return true           // private
  if (a === 169 && b === 254) return true           // link-local + cloud metadata
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT (100.64/10)
  return false
}

export function isBlockedHost(hostname: string): boolean {
  let h = hostname.toLowerCase().trim()
  if (!h) return true
  // Strip brackets from IPv6 literals ([::1] → ::1)
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1)

  // Internal / loopback hostnames and suffixes
  if (
    h === 'localhost' || h.endsWith('.localhost') ||
    h.endsWith('.local') || h.endsWith('.internal') ||
    h === 'metadata.google.internal'
  ) return true

  // IPv6: loopback, unspecified, link-local (fe80::/10), unique-local (fc00::/7)
  if (h === '::1' || h === '::' || h.startsWith('fe80:') || /^f[cd][0-9a-f]*:/.test(h)) return true
  // IPv4-mapped / -embedded IPv6 (::ffff:127.0.0.1, ::ffff:7f00:1) — pull out any
  // trailing dotted-quad and range-check it.
  if (h.includes(':')) {
    const tail = h.match(/(\d{1,3}(?:\.\d{1,3}){3})$/)
    if (tail) {
      const ip = parseIPv4(tail[1])
      if (ip !== null && isBlockedIPv4(ip)) return true
    }
  }

  // Any IPv4 encoding (decimal/hex/octal/packed-integer)
  const ip = parseIPv4(h)
  if (ip !== null && isBlockedIPv4(ip)) return true

  return false
}

export function safeParseStoreUrl(raw: string): { protocol: string; hostname: string; origin: string } | null {
  try {
    const u = new URL(raw)
    if (!['http:', 'https:'].includes(u.protocol)) return null
    if (isBlockedHost(u.hostname)) return null
    return { protocol: u.protocol, hostname: u.hostname, origin: `${u.protocol}//${u.hostname}` }
  } catch {
    return null
  }
}

// ── Following a link is a second request, and it deserves a second check ─────
//
// `safeParseStoreUrl` above validates the URL a caller hands us. It cannot
// validate the one the server then redirects us to, and `fetch` follows
// redirects by default — so a host that passes the check can answer 302 and
// send the next request wherever it likes, including 169.254.169.254. Every
// user-facing fetch in this app was doing exactly that.
//
// `safeFetch` walks the chain itself: `redirect: 'manual'`, and each hop is put
// through the same predicate before it is followed. Nothing about the predicate
// changes — it is the same `isBlockedHost` the three routes already trusted,
// applied at every hop instead of only the first.
//
// THE BODY IS BOUNDED WHILE IT ARRIVES, not afterwards. Reading a response and
// then checking its length is a size check that still lets an attacker post a
// gigabyte through this process's memory first. The reader below stops and
// cancels the stream the moment the cap is passed, and fails closed rather than
// handing back a silently truncated document that a caller would parse as if it
// were whole.

/** A destination this app must not reach. Thrown, never returned, so a caller
 *  cannot mistake a blocked request for an empty one. */
export class BlockedDestinationError extends Error {
  constructor(readonly url: string, readonly reason: string) {
    super(`blocked destination: ${reason}`)
    this.name = 'BlockedDestinationError'
  }
}

/** The response was larger than the caller allowed. Fail closed: a truncated
 *  document parsed as a whole one is worse than no document. */
export class ResponseTooLargeError extends Error {
  constructor(readonly url: string, readonly limit: number) {
    super(`response exceeded ${limit} bytes`)
    this.name = 'ResponseTooLargeError'
  }
}

export type SafeFetchOptions = {
  /** Hops to follow before giving up. Three covers every real store redirect
   *  (apex → www, http → https, locale) and stops a loop cheaply. */
  maxRedirects?: number
  /** Hard ceiling on the body, enforced as it streams. */
  maxBytes?: number
}

const DEFAULT_MAX_REDIRECTS = 3
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024

/** The same check `safeParseStoreUrl` makes, as a reusable step. */
function assertAllowed(url: string): URL {
  let u: URL
  try { u = new URL(url) } catch { throw new BlockedDestinationError(url, 'unparseable') }
  if (!['http:', 'https:'].includes(u.protocol)) {
    throw new BlockedDestinationError(url, `scheme ${u.protocol}`)
  }
  if (isBlockedHost(u.hostname)) throw new BlockedDestinationError(url, `host ${u.hostname}`)
  return u
}

/**
 * Fetch a URL that came from outside this app.
 *
 * Every hop is validated, the body is capped as it arrives, and an
 * `Authorization` header is dropped the moment the host changes. The returned
 * Response carries the already-read body, so a caller's `.text()`/`.json()`
 * works exactly as before and cannot re-read past the cap.
 */
export async function safeFetch(
  rawUrl: string,
  init: RequestInit = {},
  opts: SafeFetchOptions = {},
): Promise<Response> {
  const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES

  let current = assertAllowed(rawUrl)
  const originHost = current.hostname
  const seen = new Set<string>([current.toString()])
  let headers = new Headers(init.headers as HeadersInit | undefined)

  for (let hop = 0; ; hop++) {
    const res = await fetch(current.toString(), { ...init, headers, redirect: 'manual' })

    const isRedirect = res.status >= 300 && res.status < 400 && res.headers.has('location')
    if (!isRedirect) return capture(res, current.toString(), maxBytes)

    if (hop >= maxRedirects) {
      throw new BlockedDestinationError(current.toString(), `more than ${maxRedirects} redirects`)
    }

    // A Location may be relative; resolve it against the hop we are on, then
    // put the RESULT through the same predicate. This is the whole point.
    const location = res.headers.get('location') as string
    const next = assertAllowed(new URL(location, current).toString())

    if (seen.has(next.toString())) {
      throw new BlockedDestinationError(next.toString(), 'redirect loop')
    }
    seen.add(next.toString())

    // Credentials do not cross a host boundary.
    if (next.hostname !== originHost && headers.has('authorization')) {
      headers = new Headers(headers)
      headers.delete('authorization')
    }
    current = next
  }
}

/**
 * Read a response body, stopping at the cap.
 *
 * The read is incremental and the stream is cancelled as soon as the limit is
 * passed — the oversized bytes are never all held at once, which is the
 * difference between a size limit and a size report.
 */
async function capture(res: Response, url: string, maxBytes: number): Promise<Response> {
  if (!res.body) return res

  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel('response too large').catch(() => {})
        throw new ResponseTooLargeError(url, maxBytes)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock?.()
  }

  const body = new Uint8Array(total)
  let at = 0
  for (const c of chunks) { body.set(c, at); at += c.byteLength }

  return new Response(body, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  })
}
