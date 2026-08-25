/**
 * What the catalogue throws away, and what it merely moves down the page.
 *
 * `lib/catalog/productFilters.ts` answers four questions about every candidate
 * a store returns. Two of them DELETE products and two REORDER them, and
 * getting that split wrong is the difference between a page that is wrong and
 * a page that is empty:
 *
 *   isNonFashion            deletes  — a candle is not a near-miss shirt
 *   productGenderSignal     deletes  — a saree is not a men's shirt
 *   colour agreement        reorders — a blue shirt beats no shirt
 *   size preference         reorders — an XL beats no shirt
 *
 * A shopper who asks for a green shirt and is shown a blue one got a worse
 * answer. A shopper who asks for a green shirt and is shown nothing got no
 * answer. That is why colour and size sort rather than filter, and it is the
 * single most reversible-looking decision in this file — "surely we should
 * only show the colour they asked for" is exactly the change that empties the
 * page for every specific request.
 *
 * Written before the move, and run against the code on both sides of it.
 */
const path = require('path')
const fs = require('fs')
const { execFileSync } = require('child_process')

const WEB = path.resolve(__dirname, '..')
const out = path.join(WEB, '.vt', 'catalog-filters.cjs')
fs.mkdirSync(path.join(WEB, '.vt'), { recursive: true })
execFileSync(path.join(WEB, 'node_modules/.bin/esbuild'), [
  path.join(WEB, 'lib/catalog/productFilters.ts'),
  '--bundle', '--platform=node', '--format=cjs', '--outfile=' + out,
  '--log-level=error', '--alias:@=' + WEB,
])
const F = require(out)

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

// ── is it clothing at all ───────────────────────────────────────────────────
console.log('── a candle is not a near-miss shirt ' + '─'.repeat(37))
{
  for (const t of ['Hardcover Novel', 'Scented Candle', 'Gift Card', 'Wall Art Print', 'A5 Notebook', 'Reed Diffuser']) {
    check(F.isNonFashion(p(t)) === true, `"${t}" is removed`)
  }
  for (const t of ['Linen Shirt', 'Wool Overcoat', 'Leather Loafers', 'Cotton Shorts']) {
    check(F.isNonFashion(p(t)) === false, `"${t}" stays`)
  }
  check(F.isNonFashion(p('Notebook Stripe Shirt')) === true,
    'the word wins wherever it sits in the title — the cost of a keyword rule, recorded not defended')
  check(F.isNonFashion(p('Silk Scarf', { tags: ['book'] })) === true, 'and a tag counts as much as a title')
}

// ── who is it for ───────────────────────────────────────────────────────────
console.log('\n── stated gender is a fact, not a preference ' + '─'.repeat(29))
{
  check(F.productGenderSignal(p("Men's Oxford Shirt")) === 'men', 'a title that says so')
  check(F.productGenderSignal(p("Women's Silk Blouse")) === 'women', 'either way')
  check(F.productGenderSignal(p('Linen Shirt')) === null,
    'and a title that says nothing signals nothing — unisex stock must not be filtered out')

  check(F.productGenderSignal(p('Banarasi Saree')) === 'women',
    'a garment that is only womenswear counts even with no gendered word')
  check(F.productGenderSignal(p('Anarkali Kurti')) === 'women', 'so does another')

  check(F.productGenderSignal(p('Shirt', { tags: ['collection:Mens'] })) === 'men',
    'a Shopify collection tag is read the same as the title')

  same(F.requestedGenderFromConcepts([['men', 'mens']]), 'men', 'a request can state it too')
  same(F.requestedGenderFromConcepts([['linen'], ['shirt']]), null, 'and usually does not')
}

// ── colour ──────────────────────────────────────────────────────────────────
console.log('\n── colour agrees or it does not ' + '─'.repeat(42))
{
  check(F.colorFamiliesAgree('blue', 'navy') === true, 'navy is a blue')
  check(F.colorFamiliesAgree('blue', 'red') === false, 'red is not')
  check(F.colorFamiliesAgree('green', 'green') === true, 'and a family agrees with itself')

  const fams = F.productColorFamilies(p('Olive Green Linen Shirt'))
  check(fams instanceof Set && fams.size > 0, 'a title yields its colour families', JSON.stringify([...fams]))
  check(F.productColorFamilies(p('Linen Shirt')).size === 0,
    'and a title with no colour yields none — never guessed')

  // ONE COLOUR WORD IS NOT A COLOUR REQUEST. A group has to be mostly colour
  // vocabulary — at least two matching tokens and 60% of the group — or a
  // garment list that happens to contain "olive" or "rose" would be read as a
  // request for that colour and then filter on it.
  same(F.requestedColorsFromConcepts([['green'], ['shirt']]), [],
    'a lone colour token is NOT read as a colour request')
  same(F.requestedColorsFromConcepts([['green', 'olive', 'sage']]), ['green'],
    'a group that is mostly one colour family IS — this is the shape buildMandatoryConcepts produces')
  same(F.requestedColorsFromConcepts([['shirt', 'blouse', 'top', 'olive']]), [],
    'and a garment list carrying one colour word stays a garment list')
  same(F.requestedColorsFromConcepts([['linen'], ['shirt']]), [], 'a request with no colour names none')
  same(F.requestedColorsFromConcepts([]), [], 'and no concepts name nothing')
}

// ── size ────────────────────────────────────────────────────────────────────
console.log('\n── size moves a product, it never deletes one ' + '─'.repeat(28))
{
  check(F.normalizeSizeLabel(' m ') === F.normalizeSizeLabel('M'), 'case and spacing do not change a size')
  check(typeof F.normalizeSizeLabel('medium') === 'string', 'and a word is read as one', F.normalizeSizeLabel('medium'))

  const pool = [p('Shirt A'), p('Shirt B'), p('Shirt C')]
  const sorted = F.applySizePreference(pool, 'M')
  check(sorted.length === 3, 'EVERY product survives a size preference — this is a sort, not a filter', sorted.length)
  same(F.applySizePreference(pool, null).map(x => x.title), ['Shirt A', 'Shirt B', 'Shirt C'],
    'and with no stated size the order is untouched')
  same(F.applySizePreference([], 'M'), [], 'nothing in, nothing out')

  // A product that states the wanted size outranks one that states another.
  const withSizes = [
    p('Shirt XS-only', { options: [{ name: 'Size', values: ['XS'] }] }),
    p('Shirt M-only', { options: [{ name: 'Size', values: ['M'] }] }),
  ]
  const ranked = F.applySizePreference(withSizes, 'M')
  check(ranked.length === 2, 'both are still shown', ranked.length)
  check(ranked[0].title === 'Shirt M-only', 'and the one that fits leads', ranked[0].title)
}

console.log('\n' + (bad === 0
  ? 'two questions delete a product and two only move it, exactly as before the move'
  : `${bad} FAILED`))
process.exit(bad === 0 ? 0 : 1)
