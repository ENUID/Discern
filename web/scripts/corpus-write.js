/**
 * The first thing Discern owns.
 *
 * Every product this app has ever shown came from somebody else's server and
 * was thrown away thirty seconds later. lib/stylist/trace.ts says, of the ids
 * it records, that "the price, the variants and the images are all recoverable
 * from the id, which is the point of having one" — and that has never been
 * true, because nothing kept them. This is the store that makes it true.
 *
 * WRITE-ONLY, and that is the whole design of this phase. Nothing reads the
 * corpus. `convex/products.ts` deliberately exports no query at all, so "no
 * corpus read can enter retrieval" is guaranteed by there being nothing to
 * call rather than by anyone remembering not to call it. The live catalogue
 * still dedupes on the bare `raw.id`, still ranks the same way, still returns
 * the same page; the corpus is a shadow taken on the way past.
 *
 * WHAT IS BEING PINNED HERE:
 *   ONE ROW PER GARMENT      the same product seen twice is one record whose
 *                            lastSeenAt moves and whose identity does not
 *   CONTENT, NOT CLOCK       a re-observation that changed nothing writes no
 *                            new content hash and no new lastChangedAt
 *   TWO SHOPS, TWO ROWS      one sourceId from two merchants is two garments
 *                            in the corpus — while the live path still returns
 *                            ONE product, because its dedupe is untouched
 *   NOTHING LEAKS BACK       a write that fails, a Convex that is down, a
 *                            malformed row: the shopper's page is identical
 *
 * NO NETWORK. The store fan-out, the image reads and Convex itself are all
 * stubbed — Convex by a local HTTP server standing in for it, the same way
 * scripts/profile-cache.js already does.
 */

process.env.RELEVANCE_RERANK = 'off'
process.env.SEARCH_CACHE = 'off'
process.env.PROFILE_PERSISTENT_CACHE = 'off'
process.env.ENRICH_VISION = 'off'
process.env.CORPUS_WRITE = 'on'

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

// ── the corpus, as Convex would hold it ─────────────────────────────────────
//
// THE REAL MUTATION HANDLER RUNS HERE. Convex's mutationGeneric hangs the raw
// handler off the returned function as `_handler` (see
// node_modules/convex/dist/cjs/server/impl/registration_impl.js), so this
// harness executes convex/products.ts itself against an in-memory ctx.db
// rather than reimplementing what it is supposed to be testing. The freshness
// bucket, the insert/patch decision and the contentHash comparison are all the
// production ones.
//
// WHAT THIS MOCK DOES NOT PROVE: it is a single-threaded stand-in, so it says
// nothing about Convex's own transaction isolation or optimistic-concurrency
// retries. Those are established from the vendored type declarations
// ("Mutations run transactionally, all reads and writes within a single
// mutation are atomic and isolated"), not from this file.
let rowsById = new Map()
let nextId = 0
/** Every mutation the writer sent, so batching can be counted. */
let mutations = []
/** Rows the handler actually WROTE — inserts plus patches. The amplification
 *  measurement is this number, not the number of rows offered. */
let dbWrites = 0
/** Index lookups the handler performed. The server-side freshness bucket
 *  removes writes but not these: reaching it costs one read per row. */
let dbReads = 0
/** Rows the writer put on the wire, summed across batches. */
let rowsOffered = 0
/** Reads of the corpus. Must stay at zero: nothing may read it. */
let corpusQueries = 0
/** When set, every mutation fails — the failure-isolation test. */
let convexBroken = false

const byKey = (k) => Array.from(rowsById.values()).find(r => r.key === k)

/** Just enough of Convex's DatabaseWriter for this one handler. */
const fakeDb = {
  query: () => ({
    withIndex: (_name, fn) => {
      let want
      fn({ eq: (_field, val) => { want = val; return {} } })
      dbReads++
      return { first: async () => byKey(want) ?? null }
    },
  }),
  insert: async (_table, doc) => {
    const _id = `row${++nextId}`
    rowsById.set(_id, { _id, ...doc })
    dbWrites++
    return _id
  },
  patch: async (_id, patch) => {
    Object.assign(rowsById.get(_id), patch)
    dbWrites++
  },
}

const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', c => (body += c))
  req.on('end', () => {
    const json = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)) }
    if (req.url.includes('/api/query')) {
      // Only a read of the CORPUS counts. Other modules legitimately query
      // Convex on the search path — relevanceAdjustments and trendConcepts both
      // do — and counting those would make this assertion meaningless.
      if (/\bproducts[:.]/.test(body)) corpusQueries++
      return json({ status: 'success', value: [] })
    }
    if (req.url.includes('/api/mutation')) {
      const { args } = JSON.parse(body)
      const a = args?.[0] ?? {}
      mutations.push((a.entries ?? []).length)
      rowsOffered += (a.entries ?? []).length
      if (convexBroken) return json({ status: 'error', errorMessage: 'convex is down' })
      // The REAL handler, against the in-memory db above.
      REAL_UPSERT(fakeDb, a)
        .then(v => json({ status: 'success', value: v }))
        .catch(e => json({ status: 'error', errorMessage: String(e && e.message) }))
      return
    }
    return json({ status: 'success', value: null })
  })
})
/** Bound once the bundle is built. */
let REAL_UPSERT = async () => { throw new Error('handler not bound') }

/** The rows the handler wrote, addressed by product key, so the assertions
 *  below read as questions about the corpus rather than about a Map. */
const store = {
  get: (k) => byKey(k),
  get size() { return rowsById.size },
  keys: () => Array.from(rowsById.values()).map(r => r.key),
}

// ── the stores, and the shopper ─────────────────────────────────────────────
// EUR and GBP are load-bearing: getExchangeRates rejects a rate table that
// lacks them and falls through to a SECOND provider on a different host —
// which the "no new network request" assertion below then catches, correctly.
const RATES = { USD: 1, EUR: 0.9, GBP: 0.8, INR: 83 }
const ucpBody = (products) => JSON.stringify(
  { result: { content: [{ type: 'text', text: JSON.stringify({ products }) }] } })

/** A UCP product with everything the canonical shape reads. */
const product = (o) => ({
  id: o.id,
  title: o.title ?? 'Plain Linen Shirt',
  url: o.url ?? `https://${o.host ?? 'kith.com'}/products/${String(o.id).replace(/[^a-z0-9]/gi, '')}`,
  media: o.noImage ? [] : [{ url: `https://cdn.shopify.com/s/files/${o.img ?? String(o.id).replace(/[^a-z0-9]/gi, '')}.jpg` }],
  description: { plain: o.description ?? 'A considered piece, cut from washed linen.' },
  tags: o.tags ?? ['shirt', 'linen'],
  options: [{ name: 'Size', values: o.sizes ?? ['S', 'M', 'L'] }],
  // `available`, not `availability`. readAvailability reads
  // `v.availability?.available` then `v.available`; a bare boolean under
  // `availability` matches neither, so it reads as UNKNOWN and the optimistic
  // default makes every product in stock. Getting this wrong is why the
  // sold-out case below silently passed as in-stock on the first run.
  variants: (o.variants ?? [{ id: `v-${o.id}`, price: o.price ?? 475000, available: o.available !== false }])
    .map(v => ({
      id: v.id, title: v.title ?? 'M', available: v.available !== false,
      price: { amount: v.price ?? 475000, currency: 'USD' },
      url: o.url ?? `https://${o.host ?? 'kith.com'}/products/${String(o.id).replace(/[^a-z0-9]/gi, '')}`,
    })),
})

const realFetch = global.fetch
const restore = () => { global.fetch = realFetch }
let externalCalls = []

function installFetch(perDomain, convexBase) {
  global.fetch = async (u, init) => {
    const url = String(u)
    if (url.startsWith(convexBase)) {
      return realFetch(u, init)             // the local stand-in for Convex
    }
    if (url.includes('open.er-api.com')) {
      return new Response(JSON.stringify({ rates: RATES }), {
        status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (/\/api\/mcp$/.test(url)) {
      const domain = new URL(url).hostname
      return new Response(ucpBody(perDomain(domain) || []), {
        status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (url.includes('cdn.shopify.com')) return new Response('no', { status: 404 })
    externalCalls.push(url)                 // anything else is a new network call
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  }
}

/** The write happens behind the response, so a test has to let it land.
 *  Waits until no further mutation arrives, bounded. */
async function settle(ms = 900) {
  const deadline = Date.now() + ms
  let last = -1
  while (Date.now() < deadline) {
    const now = mutations.length
    if (now === last && now >= 0) { await new Promise(r => setTimeout(r, 60)); if (mutations.length === now) return }
    last = now
    await new Promise(r => setTimeout(r, 60))
  }
}

let run = 0
const nextQuery = () => `linen shirt corpus write ${++run}`

;(async () => {
  console.log('\nthe first thing Discern owns\n')

  const hasWriter = fs.existsSync(path.join(WEB, 'lib/services/corpusWriter.ts'))
  if (!hasWriter) {
    check(false, 'lib/services/corpusWriter.ts exists', 'no corpus writer')
    check(false, 'a product observed twice is one durable row', 'nothing persists a product')
    check(false, 'a price change updates an owned corpus row', 'no corpus row to update')
    check(false, 'a corpus write failure is isolated from the shopper', 'no corpus write to fail')
    console.log(`\n${bad} FAILED\n`)
    process.exit(1)
  }

  const entryFile = path.join(WEB, '.vt', 'corpus-write-entry.ts')
  fs.mkdirSync(path.join(WEB, '.vt'), { recursive: true })
  fs.writeFileSync(entryFile,
    `export { GlobalCatalogService } from ${JSON.stringify(path.join(WEB, 'lib/services/GlobalCatalogService'))}\n` +
    `export * as W from ${JSON.stringify(path.join(WEB, 'lib/services/corpusWriter'))}\n` +
    `export * as PRODUCTS from ${JSON.stringify(path.join(WEB, 'convex/products'))}\n`)

  await new Promise(r => server.listen(0, r))
  const port = server.address().port
  const convexBase = `http://127.0.0.1:${port}`
  process.env.NEXT_PUBLIC_CONVEX_URL = convexBase
  process.env.CONVEX_AUTH_SECRET = 'stub-secret'

  const C = build('.vt/corpus-write-entry.ts', 'corpus-write')
  const W = C.W
  const handler = C.PRODUCTS && C.PRODUCTS.upsertMany && C.PRODUCTS.upsertMany._handler
  check(typeof handler === 'function',
    'the REAL convex upsertMany handler is what these tests run', handler ? '' : 'not reachable')
  REAL_UPSERT = (db, args) => handler({ db }, args)

  const search = (q, domains, currency = 'USD') => C.GlobalCatalogService.search(
    q, undefined, [], 'US', true, [], 'relevance', currency, {}, domains, undefined, q, null, null)

  const obs = () => (typeof W.corpusWriteObservation === 'function' ? W.corpusWriteObservation() : null)
  const flat = (o) => o && JSON.parse(JSON.stringify(o))

  try {
    // ══════════════════════════════════════════════════════════════════════
    // 0a. WHAT COUNTS AS A CHANGE — hash equality, asserted directly
    // ══════════════════════════════════════════════════════════════════════
    // Asserted on the HASH itself rather than on "did a row update", because a
    // test that only watches for an update cannot tell a real merchant change
    // from serialisation noise — which is exactly how the defect this section
    // pins got through the first time.
    //
    // SET-LIKE, order carries nothing:  tags · categories · variants · options
    // SEQUENCE-LIKE, order is content:  options[].values · media
    //   media because media[0] decides image_url; option values because
    //   XS,S,M,L is a size run and not a bag of labels.
    console.log('── what counts as a change ' + '─'.repeat(47))
    {
      const H = W.contentHash
      const base = {
        key: 'k::1', source: { merchant: 'k', sourceId: '1', via: 'ucp-mcp', fetchedAt: 1, schema: 1 },
        id: '1', title: 'Shirt', vendor: 'V', price: 47.5, currency: 'USD',
        store_url: 'https://k.com/p/1', image_url: 'https://cdn/1.jpg', in_stock: true,
        tags: ['linen', 'shirt', 'mens'],
        categories: ['gid://a', 'gid://b'],
        description: 'd', description_html: '<p>d</p>',
        options: [{ name: 'Size', values: ['S', 'M'] }, { name: 'Color', values: ['Ecru'] }],
        media: [{ type: 'image', url: 'https://cdn/1.jpg', alt: 'a' }, { type: 'image', url: 'https://cdn/2.jpg', alt: 'b' }],
        variants: [
          { id: 'v1', title: 'S', price: 47.5, availability: true, options: [{ name: 'Size', label: 'S' }], media: [] },
          { id: 'v2', title: 'M', price: 47.5, availability: true, options: [{ name: 'Size', label: 'M' }], media: [] },
        ],
      }
      const h0 = H(base)
      const w = (o) => H({ ...base, ...o })
      const rev = (a) => [...a].reverse()

      same(w({}), h0, 'an identical observation hashes the same')
      // LOAD-BEARING — every one of these moved the hash before the correction.
      same(w({ tags: rev(base.tags) }), h0, 'tags REORDERED — same garment, same hash')
      same(w({ categories: rev(base.categories) }), h0, 'categories REORDERED — same hash')
      same(w({ variants: rev(base.variants) }), h0, 'variants REORDERED — same hash')
      same(w({ options: rev(base.options) }), h0, 'options REORDERED — same hash')
      same(H(Object.fromEntries(Object.entries(base).reverse())), h0,
        'and the source object\'s own key order is irrelevant')

      // PRESERVATION — these are sequences, and reordering them IS a change.
      check(w({ media: rev(base.media) }) !== h0, 'media reordered DOES move the hash — media[0] is image_url')
      check(w({ options: [{ name: 'Size', values: ['M', 'S'] }, base.options[1]] }) !== h0,
        'option VALUES reordered DOES move it — a size run is not a set')

      // PRESERVATION — real merchant changes still register.
      for (const [label, o] of [
        ['price', { price: 99 }], ['title', { title: 'Other' }], ['stock', { in_stock: false }],
        ['a tag added', { tags: [...base.tags, 'ss26'] }],
        ['a variant sold out', { variants: [{ ...base.variants[0], availability: false }, base.variants[1]] }],
        ['a variant added', { variants: [...base.variants, { id: 'v3', title: 'L', price: 47.5, availability: true, options: [], media: [] }] }],
      ]) check(w(o) !== h0, `a real change still moves it: ${label}`)
    }

    // ══════════════════════════════════════════════════════════════════════
    // 0b. THE FRESHNESS BUCKET — against the real handler, on a stubbed clock
    // ══════════════════════════════════════════════════════════════════════
    // Driven through convex/products.ts's own handler, so the bucket under
    // test is the production one. The clock is stubbed only around the calls;
    // no production code learns about it.
    console.log('\n── how often a re-observation is worth a write ' + '─'.repeat(28))
    {
      const saved = Date.now
      const rows = new Map(); let n = 0
      const db = {
        query: () => ({ withIndex: (_x, f) => { let want; f({ eq: (_k, v) => { want = v; return {} } })
          return { first: async () => Array.from(rows.values()).find(r => r.key === want) ?? null } } }),
        insert: async (_t, d) => { const _id = `r${++n}`; rows.set(_id, { _id, ...d }); return _id },
        patch: async (_id, p) => Object.assign(rows.get(_id), p),
      }
      const row = (hash) => ({
        key: 'k::bucket', merchant: 'k', sourceId: 'bucket', title: 'T', vendor: 'V',
        price: 10, currency: 'USD', storeUrl: 'https://k.com/p', imageUrl: 'https://cdn/i.jpg',
        inStock: true, payload: '{}', via: 'ucp-mcp', schema: 1, contentHash: hash, status: 'active',
      })
      const at = async (t, hash) => {
        Date.now = () => t
        try { return await REAL_UPSERT(db, { entries: [row(hash)], serverSecret: 'stub-secret' }) }
        finally { Date.now = saved }
      }
      const T0 = 1_700_000_000_000
      const r1 = await at(T0, 'h1')
      const held = () => Array.from(rows.values())[0]
      same(r1.inserted, 1, 'first sighting inserts')
      same(held().firstSeenAt, T0, '  firstSeenAt set')
      same(held().lastSeenAt, T0, '  lastSeenAt set')

      // LOAD-BEARING: before the correction this patched lastSeenAt every time.
      const r2 = await at(T0 + 60_000, 'h1')
      same(r2.unchanged, 1, 'a minute later, unchanged content')
      same(held().lastSeenAt, T0, '  and lastSeenAt is NOT rewritten')

      const r3 = await at(T0 + 14 * 60_000, 'h1')
      same(held().lastSeenAt, T0, 'still not rewritten at fourteen minutes')
      check(r3.unchanged === 1, '  counted as unchanged')

      const r4 = await at(T0 + 16 * 60_000, 'h1')
      same(held().lastSeenAt, T0 + 16 * 60_000, 'past the bucket, lastSeenAt DOES advance')
      check((r4.refreshed ?? 0) === 1, '  and it is reported as a refresh, not an update',
        `refreshed=${r4.refreshed}`)
      same(held().firstSeenAt, T0, '  firstSeenAt still untouched')
      same(held().lastChangedAt, T0, '  and lastChangedAt still means CHANGED, not SEEN')

      // PRESERVATION: a real change writes immediately, bucket or no bucket.
      const r5 = await at(T0 + 16 * 60_000 + 1000, 'h2')
      same(r5.updated, 1, 'a changed hash writes at once, inside the bucket')
      same(held().lastChangedAt, T0 + 16 * 60_000 + 1000, '  lastChangedAt moves')
      same(held().firstSeenAt, T0, '  firstSeenAt never does')
      same(Date.now, saved, 'the clock is put back')
    }

    // ══════════════════════════════════════════════════════════════════════
    // 1. ONE GARMENT, ONE ROW
    // ══════════════════════════════════════════════════════════════════════
    console.log('── the same garment, twice ' + '─'.repeat(47))
    const P1 = 'gid://shopify/Product/C1'
    const five = (extra = {}) => [
      product({ id: P1, title: 'First Linen Shirt', ...extra }),
      product({ id: 'gid://shopify/Product/C2', title: 'Second Linen Shirt' }),
      product({ id: 'gid://shopify/Product/C3', title: 'Third Linen Shirt' }),
      product({ id: 'gid://shopify/Product/C4', title: 'Fourth Linen Shirt' }),
      product({ id: 'gid://shopify/Product/C5', title: 'Fifth Linen Shirt' }),
    ]
    installFetch(d => (d === 'kith.com' ? five() : []), convexBase)
    await search(nextQuery(), ['kith.com'])
    await settle()
    restore()

    const key1 = `kith.com::${P1}`
    const first = store.get(key1)
    check(!!first, 'the garment has a row', first ? first.key : 'MISSING')
    if (!first) throw new Error('no row to continue from')
    same(store.size, 5, 'and so does every other product in the pool')
    same(first.merchant, 'kith.com', 'filed under the shop we asked')
    same(first.sourceId, P1, 'with the id the merchant used')
    same(first.status, 'active', 'and it is active')
    const snap1 = { ...first }

    await new Promise(r => setTimeout(r, 25))
    installFetch(d => (d === 'kith.com' ? five() : []), convexBase)
    await search(nextQuery(), ['kith.com'])
    await settle()
    restore()

    const second = store.get(key1)
    same(store.size, 5, 'seeing it again does not make a second row')
    same(second.firstSeenAt, snap1.firstSeenAt, 'firstSeenAt never moves again')
    // Within the freshness bucket, seeing a garment again is not news. The
    // bucket's expiry is proved on a stubbed clock in section 0b; here the two
    // searches are milliseconds apart, so the correct answer is no write.
    same(second.lastSeenAt, snap1.lastSeenAt, 'lastSeenAt is NOT rewritten inside the bucket')
    same(second.lastChangedAt, snap1.lastChangedAt, 'lastChangedAt does NOT — nothing changed')
    same(second.contentHash, snap1.contentHash, 'and the content hash is identical')

    // LOAD-BEARING, through the real search path: ten identical warm searches
    // measured 2,560 row writes for 256 garments before this correction.
    const writesBefore = dbWrites
    for (let i = 0; i < 10; i++) {
      installFetch(d => (d === 'kith.com' ? five() : []), convexBase)
      await search(nextQuery(), ['kith.com'])
      await settle()
      restore()
    }
    same(dbWrites - writesBefore, 0,
      'and ten more identical observations write NOTHING to the database')
    same(store.size, 5, 'the corpus still holds exactly the five garments')

    // ══════════════════════════════════════════════════════════════════════
    // 2/3. MERCHANT STATE MOVES, IDENTITY DOES NOT
    // ══════════════════════════════════════════════════════════════════════
    console.log('\n── the price changes, the garment does not ' + '─'.repeat(31))
    await new Promise(r => setTimeout(r, 25))
    installFetch(d => (d === 'kith.com' ? five({ price: 990000 }) : []), convexBase)
    await search(nextQuery(), ['kith.com'])
    await settle()
    restore()

    const priced = store.get(key1)
    same(store.size, 5, 'still one row for the garment')
    same(priced.key, snap1.key, 'the key is untouched')
    same(priced.price, 9900, 'the price is the new one')
    check(priced.contentHash !== snap1.contentHash, 'the content hash moved')
    check(priced.lastChangedAt > snap1.lastChangedAt, 'and so did lastChangedAt')
    same(priced.firstSeenAt, snap1.firstSeenAt, 'firstSeenAt still does not move')

    for (const [label, extra, field, want] of [
      ['a retitled garment', { title: 'Renamed Linen Shirt' }, 'title', 'Renamed Linen Shirt'],
      ['a sold-out garment', { available: false }, 'inStock', false],
      ['a reshot garment', { img: 'reshot-v2' }, 'imageUrl', null],
      ['a moved garment', { url: 'https://kith.com/products/moved-here' }, 'storeUrl', 'https://kith.com/products/moved-here'],
      ['a re-varianted garment', { variants: [{ id: 'v-a' }, { id: 'v-b' }] }, null, null],
    ]) {
      await new Promise(r => setTimeout(r, 25))
      const before = { ...store.get(key1) }
      installFetch(d => (d === 'kith.com' ? five({ price: 990000, ...extra }) : []), convexBase)
      await search(nextQuery(), ['kith.com'])
      await settle()
      restore()
      const after = store.get(key1)
      const moved = after.contentHash !== before.contentHash
      const kept = after.key === before.key && after.firstSeenAt === before.firstSeenAt
      check(moved && kept, `${label}: state updated, key and firstSeenAt kept`,
        moved ? 'hash moved' : 'HASH DID NOT MOVE')
      if (field && want !== null) same(after[field], want, `  and ${field} is the new value`)
      if (field === 'imageUrl') check(after.imageUrl.includes('reshot-v2'), '  and imageUrl is the new photograph')
    }
    same(store.size, 5, 'and none of that created a second row')

    // ══════════════════════════════════════════════════════════════════════
    // 4. TWO SHOPS, ONE sourceId — TWO ROWS, ONE PRODUCT
    // ══════════════════════════════════════════════════════════════════════
    console.log('\n── two shops, one sourceId ' + '─'.repeat(47))
    // WHERE THE SEAM PUTS THE LIMIT, stated exactly rather than glossed.
    //
    // The corpus is written from entry.products, which is the pool AFTER
    // ingest has deduped it on the bare raw.id. So within ONE ingest pass a
    // cross-merchant duplicate never reaches the corpus at all — the second
    // shop's garment is dropped before the write seam, exactly as it is
    // dropped before the page. Two rows therefore require two searches, whose
    // different cache scopes give them different pools.
    //
    // That is not a defect in the writer; it is the live dedupe still being
    // unchanged, which this phase requires. The corpus records what the
    // catalogue actually kept. Both-in-one-pass is what re-keying dedupe would
    // buy, and it is deferred with the rest of that decision.
    const DUP = 'gid://shopify/Product/SHARED'
    const before4 = store.size

    installFetch(d => (d === 'kith.com'
      ? [product({ id: DUP, title: 'Shirt From Kith', host: 'kith.com', img: 'k' }), ...five().slice(1)]
      : []), convexBase)
    await search(nextQuery(), ['kith.com'])
    await settle()
    restore()

    installFetch(d => (d === 'aloyoga.com'
      ? [product({ id: DUP, title: 'Shirt From Alo', host: 'aloyoga.com', img: 'a' }),
         ...five().slice(1).map(p => ({ ...p, url: p.url.replace('kith.com', 'aloyoga.com') }))]
      : []), convexBase)
    await search(nextQuery(), ['aloyoga.com'])
    await settle()
    restore()

    const kithRow = store.get(`kith.com::${DUP}`)
    const aloRow = store.get(`aloyoga.com::${DUP}`)
    check(!!kithRow && !!aloRow, 'the corpus holds BOTH shops\' garments',
      `${kithRow ? 'kith' : '-'} / ${aloRow ? 'alo' : '-'}`)
    check(!!kithRow && !!aloRow && kithRow.key !== aloRow.key, 'under two different keys',
      kithRow && aloRow ? `${kithRow.key} vs ${aloRow.key}` : '')
    check(!!kithRow && !!aloRow && kithRow.sourceId === aloRow.sourceId, 'from one identical merchant id')
    check(store.size > before4 + 1, 'and both are new rows', `+${store.size - before4}`)

    // Now the same collision inside ONE search. The live page must still show
    // one product — bare-id dedupe is untouched — and the corpus must gain
    // nothing, because the dropped garment never reaches the seam.
    const before4b = store.size
    installFetch(d => {
      if (d === 'kith.com') return [product({ id: DUP, title: 'Shirt From Kith', host: 'kith.com', img: 'k' }), ...five().slice(1)]
      if (d === 'aloyoga.com') return [product({ id: DUP, title: 'Shirt From Alo', host: 'aloyoga.com', img: 'a' })]
      return []
    }, convexBase)
    const page = await search(nextQuery(), ['kith.com', 'aloyoga.com'])
    await settle()
    restore()
    same(page.filter(p => p.id === DUP).length, 1,
      'ONE ingest pass still shows exactly one product — dedupe unchanged')
    same(store.size, before4b,
      'and the corpus gained nothing from it: the dropped garment never reached the seam')

    // ══════════════════════════════════════════════════════════════════════
    // 5. WHAT NEVER REACHES THE CORPUS
    // ══════════════════════════════════════════════════════════════════════
    console.log('\n── what never becomes a record ' + '─'.repeat(43))
    const before5 = store.size
    installFetch(d => (d === 'kith.com' ? [
      ...five(),
      { ...product({ id: 'gid://shopify/Product/CANDLE', title: 'Scented Candle' }), tags: ['candle'] },
      product({ id: 'gid://shopify/Product/OFFREG', title: 'Off Registry Shirt', host: 'zzzqqqxyz.example.org' }),
      product({ id: 'gid://shopify/Product/NOIMG', title: 'No Photograph Shirt', noImage: true }),
      { id: '', title: 'No Id At All', media: [{ url: 'https://cdn.shopify.com/x.jpg' }], variants: [] },
    ] : []), convexBase)
    await search(nextQuery(), ['kith.com'])
    await settle()
    restore()
    const added = Array.from(store.keys()).filter(k => /CANDLE|OFFREG|NOIMG/.test(k))
    same(added.length, 0, 'a candle, an off-registry piece and a photographless one get no row')
    same(store.size, before5, 'the corpus did not grow at all')

    // ══════════════════════════════════════════════════════════════════════
    // 6. QUARANTINED, AND STILL SERVED
    // ══════════════════════════════════════════════════════════════════════
    console.log('\n── quarantined in the corpus, shown on the page ' + '─'.repeat(27))
    const ZERO = 'gid://shopify/Product/FREE'
    installFetch(d => (d === 'kith.com' ? [
      product({ id: ZERO, title: 'Unpriced Shirt', price: 0 }),
      ...five().slice(1),
    ] : []), convexBase)
    const zpage = await search(nextQuery(), ['kith.com'])
    await settle()
    restore()
    const zrow = store.get(`kith.com::${ZERO}`)
    check(!!zrow, 'the unpriced garment has a row')
    same(zrow && zrow.status, 'quarantined', 'marked quarantined')
    same(zpage.filter(p => p.id === ZERO).length, 1, 'and the live page still shows it — nothing was filtered')

    // ══════════════════════════════════════════════════════════════════════
    // 7. A BROKEN CORPUS CANNOT REACH THE SHOPPER
    // ══════════════════════════════════════════════════════════════════════
    console.log('\n── when the corpus is down ' + '─'.repeat(47))
    const beforeFail = flat(obs())
    const sizeBefore = store.size
    convexBroken = true
    // Fresh ids on purpose: the five above have been offered many times by
    // now, so the local memo would correctly skip them and no write would be
    // attempted at all — which would test nothing.
    const unseen = () => Array.from({ length: 5 }, (_, i) =>
      product({ id: `gid://shopify/Product/BROKEN${i}`, title: `Unwritable Shirt ${i}` }))
    installFetch(d => (d === 'kith.com' ? unseen() : []), convexBase)
    let threw = null
    let broken = []
    try { broken = await search(nextQuery(), ['kith.com']) }
    catch (e) { threw = e instanceof Error ? e.message : String(e) }
    await settle()
    restore()
    convexBroken = false

    same(threw, null, 'the search does not throw')
    check(broken.length === 5, 'the shopper still gets their page', `${broken.length} products`)
    same(store.size, sizeBefore, 'and nothing was written')
    const afterFail = flat(obs())
    check(afterFail && afterFail.writeFailures > (beforeFail ? beforeFail.writeFailures : 0),
      'the failure is counted', afterFail ? `writeFailures ${afterFail.writeFailures}` : 'no counters')

    // ══════════════════════════════════════════════════════════════════════
    // 8. BATCH BOUNDARIES
    // ══════════════════════════════════════════════════════════════════════
    console.log('\n── how many mutations a page costs ' + '─'.repeat(39))
    // Past 256 these were silently truncated by MAX_PER_SEARCH before the
    // correction: 257 and 300 both wrote 256 rows and dropped the rest, the
    // same rows every time. LOAD-BEARING from 257 up.
    for (const [n, wantBatches] of [[64, 1], [65, 2], [128, 2], [256, 4], [257, 5], [300, 5], [500, 8]]) {
      mutations = []
      const many = Array.from({ length: n }, (_, i) =>
        product({ id: `gid://shopify/Product/B${n}-${i}`, title: `Batch Shirt ${i}` }))
      installFetch(d => (d === 'kith.com' ? many : []), convexBase)
      await search(nextQuery(), ['kith.com'])
      await settle()
      restore()
      same(mutations.length, wantBatches, `${n} products -> ${wantBatches} mutation(s)`)
      same(mutations.reduce((a, b) => a + b, 0), n, `  and all ${n} were sent`)
      check(mutations.every(m => m <= 64), '  with no batch over 64', mutations.join('+'))
    }

    // ══════════════════════════════════════════════════════════════════════
    // 8b. THE ROUND-TRIP THE SERVER BUCKET CANNOT AVOID
    // ══════════════════════════════════════════════════════════════════════
    // The freshness bucket in convex/products.ts stops the WRITE. It cannot
    // stop the call: to reach it the writer must send the batch and the handler
    // must read every row to discover there is nothing to do. Measured on a
    // 1,000-product pool, a hundred identical observations cost 1,600
    // round-trips and 100,000 index reads for zero information.
    //
    // So the writer keeps a process-local memo of what it recently offered.
    // Two layers, two jobs: the memo saves a warm instance the round trip, and
    // the server bucket stays authoritative for cold instances and for two
    // instances writing at once.
    console.log('\n── what a warm instance already knows ' + '─'.repeat(36))
    {
      const Q = nextQuery()
      const set = () => [
        product({ id: 'gid://shopify/Product/M1', title: 'Memo Shirt One' }),
        product({ id: 'gid://shopify/Product/M2', title: 'Memo Shirt Two' }),
        product({ id: 'gid://shopify/Product/M3', title: 'Memo Shirt Three' }),
        product({ id: 'gid://shopify/Product/M4', title: 'Memo Shirt Four' }),
        product({ id: 'gid://shopify/Product/M5', title: 'Memo Shirt Five' }),
      ]
      // (1) TEN IDENTICAL SEARCHES — the real path, the real handler.
      const m0 = mutations.length, o0 = rowsOffered, r0 = dbReads, w0 = dbWrites
      installFetch(d => (d === 'kith.com' ? set() : []), convexBase)
      await search(Q, ['kith.com']); await settle()
      restore()
      const afterFirst = { mut: mutations.length - m0, off: rowsOffered - o0, rd: dbReads - r0, wr: dbWrites - w0 }
      check(afterFirst.mut === 1 && afterFirst.off === 5 && afterFirst.wr === 5,
        'the first search sends the five garments',
        `${afterFirst.mut} round-trip, ${afterFirst.off} offered, ${afterFirst.wr} written`)

      const m1 = mutations.length, o1 = rowsOffered, r1 = dbReads, w1 = dbWrites
      for (let i = 0; i < 9; i++) {
        installFetch(d => (d === 'kith.com' ? set() : []), convexBase)
        await search(nextQuery(), ['kith.com']); await settle()
        restore()
      }
      same(mutations.length - m1, 0, 'the next NINE send no mutation at all')
      same(rowsOffered - o1, 0, '  no rows offered')
      same(dbReads - r1, 0, '  no index reads')
      same(dbWrites - w1, 0, '  and no writes')

      // (4) UNCHANGED CONTENT INSIDE THE BUCKET is what did that, and the
      // writer counts it apart from an identity skip.
      const o = flat(obs())
      check(o && o.localSkips >= 45, 'the writer counted them as local recency skips',
        o ? `localSkips ${o.localSkips}` : 'no counter')
      check(o && typeof o.skipped === 'number' && o.skipped !== o.localSkips,
        '  kept separate from identity skips', o ? `skipped ${o.skipped}` : '')

      // (3) CHANGED CONTENT INSIDE THE BUCKET must still go. PRESERVATION
      // against the server bucket, LOAD-BEARING against a memo that only
      // looked at time.
      const m2 = mutations.length, w2 = dbWrites
      installFetch(d => (d === 'kith.com' ? set().map((p, i) =>
        (i === 0 ? { ...p, title: 'Memo Shirt One, Repriced' } : p)) : []), convexBase)
      await search(nextQuery(), ['kith.com']); await settle()
      restore()
      check(mutations.length - m2 === 1, 'a garment that CHANGED is sent again inside the bucket')
      same(rowsOffered - o1 - 0 > 0, true, '  and it is on the wire')
      same(dbWrites - w2, 1, '  exactly the one that changed is written')
      same(store.get('kith.com::gid://shopify/Product/M1').title, 'Memo Shirt One, Repriced',
        '  with its new title')
    }

    // ══════════════════════════════════════════════════════════════════════
    // 8c. A COLD WRITER, AN EXPIRED ENTRY, AND A BOUNDED MEMO
    // ══════════════════════════════════════════════════════════════════════
    // Writer-boundary tests: these call writeCorpus directly so the memo can be
    // examined without a search in the way. The clock is stubbed only around
    // the calls; no production code learns about it.
    console.log('\n── the memo forgets, on purpose ' + '─'.repeat(42))
    {
      const canon = (i, title) => ({
        key: `kith.com::cold-${i}`,
        source: { merchant: 'kith.com', sourceId: `cold-${i}`, via: 'ucp-mcp', fetchedAt: Date.now(), schema: 1 },
        id: `cold-${i}`, title: title ?? `Cold Shirt ${i}`, vendor: 'Kith', price: 47.5, currency: 'USD',
        store_url: 'https://kith.com/products/x', image_url: 'https://cdn.shopify.com/s/files/c.jpg',
        in_stock: true, tags: ['shirt'], description: 'd',
        options: [{ name: 'Size', values: ['M'] }], media: [],
        variants: [{ id: 'v1', title: 'M', price: 47.5, availability: true, options: [], media: [] }],
      })
      const five = Array.from({ length: 5 }, (_, i) => canon(i))

      // (2) COLD WRITER — a fresh module instance has no memo.
      for (const k of Object.keys(require.cache)) if (k.includes('/.vt/')) delete require.cache[k]
      const fresh = build('.vt/corpus-write-entry.ts', 'corpus-write-cold')
      const c0 = mutations.length
      await fresh.W.writeCorpus(five)
      await settle()
      check(mutations.length - c0 === 1,
        'a COLD writer offers everything again — the memo is process-local, never persisted',
        `${mutations.length - c0} round-trip(s)`)
      const c1 = mutations.length
      await fresh.W.writeCorpus(five); await settle()
      same(mutations.length - c1, 0, '  and then remembers them, like the warm one')

      // (5) EXPIRED ENTRY — past the bucket, offered again.
      const saved = Date.now
      const c2 = mutations.length
      Date.now = () => saved() + 16 * 60 * 1000
      try { await fresh.W.writeCorpus(five); await settle() } finally { Date.now = saved }
      check(mutations.length - c2 === 1, 'sixteen minutes on, the memo has expired and they go again',
        `${mutations.length - c2} round-trip(s)`)

      // (6) BOUNDED — more unique keys than the cache holds, and the earliest
      // are evicted rather than accumulating.
      const cap = fresh.W.CORPUS_MEMO_MAX
      check(typeof cap === 'number' && cap > 0, 'the memo declares a finite capacity', String(cap))
      if (typeof cap === 'number') {
        const many = Array.from({ length: cap + 200 }, (_, i) => canon(`bulk-${i}`))
        await fresh.W.writeCorpus(many); await settle()
        const c3 = mutations.length
        // The first 200 offered are the ones evicted by the last 200.
        await fresh.W.writeCorpus(many.slice(0, 100)); await settle()
        check(mutations.length - c3 > 0,
          'once evicted, a garment is offered again rather than lost',
          `${mutations.length - c3} round-trip(s) for 100 evicted keys`)
        const c4 = mutations.length
        await fresh.W.writeCorpus(many.slice(-100)); await settle()
        same(mutations.length - c4, 0, '  while the most recent are still remembered')
      }

      // A FAILED write must not be remembered as done, or the products it lost
      // would sit unretried until the bucket expired.
      const c5 = mutations.length
      const failSet = Array.from({ length: 3 }, (_, i) => canon(`fail-${i}`))
      convexBroken = true
      await fresh.W.writeCorpus(failSet); await settle()
      convexBroken = false
      check(mutations.length - c5 === 1, 'a failed batch was attempted')
      const c6 = mutations.length
      await fresh.W.writeCorpus(failSet); await settle()
      check(mutations.length - c6 === 1,
        'and is offered AGAIN next time — a failure is not remembered as a success',
        `${mutations.length - c6} round-trip(s)`)
    }

    // ══════════════════════════════════════════════════════════════════════
    // 9. THE CORPUS IS WRITE-ONLY
    // ══════════════════════════════════════════════════════════════════════
    console.log('\n── nothing reads it back ' + '─'.repeat(49))
    same(corpusQueries, 0, 'nothing queried the corpus')
    const convexSrc = fs.readFileSync(path.join(WEB, 'convex/products.ts'), 'utf8')
    // The EXPORT, not the internal ctx.db.query the upsert needs to read its
    // own row. What must not exist is a callable read of this table.
    check(!/export\s+const\s+\w+\s*=\s*query\s*\(/.test(convexSrc),
      'and convex/products.ts exports no query at all — nothing to call', 'write-only by construction')
    same(externalCalls.length, 0, 'and no new network host was contacted', externalCalls.slice(0, 3).join(','))

    // ══════════════════════════════════════════════════════════════════════
    // 10. TWO WRITES AT ONCE
    // ══════════════════════════════════════════════════════════════════════
    // What this can and cannot prove is stated exactly: the stand-in Convex
    // here executes one mutation at a time, so this shows the WRITER does not
    // corrupt state across concurrent invocations. It does NOT establish
    // anything about real Convex transaction isolation, which cannot be
    // exercised from this harness.
    console.log('\n── two searches writing at once ' + '─'.repeat(42))
    const conc = 'gid://shopify/Product/CONC'
    const beforeConc = store.size
    installFetch(d => (d === 'kith.com' ? [product({ id: conc, title: 'Contended Shirt' }), ...five().slice(1)] : []), convexBase)
    await Promise.all([search(nextQuery(), ['kith.com']), search(nextQuery(), ['kith.com'])])
    await settle()
    restore()
    const crow = store.get(`kith.com::${conc}`)
    check(!!crow, 'the contended garment has a row')
    same(store.size, beforeConc + 1, 'exactly one row was added, not two')
    check(crow && crow.firstSeenAt <= crow.lastSeenAt, 'and its timestamps are coherent')

    // ── counters ────────────────────────────────────────────────────────────
    console.log('\n── what the writer counted ' + '─'.repeat(47))
    const o = flat(obs())
    check(!!o, 'the writer reports counters', o ? '' : 'MISSING')
    if (o) {
      check(o.inserted > 0, 'inserted', String(o.inserted))
      check(o.unchanged > 0, 'unchanged', String(o.unchanged))
      check(o.updated > 0, 'updated', String(o.updated))
      check(o.quarantined > 0, 'quarantined', String(o.quarantined))
      check(o.writeFailures > 0, 'writeFailures', String(o.writeFailures))
      check(o.merchants >= 2, 'merchants represented', String(o.merchants))
      // Internally coherent, not compared against the row store: the bounded
      // memo test above writes through a SECOND writer instance with its own
      // counters, so rowsById holds rows this counter never saw.
      check(o.distinctKeys >= o.inserted, 'distinct keys offered >= rows this writer inserted',
        `${o.distinctKeys} offered, ${o.inserted} inserted`)
      check(o.localSkips > 0, 'and the local memo saved round trips', String(o.localSkips))
    }
  } catch (e) {
    check(false, 'the harness ran to completion', e instanceof Error ? (e.stack || e.message) : String(e))
  } finally {
    restore()
    server.close()
  }

  console.log(bad === 0
    ? `\nthe corpus holds ${store.size} garments, and the page never noticed\n`
    : `\n${bad} FAILED\n`)
  process.exit(bad === 0 ? 0 : 1)
})()
