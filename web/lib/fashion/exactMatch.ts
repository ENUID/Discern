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

/** Sentences in which the model announces it has found the piece.
 *
 *  It writes the reply BEFORE the search runs — the route says so in its own
 *  comments — so any such sentence is a guess dressed as a result. Asked for a
 *  photographed denim clog, it opened with:
 *
 *    "Here it is: Monkstory Atelier 1920 Triple Strap Slide Sandals, Midnight
 *     Black. This is the exact style you're looking for … just as you
 *     described."
 *
 *  A black triple-strap slide, described as the blue denim clog the shopper
 *  photographed, in confident detail. Telling the prompt not to do this was
 *  not enough — the same lesson stripAiDashes and stripSafetyLabels are here
 *  for — so the claim is removed rather than argued with. Appending an honest
 *  note under a sentence like that only produces a reply that contradicts
 *  itself in consecutive breaths. */
const CLAIM = new RegExp([
  'here it is', 'here you go', 'found it', 'this is it', 'that\'?s the one',
  'exactly what you', 'exactly the (?:one|piece|pair)', 'just as you described',
  'just like (?:the|your) (?:one|photo|picture|image)',
  'same (?:one|piece|pair) as', 'matches your photo',
  // Production again, with a verdict of NO sitting right behind it:
  // "They're the same style you saw". Style, model, product — the noun
  // changes and the assertion does not.
  '\\bthe same (?:style|model|product|item|thing|design)\\b',
  '\\b(?:the one|the pair|the piece) (?:you|in your)\\b',
  'i found', 'we found', 'pulled up the exact', 'pull(?:ing)? up (?:the|that) exact',
  // A subject, a copula, and the claim. The first pass listed the exact
  // wordings it had seen — "this is the exact" — and production immediately
  // produced one it had not: "This PAIR IS the exact sandals you're looking
  // for." Any of these subjects in front of any of these nouns is the same
  // assertion however it is phrased, so match the shape rather than the
  // sentence.
  '\\b(?:this|that|these|those|it)\\b[^.!?]{0,40}?\\b(?:is|are)\\b[^.!?]{0,20}?\\bthe exact\\b',
  '\\bthe exact (?:one|piece|pair|style|match|sandals?|shoes?|item|product)\\b',
  '\\b(?:this|that|these|those)\\b[^.!?]{0,40}?\\bis (?:the|your) (?:one|piece|pair)\\b',
].join('|'), 'i')

/** The reply with those sentences taken out. Never returns nothing: if every
 *  sentence was a claim, the caller's honest note becomes the whole reply. */
export function stripUnverifiableClaims(reply: string): string {
  if (!reply) return ''
  // Split on sentence ends, keeping the punctuation with its sentence.
  const sentences = reply.match(/[^.!?]+[.!?]*/g) ?? [reply]
  const kept = sentences.filter(s => !CLAIM.test(s))

  // A reply cut off mid-sentence, with a note welded to the stump.
  //
  // The model ran out of completion tokens at "…light and breathable, perfect
  // for" and the honest note was appended straight onto it, so the shopper
  // read "perfect for I cannot promise any of these is the exact piece". An
  // unterminated last sentence is a truncation, not a thought, and anything
  // joined to it reads as gibberish.
  //
  // Dropped outright, including when it is the ONLY sentence left. Putting a
  // full stop on the end of it instead just yields "…light and breathable,
  // perfect for." — a fragment wearing punctuation, which is not better than
  // no sentence at all. If nothing survives, the honest note becomes the whole
  // reply, and that reply is complete.
  while (kept.length > 0 && !/[.!?]["')\]]*\s*$/.test(kept[kept.length - 1])) {
    kept.pop()
  }

  const out = kept.join('').replace(/\s+/g, ' ').trim()
  // A leftover fragment that only made sense after the claim it followed
  // ("It's 1490 INR.") is worse than nothing.
  return out.length >= 25 ? out : ''
}

/** What a look at both pictures concluded, when one happened.
 *  Mirrors lib/services/sameGarment.ts without importing it — this module is
 *  pure text and must stay callable with no vision anywhere in reach. */
export type Verdict = { sameIndex: number | null; confidence: number; why?: string } | null

/** The sentence to add, or ''. Kept short and free of apology: it states what
 *  happened and what the page below actually is.
 *
 *  There are three states here and they are genuinely different, which is the
 *  whole reason the comparison was worth building:
 *
 *    a look happened and found it        say so — it is the answer
 *    a look happened and found nothing   say NO, plainly. This is the answer
 *                                        too, and the one no amount of word
 *                                        matching could ever have given
 *    no look happened                    withhold the claim, as before
 */
export function exactMatchNote(
  question: string,
  searchQuery: string,
  shown: Shown[],
  verdict?: Verdict,
): string {
  if (!wantsTheExactPiece(question)) return ''

  // Something actually compared the photographs.
  if (verdict) {
    if (verdict.sameIndex != null) {
      return "I compared these against your photo — the first one is the same piece."
    }
    return shown.length === 0
      ? "I could not find that exact piece in the brands I carry."
      : "I compared every one of these against your photo and none of them is that piece. These are the closest I carry."
  }

  if (shown.length === 0) {
    return "I could not find that exact piece in the brands I carry."
  }
  if (nothingIsTheRightGarment(searchQuery, shown)) {
    return "I could not find that exact piece — nothing I carry matches it, so what is below is the closest I have rather than the same thing."
  }
  // Right kind of garment, but sameness is not something text can verify.
  return "I cannot promise any of these is the exact piece — these are the closest I carry."
}
