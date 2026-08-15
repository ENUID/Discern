/**
 * The house eye.
 *
 * Sixteen outfits, chosen by Discern's owner as examples of what "right" looks
 * like. They are not decoration and they are not a mood board: they are the
 * only written record of the taste this app is supposed to have, and the judge
 * that ranks every search reads what is derived from them.
 *
 * WHY THIS EXISTS. Everything else the ranker knows is general fashion fact —
 * that cashmere has a micron count, that black tie excludes sneakers, that a
 * brown belt fights a black shoe. All true, all impersonal, and none of it
 * distinguishes a good answer from a boring one. Sixteen photographs do,
 * because they agree with each other far more than chance allows.
 *
 * HOW IT WORKS. Not training — there is no image model here and no corpus to
 * embed. Each look is written down as structured fact, the agreements between
 * them are COUNTED rather than asserted, and the counts become a short block
 * in the judge's prompt. So the rules are auditable: every claim in the block
 * below can be checked against the looks in the array, and adding a batch
 * changes the numbers without anybody rewriting prose.
 *
 * ADDING A BATCH. Append to LOOKS. Nothing else needs touching — the derived
 * stats and the prompt block follow. Rejections matter more than approvals for
 * a judge, so `verdict: 'no'` looks are worth more than another good one; see
 * the note on the type.
 */

export type Look = {
  id: string
  /** Which batch it arrived in, so a shift in taste over time stays visible. */
  batch: number
  /** Kept for when a look is sent as an example of what NOT to return. A judge
   *  learns more from a near miss that was rejected than from another hit,
   *  because the near miss is what it would otherwise have chosen. */
  verdict: 'yes' | 'no'
  /** Outermost first. */
  layers: string[]
  bottom: string
  shoes: string
  accessories: string[]
  /** The palette in plain words, in the order the eye takes them. */
  colours: string[]
  topVolume: 'fitted' | 'boxy'
  bottomVolume: 'wide' | 'straight' | 'slim'
  /** tonal — one family, low contrast. neutral-split — two neutrals against
   *  each other. accent — neutrals plus one muted colour. */
  contrast: 'tonal' | 'neutral-split' | 'accent'
  /** Does anything below the waist repeat a colour from above? */
  echo: boolean
  note: string
}

export const LOOKS: Look[] = [
  // ── batch 1 ──────────────────────────────────────────────────────────────
  {
    id: 'l01', batch: 1, verdict: 'yes',
    layers: ['sage ribbed knit polo, short sleeve, fitted'],
    bottom: 'grey pleated wide-leg trousers',
    shoes: 'black leather loafers',
    accessories: ['black leather belt', 'steel watch'],
    colours: ['sage', 'grey', 'black'],
    topVolume: 'fitted', bottomVolume: 'wide', contrast: 'accent', echo: true,
    note: 'A knit polo is the whole trick: it dresses tailored trousers down without turning them casual.',
  },
  {
    id: 'l02', batch: 1, verdict: 'yes',
    layers: ['olive chunky knit crewneck, oversized'],
    bottom: 'cream baggy jeans',
    shoes: 'green canvas low-top sneakers',
    accessories: [],
    colours: ['olive', 'cream', 'green'],
    topVolume: 'boxy', bottomVolume: 'wide', contrast: 'accent', echo: true,
    note: 'The shoe repeats the knit. Two greens and a cream is the entire palette.',
  },
  {
    id: 'l03', batch: 1, verdict: 'yes',
    layers: ['taupe crinkled linen overshirt, open', 'white t-shirt'],
    bottom: 'cream wide-leg trousers',
    shoes: 'white low-top sneakers',
    accessories: ['black sunglasses'],
    colours: ['taupe', 'white', 'cream'],
    topVolume: 'boxy', bottomVolume: 'wide', contrast: 'tonal', echo: true,
    note: 'Open shirt over a white tee — the third layer that costs nothing and makes the outfit.',
  },
  {
    id: 'l04', batch: 1, verdict: 'yes',
    layers: ['light blue cable cardigan, cropped and boxy', 'pale blue shirt'],
    bottom: 'mid-wash blue jeans',
    shoes: '',
    accessories: ['black and white neckerchief', 'cream fringed bag', 'amber sunglasses'],
    colours: ['light blue', 'pale blue', 'indigo'],
    topVolume: 'boxy', bottomVolume: 'wide', contrast: 'tonal', echo: true,
    note: 'Three blues at different depths. Tonal is not matching — it is one family, three values.',
  },

  // ── batch 2 ──────────────────────────────────────────────────────────────
  {
    id: 'l05', batch: 2, verdict: 'yes',
    layers: ['burgundy knit vest', 'white short-sleeve t-shirt'],
    bottom: 'navy pinstripe pleated wide-leg trousers',
    shoes: 'brown leather loafers',
    accessories: ['brown leather belt', 'watch', 'black sunglasses'],
    colours: ['burgundy', 'white', 'navy', 'brown'],
    topVolume: 'fitted', bottomVolume: 'wide', contrast: 'accent', echo: false,
    note: 'A vest over a tee, not over a shirt. Belt and shoe are the same brown.',
  },
  {
    id: 'l06', batch: 2, verdict: 'yes',
    layers: ['cream ribbed knit polo, short sleeve'],
    bottom: 'cream pleated wide-leg trousers',
    shoes: 'white sneakers',
    accessories: ['black sunglasses'],
    colours: ['cream'],
    topVolume: 'fitted', bottomVolume: 'wide', contrast: 'tonal', echo: true,
    note: 'One colour head to toe. The rib and the pleats are what stop it reading flat.',
  },
  {
    id: 'l07', batch: 2, verdict: 'yes',
    layers: ['black oversized t-shirt'],
    bottom: 'black baggy jeans',
    shoes: 'black sneakers',
    accessories: ['black cap', 'silver bracelet'],
    colours: ['black'],
    topVolume: 'boxy', bottomVolume: 'wide', contrast: 'tonal', echo: true,
    note: 'Monochrome black. Works only because every piece is oversized on purpose rather than by accident.',
  },
  {
    id: 'l08', batch: 2, verdict: 'yes',
    layers: ['navy shirt, sleeves rolled'],
    bottom: 'cream pleated wide-leg trousers',
    shoes: 'white low-profile sneakers',
    accessories: ['black leather belt', 'steel watch'],
    colours: ['navy', 'cream'],
    topVolume: 'boxy', bottomVolume: 'wide', contrast: 'neutral-split', echo: false,
    note: 'Navy over cream is the safest high-contrast pair there is, and it never looks loud.',
  },

  // ── batch 3 ──────────────────────────────────────────────────────────────
  {
    id: 'l09', batch: 3, verdict: 'yes',
    layers: ['mid-blue denim short-sleeve overshirt, open', 'white t-shirt'],
    bottom: 'ecru wide-leg trousers',
    shoes: 'white and gum low-top sneakers',
    accessories: ['brown leather crossbody'],
    colours: ['denim blue', 'white', 'ecru', 'brown'],
    topVolume: 'boxy', bottomVolume: 'wide', contrast: 'accent', echo: true,
    note: 'Denim used as the colour, not as the fabric of the trousers.',
  },
  {
    id: 'l10', batch: 3, verdict: 'yes',
    layers: ['olive checked knit vest', 'white shirt'],
    bottom: 'brown wide-leg trousers',
    shoes: 'brown loafers',
    accessories: ['brown leather satchel', 'patterned tie'],
    colours: ['olive', 'white', 'brown'],
    topVolume: 'fitted', bottomVolume: 'wide', contrast: 'accent', echo: true,
    note: 'Olive and brown are the same temperature; the white shirt is what keeps it from going muddy.',
  },
  {
    id: 'l11', batch: 3, verdict: 'yes',
    layers: ['light blue ribbed cardigan, oversized', 'white shirt', 'navy striped tie'],
    bottom: 'stone pleated wide-leg trousers',
    shoes: '',
    accessories: ['brown leather holdall', 'clear glasses'],
    colours: ['light blue', 'white', 'stone', 'navy'],
    topVolume: 'boxy', bottomVolume: 'wide', contrast: 'accent', echo: true,
    note: 'A tie under a slouchy cardigan. The formality mismatch is the point, not a mistake.',
  },
  {
    id: 'l12', batch: 3, verdict: 'yes',
    layers: ['ecru linen shirt, oversized, sleeves rolled'],
    bottom: 'light-wash baggy jeans',
    shoes: 'white and black terrace sneakers',
    accessories: ['watch'],
    colours: ['ecru', 'light indigo', 'white'],
    topVolume: 'boxy', bottomVolume: 'wide', contrast: 'tonal', echo: true,
    note: 'Two pale washes. Nothing here is darker than mid-tone and that is what makes it read easy.',
  },

  // ── batch 4 ──────────────────────────────────────────────────────────────
  {
    id: 'l13', batch: 4, verdict: 'yes',
    layers: ['brown waffle henley'],
    bottom: 'cream wide-leg drawstring trousers',
    shoes: 'brown and cream low-top sneakers',
    accessories: ['silver chain', 'bracelet'],
    colours: ['brown', 'cream'],
    topVolume: 'fitted', bottomVolume: 'wide', contrast: 'neutral-split', echo: true,
    note: 'The shoe carries both colours in the outfit, which is why it disappears into it.',
  },
  {
    id: 'l14', batch: 4, verdict: 'yes',
    layers: ['light blue linen shirt, open', 'white t-shirt'],
    bottom: 'black wide-leg trousers',
    shoes: 'white sneakers',
    accessories: ['black sunglasses', 'watch'],
    colours: ['light blue', 'white', 'black'],
    topVolume: 'boxy', bottomVolume: 'wide', contrast: 'accent', echo: false,
    note: 'The open shirt again, over black instead of cream. Same move, different weight.',
  },
  {
    id: 'l15', batch: 4, verdict: 'yes',
    layers: ['olive linen band-collar shirt'],
    bottom: 'ivory pleated wide-leg trousers',
    shoes: 'sand suede desert boots',
    accessories: ['sunglasses'],
    colours: ['olive', 'ivory', 'sand'],
    topVolume: 'boxy', bottomVolume: 'wide', contrast: 'accent', echo: true,
    note: 'Suede against linen. Texture is doing the work a pattern would do badly.',
  },
  {
    id: 'l16', batch: 4, verdict: 'yes',
    layers: ['brown corduroy harrington jacket', 'black shirt'],
    bottom: 'ecru wide-leg jeans',
    shoes: 'black leather loafers',
    accessories: ['black leather belt'],
    colours: ['brown', 'black', 'ecru'],
    topVolume: 'boxy', bottomVolume: 'wide', contrast: 'neutral-split', echo: true,
    note: 'Belt and shoe agree in black while the jacket goes brown — the one place mixing is allowed is above the waist.',
  },
]

// ── What the set actually agrees on ─────────────────────────────────────────
/** Counted, never asserted. Every number in the prompt block comes from here,
 *  so a claim can be checked against the looks and a new batch moves it. */
export function lookbookStats() {
  const yes = LOOKS.filter(l => l.verdict === 'yes')
  const n = yes.length || 1
  const share = (k: number) => Math.round((k / n) * 100)
  const count = (f: (l: Look) => boolean) => yes.filter(f).length

  const bottoms = new Map<string, number>()
  for (const l of yes) {
    for (const w of ['cream', 'ecru', 'ivory', 'stone', 'white', 'grey', 'navy', 'black', 'brown', 'indigo']) {
      if (l.bottom.includes(w)) bottoms.set(w, (bottoms.get(w) ?? 0) + 1)
    }
  }
  // Kept with their counts. Naming the top three as if they were equal read
  // "cream, black, ecru" off a set where cream appears five times and the
  // other two twice each — true words, false impression.
  const bottomTones = Array.from(bottoms.entries())
    .sort((a, b) => b[1] - a[1]).map(([tone, count]) => ({ tone, count }))

  return {
    n,
    wide: count(l => l.bottomVolume === 'wide'),
    wideShare: share(count(l => l.bottomVolume === 'wide')),
    thirdLayer: count(l => l.layers.length >= 2),
    thirdLayerShare: share(count(l => l.layers.length >= 2)),
    echo: count(l => l.echo),
    echoShare: share(count(l => l.echo)),
    tonal: count(l => l.contrast === 'tonal'),
    accessoriesMax: Math.max(...yes.map(l => l.accessories.length)),
    bottomTones,
    rejected: LOOKS.filter(l => l.verdict === 'no').length,
  }
}

// ── What goes UNDER what, and ON what ───────────────────────────────────────
/** The lookbook read as a pairing table.
 *
 *  HOW TO STYLE used to search the catalogue for "men trousers" whatever piece
 *  the shopper had open, so every shirt in the catalogue was offered the same
 *  trousers and the same jacket — the piece on screen never entered the query,
 *  only the re-ranking of an identical pool. The colour of the thing you are
 *  looking at is the single most useful fact for deciding what goes with it,
 *  and it was being measured and thrown away.
 *
 *  These are counted off LOOKS, not written by hand: for every look, the top's
 *  leading colour is paired with the bottom's and the shoe's. Sixteen outfits
 *  is a small sample and it is honest about that — a colour the lookbook has
 *  never seen falls back to what the set does most, which is a cream bottom
 *  and a white shoe. Adding a batch moves these without anyone editing prose.
 */
/** The colour a written look-line leads with.
 *
 *  Not the first word. "light blue linen overshirt" leads with light blue, and
 *  taking the first token gave "light" — which is not a colour, cannot be
 *  searched for, and made every layer resolve to the same non-word. Two-word
 *  colours are matched before one-word ones, and a wash is kept whole because
 *  "mid-wash" means denim. */
const COLOUR_WORDS = [
  'light blue', 'pale blue', 'mid-blue', 'light indigo', 'denim blue', 'off-white',
  'light-wash', 'mid-wash', 'dark-wash', 'light wash', 'mid wash', 'dark wash',
  'cream', 'ivory', 'ecru', 'stone', 'sand', 'taupe', 'tan', 'khaki', 'oat',
  'white', 'black', 'charcoal', 'grey', 'silver',
  'navy', 'indigo', 'blue', 'teal',
  'olive', 'sage', 'green', 'forest',
  'brown', 'chocolate', 'rust', 'burgundy', 'maroon', 'red', 'pink',
  'mustard', 'yellow', 'purple', 'lilac', 'beige',
]
const LEAD = (s: string): string => {
  const t = ` ${(s || '').toLowerCase()} `
  // Earliest in the SENTENCE, not earliest in the list above. Scanning the
  // list turned "brown leather loafers with a cream sole" into cream, because
  // cream is written earlier here — the look said brown and the table learned
  // the wrong shoe. Ties go to the longer word so "light blue" beats "blue".
  let best = '', bestAt = Infinity
  for (const w of COLOUR_WORDS) {
    const m = new RegExp(`\\b${w.replace(/[-\s]/g, '[-\\s]')}\\b`).exec(t)
    if (!m) continue
    if (m.index < bestAt || (m.index === bestAt && w.length > best.length)) {
      bestAt = m.index
      best = /wash$/.test(w) ? w.replace(/\s/g, '-') : w
    }
  }
  return best
}

export function pairingsFromLooks(): Map<string, { bottom: string[]; shoes: string[] }> {
  const out = new Map<string, { bottom: Map<string, number>; shoes: Map<string, number> }>()
  for (const l of LOOKS) {
    if (l.verdict !== 'yes') continue
    // The innermost layer is the garment actually on the torso; the outermost
    // is the coat. A shopper opening a shirt is asking about the shirt.
    const top = LEAD(l.layers[l.layers.length - 1] || '')
    if (!top) continue
    const rec = out.get(top) ?? { bottom: new Map(), shoes: new Map() }
    const b = LEAD(l.bottom), s = LEAD(l.shoes)
    if (b) rec.bottom.set(b, (rec.bottom.get(b) ?? 0) + 1)
    if (s) rec.shoes.set(s, (rec.shoes.get(s) ?? 0) + 1)
    out.set(top, rec)
  }
  const rank = (m: Map<string, number>) =>
    Array.from(m.entries()).sort((a, b) => b[1] - a[1]).map(([k]) => k)
  const final = new Map<string, { bottom: string[]; shoes: string[] }>()
  for (const [k, v] of Array.from(out.entries())) {
    final.set(k, { bottom: rank(v.bottom), shoes: rank(v.shoes) })
  }
  return final
}

/** What the set puts on TOP of everything, when it puts anything there.
 *
 *  The layer had been searching the same tone as the trousers, so every shirt
 *  in the catalogue was offered the same off-white jacket sitting above the
 *  same off-white trousers — one colour, three garments, no outfit. The looks
 *  that wear an outer layer do not do that: the layer is where the set puts
 *  its darker or earthier tone. Counted off the looks with two or more layers. */
export function outerTones(): string[] {
  const m = new Map<string, number>()
  for (const l of LOOKS) {
    if (l.verdict !== 'yes' || l.layers.length < 2) continue
    const o = LEAD(l.layers[0])
    if (o) m.set(o, (m.get(o) ?? 0) + 1)
  }
  const ranked = Array.from(m.entries()).sort((a, b) => b[1] - a[1]).map(([k]) => k)
  // The set is small; these are the tones it reaches for when it has no
  // second layer to learn from, and every one of them appears in it somewhere.
  return ranked.length ? ranked : ['navy', 'brown', 'charcoal', 'olive']
}

/** Roughly how light each tone reads, 0 black to 1 white. Only needs to be
 *  ordinally right — it decides which direction the layer moves, not a shade. */
const LIGHTNESS: Record<string, number> = {
  black: 0.05, charcoal: 0.2, navy: 0.2, indigo: 0.25, burgundy: 0.25, brown: 0.3,
  olive: 0.35, forest: 0.3, teal: 0.35, rust: 0.4, blue: 0.4, green: 0.4, red: 0.4,
  grey: 0.5, taupe: 0.5, purple: 0.4, khaki: 0.55, tan: 0.55, mustard: 0.6,
  sage: 0.62, stone: 0.65, 'mid-blue': 0.5, sand: 0.7, pink: 0.75, silver: 0.78,
  ecru: 0.82, 'light blue': 0.78, 'pale blue': 0.8, beige: 0.8,
  cream: 0.88, ivory: 0.9, 'off-white': 0.92, white: 0.96,
}
const lightnessOf = (t: string) => LIGHTNESS[t.toLowerCase()] ?? 0.5

/** The layer's tone: never the trousers', never the piece's own, and moving in
 *  the direction that leaves the outfit readable.
 *
 *  Walking a fixed list gave every piece in the catalogue the same layer — the
 *  first tone that was not already taken, which is the same tone every time.
 *  A layer is the one garment with a job beyond matching: it separates the
 *  outfit from itself. Over a pale piece it goes dark; over a dark one it goes
 *  soft; over a mid one it goes to the quiet end. That is what the looks do,
 *  and it also happens to be why the outfit stops looking like one colour. */
export function layerTone(subject: string | null, bottom: string): string {
  const taken = new Set([bottom.toLowerCase(), (subject ?? '').toLowerCase()])
  for (const kin of KIN[bottom.toLowerCase()] ?? []) taken.add(kin)

  const subjectL = subject ? lightnessOf(subject) : 0.5
  const want = subjectL > 0.66 ? 'dark' : subjectL < 0.32 ? 'soft' : 'quiet'

  const pool = outerTones().concat(['navy', 'brown', 'olive', 'charcoal', 'taupe', 'burgundy'])
    .filter(t => !taken.has(t))
  if (pool.length === 0) return 'navy'

  const score = (t: string) => {
    const l = lightnessOf(t)
    if (want === 'dark') return 1 - l          // pale piece: the darker the better
    if (want === 'soft') return l              // dark piece: lift it
    return 1 - Math.abs(l - 0.4)               // mid piece: stay in the low-middle
  }
  return pool.slice().sort((a, b) => score(b) - score(a))[0]
}

/** What the set does when it has no opinion about a specific colour — the
 *  most-used bottom tone and the most-used shoe across every look. */
export function houseDefault(): { bottom: string; shoes: string } {
  const bottoms = new Map<string, number>(), shoes = new Map<string, number>()
  for (const l of LOOKS) {
    if (l.verdict !== 'yes') continue
    const b = LEAD(l.bottom), s = LEAD(l.shoes)
    if (b) bottoms.set(b, (bottoms.get(b) ?? 0) + 1)
    if (s) shoes.set(s, (shoes.get(s) ?? 0) + 1)
  }
  const top = (m: Map<string, number>, fallback: string) =>
    Array.from(m.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? fallback
  return { bottom: top(bottoms, 'cream'), shoes: top(shoes, 'white') }
}

/** Colours that read as the same tone to a shopper, so a lookup for one can
 *  answer with another's row. Keeps a sixteen-look table from being empty for
 *  most of the catalogue. */
const KIN: Record<string, string[]> = {
  cream: ['ecru', 'ivory', 'off-white', 'sand', 'stone', 'oat', 'beige'],
  ecru: ['cream', 'ivory', 'sand', 'stone'],
  white: ['cream', 'ecru', 'ivory'],
  black: ['charcoal'],
  charcoal: ['black', 'grey'],
  grey: ['charcoal', 'black', 'silver', 'stone'],
  navy: ['indigo', 'blue'],
  blue: ['navy', 'indigo', 'light blue'],
  'light blue': ['blue', 'pale'],
  olive: ['sage', 'khaki', 'green'],
  sage: ['olive', 'green'],
  green: ['olive', 'sage'],
  brown: ['tan', 'taupe', 'rust', 'chocolate'],
  tan: ['brown', 'sand', 'taupe'],
  taupe: ['brown', 'stone', 'tan'],
  burgundy: ['rust', 'red'],
}

/** What to put below, and on the feet, given the colour of the piece on
 *  screen. Its own row first, then a kindred colour's row, then the house
 *  default — so the answer is always specific enough to search for. */
/** A denim wash is not a colour word — nobody's catalogue has a "light-wash
 *  trouser" — but it is exactly the right instruction once it says denim. */
function searchable(tone: string): string {
  const m = /^(light|mid|dark)-?wash$/.exec(tone)
  return m ? `${m[1]} wash denim` : tone
}

export function partnersFor(colour: string | null):
  { bottom: string; shoes: string; source: 'own' | 'kin' | 'default' } {
  const table = pairingsFromLooks()
  const fallback = houseDefault()
  if (!colour) return { ...fallback, source: 'default' }
  const key = colour.toLowerCase()

  const take = (r: { bottom: string[]; shoes: string[] }, source: 'own' | 'kin') => ({
    bottom: searchable(r.bottom[0] ?? fallback.bottom),
    shoes: r.shoes[0] ?? fallback.shoes,
    source,
  })

  const row = table.get(key)
  if (row && (row.bottom.length || row.shoes.length)) return take(row, 'own')
  for (const kin of KIN[key] ?? []) {
    const r = table.get(kin)
    if (r && (r.bottom.length || r.shoes.length)) return take(r, 'kin')
  }
  return { ...fallback, source: 'default' }
}

/** The house does wear a colour against itself — five of the sixteen looks are
 *  tonal, and black on black is one of them. So this only steps sideways when
 *  the pairing came from the DEFAULT rather than from a look: repeating a
 *  colour the lookbook chose is taste, repeating one nobody chose is an
 *  accident. */
export function avoidSameAs(
  colour: string | null, partner: string, source: 'own' | 'kin' | 'default' = 'default',
): string {
  if (!colour || source === 'own') return partner
  const a = colour.toLowerCase(), b = partner.toLowerCase()
  if (a !== b && !(KIN[a] ?? []).includes(b)) return partner
  // Cream is the set's workhorse below the waist; when the top IS cream, the
  // looks reach for a mid-wash denim or a navy instead.
  if (a === 'cream' || a === 'ecru' || a === 'white') return 'navy'
  return houseDefault().bottom
}

/** The house eye, as the judge reads it.
 *
 *  Deliberately short. It sits alongside four blocks of general fashion
 *  knowledge and a scoring rubric, and a prompt that buries its rubric under
 *  an essay gets a worse answer, not a better one.
 *
 *  The guard in the last line is load-bearing. Sixteen looks all wear a wide
 *  leg; encoded without it, that becomes "never show a slim trouser", which
 *  would make the app narrower rather than better. A stated preference beats
 *  the house every time. */
export function houseTaste(): string {
  const s = lookbookStats()
  return `━━━ THE HOUSE EYE ━━━
Discern has a point of view. It is drawn from ${s.n} outfits its buyer marked as right, and it decides the OPEN questions — which of two equally correct pieces to put first.
PROPORTION: ${s.wide} of ${s.n} pair a wide, pleated or baggy leg with a top that is either fitted or boxy. Volume belongs below the waist. Against an open ask, a tapered or skinny leg is the weaker answer and a wide or pleated one the stronger.
PALETTE: neutrals carry the outfit and at most one muted colour joins them — sage, olive, burgundy, taupe, navy, washed blue. The bottom half is ${s.bottomTones[0].tone} in ${s.bottomTones[0].count} of ${s.n}, and otherwise ${s.bottomTones.slice(1, 4).map(b => b.tone).join(', ')}. Saturated brights, high-shine synthetics and anything neon score badly here whatever else is right about them.
ECHO: ${s.echo} of ${s.n} repeat a colour from above somewhere below — the shoe, the belt, the bag. A piece that could do that for an outfit already on screen is worth more than one that cannot.
LAYERS: ${s.thirdLayer} of ${s.n} carry a third piece — a knit vest, an open overshirt over a plain tee, a cardigan. Pieces that layer are worth more than pieces that can only be worn alone.
SURFACE: texture instead of print. Rib, waffle, cable, corduroy, slub linen, denim, suede. No graphics, no slogans, no visible logos in any of the ${s.n}.
RESTRAINT: at most ${s.accessoriesMax} small accessories, and leather agrees with leather.
This is a tiebreaker, not a filter. When the shopper names a cut, a colour or a fibre, their words win outright — the house eye only decides what they left open.`
}
