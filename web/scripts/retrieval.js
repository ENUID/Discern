/**
 * What one shopper sentence actually asks ninety stores, and what comes back.
 *
 * `lib/stylist/retrieval.ts` turns "shirts and shorts for the beach" into
 * several separately-ranked searches and reassembles the answers into strips a
 * person can read. Almost everything it does is invisible when it breaks:
 *
 *   a shirt slides into the T-Shirts strip     — reads as a bad search
 *   both strips share one budget (4 + 4)       — reads as a thin catalogue
 *   a product appears in two strips            — reads as duplicate stock
 *   a strip reports the query it HOPED would   — "See more" then returns
 *     work instead of the one that did           something else entirely
 *   `sizeForQuery` resolves once, not per slot — one size on every strip
 *   the occasion's linen lands on the sandals  — ninety stores guess, quietly
 *
 * None of those raises an error and none of them fails a build. So this harness
 * puts a fake catalogue behind the module and asserts on the QUESTIONS it asks
 * and the SHAPE it returns, which is the only place those bugs are visible.
 *
 * The catalogue and the model are the only things stubbed. The garment
 * vocabulary, the occasion tables, the lookbook and the outfit composer are all
 * real, because those are what decide the answers being asserted on.
 *
 * This records what the code does TODAY, including one thing that is arguably
 * wrong (noted where it appears). Characterization, not aspiration: E5 moved
 * this code without changing it, and this file is what "without changing it"
 * means.
 */
const path = require('path')
const fs = require('fs')
const { execFileSync } = require('child_process')

const WEB = path.resolve(__dirname, '..')
const out = path.join(WEB, '.vt', 'retrieval.cjs')
fs.mkdirSync(path.join(WEB, '.vt'), { recursive: true })
execFileSync(path.join(WEB, 'node_modules/.bin/esbuild'), [
  path.join(WEB, 'scripts/stubs/entry.js'),
  '--bundle', '--platform=node', '--format=cjs', '--outfile=' + out, '--log-level=error',
  '--alias:@/lib/services/GlobalCatalogService=' + path.join(WEB, 'scripts/stubs/catalog.js'),
  '--alias:@/lib/groq=' + path.join(WEB, 'scripts/stubs/groq.js'),
  '--alias:@=' + WEB,
])
const R = require(out)

let bad = 0
const check = (ok, label, detail) => {
  if (!ok) bad++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail !== undefined ? `  ${detail}` : ''}`)
}
const same = (got, want, label) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  check(ok, label, ok ? undefined : `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)
}

/** Run a block with the module's own logging muted. Some checks below
 *  deliberately break things the module is supposed to survive, and its error
 *  logging is correct behaviour rather than harness output. Only the call is
 *  wrapped; every assertion happens outside, where console still works. */
async function quietly(fn) {
  const log = console.log, error = console.error
  console.log = () => {}; console.error = () => {}
  try { return await fn() } finally { console.log = log; console.error = error }
}

/** A product the way the catalogue hands one over. */
const prod = (id, title, price) => ({ id, title, tags: [], price })

/** Run one search against a fake catalogue, recording every question asked. */
async function run(query, answer, opts = {}) {
  const asked = []
  const sized = []
  R.__searches.length = 0
  R.__catalog.search = async (q) => { asked.push(q); return answer(q) }
  const groups = await R.multiCategorySearch(
    query, opts.budget ?? null, opts.country ?? 'IN', opts.currency ?? 'INR',
    opts.taste, (q) => { sized.push(q); return opts.size ? opts.size(q) : null },
    undefined, 'gender' in opts ? opts.gender : 'men',
  )
  return { groups, asked, sized }
}

const titles = (g) => g.products.map(p => p.title)

// ── the caps ────────────────────────────────────────────────────────────────
console.log('── the caps ' + '─'.repeat(61))
check(R.INITIAL_RESULT_CAP === 8, 'a first page is eight products', R.INITIAL_RESULT_CAP)
check(R.MULTI_CATEGORY_PER_GROUP_CAP === R.INITIAL_RESULT_CAP,
  'and each strip gets that SAME budget, never a share of it',
  `${R.MULTI_CATEGORY_PER_GROUP_CAP} per strip`)

// ── dedupeById ──────────────────────────────────────────────────────────────
console.log('\n── no id twice, whatever produced it ' + '─'.repeat(36))
{
  const d = R.dedupeById([prod('a', 'A'), prod('b', 'B'), prod('a', 'A again'), prod('c', 'C')])
  same(d.map(p => p.id), ['a', 'b', 'c'], 'order is kept and the duplicate goes')
  check(d[0].title === 'A', 'the FIRST copy survives, not the last', d[0].title)
  same(R.dedupeById([{ title: 'no id at all' }, prod('a', 'A')]).map(p => p.id), ['a'],
    'a product with no id is dropped rather than counted')
  same(R.dedupeById([]), [], 'nothing in, nothing out')
}

// ── the reply line ──────────────────────────────────────────────────────────
console.log('\n── the reply line names every strip on screen ' + '─'.repeat(28))
check(R.multiCategoryReplyText(['Shirts']) === "Here's a curated mix of shirts from independent brands.", 'one strip')
check(R.multiCategoryReplyText(['Shirts', 'Shorts']) === "Here's a curated mix of shirts and shorts from independent brands.",
  'two are joined with "and", not a comma')
check(R.multiCategoryReplyText(['Shirts', 'Trousers', 'Loafers']) === "Here's a curated mix of shirts, trousers and loafers from independent brands.",
  'three read as a list')

// ── brands ──────────────────────────────────────────────────────────────────
console.log('\n── a brand name, and a search without it ' + '─'.repeat(32))
{
  check(R.brandNameOf('aloyoga.com') === 'Alo Yoga',
    'a registry domain resolves to the name a shopper would recognise', R.brandNameOf('aloyoga.com'))
  check(R.brandNameOf('ALOYOGA.COM  ') === 'Alo Yoga', 'case and stray spacing do not lose the match')
  check(R.brandNameOf('not-a-real-store.example') === 'not-a-real-store.example',
    'an unknown domain comes back unchanged rather than empty')

  same(R.stripBrandNames('leggings from Alo Yoga', ['aloyoga.com']), 'leggings',
    '"from <brand>" comes out whole, preposition included')
  same(R.stripBrandNames('Alo Yoga leggings', ['aloyoga.com']), 'leggings', 'and so does a bare mention')
  same(R.stripBrandNames('leggings at Alo Yoga', ['aloyoga.com']), 'leggings', 'at, by and in are read the same way')
  check(R.stripBrandNames('linen shirt', []) === 'linen shirt', 'no brands named, nothing touched')
  check(R.stripBrandNames('linen shirt', ['not-a-real-store.example']) === 'linen shirt',
    'and a name under three characters long is never stripped — too much of the query would go with it')
}

async function main() {
  // ── two garments, two strips ──────────────────────────────────────────────
  console.log('\n── "shirts and shorts" is two searches, not one ' + '─'.repeat(26))
  {
    const shirts = Array.from({ length: 12 }, (_, i) => prod(`sh${i}`, `Cotton Shirt ${i}`))
    const shorts = Array.from({ length: 12 }, (_, i) => prod(`st${i}`, `Cotton Shorts ${i}`))
    const { groups, asked } = await run('men white shirts and blue shorts', async () => [...shirts, ...shorts])

    same(groups.map(g => g.label), ['Shirts', 'Shorts'], 'one strip per garment the shopper named')
    same(groups.map(g => g.products.length), [8, 8],
      'EIGHT EACH — not four and four. A shared budget split across strips is the bug this cap exists to prevent')
    check(titles(groups[0]).every(t => t.includes('Shirt')), 'the Shirts strip is only shirts')
    check(titles(groups[1]).every(t => t.includes('Shorts')), 'the Shorts strip is only shorts')
    same(asked, ['men white blue shirt', 'men white blue short'],
      'each strip asks its own question, built from the shared modifiers plus its own garment')
    check(asked.length === 2, 'and when the shopper named the colours there is only ONE rung per strip', asked.length)
  }

  // ── an empty strip is dropped, never backfilled ───────────────────────────
  console.log('\n── a shirt never lands in the T-Shirts strip ' + '─'.repeat(29))
  {
    // The catalogue answers both questions with button-up shirts — exactly what
    // a store's own search box does when asked for t-shirts and it has none.
    const shirts = Array.from({ length: 10 }, (_, i) => prod(`sh${i}`, `Cotton Shirt ${i}`))
    const { groups } = await run('shirts and tshirts', async () => shirts)

    same(groups.map(g => g.label), ['Shirts'],
      'the T-Shirts strip is DROPPED rather than filled with shirts')
    check(groups.every(g => titles(g).every(t => !t.toLowerCase().includes('t-shirt'))),
      'and nothing was backfilled from the unfiltered pool')
  }

  // ── cross-group dedupe ────────────────────────────────────────────────────
  console.log('\n── a piece that fits two strips appears in one ' + '─'.repeat(27))
  {
    // "Shirt Jacket" genuinely matches both garment keys, the way a shacket does.
    const pool = [prod('both', 'Shirt Jacket'), prod('s1', 'Cotton Shirt'), prod('j1', 'Denim Jacket')]
    const { groups } = await run('shirts and jackets', async () => pool)
    const ids = groups.flatMap(g => g.products.map(p => p.id))
    check(ids.filter(i => i === 'both').length === 1,
      'the shared piece is listed once across every strip', `${ids.filter(i => i === 'both').length}×`)
    check(groups[0].products.some(p => p.id === 'both'),
      'and it stays in the FIRST strip that placed it')
  }

  // ── one garment is the caller's problem ───────────────────────────────────
  console.log('\n── fewer than two garments is not a multi-search ' + '─'.repeat(25))
  {
    const { groups, asked } = await run('shirts', async () => [prod('a', 'Cotton Shirt')])
    check(groups === null, 'one garment returns null so the caller runs its own single search')
    check(asked.length === 0, 'and no store was asked anything', asked.length)
  }

  // ── an occasion is an outfit ──────────────────────────────────────────────
  console.log('\n── naming a situation is naming an outfit ' + '─'.repeat(31))
  {
    const { groups, asked } = await run('what do I wear to a job interview', async (q) =>
      [prod('p-' + q, q.split(' ').pop().replace(/^./, c => c.toUpperCase()))])

    same(asked.slice(0, 4), ['men charcoal blazer', 'men white shirt', 'men grey trouser', 'men black derby'],
      'four slots, each carrying its own tone from the occasion palette')
    check(groups !== null && groups.length >= 1, 'and it comes back as strips, not one flat list')
  }

  console.log('\n── the occasion\'s cloth goes on the clothes, not the feet ' + '─'.repeat(14))
  {
    const { asked } = await run('what do I wear to a beach party', async () => [])
    same(asked.slice(0, 3), ['men linen white shirt', 'men linen stone short', 'men white sandal'],
      'linen reaches the shirt and the shorts and NOT the sandal')
    check(!asked.some(q => /linen (sandal|loafer|derby|shoe)/.test(q)),
      'because ninety stores asked for a "linen sandal" answer with whatever they have')
  }

  // ── the colour rung ───────────────────────────────────────────────────────
  console.log('\n── a colour is a preference, not a promise ' + '─'.repeat(30))
  {
    // Nobody stocks a charcoal blazer today. The coloured rung comes back empty
    // and the plain one is tried rather than handing back an empty strip.
    const tone = /charcoal|white|grey|black/
    const { groups, asked } = await run('what do I wear to a job interview', async (q) =>
      tone.test(q) ? [] : [prod('p-' + q, q.split(' ').pop().replace(/^./, c => c.toUpperCase()))])

    check(asked.length === 8, 'every slot tried the coloured query, then the plain one', `${asked.length} questions`)
    check(groups.every(g => !tone.test(g.query)),
      'and each strip reports the query that ACTUALLY produced it',
      JSON.stringify(groups.map(g => g.query)))
    check(groups.every(g => g.products.length > 0), 'so no strip comes back empty')
  }

  // ── sizeForQuery is a closure ─────────────────────────────────────────────
  console.log('\n── the size is resolved per strip, not once ' + '─'.repeat(29))
  {
    const { asked, sized } = await run('what do I wear to a job interview', async () => [])
    same(sized, asked,
      'sizeForQuery is called once per question, with exactly that question')
    check(new Set(sized).size > 1,
      'and it sees several DIFFERENT queries — a value here instead of a closure would put one size on every strip',
      `${new Set(sized).size} distinct`)
  }

  // ── the price register ────────────────────────────────────────────────────
  console.log('\n── one register, and a slot that is out of it ' + '─'.repeat(28))
  {
    // Shirts around ₹1,000, shoes around ₹40,000. The median of the two leads
    // is the register; the whole shirt strip falls outside it.
    const answer = async (q) => (/shirt/.test(q)
      ? Array.from({ length: 3 }, (_, i) => prod(`s${i}`, `Cotton Shirt ${i}`, 1000 + i))
      : Array.from({ length: 3 }, (_, i) => prod(`d${i}`, `Leather Derby ${i}`, 40000 + i)))
    const { groups } = await run('shirts and derbies', answer)

    const shirtStrip = groups.find(g => g.label === 'Shirts')
    check(shirtStrip && shirtStrip.products.length === 3,
      'a slot entirely outside the band keeps every piece — the band is wrong, not the slot',
      shirtStrip && shirtStrip.products.length)
    same(shirtStrip && titles(shirtStrip), ['Cotton Shirt 0', 'Cotton Shirt 1', 'Cotton Shirt 2'],
      'and its order is untouched')
  }

  // ── looks ─────────────────────────────────────────────────────────────────
  console.log('\n── the same strips, read as looks ' + '─'.repeat(39))
  {
    const top = { label: 'Shirts', query: 'shirt', products: Array.from({ length: 6 }, (_, i) => prod(`s${i}`, `Cotton Shirt ${i}`)) }
    const bottom = { label: 'Trousers', query: 'trouser', products: Array.from({ length: 6 }, (_, i) => prod(`t${i}`, `Wool Trousers ${i}`)) }

    const none = await quietly(() => R.looksFrom([top]))
    same(none, [], 'one body part is not an outfit')

    const notBody = await quietly(() => R.looksFrom([
      { label: 'Belts', query: 'belt', products: [prod('b1', 'Leather Belt')] },
      { label: 'Watches', query: 'watch', products: [prod('w1', 'Steel Watch')] },
    ]))
    same(notBody, [], 'and neither are two strips that do not clothe a person')

    // RECORDED, NOT ENDORSED: looksFrom's own comment says "black shirts and
    // white shirts" is declined because the slots are not distinct parts of a
    // body. It is not — two strips that both classify as `top` are composed
    // into looks of two shirts. The guard is on the SLOT CLASS, and both
    // strips pass it. E5 moved this code unchanged, so the harness records
    // what it does rather than what the comment claims.
    const twoTops = await quietly(() => R.looksFrom([top, { ...top, label: 'Shirts' }]))
    check(twoTops.length > 0,
      'two strips of the same slot DO compose today, despite the comment saying otherwise',
      `${twoTops.length} looks of two tops`)

    const looks = await quietly(() => R.looksFrom([top, bottom]))
    check(looks.length >= 1 && looks.length <= 4, 'a top and a bottom make between one and four looks', looks.length)
    same(looks.map(l => l.label), looks.map((_, i) => `Look ${i + 1}`), 'numbered from one, in order')
    check(looks.every(l => l.pieces.length === 2), 'each look has one piece per slot', JSON.stringify(looks.map(l => l.pieces.length)))
    check(looks.every(l => new Set(l.pieces.map(p => p.label)).size === l.pieces.length),
      'and never two pieces from the same slot')
  }

  // ── the refine step ───────────────────────────────────────────────────────
  console.log('\n── relaxing exactly one constraint ' + '─'.repeat(38))
  {
    const asks = () => R.__groq.calls[R.__groq.calls.length - 1]
    const reply = (content) => { R.__groq.reply = async () => ({ content }) }

    reply('men linen shirt')
    check(await R.refineSearchQuery('men sage green linen shirt', 'linen shirt for a wedding') === 'men linen shirt',
      'the broadened query comes back')
    const [messages, system, third, opts] = asks()
    void messages; void system; void third
    check(opts.model === 'stub-fast-model', 'asked of the FAST model, not the stylist model', opts.model)
    check(opts.max_tokens === 40, 'with a 40-token ceiling — this is a query, not a reply', opts.max_tokens)
    check(opts.temperature === 0.2, 'and barely any temperature', opts.temperature)

    reply('"men linen shirt"')
    check(await R.refineSearchQuery('men sage linen shirt', 'x') === 'men linen shirt',
      'quotes the model wrapped it in are stripped')

    reply('men sage green linen shirt')
    check(await R.refineSearchQuery('men sage green linen shirt', 'x') === null,
      'a query that came back unchanged is not a broadening')
    reply('  MEN SAGE GREEN LINEN SHIRT  ')
    check(await R.refineSearchQuery('men sage green linen shirt', 'x') === null,
      'and case and spacing do not sneak the same query through')

    reply('ab')
    check(await R.refineSearchQuery('men linen shirt', 'x') === null, 'two characters is not a query')
    reply('x'.repeat(151))
    check(await R.refineSearchQuery('men linen shirt', 'x') === null, 'and neither is a paragraph')
    reply('')
    check(await R.refineSearchQuery('men linen shirt', 'x') === null, 'an empty answer is a no-op')

    R.__groq.reply = async () => { throw new Error('groq is down') }
    check(await quietly(() => R.refineSearchQuery('men linen shirt', 'x')) === null,
      'and a dead model leaves the original results standing rather than throwing')
  }

  // ── what a store error costs ──────────────────────────────────────────────
  console.log('\n── when one store call throws ' + '─'.repeat(43))
  {
    const { groups } = await quietly(() => run('shirts and shorts', async (q) => {
      if (/short/.test(q)) throw new Error('catalogue exploded')
      return [prod('s1', 'Cotton Shirt')]
    }))
    same(groups.map(g => g.label), ['Shirts'],
      'the strip that worked is still served; the one that threw is dropped, not the whole answer')
  }

  console.log('\n' + (bad === 0
    ? 'retrieval asks the same questions and returns the same shapes as before the move'
    : `${bad} FAILED`))
  process.exit(bad === 0 ? 0 : 1)
}

main().catch(e => { console.error(e); process.exit(1) })
