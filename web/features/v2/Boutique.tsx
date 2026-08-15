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
import { productSlotCategories } from '@/lib/queryParser'

/** The word a slot goes by in a heading. Plural, because a section holds
 *  several — and "Outerwear" rather than "Outer", which is a database column. */
const SLOT_WORDS: Record<string, string> = {
  top: 'tops', bottom: 'trousers', outer: 'outerwear',
  dress: 'dresses', shoes: 'shoes', accessory: 'accessories',
}

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
    // Every variant in this colourway, not the first one found. A colour comes
    // in sizes; picking the first variant meant a sold-out S made the whole
    // colour read "Unavailable" while M and L were sitting in stock. That is
    // the button on the product page refusing a sale the brand would have made.
    const inColour = (p?.variants ?? []).filter((vr: any) =>
      (vr?.options ?? []).some((o: any) => String(o?.label ?? '').toLowerCase() === name.toLowerCase()))
    return {
      name,
      image: inColour.find((v: any) => v?.media?.[0]?.url)?.media?.[0]?.url || img(p),
      // Available if ANY size in this colour is.
      available: inColour.length === 0 || inColour.some((v: any) => v.availability !== false),
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
  /** Better captions for catalogue titles, arriving after the grid is already
   *  on screen. Keyed by the raw title, because that is what the products
   *  carry and what the endpoint was asked about. */
  const [renames, setRenames] = useState<Record<string, string>>({})
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
  const onQuery = useCallback(async (
    q: string, history: V2Msg[] = [], images: string[] = [],
    // What the backend is doing right now, forwarded verbatim to the status
    // line. The endpoint has always streamed these at its real boundaries; the
    // interface simply never asked for them.
    onProgress?: (step: { text: string; icon?: string }) => void,
    // Pieces the question is about. Present means "these ARE the answer"
    // server-side, so it describes them rather than searching for them again.
    pinned?: V2Product[],
  ) => {
    // askStylist rethrows on the last attempt when the request never
    // completed — a dead connection, DNS, a killed function. That throw used to
    // fly past the catalogue fallback below and land in the interface's own
    // catch, so the one failure most likely to be a network fault was the one
    // failure that skipped the network-free path.
    let data: any = null
    try {
      data = await askStylist({
        question: q,
        messages: history.slice(-6),
        images,
        context,
        onProgress,
        products: pinned && pinned.length
          ? pinned.map(p => ({
              id: p.id, title: p.title, vendor: p.vendor, price: p.price,
              currency: p.currency, material: p.materials, description: p.description,
              url: p.storeUrl,
            }))
          : undefined,
      })
    } catch (e) {
      console.error('[boutique] stylist unreachable:', e)
    }

    /** The catalogue, when the stylist could not answer.
     *
     *  /api/ai/stylist needs a language model and therefore somebody else's
     *  quota and uptime; /api/catalog/search needs neither. Every route to a
     *  product used to run through the model, so a provider outage emptied the
     *  screen — the brands were up the whole time and the shopper still got an
     *  apology. This asks the catalogue directly with the same question.
     *
     *  It runs only when the stylist produced no pieces at all, so a working
     *  model is never second-guessed, and it is silent on failure: if this
     *  cannot answer either, the honest empty state stands. */
    const brought = (d: any) =>
      (Array.isArray(d?.foundProducts) && d.foundProducts.length > 0)
      || (Array.isArray(d?.foundProductGroups) && d.foundProductGroups.length > 0)
      || (Array.isArray(d?.outfitSlots) && d.outfitSlots.length > 0)
      || (Array.isArray(d?.outfitGroups) && d.outfitGroups.length > 0)

    if (!brought(data) && (data?.failed || data?.busy || data?.retryable || !data)) {
      onProgress?.({ text: 'Going straight to the catalogue', icon: 'search' })
      try {
        const r = await fetch('/api/catalog/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            q,
            country: context.buyerCountry,
            currency: context.buyerCurrency,
            gender: context.shopperGender,
            sizes: context.shopperSizes,
          }),
        })
        if (r.ok) {
          const c = await r.json()
          if (Array.isArray(c?.products) && c.products.length > 0) {
            data = {
              ...(data ?? {}),
              reply: data?.reply,
              searchQuery: c.query || q,
              foundProducts: c.products,
              foundProductGroups: Array.isArray(c.groups) && c.groups.length ? c.groups : undefined,
              // It answered, just not the way it wanted to. Not a failure.
              failed: false, retryable: false, degraded: true,
            }
          }
        }
      } catch { /* the empty state below is still honest */ }
    }

    const sections: V2Section[] = []
    let look: V2Product[] | undefined

    /** Section headings name what was actually looked for — the group's own
     *  label, or failing that the query the model ran. Never an invented
     *  phrase: "The Selection" and "Selection" were words nobody chose, sitting
     *  where the reference puts a real collection name, and a heading that says
     *  nothing is worse than no heading. Falls back to the shopper's own
     *  wording, which is at least true. */
    /** The name of what is on the page.
     *
     *  This fell back to the shopper's own sentence, so a page of sneakers was
     *  headed "Men i need some trousers and shoes maybe from comet" — their
     *  words read back to them, with the typo, as a title. A heading names the
     *  selection; it is not a receipt for the question.
     *
     *  So it is built from the garments actually shown: "Trousers & shoes",
     *  "Cashmere sweaters", "Shoes". The pieces on screen decide it, which also
     *  means it stays honest when the search finds one of the two things asked
     *  for — the old version promised trousers over a page of shoes. */
    const TITLE_STRIP = /\b(i|me|my|we|need|want|looking|look|for|some|any|please|maybe|can|you|give|show|find|get|the|a|an|of|from|with|to|and|men|mens|women|womens|guys|girls|under|below|around)\b/gi

    const titleFor = (products: V2Product[], label?: string): string => {
      // What is genuinely on the page, in the order the sections run.
      const kinds: string[] = []
      for (const pr of products.slice(0, 24)) {
        for (const k of Array.from(productSlotCategories({ title: pr.title, tags: [], description: pr.description }))) {
          const word = SLOT_WORDS[k]
          if (word && !kinds.includes(word)) kinds.push(word)
        }
      }

      // A group label from the backend is already a garment name — trust it,
      // just tidy the case.
      const fromLabel = (label || '').trim()
      if (fromLabel && fromLabel.split(/\s+/).length <= 3) {
        return fromLabel.charAt(0).toUpperCase() + fromLabel.slice(1).toLowerCase()
      }

      // A qualifier worth keeping — a fibre or a colour the shopper named —
      // makes "Cashmere sweaters" out of "sweaters".
      const q0 = (data?.searchQuery || q || '').toLowerCase()
      const qualifier = (q0.match(/\b(cashmere|merino|wool|linen|cotton|silk|leather|suede|denim|velvet|corduroy|tweed|black|white|navy|cream|beige|camel|olive|burgundy|grey|brown|tan)\b/) || [])[0]

      if (kinds.length === 0) {
        // Nothing recognisable — fall back to the query with the filler removed
        // rather than to the raw sentence.
        const bare = (data?.searchQuery || q || '').replace(TITLE_STRIP, ' ').replace(/[^a-z0-9\s'-]/gi, ' ')
          .replace(/\s+/g, ' ').trim()
        if (!bare) return ''
        return bare.charAt(0).toUpperCase() + bare.slice(1)
      }

      const named = kinds.length === 1 ? kinds[0]
        : kinds.length === 2 ? `${kinds[0]} & ${kinds[1]}`
        : `${kinds.slice(0, -1).join(', ')} & ${kinds[kinds.length - 1]}`
      const full = qualifier && kinds.length === 1 ? `${qualifier} ${named}` : named
      return full.charAt(0).toUpperCase() + full.slice(1)
    }


    // A multi-garment search comes back as labelled groups — one editorial
    // section per garment, which maps exactly onto this layout.
    if (Array.isArray(data?.foundProductGroups) && data.foundProductGroups.length > 0) {
      for (const g of data.foundProductGroups) {
        const products = (g?.products ?? []).map(toProduct).filter((p: V2Product) => p.image)
        if (!products.length) continue
        sections.push({ title: titleFor(products, g?.label), hero: products[0], products: products.slice(1), query: g?.query || data?.searchQuery || q })
      }
    }

    // A single search: one section.
    if (!sections.length && Array.isArray(data?.foundProducts) && data.foundProducts.length > 0) {
      const products = data.foundProducts.map(toProduct).filter((p: V2Product) => p.image)
      if (products.length) {
        sections.push({ title: titleFor(products), hero: products[0], products: products.slice(1), query: data?.searchQuery || q })
      }
    }

    // ── An outfit ────────────────────────────────────────────────────────────
    // The backend has always built these: "build me a look for a wedding"
    // emits [OUTFIT: q1 | q2 | q3], each slot is searched, and the pieces come
    // back in outfitSlots. They were mapped ONLY to the floating tray — which
    // renders on the results view — while sections stayed empty. An outfit
    // reply also carries no searchQuery, so the interface read the turn as
    // "nothing found, nothing searched", took the conversational exit, and the
    // shopper was left on the home screen with a sentence about a look they
    // could not see. The outfit builder was working the whole time; nothing
    // drew it.
    //
    // Each slot is its own section, the same shape a multi-garment search
    // produces, so the look reads down the page as Jacket / Shirt / Trousers /
    // Shoes. The tray stays as well: it is the one-of-each summary.
    const slotLabel = (s: any): string => {
      const raw = String(s?.slotCategory || s?.query || '').trim()
      if (!raw) return ''
      // "men navy wool blazer" → "Navy wool blazer". The gender is already
      // known; repeating it in four headings is noise.
      const cleaned = raw.replace(/^(men'?s?|women'?s?|unisex)\s+/i, '')
      return cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
    }
    if (Array.isArray(data?.outfitSlots) && data.outfitSlots.length > 0) {
      for (const s of data.outfitSlots) {
        const products = (s?.products ?? []).map(toProduct).filter((p: V2Product) => p.image)
        if (!products.length) continue
        sections.push({ title: slotLabel(s), hero: products[0], products: products.slice(1), query: s?.query })
      }
      look = data.outfitSlots.map((s: any) => toProduct(s?.products?.[0])).filter((p: V2Product) => p.image)
    } else if (Array.isArray(data?.outfitGroups) && data.outfitGroups.length > 0) {
      for (const g of data.outfitGroups) {
        const products = (g?.products ?? []).map(toProduct).filter((p: V2Product) => p.image)
        if (!products.length) continue
        sections.push({ title: titleFor(products, g?.label), hero: products[0], products: products.slice(1), query: g?.query || data?.searchQuery || q })
      }
      look = (data.outfitGroups[0]?.products ?? []).map(toProduct).filter((p: V2Product) => p.image)
    }

    // Rename everything in one call before the grid draws. Catalogue titles are
    // written for a search engine — four lines of keywords under a photograph,
    // or a bare style code that names no garment at all. Failure is silent and
    // the raw titles stand, which is where this started.
    // NOT awaited. This is a model call — measured at 0.9 to 1.6 seconds
    // against production, and on the run that prompted this it renamed
    // nothing at all — and it used to sit between the answer and the page. The
    // clothes were found, judged and ready, and the shopper watched a spinner
    // while a second model decided what to call them. A caption is worth
    // waiting nothing for: the grid draws with the catalogue's own titles and
    // the better ones drop in when they arrive.
    {
      const all = [...sections.flatMap(s => [s.hero, ...s.products]), ...(look ?? [])]
        .filter(Boolean) as V2Product[]
      if (all.length) {
        fetch('/api/product-names', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: all.map(p => ({ title: p.title })) }),
        })
          .then(res => (res.ok ? res.json() : null))
          .then(d => {
            const names = d?.names
            if (!names || typeof names !== 'object') return
            const clean: Record<string, string> = {}
            for (const [raw, better] of Object.entries(names)) {
              if (typeof better === 'string' && better.trim() && better !== raw) clean[raw] = better
            }
            if (Object.keys(clean).length) setRenames(prev => ({ ...prev, ...clean }))
          })
          .catch(() => { /* raw titles are a worse caption, not a broken one */ })
      }
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
      // An outfit is a search — four of them, in fact. It carries no
      // searchQuery (that field belongs to [SEARCH:], not [OUTFIT:]), so
      // keying off it alone told the interface no search had run and every
      // outfit turn took the conversational exit.
      didSearch: (typeof data?.searchQuery === 'string' && data.searchQuery.length > 0)
        || sections.length > 0,
      // A busy or degraded answer with nothing to show is a failure from the
      // shopper's side, whatever it is called on the wire — it belongs on the
      // page with a way to try again, not as a sentence in the composer.
      failed: data?.failed === true || ((data?.busy === true || data?.retryable === true) && sections.length === 0),
      light: data?.light === true,
      comparison: data?.comparison ?? undefined,
      busy: data?.busy === true,
    }
  }, [context])

  /** The next page of one strip.
   *
   *  The endpoint's load-more mode takes the query and everything already on
   *  screen, and returns only what it has not sent — so the page extends rather
   *  than repeating itself. It needs no model, which is why it keeps working
   *  when the stylist is degraded. */
  /** What to wear with the piece on screen.
   *
   *  Lives here rather than in the interface because the answer depends on who
   *  is asking — their gender, their country, their currency — and that
   *  context is held here. The endpoint does the real work: reads the piece's
   *  colour off its photograph, works out which slots are missing, searches
   *  every brand for them, and ranks by whether the result actually sits
   *  beside it. */
  const onStyleWith = useCallback(async (p: V2Product): Promise<V2Section[]> => {
    try {
      const res = await fetch('/api/style-with', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product: { id: p.id, title: p.title, image: p.image, description: p.description },
          gender: context.shopperGender,
          country: context.buyerCountry,
          currency: context.buyerCurrency,
        }),
      })
      if (!res.ok) return []
      const data = await res.json()
      const groups = Array.isArray(data?.groups) ? data.groups : []
      return groups.map((g: any) => {
        const products = (g?.products ?? []).map(toProduct).filter((x: V2Product) => x.image)
        return { title: String(g?.label ?? ''), hero: undefined, products, query: g?.query }
      }).filter((sec: V2Section) => sec.products.length > 0)
    } catch {
      return []
    }
  }, [context])

  const onLoadMore = useCallback(async (query: string, excludeIds: string[]): Promise<V2Product[]> => {
    try {
      const res = await fetch('/api/ai/stylist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'load-more', query, excludeIds, ...context }),
      })
      if (!res.ok) return []
      const text = await res.text()
      let data: any = null
      for (const line of text.split('\n')) {
        const t = line.trim()
        if (!t) continue
        try { const o = JSON.parse(t); if (o.type === 'result') data = o } catch { /* partial */ }
      }
      const more = Array.isArray(data?.foundProducts) ? data.foundProducts.map(toProduct) : []
      return more.filter((p: V2Product) => p.image && !excludeIds.includes(p.id))
    } catch {
      return []
    }
  }, [context])

  return (
    <DiscernV2
      onQuery={onQuery}
      onLoadMore={onLoadMore}
      onStyleWith={onStyleWith}
      onFeatured={onFeatured}
      onSearched={remember}
      onSavedChange={onSavedChange}
      heroCopy={heroCopy}
      buyerCountry={buyerCountry}
      buyerCurrency={buyerCurrency}
      renames={renames}
    />
  )
}
