/**
 * Whose product is it, and who is allowed to write on it.
 *
 * A catalogue search fills a module-level LRU pool with parsed products and
 * hands the SAME OBJECTS to every shopper whose query, country and brand set
 * hash to the same key. The cache key does not include currency
 * (`makeCacheKey`, GlobalCatalogService), and `applyFiltersAndSort` used to
 * write `display_price` and `display_currency` — which are a function of the
 * SHOPPER, not of the garment — straight onto those pooled objects.
 *
 * Between that write and the response, a search awaits the relevance judge and
 * then the palette pass. That is seconds of wall clock during which a second
 * shopper on the same query can reach the same pool and overwrite the first
 * shopper's currency underneath them. Nothing in the app noticed, because
 * nothing anywhere compared the two.
 *
 * So the load-bearing test here is not "are these two objects different". It
 * drives two real, overlapping `GlobalCatalogService.search()` calls through
 * the real code path — one shopper in USD, one in INR, same query, same
 * country, no brands, therefore the same cached entry — and suspends the first
 * one INSIDE its palette pass by holding its image fetches open. The second
 * runs to completion in that window. Then the first is released and asked what
 * currency it is holding.
 *
 * Against a384bc3 it answers INR. That is the defect, and this is the proof.
 *
 * Everything else in this file is a preservation guard around that fix: the
 * pooled merchant facts, the nested arrays a shallow copy still shares, the
 * object-identity assumption the worn-gender demotion makes, the wire fields
 * Boutique reads, provenance, and the identity functions.
 *
 * NO NETWORK. `global.fetch` is stubbed for the store fan-out, the exchange
 * rates and the image reads; the relevance judge is pointed at a stub base URL
 * through GROQ_BASE_URL. Every one of those is a real code path with a fake
 * other end.
 */

// ── env, before anything is required ────────────────────────────────────────
// GROQ_DIRECT_API_KEY and GROQ_DIRECT_BASE are read at MODULE SCOPE in
// lib/groq.ts, so they have to be set before the bundle is loaded — setting
// them later reads as "no provider configured" and the judge silently never
// runs. Every other provider key is cleared so the ladder has exactly one
// ready rung and the test cannot depend on which of five answered.
process.env.GROQ_API_KEY = 'stub-key'
process.env.GROQ_BASE_URL = 'https://groq.stub.test/openai/v1'
for (const k of ['CEREBRAS_API_KEY', 'NVIDIA_API_KEY', 'GOOGLE_AI_API_KEY',
                 'OPENROUTER_API_KEY', 'OPENAI_API_KEY']) delete process.env[k]
// The persisted caches would reach for Convex; the vision enrichment would
// reach for a provider. Neither is what this file is about.
process.env.SEARCH_CACHE = 'off'
process.env.PROFILE_PERSISTENT_CACHE = 'off'
process.env.RERANK_PERSISTENT_CACHE = 'off'
process.env.ENRICH_VISION = 'off'
delete process.env.NEXT_PUBLIC_CONVEX_URL
delete process.env.CONVEX_AUTH_SECRET
// Judged in front of the response rather than behind it, so one search's
// ranking state is observable in that search's own return value.
process.env.RELEVANCE_RERANK_BLOCKING = 'on'

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

// One bundle for the catalogue and, when it exists, the canonical product
// module beside it — so the identity functions under test are the same
// instance the catalogue itself is using, not a second copy.
const entryFile = path.join(WEB, '.vt', 'canonical-entry.ts')
fs.mkdirSync(path.join(WEB, '.vt'), { recursive: true })
const hasProductModule = fs.existsSync(path.join(WEB, 'lib/catalog/product.ts'))
fs.writeFileSync(entryFile,
  `export { GlobalCatalogService } from ${JSON.stringify(path.join(WEB, 'lib/services/GlobalCatalogService'))}\n` +
  `export { rerankByRelevance } from ${JSON.stringify(path.join(WEB, 'lib/services/relevanceRerank'))}\n` +
  (hasProductModule
    ? `export * as P from ${JSON.stringify(path.join(WEB, 'lib/catalog/product'))}\n`
    : `export const P = null\n`))
const C = build('.vt/canonical-entry.ts', 'canonical-product')
const P = C.P

// ── the other end of every wire ─────────────────────────────────────────────

/** Rates that make USD and INR visibly different numbers, not just different
 *  labels — so a test that passes on the currency code alone cannot hide a
 *  price that was never converted. */
const RATES = { USD: 1, EUR: 0.9, GBP: 0.8, INR: 83, JPY: 150 }

/** One store's UCP answer, in the envelope GlobalCatalogService unwraps. */
const ucpBody = (products) => JSON.stringify(
  { result: { content: [{ type: 'text', text: JSON.stringify({ products }) }] } })

/** Four pieces per store, priced in minor units the way UCP quotes them.
 *  `run` is in the ids and image URLs so no two scenarios share a cache entry
 *  or a palette memo. */
function productsFor(domain, run) {
  const token = domain.replace(/\..*$/, '').replace(/[^a-z0-9]/gi, '')
  return Array.from({ length: 4 }, (_, i) => ({
    id: `gid://shopify/Product/${token}-${run}-${i}`,
    title: `Plain Linen Shirt ${i}`,
    url: `https://${domain}/products/${token}-${i}`,
    media: [{ url: `https://cdn.shopify.com/s/files/${token}-${run}-${i}.jpg` }],
    description: { plain: 'A considered piece, cut from washed linen.' },
    tags: ['shirt', 'linen'],
    options: [{ name: 'Size', values: ['S', 'M', 'L'] }],
    variants: [{
      id: `gid://shopify/ProductVariant/${token}-${run}-${i}`,
      title: 'M', availability: true,
      price: { amount: 475000, currency: 'USD' },
      url: `https://${domain}/products/${token}-${i}`,
    }],
  }))
}

/** What the relevance judge is answered with: a well-formed score for every
 *  index it was shown, so the judge takes its `judged` path rather than any of
 *  its silent fallbacks. */
function judgeAnswer(body) {
  let n = 40
  try {
    const products = String(JSON.parse(body).messages.map(m => m.content).join('\n'))
    n = (products.match(/^\[\d+\] /gm) || []).length || 40
  } catch { /* the default covers it */ }
  const arr = Array.from({ length: n }, (_, i) => ({ i, s: 90 - (i % 40) }))
  return new Response(JSON.stringify({
    choices: [{ message: { role: 'assistant', content: JSON.stringify(arr) } }],
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}

const realFetch = global.fetch
const restore = () => { global.fetch = realFetch }

/** The state the image gate reads. `phase` is flipped by the driver below;
 *  while it is 'A', every product photograph request is parked. */
const gate = { phase: 'open', held: 0, release: null, firstHeld: null }

function installFetch(opts = {}) {
  const seen = { stores: 0, images: 0, judge: 0 }
  global.fetch = async (u, init) => {
    const url = String(u)

    if (url.includes('open.er-api.com')) {
      return new Response(JSON.stringify({ rates: RATES }), {
        status: 200, headers: { 'content-type': 'application/json' } })
    }

    if (url.includes('groq.stub.test')) {
      seen.judge++
      return judgeAnswer(init && init.body)
    }

    if (/\/api\/mcp$/.test(url)) {
      seen.stores++
      const domain = new URL(url).hostname
      const list = opts.storeProducts ? opts.storeProducts(domain) : productsFor(domain, opts.run)
      return new Response(ucpBody(list), {
        status: 200, headers: { 'content-type': 'application/json' } })
    }

    if (url.includes('cdn.shopify.com')) {
      seen.images++
      if (gate.phase === 'A') {
        gate.held++
        if (gate.held === 1 && gate.firstHeld) gate.firstHeld()
        await new Promise(r => { const p = gate.release; gate.release = () => { p && p(); r() } })
      }
      // Not a decodable image on purpose: paletteOf catches and returns null,
      // which is the "unread photograph" branch the ranking already handles.
      // This test is about who owns the object, not about colour.
      return new Response('not-an-image', { status: 404 })
    }

    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return seen
}

/** The positional argument list `search` actually takes, named once here so a
 *  scenario reads as the shopper it describes. */
const search = (q, currency, extra = {}) => C.GlobalCatalogService.search(
  q,                       // query
  undefined,               // budgetMax
  [],                      // excludeIds
  'US',                    // countryCode
  true,                    // _isClothing
  extra.concepts || [],    // mandatoryConcepts
  'relevance',             // sort
  currency,                // budgetCurrency
  {},                      // options
  [],                      // brandDomains — empty: a CATEGORY search, so the
                           // palette pass runs and can be used as the gate
  undefined,               // _tasteProfile
  q,                       // rerankQuery
  null,                    // preferredSize
  null,                    // matchImage
)

let run = 0
const nextQuery = () => `plain linen shirt canonical ${++run}`

// ════════════════════════════════════════════════════════════════════════════
// 1. TWO SHOPPERS, ONE CACHED POOL — the load-bearing differential
// ════════════════════════════════════════════════════════════════════════════
async function concurrentShoppers() {
  console.log('\n── two shoppers, one cached pool ' + '─'.repeat(41))

  process.env.RELEVANCE_RERANK = 'off'   // the gate here is the palette, not
                                         // the judge; keep the judge out of it
  const q = nextQuery()
  const seen = installFetch({ run })

  gate.phase = 'A'
  gate.held = 0
  gate.release = null
  const firstHeld = new Promise(r => { gate.firstHeld = r })

  // Shopper A, in dollars. Runs until its palette pass asks for the first
  // product photograph, and is parked there — which is AFTER
  // applyFiltersAndSort has already decided A's display currency.
  const pA = search(q, 'USD')

  const parked = await Promise.race([
    firstHeld.then(() => 'parked'),
    new Promise(r => setTimeout(() => r('never'), 15000)),
  ])
  check(parked === 'parked',
    'shopper A is suspended inside its own request, holding its result',
    parked === 'parked' ? `${gate.held} photograph read(s) parked` : 'A never reached the palette pass')
  if (parked !== 'parked') { gate.phase = 'open'; if (gate.release) gate.release(); await pA.catch(() => {}); restore(); return }

  // Shopper B, in rupees, same query and country and no brands — therefore
  // the SAME cache key and the same pooled product objects. Runs start to
  // finish in the window A is parked in.
  gate.phase = 'B'
  const rB = await search(q, 'INR')
  check(rB.length >= 4, 'shopper B got a page of its own', `${rB.length} products`)

  // Let A finish.
  gate.phase = 'open'
  if (gate.release) gate.release()
  const rA = await pA
  restore()

  check(rA.length >= 4, 'shopper A got a page of its own', `${rA.length} products`)

  const aCurrencies = Array.from(new Set(rA.map(p => p.display_currency)))
  const bCurrencies = Array.from(new Set(rB.map(p => p.display_currency)))

  check(bCurrencies.length === 1 && bCurrencies[0] === 'INR',
    'shopper B is shown rupees', bCurrencies.join(','))

  // THE ASSERTION THIS FILE EXISTS FOR.
  check(aCurrencies.length === 1 && aCurrencies[0] === 'USD',
    'shopper A is still shown dollars after B ranked the same pool',
    aCurrencies.join(','))

  const aPrices = Array.from(new Set(rA.map(p => p.display_price)))
  const bPrices = Array.from(new Set(rB.map(p => p.display_price)))
  check(aPrices.every(v => v === 4750), 'and A\'s converted price is the dollar one', aPrices.join(','))
  check(bPrices.every(v => v === Math.round(4750 * 83)), 'and B\'s is the rupee one', bPrices.join(','))

  // Merchant facts are the same for both, because they belong to the merchant.
  check(rA.every(p => p.price === 4750 && p.currency === 'USD'),
    'the merchant\'s own price and currency are untouched for A')
  check(rB.every(p => p.price === 4750 && p.currency === 'USD'),
    'and untouched for B — checkout still hands off in the brand\'s currency')

  // Two requests must not be handed the same mutable object.
  const byIdA = new Map(rA.map(p => [p.id, p]))
  const shared = rB.filter(p => byIdA.get(p.id) === p)
  check(shared.length === 0,
    'no product object is shared between the two requests',
    `${shared.length} shared reference(s)`)

  // A third shopper, later, on the warm pool: the pooled facts must still be
  // the merchant's, and the display must be theirs.
  gate.phase = 'open'
  installFetch({ run })
  const rC = await search(q, 'GBP')
  restore()
  check(rC.length >= 4 && rC.every(p => p.price === 4750 && p.currency === 'USD'),
    'the pooled merchant facts survive both of them')
  check(rC.every(p => p.display_currency === 'GBP' && p.display_price === Math.round(4750 * 0.8)),
    'and a later shopper on the warm pool is shown pounds')

  return { rA, rB, seen }
}

// ════════════════════════════════════════════════════════════════════════════
// 2. NESTED DATA — what a shallow copy still shares
// ════════════════════════════════════════════════════════════════════════════
// A request-owned copy is shallow: `variants`, `media` and `options` are the
// SAME arrays the pooled object holds. That is fine only for as long as
// nothing downstream writes to them. This establishes whether anything does,
// rather than assuming it does not and deep-cloning on every search to be
// safe.
async function nestedData() {
  console.log('\n── the arrays a shallow copy still shares ' + '─'.repeat(32))
  process.env.RELEVANCE_RERANK = 'off'

  const q = nextQuery()
  installFetch({ run })
  const first = await search(q, 'USD')
  restore()
  check(first.length >= 4, 'a page to instrument', `${first.length} products`)

  const snapshot = JSON.stringify(first.map(p => ({ v: p.variants, m: p.media, o: p.options })))

  // Frozen, so a write throws where the module is strict, AND snapshotted, so
  // a write is caught where it does not. Belt and braces: a silently ignored
  // write is still a write somebody meant to make.
  for (const p of first) {
    for (const arr of [p.variants, p.media, p.options]) {
      if (!Array.isArray(arr)) continue
      for (const el of arr) if (el && typeof el === 'object') Object.freeze(el)
      Object.freeze(arr)
    }
  }

  let threw = null
  installFetch({ run })
  try {
    await search(q, 'INR')          // warm pool, full ranking path, same objects
    await search(q, 'JPY')
  } catch (e) { threw = e instanceof Error ? e.message : String(e) }
  restore()

  check(threw === null, 'no request writes to a pooled nested array', threw || 'nothing threw')

  installFetch({ run })
  const after = await search(q, 'GBP')
  restore()
  const stillSame = JSON.stringify(after.map(p => ({ v: p.variants, m: p.media, o: p.options })))
  check(stillSame === snapshot, 'and their contents are byte-identical afterwards')
}

// ════════════════════════════════════════════════════════════════════════════
// 3. OBJECT IDENTITY — the assumption the worn-gender demotion makes
// ════════════════════════════════════════════════════════════════════════════
// GlobalCatalogService's last ranking step partitions the page with
// `new Set(wrong)` and `result.filter(p => !wrongSet.has(p))` — object
// identity, not ids. Introducing request-owned copies must not break that:
// within ONE request every element has to stay a distinct, stable reference.
async function objectIdentity() {
  console.log('\n── the identity the last ranking step relies on ' + '─'.repeat(26))
  process.env.RELEVANCE_RERANK = 'off'

  const q = nextQuery()
  installFetch({ run })
  const result = await search(q, 'USD')
  restore()

  check(new Set(result).size === result.length,
    'every product on one page is a distinct object',
    `${new Set(result).size} of ${result.length}`)

  // The exact expression at the demotion, run against the real page.
  const wrong = result.filter((_, i) => i % 3 === 0)
  const wrongSet = new Set(wrong)
  const reordered = [...result.filter(p => !wrongSet.has(p)), ...wrong]
  check(reordered.length === result.length,
    'the demotion partitions the page without losing a piece',
    `${reordered.length} of ${result.length}`)
  check(new Set(reordered).size === result.length,
    'and without duplicating one')
  check(reordered.slice(-wrong.length).every((p, i) => p === wrong[i]),
    'and the demoted pieces land at the back, in order')

  // applySizePreference and the geo sort both map over the same references.
  check(result.every(p => p && typeof p.id === 'string' && p.id.length > 0),
    'every piece survived the reorder chain intact')
}

// ════════════════════════════════════════════════════════════════════════════
// 4. PROVENANCE
// ════════════════════════════════════════════════════════════════════════════
async function provenance() {
  console.log('\n── did the merchant tell us this ' + '─'.repeat(41))
  process.env.RELEVANCE_RERANK = 'off'

  const started = Date.now()
  const q = nextQuery()
  installFetch({ run })
  const result = await search(q, 'USD')
  restore()
  const finished = Date.now()

  const p = result[0]
  check(!!p, 'a product to ask about')
  if (!p) return

  check(!!p.source, 'it carries where it came from', p.source ? 'yes' : 'MISSING')
  if (!p.source) return

  const domain = new URL(p.store_url).hostname
  same(p.source.merchant, domain, 'source.merchant is the store it came from')
  same(p.source.sourceId, p.id, 'source.sourceId is the id the merchant used')
  same(p.source.via, 'ucp-mcp', 'source.via names the retrieval path')
  check(typeof p.source.fetchedAt === 'number' && p.source.fetchedAt >= started && p.source.fetchedAt <= finished,
    'source.fetchedAt falls inside this run', String(p.source.fetchedAt))
  same(p.source.schema, 1, 'source.schema is the canonical schema version')
  check(typeof p.key === 'string' && p.key.length > 0, 'and it carries a stable key', p.key)
}

// ════════════════════════════════════════════════════════════════════════════
// 5. IDENTITY FUNCTIONS
// ════════════════════════════════════════════════════════════════════════════
// A Shopify product GID is allocated PER SHOP, so the bare id is not a global
// name for a garment. These are defined now and wired into storage later; what
// is asserted here is that they are correct and total, not that anything uses
// them yet.
function identityFunctions() {
  console.log('\n── naming a garment across two shops ' + '─'.repeat(37))
  if (!P || !P.productKey) {
    check(false, 'lib/catalog/product.ts exports the identity functions', 'module missing')
    return
  }
  const { merchantKey, productKey, variantKey } = P

  same(merchantKey('https://www.Kith.com/products/x'), 'kith.com', 'merchantKey strips www and case')
  same(merchantKey('kith.com'), 'kith.com', 'merchantKey takes a bare domain')
  same(merchantKey('  HTTPS://Kith.com  '), 'kith.com', 'merchantKey tolerates whitespace')
  same(merchantKey(''), '', 'merchantKey has an empty answer, not a throw')
  same(merchantKey(null), '', 'and for null')
  same(merchantKey('not a url'), '', 'and for something that is not a URL')

  const a = { id: 'gid://shopify/Product/999', store_url: 'https://kith.com/products/a',
              source: { merchant: 'kith.com', sourceId: 'gid://shopify/Product/999' } }
  const b = { id: 'gid://shopify/Product/999', store_url: 'https://aime-leon-dore.com/products/b',
              source: { merchant: 'aime-leon-dore.com', sourceId: 'gid://shopify/Product/999' } }

  same(productKey(a), 'kith.com::gid://shopify/Product/999', 'productKey qualifies the id by merchant')
  check(productKey(a) !== productKey(b),
    'two shops sharing a numeric id are two different garments',
    `${productKey(a)} vs ${productKey(b)}`)

  // Price and title are mutable merchant state and must not be identity.
  const aLater = { ...a, price: 9999, title: 'Renamed', in_stock: false }
  same(productKey(aLater), productKey(a), 'a price, title or stock change does not rename a garment')

  same(variantKey(a, { id: 'gid://shopify/ProductVariant/7' }),
    'kith.com::gid://shopify/Product/999::gid://shopify/ProductVariant/7',
    'variantKey hangs off the product key')
  check(variantKey(a, { id: 'v1' }) !== variantKey(b, { id: 'v1' }),
    'and two shops\' variants are distinct too')

  same(P.CANONICAL_SCHEMA_VERSION, 1, 'the canonical schema is at version 1')
}

// ════════════════════════════════════════════════════════════════════════════
// 6. RANKING STATE
// ════════════════════════════════════════════════════════════════════════════
// The judge's verdict is a fact about one request, not about a garment. It
// must not be written onto the product — and, since the pooled products are
// what a later shopper is handed, must not be able to reach one.
async function rankingState() {
  console.log('\n── the judge\'s verdict belongs to the request ' + '─'.repeat(28))
  process.env.RELEVANCE_RERANK = 'on'

  const q = nextQuery()
  const seen = installFetch({ run })
  let outcome = null
  const result = await C.GlobalCatalogService.search(
    q, undefined, [], 'US', true, [], 'relevance', 'USD',
    { onJudge: (o) => { outcome = o } }, [], undefined, q, null, null)
  restore()
  process.env.RELEVANCE_RERANK = 'off'

  check(seen.judge > 0, 'the judge actually ran', `${seen.judge} call(s)`)
  check(outcome === 'judged' || outcome === 'cached',
    'and it actually scored this page', String(outcome))

  const polluted = result.filter(p => 'relevance_score' in p || 'relevance_reason' in p)
  check(polluted.length === 0,
    'no product carries a relevance score',
    `${polluted.length} of ${result.length} do`)

  const trusted = result.filter(p => 'trust_score' in p)
  check(trusted.length === 0, 'and none carries a trust score', `${trusted.length}`)

  // The verdict is not thrown away — it is addressed to the request that asked
  // for it. A caller who wants the scores supplies somewhere to put them.
  process.env.RELEVANCE_RERANK = 'on'
  const state = new Map()
  installFetch({ run })
  const ranked = await C.rerankByRelevance(`${q} judged directly`, result, undefined, undefined, state)
  restore()
  process.env.RELEVANCE_RERANK = 'off'

  check(ranked.length === result.length,
    'the ranking still returns every piece it was given',
    `${ranked.length} of ${result.length}`)
  check(state.size > 0, 'and the scores land in the request\'s own ranking state', `${state.size} scored`)

  const keys = new Set(result.map(p => p.key))
  const foreign = Array.from(state.keys()).filter(k => !keys.has(k))
  check(foreign.length === 0, 'keyed by the product key, and nothing else', `${foreign.length} unknown key(s)`)

  const anySignal = Array.from(state.values()).find(v => typeof v.judgeScore === 'number')
  check(!!anySignal, 'the judge score is there to be read',
    anySignal ? `judgeScore ${anySignal.judgeScore}` : 'no judgeScore recorded')

  // Two shoppers, two rankings, one garment — and the garment does not change.
  const other = new Map()
  installFetch({ run })
  process.env.RELEVANCE_RERANK = 'on'
  await C.rerankByRelevance(`${q} judged for someone else`, result, 'prefers workwear', undefined, other)
  restore()
  process.env.RELEVANCE_RERANK = 'off'
  check(other.size > 0, 'a second shopper gets a ranking of their own', `${other.size} scored`)
  check(state !== other && Array.from(state.keys()).every(k => keys.has(k)),
    'held separately, over the same unchanged products')
  check(result.every(p => p.price === 4750 && p.currency === 'USD' && !('relevance_score' in p)),
    'and neither ranking left a mark on the products')
}

// ════════════════════════════════════════════════════════════════════════════
// 7. WHAT THE INTERFACE READS
// ════════════════════════════════════════════════════════════════════════════
// features/v2/Boutique.tsx `toProduct()` and lib/stylist/retrieval.ts read
// these off the object the route serialises. Removing or renaming one is a
// blank price or a dead checkout link, so the wire shape is pinned.
async function wireCompatibility() {
  console.log('\n── every field the interface reads ' + '─'.repeat(39))
  process.env.RELEVANCE_RERANK = 'off'

  const q = nextQuery()
  installFetch({ run })
  const result = await search(q, 'INR')
  restore()

  const p = result[0]
  check(!!p, 'a product to serialise')
  if (!p) return

  const REQUIRED = ['id', 'title', 'price', 'currency', 'display_price', 'display_currency',
                    'media', 'vendor', 'store_url', 'variants', 'options', 'description', 'image_url']
  const missing = REQUIRED.filter(k => !(k in p))
  check(missing.length === 0, 'the wire object still carries all thirteen',
    missing.length ? `missing ${missing.join(', ')}` : REQUIRED.length + ' present')

  // The shapes Boutique destructures, not just the keys.
  check(Array.isArray(p.variants) && p.variants.every(v => 'id' in v && Array.isArray(v.options) && 'availability' in v),
    'variants still carry id, options and availability for the bag')
  check(Array.isArray(p.media) && p.media.every(m => typeof m.url === 'string'),
    'media still carry urls')
  check(Array.isArray(p.options) && p.options.every(o => typeof o.name === 'string' && Array.isArray(o.values)),
    'options still carry a name and values')
  check(typeof p.store_url === 'string' && p.store_url.startsWith('https://'),
    'store_url is still where checkout hands off', p.store_url)

  // It has to survive the trip through JSON, which is how it actually leaves.
  const wire = JSON.parse(JSON.stringify(p))
  const lost = REQUIRED.filter(k => !(k in wire))
  check(lost.length === 0, 'and all of it survives JSON serialisation',
    lost.length ? `lost ${lost.join(', ')}` : 'intact')
}

// ── run ─────────────────────────────────────────────────────────────────────
;(async () => {
  console.log('\nwho owns a product, and who may write on it\n')
  try {
    await concurrentShoppers()
    await nestedData()
    await objectIdentity()
    await provenance()
    identityFunctions()
    await rankingState()
    await wireCompatibility()
  } catch (e) {
    check(false, 'the harness ran to completion', e instanceof Error ? (e.stack || e.message) : String(e))
  } finally {
    restore()
    gate.phase = 'open'
    if (gate.release) gate.release()
  }

  console.log(bad === 0
    ? '\nmerchant facts are the merchant\'s, and a ranking belongs to the request that made it\n'
    : `\n${bad} FAILED\n`)
  process.exit(bad === 0 ? 0 : 1)
})()
