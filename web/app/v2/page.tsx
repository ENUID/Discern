'use client'
/**
 * /v2 — preview route for the next-version boutique interface.
 *
 * Deliberately its own route so the live experience at / is untouched while
 * this is being built. It talks to the SAME /api/ai/stylist endpoint the
 * current app uses, so what renders here is real catalog data and real
 * reasoning, not a mock — the only thing that differs is the presentation.
 */
import React, { useCallback } from 'react'
import DiscernV2, { type V2Product, type V2Section } from '@/features/v2/DiscernV2'
import type { V2Msg } from '@/features/v2/DiscernV2'

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
    colorName: opt(p, /colou?r/i)[0],
    colors: toColors(p),
    sizes: opt(p, /size/i).slice(0, 10),
    description: typeof p?.description === 'string'
      ? p.description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 520)
      : undefined,
    materials: (p?.tags ?? []).filter((t: string) => /cotton|linen|wool|silk|cashmere|leather|denim|suede|velvet/i.test(t)).join(', ') || undefined,
  }
}

export default function V2Page() {
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
      .slice(0, 12)
  }, [])

  // `messages` was hardcoded to [] — v2 had no memory at all, so every turn
  // arrived as turn one and a follow-up like "cheaper" was a brand-new
  // conversation. The caller owns the transcript and passes it in.
  const onQuery = useCallback(async (q: string, history: V2Msg[] = []) => {
    const res = await fetch('/api/ai/stylist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: q, messages: history.slice(-6) }),
    })
    const data = await readStream(res)

    const sections: V2Section[] = []
    let look: V2Product[] | undefined

    // A multi-garment search comes back as labelled groups — one editorial
    // section per garment, which maps exactly onto this layout.
    if (Array.isArray(data?.foundProductGroups) && data.foundProductGroups.length > 0) {
      for (const g of data.foundProductGroups) {
        const products = (g?.products ?? []).map(toProduct).filter((p: V2Product) => p.image)
        if (!products.length) continue
        sections.push({ title: g.label ?? 'Selection', hero: products[0], products: products.slice(1) })
      }
    }

    // A single search: one section.
    if (!sections.length && Array.isArray(data?.foundProducts) && data.foundProducts.length > 0) {
      const products = data.foundProducts.map(toProduct).filter((p: V2Product) => p.image)
      if (products.length) {
        sections.push({ title: 'The Selection', hero: products[0], products: products.slice(1) })
      }
    }

    // An outfit becomes the floating "look" tray — one piece per slot.
    if (Array.isArray(data?.outfitSlots) && data.outfitSlots.length > 0) {
      look = data.outfitSlots.map((s: any) => toProduct(s?.products?.[0])).filter((p: V2Product) => p.image)
    } else if (Array.isArray(data?.outfitGroups) && data.outfitGroups.length > 0) {
      look = (data.outfitGroups[0]?.products ?? []).map(toProduct).filter((p: V2Product) => p.image)
    }

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
  }, [])

  return <DiscernV2 onQuery={onQuery} onFeatured={onFeatured} />
}
