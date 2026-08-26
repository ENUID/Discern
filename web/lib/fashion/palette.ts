/**
 * What colour a garment actually is, read from its photograph.
 *
 * WHY THIS EXISTS. Outfit coherence — whether the pieces on a page go together
 * — was decided by reading colour words out of product titles. Measured across
 * 592 products from five brands, only 33% of titles name a colour at all. The
 * rest are "Rare Rabbit Men's Dream-26 Dusky P…", "KUNAL", "GUDDU", "X Lows
 * CHESTNUT". So on two thirds of the catalogue the thing deciding what goes
 * with what was simply blind, and blind in a way nothing reported.
 *
 * The photograph is right there and it is not ambiguous. This reads it.
 *
 * NO MODEL. This is arithmetic on pixels, which matters for two reasons: it
 * costs nothing per product, and it works whether or not any provider is
 * answering — unlike everything else that was supposed to be handling taste.
 *
 * THE BACKGROUND IS THE HARD PART. A product shot is mostly backdrop, so the
 * naive answer to "what colour is this shirt" is always "white". The corners
 * are sampled to learn the backdrop, every pixel close to it is discarded, and
 * what remains is the garment (plus, on model shots, some skin and hair — hence
 * the skin filter below).
 */

import sharp from 'sharp'
import { BoundedCache } from '../boundedCache'
import { safeFetch } from '../ssrfGuard'

export type Rgb = { r: number; g: number; b: number }
export type Family = 'neutral' | 'earth' | 'cool' | 'warm' | 'jewel' | 'pastel'

export type Palette = {
  /** Most-covering first. Usually one or two on a plain garment. */
  colours: Rgb[]
  /** The families those colours belong to, deduped, most-covering first. */
  families: Family[]
  /** How many distinct hues carry real area. A plain shirt is 1; a paisley
   *  print is 4 or 5, which is a usable print detector on its own. */
  variety: number
  /** True when the garment reads as a single flat colour — the shape most of
   *  the reference lookbook is made of. */
  plain: boolean
}

// ── colour space ────────────────────────────────────────────────────────────
function toHsl({ r, g, b }: Rgb): { h: number; s: number; l: number } {
  const R = r / 255, G = g / 255, B = b / 255
  const max = Math.max(R, G, B), min = Math.min(R, G, B)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = (max === R ? ((G - B) / d + (G < B ? 6 : 0))
    : max === G ? (B - R) / d + 2
    : (R - G) / d + 4) * 60
  return { h, s, l }
}

const dist = (a: Rgb, b: Rgb) =>
  Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2)

/** Skin, roughly. Model shots are half arms and face, and a tan forearm reads
 *  as "earth" and quietly makes every outfit look coordinated. Deliberately
 *  generous — losing a genuinely skin-toned garment costs less than treating
 *  every model's arms as the product. */
function looksLikeSkin(c: Rgb): boolean {
  const { h, s, l } = toHsl(c)
  return h >= 5 && h <= 45 && s > 0.15 && s < 0.72 && l > 0.28 && l < 0.82
}

/** Which family a measured colour belongs to. The same six the written
 *  vocabulary uses, so a colour read from a photograph and one read from a
 *  title are interchangeable downstream. */
export function familyOf(c: Rgb): Family {
  const { h, s, l } = toHsl(c)
  // Anything this desaturated is a neutral whatever its hue says — black,
  // white, grey, stone, charcoal, ecru.
  if (s < 0.12 || l < 0.08 || l > 0.94) return 'neutral'
  // Cream, ivory, bone, oat. Measured, these carry a real warm hue and enough
  // saturation to escape the test above — a cream sneaker came back "warm",
  // which would have it fighting a rust trouser it actually sits beside
  // perfectly. Very light and only faintly coloured IS a neutral.
  if (l > 0.80 && s < 0.45) return 'neutral'
  // The same at the other end: near-black with a cast to it is still black.
  if (l < 0.18 && s < 0.50) return 'neutral'
  if (s < 0.28 && l > 0.62) return 'pastel'
  if (h < 20 || h >= 330) return s > 0.55 ? 'warm' : 'earth'      // reds
  if (h < 45) return l < 0.45 ? 'earth' : 'warm'                  // orange / tan
  if (h < 70) return s > 0.5 && l > 0.5 ? 'warm' : 'earth'        // mustard / khaki
  if (h < 165) return l < 0.35 ? 'jewel' : 'earth'                // greens: forest vs olive
  if (h < 200) return 'jewel'                                     // teal
  if (h < 260) return 'cool'                                      // blues, navy, indigo
  return l < 0.4 ? 'jewel' : 'pastel'                             // purples
}

// ── naming a colour ─────────────────────────────────────────────────────────
/** The six families are the right grain for "do these fight", and the wrong
 *  grain for everything else. An olive shirt measures rgb(57,59,49) and a
 *  charcoal one rgb(57,57,58); both are desaturated and dark, so both land in
 *  'neutral' and become indistinguishable — which is why HOW TO STYLE offered
 *  the same trousers for every shirt in the catalogue. A family cannot be put
 *  into a search query either: nobody sells "a neutral trouser".
 *
 *  So a colour also gets a NAME, by nearest neighbour against the words the
 *  lookbook itself uses and stores actually print. A name survives into a
 *  query, and two shirts that differ get different names even when they share
 *  a family. */
const NAMED: [string, Rgb][] = [
  ['black',    { r: 26,  g: 26,  b: 28  }],
  ['charcoal', { r: 62,  g: 64,  b: 68  }],
  ['grey',     { r: 138, g: 140, b: 143 }],
  ['silver',   { r: 198, g: 200, b: 203 }],
  ['white',    { r: 246, g: 246, b: 244 }],
  ['cream',    { r: 236, g: 226, b: 203 }],
  ['ecru',     { r: 214, g: 205, b: 184 }],
  ['sand',     { r: 200, g: 180, b: 146 }],
  ['stone',    { r: 176, g: 168, b: 152 }],
  ['taupe',    { r: 146, g: 133, b: 118 }],
  ['tan',      { r: 176, g: 137, b: 94  }],
  ['brown',    { r: 108, g: 78,  b: 54  }],
  ['rust',     { r: 158, g: 78,  b: 44  }],
  ['burgundy', { r: 106, g: 40,  b: 50  }],
  ['red',      { r: 186, g: 48,  b: 44  }],
  ['pink',     { r: 226, g: 166, b: 176 }],
  ['mustard',  { r: 200, g: 160, b: 56  }],
  ['khaki',    { r: 158, g: 148, b: 104 }],
  ['olive',    { r: 96,  g: 98,  b: 62  }],
  ['sage',     { r: 156, g: 168, b: 140 }],
  ['green',    { r: 74,  g: 118, b: 74  }],
  ['teal',     { r: 56,  g: 118, b: 118 }],
  ['light blue', { r: 168, g: 196, b: 222 }],
  ['blue',     { r: 58,  g: 102, b: 170 }],
  ['navy',     { r: 38,  g: 48,  b: 78  }],
  ['indigo',   { r: 62,  g: 72,  b: 118 }],
  ['purple',   { r: 106, g: 76,  b: 140 }],
]

/** The nearest name to a measured colour. Plain nearest-neighbour in RGB is
 *  crude, but the anchors are spaced by how stores talk rather than evenly
 *  through the cube, which is what makes it land on the right word. */
export function nameOf(c: Rgb): string {
  let best = NAMED[0][0], bestD = Infinity
  for (const [name, ref] of NAMED) {
    const d = dist(c, ref)
    if (d < bestD) { bestD = d; best = name }
  }
  return best
}

/** What to call this garment's colour, preferring what the store WROTE over
 *  what the photograph measures.
 *
 *  A title that says "Olive" is ground truth: the brand chose the word and the
 *  shopper reads the same word. The photograph is the fallback for the two
 *  thirds of this catalogue that name no colour at all — lighting, shadow and
 *  a grey backdrop all push a measured colour around, and a stated one has
 *  none of those problems. */
export function colourNameFor(title: string, p: Palette | null): string | null {
  const hay = ` ${(title || '').toLowerCase()} `
  // Longest first, so "light blue" wins over "blue" and "off-white" over "white".
  const words = NAMED.map(n => n[0]).concat(['off-white', 'ivory', 'beige', 'maroon', 'lilac'])
    .sort((a, b) => b.length - a.length)
  for (const w of words) {
    if (new RegExp(`\\b${w.replace(/[-\s]/g, '[-\\s]')}\\b`).test(hay)) {
      // Fold the synonyms onto a name the pairing table knows.
      if (w === 'off-white' || w === 'ivory') return 'cream'
      if (w === 'beige') return 'ecru'
      if (w === 'maroon') return 'burgundy'
      if (w === 'lilac') return 'purple'
      return w
    }
  }
  if (p?.colours?.length) return nameOf(p.colours[0])
  return null
}

// ── the read ────────────────────────────────────────────────────────────────
/** Shopify serves any width from the same URL, so ask for a thumbnail rather
 *  than a 2048px photograph we immediately throw away. */
function small(src: string, px = 64): string {
  try {
    const u = new URL(src.startsWith('//') ? `https:${src}` : src)
    if (/cdn\.shopify|shopifycdn/.test(u.hostname) || u.pathname.includes('/cdn/shop/')) {
      u.searchParams.set('width', String(px))
      u.searchParams.delete('height')
    }
    return u.toString()
  } catch { return src }
}

/** How much of a photograph is worth downloading to read four colours off it.
 *
 *  A Shopify image arrives already narrowed — parseProduct runs image_url
 *  through normalizeImageUrl (?width=400, ~20-40KB) and small() below asks for
 *  64px on top of that. Nothing rewrites a non-Shopify CDN, so those still
 *  arrive as the multi-MB original, and a cap that rejected them would quietly
 *  stop colour working for a slice of the catalogue.
 *
 *  Five megabytes covers a 2048px original with room to spare, and bounds the
 *  worst case: palettesFor runs twelve of these at once, so this is the
 *  difference between 60MB in flight and no ceiling at all. Beyond it, the
 *  bytes are not a product photograph — and this whole function throws all but
 *  48x48 of them away regardless. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

export async function paletteOf(imageUrl: string, timeoutMs = 6000): Promise<Palette | null> {
  if (!imageUrl) return null
  let buf: Buffer
  try {
    // safeFetch, not fetch. This URL is not ours: it reaches here from a
    // store's own catalogue AND, through /api/style-with, straight out of an
    // unauthenticated request body — so before this it was a way to make the
    // server fetch 169.254.169.254 on request. Every hop is checked and the
    // body stops at the cap; a blocked destination, an oversized image and an
    // unreachable host all throw, and the catch below turns every one of them
    // into the null this function already returned for a bad image.
    const res = await safeFetch(small(imageUrl), { signal: AbortSignal.timeout(timeoutMs) }, { maxBytes: MAX_IMAGE_BYTES })
    if (!res.ok) return null
    buf = Buffer.from(await res.arrayBuffer())
  } catch { return null }

  let px: Buffer, w: number, h: number
  try {
    // Down to a postage stamp on purpose. Colour survives; JPEG noise, weave
    // and stitching do not, and 48x48 is 2,304 pixels to walk instead of four
    // million.
    const out = await sharp(buf).resize(48, 48, { fit: 'inside' }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    px = out.data; w = out.info.width; h = out.info.height
  } catch { return null }

  // ── where the garment is ──────────────────────────────────────────────
  // The first version measured the whole photograph and every shirt came back
  // "busy, variety 2-3" — a plain white shirt scoring the same as a yellow
  // plaid, which made the whole signal useless for ranking. The reason is that
  // a model shot is mostly NOT the garment: hair, face, trousers, shoes, floor
  // and backdrop all contributed colours, so what was being measured was the
  // photograph rather than the thing for sale.
  //
  // Product photography puts the product in the middle. Reading only the
  // central band throws away most of the hair, the floor and the surroundings,
  // and on a full-length shot lands on the torso — which is the garment on a
  // top and still mostly garment on a trouser.
  const x0 = Math.floor(w * 0.22), x1 = Math.ceil(w * 0.78)
  const y0 = Math.floor(h * 0.24), y1 = Math.ceil(h * 0.76)

  const at = (x: number, y: number): Rgb => {
    const i = (y * w + x) * 3
    return { r: px[i], g: px[i + 1], b: px[i + 2] }
  }

  // The backdrop, learned from the corners rather than assumed to be white —
  // plenty of these brands shoot on grey, sand or black.
  const corners = [at(0, 0), at(w - 1, 0), at(0, h - 1), at(w - 1, h - 1)]
  const bg: Rgb = {
    r: Math.round(corners.reduce((s, c) => s + c.r, 0) / 4),
    g: Math.round(corners.reduce((s, c) => s + c.g, 0) / 4),
    b: Math.round(corners.reduce((s, c) => s + c.b, 0) / 4),
  }
  // Only treat the corners as a backdrop if they agree with each other. On a
  // flat-lay that fills the frame they will not, and then nothing is dropped.
  const backdropIsFlat = corners.every(c => dist(c, bg) < 34)

  // Quantise into coarse bins. Fine enough to keep navy apart from black,
  // coarse enough that a gradient across a sleeve stays one colour.
  // Coarser than it was. At 32 a sleeve's shadow counted as a second colour on
  // a plain shirt, which is precisely the noise that flattened the signal.
  const BIN = 52
  const bins = new Map<string, { sum: Rgb; n: number }>()
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const c = at(x, y)
      if (backdropIsFlat && dist(c, bg) < 40) continue
      if (looksLikeSkin(c)) continue
      const key = `${Math.round(c.r / BIN)}|${Math.round(c.g / BIN)}|${Math.round(c.b / BIN)}`
      const e = bins.get(key) ?? { sum: { r: 0, g: 0, b: 0 }, n: 0 }
      e.sum.r += c.r; e.sum.g += c.g; e.sum.b += c.b; e.n++
      bins.set(key, e)
    }
  }

  const total = Array.from(bins.values()).reduce((s, e) => s + e.n, 0)
  // Almost everything was backdrop or skin: a packshot of something tiny, or a
  // photograph we cannot read. Saying nothing beats guessing.
  if (total < 40) return null

  const ranked = Array.from(bins.values())
    .map(e => ({
      colour: { r: Math.round(e.sum.r / e.n), g: Math.round(e.sum.g / e.n), b: Math.round(e.sum.b / e.n) },
      share: e.n / total,
    }))
    .sort((a, b) => b.share - a.share)

  // A colour has to hold an eighth of the garment to count as one of its
  // colours. At a twelfth, a shadow under a collar and a hair fall counted,
  // and every plain shirt on a model came back with four colours — which
  // would make "is this a print" useless. Below this it is a button, a label
  // or a shadow.
  const real = ranked.filter(c => c.share >= 0.12).slice(0, 5)
  const colours = (real.length ? real : ranked.slice(0, 1)).map(c => c.colour)

  const families: Family[] = []
  for (const c of colours) {
    const f = familyOf(c)
    if (!families.includes(f)) families.push(f)
  }

  return {
    colours,
    families,
    variety: real.length,
    // One dominant colour holding more than half the garment is what "plain"
    // means to a person looking at it.
    plain: ranked[0].share >= 0.42 && real.length <= 2,
  }
}


// ── remembering ─────────────────────────────────────────────────────────────
/** A garment's colour does not change, so this is read once per photograph and
 *  then never again. That is what makes it affordable to do at all: the cost
 *  is per PRODUCT, not per search, and the second time a shirt appears it is
 *  free. `null` is cached too — an unreadable photograph stays unreadable, and
 *  retrying it on every search would be the whole expense with none of the
 *  benefit. */
const cache = new BoundedCache<string, Palette | null>(6000)

export async function paletteCached(imageUrl: string): Promise<Palette | null> {
  if (!imageUrl) return null
  if (cache.has(imageUrl)) return cache.get(imageUrl) ?? null
  const pal = await paletteOf(imageUrl)
  cache.set(imageUrl, pal)
  return pal
}

/** Several at once, bounded so a page of candidates cannot open sixty sockets.
 *  Order is preserved so callers can zip the result back onto their products. */
export async function palettesFor(urls: string[], concurrency = 8): Promise<(Palette | null)[]> {
  const out: (Palette | null)[] = new Array(urls.length).fill(null)
  let next = 0
  const worker = async () => {
    for (;;) {
      const i = next++
      if (i >= urls.length) return
      out[i] = await paletteCached(urls[i]).catch(() => null)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker))
  return out
}

// ── does it go with it ──────────────────────────────────────────────────────
/** How well two garments sit together, 0–1, from what they actually look like.
 *
 *  The rules are the lookbook's, counted rather than invented: neutrals go with
 *  anything, one accent against neutrals is the classic, two accents from the
 *  same family still reads deliberate, and two unrelated accents is where an
 *  outfit stops being one. The echo — a colour repeated between the two pieces
 *  — is the bonus, because thirteen of the sixteen reference looks do it. */
export function goesWith(a: Palette | null, b: Palette | null): number {
  if (!a || !b) return 0.5                       // unknown is not wrong
  const accentsA = a.families.filter(f => f !== 'neutral')
  const accentsB = b.families.filter(f => f !== 'neutral')

  let score: number
  if (accentsA.length === 0 || accentsB.length === 0) score = 1        // one side neutral
  else if (accentsA.some(f => accentsB.includes(f))) score = 0.9       // same family
  else if (accentsA.length + accentsB.length <= 2) score = 0.65        // one each, different
  else score = 0.35                                                     // several, unrelated

  // Something repeated between the two pieces, colour for colour.
  const echo = a.colours.some(c1 => b.colours.some(c2 => dist(c1, c2) < 60))
  if (echo) score = Math.min(1, score + 0.1)

  // Two busy pieces together is the one combination the lookbook never makes.
  if (!a.plain && !b.plain && a.variety >= 3 && b.variety >= 3) score -= 0.2

  return Math.max(0, Math.min(1, +score.toFixed(3)))
}

/** How much two garments LOOK like each other, 0 to 1.
 *
 *  `goesWith` above answers a different question — whether two pieces belong
 *  in one outfit — and for that, sameness is not the goal: a cream trouser
 *  under an olive shirt scores well precisely because they differ. Asked "find
 *  me this jacket", that scoring is actively wrong; it would rank the pieces
 *  that COMPLEMENT the photograph above the ones that match it.
 *
 *  So this is the opposite measure. Same dominant colour, same depth of it,
 *  same busy-or-plain character, same number of colours in play. It is
 *  deliberately unforgiving about the leading colour, because that is what a
 *  person means when they hold up a picture and say "like this".
 *
 *  What it cannot do is recognise a cut. Two navy wool coats of different
 *  shapes score alike here — the words from the vision model carry the
 *  silhouette, and this carries the look. Neither is sufficient alone, which
 *  is why the search uses both.
 */
export function looksLike(a: Palette | null, b: Palette | null): number {
  if (!a || !b || !a.colours.length || !b.colours.length) return 0.4  // unknown, not wrong

  // The leading colour, by straight distance in RGB. 0 is identical; ~120 is
  // "a different colour entirely" for garment photography.
  const lead = dist(a.colours[0], b.colours[0])
  const leadScore = Math.max(0, 1 - lead / 140)

  // Any colour in one appearing in the other — catches a navy piece with a
  // white stripe against a navy piece with a white collar.
  const shared = a.colours.some(c1 => b.colours.some(c2 => dist(c1, c2) < 55)) ? 1 : 0

  // Plain against plain, print against print. A plain black tee and a printed
  // black tee are not the same garment however close their leading colour.
  const character = a.plain === b.plain ? 1 : 0.35

  // How many colours each carries. A two-tone piece is not a five-tone piece.
  const variety = 1 - Math.min(1, Math.abs(a.variety - b.variety) / 4)

  // Same family as a floor, so a slightly different navy is not punished as
  // hard as a navy against a rust.
  const family = a.families.some(f => b.families.includes(f)) ? 1 : 0.3

  const score = leadScore * 0.42 + character * 0.22 + family * 0.16
    + variety * 0.12 + shared * 0.08
  return Math.max(0, Math.min(1, +score.toFixed(3)))
}
