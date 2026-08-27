
// Builds what it needs, so this is runnable from a clean checkout rather than
// only after some other command happened to leave a bundle behind.
const { execFileSync: _exec } = require('child_process')
const _fs = require('fs')
const _path = require('path')
const _WEB = _path.resolve(__dirname, '..')
function load(tsPath, name) {
  const out = _path.join(_WEB, '.vt', name + '.cjs')
  _fs.mkdirSync(_path.join(_WEB, '.vt'), { recursive: true })
  _exec(_path.join(_WEB, 'node_modules/.bin/esbuild'), [
    _path.join(_WEB, tsPath), '--bundle', '--platform=node', '--format=cjs',
    '--outfile=' + out, '--log-level=error', '--alias:@=' + _WEB,
  ])
  return require(out)
}
/**
 * Does the garment filter keep the wrong garment out, and the right one in?
 *
 * Every case below is a real product from a real production response to the
 * question "what should I wear to a summer wedding in Delhi" (men, INR, IN).
 * The four marked WRONG were on the page: two sock packs in the Loafers strip,
 * a womenswear co-ord leading the Blazers strip, and a pair of shorts in the
 * Trousers strip.
 *
 * The RIGHT cases matter more than the wrong ones. An exclusion list is easy to
 * make strict enough to empty a strip, and an empty strip is a worse bug than a
 * sock in it — so every real garment that shared the page is asserted to
 * survive, by name.
 *
 * The garment question reads TITLE, TAGS and PRODUCT TYPE only, never the
 * description; the haystack below is built the same way for that reason.
 */
const { matchesGarmentExclusion, GARMENT_VOCAB, decomposeQuery } = load('lib/queryParser.ts', 'qp')

const hay = p => `${p.title} ${(p.tags || []).join(' ')} ${p.type || ''}`
  .toLowerCase().replace(/[_/|>]+/g, ' ')

/** The product-term group for a garment key, as the catalogue matcher passes it. */
const group = key => GARMENT_VOCAB[key].product

// key, product, shouldBeExcluded
const CASES = [
  // ── The four that were wrong on the page ───────────────────────────────────
  ['loafer', { title: 'The Complete Loafer Sock Pack', tags: ['BT'] }, true],
  // The two hosiery packs as they REALLY arrive: tagged ["BT"], no product
  // type, and the word "sock" only ever in the description — which the garment
  // filter must not read. The multipack in the title is the whole signal.
  ['loafer', { title: 'Black Essentials Loafers (Pack of 3)', tags: ['BT'] }, true],
  ['loafer', { title: 'Rust & Tide Loafers (Pack of 3)', tags: ['BT'] }, true],
  ['blazer', { title: 'Shanaya Top-Pants & Blazer Set', tags: ['Colour_Maroon', 'cotton', 'Material_Cotton'] }, true],
  ['trouser', { title: 'Classic Shorts - Navy', tags: ['Filterclass_Shorts', 'Filtersubclass_Shorts', 'Bottomwear_Classic'] }, true],

  // ── Everything else that shared those strips, and must survive ─────────────
  ['loafer', { title: "Men's Terra Black Loafers", tags: [] }, false],
  ['loafer', { title: "Men's Black Esparto Loafers", tags: [] }, false],
  ['loafer', { title: 'RABARI LOAFER', tags: [] }, false],
  ['loafer', { title: 'Queens Crest Loafer', tags: [] }, false],
  ['loafer', { title: 'SQUARE LOAFER', tags: [] }, false],
  ['loafer', { title: 'SOFT NEW BANDED LOAFER', tags: [] }, false],
  ['blazer', { title: 'The Effortless Blazer Navy', tags: [] }, false],
  ['blazer', { title: 'Transit Summer Blazer', tags: [] }, false],
  ['blazer', { title: 'Yacht Club Luxe Linen Blazer', tags: [] }, false],
  ['blazer', { title: 'CRASH KANTHA BLAZER', tags: [] }, false],
  ['blazer', { title: 'THREE BUTTON BLAZER', tags: [] }, false],
  ['trouser', { title: 'Flycatcher Trousers - Navy', tags: ['Filterclass_Trousers'] }, false],
  ['trouser', { title: 'Vulcan Navy Wool Blend Trousers', tags: [] }, false],
  ['trouser', { title: 'Lapis European Linen Trouser', tags: [] }, false],
  ['trouser', { title: 'ASTRA TROUSERS [UNISEX]', tags: [] }, false],
  ['trouser', { title: 'Navy Blue Pants', tags: [] }, false],
  ['shirt', { title: 'Stone Grey European Linen Shirt', tags: [] }, false],
  ['shirt', { title: 'Riverine Shirt - Ivory & Charcoal Embroidered', tags: [] }, false],
  ['shirt', { title: 'Half Sleeve Shirt - Cotton Linen Classic Fit', tags: ['Filterclass_Shirt', 'Filtersleeve_Half Sleeves'] }, false],

  // ── The shoe-adjacent objects, and the shoes they sit beside ──────────────
  ['shoe', { title: 'Cedar Shoe Trees', tags: [] }, true],
  ['shoe', { title: 'Leather Shoe Care Kit', tags: [] }, true],
  ['sandal', { title: 'Ankle Socks Three Pack', tags: [] }, true],
  ['shoe', { title: 'Derby Shoes In Brown Leather', tags: [] }, false],
  ['sandal', { title: 'Woven Leather Sandals', tags: [] }, false],
  ['heel', { title: 'Block Heel Court Shoes', tags: [] }, false],
  // A multipack only disqualifies FOOTWEAR. Socks, tees and underwear are sold
  // in threes perfectly legitimately, and their own strips must keep them.
  ['sock', { title: 'Black Essentials Loafers (Pack of 3)', tags: ['BT'] }, false],
  ['tshirt', { title: 'Crew Neck Tee Pack of 3', tags: [] }, false],
]

// A garment named alongside another garment must not be deleted by the
// specificity filter. The first four are the ones the new cross-slot
// exclusions would have broken; the last two are what that filter is FOR.
const DECOMPOSE = [
  ['loafers and socks', ['loafer', 'sock']],
  ['trousers and shorts', ['trouser', 'short']],
  ['leggings and shoes', ['legging', 'shoe']],
  ['a blazer and a jumpsuit', ['blazer', 'jumpsuit']],
  ['men t-shirt', ['tshirt']],
  ['bootcut jeans', ['jean']],
]

let bad = 0

console.log('── garment exclusion ' + '─'.repeat(52))
for (const [key, p, want] of CASES) {
  const got = matchesGarmentExclusion(hay(p), group(key))
  const ok = got === want
  if (!ok) bad++
  console.log(
    `${ok ? '  ok  ' : ' FAIL '}${key.padEnd(8)} ${want ? 'excluded' : 'kept    '}  ` +
    `${got === want ? '' : `(got ${got ? 'excluded' : 'kept'}) `}${p.title}`
  )
}

console.log('\n── query decomposition ' + '─'.repeat(50))
for (const [q, want] of DECOMPOSE) {
  const got = decomposeQuery(q).garmentKeys
  const ok = want.every(k => got.includes(k)) && got.length === want.length
  if (!ok) bad++
  console.log(`${ok ? '  ok  ' : ' FAIL '}"${q}" → [${got.join(', ')}]${ok ? '' : `  want [${want.join(', ')}]`}`)
}

console.log('\n' + (bad === 0 ? 'all clear' : `${bad} FAILED`))
process.exit(bad === 0 ? 0 : 1)
