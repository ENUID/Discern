/**
 * What this route spent, and what it could not read.
 *
 * Two fire-and-forget diagnostics. Neither is on the path a shopper waits on,
 * so the properties worth protecting are not "does it log" but:
 *
 *   it is INERT without a Convex URL          — a missing env var must not throw
 *   it NEVER throws and never rejects         — logging cannot reach a reply
 *   failures are ALWAYS kept                  — that is the signal worth having
 *   successes are SAMPLED 1-in-N              — observing the system was itself
 *                                               one of its heaviest consumers
 *   vocab misses are bounded                  — short, term-like queries only,
 *                                               because sentences read as PII
 *
 * The sampling rule is the one with real behaviour in it, and the one a
 * "cleanup" would most plausibly flatten into "log everything" or "log one in
 * five of everything". Both would be wrong in different directions.
 */
const path = require('path')
const fs = require('fs')
const { execFileSync } = require('child_process')

const WEB = path.resolve(__dirname, '..')
function load(name) {
  const out = path.join(WEB, '.vt', name + '.cjs')
  fs.mkdirSync(path.join(WEB, '.vt'), { recursive: true })
  execFileSync(path.join(WEB, 'node_modules/.bin/esbuild'), [
    path.join(WEB, 'lib/stylist/usage.ts'),
    '--bundle', '--platform=node', '--format=cjs',
    '--outfile=' + out, '--log-level=error', '--alias:@=' + WEB,
  ])
  return out
}

let bad = 0
const check = (ok, label, detail) => {
  if (!ok) bad++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail !== undefined ? `  ${detail}` : ''}`)
}

const info = (ok) => ({
  path: 'llm-heavy', provider: 'groq',
  estPromptTokens: 100, estCompletionTokensCap: 500, ok,
})

// ── with no Convex configured ───────────────────────────────────────────────
console.log('── unconfigured: inert, never fatal ' + '─'.repeat(37))
{
  delete process.env.NEXT_PUBLIC_CONVEX_URL
  delete process.env.CONVEX_AUTH_SECRET
  for (const k of Object.keys(require.cache)) if (k.includes('/.vt/')) delete require.cache[k]
  const U = require(load('usage_off'))

  check(U.convexUsageClient === null, 'no client is created')
  let threw = false
  try { U.logAiUsage(info(true)); U.logAiUsage(info(false)); U.recordVocabMiss('linen shirt', 'no-results') }
  catch { threw = true }
  check(!threw, 'and both writes are silent no-ops rather than throwing')
  check(U.estimateTokens('') === 0, 'the estimator still works', U.estimateTokens(''))
}

// ── the estimator ───────────────────────────────────────────────────────────
console.log('\n── the token estimate: chars / 4, rounded up ' + '─'.repeat(28))
{
  for (const k of Object.keys(require.cache)) if (k.includes('/.vt/')) delete require.cache[k]
  const U = require(load('usage_est'))
  check(U.estimateTokens('abcd') === 1, '4 chars → 1')
  check(U.estimateTokens('abcde') === 2, '5 chars → 2 (rounds up)')
  check(U.estimateTokens('') === 0, 'empty → 0')
  check(U.estimateTokens('x'.repeat(4000)) === 1000, '4,000 chars → 1,000')
}

// ── with a client, watching what it actually writes ─────────────────────────
console.log('\n── failures always, successes sampled ' + '─'.repeat(35))
{
  process.env.NEXT_PUBLIC_CONVEX_URL = 'https://stub.convex.cloud'
  process.env.CONVEX_AUTH_SECRET = 'stub-secret'
  process.env.AI_USAGE_SAMPLE_N = '5'
  for (const k of Object.keys(require.cache)) if (k.includes('/.vt/')) delete require.cache[k]
  const U = require(load('usage_on'))

  const wrote = []
  U.convexUsageClient.mutation = async (fn, args) => { wrote.push(args); return null }

  check(U.__usageState.sampleN() === 5, 'the sample rate is read from the environment', U.__usageState.sampleN())

  for (let i = 0; i < 20; i++) U.logAiUsage(info(false))
  check(wrote.length === 20, 'twenty failures write twenty times', wrote.length)

  wrote.length = 0
  for (let i = 0; i < 20; i++) U.logAiUsage(info(true))
  check(wrote.length === 4, 'twenty successes write four times — one in five', wrote.length)

  wrote.length = 0
  U.logAiUsage(info(true))
  U.logAiUsage(info(false))
  check(wrote.length === 1 && wrote[0].properties.ok === false,
    'a failure is kept even when the sampler would have skipped it')

  check(wrote[0].event === 'ai_usage', 'written under the ai_usage event', wrote[0].event)
  check(wrote[0].properties.provider === 'groq', 'carrying the provider', wrote[0].properties.provider)
}

// ── vocab misses are bounded ────────────────────────────────────────────────
console.log('\n── a vocabulary miss: short, term-like queries only ' + '─'.repeat(21))
{
  for (const k of Object.keys(require.cache)) if (k.includes('/.vt/')) delete require.cache[k]
  const U = require(load('usage_vocab'))
  const wrote = []
  U.convexUsageClient.mutation = async (fn, args) => { wrote.push(args); return null }

  const tries = (q) => { wrote.length = 0; U.recordVocabMiss(q, 'no-results'); return wrote.length === 1 }

  check(tries('overshirt') === true, 'a single term is recorded')
  check(tries('cropped linen overshirt') === true, 'three words is recorded')
  check(tries('ab') === false, 'two characters is not', 'too short')
  check(tries('x'.repeat(61)) === false, 'sixty-one characters is not', 'too long')
  check(tries('a b c d e f g') === false, 'seven words is not — a sentence, not a term')
  check(tries('  overshirt  ') === true, 'and it is trimmed first')

  wrote.length = 0
  U.recordVocabMiss('overshirt', 'weak-match')
  check(wrote[0].reason === 'weak-match', 'the reason is carried through', wrote[0].reason)
  check(wrote[0].serverSecret === 'stub-secret', 'and the write is authenticated')
}

// ── a broken Convex must never reach the shopper ────────────────────────────
console.log('\n── when the write fails ' + '─'.repeat(49))
{
  for (const k of Object.keys(require.cache)) if (k.includes('/.vt/')) delete require.cache[k]
  const U = require(load('usage_fail'))
  U.convexUsageClient.mutation = async () => { throw new Error('convex is down') }

  let threw = false
  try { U.logAiUsage(info(false)); U.recordVocabMiss('overshirt', 'no-results') } catch { threw = true }
  check(!threw, 'a rejected write does not throw at the call site')
}

// Give the rejected promises above a tick to settle; an unhandled rejection
// here would crash the process and is exactly what the .catch() prevents.
setTimeout(() => {
  console.log('\n' + (bad === 0
    ? 'both diagnostics are inert when unconfigured, bounded, and unable to reach a reply'
    : `${bad} FAILED`))
  process.exit(bad === 0 ? 0 : 1)
}, 50)
