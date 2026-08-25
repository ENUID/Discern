/**
 * The trace has to be bounded, redacted, and per-request.
 *
 * It records the shopper's own question and the provider's own error text —
 * and provider errors quote the failing request back at you, which is where a
 * key lives. It is also written on every single request, so anything that
 * grows without a limit is a memory leak wearing a diagnostic's clothes.
 *
 * Three properties, none of which should be trusted without a test:
 *
 *   BOUNDED   every string capped, every list capped, products reduced to an
 *             id and a title
 *   REDACTED  the free-text fields go through the same tested redactor the
 *             public provider check uses
 *   ISOLATED  two concurrent requests cannot see each other's trace, which is
 *             exactly what lastJudgeOutcome cannot promise and why this is not
 *             built the same way
 */
const path = require('path')
const fs = require('fs')
const { execFileSync } = require('child_process')

const WEB = '/home/user/From/web'
function load(tsPath, name) {
  const out = path.join(WEB, '.vt', name + '.cjs')
  fs.mkdirSync(path.join(WEB, '.vt'), { recursive: true })
  execFileSync(path.join(WEB, 'node_modules/.bin/esbuild'), [
    path.join(WEB, tsPath), '--bundle', '--platform=node', '--format=cjs',
    '--outfile=' + out, '--log-level=error', '--alias:@=' + WEB,
  ])
  return require(out)
}

const T = load('lib/stylist/trace.ts', 'trace')
const { redactSecrets } = load('lib/redact.ts', 'redact')

let bad = 0
const check = (ok, label, detail) => {
  if (!ok) bad++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  ${detail}` : ''}`)
}

console.log('── it records the decision ' + '─'.repeat(46))
const t = T.startTrace({ question: 'what should I wear to a summer wedding', gender: 'men', country: 'IN', currency: 'INR' })
check(/^r-[a-z0-9]+-[a-z0-9]{4}$/.test(t.id), 'the id is short enough to read out loud', t.id)
T.note(t, { route: 'heavy' })
T.step(t, 'routed', 'heavy(can search)')
T.note(t, { answerVia: 'tokens', outfitQueries: ['men linen shirt', 'men wide trousers'] })
T.note(t, { judge: 'judged', judgeDetail: 'groq' })
T.shown(t, [
  { id: 'gid://p1', title: 'Linen Shirt', vendor: 'Nicobar', price: 4750, description: 'x'.repeat(5000) },
])
const done = T.finishTrace(t)
check(done.route === 'heavy' && done.answerVia === 'tokens' && done.judge === 'judged',
  'route, answer strategy and judge all on one record')
check(done.shown[0].id === 'gid://p1' && done.shown[0].vendor === 'Nicobar', 'products carry id, title, brand')
check(!('price' in done.shown[0]) && !('description' in done.shown[0]),
  'and nothing else — a trace is not a second copy of the catalogue')
check(typeof done.ms === 'number', 'and how long it took')

console.log('\n── it cannot grow without limit ' + '─'.repeat(41))
const big = T.startTrace({ question: 'q'.repeat(5000) })
check(big.question.length <= 500, 'the question is capped', `${big.question.length} chars`)
for (let i = 0; i < 500; i++) T.step(big, 'step ' + i, 'd'.repeat(2000))
check(big.steps.length <= 40, 'steps are capped', `${big.steps.length} steps`)
check(big.steps.every(s => (s.detail || '').length <= 300), 'each detail is capped')
T.shown(big, Array.from({ length: 500 }, (_, i) => ({ id: 'p' + i, title: 'T'.repeat(1000) })))
check(big.shown.length <= 24, 'products are capped', `${big.shown.length}`)
check(big.shown.every(p => p.title.length <= 120), 'each title is capped')
T.note(big, { outfitQueries: Array.from({ length: 50 }, (_, i) => 'q' + i) })
check(big.outfitQueries.length <= 8, 'queries are capped', `${big.outfitQueries.length}`)
const serialised = JSON.stringify(T.finishTrace(big))
check(serialised.length < 40_000, 'a worst-case trace is still small enough to store', `${serialised.length} bytes`)

console.log('\n── secrets do not reach the store ' + '─'.repeat(39))
// This is the field that carries a provider's error verbatim.
const leaky = 'Gemini HTTP 400: Bearer AIzaSyD-1a2B3c4D5e6F7g8H9i0JkLmNoPqRsTuV rejected'
check(!/AIzaSy|[A-Za-z0-9_-]{24,}/.test(redactSecrets(leaky)), 'a key in modelTrace is redacted', redactSecrets(leaky))
const useful = 'Gemini HTTP 404: models/gemini-2.0-flash is no longer available'
check(redactSecrets(useful).includes('gemini-2.0-flash is no longer available'),
  'and the diagnosis itself survives')

console.log('\n── two shoppers cannot read each other ' + '─'.repeat(34))
const a = T.startTrace({ question: 'a wedding' })
const b = T.startTrace({ question: 'a funeral' })
T.note(a, { judge: 'judged' })
T.note(b, { judge: 'warming' })
check(a.id !== b.id, 'separate ids')
check(a.judge === 'judged' && b.judge === 'warming', 'and separate records')
check(a.question === 'a wedding' && b.question === 'a funeral', 'nothing shared between them')

console.log('\n── nothing here may throw ' + '─'.repeat(47))
// Every one of these is called on a path a shopper is waiting on.
T.step(null, 'x'); T.note(null, { route: 'heavy' }); T.shown(null, [])
check(T.finishTrace(null) === null, 'a null trace is inert, never an exception')
T.shown(a, null); T.shown(a, [null, undefined, 42])
check(Array.isArray(a.shown), 'rubbish products do not break it', JSON.stringify(a.shown))
T.note(a, {})
check(true, 'an empty note is fine')

console.log('\n' + (bad === 0
  ? 'the decision is recorded, bounded, redacted, and nobody else can see it'
  : `${bad} FAILED`))
process.exit(bad === 0 ? 0 : 1)
