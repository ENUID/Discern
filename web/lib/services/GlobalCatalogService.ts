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
import { rerankByRelevance, type JudgeOutcome } from './relevanceRerank'

/** The last search's judge outcome, for the diagnostic endpoint and the
 *  scorecard. A module-level value is enough: it answers "is the taste layer
 *  running at all", which is a property of the deployment rather than of one
 *  request. */
export let lastJudgeOutcome: JudgeOutcome | 'not-run' = 'not-run'
import { matchStyles, styleRecallSignals } from '../styleVocabulary'
import { recordBrandOutcome, deprioritizeDead } from './brandHealth'
import { readPersistentCache, writePersistentCache } from './persistentSearchCache'
import { retrievalQueries } from '../fashion/outfitKnowledge'

// ─── Types ─────────────────────────────────────────────────────────────────────

export type UcpProduct = {
  id: string
  title: string
  vendor: string
  price: number
  currency: string
  store_url: string
  image_url: string
  in_stock: boolean
  tags: string[]
  description?: string
  description_html?: string
  options?: { name: string; values: string[] }[]
  media?: Array<{ type: string; url: string; alt?: string }>
  variants?: Array<{
    id: string
    title: string
    price: number
    availability: boolean
    options: Array<{ name: string; label: string }>
    media?: Array<{ url: string; alt?: string }>
  }>
  trust_score?: number
  relevance_score?: number
  relevance_reason?: string
  product_type?: string
  /** Shopify standard taxonomy ids, e.g. 'gid://shopify/TaxonomyCategory/aa-8-8'. */
  categories?: string[]
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

function cacheGet(key: string): CacheEntry | null {
  const e = lruCache.get(key)
  if (!e || Date.now() - e.timestamp > CACHE_TTL_MS) {
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

// ─── Concept relevance ─────────────────────────────────────────────────────────
// mandatoryConcepts are synonym groups extracted from the request:
//   [["shirt","shirts","tee"], ["linen"], ["black"]]
// The FIRST group is the garment — products missing it are off-category. The
// rest (color/material/origin) are ranking signals. Always graceful: if hard
// filtering would leave too few results, we fall back to scoring only.

function productHaystack(p: UcpProduct): string {
  const opts = (p.options || []).map(o => `${o.name} ${o.values.join(' ')}`).join(' ')
  return `${p.title} ${(p.tags || []).join(' ')} ${p.description || ''} ${opts}`.toLowerCase()
}

function conceptHit(haystack: string, group: string[]): boolean {
  return group.some(term => {
    const t = term.toLowerCase().trim()
    if (!t) return false
    if (t.includes(' ') || t.includes('-')) return haystack.includes(t)
    const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // Short terms need BOTH boundaries — a bare prefix match lets "red" hit
    // "reduced" and "tee" hit "teen". Longer terms keep the open-ended suffix
    // so "shirt" still matches "shirts", "boot" matches "boots".
    if (t.length < 4) return new RegExp(`\\b${esc}s?\\b`, 'i').test(haystack)
    return new RegExp(`\\b${esc}`, 'i').test(haystack)
  })
}

// Which concept group is the GARMENT (category) group? Match against the known
// garment vocabulary instead of trusting position — LLM output sometimes leads
// with gender or material, and hard-filtering on those returns wrong products.
function findGarmentGroupIndex(groups: string[][]): number {
  for (let i = 0; i < groups.length; i++) {
    if (groups[i].some(t => GARMENT_PRODUCT_TERMS.has(t.toLowerCase().trim()))) return i
  }
  return 0 // fall back to the historical assumption
}

/**
 * Precision ordering: products matching EVERY requested detail (garment AND
 * material AND color AND …) rank first, then right-category products missing
 * a detail. Off-category products are dropped entirely when enough
 * right-category results survive — the page stays FULL but exact matches
 * always lead. Always graceful: never empties the page over a filter.
 */
function applyConceptRelevance(products: UcpProduct[], concepts: string[][], minKeep: number): UcpProduct[] {
  const groups = (concepts || []).filter(g => Array.isArray(g) && g.length > 0)
  if (groups.length === 0 || products.length === 0) return products

  const garmentIdx = findGarmentGroupIndex(groups)
  const scored = products.map((p, i) => {
    const hay = productHaystack(p)
    let hits = 0
    let garmentHit = false
    let score = 0
    groups.forEach((g, gi) => {
      const isGarment = gi === garmentIdx
      // A general garment concept must not count a more-specific look-alike as
      // a match — "shirt" must reject "t-shirt"/"polo", "boot" reject "bootcut".
      // Only applied to the garment group (the exclusions are garment-specific).
      if (isGarment && conceptHit(hay, g) && matchesGarmentExclusion(hay, g)) return
      if (conceptHit(hay, g)) {
        hits++
        // Garment dominates; every extra matched detail (material, color,
        // gender) stacks on top — so a full exact match always outranks a
        // right-category-only match, which outranks everything else.
        score += isGarment ? 100 : 10
        if (isGarment) garmentHit = true
      }
    })
    return { p, i, score, hits, garmentHit }
  })

  // Drop off-category products when enough right-category ones survive.
  const onGarment = scored.filter(s => s.garmentHit)
  const pool = onGarment.length >= Math.min(minKeep, products.length) ? onGarment : scored

  // Most-details-matched first, then original (store relevance) order.
  return [...pool].sort((a, b) => b.score - a.score || b.hits - a.hits || a.i - b.i).map(s => s.p)
}

// ─── Non-fashion filter ────────────────────────────────────────────────────────

const NON_FASHION_TITLE_RE = /\b(?:book|books|magazine|magazines|zine|zines|paperback|hardcover|novel|novels|stationery|notepad|notepads|notebook|notebooks|candle|candles|diffuser|diffusers|incense|art\s+print|art\s+prints|wall\s+art|poster|posters|gift\s+card|gift\s+wrap)\b/i
const NON_FASHION_TAGS = new Set([
  'book', 'books', 'magazine', 'magazines', 'zine', 'novel', 'publication',
  'art-print', 'art print', 'wall-art', 'wall art', 'poster',
  'candle', 'candles', 'diffuser', 'home-fragrance', 'home fragrance', 'incense',
  'notebook', 'notebooks', 'stationery', 'notepad',
  'gift-card', 'gift card', 'gift_card',
])

function isNonFashion(p: UcpProduct): boolean {
  if (NON_FASHION_TITLE_RE.test(p.title)) return true
  return (p.tags || []).some(t => NON_FASHION_TAGS.has(t.toLowerCase()))
}

// ─── Gender hard filter ─────────────────────────────────────────────────────
// mandatoryConcepts' color/material groups are soft ranking signals — a
// product missing "black" just ranks lower. Gender is different: a shopper
// searching menswear should never be shown a bona fide women's item, full
// stop. This hard-drops any product whose OWN gender signal clearly
// conflicts with what was requested; unisex/ungendered products (most of
// the catalog doesn't explicitly self-tag gender at all) are never rejected.
const WOMEN_GENDER_RE = /\b(women'?s?|womens|ladies?|female)\b/i
const MEN_GENDER_RE = /\b(men'?s?|mens|male|gentlemen)\b/i

function productGenderSignal(p: UcpProduct): 'men' | 'women' | null {
  // The OPENING of the description as well as the title and tags. A men's
  // shorts search was returning "Zahra Printed Shirt & Shorts Co-Ord Set" —
  // womenswear whose title, tags and product_type never say so, and whose
  // description says it in the first line. Reading three of the four places a
  // store states who a garment is for is how a man ends up looking at a photo
  // of a woman.
  //
  // Only the opening, deliberately. Further down a description will say things
  // like "also available in women's", and treating that as the garment's own
  // gender would drop menswear for mentioning that a women's version exists.
  const intro = String(p.description || '').slice(0, 220)
  const hay = `${p.title} ${(p.tags || []).join(' ')} ${p.product_type || ''} ${intro}`.toLowerCase()
  const isWomen = WOMEN_GENDER_RE.test(hay)
  const isMen = MEN_GENDER_RE.test(hay)
  if (isWomen && !isMen) return 'women'
  if (isMen && !isWomen) return 'men'
  return null
}

// ─── Colour: a stated fact, not a preference ────────────────────────────────
// "White shirts" came back with green ones in the page. Colour was a +10
// ranking nudge inside applyConceptRelevance, which only ever SORTS — nothing
// was ever dropped for being the wrong colour, so the page filled to its
// minimum with whatever else the stores returned. Sorted correctly, and wrong.
//
// A shopper who says white has not expressed a preference; they have stated a
// requirement, the same way a size is. So a product whose own colour is legibly
// something else is removed. "Cannot tell" is not "wrong" — a piece that names
// no colour anywhere survives, because most independent stores are inconsistent
// about it and dropping the silent ones would empty the page.

/** Every colour family this product legibly claims, from its title, its tags
 *  and its Color option — the three places a store actually writes one. */
function familiesIn(text: string): Set<string> {
  const hay = text.toLowerCase()
  const found = new Set<string>()
  for (const [family, synonyms] of Object.entries(COLOR_VOCAB)) {
    if (synonyms.some(t => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(hay))) {
      found.add(family)
    }
  }
  return found
}

function productColorFamilies(p: UcpProduct): Set<string> {
  // The title first, and alone when it says anything. A store's tag list
  // routinely carries every colourway a style comes in, so a piece called
  // "Green Tropical Shirt Set" and tagged white passed a tag-based check while
  // being, in its name and its photograph, green. What a piece is called is
  // what the shopper sees.
  const fromTitle = familiesIn(p.title || '')
  if (fromTitle.size > 0) return fromTitle

  return familiesIn([
    (p.tags || []).join(' '),
    (p.options || []).filter(o => /colou?r/i.test(o.name || '')).flatMap(o => o.values || []).join(' '),
  ].join(' '))
}

/** Families that overlap enough that one is not "wrong" for the other — the
 *  vocabulary deliberately shares synonyms (ivory is both white and cream,
 *  navy is both navy and blue), so a strict family match would reject pieces a
 *  person would call correct. */
function colorFamiliesAgree(a: string, b: string): boolean {
  if (a === b) return true
  const sa = new Set(COLOR_VOCAB[a] ?? []), sb = COLOR_VOCAB[b] ?? []
  return sb.some(t => sa.has(t))
}

/** The colour families the shopper actually named.
 *
 *  Matched by overlap, not by array identity. Two code paths build these
 *  groups — buildMandatoryConcepts and the intent compiler — and they do not
 *  produce byte-identical arrays, so an exact comparison silently matched
 *  nothing on the compiled path. Which is the worst kind of bug: the filter
 *  existed, was correct, and never ran.
 */
function requestedColorsFromConcepts(groups: string[][]): string[] {
  const out: string[] = []
  for (const g of groups) {
    if (!g.length) continue
    const tokens = g.map(t => String(t).toLowerCase().trim())
    let best: string | null = null
    let bestHits = 0
    for (const [family, synonyms] of Object.entries(COLOR_VOCAB)) {
      const set = new Set(synonyms)
      const hits = tokens.filter(t => set.has(t)).length
      if (hits > bestHits) { bestHits = hits; best = family }
    }
    // Most of the group has to be this family's vocabulary, or a garment list
    // that happens to contain one colour word would read as a colour request.
    if (best && bestHits >= Math.max(2, Math.ceil(tokens.length * 0.6)) && !out.includes(best)) {
      out.push(best)
    }
  }
  return out
}

// Which concept group (if any) names the requested gender? Only the
// dedicated gender group ever contains these terms — garment/material/color
// vocabularies don't — so this reads the shopper's actual request, not a
// guess.
function requestedGenderFromConcepts(groups: string[][]): 'men' | 'women' | null {
  for (const g of groups) {
    const joined = g.join(' ')
    if (WOMEN_GENDER_RE.test(joined)) return 'women'
    if (MEN_GENDER_RE.test(joined)) return 'men'
  }
  return null
}

// ─── Size soft signal ───────────────────────────────────────────────────────
// A confirmed size match nudges a product up; a confirmed unavailable variant
// nudges it down — but this is NEVER a hard filter, unlike gender. Size label
// formats vary too much across independent stores (S/M/L vs numeric vs UK/EU)
// to safely exclude on a literal-text miss: a label that doesn't match almost
// always means "this store labels sizes differently" or "doesn't expose
// sizes at all," not "wrong size." Only a genuine, legible mismatch — the
// product lists the shopper's exact size as an option, and that specific
// variant is out of stock — demotes it. Everything else (can't tell) is left
// exactly where relevance already ranked it.
const SIZE_ALIASES: Record<string, string> = {
  xs: 'xs', extrasmall: 'xs',
  s: 's', small: 's',
  m: 'm', medium: 'm',
  l: 'l', large: 'l',
  xl: 'xl', extralarge: 'xl',
  xxl: 'xxl', '2xl': 'xxl', xxlarge: 'xxl',
  xxxl: 'xxxl', '3xl': 'xxxl',
}

function normalizeSizeLabel(raw: string): string {
  let cleaned = raw.toLowerCase().replace(/\b(us|uk|eu|eur|women'?s|men'?s)\b/g, '').replace(/[^a-z0-9]/g, '').trim()
  // Denim/trouser waist sizes are commonly labeled "W32" or "32W" — a
  // shopper stating a bare "32" should still match either form.
  cleaned = cleaned.replace(/^w(?=\d)/, '').replace(/w$/, '')
  return SIZE_ALIASES[cleaned] ?? cleaned
}

function productSizeSignal(p: UcpProduct, wantedSize: string): 'match' | 'mismatch' | 'unknown' {
  const wanted = normalizeSizeLabel(wantedSize)
  if (!wanted) return 'unknown'

  const sizeOptionValues = (p.options || []).filter(o => /size/i.test(o.name)).flatMap(o => o.values)
  if (sizeOptionValues.length === 0) return 'unknown' // product doesn't expose sizes at all — can't tell

  const hasWanted = sizeOptionValues.some(v => normalizeSizeLabel(v) === wanted)
  if (!hasWanted) return 'unknown' // this store just labels sizes differently — never guess mismatch from that alone

  if (p.variants && p.variants.length > 0) {
    const variant = p.variants.find(v => v.options.some(o => /size/i.test(o.name) && normalizeSizeLabel(o.label) === wanted))
    if (variant) return variant.availability ? 'match' : 'mismatch'
  }
  return 'match' // the size is listed and we have no variant-level stock data to contradict it
}

// Reorders (never filters) by size signal: confirmed match first, confirmed
// out-of-stock-in-that-size last, everything indeterminate stays exactly
// where relevance already put it.
function applySizePreference(products: UcpProduct[], wantedSize: string | null | undefined): UcpProduct[] {
  if (!wantedSize) return products
  const scored = products.map((p, i) => {
    const sig = productSizeSignal(p, wantedSize)
    return { p, i, score: sig === 'match' ? 1 : sig === 'mismatch' ? -1 : 0 }
  })
  return scored.sort((a, b) => b.score - a.score || a.i - b.i).map(s => s.p)
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
      const res = await fetch(`https://${domain}/api/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(STORE_TIMEOUT_MS),
      })
      if (!res.ok) return { products: [] as any[], errored: true }
      const data = await res.json()
      const products = extractProducts(data)
      for (const p of products) p._sourceDomain = domain
      return { products, errored: false }
    } catch {
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

    const descCandidates = [
      raw.description?.plain,
      variant.description?.plain,
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

    return {
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
      const hay = `${p.title} ${(p.tags || []).join(' ')} ${p.product_type || ''} ${String(p.description || '').slice(0, 220)}`.toLowerCase()
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

  return out.slice(0, params.limit)
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
      const batchRaw = await Promise.all(batch.map(d => fetchStore(d, storeQuery, cc, storeCtx)))
      for (const d of batch) entry.queried.add(d)
      ingest(batchRaw)
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
        result = await rerankByRelevance(judgeQuery, result, _tasteProfile, (o) => {
          lastJudgeOutcome = o
          if (o !== 'judged' && o !== 'cached') {
            console.warn(`[Catalog] the judge did NOT rank "${judgeQuery}" (${o}) — this page is keyword order`)
          }
        })
      } catch (err) {
        console.warn('[Catalog] rerank skipped:', err instanceof Error ? err.message : String(err))
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

    return result
  }
}
