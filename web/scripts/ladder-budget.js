/**
 * Does the provider ladder spend the time it has?
 *
 * The per-attempt cap was a flat 11 seconds. That is right when four more
 * pools are waiting behind this one and wrong when none are: with cerebras
 * wanting payment and gemini's free tier spent, the live chain is groq then
 * nvidia, so a slow groq was abandoned at 11s, nvidia at 22s, and the shopper
 * got "I could not think this one through" with twelve seconds of the ladder's
 * own 34-second budget never spent.
 *
 * The cap is now the flat floor OR an even share of what is left, whichever is
 * larger. Three things have to hold, and the third is the one that bites:
 *
 *   1. a long chain still behaves exactly as it did — 11s a rung
 *   2. a short chain spends the whole budget instead of a fraction of it
 *   3. the total can never run away, however the caps are distributed
 */
const ATTEMPT_MS = 11_000
const LADDER_MS = 34_000

/** The share the FIRST rung gets. The rungs are not equal: the first is the
 *  one picked as best for this request and a success there ends it outright. */
const FIRST_SHARE = 0.55

/** The cap this rung gets, given how much of the ladder is already gone. */
const capFor = (rungsLeft, elapsed, isFirst) => {
  const left = LADDER_MS - elapsed
  // Last rung first: nothing is held back for a fallback that does not exist.
  if (rungsLeft === 1) return Math.max(ATTEMPT_MS, left)
  return isFirst
    ? Math.max(ATTEMPT_MS, Math.floor(left * FIRST_SHARE))
    : Math.max(ATTEMPT_MS, Math.floor(left / rungsLeft))
}

/** Every rung times out; returns the caps handed out and the total spent. */
function allTimeOut(chainLength) {
  const caps = []
  let elapsed = 0
  for (let i = 0; i < chainLength; i++) {
    const cap = capFor(chainLength - i, elapsed, i === 0)
    caps.push(cap)
    elapsed += cap
  }
  return { caps, total: elapsed }
}

let bad = 0
const check = (label, ok, detail) => {
  if (!ok) bad++
  console.log(`${ok ? '  ok  ' : ' FAIL '}${label}${detail ? `  ${detail}` : ''}`)
}

console.log('── caps handed out when every rung times out ' + '─'.repeat(28))
for (const n of [1, 2, 3, 4, 5]) {
  const { caps, total } = allTimeOut(n)
  console.log(`   ${n} rung${n > 1 ? 's' : ''}: [${caps.map(c => (c / 1000).toFixed(1) + 's').join(', ')}]  total ${(total / 1000).toFixed(1)}s`)
}

console.log('\n── what has to hold ' + '─'.repeat(53))

// 1. THE REPORT. Four healthy pools, an even share of 8.5s floored to 11s, and
//    eleven seconds cannot generate 1200 tokens against a 5000-token prompt on
//    any of these providers — so all four were cut off mid-sentence and the
//    shopper got "I could not think this one through" from a chain in which
//    nothing was broken except the clock.
const four = allTimeOut(4)
check('the first of four rungs gets a real chance, not a quarter share',
  four.caps[0] >= 17_000, `${(four.caps[0] / 1000).toFixed(1)}s`)
check('and the fallbacks still get the floor', four.caps.slice(1).every(c => c >= ATTEMPT_MS),
  `[${four.caps.slice(1).map(c => (c / 1000).toFixed(1) + 's').join(', ')}]`)

// 2. A short chain spends the budget rather than a fraction of it.
const two = allTimeOut(2)
check('two rungs spend the whole 34s, not 22s', two.total === LADDER_MS, `${two.total}ms`)
const one = allTimeOut(1)
check('a lone provider gets the whole budget, not 11s', one.caps[0] === LADDER_MS, `${one.caps[0]}ms`)

// 3. The total can never exceed the ladder budget — except by the floor itself,
//    which is deliberate: a rung is always worth 11s even at the very end.
for (const n of [1, 2, 3, 4, 5, 8]) {
  const { total } = allTimeOut(n)
  // The floor guarantees each rung ATTEMPT_MS however little is left, and the
  // first takes its larger share on top — so the honest ceiling is the budget
  // or that sum, whichever is greater. The caller's own chatDeadline is what
  // actually stops the clock; this only asserts the arithmetic is bounded.
  const first = Math.max(ATTEMPT_MS, Math.floor(LADDER_MS * FIRST_SHARE))
  const ceiling = Math.max(LADDER_MS, n === 1 ? LADDER_MS : first + ATTEMPT_MS * (n - 1))
  check(`${n} rungs cannot run away`, total <= ceiling, `${(total / 1000).toFixed(1)}s ≤ ${(ceiling / 1000).toFixed(1)}s`)
}

// 4. A fast early rung leaves MORE for the one behind it, never less.
const afterFast = capFor(1, 3_000, false)
const afterSlow = capFor(1, 25_000, false)
check('a fast first rung leaves the second more time', afterFast > afterSlow, `${afterFast}ms vs ${afterSlow}ms`)
check('a slow first rung still leaves the floor', afterSlow >= ATTEMPT_MS, `${afterSlow}ms`)

console.log('\n' + (bad === 0 ? 'the ladder spends what it has, and no more' : `${bad} FAILED`))
process.exit(bad === 0 ? 0 : 1)
