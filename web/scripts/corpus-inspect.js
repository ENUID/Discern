/**
 * Looking at what the corpus actually holds.
 *
 * The products table was committed, CI-green, and had never been deployed —
 * convex-deploy.yml listed main and a June branch and not this one — so the
 * corpus was provably empty and nothing in the repository could say so. A
 * write-only store nobody can observe is indistinguishable from a broken one.
 * `products.inspect` is the read that ends that, and this is what pins it.
 *
 * IT RUNS THE REAL QUERY. Convex's queryGeneric hangs the raw handler off the
 * returned function as `_handler` (node_modules/convex/dist/cjs/server/impl/
 * registration_impl.js), so the bounds, the ordering, the admin gate and the
 * arithmetic under test here are the deployed ones rather than a second
 * implementation that could agree with a wrong idea.
 *
 * WHAT IT CANNOT DO: reach a real deployment. There is no Convex URL and no
 * secret in this environment, so every number below comes from a seeded
 * fixture. That is the point of the fixture — the query's arithmetic can be
 * proven anywhere; whether the live corpus has rows in it cannot, and this file
 * does not pretend otherwise.
 *
 * AND THE THING IT GUARDS. Phase 1's hardest promise was that no corpus record
 * could reach a shopper, and it held because there was nothing to call. There
 * is something to call now, so the promise needs an actual test: no file under
 * app/, lib/ or features/ may name this query, and the writer may call the
 * mutation and nothing else.
 */

const path = require('path')
const fs = require('fs')
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

const ADMIN = 'stub-admin-secret'
process.env.ADMIN_SECRET = ADMIN

const entryFile = path.join(WEB, '.vt', 'corpus-inspect-entry.ts')
fs.mkdirSync(path.join(WEB, '.vt'), { recursive: true })
fs.writeFileSync(entryFile,
  `export * as PRODUCTS from ${JSON.stringify(path.join(WEB, 'convex/products'))}\n`)
const C = build('.vt/corpus-inspect-entry.ts', 'corpus-inspect')

// ── a database, just enough of one ──────────────────────────────────────────
/** Records how the query actually read, so "bounded and index-based" is an
 *  observation rather than a claim about the source. */
const reads = { withIndex: [], order: [], take: [], paginate: [], deletes: 0, fullScans: 0 }

function makeDb(rows) {
  return {
    // Mutates the caller's array, so a prune actually removes rows and a second
    // pass over the same fixture sees the result of the first.
    delete: async (id) => {
      const i = rows.findIndex(r => r._id === id)
      if (i >= 0) { rows.splice(i, 1); reads.deletes++ }
    },
    query: (table) => {
      const chain = {
        withIndex: (name) => { reads.withIndex.push(`${table}:${name}`); return chain },
        order: (dir) => { reads.order.push(dir); return chain },
        take: async (n) => {
          reads.take.push(n)
          // by_last_seen, newest first — the same order the index gives.
          const sorted = [...rows].sort((a, b) => b.lastSeenAt - a.lastSeenAt)
          return sorted.slice(0, n)
        },
        // Convex's own pagination: no index, so _creationTime ascending — the
        // immutable order. The cursor is an offset here because the fixture is
        // an array; what it stands in for is opaque to the query either way,
        // which is the property under test.
        paginate: async ({ numItems, cursor }) => {
          reads.paginate.push(numItems)
          const ordered = [...rows].sort((x, y) => (x._creationTime ?? 0) - (y._creationTime ?? 0))
          // A KEY-BASED CURSOR, because that is what Convex actually hands out:
          // it encodes the index key of the last row returned, and the next page
          // is everything strictly after it. An OFFSET cursor would be a
          // different system — under one, deleting rows inside a page shifts
          // everything left and the next page skips exactly as many rows as were
          // removed. This mock modelled an offset first and the prune tests
          // caught it: six candidates counted, five deleted, one silently
          // stepped over. The bug was in the model, not the mutation, but the
          // failure is the real one a positional cursor would produce.
          const after = cursor === null || cursor === undefined ? -Infinity : Number(cursor)
          const remaining = ordered.filter(r => (r._creationTime ?? 0) > after)
          const slice = remaining.slice(0, numItems)
          const last = slice.length ? slice[slice.length - 1]._creationTime : after
          return {
            page: slice,
            isDone: remaining.length <= numItems,
            continueCursor: String(last),
          }
        },
        // Anything that collects without a bound is a full scan, and the query
        // must never reach for one.
        collect: async () => { reads.fullScans++; return [...rows] },
        first: async () => rows[0] ?? null,
      }
      return chain
    },
  }
}

const T0 = 1_700_000_000_000
const DAY = 24 * 60 * 60 * 1000

/** One corpus row. Everything not named takes a plausible default so a test
 *  only has to say what it is actually about. */
let seq = 0
const row = (o) => ({
  _id: `r-${o.key}`,
  // Convex stamps this and never changes it. The census paginates over it for
  // exactly that reason, so the fixture has to carry a real one.
  _creationTime: o._creationTime ?? ++seq,
  key: o.key,
  merchant: o.merchant ?? 'kith.com',
  sourceId: o.sourceId ?? `gid://shopify/Product/${o.key}`,
  title: o.title ?? 'Plain Linen Shirt',
  vendor: o.vendor ?? 'Kith',
  price: o.price ?? 47.5,
  currency: o.currency ?? 'USD',
  storeUrl: o.storeUrl ?? 'https://kith.com/products/x',
  imageUrl: o.imageUrl ?? `https://cdn.shopify.com/${o.key}.jpg`,
  inStock: o.inStock !== false,
  payload: o.payload ?? JSON.stringify({
    variants: [{ id: 'v1' }], media: [], options: [],
    description: 'A considered piece.', description_html: null,
    tags: ['shirt'], categories: ['gid://shopify/TaxonomyCategory/aa-8-8'],
  }),
  via: o.via ?? 'ucp-mcp',
  schema: o.schema ?? 1,
  firstSeenAt: o.firstSeenAt ?? T0,
  lastSeenAt: o.lastSeenAt ?? T0,
  lastChangedAt: o.lastChangedAt ?? T0,
  contentHash: o.contentHash ?? `h-${o.key}`,
  status: o.status ?? 'active',
  // Deliberately NOT defaulted. Left off, these stay undefined — the shape of
  // a row written before provenance existed, which the counters must keep
  // separate from a real answer rather than fold into one.
  currencyStated: o.currencyStated,
  availabilityStated: o.availabilityStated,
  vendorSource: o.vendorSource,
  // Left off, this stays undefined — a legacy row, written before country
  // scoping, whose country was never recorded and must not be invented.
  country: o.country,
  requestedCurrency: o.requestedCurrency,
})

;(async () => {
  console.log('\nwhat the corpus actually holds\n')

  const handler = C.PRODUCTS && C.PRODUCTS.inspect && C.PRODUCTS.inspect._handler
  check(typeof handler === 'function',
    'the REAL products.inspect handler is what these tests run', handler ? '' : 'not reachable')
  if (typeof handler !== 'function') { console.log(`\n${bad} FAILED\n`); process.exit(1) }
  const run = (rows, args = {}) => handler({ db: makeDb(rows) }, { adminSecret: ADMIN, ...args })

  const censusHandler = C.PRODUCTS && C.PRODUCTS.census && C.PRODUCTS.census._handler
  check(typeof censusHandler === 'function',
    'the REAL products.census handler is what the census tests run',
    censusHandler ? '' : 'not reachable')
  const runCensus = (rows, args = {}) =>
    censusHandler({ db: makeDb(rows) }, { adminSecret: ADMIN, ...args })

  /** Walk the whole table the way an operator would, and add the pages up.
   *  Bounded per call; the loop is the caller's, which is the design. */
  const walkCensus = async (rows, pageSize) => {
    const merged = {
      pages: 0, scanned: 0, keysSeen: [], wouldDelete: 0,
      byCountry: {}, byRequestedCurrency: {}, byKeyShape: {}, perMerchant: {},
      distinctMerchantsPerPage: [],
      legacyKeyedButCountryScoped: 0, candidatesCarryingRequestedCurrency: 0,
      sampleKeys: [], isDone: false,
    }
    let cursor = null
    // Bounded so a broken cursor cannot spin forever — a runaway loop would
    // otherwise look like a passing test that simply never returned.
    for (let guard = 0; guard < 100; guard++) {
      const r = await runCensus(rows, { cursor, pageSize })
      merged.pages++
      merged.scanned += r.page.scanned
      merged.wouldDelete += r.legacy.wouldDelete
      merged.legacyKeyedButCountryScoped += r.legacy.legacyKeyedButCountryScoped
      merged.candidatesCarryingRequestedCurrency += r.legacy.candidatesCarryingRequestedCurrency
      for (const k of r.legacy.sampleKeys) merged.sampleKeys.push(k)
      merged.distinctMerchantsPerPage.push(r.counts.distinctMerchants)
      for (const [dim, src] of [['byCountry', r.counts.byCountry],
                                ['byRequestedCurrency', r.counts.byRequestedCurrency],
                                ['byKeyShape', r.counts.byKeyShape],
                                ['perMerchant', r.counts.perMerchant]]) {
        for (const [k, n] of Object.entries(src)) merged[dim][k] = (merged[dim][k] ?? 0) + n
      }
      if (r.page.isDone) { merged.isDone = true; merged.lastCursor = r.page.cursor; break }
      cursor = r.page.cursor
    }
    return merged
  }

  // ── the gate ──────────────────────────────────────────────────────────────
  console.log('── who may look ' + '─'.repeat(58))
  same(await handler({ db: makeDb([]) }, { adminSecret: 'wrong' }), null,
    'a wrong operator secret gets null, not data')
  same(await handler({ db: makeDb([]) }, { adminSecret: '' }), null, 'and so does an empty one')
  check((await run([])) !== null, 'the right one gets an answer')

  // ── A. a seeded corpus, counted ───────────────────────────────────────────
  console.log('\n── A. a seeded corpus, counted ' + '─'.repeat(43))
  const seeded = [
    // The first five carry provenance; the last two deliberately do not, so
    // "unrecorded" is exercised alongside every real answer.
    row({ key: 'kith.com::1::US', lastSeenAt: T0 + 5 * DAY, firstSeenAt: T0, lastChangedAt: T0 + DAY,
          currencyStated: true, availabilityStated: true, vendorSource: 'merchant', country: 'US',
          requestedCurrency: 'USD' }),
    row({ key: 'kith.com::2::IN', lastSeenAt: T0 + 4 * DAY, inStock: false,
          currencyStated: true, availabilityStated: true, vendorSource: 'merchant', country: 'IN',
          requestedCurrency: 'USD' }),
    // A four-segment key: no country was sent AND the request asked in EUR.
    row({ key: 'kith.com::3::--::EUR', lastSeenAt: T0 + 3 * DAY, status: 'quarantined', price: 0,
          currency: 'EUR',
          currencyStated: false, availabilityStated: false, vendorSource: 'domain', country: '--',
          requestedCurrency: 'EUR' }),
    row({ key: 'aloyoga.com::4', merchant: 'aloyoga.com', lastSeenAt: T0 + 2 * DAY, schema: 1,
          currencyStated: false, availabilityStated: true, vendorSource: 'domain' }),
    row({ key: 'aloyoga.com::5', merchant: 'aloyoga.com', lastSeenAt: T0 + DAY, via: 'ucp-mcp',
          currencyStated: true, availabilityStated: false, vendorSource: 'none' }),
    row({ key: 'taylorstitch.com::6', merchant: 'taylorstitch.com', lastSeenAt: T0 + 6 * DAY,
          firstSeenAt: T0 - DAY, lastChangedAt: T0 + 6 * DAY, currency: 'GBP',
          title: 'Untitled', vendor: 'Independent', sourceId: '90210' }),
    row({ key: 'taylorstitch.com::7', merchant: 'taylorstitch.com', lastSeenAt: T0,
          sourceId: 'handle-shirt' }),
  ]
  const r = await run(seeded)
  const s = r.stats

  same(s.total, 7, 'every seeded row was examined')
  same(s.capped, false, 'and the scan was not capped')
  same(s.byStatus.active, 6, 'six active')
  same(s.byStatus.quarantined, 1, 'one quarantined')
  same(s.byVia['ucp-mcp'], 7, 'all seven arrived via ucp-mcp')
  same(s.bySchema['1'], 7, 'all seven at canonical schema 1')
  same(s.distinctMerchants, 3, 'three distinct merchants')
  same(s.perMerchant['kith.com'], 3, '  kith.com holds three')
  same(s.perMerchant['aloyoga.com'], 2, '  aloyoga.com two')
  same(s.perMerchant['taylorstitch.com'], 2, '  taylorstitch.com two')
  same(s.inStock, 6, 'six in stock')

  same(s.firstSeenAt.min, T0 - DAY, 'firstSeenAt min')
  same(s.firstSeenAt.max, T0, 'firstSeenAt max')
  same(s.lastSeenAt.min, T0, 'lastSeenAt min')
  same(s.lastSeenAt.max, T0 + 6 * DAY, 'lastSeenAt max')
  same(s.lastChangedAt.min, T0, 'lastChangedAt min')
  same(s.lastChangedAt.max, T0 + 6 * DAY, 'lastChangedAt max')

  same(s.byIdShape.gid, 5, 'five Shopify GIDs')
  same(s.byIdShape.numeric, 1, 'one bare numeric')
  same(s.byIdShape.other, 1, 'one neither')

  // The defaults parseProduct applies are indistinguishable from real values
  // in a row; counting the sentinels is the only visibility there is.
  same(s.defaulted.titleUntitled, 1, 'one title is the Untitled sentinel')
  same(s.defaulted.unpriced, 1, 'one has no usable price')
  // Five, not six: the EUR row above answers in EUR because it was ASKED in
  // EUR. That is the whole point of the fourth key segment — this count is
  // about the merchant's answer, byRequestedCurrency is about our question,
  // and they are now separately visible.
  same(s.defaulted.currencyUSD, 5, 'five are USD — real or defaulted, indistinguishable')
  same(s.defaulted.vendorIndependent, undefined,
    'and vendorIndependent is GONE — it counted a branch the domain fallback pre-empts')

  // ── what the merchant actually said ───────────────────────────────────────
  //
  // The counter above cannot answer this and never could: 'USD' is 'USD'
  // whether a store sent it or nobody did. These read each row's recorded
  // provenance instead, and keep pre-provenance rows in their own bucket
  // rather than guessing on their behalf.
  same(s.provenance.currency.stated, 3, "three currencies were the merchant's word")
  same(s.provenance.currency.defaultedUSD, 2, '  two are the USD default wearing a currency')
  same(s.provenance.currency.unrecorded, 2, '  and two predate provenance entirely')
  same(s.provenance.currency.stated + s.provenance.currency.defaultedUSD
     + s.provenance.currency.unrecorded, s.total, '  every row lands in exactly one bucket')

  same(s.provenance.availability.stated, 3, 'three had a real availability signal')
  same(s.provenance.availability.assumedInStock, 2, '  two are the optimistic default, not an observation')
  same(s.provenance.availability.unrecorded, 2, '  and two predate provenance')
  same(s.provenance.availability.stated + s.provenance.availability.assumedInStock
     + s.provenance.availability.unrecorded, s.total, '  every row lands in exactly one bucket')

  same(s.provenance.vendor.merchant, 2, 'two vendors are the merchant speaking')
  same(s.provenance.vendor.domain, 2, '  two are a title-cased domain token wearing a brand name')
  same(s.provenance.vendor.none, 1, '  one is the Independent sentinel')
  same(s.provenance.vendor.unrecorded, 2, '  and two predate provenance')
  same(s.provenance.vendor.merchant + s.provenance.vendor.domain
     + s.provenance.vendor.none + s.provenance.vendor.unrecorded, s.total,
    '  every row lands in exactly one bucket')

  // The whole point, as an assertion: the old metric and the new one disagree,
  // and the new one is the true reading of the same seven rows.
  same(s.defaulted.currencyUSD !== s.provenance.currency.defaultedUSD, true,
    'the USD count and the DEFAULTED-USD count are different numbers')

  // ── which country each observation was made under ─────────────────────────
  //
  // The corpus files merchant::sourceId::COUNTRY, because cc reaches the store
  // as address_country and the store localises price, currency and
  // availability from it. Rows written before that carry a two-segment key and
  // no country, which is counted as its own bucket rather than guessed at.
  same(s.byCountry.US, 1, 'one observation was made from US')
  same(s.byCountry.IN, 1, '  one from IN')
  same(s.byCountry['--'], 1, '  one from a request that carried no country')
  same(s.byCountry.unscoped, 4, '  and four are legacy rows with no country recorded')
  same(Object.values(s.byCountry).reduce((a, b) => a + b, 0), s.total,
    '  every row lands in exactly one country bucket')
  same(Object.prototype.hasOwnProperty.call(s.byCountry, '--')
    && Object.prototype.hasOwnProperty.call(s.byCountry, 'unscoped'), true,
    'unknown-country and never-recorded are separate buckets, not one answer')

  // ── the other half of the observation context ────────────────────────────
  // The currency we ASKED in, never the one a merchant answered with. The USD
  // rows carry no fourth key segment, so this column is the ONLY place a
  // requested-USD row can be told apart from one written before the field
  // existed — which is the cost of the backward-compatible key and the reason
  // the column is stored for every row rather than only the scoped ones.
  same(s.byRequestedCurrency.USD, 2, 'two observations were requested in USD')
  same(s.byRequestedCurrency.EUR, 1, '  one in EUR')
  same(s.byRequestedCurrency.unrecorded, 4, '  and four predate the field')
  same(Object.values(s.byRequestedCurrency).reduce((a, b) => a + b, 0), s.total,
    '  every row lands in exactly one requested-currency bucket')
  same(Object.prototype.hasOwnProperty.call(s.byRequestedCurrency, 'unrecorded'), true,
    'never-recorded is its own answer, not folded into USD')
  // The two dimensions are independent: the EUR observation is also the one
  // that carried no country, and each is counted in its own bucket.
  same(s.byCountry['--'] === 1 && s.byRequestedCurrency.EUR === 1, true,
    'country and requested currency are independent dimensions')

  same(s.payloadSample.scanned, 7, 'the payload sample covered all seven')
  same(s.payloadSample.withVariants, 7, '  all have variants')
  same(s.payloadSample.withCategories, 7, '  all have categories')
  same(s.payloadSample.withDescription, 7, '  all have a description')

  // ── duplicates, which are the thing worth finding ─────────────────────────
  console.log('\n── the duplicates a corpus is for finding ' + '─'.repeat(32))
  const dupes = [
    row({ key: 'kith.com::D', merchant: 'kith.com', sourceId: 'gid://shopify/Product/SAME',
          imageUrl: 'https://cdn/one.jpg', title: 'Linen  Shirt', lastSeenAt: T0 + 3 }),
    row({ key: 'aloyoga.com::D', merchant: 'aloyoga.com', sourceId: 'gid://shopify/Product/SAME',
          imageUrl: 'https://cdn/two.jpg', title: 'LINEN SHIRT', lastSeenAt: T0 + 2 }),
    row({ key: 'kith.com::E', merchant: 'kith.com', sourceId: 'gid://shopify/Product/OTHER',
          imageUrl: 'https://cdn/one.jpg', title: 'Something Else', lastSeenAt: T0 + 1 }),
  ]
  const d = (await run(dupes)).stats
  same(d.duplicateSourceIdsAcrossMerchants, 1,
    'one sourceId appears under two merchants — the cross-merchant collision, visible at last')
  same(d.duplicateImageUrls, 1, 'one image URL is shared by two rows')
  same(d.duplicateTitles, 1, 'and one normalised title — case and spacing folded')

  // ── B/C. bounds and ordering ──────────────────────────────────────────────
  console.log('\n── B/C. bounded, and in a fixed order ' + '─'.repeat(36))
  const many = Array.from({ length: 250 }, (_, i) =>
    row({ key: `kith.com::b${i}`, lastSeenAt: T0 + i }))
  const big = await run(many)
  check(big.sample.length <= 100, 'the sample never exceeds one hundred rows', String(big.sample.length))
  same(big.sample.length, 100, '  and fills to the cap when there is more')
  same(big.stats.total, 250, '  while the stats saw all 250')

  const asked = await run(many, { sampleSize: 10 })
  same(asked.sample.length, 10, 'a caller may ask for fewer')
  const tooMany = await run(many, { sampleSize: 5000 })
  same(tooMany.sample.length, 100, 'and may not ask for more than the cap')
  same((await run(many, { sampleSize: -5 })).sample.length, 0, 'a negative request is zero, not a throw')

  const a1 = (await run(many)).sample.map(x => x.key)
  const a2 = (await run(many)).sample.map(x => x.key)
  check(JSON.stringify(a1) === JSON.stringify(a2), 'the ordering is deterministic across calls')
  same(a1[0], 'kith.com::b249', '  newest lastSeenAt first')
  check(a1.every((k, i) => i === 0 || Number(k.split('b')[1]) < Number(a1[i - 1].split('b')[1])),
    '  and strictly descending')
  same(new Set(a1).size, a1.length, 'no key appears twice in one sample')

  // ── D. every approved inspection field ────────────────────────────────────
  console.log('\n── D. what a sample row carries ' + '─'.repeat(42))
  const FIELDS = ['key', 'merchant', 'sourceId', 'title', 'vendor', 'price', 'currency',
    'storeUrl', 'imageUrl', 'inStock', 'via', 'schema', 'firstSeenAt', 'lastSeenAt',
    'lastChangedAt', 'contentHash', 'status']
  const one = big.sample[0]
  const missing = FIELDS.filter(f => !(f in one))
  same(missing.length, 0, 'all seventeen approved fields are present',
    missing.length ? `missing ${missing.join(', ')}` : `${FIELDS.length} fields`)
  check(!('payload' in one), 'and payload is NOT returned — the bytes stay on the server')
  check(!('_id' in one), 'nor the Convex row id')

  // ── E. bounded, index-based reads ─────────────────────────────────────────
  console.log('\n── E. how it reads ' + '─'.repeat(55))
  same(reads.fullScans, 0, 'not one unbounded collect() in any call')
  check(reads.withIndex.every(x => x === 'products:by_last_seen'),
    'every read went through the by_last_seen index',
    Array.from(new Set(reads.withIndex)).join(',') || 'none')
  check(reads.take.length > 0 && reads.take.every(n => n === 3000),
    'and every one was bounded at the 3000 scan cap analytics.ts already uses',
    Array.from(new Set(reads.take)).join(','))

  // ── F/G. it cannot reach a shopper ────────────────────────────────────────
  console.log('\n── F/G. still unreachable from a page ' + '─'.repeat(36))
  const walk = (dir, out = []) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.next' || e.name === '.vt') continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p, out)
      else if (/\.(ts|tsx)$/.test(e.name)) out.push(p)
    }
    return out
  }
  const productionFiles = ['app', 'lib', 'features', 'components']
    .filter(d => fs.existsSync(path.join(WEB, d)))
    .flatMap(d => walk(path.join(WEB, d)))
  const namesInspect = productionFiles.filter(f =>
    /products\.(inspect|census)|['"`](inspect|census)['"`]\s*[,)]/.test(fs.readFileSync(f, 'utf8')))
  same(namesInspect.length, 0,
    'no file under app/, lib/, features/ or components/ names an inspection query',
    namesInspect.map(f => path.relative(WEB, f)).join(', ') || 'none')

  const writer = fs.readFileSync(path.join(WEB, 'lib/services/corpusWriter.ts'), 'utf8')
  check(/anyApi\.products\.upsertMany/.test(writer), 'the writer still calls upsertMany')
  check(!/products\.inspect/.test(writer), 'and the writer does NOT call inspect')


  // ── F. the census: exact counts, one bounded page at a time ───────────────
  // `inspect` above is a window and says so. This is the read that can answer
  // "how many rows are there", and the only thing that licenses calling a
  // running total a census is isDone.
  console.log('\n── F. an exact census, paginated ' + '─'.repeat(41))
  {
    same(await censusHandler({ db: makeDb([]) }, { adminSecret: 'wrong' }), null,
      'the census refuses a wrong operator secret too')

    // A corpus with all three key shapes and a known composition.
    const corpus = [
      ...Array.from({ length: 40 }, (_, i) =>
        row({ key: `kith.com::L${i}`, sourceId: `L${i}` })),                       // legacy
      ...Array.from({ length: 25 }, (_, i) =>
        row({ key: `kith.com::U${i}::US`, sourceId: `U${i}`, country: 'US',
              requestedCurrency: 'USD' })),                                        // scoped
      ...Array.from({ length: 12 }, (_, i) =>
        row({ key: `kith.com::I${i}::IN`, sourceId: `I${i}`, country: 'IN',
              requestedCurrency: 'USD' })),                                        // scoped
      ...Array.from({ length: 7 }, (_, i) =>
        row({ key: `kith.com::E${i}::US::EUR`, sourceId: `E${i}`, country: 'US',
              requestedCurrency: 'EUR' })),                                        // scoped+currency
    ]
    const TRUE_TOTAL = 40 + 25 + 12 + 7

    // 1. a first page
    const p1 = await runCensus(corpus, { pageSize: 30 })
    same(p1.page.scanned, 30, 'the first page is bounded to what was asked')
    same(p1.page.isDone, false, '  and reports it is not done')
    check(typeof p1.page.cursor === 'string' && p1.page.cursor.length > 0,
      '  handing back a cursor for the next one')

    // 2. a subsequent page, from that cursor
    const p2 = await runCensus(corpus, { cursor: p1.page.cursor, pageSize: 30 })
    same(p2.page.scanned, 30, 'the second page continues from the cursor')
    check(p2.page.cursor !== p1.page.cursor, '  and the cursor advances')

    // 3 + 4. a full traversal ends, and visits every row exactly once
    const walk = await walkCensus(corpus, 30)
    same(walk.isDone, true, 'the traversal reports done')
    same(walk.lastCursor, null, '  and the final cursor is null')
    same(walk.scanned, TRUE_TOTAL, 'every row was scanned exactly once, across pages')
    same(walk.pages, Math.ceil(TRUE_TOTAL / 30), '  in the expected number of pages')

    // 5. the aggregate equals the true corpus
    const sum = (m) => Object.values(m).reduce((a, b) => a + b, 0)
    same(sum(walk.byCountry), TRUE_TOTAL, 'byCountry summed across pages equals the corpus')
    same(sum(walk.byRequestedCurrency), TRUE_TOTAL, '  and so does byRequestedCurrency')
    same(sum(walk.byKeyShape), TRUE_TOTAL, '  and so does byKeyShape')
    same(walk.byCountry.US, 25 + 7, '  US counted across both currency contexts')
    same(walk.byCountry.IN, 12, '  IN')
    same(walk.byCountry.unscoped, 40, '  and the legacy rows as unscoped')
    same(walk.byRequestedCurrency.USD, 25 + 12, '  USD')
    same(walk.byRequestedCurrency.EUR, 7, '  EUR')
    same(walk.byRequestedCurrency.unrecorded, 40, '  and the legacy rows as unrecorded')

    // 6. legacy rows counted EXACTLY — the number a deletion would act on
    same(walk.byKeyShape.legacy, 40, 'legacy two-segment rows counted exactly')
    same(walk.byKeyShape.scoped, 25 + 12, '  three-segment rows')
    same(walk.byKeyShape['scoped-currency'], 7, '  four-segment rows')
    same(walk.byKeyShape.malformed, 0, '  and nothing malformed')

    // ── R + S. per-merchant coverage, merged across the whole traversal ──
    // The counter the coverage work needs. distinctMerchants cannot be SUMMED
    // across pages — a merchant on two pages would count twice — but
    // perMerchant merges exactly, because merging two records unions their keys
    // and adds their values. So the corpus-wide answer is the KEY COUNT of the
    // merged map, and that is what these assertions pin.
    same(sum(walk.perMerchant), TRUE_TOTAL, 'perMerchant summed across pages equals the corpus')
    same(Object.keys(walk.perMerchant).length, 1,
      'distinct merchants across the traversal', Object.keys(walk.perMerchant).join(','))
    same(walk.perMerchant['kith.com'], TRUE_TOTAL, '  and every row belongs to it')

    // Several merchants, deliberately split across page boundaries so the
    // merge is doing real work rather than reading one page twice.
    {
      const many = []
      const brands = ['kith.com', 'aloyoga.com', 'staud.clothing', 'onia.com']
      brands.forEach((m, bi) => {
        for (let i = 0; i < 11 + bi; i++) {
          many.push(row({ key: `${m}::m${bi}_${i}::US`, merchant: m, sourceId: `m${bi}_${i}`,
                          country: 'US', requestedCurrency: 'USD' }))
        }
      })
      const total = 11 + 12 + 13 + 14
      const w = await walkCensus(many, 5)          // 5 per page -> merchants straddle pages
      same(w.isDone, true, 'a multi-merchant corpus traverses to done')
      same(w.scanned, total, '  scanning every row once')
      same(sum(w.perMerchant), total, 'perMerchant sums EXACTLY to the census total')
      same(Object.keys(w.perMerchant).length, 4, 'distinctMerchants equals the merchants represented')
      same(w.perMerchant['kith.com'], 11, '  kith.com')
      same(w.perMerchant['aloyoga.com'], 12, '  aloyoga.com')
      same(w.perMerchant['staud.clothing'], 13, '  staud.clothing')
      same(w.perMerchant['onia.com'], 14, '  onia.com')
      // The per-page number is NOT the corpus number, and the harness proves it
      // rather than trusting the field name.
      check(Math.max(...w.distinctMerchantsPerPage) <= 4, 'a page reports only its own merchants')
      check(w.distinctMerchantsPerPage.reduce((a, b) => a + b, 0) > 4,
        '  and summing those page counts would OVER-count — hence the key merge',
        w.distinctMerchantsPerPage.join('+'))
    }

    // The page size cannot be talked upward past the bound.
    const huge = await runCensus(corpus, { pageSize: 1e9 })
    check(huge.page.scanned <= 1000, 'a caller cannot ask for an unbounded page',
      String(huge.page.scanned))
    same(huge.page.isDone, true, '  and a corpus smaller than one page finishes in one')

    // A page size of one still terminates and still totals correctly — the
    // cursor, not the size, is what makes the walk complete.
    const slow = await walkCensus(corpus.slice(0, 9), 1)
    same(slow.pages, 9, 'a one-row page size still traverses everything')
    same(slow.scanned, 9, '  and counts each row once')
  }

  // ── G. the dry run: what a cleanup WOULD take, and nothing else ───────────
  // Counted, sampled, and not acted on. The rule needs both conditions, and
  // the two cross-checks below are the ones that would catch a mis-specified
  // predicate before it ever reached a delete.
  console.log('\n── G. a deletion that is not performed ' + '─'.repeat(35))
  {
    const mixed = [
      ...Array.from({ length: 6 }, (_, i) =>
        row({ key: `kith.com::L${i}`, sourceId: `L${i}` })),
      ...Array.from({ length: 4 }, (_, i) =>
        row({ key: `kith.com::U${i}::US`, sourceId: `U${i}`, country: 'US', requestedCurrency: 'USD' })),
      ...Array.from({ length: 3 }, (_, i) =>
        row({ key: `kith.com::E${i}::US::EUR`, sourceId: `E${i}`, country: 'US', requestedCurrency: 'EUR' })),
      // A row whose sourceId CONTAINS '::'. Under naive segment counting its
      // three-segment key reads as four and it would be miscounted; anchored on
      // the row's own merchant and sourceId it is simply scoped.
      row({ key: 'kith.com::od::d::US', sourceId: 'od::d', country: 'US', requestedCurrency: 'USD' }),
    ]
    const dry = await walkCensus(mixed, 5)
    same(dry.isDone, true, 'the dry run traverses the whole table')
    same(dry.wouldDelete, 6, 'exactly the six legacy rows would be deleted')
    same(dry.byKeyShape.legacy, 6, '  and exactly six are legacy-shaped')
    same(dry.byKeyShape.malformed, 0, '  a sourceId containing :: is not malformed')
    same(dry.byKeyShape['scoped-currency'], 3, '  nor is it counted as currency-scoped')

    // The two cross-checks. Both must be zero or the rule is wrong.
    same(dry.legacyKeyedButCountryScoped, 0, 'no country-scoped row matches the rule')
    same(dry.candidatesCarryingRequestedCurrency, 0, 'no candidate carries a requested currency')

    // Bounded evidence of WHICH rows, without exporting them.
    check(dry.sampleKeys.length > 0 && dry.sampleKeys.length <= 6 * 5,
      'the dry run names candidate keys', dry.sampleKeys.slice(0, 3).join(', '))
    check(dry.sampleKeys.every(k => k.startsWith('kith.com::L')),
      '  and every one of them is a legacy key')
    const firstPage = await runCensus(mixed, { pageSize: 5 })
    check(firstPage.legacy.sampleKeys.length <= 5, '  a page samples at most five keys')
    check(!JSON.stringify(firstPage).includes('payload'),
      'the dry run never returns payload contents')

    // A corpus with no legacy rows answers zero rather than nothing.
    const clean = await walkCensus(mixed.filter(r => r.country !== undefined), 5)
    same(clean.wouldDelete, 0, 'a corpus with nothing to delete says zero')
    same(clean.isDone, true, '  and still completes')
  }


  // ── H. the cleanup: what it takes, and everything it refuses ─────────────
  // The destructive counterpart to the dry run above, and it shares the
  // predicate rather than restating it — the same keyShape the census counts
  // with and upsertMany guards with. The assertions below are mostly about
  // what it must NOT do.
  console.log('\n── a deletion with five safeguards ' + '─'.repeat(39))
  {
    const prune = C.PRODUCTS && C.PRODUCTS.pruneLegacyRows && C.PRODUCTS.pruneLegacyRows._handler
    check(typeof prune === 'function', 'the REAL products.pruneLegacyRows handler is what these tests run')

    const CONFIRM = 'delete-legacy-rows'
    /** A corpus that would trip a rule using EITHER predicate alone. */
    const fixture = () => [
      // 6 genuine candidates: legacy key AND no country.
      ...Array.from({ length: 6 }, (_, i) => row({ key: `kith.com::L${i}`, sourceId: `L${i}` })),
      // Legacy-SHAPED key but country-scoped. A key-only rule would take these.
      row({ key: 'kith.com::T1', sourceId: 'T1', country: 'US' }),
      row({ key: 'kith.com::T2', sourceId: 'T2', country: '--' }),
      // Country undefined but a SCOPED key. A column-only rule would take these.
      row({ key: 'kith.com::T3::US', sourceId: 'T3' }),
      row({ key: 'kith.com::T4::US::EUR', sourceId: 'T4' }),
      // Live rows, exactly as the writer produces them.
      row({ key: 'kith.com::U1::US', sourceId: 'U1', country: 'US', requestedCurrency: 'USD' }),
      row({ key: 'kith.com::E1::US::EUR', sourceId: 'E1', country: 'US', requestedCurrency: 'EUR' }),
    ]
    const run = (rows, args) => prune({ db: makeDb(rows) }, { adminSecret: ADMIN, ...args })
    const walkPrune = async (rows, args = {}) => {
      let cursor = null, deleted = 0, scanned = 0, calls = 0, done = false
      for (let g = 0; g < 100; g++) {
        const r = await run(rows, { confirm: CONFIRM, cursor, limit: 5, ...args })
        calls++; deleted += r.deleted; scanned += r.scanned
        if (r.isDone) { done = true; break }
        cursor = r.cursor
      }
      return { deleted, scanned, calls, done }
    }

    // ── the gate ────────────────────────────────────────────────────────
    const rows0 = fixture()
    same(await prune({ db: makeDb(rows0) }, { adminSecret: 'wrong', confirm: CONFIRM, dryRun: false }),
      null, 'a wrong operator secret gets null, and deletes nothing')
    same(rows0.length, 12, '  the table is untouched')

    // ── confirm ─────────────────────────────────────────────────────────
    for (const [label, confirm] of [['missing', ''], ['wrong', 'yes'], ['near-miss', 'delete-legacy-row']]) {
      const rows = fixture()
      const r = await run(rows, { confirm, dryRun: false })
      same(r.ok, false, `a ${label} confirm phrase refuses`)
      same(r.deleted, 0, '  and deletes nothing')
      same(rows.length, 12, '  the table is untouched')
    }

    // ── dryRun DEFAULTS TO TRUE ─────────────────────────────────────────
    // The destructive call is the one you have to ask for.
    {
      const rows = fixture()
      const r = await run(rows, { confirm: CONFIRM })     // no dryRun given
      same(r.dryRun, true, 'dryRun DEFAULTS to true when it is not passed')
      same(rows.length, 12, '  so a confirmed call still deletes nothing')
      check(r.deleted > 0, '  while still counting what it would take', String(r.deleted))
      const explicit = await run(fixture(), { confirm: CONFIRM, dryRun: undefined })
      same(explicit.dryRun, true, '  and an explicit undefined is still a dry run')
    }

    // ── the dry run and the real run agree, because it is one loop ───────
    {
      const dry = await walkPrune(fixture(), { dryRun: true })
      const rows = fixture()
      const real = await walkPrune(rows, { dryRun: false })
      same(dry.deleted, 6, 'the dry run counts exactly the six candidates')
      same(real.deleted, 6, '  and the real run deletes exactly the same six')
      same(dry.deleted, real.deleted, '  the two cannot disagree — same loop, same predicate')
      same(rows.length, 6, '  six of twelve rows survive')

      // And it agrees with the census, which is the number an operator reads
      // BEFORE deciding. Three counts, one predicate.
      const c = await walkCensus(fixture(), 5)
      same(c.wouldDelete, dry.deleted, 'the census wouldDelete equals the prune dry run')
    }

    // ── what it must never take ─────────────────────────────────────────
    {
      const rows = fixture()
      await walkPrune(rows, { dryRun: false })
      const left = rows.map(r => r.key).sort()
      same(left.length, 6, 'six survivors')
      check(!left.some(k => /::L\d/.test(k)), '  no candidate survived')
      check(left.includes('kith.com::T1') && left.includes('kith.com::T2'),
        'a legacy-SHAPED key with a country is NOT deleted — a key-only rule would have taken it')
      check(left.includes('kith.com::T3::US') && left.includes('kith.com::T4::US::EUR'),
        'a scoped key with no country is NOT deleted — a column-only rule would have taken it')
      check(left.includes('kith.com::U1::US') && left.includes('kith.com::E1::US::EUR'),
        'no row carrying a requestedCurrency is deleted')
    }

    // WHY a requestedCurrency row can never be a candidate, from the writer
    // rather than from this fixture: corpusWriter.toRow sets
    // `country: p.source.country ?? UNKNOWN_COUNTRY`, unconditionally and for
    // every row it emits. So requestedCurrency defined implies country defined,
    // which the second condition excludes. The census counts the violation
    // anyway — candidatesCarryingRequestedCurrency — because a structural
    // argument is worth having a live counter behind it.
    {
      const writer = fs.readFileSync(path.join(WEB, 'lib/services/corpusWriter.ts'), 'utf8')
      check(/country: p\.source\.country \?\? UNKNOWN_COUNTRY/.test(writer),
        'the writer always records a country, so a requestedCurrency row always has one')
    }

    // ── survivors are not edited ────────────────────────────────────────
    // A cleanup that patched a surviving row would move lastChangedAt, which is
    // the signal three phases went into making trustworthy.
    {
      const rows = fixture()
      const before = JSON.stringify(rows.filter(r => !/::L\d$/.test(r.key)))
      await walkPrune(rows, { dryRun: false })
      same(JSON.stringify(rows), before, 'every surviving row is byte-identical afterwards')
    }

    // ── bounded, resumable, idempotent ──────────────────────────────────
    {
      const huge = await run(fixture(), { confirm: CONFIRM, limit: 1e9 })
      check(huge.scanned <= 500, 'a caller cannot ask for an unbounded batch', String(huge.scanned))

      const rows = fixture()
      const first = await walkPrune(rows, { dryRun: false })
      same(first.done, true, 'the traversal reports done')
      check(first.calls > 1, '  across more than one bounded call', String(first.calls))
      same(first.scanned, 12, '  having scanned every row exactly once')
      const second = await walkPrune(rows, { dryRun: false })
      same(second.deleted, 0, 'running it again deletes nothing — it is idempotent')
      same(rows.length, 6, '  and the survivors are still there')

      const emptyRun = await walkPrune([], { dryRun: false })
      same(emptyRun.deleted, 0, 'an empty corpus deletes nothing and still completes')
      same(emptyRun.done, true, '  and reports done')
    }

    // ── it only ever deletes ────────────────────────────────────────────
    {
      const src = fs.readFileSync(path.join(WEB, 'convex/products.ts'), 'utf8')
      const body = src.slice(src.indexOf('export const pruneLegacyRows = mutation('))
      check(!/ctx\.db\.(insert|patch|replace)/.test(body),
        'pruneLegacyRows never inserts, patches or replaces — it only deletes')
      check(/keyShape\(r\.key, r\.merchant, r\.sourceId\) !== "legacy"/.test(body),
        '  and it reuses the census predicate rather than restating it')
      check(/r\.country !== undefined/.test(body), '  with the country condition beside it')
      check(/\.paginate\(\{ numItems, cursor/.test(body), '  paginating by the immutable order')
      check(!/withIndex\("by_last_seen"\)/.test(body), '  never by a mutable index')
    }
  }

  const convexSrc = fs.readFileSync(path.join(WEB, 'convex/products.ts'), 'utf8')
  const exported = (convexSrc.match(/export\s+const\s+(\w+)\s*=\s*(query|mutation)\(/g) || [])
    .map(m => m.replace(/export\s+const\s+/, '').replace(/\s*=\s*/, ' = '))
  // THE SET, NOT THE COUNT. This asserted `length === 2` and a count is the
  // weaker claim: it passes for any two functions, including a read a shopper
  // could reach. Naming them means a new export has to be added here on
  // purpose, and the two reads are separately proven admin-gated below.
  same(exported.join(' · '),
    'upsertMany = mutation( · inspect = query( · census = query( · pruneLegacyRows = mutation(',
    'products.ts exports exactly these four functions')

  // Every query is behind the admin gate. `upsertMany` has its own server
  // secret; what must never happen is a READ that has neither.
  const queryNames = (convexSrc.match(/export\s+const\s+(\w+)\s*=\s*query\(/g) || [])
    .map(m => m.replace(/export\s+const\s+/, '').replace(/\s*=\s*query\($/, ''))
  same(queryNames.join(','), 'inspect,census', '  both reads are queries, named')
  for (const q of queryNames) {
    const body = convexSrc.slice(convexSrc.indexOf(`export const ${q} = query(`))
    check(/verifyAdminSecret\(args\.adminSecret\)/.test(body.slice(0, 1200)),
      `  ${q} is guarded by the admin secret`)
  }
  check(/adminSecret/.test(convexSrc), 'and the read one is behind the operator secret')

  console.log(bad === 0
    ? '\nthe query is bounded, ordered, guarded, and reaches no page\n'
    : `\n${bad} FAILED\n`)
  process.exit(bad === 0 ? 0 : 1)
})()
