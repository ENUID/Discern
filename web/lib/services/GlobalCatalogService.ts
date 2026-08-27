/**
 * Discern Catalog Search — queries each curated brand's own Shopify store catalog.
 *
 * Data source: every brand in the registry exposes a Universal Commerce Protocol
 * MCP endpoint at  https://{domain}/api/mcp  (search_catalog tool). We query the
 * selected brands' own endpoints directly — so results come ONLY from the brands
 * you've chosen, pulled live from each store's real Shopify catalog.
 *
 * Flow:
 *   1. Choose domains: exact brand match (user named a brand) OR category-filtered
 *      subset of the registry, relevance-sorted.
 *   2. Query those stores' /api/mcp in parallel batches.
 *   3. Parse → validate against registry → filter (budget / non-fashion) → sort.
 *   4. Cache the fetched product pool per query so "load more" paginates cleanly.
 */

import { UCP_REGISTRY, detectBrandsInQuery, BRAND_NAMES, getStoreCountry, GEO_REGIONS, brandQualityScore } from '../stores'
import { GARMENT_PRODUCT_TERMS, matchesGarmentExclusion, COLOR_VOCAB } from '../queryParser'
import { getExchangeRates } from '../exchangeRates'
import {
  isNonFashion,
  productGenderSignal,
  productColorFamilies,
  colorFamiliesAgree,
  requestedColorsFromConcepts,
  requestedGenderFromConcepts,
  applySizePreference,
  WOMEN_GENDER_RE,
  MEN_GENDER_RE,
  genderHaystack,
} from '../catalog/productFilters'
import { applyConceptRelevance } from '../catalog/concepts'
import { rerankByRelevance, type JudgeOutcome } from './relevanceRerank'
import { palettesFor, paletteCached, looksLike } from '../fashion/palette'
import { runAfterResponse } from '../afterResponse'
import { wornGenderFor } from './wornGender'
import { findSameGarment } from './sameGarment'

/** How the judge went for ONE search, reported to whoever asked for that
 *  search rather than left in a module-level slot.
 *
 *  It used to be `export let lastJudgeOutcome`, on the reasoning that it
 *  answers "is the taste layer running at all", which is a property of the
 *  deployment rather than of one request. That reasoning does not survive two
 *  shoppers at once: the value a request reported was whichever search
 *  finished last, so a request could and did report a judge outcome that
 *  belonged to somebody else's query. Proven, then fixed — see
 *  `scripts/judge-scope.js`.
 *
 *  Passed as `options.onJudge`, the same shape as `options.onProgress`
 *  directly above it, and request-scoped for the same reason: it is a closure
 *  over the caller's own state, so there is only ever one request's answer in
 *  it. A caller that does not pass it is not reporting the outcome and pays
 *  nothing. */
export type JudgeReport = (outcome: JudgeOutcome, detail: string) => void

/** What the last look at the shopper's photograph concluded.
 *
 *  The comparison already happens here, and the caller needs the ANSWER —
 *  not to ask the same question again. The stylist route did exactly that for
 *  a while: it ran findSameGarment a second time on the same photograph and
 *  the same candidates, so every photo search paid for two vision calls on
 *  whichever provider still had quota, to learn the same thing twice.
 *
 *  Keyed by the photograph it was asked about. A module-level value is shared
 *  by concurrent requests, and a stale verdict about somebody else's picture
 *  is worse than none — so the caller can only use it by naming the image it
 *  is asking about, and two shoppers holding up different photographs can
 *  never read each other's answer. */
export let lastSameGarment: { forImage: string; sameIndex: number | null; confidence: number; why: string } | null = null

/** The verdict for THIS photograph, or null. */
export function sameGarmentVerdictFor(image: string | null | undefined) {
  if (!image || !lastSameGarment || lastSameGarment.forImage !== image) return null
  return lastSameGarment
}
import { matchStyles, styleRecallSignals } from '../styleVocabulary'
import { recordBrandOutcome, deprioritizeDead } from './brandHealth'
import { safeFetch, BlockedDestinationError, ResponseTooLargeError } from '../ssrfGuard'
import { readPersistentCache, writePersistentCache } from './persistentSearchCache'
import { retrievalQueries } from '../fashion/outfitKnowledge'
import {
  CANONICAL_SCHEMA_VERSION, merchantKey, productKey,
  type CanonicalProduct, type ProductProvenance,
} from '../catalog/product'

// ─── Types ─────────────────────────────────────────────────────────────────────

/** What a search hands back: the merchant's garment, plus the two values this
 *  particular shopper's request decided about it.
 *
 *  The garment half is CanonicalProduct and is readonly — see lib/catalog/
 *  product.ts. It is the object the LRU pool below holds and every shopper on
 *  this query shares, so nothing about one request may be written into it.
 *
 *  The display half is the request's own. Three fields used to sit here that
 *  do not belong to either: `trust_score`, which nothing has ever written or
 *  read; and `relevance_score` / `relevance_reason`, which the LLM judge wrote
 *  onto the pooled object on every search and which nothing anywhere read.
 *  The judge's verdict is now handed to whoever asked for the ranking, as
 *  RankingState — one request's opinion, keyed and scoped to that request. */
export type UcpProduct = CanonicalProduct & {
  /** The same price, in the currency the SHOPPER is using.
   *
   *  Every product keeps the currency its own brand quoted, and the interface
   *  printed that verbatim — so one outfit showed a ₹4,750 shirt beside $630
   *  loafers beside €200 sandals. Three currencies on one screen is not a
   *  price list, it is a puzzle, and no one can tell whether the shoes cost
   *  four times the shirt or forty. Converted once, here, where the rates
   *  already are; `price` and `currency` stay untouched because checkout hands
   *  off to the brand and the brand quotes its own.
   *
   *  WRITTEN ON A COPY THIS REQUEST OWNS, never on the pooled product — see
   *  the end of applyFiltersAndSort. It is a fact about the shopper, and the
   *  pool is shared by all of them. */
  display_price?: number
  display_currency?: string
}

export type CatalogSearchDebug = {
  catalogFetched?: boolean
  loadMorePage?: number
  loadMoreQuery?: string
}

// Real-work progress the search emits at its genuine internal boundaries — the
// slow parallel catalog fetch, an optional broadening pass, and the LLM
// relevance judge. The route turns each into a live status line, so the search
// animation is paced by actual backend work (a phase stays on screen exactly as
// long as its step is running), never a client-side simulation.
export type CatalogProgress = (e: (
  | { kind: 'fetch'; brandCount: number; sampleBrands: string[] }
  | { kind: 'broaden'; queries: string[] }
  | { kind: 'judge'; candidates: number }
) & { label?: string }) => void

type ProductSort = 'price_asc' | 'price_desc' | 'relevance' | 'trust_desc'

// ─── Config ────────────────────────────────────────────────────────────────────

const STORE_TIMEOUT_MS = 5000   // many Shopify MCP endpoints take 2.5–4s; a tight
                                // timeout silently drops them and starves results
/** How long a round is allowed to hold up the page.
 *
 *  Distinct from STORE_TIMEOUT_MS, and the distinction is the whole point. The
 *  timeout is how long a STORE gets before we give up on it; this is how long
 *  the SHOPPER waits for the slowest one still talking. A store that needs 4.5s
 *  is not a problem to be cut off — its pieces are welcome whenever they land —
 *  it is only a problem when forty other stores have already answered and the
 *  page is being held for it. Late arrivals ingest into the same cached pool
 *  and show up on the next page or the next search. */
const STORE_SOFT_MS = Number(process.env.STORE_SOFT_MS ?? 2600)
const BATCH_SIZE = 45          // stores queried in parallel per round
const MAX_ROUNDS_PER_CALL = 2  // up to 90 stores fetched per search() call
// This is the CANDIDATE POOL fetched per call, not what a shopper actually
// sees — the stylist route's reranker (relevanceRerank.ts) judges from this
// whole pool and then slices to a much smaller best-of-best page
// (INITIAL_RESULT_CAP, currently 8) for a fresh search, or the next such
// page on a "See more" tap. Kept wide here so the reranker has real options
// to choose the best of, not narrowed to match the final display count.
const INITIAL_LIMIT = 52
const LOAD_MORE_LIMIT = 52
const CACHE_TTL_MS = 15 * 60 * 1000
const MAX_CACHE_ENTRIES = 300
const ZERO_DECIMAL_CURRENCIES = new Set(['VND', 'JPY', 'KRW'])

// ─── LRU cache (per query) ─────────────────────────────────────────────────────

type CacheEntry = {
  timestamp: number
  products: UcpProduct[]   // everything fetched for this query so far
  pending: string[]        // domains not yet queried, in relevance order
  queried: Set<string>     // domains already queried
  broadened?: boolean      // garment-only retry already performed for this query
}
const lruCache = new Map<string, CacheEntry>()

/** How long a query that came back with NOTHING stays remembered.
 *
 *  A search that finished having found nothing is cached exactly like one that
 *  found ninety pieces, and for the same fifteen minutes. So a single bad
 *  minute — stores slow, a fan-out that timed out, a deploy mid-flight —
 *  becomes a quarter of an hour of "nothing found" for that query, and the
 *  shopper cannot tell the difference between an empty shelf and a bad moment.
 *
 *  That is how the Sneaker strip vanished out of every "give me some outfits"
 *  answer: "men sneaker" returned zero once, and was then served from cache as
 *  zero. "men sneakers" — a different key — returned twelve the whole time.
 *
 *  Not zero, because a genuinely empty query ("hand knitted balaclava in
 *  vicuna") would then re-fan-out over ninety stores on every keystroke. A
 *  minute is long enough to protect against that and short enough that nobody
 *  meets the same bad minute twice. */
const EMPTY_TTL_MS = 60 * 1000

function cacheGet(key: string): CacheEntry | null {
  const e = lruCache.get(key)
  if (!e || Date.now() - e.timestamp > CACHE_TTL_MS) {
    lruCache.delete(key)
    return null
  }
  // Finished, and found nothing. `pending` still holding domains means the
  // fan-out is mid-flight and a concurrent request should share it, so only a
  // FULLY spent entry counts as a real answer of "none".
  if (e.products.length === 0 && e.pending.length === 0 && Date.now() - e.timestamp > EMPTY_TTL_MS) {
    lruCache.delete(key)
    return null
  }
  lruCache.delete(key)
  lruCache.set(key, e) // promote (most-recently-used)
  return e
}

function cacheSet(key: string, e: CacheEntry) {
  if (!lruCache.has(key) && lruCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = lruCache.keys().next().value
    if (oldest) lruCache.delete(oldest)
  }
  lruCache.set(key, e)
}

function makeCacheKey(
  query: string,
  cc: string | null,
  brandDomains: string[],
): string {
  return JSON.stringify({
    q: query.toLowerCase().trim(),
    cc,
    brands: [...brandDomains].sort(),
  })
}

// ─── Category → domain mapping ─────────────────────────────────────────────────

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  tops: [
    'shirt', 'shirts', 'tee', 'tees', 't-shirt', 't-shirts', 'top', 'tops', 'blouse', 'blouses',
    'polo', 'polos', 'henley', 'henleys', 'tank', 'tanks', 'crop', 'button-down', 'oxford', 'overshirt',
    'sweatshirt', 'sweatshirts', 'hoodie', 'hoodies', 'sweater', 'sweaters', 'cardigan', 'cardigans',
    'pullover', 'turtleneck', 'crewneck', 'knitwear', 'knit', 'flannel',
    'áo', 'シャツ', 'セーター',
  ],
  bottoms: [
    'pant', 'pants', 'trouser', 'trousers', 'jean', 'jeans', 'short', 'shorts', 'skirt', 'skirts',
    'legging', 'leggings', 'jogger', 'joggers', 'sweatpant', 'sweatpants', 'chino', 'chinos', 'cargo',
    'culottes', 'culotte', 'selvedge',
    'quần', 'パンツ', 'ジーンズ',
  ],
  dress: [
    'dress', 'dresses', 'gown', 'gowns', 'jumpsuit', 'jumpsuits', 'bodysuit', 'bodysuits',
    'romper', 'rompers', 'playsuit', 'co-ord', 'coord', 'sundress',
    'đầm', 'váy', 'ワンピース',
  ],
  outerwear: [
    'jacket', 'jackets', 'coat', 'coats', 'blazer', 'blazers', 'vest', 'vests', 'gilet', 'waistcoat',
    'fleece', 'parka', 'puffer', 'windbreaker', 'raincoat', 'overcoat', 'trench', 'bomber',
    'harrington', 'trucker',
    'khoác', 'ジャケット', 'コート',
  ],
  footwear: [
    'shoe', 'shoes', 'sneaker', 'sneakers', 'boot', 'boots', 'sandal', 'sandals', 'heel', 'heels',
    'loafer', 'loafers', 'slide', 'slides', 'flat', 'flats', 'oxford', 'oxfords', 'mule', 'mules',
    'clog', 'clogs', 'espadrille', 'espadrilles', 'derby', 'brogue', 'brogues',
    'chelsea', 'chukka', 'pump', 'pumps', 'trainer', 'trainers',
    'giày', 'dép', '靴', 'footwear',
  ],
  underwear: [
    'sock', 'socks', 'underwear', 'bra', 'bras', 'briefs', 'boxer', 'boxers', 'thong', 'thongs',
    'sleepwear', 'robe', 'robes', 'lingerie', 'bralette', 'swimwear', 'swimsuit', 'bikini',
    'swim', 'pajama', 'pyjama', 'loungewear',
  ],
  accessory: [
    'bag', 'bags', 'backpack', 'backpacks', 'tote', 'totes', 'pouch', 'clutch', 'clutches',
    'wallet', 'wallets', 'purse', 'purses', 'cardholder', 'crossbody', 'handbag',
    'weekender', 'duffle', 'messenger',
    'hat', 'hats', 'cap', 'caps', 'beanie', 'beanies', 'belt', 'belts', 'sunglasses', 'shades',
    'eyewear', 'scarf', 'scarves', 'watch', 'watches', 'jewelry', 'jewellery', 'necklace',
    'bracelet', 'bracelets', 'earring', 'earrings', 'ring', 'rings', 'pendant', 'chain', 'anklet',
    'túi', 'ví', 'mũ', 'kính', 'バッグ', '帽子',
  ],
}

function matchedCategories(query: string): Set<string> {
  const q = query.toLowerCase().replace(/[()\"',]/g, ' ')
  const words = q.split(/\s+/).filter(w => w.length >= 2 && w !== 'or' && w !== 'and')
  const cats = new Set<string>()
  for (const word of words) {
    for (const [cat, kws] of Object.entries(CATEGORY_KEYWORDS)) {
      if (kws.some(kw => {
        if (kw.length < 3) return word === kw
        return word === kw || (word.length >= 4 && (word.includes(kw) || kw.includes(word)))
      })) {
        cats.add(cat)
      }
    }
  }
  return cats
}

// The roster is US + India only now, so geo-boost reduces to a clean binary:
// shoppers in South Asia get an Indian-brand lift, everyone else (North
// America, Europe, and every other region) gets a US-brand lift — matching
// the explicit "show India Indian brands, show US and Europe US brands"
// requirement now that there are exactly two markets to choose between.
function preferredMarket(cc: string | null | undefined): 'US' | 'IN' | null {
  if (!cc) return null
  return GEO_REGIONS[cc] === 'SA' ? 'IN' : 'US'
}

// Human brand names for the first few domains about to be queried — used only
// to make the "searching N catalogs" status line concrete ("Rare Rabbit, Taka,
// Kardo…") rather than a bare number.
function sampleBrandNames(domains: string[], n: number): string[] {
  const out: string[] = []
  for (const d of domains) {
    const dom = d.toLowerCase().replace(/^www\./, '').trim()
    const name = BRAND_NAMES[dom] || UCP_REGISTRY.find(s => s.domain.toLowerCase() === dom)?.name
    if (name) out.push(name)
    if (out.length >= n) break
  }
  return out
}

/** Returns registry domains matching the query's categories, sorted by relevance to the query. */
function getCategoryDomains(query: string, cc?: string | null): string[] {
  const cats = matchedCategories(query)
  const qLower = query.toLowerCase()

  const candidates = cats.size === 0
    ? UCP_REGISTRY
    : UCP_REGISTRY.filter(s => s.categories.some(c => cats.has(c)))

  const pool = candidates.length > 0 ? candidates : UCP_REGISTRY

  // Aesthetic intelligence: when the query carries a style ("quiet luxury",
  // "gorpcore"…), favor brands whose vibe tags and price tier fit that style.
  const styles = matchStyles(query)
  const styleSignals = new Set<string>()
  const stylePriceTiers = new Set<string>()
  for (const s of styles) {
    for (const k of s.keywords) styleSignals.add(k.toLowerCase())
    for (const m of s.materials) styleSignals.add(m.toLowerCase())
    stylePriceTiers.add(s.priceSignal)
  }

  // Gender routing: "men's shirt" should hit menswear brands first.
  const wantsMen   = /\b(men|men's|mens|menswear|male|him|guys)\b/i.test(qLower)
  const wantsWomen = /\b(women|women's|womens|womenswear|female|her|ladies)\b/i.test(qLower)

  // Relevance score: vibe terms appearing in the query rank a brand higher,
  // plus style-vocabulary fit, gender fit, and a small boost for category breadth.
  const ranked = [...pool]
    .map(s => {
      let score = 0
      for (const vibe of s.vibe) {
        const v = vibe.toLowerCase()
        if (qLower.includes(v)) score += 10
        if (styleSignals.has(v)) score += 6
      }
      if (s.priceRange && stylePriceTiers.has(s.priceRange)) score += 4
      if (wantsMen !== wantsWomen && s.gender && s.gender.length > 0) {
        const hasMen = s.gender.includes('men') || s.gender.includes('unisex')
        const hasWomen = s.gender.includes('women') || s.gender.includes('unisex')
        if (wantsMen) score += hasMen ? 12 : -20
        if (wantsWomen) score += hasWomen ? 12 : -20
      }
      if (s.items && s.items.some(it => qLower.includes(it.toLowerCase()))) score += 8
      score += s.categories.length
      // Geo-aware fetch ordering: prioritise stores in the shopper's country so
      // local brands are in the pool before the geo-boost re-sorts the results.
      if (cc) {
        const dom = s.domain.toLowerCase().replace(/^www\./, '')
        const storeCc = getStoreCountry(dom)
        // Moderate boost only: local stores go EARLY in the fetch order but must
        // not wall it off. (+50 made round 1 all-local for Indian shoppers; the
        // pool became whichever local brand had the most matches, and the page
        // filled with one brand.) Local-first RANKING of results is enforced
        // downstream by the strict geo sort — the fetch pool must stay diverse.
        if (storeCc === cc) score += 18
        else if (storeCc === preferredMarket(cc)) score += 8
      }
      return { domain: s.domain.toLowerCase().trim(), score }
    })
    .sort((a, b) => b.score - a.score)
    .map(x => x.domain)

  // Push stores that have been hard-failing to the back — they're queried only
  // if the healthy ones don't fill the page, and rejoin automatically on recovery.
  return deprioritizeDead(ranked)
}

// ─── EN→JA translation for Japanese-catalog stores ─────────────────────────────

const EN_TO_JA: Record<string, string> = {
  shirt: 'シャツ', shirts: 'シャツ', tee: 'Tシャツ', 't-shirt': 'Tシャツ',
  pants: 'パンツ', trousers: 'パンツ', jeans: 'ジーンズ', denim: 'デニム',
  jacket: 'ジャケット', coat: 'コート', sweater: 'セーター', hoodie: 'フーディー',
  cardigan: 'カーディガン', vest: 'ベスト', blazer: 'ブレザー',
  dress: 'ワンピース', skirt: 'スカート', shorts: 'ショーツ',
  shoes: '靴', sneakers: 'スニーカー', boots: 'ブーツ', sandals: 'サンダル', loafers: 'ローファー',
  bag: 'バッグ', backpack: 'リュック', hat: '帽子', cap: 'キャップ', belt: 'ベルト',
  wallet: '財布', socks: '靴下', scarf: 'スカーフ',
  linen: 'リネン', cotton: 'コットン', wool: 'ウール', silk: 'シルク', leather: 'レザー',
  cashmere: 'カシミヤ', fleece: 'フリース', nylon: 'ナイロン',
}

function translateEnToJa(query: string): string {
  const words = query.toLowerCase().split(/\s+/)
  const out = words.map(w => EN_TO_JA[w]).filter(Boolean)
  return out.length > 0 ? out.join(' ') : ''
}

// ─── Utilities ─────────────────────────────────────────────────────────────────

function normalizeImageUrl(url?: string): string {
  if (!url) return ''
  let u = url.startsWith('//') ? `https:${url}` : url
  // Shopify serves images from cdn.shopify.com, *.shopifycdn.*, AND the
  // store's own domain under /cdn/shop/… — all honour the ?width= param.
  // Without it, cards download the multi-MB original and the grid appears to
  // load a couple of products at a time; with it, each card is ~20-40KB and
  // a whole page of images lands near-simultaneously.
  if (u.includes('cdn.shopify.com') || u.includes('shopifycdn') || u.includes('/cdn/shop/')) {
    try {
      const obj = new URL(u)
      obj.searchParams.set('width', '400')
      u = obj.toString()
    } catch {}
  }
  return u
}

function cleanDomainToken(d: string): string {
  return d.toLowerCase().replace(/^www\./, '').replace(/[\-_]/g, '').split('.')[0] ?? ''
}

function domainMatches(productDomain: string, registryDomain: string): boolean {
  const p = cleanDomainToken(productDomain)
  const r = cleanDomainToken(registryDomain)
  if (!p || !r || p.length < 3) return false
  return p === r || p.startsWith(r) || r.startsWith(p)
}

function getStoreDomain(storeUrl: string): string {
  try { return new URL(storeUrl).hostname.replace(/^www\./i, '').toLowerCase() } catch { return '' }
}

function convertPrice(price: number, from: string, to: string, rates: Record<string, number>): number {
  from = from.toUpperCase(); to = to.toUpperCase()
  if (from === to) return price
  const f = rates[from]; const t = rates[to]
  if (!f || !t) return price
  return (price / f) * t
}

function normalizeCurrency(c?: string | null): string {
  return String(c || 'USD').trim().toUpperCase() || 'USD'
}

// ─── Per-store MCP fetch ───────────────────────────────────────────────────────

function extractProducts(data: any): any[] {
  if (data?.result?.structuredContent?.products) return data.result.structuredContent.products
  const text = data?.result?.content?.[0]?.text
  if (typeof text === 'string') {
    try {
      const inner = JSON.parse(text)
      if (Array.isArray(inner?.products)) return inner.products
    } catch {}
  }
  if (data?.result?.products) return data.result.products
  return []
}

/** Query one brand's own Shopify catalog via its MCP endpoint. */
/** How much of a store's catalogue to ask for in one call.
 *
 *  UCP's ceiling is 250 and raising it looked like free depth. It is not, and
 *  the numbers are worth keeping so nobody raises it again on the same
 *  reasoning.
 *
 *  Per store, a 250-product reply is 1.5-2.5 MB and takes 3.0-3.4s; ninety of
 *  those is ~180 MB a search against a 5s per-store timeout several were
 *  already brushing, and a store that misses the timeout returns NOTHING. So
 *  250 trades "40 from every store" for "250 from some and zero from others".
 *
 *  120 measured worse end to end than 40 — "sneakers" went from 12 results in
 *  5.3s to 6 results in 33s, because forty-five parallel stores at 120 apiece
 *  is a different amount of data to move and parse. Even 60, which is well
 *  inside every per-store timeout, doubled the wall clock ("white shirt" 5.9s
 *  to 11.9s) and returned the same twelve pieces.
 *
 *  That last part is the whole answer: the page is capped at twelve either
 *  way, so a deeper pool can only change WHICH twelve, and nothing here can
 *  yet detect that it changed them for the better. Paying six seconds for an
 *  unmeasurable difference is a bad trade, and it is the wrong direction after
 *  a complaint about speed. Revisit it when there is an evaluation set that
 *  can see a quality gain — with a measurement, never with the spec's
 *  maximum. */
const STORE_PAGE_LIMIT = 40
const STORE_BROWSE_LIMIT = 60

/** How much of a store's answer this process will read.
 *
 *  Derived from the measurement in the comment above rather than guessed: a
 *  250-product reply is 1.5-2.5MB, so a product costs 6-10KB. The largest
 *  thing asked for here is STORE_BROWSE_LIMIT, sixty products, which puts the
 *  expected worst case around 600KB — a realistic 60-product browse fixture
 *  measures 497KB. 1.5MB is roughly two and a half times that, headroom for a
 *  store whose products are far heavier than anything measured, while still
 *  bounding what forty-five concurrent stores can put in this process at once
 *  to about 67MB rather than nothing at all.
 *
 *  Deliberately not safeFetch's 2MB default. That number is a general guess;
 *  this one is what this endpoint actually returns. And deliberately below the
 *  1.5-2.5MB a 250-product reply costs, because that is a size this code goes
 *  out of its way never to request. */
const STORE_MAX_BYTES = 1.5 * 1024 * 1024

type StoreFetchContext = {
  /** Passed to the store's own relevance engine — UCP documents `intent` as
   *  "background context describing the buyer's intent", and we were sending
   *  none of it. The shopper's actual sentence, not our stripped-down keyword
   *  query, is what that field is for. */
  intent?: string | null
  currency?: string | null
  language?: string | null
  /** Filtered at the store rather than thrown away here. Minor units. */
  priceMaxMinor?: number | null
}

async function fetchStore(
  domain: string,
  query: string,
  countryCode: string | null,
  ctx: StoreFetchContext = {},
): Promise<any[]> {
  const profile = UCP_REGISTRY.find(s => s.domain.toLowerCase().trim() === domain)
  const langs = profile?.languages || ['en']

  // Build query variants: English plus a Japanese rendering for JA-catalog stores.
  const queries = new Set<string>([query])
  if (langs.includes('ja')) {
    const ja = translateEnToJa(query)
    if (ja) queries.add(ja)
  }

  // ships_to is not part of Shopify's public MCP spec — omitting it prevents
  // the endpoint from returning empty when the filter format is unrecognised.
  const runOne = async (q: string): Promise<{ products: any[]; errored: boolean }> => {
    // Empty query = browse full catalog. Shopify MCP returns all available products
    // when no query is specified, so we omit the field rather than sending "".
    // Reach deeper into each brand's catalog: more matches per brand for search,
    // and a wider sample for browse/Explore. (Shopify's MCP caps the page here —
    // true full-catalog depth needs cursor pagination via products.json.)
    const catalogArgs: Record<string, any> = {
      pagination: { limit: q ? STORE_PAGE_LIMIT : STORE_BROWSE_LIMIT },
    }
    if (q) catalogArgs.query = q

    // `filters` accepts categories and price and nothing else — `available:
    // true` was not in the schema and was being ignored, so it bought nothing
    // and misdescribed what we were asking for.
    if (typeof ctx.priceMaxMinor === 'number' && ctx.priceMaxMinor > 0) {
      catalogArgs.filters = { price: { max: Math.round(ctx.priceMaxMinor) } }
    }

    // Buyer signals. The store localises its own prices and availability from
    // these, which is better than us quoting one currency and converting into
    // another afterwards.
    const context: Record<string, string> = {}
    if (countryCode) context.address_country = countryCode
    if (ctx.currency) context.currency = ctx.currency
    if (ctx.language) context.language = ctx.language
    if (ctx.intent && ctx.intent.trim()) context.intent = ctx.intent.trim().slice(0, 300)
    if (Object.keys(context).length) catalogArgs.context = context
    const payload = {
      jsonrpc: '2.0',
      method: 'tools/call',
      id: 1,
      params: {
        name: 'search_catalog',
        arguments: { catalog: catalogArgs },
      },
    }
    try {
      // safeFetch, not fetch. The destination is registry-closed — every
      // domain reaching here came from UCP_REGISTRY — so this was never a way
      // to make the server call an address a shopper named. What it was is a
      // store we already talk to being able to redirect us somewhere else, or
      // answer with a body res.json() would read in full, forty-five stores at
      // a time. Now every hop is revalidated and the read stops at the cap.
      //
      // Nothing about the request changes: same POST, same JSON-RPC body, same
      // Content-Type, same store timeout. And nothing about failure changes —
      // a blocked redirect, an oversized answer and a dead endpoint all throw,
      // and the catch below turns every one of them into the same
      // {products: [], errored: true} this function already returned.
      const res = await safeFetch(`https://${domain}/api/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(STORE_TIMEOUT_MS),
      }, { maxBytes: STORE_MAX_BYTES })
      if (!res.ok) return { products: [] as any[], errored: true }
      const data = await res.json()
      const products = extractProducts(data)
      // Written onto the store's RAW payload, before parseProduct turns any of
      // it into a product — so this is not a request writing on a canonical
      // object, it is the fan-out remembering which store answered so the
      // parser can attribute what it builds. The raw objects are discarded the
      // moment parseProduct has read them.
      for (const p of products) p._sourceDomain = domain
      return { products, errored: false }
    } catch (e) {
      // Same outcome as before; the difference is that a refusal by our own
      // boundary no longer looks identical to a store being down in the log.
      // Named error only — never the URL's query, the body, or a header.
      const why = e instanceof BlockedDestinationError ? 'blocked-destination'
        : e instanceof ResponseTooLargeError ? 'response-too-large'
        : null
      if (why) console.warn(`[Catalog] ${domain} refused by safeFetch: ${why}`)
      return { products: [] as any[], errored: true }
    }
  }

  const results = await Promise.all(Array.from(queries).map(runOne))
  const errored = results.every(r => r.errored)
  const products = results.flatMap(r => r.products)
  recordBrandOutcome(domain, { productCount: products.length, errored })
  return products
}

// ─── Product normalization ─────────────────────────────────────────────────────

// Read availability from a raw variant/product object. Shopify and various UCP
// implementations use different field names — try all known paths in order.
// Returns true (available) or false (sold out). When no availability signal is
// present at all we return null (unknown) so callers can decide the default.
function readAvailability(v: any): boolean | null {
  if (typeof v.availability?.available === 'boolean') return v.availability.available
  if (typeof v.available === 'boolean') return v.available
  if (typeof v.availableForSale === 'boolean') return v.availableForSale
  if (typeof v.available_for_sale === 'boolean') return v.available_for_sale
  if (typeof v.inventoryQuantity === 'number') return v.inventoryQuantity > 0
  if (typeof v.inventory_quantity === 'number') return v.inventory_quantity > 0
  return null
}

function parseProduct(raw: any, sourceDomain?: string): UcpProduct | null {
  try {
    const variant = raw.variants?.[0] ?? {}
    const currency = normalizeCurrency(variant.price?.currency ?? raw.price_range?.min?.currency)
    const isZero = ZERO_DECIMAL_CURRENCIES.has(currency)
    const rawAmount = variant.price?.amount ?? raw.price_range?.min?.amount ?? 0
    const price = isZero ? rawAmount : rawAmount / 100

    const domain = sourceDomain ?? raw._sourceDomain
    let vendor = variant.seller?.name ?? variant.seller?.domain
    if (!vendor && domain) {
      const token = cleanDomainToken(domain)
      vendor = token ? token.charAt(0).toUpperCase() + token.slice(1) : domain
    }
    vendor = vendor || 'Independent'

    // Build a usable product URL, defaulting to the source store's domain.
    let store_url = variant.url ?? raw.url ?? ''
    if (store_url && store_url.startsWith('/') && domain) {
      store_url = `https://${domain}${store_url}`
    } else if (!store_url && domain) {
      const idPart = String(raw.id ?? '').split('/').pop()
      store_url = `https://${domain}/products/${idPart}`
    } else if (store_url && !store_url.startsWith('http')) {
      store_url = `https://${store_url}`
    }

    /** Tags stripped out of a description's HTML, so a brand that sent only
     *  the rich form still gets read. */
    const fromHtml = (h: unknown): string | undefined => {
      if (typeof h !== 'string' || !h.trim()) return undefined
      const t = h
        // EVERY tag becomes a space, not just the block-level ones.
        //
        // This listed the closers it thought mattered and stripped the rest to
        // nothing, so a spec table — `Full Sleeve</td><td>SIZE</td>` — came out
        // as "SleeveSIZEModel height 188cm" on the product page. There is no
        // case where deleting a tag should weld two words together; whitespace
        // is collapsed on the next line anyway, so a space is always the safe
        // substitution and a missing one never is.
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
        .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
        .replace(/\s+/g, ' ')
        .trim()
      return t.length > 0 ? t : undefined
    }

    // UCP gives a description as `{ plain, html }` and this read `plain` only.
    // Plenty of stores send ONLY `html` — kartikresearch.com among them — so
    // for every product from those brands the description came out undefined,
    // and the product page said "this brand does not publish a fabric
    // composition" about a piece whose brand had written three paragraphs. The
    // words were in the payload the whole time, under the other key.
    const descCandidates = [
      raw.description?.plain,
      variant.description?.plain,
      fromHtml(raw.description?.html),
      fromHtml(variant.description?.html),
      raw.metadata?.tech_specs,
    ].filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    const description = descCandidates.length
      ? descCandidates.reduce((a, b) => (b.length > a.length ? b : a))
      : undefined

    const options = Array.isArray(raw.options)
      ? raw.options
          .map((o: any) => ({
            name: o.name,
            values: (o.values ?? []).map((v: any) => v.label ?? String(v)),
          }))
          .filter((o: any) => o.values.length > 0)
      : undefined

    // Keep each variant's RAW signal (true/false/null) alongside the optimistic
    // per-variant default — the raw value is what the product-level in_stock
    // decision below actually reasons over. Losing this distinction (defaulting
    // to true before aggregating) was the bug: one variant with no stock field
    // at all was enough to mark the WHOLE product "in stock" via .some(), even
    // when every other variant explicitly reported sold out.
    const variants = (raw.variants ?? []).map((v: any) => {
      const vc = normalizeCurrency(v.price?.currency ?? currency)
      const vz = ZERO_DECIMAL_CURRENCIES.has(vc)
      const rawAvail = readAvailability(v)
      return {
        id: v.id,
        title: v.title,
        price: (() => {
          const va = v.price?.amount ?? 0
          return vz ? va : va / 100
        })(),
        // Per-variant UI (e.g. disabling a sold-out size button) still defaults
        // optimistic on missing data — a single unknown variant is low-stakes.
        availability: rawAvail ?? true,
        _rawAvailability: rawAvail,
        options: v.options ?? [],
        media: (v.media ?? []).map((m: any) => ({
          url: normalizeImageUrl(m.url),
          alt: m.alt ?? m.altText ?? m.alt_text ?? '',
        })),
      }
    })

    const media = (raw.media ?? []).map((m: any) => ({
      type: m.type ?? 'image',
      url: normalizeImageUrl(m.url),
      alt: m.alt ?? m.altText ?? m.alt_text ?? '',
    }))

    const image_url = normalizeImageUrl(raw.media?.[0]?.url ?? variant.media?.[0]?.url ?? '')
    if (!image_url) return null

    // Product-level in_stock (drives both the search filter AND the detail
    // popup's green/red dot) — reasons over the RAW signals, not the
    // per-variant optimistic default:
    //   - any variant explicitly available            -> in stock
    //   - no variant explicitly available, but at
    //     least one explicitly SOLD OUT (a real signal) -> out of stock
    //   - literally no variant reports availability     -> trust the store's
    //     own available:true filter on the request (best info we have)
    const anyExplicitlyAvailable = variants.some((v: { _rawAvailability: boolean | null }) => v._rawAvailability === true)
    const anyKnownSignal = variants.some((v: { _rawAvailability: boolean | null }) => v._rawAvailability !== null)
    const inStock = variants.length > 0
      ? (anyExplicitlyAvailable || !anyKnownSignal)
      : (readAvailability(raw) ?? readAvailability(variant) ?? true)

    // Strip the internal-only _rawAvailability before it leaves this module.
    const publicVariants = variants.map(({ _rawAvailability, ...v }: any) => v)

    /** This function is the ONLY boundary between what a store sent and what
     *  the rest of the app treats as a product, which makes it the only honest
     *  place to record where the thing came from. Everything below this line
     *  is the merchant speaking, or one of the named normalisations above
     *  speaking on their behalf — nothing a model concluded, and nothing one
     *  request decided. */
    const source: ProductProvenance = {
      merchant: merchantKey(store_url) || merchantKey(domain),
      sourceId: String(raw.id),
      via: 'ucp-mcp',
      fetchedAt: Date.now(),
      schema: CANONICAL_SCHEMA_VERSION,
    }

    return {
      key: productKey({ source }),
      source,
      id: raw.id,
      title: raw.title ?? 'Untitled',
      vendor,
      price,
      currency,
      store_url,
      image_url,
      in_stock: inStock,
      tags: raw.tags ?? [],
      // Shopify's own taxonomy, kept rather than dropped. It is what tells us
      // a product with no garment word in it is still a sneaker.
      categories: Array.isArray(raw.categories)
        ? raw.categories.map((c: any) => (typeof c === 'string' ? c : c?.value))
            .filter((v: unknown): v is string => typeof v === 'string')
        : undefined,
      description,
      description_html:
        typeof raw.description?.html === 'string' && raw.description.html.trim()
          ? raw.description.html
          : undefined,
      options: options?.length ? options : undefined,
      variants: publicVariants,
      media,
    }
  } catch {
    return null
  }
}

// ─── Filter + sort ─────────────────────────────────────────────────────────────

function applyFiltersAndSort(
  products: UcpProduct[],
  params: {
    budgetMax?: number | null
    budgetCurrency: string
    excludeIds: string[]
    sort: ProductSort
    limit: number
    rates: Record<string, number>
    concepts?: string[][]
    /** Max products per store BEFORE the page slice. 0/undefined = no cap.
     *  Capping pre-slice is what keeps the page full AND diverse: post-slice
     *  capping let one keyword-rich brand eat all 30 slots, then shrink the
     *  page to a handful of its own products. */
    perVendorCap?: number
    /** Who is shopping, from their profile — not from the words they typed.
     *
     *  Gender was only ever a filter when the QUERY named one, so a man whose
     *  profile says men still got womenswear for "a linen shirt", which names
     *  no gender at all. Most requests name none. This is the default the
     *  request falls back to, and an explicit gender in the query still wins:
     *  a man asking for a dress for his wife must still get dresses. */
    preferGender?: 'men' | 'women' | null
  },
): UcpProduct[] {
  const excluded = new Set(params.excludeIds)
  let out = products.filter(p => {
    if (excluded.has(p.id)) return false
    if (!p.in_stock) return false
    if (params.budgetMax && params.budgetMax > 0) {
      if (convertPrice(p.price, p.currency, params.budgetCurrency, params.rates) > params.budgetMax) {
        return false
      }
    }
    return true
  })

  // Gender is a hard filter, not a ranking signal — reject clear opposite-
  // gender matches. The query wins when it names one; otherwise the shopper's
  // profile decides. This runs whether or not there are concepts, because a
  // query with no concepts is exactly the case that used to leak.
  //
  // Never lets it empty the page: in the pathological case where everything
  // found reads as the opposite gender, the unfiltered set stands rather than
  // showing nothing.
  const requestedGender = requestedGenderFromConcepts(params.concepts ?? []) ?? params.preferGender ?? null
  if (requestedGender) {
    const opposite = requestedGender === 'men' ? 'women' : 'men'
    const genderSafe = out.filter(p => productGenderSignal(p) !== opposite)
    if (genderSafe.length > 0) out = genderSafe

    // Ambiguous pieces go last. Some stores tag one listing for both
    // departments — a co-ord set tagged MEN and WOMEN together — and reading
    // that as "cannot tell" let it survive and rank on its words alone, which
    // is how a photograph of a woman appeared in a men's shorts strip. It is
    // not dropped, because occasionally the item really is unisex and the page
    // has to stay full; it simply loses to every piece that says plainly who
    // it is for. With twelve places on a page, losing is usually enough.
    const speaksTo = (p: UcpProduct) => {
      const hay = genderHaystack(p)
      const w = WOMEN_GENDER_RE.test(hay), m = MEN_GENDER_RE.test(hay)
      // Named for the asked-for gender and not the other: unambiguous.
      if (requestedGender === 'men') return m && !w ? 0 : (m && w ? 1 : 0.5)
      return w && !m ? 0 : (m && w ? 1 : 0.5)
    }
    out = out.slice().sort((a, b) => speaksTo(a) - speaksTo(b))
  }

  // Colour, on the same footing as gender: a named colour is a requirement.
  // A piece that legibly claims a different family is out; a piece that claims
  // none survives. Never empties the page.
  const requestedColors = requestedColorsFromConcepts(params.concepts ?? [])
  if (requestedColors.length > 0) {
    const rightColor = out.filter(p => {
      const mine = productColorFamilies(p)
      if (mine.size === 0) return true                       // the store said nothing
      for (const want of requestedColors) {
        for (const has of Array.from(mine)) if (colorFamiliesAgree(want, has)) return true
      }
      return false
    })
    if (rightColor.length > 0) out = rightColor
  }

  // Concept layer: drop off-garment items (when safe) and rank by concept fit.
  if (params.concepts && params.concepts.length > 0) {
    out = applyConceptRelevance(out, params.concepts, 4)
  }

  if (params.sort === 'price_asc') out = [...out].sort((a, b) => a.price - b.price)
  else if (params.sort === 'price_desc') out = [...out].sort((a, b) => b.price - a.price)
  // 'relevance' / 'trust_desc': preserve concept + store catalog order

  // Vendor diversity BEFORE the slice: the page fills its full `limit` with at
  // most N per store, other brands backfilling — instead of one brand consuming
  // the slice and the page collapsing to a few items after a post-hoc cap.
  if (params.perVendorCap && params.perVendorCap > 0) {
    const perDomain = new Map<string, number>()
    out = out.filter(p => {
      const dom = getStoreDomain(p.store_url)
      const seen = perDomain.get(dom) ?? 0
      if (seen >= params.perVendorCap!) return false
      perDomain.set(dom, seen + 1)
      return true
    })
  }

  // The same piece, listed twice.
  //
  // "Queens Crest Loafer" appeared at positions 8 and 9 — two Shopify products,
  // queens-crest-loafer-4 and -5, same brand, same price, same name. Almost
  // certainly two colourways the store chose to list separately. Ids say they
  // are different; a shopper reading two identical rows says the app is
  // repeating itself, and is right to.
  //
  // Keyed on brand AND name, so two brands may both sell a "Chelsea Boot" and
  // both appear. The colourway lost here is a real cost, and a smaller one than
  // a page that looks broken.
  {
    const seenPiece = new Set<string>()
    out = out.filter(p => {
      const k = `${(p.vendor || '').toLowerCase().trim()}|${(p.title || '').toLowerCase().trim()}`
      if (k === '|') return true
      if (seenPiece.has(k)) return false
      seenPiece.add(k)
      return true
    })
  }

  // One currency for the eye. Done last so it costs nothing on the pieces that
  // were filtered out along the way.
  //
  // ON A COPY, AND THIS IS THE WHOLE POINT. `products` here is the pooled
  // array owned by the module LRU above, whose key is query + country + brands
  // and NOT currency — so every shopper asking the same question in a different
  // currency reaches the same objects. Writing the display fields onto them
  // meant a request handed its page to the shopper and then, while it waited
  // on the judge and the palette read, had that page's currency rewritten
  // underneath it by the next person to ask the same question. Measured, not
  // theorised: two overlapping searches, one in dollars and one in rupees, and
  // the dollar shopper is handed ₹394,250. See scripts/canonical-product.js.
  //
  // A shallow copy is the right depth. It severs exactly what one request
  // writes — the two display fields — and shares the nested arrays, which
  // nothing downstream mutates; the same harness freezes `variants`, `media`
  // and `options` on a pooled product and runs the full ranking path over it
  // to keep that true. Deep-cloning fifty-two products per page to defend
  // against a write nobody makes would be paying for the wrong thing.
  const shown: UcpProduct[] = out.slice(0, params.limit).map(p => ({ ...p }))
  const target = normalizeCurrency(params.budgetCurrency)
  for (const p of shown) {
    p.display_currency = target
    p.display_price = Math.round(convertPrice(p.price, p.currency, target, params.rates))
  }
  return shown
}

// ─── Main search ───────────────────────────────────────────────────────────────

export class GlobalCatalogService {
  static async search(
    query: string,
    budgetMax?: number | null,
    excludeIds: string[] = [],
    countryCode?: string | null,
    _isClothing?: boolean,
    mandatoryConcepts: string[][] = [],
    sort: ProductSort = 'relevance',
    budgetCurrency: string | null = 'USD',
    options: {
      loadMore?: boolean
      fastFirstPage?: boolean
      refreshReserve?: boolean
      debug?: CatalogSearchDebug
      onProgress?: CatalogProgress
      /** Where this search's judge outcome goes. See JudgeReport above. */
      onJudge?: JudgeReport
    } = {},
    brandDomains: string[] = [],
    _tasteProfile?: string,
    /** The user's original message — used for relevance reranking so aesthetic /
     *  style signals survive even when the fetch query is stripped down. The
     *  catalog fetch still uses the clean `query` so recall is never reduced. */
    rerankQuery?: string,
    /** The shopper's stated size for whichever garment category this query is
     *  (tops/bottoms/shoes) — a soft reorder signal only, see applySizePreference. */
    preferredSize?: string | null,
    /** A photograph the shopper is holding up: "find me this".
     *
     *  The vision model already turns that picture into words and those words
     *  drive the search. Words carry the silhouette and the material and they
     *  do not carry the LOOK — "mid-wash denim jacket" describes a hundred
     *  jackets, and the shopper meant one of them. So the picture also ranks
     *  what comes back, by measuring every candidate's own photograph against
     *  it. Words find the right shelf; the picture picks off the shelf. */
    matchImage?: string | null,
  ): Promise<UcpProduct[]> {
    // The shopper's own gender — read from the FIRST segment of the taste line,
    // which is where the route puts it, and nowhere else.
    //
    // This scanned the whole line, and the line also carries recent searches and
    // the brands in the bag. A man who had once searched "women white shirt" was
    // therefore filtered to womenswear on every subsequent request, from his own
    // history. A stated fact and a remembered phrase are not the same thing and
    // must not be read from the same string.
    // Only the leading segment, and only when it looks like a gender statement
    // rather than a brand list that happens to contain the word.
    const firstSegment = String(_tasteProfile || '').split('·')[0].trim()
    const genderSegment = firstSegment.length <= 60 && !/^(bag|recently|usual|shopping)\b/i.test(firstSegment)
      ? firstSegment : ''
    const preferGender: 'men' | 'women' | null =
      /\b(women|womens|women's|female|ladies)\b/i.test(genderSegment) ? 'women'
      : /\b(men|mens|men's|male)\b/i.test(genderSegment) ? 'men'
      : null

    const rawQuery = query.trim()
    // For brand-only searches (brandDomains pre-supplied), allow empty rawQuery —
    // we'll browse the brand's catalog with a broad/empty query instead of returning early.
    if (!rawQuery && brandDomains.length === 0) return []

    const isLoadMore = Boolean(options.loadMore)
    const limit = isLoadMore ? LOAD_MORE_LIMIT : INITIAL_LIMIT
    const cc = countryCode?.trim().toUpperCase() || null
    const bcur = normalizeCurrency(budgetCurrency)
    /** What every store call tells the shop about the buyer. `rerankQuery` is
     *  the shopper's own sentence — the fetch query is a stripped keyword
     *  string, and intent is the field that wants the sentence. The budget is
     *  in minor units because that is what UCP asks for. */
    const storeCtx: StoreFetchContext = {
      intent: (rerankQuery || '').trim() || null,
      currency: bcur || null,
      language: 'en',
      priceMaxMinor: typeof budgetMax === 'number' && budgetMax > 0
        ? Math.round(budgetMax * 100) : null,
    }
    const rates = await getExchangeRates().catch(() => ({} as Record<string, number>))

    // Which brands? Explicit brandDomains → else detect a named brand → else category subset.
    const detectedBrands = brandDomains.length > 0 ? brandDomains : detectBrandsInQuery(rawQuery)
    const validBrands = detectedBrands.filter(d =>
      UCP_REGISTRY.some(s => s.domain.toLowerCase() === d.toLowerCase()),
    )
    const isBrandSearch = validBrands.length > 0

    // Strip the brand name from the query sent to the store ("shirts from Banana Club" → "shirts").
    // For brand-only searches where the whole query IS the brand name, storeQuery becomes empty —
    // that's intentional: an empty Shopify query returns all available products in the store.
    let storeQuery = rawQuery
    if (isBrandSearch) {
      for (const d of detectedBrands) {
        const name = BRAND_NAMES[d] || (UCP_REGISTRY.find(s => s.domain === d)?.name)
        if (name && name.length >= 3) {
          const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          storeQuery = storeQuery
            .replace(new RegExp(`\\b(?:from|at|by|in)\\s+${esc}\\b`, 'gi'), ' ')
            .replace(new RegExp(`\\b${esc}\\b`, 'gi'), ' ')
        }
      }
      // Don't fall back to rawQuery (which has the brand name) — empty storeQuery
      // intentionally browses the brand's full available catalog.
      storeQuery = storeQuery.replace(/\s+/g, ' ').trim()
    }

    const cacheKey = makeCacheKey(storeQuery, cc, validBrands)

    // Reuse the fetched pool across pages; rebuild it on a cold cache.
    let entry = options.refreshReserve ? null : cacheGet(cacheKey)
    let seededFromPersistent = false
    if (!entry) {
      const orderedDomains = isBrandSearch
        ? validBrands.map(d => d.toLowerCase().trim())
        : getCategoryDomains(storeQuery, cc)
      entry = { timestamp: Date.now(), products: [], pending: [...orderedDomains], queried: new Set() }
      cacheSet(cacheKey, entry)

      // Cold in-memory cache — try the persistent (cross-cold-start) cache. The
      // pool is seeded but `pending` is kept, so the first page serves instantly
      // while load-more can still fetch fresh stores. 15-min TTL enforced in Convex.
      if (!isLoadMore) {
        const persisted = await readPersistentCache(cacheKey)
        if (persisted && persisted.products.length > 0) {
          entry.products = persisted.products
          // If data is fresh (< 5min), skip re-fetch; otherwise re-fetch but still serve stale immediately
          seededFromPersistent = persisted.age < 5 * 60 * 1000
        }
      }
    }

    if (options.debug) options.debug.catalogFetched = true

    // Diversity-aware page cap: brand searches show one brand's full catalog;
    // everything else caps at 2 per store so no single brand floods the page.
    const perVendorCap = isBrandSearch ? 0 : 2

    const enough = () =>
      applyFiltersAndSort(entry!.products, {
        budgetMax, budgetCurrency: bcur, excludeIds, sort, limit, rates,
        concepts: mandatoryConcepts, perVendorCap, preferGender,
      }).length >= limit

    const ingest = (batchRaw: any[][]) => {
      const seen = new Set(entry!.products.map(p => p.id))
      for (const list of batchRaw) {
        for (const raw of list) {
          if (!raw?.id || seen.has(raw.id)) continue
          const p = parseProduct(raw, raw._sourceDomain)
          if (!p) continue
          if (isNonFashion(p)) continue
          // Trust the source store, but validate when a URL points elsewhere.
          const dom = getStoreDomain(p.store_url)
          if (dom && !UCP_REGISTRY.some(s => domainMatches(dom, s.domain))) continue
          seen.add(raw.id)
          entry!.products.push(p)
        }
      }
    }

    // Fetch in batches until we have enough to serve this page or run out of stores.
    // The parallel store fetch is the slowest phase of a search, so announce it
    // (with a real brand count + sample names) right before it runs — the status
    // line then stays on screen for exactly as long as the fetch actually takes.
    if (options.onProgress && !enough() && entry.pending.length > 0) {
      const aboutToQuery = Math.min(entry.pending.length, BATCH_SIZE * MAX_ROUNDS_PER_CALL)
      options.onProgress({ kind: 'fetch', brandCount: aboutToQuery, sampleBrands: sampleBrandNames(entry.pending, 3) })
    }
    let rounds = 0
    while (!enough() && entry.pending.length > 0 && rounds < MAX_ROUNDS_PER_CALL) {
      rounds++
      const batch = entry.pending.splice(0, BATCH_SIZE)
      for (const d of batch) entry.queried.add(d)

      // The round used to be `Promise.all`, which means it finished when its
      // SLOWEST store did. Forty stores answering in 800ms and five hanging to
      // the 5s timeout cost the shopper five seconds — for the five, which by
      // definition contributed nothing. Every search paid the worst store in
      // the batch, twice.
      //
      // So each store ingests the moment it lands, and the round stops at a
      // soft deadline with whatever has arrived. The stragglers are NOT
      // cancelled: they keep running and keep ingesting into this same pool,
      // which is cached — so their pieces are simply there for the next page
      // or the next search rather than being thrown away. Nothing fetched is
      // ever wasted; it just stops being something anyone waits for.
      const inflight = batch.map(d =>
        fetchStore(d, storeQuery, cc, storeCtx)
          .then(list => { ingest([list]); return true })
          .catch(() => false),
      )
      // Keep late arrivals alive past the response on serverless, so the pool
      // they are filling is actually there next time.
      runAfterResponse(() => Promise.all(inflight).then(() => undefined))

      await Promise.race([
        Promise.all(inflight),
        new Promise<void>(r => setTimeout(r, STORE_SOFT_MS)),
      ])
    }

    // Second-chance recall: a literal query can miss on Shopify's keyword search
    // two ways — a specific multi-word phrase ("oxford camp collar shirt") matches
    // nothing, or an aesthetic term ("gorpcore") has no literal catalog presence.
    // If results are thin, retry the queried stores with broader signals, UNIONing
    // anything new into the pool (never replacing the clean primary results).
    // Runs at most once per cached query — worst case it adds nothing.
    if (!isLoadMore && !entry.broadened) {
      const current = applyFiltersAndSort(entry.products, {
        budgetMax, budgetCurrency: bcur, excludeIds, sort, limit, rates,
        concepts: mandatoryConcepts, perVendorCap, preferGender,
      })
      // An occasion query is thin at a much higher count than a garment query,
      // because everything it did retrieve came from three words that name no
      // garment. Five was the right floor for "navy linen shirt" and far too
      // low for "what do I wear to an interview", where a pool of twelve
      // near-misses looks healthy and answers nothing.
      const occasionLed = retrievalQueries((rerankQuery && rerankQuery.trim()) || rawQuery).length > 0
      if (current.length < (occasionLed ? 14 : 5)) {
        entry.broadened = true
        const recallQueries: string[] = []

        // (0) The occasion's own nouns. This runs first because it is the only
        // source here that can add a garment the shopper never named — the
        // others rewrite what was already asked for.
        for (const q of retrievalQueries((rerankQuery && rerankQuery.trim()) || rawQuery)) {
          if (!recallQueries.includes(q)) recallQueries.push(q)
        }

        // (a) Garment broadening — drop modifiers, keep the bare item type.
        if (storeQuery.includes(' ')) {
          const garment = mandatoryConcepts[0]?.[0] || storeQuery.split(' ').pop() || ''
          if (garment && garment.length >= 3 && garment.toLowerCase() !== storeQuery.toLowerCase()) {
            recallQueries.push(garment)
          }
        }

        // (b) Style-vocabulary recall — when the request references an aesthetic,
        // query its concrete material/keyword tokens (e.g. gorpcore → gore-tex,
        // nylon, fleece) to surface pieces the literal style term never matches.
        const styleQuery = (rerankQuery && rerankQuery.trim()) || rawQuery
        for (const sig of styleRecallSignals(styleQuery)) {
          if (!recallQueries.includes(sig)) recallQueries.push(sig)
        }

        const queries = recallQueries.slice(0, 3)   // bound fan-out cost
        if (queries.length > 0) {
          // A genuine second fetch pass — the first query came back thin, so
          // we're widening with broader signals. Real, conditional work worth
          // its own status line.
          options.onProgress?.({ kind: 'broaden', queries })
          // Keep total fetches bounded: full store breadth for a single recall
          // query, tighter when style signals multiply the fan-out.
          const domainCap = queries.length <= 1 ? 20 : 16
          const retryDomains = Array.from(entry.queried).slice(0, domainCap)
          const retryRaw = await Promise.all(
            // The broadening pass deliberately drops the price filter: it runs
            // because the pool was thin, and narrowing it again is the opposite
            // of recall.
            retryDomains.flatMap(d => queries.map(q => fetchStore(d, q, cc, { ...storeCtx, priceMaxMinor: null }))),
          )
          ingest(retryRaw)
          console.log(`[Catalog] recall "${storeQuery}" → [${queries.join(', ')}] (+${entry.products.length} pool)`)
        }
      }
    }
    cacheSet(cacheKey, entry)

    // Persist a fresh pool so the next cold start serves it instantly. Skip when
    // we just seeded from the persistent cache (already stored). Fire-and-forget
    // (NOT awaited) — the write has no time-box, so awaiting it would stall the
    // reply before rerank if Convex is slow/degraded; the reply never depends on
    // this cache landing.
    if (!isLoadMore && !seededFromPersistent && entry.queried.size > 0 && entry.products.length > 0) {
      void writePersistentCache(cacheKey, entry.products).catch(() => {})
    }

    console.log(
      `[Catalog] "${storeQuery.slice(0, 50)}" ${isBrandSearch ? '(brand)' : '(category)'} → ` +
      `${entry.products.length} products, ${entry.queried.size} stores queried, ${entry.pending.length} pending` +
      `${seededFromPersistent ? ' [warm:persistent]' : ''}`,
    )

    let result = applyFiltersAndSort(entry.products, {
      budgetMax, budgetCurrency: bcur, excludeIds, sort, limit, rates,
      concepts: mandatoryConcepts, perVendorCap, preferGender,
    })

    // Optional LLM rerank for nuanced relevance queries (first page only).
    if (sort === 'relevance' && result.length >= 4 && !isLoadMore) {
      try {
        // A real LLM call weighing each candidate against the request — the
        // second genuinely slow phase, so it gets its own status line and
        // stays up while the judge is actually thinking.
        options.onProgress?.({ kind: 'judge', candidates: result.length })
        const judgeQuery = (rerankQuery && rerankQuery.trim()) ? rerankQuery.trim() : rawQuery
        result = await rerankByRelevance(judgeQuery, result, _tasteProfile, (o, detail) => {
          options.onJudge?.(o, detail)
          if (o !== 'judged' && o !== 'cached') {
            console.warn(`[Catalog] the judge did NOT rank "${judgeQuery}" (${o}) — this page is keyword order`)
          }
        })
      } catch (err) {
        console.warn('[Catalog] rerank skipped:', err instanceof Error ? err.message : String(err))
      }
    }

    // ── The house eye, as a sort rather than as advice ──────────────────
    // Measured across a 1,218-product sample of the roster, only 23% of the
    // catalogue carries a print or a graphic. The pages coming back were
    // almost entirely prints. So the supply is not the problem and never was:
    // something was actively choosing the loud quarter over the quiet three
    // quarters, and every rule telling it not to lived in a prompt that the
    // judge reads — and the judge is the layer that silently does not run.
    //
    // This needs no model. Sixteen of sixteen reference looks use texture
    // rather than print and not one carries a slogan, a logo or a graphic, so
    // a piece that leads with one is the weaker answer to a request that did
    // not ask for it. Demoted, never dropped: somebody who wants a printed
    // shirt should still find one, which is why the whole thing switches off
    // the moment they say so.
    if (sort === 'relevance' && !isBrandSearch) {
      const asked = /\b(print(ed|s)?|graphic|slogan|logo|typograph\w*|varsity|floral|paisley|tie.?dye|camo|embroider\w*|patterned)\b/i.test(rawQuery)
      if (!asked) {
        const LOUD = /\b(print(ed)?|graphic|slogan|typographic|varsity|floral|paisley|abstract|tie.?dye|camo|cartoon|anime|funky|quirky|meme)\b/i
        const quiet = (p: UcpProduct) =>
          LOUD.test(`${p.title} ${(p.tags || []).join(' ')}`) ? 1 : 0
        // Stable, so a genuinely better match still outranks a quieter worse
        // one — this only separates pieces the ranker already thought were
        // equivalent.
        result = result.slice().sort((a, b) => quiet(a) - quiet(b))

        // ── And then the photograph, which is the only honest witness ──────
        //
        // The rule above reads the TITLE, and a title is written by whoever
        // uploaded it. "Ronald shirt" is a loud yellow plaid. "Black Cotton
        // Panelled Shirt" is a black-grey-teal colourblock. "KUNAL" could be
        // anything. None of those words trip a print filter, so every one of
        // them led a page of shirts — which is exactly what a shopper keeps
        // seeing and calling lame.
        //
        // Colour extraction was already built and was only being used for
        // outfit coherence and the styling panel, never for the page anyone
        // actually looks at. It is here now: the leading candidates have their
        // photographs read, and a piece carrying four competing colours loses
        // to one carrying a single flat colour.
        //
        // Bounded on purpose. Only the head of the list is read — the tail is
        // never shown anyway — every read is cached per photograph for the
        // life of the process, and the whole pass is time-boxed so a slow
        // image host costs the ordering, never the page.
        // THE WHOLE POOL, not the head of it. This read the top eighteen on
        // the reasoning that the page shows twelve, so a few spare was enough
        // to promote something. It was not, and the measurement says why:
        // across the fifty-two candidates for "men shirt", twenty-four are
        // quiet — and SIXTEEN of those sit below eighteen. "Men's Cotton Solid
        // Slim Fit", "Relaxed Shirt", "Coreform Black Shirt", none of them
        // ever looked at. Reordering the noisy head could never surface them,
        // which is why the page kept coming back the same however the weights
        // were tuned. It was a retrieval problem wearing a ranking problem's
        // clothes.
        //
        // The whole pool costs 1,294ms cold for fifty-two photographs and
        // nothing at all warm — I had assumed far worse and was measuring the
        // store fan-out alongside it.
        const HEAD = result.length
        const head = result.slice(0, HEAD)
        if (head.length > 3) {
          try {
            const looks = await Promise.race([
              palettesFor(head.map(p => p.image_url || ''), 12),
              // Half what it was. This is a nicety on top of an order that is
              // already correct — it must not be something a shopper waits on.
              // Measured at 1.3s for the full pool cold, so this clears it
              // with room and still refuses to be something anyone waits on.
              new Promise<null>(r => setTimeout(() => r(null), 2600)),
            ])
            if (looks) {
              // Relevance keeps most of the weight — this reorders pieces the
              // ranker already thought were close, it does not overturn it.
              const scored = head.map((p, i) => {
                const look = looks[i]
                const calm = !look ? 0.6                       // unread: neither rewarded nor punished
                  : look.plain ? 1
                  : Math.max(0, 1 - (look.variety - 1) * 0.28)
                // Neutrals and a single accent are what sixteen of sixteen
                // reference looks are built from; three families competing on
                // one garment is the opposite of that.
                const accents = look ? look.families.filter(f => f !== 'neutral').length : 1
                const palette = accents <= 1 ? 1 : accents === 2 ? 0.7 : 0.4
                const rank = 1 - i / HEAD
                // Weighted so the photograph can actually move a piece. At
                // 0.55 on rank the two terms cancelled and the page came back
                // in the order it went in — a busy shirt at position one still
                // beat a plain one at position ten by a hair. Relevance is
                // still the largest single term, and the garment filters above
                // are hard, so nothing off-category can climb: this only
                // reorders pieces that all genuinely answer the ask.
                return { p, s: rank * 0.40 + calm * 0.42 + palette * 0.18 }
              }).sort((a, b) => b.s - a.s)
              result = [...scored.map(x => x.p), ...result.slice(HEAD)]
            }
          } catch { /* the word-level order above still stands */ }
        }
      }
    }

    // Geo + quality boost for generic (non-brand) relevance searches. Within the
    // relevance order we nudge results up by a composite score: location dominates
    // (same-country, then same-region), and brand quality (icon > luxury > premium)
    // gives a gentle lift on top. The sort is stable, so a highly relevant product
    // still beats a weakly relevant one of the same composite tier. Brand searches
    // are skipped (the user already chose the brand explicitly).
    if (!isBrandSearch && sort === 'relevance') {
      const market = preferredMarket(cc)
      const domainOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' } }
      const composite = (url: string) => {
        const dom = domainOf(url)
        const ctry = getStoreCountry(dom)
        const geo = cc ? (ctry === cc ? 2 : ctry === market ? 1 : 0) : 0
        // Geo STRICTLY dominates: a same-country brand always outranks any
        // foreign one regardless of brand quality. Quality only breaks ties
        // within the same geo tier. (×100 ≫ any brandQualityScore range.)
        return geo * 100 + brandQualityScore(dom)
      }
      result = result.slice().sort((a, b) => composite(b.store_url) - composite(a.store_url))
    }

    // (Vendor diversity is applied INSIDE applyFiltersAndSort, before the page
    // slice — so the page is both full and diverse. No post-hoc cap needed.)

    // Size preference — soft reorder only, applied last so it nudges within
    // whatever relevance/geo order already exists rather than overriding it.
    result = applySizePreference(result, preferredSize)

    // The photograph the shopper held up, against the photograph of every
    // piece we found. This is the difference between "we searched for the
    // words a model used to describe your picture" and "we looked."
    //
    // Weighted hard on purpose. Everywhere else in this file a visual signal
    // nudges an order that words already decided, because the shopper asked in
    // words. Here they asked with a picture, and the words are only our
    // transcription of it — so likeness leads and the existing order breaks
    // ties beneath it. Boxed and failure-silent like every other read: no
    // answer inside the box leaves the order exactly as it was.
    if (matchImage && result.length > 1) {
      try {
        const HEAD = Math.min(result.length, 24)
        const head = result.slice(0, HEAD)
        const [want, mine] = await Promise.all([
          paletteCached(matchImage),
          palettesFor(head.map(p => p.image_url || ''), 12),
        ])
        if (want) {
          const scored = head.map((p, i) => ({
            p, i, s: looksLike(want, mine[i]),
          })).sort((a, b) => (b.s - a.s) || (a.i - b.i))
          result = [...scored.map(x => x.p), ...result.slice(HEAD)]
        }

        // …and then LOOK, rather than only measuring.
        //
        // The colour comparison above puts pieces resembling the photograph at
        // the top; it cannot tell one cream shirt from another cream shirt,
        // because a colour histogram is all it is. A shopper who screenshotted
        // a piece from this app and asked for that piece was handed a different
        // shirt of roughly the right colour — the words were too coarse, and so
        // was the palette.
        //
        // So the photograph and the best few candidates go to the vision model
        // TOGETHER and it is asked which is the same garment. Not "describe
        // this and search the description" — a direct comparison, which is the
        // question actually being asked. When it finds the piece, that piece
        // leads; when it does not, the order above stands and the only cost is
        // one model call.
        const look = await findSameGarment(matchImage, result.slice(0, 6).map(p => p.image_url || ''))
        // Recorded for the caller, whatever it says. A confident NO is as much
        // an answer to "find me this exact one" as a yes, and the route has no
        // other way to know one was even asked for.
        lastSameGarment = {
          forImage: matchImage,
          sameIndex: look.sameIndex,
          confidence: look.confidence,
          why: look.why ?? '',
        }
        if (look.sameIndex !== null && look.sameIndex > 0) {
          const found = result[look.sameIndex]
          result = [found, ...result.filter((_, i) => i !== look.sameIndex)]
          console.log(`[Catalog] the photograph matched "${found.title}" (${look.confidence}%)`)
        }
      } catch { /* the order above still stands */ }
    }

    // Who is actually in the photograph.
    //
    // The gender filter above is a text filter and it is clean — a men's
    // search leaks nothing that SAYS women anywhere. What survives it is the
    // piece that says nothing at all: no department, no gendered tag, no
    // pronoun, and a photograph of a woman. "Bunai Cotton Grace Coord Set",
    // "Whispers of Flowers Shirt". There is no text fix for a fact nobody
    // wrote down, and the photograph has been sitting there the whole time.
    //
    // Only on the page about to be shown, never on the pool of fifty-two —
    // this is a model call, unlike the palette read beside it, and running it
    // wide is how a search costs thirty seconds again. Only when the shopper
    // has actually told us a gender. Demote, never drop: unisex pieces exist
    // and a wrong read should cost a piece its place, not its existence.
    // The gender the ANSWER was filtered to, which is not always the profile's.
    // /api/catalog/search passes no taste profile at all — it prepends "men" to
    // the query instead — so preferGender is null there and this whole pass was
    // silently skipped on the path the interface falls back to. Resolved the
    // same way applyFiltersAndSort resolves it, from the query first.
    const effectiveGender =
      requestedGenderFromConcepts(mandatoryConcepts ?? []) ?? preferGender ?? null
    if (effectiveGender && result.length > 1) {
      try {
        const opposite = effectiveGender === 'men' ? 'woman' : 'man'
        const worn = await wornGenderFor(result.map(p => p.image_url || ''))
        const wrong = result.filter((_, i) => worn[i] === opposite)
        // Everything reading as the other gender is far likelier to be a bad
        // read than a catalogue with nothing in it for you. Leave it alone.
        if (wrong.length > 0 && wrong.length < result.length) {
          const wrongSet = new Set(wrong)
          result = [...result.filter(p => !wrongSet.has(p)), ...wrong]
        }
      } catch { /* the order above stands */ }
    }

    return result
  }
}
