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

function toProduct(p: any): V2Product {
  return {
    id: String(p?.id ?? p?.handle ?? Math.random()),
    title: String(p?.title ?? 'Piece'),
    price: typeof p?.price === 'number' ? p.price : undefined,
    compareAt: typeof p?.compare_at_price === 'number' ? p.compare_at_price : undefined,
    currency: p?.currency ?? 'USD',
    image: img(p),
    images: Array.isArray(p?.media) ? p.media.map((m: any) => m?.url).filter(Boolean).slice(0, 4) : undefined,
    vendor: p?.vendor,
    description: typeof p?.description === 'string'
      ? p.description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 480)
      : undefined,
    sizes: Array.isArray(p?.options)
      ? (p.options.find((o: any) => /size/i.test(o?.name ?? ''))?.values ?? []).slice(0, 8)
      : undefined,
  }
}

export default function V2Page() {
  const onQuery = useCallback(async (q: string) => {
    const res = await fetch('/api/ai/stylist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: q, messages: [] }),
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
        sections.push({ title: g.label ?? 'Selection', subtitle: data?.reply?.slice(0, 90), hero: products[0], products: products.slice(1) })
      }
    }

    // A single search: one section.
    if (!sections.length && Array.isArray(data?.foundProducts) && data.foundProducts.length > 0) {
      const products = data.foundProducts.map(toProduct).filter((p: V2Product) => p.image)
      if (products.length) {
        sections.push({ title: 'The Selection', subtitle: data?.reply?.slice(0, 90), hero: products[0], products: products.slice(1) })
      }
    }

    // An outfit becomes the floating "look" tray — one piece per slot.
    if (Array.isArray(data?.outfitSlots) && data.outfitSlots.length > 0) {
      look = data.outfitSlots.map((s: any) => toProduct(s?.products?.[0])).filter((p: V2Product) => p.image)
    } else if (Array.isArray(data?.outfitGroups) && data.outfitGroups.length > 0) {
      look = (data.outfitGroups[0]?.products ?? []).map(toProduct).filter((p: V2Product) => p.image)
    }

    return { sections, look }
  }, [])

  return <DiscernV2 onQuery={onQuery} />
}
