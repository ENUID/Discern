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

/** The cap this rung gets, given how much of the ladder is already gone. */
const capFor = (rungsLeft, elapsed) =>
  Math.max(ATTEMPT_MS, Math.floor((LADDER_MS - elapsed) / rungsLeft))

/** Every rung times out; returns the caps handed out and the total spent. */
function allTimeOut(chainLength) {
  const caps = []
  let elapsed = 0
  for (let i = 0; i < chainLength; i++) {
    const cap = capFor(chainLength - i, elapsed)
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

// 1. A long chain is unchanged: still the flat floor, every rung.
const four = allTimeOut(4)
check('four rungs still get the flat 11s floor each', four.caps.every(c => c === ATTEMPT_MS), `[${four.caps.join(', ')}]`)

// 2. A short chain spends the budget rather than a fraction of it.
const two = allTimeOut(2)
check('two rungs spend the whole 34s, not 22s', two.total === LADDER_MS, `${two.total}ms`)
const one = allTimeOut(1)
check('a lone provider gets the whole budget, not 11s', one.caps[0] === LADDER_MS, `${one.caps[0]}ms`)

// 3. The total can never exceed the ladder budget — except by the floor itself,
//    which is deliberate: a rung is always worth 11s even at the very end.
for (const n of [1, 2, 3, 4, 5, 8]) {
  const { total } = allTimeOut(n)
  const ceiling = Math.max(LADDER_MS, ATTEMPT_MS * n)
  check(`${n} rungs cannot run away`, total <= ceiling, `${(total / 1000).toFixed(1)}s ≤ ${(ceiling / 1000).toFixed(1)}s`)
}

// 4. A fast early rung leaves MORE for the one behind it, never less.
const afterFast = capFor(1, 3_000)
const afterSlow = capFor(1, 25_000)
check('a fast first rung leaves the second more time', afterFast > afterSlow, `${afterFast}ms vs ${afterSlow}ms`)
check('a slow first rung still leaves the floor', afterSlow >= ATTEMPT_MS, `${afterSlow}ms`)

console.log('\n' + (bad === 0 ? 'the ladder spends what it has, and no more' : `${bad} FAILED`))
process.exit(bad === 0 ? 0 : 1)
