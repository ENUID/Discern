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

// lib/fashion/outfitKnowledge.ts
var outfitKnowledge_exports = {};
__export(outfitKnowledge_exports, {
  coherence: () => coherence,
  colorFamily: () => colorFamily,
  composeOutfit: () => composeOutfit,
  composeOutfits: () => composeOutfits,
  composeOutfitsWithProfiles: () => composeOutfitsWithProfiles,
  intentKey: () => intentKey,
  outfitPlan: () => outfitPlan,
  pieceFormality: () => pieceFormality,
  planPromptBlock: () => planPromptBlock,
  readGender: () => readGender,
  readOccasion: () => readOccasion,
  readSeason: () => readSeason,
  retrievalQueries: () => retrievalQueries,
  seasonAvoids: () => seasonAvoids,
  seasonFabrics: () => seasonFabrics
});
module.exports = __toCommonJS(outfitKnowledge_exports);

// lib/queryParser.ts
var GARMENT_VOCAB = {
  // ── Tops ──────────────────────────────────────────────────────────────────
  shirt: {
    query: ["shirt", "shirts"],
    product: ["shirt", "button-up", "button-down", "dress shirt", "oxford shirt", "flannel shirt", "overshirt", "camp shirt", "woven shirt"]
  },
  tshirt: {
    query: ["t-shirt", "t shirt", "tshirt", "tee", "tees"],
    product: ["t-shirt", "tshirt", "tee", "tees"]
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

// lib/fashion/outfitKnowledge.ts
var SEASONS = {
  spring: {
    match: /\b(spring|april|may|march)\b/i,
    fabrics: ["cotton", "lightweight wool", "poplin", "gabardine"],
    avoid: ["shearling", "heavy tweed"]
  },
  summer: {
    match: /\b(summer|june|july|august|beach|tropical|resort|hot weather|humid)\b/i,
    fabrics: ["linen", "cotton", "silk", "seersucker"],
    avoid: ["wool", "cashmere", "shearling", "corduroy"]
  },
  autumn: {
    match: /\b(autumn|fall|september|october|november)\b/i,
    fabrics: ["wool", "flannel", "corduroy", "suede", "leather"],
    avoid: ["linen", "seersucker"]
  },
  winter: {
    match: /\b(winter|december|january|february|snow|ski|cold weather|freezing)\b/i,
    fabrics: ["wool", "cashmere", "shearling", "down", "tweed"],
    avoid: ["linen", "seersucker"]
  }
};
function readSeason(query) {
  for (const [key, s] of Object.entries(SEASONS)) {
    if (s.match.test(query)) return key;
  }
  return null;
}
function seasonFabrics(season) {
  return season ? SEASONS[season].fabrics : [];
}
function seasonAvoids(season) {
  return season ? SEASONS[season].avoid : [];
}
var OCCASIONS = [
  {
    key: "black-tie",
    match: /\b(black[- ]?tie|tuxedos?|galas?|opera|balls?)\b/i,
    formality: 5,
    slots: { men: ["blazer", "shirt", "trouser", "derby"], women: ["gown", "heel", "jewelry"] },
    palette: ["black", "midnight blue", "ivory"],
    note: "Black tie: dinner jacket or full-length gown only. Anything that could be worn to an office is under-dressed."
  },
  {
    key: "wedding-guest",
    match: /\b(weddings?|marriage|nikah|receptions?|civil ceremony|shaadi|baraat|sangeet)\b/i,
    formality: 4,
    slots: { men: ["blazer", "shirt", "trouser", "loafer"], women: ["dress", "heel", "bag"] },
    // White is the one genuine rule in menswear-and-womenswear alike; it is
    // not a taste call and belongs in the data rather than in a prompt.
    palette: ["navy", "sage", "dusty rose", "burgundy", "stone"],
    note: "Wedding guest: never white, never ivory, never bridal. Tailoring or a proper dress; sharp shoes."
  },
  {
    key: "interview",
    match: /\b(interviews?|interviewing|job interview|first day|presentations?|pitch(?:es|ing)?|viva)\b/i,
    formality: 4,
    slots: { men: ["blazer", "shirt", "trouser", "derby"], women: ["blazer", "blouse", "trouser", "flat"] },
    palette: ["navy", "charcoal", "white", "grey"],
    note: "Interview: quiet and exact. Nothing loud enough to be remembered instead of you."
  },
  {
    key: "funeral",
    match: /\b(funerals?|memorial|wake|condolences?|prayer meet)\b/i,
    formality: 4,
    slots: { men: ["blazer", "shirt", "trouser", "derby"], women: ["dress", "coat", "flat"] },
    palette: ["black", "charcoal", "navy"],
    note: "Funeral: black or near-black, matte, nothing that catches light or attention."
  },
  {
    key: "cocktail",
    match: /\b(cocktails?|evening do|drinks party|christmas party|new year'?s? eve|night ?out|clubbing|party)\b/i,
    formality: 4,
    slots: { men: ["blazer", "shirt", "trouser", "loafer"], women: ["dress", "heel", "jewelry"] },
    palette: ["black", "emerald", "burgundy", "midnight blue"],
    note: "Cocktail: shorter and sharper than black tie, dressier than any office. Sneakers fail here regardless of price."
  },
  {
    key: "work",
    match: /\b(work|working|office|business|workwear|corporate|meetings?|9[- ]?to[- ]?5|formals?)\b/i,
    formality: 3,
    slots: { men: ["shirt", "trouser", "blazer", "loafer"], women: ["blouse", "trouser", "blazer", "flat"] },
    palette: ["navy", "charcoal", "white", "camel", "olive"],
    note: "Work: repeatable rather than memorable. Pieces that go with what is already in the wardrobe."
  },
  {
    key: "dinner",
    match: /\b(dinners?|date night|dates?|restaurants?|anniversary|dinner party|lunch date)\b/i,
    formality: 3,
    slots: { men: ["shirt", "trouser", "jacket", "loafer"], women: ["dress", "heel", "jacket"] },
    palette: ["black", "burgundy", "ink", "chocolate"],
    note: "Dinner: one considered piece, everything else quiet around it. Fabric reads more than colour under low light."
  },
  {
    key: "travel",
    match: /\b(travel(?:ling|ing)?|flights?|flying|long[- ]haul|airport|road trip|commute|commuting)\b/i,
    formality: 2,
    slots: { men: ["tshirt", "trouser", "jacket", "sneaker"], women: ["tshirt", "trouser", "cardigan", "sneaker"] },
    palette: ["black", "navy", "grey", "stone"],
    note: "Travel: creases and layers decide this. Knit over woven, one warm layer that packs down."
  },
  {
    key: "holiday",
    match: /\b(holidays?|vacations?|vacationing|beach(?:y|es)?|seaside|poolside|island|honeymoon|getaway|resort|goa|maldives)\b/i,
    formality: 2,
    slots: { men: ["shirt", "short", "sandal"], women: ["dress", "sandal", "bag"] },
    palette: ["white", "stone", "sky", "terracotta"],
    note: "Holiday: linen and cotton, loose, pale. Anything synthetic is unwearable in real heat."
  },
  {
    key: "weekend",
    match: /\b(weekends?|casual(?:ly|s)?|every ?-? ?day|day[- ]to[- ]day|daily|brunch|day off|errands?|regular wear|lounging|chill(?:ing)?)\b/i,
    formality: 2,
    slots: { men: ["tshirt", "jean", "jacket", "sneaker"], women: ["tshirt", "jean", "cardigan", "sneaker"] },
    palette: ["indigo", "white", "olive", "grey"],
    note: "Weekend: comfort without giving up shape. Fit is what separates this from loungewear."
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
    key: "open-style",
    match: /\b(fashion sense|style sense|dress better|dress well|improve my (?:style|wardrobe|fashion)|up my (?:style|fashion|game)|style (?:advice|tips|help)|outfit ideas|some outfits|any outfits|help me dress|what (?:should|do) i wear\b(?!.*\b(?:to|for)\b))/i,
    formality: 2,
    slots: { men: ["shirt", "trouser", "sneaker"], women: ["tshirt", "jean", "cardigan", "sneaker"] },
    palette: ["cream", "ecru", "stone", "navy", "olive", "taupe"],
    note: "No occasion named: this is the house look. Neutrals with at most one muted colour, volume below the waist, texture rather than print, and a low-profile shoe. Nothing athletic, nothing beachy, nothing loud \u2014 the point is pieces that go with what they already own."
  },
  {
    key: "gym",
    match: /\b(gyms?|workouts?|working out|training|runs?|running|jog(?:ging)?|yoga|pilates|athleisure)\b/i,
    formality: 1,
    slots: { men: ["tshirt", "short", "sneaker"], women: ["tank", "legging", "sneaker"] },
    palette: ["black", "grey", "navy"],
    note: "Training: technical fabric only. Cotton holds sweat and is the one place natural fibre loses."
  }
];
var PLACE_BEATS_PARTY = [
  [/\b(beach|poolside|pool|seaside|island|resort|shore|sand)\b/i, "holiday"],
  [/\b(gym|workout|training)\b/i, "gym"],
  [/\b(wedding|shaadi|nikah|reception)\b/i, "wedding-guest"],
  [/\b(funeral|memorial)\b/i, "funeral"],
  [/\b(interview)\b/i, "interview"]
];
var UNQUALIFIED_CASUAL = /(?<!\b(?:smart|business|dressy|elevated)[\s-])\bcasual\b/i;
var GENERIC_GATHERING = /\b(part(?:y|ies)|night ?out|nights? out|drinks|get[- ]?together|hang ?out|meet[- ]?up)\b/i;
function readOccasion(query) {
  for (const [re, key] of PLACE_BEATS_PARTY) {
    if (!re.test(query)) continue;
    const hit = OCCASIONS.find((o) => o.key === key);
    if (hit) return hit;
  }
  if (UNQUALIFIED_CASUAL.test(query) && GENERIC_GATHERING.test(query)) {
    const hit = OCCASIONS.find((o) => o.key === "weekend");
    if (hit) return hit;
  }
  for (const o of OCCASIONS) if (o.match.test(query)) return o;
  return null;
}
var COLOR_FAMILY = [
  [/\b(black|white|ivory|cream|grey|gray|charcoal|stone|ecru|off[- ]white|bone)\b/i, "neutral"],
  [/\b(camel|tan|beige|khaki|olive|chocolate|brown|rust|terracotta|sand|taupe|cognac)\b/i, "earth"],
  [/\b(navy|indigo|denim|slate|sky|steel|ink|midnight)\b/i, "cool"],
  [/\b(red|orange|coral|mustard|amber|scarlet|tomato)\b/i, "warm"],
  [/\b(burgundy|emerald|sapphire|plum|forest|oxblood|teal|bottle green)\b/i, "jewel"],
  [/\b(blush|dusty rose|lilac|mint|butter|powder blue|sage)\b/i, "pastel"]
];
function colorFamily(text) {
  for (const [re, fam] of COLOR_FAMILY) if (re.test(text)) return fam;
  return null;
}
var FORMALITY_WORDS = [
  [/\b(tuxedo|dinner jacket|gown|tailcoat)\b/i, 5],
  [/\b(blazer|suit|oxford shoe|derby|brogue|dress shirt|waistcoat|tie)\b/i, 4],
  [/\b(loafer|shirt|trouser|chino|knit|cardigan|overshirt|monk|boot)\b/i, 3],
  [/\b(jean|denim|t-?shirt|tee|polo|sneaker|trainer|jacket|sweater|jumper)\b/i, 2],
  [/\b(hoodie|sweatpant|jogger|short|slide|sandal|track|gym|legging)\b/i, 1]
];
function pieceFormality(text) {
  for (const [re, level] of FORMALITY_WORDS) if (re.test(text)) return level;
  return void 0;
}
function coherence(pieces) {
  if (pieces.length < 2) return 1;
  const families = pieces.map((p) => colorFamily(p.text)).filter(Boolean);
  const nonNeutral = new Set(families.filter((f) => f !== "neutral"));
  const colorScore = nonNeutral.size <= 1 ? 1 : nonNeutral.size === 2 ? 0.7 : 0.35;
  const echo = families.length >= 2 && new Set(families).size < families.length ? 1 : 0;
  const levels = pieces.map((p) => p.formality ?? pieceFormality(p.text)).filter((f) => typeof f === "number");
  if (levels.length < 2) return +(colorScore * 0.85 + echo * 0.15).toFixed(3);
  const spread = Math.max(...levels) - Math.min(...levels);
  const formalityScore = spread <= 1 ? 1 : spread === 2 ? 0.6 : 0.25;
  return +(colorScore * 0.4 + formalityScore * 0.45 + echo * 0.15).toFixed(3);
}
function composeOutfit(slots, textOf, opts = {}) {
  const perSlot = Math.max(1, opts.perSlot ?? 3);
  const weight = opts.weight ?? 0.35;
  const usable = slots.filter((s) => s.products.length > 0);
  if (usable.length < 2) return slots;
  if (usable.length > 5) return slots;
  const options = usable.map((s) => s.products.slice(0, perSlot));
  let bestCombo = null;
  let bestScore = -Infinity;
  const walk = (depth, picked) => {
    if (depth === options.length) {
      const pieces = picked.map((idx, i) => ({ text: textOf(options[i][idx]) }));
      const relevance = picked.reduce((sum, idx) => sum + (1 - idx * 0.34), 0) / picked.length;
      const score = relevance * (1 - weight) + coherence(pieces) * weight;
      if (score > bestScore) {
        bestScore = score;
        bestCombo = [...picked];
      }
      return;
    }
    for (let i = 0; i < options[depth].length; i++) walk(depth + 1, [...picked, i]);
  };
  walk(0, []);
  if (!bestCombo) return slots;
  const lead = /* @__PURE__ */ new Map();
  usable.forEach((s, i) => lead.set(s.products, bestCombo[i]));
  return slots.map((s) => {
    const idx = lead.get(s.products);
    if (!idx) return s;
    const chosen = s.products[idx];
    return { ...s, products: [chosen, ...s.products.filter((_, i) => i !== idx)] };
  });
}
function readGender(input) {
  const s = input || "";
  if (/\b(women|womens|women's|female|ladies)\b/i.test(s)) return "Women";
  if (/\b(men|mens|men's|male)\b/i.test(s)) return "Men";
  return null;
}
function outfitPlan(query, gender) {
  const occasion = readOccasion(query);
  if (!occasion) return null;
  const season = readSeason(query);
  const slots = readGender(gender) === "Women" ? occasion.slots.women : occasion.slots.men;
  return {
    occasion: occasion.key,
    formality: occasion.formality,
    season,
    slots,
    palette: occasion.palette,
    fabrics: seasonFabrics(season),
    note: occasion.note
  };
}
function retrievalQueries(query, gender) {
  const plan = outfitPlan(query, gender);
  if (!plan) return [];
  const fabric = plan.fabrics[0];
  const colour = plan.palette[0];
  const out = [];
  for (const slot of plan.slots.slice(0, 3)) {
    const term = GARMENT_VOCAB[slot]?.query[0] || slot;
    out.push([fabric, term].filter(Boolean).join(" "));
  }
  if (colour && plan.slots.length) {
    const lead = GARMENT_VOCAB[plan.slots[0]]?.query[0] || plan.slots[0];
    out.push(`${colour} ${lead}`);
  }
  return Array.from(new Set(out.map((s) => s.trim()).filter((s) => s.length >= 3))).slice(0, 3);
}
function intentKey(query, gender) {
  const occasion = readOccasion(query);
  const season = readSeason(query);
  const family = colorFamily(query);
  return [
    occasion?.key ?? "-",
    season ?? "-",
    family ?? "-",
    readGender(gender) ?? "-"
  ].join("|");
}
function planPromptBlock(query, gender) {
  const plan = outfitPlan(query, gender);
  if (!plan) return "";
  const bits = [
    `Occasion: ${plan.occasion} (formality ${plan.formality}/5). ${plan.note}`,
    `Palette that reads right: ${plan.palette.join(", ")}.`
  ];
  if (plan.season) {
    bits.push(`Season: ${plan.season} \u2014 ${plan.fabrics.join(", ")}. Wrong for it: ${seasonAvoids(plan.season).join(", ")}.`);
  }
  return bits.join("\n");
}
function composeOutfitsWithProfiles(slots, textOf, profileOf, worksWith, opts = {}) {
  const count = Math.max(1, opts.count ?? 4);
  const perSlot = Math.max(1, opts.perSlot ?? 6);
  const weight = opts.weight ?? 0.6;
  const usable = slots.filter((s) => s.products.length > 0);
  if (usable.length < 2 || usable.length > 5) return [];
  const options = usable.map((s) => s.products.slice(0, perSlot));
  const combos = [];
  const walk = (depth, picked) => {
    if (depth === options.length) {
      const chosen = picked.map((idx, i) => options[i][idx]);
      const profiles = chosen.map(profileOf);
      let worst = 1;
      let pairs = 0;
      for (let i = 0; i < profiles.length; i++) {
        for (let j = i + 1; j < profiles.length; j++) {
          const a = profiles[i], b = profiles[j];
          if (!a || !b) continue;
          worst = Math.min(worst, worksWith(a, b));
          pairs++;
        }
      }
      const fit = pairs > 0 ? worst : coherence(chosen.map((p) => ({ text: textOf(p) })));
      const relevance = picked.reduce((sum, idx) => sum + (1 - idx * 0.14), 0) / picked.length;
      combos.push({ idx: [...picked], score: relevance * (1 - weight) + fit * weight });
      return;
    }
    for (let i = 0; i < options[depth].length; i++) walk(depth + 1, [...picked, i]);
  };
  walk(0, []);
  combos.sort((a, b) => b.score - a.score);
  const usedPiece = options.map(() => /* @__PURE__ */ new Set());
  const out = [];
  for (const c of combos) {
    if (out.length >= count) break;
    const ids = c.idx.map((idx, i) => textOf(options[i][idx]).toLowerCase().trim());
    if (ids.some((id, i) => usedPiece[i].has(id))) continue;
    ids.forEach((id, i) => usedPiece[i].add(id));
    out.push({
      score: +c.score.toFixed(3),
      pieces: c.idx.map((idx, i) => ({
        label: usable[i].label ?? `Slot ${i + 1}`,
        product: options[i][idx]
      }))
    });
  }
  return out;
}
function composeOutfits(slots, textOf, opts = {}) {
  const count = Math.max(1, opts.count ?? 4);
  const perSlot = Math.max(1, opts.perSlot ?? 6);
  const weight = opts.weight ?? 0.45;
  const usable = slots.filter((s) => s.products.length > 0);
  if (usable.length < 2) return [];
  if (usable.length > 5) return [];
  const options = usable.map((s) => s.products.slice(0, perSlot));
  const combos = [];
  const walk = (depth, picked) => {
    if (depth === options.length) {
      const pieces = picked.map((idx, i) => ({ text: textOf(options[i][idx]) }));
      const relevance = picked.reduce((sum, idx) => sum + (1 - idx * 0.14), 0) / picked.length;
      combos.push({ idx: [...picked], score: relevance * (1 - weight) + coherence(pieces) * weight });
      return;
    }
    for (let i = 0; i < options[depth].length; i++) walk(depth + 1, [...picked, i]);
  };
  walk(0, []);
  combos.sort((a, b) => b.score - a.score);
  const identity = (p) => {
    const anyP = p;
    return (anyP?.title || anyP?.id || String(p)).toLowerCase().replace(/\s+/g, " ").trim();
  };
  const used = options.map(() => /* @__PURE__ */ new Set());
  const out = [];
  for (const c of combos) {
    if (out.length >= count) break;
    if (c.idx.some((idx, i) => used[i].has(identity(options[i][idx])))) continue;
    c.idx.forEach((idx, i) => used[i].add(identity(options[i][idx])));
    out.push({
      score: +c.score.toFixed(3),
      pieces: c.idx.map((idx, i) => ({
        label: usable[i].label ?? `Slot ${i + 1}`,
        product: options[i][idx]
      }))
    });
  }
  return out;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  coherence,
  colorFamily,
  composeOutfit,
  composeOutfits,
  composeOutfitsWithProfiles,
  intentKey,
  outfitPlan,
  pieceFormality,
  planPromptBlock,
  readGender,
  readOccasion,
  readSeason,
  retrievalQueries,
  seasonAvoids,
  seasonFabrics
});
