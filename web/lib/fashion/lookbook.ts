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
