/**
 * What a garment actually is.
 *
 * Everything this app knows about a piece of clothing today is a title, some
 * tags, a price, a paragraph of marketing copy, and one dominant colour read
 * off the photograph. Everything built on top of that — the lookbook pairings,
 * the colour matching, the outfit composition — is a PROXY for knowledge we do
 * not have. Colour standing in for taste. Keywords standing in for register.
 * Proxies do not stack into understanding, which is why the outfits come out
 * technically coordinated and obviously wrong to anyone with an eye.
 *
 * Nothing prevented us knowing more. A vision model can read the cut, the fit,
 * the weight of the cloth, the collar, the pattern scale and the register
 * straight off the photograph. The step simply did not exist.
 *
 * READ ONCE, KEPT FOREVER. This is deliberately not a query-time call. A vision
 * call per product per search would be unaffordable and slow; a vision call per
 * product ONCE, cached, is neither. Every search afterwards reasons over
 * structured fact instead of guessing from a title.
 *
 * EVERY FIELD IS AN ENUM, and that is the point. "Relaxed" and "boxy" and
 * "mid-weight" can be compared, scored and reasoned about by a machine.
 * A sentence of prose about the drape cannot. The whole reason this exists is
 * to let outfit composition ask the questions a stylist asks — does the volume
 * balance, is the formality within a step, do two patterns fight at the same
 * scale, is the cloth right for the season — and each of those is a comparison
 * between two known values, not a search for a word.
 */

/** Versions, because a cached profile is only trustworthy while the thing that
 *  produced it is unchanged.
 *
 *  §15 of the build spec asks for a cache identity of product + image + schema
 *  + prompt + model, and it is right: a profile read by an older prompt against
 *  an older field set is not the same answer, and silently reusing it is how a
 *  cache becomes a source of stale wrong data rather than a saving.
 *
 *  BUMP SCHEMA when a field is added, removed or its values change.
 *  BUMP PROMPT when PROFILE_SYSTEM or profilePrompt() changes what is asked.
 *  Either bump invalidates every stored profile by changing the key — no
 *  migration, no deletion, the old rows simply stop being addressed and age
 *  out. */
export const PROFILE_SCHEMA_VERSION = 1
export const PROFILE_PROMPT_VERSION = 1

export type Fit = 'slim' | 'regular' | 'relaxed' | 'oversized' | 'wide'
export type Volume = 'fitted' | 'boxy'
export type Weight = 'light' | 'mid' | 'heavy'
export type Drape = 'crisp' | 'fluid' | 'structured'
export type PatternKind =
  | 'plain' | 'stripe' | 'check' | 'floral' | 'geometric' | 'abstract' | 'texture'
export type PatternScale = 'none' | 'small' | 'medium' | 'large'
export type Aesthetic =
  | 'tailored' | 'classic' | 'minimal' | 'workwear' | 'streetwear'
  | 'artisanal' | 'sport' | 'resort' | 'romantic'
export type Season = 'summer' | 'winter' | 'transitional' | 'all'

export type GarmentProfile = {
  /** shirt, trouser, loafer … the specific garment, not the slot. */
  garment: string
  fit: Fit
  /** How it reads on a body. The lookbook records this for all sixteen looks,
   *  and volume balance — boxy over wide, fitted over wide — is one of the few
   *  rules those looks agree on almost unanimously. */
  volume: Volume
  /** The cloth, named. */
  fabric: string
  weight: Weight
  drape: Drape
  pattern: PatternKind
  patternScale: PatternScale
  /** Precise, not approximate: ecru rather than white, mid-wash indigo rather
   *  than blue. The palette reader measures a dominant RGB; this NAMES it, and
   *  a name is what a person and a search both use. */
  colour: string
  /** 1 gym, 2 casual, 3 smart casual, 4 formal, 5 black tie. The single most
   *  useful number in an outfit: pieces more than one step apart do not belong
   *  together, whatever their colours do. */
  formality: 1 | 2 | 3 | 4 | 5
  aesthetic: Aesthetic
  season: Season
  /** Collar, sleeve, closure, rise, leg — whatever the photograph actually
   *  shows. Short phrases, at most four. */
  details: string[]
  /** Named fibre grade, stated weight, real construction and hardware over
   *  generic filler. 0 when the photograph and the copy say nothing. */
  quality: 0 | 1 | 2 | 3
  /** Which model read it, and when. A profile is only as good as the pass that
   *  produced it, and a bad batch has to be findable and re-runnable. */
  readBy?: string
  readAt?: number
}

/** The instruction. Kept here beside the type so the two can never drift: every
 *  field below appears in the schema above, in the same order, with the same
 *  words for the same values. */
export const PROFILE_SYSTEM =
  'You are a garment analyst. You look at a photograph of one piece of clothing ' +
  'and record what it is, as structured JSON. You never guess beyond what the ' +
  'photograph and the copy support, and you only ever output JSON.'

export function profilePrompt(title: string, description: string): string {
  return (
    `This is one product. Read the photograph first; the words are supporting evidence.\n\n` +
    `TITLE: ${title}\n` +
    `COPY: ${String(description || '').slice(0, 400)}\n\n` +
    `Return ONLY this JSON, using EXACTLY these allowed values:\n` +
    `{\n` +
    `  "garment": "<shirt|t-shirt|polo|sweater|cardigan|jacket|blazer|coat|vest|` +
    `trouser|jean|chino|short|skirt|dress|jumpsuit|sneaker|loafer|boot|derby|sandal|bag|belt|hat|scarf>",\n` +
    `  "fit": "<slim|regular|relaxed|oversized|wide>",\n` +
    `  "volume": "<fitted|boxy>",\n` +
    `  "fabric": "<one word: linen, cotton, wool, denim, leather, silk, cashmere, ` +
    `corduroy, canvas, jersey, suede, velvet, nylon, blend>",\n` +
    `  "weight": "<light|mid|heavy>",\n` +
    `  "drape": "<crisp|fluid|structured>",\n` +
    `  "pattern": "<plain|stripe|check|floral|geometric|abstract|texture>",\n` +
    `  "patternScale": "<none|small|medium|large>",\n` +
    `  "colour": "<precise colour name, two words at most: ecru, mid-wash indigo, ` +
    `dark olive, charcoal>",\n` +
    `  "formality": <1 gym, 2 casual, 3 smart casual, 4 formal, 5 black tie>,\n` +
    `  "aesthetic": "<tailored|classic|minimal|workwear|streetwear|artisanal|sport|resort|romantic>",\n` +
    `  "season": "<summer|winter|transitional|all>",\n` +
    `  "details": ["at most four short phrases: camp collar, short sleeve, ` +
    `patch pocket, pleated front, wide leg, zip through"],\n` +
    `  "quality": <0 nothing stated, 1 basic, 2 good fibre or construction named, ` +
    `3 exceptional cloth or handwork>\n` +
    `}\n\n` +
    `Judge the GARMENT, never the model wearing it or the background. ` +
    `If the photograph is a screenshot, ignore every interface element. ` +
    `Where the photograph and the copy disagree, believe the photograph.`
  )
}

const ONE_OF = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  (typeof v === 'string' && (allowed as readonly string[]).includes(v.toLowerCase())
    ? (v.toLowerCase() as T) : fallback)

/** A model's answer, made safe. Anything unrecognised falls to the middle
 *  rather than throwing the profile away — a garment with one wrong field is
 *  far more useful than no garment at all. */
export function parseProfile(raw: string): GarmentProfile | null {
  try {
    const m = raw.match(/\{[\s\S]*\}/)
    if (!m) return null
    const o = JSON.parse(m[0]) as Record<string, unknown>
    const garment = typeof o.garment === 'string' ? o.garment.toLowerCase().trim() : ''
    if (!garment) return null
    const n = Number(o.formality)
    const q = Number(o.quality)
    return {
      garment,
      fit: ONE_OF(o.fit, ['slim', 'regular', 'relaxed', 'oversized', 'wide'] as const, 'regular'),
      volume: ONE_OF(o.volume, ['fitted', 'boxy'] as const, 'fitted'),
      fabric: typeof o.fabric === 'string' ? o.fabric.toLowerCase().trim() : 'blend',
      weight: ONE_OF(o.weight, ['light', 'mid', 'heavy'] as const, 'mid'),
      drape: ONE_OF(o.drape, ['crisp', 'fluid', 'structured'] as const, 'crisp'),
      pattern: ONE_OF(o.pattern, ['plain', 'stripe', 'check', 'floral', 'geometric', 'abstract', 'texture'] as const, 'plain'),
      patternScale: ONE_OF(o.patternScale, ['none', 'small', 'medium', 'large'] as const, 'none'),
      colour: typeof o.colour === 'string' ? o.colour.toLowerCase().trim().slice(0, 24) : '',
      formality: (Number.isFinite(n) && n >= 1 && n <= 5 ? Math.round(n) : 3) as GarmentProfile['formality'],
      aesthetic: ONE_OF(o.aesthetic, ['tailored', 'classic', 'minimal', 'workwear', 'streetwear', 'artisanal', 'sport', 'resort', 'romantic'] as const, 'classic'),
      season: ONE_OF(o.season, ['summer', 'winter', 'transitional', 'all'] as const, 'all'),
      details: Array.isArray(o.details)
        ? o.details.filter((d): d is string => typeof d === 'string').map(d => d.toLowerCase().trim()).slice(0, 4)
        : [],
      quality: (Number.isFinite(q) && q >= 0 && q <= 3 ? Math.round(q) : 0) as GarmentProfile['quality'],
    }
  } catch {
    return null
  }
}

// ── What the profiles are FOR ───────────────────────────────────────────────
/** Do these two pieces belong in one outfit? 0 to 1.
 *
 *  This is the question the whole file exists to answer, and the reason the
 *  fields are enums. Every term below is a comparison between two known values
 *  — not a keyword search, not a colour histogram. It is what a person means
 *  when they look at a shirt and a trouser and say those work.
 *
 *  Colour is deliberately NOT here. It is handled by the palette and the
 *  lookbook's counted pairings, and it was the only thing being considered
 *  before this existed — which is precisely the complaint. A green that goes
 *  with a cream does not make a gym short and a dinner jacket an outfit.
 */
export function worksWith(a: GarmentProfile, b: GarmentProfile): number {
  // Formality. Pieces more than one step apart do not belong together whatever
  // else agrees — a sneaker with black tie, a hoodie at an interview.
  const gap = Math.abs(a.formality - b.formality)
  const formality = gap === 0 ? 1 : gap === 1 ? 0.85 : gap === 2 ? 0.4 : 0.05

  // Volume. Thirteen of the sixteen reference looks pair a boxy or fitted top
  // with a wide or straight leg; what none of them do is slim against slim, or
  // oversized against oversized.
  const wideBottom = b.fit === 'wide' || b.fit === 'relaxed' || b.fit === 'oversized'
  const slimBottom = b.fit === 'slim'
  const volume = a.volume === 'boxy'
    ? (wideBottom ? 0.9 : slimBottom ? 0.45 : 0.75)
    : (wideBottom ? 1 : 0.8)

  // Two loud patterns at the same scale fight; a pattern against a plain is the
  // shape almost every good look takes.
  const bothPatterned = a.pattern !== 'plain' && b.pattern !== 'plain'
  const sameScale = a.patternScale === b.patternScale && a.patternScale !== 'none'
  const pattern = !bothPatterned ? 1 : sameScale ? 0.25 : 0.55

  // Cloth. A heavy winter tweed over a light summer linen is two seasons in one
  // outfit; and weights that differ by a whole step read as borrowed clothes.
  const wOrder = { light: 0, mid: 1, heavy: 2 } as const
  const wGap = Math.abs(wOrder[a.weight] - wOrder[b.weight])
  const seasonClash = (a.season === 'summer' && b.season === 'winter')
    || (a.season === 'winter' && b.season === 'summer')
  const cloth = (wGap === 0 ? 1 : wGap === 1 ? 0.8 : 0.45) * (seasonClash ? 0.4 : 1)

  // Register. Workwear with tailoring is a deliberate move and rarely an
  // accident; most mismatches here are simply two different wardrobes.
  const FAMILY: Record<Aesthetic, string> = {
    tailored: 'smart', classic: 'smart', minimal: 'smart', romantic: 'smart',
    workwear: 'rugged', artisanal: 'rugged',
    streetwear: 'casual', sport: 'casual', resort: 'casual',
  }
  const aesthetic = a.aesthetic === b.aesthetic ? 1
    : FAMILY[a.aesthetic] === FAMILY[b.aesthetic] ? 0.85 : 0.5

  // A weighted sum alone was wrong, and the test that proved it was worth more
  // than the code: a large floral shirt with large check trousers scored 0.83,
  // and a summer linen shirt with heavy winter tweed scored 0.78. Both are
  // outfits nobody would wear, and both scored well because a sum lets four
  // agreeable terms outvote one catastrophic one.
  //
  // Real styling does not average. Some mismatches are not deductions, they are
  // disqualifications — and a disqualification has to multiply, not subtract.
  const base = formality * 0.34 + volume * 0.2 + pattern * 0.18 + cloth * 0.16 + aesthetic * 0.12

  let penalty = 1
  // Three steps of formality apart is a different occasion, not a bolder
  // choice: gym shorts with a dinner jacket.
  if (gap >= 3) penalty *= 0.15
  // Two loud patterns at the same scale are the one combination the reference
  // looks never make. Small against small is a texture; large against large is
  // a collision.
  if (bothPatterned && sameScale && (a.patternScale === 'medium' || a.patternScale === 'large')) penalty *= 0.4
  // Summer cloth with winter cloth is two seasons in one outfit however well
  // the colours behave.
  if (seasonClash) penalty *= 0.45
  // Light against heavy reads as borrowed clothes even inside one season.
  if (wGap >= 2) penalty *= 0.75

  return Math.max(0, Math.min(1, +(base * penalty).toFixed(3)))
}
