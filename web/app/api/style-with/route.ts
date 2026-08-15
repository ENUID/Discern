import { NextRequest, NextResponse } from 'next/server'
import { GlobalCatalogService } from '@/lib/services/GlobalCatalogService'
import {
  buildMandatoryConcepts, productSlotCategories, productMatchesGarmentKey,
  GARMENT_VOCAB, type SlotCategory,
} from '@/lib/queryParser'
import { palettesFor, paletteCached, goesWith } from '@/lib/fashion/palette'
import { pieceFormality } from '@/lib/fashion/outfitKnowledge'
import { makeIpRateLimiter } from '@/lib/rateLimit'

/**
 * What to wear with this, chosen for THIS piece.
 *
 * HOW TO STYLE used to take whatever happened to be in the current search
 * results and pick the first thing it found in each empty slot. Open a brown
 * linen shirt after searching "shirts" and you were offered whatever trousers
 * the shirt search had incidentally returned — which is to say, none, or
 * something at random. It answered "what else is on this page", not "what goes
 * with this".
 *
 * This asks the actual question. It reads the piece's own colour off its
 * photograph — because two thirds of this catalogue never state one in words —
 * works out which slots are missing, searches every brand for them, and ranks
 * what comes back by whether it genuinely sits beside the piece the shopper is
 * looking at: colour families that agree, formality within a step, and the
 * quiet over the loud.
 *
 * It is NOT an outfit builder. It returns each slot as its own row of options,
 * the same shape the results page uses, because the shopper picks — this only
 * has to make every option on the row a defensible one.
 */

export const maxDuration = 60
export const dynamic = 'force-dynamic'

const isRateLimited = makeIpRateLimiter(20, 60_000)

/** What completes what. Order is wear order, not importance. */
const COMPLEMENTS: Record<string, { slot: SlotCategory; key: string; label: string }[]> = {
  top:    [
    { slot: 'bottom', key: 'trouser', label: 'Trousers' },
    { slot: 'bottom', key: 'jean',    label: 'Jeans' },
    { slot: 'shoes',  key: 'sneaker', label: 'Shoes' },
    { slot: 'outer',  key: 'jacket',  label: 'Layer over it' },
  ],
  bottom: [
    { slot: 'top',    key: 'shirt',   label: 'Shirts' },
    { slot: 'top',    key: 'tshirt',  label: 'T-shirts' },
    { slot: 'shoes',  key: 'sneaker', label: 'Shoes' },
    { slot: 'outer',  key: 'jacket',  label: 'Layer over it' },
  ],
  outer:  [
    { slot: 'top',    key: 'shirt',   label: 'Under it' },
    { slot: 'bottom', key: 'trouser', label: 'Trousers' },
    { slot: 'shoes',  key: 'sneaker', label: 'Shoes' },
  ],
  shoes:  [
    { slot: 'bottom', key: 'trouser', label: 'Trousers' },
    { slot: 'top',    key: 'shirt',   label: 'Shirts' },
    { slot: 'outer',  key: 'jacket',  label: 'Layer' },
  ],
  dress:  [
    { slot: 'outer',  key: 'jacket',  label: 'Layer over it' },
    { slot: 'shoes',  key: 'sneaker', label: 'Shoes' },
  ],
}

/** The slot the opened piece occupies, so we never offer it more of itself. */
function slotOf(p: { title?: string; description?: string; tags?: string[] }): SlotCategory | null {
  const cats = productSlotCategories({ title: p.title, tags: p.tags ?? [], description: p.description })
  for (const s of ['top', 'bottom', 'outer', 'shoes', 'dress'] as SlotCategory[]) {
    if (cats.has(s)) return s
  }
  return null
}

export async function POST(req: NextRequest) {
  if (isRateLimited(req)) return NextResponse.json({ groups: [], reason: 'rate-limited' }, { status: 429 })

  let body: any = {}
  try { body = await req.json() } catch { /* defaults */ }

  const product = body?.product
  if (!product?.title) return NextResponse.json({ groups: [], reason: 'no-product' })

  const country: string | null = typeof body?.country === 'string' ? body.country.toUpperCase() : null
  const currency: string = typeof body?.currency === 'string' ? body.currency.toUpperCase() : 'USD'
  const g = /^w/i.test(String(body?.gender || '')) ? 'women' : /^m/i.test(String(body?.gender || '')) ? 'men' : ''

  const mine = slotOf(product)
  // An accessory, or something we cannot place. Offering "trousers to go with
  // your trousers" is worse than offering nothing, so nothing is offered.
  if (!mine || !COMPLEMENTS[mine]) return NextResponse.json({ groups: [], reason: 'unplaceable' })

  // What the shopper is looking at, as colour. Everything below is measured
  // against this.
  const subject = await paletteCached(product.image || product.image_url || '')
  const subjectFormality = pieceFormality(`${product.title} ${product.description ?? ''}`)

  const wanted = COMPLEMENTS[mine].slice(0, 4)

  try {
    const groups = await Promise.all(wanted.map(async ({ key, label }) => {
      const term = GARMENT_VOCAB[key]?.query[0] || key
      const q = `${g} ${term}`.trim()
      let found: any[] = []
      try {
        found = await GlobalCatalogService.search(
          q, undefined, [product.id].filter(Boolean), country, true,
          buildMandatoryConcepts(q), 'relevance', currency,
          { fastFirstPage: true }, [], undefined, q, null,
        )
      } catch { return { label, query: q, products: [] } }

      const pure = found.filter(p => productMatchesGarmentKey(p, key)).slice(0, 14)
      if (pure.length === 0) return { label, query: q, products: [] }

      // Read every candidate's colour, then rank by whether it belongs beside
      // the piece on screen rather than by how well it matched a word.
      const pals = await palettesFor(pure.map(p => p?.media?.[0]?.url || p?.image_url || ''))
      const scored = pure.map((p, i) => {
        const colour = goesWith(subject, pals[i])
        const theirs = pieceFormality(`${p.title ?? ''} ${p.description ?? ''}`)
        // Within one step is the lookbook's own spread — a knit polo with
        // tailored trousers, a cardigan with jeans. Two steps still works,
        // three is a blazer over gym shorts.
        const gap = subjectFormality && theirs ? Math.abs(subjectFormality - theirs) : 1
        const formality = gap <= 1 ? 1 : gap === 2 ? 0.6 : 0.25
        // The house eye, once more: a plain piece is the better companion
        // unless the shopper went looking for a loud one.
        const quiet = pals[i]?.plain ? 1 : 0.75
        return { p, score: colour * 0.55 + formality * 0.3 + quiet * 0.15 }
      }).sort((a, b) => b.score - a.score)

      return { label, query: q, products: scored.slice(0, 10).map(s => s.p) }
    }))

    return NextResponse.json({
      groups: groups.filter(gr => gr.products.length > 0),
      subject: subject ? { families: subject.families, plain: subject.plain } : null,
      slot: mine,
    })
  } catch (e) {
    console.error('[style-with] failed:', e)
    return NextResponse.json({ groups: [], reason: 'failed' }, { status: 200 })
  }
}
