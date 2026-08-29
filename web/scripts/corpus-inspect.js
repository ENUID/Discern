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
const reads = { withIndex: [], order: [], take: [], fullScans: 0 }

function makeDb(rows) {
  return {
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
const row = (o) => ({
  _id: `r-${o.key}`,
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
})

;(async () => {
  console.log('\nwhat the corpus actually holds\n')

  const handler = C.PRODUCTS && C.PRODUCTS.inspect && C.PRODUCTS.inspect._handler
  check(typeof handler === 'function',
    'the REAL products.inspect handler is what these tests run', handler ? '' : 'not reachable')
  if (typeof handler !== 'function') { console.log(`\n${bad} FAILED\n`); process.exit(1) }
  const run = (rows, args = {}) => handler({ db: makeDb(rows) }, { adminSecret: ADMIN, ...args })

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
    row({ key: 'kith.com::1', lastSeenAt: T0 + 5 * DAY, firstSeenAt: T0, lastChangedAt: T0 + DAY,
          currencyStated: true, availabilityStated: true, vendorSource: 'merchant' }),
    row({ key: 'kith.com::2', lastSeenAt: T0 + 4 * DAY, inStock: false,
          currencyStated: true, availabilityStated: true, vendorSource: 'merchant' }),
    row({ key: 'kith.com::3', lastSeenAt: T0 + 3 * DAY, status: 'quarantined', price: 0,
          currencyStated: false, availabilityStated: false, vendorSource: 'domain' }),
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
  same(s.defaulted.currencyUSD, 6, 'six are USD — real or defaulted, indistinguishable')
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
    /products\.inspect|['"`]inspect['"`]\s*[,)]/.test(fs.readFileSync(f, 'utf8')))
  same(namesInspect.length, 0,
    'no file under app/, lib/, features/ or components/ names the inspection query',
    namesInspect.map(f => path.relative(WEB, f)).join(', ') || 'none')

  const writer = fs.readFileSync(path.join(WEB, 'lib/services/corpusWriter.ts'), 'utf8')
  check(/anyApi\.products\.upsertMany/.test(writer), 'the writer still calls upsertMany')
  check(!/products\.inspect/.test(writer), 'and the writer does NOT call inspect')

  const convexSrc = fs.readFileSync(path.join(WEB, 'convex/products.ts'), 'utf8')
  const exported = (convexSrc.match(/export\s+const\s+(\w+)\s*=\s*(query|mutation)\(/g) || [])
    .map(m => m.replace(/export\s+const\s+/, '').replace(/\s*=\s*/, ' = '))
  same(exported.length, 2, 'products.ts exports exactly two functions', exported.join(' · '))
  check(/adminSecret/.test(convexSrc), 'and the read one is behind the operator secret')

  console.log(bad === 0
    ? '\nthe query is bounded, ordered, guarded, and reaches no page\n'
    : `\n${bad} FAILED\n`)
  process.exit(bad === 0 ? 0 : 1)
})()
