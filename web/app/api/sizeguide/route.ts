import { NextRequest, NextResponse } from 'next/server'
import { BoundedCache } from '@/lib/boundedCache'
import { safeParseStoreUrl, safeFetch } from '@/lib/ssrfGuard'
import { UCP_REGISTRY } from '@/lib/stores'

/** True when this host is one of the brands Discern actually carries.
 *
 *  Same check, same registry and same exact-match rule as
 *  /api/product-images and GlobalCatalogService — not a second allowlist.
 *  Without it this route would fetch any public host a caller named, which
 *  combined with the hostname-predicate bypasses closed alongside it was a
 *  working unauthenticated request forgery. */
function isRegisteredStore(hostname: string): boolean {
  const h = hostname.toLowerCase().trim()
  return UCP_REGISTRY.some(s => s.domain.toLowerCase().trim() === h)
}

const SIZE_KWS = /\b(size|chest|waist|hip|inseam|sleeve|shoulder|length|neck|bust|height|weight|measurements?|XS|XL|XXL)\b/i

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

// In-process cache keyed by store origin
const cache = new BoundedCache<string, string | null>(2000)

// ── Content extractors ──────────────────────────────────────────────────────

function extractTables(html: string): string | null {
  const found: string[] = []
  const re = /<table[\s\S]*?<\/table>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    if (SIZE_KWS.test(m[0])) found.push(m[0])
  }
  return found.length ? found.join('') : null
}

function extractSizeImages(html: string): string | null {
  const found: string[] = []
  const re = /<img[^>]+>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const tag = m[0]
    if (!/\bsrc=/i.test(tag)) continue
    const srcM = tag.match(/src=["']([^"']+)["']/i)
    if (!srcM || srcM[1].startsWith('data:')) continue
    if (!/size.?chart|size.?guide|sizing|measurement/i.test(tag)) continue
    found.push(tag
      .replace(/width=["'][^"']*["']/gi, '')
      .replace(/height=["'][^"']*["']/gi, '')
      .replace(/<img/, '<img style="max-width:100%;height:auto;display:block"'))
  }
  return found.length ? `<div>${found.join('')}</div>` : null
}

function extractPageImages(html: string): string | null {
  const found: string[] = []
  const re = /<img[^>]+>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const tag = m[0]
    const srcM = tag.match(/src=["']([^"']+)["']/i)
    if (!srcM) continue
    const src = srcM[1]
    if (src.startsWith('data:') || /\.(svg|ico|gif)(\?|$)/i.test(src)) continue
    if (/logo|spinner|icon|avatar|badge|social|header|nav|menu/i.test(src + tag)) continue
    const wM = tag.match(/width=["'](\d+)["']/i)
    if (wM && parseInt(wM[1]) < 200) continue
    found.push(tag
      .replace(/width=["'][^"']*["']/gi, '')
      .replace(/height=["'][^"']*["']/gi, '')
      .replace(/<img/, '<img style="max-width:100%;height:auto;display:block;margin:6px 0"'))
  }
  return found.length ? `<div>${found.join('')}</div>` : null
}

function tryExtract(html: string): string | null {
  return extractTables(html) ?? extractSizeImages(html) ?? extractPageImages(html)
}

// ── Fetch helpers ───────────────────────────────────────────────────────────

const BROWSER_HEADERS = {
  'User-Agent': UA,
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
}

async function getJson(url: string, ms = 8000): Promise<any> {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms)
  try {
    const r = await safeFetch(url, { signal: c.signal, headers: { Accept: 'application/json', 'User-Agent': UA } })
    if (!r.ok) return null
    return await r.json()
  } catch { return null } finally { clearTimeout(t) }
}

async function getHtml(url: string, ms = 7000): Promise<string | null> {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms)
  try {
    const r = await safeFetch(url, {
      signal: c.signal,
      headers: { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', ...BROWSER_HEADERS },
    })
    if (!r.ok) return null
    return await r.text()
  } catch { return null } finally { clearTimeout(t) }
}

// ── Strategy 1: Shopify public pages JSON API ────────────────────────────────
// /pages.json returns all store pages with body_html — no bot protection.
// When body_html is empty (JSON-template stores), fall back to rendered fetch.
async function tryShopifyPagesApi(origin: string): Promise<string | null> {
  const data = await getJson(`${origin}/pages.json?limit=250`)
  if (!data?.pages) return null

  const pages: { title: string; body_html: string; handle: string }[] = data.pages ?? []

  const ranked = pages
    .filter(p => /size|fit|measurement|sizing/i.test(p.title))
    .sort((a, b) => {
      const score = (t: string) =>
        /size.?(guide|chart)/i.test(t) ? 3 : /size/i.test(t) ? 2 : /fit|measurement/i.test(t) ? 1 : 0
      return score(b.title) - score(a.title)
    })

  for (const page of ranked) {
    if (page.body_html?.length > 20) {
      const result = tryExtract(page.body_html)
      if (result) return result
    } else if (page.handle) {
      // body_html is empty (JSON-template page) — fetch the rendered HTML directly
      const html = await getHtml(`${origin}/pages/${page.handle}`)
      if (html) {
        const result = tryExtract(html)
        if (result) return result
      }
    }
  }
  return null
}

// ── Strategy 2: Shopify product JSON (uses description_html) ─────────────────
async function tryProductJson(storeUrl: string): Promise<string | null> {
  const m = storeUrl.match(/\/products\/([^/?#]+)/)
  if (!m) return null
  const { protocol, hostname } = new URL(storeUrl)
  const data = await getJson(`${protocol}//${hostname}/products/${m[1]}.json`)
  const html: string = data?.product?.body_html ?? ''
  if (!html) return null
  return extractTables(html) ?? extractSizeImages(html)
}

// ── Strategy 3: Direct HTML fetch — comprehensive slug list ─────────────────
const SLUG_PATTERNS = [
  // Most common
  'size-guide', 'size-chart', 'sizing', 'size', 'sizes',
  // Fit
  'fit-guide', 'fit', 'size-guides', 'size-charts',
  // Measurement variants
  'measurement-guide', 'measurements', 'how-to-measure', 'how-to-size',
  // International
  'international-sizing', 'size-information', 'size-info',
  // Gendered
  'size-guide-women', 'size-guide-men', 'size-guide-kids',
  'womens-size-guide', 'mens-size-guide',
  'women-size-guide', 'men-size-guide',
  'size-guide-womens', 'size-guide-mens',
  // Alternatives
  'sizing-guide', 'sizing-chart', 'size-reference', 'size-help',
  'body-measurements', 'find-your-size', 'find-your-fit',
  'size-and-fit', 'fit-and-size',
]

async function tryDirectFetch(origin: string): Promise<string | null> {
  // Batch in groups of 4 to avoid overwhelming a single server
  for (let i = 0; i < SLUG_PATTERNS.length; i += 4) {
    const batch = SLUG_PATTERNS.slice(i, i + 4)
    const results = await Promise.all(
      batch.map(async slug => {
        const html = await getHtml(`${origin}/pages/${slug}`)
        if (!html) return null
        return tryExtract(html)
      })
    )
    const found = results.find(r => r !== null)
    if (found) return found
  }
  return null
}

// ── Strategy 4: Root-level pages — non-Shopify stores (WooCommerce, custom) ──
async function tryRootSlugs(origin: string): Promise<string | null> {
  const slugs = [
    'size-guide', 'size-chart', 'sizing', 'size', 'sizes',
    'fit-guide', 'sizing-guide', 'size-information',
    'measurement-guide', 'measurements',
  ]
  for (let i = 0; i < slugs.length; i += 4) {
    const results = await Promise.all(
      slugs.slice(i, i + 4).map(async slug => {
        const html = await getHtml(`${origin}/${slug}`)
        return html ? tryExtract(html) : null
      })
    )
    const found = results.find(r => r !== null)
    if (found) return found
  }
  return null
}

// ── Route handler ───────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('url')
  if (!raw) return NextResponse.json({ html: null })

  const parsed = safeParseStoreUrl(raw)
  if (!parsed) return NextResponse.json({ html: null })
  // Every path this route builds is Shopify-shaped — /pages.json,
  // /pages/{handle}, /products/{handle}.json — so a store is the only
  // destination it was ever meant to reach. Same answer shape as an
  // unreadable URL, so the public contract does not change.
  if (!isRegisteredStore(parsed.hostname)) return NextResponse.json({ html: null })
  const origin = parsed.origin

  // Check cache first
  if (cache.has(origin)) return NextResponse.json({ html: cache.get(origin) ?? null })

  // Strategy 1: Shopify pages JSON (most reliable, no bot protection)
  const shopifyResult = await tryShopifyPagesApi(origin)
  if (shopifyResult) {
    cache.set(origin, shopifyResult)
    return NextResponse.json({ html: shopifyResult })
  }

  const [productResult, directResult, rootResult] = await Promise.allSettled([
    tryProductJson(raw),
    tryDirectFetch(origin),
    tryRootSlugs(origin),
  ])

  const result =
    (productResult.status === 'fulfilled' && productResult.value) ||
    (directResult.status  === 'fulfilled' && directResult.value)  ||
    (rootResult.status    === 'fulfilled' && rootResult.value)    ||
    null

  cache.set(origin, result)
  return NextResponse.json({ html: result })
}
