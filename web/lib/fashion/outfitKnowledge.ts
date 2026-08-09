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
    match: /\b(black[- ]?tie|tuxedo|gala|opera|ball)\b/i,
    formality: 5,
    slots: { men: ['blazer', 'shirt', 'trouser', 'derby'], women: ['gown', 'heel', 'jewelry'] },
    palette: ['black', 'midnight blue', 'ivory'],
    note: 'Black tie: dinner jacket or full-length gown only. Anything that could be worn to an office is under-dressed.',
  },
  {
    key: 'wedding-guest',
    match: /\b(wedding|marriage|nikah|reception|civil ceremony)\b/i,
    formality: 4,
    slots: { men: ['blazer', 'shirt', 'trouser', 'loafer'], women: ['dress', 'heel', 'bag'] },
    // White is the one genuine rule in menswear-and-womenswear alike; it is
    // not a taste call and belongs in the data rather than in a prompt.
    palette: ['navy', 'sage', 'dusty rose', 'burgundy', 'stone'],
    note: 'Wedding guest: never white, never ivory, never bridal. Tailoring or a proper dress; sharp shoes.',
  },
  {
    key: 'interview',
    match: /\b(interview|job interview|first day|presentation|pitch)\b/i,
    formality: 4,
    slots: { men: ['blazer', 'shirt', 'trouser', 'derby'], women: ['blazer', 'blouse', 'trouser', 'flat'] },
    palette: ['navy', 'charcoal', 'white', 'grey'],
    note: 'Interview: quiet and exact. Nothing loud enough to be remembered instead of you.',
  },
  {
    key: 'funeral',
    match: /\b(funeral|memorial|wake|condolence)\b/i,
    formality: 4,
    slots: { men: ['blazer', 'shirt', 'trouser', 'derby'], women: ['dress', 'coat', 'flat'] },
    palette: ['black', 'charcoal', 'navy'],
    note: 'Funeral: black or near-black, matte, nothing that catches light or attention.',
  },
  {
    key: 'cocktail',
    match: /\b(cocktail|evening do|drinks party|christmas party|new year'?s? eve)\b/i,
    formality: 4,
    slots: { men: ['blazer', 'shirt', 'trouser', 'loafer'], women: ['dress', 'heel', 'jewelry'] },
    palette: ['black', 'emerald', 'burgundy', 'midnight blue'],
    note: 'Cocktail: shorter and sharper than black tie, dressier than any office. Sneakers fail here regardless of price.',
  },
  {
    key: 'work',
    match: /\b(work|office|business|workwear|corporate|meeting|9[- ]?to[- ]?5)\b/i,
    formality: 3,
    slots: { men: ['shirt', 'trouser', 'blazer', 'loafer'], women: ['blouse', 'trouser', 'blazer', 'flat'] },
    palette: ['navy', 'charcoal', 'white', 'camel', 'olive'],
    note: 'Work: repeatable rather than memorable. Pieces that go with what is already in the wardrobe.',
  },
  {
    key: 'dinner',
    match: /\b(dinner|date night|restaurant|anniversary|dinner party)\b/i,
    formality: 3,
    slots: { men: ['shirt', 'trouser', 'jacket', 'loafer'], women: ['dress', 'heel', 'jacket'] },
    palette: ['black', 'burgundy', 'ink', 'chocolate'],
    note: 'Dinner: one considered piece, everything else quiet around it. Fabric reads more than colour under low light.',
  },
  {
    key: 'travel',
    match: /\b(travel|flight|flying|long[- ]haul|airport|road trip)\b/i,
    formality: 2,
    slots: { men: ['tshirt', 'trouser', 'jacket', 'sneaker'], women: ['tshirt', 'trouser', 'cardigan', 'sneaker'] },
    palette: ['black', 'navy', 'grey', 'stone'],
    note: 'Travel: creases and layers decide this. Knit over woven, one warm layer that packs down.',
  },
  {
    key: 'holiday',
    match: /\b(holiday|vacation|beach|poolside|island|honeymoon)\b/i,
    formality: 2,
    slots: { men: ['shirt', 'short', 'sandal'], women: ['dress', 'sandal', 'bag'] },
    palette: ['white', 'stone', 'sky', 'terracotta'],
    note: 'Holiday: linen and cotton, loose, pale. Anything synthetic is unwearable in real heat.',
  },
  {
    key: 'weekend',
    match: /\b(weekend|casual|everyday|brunch|day off|errands)\b/i,
    formality: 2,
    slots: { men: ['tshirt', 'jean', 'jacket', 'sneaker'], women: ['tshirt', 'jean', 'cardigan', 'sneaker'] },
    palette: ['indigo', 'white', 'olive', 'grey'],
    note: 'Weekend: comfort without giving up shape. Fit is what separates this from loungewear.',
  },
  {
    key: 'gym',
    match: /\b(gym|workout|training|run|running|yoga|pilates)\b/i,
    formality: 1,
    slots: { men: ['tshirt', 'short', 'sneaker'], women: ['tank', 'legging', 'sneaker'] },
    palette: ['black', 'grey', 'navy'],
    note: 'Training: technical fabric only. Cotton holds sweat and is the one place natural fibre loses.',
  },
]

export function readOccasion(query: string): Occasion | null {
  // Longest-match-wins is not needed here — the patterns are disjoint by
  // construction — but order matters where a word appears twice ('christmas
  // party' is cocktail, not weekend), so the list order is the priority.
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
export function coherence(pieces: Array<{ text: string; formality?: Formality }>): number {
  if (pieces.length < 2) return 1

  const families = pieces.map(p => colorFamily(p.text)).filter(Boolean) as ColorFamily[]
  const nonNeutral = new Set(families.filter(f => f !== 'neutral'))
  // One accent against neutrals is the classic; two related families still
  // reads deliberate; three or more is where an outfit stops being an outfit.
  const colorScore = nonNeutral.size <= 1 ? 1 : nonNeutral.size === 2 ? 0.7 : 0.35

  const levels = pieces.map(p => p.formality).filter((f): f is Formality => typeof f === 'number')
  if (levels.length < 2) return colorScore
  const spread = Math.max(...levels) - Math.min(...levels)
  const formalityScore = spread <= 1 ? 1 : spread === 2 ? 0.6 : 0.25

  return +(colorScore * 0.45 + formalityScore * 0.55).toFixed(3)
}

// ── The plan ─────────────────────────────────────────────────────────────────

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
  const g = (gender || '').toLowerCase()
  // 'Both' and 'Non-binary' are real answers on the profile and neither of them
  // means "no preference between two lists". Menswear slots are the safer
  // default: every slot in them exists in both wardrobes, which is not true the
  // other way round (a gown is not a neutral suggestion).
  const slots = g.startsWith('w') ? occasion.slots.women : occasion.slots.men

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
  const g = (gender || '').toLowerCase().slice(0, 1)
  return [
    occasion?.key ?? '-',
    season ?? '-',
    family ?? '-',
    g || '-',
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
