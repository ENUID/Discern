import { NextRequest, NextResponse } from 'next/server'
import { GlobalCatalogService } from '@/lib/services/GlobalCatalogService'
import {
  buildMandatoryConcepts, productSlotCategories, productMatchesGarmentKey,
  GARMENT_VOCAB, type SlotCategory,
} from '@/lib/queryParser'
import { palettesFor, paletteCached, goesWith, colourNameFor } from '@/lib/fashion/palette'
import { pieceFormality, composeOutfit } from '@/lib/fashion/outfitKnowledge'
import { partnersFor, avoidSameAs, layerTone } from '@/lib/fashion/lookbook'
import { MATERIAL_VOCAB } from '@/lib/queryParser'
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
 * ONE PIECE PER SLOT. Not ten options a slot: open a shirt and you get the
 * trouser, the shoe and the layer — the best single answer for each, chosen
 * TOGETHER rather than three separate winners. A row of ten trousers is a
 * search result; one trouser that goes with the shirt in front of you is an
 * opinion, and the opinion is the product.
 */

export const maxDuration = 60
export const dynamic = 'force-dynamic'

const isRateLimited = makeIpRateLimiter(20, 60_000)

/** What completes what. Order is wear order, not importance. */
const COMPLEMENTS: Record<string, { key: string; label: string }[]> = {
  top:    [{ key: 'trouser', label: 'Trousers' }, { key: 'sneaker', label: 'Shoes' }, { key: 'jacket', label: 'Layer over it' }],
  bottom: [{ key: 'shirt', label: 'Shirt' }, { key: 'sneaker', label: 'Shoes' }, { key: 'jacket', label: 'Layer over it' }],
  outer:  [{ key: 'shirt', label: 'Under it' }, { key: 'trouser', label: 'Trousers' }, { key: 'sneaker', label: 'Shoes' }],
  shoes:  [{ key: 'trouser', label: 'Trousers' }, { key: 'shirt', label: 'Shirt' }, { key: 'jacket', label: 'Layer' }],
  dress:  [{ key: 'jacket', label: 'Layer over it' }, { key: 'sneaker', label: 'Shoes' }],
}

/** The slot the opened piece occupies, so we never offer it more of itself.
 *
 *  Reads the tags and the store's own product type, not only the title. A
 *  great many listings in this catalogue are called "RONALD" or "OLBIA" and
 *  say what they are nowhere except a tag reading "Men > Shirts" — those came
 *  back `unplaceable` and the shopper got no styling answer at all. */
function slotOf(p: {
  title?: string; description?: string; tags?: string[]
  categories?: string[]; productType?: string
}): SlotCategory | null {
  const cats = productSlotCategories({
    title: `${p.title ?? ''} ${p.productType ?? ''}`,
    tags: p.tags ?? [],
    description: p.description,
    categories: p.categories,
  })
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

  // The colour of the piece, as a WORD — from what the store wrote if it wrote
  // one, otherwise off the photograph. This is the fact the whole feature turns
  // on and it was previously measured and discarded.
  const subjectColour = colourNameFor(
    `${product.title ?? ''} ${product.colorName ?? ''}`, subject,
  )
  // What the lookbook puts below and on the feet of a piece this colour.
  const partner = partnersFor(subjectColour)
  const bottomTone = avoidSameAs(subjectColour, partner.bottom, partner.source)

  /** The colour word to search each slot for.
   *
   *  THIS is what was broken. The query used to be `${gender} ${garment}` and
   *  nothing else, so every top in the catalogue searched for "men trouser",
   *  hit the same cached pool and was offered the same trousers and the same
   *  jacket — an olive shirt, a grey shirt and a white floral shirt all came
   *  back with identical outfits. The piece never entered its own question.
   *  Now the colour it is answering for goes into the search itself. */
  const layer = layerTone(subjectColour, bottomTone)
  const toneFor = (key: string): string => {
    if (key === 'sneaker') return partner.shoes
    if (key === 'trouser' || key === 'jean') return bottomTone
    // Anything else here is the third garment — the layer over the top, or the
    // shirt under a jacket. It used to take the bottom's tone, which put the
    // same colour on screen twice and made every outfit read as one note.
    return layer
  }

  /** What the piece is made of, when it says. A cotton shirt asking the
   *  catalogue for "trousers" was being answered with polyester ones; a linen
   *  shirt wants linen or cotton beneath it, and a wool one does not want
   *  either. This is the difference between a matching colour and an outfit. */
  const subjectMaterial = (() => {
    const hay = ` ${`${product.title ?? ''} ${product.description ?? ''}`.toLowerCase()} `
    // Only the materials that carry a season or a register. Nylon and
    // polyester say nothing a shopper is choosing on.
    for (const key of ['linen', 'wool', 'cashmere', 'corduroy', 'silk', 'denim', 'leather', 'cotton']) {
      if ((MATERIAL_VOCAB[key] ?? []).some(t => new RegExp(`\\b${t}\\b`).test(hay))) return key
    }
    return null
  })()

  /** Which slots should echo the material. Shoes never do — a linen sneaker is
   *  not a thing, and asking for one empties the strip. */
  const materialFor = (key: string): string =>
    key === 'sneaker' || !subjectMaterial ? ''
      // Silk and cashmere name a register rather than a fabric you'd want head
      // to toe; the piece beneath them should be tailored, not the same cloth.
      : subjectMaterial === 'silk' || subjectMaterial === 'cashmere' ? 'wool'
      : subjectMaterial === 'leather' ? ''
      : subjectMaterial

  const wanted = COMPLEMENTS[mine].slice(0, 3)

  try {
    const groups = await Promise.all(wanted.map(async ({ key, label }) => {
      const term = GARMENT_VOCAB[key]?.query[0] || key
      const q = [g, toneFor(key), materialFor(key), term].filter(Boolean).join(' ').trim()
      // Gender travels as the leading segment of the taste line, which is the
      // only place the catalogue reads it from. Passing nothing here is how a
      // "SPORTY LEATHER SLIP ON BALLET SNEAKER" got offered to a man.
      const taste = g || undefined

      const ask = async (text: string) => GlobalCatalogService.search(
        text, undefined, [product.id].filter(Boolean), country, true,
        buildMandatoryConcepts(text), 'relevance', currency,
        { fastFirstPage: true }, [], taste, text, null,
      )

      // Colour and material are both real constraints and some combinations
      // genuinely are not stocked — "green linen sneakers" is nobody's shelf.
      // Rather than hand back an empty slot, drop one constraint at a time and
      // let the ranking below do the choosing. Each is a preference, not a
      // promise, and the first rung that returns anything wins.
      const rungs = [
        q,
        [g, toneFor(key), term].filter(Boolean).join(' ').trim(),
        [g, term].filter(Boolean).join(' ').trim(),
      ].filter((v, i, a) => a.indexOf(v) === i)

      let pure: any[] = []
      let query = q
      for (const rung of rungs) {
        let found: any[] = []
        try { found = await ask(rung) } catch { found = [] }
        pure = found.filter(p => productMatchesGarmentKey(p, key)).slice(0, 14)
        query = rung
        if (pure.length > 0) break
      }
      if (pure.length === 0) return { label, query, products: [] }

      // Read every candidate's colour, then rank by whether it belongs beside
      // the piece on screen rather than by how well it matched a word.
      const pals = await palettesFor(pure.map(p => p?.media?.[0]?.url || p?.image_url || ''))
      const want = toneFor(key)
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
        // Did it actually come back in the tone the lookbook asked for? The
        // store's word first, its photograph second — same rule as the subject.
        const theirName = colourNameFor(`${p.title ?? ''}`, pals[i])
        const onTone = theirName && want && theirName === want ? 1 : 0
        return { p, score: colour * 0.40 + onTone * 0.25 + formality * 0.22 + quiet * 0.13 }
      }).sort((a, b) => b.score - a.score)

      // The shortlist, kept for the composer below rather than shown.
      return { label, query, products: scored.slice(0, 4).map(s => s.p) }
    }))

    // Chosen TOGETHER. Each slot has offered its best few; this picks the
    // combination that reads as one outfit rather than three separately
    // excellent pieces, and promotes that combination's piece to the front of
    // its slot. Then only the front one is returned — one trouser, one shoe,
    // one layer, and they agree with each other.
    const alive = groups.filter(gr => gr.products.length > 0)
    const composed = composeOutfit(
      alive,
      (p: any) => `${p?.title ?? ''} ${(p?.tags ?? []).join(' ')}`,
    ) as typeof alive

    return NextResponse.json({
      groups: composed.map(gr => ({ ...gr, products: gr.products.slice(0, 1) })),
      subject: subject
        ? { colour: subjectColour, families: subject.families, plain: subject.plain }
        : { colour: subjectColour, families: [], plain: true },
      // What the lookbook asked for, so the answer can be argued with rather
      // than only looked at.
      chose: { bottom: bottomTone, shoes: partner.shoes, from: partner.source },
      slot: mine,
    })
  } catch (e) {
    console.error('[style-with] failed:', e)
    return NextResponse.json({ groups: [], reason: 'failed' }, { status: 200 })
  }
}
