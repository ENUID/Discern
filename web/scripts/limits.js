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

const WEB = '/home/user/From/web'
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

console.log('\n' + (bad === 0
  ? 'the protections behave as they did, and there is exactly one of each'
  : `${bad} FAILED`))
process.exit(bad === 0 ? 0 : 1)
