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

  console.log('\n' + (bad === 0
    ? 'every hop is checked before it is followed, and the body stops at the cap'
    : `${bad} FAILED`))
  process.exit(bad === 0 ? 0 : 1)
}

main().catch(e => { restore(); console.error(e); process.exit(1) })
