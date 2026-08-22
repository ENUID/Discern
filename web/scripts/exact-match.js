/**
 * "Find me this exact one, not similar" — and the eight leather sandals.
 *
 * A shopper screenshotted a pair of denim clogs from a post, uploaded it, and
 * asked for that exact pair. What came back, verbatim from production:
 *
 *   searchQuery "men leather sandals"
 *   reply       "I am going off your photo details for this one, let us pull
 *                up the exact pair right here."
 *   products    AMBASSADOR - JET BLACK, Pathani Heritage Sandals - Tan,
 *               Marbella Black Sliders, Yuketen Cruz Sandal …
 *
 * Every one of those is a leather sandal. The photo is a blue denim clog with
 * a buckle, a cork footbed, and a brand tag reading DENIMVERSE. Wrong
 * material, wrong silhouette, wrong brand — under a sentence promising the
 * exact pair.
 *
 * Two separate faults. The vision read is one (prompt-side, not testable
 * here). The claim is the other, and it is testable: the app cannot know it
 * found the exact piece, because nothing here compares the shopper's
 * photograph to a product photograph. So it must never say that it did.
 *
 * The asymmetry below is the design. This only ever WITHHOLDS or CONTRADICTS
 * the claim — it never asserts a match, because no amount of text comparison
 * can settle sameness. A denim clog and a leather clog are both clogs.
 */
const { exactMatchNote, wantsTheExactPiece, nothingIsTheRightGarment } =
  require('/home/user/From/web/.vt/em.cjs')

const P = (title, tags) => ({ title, tags: tags || [], description: '' })

// The eight the shopper was actually shown.
const LEATHER_SANDALS = [
  P('AMBASSADOR - JET BLACK', ['sandal']),
  P('Monkstory Pathani Heritage Sandals - Tan'),
  P('AMBASSADOR - SEPIA BROWN', ['sandal']),
  P('Monkstory Cosmopolitan Cross Strap Toe Ring Chunky Sandals – Dark Tan'),
  P("Men's Marbella Black Sliders"),
  P("Men's Marbella White Sliders"),
  P('Yuketen Cruz Sandal - Brown'),
  P('LINE SANDAL'),
]

let bad = 0
const check = (ok, label, detail) => {
  if (!ok) bad++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  ${detail}` : ''}`)
}

console.log('── which ask is it ' + '─'.repeat(54))
for (const [q, want] of [
  ['find me this exact one, not similar, the exact same sandals', true],
  ['find me the exact same one', true],
  ['I want this exact pair', true],
  ['is this the identical one', true],
  // The opposite request. Close matches ARE the right answer here, so the
  // note must not fire and spoil a page that is doing its job.
  ['find me something like this', false],
  ['show me similar sandals', false],
  ['anything like this but cheaper', false],
  ['other brands that make this', false],
  // Mixed wording: "exact" next to "similar" is a similar ask.
  ['not the exact one, something similar', false],
  // Ordinary shopping, no photo claim at all.
  ['men leather sandals', false],
  ['what should I wear to a wedding', false],
]) {
  const got = wantsTheExactPiece(q)
  check(got === want, `${want ? 'exact ' : 'similar'} — "${q}"`, got === want ? '' : `got ${got}`)
}

console.log('\n── the report ' + '─'.repeat(59))
// The query the vision step produced was "men leather sandals" and the results
// really are sandals — so the garment check passes and the note falls back to
// the honest "cannot promise". That is the correct outcome for a WRONG query:
// this function cannot know the query itself was wrong.
const asWasted = exactMatchNote(
  'find me this exact one, not similar, the exact same sandals',
  'men leather sandals', LEATHER_SANDALS)
check(!!asWasted, 'says something rather than nothing', `"${asWasted}"`)
check(!/\b(exact pair|found it|this is it|here it is)\b/i.test(asWasted), 'never claims it found the piece')
check(/cannot promise|could not find/i.test(asWasted), 'withholds the claim in plain words')

// With the query the photo SHOULD have produced, the same page is caught
// outright: not one of those eight is a clog.
const asShould = exactMatchNote(
  'find me this exact one, not similar',
  'denimverse men blue denim clog', LEATHER_SANDALS)
check(/could not find that exact piece/i.test(asShould), 'a denim clog against eight sandals: caught', `"${asShould}"`)
check(nothingIsTheRightGarment('denimverse men blue denim clog', LEATHER_SANDALS),
  'nothing on the page is the right kind of thing')

console.log('\n── it must not cry wolf ' + '─'.repeat(49))
// A real clog page, asked for exactly. Right kind of thing — so the softer
// line, not the "could not find it" one.
const CLOGS = [P('Denim Clog - Indigo', ['clog']), P('Suede Clog Mule')]
const onClogs = exactMatchNote('find me this exact one', 'men blue denim clog', CLOGS)
check(!/could not find/i.test(onClogs), 'does not claim failure when the garment matches', `"${onClogs}"`)
check(!!onClogs, 'still declines to promise sameness')

// A similar-ask on the same page says nothing at all.
check(exactMatchNote('something like this', 'men blue denim clog', CLOGS) === '',
  'silent on a similar ask')

// Empty page, exact ask.
check(/could not find that exact piece/i.test(exactMatchNote('this exact one', 'men denim clog', [])),
  'an empty page says so')

// A query naming no garment cannot be judged — silence beats a guess.
check(!/could not find that exact piece —/i.test(exactMatchNote('this exact one', 'denimverse', LEATHER_SANDALS)),
  'no garment in the query: does not accuse the page')

console.log('\n' + (bad === 0
  ? 'it never claims a match it cannot verify, and never cries wolf'
  : `${bad} FAILED`))
process.exit(bad === 0 ? 0 : 1)
