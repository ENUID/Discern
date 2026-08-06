// ── Discern v2 design tokens ─────────────────────────────────────────────────
// The register is editorial rather than app-like: a serif display against a
// clean sans, a lot of air, near-black on off-white, and glass controls that
// float over content instead of sitting in a chrome bar. Nothing decorative earns its place — if a
// rule, flourish or line of copy isn't doing work, it isn't here.

export const V2 = {
  // Surfaces
  bone:      '#F4F3F1',  // page background — off-white, never pure white
  boneDeep:  '#E9E7E4',  // secondary band
  ink:       '#1A1A1C',  // primary text — soft black, never pure #000
  ink70:     'rgba(26,26,28,.70)',
  ink45:     'rgba(26,26,28,.45)',
  hairline:  'rgba(26,26,28,.10)',

  // Frosted controls floating over content. Two variants: one for light
  // backdrops, one for dark or photographic ones.
  glassDark:  'rgba(32,32,34,.62)',
  glassLight: 'rgba(255,255,255,.68)',
  glassEdge:  'rgba(255,255,255,.20)',

  // Type. A serif display against a sans body — the contrast Aesop, COS and
  // Veilance-register editorial all run on, and the thing that stops an
  // interface reading as another iOS app.
  //
  // `editorial` is Instrument Serif. The faces this was specified against —
  // Canela, Austin, Ivar Display, Noe Display, PP Editorial New, Saol Display —
  // are all commercial licences and none can ship here. Instrument Serif is the
  // closest freely-licensed face in that register: contemporary, slightly
  // condensed, high contrast without tipping into didone. Swap the stack below
  // if a licence is bought; nothing else needs to change.
  editorial: "'Instrument Serif', 'Canela', 'Saol Display', 'Ivar Display', Georgia, serif",
  display: "'Geist', -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Inter', sans-serif",
  sans:    "'Geist', -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter', sans-serif",

  // Motion — one shared easing so every transition feels like one system.
  ease:      'cubic-bezier(.22,.61,.36,1)',
  easeInOut: 'cubic-bezier(.65,.05,.36,1)',
} as const

// Rotating prompt suggestions shown in the bar when it's idle. These teach what
// the thing can do, so they're specific requests rather than categories.
export const V2_PROMPTS = [
  'A white shirt that isn’t see-through',
  'Winter coat under $300',
  'What goes with wide-leg jeans',
  'Something for a summer wedding',
  'Black boots I can walk all day in',
  'A jacket for 10°C and rain',
]

// Shown while a search runs. A sequence, not one frozen label — it cross-fades
// through these for as long as the work takes.
export const V2_LOADING = [
  ['Reading your ', 'request'],
  ['Searching the ', 'catalogue'],
  ['Comparing the ', 'options'],
  ['Almost ', 'there'],
]

// Tap-to-run suggestions on the opening panel. Full-width, left-aligned.
export const V2_SUGGESTIONS = [
  'Build me a capsule wardrobe for work',
  'Find an everyday bag under $200',
]
