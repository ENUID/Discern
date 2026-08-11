import { NextRequest, NextResponse } from 'next/server'
import { BoundedCache } from '@/lib/boundedCache'
import { safeParseStoreUrl } from '@/lib/ssrfGuard'

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

type Gallery = {
  images: string[]
  colors: string[]
  byColor: Record<string, string[]>
}

// Cache by product URL so repeated sheet opens are instant
const cache = new BoundedCache<string, Gallery>(2000)

function toGalleryUrl(src: string): string {
  if (!src) return src
  try {
    const u = new URL(src.startsWith('//') ? `https:${src}` : src)
    // Shopify image hosts: cdn.shopify.com, *.shopifycdn.*, and the store's
    // own domain under /cdn/shop/… — all honour the ?width= param.
    if (u.hostname.includes('cdn.shopify') || u.hostname.includes('shopifycdn') || u.pathname.includes('/cdn/shop/')) {
      u.searchParams.set('width', '2048')
      u.searchParams.delete('height')
    }
    return u.toString()
  } catch {
    return src
  }
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('url')
  if (!raw) return NextResponse.json({ images: [], colors: [], byColor: {} })

  const parsed = safeParseStoreUrl(raw)
  if (!parsed) return NextResponse.json({ images: [], colors: [], byColor: {} })

  if (cache.has(raw)) return NextResponse.json(cache.get(raw))

  // Extract the product handle from the URL
  const handleMatch = raw.match(/\/products\/([^/?#]+)/)
  if (!handleMatch) return NextResponse.json({ images: [], colors: [], byColor: {} })

  const { protocol, hostname } = parsed
  const jsonUrl = `${protocol}//${hostname}/products/${handleMatch[1]}.json`

  const empty: Gallery = { images: [], colors: [], byColor: {} }

  const grab = async (url: string) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 7000)
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': UA, Accept: 'application/json' },
      })
      return res
    } finally { clearTimeout(timer) }
  }

  try {
    let res = await grab(jsonUrl)

    // Some stores serve /products/<handle>.json behind a bot rule and answer
    // 403, while /products/<handle>.js — the endpoint their own storefront
    // uses — is wide open. Todd Snyder is one, and every one of its pieces
    // showed a single photograph because of it. The two payloads differ only
    // in shape, so the second is normalised into the first below rather than
    // handled twice.
    let viaJs = false
    if (!res.ok && res.status !== 404 && res.status !== 410) {
      const alt = await grab(`${protocol}//${hostname}/products/${handleMatch[1]}.js`)
      if (alt.ok) { res = alt; viaJs = true }
    }

    if (!res.ok) {
      // Cache "no gallery" only for responses that mean the product page
      // genuinely has no JSON gallery (404/410). Transient upstream states
      // (5xx, 429, timeouts) must NOT be memoized — the old unconditional
      // cache.set turned one slow store response into "this product has no
      // images" for the life of the process.
      if (res.status === 404 || res.status === 410) cache.set(raw, empty)
      return NextResponse.json(empty)
    }

    const data = await res.json()
    // .json wraps the product; .js IS the product, and its `images` are plain
    // URL strings rather than objects. Everything downstream reads
    // `product.images[].src`, so the strings are lifted into that shape and
    // the media previews are folded in behind them.
    const product = viaJs
      ? {
          ...data,
          images: [
            ...(Array.isArray(data?.images) ? data.images : [])
              .filter((u: unknown): u is string => typeof u === 'string')
              .map((src: string) => ({ src })),
            ...(Array.isArray(data?.media) ? data.media : [])
              .map((m: any) => m?.preview_image?.src)
              .filter((src: unknown): src is string => typeof src === 'string')
              .map((src: string) => ({ src })),
          ],
        }
      : data?.product

    // ── Full gallery (ordered by position) ──────────────────────────────────
    const seen = new Set<string>()
    const images: string[] = []
    const push = (src?: string) => {
      if (!src) return
      const url = toGalleryUrl(src)
      if (!seen.has(url)) { seen.add(url); images.push(url) }
    }
    for (const img of (product?.images ?? [])) push(img.src)
    for (const v of (product?.variants ?? [])) push(v.featured_image?.src)

    // ── Separate images by colour ───────────────────────────────────────────
    // Shopify exposes the variant→image link via image.variant_ids and the
    // colour value via the variant's optionN field (N = the colour option's
    // position). We walk both to bucket every image under its colourway, so the
    // sheet can show one colour at a time.
    const byColor: Record<string, string[]> = {}
    const colors: string[] = []

    const colorOpt = (product?.options ?? []).find((o: any) => /colou?r/i.test(o?.name ?? ''))
    if (colorOpt) {
      const pos: number = colorOpt.position // 1-indexed
      for (const val of (colorOpt.values ?? [])) {
        if (typeof val === 'string' && val.trim()) colors.push(val)
      }

      // variantId → colour value
      const variantColor = new Map<number, string>()
      // colour value → its variant's featured image (fallback when an image
      // carries no variant_ids but the variant has a featured_image).
      for (const v of (product?.variants ?? [])) {
        const colour = v?.[`option${pos}`]
        if (typeof colour !== 'string' || !colour.trim()) continue
        if (typeof v?.id === 'number') variantColor.set(v.id, colour)
        if (v?.featured_image?.src) {
          const url = toGalleryUrl(v.featured_image.src)
          ;(byColor[colour] ??= [])
          if (!byColor[colour].includes(url)) byColor[colour].push(url)
        }
      }

      // Each gallery image may be tagged to specific variants → colours.
      for (const img of (product?.images ?? [])) {
        const url = toGalleryUrl(img?.src)
        if (!url) continue
        const vids: number[] = Array.isArray(img?.variant_ids) ? img.variant_ids : []
        const coloursForImg = new Set<string>()
        for (const vid of vids) {
          const colour = variantColor.get(vid)
          if (colour) coloursForImg.add(colour)
        }
        for (const colour of Array.from(coloursForImg)) {
          ;(byColor[colour] ??= [])
          if (!byColor[colour].includes(url)) byColor[colour].push(url)
        }
      }
    }

    const gallery: Gallery = { images, colors, byColor }
    cache.set(raw, gallery)
    return NextResponse.json(gallery)
  } catch {
    // Network error / abort — transient by definition, never cached.
    return NextResponse.json(empty)
  }
}
