import { NextRequest, NextResponse } from 'next/server'
import { GlobalCatalogService } from '@/lib/services/GlobalCatalogService'
import { UCP_REGISTRY, bestBrandDomains } from '@/lib/stores'
import { makeIpRateLimiter } from '@/lib/rateLimit'

export const maxDuration = 60

/** The feed is the one public route that spends other people's quota for free.
 *
 *  Every other endpoint that fans out or calls a model already carries this;
 *  this one carried it on neither verb. Thirty a minute is far above a shopper
 *  scrolling the grid, and far below a script. */
const isRateLimited = makeIpRateLimiter(30, 60_000)

// Map a brand domain → the genders it serves (from the registry).
const BRAND_GENDERS: Map<string, string[]> = new Map(
  UCP_REGISTRY.map(s => [s.domain.toLowerCase().replace(/^www\./, ''), (s.gender ?? []).map(g => g.toLowerCase())]),
)
function brandServesGender(domain: string, gender: 'men' | 'women'): boolean {
  const g = BRAND_GENDERS.get(domain.toLowerCase().replace(/^www\./, ''))
  if (!g || g.length === 0) return true            // unknown → keep (don't starve)
  return g.includes(gender) || g.includes('unisex')
}

// Drop products clearly meant for the opposite gender (conservative — only
// strong signals, so we never over-filter the feed into emptiness).
function isOppositeGender(p: any, gender: 'men' | 'women'): boolean {
  const t = `${p.title ?? ''} ${(Array.isArray(p.tags) ? p.tags.join(' ') : '')}`.toLowerCase()
  if (gender === 'men') {
    return /\bwomen|woman\b|\bwomens\b|\bwomen's|ladies|\bdress\b|\bdresses\b|skirt|blouse|\bbra\b|bralette|lingerie|\bheels?\b|stiletto|saree|lehenga|anarkali|\bkurti\b|gown|\bher\b/.test(t)
  }
  // women: only drop things explicitly marked men's (women's garments rarely say "women")
  return /\bmen's|\bmens\b|\bmenswear\b|boxers\b/.test(t)
}

// Deterministic shuffle keyed by a seed so each scroll page pulls a different,
// stable set of brands (no Math.random → repeatable, paginates cleanly).
function seededShuffle<T>(arr: T[], seed: number): T[] {
  const a = arr.slice()
  let s = (seed >>> 0) || 1
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// Coarse category bucket from title/tags — used to interleave the feed so no
// single category (e.g. footwear) ever dominates the grid.
function categoryOf(p: any): string {
  const t = `${p.title ?? ''} ${(Array.isArray(p.tags) ? p.tags.join(' ') : '')}`.toLowerCase()
  if (/sneaker|trainer|loafer|\bboot|heel|sandal|flip.?flop|\bshoe|footwear|derby|oxford|\bmule|clog|espadrille|pump/.test(t)) return 'shoes'
  if (/dress|gown|kurta|saree|lehenga|anarkali|jumpsuit|romper|kaftan/.test(t)) return 'dress'
  if (/trouser|pant|jean|denim|chino|short|skirt|legging|cargo|culotte/.test(t)) return 'bottom'
  if (/jacket|coat|blazer|parka|trench|bomber|overcoat|gilet|waistcoat/.test(t)) return 'outerwear'
  if (/\bbag|tote|backpack|clutch|purse|wallet|crossbody|duffle/.test(t)) return 'bag'
  if (/ring|necklace|earring|bracelet|jewel|pendant|anklet|\bchain\b/.test(t)) return 'jewelry'
  if (/\bhat|\bcap\b|beanie|scarf|\bbelt|sunglass|\bsock|\btie\b/.test(t)) return 'accessory'
  if (/shirt|\btee\b|t-shirt|\btop\b|blouse|sweater|hoodie|knit|polo|sweatshirt|kurti|cardigan/.test(t)) return 'top'
  return 'other'
}

// Round-robin interleave across category buckets so the feed LEADS WITH CLOTHING
// (tops, dresses, bottoms, outerwear) and pushes footwear to the back — never a
// wall of shoes up top. Reorders only; never drops a product.
const CLOTHING = ['top', 'dress', 'bottom', 'outerwear']
function diversify(products: any[], seed: number): any[] {
  const buckets = new Map<string, any[]>()
  for (const p of products) {
    const c = categoryOf(p)
    if (!buckets.has(c)) buckets.set(c, [])
    buckets.get(c)!.push(p)
  }
  for (const list of Array.from(buckets.values())) {
    const s = seededShuffle(list, seed + list.length)
    list.length = 0
    list.push(...s)
  }
  const present = Array.from(buckets.keys())
  const clothing = seededShuffle(present.filter(c => CLOTHING.includes(c)), seed + 5)
  const middle = seededShuffle(present.filter(c => !CLOTHING.includes(c) && c !== 'shoes'), seed + 9)
  const shoes = present.filter(c => c === 'shoes')
  const order = [...clothing, ...middle, ...shoes]
  const lists = order.map(c => buckets.get(c)!)
  const out: any[] = []
  let added = true
  while (added) {
    added = false
    for (const list of lists) {
      const item = list.shift()
      if (item) { out.push(item); added = true }
    }
  }
  return out
}

// Core feed builder, shared by POST (the app) and GET (browser diagnostic).
// Built on the proven-reliable "best brands" (premium/luxury — the ones that
// actually respond on Shopify's MCP); the roster's long tail of tiny stores
// mostly returns nothing, so leaning on them starved the feed. Each page pulls a
// fresh rotated set of these brands, dedupes against what's shown, clothes-first.
async function buildFeatured(
  countryCode: string | null, page: number, excludeIds: Set<string>, buyerCurrency: string,
  gender: 'men' | 'women' | null = null,
) {
  // Brand pool — when a gender is set, prefer brands that serve it (or unisex),
  // but only drop those that exclusively serve the other gender, so the pool
  // stays wide enough to fill the grid.
  let pool = bestBrandDomains()
  if (gender) pool = pool.filter(d => brandServesGender(d, gender))
  const WINDOW = 28
  // How many pages the pool actually holds, and the wrap that keeps `page`
  // inside them.
  //
  // `page` seeds the shuffle below AND picks the window, so every value gave a
  // different set of brands — a different catalogue cache key, a guaranteed
  // miss, and another WINDOW store fetches. Nothing bounded it, so the number
  // of distinct keys one caller could mint was unbounded too and the cache
  // stopped being a ceiling on anything: a walk of pages 0..200 cost 5,040
  // outbound store calls.
  //
  // Wrapping rather than rejecting. A page inside the range is untouched, so
  // the feed, its order and its brands are exactly what they were; a page past
  // the end lands deterministically on a real one. This route has always
  // answered every page with a feed, and it still does.
  const pages = Math.max(1, Math.ceil(pool.length / WINDOW))
  page = ((page % pages) + pages) % pages
  const all = seededShuffle(pool, page * 7 + 11)
  const start = all.length ? (page * WINDOW) % all.length : 0
  const sample = all.slice(start, start + WINDOW)
  if (sample.length < WINDOW) sample.push(...all.slice(0, WINDOW - sample.length))

  const products = await GlobalCatalogService.search(
    '',                       // empty query → browse each brand's catalog
    undefined, [], countryCode, true, [],
    'relevance', buyerCurrency,
    { fastFirstPage: true },
    sample,                    // restrict fan-out to this page's reliable brands
  )

  // In stock, not already shown, no duplicate id/image. NO per-brand cap — the
  // working feed had none; a cap only ever subtracts.
  const seenId = new Set<string>()
  const seenImg = new Set<string>()
  const kept = products.filter(p => {
    if (!p.in_stock || excludeIds.has(p.id) || seenId.has(p.id)) return false
    if (gender && isOppositeGender(p, gender)) return false
    const img = p.image_url || ''
    if (img && seenImg.has(img)) return false
    seenId.add(p.id); if (img) seenImg.add(img)
    return true
  })

  const out = diversify(kept, page * 13 + 1).slice(0, 50)
  return {
    products: out,
    _meta: { sampled: sample.length, fetched: products.length, kept: kept.length, returned: out.length, cc: countryCode ?? null },
  }
}

export async function POST(req: NextRequest) {
  if (isRateLimited(req)) {
    return NextResponse.json({ products: [], _meta: { error: 'rate-limited' } }, { status: 429 })
  }
  try {
    const body = await req.json().catch(() => ({}))
    const buyerCurrency: string = typeof body?.buyerCurrency === 'string' ? body.buyerCurrency.toUpperCase() : 'USD'
    const countryCode: string | null = (typeof body?.buyerCountry === 'string' && body.buyerCountry.trim()
      ? body.buyerCountry.trim().toUpperCase()
      : req.headers.get('x-vercel-ip-country') || req.headers.get('cf-ipcountry') || null)
    const page: number = Number.isFinite(body?.page) ? Math.max(0, Math.floor(body.page)) : 0
    const excludeIds: Set<string> = new Set(
      Array.isArray(body?.excludeIds) ? body.excludeIds.filter((x: any) => typeof x === 'string') : []
    )
    const g = typeof body?.gender === 'string' ? body.gender.toLowerCase() : ''
    const gender: 'men' | 'women' | null = g === 'men' ? 'men' : g === 'women' ? 'women' : null
    return NextResponse.json(await buildFeatured(countryCode, page, excludeIds, buyerCurrency, gender))
  } catch (e) {
    console.error('[featured] error:', e)
    return NextResponse.json({ products: [], _meta: { error: String(e) } })
  }
}

// Browser diagnostic: open https://discern.enuid.com/api/featured?cc=IN to see the
// pipeline counts (sampled/fetched/kept/returned) and a sample of brand domains.
export async function GET(req: NextRequest) {
  if (isRateLimited(req)) {
    return NextResponse.json({ error: 'rate-limited' }, { status: 429 })
  }
  try {
    const cc = (req.nextUrl.searchParams.get('cc') || req.headers.get('x-vercel-ip-country') || 'US').toUpperCase()
    const page = Math.max(0, Math.floor(Number(req.nextUrl.searchParams.get('page') ?? 0)) || 0)
    const g = (req.nextUrl.searchParams.get('gender') || '').toLowerCase()
    const gender: 'men' | 'women' | null = g === 'men' ? 'men' : g === 'women' ? 'women' : null
    const result = await buildFeatured(cc, page, new Set(), 'USD', gender)
    const sampleBrands = seededShuffle(bestBrandDomains(), page * 7 + 11).slice(0, 28)
    return NextResponse.json({
      _meta: result._meta,
      totalBestBrands: bestBrandDomains().length,
      sampleBrands,
      firstProducts: result.products.slice(0, 8).map((p: any) => ({ title: p.title, vendor: p.vendor, store_url: p.store_url, img: !!p.image_url })),
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
