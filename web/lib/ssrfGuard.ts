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

/** Parse an IPv6 literal into its eight 16-bit groups, or null.
 *
 *  The guard below used to look for an embedded IPv4 by matching a trailing
 *  dotted-quad on the raw string. `new URL()` does not preserve that form:
 *  `[::ffff:127.0.0.1]` is normalised to `[::ffff:7f00:1]` before the guard
 *  ever sees it, so the dotted-quad was gone and the address — plain 127.0.0.1
 *  — was allowed through. Parsing properly is the only way to see it. */
function parseIPv6(host: string): number[] | null {
  let h = host.toLowerCase().trim()
  if (!h.includes(':')) return null
  // A zone index ("fe80::1%eth0") names an interface, never a destination.
  const pct = h.indexOf('%')
  if (pct !== -1) h = h.slice(0, pct)

  const halves = h.split('::')
  if (halves.length > 2) return null

  // A trailing dotted-quad occupies the last two groups.
  const expand = (part: string): number[] | null => {
    if (part === '') return []
    const out: number[] = []
    const bits = part.split(':')
    for (let i = 0; i < bits.length; i++) {
      const b = bits[i]
      if (i === bits.length - 1 && b.includes('.')) {
        const v4 = parseIPv4(b)
        if (v4 === null) return null
        out.push((v4 >>> 16) & 0xffff, v4 & 0xffff)
        continue
      }
      if (!/^[0-9a-f]{1,4}$/.test(b)) return null
      out.push(parseInt(b, 16))
    }
    return out
  }

  if (halves.length === 1) {
    const only = expand(halves[0])
    return only && only.length === 8 ? only : null
  }
  const left = expand(halves[0])
  const right = expand(halves[1])
  if (!left || !right) return null
  const gap = 8 - left.length - right.length
  if (gap < 1) return null
  return [...left, ...new Array(gap).fill(0), ...right]
}

/** The IPv4 address an IPv6 literal actually reaches, or null.
 *
 *  Two prefixes carry a real IPv4 destination in their last 32 bits, and both
 *  were reachable before this: `::ffff:a.b.c.d` (IPv4-mapped, RFC 4291) and
 *  `64:ff9b::a.b.c.d` (NAT64 well-known, RFC 6052). Nothing else is treated
 *  this way on purpose — 2001:db8::7f00:1 is a perfectly ordinary address that
 *  merely ends in the same 32 bits, and blocking it would be wrong. */
function embeddedIPv4(groups: number[]): number | null {
  const zeros = (from: number, to: number) => groups.slice(from, to).every(g => g === 0)
  const tail = ((groups[6] << 16) | groups[7]) >>> 0

  if (zeros(0, 5) && groups[5] === 0xffff) return tail          // ::ffff:0:0/96
  if (zeros(0, 6)) return tail                                  // ::a.b.c.d (deprecated)
  if (groups[0] === 0x0064 && groups[1] === 0xff9b && zeros(2, 6)) return tail  // 64:ff9b::/96
  return null
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
  // A trailing dot is the DNS root and resolves identically: "localhost." is
  // "localhost". `new URL()` strips it from IP literals but NOT from names, so
  // every suffix rule below was one keystroke from being bypassed.
  h = h.replace(/\.+$/, '')
  if (!h) return true

  // Internal / loopback hostnames and suffixes
  if (
    h === 'localhost' || h.endsWith('.localhost') ||
    h.endsWith('.local') || h.endsWith('.internal') ||
    h === 'metadata.google.internal'
  ) return true

  // IPv6: loopback, unspecified, link-local (fe80::/10), unique-local (fc00::/7)
  if (h === '::1' || h === '::' || h.startsWith('fe80:') || /^f[cd][0-9a-f]*:/.test(h)) return true
  // IPv4 carried inside an IPv6 address — ::ffff:127.0.0.1, its normalised form
  // ::ffff:7f00:1, and the NAT64 well-known prefix. Parsed rather than pattern-
  // matched, because normalisation removes the dotted-quad the old check needed.
  if (h.includes(':')) {
    const groups = parseIPv6(h)
    if (groups) {
      const embedded = embeddedIPv4(groups)
      if (embedded !== null && isBlockedIPv4(embedded)) return true
    }
    // Kept: a trailing dotted-quad in any other IPv6 shape still range-checks.
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

/** Headers that authenticate a request rather than describe it.
 *
 *  Only `authorization` was dropped before, which named the smallest of the
 *  four. A cookie is a credential; an API key is a credential; a proxy
 *  credential is one for a hop the caller never intended to hand to a
 *  redirect target. Nothing in this app sends any of them through safeFetch
 *  today — this is the list that keeps that true when something does. */
const CREDENTIAL_HEADERS = ['authorization', 'cookie', 'proxy-authorization', 'x-api-key']

/** Headers that describe a body, and must go when the body does. */
const BODY_HEADERS = ['content-type', 'content-length']

/** What the returned Response can no longer honestly claim.
 *
 *  `capture` hands back bytes that `fetch` has already decoded, re-framed into
 *  a new Response. `content-encoding` described a compression that is no longer
 *  applied, `content-length` a wire length that is no longer the body's, and
 *  `content-range` a slice of a document this is not. `content-type` still
 *  describes the bytes, so it stays. */
const STALE_ON_CAPTURE = ['content-encoding', 'content-length', 'content-range']

/** Same scheme, same host, same effective port — exactly what `URL.origin` is.
 *
 *  The old comparison was hostname alone, which called `https://x` → `http://x`
 *  the same place and let a credential travel there in the clear, and said the
 *  same of a port change. */
function sameOrigin(a: URL, b: URL): boolean {
  return a.origin === b.origin
}

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
 * Every hop is validated before it is followed. Beyond that, three things
 * happen at a redirect, and each exists because the alternative was a way to
 * make this app do something on somebody else's behalf:
 *
 *   CREDENTIALS STOP AT THE ORIGIN   `authorization`, `cookie`,
 *                                    `proxy-authorization` and `x-api-key` are
 *                                    dropped the moment scheme, host or port
 *                                    changes. Same-origin hops keep them.
 *
 *   A POST IS NOT REPLAYED           301, 302 and 303 turn a non-GET into a
 *                                    GET and drop the body, which is what
 *                                    native `fetch` did before this function
 *                                    took the redirect loop over. 307 and 308
 *                                    mean "keep the method", so across an
 *                                    origin a body-bearing request is refused
 *                                    outright rather than sent somewhere the
 *                                    caller never named. A GET or HEAD has no
 *                                    body to replay and follows normally.
 *
 *   THE BODY IS BOUNDED WHILE IT ARRIVES, and `maxBytes` cannot be argued out
 *                                    of: anything that is not a finite
 *                                    positive number is the default.
 *
 * The returned Response carries the already-read body, so a caller's
 * `.text()`/`.json()`/`.arrayBuffer()` works exactly as before and cannot
 * re-read past the cap.
 */
export async function safeFetch(
  rawUrl: string,
  init: RequestInit = {},
  opts: SafeFetchOptions = {},
): Promise<Response> {
  const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS
  // Infinity and NaN both used to disable the cap outright — Infinity because
  // nothing exceeds it, NaN because `total > NaN` is false forever. Neither is
  // a size, so neither is accepted as one.
  const maxBytes = Number.isFinite(opts.maxBytes) && (opts.maxBytes as number) > 0
    ? (opts.maxBytes as number)
    : DEFAULT_MAX_BYTES

  let current = assertAllowed(rawUrl)
  const seen = new Set<string>([current.toString()])
  let headers = new Headers(init.headers as HeadersInit | undefined)
  let method = typeof init.method === 'string' ? init.method.toUpperCase() : 'GET'
  let body = init.body

  for (let hop = 0; ; hop++) {
    const res = await fetch(current.toString(), { ...init, method, body, headers, redirect: 'manual' })

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

    const crossOrigin = !sameOrigin(next, current)
    const bodyBearing = method !== 'GET' && method !== 'HEAD'

    // 307 and 308 exist to say "resend exactly what you sent". Across an
    // origin that is a request forgery with our body in it, so it is refused
    // before the second host is contacted rather than quietly stripped — a
    // bodyless POST arriving at a store is a worse answer than an error.
    //
    // Only for a request that HAS something to resend, though. A GET or a HEAD
    // carries no body, and the credential policy below has already taken the
    // headers off at the origin boundary, so refusing one would cost a
    // legitimate store redirect and buy nothing.
    if ((res.status === 307 || res.status === 308) && crossOrigin && bodyBearing) {
      res.body?.cancel().catch(() => { /* nothing left to do about it */ })
      throw new BlockedDestinationError(next.toString(), `cross-origin ${res.status} would replay the request`)
    }

    // Credentials stop at the origin, not merely at the hostname.
    if (crossOrigin && CREDENTIAL_HEADERS.some(h => headers.has(h))) {
      headers = new Headers(headers)
      for (const h of CREDENTIAL_HEADERS) headers.delete(h)
    }

    // 301/302/303: a non-GET becomes a GET and loses its body, along with the
    // two headers that only described that body.
    if (res.status !== 307 && res.status !== 308 && bodyBearing) {
      method = 'GET'
      body = undefined
      headers = new Headers(headers)
      for (const h of BODY_HEADERS) headers.delete(h)
    }

    // Nothing here reads the redirect's body, so let go of it explicitly
    // rather than leaving it to the garbage collector to dump.
    res.body?.cancel().catch(() => { /* nothing left to do about it */ })

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

  // The bytes below are decoded and re-framed, so three of the headers that
  // came off the wire no longer describe them. Everything else — content-type,
  // set-cookie, whatever else the store sent — is passed through untouched.
  const headers = new Headers(res.headers)
  for (const h of STALE_ON_CAPTURE) headers.delete(h)

  return new Response(body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  })
}
