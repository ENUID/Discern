'use client'
/**
 * The boutique interface — the app's only UI.
 *
 * It talks to the same /api/ai/stylist endpoint the chat UI did, and now sends
 * the same thing: gender, sizes, wardrobe, memory, currency, saved pieces,
 * recent searches and attached photos. Sending only the question was the whole
 * gap between the two surfaces — the model was answering a stranger here and a
 * known shopper there.
 */
import React, { useCallback, useMemo, useState } from 'react'
import DiscernV2, { type V2Product, type V2Section } from '@/features/v2/DiscernV2'
import type { V2Msg } from '@/features/v2/DiscernV2'
import { askStylist } from '@/features/stylist/askStylist'
import { useStylistContext } from '@/features/stylist/useStylistContext'

// The stylist endpoint streams newline-delimited JSON: many {type:'progress'}
// lines then a single {type:'result'}. Same reader shape as the main app.
async function readStream(res: Response): Promise<any> {
  if (!res.body) return null
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let out: any = null
  const line = (l: string) => {
    const t = l.trim()
    if (!t) return
    try { const o = JSON.parse(t); if (o.type === 'result') out = o } catch { /* skip partial */ }
  }
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let i
    while ((i = buf.indexOf('\n')) >= 0) { line(buf.slice(0, i)); buf = buf.slice(i + 1) }
  }
  line(buf)
  return out
}

const img = (p: any): string =>
  p?.media?.[0]?.url || p?.image_url || p?.image || p?.images?.[0] || ''

/** The catalogue hands back images at ?width=400 — a tile size. The hero cards
 *  are the largest imagery on the opening screen and were upscaling those, which
 *  is what made them look soft. Shopify's CDN honours the parameter, so ask for
 *  the size actually being drawn; anything not on that CDN is returned as-is. */
function atWidth(src: string, width = 1200): string {
  try {
    const u = new URL(src.startsWith('//') ? `https:${src}` : src)
    if (u.hostname.includes('cdn.shopify') || u.hostname.includes('shopifycdn') || u.pathname.includes('/cdn/shop/')) {
      u.searchParams.set('width', String(width))
      u.searchParams.delete('height')
      return u.toString()
    }
    return src
  } catch {
    return src
  }
}

const opt = (p: any, re: RegExp): string[] =>
  (Array.isArray(p?.options) ? p.options.find((o: any) => re.test(o?.name ?? ''))?.values ?? [] : [])

/** Colour swatches, resolved against variants so each carries its own image
 *  and real availability — that's what drives the picker's ring and its
 *  "Unavailable" state rather than a decorative dot. */
function toColors(p: any) {
  const names: string[] = opt(p, /colou?r/i)
  if (!names.length) return undefined
  return names.slice(0, 6).map(name => {
    const v = (p?.variants ?? []).find((vr: any) =>
      (vr?.options ?? []).some((o: any) => String(o?.label ?? '').toLowerCase() === name.toLowerCase()))
    return {
      name,
      image: v?.media?.[0]?.url || img(p),
      available: v ? v.availability !== false : true,
    }
  })
}

function toProduct(p: any): V2Product {
  const media = Array.isArray(p?.media) ? p.media.map((m: any) => m?.url).filter(Boolean) : []
  return {
    id: String(p?.id ?? p?.handle ?? Math.random()),
    title: String(p?.title ?? 'Piece'),
    price: typeof p?.price === 'number' ? p.price : undefined,
    compareAt: typeof p?.compare_at_price === 'number' ? p.compare_at_price : undefined,
    currency: p?.currency ?? p?.base_currency ?? 'USD',
    image: img(p),
    images: media.length ? media.slice(0, 5) : undefined,
    vendor: p?.vendor,
    sku: p?.handle ? String(p.handle).toUpperCase().replace(/-/g, '').slice(0, 18) : undefined,
    // The catalogue returns this and the bag needs it to hand off to the brand.
    // It was being dropped here, which is why Checkout had nowhere to go.
    storeUrl: p?.store_url || p?.url || undefined,
    // Carried for checkout: without the variant ids the bag can only send the
    // shopper to a product page to pick their size a second time.
    variants: Array.isArray(p?.variants)
      ? p.variants.map((v: any) => ({
          id: v?.id ? String(v.id) : undefined,
          options: Array.isArray(v?.options) ? v.options.map((o: any) => ({ label: String(o?.label ?? '') })) : [],
          availability: v?.availability !== false,
        }))
      : undefined,
    colorName: opt(p, /colou?r/i)[0],
    colors: toColors(p),
    sizes: opt(p, /size/i).slice(0, 10),
    description: typeof p?.description === 'string'
      ? p.description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 520)
      : undefined,
    materials: (p?.tags ?? []).filter((t: string) => /cotton|linen|wool|silk|cashmere|leather|denim|suede|velvet/i.test(t)).join(', ') || undefined,
  }
}

export default function Boutique({ buyerCurrency, buyerCountry, heroCopy }: {
  buyerCurrency?: string
  buyerCountry?: string
  /** Which of the eight opening lines is showing. Computed on the server from
   *  the clock, so the server and client render the same one. */
  heroCopy?: number
}) {
  // Recent searches are free-tier personalisation: they carry taste even for a
  // shopper who has never signed in. Kept here rather than inside DiscernV2
  // because this is the layer that owns everything else Fabrics is told.
  const [recentSearches, setRecentSearches] = useState<string[]>([])
  const remember = useCallback((q: string) => {
    setRecentSearches(prev => [q, ...prev.filter(x => x !== q)].slice(0, 8))
  }, [])

  // Saved pieces, mirrored up from the interface. Only the four fields the
  // stylist reads — sending whole product objects would bloat every request
  // with images and variant data the model never looks at.
  const [savedProducts, setSavedProducts] = useState<
    Array<{ title?: string; vendor?: string; price?: number; currency?: string }>>([])
  const onSavedChange = useCallback((saved: V2Product[]) => {
    setSavedProducts(saved.map(p => ({
      title: p.title, vendor: p.vendor, price: p.price, currency: p.currency,
    })))
  }, [])

  const context = useStylistContext({
    buyerCurrency, buyerCountry, recentSearches, savedProducts,
  })

  /** Opening-screen imagery, pulled from the same geo-aware feed the live app
   *  uses. This is why the hero needs no hand-placed art files: it shows real,
   *  in-stock pieces from the catalogue. Failure is silent — the hero falls
   *  back to its paper surfaces rather than showing a broken screen. */
  const onFeatured = useCallback(async () => {
    const res = await fetch('/api/featured', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page: 0, excludeIds: [] }),
    })
    if (!res.ok) return []
    const data = await res.json()
    const items: any[] = Array.isArray(data?.products) ? data.products : []
    return items
      .filter(p => p?.in_stock !== false)
      .map(img)
      .filter(Boolean)
      .map(atWidth)
      .slice(0, 12)
  }, [])

  // `messages` was hardcoded to [] — v2 had no memory at all, so every turn
  // arrived as turn one and a follow-up like "cheaper" was a brand-new
  // conversation. The caller owns the transcript and passes it in.
  const onQuery = useCallback(async (q: string, history: V2Msg[] = [], images: string[] = []) => {
    const data = await askStylist({
      question: q,
      messages: history.slice(-6),
      images,
      context,
    })

    const sections: V2Section[] = []
    let look: V2Product[] | undefined

    /** Section headings name what was actually looked for — the group's own
     *  label, or failing that the query the model ran. Never an invented
     *  phrase: "The Selection" and "Selection" were words nobody chose, sitting
     *  where the reference puts a real collection name, and a heading that says
     *  nothing is worse than no heading. Falls back to the shopper's own
     *  wording, which is at least true. */
    const heading = (label?: string) => {
      const s = (label || data?.searchQuery || q || '').trim()
      if (!s) return ''
      return s.charAt(0).toUpperCase() + s.slice(1)
    }

    // A multi-garment search comes back as labelled groups — one editorial
    // section per garment, which maps exactly onto this layout.
    if (Array.isArray(data?.foundProductGroups) && data.foundProductGroups.length > 0) {
      for (const g of data.foundProductGroups) {
        const products = (g?.products ?? []).map(toProduct).filter((p: V2Product) => p.image)
        if (!products.length) continue
        sections.push({ title: heading(g?.label), hero: products[0], products: products.slice(1) })
      }
    }

    // A single search: one section.
    if (!sections.length && Array.isArray(data?.foundProducts) && data.foundProducts.length > 0) {
      const products = data.foundProducts.map(toProduct).filter((p: V2Product) => p.image)
      if (products.length) {
        sections.push({ title: heading(), hero: products[0], products: products.slice(1) })
      }
    }

    // An outfit becomes the floating "look" tray — one piece per slot.
    if (Array.isArray(data?.outfitSlots) && data.outfitSlots.length > 0) {
      look = data.outfitSlots.map((s: any) => toProduct(s?.products?.[0])).filter((p: V2Product) => p.image)
    } else if (Array.isArray(data?.outfitGroups) && data.outfitGroups.length > 0) {
      look = (data.outfitGroups[0]?.products ?? []).map(toProduct).filter((p: V2Product) => p.image)
    }

    // Rename everything in one call before the grid draws. Catalogue titles are
    // written for a search engine — four lines of keywords under a photograph,
    // or a bare style code that names no garment at all. Failure is silent and
    // the raw titles stand, which is where this started.
    try {
      const all = [...sections.flatMap(s => [s.hero, ...s.products]), ...(look ?? [])]
        .filter(Boolean) as V2Product[]
      if (all.length) {
        const res = await fetch('/api/product-names', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: all.map(p => ({ title: p.title })) }),
        })
        if (res.ok) {
          const { names } = await res.json()
          if (names && typeof names === 'object') {
            for (const p of all) {
              const better = names[p.title]
              // Keep the catalogue title for the product page and the bag —
              // it is the piece's real name, and the shopper is buying it.
              if (typeof better === 'string' && better) { p.fullTitle = p.title; p.title = better }
            }
          }
        }
      }
    } catch { /* raw titles are a worse caption, not a broken one */ }


    // The reply was previously used only as a 90-character section caption and
    // otherwise discarded, and a conversational turn (no products) rendered as
    // "No match — nothing in the catalogue fits that", blaming the catalogue
    // for something that was never a catalogue query. Both are fixed by
    // carrying two more fields: the answer itself, and whether the model
    // actually searched. `searchQuery` is already on the wire.
    return {
      sections,
      look,
      answer: typeof data?.reply === 'string' ? data.reply : undefined,
      didSearch: typeof data?.searchQuery === 'string' && data.searchQuery.length > 0,
      light: data?.light === true,
    }
  }, [context])

  return (
    <DiscernV2
      onQuery={onQuery}
      onFeatured={onFeatured}
      onSearched={remember}
      onSavedChange={onSavedChange}
      heroCopy={heroCopy}
      buyerCountry={buyerCountry}
    />
  )
}
