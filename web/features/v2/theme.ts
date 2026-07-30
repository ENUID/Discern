// ── Discern v2 design tokens ─────────────────────────────────────────────────
// Extracted from the reference clips: a luxury-boutique language built on
// full-bleed imagery, editorial serif display type, and frosted "glass" pill
// controls that float over the content rather than sitting in a chrome bar.
//
// The palette is deliberately warm-neutral (bone / greige / soft black) rather
// than the cool grey of v1 — every surface in the reference reads as paper,
// stone or unbleached linen, never as UI.

export const V2 = {
  // Surfaces
  bone:      '#F2EFEA',  // primary page background (warm off-white / paper)
  boneDeep:  '#E8E4DD',  // secondary band, alternating sections
  ink:       '#1C1B19',  // primary text (soft black, never pure #000)
  ink70:     'rgba(28,27,25,.70)',
  ink45:     'rgba(28,27,25,.45)',
  hairline:  'rgba(28,27,25,.12)',

  // Frosted controls that float over imagery. Two variants: one for light
  // backdrops, one for dark/photographic backdrops.
  glassDark:  'rgba(38,35,32,.55)',
  glassLight: 'rgba(255,255,255,.62)',
  glassEdge:  'rgba(255,255,255,.22)',

  // Type
  serif: "'Cormorant Garamond', 'Times New Roman', serif",
  sans:  "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",

  // Motion — one shared easing so every transition feels like one system.
  ease:      'cubic-bezier(.22,.61,.36,1)',
  easeInOut: 'cubic-bezier(.65,.05,.36,1)',
} as const

// Rotating prompt suggestions shown in the search bar when it's idle — the
// reference cycles these to teach people what the assistant can do.
export const V2_PROMPTS = [
  'Suggest me some looks for a weekend outdoor',
  "I'm looking for an outfit for an elegant dinner",
  'Show me what’s new',
  'Find me an outfit for a movie premiere',
  'Knitwear',
  'Something I can wear over a shirt in winter',
]

// Editorial interstitials — the dark full-bleed quote panels between product
// sections. Kept here so copy can be tuned without touching layout code.
export const V2_EDITORIAL = [
  'Between creative instinct and sartorial precision, a vision of contemporary elegance creates new balances of style.',
  'The intensity of shades resonates through refined textures and the essential lines of every creation.',
  'Where ideas become endless possibilities.',
]
