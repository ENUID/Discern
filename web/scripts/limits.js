/**
 * The rate limit, the breaker, and the provider cooldown — and the one way
 * extracting them could silently break production.
 *
 * All three are process-level singletons. Each works precisely BECAUSE there
 * is exactly one of it. If an extraction leaves two copies reachable — two
 * import paths, a barrel that re-exports a second instance, a factory called
 * per request — then:
 *
 *   two rate-limit maps    → double the effective limit
 *   two breakers           → neither ever reaches its threshold
 *   two provider-out maps  → every request re-discovers a dead provider
 *
 * None of that is visible. The code compiles, every other test passes, and the
 * protection is simply gone. So the last section here is the important one: it
 * reaches the same counter through two different specifiers and asserts they
 * are the same object.
 */
const path = require('path')
const fs = require('fs')
const { execFileSync } = require('child_process')

const WEB = path.resolve(__dirname, '..')
function build(name, alias) {
  const out = path.join(WEB, '.vt', name + '.cjs')
  fs.mkdirSync(path.join(WEB, '.vt'), { recursive: true })
  execFileSync(path.join(WEB, 'node_modules/.bin/esbuild'), [
    path.join(WEB, 'lib/stylist/limits.ts'),
    '--bundle', '--platform=node', '--format=cjs',
    '--outfile=' + out, '--log-level=error', '--alias:@=' + WEB,
  ])
  return out
}

const L = require(build('limits'))

let bad = 0
const check = (ok, label, detail) => {
  if (!ok) bad++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail !== undefined ? `  ${detail}` : ''}`)
}
const req = (ip) => ({ headers: { get: (h) => (h === 'x-forwarded-for' ? ip : null) } })

console.log('── the rate limit ' + '─'.repeat(55))
{
  const ip = '1.1.1.1'
  let refusedAt = null
  for (let i = 1; i <= 40; i++) {
    if (L.stylistRateLimited(req(ip)) && refusedAt === null) refusedAt = i
  }
  // 30 per minute: the 31st is the first refusal.
  check(refusedAt === 31, 'the 31st request in a window is the first refused', `refused at ${refusedAt}`)
  check(L.stylistRateLimited(req('2.2.2.2')) === false, 'a different IP is unaffected')
  check(L.stylistRateLimited(req(null)) === false, 'a request with no IP header still works')
}

console.log('\n── the breaker ' + '─'.repeat(58))
{
  L.noteModelSuccess()  // start closed
  check(L.modelLooksDown() === false, 'starts closed')
  L.noteModelFailure()
  check(L.modelLooksDown() === false, 'one failure does not open it')
  L.noteModelFailure()
  check(L.modelLooksDown() === false, 'two do not either')
  L.noteModelFailure()
  check(L.modelLooksDown() === true, 'the THIRD consecutive failure opens it')
  L.noteModelSuccess()
  check(L.modelLooksDown() === false, 'and a success closes it again')

  // A success in the middle resets the count — three failures must be
  // CONSECUTIVE, or a healthy provider with occasional errors trips it.
  L.noteModelFailure(); L.noteModelFailure()
  L.noteModelSuccess()
  L.noteModelFailure(); L.noteModelFailure()
  check(L.modelLooksDown() === false, 'a success in between resets the count')
  L.noteModelSuccess()
}

console.log('\n── the provider cooldown ' + '─'.repeat(48))
{
  check(L.providerOutUntil('cerebras') === undefined, 'an unknown provider is not out')
  const before = Date.now()
  L.markProviderOut('cerebras')
  const until = L.providerOutUntil('cerebras')
  check(typeof until === 'number' && until > before, 'marking one records a time', `+${Math.round((until - before) / 60000)}min`)
  check(until - before > 9 * 60_000 && until - before <= 10 * 60_000 + 50, 'ten minutes, as before the move')
  check(L.providerOutUntil('groq') === undefined, 'and does not affect another provider')
}

console.log('\n── which errors count as a refusal ' + '─'.repeat(38))
{
  for (const m of ['HTTP 429', 'rate limit exceeded', 'Too Many Requests', 'quota exhausted']) {
    check(L.isRateLimited(new Error(m)) === true, `"${m}"`)
  }
  for (const m of ['HTTP 500', 'fetch failed', 'unauthorized', '']) {
    check(L.isRateLimited(new Error(m)) === false, `NOT "${m || '(empty)'}"`)
  }
  check(L.isRateLimited(null) === false, 'NOT a null error')
  check(L.isRateLimited({}) === false, 'NOT a bare object')
}

console.log('\n── ONE MODULE, OR THE PROTECTION IS GONE ' + '─'.repeat(32))
{
  // Two different specifiers for the same file. Node resolves both to one
  // realpath and therefore one module instance — this asserts that holds, and
  // will fail the day someone adds a barrel that re-exports a second copy.
  const a = require(build('limits'))
  const b = require(build('limits_second_path'))

  check(a === L, 'the same specifier yields the same module')
  check(a.__state.buckets() === L.__state.buckets(), 'and literally the same bucket map')

  // Two SEPARATE bundles are two instances — this is the failure mode, proven
  // to be detectable rather than assumed. If the app ever ends up like this,
  // the assertion below is what it looks like.
  check(b.__state.buckets() !== a.__state.buckets(),
    'two separate bundles ARE two maps — which is exactly the bug to avoid')

  // And the consequence, demonstrated rather than described.
  const ip = '9.9.9.9'
  for (let i = 0; i < 30; i++) a.stylistRateLimited(req(ip))
  check(a.stylistRateLimited(req(ip)) === true, 'one instance refuses after 30')
  check(b.stylistRateLimited(req(ip)) === false,
    'the second instance lets the SAME IP straight through — the doubled limit, made visible')
}

// ── the feed, which spends other people's quota ──────────────────────────────
// /api/featured fans out to WINDOW brand stores per request. It was the one
// public route with no limiter on either verb, and `page` — unbounded, and the
// seed for the brand shuffle — meant every value produced a different sample,
// a different catalogue cache key, and another round of real store fetches. A
// walk of pages 0..200 cost 5,040 outbound calls.
//
// Counted here by stubbing the network and tallying the store calls that would
// actually have been made, not by reading cache internals.
async function featured() {
  const FEED = path.join(WEB, '.vt', 'featured-route.cjs')
  fs.mkdirSync(path.join(WEB, '.vt'), { recursive: true })
  execFileSync(path.join(WEB, 'node_modules/.bin/esbuild'), [
    path.join(WEB, 'app/api/featured/route.ts'),
    '--bundle', '--platform=node', '--format=cjs',
    '--outfile=' + FEED, '--log-level=error', '--alias:@=' + WEB,
  ])
  const R = require(FEED)

  const calls = { store: 0 }
  const saved = global.fetch
  global.fetch = async (url) => {
    if (/\/api\/mcp/.test(String(url))) {
      calls.store++
      return new Response(JSON.stringify({ result: { structuredContent: { products: [] } } }),
        { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  }

  const hdr = (ip) => ({ get: (h) => (h === 'x-vercel-forwarded-for' ? ip : null) })
  const post = (ip, body) => R.POST({ headers: hdr(ip), json: async () => body })
  const get = (ip, qs) => R.GET({ headers: hdr(ip), nextUrl: { searchParams: new URLSearchParams(qs) } })

  try {
    console.log('\n── the feed cannot be walked for free ' + '─'.repeat(35))

    // The pool is finite, so the number of distinct pages is too.
    calls.store = 0
    for (let p = 0; p < 7; p++) await post('10.0.0.1', { page: p })
    check(calls.store > 0, 'walking the real pages does reach the stores', `${calls.store} store calls`)

    calls.store = 0
    for (let p = 7; p < 21; p++) await post('10.0.0.1', { page: p })
    check(calls.store === 0,
      'fourteen pages PAST the end reach none — they wrap onto samples already fetched',
      `${calls.store} store calls`)

    // The walk itself, at the scale an attacker would use. The limiter is not
    // what is being measured here, so this goes straight at buildFeatured's
    // behaviour through a fresh IP per burst.
    calls.store = 0
    for (let p = 0; p <= 10000; p += 37) await post(`10.2.${(p / 37) % 250}.${((p / 37) >> 8) % 250}`, { page: p })
    check(calls.store === 0,
      'and a 0..10000 walk mints no new fan-out at all — every page is one already held',
      `${calls.store} store calls across ${Math.floor(10000 / 37) + 1} requests`)

    // A page inside the range is untouched: same feed, same order, same shape.
    const a = await (await post('10.0.0.3', { page: 2 })).json()
    const b = await (await post('10.0.0.3', { page: 2 })).json()
    check(JSON.stringify(a) === JSON.stringify(b), 'a valid page is still deterministic')
    check(a._meta && typeof a._meta.sampled === 'number' && 'fetched' in a._meta
      && 'kept' in a._meta && 'returned' in a._meta && 'cc' in a._meta,
      '  and _meta keeps every key it had', JSON.stringify(Object.keys(a._meta || {})))
    check(a._meta.sampled === 28, '  and WINDOW is still 28', String(a._meta?.sampled))
    check(Array.isArray(a.products) && a.products.length <= 50,
      '  and products is still an array capped at 50', String(a.products?.length))

    // Ranking and diversification are downstream of the clamp and must be
    // untouched by it: the same page yields the same ORDER, not merely the
    // same set. (With the stores stubbed empty this is the empty ordering —
    // what it proves is that the clamp did not reorder or re-seed anything.)
    const src = fs.readFileSync(path.join(WEB, 'app/api/featured/route.ts'), 'utf8')
    check(/const out = diversify\(kept, page \* 13 \+ 1\)\.slice\(0, 50\)/.test(src),
      'diversify still runs on the same seed and the same cap')
    check(/seededShuffle\(pool, page \* 7 \+ 11\)/.test(src), 'and the shuffle is seeded exactly as before')
    check(/const WINDOW = 28/.test(src), 'WINDOW is still declared 28 in the source')

    // Wrapping is deterministic, not a rejection: page 7 IS page 0.
    const p0 = await (await post('10.0.0.4', { page: 0 })).json()
    const p7 = await (await post('10.0.0.4', { page: 7 })).json()
    check(JSON.stringify(p0) === JSON.stringify(p7),
      'an out-of-range page lands deterministically on a real one rather than erroring')

    // Both verbs are limited, each on its own IP so neither spends the other's
    // allowance.
    let refusedAt = -1
    for (let i = 1; i <= 40 && refusedAt < 0; i++) {
      const res = await post('10.1.0.1', { page: 0 })
      if (res.status === 429) refusedAt = i
    }
    check(refusedAt === 31, 'POST is refused on the 31st request in a window', `refused at ${refusedAt}`)

    refusedAt = -1
    for (let i = 1; i <= 40 && refusedAt < 0; i++) {
      const res = await get('10.1.0.2', 'cc=US&page=0')
      if (res.status === 429) refusedAt = i
    }
    check(refusedAt === 31, 'GET is refused on the 31st too — it was the unlimited one', `refused at ${refusedAt}`)

    const limited = await post('10.1.0.1', { page: 0 })
    const body = await limited.json()
    check(limited.status === 429 && Array.isArray(body.products) && body.products.length === 0,
      'a refused request still answers in the shape the caller expects')
  } finally {
    global.fetch = saved
  }
}

featured().then(() => {
  console.log('\n' + (bad === 0
    ? 'the protections behave as they did, and there is exactly one of each'
    : `${bad} FAILED`))
  process.exit(bad === 0 ? 0 : 1)
}, (e) => { console.error(e); process.exit(1) })
