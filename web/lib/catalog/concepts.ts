/**
 * Does this product actually match what was asked for?
 *
 * Extracted from GlobalCatalogService — **moved, not rewritten**. Every
 * threshold and comment below is byte-identical to what it replaced.
 *
 * A search sends one query to ninety stores and each store answers with its
 * own idea of a match. This is where those answers are measured against the
 * request: a concept group is a set of words that mean the same thing
 * ("olive", "sage", "forest"), and a product hits a group if it contains any
 * of them. More groups hit, higher it ranks.
 *
 * `findGarmentGroupIndex` IS THE PART TO READ BEFORE CHANGING ANYTHING. It
 * finds the FIRST concept group that names a garment, and only that one counts
 * as "the garment" for the whole search. A query naming two categories at once
 * therefore has exactly one of them recognised, and the second category's
 * products carry no garment hit and are dropped once enough of the first
 * exist — the shopper sees shirts and no shorts, with nothing anywhere saying
 * so. That is not a bug in this function; it is the constraint that
 * `multiCategorySearch` in lib/stylist/retrieval.ts exists to work around, by
 * running one separately-ranked search per garment instead of one ambiguous
 * combined one. Changing the rule here without reading that one is how the
 * wrong-strip bug comes back.
 *
 * `minKeep` is the other load-bearing number: concept filtering keeps at least
 * this many products even when nothing matches well, because a page of
 * near-misses beats an empty page.
 *
 * Pure functions over a product and a request. `scripts/catalog-concepts.js`
 * pins them.
 */
import { GARMENT_PRODUCT_TERMS, matchesGarmentExclusion } from '../queryParser'
import type { UcpProduct } from '../services/GlobalCatalogService'

// ─── Concept relevance ─────────────────────────────────────────────────────────
// mandatoryConcepts are synonym groups extracted from the request:
//   [["shirt","shirts","tee"], ["linen"], ["black"]]
// The FIRST group is the garment — products missing it are off-category. The
// rest (color/material/origin) are ranking signals. Always graceful: if hard
// filtering would leave too few results, we fall back to scoring only.

export function productHaystack(p: UcpProduct): string {
  const opts = (p.options || []).map(o => `${o.name} ${o.values.join(' ')}`).join(' ')
  // Separators become spaces. Shopify tags are written `key_Value`
  // (`Filtercategory_Women`, `Bottomwear_Classic`, `Men > Shirts`), and `_` is
  // a WORD character to a JavaScript regex — so every word-boundary test in
  // here silently failed to read the single most structured field a store
  // gives us. The tags were being carried around and never actually read.
  return `${p.title} ${(p.tags || []).join(' ')} ${p.description || ''} ${opts}`
    .toLowerCase()
    .replace(/[_/|>]+/g, ' ')
}

/** What the product IS, without what it says to wear alongside it.
 *
 *  A pair of shorts whose description reads "versatile enough to pair with a
 *  range of FOOTWEAR and apparel" was counted as footwear, and turned up in a
 *  search for party shoes. Not a near miss — a garment from a different half
 *  of the body, admitted on the strength of a sentence about something else.
 *
 *  Every listing describes what to wear a thing WITH. A trouser names shirts,
 *  a shirt names trousers, a shoe names both. So the description is evidence of
 *  almost nothing when the question is "what garment is this", while being
 *  perfectly good evidence for colour, material and gender — which is why only
 *  the garment group reads this narrower text and the others still read it all.
 *
 *  Title, tags and the store's own product type. Three places a brand states
 *  what a thing is, none of which is a sentence about styling it. */
export function garmentHaystack(p: UcpProduct): string {
  return `${p.title} ${(p.tags || []).join(' ')} ${p.product_type || ''}`
    .toLowerCase()
    .replace(/[_/|>]+/g, ' ')
}

export function conceptHit(haystack: string, group: string[]): boolean {
  return group.some(term => {
    const t = term.toLowerCase().trim()
    if (!t) return false
    if (t.includes(' ') || t.includes('-')) return haystack.includes(t)
    const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // Short terms need BOTH boundaries — a bare prefix match lets "red" hit
    // "reduced" and "tee" hit "teen". Longer terms keep the open-ended suffix
    // so "shirt" still matches "shirts", "boot" matches "boots".
    if (t.length < 4) return new RegExp(`\\b${esc}s?\\b`, 'i').test(haystack)
    return new RegExp(`\\b${esc}`, 'i').test(haystack)
  })
}

// Which concept group is the GARMENT (category) group? Match against the known
// garment vocabulary instead of trusting position — LLM output sometimes leads
// with gender or material, and hard-filtering on those returns wrong products.
export function findGarmentGroupIndex(groups: string[][]): number {
  for (let i = 0; i < groups.length; i++) {
    if (groups[i].some(t => GARMENT_PRODUCT_TERMS.has(t.toLowerCase().trim()))) return i
  }
  return 0 // fall back to the historical assumption
}

/**
 * Precision ordering: products matching EVERY requested detail (garment AND
 * material AND color AND …) rank first, then right-category products missing
 * a detail. Off-category products are dropped entirely when enough
 * right-category results survive — the page stays FULL but exact matches
 * always lead. Always graceful: never empties the page over a filter.
 */
export function applyConceptRelevance(products: UcpProduct[], concepts: string[][], minKeep: number): UcpProduct[] {
  const groups = (concepts || []).filter(g => Array.isArray(g) && g.length > 0)
  if (groups.length === 0 || products.length === 0) return products

  const garmentIdx = findGarmentGroupIndex(groups)
  const scored = products.map((p, i) => {
    const hay = productHaystack(p)
    const garmentHay = garmentHaystack(p)
    let hits = 0
    let garmentHit = false
    let score = 0
    groups.forEach((g, gi) => {
      const isGarment = gi === garmentIdx
      // A general garment concept must not count a more-specific look-alike as
      // a match — "shirt" must reject "t-shirt"/"polo", "boot" reject "bootcut".
      // Only applied to the garment group (the exclusions are garment-specific).
      // The garment question is asked of the title, tags and product type
      // only — see garmentHaystack. Everything else still reads the full text.
      const text = isGarment ? garmentHay : hay
      if (isGarment && conceptHit(text, g) && matchesGarmentExclusion(text, g)) return
      if (conceptHit(text, g)) {
        hits++
        // Garment dominates; every extra matched detail (material, color,
        // gender) stacks on top — so a full exact match always outranks a
        // right-category-only match, which outranks everything else.
        score += isGarment ? 100 : 10
        if (isGarment) garmentHit = true
      }
    })
    return { p, i, score, hits, garmentHit }
  })

  // Drop off-category products when enough right-category ones survive.
  const onGarment = scored.filter(s => s.garmentHit)
  const pool = onGarment.length >= Math.min(minKeep, products.length) ? onGarment : scored

  // Most-details-matched first, then original (store relevance) order.
  return [...pool].sort((a, b) => b.score - a.score || b.hits - a.hits || a.i - b.i).map(s => s.p)
}
