/**
 * Shopify's own product taxonomy, as far as we have actually seen it.
 *
 * Every product UCP returns can carry a category from Shopify's standard
 * taxonomy — `gid://shopify/TaxonomyCategory/aa-8-8` and the like. We were
 * throwing the field away and deciding what a garment was by reading its
 * title, which is how a whole sneaker brand went missing: Comet's catalogue is
 * "X Lows CHESTNUT", "Aeon v2 ECLIPSE", "Alter" — no title, tag or description
 * anywhere contains the word sneaker or even shoe. Shopify had it labelled
 * `aa-8-8` the entire time.
 *
 * WHAT IS IN HERE. Only ids observed on live stores and checked against the
 * products carrying them. `aa-8-8` was confirmed on Comet's X Lows and Thursday
 * Boots' Premier Low Top; `aa-8` on Thursday Boots' Captain and Rodeo boots;
 * `aa-1-13` on Taylor Stitch's shirts and tees. A guessed map would be worse
 * than none — a wrong category is a confident lie, where a missing one just
 * falls back to reading the words.
 *
 * WHAT IT IS FOR. Corroboration, never contradiction. A product with no
 * category is judged exactly as it was before. A product WITH one can satisfy
 * a garment or slot it never names, which is the whole point.
 *
 * Many products come back `na` or with no category at all, so this is a bonus
 * signal on top of the text, not a replacement for it.
 */

import type { SlotCategory } from '../queryParser'

/** The bare id, e.g. 'aa-8-8', from whatever shape the field arrives in. */
export function taxonomyIds(categories?: unknown): string[] {
  if (!Array.isArray(categories)) return []
  const out: string[] = []
  for (const c of categories) {
    const raw = typeof c === 'string' ? c : (c as { value?: unknown })?.value
    if (typeof raw !== 'string') continue
    const id = raw.split('/').pop()?.trim().toLowerCase()
    // 'na' is Shopify for "not categorised" and carries no information.
    if (id && id !== 'na' && !id.startsWith('archived')) out.push(id)
  }
  return out
}

/** Exact ids that identify one specific garment. Deliberately short. */
const KEY_BY_ID: Record<string, string> = {
  'aa-8-8': 'sneaker',
}

/** Prefixes that identify a slot but not a garment — `aa-8` covers every shoe,
 *  which tells you it is footwear and nothing about whether it is a boot. */
const SLOT_BY_PREFIX: [string, SlotCategory][] = [
  ['aa-8', 'shoes'],
  ['aa-1-13', 'top'],
]

/** The garment this product's category names, if it names one at all. */
export function taxonomyGarmentKey(categories?: unknown): string | null {
  for (const id of taxonomyIds(categories)) {
    const key = KEY_BY_ID[id]
    if (key) return key
  }
  return null
}

/** The slot this product's category puts it in, if any. */
export function taxonomySlot(categories?: unknown): SlotCategory | null {
  const ids = taxonomyIds(categories)
  // Longest prefix first, so 'aa-8-8' is read as shoes via 'aa-8' rather than
  // matching some shorter, broader entry added later.
  const ordered = [...SLOT_BY_PREFIX].sort((a, b) => b[0].length - a[0].length)
  for (const id of ids) {
    for (const [prefix, slot] of ordered) {
      if (id === prefix || id.startsWith(prefix + '-')) return slot
    }
  }
  return null
}
