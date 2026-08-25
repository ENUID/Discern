"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// lib/queryParser.ts
var queryParser_exports = {};
__export(queryParser_exports, {
  COLOR_VOCAB: () => COLOR_VOCAB,
  FIT_VOCAB: () => FIT_VOCAB,
  GARMENT_CATEGORY: () => GARMENT_CATEGORY,
  GARMENT_EXCLUSIONS: () => GARMENT_EXCLUSIONS,
  GARMENT_PRODUCT_EXCLUSIONS: () => GARMENT_PRODUCT_EXCLUSIONS,
  GARMENT_PRODUCT_TERMS: () => GARMENT_PRODUCT_TERMS,
  GARMENT_VOCAB: () => GARMENT_VOCAB,
  MATERIAL_VOCAB: () => MATERIAL_VOCAB,
  augmentConcepts: () => augmentConcepts,
  buildMandatoryConcepts: () => buildMandatoryConcepts,
  classifyQuerySlot: () => classifyQuerySlot,
  decomposeQuery: () => decomposeQuery,
  detectGenderInQuery: () => detectGenderInQuery,
  dropGenericWhenSpecific: () => dropGenericWhenSpecific,
  matchesGarmentExclusion: () => matchesGarmentExclusion,
  normalizeFashionTypos: () => normalizeFashionTypos,
  productMatchesGarmentKey: () => productMatchesGarmentKey,
  productMatchesSlot: () => productMatchesSlot,
  productSlotCategories: () => productSlotCategories,
  slotLabelFor: () => slotLabelFor
});
module.exports = __toCommonJS(queryParser_exports);

// lib/fashion/taxonomy.ts
function taxonomyIds(categories) {
  if (!Array.isArray(categories)) return [];
  const out = [];
  for (const c of categories) {
    const raw = typeof c === "string" ? c : c?.value;
    if (typeof raw !== "string") continue;
    const id = raw.split("/").pop()?.trim().toLowerCase();
    if (id && id !== "na" && !id.startsWith("archived")) out.push(id);
  }
  return out;
}
var KEY_BY_ID = {
  "aa-8-8": "sneaker"
};
var SLOT_BY_PREFIX = [
  ["aa-8", "shoes"],
  ["aa-1-13", "top"]
];
function taxonomyGarmentKey(categories) {
  for (const id of taxonomyIds(categories)) {
    const key = KEY_BY_ID[id];
    if (key) return key;
  }
  return null;
}
function taxonomySlot(categories) {
  const ids = taxonomyIds(categories);
  const ordered = [...SLOT_BY_PREFIX].sort((a, b) => b[0].length - a[0].length);
  for (const id of ids) {
    for (const [prefix, slot] of ordered) {
      if (id === prefix || id.startsWith(prefix + "-")) return slot;
    }
  }
  return null;
}

// lib/queryParser.ts
function hasWord(text, word) {
  return new RegExp(
    `(?:^|[^a-z])${word.replace(/[-\s]+/g, "[\\s-]+")}(?:[^a-z]|$)`,
    "i"
  ).test(text);
}
function detectGenderInQuery(text) {
  const lower = text.toLowerCase();
  const women = /(?:^|[^a-z])(women|woman|womens|womenswear|ladies|lady|female)(?:[^a-z]|$)/i.test(lower);
  const men = /(?:^|[^a-z])(men|man|mens|menswear|male|guys?|gentlemen)(?:[^a-z]|$)/i.test(lower);
  const kids = /(?:^|[^a-z])(kids?|children|child|toddler|infant|baby|boys?|girls?)(?:[^a-z]|$)/i.test(lower);
  if (kids && !women && !men) return "kids";
  if (women && !men) return "women";
  if (men && !women) return "men";
  return null;
}
var GARMENT_VOCAB = {
  // ── Tops ──────────────────────────────────────────────────────────────────
  shirt: {
    query: ["shirt", "shirts"],
    product: ["shirt", "button-up", "button-down", "dress shirt", "oxford shirt", "flannel shirt", "overshirt", "camp shirt", "woven shirt"]
  },
  tshirt: {
    // The plurals are listed, and they have to be. hasWord anchors on a word
    // boundary, so 't-shirt' does not match "t-shirts" — and `shirt` lists
    // BOTH its forms, so it did. "plain white t-shirts" resolved to `shirt`
    // and returned button-ups, while "plain white tshirts" resolved to nothing
    // at all. The comment on GARMENT_EXCLUSIONS calls dropping the t "the exact
    // reported bug"; it was still live for every plural.
    query: ["t-shirt", "t-shirts", "t shirt", "t shirts", "tshirt", "tshirts", "tee", "tees"],
    product: ["t-shirt", "t-shirts", "tshirt", "tshirts", "tee", "tees"]
  },
  blouse: {
    query: ["blouse", "blouses"],
    product: ["blouse", "blouses"]
  },
  polo: {
    query: ["polo", "polo shirt", "polo tee"],
    product: ["polo"]
  },
  tank: {
    query: ["tank", "tank top", "singlet", "cami", "camisole"],
    product: ["tank top", "tank", "singlet", "cami", "camisole"]
  },
  sweater: {
    query: ["sweater", "jumper", "pullover", "knitwear", "knit top"],
    product: ["sweater", "jumper", "pullover", "knitwear"]
  },
  hoodie: {
    query: ["hoodie", "hoodies", "sweatshirt", "sweatshirts"],
    product: ["hoodie", "sweatshirt"]
  },
  cardigan: {
    query: ["cardigan", "cardigans"],
    product: ["cardigan"]
  },
  // ── Bottoms ───────────────────────────────────────────────────────────────
  trouser: {
    query: ["trouser", "trousers", "pants", "pant", "slacks", "wide-leg", "wide leg"],
    product: ["trouser", "trousers", "pants", "slacks"]
  },
  jean: {
    query: ["jean", "jeans", "denim jeans", "denim pants"],
    product: ["jean", "jeans", "denim"]
  },
  chino: {
    query: ["chino", "chinos", "khaki", "khakis", "chino pants"],
    product: ["chino", "chinos", "khaki"]
  },
  short: {
    query: ["short", "shorts", "swim shorts", "board shorts"],
    product: ["shorts"]
  },
  skirt: {
    query: ["skirt", "skirts", "midi skirt", "mini skirt", "maxi skirt"],
    product: ["skirt", "skirts"]
  },
  legging: {
    query: ["legging", "leggings", "tights", "yoga pants"],
    product: ["legging", "leggings", "tights"]
  },
  // ── Outerwear ─────────────────────────────────────────────────────────────
  jacket: {
    query: ["jacket", "jackets"],
    product: ["jacket"]
  },
  blazer: {
    query: ["blazer", "blazers"],
    product: ["blazer"]
  },
  coat: {
    query: ["coat", "coats", "overcoat", "trench coat", "trench", "parka", "puffer"],
    product: ["coat", "overcoat", "trench", "parka", "puffer"]
  },
  vest: {
    query: ["vest", "waistcoat", "gilet"],
    product: ["vest", "waistcoat", "gilet"]
  },
  // ── Full-body ─────────────────────────────────────────────────────────────
  dress: {
    query: ["dress", "dresses", "midi dress", "mini dress", "maxi dress", "slip dress", "sundress"],
    product: ["dress", "dresses", "gown"]
  },
  jumpsuit: {
    query: ["jumpsuit", "jumpsuits", "romper", "rompers", "playsuit", "overall", "overalls"],
    product: ["jumpsuit", "romper", "playsuit", "overall"]
  },
  bodysuit: {
    query: ["bodysuit", "bodysuits"],
    product: ["bodysuit", "bodysuits"]
  },
  // ── Footwear ──────────────────────────────────────────────────────────────
  // Generic footwear catch-all: a bare "shoes" (no specific style) must still
  // register as a distinct category so "shirts, trousers and shoes" splits into
  // three groups, not two. Specific styles below still win their own product
  // matching; they all share the 'shoes' SlotCategory so they never double-count
  // into two footwear strips.
  shoe: {
    query: ["shoe", "shoes", "footwear"],
    product: ["shoe", "shoes", "footwear"]
  },
  // A sneaker brand will very often never write the word. Comet's whole
  // catalogue is "X Lows CORTADO", "Aeon v2 ECLIPSE", "Alter" — no title, tag
  // or description anywhere says sneaker or even shoe, so a matcher that only
  // knows the word threw the brand out of its own category. What identifies
  // these is the SHAPE: low top, high top, court, runner, skate. Those go in
  // the product terms (what a listing might say) but stay out of the query
  // terms (what a shopper searching "sneakers" is sent to look for), because
  // the two lists answer different questions.
  sneaker: {
    query: ["sneaker", "sneakers", "trainer", "trainers", "running shoe", "running shoes", "athletic shoe", "court shoe"],
    product: [
      "sneaker",
      "sneakers",
      "trainer",
      "trainers",
      "running shoe",
      "athletic",
      "low top",
      "low-top",
      "lowtop",
      "lows",
      "high top",
      "high-top",
      "hightop",
      "court shoe",
      "runner",
      "runners",
      "skate shoe",
      "plimsoll",
      "canvas shoe"
    ]
  },
  boot: {
    query: ["boot", "boots", "chelsea boot", "chelsea boots", "ankle boot", "ankle boots", "knee-high boot", "combat boot"],
    product: ["boot", "boots", "chelsea", "ankle boot"]
  },
  loafer: {
    query: ["loafer", "loafers", "moccasin", "moccasins", "slip-on shoe", "slip-on shoes"],
    product: ["loafer", "loafers", "moccasin"]
  },
  sandal: {
    query: ["sandal", "sandals", "slide", "slides", "flip flop", "flip flops", "thong sandal"],
    product: ["sandal", "sandals", "slide"]
  },
  heel: {
    query: ["heel", "heels", "pump", "pumps", "stiletto", "wedge", "block heel"],
    product: ["heel", "heels", "pump", "pumps", "stiletto", "wedge"]
  },
  derby: {
    query: ["derby", "derbies", "oxford shoe", "oxford shoes", "brogue", "brogues"],
    product: ["oxford", "derby", "brogue"]
  },
  espadrille: {
    query: ["espadrille", "espadrilles"],
    product: ["espadrille", "espadrilles"]
  },
  clog: {
    query: ["clog", "clogs"],
    product: ["clog", "clogs"]
  },
  // ── Accessories ───────────────────────────────────────────────────────────
  bag: {
    query: ["bag", "bags", "handbag", "handbags", "tote bag", "tote bags", "shoulder bag", "crossbody"],
    product: ["bag", "handbag", "tote", "clutch", "purse", "crossbody"]
  },
  tote: {
    query: ["tote", "totes"],
    product: ["tote"]
  },
  backpack: {
    query: ["backpack", "backpacks", "rucksack", "rucksacks"],
    product: ["backpack", "rucksack"]
  },
  hat: {
    query: ["hat", "hats", "cap", "caps", "beanie", "beanies", "bucket hat"],
    product: ["hat", "cap", "beanie"]
  },
  scarf: {
    query: ["scarf", "scarves", "shawl", "wrap"],
    product: ["scarf", "scarves"]
  },
  belt: {
    query: ["belt", "belts"],
    product: ["belt", "belts"]
  },
  sock: {
    query: ["sock", "socks"],
    product: ["sock", "socks"]
  },
  sunglasses: {
    query: ["sunglasses", "sunnies", "shades"],
    product: ["sunglasses", "sunglasses"]
  },
  watch: {
    query: ["watch", "watches", "timepiece"],
    product: ["watch", "watches"]
  },
  jewelry: {
    query: ["necklace", "bracelet", "earring", "earrings", "ring", "rings", "jewelry", "jewellery", "pendant"],
    product: ["necklace", "bracelet", "earring", "ring", "pendant", "jewelry", "jewellery"]
  },
  wallet: {
    query: ["wallet", "wallets", "card holder", "cardholder", "card wallet"],
    product: ["wallet", "wallets", "cardholder", "card holder"]
  },
  // ── More Western garments ───────────────────────────────────────────────────
  henley: {
    query: ["henley", "henleys", "henley shirt", "henley tee", "granddad tee"],
    product: ["henley"]
  },
  turtleneck: {
    // "polo neck" / "roll neck" / "high neck" all mean turtleneck — this is also
    // why plain `polo` excludes "polo neck" (that's a turtleneck, not a polo).
    query: ["turtleneck", "turtle neck", "roll neck", "rollneck", "polo neck", "poloneck", "high neck", "mock neck", "skivvy"],
    product: ["turtleneck", "roll neck", "rollneck", "mock neck", "high neck"]
  },
  cargo: {
    query: ["cargo", "cargos", "cargo pants", "cargo trousers", "cargo joggers", "combat pants", "utility pants"],
    product: ["cargo", "combat pant", "utility pant"]
  },
  jogger: {
    query: ["jogger", "joggers", "jogger pants", "jog pants"],
    product: ["jogger", "joggers"]
  },
  sweatpant: {
    query: ["sweatpants", "sweat pants", "track pants", "trackpants", "lounge pants"],
    product: ["sweatpant", "sweat pant", "track pant", "trackpant", "lounge pant"]
  },
  culotte: {
    query: ["culottes", "culotte"],
    product: ["culotte", "culottes"]
  },
  capri: {
    query: ["capris", "capri", "capri pants", "three-quarter pants", "3/4 pants"],
    product: ["capri", "capris"]
  },
  bomber: {
    query: ["bomber", "bomber jacket", "flight jacket", "aviator jacket", "ma-1"],
    product: ["bomber"]
  },
  denimJacket: {
    query: ["denim jacket", "jean jacket", "jeans jacket", "trucker jacket"],
    product: ["denim jacket", "jean jacket", "trucker jacket"]
  },
  windbreaker: {
    query: ["windbreaker", "windcheater", "wind jacket", "shell jacket", "cagoule"],
    product: ["windbreaker", "windcheater", "shell jacket"]
  },
  gown: {
    query: ["gown", "gowns", "evening gown", "ball gown"],
    product: ["gown", "evening gown", "ball gown"]
  },
  mule: {
    query: ["mule", "mules", "backless shoes"],
    product: ["mule", "mules"]
  },
  flat: {
    query: ["flats", "flat shoes", "ballet flats", "ballerina flats", "ballerinas", "bellies"],
    product: ["ballet flat", "ballerina", "flat shoe"]
  },
  // ── Indian / South-Asian garments (catalog carries Indian brands) ────────────
  // Sets (salwar kameez, punjabi suit) fold into ONE key mapped to a single slot
  // so a "salwar kameez" search stays one strip of complete sets, not a false
  // top+bottom split. Genuinely separate combos ("kurta and palazzo") still split.
  kurta: {
    query: ["kurta", "kurtas", "kurtha"],
    product: ["kurta"]
  },
  kurti: {
    query: ["kurti", "kurtis", "kurty", "kurties"],
    product: ["kurti"]
  },
  saree: {
    query: ["saree", "sari", "sarees", "saris", "saree with blouse"],
    product: ["saree", "sari"]
  },
  lehenga: {
    query: ["lehenga", "lehanga", "lehnga", "lehngha", "ghagra", "chaniya", "lehenga choli"],
    product: ["lehenga", "lehanga", "lehnga", "ghagra"]
  },
  anarkali: {
    query: ["anarkali", "anarkalis"],
    product: ["anarkali"]
  },
  kaftan: {
    query: ["kaftan", "caftan", "kaftans"],
    product: ["kaftan", "caftan"]
  },
  palazzo: {
    query: ["palazzo", "palazzos", "palazo", "pallazo"],
    product: ["palazzo", "palazzos"]
  },
  churidar: {
    query: ["churidar", "chudidar", "churidaar"],
    product: ["churidar", "chudidar"]
  },
  sharara: {
    query: ["sharara", "shararah"],
    product: ["sharara"]
  },
  gharara: {
    query: ["gharara", "ghararas"],
    product: ["gharara"]
  },
  dhoti: {
    query: ["dhoti", "dhoti pants", "veshti", "mundu"],
    product: ["dhoti"]
  },
  salwarKameez: {
    // Folds salwar + kameez + the various "suit" names into one set concept.
    query: ["salwar kameez", "shalwar kameez", "salwar suit", "churidar suit", "punjabi suit", "salwar", "shalwar", "kameez", "patiala suit"],
    product: ["salwar kameez", "salwar suit", "salwar", "kameez"]
  },
  sherwani: {
    query: ["sherwani", "sherwanis"],
    product: ["sherwani"]
  },
  nehruJacket: {
    query: ["nehru jacket", "modi jacket", "nehru vest", "ethnic jacket", "bandi jacket"],
    product: ["nehru jacket", "modi jacket"]
  },
  bandhgala: {
    query: ["bandhgala", "bandhagala", "jodhpuri", "jodhpuri suit"],
    product: ["bandhgala", "jodhpuri"]
  },
  dupatta: {
    query: ["dupatta", "duppatta", "chunni", "odhni"],
    product: ["dupatta", "chunni"]
  }
};
var WHOLE_BODY = ["jumpsuit", "romper", "playsuit", "dungaree", "gown", "saree", "lehenga", "kaftan"];
var OTHER_SLOT = ["skirt"];
var SET_PIECE = [
  "co-ord",
  "co ord",
  "coord",
  "co-ords",
  "coords",
  "shorts set",
  "short set",
  "pant set",
  "pants set",
  "trouser set",
  "shirt set",
  "kurta set",
  "night set",
  "pyjama set",
  "pajama set",
  // The comment above names "Top-pants blazer set" as the thing this list is
  // for, and the list did not contain a phrase that matches it. So "Shanaya
  // Top-Pants & Blazer Set" — a womenswear co-ord — led the Blazers strip of a
  // men's wedding search, as the first piece of the first look on the page.
  "blazer set",
  "top-pants",
  "top pants",
  "jacket set",
  "blouse set",
  "skirt set",
  "two piece set",
  "2 piece set",
  "three piece set",
  "3 piece set"
];
var NOT_FOOTWEAR = [
  "sock",
  "socks",
  "stocking",
  "stockings",
  "hosiery",
  "legging",
  "tights",
  "shoe tree",
  "shoe trees",
  "shoe care",
  "shoe polish",
  "shoe cream",
  "shoe bag",
  "shoe horn",
  "insole",
  "insoles",
  "shoelace",
  "shoe lace",
  "laces",
  // Nobody sells three pairs of loafers in a bag.
  //
  // "Rust & Tide Loafers (Pack of 3)" and "Black Essentials Loafers (Pack of
  // 3)" survived the sock rule above because they never say sock where the
  // garment filter can see it: the titles say Loafers, the tags are ["BT"],
  // there is no product type. Only the descriptions give it away — "this
  // loafer sock pack", "these black loafer socks" — and descriptions are
  // exactly what the garment question must not read, or every real loafer
  // whose copy mentions socks goes with them.
  //
  // The multipack is the tell, and it is structural rather than lexical:
  // footwear is sold in pairs, one pair at a time. Hosiery is what comes in
  // threes. At ₹399 for "three pairs of loafers" the price says the same
  // thing, but a price rule would have to hold across every currency and
  // market in the catalogue, and this one does not have to hold across
  // anything.
  "pack of",
  "multipack",
  "multi pack",
  "pairs pack",
  "value pack",
  "combo pack"
];
var GARMENT_EXCLUSIONS = {
  // 'shirt dress' is here for the same reason 't-shirt' is: it is a garment
  // whose name contains "shirt" and which is not one. It arrived at the top of
  // a shirt strip as "MULMUL TINY MOTIFS BLOCK PRINTED SHIRT DRESS".
  shirt: [
    "t-shirt",
    "t shirt",
    "tshirt",
    "tee",
    "tees",
    "sweatshirt",
    "polo",
    "nightshirt",
    "undershirt",
    "henley",
    "shirt dress",
    "shirtdress"
  ],
  polo: ["polo neck", "poloneck", "polo-neck", "water polo"],
  boot: ["bootcut", "boot cut", "bootie shorts", ...NOT_FOOTWEAR],
  // These were PHRASES, and a phrase is the wrong shape for this. "denim dress"
  // never matched "Blue Outline Denim Short Dress" because the words are split
  // by another one, and "Blue Denim Jumpsuit" was not listed at all — so both
  // appeared, on women, in a men's jeans strip.
  //
  // What actually disqualifies them is naming a garment from somewhere else
  // entirely. A dress is not a trouser however much denim is in it. Single
  // words, matched as words, so nothing gets past by having an adjective
  // wedged into the middle.
  jean: ["denim jacket", "denim shirt", "denim jkt", "dress", ...WHOLE_BODY, ...OTHER_SLOT, ...SET_PIECE],
  // A pair of shorts is not a trouser. "Classic Shorts - Navy" stood in the
  // Trousers strip of a wedding search, which is wrong twice over — wrong
  // garment, and wrong for the occasion. Both halves of the bottom slot name
  // the other in tags often enough that this only became safe when the garment
  // question stopped reading descriptions.
  trouser: ["short", "shorts", ...WHOLE_BODY, ...OTHER_SLOT, ...SET_PIECE],
  short: ["dress", ...WHOLE_BODY, ...OTHER_SLOT, "bootie shorts", ...SET_PIECE],
  // A co-ord is a set, not a t-shirt, and it kept arriving as one.
  tshirt: ["track pant", ...WHOLE_BODY, ...SET_PIECE],
  tank: ["tankini"],
  // The shape words above are strong signals on footwear and meaningless
  // elsewhere: "low rise" is a trouser, "track pant" is not a runner, and a
  // "high top" sock is a sock. Each of these would otherwise pull a garment
  // from another slot into the sneaker strip.
  sneaker: [
    "low rise",
    "low-rise",
    "lowrise",
    "high rise",
    "high-rise",
    "high waist",
    "sock",
    "socks",
    "boot",
    "sandal",
    "slide",
    "loafer"
  ],
  // "dress" as a garment must reject the adjectival uses — a "dress shirt" is a
  // shirt, "dress pants" are trousers, "dress shoes" are footwear — and the
  // sleepwear look-alikes (nightgown, dressing gown).
  dress: ["dress shirt", "dress pant", "dress trouser", "dress shoe", "dress sock", "nightgown", "dressing gown"],
  // The outerwear slot had no exclusions at all, so the co-ord rule written for
  // the shorts strip never protected the one strip whose example is named in
  // its own comment.
  blazer: [...WHOLE_BODY, ...SET_PIECE],
  jacket: [...WHOLE_BODY, ...SET_PIECE],
  coat: [...WHOLE_BODY, ...SET_PIECE],
  // The rest of the footwear slot. `sneaker` has carried the sock exclusion
  // since the day a high-top sock led its strip; every other kind of shoe was
  // left open, which is how a hosiery brand sold two pairs of loafers.
  shoe: [...NOT_FOOTWEAR],
  loafer: [...NOT_FOOTWEAR],
  sandal: [...NOT_FOOTWEAR],
  heel: [...NOT_FOOTWEAR],
  derby: [...NOT_FOOTWEAR],
  espadrille: [...NOT_FOOTWEAR],
  clog: [...NOT_FOOTWEAR],
  mule: [...NOT_FOOTWEAR]
};
var GARMENT_PRODUCT_EXCLUSIONS = (() => {
  const m = {};
  for (const [key, ex] of Object.entries(GARMENT_EXCLUSIONS)) {
    if (ex.length === 0) continue;
    for (const term of GARMENT_VOCAB[key]?.product || []) {
      m[term.toLowerCase().trim()] = ex;
    }
  }
  return m;
})();
function matchesGarmentExclusion(haystack, garmentGroup) {
  const excludes = /* @__PURE__ */ new Set();
  for (const term of garmentGroup) {
    const list = GARMENT_PRODUCT_EXCLUSIONS[term.toLowerCase().trim()];
    if (list) for (const e of list) excludes.add(e);
  }
  if (excludes.size === 0) return false;
  for (const t of Array.from(excludes)) {
    const esc = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${esc}s?\\b`, "i").test(haystack)) return true;
  }
  return false;
}
var MATERIAL_VOCAB = {
  linen: ["linen"],
  cotton: ["cotton"],
  wool: ["wool", "woolen", "woollen", "merino"],
  silk: ["silk", "silky"],
  leather: ["leather"],
  denim: ["denim"],
  cashmere: ["cashmere"],
  velvet: ["velvet"],
  suede: ["suede"],
  canvas: ["canvas"],
  fleece: ["fleece"],
  satin: ["satin"],
  lace: ["lace"],
  tweed: ["tweed"],
  corduroy: ["corduroy", "cord"],
  jersey: ["jersey"],
  nylon: ["nylon"],
  polyester: ["polyester"],
  lace_trim: ["lace trim"],
  hemp: ["hemp"]
};
var COLOR_VOCAB = {
  black: ["black", "jet black", "onyx", "noir"],
  white: ["white", "ivory", "ecru", "off-white", "off white"],
  cream: ["cream", "ivory", "ecru", "oatmeal", "bone", "vanilla"],
  beige: ["beige", "sand", "stone", "oatmeal", "taupe"],
  tan: ["tan", "camel", "caramel", "cognac"],
  brown: ["brown", "chocolate", "coffee", "mocha", "espresso", "walnut"],
  grey: ["grey", "gray", "charcoal", "slate", "graphite"],
  gray: ["gray", "grey", "charcoal", "slate", "graphite"],
  navy: ["navy", "midnight", "dark blue"],
  blue: ["blue", "navy", "cobalt", "indigo", "azure"],
  green: ["green", "olive", "sage", "forest", "emerald", "moss"],
  olive: ["olive", "army green", "military green", "moss"],
  red: ["red", "crimson", "scarlet", "cherry"],
  burgundy: ["burgundy", "maroon", "wine", "oxblood", "bordeaux"],
  pink: ["pink", "blush", "rose", "dusty pink"],
  purple: ["purple", "violet", "plum", "lilac", "lavender"],
  orange: ["orange", "rust", "terracotta", "burnt orange", "amber"],
  yellow: ["yellow", "mustard", "ochre", "lemon"],
  gold: ["gold", "golden"],
  silver: ["silver", "metallic"]
};
var FIT_VOCAB = {
  oversized: ["oversized", "oversize", "over-sized", "oversized fit"],
  relaxed: ["relaxed", "relaxed fit", "easy fit"],
  loose: ["loose", "loose fit", "baggy"],
  boxy: ["boxy", "boxy fit"],
  slim: ["slim", "slim fit", "slim-fit", "slimfit"],
  skinny: ["skinny", "skinny fit"],
  muscle: ["muscle fit", "muscle-fit", "athletic fit", "compression fit"],
  regular: ["regular fit", "classic fit", "standard fit", "regular-fit"],
  tailored: ["tailored", "tailored fit", "slim tailored"],
  fitted: ["fitted", "bodycon", "body-con", "body con", "body-hugging"],
  cropped: ["cropped", "crop", "crop fit"],
  longline: ["longline", "long-line", "longer length"],
  "wide-leg": ["wide-leg", "wide leg", "wideleg"],
  "straight-leg": ["straight-leg", "straight leg", "straight fit"],
  bootcut: ["bootcut", "boot cut", "boot-cut"],
  tapered: ["tapered", "tapered fit", "carrot fit"],
  flared: ["flared", "flare", "bell-bottom", "bell bottom", "bootleg flare"],
  "high-rise": ["high-rise", "high rise", "high-waisted", "high waisted", "high waist"],
  "mid-rise": ["mid-rise", "mid rise", "mid-waisted"],
  "low-rise": ["low-rise", "low rise", "low-waisted", "low waist"]
};
var GARMENT_PRODUCT_TERMS = new Set(
  Object.values(GARMENT_VOCAB).flatMap((e) => e.product.map((t) => t.toLowerCase()))
);
var TYPO_MAP = {
  jaket: "jacket",
  jakcet: "jacket",
  jackt: "jacket",
  jaccket: "jacket",
  jacekt: "jacket",
  snekers: "sneakers",
  sneekers: "sneakers",
  snekrs: "sneakers",
  sneaker: "sneaker",
  sneekrs: "sneakers",
  truosers: "trousers",
  trowsers: "trousers",
  trousor: "trousers",
  trosers: "trousers",
  trowser: "trouser",
  tshit: "t-shirt",
  tshrt: "t-shirt",
  teeshirt: "t-shirt",
  teee: "tee",
  shrt: "shirt",
  shert: "shirt",
  shirtt: "shirt",
  shrit: "shirt",
  jeens: "jeans",
  jenes: "jeans",
  jean: "jeans",
  swetar: "sweater",
  sweter: "sweater",
  swaeter: "sweater",
  sweatr: "sweater",
  sweather: "sweater",
  hoody: "hoodie",
  hoddie: "hoodie",
  hodie: "hoodie",
  hoodi: "hoodie",
  jumpr: "jumper",
  jumperr: "jumper",
  trosuer: "trouser",
  jogers: "joggers",
  joggger: "jogger",
  jewelery: "jewelry",
  jewlery: "jewelry",
  jewellary: "jewellery",
  accesories: "accessories",
  accessorie: "accessories",
  acessories: "accessories",
  blak: "black",
  blck: "black",
  balck: "black",
  blakc: "black",
  wihte: "white",
  whyte: "white",
  whit: "white",
  whte: "white",
  wht: "white",
  navi: "navy",
  gery: "grey",
  gray: "grey",
  beig: "beige",
  biege: "beige",
  beigh: "beige",
  brwon: "brown",
  borwn: "brown",
  purpel: "purple",
  gren: "green",
  geren: "green",
  leathr: "leather",
  lether: "leather",
  leater: "leather",
  leathar: "leather",
  coton: "cotton",
  cottn: "cotton",
  cottton: "cotton",
  wooll: "wool",
  linnen: "linen",
  linnene: "linen",
  linin: "linen",
  linnin: "linen",
  cashmer: "cashmere",
  cashmier: "cashmere",
  cashmire: "cashmere",
  denm: "denim",
  denium: "denim",
  deneim: "denim",
  corderoy: "corduroy",
  cordroy: "corduroy",
  dres: "dress",
  dresss: "dress",
  skrit: "skirt",
  shorst: "shorts",
  caot: "coat",
  blazr: "blazer",
  blezer: "blazer",
  bagz: "bags",
  watchs: "watches",
  sunglases: "sunglasses",
  sunglass: "sunglasses",
  wedeing: "wedding",
  weding: "wedding",
  casaul: "casual",
  casul: "casual",
  forml: "formal",
  summr: "summer",
  wntr: "winter",
  ofice: "office",
  officee: "office"
};
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 1) return 2;
  const dp = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_2, j) => i === 0 ? j : j === 0 ? i : 0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + 1);
      }
    }
  }
  return dp[m][n];
}
var OCCASION_VOCAB = [
  "wedding",
  "weddings",
  "interview",
  "interviews",
  "funeral",
  "cocktail",
  "reception",
  "graduation",
  "anniversary",
  "birthday",
  "holiday",
  "vacation",
  "honeymoon",
  "office",
  "business",
  "meeting",
  "presentation",
  "dinner",
  "restaurant",
  "brunch",
  "travel",
  "flight",
  "airport",
  "festival",
  "party",
  "beach",
  "poolside",
  "winter",
  "summer",
  "autumn",
  "spring",
  "monsoon",
  "january",
  "february",
  "march",
  "april",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
  "formal",
  "casual",
  "smart",
  "evening",
  "daytime",
  "outfit",
  "outfits",
  "wardrobe"
];
var CORRECTION_VOCAB = Array.from(new Set([
  ...Array.from(GARMENT_PRODUCT_TERMS),
  ...Object.values(MATERIAL_VOCAB).flat(),
  ...Object.values(COLOR_VOCAB).flat(),
  ...OCCASION_VOCAB
].map((w) => w.toLowerCase()).filter((w) => /^[a-z]{4,}$/.test(w))));
var CORRECTION_SET = new Set(CORRECTION_VOCAB);
var FIT_WORD_SET = new Set(
  Object.values(FIT_VOCAB).flat().flatMap((t) => t.split(/[\s-]+/)).filter((w) => w.length >= 3).map((w) => w.toLowerCase())
);
var TYPO_SKIP = /* @__PURE__ */ new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "some",
  "any",
  "are",
  "was",
  "not",
  "but",
  "you",
  "your",
  "have",
  "want",
  "went",
  "need",
  "like",
  "love",
  "nice",
  "good",
  "best",
  "cost",
  "rest",
  "test",
  "bed",
  "ten",
  "ton",
  "set",
  "get",
  "looking",
  "something",
  "anything",
  "casual",
  "formal",
  "summer",
  "winter",
  "wedding",
  "work",
  "date",
  "party",
  "beach",
  "office",
  "under",
  "over",
  "cheap",
  "size",
  "color",
  "colour",
  "style",
  "brand",
  "shop",
  "store",
  "from",
  "wear",
  "them",
  "they",
  "here",
  "there",
  "what",
  "when",
  "show",
  "find",
  "give"
]);
function matchCase(orig, repl) {
  const first = orig.charAt(0);
  if (first !== first.toLowerCase() && first === first.toUpperCase()) {
    return repl.charAt(0).toUpperCase() + repl.slice(1);
  }
  return repl;
}
function normalizeFashionTypos(text) {
  if (!text) return text;
  return text.replace(/[a-zA-Z][a-zA-Z'-]*/g, (token) => {
    const lower = token.toLowerCase();
    if (lower.length < 3) return token;
    if (CORRECTION_SET.has(lower) || GARMENT_PRODUCT_TERMS.has(lower) || FIT_WORD_SET.has(lower)) return token;
    const mapped = TYPO_MAP[lower];
    if (mapped) return matchCase(token, mapped);
    if (lower.endsWith("s")) {
      const singular = TYPO_MAP[lower.slice(0, -1)];
      if (singular) return matchCase(token, singular + "s");
    }
    if (TYPO_SKIP.has(lower)) return token;
    let best = null, bestDist = 9, ties = 0;
    for (const cand of CORRECTION_VOCAB) {
      if (Math.abs(cand.length - lower.length) > 1) continue;
      const d = levenshtein(lower, cand);
      if (d < bestDist) {
        bestDist = d;
        best = cand;
        ties = 0;
      } else if (d === bestDist) ties++;
    }
    if (best && bestDist === 1 && ties === 0) return matchCase(token, best);
    return token;
  });
}
function decomposeQuery(query) {
  const lower = query.toLowerCase();
  const gender = detectGenderInQuery(lower) ?? void 0;
  const matchedKeys = [];
  for (const [key, entry] of Object.entries(GARMENT_VOCAB)) {
    if (entry.query.some((term) => hasWord(lower, term))) {
      matchedKeys.push(key);
    }
  }
  const garmentKeys = matchedKeys.filter((key) => {
    const ex = GARMENT_EXCLUSIONS[key];
    if (!ex || ex.length === 0) return true;
    const ownTerms = [
      ...GARMENT_VOCAB[key]?.product || [],
      ...GARMENT_VOCAB[key]?.query || []
    ].map((t) => t.toLowerCase().trim()).filter(Boolean);
    return !ex.some((term) => {
      const t = term.toLowerCase().trim();
      if (!t || !(hasWord(lower, t) || hasWord(lower, `${t}s`))) return false;
      return ownTerms.some((own) => t !== own && t.includes(own));
    });
  });
  const materials = [];
  for (const [mat] of Object.entries(MATERIAL_VOCAB)) {
    if (hasWord(lower, mat)) materials.push(mat);
  }
  const colors = [];
  for (const [color] of Object.entries(COLOR_VOCAB)) {
    if (hasWord(lower, color)) colors.push(color);
  }
  const fits = [];
  for (const [fit, syns] of Object.entries(FIT_VOCAB)) {
    if (syns.some((term) => hasWord(lower, term))) fits.push(fit);
  }
  return { gender, garmentKeys, materials, colors, fits };
}
function buildMandatoryConcepts(query) {
  const { gender, garmentKeys, materials, colors, fits } = decomposeQuery(query);
  const concepts = [];
  for (const key of garmentKeys) {
    const entry = GARMENT_VOCAB[key];
    if (entry) concepts.push(entry.product);
  }
  for (const mat of materials) {
    const synonyms = MATERIAL_VOCAB[mat];
    if (synonyms) concepts.push(synonyms);
  }
  for (const color of colors) {
    const synonyms = COLOR_VOCAB[color];
    if (synonyms) concepts.push(synonyms);
  }
  for (const fit of fits) {
    const synonyms = FIT_VOCAB[fit];
    if (synonyms) concepts.push(synonyms);
  }
  if (gender === "men") concepts.push(["men", "mens", "man", "male", "unisex"]);
  if (gender === "women") concepts.push(["women", "womens", "woman", "ladies", "female"]);
  return concepts;
}
function augmentConcepts(llmConcepts, query) {
  const deterministic = buildMandatoryConcepts(query);
  if (deterministic.length === 0) return llmConcepts;
  const merged = [...llmConcepts];
  for (const detGroup of deterministic) {
    const alreadyCovered = merged.some(
      (existing) => existing.some(
        (a) => detGroup.some((b) => a.toLowerCase().trim() === b.toLowerCase().trim())
      )
    );
    if (!alreadyCovered) merged.push(detGroup);
  }
  return merged;
}
var GARMENT_CATEGORY = {
  shirt: "top",
  tshirt: "top",
  blouse: "top",
  polo: "top",
  tank: "top",
  sweater: "top",
  hoodie: "top",
  cardigan: "top",
  henley: "top",
  turtleneck: "top",
  trouser: "bottom",
  jean: "bottom",
  chino: "bottom",
  short: "bottom",
  skirt: "bottom",
  legging: "bottom",
  cargo: "bottom",
  jogger: "bottom",
  sweatpant: "bottom",
  culotte: "bottom",
  capri: "bottom",
  jacket: "outer",
  blazer: "outer",
  coat: "outer",
  vest: "outer",
  bomber: "outer",
  denimJacket: "outer",
  windbreaker: "outer",
  dress: "dress",
  jumpsuit: "dress",
  bodysuit: "dress",
  gown: "dress",
  shoe: "shoes",
  sneaker: "shoes",
  boot: "shoes",
  loafer: "shoes",
  sandal: "shoes",
  heel: "shoes",
  derby: "shoes",
  espadrille: "shoes",
  clog: "shoes",
  mule: "shoes",
  flat: "shoes",
  // Indian / South-Asian
  kurta: "top",
  kurti: "top",
  palazzo: "bottom",
  churidar: "bottom",
  sharara: "bottom",
  gharara: "bottom",
  dhoti: "bottom",
  lehenga: "bottom",
  saree: "dress",
  anarkali: "dress",
  kaftan: "dress",
  salwarKameez: "dress",
  sherwani: "outer",
  nehruJacket: "outer",
  bandhgala: "outer",
  dupatta: "accessory",
  bag: "accessory",
  tote: "accessory",
  backpack: "accessory",
  hat: "accessory",
  scarf: "accessory",
  belt: "accessory",
  sock: "accessory",
  sunglasses: "accessory",
  watch: "accessory",
  jewelry: "accessory",
  wallet: "accessory"
};
var SLOT_LABELS = {
  top: "Top",
  bottom: "Bottom",
  outer: "Outer",
  dress: "Dress",
  shoes: "Shoes",
  accessory: "Accessory"
};
function slotLabelFor(cat) {
  return SLOT_LABELS[cat];
}
var GENERIC_GARMENTS = {
  shoe: "shoes"
};
function dropGenericWhenSpecific(keys) {
  if (keys.length < 2) return keys;
  return keys.filter((key) => {
    const slot = GENERIC_GARMENTS[key];
    if (!slot) return true;
    return !keys.some((other) => other !== key && GARMENT_CATEGORY[other] === slot);
  });
}
function classifyQuerySlot(query) {
  const { garmentKeys } = decomposeQuery(query);
  for (const key of garmentKeys) {
    const cat = GARMENT_CATEGORY[key];
    if (cat) return cat;
  }
  return null;
}
function productSlotCategories(p) {
  const text = `${p.title || ""} ${(p.tags || []).join(" ")} ${p.description || ""}`.toLowerCase();
  const cats = /* @__PURE__ */ new Set();
  const fromTaxonomy = taxonomySlot(p.categories);
  if (fromTaxonomy) cats.add(fromTaxonomy);
  for (const [key, entry] of Object.entries(GARMENT_VOCAB)) {
    const cat = GARMENT_CATEGORY[key];
    if (!cat) continue;
    if (entry.product.some((term) => hasWord(text, term))) cats.add(cat);
  }
  return cats;
}
function productMatchesSlot(p, cat) {
  return productSlotCategories(p).has(cat);
}
function productMatchesGarmentKey(p, key) {
  const entry = GARMENT_VOCAB[key];
  if (!entry) return false;
  const text = `${p.title || ""} ${(p.tags || []).join(" ")} ${p.description || ""}`.toLowerCase();
  const namedByShopify = taxonomyGarmentKey(p.categories) === key;
  if (!namedByShopify && !entry.product.some((term) => hasWord(text, term))) return false;
  if (matchesGarmentExclusion(text, entry.product)) return false;
  return true;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  COLOR_VOCAB,
  FIT_VOCAB,
  GARMENT_CATEGORY,
  GARMENT_EXCLUSIONS,
  GARMENT_PRODUCT_EXCLUSIONS,
  GARMENT_PRODUCT_TERMS,
  GARMENT_VOCAB,
  MATERIAL_VOCAB,
  augmentConcepts,
  buildMandatoryConcepts,
  classifyQuerySlot,
  decomposeQuery,
  detectGenderInQuery,
  dropGenericWhenSpecific,
  matchesGarmentExclusion,
  normalizeFashionTypos,
  productMatchesGarmentKey,
  productMatchesSlot,
  productSlotCategories,
  slotLabelFor
});
