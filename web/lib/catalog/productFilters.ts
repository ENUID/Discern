/**
 * What a product IS, judged one product at a time.
 *
 * Four questions the catalogue asks of every candidate, extracted from
 * GlobalCatalogService — **moved, not rewritten**. Every regex, every
 * threshold and every comment below is byte-identical to what it replaced.
 *
 *   IS IT CLOTHING AT ALL       a candle is not a near-miss shirt
 *   WHO IS IT FOR               stated gender is a fact, not a preference
 *   WHAT COLOUR IS IT           and does that agree with what was asked for
 *   DOES IT COME IN THEIR SIZE  a soft signal, never a filter
 *
 * The first two REMOVE products and the last two REORDER them, and that
 * distinction is the whole design. A shopper who asks for a green shirt and is
 * shown a blue one has been given a worse answer; a shopper who asks for a
 * green shirt and is shown nothing has been given no answer. So colour and size
 * sort, and only "this is not clothing" and "this is explicitly for someone
 * else" delete.
 *
 * These are pure functions over a product and a request. They hold no state,
 * make no network calls, and know nothing about which shopper is asking —
 * which is what makes them safe to move and worth testing directly.
 * `scripts/catalog-filters.js` pins them.
 */
import { COLOR_VOCAB } from '../queryParser'
import type { UcpProduct } from '../services/GlobalCatalogService'

// ─── Non-fashion filter ────────────────────────────────────────────────────────

export const NON_FASHION_TITLE_RE = /\b(?:book|books|magazine|magazines|zine|zines|paperback|hardcover|novel|novels|stationery|notepad|notepads|notebook|notebooks|candle|candles|diffuser|diffusers|incense|art\s+print|art\s+prints|wall\s+art|poster|posters|gift\s+card|gift\s+wrap)\b/i
export const NON_FASHION_TAGS = new Set([
  'book', 'books', 'magazine', 'magazines', 'zine', 'novel', 'publication',
  'art-print', 'art print', 'wall-art', 'wall art', 'poster',
  'candle', 'candles', 'diffuser', 'home-fragrance', 'home fragrance', 'incense',
  'notebook', 'notebooks', 'stationery', 'notepad',
  'gift-card', 'gift card', 'gift_card',
])

export function isNonFashion(p: UcpProduct): boolean {
  if (NON_FASHION_TITLE_RE.test(p.title)) return true
  return (p.tags || []).some(t => NON_FASHION_TAGS.has(t.toLowerCase()))
}

// ─── Gender hard filter ─────────────────────────────────────────────────────
// mandatoryConcepts' color/material groups are soft ranking signals — a
// product missing "black" just ranks lower. Gender is different: a shopper
// searching menswear should never be shown a bona fide women's item, full
// stop. This hard-drops any product whose OWN gender signal clearly
// conflicts with what was requested; unisex/ungendered products (most of
// the catalog doesn't explicitly self-tag gender at all) are never rejected.
export const WOMEN_GENDER_RE = /\b(women'?s?|womens|ladies?|female)\b/i
export const MEN_GENDER_RE = /\b(men'?s?|mens|male|gentlemen)\b/i

/** Garments whose NAME is the gender.
 *
 *  From a screen recording, frame by frame: "Livvy Floral Shirt & Olive Tunic
 *  Set" — a woman in an olive midi holding sunflowers — sitting between a
 *  black cotton shirt and a rust linen one in a men's strip.
 *
 *  Every filter was working and none could see it. The title says shirt, so
 *  the garment matcher was right to keep it. Title, tags and the opening of
 *  the description say nothing about women, so the text filter had nothing to
 *  read. And it reached the page.
 *
 *  Some garments need no department label because the word IS one. A saree is
 *  not menswear. Neither is a kurti, a lehenga, an anarkali, a bralette, a
 *  peplum top — or a tunic, which in this catalogue is womenswear every time.
 *
 *  Deliberately short and deliberately unambiguous. "Kaftan" and "robe" were
 *  candidates and are NOT here: they are genuinely worn by everyone, and a
 *  wrong entry deletes real menswear from a real search. When in doubt it
 *  stays out — the photograph pass catches what this cannot. */
export const WOMENS_GARMENTS = /\b(saree|sari|lehenga|choli|anarkali|kurti|salwar|churidar|dupatta|ghagra|tunic|bralette|camisole|peplum|bodycon|maxi dress|midi dress|skater dress|wrap dress)\b/i

/** The places a store states who a garment is for, in one string a word-
 *  boundary regex can actually read.
 *
 *  The underscore is why this function exists. Shopify's own tag convention is
 *  `key_Value` — `Filtercategory_Women`, `category_women`, `collection_Mens
 *  Shirt` — and in a JavaScript regex `_` is a WORD character, so `\bwomen`
 *  never matches `Filtercategory_Women`. Every one of those tags says the
 *  gender in plain English and the filter was blind to all of them: a shirt
 *  tagged `Filtercategory_Women` led a beach-party search, and a strip of
 *  women's co-ord shorts sets sat above the menswear. Separators become
 *  spaces, so the words stand on their own.
 *
 *  The description is read only at its OPENING, deliberately. Further down, a
 *  description will say things like "also available in women's", and treating
 *  that as the garment's own gender would drop menswear for mentioning that a
 *  women's version exists. */
export function genderHaystack(p: UcpProduct): string {
  const intro = String(p.description || '').slice(0, 220)
  return `${p.title} ${(p.tags || []).join(' ')} ${p.product_type || ''} ${intro}`
    .toLowerCase()
    .replace(/[_/|>]+/g, ' ')
}

export function productGenderSignal(p: UcpProduct): 'men' | 'women' | null {
  // Checked against the TITLE only, on purpose: a men's shirt whose
  // description says "wear it over a kurti" is a men's shirt, and reading the
  // whole haystack would throw it out for a sentence about somebody else's
  // wardrobe.
  if (WOMENS_GARMENTS.test(String(p.title || ''))) return 'women'
  const hay = genderHaystack(p)
  const isWomen = WOMEN_GENDER_RE.test(hay)
  const isMen = MEN_GENDER_RE.test(hay)
  if (isWomen && !isMen) return 'women'
  if (isMen && !isWomen) return 'men'
  return null
}

// ─── Colour: a stated fact, not a preference ────────────────────────────────
// "White shirts" came back with green ones in the page. Colour was a +10
// ranking nudge inside applyConceptRelevance, which only ever SORTS — nothing
// was ever dropped for being the wrong colour, so the page filled to its
// minimum with whatever else the stores returned. Sorted correctly, and wrong.
//
// A shopper who says white has not expressed a preference; they have stated a
// requirement, the same way a size is. So a product whose own colour is legibly
// something else is removed. "Cannot tell" is not "wrong" — a piece that names
// no colour anywhere survives, because most independent stores are inconsistent
// about it and dropping the silent ones would empty the page.

/** Every colour family this product legibly claims, from its title, its tags
 *  and its Color option — the three places a store actually writes one. */
export function familiesIn(text: string): Set<string> {
  const hay = text.toLowerCase()
  const found = new Set<string>()
  for (const [family, synonyms] of Object.entries(COLOR_VOCAB)) {
    if (synonyms.some(t => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(hay))) {
      found.add(family)
    }
  }
  return found
}

export function productColorFamilies(p: UcpProduct): Set<string> {
  // The title first, and alone when it says anything. A store's tag list
  // routinely carries every colourway a style comes in, so a piece called
  // "Green Tropical Shirt Set" and tagged white passed a tag-based check while
  // being, in its name and its photograph, green. What a piece is called is
  // what the shopper sees.
  const fromTitle = familiesIn(p.title || '')
  if (fromTitle.size > 0) return fromTitle

  return familiesIn([
    (p.tags || []).join(' '),
    (p.options || []).filter(o => /colou?r/i.test(o.name || '')).flatMap(o => o.values || []).join(' '),
  ].join(' '))
}

/** Families that overlap enough that one is not "wrong" for the other — the
 *  vocabulary deliberately shares synonyms (ivory is both white and cream,
 *  navy is both navy and blue), so a strict family match would reject pieces a
 *  person would call correct. */
export function colorFamiliesAgree(a: string, b: string): boolean {
  if (a === b) return true
  const sa = new Set(COLOR_VOCAB[a] ?? []), sb = COLOR_VOCAB[b] ?? []
  return sb.some(t => sa.has(t))
}

/** The colour families the shopper actually named.
 *
 *  Matched by overlap, not by array identity. Two code paths build these
 *  groups — buildMandatoryConcepts and the intent compiler — and they do not
 *  produce byte-identical arrays, so an exact comparison silently matched
 *  nothing on the compiled path. Which is the worst kind of bug: the filter
 *  existed, was correct, and never ran.
 */
export function requestedColorsFromConcepts(groups: string[][]): string[] {
  const out: string[] = []
  for (const g of groups) {
    if (!g.length) continue
    const tokens = g.map(t => String(t).toLowerCase().trim())
    let best: string | null = null
    let bestHits = 0
    for (const [family, synonyms] of Object.entries(COLOR_VOCAB)) {
      const set = new Set(synonyms)
      const hits = tokens.filter(t => set.has(t)).length
      if (hits > bestHits) { bestHits = hits; best = family }
    }
    // Most of the group has to be this family's vocabulary, or a garment list
    // that happens to contain one colour word would read as a colour request.
    if (best && bestHits >= Math.max(2, Math.ceil(tokens.length * 0.6)) && !out.includes(best)) {
      out.push(best)
    }
  }
  return out
}

// Which concept group (if any) names the requested gender? Only the
// dedicated gender group ever contains these terms — garment/material/color
// vocabularies don't — so this reads the shopper's actual request, not a
// guess.
export function requestedGenderFromConcepts(groups: string[][]): 'men' | 'women' | null {
  for (const g of groups) {
    const joined = g.join(' ')
    if (WOMEN_GENDER_RE.test(joined)) return 'women'
    if (MEN_GENDER_RE.test(joined)) return 'men'
  }
  return null
}

// ─── Size soft signal ───────────────────────────────────────────────────────
// A confirmed size match nudges a product up; a confirmed unavailable variant
// nudges it down — but this is NEVER a hard filter, unlike gender. Size label
// formats vary too much across independent stores (S/M/L vs numeric vs UK/EU)
// to safely exclude on a literal-text miss: a label that doesn't match almost
// always means "this store labels sizes differently" or "doesn't expose
// sizes at all," not "wrong size." Only a genuine, legible mismatch — the
// product lists the shopper's exact size as an option, and that specific
// variant is out of stock — demotes it. Everything else (can't tell) is left
// exactly where relevance already ranked it.
export const SIZE_ALIASES: Record<string, string> = {
  xs: 'xs', extrasmall: 'xs',
  s: 's', small: 's',
  m: 'm', medium: 'm',
  l: 'l', large: 'l',
  xl: 'xl', extralarge: 'xl',
  xxl: 'xxl', '2xl': 'xxl', xxlarge: 'xxl',
  xxxl: 'xxxl', '3xl': 'xxxl',
}

export function normalizeSizeLabel(raw: string): string {
  let cleaned = raw.toLowerCase().replace(/\b(us|uk|eu|eur|women'?s|men'?s)\b/g, '').replace(/[^a-z0-9]/g, '').trim()
  // Denim/trouser waist sizes are commonly labeled "W32" or "32W" — a
  // shopper stating a bare "32" should still match either form.
  cleaned = cleaned.replace(/^w(?=\d)/, '').replace(/w$/, '')
  return SIZE_ALIASES[cleaned] ?? cleaned
}

export function productSizeSignal(p: UcpProduct, wantedSize: string): 'match' | 'mismatch' | 'unknown' {
  const wanted = normalizeSizeLabel(wantedSize)
  if (!wanted) return 'unknown'

  const sizeOptionValues = (p.options || []).filter(o => /size/i.test(o.name)).flatMap(o => o.values)
  if (sizeOptionValues.length === 0) return 'unknown' // product doesn't expose sizes at all — can't tell

  const hasWanted = sizeOptionValues.some(v => normalizeSizeLabel(v) === wanted)
  if (!hasWanted) return 'unknown' // this store just labels sizes differently — never guess mismatch from that alone

  if (p.variants && p.variants.length > 0) {
    const variant = p.variants.find(v => v.options.some(o => /size/i.test(o.name) && normalizeSizeLabel(o.label) === wanted))
    if (variant) return variant.availability ? 'match' : 'mismatch'
  }
  return 'match' // the size is listed and we have no variant-level stock data to contradict it
}

// Reorders (never filters) by size signal: confirmed match first, confirmed
// out-of-stock-in-that-size last, everything indeterminate stays exactly
// where relevance already put it.
export function applySizePreference(products: UcpProduct[], wantedSize: string | null | undefined): UcpProduct[] {
  if (!wantedSize) return products
  const scored = products.map((p, i) => {
    const sig = productSizeSignal(p, wantedSize)
    return { p, i, score: sig === 'match' ? 1 : sig === 'mismatch' ? -1 : 0 }
  })
  return scored.sort((a, b) => b.score - a.score || a.i - b.i).map(s => s.p)
}
