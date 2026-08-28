/**
 * Who a garment belongs to, and what the catalogue is actually seeing.
 *
 * Two things this file pins, both of which were wrong at b1b0cf3.
 *
 * WHOSE GARMENT IS IT. parseProduct derived the merchant from `store_url` —
 * which is merchant-controlled product data, built three different ways
 * (`variant.url ?? raw.url ?? ''`, absolutised, or SYNTHESISED from the
 * registry domain when the store sends none). So a store answering with URLs
 * on a different host than its registry entry filed under that other host, and
 * — worse — a store answering with an absolute URL for one product and a
 * relative one for the next gave those two products two different merchants
 * out of a single fetch. The registry domain is the one stable answer: it is
 * the destination Discern chose to query, it is versioned in git, and it
 * cannot vary product to product.
 *
 * WHAT THE POOL CONTAINS. Nothing counted anything. `ingest()` drops a product
 * whose raw id is already in the pool — across ALL stores in a query — so a
 * genuine second product carrying a colliding id is discarded in silence.
 * These counters are the record of that, and of the id shapes the 458 UCP
 * endpoints actually emit. They OBSERVE ONLY: nothing here writes a product
 * anywhere, and there is no products table.
 *
 * WHAT THE ALIAS PROBE FOUND, since it is the reason no alias map exists.
 * Seven brands hold two registry entries each. Fourteen live /api/mcp requests
 * were sent, once each: five domains answered, nine did not (four 404s with
 * real HTML bodies, a 405, a DNS failure, a timeout). No pair had both members
 * answer, so no pair produced comparable data, and the pre-declared rule
 * (idOverlap >= 0.5 with titleAgreement >= 0.9, or one domain's URLs pointing
 * at the other) could not fire for any of them. All seven stay unresolved.
 * Of the 180 products that did come back, every id was a Shopify GID and every
 * product URL was self-hosted — which is why test A below has to CONSTRUCT the
 * divergence it checks rather than point at a real store.
 */

process.env.RELEVANCE_RERANK = 'off'
process.env.SEARCH_CACHE = 'off'
process.env.RERANK_PERSISTENT_CACHE = 'off'
delete process.env.NEXT_PUBLIC_CONVEX_URL
delete process.env.CONVEX_AUTH_SECRET

const path = require('path')
const fs = require('fs')
const http = require('http')
const { execFileSync } = require('child_process')

const WEB = path.resolve(__dirname, '..')

function build(entry, name) {
  const out = path.join(WEB, '.vt', name + '.cjs')
  fs.mkdirSync(path.join(WEB, '.vt'), { recursive: true })
  execFileSync(path.join(WEB, 'node_modules/.bin/esbuild'), [
    path.join(WEB, entry), '--bundle', '--platform=node', '--format=cjs',
    '--outfile=' + out, '--log-level=error', '--alias:@=' + WEB,
  ])
  return require(out)
}

let bad = 0
const check = (ok, label, detail) => {
  if (!ok) bad++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail !== undefined ? `  ${detail}` : ''}`)
}
const same = (got, want, label) =>
  check(got === want, label, got === want ? undefined : `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)

const entryFile = path.join(WEB, '.vt', 'corpus-entry.ts')
fs.mkdirSync(path.join(WEB, '.vt'), { recursive: true })
fs.writeFileSync(entryFile,
  `export * from ${JSON.stringify(path.join(WEB, 'lib/services/GlobalCatalogService'))}\n` +
  `export * as P from ${JSON.stringify(path.join(WEB, 'lib/catalog/product'))}\n` +
  `export { corpusWriteObservation } from ${JSON.stringify(path.join(WEB, 'lib/services/corpusWriter'))}\n`)
const C = build('.vt/corpus-entry.ts', 'corpus-identity')

const realFetch = global.fetch
const restore = () => { global.fetch = realFetch }
const RATES = { USD: 1, EUR: 0.9, GBP: 0.8, INR: 83 }
const ucpBody = (products) => JSON.stringify(
  { result: { content: [{ type: 'text', text: JSON.stringify({ products }) }] } })

/** One store's answer, from a handler keyed by the domain that was asked. */
function installFetch(perDomain) {
  global.fetch = async (u) => {
    const url = String(u)
    if (url.includes('open.er-api.com')) {
      return new Response(JSON.stringify({ rates: RATES }), {
        status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (/\/api\/mcp$/.test(url)) {
      const domain = new URL(url).hostname
      const list = perDomain(domain) || []
      return new Response(ucpBody(list), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (url.includes('cdn.shopify.com')) return new Response('not-an-image', { status: 404 })
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  }
}

/** A UCP product. `url` is passed through verbatim so a test can make it
 *  absolute, relative, or absent — which is the whole point of tests A and B. */
const product = (id, title, url, imgId) => ({
  id, title,
  ...(url === undefined ? {} : { url }),
  media: [{ url: `https://cdn.shopify.com/s/files/${imgId || id.replace(/[^a-z0-9]/gi, '')}.jpg` }],
  description: { plain: 'A considered piece, cut from washed linen.' },
  tags: ['shirt', 'linen'],
  options: [{ name: 'Size', values: ['S', 'M', 'L'] }],
  variants: [{ id: `v-${id}`, title: 'M', availability: true,
    price: { amount: 475000, currency: 'USD' },
    ...(url === undefined ? {} : { url }) }],
})

const brandSearch = (q, domains) => C.GlobalCatalogService.search(
  q, undefined, [], 'US', true, [], 'relevance', 'USD', {}, domains, undefined, q, null, null)

let run = 0
const nextQuery = () => `linen shirt corpus ${++run}`

/** The counters, if this build has them. Deltas are what a test asserts on. */
const obs = () => (typeof C.corpusObservation === 'function' ? C.corpusObservation() : null)
const flat = (o) => o && JSON.parse(JSON.stringify(o))
const delta = (a, b) => {
  if (!a || !b) return null
  const d = { seen: b.seen - a.seen, crossMerchantDuplicateIds: b.crossMerchantDuplicateIds - a.crossMerchantDuplicateIds,
              quarantinable: b.quarantinable - a.quarantinable, pooled: b.pooled - a.pooled,
              rejected: {}, idShapes: {} }
  for (const k of Object.keys(b.rejected)) d.rejected[k] = b.rejected[k] - a.rejected[k]
  for (const k of Object.keys(b.idShapes)) d.idShapes[k] = b.idShapes[k] - a.idShapes[k]
  d.distinctMerchants = b.distinctMerchants
  return d
}

// ════════════════════════════════════════════════════════════════════════════
// A. THE PRODUCT URL IS NOT WHO THE MERCHANT IS
// ════════════════════════════════════════════════════════════════════════════
// The registry says we asked kith.com. The store answers with product URLs on
// a different host. The garment belongs to the store we asked, not to whatever
// hostname it chose to put in a field.
//
// CONSTRUCTED, and said plainly: all 180 products in the alias probe were
// self-hosted, so this divergence was not observed in the wild. It is reachable
// by construction — domainMatches() clears kith-shop.example.com against
// kith.com on a first-token prefix match, so such a product is ingested today.
async function urlHostIsNotIdentity() {
  console.log('\n── the product URL is not who the merchant is ' + '─'.repeat(29))
  const q = nextQuery()
  const OTHER = 'https://kith-shop.example.com/products/a'
  installFetch(d => d === 'kith.com'
    ? [product('gid://shopify/Product/A1', 'Plain Linen Shirt', OTHER)]
    : [])
  const r = await brandSearch(q, ['kith.com'])
  restore()

  check(r.length === 1, 'the product survived ingest', `${r.length}`)
  if (!r.length) return
  const p = r[0]

  same(p.source && p.source.merchant, 'kith.com',
    'source.merchant is the registry domain we asked')
  check(String(p.key).startsWith('kith.com::'), 'and the key is filed under it', p.key)

  // The shopper-facing URL must not move. This is a provenance change, not a
  // rewrite of where checkout sends anybody.
  same(p.store_url, OTHER, 'the store_url the shopper follows is untouched')
  same(p.id, 'gid://shopify/Product/A1', 'and the merchant\'s own id is untouched')
}

// ════════════════════════════════════════════════════════════════════════════
// B. ONE STORE, ONE MERCHANT — WHATEVER SHAPE ITS URLS TAKE
// ════════════════════════════════════════════════════════════════════════════
// The sharper half of the same defect. `variant.url ?? raw.url ?? ''` means one
// fetch can yield an absolute URL for one product and a relative one for the
// next; the relative one is absolutised onto the registry domain and the
// absolute one is not. Two products, one store, two merchants.
async function oneStoreOneMerchant() {
  console.log('\n── one store, one merchant, whatever its URLs look like ' + '─'.repeat(19))
  const q = nextQuery()
  installFetch(d => d === 'kith.com' ? [
    product('gid://shopify/Product/B1', 'Plain Linen Shirt One', 'https://kith-shop.example.com/products/b1'),
    product('gid://shopify/Product/B2', 'Plain Linen Shirt Two', '/products/b2'),
    product('gid://shopify/Product/B3', 'Plain Linen Shirt Three', undefined),
  ] : [])
  const r = await brandSearch(q, ['kith.com'])
  restore()

  check(r.length === 3, 'all three shapes survived ingest', `${r.length}`)
  const merchants = Array.from(new Set(r.map(p => p.source && p.source.merchant)))
  check(merchants.length === 1 && merchants[0] === 'kith.com',
    'absolute, relative and absent URLs give ONE merchant', merchants.join(','))
  const keyed = Array.from(new Set(r.map(p => String(p.key).split('::')[0])))
  check(keyed.length === 1 && keyed[0] === 'kith.com', 'and one key namespace', keyed.join(','))

  // Each product keeps its own URL, whatever it was.
  const urls = r.map(p => p.store_url).sort()
  check(urls.some(u => u.startsWith('https://kith-shop.example.com/')), 'the absolute URL is preserved')
  check(urls.some(u => u === 'https://kith.com/products/b2'), 'the relative one is still absolutised onto the store')
}

// ════════════════════════════════════════════════════════════════════════════
// C. TWO SHOPS, ONE RAW ID
// ════════════════════════════════════════════════════════════════════════════
async function twoShopsOneId() {
  console.log('\n── two shops, one raw id ' + '─'.repeat(49))
  const DUP = 'gid://shopify/Product/999999'

  // C1 — self-hosted URLs. Distinct today and after: a preservation guard,
  // NOT a differential, and labelled so.
  {
    const q1 = nextQuery()
    installFetch(d => d === 'kith.com' ? [product(DUP, 'Shirt From Kith', `https://kith.com/products/x`, 'c1a')] : [])
    const a = await brandSearch(q1, ['kith.com'])
    const q2 = nextQuery()
    installFetch(d => d === 'aloyoga.com' ? [product(DUP, 'Shirt From Alo', `https://aloyoga.com/products/x`, 'c1b')] : [])
    const b = await brandSearch(q2, ['aloyoga.com'])
    restore()
    check(a.length === 1 && b.length === 1, 'both shops answered', `${a.length}/${b.length}`)
    if (a.length && b.length) {
      check(a[0].key !== b[0].key, 'PRESERVED: self-hosted, the keys already differed', `${a[0].key} vs ${b[0].key}`)
      same(a[0].id, b[0].id, 'even though the merchants\' own ids are identical')
    }
  }

  // C2 — both shops answering with URLs on ONE shared host. Before the merchant
  // precedence correction both products took their merchant from that host, so
  // one raw id became ONE key across two shops.
  //
  // WHAT THIS IS, EXACTLY. A CORPUS-LEVEL identity collision, demonstrated
  // across two INDEPENDENT searches. It is NOT a proof that both products
  // survive one ingest pass, and it must never be read as one:
  //
  //   - search A and search B use different queries and different brand lists,
  //     so makeCacheKey gives them different cache scopes and different pools;
  //   - the two products therefore never meet the same `seen` set, and the
  //     dedupe branch is never consulted about them;
  //   - what is proved is that productKey is MERCHANT-SCOPED — the same raw id
  //     from two shops yields two keys, so a future corpus would file two
  //     records rather than overwrite one;
  //   - what is NOT proved, and is not true, is that live ingest dedupe has
  //     been re-keyed. It still dedupes on the bare `raw.id`, across every
  //     store in a query, exactly as it did before this phase.
  //
  // BOTH-PRODUCTS-SURVIVE-ONE-INGEST IS INTENTIONALLY DEFERRED to the future
  // phase that re-keys dedupe from `raw.id` to productKey. Until then the
  // second shop's garment is still dropped, and `crossMerchantDuplicateIds`
  // (test D) is the counter that records the drop.
  {
    const SHARED = 'https://shop.example.com/products/x'
    const q1 = nextQuery()
    installFetch(d => d === 'kith.com' ? [product(DUP, 'Shirt From Kith', SHARED, 'c2a')] : [])
    const a = await brandSearch(q1, ['kith.com'])
    const q2 = nextQuery()
    installFetch(d => d === 'aloyoga.com' ? [product(DUP, 'Shirt From Alo', SHARED, 'c2b')] : [])
    const b = await brandSearch(q2, ['aloyoga.com'])
    restore()
    check(a.length === 1 && b.length === 1,
      'two INDEPENDENT searches, one product each — not one ingest pass', `${a.length}/${b.length}`)
    if (a.length && b.length) {
      check(a[0].key !== b[0].key,
        'a shared URL host does NOT merge two shops\' corpus records', `${a[0].key} vs ${b[0].key}`)
      same(a[0].source && a[0].source.merchant, 'kith.com', 'the first is filed under the shop we asked')
      same(b[0].source && b[0].source.merchant, 'aloyoga.com', 'and the second under the shop we asked')
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// D. OBSERVATION — AND THE DROP NOBODY COUNTED
// ════════════════════════════════════════════════════════════════════════════
// ingest() dedupes on the bare raw id across every store in one query, so when
// two shops answer with the same id the second product is discarded. That is
// the one place a collision is visible, and it is where the counter lives.
// Nothing here writes a product anywhere.
async function observation() {
  console.log('\n── what the pool actually contained ' + '─'.repeat(38))
  if (!obs()) {
    check(false, 'GlobalCatalogService exports corpusObservation()', 'not exported')
    return
  }

  const DUP = 'gid://shopify/Product/777777'
  const before = flat(obs())
  const q = nextQuery()
  // Six survivors on purpose. Below five, search() decides the pool is thin and
  // runs its second-chance recall — three more queries across both stores, so
  // ingest sees the same fixture four times over and every count is 4x. That
  // is correct behaviour and correct counting; it is just not what this test is
  // trying to isolate.
  installFetch(d => {
    if (d === 'kith.com') return [
      product(DUP, 'Shirt From Kith', 'https://kith.com/products/k1', 'd1'),
      product('gid://shopify/Product/D2', 'Second Kith Shirt', 'https://kith.com/products/k2', 'd2'),
      product('gid://shopify/Product/D6', 'Third Kith Shirt', 'https://kith.com/products/k6', 'd6'),
      product('gid://shopify/Product/D7', 'Fourth Kith Shirt', 'https://kith.com/products/k7', 'd7'),
      product('12345', 'Numeric Id Shirt', 'https://kith.com/products/k3', 'd3'),
      product('kith-handle-shirt', 'Handle Id Shirt', 'https://kith.com/products/k4', 'd4'),
      { ...product('gid://shopify/Product/D5', 'Scented Candle', 'https://kith.com/products/k5', 'd5'), tags: ['candle'] },
      { id: '', title: 'No Id At All', media: [{ url: 'https://cdn.shopify.com/x.jpg' }], variants: [] },
    ]
    if (d === 'aloyoga.com') return [
      product(DUP, 'Shirt From Alo', 'https://aloyoga.com/products/a1', 'd8'),
    ]
    return []
  })
  const pool = await brandSearch(q, ['kith.com', 'aloyoga.com'])
  restore()
  const d = delta(before, flat(obs()))

  check(pool.length === 6, 'six products survived, so no recall pass ran', `${pool.length}`)
  same(d.seen, 9, 'seen counts every raw product ingest looked at')
  same(d.rejected.noId, 1, 'one raw product had no id')
  same(d.rejected.nonFashion, 1, 'one was a candle')
  same(d.rejected.duplicateId, 1, 'one was a duplicate id')
  same(d.crossMerchantDuplicateIds, 1,
    'and that duplicate came from a DIFFERENT shop — the silent drop, counted')
  // Raw-level: every id ingest saw, including the deduped one and the candle.
  same(d.idShapes.gid, 6, 'six RAW ids were Shopify GIDs')
  same(d.idShapes.numeric, 1, 'one was bare numeric')
  same(d.idShapes.other, 1, 'one was neither')
  check(d.distinctMerchants >= 2, 'at least two merchants were seen', String(d.distinctMerchants))

  // Quarantine is a judgement about a record, not a filter on the page.
  const before2 = flat(obs())
  const q2 = nextQuery()
  installFetch(d2 => d2 === 'kith.com' ? [
    { ...product('gid://shopify/Product/Q1', 'Free Shirt', 'https://kith.com/products/q1', 'q1'),
      variants: [{ id: 'v-q1', title: 'M', availability: true, price: { amount: 0, currency: 'USD' },
                   url: 'https://kith.com/products/q1' }] },
    product('gid://shopify/Product/Q2', 'Priced Shirt', 'https://kith.com/products/q2', 'q2'),
  ] : [])
  const page = await brandSearch(q2, ['kith.com'])
  restore()
  const d2 = delta(before2, flat(obs()))
  same(d2.quarantinable, 1, 'a zero-priced record is counted as quarantinable')
  check(page.length === 2, 'and is STILL served — nothing is quarantined', `${page.length}`)

  // ── and a THIRD population, which must not be confused with these two ────
  // The corpus writer keeps its own counters over its own population: `offered`
  // is per WRITE, over the snapshot a search handed it, after the pool has
  // already been deduped. It is not `seen` (raw arrivals, pre-dedupe) and it is
  // not `pooled` (post-dedupe, re-counted on every serving search). Three
  // stages, three denominators, and no ratio between them means anything.
  // Keeping the two counter objects genuinely separate is what makes that
  // true rather than merely documented.
  const catalogueKeys = Object.keys(flat(obs()))
  const writeKeys = typeof C.corpusWriteObservation === 'function'
    ? Object.keys(C.corpusWriteObservation()) : null
  check(writeKeys !== null, 'the corpus writer reports its own counters', writeKeys ? '' : 'MISSING')
  if (writeKeys) {
    const overlap = catalogueKeys.filter(k => writeKeys.includes(k))
    check(overlap.length === 0,
      'and shares not one field name with the catalogue\'s', overlap.join(',') || 'disjoint')
    check(writeKeys.includes('offered') && catalogueKeys.includes('seen') && catalogueKeys.includes('pooled'),
      'three populations, three names: seen (raw) · pooled (post-dedupe) · offered (per write)')
  }
}

// ════════════════════════════════════════════════════════════════════════════
// F. ID SHAPES ARE WHAT THE ENDPOINTS SENT
// ════════════════════════════════════════════════════════════════════════════
// The counters exist to answer "what shape are the ids these 458 independent
// UCP endpoints emit". Measured over the surviving pool that question cannot
// be answered: a product deduped away, or dropped as non-fashion, or dropped
// for pointing off the registry, or dropped for having no photograph, still
// CAME FROM AN ENDPOINT and still had an id with a shape — and the pool has
// none of them. Worse, the pool is re-observed on every search including
// load-more, so shapes were weighted by how often a product was served rather
// than by how many distinct ids arrived.
//
// So the shape is read at the raw level, immediately after the no-id check and
// before every downstream decision. The invariant that makes the denominator
// derivable: gid + numeric + other === seen - rejected.noId.
async function idShapesAreRaw() {
  console.log('\n── the ids the endpoints actually sent ' + '─'.repeat(35))
  if (!obs()) { check(false, 'GlobalCatalogService exports corpusObservation()', 'not exported'); return }

  const S1 = 'gid://shopify/Product/F1'
  const before = flat(obs())
  const q = nextQuery()
  // Five survivors, so the thin-pool recall pass never runs and one ingest
  // pass is exactly what is measured.
  installFetch(d => d === 'kith.com' ? [
    product(S1, 'First Linen Shirt', 'https://kith.com/products/f1', 'f1'),
    product('gid://shopify/Product/F2', 'Second Linen Shirt', 'https://kith.com/products/f2', 'f2'),
    product('gid://shopify/Product/F3', 'Third Linen Shirt', 'https://kith.com/products/f3', 'f3'),
    product('90210', 'Numeric Id Shirt', 'https://kith.com/products/f4', 'f4'),
    product('handle-shirt', 'Handle Id Shirt', 'https://kith.com/products/f5', 'f5'),
    // …and five that never reach the pool, each of which still has an id.
    product(S1, 'Duplicate Of The First', 'https://kith.com/products/f1', 'f6'),
    { ...product('77', 'Scented Candle', 'https://kith.com/products/f7', 'f7'), tags: ['candle'] },
    product('off-reg-handle', 'Off Registry Shirt', 'https://zzzqqqxyz.example.org/products/f8', 'f8'),
    { id: 'gid://shopify/Product/F9', title: 'No Photograph Shirt', url: 'https://kith.com/products/f9',
      description: { plain: 'x' }, tags: ['shirt'], variants: [] },   // no media -> parseProduct returns null
    { id: '', title: 'No Id At All', media: [{ url: 'https://cdn.shopify.com/f10.jpg' }], variants: [] },
  ] : [])
  const page = await brandSearch(q, ['kith.com'])
  restore()
  const d = delta(before, flat(obs()))

  check(page.length === 5, 'five products reached the page', `${page.length}`)
  same(d.seen, 10, 'ten raw products reached ingest')
  same(d.pooled, 5, 'five of them were pooled')
  same(d.rejected.noId, 1, 'one had no id')
  same(d.rejected.duplicateId, 1, 'one was a duplicate')
  same(d.rejected.nonFashion, 1, 'one was a candle')
  same(d.rejected.offRegistry, 1, 'one pointed off the registry')
  same(d.rejected.unparseable, 1, 'one had no photograph')

  // The point of the correction: the five that never reached the pool still
  // told us what shape their ids were.
  same(d.idShapes.gid, 5, 'five raw ids were GIDs — three pooled, one deduped, one unparseable')
  same(d.idShapes.numeric, 2, 'two were bare numerics — one pooled, one a candle')
  same(d.idShapes.other, 2, 'two were neither — one pooled, one off-registry')

  const total = d.idShapes.gid + d.idShapes.numeric + d.idShapes.other
  same(total, d.seen - d.rejected.noId,
    'and every id ingest saw has a shape: gid+numeric+other === seen - noId')

  // Observing the same pool again must not move the shapes. The second search
  // hits the warm entry: no store is queried, ingest never runs, and only
  // observePool fires.
  const before2 = flat(obs())
  installFetch(() => [])
  await brandSearch(q, ['kith.com'])
  restore()
  const d2 = delta(before2, flat(obs()))
  same(d2.seen, 0, 'a repeat search re-ingests nothing')
  same(d2.pooled, 5, 'but the pool is observed again')
  same(d2.idShapes.gid + d2.idShapes.numeric + d2.idShapes.other, 0,
    'and the id shapes do NOT move — they count arrivals, not servings')
}

// ════════════════════════════════════════════════════════════════════════════
// E. A RESHOT GARMENT, IN A WARM PROCESS
// ════════════════════════════════════════════════════════════════════════════
// profileKey is product + image + schema + prompt + model, and the Convex layer
// respects all five. The in-memory map in enrichProduct was keyed on the bare
// product id, so a warm instance kept answering with the profile of a
// photograph the brand had already replaced. scripts/profile-cache.js proves
// profileKey CHANGES on a reshoot; nothing proved the memory honoured it.
function profileMemory() {
  return new Promise((resolve) => {
    console.log('\n── a reshot garment, in a warm process ' + '─'.repeat(35))
    const PROFILE = {
      garment: 'shirt', fit: 'relaxed', volume: 'boxy', fabric: 'linen',
      weight: 'light', drape: 'fluid', pattern: 'plain', patternScale: 'none',
      colour: 'ecru', formality: 2, aesthetic: 'minimal', season: 'summer',
      details: ['camp collar'], quality: 2,
    }
    let visionCalls = 0
    const server = http.createServer((req, res) => {
      let body = ''
      req.on('data', c => (body += c))
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        visionCalls++
        res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify(PROFILE) } }] }))
      })
    })
    server.listen(0, async () => {
      const port = server.address().port
      process.env.GROQ_API_KEY = 'mock'
      process.env.GROQ_BASE_URL = `http://127.0.0.1:${port}`
      process.env.PROFILE_PERSISTENT_CACHE = 'off'   // memory is what is under test
      process.env.ENRICH_VISION = 'on'
      process.env.ENRICH_TIMEOUT_MS = '8000'
      for (const k of Object.keys(require.cache)) if (k.includes('/.vt/')) delete require.cache[k]
      const { profilesFor } = build('lib/services/enrichProduct.ts', 'corpus-enrich')

      const P = (img) => [{ id: 'p1', title: 'Boxy Linen Camp Shirt', description: '', image_url: img }]
      const FIRST = 'https://cdn.shopify.com/p1.jpg'
      const RESHOT = 'https://cdn.shopify.com/p1-v2.jpg'

      let got = await profilesFor(P(FIRST))
      check(got.size === 1 && visionCalls === 1, 'the garment is read once', `${visionCalls} vision call(s)`)

      got = await profilesFor(P(FIRST))
      check(got.size === 1 && visionCalls === 1,
        'PRESERVED: the same photograph is answered from memory, free', `${visionCalls} call(s)`)

      got = await profilesFor(P(RESHOT))
      check(visionCalls === 2,
        'a RESHOT garment is read again — memory honours the image', `${visionCalls} call(s)`)
      check(got.size === 1, 'and a profile still comes back', `${got.size}`)

      got = await profilesFor(P(RESHOT))
      check(visionCalls === 2, 'and the new photograph is then remembered too', `${visionCalls} call(s)`)

      server.close(() => resolve())
    })
  })
}

// ── run ─────────────────────────────────────────────────────────────────────
;(async () => {
  console.log('\nwhose garment is it, and what did the catalogue see\n')
  try {
    await urlHostIsNotIdentity()
    await oneStoreOneMerchant()
    await twoShopsOneId()
    await observation()
    await idShapesAreRaw()
    await profileMemory()
  } catch (e) {
    check(false, 'the harness ran to completion', e instanceof Error ? (e.stack || e.message) : String(e))
  } finally {
    restore()
  }
  console.log(bad === 0
    ? '\na garment belongs to the shop we asked, and the pool is counted\n'
    : `\n${bad} FAILED\n`)
  process.exit(bad === 0 ? 0 : 1)
})()
