/**
 * "Find me this EXACT one, not similar" — and did we?
 *
 * A shopper photographed a pair of denim clogs from a post, uploaded it, and
 * asked for that exact pair. The vision step read the photo as "men leather
 * sandals" — wrong material, wrong silhouette — the catalogue faithfully
 * returned eight leather sandals, and the reply said "let us pull up the exact
 * pair right here". Confidently, specifically wrong.
 *
 * There is no visual comparison in this codebase: nothing ever puts the
 * shopper's photograph next to a product photograph and asks whether they are
 * the same object. Until something does, the app CANNOT know it found the
 * exact piece — so it must stop saying that it did.
 *
 * This is the cheap half of the answer, and it needs no model and no extra
 * wait. Two questions, both answerable from text already in hand:
 *
 *   did the shopper ask for the EXACT piece, or for something like it?
 *   does anything we are about to show even match the garment we searched for?
 *
 * When they asked for the exact piece and nothing on the page is the right
 * KIND of thing, the honest sentence is that we could not find it — not a
 * silent page of near-misses under a promise.
 *
 * Deliberately NOT a claim of success in the other direction. Matching the
 * garment word is a floor, not proof; a denim clog and a leather clog are both
 * clogs. This function only ever says "definitely not", never "yes, this is
 * it", because only a look at the two photographs could say that.
 */
import { decomposeQuery, productMatchesGarmentKey } from '@/lib/queryParser'

/** Did they ask for THIS piece, or for something like it?
 *
 *  The distinction is the whole point: "find something like this" is answered
 *  well by close matches, and "find this exact one, not similar" is answered
 *  badly by the very same page. Only the second gets the honest note. */
export function wantsTheExactPiece(question: string): boolean {
  const q = (question || '').toLowerCase()
  if (!q) return false

  // Order matters, and getting it wrong inverts the answer on the very
  // sentence this exists for. The report was:
  //
  //   "find me this exact one, NOT SIMILAR, the exact same sandals"
  //
  // A plain scan for the word "similar" reads that as a request for similar
  // pieces — the exact opposite of what was typed, twice, emphatically. A
  // negated word is not the word. So the negations are read first, and each
  // one settles it outright.
  if (/\bnot\s+(?:the\s+)?exact/.test(q)) return false          // "not the exact one, something similar"
  if (/\b(?:not|no|never|nothing)\s+(?:something\s+|anything\s+)?similar\b/.test(q)) return true

  // Then the plain readings.
  if (/\b(similar|something like|like this|other brand|alternative|dupe|cheaper|instead)\b/.test(q)) return false
  return /\b(exact|exactly|same one|the same|identical|this very)\b/.test(q)
}

type Shown = { title?: string; tags?: string[]; description?: string }

/** True when the shopper asked for the exact piece and NOTHING on the page is
 *  even the right kind of garment. */
export function nothingIsTheRightGarment(searchQuery: string, shown: Shown[]): boolean {
  if (shown.length === 0) return false
  const keys = decomposeQuery(searchQuery || '').garmentKeys
  // The query named no garment at all, so there is nothing to check it
  // against. Silence is better than a guess.
  if (keys.length === 0) return false
  return !shown.some(p => keys.some(k => productMatchesGarmentKey(p, k)))
}

/** The sentence to add, or ''. Kept short and free of apology: it states what
 *  happened and what the page below actually is. */
export function exactMatchNote(
  question: string,
  searchQuery: string,
  shown: Shown[],
): string {
  if (!wantsTheExactPiece(question)) return ''
  if (shown.length === 0) {
    return "I could not find that exact piece in the brands I carry."
  }
  if (nothingIsTheRightGarment(searchQuery, shown)) {
    return "I could not find that exact piece — nothing I carry matches it, so what is below is the closest I have rather than the same thing."
  }
  // Right kind of garment, but sameness is not something this can verify.
  return "I cannot promise any of these is the exact piece — these are the closest I carry."
}
