// ── What a stylist knows, in a form retrieval can use ────────────────────────
//
// knowledgeModules.ts already carries fashion knowledge as prose for the LLM
// judge to read. That helps it score what came back, and does nothing about
// what came back, which is the actual ceiling: no reranker recovers a piece the
// query never retrieved. "An autumn wedding" reaches the stores as those three
// words; nothing in them says wool, or tailoring, or burgundy, so nothing wool,
// tailored or burgundy is fetched, and the judge picks the best of a bad pool.
//
// So the same knowledge is encoded here as data — occasion to slots, season to
// fibres, occasion to palette — and used BEFORE the fetch: to decide which
// garments an occasion even implies, and to put concrete nouns into the query
// the shopper's own words never contained.
//
// It is deliberately a curated table rather than a model call. It runs in
// microseconds on every search, it cannot time out, and its judgements are
// inspectable and arguable — which is what you want from the part of the system
// that decides what is eligible.

import { GARMENT_VOCAB } from '../queryParser'

export type Season = 'spring' | 'summer' | 'autumn' | 'winter'
export type Formality = 1 | 2 | 3 | 4 | 5

// ── Seasons ──────────────────────────────────────────────────────────────────
// Fibre first, because fibre is what a keyword search cannot infer and what
// separates a piece that works from a piece that merely matches. Weight matters
// as much as fibre: linen in January and merino in July are both wrong.

const SEASONS: Record<Season, { match: RegExp; fabrics: string[]; avoid: string[] }> = {
  spring: {
    match: /\b(spring|april|may|march)\b/i,
    fabrics: ['cotton', 'lightweight wool', 'poplin', 'gabardine'],
    avoid: ['shearling', 'heavy tweed'],
  },
  summer: {
    match: /\b(summer|june|july|august|beach|tropical|resort|hot weather|humid)\b/i,
    fabrics: ['linen', 'cotton', 'silk', 'seersucker'],
    avoid: ['wool', 'cashmere', 'shearling', 'corduroy'],
  },
  autumn: {
    match: /\b(autumn|fall|september|october|november)\b/i,
    fabrics: ['wool', 'flannel', 'corduroy', 'suede', 'leather'],
    avoid: ['linen', 'seersucker'],
  },
  winter: {
    match: /\b(winter|december|january|february|snow|ski|cold weather|freezing)\b/i,
    fabrics: ['wool', 'cashmere', 'shearling', 'down', 'tweed'],
    avoid: ['linen', 'seersucker'],
  },
}

export function readSeason(query: string): Season | null {
  for (const [key, s] of Object.entries(SEASONS)) {
    if (s.match.test(query)) return key as Season
  }
  return null
}

export function seasonFabrics(season: Season | null): string[] {
  return season ? SEASONS[season].fabrics : []
}

export function seasonAvoids(season: Season | null): string[] {
  return season ? SEASONS[season].avoid : []
}

// ── Occasions ────────────────────────────────────────────────────────────────
// The slots are what someone actually walks out of the house wearing for this,
// in wear order, and they are the whole reason an occasion query should not
// return one flat list. "What do I wear to an interview" has an answer with
// three or four parts to it, and any single garment is at best a quarter of it.
//
// `formality` is a floor on a 1–5 scale (1 gym, 5 black tie). A piece below the
// floor fails however well its words match — the rubric in relevanceRerank says
// this in prose, and this is the number behind it.

type Occasion = {
  key: string
  match: RegExp
  formality: Formality
  /** Garment keys from GARMENT_VOCAB, in wear order. Women's list is not a
   *  variant of the men's: a dress answers the whole brief on its own, and
   *  putting it first is the difference between one good answer and four
   *  separate approximations of one. */
  slots: { men: string[]; women: string[] }
  /** Colours that read correctly here. First entry leads any expansion. */
  palette: string[]
  /** One line the judge can weigh. Kept short; it joins an already long prompt. */
  note: string
}

const OCCASIONS: Occasion[] = [
  {
    key: 'black-tie',
    match: /\b(black[- ]?tie|tuxedos?|galas?|opera|balls?)\b/i,
    formality: 5,
    slots: { men: ['blazer', 'shirt', 'trouser', 'derby'], women: ['gown', 'heel', 'jewelry'] },
    palette: ['black', 'midnight blue', 'ivory'],
    note: 'Black tie: dinner jacket or full-length gown only. Anything that could be worn to an office is under-dressed.',
  },
  {
    key: 'wedding-guest',
    match: /\b(weddings?|marriage|nikah|receptions?|civil ceremony|shaadi|baraat|sangeet)\b/i,
    formality: 4,
    slots: { men: ['blazer', 'shirt', 'trouser', 'loafer'], women: ['dress', 'heel', 'bag'] },
    // White is the one genuine rule in menswear-and-womenswear alike; it is
    // not a taste call and belongs in the data rather than in a prompt.
    palette: ['navy', 'sage', 'dusty rose', 'burgundy', 'stone'],
    note: 'Wedding guest: never white, never ivory, never bridal. Tailoring or a proper dress; sharp shoes.',
  },
  {
    key: 'interview',
    match: /\b(interviews?|interviewing|job interview|first day|presentations?|pitch(?:es|ing)?|viva)\b/i,
    formality: 4,
    slots: { men: ['blazer', 'shirt', 'trouser', 'derby'], women: ['blazer', 'blouse', 'trouser', 'flat'] },
    palette: ['navy', 'charcoal', 'white', 'grey'],
    note: 'Interview: quiet and exact. Nothing loud enough to be remembered instead of you.',
  },
  {
    key: 'funeral',
    match: /\b(funerals?|memorial|wake|condolences?|prayer meet)\b/i,
    formality: 4,
    slots: { men: ['blazer', 'shirt', 'trouser', 'derby'], women: ['dress', 'coat', 'flat'] },
    palette: ['black', 'charcoal', 'navy'],
    note: 'Funeral: black or near-black, matte, nothing that catches light or attention.',
  },
  {
    key: 'cocktail',
    match: /\b(cocktails?|evening do|drinks party|christmas party|new year'?s? eve|night ?out|clubbing|party)\b/i,
    formality: 4,
    slots: { men: ['blazer', 'shirt', 'trouser', 'loafer'], women: ['dress', 'heel', 'jewelry'] },
    palette: ['black', 'emerald', 'burgundy', 'midnight blue'],
    note: 'Cocktail: shorter and sharper than black tie, dressier than any office. Sneakers fail here regardless of price.',
  },
  {
    // Occasions the catalogue will never name, and the parser was dropping.
    //
    // §20 forbids lossy compilation, and this was the clearest breach in the
    // system: "something for Muharram" compiled to nothing at all — no
    // occasion, no garment, no residue carried forward — so the meaning of the
    // sentence survived only if the model happened to be up and happened to
    // translate it. The system prompt tells it how; the prompt is not a
    // guarantee, and on this deployment the model is unavailable often.
    //
    // Encoded here it works whether or not a model answers, and it is
    // inspectable and arguable, which prose in a prompt is not. The palettes
    // and the formality are the load-bearing parts: nobody searches for the
    // word Muharram, they search for plain black cotton that breathes.
    key: 'mourning-observance',
    match: /\b(muharram|ashura|matam|shok|mourning period)\b/i,
    formality: 4,
    slots: { men: ['kurta', 'trouser', 'sandal'], women: ['kurta', 'palazzo', 'dupatta'] },
    palette: ['black', 'charcoal', 'deep grey'],
    note: 'A month of mourning: plain black, matte, modest, nothing that catches light. Hot South-Asian season, so breathable cotton over anything heavy.',
  },
  {
    key: 'festive-south-asian',
    match: /\b(eid|diwali|deepavali|navratri|onam|pongal|baisakhi|raksha bandhan|karwa chauth|puja|pooja|teej)\b/i,
    formality: 4,
    slots: { men: ['kurta', 'trouser', 'nehruJacket'], women: ['kurta', 'lehenga', 'dupatta'] },
    palette: ['ivory', 'gold', 'emerald', 'deep red', 'mustard'],
    note: 'Festive and traditional rather than western-formal. Colour and craft are the point; a suit reads as the wrong kind of dressed up.',
  },
  {
    key: 'graduation',
    match: /\b(graduations?|convocation|commencement|degree ceremony)\b/i,
    formality: 4,
    slots: { men: ['blazer', 'shirt', 'trouser', 'derby'], women: ['dress', 'blazer', 'flat'] },
    palette: ['navy', 'charcoal', 'stone', 'white'],
    note: 'Photographed all day, often under a gown: it has to read from the shoulders up and survive being sat in.',
  },
  {
    key: 'work',
    match: /\b(work|working|office|business|workwear|corporate|meetings?|9[- ]?to[- ]?5|formals?)\b/i,
    formality: 3,
    slots: { men: ['shirt', 'trouser', 'blazer', 'loafer'], women: ['blouse', 'trouser', 'blazer', 'flat'] },
    palette: ['navy', 'charcoal', 'white', 'camel', 'olive'],
    note: 'Work: repeatable rather than memorable. Pieces that go with what is already in the wardrobe.',
  },
  {
    key: 'dinner',
    match: /\b(dinners?|date night|dates?|restaurants?|anniversary|dinner party|lunch date)\b/i,
    formality: 3,
    slots: { men: ['shirt', 'trouser', 'jacket', 'loafer'], women: ['dress', 'heel', 'jacket'] },
    palette: ['black', 'burgundy', 'ink', 'chocolate'],
    note: 'Dinner: one considered piece, everything else quiet around it. Fabric reads more than colour under low light.',
  },
  {
    key: 'travel',
    match: /\b(travel(?:ling|ing)?|flights?|flying|long[- ]haul|airport|road trip|commute|commuting)\b/i,
    formality: 2,
    slots: { men: ['tshirt', 'trouser', 'jacket', 'sneaker'], women: ['tshirt', 'trouser', 'cardigan', 'sneaker'] },
    palette: ['black', 'navy', 'grey', 'stone'],
    note: 'Travel: creases and layers decide this. Knit over woven, one warm layer that packs down.',
  },
  {
    key: 'holiday',
    match: /\b(holidays?|vacations?|vacationing|beach(?:y|es)?|seaside|poolside|island|honeymoon|getaway|resort|goa|maldives)\b/i,
    formality: 2,
    slots: { men: ['shirt', 'short', 'sandal'], women: ['dress', 'sandal', 'bag'] },
    palette: ['white', 'stone', 'sky', 'terracotta'],
    note: 'Holiday: linen and cotton, loose, pale. Anything synthetic is unwearable in real heat.',
  },
  {
    key: 'weekend',
    match: /\b(weekends?|casual(?:ly|s)?|every ?-? ?day|day[- ]to[- ]day|daily|brunch|day off|errands?|regular wear|lounging|chill(?:ing)?)\b/i,
    formality: 2,
    slots: { men: ['tshirt', 'jean', 'jacket', 'sneaker'], women: ['tshirt', 'jean', 'cardigan', 'sneaker'] },
    palette: ['indigo', 'white', 'olive', 'grey'],
    note: 'Weekend: comfort without giving up shape. Fit is what separates this from loungewear.',
  },
  {
    // LAST on purpose. Every occasion above names a situation; this one names
    // no situation at all — "give me some outfits", "help me dress better",
    // "how do I up my fashion sense". It has to be checked after all of them
    // so a real occasion always wins.
    //
    // It exists because that question was producing NOTHING deterministic: no
    // occasion, no garment, no plan — so the slot choice fell entirely to the
    // model, and the model answered an open question about style with a shirt,
    // shorts and sandals. A beach outfit, for somebody asking how to dress
    // better.
    //
    // The men's slots are the spine of the reference lookbook: a shirt or knit
    // on top, a wide-leg trouser, a low-profile shoe. Sixteen of sixteen looks
    // in it are built that way. The women's slots are NOT from the lookbook —
    // every reference in it is menswear — so they are the weekend set, and
    // this comment is here so nobody mistakes one for the other.
    key: 'open-style',
    match: /\b(fashion sense|style sense|dress better|dress well|improve my (?:style|wardrobe|fashion)|up my (?:style|fashion|game)|style (?:advice|tips|help)|outfit ideas|some outfits|any outfits|help me dress|what (?:should|do) i wear\b(?!.*\b(?:to|for)\b))/i,
    formality: 2,
    slots: { men: ['shirt', 'trouser', 'sneaker'], women: ['tshirt', 'jean', 'cardigan', 'sneaker'] },
    palette: ['cream', 'ecru', 'stone', 'navy', 'olive', 'taupe'],
    note: 'No occasion named: this is the house look. Neutrals with at most one muted colour, volume below the waist, texture rather than print, and a low-profile shoe. Nothing athletic, nothing beachy, nothing loud — the point is pieces that go with what they already own.',
  },
  {
    key: 'gym',
    match: /\b(gyms?|workouts?|working out|training|runs?|running|jog(?:ging)?|yoga|pilates|athleisure)\b/i,
    formality: 1,
    slots: { men: ['tshirt', 'short', 'sneaker'], women: ['tank', 'legging', 'sneaker'] },
    palette: ['black', 'grey', 'navy'],
    note: 'Training: technical fabric only. Cotton holds sweat and is the one place natural fibre loses.',
  },
]

/** Words that name WHERE or WHAT, and beat a word that only names a social
 *  gathering. "Beach party" is a beach; "pool party" is a pool. The generic
 *  half of the phrase must not decide the outfit.
 *
 *  This is a regression I introduced. Widening the patterns so people could
 *  type naturally, I added "party" to cocktail — and cocktail is checked before
 *  holiday, so "I am going on a beach party with my friends" resolved to
 *  cocktail and came back with BLAZERS. The word beach was right there in the
 *  sentence and lost to the word party. */
const PLACE_BEATS_PARTY: [RegExp, string][] = [
  // A NAMED event beats a generic gathering word, for the same reason a named
  // place does: "diwali party outfit" resolved to cocktail, because cocktail
  // owns the word party and is checked first — so a festival came back as a
  // black blazer. The word diwali was right there in the sentence and lost to
  // the word party, exactly as beach did before it.
  [/\b(muharram|ashura|matam)\b/i, 'mourning-observance'],
  [/\b(eid|diwali|deepavali|navratri|onam|pongal|baisakhi|raksha bandhan|karwa chauth|teej)\b/i, 'festive-south-asian'],
  [/\b(graduations?|convocation|commencement)\b/i, 'graduation'],
  [/\b(beach|poolside|pool|seaside|island|resort|shore|sand)\b/i, 'holiday'],
  [/\b(gym|workout|training)\b/i, 'gym'],
  [/\b(wedding|shaadi|nikah|reception)\b/i, 'wedding-guest'],
  [/\b(funeral|memorial)\b/i, 'funeral'],
  [/\b(interview)\b/i, 'interview'],
]

/** The same regression as PLACE_BEATS_PARTY, one step further along.
 *
 *  A shopper asked for "outfits for a casual party" and the table answered
 *  blazer, shirt, trouser, loafer — because `party` belongs to cocktail,
 *  cocktail is formality 4, and it is checked long before weekend. The word
 *  casual was right there in the sentence and lost to the word party, exactly
 *  as beach did.
 *
 *  A place beats a gathering because it says WHERE. This says HOW DRESSY, which
 *  is the only thing the slots actually encode, so it beats it for the same
 *  reason: the shopper stated the formality outright and we overrode it.
 *
 *  "Smart casual" and "business casual" are excluded deliberately — they are
 *  dressier than casual, not versions of it, and a smart-casual party is much
 *  closer to cocktail than to jeans and a t-shirt. And this only fires against
 *  a GATHERING word: "casual Friday at the office" is still work, "casual
 *  dinner" is still dinner. It is only the generic social words that a stated
 *  formality is allowed to overrule. */
const UNQUALIFIED_CASUAL = /(?<!\b(?:smart|business|dressy|elevated)[\s-])\bcasual\b/i
const GENERIC_GATHERING = /\b(part(?:y|ies)|night ?out|nights? out|drinks|get[- ]?together|hang ?out|meet[- ]?up)\b/i

export function readOccasion(query: string): Occasion | null {
  // A named place or event wins outright over a generic social word, whatever
  // the list order says.
  for (const [re, key] of PLACE_BEATS_PARTY) {
    if (!re.test(query)) continue
    const hit = OCCASIONS.find(o => o.key === key)
    if (hit) return hit
  }
  // Then a stated formality, over the gathering word it is describing.
  if (UNQUALIFIED_CASUAL.test(query) && GENERIC_GATHERING.test(query)) {
    const hit = OCCASIONS.find(o => o.key === 'weekend')
    if (hit) return hit
  }
  // Otherwise: order matters where a word appears twice ('christmas party' is
  // cocktail, not weekend), so the list order is the priority.
  for (const o of OCCASIONS) if (o.match.test(query)) return o
  return null
}

// ── Colour ───────────────────────────────────────────────────────────────────
// Enough to answer "does this go with that" — a family, a temperature, and
// whether it is a neutral. Neutrals go with everything, which is why the rule
// below is about how many non-neutrals are in play rather than about pairs.

type ColorFamily = 'neutral' | 'earth' | 'cool' | 'warm' | 'jewel' | 'pastel'

const COLOR_FAMILY: Array<[RegExp, ColorFamily]> = [
  [/\b(black|white|ivory|cream|grey|gray|charcoal|stone|ecru|off[- ]white|bone)\b/i, 'neutral'],
  [/\b(camel|tan|beige|khaki|olive|chocolate|brown|rust|terracotta|sand|taupe|cognac)\b/i, 'earth'],
  [/\b(navy|indigo|denim|slate|sky|steel|ink|midnight)\b/i, 'cool'],
  [/\b(red|orange|coral|mustard|amber|scarlet|tomato)\b/i, 'warm'],
  [/\b(burgundy|emerald|sapphire|plum|forest|oxblood|teal|bottle green)\b/i, 'jewel'],
  [/\b(blush|dusty rose|lilac|mint|butter|powder blue|sage)\b/i, 'pastel'],
]

export function colorFamily(text: string): ColorFamily | null {
  for (const [re, fam] of COLOR_FAMILY) if (re.test(text)) return fam
  return null
}

/** Whether a set of pieces reads as one outfit rather than several. 0–1.
 *
 *  Two rules, both of which a keyword search is blind to and both of which a
 *  person notices instantly: how many colours are competing, and whether
 *  everything is dressed to the same level. A blazer over gym shorts scores
 *  badly here no matter how well each piece matches the words. */
/** How dressed a piece is, from the garment word in its own text.
 *
 *  Coherence needs a level per piece and nothing was producing one, which is
 *  part of why coherence itself was never called. Deliberately coarse: the
 *  question it answers is "is this outfit dressed to one level", and that does
 *  not need more resolution than this. */
const FORMALITY_WORDS: [RegExp, Formality][] = [
  [/\b(tuxedo|dinner jacket|gown|tailcoat)\b/i, 5],
  [/\b(blazer|suit|oxford shoe|derby|brogue|dress shirt|waistcoat|tie)\b/i, 4],
  [/\b(loafer|shirt|trouser|chino|knit|cardigan|overshirt|monk|boot)\b/i, 3],
  [/\b(jean|denim|t-?shirt|tee|polo|sneaker|trainer|jacket|sweater|jumper)\b/i, 2],
  [/\b(hoodie|sweatpant|jogger|short|slide|sandal|track|gym|legging)\b/i, 1],
]
export function pieceFormality(text: string): Formality | undefined {
  for (const [re, level] of FORMALITY_WORDS) if (re.test(text)) return level
  return undefined
}

export function coherence(pieces: Array<{ text: string; formality?: Formality }>): number {
  if (pieces.length < 2) return 1

  const families = pieces.map(p => colorFamily(p.text)).filter(Boolean) as ColorFamily[]
  const nonNeutral = new Set(families.filter(f => f !== 'neutral'))
  // One accent against neutrals is the classic; two related families still
  // reads deliberate; three or more is where an outfit stops being an outfit.
  const colorScore = nonNeutral.size <= 1 ? 1 : nonNeutral.size === 2 ? 0.7 : 0.35

  // The echo: something below repeating a colour from above. Thirteen of the
  // sixteen looks in the lookbook do it — the shoe picking up the knit, the
  // belt picking up the shoe — and it is the difference between pieces that
  // merely avoid clashing and pieces that were chosen for each other. Counted
  // as a bonus rather than a requirement, because three of the sixteen do not.
  const echo = families.length >= 2 && new Set(families).size < families.length ? 1 : 0

  const levels = pieces.map(p => p.formality ?? pieceFormality(p.text))
    .filter((f): f is Formality => typeof f === 'number')
  if (levels.length < 2) return +(colorScore * 0.85 + echo * 0.15).toFixed(3)
  const spread = Math.max(...levels) - Math.min(...levels)
  const formalityScore = spread <= 1 ? 1 : spread === 2 ? 0.6 : 0.25

  return +(colorScore * 0.4 + formalityScore * 0.45 + echo * 0.15).toFixed(3)
}

/** Choose which piece LEADS each slot, so the leads work together.
 *
 *  An outfit was being assembled rather than composed: every slot was filled
 *  with the piece that ranked best on its own, and nothing ever compared the
 *  blazer with the trousers it was going to be worn with. Four individually
 *  excellent pieces are not an outfit, which is the entire complaint behind
 *  every reference photograph in the lookbook.
 *
 *  So the leads are chosen together. Each slot offers its top few candidates,
 *  every combination is scored on relevance AND on whether the set reads as
 *  one outfit, and the winning combination's pieces are promoted to the front
 *  of their slots. Nothing is discarded: a slot keeps all its candidates and
 *  only their order changes, so a shopper who dislikes the chosen shirt still
 *  has the others.
 *
 *  Relevance still dominates. Coherence is worth about a third, which is
 *  enough to break a tie between two good shirts and not enough to promote a
 *  bad one for matching. */
export function composeOutfit<T>(
  slots: Array<{ products: T[] }>,
  textOf: (p: T) => string,
  opts: { perSlot?: number; weight?: number } = {},
): Array<{ products: T[] }> {
  const perSlot = Math.max(1, opts.perSlot ?? 3)
  const weight = opts.weight ?? 0.35
  const usable = slots.filter(s => s.products.length > 0)
  if (usable.length < 2) return slots
  // 3^5 is 243 combinations at the very worst, and most outfits are four
  // slots. Bounded rather than clever.
  if (usable.length > 5) return slots

  const options = usable.map(s => s.products.slice(0, perSlot))
  let bestCombo: number[] | null = null
  let bestScore = -Infinity

  const walk = (depth: number, picked: number[]) => {
    if (depth === options.length) {
      const pieces = picked.map((idx, i) => ({ text: textOf(options[i][idx]) }))
      // Relevance, as the rank it arrived at: the first candidate is the one
      // the ranker preferred, and moving down costs.
      const relevance = picked.reduce((sum, idx) => sum + (1 - idx * 0.34), 0) / picked.length
      const score = relevance * (1 - weight) + coherence(pieces) * weight
      if (score > bestScore) { bestScore = score; bestCombo = [...picked] }
      return
    }
    for (let i = 0; i < options[depth].length; i++) walk(depth + 1, [...picked, i])
  }
  walk(0, [])
  if (!bestCombo) return slots

  const lead = new Map<Array<T>, number>()
  usable.forEach((s, i) => lead.set(s.products, bestCombo![i]))
  return slots.map(s => {
    const idx = lead.get(s.products)
    if (!idx) return s          // 0 or undefined — already leading, or untouched
    const chosen = s.products[idx]
    return { ...s, products: [chosen, ...s.products.filter((_, i) => i !== idx)] }
  })
}

// ── The plan ─────────────────────────────────────────────────────────────────

/** Who this is for, out of whatever the caller happened to have.
 *
 *  Some callers hold a clean 'Women' / 'Men'; the ranker holds the shopper's
 *  whole taste line ("women · tops M · bag: …"). Both have to work, and a naive
 *  first-letter test on the second reads 'w' from "women" but also matches any
 *  sentence starting with w. `\bmen\b` cannot fire inside "women" — the word
 *  boundary fails against the preceding o — so this order is safe. */
export function readGender(input?: string | null): 'Women' | 'Men' | null {
  const s = input || ''
  if (/\b(women|womens|women's|female|ladies)\b/i.test(s)) return 'Women'
  if (/\b(men|mens|men's|male)\b/i.test(s)) return 'Men'
  return null
}

export type OutfitPlan = {
  occasion: string
  formality: Formality
  season: Season | null
  /** Garment keys to retrieve, one strip each. */
  slots: string[]
  palette: string[]
  fabrics: string[]
  note: string
}

/** What this occasion actually asks for, or null when the shopper named a
 *  garment instead of a situation — in which case they have already told us
 *  what they want and inventing three more strips would be presumptuous. */
export function outfitPlan(query: string, gender?: string | null): OutfitPlan | null {
  const occasion = readOccasion(query)
  if (!occasion) return null

  const season = readSeason(query)
  // 'Both' and 'Non-binary' are real answers on the profile and neither of them
  // means "no preference between two lists". Menswear slots are the safer
  // default: every slot in them exists in both wardrobes, which is not true the
  // other way round (a gown is not a neutral suggestion).
  const slots = readGender(gender) === 'Women' ? occasion.slots.women : occasion.slots.men

  return {
    occasion: occasion.key,
    formality: occasion.formality,
    season,
    slots,
    palette: occasion.palette,
    fabrics: seasonFabrics(season),
    note: occasion.note,
  }
}

/** Concrete nouns to fetch on, built from the plan rather than from the
 *  shopper's wording. This is the whole point: "an autumn wedding" contains no
 *  retrievable noun, and these do.
 *
 *  Capped at three because each one multiplies the store fan-out. */
export function retrievalQueries(query: string, gender?: string | null): string[] {
  const plan = outfitPlan(query, gender)
  if (!plan) return []

  const fabric = plan.fabrics[0]
  const colour = plan.palette[0]
  const out: string[] = []

  for (const slot of plan.slots.slice(0, 3)) {
    const term = GARMENT_VOCAB[slot]?.query[0] || slot
    // Fabric before colour: a store's search does better with a material word
    // than a colour word, and a wrong-fibre result is a worse answer than a
    // wrong-colour one.
    out.push([fabric, term].filter(Boolean).join(' '))
  }
  if (colour && plan.slots.length) {
    const lead = GARMENT_VOCAB[plan.slots[0]]?.query[0] || plan.slots[0]
    out.push(`${colour} ${lead}`)
  }

  return Array.from(new Set(out.map(s => s.trim()).filter(s => s.length >= 3))).slice(0, 3)
}

/** A stable name for what is being asked, independent of how it was worded.
 *
 *  The rerank cache keys on the query string and the exact set of product ids
 *  that came back, so "smart shoes for a wedding" and "wedding shoes" never
 *  share a judgement even though the reasoning is identical. This is the part
 *  worth caching: the intent, not the sentence. */
export function intentKey(query: string, gender?: string | null): string {
  const occasion = readOccasion(query)
  const season = readSeason(query)
  const family = colorFamily(query)
  return [
    occasion?.key ?? '-',
    season ?? '-',
    family ?? '-',
    readGender(gender) ?? '-',
  ].join('|')
}

/** The plan as one short block for the judge, so what shaped the retrieval also
 *  shapes the scoring. Empty when no occasion was recognised — silence beats a
 *  generic paragraph. */
export function planPromptBlock(query: string, gender?: string | null): string {
  const plan = outfitPlan(query, gender)
  if (!plan) return ''
  const bits = [
    `Occasion: ${plan.occasion} (formality ${plan.formality}/5). ${plan.note}`,
    `Palette that reads right: ${plan.palette.join(', ')}.`,
  ]
  if (plan.season) {
    bits.push(`Season: ${plan.season} — ${plan.fabrics.join(', ')}. Wrong for it: ${seasonAvoids(plan.season).join(', ')}.`)
  }
  return bits.join('\n')
}


/** Not one outfit — a set of them, the way a lookbook page reads.
 *
 *  `composeOutfit` above answers "of everything we found, which single
 *  combination is best" and promotes it to the front of each strip. Which is
 *  correct, and invisible: the page draws twenty-four tiles at equal weight, so
 *  the shopper sees a shirt shelf, a trouser shelf and a shoe shelf and is
 *  asked to do the styling themselves. Eight by eight by eight is five hundred
 *  and twelve combinations and only one of them was ever chosen.
 *
 *  This returns LOOK 1, LOOK 2, LOOK 3 — each a complete outfit, each scored as
 *  a whole, and each DIFFERENT IN EVERY SLOT from the ones above it. That last
 *  rule is what stops four looks that are the same outfit with a different
 *  shoe: a shopper reading a page of near-identical rows learns nothing, and
 *  the point of showing four is that they are four real choices.
 *
 *  Greedy rather than optimal on purpose. Taking the best combination, then the
 *  best that shares no piece with it, and so on, gives a spread across the pool
 *  instead of a cluster around one very good shirt. The globally optimal set
 *  would be the four best-scoring combinations, which in practice is one shirt
 *  wearing four different trousers.
 */
/** The same composition, but judging the pieces on what they ARE.
 *
 *  composeOutfits below scores a combination on the words in its titles —
 *  coherence() reading for colour names and loudness. That was the best
 *  available while a garment was a title and a colour, and it is the reason
 *  outfits came out colour-coordinated and wrong: two pieces can share a
 *  palette and still be a gym short with a dinner jacket.
 *
 *  When profiles exist, this replaces that judgement with worksWith() — volume
 *  balance, formality within a step, pattern scale, cloth weight and season,
 *  and whether the two garments come from the same wardrobe. Every pair in a
 *  combination is scored and the WEAKEST pair decides, because an outfit is
 *  only as good as its worst relationship: three pieces that agree and one that
 *  fights is not three quarters of an outfit.
 */
export function composeOutfitsWithProfiles<T>(
  slots: Array<{ label?: string; products: T[] }>,
  textOf: (p: T) => string,
  profileOf: (p: T) => { formality: number; volume: string; fit: string; pattern: string; patternScale: string; weight: string; season: string; aesthetic: string } | null,
  worksWith: (a: never, b: never) => number,
  opts: { count?: number; perSlot?: number; weight?: number } = {},
): Array<{ pieces: Array<{ label: string; product: T }>; score: number }> {
  const count = Math.max(1, opts.count ?? 4)
  const perSlot = Math.max(1, opts.perSlot ?? 6)
  const weight = opts.weight ?? 0.6
  const usable = slots.filter(s => s.products.length > 0)
  if (usable.length < 2 || usable.length > 5) return []

  const options = usable.map(s => s.products.slice(0, perSlot))

  const combos: Array<{ idx: number[]; score: number }> = []
  const walk = (depth: number, picked: number[]) => {
    if (depth === options.length) {
      const chosen = picked.map((idx, i) => options[i][idx])
      const profiles = chosen.map(profileOf)
      // Every pair, and the weakest one decides. An outfit is only as good as
      // its worst relationship.
      let worst = 1
      let pairs = 0
      for (let i = 0; i < profiles.length; i++) {
        for (let j = i + 1; j < profiles.length; j++) {
          const a = profiles[i], b = profiles[j]
          if (!a || !b) continue
          worst = Math.min(worst, worksWith(a as never, b as never))
          pairs++
        }
      }
      // Nothing profiled: fall back to the written coherence so a combination
      // is never scored on nothing at all.
      const fit = pairs > 0 ? worst : coherence(chosen.map(p => ({ text: textOf(p) })))
      const relevance = picked.reduce((sum, idx) => sum + (1 - idx * 0.14), 0) / picked.length
      combos.push({ idx: [...picked], score: relevance * (1 - weight) + fit * weight })
      return
    }
    for (let i = 0; i < options[depth].length; i++) walk(depth + 1, [...picked, i])
  }
  walk(0, [])
  combos.sort((a, b) => b.score - a.score)

  const usedPiece = options.map(() => new Set<string>())
  const out: Array<{ pieces: Array<{ label: string; product: T }>; score: number }> = []
  for (const c of combos) {
    if (out.length >= count) break
    const ids = c.idx.map((idx, i) => textOf(options[i][idx]).toLowerCase().trim())
    if (ids.some((id, i) => usedPiece[i].has(id))) continue
    ids.forEach((id, i) => usedPiece[i].add(id))
    out.push({
      score: +c.score.toFixed(3),
      pieces: c.idx.map((idx, i) => ({
        label: usable[i].label ?? `Slot ${i + 1}`,
        product: options[i][idx],
      })),
    })
  }
  return out
}

export function composeOutfits<T>(
  slots: Array<{ label?: string; products: T[] }>,
  textOf: (p: T) => string,
  opts: { count?: number; perSlot?: number; weight?: number } = {},
): Array<{ pieces: Array<{ label: string; product: T }>; score: number }> {
  const count = Math.max(1, opts.count ?? 4)
  const perSlot = Math.max(1, opts.perSlot ?? 6)
  const weight = opts.weight ?? 0.45
  const usable = slots.filter(s => s.products.length > 0)
  if (usable.length < 2) return []
  // Six to the fifth is 7,776 and each is a cheap string comparison. Bounded
  // rather than clever, same as its sibling above.
  if (usable.length > 5) return []

  const options = usable.map(s => s.products.slice(0, perSlot))

  // Every combination, scored once.
  const combos: Array<{ idx: number[]; score: number }> = []
  const walk = (depth: number, picked: number[]) => {
    if (depth === options.length) {
      const pieces = picked.map((idx, i) => ({ text: textOf(options[i][idx]) }))
      // Where each piece sat in its own strip. The ranker put the best first,
      // so reaching further down costs — but never so much that it refuses a
      // genuinely better-matched combination.
      const relevance = picked.reduce((sum, idx) => sum + (1 - idx * 0.14), 0) / picked.length
      combos.push({ idx: [...picked], score: relevance * (1 - weight) + coherence(pieces) * weight })
      return
    }
    for (let i = 0; i < options[depth].length; i++) walk(depth + 1, [...picked, i])
  }
  walk(0, [])
  combos.sort((a, b) => b.score - a.score)

  // Tracked by what the piece IS, not where it sat.
  //
  // This kept a set of used INDICES per slot, and a strip that carries the
  // same shoe twice — the same product listed under two ids, which this
  // catalogue does constantly — offers it at two different positions. Two
  // different positions passed the check, and Look 3 and Look 4 came back
  // wearing identical slip-ons. Verified against the live catalogue, which is
  // the only reason it was caught: the fixture pool had no duplicates.
  const identity = (p: T): string => {
    const anyP = p as unknown as { title?: string; id?: string }
    return (anyP?.title || anyP?.id || String(p)).toLowerCase().replace(/\s+/g, ' ').trim()
  }
  const used = options.map(() => new Set<string>())
  const out: Array<{ pieces: Array<{ label: string; product: T }>; score: number }> = []
  for (const c of combos) {
    if (out.length >= count) break
    // Every slot must contribute a piece no earlier look has used.
    if (c.idx.some((idx, i) => used[i].has(identity(options[i][idx])))) continue
    c.idx.forEach((idx, i) => used[i].add(identity(options[i][idx])))
    out.push({
      score: +c.score.toFixed(3),
      pieces: c.idx.map((idx, i) => ({
        label: usable[i].label ?? `Slot ${i + 1}`,
        product: options[i][idx],
      })),
    })
  }
  return out
}
