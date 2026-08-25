/**
 * Asking ninety stores a question, and reading the answer.
 *
 * Extracted from the route in Phase E, step E5 — **moved, not rewritten**.
 * Every cap, every fallback rung, every filter and every comment below is
 * byte-identical to what it replaced.
 *
 * WHAT IS HERE is the orchestration: how one shopper sentence becomes several
 * searches, what each of them asks for, how the results are capped, deduped,
 * price-banded, composed into outfits and labelled.
 *
 * WHAT IS DELIBERATELY NOT HERE are the twelve inline
 * `GlobalCatalogService.search(...)` calls still sitting in the route. They
 * look repetitive and they are not: each carries a different budget, a
 * different concept set, a different fallback, and a comment naming the bug it
 * exists to prevent. Unifying them into one wrapper is a behaviour change
 * wearing the costume of a cleanup, and it is out of scope for a step whose
 * entire promise is that nothing changed. The one call site that DID move is
 * the one inside `multiCategorySearch`, because it moved with the function
 * that owns it.
 *
 * `sizeForQuery` IS STILL A CLOSURE. `multiCategorySearch` takes it as a
 * function, not a value, because each garment resolves its own size — the
 * shopper's top size must not nudge the bottoms strip. Turning that parameter
 * into a string would compile, pass every test, and quietly put one size on
 * every strip.
 */
import { GlobalCatalogService, type CatalogProgress } from '@/lib/services/GlobalCatalogService'
import { groqChat, FAST_MODEL } from '@/lib/groq'
import {
  buildMandatoryConcepts, classifyQuerySlot, decomposeQuery, dropGenericWhenSpecific,
  productMatchesGarmentKey, GARMENT_CATEGORY, GARMENT_VOCAB, type SlotCategory,
} from '@/lib/queryParser'
import { cleanSubQuery, garmentLabel, separatedGarmentKeys } from '@/lib/intent/routing'
import { composeOutfit, composeOutfits, composeOutfitsWithProfiles, outfitPlan } from '@/lib/fashion/outfitKnowledge'
import { outfitTones } from '@/lib/fashion/lookbook'
import { worksWith } from '@/lib/fashion/garmentProfile'
import { profilesFor } from '@/lib/services/enrichProduct'
import { brandDisplayName, UCP_REGISTRY } from '@/lib/stores'

// Best-of-best cap — applied to BOTH the first page of a fresh search AND
// each "See more" page. The reranker (relevanceRerank.ts) already judges a
// much wider candidate pool and orders it best-first; showing dozens of
// those at once (this used to be 52, 4 rows of 13) diluted "the best
// options" into "everything roughly relevant." "See more" re-runs the same
// reasoned search excluding what's already shown and returns the next
// best-of-best batch of this same size, not a bulk dump of the wider pool.
export const INITIAL_RESULT_CAP = 8

// Per-category cap when one request spans multiple distinct garment
// categories (see multiCategorySearch below) — each category strip gets the
// SAME best-of-best budget as a single-category search, not a shared total
// split across categories. "Shirts and shorts" therefore shows up to 8 tops
// AND up to 8 bottoms, not 4 and 4 — deriving from INITIAL_RESULT_CAP instead
// of a second hardcoded 8 keeps that intentional equality from silently
// drifting if one is retuned later.
export const MULTI_CATEGORY_PER_GROUP_CAP = INITIAL_RESULT_CAP

// Absolute last-line guard: no product id may appear twice in a single
// foundProducts payload, whatever upstream produced it (fresh search, brand
// fallback, or the persistent catalog-cache pool). Applied at every site that
// builds a foundProducts response, right before the INITIAL_RESULT_CAP slice.
export function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const p of items) {
    if (!p?.id || seen.has(p.id)) continue
    seen.add(p.id)
    out.push(p)
  }
  return out
}

// ── Multi-category search split ──────────────────────────────────────────────
// GlobalCatalogService's concept-relevance scoring only recognizes ONE
// "garment" group per search (the first concept group matched against known
// garment vocabulary — see findGarmentGroupIndex in GlobalCatalogService.ts).
// Feed it a query that decomposes to two categories at once ("shirts and
// shorts") and only the first-recognized category (shirts) counts as the
// garment; the second category's products never carry a garment hit, so
// they get filtered out entirely once enough first-category results exist.
// The shopper sees only shirts and no shorts, with no error or signal that
// anything was dropped. Fix: when a query names 2+ distinct garment
// categories, run one real, separately-ranked search per category instead of
// one ambiguous combined search.
export async function multiCategorySearch(
  fullQuery: string,
  budgetMax: number | null | undefined,
  countryCode: string | null,
  buyerCurrency: string,
  /** The shopper, in one line — see the tasteProfile builder in the handler. */
  tasteProfile: string | undefined,
  // Per-garment size, not one shared value — the shopper's TOP size must not
  // nudge the bottoms strip. Resolved per subQuery from its own garment slot.
  sizeForQuery: (q: string) => string | null,
  onProgress?: CatalogProgress,
  /** The shopper's stated gender, so an occasion resolves to the right slots. */
  shopperGender?: string | null,
): Promise<{ label: string; products: any[]; query: string }[] | null> {
  const decomp = decomposeQuery(fullQuery)
  // One strip PER DISTINCT GARMENT the shopper named — "shirts, trousers and
  // tshirts" is three strips (Shirts, Trousers, T-Shirts), not two merged by
  // broad slot. Compounds still collapse ("dress shirt" is one shirt), so the
  // strip count genuinely tracks the request. Fewer than two garments → single
  // search (the caller handles it).
  // Same rule as the catalogue route: the generic word for a slot loses to a
  // specific one in it, so "shoes and sneakers" is one strip rather than the
  // same rail shown twice under two headings.
  const named = dropGenericWhenSpecific(separatedGarmentKeys(fullQuery))
  // Naming a situation is naming an outfit. "What do I wear to an interview"
  // names no garment at all, so this used to fall through to one flat list of
  // whatever "interview" retrieves — which is the shape of the complaint that
  // every question comes back looking like a generic search. An occasion has a
  // known set of slots; retrieving them separately is the difference between
  // answering a quarter of the question and answering it.
  // Read the occasion whether or not garments were named. When they were, it
  // does not choose the slots — the shopper did — but it still knows what the
  // cloth should be, and that is the difference between a beach shirt and a
  // shirt. "Linen shirt and shorts for the beach" named two garments, so the
  // occasion was thrown away entirely and the strips came back as ordinary
  // shirts: correct garment, wrong summer.
  const occasion = outfitPlan(fullQuery, shopperGender)
  const plan = named.length >= 2 ? null : occasion
  const keys = named.length >= 2 ? named : (plan?.slots ?? [])
  if (keys.length < 2) return null

  // Each garment's subquery is the SHARED modifiers (gender, colour, material,
  // fit) + that garment's own term, built from parts rather than by stripping
  // the sentence — stripping "shirt" out of "t-shirt" is exactly the substring
  // collision that would corrupt a per-garment split.
  //
  // For an occasion the shared modifier is the season's fibre rather than
  // anything the shopper typed. "Autumn wedding" contains no retrievable noun;
  // "wool blazer" does, and that is what actually reaches the stores.
  const profileGender = (shopperGender || '').toLowerCase().startsWith('w') ? 'women'
    : (shopperGender || '').toLowerCase().startsWith('m') ? 'men'
    : undefined
  const sharedBits = (plan
    ? [decomp.gender ?? profileGender, plan.fabrics[0]]
    : [
        decomp.gender ?? profileGender, ...decomp.colors, ...decomp.materials, ...decomp.fits,
        // The occasion's own cloth, and only when the shopper named none of
        // their own — their word always wins over the table's.
        decomp.materials.length === 0 ? (occasion?.fabrics[0] ?? '') : '',
      ]
  ).filter(Boolean) as string[]
  const shared = sharedBits.join(' ')

  /** A colour for each slot, so the four searches describe ONE outfit.
   *
   *  This is where the sixteen reference looks were failing to land. They are
   *  encoded, counted and injected — into the JUDGE's prompt, which ranks. And
   *  ranking can only reorder what the stores already sent back. Every slot
   *  asked its ninety brands for a bare garment ("men wool blazer"), got
   *  whatever that brand's own search box returned, and the house eye then
   *  picked the least bad of them. Ask for nothing in particular and the best
   *  of what arrives is a coincidence.
   *
   *  So the colour story goes into the QUESTION. The occasion names a palette;
   *  its first tone leads, and the lookbook's own counted pairings decide the
   *  rest — a cream trouser under an olive top because look l02 does that, a
   *  layer that moves away from both so the outfit is not one note. Same
   *  machinery that took HOW TO STYLE from one repeated outfit to seven
   *  distinct ones; it simply was never wired to the path that answers "build
   *  me an outfit".
   *
   *  Only when the shopper named no colour of their own. Their word always
   *  wins over the table's. */
  const tones = plan && decomp.colors.length === 0
    ? outfitTones(plan.palette, plan.formality) : null
  const toneForSlot = (key: string): string => {
    if (!tones) return ''
    switch (GARMENT_CATEGORY[key]) {
      case 'top':    return tones.top
      case 'bottom': return tones.bottom
      case 'outer':  return tones.outer
      case 'shoes':  return tones.shoes
      default:       return ''
    }
  }

  const groups = await Promise.all(
    keys.map(async (key) => {
      const garmentTerm = GARMENT_VOCAB[key]?.query[0] || key
      // The occasion's cloth belongs on the clothes, not on the feet. `shared`
      // carries the season's fibre, and prepending it to every slot asked
      // ninety stores for a "linen loafer" and a "wool derby" — garments that
      // do not exist, so the strip came back on whatever the store guessed.
      const isFootwear = GARMENT_CATEGORY[key] === 'shoes'
      const base = isFootwear ? (decomp.gender ?? profileGender ?? '') : shared
      const subQuery = cleanSubQuery([base, toneForSlot(key), garmentTerm].filter(Boolean).join(' ')) || garmentTerm
      const cat = GARMENT_CATEGORY[key] as SlotCategory | undefined
      const label = garmentLabel(key)
      // A named colour is a real constraint and some are genuinely not stocked
      // — "green loafers" is a thin shelf. Rather than hand back an empty
      // strip, drop the colour and let the ranking choose. It is a preference
      // here, not a promise; the first rung that returns anything wins.
      const plain = cleanSubQuery([base, garmentTerm].filter(Boolean).join(' ')) || garmentTerm
      const rungs = [subQuery, plain].filter((v, i, a) => a.indexOf(v) === i)
      try {
        let chosen: any[] = []
        let used = subQuery
        for (const rung of rungs) {
          const found = await GlobalCatalogService.search(
            rung, budgetMax, [], countryCode, true, buildMandatoryConcepts(rung),
            'relevance', buyerCurrency,
            { fastFirstPage: true, onProgress: onProgress ? (e => onProgress({ ...e, label })) : undefined },
            [], tasteProfile, rung, sizeForQuery(rung),
          )
          // Filter by the SPECIFIC garment, not its broad slot — t-shirt and shirt
          // both live in the 'top' slot, so a slot-level filter let button-up
          // shirts flood the "T-Shirts" strip (the reported bug). Garment-key
          // matching keeps each strip pure to exactly what it's labelled.
          const filtered = found.filter(p => productMatchesGarmentKey(p, key))
          // Category purity: keep ONLY matching products, even if that leaves the
          // group empty (an empty group is dropped below). Falling back to the
          // unfiltered results was the exact bug that put a shirt into the wrong strip.
          chosen = dedupeById(filtered).slice(0, MULTI_CATEGORY_PER_GROUP_CAP)
          used = rung
          if (chosen.length > 0) break
        }
        // `used` is what this strip's "See more" re-runs on the frontend, so it
        // must be the query that actually produced these, not the one we hoped
        // would.
        return { label, products: chosen, query: used }
      } catch (e) {
        console.error('[stylist] multi-category search error:', e)
        return { label, products: [], query: subQuery }
      }
    })
  )
  // Cross-group dedupe: a product that matches two slots (a shacket reads as
  // both top and outer) must appear in only ONE strip, not be double-listed.
  // Walk groups in order, keeping each id in the first group that placed it.
  const seen = new Set<string>()
  const deduped = groups.map(g => {
    const products = g.products.filter(p => { if (seen.has(p.id)) return false; seen.add(p.id); return true })
    return { ...g, products }
  })
  const nonEmpty = deduped.filter(g => g.products.length > 0)

  // Chosen TOGETHER, not four times separately.
  //
  // Four slots ran four independent searches and each returned its own best
  // six, and that was called an outfit. It is not one: it is four search
  // results stacked, and whether the trouser at the top of strip two goes with
  // the shirt at the top of strip one was nobody's job. Asked to "build me an
  // outfit", the app was answering "here are four things".
  //
  // composeOutfit scores whole combinations — colour agreement, formality
  // within a step, the lookbook's own preference for one loud piece at most —
  // and promotes the winning combination to the front of each strip. So the
  // first piece in every strip belongs with the first piece in every other,
  // and the rest stay behind them as alternatives.
  //
  // This function already existed and was already imported here. It was
  // running in HOW TO STYLE and had never been called on the path that answers
  // the question it was written for.
  // One register, before anything is composed.
  //
  // An outfit came back with a ₹4,750 shirt and $630 loafers — the shoes cost
  // eleven times the shirt. Both were good answers to their own slot and
  // together they are not an outfit anybody buys. Nothing anywhere had ever
  // compared the price of one slot to another, partly because until this
  // commit they were not even in the same currency.
  //
  // Not a budget, and not a filter: the median of what the slots ALREADY
  // returned is the register this question is being answered in, and a piece
  // more than four times it — or less than a quarter — is out of the outfit
  // rather than out of the catalogue. It goes behind pieces that fit, and
  // stays available. And if a whole slot is out of band, the band is wrong,
  // not the slot: a lone shoe strip full of good expensive shoes should not
  // be emptied by a cheap shirt.
  const priceOf = (p: any) => (typeof p?.display_price === 'number' ? p.display_price
    : typeof p?.price === 'number' ? p.price : 0)
  const leads = nonEmpty.map(g => priceOf(g.products[0])).filter(n => n > 0).sort((a, b) => a - b)
  const median = leads.length ? leads[Math.floor(leads.length / 2)] : 0
  const inBand = (n: number) => n > 0 && n <= median * 4 && n >= median / 4
  const banded = median <= 0 ? nonEmpty : nonEmpty.map(g => {
    const fits = g.products.filter(p => inBand(priceOf(p)))
    // Every piece out of band means the median is not this slot's register.
    return fits.length === 0 ? g
      : { ...g, products: [...fits, ...g.products.filter(p => !inBand(priceOf(p)))] }
  })

  const composed = composeOutfit(
    banded,
    (p: any) => `${p?.title ?? ''} ${(p?.tags ?? []).join(' ')}`,
  ) as typeof nonEmpty

  // Return whatever categories actually produced results — even just one. The
  // caller's fallback re-searches the compiler's single lead garment, which may
  // be the EMPTY category ("shirts and boots" where only boots exist → fallback
  // searches shirts → nothing), throwing away results we already have. One real
  // strip beats discarding it.
  return composed.length >= 1 ? composed : null
}

/** The same strips, read as looks.
 *
 *  A multi-garment answer already comes back as one strip per garment, and the
 *  screen draws them as three shelves of eight. That is a shop. What a shopper
 *  asked for when they typed "outfits" is LOOK 1, LOOK 2, LOOK 3 — a shirt with
 *  the trousers and the shoes that go with THAT shirt, four times over, each a
 *  real alternative rather than the same outfit with a different shoe.
 *
 *  The strips are not thrown away: they still travel, and "see all shirts" is
 *  still a tap. This is what leads the page.
 *
 *  Only for a genuine outfit — two or more slots that between them clothe a
 *  person. "Shirts and trousers" qualifies; "black shirts and white shirts"
 *  does not, and composeOutfits declines it by returning nothing when the
 *  slots are not distinct parts of a body.
 */
export async function looksFrom(
  groups: { label: string; products: any[]; query: string }[],
): Promise<{ label: string; pieces: { label: string; product: any }[] }[]> {
  const bodyParts = groups.filter(g => {
    const cat = classifyQuerySlot(g.label || '')
    return cat === 'top' || cat === 'bottom' || cat === 'shoes' || cat === 'outer' || cat === 'dress'
  })
  if (bodyParts.length < 2) return []

  const slots = bodyParts.map(g => ({ label: g.label, products: g.products }))
  const textOf = (p: any) => `${p?.title ?? ''} ${(p?.tags ?? []).join(' ')}`

  // Read the pieces that are actually candidates for an outfit — the first six
  // of each slot, which is everything composition will consider. Roughly
  // eighteen garments, read once each and remembered, so the second search that
  // meets any of them pays nothing.
  const candidates = slots.flatMap(s => s.products.slice(0, 6))
  const profiles = await profilesFor(candidates)

  // Judged on what the garments ARE when we know, on their words when we do
  // not. The fallback is the old behaviour exactly, so a slow or missing vision
  // pass costs quality and never an answer.
  const looks = profiles.size >= 2
    ? composeOutfitsWithProfiles(
        slots, textOf,
        (p: any) => (profiles.get(p?.id) as never) ?? null,
        worksWith as never,
        { count: 4, perSlot: 6 },
      )
    : composeOutfits(slots, textOf, { count: 4, perSlot: 6 })

  console.log(`[stylist] ${looks.length} looks from ${candidates.length} candidates, ${profiles.size} understood`)
  return looks.map((l, i) => ({ label: `Look ${i + 1}`, pieces: l.pieces }))
}

// Reply line for a multi-category result — names every category shown ("tops,
// bottoms and shoes") so the prose matches the separate labeled strips below it,
// instead of the old single-garment template that said only "trousers" even
// when two strips were on screen.
export function multiCategoryReplyText(labels: string[]): string {
  const parts = labels.map(l => l.toLowerCase())
  const list = parts.length <= 1
    ? parts.join('')
    : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
  return `Here's a curated mix of ${list} from independent brands.`
}

// Resolve a registry domain to its display name for brand-fallback messaging.
export function brandNameOf(domain: string): string {
  const p = UCP_REGISTRY.find(s => s.domain.toLowerCase().trim() === domain.toLowerCase().trim())
  return p ? brandDisplayName(p) : domain
}

// Strip named-brand tokens so a fallback search spans the whole roster.
export function stripBrandNames(query: string, domains: string[]): string {
  let q = query
  for (const d of domains) {
    const name = brandNameOf(d)
    if (name && name.length >= 3) {
      const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      q = q
        .replace(new RegExp(`\\b(?:from|at|by|in)\\s+${esc}\\b`, 'gi'), ' ')
        .replace(new RegExp(`\\b${esc}\\b`, 'gi'), ' ')
    }
  }
  return q.replace(/\s+/g, ' ').trim()
}

// ── Agentic refine step ──────────────────────────────────────────────────────
// The one genuinely multi-step piece of this pipeline: when a search comes
// back empty and it isn't a named-brand miss (that has its own honest
// handling), this looks at what was actually tried and asks a small, fast
// model to relax exactly ONE constraint — not a second full stylist turn,
// just a narrow, bounded "what would get this shopper real results" decision.
// Called at most once per request; a failure or a no-op answer here just
// means the original (possibly empty) results stand — it never blocks or
// degrades the reply.
export async function refineSearchQuery(originalQuery: string, shopperQuestion: string): Promise<string | null> {
  try {
    const system = `You broaden a product-search query that returned zero results, by relaxing exactly ONE constraint. Keep the core garment type intact. Drop or generalize the single modifier least essential to the shopper's actual goal — an overly specific color, an exact material claim, an occasion word, a fit descriptor. Respond with ONLY the revised search query: no punctuation, no quotes, no explanation, nothing else.`
    const userMsg = `Shopper asked: "${shopperQuestion}"\nSearch tried: "${originalQuery}"\nResult count: 0\nRevised query:`
    const res = await groqChat([{ role: 'user', content: userMsg }], system, undefined, { model: FAST_MODEL, max_tokens: 40, temperature: 0.2 })
    const revised = String(res?.content || '').trim().replace(/^["'\[\]]+|["'\[\].]+$/g, '')
    if (!revised || revised.length < 3 || revised.length > 150) return null
    if (revised.toLowerCase() === originalQuery.trim().toLowerCase()) return null
    return revised
  } catch (e) {
    console.error('[stylist] refine-query failed:', e)
    return null
  }
}
