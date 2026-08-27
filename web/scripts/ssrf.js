/**
 * Where this server is allowed to send a request, and how much it will read.
 *
 * Three routes take a URL from the caller — `?url=` on product-images,
 * sizeguide and shipping — and fetch it. `safeParseStoreUrl` checked the host
 * they were given. It could not check the host they were *sent to*, because
 * `fetch` follows redirects by default and nothing in this app ever said
 * otherwise. A host that passes the check can answer `302 Location:
 * http://169.254.169.254/` and the second request goes wherever it likes.
 *
 * So the interesting tests here are not "is 127.0.0.1 blocked" — the predicate
 * was already good at that, and this file proves it stayed good. They are:
 *
 *   EVERY HOP IS CHECKED    a blocked redirect target is never requested at
 *                           all, which is asserted by watching what fetch was
 *                           actually called with
 *   THE READER STOPS        an oversized body is abandoned mid-stream rather
 *                           than downloaded and then measured, which is
 *                           asserted by counting the chunks that were pulled
 *   IT FAILS CLOSED         oversize throws instead of returning a truncated
 *                           document a caller would parse as a whole one
 *
 * `fetch` is stubbed throughout. That is deliberate: a real server would need a
 * real port, and the loopback address this harness exists to block is exactly
 * where such a server would live. Stubbing lets the test assert on the requests
 * that WOULD have been made, which is the only thing that matters here.
 */
const path = require('path')
const fs = require('fs')
const zlib = require('zlib')
const { execFileSync } = require('child_process')

const WEB = path.resolve(__dirname, '..')
function build(entry, name) {
  const out = path.join(WEB, '.vt', name + '.cjs')
  fs.mkdirSync(path.join(WEB, '.vt'), { recursive: true })
  execFileSync(path.join(WEB, 'node_modules/.bin/esbuild'), [
    path.join(WEB, entry), '--bundle', '--platform=node', '--format=cjs',
    '--outfile=' + out, '--log-level=error', '--alias:@=' + WEB,
  ])
  return require(out)
}

const G = build('lib/ssrfGuard.ts', 'ssrf')
const { isBlockedHost, safeParseStoreUrl, safeFetch,
        BlockedDestinationError, ResponseTooLargeError } = G

let bad = 0
const check = (ok, label, detail) => {
  if (!ok) bad++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail !== undefined ? `  ${detail}` : ''}`)
}

/** Install a fetch that records every URL it is asked for. */
function stubFetch(handler) {
  const asked = []
  global.fetch = async (url, init) => {
    asked.push(String(url))
    return handler(String(url), init, asked.length - 1)
  }
  return asked
}
const realFetch = global.fetch
const restore = () => { global.fetch = realFetch }

const redirectTo = (location, status = 302) =>
  new Response(null, { status, headers: { location } })
const ok = (body = 'hello') => new Response(body, { status: 200 })

/** A body that arrives in chunks, counting how many were actually pulled. */
function chunkedBody(chunkSize, chunkCount, counter) {
  let sent = 0
  return new ReadableStream({
    pull(controller) {
      if (sent >= chunkCount) { controller.close(); return }
      sent++
      counter.pulled = sent
      controller.enqueue(new Uint8Array(chunkSize))
    },
  })
}

// ── the destination predicate ───────────────────────────────────────────────
console.log('── where this server may not go ' + '─'.repeat(42))
{
  const blocked = [
    ['localhost', 'localhost'],
    ['127.0.0.1', 'loopback'],
    ['0.0.0.0', 'this host'],
    ['[::1]', 'IPv6 loopback'],
    ['10.0.0.1', 'private 10/8'],
    ['172.16.0.1', 'private 172.16/12'],
    ['172.31.255.254', 'private 172.31 (upper edge)'],
    ['192.168.1.1', 'private 192.168/16'],
    ['169.254.169.254', 'link-local — the cloud metadata address'],
    ['100.64.0.1', 'CGNAT 100.64/10'],
    ['[fe80::1]', 'IPv6 link-local'],
    ['[fc00::1]', 'IPv6 unique-local'],
    ['[fd00::1]', 'IPv6 unique-local (fd)'],
    ['2130706433', 'packed-integer 127.0.0.1'],
    ['0x7f000001', 'hexadecimal 127.0.0.1'],
    ['0177.0.0.1', 'octal 127.0.0.1'],
    ['127.1', 'short-form 127.0.0.1'],
    ['[::ffff:127.0.0.1]', 'IPv4-mapped IPv6 loopback'],
    ['metadata.google.internal', 'metadata by name'],
    ['foo.internal', '.internal suffix'],
    ['foo.local', '.local suffix'],
  ]
  for (const [host, why] of blocked) {
    const bare = host.replace(/^\[|\]$/g, '')
    check(isBlockedHost(bare) === true, `${host} — ${why}`)
  }
  // And the thing that must still work.
  check(isBlockedHost('taylorstitch.com') === false, 'a real store is not blocked')
  check(isBlockedHost('8.8.8.8') === false, 'a public IP is not blocked')
}

console.log('\n── schemes and shapes ' + '─'.repeat(52))
{
  for (const scheme of ['file:///etc/passwd', 'ftp://x.com/a', 'gopher://x.com/', 'data:text/html,x']) {
    check(safeParseStoreUrl(scheme) === null, `${scheme.split(':')[0]}: is refused`)
  }
  check(safeParseStoreUrl('not a url') === null, 'an unparseable string is refused')
  check(safeParseStoreUrl('https://taylorstitch.com/x') !== null, 'https is accepted')
  check(safeParseStoreUrl('http://taylorstitch.com/x') !== null, 'http is accepted')

  // RECORDED, NOT CHANGED: a non-standard port on a public host is allowed
  // today. Constraining ports was not in this phase's approved scope, so the
  // behaviour is pinned here rather than silently altered.
  check(safeParseStoreUrl('https://taylorstitch.com:8080/x') !== null,
    'a non-standard port is currently ALLOWED on a public host — recorded, not changed')
  check(safeParseStoreUrl('http://127.0.0.1:8080/x') === null,
    'but a port cannot rescue a blocked host')
}

async function main() {
  // ── the first hop ─────────────────────────────────────────────────────────
  console.log('\n── a blocked destination is never requested ' + '─'.repeat(31))
  {
    for (const url of ['http://127.0.0.1/x', 'http://169.254.169.254/latest/meta-data/',
                       'file:///etc/passwd', 'http://[::1]/x']) {
      const asked = stubFetch(() => ok())
      let threw = null
      try { await safeFetch(url) } catch (e) { threw = e }
      restore()
      check(threw instanceof BlockedDestinationError, `${url} throws BlockedDestinationError`)
      check(asked.length === 0, '  and fetch was never called', `${asked.length} calls`)
    }
  }

  // ── every hop, not just the first ─────────────────────────────────────────
  console.log('\n── EACH redirect target is validated before it is followed ' + '─'.repeat(15))
  {
    // The attack: a host that passes the check redirects to the metadata service.
    const asked = stubFetch((url, _init, i) =>
      i === 0 ? redirectTo('http://169.254.169.254/latest/meta-data/') : ok('SECRET'))
    let threw = null
    try { await safeFetch('https://taylorstitch.com/start') } catch (e) { threw = e }
    restore()
    check(threw instanceof BlockedDestinationError, 'a redirect to the metadata address is blocked')
    check(asked.length === 1, 'and the second request was NEVER made', `${asked.length} request(s)`)
    check(asked[0] === 'https://taylorstitch.com/start', 'only the first hop happened')
  }
  {
    const asked = stubFetch((url, _init, i) => i === 0 ? redirectTo('http://10.0.0.5/admin') : ok())
    let threw = null
    try { await safeFetch('https://taylorstitch.com/a') } catch (e) { threw = e }
    restore()
    check(threw instanceof BlockedDestinationError, 'a redirect to a private IP is blocked')
    check(!asked.some(u => u.includes('10.0.0.5')), 'the private address was never contacted')
  }
  {
    // A relative Location must be resolved and then checked, not trusted.
    const asked = stubFetch((url, _init, i) => i === 0 ? redirectTo('/next') : ok('arrived'))
    const res = await safeFetch('https://taylorstitch.com/a')
    restore()
    check(res.status === 200, 'a relative redirect on an allowed host is followed')
    check(asked[1] === 'https://taylorstitch.com/next', 'resolved against the hop it came from', asked[1])
  }
  {
    // An unregistered but public host is allowed by safeFetch — keeping the
    // brand allowlist is the ROUTE's job, and product-images does it.
    const asked = stubFetch((url, _init, i) => i === 0 ? redirectTo('https://example.com/x') : ok())
    const res = await safeFetch('https://taylorstitch.com/a')
    restore()
    check(res.status === 200, 'a redirect to another PUBLIC host is followed by safeFetch')
    check(asked.length === 2, 'the destination policy here is "not internal", not "registered"')
  }

  console.log('\n── loops and limits ' + '─'.repeat(54))
  {
    const asked = stubFetch(() => redirectTo('https://taylorstitch.com/loop'))
    let threw = null
    try { await safeFetch('https://taylorstitch.com/loop') } catch (e) { threw = e }
    restore()
    check(threw instanceof BlockedDestinationError, 'a self-redirect is caught as a loop')
    check(/loop/.test(threw.message), 'and says so', JSON.stringify(threw.message))
    check(asked.length <= 2, 'without walking the chain', `${asked.length} request(s)`)
  }
  {
    let n = 0
    const asked = stubFetch(() => redirectTo(`https://taylorstitch.com/hop${++n}`))
    let threw = null
    try { await safeFetch('https://taylorstitch.com/start') } catch (e) { threw = e }
    restore()
    check(threw instanceof BlockedDestinationError, 'a long chain stops')
    check(asked.length === 4, 'after the initial request and three hops', `${asked.length} requests`)
  }
  {
    const asked = stubFetch((url, _init, i) => i < 2 ? redirectTo(`https://taylorstitch.com/h${i}`) : ok('done'))
    const res = await safeFetch('https://taylorstitch.com/s')
    restore()
    check(res.status === 200 && (await res.text()) === 'done', 'a normal two-hop redirect still works')
    check(asked.length === 3, 'three requests, as expected', `${asked.length}`)
  }

  console.log('\n── credentials do not cross a host boundary ' + '─'.repeat(31))
  {
    const seen = []
    global.fetch = async (url, init) => {
      seen.push({ url: String(url), auth: new Headers(init.headers).get('authorization') })
      return seen.length === 1 ? redirectTo('https://example.com/x') : ok()
    }
    await safeFetch('https://taylorstitch.com/a', { headers: { Authorization: 'Bearer secret' } })
    restore()
    check(seen[0].auth === 'Bearer secret', 'the header is sent to the host it was meant for')
    check(seen[1].auth === null, 'and dropped when the host changes', JSON.stringify(seen[1].auth))
  }
  {
    const seen = []
    global.fetch = async (url, init) => {
      seen.push(new Headers(init.headers).get('authorization'))
      return seen.length === 1 ? redirectTo('https://taylorstitch.com/b') : ok()
    }
    await safeFetch('https://taylorstitch.com/a', { headers: { Authorization: 'Bearer secret' } })
    restore()
    check(seen[1] === 'Bearer secret', 'but it survives a redirect within the SAME host')
  }

  // ── every credential, and the origin, not just the host ───────────────────
  // Authorization was the only header this dropped, and the only thing it
  // compared was the hostname. A cookie is a credential, an API key is a
  // credential, and https://x → http://x is the same hostname carrying them
  // in the clear.
  const CREDS = {
    authorization: 'Bearer SECRET-TOKEN',
    cookie: 'session=SECRET-COOKIE',
    'proxy-authorization': 'Basic SECRET-PROXY',
    'x-api-key': 'SECRET-APIKEY',
  }
  /** Run one redirect and report the headers each hop was sent. */
  const hops = async (from, to, init = {}) => {
    const seen = []
    global.fetch = async (url, i) => {
      seen.push(Object.fromEntries([...new Headers(i.headers).entries()]))
      return seen.length === 1 ? redirectTo(to) : ok()
    }
    let threw = null
    try { await safeFetch(from, init) } catch (e) { threw = e }
    restore()
    return { seen, threw }
  }

  console.log('\n── and neither does any other credential ' + '─'.repeat(34))
  {
    const { seen } = await hops('https://taylorstitch.com/a', 'https://example.com/x', { headers: { ...CREDS } })
    for (const k of Object.keys(CREDS)) {
      check(seen[0][k] === CREDS[k], `${k} is sent to the host it was meant for`)
      check(seen[1][k] === undefined, `  and dropped when the origin changes`, seen[1][k] ?? 'absent')
    }
  }
  {
    // Same origin: every one of them must survive, or this breaks real callers.
    const { seen } = await hops('https://taylorstitch.com/a', 'https://taylorstitch.com/b', { headers: { ...CREDS } })
    for (const k of Object.keys(CREDS)) {
      check(seen[1][k] === CREDS[k], `${k} survives a redirect within the same origin`)
    }
  }
  {
    // A scheme downgrade keeps the hostname and loses the encryption, which is
    // exactly when a credential must not travel.
    const { seen } = await hops('https://taylorstitch.com/a', 'http://taylorstitch.com/b', { headers: { ...CREDS } })
    check(seen[1].authorization === undefined, 'https → http is an origin change, so the credential is dropped',
      seen[1].authorization ?? 'absent')
    check(seen[1].cookie === undefined, '  and so is the cookie')
  }
  {
    const { seen } = await hops('https://taylorstitch.com/a', 'https://taylorstitch.com:8443/b', { headers: { ...CREDS } })
    check(seen[1].authorization === undefined, 'a port change is an origin change too', seen[1].authorization ?? 'absent')
  }
  {
    // The benign headers real callers depend on must be untouched — sizeguide
    // and shipping send browser-shaped headers to get past bot rules.
    const benign = {
      'user-agent': 'Mozilla/5.0', accept: 'text/html', 'accept-language': 'en-US',
      'accept-encoding': 'gzip', 'cache-control': 'no-cache', 'sec-fetch-mode': 'navigate',
    }
    const { seen } = await hops('https://taylorstitch.com/a', 'https://example.com/x', { headers: benign })
    for (const k of Object.keys(benign)) check(seen[1][k] === benign[k], `${k} is not a credential and is kept`)
  }

  // ── what a redirect does to the method and the body ───────────────────────
  // Before safeFetch took the redirect loop over, these routes used native
  // fetch, which downgrades POST to GET on 301/302/303 and drops the body.
  // safeFetch replayed everything on every status, to every host. 307/308 keep
  // the method by design, so a body-bearing one is refused across an origin
  // rather than silently sent somewhere the caller never named.
  console.log('\n── a redirect must not replay a POST it was never given ' + '─'.repeat(19))
  {
    const post = () => ({ method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', secret: 'payload' }),
                          headers: { 'Content-Type': 'application/json' } })
    const detail = async (to, status) => {
      const seen = []
      global.fetch = async (url, i) => {
        seen.push({ method: i.method || 'GET', body: i.body ?? null,
                    ct: new Headers(i.headers).get('content-type'),
                    cl: new Headers(i.headers).get('content-length') })
        return seen.length === 1 ? redirectTo(to, status) : ok()
      }
      let threw = null
      try { await safeFetch('https://taylorstitch.com/api/mcp', post()) } catch (e) { threw = e }
      restore()
      return { seen, threw }
    }

    for (const status of [301, 302, 303]) {
      const { seen } = await detail('https://example.com/x', status)
      check(seen[1] && seen[1].method === 'GET', `${status} turns a POST into a GET`, seen[1] && seen[1].method)
      check(seen[1] && seen[1].body === null, `  and drops the body`, seen[1] && (seen[1].body ?? 'none'))
      check(seen[1] && seen[1].ct === null && seen[1].cl === null,
        `  along with content-type and content-length`, seen[1] && `ct=${seen[1].ct} cl=${seen[1].cl}`)
    }
    for (const status of [301, 302, 303]) {
      const { seen } = await detail('https://taylorstitch.com/b', status)
      check(seen[1] && seen[1].method === 'GET', `${status} does the same within one origin — it is the method that changes, not the host`)
    }

    for (const status of [307, 308]) {
      const { seen, threw } = await detail('https://example.com/x', status)
      check(threw instanceof BlockedDestinationError, `${status} across an origin is refused`, threw && threw.constructor.name)
      check(seen.length === 1, `  and the second host is never contacted`, `${seen.length} request(s)`)
    }
    for (const status of [307, 308]) {
      const { seen } = await detail('https://taylorstitch.com/b', status)
      check(seen[1] && seen[1].method === 'POST' && seen[1].body !== null,
        `${status} within one origin keeps the method and the body, as the status means`)
    }

    // A GET is untouched by any of this.
    for (const status of [301, 302, 303, 307, 308]) {
      const seen = []
      global.fetch = async (url, i) => {
        seen.push(i.method || 'GET')
        return seen.length === 1 ? redirectTo('https://taylorstitch.com/b', status) : ok()
      }
      await safeFetch('https://taylorstitch.com/a')
      restore()
      check(seen[1] === 'GET' || seen[1] === undefined, `a plain GET is unchanged by ${status}`)
    }

    // ── and the refusal is about the BODY, not about 307 ──────────────────
    // 307 and 308 are refused across an origin because they mean "resend
    // exactly what you sent", and what was sent had a body. A GET has no body
    // to resend, and the credential policy above has already taken the
    // headers off — so refusing one would cost a legitimate store redirect and
    // buy nothing. It follows, like any other GET.
    for (const method of ['GET', 'HEAD']) {
      for (const status of [307, 308]) {
        const seen = []
        global.fetch = async (url, i) => {
          seen.push({ url: String(url), method: i.method || 'GET', body: i.body ?? null })
          return seen.length === 1 ? redirectTo('https://example.com/x', status) : ok('arrived')
        }
        let threw = null
        try { await safeFetch('https://taylorstitch.com/a', { method }) } catch (e) { threw = e }
        restore()
        check(threw === null, `${method} + cross-origin ${status} is followed, not refused`,
          threw ? threw.constructor.name : 'no throw')
        check(seen.length === 2 && seen[1].url === 'https://example.com/x',
          `  it reaches the validated destination`, `${seen.length} request(s)`)
        check(seen.length === 2 && seen[1].method === method,
          `  keeping ${method}, as ${status} means`, seen[1] && seen[1].method)
        check(seen.length === 2 && seen[1].body === null, `  and still carrying no body`)
      }
    }
    {
      // The destination is still validated: a cross-origin 307 to a blocked
      // address is refused for being blocked, not for being a 307.
      const asked = stubFetch((u, i, n) => n === 0
        ? redirectTo('http://169.254.169.254/latest/meta-data/', 307) : ok('SECRET'))
      let threw = null
      try { await safeFetch('https://taylorstitch.com/a', { method: 'GET' }) } catch (e) { threw = e }
      restore()
      check(threw instanceof BlockedDestinationError, 'a GET 307 toward the metadata address is still blocked')
      check(asked.length === 1, '  and that address is never contacted', `${asked.length} request(s)`)
    }
    {
      // Any other body-bearing method is refused exactly like POST.
      for (const method of ['PUT', 'PATCH', 'DELETE']) {
        const seen = []
        global.fetch = async (url, i) => {
          seen.push(String(url))
          return seen.length === 1 ? redirectTo('https://example.com/x', 307) : ok()
        }
        let threw = null
        try { await safeFetch('https://taylorstitch.com/a', { method, body: '{"x":1}' }) } catch (e) { threw = e }
        restore()
        check(threw instanceof BlockedDestinationError, `${method} + cross-origin 307 is refused too`,
          threw ? threw.constructor.name : 'NOT REFUSED')
        check(seen.length === 1, `  and the second host is never contacted`, `${seen.length} request(s)`)
      }
    }
  }

  // ── the hops we do not read ───────────────────────────────────────────────
  console.log('\n── a redirect body is let go of, not left holding ' + '─'.repeat(25))
  {
    let cancelled = 0, pulled = 0
    const hopBody = () => new ReadableStream({
      pull(c) { pulled++; c.enqueue(new Uint8Array(1024)); if (pulled > 3) c.close() },
      cancel() { cancelled++ },
    })
    let n = 0
    global.fetch = async () => (++n <= 2)
      ? new Response(hopBody(), { status: 302, headers: { location: `https://taylorstitch.com/h${n}` } })
      : ok('done')
    const res = await safeFetch('https://taylorstitch.com/a')
    restore()
    check((await res.text()) === 'done', 'the chain still resolves')
    check(cancelled === 2, 'and each redirect body it walked past was cancelled', `${cancelled} of 2`)
    // A ReadableStream pulls once on construction, before anyone reads it, so
    // one chunk per hop is the floor rather than evidence of anything. What
    // this rules out is DRAINING: reading a redirect body to completion would
    // be four pulls a hop, not one.
    check(pulled <= 2, '  and none of them was drained', `${pulled} chunk(s) pulled, floor is 2`)
  }

  // ── what the returned Response says about itself ──────────────────────────
  console.log('\n── the reconstructed response describes the bytes it carries ' + '─'.repeat(13))
  {
    global.fetch = async () => new Response('hello world', { status: 200, headers: {
      'content-length': '999999', 'content-encoding': 'gzip', 'content-range': 'bytes 0-10/999999',
      'content-type': 'application/json', 'set-cookie': 'a=b' } })
    const res = await safeFetch('https://taylorstitch.com/x')
    restore()
    const body = await res.text()
    check(body === 'hello world', 'the body is byte-identical', JSON.stringify(body))
    check(res.headers.get('content-length') === null, 'content-length is gone — it described the wire, not this')
    check(res.headers.get('content-encoding') === null, 'content-encoding is gone — these bytes are already decoded')
    check(res.headers.get('content-range') === null, 'content-range is gone for the same reason')
    check(res.headers.get('content-type') === 'application/json', 'content-type is kept — it still describes the bytes')
    check(res.headers.get('set-cookie') === 'a=b', 'and set-cookie is left exactly as it was')
    check(res.status === 200, 'status is unchanged')
  }

  // ── the cap cannot be argued away ─────────────────────────────────────────
  console.log('\n── a caller cannot opt out of the size cap ' + '─'.repeat(32))
  {
    const CHUNK = 64 * 1024
    const flood = () => { let n = 0; return new ReadableStream({ pull(c) { n++; c.enqueue(new Uint8Array(CHUNK)); if (n > 400) c.close() } }) }
    const attempt = async (opts) => {
      global.fetch = async () => new Response(flood(), { status: 200 })
      try { const r = await safeFetch('https://taylorstitch.com/x', {}, opts); const n = (await r.arrayBuffer()).byteLength; restore(); return n }
      catch (e) { restore(); return e.constructor.name }
    }
    const TWO_MB = 2 * 1024 * 1024
    for (const [label, opts] of [
      ['omitted', {}], ['Infinity', { maxBytes: Infinity }], ['NaN', { maxBytes: NaN }],
      ['zero', { maxBytes: 0 }], ['negative', { maxBytes: -1 }],
    ]) {
      const r = await attempt(opts)
      check(r === 'ResponseTooLargeError', `${label} falls back to the 2MB default and refuses the flood`, String(r))
    }
    {
      // A finite value a caller genuinely chose is still honoured — palette
      // asks for 5MB and must keep getting it.
      let pulled = 0
      global.fetch = async () => new Response(new ReadableStream({
        pull(c) { pulled++; c.enqueue(new Uint8Array(CHUNK)); if (pulled > 400) c.close() } }), { status: 200 })
      let threw = null
      try { await safeFetch('https://taylorstitch.com/x', {}, { maxBytes: 5 * 1024 * 1024 }) } catch (e) { threw = e }
      restore()
      check(threw instanceof ResponseTooLargeError, 'an explicit 5MB cap is still the cap that applies')
      check(pulled > TWO_MB / CHUNK, '  and it let more through than the default would have', `${pulled} chunks`)
    }
  }

  // ── the body is bounded as it arrives ─────────────────────────────────────
  console.log('\n── the reader stops; it does not measure afterwards ' + '─'.repeat(23))
  {
    const counter = { pulled: 0 }
    const CHUNK = 64 * 1024
    const CHUNKS = 200                       // 12.8 MB if it were all read
    global.fetch = async () => new Response(chunkedBody(CHUNK, CHUNKS, counter), { status: 200 })
    let threw = null
    try { await safeFetch('https://taylorstitch.com/big', {}, { maxBytes: 256 * 1024 }) }
    catch (e) { threw = e }
    restore()

    check(threw instanceof ResponseTooLargeError, 'an oversized body throws')
    check(counter.pulled <= 6, 'THE STREAM WAS ABANDONED EARLY — a few chunks, not two hundred',
      `${counter.pulled} of ${CHUNKS} chunks pulled`)
    check(counter.pulled * CHUNK < 1024 * 1024,
      'so the process never held the oversized body', `${Math.round(counter.pulled * CHUNK / 1024)}KB touched`)
    check(threw.limit === 256 * 1024, 'and the error carries the limit it hit', threw.limit)
  }
  {
    // Fails closed: no truncated document is handed back as if it were whole.
    global.fetch = async () => new Response('x'.repeat(5000), { status: 200 })
    let threw = null, res = null
    try { res = await safeFetch('https://taylorstitch.com/x', {}, { maxBytes: 1000 }) }
    catch (e) { threw = e }
    restore()
    check(res === null, 'nothing is returned when the cap is exceeded')
    check(threw instanceof ResponseTooLargeError, 'the caller gets an error, never a partial body')
  }
  {
    global.fetch = async () => new Response('x'.repeat(900), { status: 200 })
    const res = await safeFetch('https://taylorstitch.com/x', {}, { maxBytes: 1000 })
    restore()
    check((await res.text()).length === 900, 'a body under the cap is returned whole')
  }

  console.log('\n── timeouts and ordinary requests ' + '─'.repeat(40))
  {
    // The caller's signal is passed through untouched — the routes each set
    // their own AbortController, and that behaviour is unchanged.
    let sawSignal = false
    global.fetch = async (_url, init) => { sawSignal = !!init.signal; return ok() }
    const c = new AbortController()
    await safeFetch('https://taylorstitch.com/x', { signal: c.signal })
    restore()
    check(sawSignal, 'the caller\'s abort signal reaches fetch')

    global.fetch = async () => { throw new Error('The operation was aborted') }
    let threw = null
    try { await safeFetch('https://taylorstitch.com/x') } catch (e) { threw = e }
    restore()
    check(threw instanceof Error && !(threw instanceof BlockedDestinationError),
      'a timeout surfaces as an ordinary error, as before', threw && threw.message)
  }
  {
    const asked = stubFetch(() => ok('{"products":[]}'))
    const res = await safeFetch('https://taylorstitch.com/api/mcp', { method: 'POST', body: '{}' })
    restore()
    check(res.status === 200, 'a normal store request still succeeds')
    check(JSON.parse(await res.text()).products.length === 0, 'and its body parses exactly as before')
    check(asked.length === 1, 'in one request', `${asked.length}`)
  }

  // ── the registry check the route now makes ────────────────────────────────
  console.log('\n── product-images may only reach a brand we carry ' + '─'.repeat(25))
  {
    const S = build('lib/stores.ts', 'ssrf-stores')
    const has = (d) => S.UCP_REGISTRY.some(s => s.domain.toLowerCase().trim() === d)
    check(has('taylorstitch.com'), 'a registry domain is recognised')
    check(!has('example.com'), 'and an unregistered one is not')
    check(!has('169.254.169.254'), 'nor is the metadata address')

    const src = fs.readFileSync(path.join(WEB, 'app/api/product-images/route.ts'), 'utf8')
    check(/function isRegisteredStore/.test(src), 'the route defines the check')
    check(/if \(!isRegisteredStore\(parsed\.hostname\)\)/.test(src), 'and applies it to the caller\'s hostname')
    check(/safeFetch\(`https:\/\/\$\{domain\}\/api\/mcp`/.test(src), 'the MCP call goes through safeFetch')
    check(!/await fetch\(/.test(src), 'and no bare fetch remains in the route')
  }
  {
    for (const f of ['app/api/sizeguide/route.ts', 'app/api/shipping/route.ts']) {
      const src = fs.readFileSync(path.join(WEB, f), 'utf8')
      check(!/await fetch\(/.test(src), `${f.split('/').slice(-2)[0]} has no bare fetch left`)
      check(/safeFetch\(/.test(src), `  and does use safeFetch`)
    }
  }


  // ── the bypasses closed in P4a ────────────────────────────────────────────
  console.log('\n── three ways the predicate used to be walked past ' + '─'.repeat(24))
  {
    // Each of these was ALLOWED before P4a — verified by rebuilding the previous
    // ssrfGuard and running these same assertions against it, where all eight
    // failed. They are grouped here so a regression is obvious rather than
    // buried among the cases that always passed.
    const closed = [
      ['http://[::ffff:7f00:1]/x', 'IPv4-mapped IPv6 in hex — what new URL() normalises [::ffff:127.0.0.1] into'],
      ['http://[::ffff:7f00:0001]/x', 'the same address zero-padded'],
      ['http://[::ffff:127.0.0.1]/x', 'and the dotted form it started as'],
      ['http://localhost./x', 'localhost with the DNS root dot'],
      ['http://foo.internal./x', '.internal with the root dot'],
      ['http://foo.local./x', '.local with the root dot'],
      ['http://[64:ff9b::7f00:1]/x', 'NAT64 well-known prefix carrying loopback'],
      ['http://[64:ff9b::127.0.0.1]/x', 'NAT64 in dotted form'],
    ]
    for (const [url, why] of closed) {
      check(safeParseStoreUrl(url) === null, `${url} — ${why}`)
    }

    // As a direct request: never contacted.
    for (const [url] of closed) {
      const asked = stubFetch(() => ok('SECRET'))
      let threw = null
      try { await safeFetch(url) } catch (e) { threw = e }
      restore()
      check(threw instanceof BlockedDestinationError && asked.length === 0,
        `  direct request to ${url} is refused and never sent`, `${asked.length} requests`)
    }

    // As a redirect target: the second hop is never made.
    for (const [url] of closed) {
      const asked = stubFetch((_u, _i, n) => n === 0 ? redirectTo(url) : ok('SECRET'))
      let threw = null
      try { await safeFetch('https://taylorstitch.com/start') } catch (e) { threw = e }
      restore()
      check(threw instanceof BlockedDestinationError, `  redirect to ${url} is blocked`)
      check(asked.length === 1, '    and the blocked destination was never contacted', `${asked.length} request(s)`)
    }
  }

  console.log('\n── and the addresses that merely look similar ' + '─'.repeat(28))
  {
    // 2001:db8::7f00:1 ends in the same 32 bits as loopback and is an ordinary
    // address. Blocking it would be a bug, so the prefix check is narrow.
    for (const url of ['http://[2001:db8::7f00:1]/', 'http://[2606:4700::1111]/',
                       'http://[64:ff9b::8.8.8.8]/', 'http://[::ffff:8.8.8.8]/',
                       'https://sub.example.co.uk/', 'https://example.com./']) {
      check(safeParseStoreUrl(url) !== null, `${url} is still allowed`)
    }
  }

  // ── the destination allowlist on the two open routes ──────────────────────
  console.log('\n── sizeguide and shipping may only reach a brand we carry ' + '─'.repeat(16))
  {
    const S = build('lib/stores.ts', 'ssrf-stores-2')
    const registered = (d) => S.UCP_REGISTRY.some(s => s.domain.toLowerCase().trim() === d)
    check(registered('taylorstitch.com'), 'a registry domain is recognised')
    check(!registered('example.com'), 'an unregistered public host is not')
    check(!registered('taylorstitch.com.evil.com'), 'nor a suffix-confusion attempt')

    for (const f of ['app/api/sizeguide/route.ts', 'app/api/shipping/route.ts']) {
      const name = f.split('/').slice(-2)[0]
      const src = fs.readFileSync(path.join(WEB, f), 'utf8')
      check(/function isRegisteredStore/.test(src), `${name} defines the registry check`)
      check(/if \(!isRegisteredStore\(parsed\.hostname\)\)/.test(src),
        `  and applies it to the caller's hostname before fetching`)
      check(/from '@\/lib\/stores'/.test(src), '  using UCP_REGISTRY, not a second allowlist')
      check(!/await fetch\(/.test(src), '  with no bare fetch remaining')
    }
  }


  // ── the palette fetch ─────────────────────────────────────────────────────
  console.log('\n── the colour read, which anyone could aim ' + '─'.repeat(31))
  {
    // paletteOf reads four colours off a product photograph. The URL reaches it
    // from a store's catalogue AND — through /api/style-with, which takes
    // `product` straight out of an unauthenticated request body — from anyone
    // at all. Before P4b-1 it was a bare fetch: no guard, redirects followed,
    // arrayBuffer() unbounded. Every case below was REQUESTED by the previous
    // implementation; that was verified by running these same assertions
    // against it.
    const P = build('lib/fashion/palette.ts', 'palette-guarded')

    const attacker = [
      ['http://127.0.0.1/x.jpg', 'loopback'],
      ['http://10.0.0.5/x.jpg', 'private 10/8'],
      ['http://169.254.169.254/latest/meta-data/', 'cloud metadata'],
      ['http://[::ffff:7f00:1]/x.jpg', 'IPv4-mapped IPv6 loopback'],
      ['http://localhost./x.jpg', 'localhost with the root dot'],
    ]
    for (const [url, why] of attacker) {
      const asked = stubFetch(() => ok('bytes'))
      const pal = await P.paletteOf(url, 2000)
      restore()
      check(asked.length === 0, `${why} is never requested`, `${asked.length} requests`)
      check(pal === null, '  and the caller gets null, exactly as for an unreadable image')
    }

    // A redirect away from a legitimate CDN must not be followed.
    {
      const asked = stubFetch((_u, _i, n) =>
        n === 0 ? redirectTo('http://169.254.169.254/latest/meta-data/') : ok('SECRET'))
      const pal = await P.paletteOf('https://cdn.shopify.com/s/files/x.jpg', 2000)
      restore()
      check(asked.length === 1, 'a redirect to the metadata address is never contacted', `${asked.length} request(s)`)
      check(pal === null, '  and the read fails closed')
    }

    // An oversized image is abandoned mid-stream, not measured afterwards.
    {
      const counter = { pulled: 0 }
      const CHUNK = 256 * 1024
      global.fetch = async () => new Response(chunkedBody(CHUNK, 200, counter), { status: 200 })
      const pal = await P.paletteOf('https://cdn.shopify.com/s/files/huge.jpg', 4000)
      restore()
      check(pal === null, 'an oversized image yields null')
      check(counter.pulled <= 24, '  and the stream stopped early rather than buffering 50MB',
        `${counter.pulled} of 200 chunks (${Math.round(counter.pulled * CHUNK / 1024 / 1024)}MB touched)`)
    }
  }

  console.log('\n── and the images that must still work ' + '─'.repeat(35))
  {
    const P = build('lib/fashion/palette.ts', 'palette-guarded')

    // A real PNG, so the decode path runs for real rather than being stubbed —
    // and a big enough one to mean something. The 1x1 fixture this would
    // otherwise reach for decodes fine and yields nothing: paletteOf resizes to
    // 48x48 and then reads only the central band (0.22..0.78 of each axis),
    // which on a 1x1 image is empty. 128x128 in two colours is the smallest
    // fixture that actually exercises the crop and the quantiser.
    const sharp = require(path.join(WEB, 'node_modules/sharp'))
    const raw = Buffer.alloc(128 * 128 * 3)
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
      const i = (y * 128 + x) * 3
      const left = x < 64
      raw[i] = left ? 0xc8 : 0x20
      raw[i + 1] = left ? 0x50 : 0x60
      raw[i + 2] = left ? 0x3c : 0xa0
    }
    const PNG = await sharp(raw, { raw: { width: 128, height: 128, channels: 3 } }).png().toBuffer()
    {
      const asked = stubFetch(() => new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } }))
      const pal = await P.paletteOf('https://cdn.shopify.com/s/files/real.png', 4000)
      restore()
      check(asked.length === 1, 'a legitimate CDN image is fetched')
      check(pal !== null && Array.isArray(pal.colours), '  and still yields a Palette',
        pal ? `${pal.colours.length} colours` : 'null')
    }
    {
      // A multi-MB original from a CDN nothing rewrites — the case a 2MB cap
      // would have broken, which is why the cap here is explicit.
      const big = Buffer.concat([PNG, Buffer.alloc(3 * 1024 * 1024)])
      const asked = stubFetch(() => new Response(big, { status: 200 }))
      await P.paletteOf('https://images.example-cdn.net/original.png', 4000)
      restore()
      check(asked.length === 1, 'a 3MB original from a non-Shopify CDN is still fetched, not rejected')
    }
    {
      const asked = stubFetch(() => ok('this is not an image'))
      const pal = await P.paletteOf('https://cdn.shopify.com/s/files/notanimage.jpg', 4000)
      restore()
      check(asked.length === 1 && pal === null, 'non-image bytes still yield null, as before')
    }
    {
      // small() must still narrow a Shopify URL and leave everything else alone.
      let sent = null
      global.fetch = async (u) => { sent = String(u); return new Response(PNG, { status: 200 }) }
      await P.paletteOf('https://cdn.shopify.com/s/files/x.jpg?width=400', 4000)
      restore()
      check(sent === 'https://cdn.shopify.com/s/files/x.jpg?width=64',
        'small() still rewrites a Shopify URL to width=64', sent)

      global.fetch = async (u) => { sent = String(u); return new Response(PNG, { status: 200 }) }
      await P.paletteOf('https://images.example-cdn.net/photo.jpg', 4000)
      restore()
      check(sent === 'https://images.example-cdn.net/photo.jpg',
        'and leaves a non-Shopify URL untouched', sent)
    }
    {
      // The 6s default is preserved: the caller's signal still reaches fetch.
      let signalled = false
      global.fetch = async (_u, init) => { signalled = !!init.signal; return new Response(PNG, { status: 200 }) }
      await P.paletteOf('https://cdn.shopify.com/s/files/x.jpg')
      restore()
      check(signalled, 'the abort signal still reaches the fetch')
      const src = fs.readFileSync(path.join(WEB, 'lib/fashion/palette.ts'), 'utf8')
      check(/timeoutMs = 6000/.test(src), 'and the 6-second default is unchanged')
      check(/AbortSignal\.timeout\(timeoutMs\)/.test(src), 'wired the same way as before')
    }
  }

  console.log('\n── the bytes that arrive small and decode enormous ' + '─'.repeat(23))
  {
    const P = build('lib/fashion/palette.ts', 'palette-guarded')
    const sharp = require(path.join(WEB, 'node_modules/sharp'))

    /** A PNG that declares w*h but carries almost nothing.
     *
     *  The transfer cap counts bytes on the wire; a decoder counts the pixels
     *  the HEADER claims. Adam7 interlacing is what turns the gap into a
     *  weapon — libvips streams an ordinary PNG and shrinks it on load, but an
     *  interlaced one has to be materialised whole before anything can be
     *  resized. All-zero scanlines deflate to nothing, so the file stays tiny. */
    const interlaced = (w, h) => {
      const table = []
      for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0 }
      const crc = b => { let r = 0xffffffff; for (const x of b) r = table[(r ^ x) & 0xff] ^ (r >>> 8); return (r ^ 0xffffffff) >>> 0 }
      const chunk = (type, data) => {
        const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
        const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
        const c = Buffer.alloc(4); c.writeUInt32BE(crc(td))
        return Buffer.concat([len, td, c])
      }
      const ihdr = Buffer.alloc(13)
      ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
      ihdr[8] = 8; ihdr[9] = 6; ihdr[12] = 1        // 8-bit RGBA, Adam7
      let raw = 0
      const xo = [0, 4, 0, 2, 0, 1, 0], yo = [0, 0, 4, 0, 2, 0, 1]
      const xs = [8, 8, 4, 4, 2, 2, 1], ys = [8, 8, 8, 4, 4, 2, 2]
      for (let p = 0; p < 7; p++) {
        const pw = Math.ceil((w - xo[p]) / xs[p]), ph = Math.ceil((h - yo[p]) / ys[p])
        if (pw > 0 && ph > 0) raw += ph * (1 + pw * 4)
      }
      return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.alloc(raw), { level: 9 })), chunk('IEND', Buffer.alloc(0)),
      ])
    }

    /** The half-and-half fixture above, at any size. Corners that disagree, so
     *  the backdrop heuristic drops nothing and a real Palette comes out. */
    const shot = (w, h) => {
      const px = Buffer.alloc(w * h * 3)
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 3, left = x < w / 2
        px[i] = left ? 0xc8 : 0x20
        px[i + 1] = left ? 0x50 : 0x60
        px[i + 2] = left ? 0x3c : 0xa0
      }
      return sharp(px, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer()
    }

    {
      const bomb = interlaced(12000, 12000)     // 144 MP declared
      check(bomb.length < 5 * 1024 * 1024,
        'the bomb passes the byte cap — so the byte cap is not what stops it',
        `${(bomb.length / 1048576).toFixed(2)}MB of a 5MB allowance`)
      const asked = stubFetch(() => new Response(bomb, { status: 200, headers: { 'content-type': 'image/png' } }))
      let threw = null
      let pal
      try { pal = await P.paletteOf('https://images.example-cdn.net/bomb.png', 8000) } catch (e) { threw = e }
      restore()
      check(asked.length === 1, '  it is fetched, as any image would be')
      check(threw === null, '  and no exception escapes to the caller', threw ? String(threw) : 'none')
      check(pal === null, '  the caller gets null, exactly as for an unreadable image')
    }

    // THE BOUND ITSELF, from both sides. This is the load-bearing pair: before
    // the limit existed the 25MP image decoded happily and returned a Palette,
    // so an assertion that only checked the bomb would have passed against the
    // vulnerable code too — the bomb returns null either way, just 660MB later.
    {
      const at = await shot(6000, 4000)         // 24.0 MP — exactly the ceiling
      stubFetch(() => new Response(at, { status: 200, headers: { 'content-type': 'image/png' } }))
      const palAt = await P.paletteOf('https://images.example-cdn.net/at.png', 8000)
      restore()
      check(palAt !== null && Array.isArray(palAt.colours),
        'a 6000x4000 original — 24.0 MP, a full-frame camera file — still reads',
        palAt ? `${palAt.colours.length} colours` : 'null')

      const over = await shot(5000, 5000)       // 25.0 MP — one megapixel past it
      stubFetch(() => new Response(over, { status: 200, headers: { 'content-type': 'image/png' } }))
      const palOver = await P.paletteOf('https://images.example-cdn.net/over.png', 8000)
      restore()
      check(palOver === null,
        '  and 5000x5000 — 25.0 MP, one past the ceiling — is refused',
        palOver ? 'RETURNED A PALETTE (the bound is not being applied)' : 'null')
    }

    // Nothing legitimate moved. These are the exact fixtures and the exact
    // values the section above produces, compared as text.
    {
      const same = async (w, h, label, expected) => {
        const png = await shot(w, h)
        stubFetch(() => new Response(png, { status: 200, headers: { 'content-type': 'image/png' } }))
        const pal = await P.paletteOf('https://images.example-cdn.net/x.png', 8000)
        restore()
        check(JSON.stringify(pal) === expected, label, JSON.stringify(pal))
      }
      const BLUE = '{"colours":[{"r":33,"g":96,"b":160}],"families":["cool"],"variety":1,"plain":true}'
      await same(128, 128, 'the 128x128 fixture is byte-identical to before the bound', BLUE)
      await same(2048, 2048, 'so is a 2048px shot — the widest this app ever asks for', BLUE)
      await same(4000, 4000, 'so is a 16MP original', BLUE)
    }

    {
      const src = fs.readFileSync(path.join(WEB, 'lib/fashion/palette.ts'), 'utf8')
      check(/limitInputPixels:\s*MAX_IMAGE_PIXELS/.test(src), 'the bound is wired into the decode itself')
      check(/const MAX_IMAGE_PIXELS = 24_000_000/.test(src), '  and it is 24 megapixels, stated once')
      check(/const MAX_IMAGE_BYTES = 5 \* 1024 \* 1024/.test(src), '  the transfer cap is untouched beside it')
    }

    // Supporting evidence, not the assertion. Peak RSS is a real number but a
    // noisy one, so the threshold sits nowhere near either side: the same
    // fixture measured 660MB before the bound and 81MB after.
    {
      const bomb = interlaced(12000, 12000)
      const bombPath = path.join(WEB, '.vt', 'bomb.png')
      fs.writeFileSync(bombPath, bomb)
      const child = `
        const P = require(${JSON.stringify(path.join(WEB, '.vt', 'palette-guarded.cjs'))})
        const fs = require('fs')
        const b = fs.readFileSync(${JSON.stringify(bombPath)})
        global.fetch = async () => new Response(b, { status: 200 })
        P.paletteOf('https://images.example-cdn.net/bomb.png', 8000).then(() => {
          const m = fs.readFileSync('/proc/self/status', 'utf8').match(/VmHWM:\\s+(\\d+) kB/)
          process.stdout.write(m ? String(Math.round(m[1] / 1024)) : 'NA')
        })`
      let mb = NaN
      try { mb = Number(execFileSync(process.execPath, ['-e', child], { encoding: 'utf8' }).trim()) } catch { /* reported below */ }
      check(Number.isFinite(mb) && mb < 250,
        'and decoding it never allocates the raster', `peak RSS ${Number.isFinite(mb) ? mb + 'MB' : 'unavailable'} (was 660MB)`)
    }
  }

  console.log('\n' + (bad === 0
    ? 'every hop is checked before it is followed, and the body stops at the cap'
    : `${bad} FAILED`))
  process.exit(bad === 0 ? 0 : 1)
}

main().catch(e => { restore(); console.error(e); process.exit(1) })
