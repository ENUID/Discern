/**
 * Whether a product matches what was asked for — and the one rule that shapes
 * every multi-garment search in the app.
 *
 * A search sends one query to ninety stores and each answers with its own idea
 * of a match. `lib/catalog/concepts.ts` measures those answers against the
 * request: a concept group is a set of words meaning the same thing ("olive",
 * "sage", "forest"), a product hits a group if it contains any of them, and
 * more hits rank higher.
 *
 * Two things here are load-bearing far beyond this file:
 *
 *   findGarmentGroupIndex finds the FIRST group that names a garment, and only
 *     that one counts as "the garment" for the whole search. Ask for shirts and
 *     shorts together and exactly one of them is recognised; the other carries
 *     no garment hit and is dropped once enough of the first exist. The shopper
 *     sees shirts and no shorts, with nothing anywhere saying so. This is the
 *     constraint multiCategorySearch exists to work around by running one
 *     search per garment — see lib/stylist/retrieval.ts.
 *
 *   minKeep keeps a floor of products even when nothing matches well, because
 *     a page of near-misses beats an empty page. It is also why a t-shirt
 *     search can still show shirts: the padding is deliberate, and the rule
 *     that produces it is asserted here rather than left to be rediscovered.
 *
 * Written before the move, and run against the code on both sides of it.
 */
const path = require('path')
const fs = require('fs')
const { execFileSync } = require('child_process')

const WEB = path.resolve(__dirname, '..')
const out = path.join(WEB, '.vt', 'catalog-concepts.cjs')
fs.mkdirSync(path.join(WEB, '.vt'), { recursive: true })
execFileSync(path.join(WEB, 'node_modules/.bin/esbuild'), [
  path.join(WEB, 'lib/catalog/concepts.ts'),
  '--bundle', '--platform=node', '--format=cjs', '--outfile=' + out,
  '--log-level=error', '--alias:@=' + WEB,
])
const C = require(out)

let bad = 0
const check = (ok, label, detail) => {
  if (!ok) bad++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail !== undefined ? `  ${detail}` : ''}`)
}
const same = (got, want, label) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  check(ok, label, ok ? undefined : `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)
}

const p = (title, extra = {}) => ({ id: title, title, vendor: 'A Brand', tags: [], description: '', ...extra })
const titles = (xs) => xs.map(x => x.title)

// ── a hit is any word in the group ──────────────────────────────────────────
console.log('── a concept group is a set of words that mean the same thing ' + '─'.repeat(12))
{
  const hay = C.productHaystack(p('Olive Linen Camp Collar Shirt'))
  check(typeof hay === 'string' && hay.includes('olive'), 'the haystack is the product, lowercased', JSON.stringify(hay.slice(0, 40)))
  check(C.conceptHit(hay, ['sage', 'olive', 'forest']) === true, 'any word in the group is a hit')
  check(C.conceptHit(hay, ['crimson', 'scarlet']) === false, 'and no word is no hit')
  check(C.conceptHit(hay, []) === false, 'an empty group cannot be hit')

  const withTags = C.productHaystack(p('Shirt', { tags: ['linen', 'summer'] }))
  check(C.conceptHit(withTags, ['linen']) === true, 'tags count as much as the title')
}

// ── only the FIRST garment group counts ─────────────────────────────────────
console.log('\n── one search recognises exactly one garment ' + '─'.repeat(29))
{
  const shirtsThenShorts = [['men'], ['shirt', 'shirts'], ['short', 'shorts']]
  const i = C.findGarmentGroupIndex(shirtsThenShorts)
  check(i === 1, 'the FIRST group naming a garment is the garment', `index ${i}`)
  check(i !== 2, 'the second garment named is NOT recognised as one — this is the whole reason')
  console.log('       multiCategorySearch runs a separate search per garment. Ask for shirts and')
  console.log('       shorts in one query and the shorts carry no garment hit at all.')

  const shortsThenShirts = [['men'], ['short', 'shorts'], ['shirt', 'shirts']]
  check(C.findGarmentGroupIndex(shortsThenShirts) === 1,
    'and it is genuinely positional — whichever is written first wins')

  // NO GARMENT NAMED FALLS BACK TO GROUP 0, not to "there isn't one". So a
  // request that names only a colour and a material treats its FIRST concept
  // group as the garment, whatever that group actually is — "the historical
  // assumption", in the code's own words. Recorded as what it does: a caller
  // reading this as "-1 means none" would be wrong in a way that compiles.
  check(C.findGarmentGroupIndex([['men'], ['linen'], ['olive']]) === 0,
    'a request naming NO garment falls back to group 0 rather than reporting none',
    C.findGarmentGroupIndex([['men'], ['linen'], ['olive']]))
  check(C.findGarmentGroupIndex([]) === 0, 'and so does an empty request')
  check(C.findGarmentGroupIndex([['shirt']]) === 0,
    'which happens to be right whenever the garment IS first — the reason this has never hurt')
}

// ── the floor ───────────────────────────────────────────────────────────────
console.log('\n── a page of near-misses beats an empty page ' + '─'.repeat(29))
{
  const pool = [
    p('Olive Linen Shirt'), p('Sage Linen Shirt'), p('Navy Cotton Shirt'),
    p('Grey Wool Coat'), p('Black Leather Boot'), p('Red Silk Dress'),
  ]
  const concepts = [['shirt', 'shirts'], ['olive', 'sage', 'forest']]

  const kept = C.applyConceptRelevance(pool, concepts, 4)
  check(kept.length >= 4, 'minKeep is a floor, honoured even when few products match well', kept.length)
  check(kept[0].title.includes('Olive') || kept[0].title.includes('Sage'),
    'and the best match still leads', kept[0].title)

  const strict = C.applyConceptRelevance(pool, concepts, 1)
  check(strict.length >= 1, 'a floor of one still returns something', strict.length)
  check(strict[0].title.includes('Olive') || strict[0].title.includes('Sage'),
    'led by a product that hits both groups', strict[0].title)

  same(titles(C.applyConceptRelevance(pool, [], 4)), titles(pool),
    'no concepts means no reordering — the store order stands')
  same(C.applyConceptRelevance([], concepts, 4), [], 'nothing in, nothing out')

  // Ordering is a total order, so the same input always gives the same page.
  const a = titles(C.applyConceptRelevance(pool, concepts, 6))
  const b = titles(C.applyConceptRelevance(pool, concepts, 6))
  same(a, b, 'the same request twice gives the same page — ties break on original order, not chance')
}

console.log('\n' + (bad === 0
  ? 'concept matching ranks the same way, and still recognises exactly one garment per search'
  : `${bad} FAILED`))
process.exit(bad === 0 ? 0 : 1)
