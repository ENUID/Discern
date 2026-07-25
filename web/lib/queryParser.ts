// ── Deterministic query parser ───────────────────────────────────────────────
// Decomposes a free-text search query into structured components (gender,
// garment type, material) and builds mandatory concept groups that are used
// as HARD filters in the catalog search pipeline.
//
// This runs on EVERY search — both as a fallback when the LLM skips
// mandatoryConcepts, and as a verifier that fills in what the LLM missed.

// Whole-word match — prevents "men" matching inside "women", "shirt" matching
// inside "t-shirt" (at the start of a word boundary), etc.
function hasWord(text: string, word: string): boolean {
  return new RegExp(
    `(?:^|[^a-z])${word.replace(/[-\s]+/g, '[\\s-]+')}(?:[^a-z]|$)`,
    'i'
  ).test(text)
}

// ── Gender detection (mirrors GlobalCatalogService) ──────────────────────────
export function detectGenderInQuery(text: string): 'men' | 'women' | 'kids' | null {
  const lower = text.toLowerCase()
  const women = /(?:^|[^a-z])(women|woman|womens|womenswear|ladies|lady|female)(?:[^a-z]|$)/i.test(lower)
  const men   = /(?:^|[^a-z])(men|man|mens|menswear|male|guys?|gentlemen)(?:[^a-z]|$)/i.test(lower)
  const kids  = /(?:^|[^a-z])(kids?|children|child|toddler|infant|baby|boys?|girls?)(?:[^a-z]|$)/i.test(lower)
  if (kids && !women && !men) return 'kids'
  if (women && !men) return 'women'
  if (men && !women) return 'men'
  return null
}

// ── Garment vocabulary ────────────────────────────────────────────────────────
// query:   terms to look for IN THE USER'S MESSAGE to detect garment intent
// product: terms to look for IN PRODUCT TEXT (title, tags, description) to
//          require this garment type — used as the mandatoryConcepts group
type GarmentEntry = { query: string[]; product: string[] }

export const GARMENT_VOCAB: Record<string, GarmentEntry> = {
  // ── Tops ──────────────────────────────────────────────────────────────────
  shirt: {
    query:   ['shirt', 'shirts'],
    product: ['shirt', 'button-up', 'button-down', 'dress shirt', 'oxford shirt', 'flannel shirt', 'overshirt', 'camp shirt', 'woven shirt'],
  },
  tshirt: {
    query:   ['t-shirt', 't shirt', 'tshirt', 'tee', 'tees'],
    product: ['t-shirt', 'tshirt', 'tee', 'tees'],
  },
  blouse: {
    query:   ['blouse', 'blouses'],
    product: ['blouse', 'blouses'],
  },
  polo: {
    query:   ['polo', 'polo shirt', 'polo tee'],
    product: ['polo'],
  },
  tank: {
    query:   ['tank', 'tank top', 'singlet', 'cami', 'camisole'],
    product: ['tank top', 'tank', 'singlet', 'cami', 'camisole'],
  },
  sweater: {
    query:   ['sweater', 'jumper', 'pullover', 'knitwear', 'knit top'],
    product: ['sweater', 'jumper', 'pullover', 'knitwear'],
  },
  hoodie: {
    query:   ['hoodie', 'hoodies', 'sweatshirt', 'sweatshirts'],
    product: ['hoodie', 'sweatshirt'],
  },
  cardigan: {
    query:   ['cardigan', 'cardigans'],
    product: ['cardigan'],
  },
  // ── Bottoms ───────────────────────────────────────────────────────────────
  trouser: {
    query:   ['trouser', 'trousers', 'pants', 'pant', 'slacks', 'wide-leg', 'wide leg'],
    product: ['trouser', 'trousers', 'pants', 'slacks'],
  },
  jean: {
    query:   ['jean', 'jeans', 'denim jeans', 'denim pants'],
    product: ['jean', 'jeans', 'denim'],
  },
  chino: {
    query:   ['chino', 'chinos', 'khaki', 'khakis', 'chino pants'],
    product: ['chino', 'chinos', 'khaki'],
  },
  short: {
    query:   ['short', 'shorts', 'swim shorts', 'board shorts'],
    product: ['shorts'],
  },
  skirt: {
    query:   ['skirt', 'skirts', 'midi skirt', 'mini skirt', 'maxi skirt'],
    product: ['skirt', 'skirts'],
  },
  legging: {
    query:   ['legging', 'leggings', 'tights', 'yoga pants'],
    product: ['legging', 'leggings', 'tights'],
  },
  // ── Outerwear ─────────────────────────────────────────────────────────────
  jacket: {
    query:   ['jacket', 'jackets'],
    product: ['jacket'],
  },
  blazer: {
    query:   ['blazer', 'blazers'],
    product: ['blazer'],
  },
  coat: {
    query:   ['coat', 'coats', 'overcoat', 'trench coat', 'trench', 'parka', 'puffer'],
    product: ['coat', 'overcoat', 'trench', 'parka', 'puffer'],
  },
  vest: {
    query:   ['vest', 'waistcoat', 'gilet'],
    product: ['vest', 'waistcoat', 'gilet'],
  },
  // ── Full-body ─────────────────────────────────────────────────────────────
  dress: {
    query:   ['dress', 'dresses', 'midi dress', 'mini dress', 'maxi dress', 'slip dress', 'sundress'],
    product: ['dress', 'dresses', 'gown'],
  },
  jumpsuit: {
    query:   ['jumpsuit', 'jumpsuits', 'romper', 'rompers', 'playsuit', 'overall', 'overalls'],
    product: ['jumpsuit', 'romper', 'playsuit', 'overall'],
  },
  bodysuit: {
    query:   ['bodysuit', 'bodysuits'],
    product: ['bodysuit', 'bodysuits'],
  },
  // ── Footwear ──────────────────────────────────────────────────────────────
  // Generic footwear catch-all: a bare "shoes" (no specific style) must still
  // register as a distinct category so "shirts, trousers and shoes" splits into
  // three groups, not two. Specific styles below still win their own product
  // matching; they all share the 'shoes' SlotCategory so they never double-count
  // into two footwear strips.
  shoe: {
    query:   ['shoe', 'shoes', 'footwear'],
    product: ['shoe', 'shoes', 'footwear'],
  },
  sneaker: {
    query:   ['sneaker', 'sneakers', 'trainer', 'trainers', 'running shoe', 'running shoes', 'athletic shoe', 'court shoe'],
    product: ['sneaker', 'sneakers', 'trainer', 'trainers', 'running shoe', 'athletic'],
  },
  boot: {
    query:   ['boot', 'boots', 'chelsea boot', 'chelsea boots', 'ankle boot', 'ankle boots', 'knee-high boot', 'combat boot'],
    product: ['boot', 'boots', 'chelsea', 'ankle boot'],
  },
  loafer: {
    query:   ['loafer', 'loafers', 'moccasin', 'moccasins', 'slip-on shoe', 'slip-on shoes'],
    product: ['loafer', 'loafers', 'moccasin'],
  },
  sandal: {
    query:   ['sandal', 'sandals', 'slide', 'slides', 'flip flop', 'flip flops', 'thong sandal'],
    product: ['sandal', 'sandals', 'slide'],
  },
  heel: {
    query:   ['heel', 'heels', 'pump', 'pumps', 'stiletto', 'wedge', 'block heel'],
    product: ['heel', 'heels', 'pump', 'pumps', 'stiletto', 'wedge'],
  },
  derby: {
    query:   ['derby', 'derbies', 'oxford shoe', 'oxford shoes', 'brogue', 'brogues'],
    product: ['oxford', 'derby', 'brogue'],
  },
  espadrille: {
    query:   ['espadrille', 'espadrilles'],
    product: ['espadrille', 'espadrilles'],
  },
  clog: {
    query:   ['clog', 'clogs'],
    product: ['clog', 'clogs'],
  },
  // ── Accessories ───────────────────────────────────────────────────────────
  bag: {
    query:   ['bag', 'bags', 'handbag', 'handbags', 'tote bag', 'tote bags', 'shoulder bag', 'crossbody'],
    product: ['bag', 'handbag', 'tote', 'clutch', 'purse', 'crossbody'],
  },
  tote: {
    query:   ['tote', 'totes'],
    product: ['tote'],
  },
  backpack: {
    query:   ['backpack', 'backpacks', 'rucksack', 'rucksacks'],
    product: ['backpack', 'rucksack'],
  },
  hat: {
    query:   ['hat', 'hats', 'cap', 'caps', 'beanie', 'beanies', 'bucket hat'],
    product: ['hat', 'cap', 'beanie'],
  },
  scarf: {
    query:   ['scarf', 'scarves', 'shawl', 'wrap'],
    product: ['scarf', 'scarves'],
  },
  belt: {
    query:   ['belt', 'belts'],
    product: ['belt', 'belts'],
  },
  sock: {
    query:   ['sock', 'socks'],
    product: ['sock', 'socks'],
  },
  sunglasses: {
    query:   ['sunglasses', 'sunnies', 'shades'],
    product: ['sunglasses', 'sunglasses'],
  },
  watch: {
    query:   ['watch', 'watches', 'timepiece'],
    product: ['watch', 'watches'],
  },
  jewelry: {
    query:   ['necklace', 'bracelet', 'earring', 'earrings', 'ring', 'rings', 'jewelry', 'jewellery', 'pendant'],
    product: ['necklace', 'bracelet', 'earring', 'ring', 'pendant', 'jewelry', 'jewellery'],
  },
  wallet: {
    query:   ['wallet', 'wallets', 'card holder', 'cardholder', 'card wallet'],
    product: ['wallet', 'wallets', 'cardholder', 'card holder'],
  },
  // ── More Western garments ───────────────────────────────────────────────────
  henley: {
    query:   ['henley', 'henleys', 'henley shirt', 'henley tee', 'granddad tee'],
    product: ['henley'],
  },
  turtleneck: {
    // "polo neck" / "roll neck" / "high neck" all mean turtleneck — this is also
    // why plain `polo` excludes "polo neck" (that's a turtleneck, not a polo).
    query:   ['turtleneck', 'turtle neck', 'roll neck', 'rollneck', 'polo neck', 'poloneck', 'high neck', 'mock neck', 'skivvy'],
    product: ['turtleneck', 'roll neck', 'rollneck', 'mock neck', 'high neck'],
  },
  cargo: {
    query:   ['cargo', 'cargos', 'cargo pants', 'cargo trousers', 'cargo joggers', 'combat pants', 'utility pants'],
    product: ['cargo', 'combat pant', 'utility pant'],
  },
  jogger: {
    query:   ['jogger', 'joggers', 'jogger pants', 'jog pants'],
    product: ['jogger', 'joggers'],
  },
  sweatpant: {
    query:   ['sweatpants', 'sweat pants', 'track pants', 'trackpants', 'lounge pants'],
    product: ['sweatpant', 'sweat pant', 'track pant', 'trackpant', 'lounge pant'],
  },
  culotte: {
    query:   ['culottes', 'culotte'],
    product: ['culotte', 'culottes'],
  },
  capri: {
    query:   ['capris', 'capri', 'capri pants', 'three-quarter pants', '3/4 pants'],
    product: ['capri', 'capris'],
  },
  bomber: {
    query:   ['bomber', 'bomber jacket', 'flight jacket', 'aviator jacket', 'ma-1'],
    product: ['bomber'],
  },
  denimJacket: {
    query:   ['denim jacket', 'jean jacket', 'jeans jacket', 'trucker jacket'],
    product: ['denim jacket', 'jean jacket', 'trucker jacket'],
  },
  windbreaker: {
    query:   ['windbreaker', 'windcheater', 'wind jacket', 'shell jacket', 'cagoule'],
    product: ['windbreaker', 'windcheater', 'shell jacket'],
  },
  gown: {
    query:   ['gown', 'gowns', 'evening gown', 'ball gown'],
    product: ['gown', 'evening gown', 'ball gown'],
  },
  mule: {
    query:   ['mule', 'mules', 'backless shoes'],
    product: ['mule', 'mules'],
  },
  flat: {
    query:   ['flats', 'flat shoes', 'ballet flats', 'ballerina flats', 'ballerinas', 'bellies'],
    product: ['ballet flat', 'ballerina', 'flat shoe'],
  },
  // ── Indian / South-Asian garments (catalog carries Indian brands) ────────────
  // Sets (salwar kameez, punjabi suit) fold into ONE key mapped to a single slot
  // so a "salwar kameez" search stays one strip of complete sets, not a false
  // top+bottom split. Genuinely separate combos ("kurta and palazzo") still split.
  kurta: {
    query:   ['kurta', 'kurtas', 'kurtha'],
    product: ['kurta'],
  },
  kurti: {
    query:   ['kurti', 'kurtis', 'kurty', 'kurties'],
    product: ['kurti'],
  },
  saree: {
    query:   ['saree', 'sari', 'sarees', 'saris', 'saree with blouse'],
    product: ['saree', 'sari'],
  },
  lehenga: {
    query:   ['lehenga', 'lehanga', 'lehnga', 'lehngha', 'ghagra', 'chaniya', 'lehenga choli'],
    product: ['lehenga', 'lehanga', 'lehnga', 'ghagra'],
  },
  anarkali: {
    query:   ['anarkali', 'anarkalis'],
    product: ['anarkali'],
  },
  kaftan: {
    query:   ['kaftan', 'caftan', 'kaftans'],
    product: ['kaftan', 'caftan'],
  },
  palazzo: {
    query:   ['palazzo', 'palazzos', 'palazo', 'pallazo'],
    product: ['palazzo', 'palazzos'],
  },
  churidar: {
    query:   ['churidar', 'chudidar', 'churidaar'],
    product: ['churidar', 'chudidar'],
  },
  sharara: {
    query:   ['sharara', 'shararah'],
    product: ['sharara'],
  },
  gharara: {
    query:   ['gharara', 'ghararas'],
    product: ['gharara'],
  },
  dhoti: {
    query:   ['dhoti', 'dhoti pants', 'veshti', 'mundu'],
    product: ['dhoti'],
  },
  salwarKameez: {
    // Folds salwar + kameez + the various "suit" names into one set concept.
    query:   ['salwar kameez', 'shalwar kameez', 'salwar suit', 'churidar suit', 'punjabi suit', 'salwar', 'shalwar', 'kameez', 'patiala suit'],
    product: ['salwar kameez', 'salwar suit', 'salwar', 'kameez'],
  },
  sherwani: {
    query:   ['sherwani', 'sherwanis'],
    product: ['sherwani'],
  },
  nehruJacket: {
    query:   ['nehru jacket', 'modi jacket', 'nehru vest', 'ethnic jacket', 'bandi jacket'],
    product: ['nehru jacket', 'modi jacket'],
  },
  bandhgala: {
    query:   ['bandhgala', 'bandhagala', 'jodhpuri', 'jodhpuri suit'],
    product: ['bandhgala', 'jodhpuri'],
  },
  dupatta: {
    query:   ['dupatta', 'duppatta', 'chunni', 'odhni'],
    product: ['dupatta', 'chunni'],
  },
}

// ── Garment disambiguation ────────────────────────────────────────────────────
// Some garment names are a LEXICAL SUBSTRING of a more specific garment, so a
// naive word match confuses them: "shirt" matches "t-shirt" (the hyphen is a
// word boundary), a "boot" search matches "bootcut" jeans, a "polo" matches a
// "polo neck" (which is actually a turtleneck), and "jeans" (via the 'denim'
// term) matches a "denim jacket". When a shopper searches the GENERAL garment,
// these more-specific look-alikes must be EXCLUDED — that was the "I asked for
// shirts and got t-shirts" bug. Keyed by garment key; a product whose text
// contains any of these terms is NOT that garment.
export const GARMENT_EXCLUSIONS: Record<string, string[]> = {
  shirt:   ['t-shirt', 't shirt', 'tshirt', 'tee', 'tees', 'sweatshirt', 'polo', 'nightshirt', 'undershirt', 'henley'],
  polo:    ['polo neck', 'poloneck', 'polo-neck', 'water polo'],
  boot:    ['bootcut', 'boot cut', 'bootie shorts'],
  jean:    ['denim jacket', 'denim shirt', 'denim skirt', 'denim dress', 'denim jkt'],
  tank:    ['tankini'],
  // "dress" as a garment must reject the adjectival uses — a "dress shirt" is a
  // shirt, "dress pants" are trousers, "dress shoes" are footwear — and the
  // sleepwear look-alikes (nightgown, dressing gown).
  dress:   ['dress shirt', 'dress pant', 'dress trouser', 'dress shoe', 'dress sock', 'nightgown', 'dressing gown'],
}

// Reverse index: each product term of an excluded garment → that garment's
// exclusion list. The catalog matcher identifies the garment concept group in
// product-term form (not by key), so it looks exclusions up this way.
export const GARMENT_PRODUCT_EXCLUSIONS: Record<string, string[]> = (() => {
  const m: Record<string, string[]> = {}
  for (const [key, ex] of Object.entries(GARMENT_EXCLUSIONS)) {
    if (ex.length === 0) continue
    for (const term of GARMENT_VOCAB[key]?.product || []) {
      m[term.toLowerCase().trim()] = ex
    }
  }
  return m
})()

// True when the product text contains a term that disqualifies it from the
// given garment concept group. Multi-word / hyphenated terms match as a loose
// substring ("premium t-shirt" → excluded); single short tokens use a word
// boundary so "tee" doesn't fire on "teen" or "polo" on nothing real.
export function matchesGarmentExclusion(haystack: string, garmentGroup: string[]): boolean {
  const excludes = new Set<string>()
  for (const term of garmentGroup) {
    const list = GARMENT_PRODUCT_EXCLUSIONS[term.toLowerCase().trim()]
    if (list) for (const e of list) excludes.add(e)
  }
  if (excludes.size === 0) return false
  for (const t of Array.from(excludes)) {
    if (t.includes(' ') || t.includes('-')) {
      if (haystack.includes(t)) return true
    } else {
      const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      if (new RegExp(`\\b${esc}s?\\b`, 'i').test(haystack)) return true
    }
  }
  return false
}

// ── Material vocabulary ───────────────────────────────────────────────────────
// Both query detection and product text matching use the same synonym list.
export const MATERIAL_VOCAB: Record<string, string[]> = {
  linen:    ['linen'],
  cotton:   ['cotton'],
  wool:     ['wool', 'woolen', 'woollen', 'merino'],
  silk:     ['silk', 'silky'],
  leather:  ['leather'],
  denim:    ['denim'],
  cashmere: ['cashmere'],
  velvet:   ['velvet'],
  suede:    ['suede'],
  canvas:   ['canvas'],
  fleece:   ['fleece'],
  satin:    ['satin'],
  lace:     ['lace'],
  tweed:    ['tweed'],
  corduroy: ['corduroy', 'cord'],
  jersey:   ['jersey'],
  nylon:    ['nylon'],
  polyester:['polyester'],
  lace_trim:['lace trim'],
  hemp:     ['hemp'],
}

// ── Color vocabulary ──────────────────────────────────────────────────────────
// key: the color word to detect in the USER'S QUERY (whole-word).
// value: synonym group to look for in PRODUCT TEXT — so "black shirt" ranks
// black shirts first, not any shirt. Synonyms cover how catalogs actually
// label the shade ("navy" pieces are often tagged "midnight"/"ink").
export const COLOR_VOCAB: Record<string, string[]> = {
  black:  ['black', 'jet black', 'onyx', 'noir'],
  white:  ['white', 'ivory', 'ecru', 'off-white', 'off white'],
  cream:  ['cream', 'ivory', 'ecru', 'oatmeal', 'bone', 'vanilla'],
  beige:  ['beige', 'sand', 'stone', 'oatmeal', 'taupe'],
  tan:    ['tan', 'camel', 'caramel', 'cognac'],
  brown:  ['brown', 'chocolate', 'coffee', 'mocha', 'espresso', 'walnut'],
  grey:   ['grey', 'gray', 'charcoal', 'slate', 'graphite'],
  gray:   ['gray', 'grey', 'charcoal', 'slate', 'graphite'],
  navy:   ['navy', 'midnight', 'dark blue'],
  blue:   ['blue', 'navy', 'cobalt', 'indigo', 'azure'],
  green:  ['green', 'olive', 'sage', 'forest', 'emerald', 'moss'],
  olive:  ['olive', 'army green', 'military green', 'moss'],
  red:    ['red', 'crimson', 'scarlet', 'cherry'],
  burgundy: ['burgundy', 'maroon', 'wine', 'oxblood', 'bordeaux'],
  pink:   ['pink', 'blush', 'rose', 'dusty pink'],
  purple: ['purple', 'violet', 'plum', 'lilac', 'lavender'],
  orange: ['orange', 'rust', 'terracotta', 'burnt orange', 'amber'],
  yellow: ['yellow', 'mustard', 'ochre', 'lemon'],
  gold:   ['gold', 'golden'],
  silver: ['silver', 'metallic'],
}

// ── Fit / silhouette vocabulary ───────────────────────────────────────────────
// How a garment is CUT — a real shopper signal ("oversized tee", "slim chinos",
// "wide-leg trousers", "high-waisted jeans") that catalogs put right in the
// product title. Unlike garment/gender this is a SOFT signal: it strongly
// ranks matching cuts to the top but never hard-filters the category away (a
// thin "oversized" page still beats an empty one). key: fit word to detect in
// the QUERY; value: synonyms to look for in PRODUCT TEXT. Ambiguous bare words
// (regular, straight) are kept as compound phrases so they don't fire on prose.
export const FIT_VOCAB: Record<string, string[]> = {
  oversized:   ['oversized', 'oversize', 'over-sized', 'oversized fit'],
  relaxed:     ['relaxed', 'relaxed fit', 'easy fit'],
  loose:       ['loose', 'loose fit', 'baggy'],
  boxy:        ['boxy', 'boxy fit'],
  slim:        ['slim', 'slim fit', 'slim-fit', 'slimfit'],
  skinny:      ['skinny', 'skinny fit'],
  muscle:      ['muscle fit', 'muscle-fit', 'athletic fit', 'compression fit'],
  regular:     ['regular fit', 'classic fit', 'standard fit', 'regular-fit'],
  tailored:    ['tailored', 'tailored fit', 'slim tailored'],
  fitted:      ['fitted', 'bodycon', 'body-con', 'body con', 'body-hugging'],
  cropped:     ['cropped', 'crop', 'crop fit'],
  longline:    ['longline', 'long-line', 'longer length'],
  'wide-leg':  ['wide-leg', 'wide leg', 'wideleg'],
  'straight-leg': ['straight-leg', 'straight leg', 'straight fit'],
  bootcut:     ['bootcut', 'boot cut', 'boot-cut'],
  tapered:     ['tapered', 'tapered fit', 'carrot fit'],
  flared:      ['flared', 'flare', 'bell-bottom', 'bell bottom', 'bootleg flare'],
  'high-rise': ['high-rise', 'high rise', 'high-waisted', 'high waisted', 'high waist'],
  'mid-rise':  ['mid-rise', 'mid rise', 'mid-waisted'],
  'low-rise':  ['low-rise', 'low rise', 'low-waisted', 'low waist'],
}

// Every product-side garment term, lowercased — lets the catalog service
// identify which concept group is the GARMENT group (the hard filter) no
// matter what order the groups arrived in (LLM output varies; gender groups
// used to land first and get mistaken for the garment).
export const GARMENT_PRODUCT_TERMS: Set<string> = new Set(
  Object.values(GARMENT_VOCAB).flatMap(e => e.product.map(t => t.toLowerCase())),
)

// ── Typo / misspelling normalization ─────────────────────────────────────────
// Shoppers type fast and loose — "blak jaket", "snekers", "truosers", "wht
// linnen shrt". The LLM planner usually recovers, but the instant compiler and
// the LLM-down fallback both match on exact words, so a misspelling silently
// drops to zero results. This corrects obvious fashion-term typos
// deterministically, so messy spelling "just works" before any matching runs.

// High-confidence corrections a single-edit check can't reach (2+ edits,
// phonetic slips, or common informal forms).
const TYPO_MAP: Record<string, string> = {
  jaket: 'jacket', jakcet: 'jacket', jackt: 'jacket', jaccket: 'jacket', jacekt: 'jacket',
  snekers: 'sneakers', sneekers: 'sneakers', snekrs: 'sneakers', sneaker: 'sneaker', sneekrs: 'sneakers',
  truosers: 'trousers', trowsers: 'trousers', trousor: 'trousers', trosers: 'trousers', trowser: 'trouser',
  tshit: 't-shirt', tshrt: 't-shirt', teeshirt: 't-shirt', teee: 'tee',
  shrt: 'shirt', shert: 'shirt', shirtt: 'shirt', shrit: 'shirt',
  jeens: 'jeans', jenes: 'jeans', jean: 'jeans',
  swetar: 'sweater', sweter: 'sweater', swaeter: 'sweater', sweatr: 'sweater', sweather: 'sweater',
  hoody: 'hoodie', hoddie: 'hoodie', hodie: 'hoodie', hoodi: 'hoodie',
  jumpr: 'jumper', jumperr: 'jumper',
  trosuer: 'trouser', jogers: 'joggers', joggger: 'jogger',
  jewelery: 'jewelry', jewlery: 'jewelry', jewellary: 'jewellery',
  accesories: 'accessories', accessorie: 'accessories', acessories: 'accessories',
  blak: 'black', blck: 'black', balck: 'black', blakc: 'black',
  wihte: 'white', whyte: 'white', whit: 'white', whte: 'white', wht: 'white',
  navi: 'navy', gery: 'grey', gray: 'grey',
  beig: 'beige', biege: 'beige', beigh: 'beige',
  brwon: 'brown', borwn: 'brown', purpel: 'purple', gren: 'green', geren: 'green',
  leathr: 'leather', lether: 'leather', leater: 'leather', leathar: 'leather',
  coton: 'cotton', cottn: 'cotton', cottton: 'cotton',
  wooll: 'wool', linnen: 'linen', linnene: 'linen', linin: 'linen', linnin: 'linen',
  cashmer: 'cashmere', cashmier: 'cashmere', cashmire: 'cashmere',
  denm: 'denim', denium: 'denim', deneim: 'denim', corderoy: 'corduroy', cordroy: 'corduroy',
  dres: 'dress', dresss: 'dress', skrit: 'skirt', shorst: 'shorts',
  caot: 'coat', blazr: 'blazer', blezer: 'blazer',
  bagz: 'bags', watchs: 'watches', sunglases: 'sunglasses', sunglass: 'sunglasses',
  wedeing: 'wedding', weding: 'wedding', casaul: 'casual', casul: 'casual', forml: 'formal',
  summr: 'summer', wntr: 'winter', ofice: 'office', officee: 'office',
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  if (Math.abs(m - n) > 1) return 2   // we only accept ≤1 from the fuzzy path
  const dp: number[] = Array.from({ length: m + 1 }, (_, i) => i)
  for (let j = 1; j <= n; j++) {
    let prev = dp[0]
    dp[0] = j
    for (let i = 1; i <= m; i++) {
      const tmp = dp[i]
      dp[i] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[i], dp[i - 1])
      prev = tmp
    }
  }
  return dp[m]
}

// Canonical single-word fashion terms to correct toward.
const CORRECTION_VOCAB: string[] = Array.from(new Set([
  ...Array.from(GARMENT_PRODUCT_TERMS),
  ...Object.values(MATERIAL_VOCAB).flat(),
  ...Object.values(COLOR_VOCAB).flat(),
].map(w => w.toLowerCase()).filter(w => /^[a-z]{4,}$/.test(w))))
const CORRECTION_SET = new Set(CORRECTION_VOCAB)

// Fit / silhouette words are real vocabulary too — protect them from the fuzzy
// typo corrector, which otherwise "fixes" one-edit look-alikes ("wide" → "wine",
// "slim" → "slit") and corrupts the query before it's ever parsed.
const FIT_WORD_SET = new Set(
  Object.values(FIT_VOCAB)
    .flat()
    .flatMap(t => t.split(/[\s-]+/))
    .filter(w => w.length >= 3)
    .map(w => w.toLowerCase()),
)

// Real English words that sit one edit from a fashion term and must never be
// "corrected" (bed→red, best→vest, cost→coat, want→pant…). Also common intent
// words that appear next to garments.
const TYPO_SKIP = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'some', 'any', 'are', 'was', 'not',
  'but', 'you', 'your', 'have', 'want', 'went', 'need', 'like', 'love', 'nice',
  'good', 'best', 'cost', 'rest', 'test', 'bed', 'ten', 'ton', 'set', 'get',
  'looking', 'something', 'anything', 'casual', 'formal', 'summer', 'winter',
  'wedding', 'work', 'date', 'party', 'beach', 'office', 'under', 'over', 'cheap',
  'size', 'color', 'colour', 'style', 'brand', 'shop', 'store', 'from', 'wear',
  'them', 'they', 'here', 'there', 'what', 'when', 'show', 'find', 'give',
])

function matchCase(orig: string, repl: string): string {
  const first = orig.charAt(0)
  if (first !== first.toLowerCase() && first === first.toUpperCase()) {
    return repl.charAt(0).toUpperCase() + repl.slice(1)
  }
  return repl
}

/**
 * Correct obvious fashion-term misspellings in a free-text query. Only touches
 * tokens that are unambiguously a typo of a known garment/colour/material term
 * — everything else (brands, proper nouns, ordinary words) is left untouched.
 */
export function normalizeFashionTypos(text: string): string {
  if (!text) return text
  return text.replace(/[a-zA-Z][a-zA-Z'-]*/g, (token) => {
    const lower = token.toLowerCase()
    if (lower.length < 3) return token
    if (CORRECTION_SET.has(lower) || GARMENT_PRODUCT_TERMS.has(lower) || FIT_WORD_SET.has(lower)) return token // already valid
    const mapped = TYPO_MAP[lower]
    if (mapped) return matchCase(token, mapped)
    if (TYPO_SKIP.has(lower)) return token
    // Single-edit fuzzy match against the fashion vocabulary. Requires a unique
    // nearest term (no ties) so ambiguous tokens are left alone.
    let best: string | null = null, bestDist = 9, ties = 0
    for (const cand of CORRECTION_VOCAB) {
      if (Math.abs(cand.length - lower.length) > 1) continue
      const d = levenshtein(lower, cand)
      if (d < bestDist) { bestDist = d; best = cand; ties = 0 }
      else if (d === bestDist) ties++
    }
    if (best && bestDist === 1 && ties === 0) return matchCase(token, best)
    return token
  })
}

// ── Query decomposition ───────────────────────────────────────────────────────
export type QueryComponents = {
  gender?: 'men' | 'women' | 'kids'
  garmentKeys: string[]
  materials: string[]
  colors: string[]
  fits: string[]
}

export function decomposeQuery(query: string): QueryComponents {
  const lower = query.toLowerCase()

  const gender = detectGenderInQuery(lower) ?? undefined

  const garmentKeys: string[] = []
  for (const [key, entry] of Object.entries(GARMENT_VOCAB)) {
    if (entry.query.some(term => hasWord(lower, term))) {
      garmentKeys.push(key)
    }
  }

  const materials: string[] = []
  for (const [mat] of Object.entries(MATERIAL_VOCAB)) {
    if (hasWord(lower, mat)) materials.push(mat)
  }

  const colors: string[] = []
  for (const [color] of Object.entries(COLOR_VOCAB)) {
    if (hasWord(lower, color)) colors.push(color)
  }

  const fits: string[] = []
  for (const [fit, syns] of Object.entries(FIT_VOCAB)) {
    if (syns.some(term => hasWord(lower, term))) fits.push(fit)
  }

  return { gender, garmentKeys, materials, colors, fits }
}

// ── Concept builder ───────────────────────────────────────────────────────────
// Builds mandatoryConcepts string[][] from a query.
// ORDER MATTERS: the garment group(s) come FIRST — the catalog service treats
// the garment group as the hard category filter, everything after it
// (material, color, gender) as precision ranking signals. Gender goes LAST:
// it's the weakest product-text signal (unisex pieces often name no gender)
// and must never be mistaken for the garment filter.
export function buildMandatoryConcepts(query: string): string[][] {
  const { gender, garmentKeys, materials, colors, fits } = decomposeQuery(query)
  const concepts: string[][] = []

  for (const key of garmentKeys) {
    const entry = GARMENT_VOCAB[key]
    if (entry) concepts.push(entry.product)
  }

  for (const mat of materials) {
    const synonyms = MATERIAL_VOCAB[mat]
    if (synonyms) concepts.push(synonyms)
  }

  for (const color of colors) {
    const synonyms = COLOR_VOCAB[color]
    if (synonyms) concepts.push(synonyms)
  }

  // Fit is a ranking signal only, never the category filter (findGarmentGroupIndex
  // keys off GARMENT_PRODUCT_TERMS, which no fit synonym is in) — a matching cut
  // gets the same +details boost color/material do, so "oversized tee" surfaces
  // oversized tees first without ever hiding the rest of the tees.
  for (const fit of fits) {
    const synonyms = FIT_VOCAB[fit]
    if (synonyms) concepts.push(synonyms)
  }

  if (gender === 'men')   concepts.push(['men', 'mens', 'man', 'male', 'unisex'])
  if (gender === 'women') concepts.push(['women', 'womens', 'woman', 'ladies', 'female'])

  return concepts
}

// ── Concept augmenter ─────────────────────────────────────────────────────────
// Merges LLM-generated concepts with deterministically-built ones.
// If the LLM already included a concept group for a term (gender/garment/material),
// the deterministic group is skipped to avoid double-filtering.
// If the LLM MISSED a concept, the deterministic one is added.
export function augmentConcepts(llmConcepts: string[][], query: string): string[][] {
  const deterministic = buildMandatoryConcepts(query)
  if (deterministic.length === 0) return llmConcepts

  const merged = [...llmConcepts]

  for (const detGroup of deterministic) {
    const alreadyCovered = merged.some(existing =>
      existing.some(a =>
        detGroup.some(b => a.toLowerCase().trim() === b.toLowerCase().trim())
      )
    )
    if (!alreadyCovered) merged.push(detGroup)
  }

  return merged
}

// ── Outfit slot classification ────────────────────────────────────────────────
// Maps every garment key to a high-level wardrobe slot, so the outfit builder
// can (a) know what category a slot query intends, (b) verify the product a
// search returned actually IS that category, and (c) label it correctly.
export type SlotCategory = 'top' | 'bottom' | 'outer' | 'dress' | 'shoes' | 'accessory'

export const GARMENT_CATEGORY: Record<string, SlotCategory> = {
  shirt: 'top', tshirt: 'top', blouse: 'top', polo: 'top', tank: 'top',
  sweater: 'top', hoodie: 'top', cardigan: 'top', henley: 'top', turtleneck: 'top',
  trouser: 'bottom', jean: 'bottom', chino: 'bottom', short: 'bottom',
  skirt: 'bottom', legging: 'bottom',
  cargo: 'bottom', jogger: 'bottom', sweatpant: 'bottom', culotte: 'bottom', capri: 'bottom',
  jacket: 'outer', blazer: 'outer', coat: 'outer', vest: 'outer',
  bomber: 'outer', denimJacket: 'outer', windbreaker: 'outer',
  dress: 'dress', jumpsuit: 'dress', bodysuit: 'dress', gown: 'dress',
  shoe: 'shoes',
  sneaker: 'shoes', boot: 'shoes', loafer: 'shoes', sandal: 'shoes',
  heel: 'shoes', derby: 'shoes', espadrille: 'shoes', clog: 'shoes', mule: 'shoes', flat: 'shoes',
  // Indian / South-Asian
  kurta: 'top', kurti: 'top',
  palazzo: 'bottom', churidar: 'bottom', sharara: 'bottom', gharara: 'bottom', dhoti: 'bottom', lehenga: 'bottom',
  saree: 'dress', anarkali: 'dress', kaftan: 'dress', salwarKameez: 'dress',
  sherwani: 'outer', nehruJacket: 'outer', bandhgala: 'outer',
  dupatta: 'accessory',
  bag: 'accessory', tote: 'accessory', backpack: 'accessory', hat: 'accessory',
  scarf: 'accessory', belt: 'accessory', sock: 'accessory', sunglasses: 'accessory',
  watch: 'accessory', jewelry: 'accessory', wallet: 'accessory',
}

const SLOT_LABELS: Record<SlotCategory, string> = {
  top: 'Top', bottom: 'Bottom', outer: 'Outer', dress: 'Dress',
  shoes: 'Shoes', accessory: 'Accessory',
}

export function slotLabelFor(cat: SlotCategory): string {
  return SLOT_LABELS[cat]
}

// What category does an outfit-slot QUERY intend? Reads the garment terms out of
// the user-facing query ("men's tan leather loafers" → 'shoes'). Returns null
// when the query names no recognizable garment.
export function classifyQuerySlot(query: string): SlotCategory | null {
  const { garmentKeys } = decomposeQuery(query)
  for (const key of garmentKeys) {
    const cat = GARMENT_CATEGORY[key]
    if (cat) return cat
  }
  return null
}

// Which categories does an actual PRODUCT belong to? Matches the product-side
// vocabulary against the product's own text (title + tags + description). A
// product can legitimately hit more than one (e.g. an overshirt reads as a top),
// so we return the full set and let the caller test membership.
export function productSlotCategories(p: { title?: string; tags?: string[]; description?: string }): Set<SlotCategory> {
  const text = `${p.title || ''} ${(p.tags || []).join(' ')} ${p.description || ''}`.toLowerCase()
  const cats = new Set<SlotCategory>()
  for (const [key, entry] of Object.entries(GARMENT_VOCAB)) {
    const cat = GARMENT_CATEGORY[key]
    if (!cat) continue
    if (entry.product.some(term => hasWord(text, term))) cats.add(cat)
  }
  return cats
}

// Does this product actually satisfy the slot the query asked for?
export function productMatchesSlot(p: { title?: string; tags?: string[]; description?: string }, cat: SlotCategory): boolean {
  return productSlotCategories(p).has(cat)
}

// Does this product match a SPECIFIC garment key, not just its broad slot? This
// is the fix for "asked for t-shirts, got button-up shirts": tshirt and shirt
// share the 'top' slot, so slot-level filtering can't tell them apart. Requires
// a product term for THIS exact garment (a "Hakuna Shirt" has no tee/t-shirt
// term, so it fails the tshirt check) AND no disqualifying look-alike (a real
// t-shirt fails the shirt check via GARMENT_EXCLUSIONS). Use this instead of
// productMatchesSlot wherever the query names one specific garment.
export function productMatchesGarmentKey(p: { title?: string; tags?: string[]; description?: string }, key: string): boolean {
  const entry = GARMENT_VOCAB[key]
  if (!entry) return false
  const text = `${p.title || ''} ${(p.tags || []).join(' ')} ${p.description || ''}`.toLowerCase()
  if (!entry.product.some(term => hasWord(text, term))) return false
  if (matchesGarmentExclusion(text, entry.product)) return false
  return true
}
