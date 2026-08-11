export type StoreProfile = {
  domain: string;
  /** Human display name of the brand, used for brand-specific search detection. */
  name?: string;
  categories: string[];
  vibe: string[];
  languages?: string[];
  // ── NEW ──
  gender?: ('men' | 'women' | 'unisex')[];
  priceRange?: 'budget' | 'mid' | 'premium' | 'luxury';
  items?: string[];     // specific product types stocked
  about?: string;       // one-line brand identity for AI
};

// Raw roster before the US/India market filter below — kept as an internal
// name so every existing consumer of UCP_REGISTRY (search, brand-health
// cron, featured feed, brand detection) picks up the filtered set for free
// without needing to change a single call site.
const UCP_REGISTRY_ALL: StoreProfile[] = [
  {
    "domain": "gymsharkusa.myshopify.com",
    "categories": [
      "top",
      "bottom",
      "outerwear",
      "footwear",
      "underwear"
    ],
    "vibe": [
      "workout",
      "sport",
      "active",
      "seamless"
    ],
    "gender": ["women", "men"],
    "priceRange": "mid",
    "items": ["leggings", "sports bra", "gym shorts", "training top", "hoodie", "jogger", "cycling shorts"],
    "about": "High-performance gym and training apparel — technical fabrics, athletic fits"
  },
  {
    "domain": "skimsbody.myshopify.com",
    "categories": [
      "top",
      "bottom",
      "dress",
      "outerwear",
      "footwear",
      "underwear",
      "accessory"
    ],
    "vibe": [
      "seamless",
      "bodycon",
      "minimalist",
      "luxury"
    ],
    "gender": ["women"],
    "priceRange": "premium",
    "items": ["shapewear", "bodysuit", "bodycon dress", "bralette", "underwear", "lounge set", "catsuit"],
    "about": "Sculpting shapewear and second-skin basics — smooth, bonded, inclusive sizing"
  },
  {
    "domain": "aloyoga.com",
    "categories": [
      "bottom",
      "outerwear",
      "underwear",
      "accessory"
    ],
    "vibe": [
      "active",
      "seamless",
      "luxury"
    ],
    "gender": ["women", "men"],
    "priceRange": "premium",
    "items": ["yoga legging", "sports bra", "hoodie", "jacket", "sweatpant", "shorts", "bodysuit"],
    "about": "Yoga-to-street premium activewear — studio-ready silhouettes with high-fashion edge"
  },
  {
    "domain": "kith.com",
    "categories": [
      "top",
      "bottom",
      "outerwear",
      "footwear",
      "accessory"
    ],
    "vibe": [
      "streetwear",
      "luxury",
      "casual"
    ],
    "gender": ["men", "women", "unisex"],
    "priceRange": "premium",
    "items": ["graphic tee", "hoodie", "crewneck sweatshirt", "cargo pant", "jacket", "sneaker", "co-ord set"],
    "about": "NYC streetwear institution — cultural collaborations, premium casual, elevated hype"
  },
  {
    "domain": "fashionnova.com",
    "categories": [
      "top",
      "bottom",
      "outerwear",
      "footwear",
      "underwear",
      "accessory"
    ],
    "vibe": [
      "bodycon",
      "casual",
      "denim"
    ],
    "gender": ["women", "men"],
    "priceRange": "budget",
    "items": ["mini dress", "bodycon dress", "crop top", "jeans", "two-piece set", "swimsuit", "jumpsuit"],
    "about": "Fast fashion for bold, body-conscious looks — curve-friendly fits, viral styles"
  },
  {
    "domain": "allbirds.com",
    "categories": [
      "footwear"
    ],
    "vibe": [
      "sustainable",
      "minimalist",
      "casual"
    ],
    "gender": ["men", "women", "unisex"],
    "priceRange": "mid",
    "items": ["wool runner sneaker", "trail shoe", "slip-on", "loafer", "boot"],
    "about": "Carbon-neutral footwear made from natural materials — merino wool, eucalyptus, sugarcane"
  },
  {
    "domain": "taylorstitch.com",
    "categories": [
      "top",
      "bottom",
      "outerwear",
      "accessory"
    ],
    "vibe": [
      "heritage-workwear",
      "organic",
      "minimalist",
      "outdoor"
    ],
    "gender": ["men"],
    "priceRange": "premium",
    "items": ["oxford shirt", "linen shirt", "flannel shirt", "chino", "selvedge denim", "overshirt", "chore coat", "work jacket", "sweatshirt"],
    "about": "San Francisco heritage menswear — natural fabrics, Made in USA quality, built-to-last pieces"
  },
  {
    "domain": "marinelayer.com",
    "categories": [
      "top",
      "bottom",
      "dress",
      "outerwear",
      "underwear",
      "accessory"
    ],
    "vibe": [
      "coastal",
      "casual",
      "organic"
    ],
    "gender": ["men", "women"],
    "priceRange": "mid",
    "items": ["linen shirt", "tee", "hoodie", "shorts", "straight-leg pant", "dress", "swimwear", "chino"],
    "about": "California coastal basics in ultra-soft micro modal and linen — effortless weekend dressing"
  },
  {
    "domain": "bombas.myshopify.com",
    "categories": [
      "top",
      "underwear"
    ],
    "vibe": [
      "active",
      "casual",
      "sustainable"
    ],
    "gender": ["men", "women", "unisex"],
    "priceRange": "mid",
    "items": ["socks", "underwear", "tee"],
    "about": "Premium comfort socks and underwear — buy-one-give-one charity model"
  },
  {
    "domain": "chubbies.myshopify.com",
    "categories": [
      "top",
      "bottom",
      "outerwear",
      "underwear"
    ],
    "vibe": [
      "casual",
      "resort",
      "coastal"
    ],
    "gender": ["men"],
    "priceRange": "mid",
    "items": ["swim trunks", "shorts", "polo", "tee", "chino", "hoodie"],
    "about": "Weekend menswear for short-inseam life — retro-inspired shorts, beach-ready casual"
  },
  {
    "domain": "goodamerican.com",
    "categories": [
      "top",
      "bottom",
      "dress",
      "outerwear",
      "accessory"
    ],
    "vibe": [
      "denim",
      "bodycon",
      "casual"
    ],
    "gender": ["women"],
    "priceRange": "premium",
    "items": ["jeans", "denim jacket", "bodycon dress", "legging", "crop top", "co-ord set"],
    "about": "Khloé Kardashian's inclusive denim brand — curves-first fit with premium stretch"
  },
  {
    "domain": "faherty.myshopify.com",
    "categories": [
      "top",
      "bottom",
      "dress",
      "outerwear",
      "accessory"
    ],
    "vibe": [
      "coastal",
      "organic",
      "resort",
      "heritage-workwear"
    ],
    "gender": ["men", "women"],
    "priceRange": "premium",
    "items": ["linen shirt", "beach pant", "hoodie", "board shorts", "swimwear", "camp shirt", "knitwear", "jacket"],
    "about": "Sustainable American coastal lifestyle — linen, organic cotton, surf-to-dinner versatility"
  },
  {
    "domain": "pangaia.com",
    "categories": [
      "top",
      "bottom",
      "dress",
      "outerwear"
    ],
    "vibe": [
      "sustainable",
      "organic",
      "casual",
      "minimalist"
    ],
    "gender": ["men", "women", "unisex"],
    "priceRange": "premium",
    "items": ["hoodie", "sweatpants", "tee", "co-ord set", "puffer jacket", "tracksuit"],
    "about": "Science-led sustainable fashion — seaweed fiber, recycled materials, tracksuit staples"
  },
  {
    "domain": "spanx-com.myshopify.com",
    "categories": [
      "top",
      "bottom",
      "dress",
      "outerwear"
    ],
    "vibe": [
      "seamless",
      "formal",
      "minimalist"
    ],
    "gender": ["women"],
    "priceRange": "premium",
    "items": ["shapewear", "legging", "bodysuit", "smoothing brief", "denim", "blazer", "dress"],
    "about": "The original shapewear brand expanded to full fashion — sculpting, smoothing, polished looks"
  },
  {
    "domain": "outdoorvoices.com",
    "categories": [
      "top",
      "bottom",
      "dress",
      "underwear"
    ],
    "vibe": [
      "active",
      "coastal",
      "casual"
    ],
    "gender": ["women", "men"],
    "priceRange": "mid",
    "items": ["legging", "shorts", "hoodie", "sports bra", "one-piece", "crop top", "jacket"],
    "about": "Activity-wear brand with playful tone — Doing Things, technical fabrics, not just gym"
  },
  {
    "domain": "toa.st",
    "categories": [
      "top",
      "bottom",
      "dress",
      "outerwear",
      "footwear",
      "underwear",
      "accessory"
    ],
    "vibe": [
      "artisan",
      "organic",
      "bohemian",
      "minimalist",
      "french"
    ],
    "gender": ["women"],
    "priceRange": "premium",
    "items": ["linen dress", "smock dress", "blouse", "trouser", "knitwear", "apron dress", "shirt dress"],
    "about": "British artisan fashion — handcrafted natural fabrics, Japanese and Indian textile influences"
  },
  {
    "domain": "backalleybodega.com",
    "categories": [
      "top",
      "bottom",
      "outerwear"
    ],
    "vibe": [
      "streetwear",
      "heritage-workwear",
      "outdoor"
    ],
    "gender": ["men", "unisex"],
    "priceRange": "mid",
    "items": ["graphic tee", "hoodie", "cargo pant", "jacket", "work shirt"],
    "about": "NYC streetwear with workwear influence — vintage-inspired graphics, outdoor-meets-urban"
  },
  {
    "domain": "dissh.com.au",
    "categories": [
      "top",
      "bottom",
      "dress",
      "outerwear"
    ],
    "vibe": [
      "casual",
      "resort",
      "bohemian"
    ],
    "gender": ["women"],
    "priceRange": "mid",
    "items": ["mini dress", "midi dress", "blouse", "wide-leg trouser", "co-ord set"],
    "about": "Australian women's fashion — feminine, holiday-ready pieces, easy-to-wear silhouettes"
  },
  {
    "domain": "porterjames.com",
    "categories": [
      "top",
      "bottom",
      "outerwear"
    ],
    "vibe": [
      "active",
      "workout",
      "sport"
    ]
  },
  {
    "domain": "caseycasey.eu",
    "categories": [
      "top",
      "bottom",
      "dress",
      "outerwear"
    ],
    "vibe": [
      "artisan",
      "bohemian",
      "french",
      "minimalist"
    ],
    "gender": ["men", "women", "unisex"],
    "priceRange": "luxury",
    "items": ["linen shirt", "wide trouser", "smock", "deconstructed coat", "handcrafted dress"],
    "about": "Marseille artisan fashion — handcrafted, irregular cuts, natural dyes, poetic silhouettes"
  },
  {
    "domain": "luroq.com",
    "categories": [
      "top",
      "bottom",
      "dress",
      "outerwear"
    ],
    "vibe": [
      "outdoor"
    ]
  },
  {
    "domain": "luso.com.pk",
    "categories": [
      "top",
      "bottom",
      "accessory"
    ],
    "vibe": [
      "streetwear",
      "organic",
      "luxury",
      "outdoor"
    ]
  },
  {
    "domain": "effelements.in",
    "categories": [
      "top"
    ],
    "vibe": [
      "active",
      "seamless",
      "outdoor"
    ]
  },
  {
    "domain": "favrics.com",
    "categories": [
      "top",
      "bottom",
      "outerwear",
      "footwear",
      "accessory"
    ],
    "vibe": [
      "organic",
      "denim"
    ]
  },
  {
    "domain": "fromherman.com",
    "categories": [
      "top",
      "bottom",
      "outerwear"
    ],
    "vibe": [
      "luxury",
      "streetwear"
    ]
  },
  {
    "domain": "loomforma.com",
    "categories": [
      "top",
      "outerwear"
    ],
    "vibe": []
  },
  {
    "domain": "pegador.com",
    "categories": [
      "top",
      "bottom",
      "outerwear"
    ],
    "vibe": [
      "streetwear",
      "casual",
      "outdoor"
    ],
    "gender": ["men", "unisex"],
    "priceRange": "mid",
    "items": ["graphic tee", "hoodie", "tracksuit", "cargo pant", "overshirt"],
    "about": "German streetwear brand — bold graphics, oversized silhouettes, urban culture"
  },
  {
    "domain": "commas.cc",
    "categories": [
      "top",
      "bottom",
      "outerwear"
    ],
    "vibe": [
      "casual",
      "cozy"
    ]
  },
  {
    "domain": "finaldraftclo.com",
    "categories": [
      "top",
      "bottom",
      "outerwear",
      "accessory"
    ],
    "vibe": []
  },
  {
    "domain": "wearneutralground.com",
    "categories": [
      "top",
      "bottom",
      "dress",
      "outerwear",
      "accessory"
    ],
    "vibe": [
      "active",
      "casual",
      "workout",
      "outdoor",
      "streetwear"
    ]
  },
  {
    "domain": "sweatscollective.com",
    "categories": [
      "top",
      "bottom",
      "outerwear",
      "accessory"
    ],
    "vibe": [
      "cozy",
      "streetwear",
      "minimalist",
      "luxury"
    ],
    "gender": ["men", "women", "unisex"],
    "priceRange": "premium",
    "items": ["hoodie", "crewneck sweatshirt", "sweatpant", "tee", "hat"],
    "about": "Premium fleece and sweatwear — elevated basics in heavyweight cotton"
  },
  {
    "domain": "gentag.store",
    "categories": [
      "top",
      "bottom",
      "dress",
      "outerwear"
    ],
    "vibe": []
  },
  {
    "domain": "antifragilecompany.in",
    "categories": [
      "top"
    ],
    "items": ["tee", "t-shirt"],
    "vibe": [
      "sport",
      "workout",
      "organic"
    ]
  },
  {
    "domain": "itsashirt.gr",
    "categories": [
      "top"
    ],
    "vibe": [
      "casual",
      "streetwear",
      "formal"
    ]
  },
  {
    "domain": "circolo1901.it",
    "categories": [
      "top",
      "outerwear"
    ],
    "vibe": [
      "sport",
      "formal",
      "casual",
      "minimalist"
    ],
    "gender": ["men"],
    "priceRange": "premium",
    "items": ["jersey blazer", "polo", "sweatshirt", "technical jacket", "trouser"],
    "about": "Italian jersey tailoring — softly structured blazers, sport-meets-formal elegance"
  },
  {
    "domain": "limited-clothing.co.uk",
    "categories": [
      "top",
      "bottom",
      "outerwear",
      "accessory"
    ],
    "vibe": []
  },
  {
    "domain": "laurenmanoogian.com",
    "categories": [
      "top",
      "bottom",
      "dress",
      "outerwear",
      "footwear"
    ],
    "vibe": [
      "artisan",
      "organic",
      "bohemian",
      "minimalist"
    ],
    "gender": ["women"],
    "priceRange": "luxury",
    "items": ["handknit sweater", "linen top", "organic dress", "woven cardigan", "co-ord set"],
    "about": "Hand-loomed knitwear and organic basics — slow fashion, artisan production in Peru"
  },
  {
    "domain": "borderlineofficial.com",
    "categories": [
      "bottom",
      "outerwear"
    ],
    "vibe": [
      "outdoor",
      "seamless",
      "active"
    ]
  },
  {
    "domain": "stosi.in",
    "categories": [
      "top",
      "bottom",
      "outerwear"
    ],
    "vibe": [
      "streetwear",
      "casual",
      "outdoor"
    ],
    "gender": ["men"],
    "priceRange": "mid",
    "items": ["tee", "cargo pant", "hoodie", "overshirt", "shorts"],
    "about": "Indian men's streetwear brand — urban casual, functional cuts"
  },
  {
    "domain": "studiopeterjohn.com",
    "categories": [
      "top",
      "bottom",
      "outerwear",
      "accessory"
    ],
    "vibe": [
      "casual",
      "formal",
      "cozy",
      "streetwear"
    ]
  },
  {
    "domain": "lacorsia.co",
    "categories": [
      "top",
      "bottom",
      "outerwear",
      "accessory"
    ],
    "vibe": [
      "sport"
    ]
  },
  {
    "domain": "commonleisureweb.com",
    "categories": [
      "top",
      "bottom",
      "dress"
    ],
    "vibe": [
      "casual",
      "active"
    ]
  },
  {
    "domain": "ladywhiteco.com",
    "categories": [
      "top",
      "bottom",
      "outerwear",
      "footwear",
      "underwear"
    ],
    "vibe": [
      "organic",
      "minimalist",
      "casual"
    ],
    "gender": ["men", "women"],
    "priceRange": "premium",
    "items": ["tee", "sweatshirt", "hoodie", "sweatpant", "sock"],
    "about": "LA premium basics brand — USA-made organic cotton, lived-in quality fits"
  },
  {
    "domain": "slvrlake.myshopify.com",
    "categories": [
      "top",
      "bottom",
      "outerwear",
      "accessory"
    ],
    "vibe": [
      "denim",
      "casual",
      "minimalist"
    ],
    "gender": ["women"],
    "priceRange": "premium",
    "items": ["jeans", "denim short", "straight leg jean", "wide-leg jean"],
    "about": "LA premium denim — clean cuts, high-rise silhouettes, quality stretch fabrics"
  },
  {
    "domain": "studionicholson.com",
    "categories": [
      "top",
      "bottom",
      "dress",
      "outerwear"
    ],
    "vibe": [
      "minimalist",
      "quiet-luxury",
      "formal"
    ],
    "gender": ["women", "men"],
    "priceRange": "luxury",
    "items": ["wide-leg trouser", "blazer", "shirt", "knitwear", "coat", "shift dress"],
    "about": "London minimalist brand — sculptural silhouettes, luxurious fabrics, architect-inspired restraint"
  },
  {
    "domain": "haruhar.com",
    "categories": [
      "top",
      "bottom",
      "dress",
      "outerwear"
    ],
    "vibe": [
      "seamless",
      "active"
    ]
  },
  {
    "domain": "coverchord.com",
    "categories": [
      "top",
      "bottom",
      "footwear",
      "accessory"
    ],
    "vibe": [
      "gorpcore",
      "japanese",
      "outdoor",
      "active"
    ],
    "languages": [
      "ja",
      "en"
    ],
    "gender": ["men", "women", "unisex"],
    "priceRange": "mid",
    "items": ["outdoor shirt", "technical trouser", "hiking boot", "cap", "anorak", "fleece"],
    "about": "Japanese outdoor-meets-street style — technical fabrics, Tokyo gorpcore aesthetic"
  },
  {
    "domain": "lionessfashion.com",
    "categories": [
      "top",
      "bottom",
      "outerwear"
    ],
    "vibe": [
      "casual",
      "formal"
    ]
  },
  {
    "domain": "and-daughter.com",
    "categories": [
      "top",
      "bottom",
      "outerwear"
    ],
    "vibe": [
      "casual",
      "active"
    ]
  },
  {
    "domain": "vahro.in",
    "categories": [
      "top",
      "bottom",
      "outerwear"
    ],
    "vibe": [
      "active",
      "casual"
    ]
  },
  {
    "domain": "desiminimals.com",
    "categories": [
      "top",
      "bottom",
      "outerwear"
    ],
    "vibe": [
      "casual",
      "formal",
      "denim"
    ]
  },
  {
    "domain": "lovepangolin.com",
    "categories": [
      "top",
      "bottom",
      "outerwear"
    ],
    "vibe": []
  },
  {
    "domain": "chapter2drip.com",
    "categories": [
      "top",
      "outerwear"
    ],
    "vibe": [
      "organic"
    ]
  },
  {
    "domain": "friendswithfrank.com",
    "categories": [
      "top",
      "bottom",
      "outerwear",
      "underwear",
      "accessory"
    ],
    "vibe": []
  },
  {
    "domain": "shop-crowd.com",
    "categories": [
      "top",
      "bottom",
      "outerwear"
    ],
    "vibe": [
      "active",
      "streetwear",
      "casual",
      "seamless",
      "cozy"
    ]
  },
  {
    "domain": "assemblylabel.com",
    "categories": [
      "top",
      "dress",
      "outerwear",
      "footwear",
      "underwear",
      "accessory"
    ],
    "vibe": [
      "organic",
      "casual",
      "minimalist",
      "coastal"
    ],
    "gender": ["women", "men"],
    "priceRange": "mid",
    "items": ["linen shirt", "midi dress", "knitwear", "trouser", "shorts", "tee"],
    "about": "Australian minimalist brand — linen-forward everyday basics, relaxed coastal aesthetic"
  },
  {
    "domain": "solacetheory.com",
    "categories": [
      "top",
      "bottom",
      "outerwear"
    ],
    "vibe": [
      "organic",
      "cozy",
      "active",
      "outdoor"
    ]
  },
  {
    "domain": "hemblanks.com",
    "categories": [
      "top",
      "outerwear"
    ],
    "vibe": [
      "organic",
      "active",
      "cozy"
    ]
  },
  {
    "domain": "yurofficial.com",
    "categories": [
      "top",
      "bottom",
      "outerwear",
      "accessory"
    ],
    "vibe": [
      "streetwear",
      "formal"
    ]
  },
  {
    "domain": "theruesociety.com",
    "categories": [
      "top",
      "bottom",
      "dress",
      "outerwear"
    ],
    "vibe": [
      "streetwear",
      "casual",
      "formal",
      "active",
      "organic"
    ]
  },
  {
    "domain": "malverra.com",
    "categories": [
      "top",
      "dress"
    ],
    "vibe": [
      "cozy",
      "outdoor",
      "active",
      "seamless"
    ]
  },
  {
    "domain": "myfriendjoni.com",
    "categories": [
      "bottom",
      "outerwear"
    ],
    "vibe": []
  },
  {
    "domain": "kartikresearch.com",
    "categories": [
      "top",
      "bottom",
      "outerwear",
      "footwear",
      "accessory"
    ],
    "items": ["jacket", "pant", "shirt", "short", "knit", "loafer", "tote"],
    "vibe": [
      "sport",
      "outdoor"
    ]
  },
  {
    "domain": "ceucle.com",
    "categories": [
      "top",
      "bottom",
      "outerwear",
      "accessory"
    ],
    "vibe": [
      "sport"
    ]
  },
  {
    "domain": "pariya.in",
    "categories": [
      "top",
      "bottom",
      "dress"
    ],
    "vibe": [
      "organic"
    ]
  },
  {
    "domain": "aimeleondore.com",
    "categories": [
      "top",
      "bottom",
      "outerwear",
      "footwear",
      "underwear",
      "accessory"
    ],
    "vibe": [
      "preppy",
      "streetwear",
      "old-money",
      "casual"
    ],
    "gender": ["men"],
    "priceRange": "premium",
    "items": ["oxford shirt", "knitwear", "sweatshirt", "trouser", "shorts", "polo", "outerwear", "tote bag"],
    "about": "New York brand mixing Ivy League prep with Queens streetwear — ALD redefines modern menswear"
  },
  {
    "domain": "hommeyusa.myshopify.com",
    "categories": [
      "top",
      "accessory"
    ],
    "vibe": [
      "organic",
      "cozy",
      "sport",
      "active"
    ]
  },
  {
    "domain": "primulaveri.com",
    "categories": [
      "top",
      "bottom",
      "outerwear"
    ],
    "vibe": [
      "organic"
    ]
  },
  {
    "domain": "elkacollective.com",
    "categories": [
      "top",
      "bottom",
      "outerwear",
      "accessory"
    ],
    "vibe": [
      "active",
      "denim",
      "seamless"
    ]
  },
  {
    "domain": "selectedhomme.in",
    "categories": [
      "top",
      "bottom"
    ],
    "vibe": [
      "organic",
      "sport",
      "active"
    ]
  },
  {
    "domain": "rarabarefoot.in",
    "categories": [
      "footwear"
    ],
    "items": ["barefoot shoe", "sneaker", "sandal"],
    "vibe": [
      "outdoor",
      "active",
      "cozy"
    ]
  },
  {
    "domain": "maisonx.in",
    "categories": [
      "top",
      "dress"
    ],
    "vibe": [
      "seamless"
    ]
  },
  {
    "domain": "elvntee.in",
    "categories": [
      "top",
      "bottom",
      "outerwear"
    ],
    "vibe": [
      "active"
    ]
  },
  {
    "domain": "wearbrun.com",
    "categories": [
      "top",
      "bottom",
      "dress",
      "outerwear"
    ],
    "vibe": [
      "outdoor"
    ]
  },
  {
    "domain": "wearloqo.com",
    "categories": [
      "footwear"
    ],
    "vibe": [
      "cozy",
      "workout",
      "active"
    ]
  },
  {
    "domain": "theminimalcloset.in",
    "categories": [
      "top",
      "bottom",
      "outerwear",
      "accessory"
    ],
    "vibe": [
      "seamless",
      "active",
      "denim"
    ]
  },
  {
    "domain": "sleepscientist.in",
    "categories": [
      "top",
      "bottom",
      "outerwear"
    ],
    "vibe": [
      "cozy"
    ]
  },
  {
    "domain": "urbanmonkey.com",
    "categories": [
      "top",
      "bottom",
      "outerwear",
      "accessory"
    ],
    "vibe": [
      "streetwear",
      "casual"
    ],
    "gender": ["men", "women", "unisex"],
    "priceRange": "budget",
    "items": ["cap", "beanie", "bucket hat", "tee", "hoodie", "accessory"],
    "about": "Indian streetwear accessories — bold cap designs, skate/hip-hop culture"
  },
  {
    "domain": "wearcomet.com",
    "categories": [
      "footwear"
    ],
    "items": ["sneaker", "low top sneaker", "shoe"],
    "vibe": [
      "streetwear",
      "skate"
    ],
    "about": "Indian sneaker label - low tops and court silhouettes (X Lows, Aeon, Alter). Its products never carry the word sneaker in their titles, which is why the vocabulary has to know the shapes."
  },
  {
    "domain": "milkandwhisky.in",
    "categories": [
      "footwear",
      "underwear"
    ],
    "vibe": [
      "seamless",
      "organic",
      "sport"
    ]
  },
  {
    "domain": "pepeinner.com",
    "categories": [
      "top",
      "bottom",
      "outerwear",
      "underwear"
    ],
    "vibe": [
      "outdoor"
    ]
  },
  {
    "domain": "monkstory.com",
    "categories": [
      "footwear",
      "underwear"
    ],
    "vibe": [
      "formal",
      "streetwear"
    ]
  },
  {
    "domain": "stooky.in",
    "categories": [
      "top",
      "bottom",
      "outerwear"
    ],
    "vibe": [
      "cozy",
      "seamless"
    ]
  },
  {
    "domain": "senso.myshopify.com",
    "categories": [
      "top",
      "bottom",
      "underwear",
      "accessory"
    ],
    "vibe": [
      "luxury",
      "seamless"
    ]
  },
  {
    "domain": "tezzo.in",
    "categories": [
      "bottom",
      "footwear"
    ],
    "vibe": [
      "active",
      "seamless"
    ]
  },
  {
    "domain": "andreanthony.co.id",
    "categories": [
      "footwear",
      "underwear"
    ],
    "vibe": [
      "organic",
      "streetwear",
      "outdoor"
    ]
  },
  {
    "domain": "shopdozo.com",
    "categories": [
      "dress"
    ],
    "vibe": [
      "cozy",
      "active"
    ]
  },
  {
    "domain": "thekiots.com",
    "categories": [
      "footwear"
    ],
    "items": ["slide", "slider", "sandal"],
    "vibe": [
      "cozy"
    ]
  },
  {
    "domain": "urbansocks.in",
    "categories": [
      "underwear"
    ],
    "vibe": [
      "organic",
      "luxury",
      "seamless",
      "casual",
      "sport"
    ]
  },
  {
    "domain": "hzyclo.com",
    "categories": [
      "top",
      "bottom",
      "outerwear"
    ],
    "vibe": [
      "organic",
      "cozy",
      "active"
    ]
  },
  {
    "domain": "lamastore.in",
    "categories": [
      "top"
    ],
    "vibe": [
      "organic"
    ]
  },
  {
    "domain": "xyxxcrew.com",
    "categories": [
      "top",
      "bottom",
      "outerwear",
      "underwear"
    ],
    "vibe": [
      "active",
      "organic"
    ]
  },
  {
    "domain": "biancajeswant.com",
    "categories": [
      "top",
      "bottom",
      "accessory"
    ],
    "vibe": []
  },
  {
    "domain": "saphed.com",
    "categories": [
      "top",
      "bottom",
      "dress",
      "outerwear"
    ],
    "vibe": [
      "streetwear",
      "casual"
    ]
  },
  {
    "domain": "theater.xyz",
    "categories": [
      "footwear",
      "accessory"
    ],
    "vibe": [
      "casual"
    ]
  },
  {
    "domain": "asos.myshopify.com",
    "categories": [
      "apparel"
    ],
    "vibe": [
      "seamless",
      "streetwear",
      "workout"
    ]
  },
  {
    "domain": "biasedblack.com",
    "categories": [
      "top",
      "bottom",
      "outerwear"
    ],
    "vibe": [
      "streetwear",
      "cozy",
      "active",
      "seamless",
      "outdoor"
    ]
  },
  {
    "domain": "thebearhouse.com",
    "categories": [
      "top",
      "bottom"
    ],
    "vibe": []
  },
  {
    "domain": "kairo.store",
    "categories": [
      "top",
      "outerwear"
    ],
    "vibe": [
      "active",
      "denim"
    ]
  },
  {
    "domain": "harlanholden.ph",
    "categories": [
      "top"
    ],
    "vibe": [
      "organic",
      "luxury",
      "seamless",
      "outdoor"
    ]
  },
  {
    "domain": "kaicollections.com",
    "categories": [
      "top",
      "bottom"
    ],
    "vibe": [
      "streetwear",
      "active"
    ]
  },
  {
    "domain": "musclemind.com",
    "categories": [
      "top",
      "bottom",
      "outerwear",
      "underwear"
    ],
    "vibe": [
      "active",
      "workout",
      "casual"
    ]
  },
  {
    "domain": "ballerathletik.com",
    "categories": [
      "top",
      "bottom",
      "underwear",
      "accessory"
    ],
    "vibe": [
      "sport"
    ]
  },
  {
    "domain": "jeffs.myshopify.com",
    "categories": [
      "apparel"
    ],
    "vibe": [
      "streetwear",
      "casual",
      "active",
      "cozy"
    ]
  },
  {
    "domain": "moderaegy.myshopify.com",
    "categories": [
      "top",
      "outerwear"
    ],
    "vibe": [
      "cozy",
      "denim",
      "organic",
      "outdoor"
    ]
  },
  {
    "domain": "ludic.life",
    "categories": [
      "top",
      "accessory"
    ],
    "vibe": [
      "active",
      "organic"
    ]
  },
  {
    "domain": "doodledept.com",
    "categories": [
      "top",
      "outerwear",
      "underwear",
      "accessory"
    ],
    "vibe": [
      "organic",
      "active"
    ]
  },
  {
    "domain": "thestylevault.ae",
    "categories": [
      "dress"
    ],
    "vibe": []
  },
  {
    "domain": "classymastour.fr",
    "categories": [
      "top",
      "outerwear",
      "underwear"
    ],
    "vibe": [
      "luxury"
    ]
  },
  {
    "domain": "theforbiddenfruit.in",
    "categories": [
      "top",
      "bottom",
      "outerwear"
    ],
    "vibe": []
  },
  {
    "domain": "koa.com.pk",
    "categories": [
      "top",
      "bottom",
      "dress",
      "accessory"
    ],
    "vibe": [
      "active",
      "organic",
      "sport",
      "outdoor"
    ]
  },
  {
    "domain": "botnia.in",
    "categories": [
      "top",
      "bottom",
      "dress"
    ],
    "vibe": [
      "outdoor",
      "active"
    ]
  },
  {
    "domain": "orr.store",
    "categories": [
      "top",
      "bottom",
      "outerwear"
    ],
    "vibe": [
      "organic",
      "casual"
    ]
  },
  {
    "domain": "oldlinenmill.com",
    "categories": [
      "top",
      "bottom",
      "dress",
      "accessory"
    ],
    "vibe": [
      "denim",
      "organic",
      "casual",
      "outdoor"
    ]
  },
  {
    "domain": "asslcollectionparis.com",
    "categories": [
      "top",
      "bottom",
      "outerwear",
      "underwear"
    ],
    "vibe": [
      "luxury",
      "streetwear",
      "cozy"
    ]
  },
  {
    "domain": "shopnirvanaa.com",
    "categories": [
      "top",
      "bottom",
      "outerwear"
    ],
    "vibe": []
  },
  {
    "domain": "bamboovogue.in",
    "categories": [
      "top"
    ],
    "vibe": [
      "workout",
      "seamless"
    ]
  },
  {
    "domain": "mugasa.co.in",
    "categories": [
      "top",
      "bottom",
      "dress"
    ],
    "vibe": [
      "active"
    ]
  },
  {
    "domain": "lunaco.in",
    "categories": [
      "top",
      "bottom",
      "outerwear"
    ],
    "vibe": [
      "outdoor"
    ]
  },
  {
    "domain": "daxuen.com",
    "categories": [
      "top",
      "bottom",
      "outerwear"
    ],
    "vibe": []
  },
  {
    "domain": "wtflex.in",
    "categories": [
      "top",
      "bottom"
    ],
    "vibe": [
      "denim",
      "workout",
      "active",
      "outdoor",
      "seamless"
    ]
  },
  {
    "domain": "surmaye.com",
    "categories": [
      "top",
      "dress"
    ],
    "vibe": [
      "luxury",
      "organic",
      "cozy"
    ]
  },
  {
    "domain": "thedeer.in",
    "categories": [
      "top"
    ],
    "vibe": [
      "active",
      "outdoor",
      "organic"
    ]
  },
  {
    "domain": "themusk.in",
    "categories": [
      "top",
      "dress"
    ],
    "vibe": [
      "sport",
      "cozy"
    ]
  },
  {
    "domain": "oziss.in",
    "categories": [
      "top",
      "bottom",
      "dress"
    ],
    "vibe": [
      "active",
      "seamless"
    ]
  },
  {
    "domain": "whipped.store",
    "categories": [
      "top"
    ],
    "vibe": [
      "organic",
      "cozy"
    ]
  },
  {
    "domain": "gangafashions.com",
    "categories": [
      "top"
    ],
    "vibe": [
      "casual",
      "streetwear",
      "active",
      "seamless",
      "formal"
    ]
  },
  {
    "domain": "dushaamai.com",
    "categories": [
      "top",
      "bottom",
      "outerwear"
    ],
    "vibe": [
      "seamless"
    ]
  },
  {
    "domain": "lininworld.com",
    "categories": [
      "top",
      "bottom",
      "dress",
      "outerwear"
    ],
    "vibe": [
      "organic"
    ]
  },
  {
    "domain": "themisnomer.com",
    "categories": [
      "bottom",
      "outerwear",
      "accessory"
    ],
    "vibe": [
      "formal",
      "active",
      "cozy"
    ]
  },
  {
    "domain": "vanshitaaz.in",
    "categories": [
      "top",
      "bottom",
      "dress"
    ],
    "vibe": [
      "cozy",
      "outdoor",
      "active"
    ]
  },
  {
    "domain": "sergebasics.com",
    "categories": [
      "top",
      "bottom"
    ],
    "vibe": [
      "casual",
      "streetwear",
      "active"
    ]
  },
  {
    "domain": "bayek.fr",
    "categories": [
      "top",
      "bottom",
      "outerwear"
    ],
    "vibe": [
      "streetwear"
    ]
  },
  {
    "domain": "coteleparis.com",
    "categories": [
      "bottom",
      "accessory"
    ],
    "vibe": [
      "outdoor",
      "active",
      "organic"
    ]
  },
  {
    "domain": "mariniclothing.com",
    "categories": [
      "top",
      "bottom",
      "outerwear",
      "accessory"
    ],
    "vibe": [
      "formal",
      "casual"
    ]
  },
  {
    "domain": "almostgods.com",
    "categories": [
      "top",
      "bottom",
      "outerwear"
    ],
    "vibe": [
      "streetwear"
    ]
  },
  {
    "domain": "11-11.in",
    "categories": [
      "top",
      "bottom",
      "dress"
    ],
    "vibe": []
  },
  {
    "domain": "shopunrush.com",
    "categories": [
      "top",
      "bottom",
      "dress"
    ],
    "vibe": [
      "cozy"
    ]
  },
  {
    "domain": "kissagoi.com",
    "categories": [
      "top",
      "bottom",
      "dress",
      "outerwear"
    ],
    "vibe": [
      "denim"
    ]
  },
  {
    "domain": "ikaibyraginiahuja.com",
    "categories": [
      "top",
      "bottom",
      "dress",
      "accessory"
    ],
    "vibe": []
  },
  {
    "domain": "sofiedhoore.be",
    "name": "Sofie D'Hoore",
    "categories": ["top", "bottom", "dress", "outerwear", "accessory"],
    "vibe": ["minimalist", "quiet-luxury", "artisan", "french"],
    "gender": ["women"],
    "priceRange": "luxury",
    "items": ["trouser", "blazer", "shirt", "coat", "shift dress", "knitwear"],
    "about": "Belgian minimalist designer — architectural silhouettes, luxurious natural fabrics"
  },
  {
    "domain": "bysera.zid.store",
    "name": "SERA",
    "categories": ["top", "bottom", "dress"],
    "vibe": ["luxury"]
  },
  {
    "domain": "aritzia.com",
    "name": "Aritzia",
    "categories": ["top", "bottom", "dress", "outerwear", "accessory"],
    "vibe": ["formal", "casual", "minimalist", "quiet-luxury"],
    "gender": ["women"],
    "priceRange": "premium",
    "items": ["blazer", "trouser", "bodysuit", "dress", "knitwear", "blouse", "coat"],
    "about": "Canadian premium women's brand — quality tailored basics, TikTok-beloved silhouettes"
  },
  {
    "domain": "slowsteadyclub.com",
    "name": "SlowSteadyClub",
    "categories": ["top", "bottom", "outerwear", "accessory"],
    "vibe": ["streetwear"]
  },
  {
    "domain": "bananaclub.co.in",
    "name": "Banana Club",
    "categories": ["top", "bottom", "outerwear", "accessory"],
    "vibe": ["streetwear", "casual"],
    "gender": ["men"],
    "priceRange": "mid",
    "items": ["shirt", "tee", "polo", "trouser", "jeans", "shorts", "jacket"],
    "about": "Indian D2C menswear from Bengaluru — casual and formal everyday styles"
  },
  {
    "domain": "bohemegoods.com",
    "name": "BOHEME",
    "categories": ["top", "bottom", "dress", "accessory"],
    "vibe": ["organic", "casual"]
  },
  {
    "domain": "turnblack.in",
    "name": "Turn Black",
    "categories": ["top", "bottom", "outerwear"],
    "vibe": ["streetwear"]
  },
  {
    "domain": "jucca.it",
    "name": "Jucca",
    "categories": ["top", "bottom", "dress", "outerwear"],
    "vibe": ["casual"]
  },
  {
    "domain": "camper.com",
    "name": "Camper",
    "categories": ["footwear", "accessory"],
    "vibe": ["casual", "artistic", "sustainable"],
    "gender": ["men", "women", "unisex"],
    "priceRange": "mid",
    "items": ["loafer", "boot", "sneaker", "sandal", "mule"],
    "about": "Spanish footwear brand — playful, artisan-adjacent shoe design with European craft tradition"
  },
  {
    "domain": "menspoem.in",
    "name": "Men's Poem",
    "categories": ["top", "bottom", "outerwear"],
    "vibe": ["formal", "casual"]
  },
  {
    "domain": "atpco.it",
    "name": "AT.P.CO",
    "categories": ["top", "bottom", "outerwear"],
    "vibe": ["casual", "formal"]
  },
  {
    "domain": "marksandspencer.in",
    "name": "Marks & Spencer",
    "categories": ["top", "bottom", "dress", "outerwear", "underwear", "accessory"],
    "vibe": ["casual", "formal"]
  },
  {
    "domain": "offonclothing.com",
    "name": "Offon",
    "categories": ["top", "bottom", "dress"],
    "vibe": ["casual"]
  },
  {
    "domain": "thatie.ru",
    "name": "Thatie",
    "categories": ["top", "dress"],
    "vibe": ["casual"]
  },
  {
    "domain": "pertestore.ru",
    "name": "Perte",
    "categories": ["top", "bottom", "outerwear"],
    "vibe": ["streetwear"]
  },
  {
    "domain": "sensclothing.com",
    "name": "Sens",
    "categories": ["top", "bottom", "outerwear"],
    "vibe": ["organic", "casual"]
  },
  {
    "domain": "herbyh.design",
    "name": "Her by H",
    "categories": ["top", "dress"],
    "vibe": ["cozy"]
  },
  {
    "domain": "ekke.co",
    "name": "Ekke",
    "categories": ["top", "bottom", "dress"],
    "vibe": ["casual"]
  },
  {
    "domain": "amoslook.com",
    "name": "Amos Look",
    "categories": ["top", "bottom", "outerwear"],
    "vibe": ["casual"]
  },
  {
    "domain": "studiodoe.cc",
    "name": "Studio Doe",
    "categories": ["top", "bottom", "dress"],
    "vibe": ["organic"]
  },
  {
    "domain": "noconcept.ru",
    "name": "No Concept",
    "categories": ["top", "bottom", "outerwear"],
    "vibe": ["streetwear"]
  },
  {
    "domain": "mimpikita.com.my",
    "name": "Kita&Co",
    "categories": ["top", "dress"],
    "vibe": ["luxury"]
  },
  {
    "domain": "jhoola.com.tr",
    "name": "Jhoola",
    "categories": ["top", "dress"],
    "vibe": ["organic"]
  },
  {
    "domain": "dirtymanners.com",
    "name": "Dirty Manners",
    "categories": ["top", "bottom", "outerwear"],
    "vibe": ["streetwear"]
  },
  {
    "domain": "towards.website",
    "name": "Toward(s)",
    "categories": ["top", "bottom", "outerwear"],
    "vibe": ["streetwear"]
  },
  {
    "domain": "blueowl.us",
    "name": "Blue Owl",
    "categories": ["top", "bottom", "outerwear"],
    "vibe": ["heritage-workwear", "denim", "old-money", "organic"],
    "gender": ["men"],
    "priceRange": "premium",
    "items": ["selvedge denim", "raw denim jacket", "chino", "oxford cloth button-down", "flannel"],
    "about": "Brooklyn denim specialist — premium selvedge, raw denim, quality heritage casualwear"
  },
  {
    "domain": "morrisonshop.com",
    "name": "Morrison",
    "categories": ["top", "bottom", "dress", "outerwear"],
    "vibe": ["casual", "coastal", "organic", "minimalist"],
    "gender": ["women"],
    "priceRange": "mid",
    "items": ["linen dress", "midi dress", "tee", "shirt", "knitwear", "trouser"],
    "about": "Australian women's brand — relaxed resort-influenced pieces, linen and natural textures"
  },
  {
    "domain": "payalkhandwala.com",
    "name": "Payal Khandwala",
    "categories": ["top", "bottom", "dress"],
    "vibe": ["luxury"]
  },
  {
    "domain": "dashanddot.com",
    "name": "Dast & Dot",
    "categories": ["top", "bottom", "dress"],
    "vibe": ["casual"]
  },
  {
    "domain": "azaadclo.com",
    "name": "Azaad",
    "categories": ["top", "bottom", "outerwear"],
    "vibe": ["streetwear"]
  },
  {
    "domain": "ourlegacy.com",
    "name": "Our Legacy",
    "categories": ["top", "bottom", "outerwear", "footwear", "accessory"],
    "vibe": ["streetwear", "luxury", "artistic", "minimalist"],
    "gender": ["men"],
    "priceRange": "premium",
    "items": ["shirt", "trouser", "jacket", "knitwear", "overcoat", "tee"],
    "about": "Stockholm avant-garde — unexpected fabrications, relaxed tailoring, intellectual edge"
  },
  {
    "domain": "harah.in",
    "name": "Harah",
    "categories": ["top", "dress"],
    "vibe": ["organic"]
  },
  {
    "domain": "houseofmasaba.com",
    "name": "House of Masaba",
    "categories": ["top", "bottom", "dress", "accessory"],
    "vibe": ["indian-ethnic", "maximalist", "luxury"],
    "gender": ["women"],
    "priceRange": "luxury",
    "items": ["kurta set", "saree", "co-ord set", "dress", "dupatta", "accessory"],
    "about": "Indian luxury designer — bold prints, modern ethnic fusion, Masaba Gupta's iconic aesthetic"
  },
  // ── Apparel ────────────────────────────────────────────────────────────────
  {
    "domain": "perryellis.com",
    "name": "Perry Ellis",
    "categories": ["top", "bottom", "outerwear", "dress", "accessory"],
    "vibe": ["formal", "casual", "minimalist", "preppy"],
    "gender": ["men", "women"],
    "priceRange": "mid",
    "items": ["polo", "dress shirt", "suit", "chino", "blazer", "tee", "dress"],
    "about": "American heritage brand — classic polos, tailored suits, smart casual staples since 1980"
  },
  {
    "domain": "forever21.com",
    "name": "Forever 21",
    "categories": ["top", "bottom", "dress", "outerwear", "swimwear", "accessory"],
    "vibe": ["casual", "bodycon", "streetwear"],
    "gender": ["women", "men"],
    "priceRange": "budget",
    "items": ["mini dress", "bodycon dress", "crop top", "jeans", "hoodie", "co-ord set", "swimsuit", "jumpsuit"],
    "about": "Fast fashion trendsetter — affordable on-trend pieces, trend-first design"
  },
  {
    "domain": "untuckit.com",
    "name": "UNTUCKit",
    "categories": ["top", "bottom", "outerwear"],
    "vibe": ["casual", "formal", "coastal"],
    "gender": ["men", "women"],
    "priceRange": "mid",
    "items": ["untucked shirt", "dress shirt", "casual shirt", "flannel", "polo", "chino", "linen shirt"],
    "about": "Shirts engineered to be worn untucked — precisely hemmed, wrinkle-free"
  },
  {
    "domain": "everlane.com",
    "name": "Everlane",
    "categories": ["top", "bottom", "outerwear", "footwear", "accessory"],
    "vibe": ["minimalist", "organic", "sustainable", "casual"],
    "gender": ["men", "women"],
    "priceRange": "mid",
    "items": ["tee", "chino", "linen shirt", "trouser", "knitwear", "denim", "sneaker", "loafer"],
    "about": "Radical price transparency — ethical factories, sustainable basics, zero-markup pricing"
  },
  {
    "domain": "statelymen.com",
    "name": "Stately Men",
    "categories": ["top", "bottom", "outerwear", "accessory"],
    "vibe": ["formal", "casual", "old-money", "preppy"],
    "gender": ["men"],
    "priceRange": "premium",
    "items": ["sport coat", "dress shirt", "chino", "sweater", "blazer", "trouser"],
    "about": "Men's personal styling brand — curated dress-casual and smart-casual pieces"
  },
  {
    "domain": "amedoree.com",
    "name": "Amedoree",
    "categories": ["top", "bottom", "dress", "outerwear"],
    "vibe": ["sustainable", "organic", "minimalist"],
    "gender": ["women"],
    "priceRange": "premium"
  },
  {
    "domain": "riverstone-wear.com",
    "name": "River Stone Wear",
    "categories": ["top", "bottom", "outerwear"],
    "vibe": ["outdoor", "casual", "heritage-workwear"]
  },
  {
    "domain": "johnhyattclothing.com",
    "name": "John Hyatt",
    "categories": ["top", "bottom", "outerwear"],
    "vibe": ["casual", "formal"]
  },
  // ── Footwear ───────────────────────────────────────────────────────────────
  {
    "domain": "thursdayboots.com",
    "name": "Thursday Boots",
    "categories": ["footwear"],
    "vibe": ["heritage-workwear", "casual", "formal", "old-money"],
    "gender": ["men", "women"],
    "priceRange": "mid",
    "items": ["chelsea boot", "chukka boot", "dress shoe", "oxford", "work boot", "loafer"],
    "about": "Direct-to-consumer leather boots — premium craftsmanship at honest prices"
  },
  {
    "domain": "rothys.com",
    "name": "Rothy's",
    "categories": ["footwear", "accessory"],
    "vibe": ["sustainable", "minimalist", "casual"],
    "gender": ["women", "unisex"],
    "priceRange": "mid",
    "items": ["flat shoe", "loafer", "sneaker", "boot", "bag"],
    "about": "Sustainable flats and bags from recycled plastic bottles — washable, flexible fit"
  },
  // ── Surf / Beach ───────────────────────────────────────────────────────────
  {
    "domain": "ripcurl.com",
    "name": "Rip Curl",
    "categories": ["top", "bottom", "outerwear", "swimwear", "accessory"],
    "vibe": ["coastal", "resort", "active", "casual"],
    "gender": ["men", "women"],
    "priceRange": "mid",
    "items": ["board shorts", "surf shirt", "wetsuit", "bikini", "tee", "hoodie", "cap"],
    "about": "Australian surf brand — technical surfwear and beach lifestyle gear since 1969"
  },
  {
    "domain": "quiksilver.com",
    "name": "Quiksilver",
    "categories": ["top", "bottom", "outerwear", "swimwear", "accessory"],
    "vibe": ["coastal", "streetwear", "casual", "active"],
    "gender": ["men"],
    "priceRange": "mid",
    "items": ["board shorts", "tee", "hoodie", "walkshort", "fleece", "wetsuit"],
    "about": "Iconic surf and skate brand — ocean-inspired casual wear and technical surfwear"
  },
  {
    "domain": "billabong.com",
    "name": "Billabong",
    "categories": ["top", "bottom", "outerwear", "swimwear", "dress", "accessory"],
    "vibe": ["coastal", "resort", "casual", "bohemian"],
    "gender": ["men", "women"],
    "priceRange": "mid",
    "items": ["board shorts", "bikini", "tee", "sundress", "hoodie", "rash guard", "shorts"],
    "about": "Australian surf and beach lifestyle brand — from the barrel to the boardwalk"
  },
  // ── Jewellery ──────────────────────────────────────────────────────────────
  {
    "domain": "mejuri.com",
    "name": "Mejuri",
    "categories": ["jewellery", "accessory"],
    "vibe": ["minimalist", "quiet-luxury", "sustainable"],
    "gender": ["women", "unisex"],
    "priceRange": "premium",
    "items": ["gold necklace", "hoop earrings", "stud earrings", "bracelet", "ring", "anklet", "pendant"],
    "about": "Fine jewellery direct-to-consumer — minimalist gold and diamond for everyday wear"
  },
  {
    "domain": "kendrascott.com",
    "name": "Kendra Scott",
    "categories": ["jewellery", "accessory"],
    "vibe": ["casual", "bohemian", "coastal", "maximalist"],
    "gender": ["women"],
    "priceRange": "mid",
    "items": ["necklace", "earrings", "bracelet", "ring", "pendant", "charm"],
    "about": "Texas-born jewellery brand — colourful semi-precious stones, everyday fashion jewellery"
  },
  {
    "domain": "brilliantearth.com",
    "name": "Brilliant Earth",
    "categories": ["jewellery", "accessory"],
    "vibe": ["minimalist", "sustainable", "quiet-luxury"],
    "gender": ["women", "unisex"],
    "priceRange": "luxury",
    "items": ["diamond ring", "engagement ring", "necklace", "earrings", "bracelet", "wedding band"],
    "about": "Ethical fine jewellery — conflict-free diamonds, recycled gold, lab-grown stones"
  },
  // ── Men's Specialty ────────────────────────────────────────────────────────
  {
    "domain": "3sixteen.com",
    "name": "3sixteen",
    "categories": ["bottom", "top", "accessory"],
    "vibe": ["heritage-workwear", "japanese", "minimalist", "casual"],
    "gender": ["men"],
    "priceRange": "premium",
    "items": ["selvedge jeans", "chino", "tee", "flannel shirt", "bomber jacket", "cap"],
    "about": "NYC selvedge denim brand — Japanese fabrics, raw denim cuts, clean American menswear"
  },
  {
    "domain": "astorflex.it",
    "name": "Astorflex",
    "categories": ["footwear"],
    "vibe": ["heritage-workwear", "minimalist", "casual"],
    "gender": ["men"],
    "priceRange": "premium",
    "items": ["desert boot", "chukka boot", "slip-on", "moccasin", "leather sneaker"],
    "about": "Italian heritage boot brand — Vibram-soled desert boots crafted in Civitanova Marche since 1904"
  },
  {
    "domain": "bather.com",
    "name": "Bather",
    "categories": ["swimwear", "top", "bottom"],
    "vibe": ["coastal", "resort", "casual", "preppy"],
    "gender": ["men"],
    "priceRange": "mid",
    "items": ["swim trunk", "board short", "camp shirt", "casual short", "tee"],
    "about": "Canadian swim brand — refined trunks with bold prints, from the pool to the patio"
  },
  {
    "domain": "chupsocks.com",
    "name": "CHUP Socks",
    "categories": ["accessory"],
    "vibe": ["japanese", "casual", "artistic"],
    "gender": ["men", "unisex"],
    "priceRange": "premium",
    "items": ["wool sock", "cotton crew sock", "patterned sock", "ankle sock"],
    "about": "Japanese-inspired fine socks — bold patterns from Finnish and Japanese textile traditions"
  },
  {
    "domain": "corridornyc.com",
    "name": "Corridor",
    "categories": ["top", "bottom", "outerwear", "accessory"],
    "vibe": ["minimalist", "heritage-workwear", "casual", "preppy"],
    "gender": ["men"],
    "priceRange": "premium",
    "items": ["sport coat", "trouser", "shirt", "overshirt", "shorts", "jacket"],
    "about": "NYC menswear — refined sport coats, easy trousers, and natural fabrics for modern American dressing"
  },
  {
    "domain": "marcoliani.it",
    "name": "Marcoliani",
    "categories": ["accessory"],
    "vibe": ["minimalist", "old-money", "preppy"],
    "gender": ["men"],
    "priceRange": "luxury",
    "items": ["dress sock", "cashmere sock", "wool sock", "pima cotton sock", "over-the-calf sock"],
    "about": "Milanese luxury hosiery — fine-gauge socks in cashmere, pima cotton, and silk since 1946"
  },
  {
    "domain": "merzbschwanen.com",
    "name": "Merz b. Schwanen",
    "categories": ["top", "bottom", "accessory"],
    "vibe": ["heritage-workwear", "minimalist", "sustainable", "casual"],
    "gender": ["men"],
    "priceRange": "premium",
    "items": ["loop-wheeled sweatshirt", "pocket tee", "hoodie", "jogger", "work pant", "henley"],
    "about": "German heritage knitwear — loop-wheeled cotton sweatshirts and tees from Albstadt since 1911"
  },
  {
    "domain": "momotaro-jeans.com",
    "name": "Momotaro Jeans",
    "categories": ["bottom", "top", "accessory"],
    "vibe": ["japanese", "heritage-workwear", "minimalist"],
    "gender": ["men"],
    "priceRange": "luxury",
    "items": ["selvedge jeans", "denim jacket", "work shirt", "cap", "bag"],
    "about": "Japanese selvedge denim from Kojima — handcrafted jeans using Okayama's finest indigo-dyed cotton"
  },
  {
    "domain": "outclass.ca",
    "name": "Outclass",
    "categories": ["accessory", "top"],
    "vibe": ["casual", "preppy", "minimalist"],
    "gender": ["men"],
    "priceRange": "mid",
    "items": ["sock", "boxer brief", "tee", "polo"],
    "about": "Canadian accessories brand — well-made socks and basics for the detail-conscious man"
  },
  {
    "domain": "portugueseflannel.com",
    "name": "Portuguese Flannel",
    "categories": ["top", "bottom", "outerwear"],
    "vibe": ["heritage-workwear", "artisan", "casual", "minimalist"],
    "gender": ["men"],
    "priceRange": "premium",
    "items": ["flannel shirt", "linen shirt", "overshirt", "trouser", "worker jacket", "shorts"],
    "about": "Porto flannel shirts — woven and sewn in Portugal using traditional Portuguese textile craft"
  },
  {
    "domain": "purebluejapan.jp",
    "name": "Pure Blue Japan",
    "categories": ["bottom", "top", "accessory"],
    "vibe": ["japanese", "heritage-workwear", "minimalist"],
    "gender": ["men"],
    "priceRange": "luxury",
    "items": ["selvedge jeans", "denim jacket", "work shirt", "tote", "indigo-dyed piece"],
    "about": "Okayama selvedge denim atelier — hand-dyed indigo jeans and Japanese workwear, made in Japan"
  },
  {
    "domain": "saxxunderwear.com",
    "name": "SAXX",
    "categories": ["underwear"],
    "vibe": ["active", "casual", "sport"],
    "gender": ["men"],
    "priceRange": "mid",
    "items": ["boxer brief", "trunk", "brief", "lounge pant", "active short"],
    "about": "Canadian performance underwear — patented BallPark Pouch support, the benchmark in men's briefs"
  },
  {
    "domain": "thefryecompany.com",
    "name": "The Frye Company",
    "categories": ["footwear", "accessory"],
    "vibe": ["heritage-workwear", "casual", "vintage"],
    "gender": ["men"],
    "priceRange": "premium",
    "items": ["cowboy boot", "harness boot", "chukka", "oxford", "leather bag", "wallet"],
    "about": "America's oldest continual shoe brand — handcrafted leather boots with Western heritage since 1863"
  },
  {
    "domain": "waxlondon.com",
    "name": "Wax London",
    "categories": ["top", "bottom", "outerwear"],
    "vibe": ["casual", "heritage-workwear", "artisan", "preppy"],
    "gender": ["men"],
    "priceRange": "mid",
    "items": ["shirt", "trouser", "jacket", "chino", "overshirt", "shorts"],
    "about": "London menswear — natural fabrics and easy silhouettes with quiet British craft at accessible prices"
  },
  {
    "domain": "wonderlooper.com",
    "name": "Wonder Looper",
    "categories": ["top"],
    "vibe": ["vintage", "casual", "artistic"],
    "gender": ["men", "unisex"],
    "priceRange": "mid",
    "items": ["vintage tee", "graphic tee", "sweatshirt"],
    "about": "Independent vintage-inspired tees — archive prints and original graphics in premium ring-spun cotton"
  },
  // ── Unisex / Both Genders ──────────────────────────────────────────────────
  {
    "domain": "agjeans.com",
    "name": "AG Jeans",
    "categories": ["bottom", "top", "outerwear"],
    "vibe": ["casual", "minimalist", "preppy"],
    "gender": ["men", "women"],
    "priceRange": "premium",
    "items": ["slim jeans", "skinny jeans", "straight jeans", "crop jean", "tee", "trucker jacket"],
    "about": "LA premium denim — stretch-forward jeans in clean silhouettes for everyday wardrobe building"
  },
  {
    "domain": "citizensofhumanity.com",
    "name": "Citizens of Humanity",
    "categories": ["bottom", "top", "outerwear"],
    "vibe": ["casual", "minimalist", "sustainable"],
    "gender": ["men", "women"],
    "priceRange": "premium",
    "items": ["straight jeans", "high-waist jeans", "wide-leg jeans", "tee", "trucker jacket", "cord trouser"],
    "about": "Premium LA denim — relaxed fits, sustainable practices, elevated everyday quality"
  },
  {
    "domain": "colorfulstandard.com",
    "name": "Colorful Standard",
    "categories": ["top", "bottom", "accessory", "underwear"],
    "vibe": ["minimalist", "sustainable", "casual"],
    "gender": ["men", "women", "unisex"],
    "priceRange": "mid",
    "items": ["sweatshirt", "tee", "hoodie", "sock", "shorts", "polo", "bucket hat"],
    "about": "Copenhagen basics label — organic cotton in 30+ vibrant colours, the benchmark sustainable basics brand"
  },
  {
    "domain": "howlin.be",
    "name": "Howlin'",
    "categories": ["top", "outerwear"],
    "vibe": ["bohemian", "artistic", "casual", "vintage"],
    "gender": ["men", "women"],
    "priceRange": "premium",
    "items": ["wool sweater", "cardigan", "wool jacket", "chunky knit", "vest"],
    "about": "Antwerp knitwear — handcrafted wool sweaters in bold patterns inspired by music and folklore"
  },
  {
    "domain": "nakedandfamousdenim.com",
    "name": "Naked & Famous Denim",
    "categories": ["bottom", "top"],
    "vibe": ["heritage-workwear", "japanese", "casual", "streetwear"],
    "gender": ["men", "women"],
    "priceRange": "mid",
    "items": ["selvedge jeans", "raw denim", "skinny jean", "slim jean", "weird guy cut", "tee"],
    "about": "Montreal selvedge denim — Japanese fabric, the most comprehensive raw denim range in North America"
  },
  {
    "domain": "norseprojects.com",
    "name": "Norse Projects",
    "categories": ["top", "bottom", "outerwear", "footwear", "accessory"],
    "vibe": ["minimalist", "heritage-workwear", "casual", "gorpcore"],
    "gender": ["men", "women"],
    "priceRange": "premium",
    "items": ["nylon jacket", "hoodie", "merino knit", "trouser", "tee", "sneaker", "cap"],
    "about": "Copenhagen utility brand — technical fabrics meet Scandinavian minimalism, from nylon shells to merino knitwear"
  },
  {
    "domain": "nudiejeans.com",
    "name": "Nudie Jeans",
    "categories": ["bottom", "top", "accessory"],
    "vibe": ["heritage-workwear", "sustainable", "casual", "vintage"],
    "gender": ["men", "women"],
    "priceRange": "premium",
    "items": ["slim jeans", "straight-leg jeans", "raw denim", "tee", "jacket", "shirt"],
    "about": "Swedish sustainable denim — organic cotton raw jeans with free lifetime repairs and trade-in program"
  },
  {
    "domain": "patrickassaraf.com",
    "name": "Patrick Assaraf",
    "categories": ["top", "outerwear"],
    "vibe": ["quiet-luxury", "minimalist", "casual"],
    "gender": ["men", "women"],
    "priceRange": "luxury",
    "items": ["cashmere sweater", "modal tee", "zip-up hoodie", "crew neck", "v-neck"],
    "about": "Montreal luxury knitwear — ultra-fine pima cotton and cashmere for quietly elevated everyday layering"
  },
  {
    "domain": "reigningchamp.com",
    "name": "Reigning Champ",
    "categories": ["top", "bottom", "outerwear"],
    "vibe": ["streetwear", "active", "casual", "heritage-workwear"],
    "gender": ["men", "women"],
    "priceRange": "premium",
    "items": ["sweatshirt", "jogger", "hoodie", "tee", "shorts", "zip-up"],
    "about": "Vancouver athletic brand — fleece made in Canada, the original premium sweatshirt brand"
  },
  {
    "domain": "schottnyc.com",
    "name": "Schott NYC",
    "categories": ["outerwear", "top", "bottom"],
    "vibe": ["heritage-workwear", "vintage", "streetwear"],
    "gender": ["men", "women"],
    "priceRange": "premium",
    "items": ["leather moto jacket", "perfecto jacket", "pea coat", "bomber jacket", "jean jacket", "jeans"],
    "about": "NYC outerwear icon — the original Perfecto motorcycle jacket, handcrafted in USA since 1913"
  },
  {
    "domain": "tigerofsweden.com",
    "name": "Tiger of Sweden",
    "categories": ["top", "bottom", "outerwear", "footwear", "accessory"],
    "vibe": ["minimalist", "formal", "casual", "preppy"],
    "gender": ["men", "women"],
    "priceRange": "premium",
    "items": ["suit", "blazer", "dress shirt", "trouser", "chino", "sneaker", "boot"],
    "about": "Swedish fashion house — sharp tailoring meets Nordic minimalism for the polished urban dresser"
  },
  {
    "domain": "veja-store.com",
    "name": "VEJA",
    "categories": ["footwear"],
    "vibe": ["sustainable", "minimalist", "casual", "french"],
    "gender": ["men", "women", "unisex"],
    "priceRange": "premium",
    "items": ["sneaker", "running shoe", "leather trainer", "canvas shoe"],
    "about": "French sustainable sneakers — organic cotton, wild Amazonian rubber, transparent supply chain"
  },
  // ── Women's Specialty ──────────────────────────────────────────────────────
  {
    "domain": "agolde.com",
    "name": "AGOLDE",
    "categories": ["bottom", "top"],
    "vibe": ["casual", "minimalist", "streetwear"],
    "gender": ["women"],
    "priceRange": "premium",
    "items": ["wide-leg jeans", "straight jeans", "low-rise jeans", "shorts", "crop tee", "denim jacket"],
    "about": "LA premium denim — directional silhouettes and raw-edge finishes, the cooler sibling of Citizens of Humanity"
  },
  {
    "domain": "alohas.com",
    "name": "Alohas",
    "categories": ["footwear"],
    "vibe": ["minimalist", "casual", "preppy", "coastal"],
    "gender": ["women"],
    "priceRange": "premium",
    "items": ["mule", "loafer", "sandal", "boot", "sneaker", "ballet flat"],
    "about": "Barcelona sustainable footwear — made-to-order shoes in natural leathers with a zero-waste approach"
  },
  {
    "domain": "autumncashmere.com",
    "name": "Autumn Cashmere",
    "categories": ["top", "outerwear"],
    "vibe": ["quiet-luxury", "minimalist", "casual", "preppy"],
    "gender": ["women"],
    "priceRange": "premium",
    "items": ["cashmere sweater", "cashmere cardigan", "cashmere hoodie", "cashmere tee", "knit dress"],
    "about": "NYC luxury cashmere — playful takes on classic knitwear in fine cashmere since 1999"
  },
  {
    "domain": "bleuforet.fr",
    "name": "Bleuforêt",
    "categories": ["accessory"],
    "vibe": ["minimalist", "french", "casual"],
    "gender": ["women"],
    "priceRange": "mid",
    "items": ["sock", "wool sock", "tights", "legging"],
    "about": "French hosiery brand — fine socks, tights, and legwear crafted in Troyes since 1923"
  },
  {
    "domain": "echonewyork.com",
    "name": "Echo New York",
    "categories": ["accessory"],
    "vibe": ["bohemian", "casual", "coastal", "maximalist"],
    "gender": ["women"],
    "priceRange": "mid",
    "items": ["scarf", "wrap", "blanket scarf", "headband", "gloves"],
    "about": "NYC accessories brand — expressive scarves and wraps in bold prints and luxurious textures since 1923"
  },
  {
    "domain": "frame-store.com",
    "name": "FRAME",
    "categories": ["bottom", "top", "dress", "outerwear"],
    "vibe": ["minimalist", "quiet-luxury", "french", "casual"],
    "gender": ["women"],
    "priceRange": "premium",
    "items": ["straight-leg jeans", "flare jeans", "silk blouse", "blazer", "dress", "shorts"],
    "about": "LA French-inspired denim and luxury basics — silk blouses, clean-cut jeans, effortless California-meets-Paris dressing"
  },
  {
    "domain": "ganni.com",
    "name": "GANNI",
    "categories": ["top", "bottom", "dress", "outerwear", "footwear", "accessory"],
    "vibe": ["maximalist", "bohemian", "casual", "sustainable", "artistic"],
    "gender": ["women"],
    "priceRange": "premium",
    "items": ["floral dress", "smocked dress", "blazer", "knitwear", "printed blouse", "boot", "bag"],
    "about": "Copenhagen's most-copied brand — playful prints, responsible practices, and Danish irreverence"
  },
  {
    "domain": "hestragloves.com",
    "name": "Hestra",
    "categories": ["accessory"],
    "vibe": ["outdoor", "casual", "heritage-workwear", "minimalist"],
    "gender": ["women", "unisex"],
    "priceRange": "premium",
    "items": ["leather glove", "ski glove", "winter glove", "work glove", "dress glove", "mitten"],
    "about": "Swedish glove makers since 1936 — handcrafted leather gloves from Åseda, the gold standard in hand protection"
  },
  {
    "domain": "intentionallyblank.us",
    "name": "Intentionally Blank",
    "categories": ["footwear"],
    "vibe": ["minimalist", "casual", "streetwear"],
    "gender": ["women"],
    "priceRange": "mid",
    "items": ["sneaker", "boot", "slide", "mule", "loafer", "platform shoe"],
    "about": "Minimal footwear brand — clean logo-free sneakers and boots with an architectural edge"
  },
  {
    "domain": "lineknitwear.com",
    "name": "LINE Knitwear",
    "categories": ["top", "outerwear"],
    "vibe": ["casual", "coastal", "minimalist"],
    "gender": ["women"],
    "priceRange": "mid",
    "items": ["knit sweater", "cardigan", "poncho", "vest", "knit jacket"],
    "about": "Canadian knitwear — relaxed coastal knits in earth tones, easy layering from beach to city"
  },
  {
    "domain": "samsoe.com",
    "name": "Samsøe Samsøe",
    "categories": ["top", "bottom", "dress", "outerwear", "accessory"],
    "vibe": ["minimalist", "casual", "sustainable", "preppy"],
    "gender": ["men", "women"],
    "priceRange": "premium",
    "items": ["shirt", "trouser", "blazer", "knit sweater", "dress", "jacket", "scarf"],
    "about": "Copenhagen fashion brand — clean Scandinavian design with sustainable focus, refined everyday dressing"
  },
  {
    "domain": "whiteandwarren.com",
    "name": "White + Warren",
    "categories": ["top", "outerwear", "accessory"],
    "vibe": ["quiet-luxury", "minimalist", "casual", "preppy"],
    "gender": ["women"],
    "priceRange": "premium",
    "items": ["cashmere sweater", "cashmere cardigan", "cashmere wrap", "cashmere hoodie", "knit scarf"],
    "about": "American cashmere brand — lightweight breathable cashmere in seasonless neutrals for everyday luxury"
  },
  {
    "domain": "adoredvintage.com",
    "name": "Adored Vintage",
    "categories": ["top", "bottom", "dress"],
    "vibe": ["vintage", "romantic", "bohemian"],
    "gender": ["women"],
    "priceRange": "mid",
    "items": ["vintage dress", "blouse", "midi dress", "skirt", "cardigan"],
    "about": "Curated true vintage and vintage-inspired pieces — romantic, feminine, old-world Europe meets Pacific Northwest"
  },
  {
    "domain": "albuslumen.com",
    "name": "Albus Lumen",
    "categories": ["dress", "top", "bottom", "swimwear"],
    "vibe": ["resort", "minimalist", "coastal"],
    "gender": ["women"],
    "priceRange": "premium",
    "items": ["linen dress", "resort shirt", "swimsuit", "maxi dress", "linen trousers"],
    "about": "Australian resort wear — fluid linen and earth-toned minimalism for sun-drenched escapes"
  },
  {
    "domain": "allthingsmochi.com",
    "name": "All Things Mochi",
    "categories": ["dress", "top", "bottom"],
    "vibe": ["bohemian", "artisan", "maximalist"],
    "gender": ["women"],
    "priceRange": "premium",
    "items": ["embroidered dress", "blouse", "skirt", "co-ord set"],
    "about": "Hand-embroidered statement pieces — global artisan craft traditions woven into vibrant modern silhouettes"
  },
  {
    "domain": "alphaindustries.com",
    "name": "Alpha Industries",
    "categories": ["outerwear", "top"],
    "vibe": ["streetwear", "heritage-workwear", "casual"],
    "gender": ["men", "women"],
    "priceRange": "mid",
    "items": ["MA-1 bomber", "field jacket", "parka", "flight jacket", "tee"],
    "about": "The original military bomber — MA-1 flight jackets and mil-spec outerwear since 1959"
  },
  {
    "domain": "andersen-andersen.com",
    "name": "Andersen-Andersen",
    "categories": ["top", "accessory"],
    "vibe": ["heritage-workwear", "minimalist", "coastal"],
    "gender": ["men", "women"],
    "priceRange": "premium",
    "items": ["sailor sweater", "merino sweater", "beanie", "cardigan"],
    "about": "Danish knitwear — five-gauge merino sailor sweaters built like workwear, made to last decades"
  },
  {
    "domain": "babyboofashion.com",
    "name": "BABYBOO Fashion",
    "categories": ["dress", "top", "bottom"],
    "vibe": ["bodycon", "resort"],
    "gender": ["women"],
    "priceRange": "budget",
    "items": ["mini dress", "bodycon dress", "co-ord set", "going-out top"],
    "about": "Australian going-out fashion — figure-hugging dresses and party sets for the night out"
  },
  {
    "domain": "blackhalo.com",
    "name": "Black Halo",
    "categories": ["dress", "top", "bottom"],
    "vibe": ["formal", "bodycon", "minimalist"],
    "gender": ["women"],
    "priceRange": "premium",
    "items": ["sheath dress", "jumpsuit", "midi dress", "blazer dress"],
    "about": "LA-made sculpted dressing — the iconic Jackie O sheath and precision-cut event wear"
  },
  {
    "domain": "blackmilkclothing.com",
    "name": "BlackMilk Clothing",
    "categories": ["top", "bottom", "dress"],
    "vibe": ["maximalist", "bodycon", "streetwear"],
    "gender": ["women"],
    "priceRange": "mid",
    "items": ["printed leggings", "bodycon dress", "swimsuit", "crop top", "skater dress"],
    "about": "Australian bold-print specialists — galaxy leggings, pop-culture collabs, and statement bodycon made in Brisbane"
  },
  {
    "domain": "bronxandbanco.com",
    "name": "Bronx and Banco",
    "categories": ["dress", "top"],
    "vibe": ["bodycon", "maximalist", "resort"],
    "gender": ["women"],
    "priceRange": "premium",
    "items": ["evening dress", "gown", "mini dress", "lace dress", "jumpsuit"],
    "about": "Glamour eveningwear — lace, fringe, and statement silhouettes for parties, weddings, and red-carpet moments"
  },
  {
    "domain": "buckmason.com",
    "name": "Buck Mason",
    "categories": ["top", "bottom", "outerwear"],
    "vibe": ["casual", "heritage-workwear", "minimalist"],
    "gender": ["men", "women"],
    "priceRange": "mid",
    "items": ["slub tee", "oxford shirt", "jeans", "field jacket", "henley"],
    "about": "Modern American classics — perfected tees, denim, and timeless staples made to wear for years"
  },
  {
    "domain": "casablancaparis.com",
    "name": "Casablanca Paris",
    "categories": ["top", "bottom", "outerwear", "accessory"],
    "vibe": ["luxury", "resort", "maximalist"],
    "gender": ["men", "women"],
    "priceRange": "luxury",
    "items": ["silk shirt", "track jacket", "printed shirt", "knit polo", "trousers"],
    "about": "French luxury leisurewear — printed silk shirts and après-sport elegance with Moroccan-riviera flair"
  },
  {
    "domain": "cdlp.com",
    "name": "CDLP",
    "categories": ["underwear", "top", "swimwear"],
    "vibe": ["quiet-luxury", "minimalist", "seamless"],
    "gender": ["men"],
    "priceRange": "premium",
    "items": ["boxer briefs", "lounge pants", "swim shorts", "tank", "socks"],
    "about": "Swedish premium underwear — lyocell luxury basics and refined loungewear with sustainable fabric focus"
  },
  {
    "domain": "christydawn.com",
    "name": "Christy Dawn",
    "categories": ["dress", "top", "bottom"],
    "vibe": ["romantic", "vintage", "sustainable", "cottagecore"],
    "gender": ["women"],
    "priceRange": "premium",
    "items": ["prairie dress", "midi dress", "blouse", "skirt"],
    "about": "Vintage-inspired prairie dresses in deadstock and regeneratively farmed cotton — romantic, honest, heirloom-worthy"
  },
  {
    "domain": "cuyana.com",
    "name": "Cuyana",
    "categories": ["accessory", "top", "outerwear"],
    "vibe": ["quiet-luxury", "minimalist", "luxury"],
    "gender": ["women"],
    "priceRange": "premium",
    "items": ["leather tote", "handbag", "silk blouse", "cashmere sweater", "leather bag", "wallet"],
    "about": "Fewer, better things — premium Italian leather bags and silk essentials with quiet-luxury restraint"
  },
  {
    "domain": "deadstock.ca",
    "name": "Deadstock",
    "categories": ["footwear", "top", "accessory"],
    "vibe": ["streetwear"],
    "gender": ["men", "women"],
    "priceRange": "mid",
    "items": ["sneakers", "graphic tee", "cap", "hoodie"],
    "about": "Toronto sneaker and streetwear boutique — curated drops and Canadian street culture"
  },
  {
    "domain": "elder-statesman.com",
    "name": "The Elder Statesman",
    "categories": ["top", "bottom", "accessory"],
    "vibe": ["luxury", "bohemian", "artisan"],
    "gender": ["men", "women"],
    "priceRange": "luxury",
    "items": ["cashmere sweater", "tie-dye knit", "cashmere beanie", "lounge pants"],
    "about": "LA luxury cashmere — hand-dyed, hand-loomed knits with laid-back California artistry"
  },
  {
    "domain": "elleandriley.com",
    "name": "Elle and Riley",
    "categories": ["top", "bottom", "dress"],
    "vibe": ["quiet-luxury", "cozy", "minimalist"],
    "gender": ["women"],
    "priceRange": "premium",
    "items": ["cashmere sweater", "cashmere cardigan", "knit dress", "lounge set"],
    "about": "Cashmere everyday essentials — buttery knits and elevated loungewear in a soft neutral palette"
  },
  {
    "domain": "fearofgod.com",
    "name": "Fear of God",
    "categories": ["top", "bottom", "outerwear", "footwear"],
    "vibe": ["streetwear", "minimalist", "luxury"],
    "gender": ["men", "women"],
    "priceRange": "luxury",
    "items": ["hoodie", "sweatpants", "overcoat", "tee", "sneakers"],
    "about": "Jerry Lorenzo's American luxury — elevated essentials and relaxed tailoring that redefined premium casual"
  },
  {
    "domain": "fiorucci.com",
    "name": "Fiorucci",
    "categories": ["top", "bottom", "outerwear", "dress"],
    "vibe": ["streetwear", "vintage", "maximalist"],
    "gender": ["men", "women"],
    "priceRange": "premium",
    "items": ["graphic tee", "jeans", "hoodie", "jacket", "mini dress"],
    "about": "Italian retro streetwear icon — cherub graphics, vinyl, and disco-era pop energy revived"
  },
  {
    "domain": "flagandanthem.com",
    "name": "Flag & Anthem",
    "categories": ["top", "bottom", "outerwear"],
    "vibe": ["casual", "heritage-workwear"],
    "gender": ["men"],
    "priceRange": "mid",
    "items": ["henley", "flannel", "jeans", "tee", "jacket"],
    "about": "Small-town American menswear — rugged casual staples with vintage soul"
  },
  {
    "domain": "girlfriend.com",
    "name": "Girlfriend Collective",
    "categories": ["top", "bottom", "underwear"],
    "vibe": ["active", "sustainable", "seamless", "casual"],
    "gender": ["women"],
    "priceRange": "mid",
    "items": ["leggings", "sports bra", "bike shorts", "tank", "unitard", "tee"],
    "about": "Recycled-fabric activewear in inclusive sizing — compressive leggings and bras made from plastic bottles and fishing nets"
  },
  {
    "domain": "golfwang.com",
    "name": "Golf Wang",
    "categories": ["top", "bottom", "outerwear", "accessory"],
    "vibe": ["streetwear", "maximalist"],
    "gender": ["men", "women"],
    "priceRange": "premium",
    "items": ["graphic tee", "hoodie", "cardigan", "beanie", "varsity jacket"],
    "about": "Tyler, the Creator's label — saturated colour, playful graphics, and golf-le-fleur whimsy"
  },
  {
    "domain": "hope-sthlm.com",
    "name": "Hope Stockholm",
    "categories": ["top", "bottom", "outerwear", "dress"],
    "vibe": ["minimalist", "formal", "casual"],
    "gender": ["men", "women"],
    "priceRange": "premium",
    "items": ["tailored trousers", "blazer", "shirt", "wool coat", "jeans"],
    "about": "Swedish tailoring with size-neutral design — relaxed suiting and sharp Scandinavian everyday wear"
  },
  {
    "domain": "johnelliott.com",
    "name": "John Elliott",
    "categories": ["top", "bottom", "outerwear", "footwear"],
    "vibe": ["streetwear", "minimalist", "luxury"],
    "gender": ["men", "women"],
    "priceRange": "premium",
    "items": ["hoodie", "french terry sweatpants", "tee", "denim", "bomber"],
    "about": "LA luxury streetwear — obsessively engineered fleece, refined cuts, and elevated everyday staples"
  },
  {
    "domain": "judithandcharles.com",
    "name": "Judith & Charles",
    "categories": ["top", "bottom", "dress", "outerwear"],
    "vibe": ["formal", "minimalist", "quiet-luxury"],
    "gender": ["women"],
    "priceRange": "premium",
    "items": ["blazer", "dress", "trousers", "silk blouse", "coat"],
    "about": "Canadian contemporary womenswear — architectural tailoring and polished workwear made in Montreal"
  },
  {
    "domain": "killstar.com",
    "name": "Killstar",
    "categories": ["top", "bottom", "dress", "outerwear", "accessory"],
    "vibe": ["streetwear", "maximalist"],
    "gender": ["men", "women"],
    "priceRange": "mid",
    "items": ["gothic dress", "graphic tee", "platform boots", "corset", "hoodie", "skirt"],
    "about": "Gothic and occult-inspired fashion — dark romantic, witchy, alternative streetwear with heavy graphic identity"
  },
  {
    "domain": "kirrinfinch.com",
    "name": "Kirrin Finch",
    "categories": ["top", "bottom", "outerwear"],
    "vibe": ["formal", "preppy", "minimalist"],
    "gender": ["women"],
    "priceRange": "premium",
    "items": ["button-up shirt", "blazer", "trousers", "suit"],
    "about": "Menswear-inspired tailoring for women and non-binary bodies — dapper shirts and suits, ethically made"
  },
  {
    "domain": "knix.com",
    "name": "Knix",
    "categories": ["underwear", "top"],
    "vibe": ["seamless", "active", "casual"],
    "gender": ["women"],
    "priceRange": "mid",
    "items": ["leakproof underwear", "wireless bra", "shapewear", "tank", "sleep set"],
    "about": "Canadian intimates — leakproof underwear and wireless bras engineered for real bodies and real life"
  },
  {
    "domain": "kookai.com.au",
    "name": "Kookai",
    "categories": ["dress", "top", "bottom", "outerwear"],
    "vibe": ["bodycon", "formal", "casual"],
    "gender": ["women"],
    "priceRange": "mid",
    "items": ["mini dress", "blazer", "knit top", "trousers", "midi dress"],
    "about": "Australian fashion house — fitted silhouettes, occasion dressing, and polished everyday pieces"
  },
  {
    "domain": "kotn.com",
    "name": "Kotn",
    "categories": ["top", "bottom", "outerwear"],
    "vibe": ["sustainable", "organic", "minimalist", "casual"],
    "gender": ["men", "women"],
    "priceRange": "mid",
    "items": ["tee", "sweater", "trousers", "shirt", "hoodie"],
    "about": "Canadian sustainable basics — traceable Egyptian cotton essentials that fund schools in farming communities"
  },
  {
    "domain": "krosskulture.com",
    "name": "Kross Kulture",
    "categories": ["dress", "top", "bottom"],
    "vibe": ["indian-ethnic", "formal"],
    "gender": ["women"],
    "priceRange": "mid",
    "items": ["kurta", "embroidered dress", "co-ord set", "tunic"],
    "about": "Pakistani contemporary ethnic wear — embroidered kurtas and modern eastern silhouettes"
  },
  {
    "domain": "kytebaby.com",
    "name": "Kyte Baby",
    "categories": ["underwear", "top", "bottom"],
    "vibe": ["cozy", "organic", "casual"],
    "priceRange": "mid",
    "items": ["baby sleep bag", "baby romper", "pajamas", "footie", "toddler set"],
    "about": "Buttery-soft bamboo sleepwear and essentials for babies, toddlers, and matching family sets"
  },
  {
    "domain": "loveluna.com.au",
    "name": "Love Luna",
    "categories": ["underwear"],
    "vibe": ["seamless", "casual"],
    "gender": ["women"],
    "priceRange": "budget",
    "items": ["period underwear", "briefs", "sleep shorts"],
    "about": "Australian period underwear — leakproof everyday styles at accessible prices"
  },
  {
    "domain": "marcellanyc.com",
    "name": "Marcella NYC",
    "categories": ["dress", "top", "bottom", "outerwear"],
    "vibe": ["minimalist", "formal", "casual"],
    "gender": ["women"],
    "priceRange": "mid",
    "items": ["dress", "blazer", "knit top", "trousers", "skirt"],
    "about": "NYC contemporary womenswear — sharp minimalist pieces with an edge, ethically made in Europe"
  },
  {
    "domain": "michaelstars.com",
    "name": "Michael Stars",
    "categories": ["top", "bottom", "dress"],
    "vibe": ["casual", "cozy", "minimalist"],
    "gender": ["women", "men"],
    "priceRange": "mid",
    "items": ["tee", "knit dress", "cardigan", "joggers", "tank"],
    "about": "LA-made luxe basics — supima tees and easy knits with laid-back California polish"
  },
  {
    "domain": "mrbeast.store",
    "name": "MrBeast Store",
    "categories": ["top", "bottom", "accessory"],
    "vibe": ["streetwear", "casual"],
    "gender": ["men", "women"],
    "priceRange": "budget",
    "items": ["graphic tee", "hoodie", "shorts", "cap", "plushie"],
    "about": "Official MrBeast merch — bold Beast-branded basics from the biggest creator on the planet"
  },
  {
    "domain": "mvmt.com",
    "name": "MVMT",
    "categories": ["accessory", "jewellery"],
    "vibe": ["minimalist", "casual"],
    "gender": ["men", "women"],
    "priceRange": "mid",
    "items": ["watch", "sunglasses", "bracelet", "ring", "necklace"],
    "about": "Minimalist watches, eyewear, and jewelry — clean modern design at accessible prices"
  },
  {
    "domain": "myrqvist.com",
    "name": "Myrqvist",
    "categories": ["footwear"],
    "vibe": ["minimalist", "formal", "quiet-luxury"],
    "gender": ["men"],
    "priceRange": "premium",
    "items": ["loafers", "derbies", "chelsea boots", "sneakers", "oxfords"],
    "about": "Swedish footwear — Goodyear-welted dress shoes and minimal sneakers, handmade in Portugal at honest prices"
  },
  {
    "domain": "ohpolly.com",
    "name": "Oh Polly",
    "categories": ["dress", "top", "bottom", "swimwear"],
    "vibe": ["bodycon", "formal"],
    "gender": ["women"],
    "priceRange": "mid",
    "items": ["bodycon dress", "corset dress", "mini dress", "bikini", "gown"],
    "about": "UK glamour label — sculpting occasion dresses and contour fits for events and nights out"
  },
  {
    "domain": "olivercabell.com",
    "name": "Oliver Cabell",
    "categories": ["footwear"],
    "vibe": ["minimalist", "luxury", "casual"],
    "gender": ["men", "women"],
    "priceRange": "premium",
    "items": ["leather sneakers", "low-top", "chelsea boots", "loafers"],
    "about": "Direct-to-consumer Italian-made leather sneakers — luxury craftsmanship without the markup"
  },
  {
    "domain": "oscardelarenta.com",
    "name": "Oscar de la Renta",
    "categories": ["dress", "top", "bottom", "outerwear", "accessory"],
    "vibe": ["luxury", "formal", "romantic"],
    "gender": ["women"],
    "priceRange": "luxury",
    "items": ["gown", "cocktail dress", "blouse", "skirt", "evening bag"],
    "about": "American couture house — occasion dressing, embroidered gowns, and ladylike glamour for evening and bridal"
  },
  {
    "domain": "patta.nl",
    "name": "Patta",
    "categories": ["top", "bottom", "outerwear", "accessory"],
    "vibe": ["streetwear"],
    "gender": ["men", "women"],
    "priceRange": "mid",
    "items": ["graphic tee", "hoodie", "track jacket", "cap", "cargo pants"],
    "about": "Amsterdam streetwear institution — community-rooted graphics and collabs from the Dutch scene's founders"
  },
  {
    "domain": "pierrehardy.com",
    "name": "Pierre Hardy",
    "categories": ["footwear", "accessory"],
    "vibe": ["luxury", "artistic", "french"],
    "gender": ["men", "women"],
    "priceRange": "luxury",
    "items": ["sneakers", "loafers", "heels", "boots", "handbag"],
    "about": "Parisian luxury footwear — graphic colour-blocking and architectural lines from a former Hermès designer"
  },
  {
    "domain": "proclub.com",
    "name": "Pro Club",
    "categories": ["top", "bottom"],
    "vibe": ["streetwear", "casual"],
    "gender": ["men"],
    "priceRange": "budget",
    "items": ["heavyweight tee", "hoodie", "sweatpants", "thermal"],
    "about": "The heavyweight blank tee institution — LA streetwear's foundation layer since 1986"
  },
  {
    "domain": "rags.com",
    "name": "Rags",
    "categories": ["top", "bottom"],
    "vibe": ["casual", "cozy"],
    "priceRange": "mid",
    "items": ["kids romper", "kids tee", "kids joggers", "onesie", "kids set"],
    "about": "Modern kids' essentials — signature rompers and everyday sets designed for comfort and play"
  },
  {
    "domain": "rareism.com",
    "name": "Rareism",
    "categories": ["top", "bottom", "dress", "outerwear"],
    "vibe": ["contemporary", "minimalist", "formal", "casual"],
    "gender": ["women"],
    "priceRange": "mid",
    "items": ["dress", "blazer", "trousers", "top", "co-ord set", "shirt", "skirt"],
    "about": "Indian contemporary womenswear from the House of Rare — sharp tailoring, clean lines, and elevated everyday pieces"
  },
  {
    "domain": "relode.se",
    "name": "Relode",
    "categories": ["top", "bottom"],
    "vibe": ["workout", "active", "seamless"],
    "gender": ["men", "women"],
    "priceRange": "mid",
    "items": ["training tee", "shorts", "leggings", "hoodie", "tank"],
    "about": "Swedish gymwear — clean Scandinavian training essentials with technical fabrics"
  },
  {
    "domain": "rezekstudio.com",
    "name": "Rezek Studio",
    "categories": ["dress", "top", "bottom"],
    "vibe": ["romantic", "vintage", "resort"],
    "gender": ["women"],
    "priceRange": "premium",
    "items": ["mini dress", "matching set", "top", "skirt"],
    "about": "LA it-girl label — flirty vintage-inspired dresses and sets with a sunny California spirit"
  },
  {
    "domain": "rouje.com",
    "name": "Rouje",
    "categories": ["dress", "top", "bottom", "outerwear"],
    "vibe": ["french", "romantic", "vintage"],
    "gender": ["women"],
    "priceRange": "premium",
    "items": ["wrap dress", "cardigan", "blouse", "jeans", "skirt"],
    "about": "Jeanne Damas's Parisian label — effortless French-girl wrap dresses, knits, and vintage-inspired femininity"
  },
  {
    "domain": "shainamote.com",
    "name": "Shaina Mote",
    "categories": ["top", "bottom", "dress"],
    "vibe": ["minimalist", "artisan", "japanese"],
    "gender": ["women"],
    "priceRange": "premium",
    "items": ["draped dress", "linen top", "wide-leg trousers", "knit"],
    "about": "LA-made sculptural minimalism — fluid natural-fibre pieces with quiet Japanese-inflected drape"
  },
  {
    "domain": "starcadet.com",
    "name": "Star Cadet",
    "categories": ["top", "bottom", "accessory"],
    "vibe": ["streetwear", "maximalist", "casual"],
    "gender": ["men", "women"],
    "priceRange": "mid",
    "items": ["graphic tee", "hoodie", "shorts", "cap"],
    "about": "Playful indie apparel — colourful graphics and limited drops with a creator-community spirit"
  },
  {
    "domain": "tallermarmo.com",
    "name": "Taller Marmo",
    "categories": ["dress", "top"],
    "vibe": ["luxury", "maximalist", "resort"],
    "gender": ["women"],
    "priceRange": "luxury",
    "items": ["fringed gown", "kaftan", "evening dress", "blouse"],
    "about": "Milan-based eveningwear — fringe-trimmed kaftans and dramatic gowns with 1970s jet-set glamour"
  },
  {
    "domain": "tenthousand.cc",
    "name": "Ten Thousand",
    "categories": ["top", "bottom"],
    "vibe": ["workout", "sport", "active"],
    "gender": ["men"],
    "priceRange": "mid",
    "items": ["training shorts", "tee", "tank", "joggers", "compression"],
    "about": "Performance training gear for men — durable minimalist kit built and tested by athletes"
  },
  {
    "domain": "tentree.com",
    "name": "Tentree",
    "categories": ["top", "bottom", "outerwear"],
    "vibe": ["sustainable", "organic", "casual", "outdoor"],
    "gender": ["men", "women"],
    "priceRange": "mid",
    "items": ["tee", "hoodie", "joggers", "jacket", "flannel", "sweater"],
    "about": "Earth-first essentials — ten trees planted for every item, organic cotton and recycled fabrics in relaxed everyday silhouettes"
  },
  {
    "domain": "thefrankieshop.com",
    "name": "The Frankie Shop",
    "categories": ["top", "bottom", "outerwear", "dress"],
    "vibe": ["minimalist", "streetwear", "formal"],
    "gender": ["men", "women"],
    "priceRange": "premium",
    "items": ["oversized blazer", "trousers", "shirt", "tee", "leather jacket"],
    "about": "Paris/NYC cult label — oversized blazers and sharply minimal staples that defined the modern silhouette"
  },
  {
    "domain": "toteme-studio.com",
    "name": "Toteme",
    "categories": ["top", "bottom", "outerwear", "dress", "accessory"],
    "vibe": ["quiet-luxury", "minimalist"],
    "gender": ["women"],
    "priceRange": "luxury",
    "items": ["wool coat", "knit sweater", "tailored trousers", "silk blouse", "scarf jacket"],
    "about": "Stockholm's quiet-luxury benchmark — disciplined silhouettes and impeccable everyday uniform dressing"
  },
  {
    "domain": "triangl.com",
    "name": "Triangl",
    "categories": ["swimwear"],
    "vibe": ["resort", "bodycon"],
    "gender": ["women"],
    "priceRange": "mid",
    "items": ["bikini", "one-piece", "swimsuit"],
    "about": "Australian swimwear icon — neoprene bikinis in bold colours and sporty-feminine cuts"
  },
  {
    "domain": "universalstore.com",
    "name": "Universal Store",
    "categories": ["top", "bottom", "dress", "outerwear", "footwear"],
    "vibe": ["streetwear", "casual", "denim"],
    "gender": ["men", "women"],
    "priceRange": "mid",
    "items": ["graphic tee", "jeans", "mini dress", "hoodie", "sneakers"],
    "about": "Australian youth fashion destination — streetwear, denim, and festival-ready brands under one roof"
  },
  {
    "domain": "vastrado.com",
    "name": "Vastrado",
    "categories": ["top", "bottom", "dress", "outerwear"],
    "vibe": ["minimalist", "sustainable", "quiet-luxury", "casual"],
    "gender": ["women"],
    "priceRange": "mid",
    "items": ["linen dress", "linen blouse", "linen trousers", "cotton top", "jacket", "skirt"],
    "about": "Spanish slow fashion — natural fibres, clean lines, and timeless silhouettes crafted for the conscious wardrobe"
  },
  {
    "domain": "vessi.com",
    "name": "Vessi",
    "categories": ["footwear"],
    "vibe": ["casual", "active", "outdoor"],
    "gender": ["men", "women"],
    "priceRange": "mid",
    "items": ["waterproof sneakers", "slip-on", "knit sneaker"],
    "about": "Canadian waterproof knit sneakers — fully breathable, machine-washable, built for rain-city life"
  },
  {
    "domain": "wearfigs.com",
    "name": "FIGS",
    "categories": ["top", "bottom", "outerwear"],
    "vibe": ["workout", "minimalist", "casual"],
    "gender": ["men", "women"],
    "priceRange": "mid",
    "items": ["scrub top", "scrub pants", "underscrub", "vest", "jogger scrubs"],
    "about": "Premium medical apparel — technical scrubs with athletic-wear comfort and a tailored fit"
  },
  {
    "domain": "whimsyandrow.com",
    "name": "Whimsy + Row",
    "categories": ["dress", "top", "bottom"],
    "vibe": ["sustainable", "romantic", "casual"],
    "gender": ["women"],
    "priceRange": "mid",
    "items": ["midi dress", "linen top", "skirt", "jumpsuit"],
    "about": "LA slow fashion — small-batch feminine pieces in deadstock and eco fabrics"
  },
  {
    "domain": "youngla.com",
    "name": "YoungLA",
    "categories": ["top", "bottom", "outerwear"],
    "vibe": ["workout", "streetwear", "casual"],
    "gender": ["men", "women"],
    "priceRange": "budget",
    "items": ["tee", "hoodie", "joggers", "shorts", "tank top", "compression wear"],
    "about": "LA gym and streetwear staple — oversized fits, lifting gear, and athleisure built for the fitness community"
  },
  {
    "domain": "offduty.in",
    "name": "Off Duty India",
    "categories": ["top", "bottom", "dress", "outerwear", "accessory"],
    "vibe": ["resort", "bohemian", "relaxed", "vacation", "tropical", "printed", "co-ord"],
    "gender": ["women"],
    "priceRange": "mid",
    "items": ["co-ord set", "dress", "blouse", "shorts", "skirt", "kaftan", "jumpsuit", "top"],
    "about": "Indian resort and vacation wear — vibrant prints, easy silhouettes, and co-ord sets for warm-weather dressing"
  },

  // ── Indian Streetwear & Casual ────────────────────────────────────────────
  {
    "domain": "snitch.co.in",
    "name": "SNITCH",
    "categories": ["top", "bottom", "outerwear", "accessory"],
    "vibe": ["streetwear", "casual", "urban", "graphic", "oversized", "y2k"],
    "gender": ["men"],
    "priceRange": "budget",
    "items": ["t-shirt", "shirt", "jogger", "shorts", "hoodie", "jacket", "cargo"],
    "about": "Indian streetwear brand with bold graphics, oversized fits, and urban casual styles at accessible prices"
  },
  {
    "domain": "thehouseofrare.com",
    "name": "The House of Rare",
    "categories": ["top", "bottom", "outerwear", "accessory"],
    "vibe": ["casual", "urban", "everyday", "relaxed"],
    "gender": ["men"],
    "priceRange": "budget",
    "items": ["t-shirt", "shirt", "trouser", "shorts", "hoodie", "sweatshirt"],
    "about": "Popular Indian menswear brand with casual everyday styles — shirts, tees, and trousers at everyday prices"
  },
  {
    "domain": "bonkerscorner.com",
    "name": "Bonkers Corner",
    "categories": ["top", "bottom", "outerwear", "accessory"],
    "vibe": ["streetwear", "casual", "graphic", "quirky", "pop-culture"],
    "gender": ["men", "women", "unisex"],
    "priceRange": "budget",
    "items": ["t-shirt", "hoodie", "sweatshirt", "shorts", "jogger"],
    "about": "Quirky Indian streetwear with pop-culture graphics, memes, and bold designs for the internet generation"
  },
  {
    "domain": "redwolf.in",
    "name": "Redwolf",
    "categories": ["top", "bottom", "outerwear", "accessory"],
    "vibe": ["graphic", "streetwear", "pop-culture", "bold", "alternative", "fandom"],
    "gender": ["men", "women", "unisex"],
    "priceRange": "budget",
    "items": ["t-shirt", "hoodie", "sweatshirt", "phone case"],
    "about": "Indian graphic tee and pop-culture apparel brand — licensed prints, fandom designs, and bold graphic fashion"
  },
  {
    "domain": "theindiangarageco.com",
    "name": "The Indian Garage Co.",
    "categories": ["top", "bottom", "outerwear", "accessory"],
    "vibe": ["casual", "urban", "everyday", "contemporary"],
    "gender": ["men"],
    "priceRange": "budget",
    "items": ["t-shirt", "shirt", "trouser", "shorts", "jacket", "sweatshirt"],
    "about": "Indian casual menswear with contemporary silhouettes — relaxed shirts, tees, and bottoms for everyday"
  },
  {
    "domain": "beyoung.in",
    "name": "Beyoung",
    "categories": ["top", "bottom", "outerwear", "accessory"],
    "vibe": ["casual", "streetwear", "urban", "graphic", "youthful"],
    "gender": ["men", "women"],
    "priceRange": "budget",
    "items": ["t-shirt", "shirt", "trouser", "shorts", "hoodie", "sweatshirt"],
    "about": "Indian casual fashion for young adults — graphic tees, relaxed fits, and affordable streetwear"
  },
  {
    "domain": "bombaytrooper.com",
    "name": "Bombay Trooper",
    "categories": ["top", "bottom", "outerwear", "accessory"],
    "vibe": ["casual", "everyday", "relaxed", "urban", "Mumbai"],
    "gender": ["men"],
    "priceRange": "budget",
    "items": ["t-shirt", "shirt", "trouser", "shorts", "jacket"],
    "about": "Mumbai-based menswear brand with relaxed, everyday styles inspired by the city's easy urban culture"
  },
  {
    "domain": "powerlook.in",
    "name": "Powerlook",
    "categories": ["top", "bottom", "outerwear", "accessory"],
    "vibe": ["casual", "streetwear", "bold", "urban"],
    "gender": ["men"],
    "priceRange": "budget",
    "items": ["t-shirt", "shirt", "trouser", "jogger", "hoodie", "sweatshirt"],
    "about": "Indian menswear brand with bold, street-influenced casual styles for young men"
  },
  {
    "domain": "franklywearing.com",
    "name": "Frankly Wearing",
    "categories": ["top", "bottom", "outerwear"],
    "vibe": ["casual", "relaxed", "everyday", "comfortable"],
    "gender": ["men", "women"],
    "priceRange": "budget",
    "items": ["t-shirt", "sweatshirt", "hoodie", "jogger", "shorts"],
    "about": "Indian casual basics brand — honest, comfortable everyday essentials in relaxed silhouettes"
  },
  {
    "domain": "mydesignation.in",
    "name": "Mydesignation",
    "categories": ["top", "bottom", "accessory"],
    "vibe": ["graphic", "casual", "fun", "office-humour", "pop-culture"],
    "gender": ["men", "women"],
    "priceRange": "budget",
    "items": ["t-shirt", "hoodie", "mug", "poster"],
    "about": "Indian pop-culture and humour apparel — office jokes, relatable graphics, and fun casual wear"
  },
  {
    "domain": "styched.com",
    "name": "Styched",
    "categories": ["top", "bottom", "outerwear"],
    "vibe": ["casual", "everyday", "comfortable", "relaxed"],
    "gender": ["men", "women"],
    "priceRange": "budget",
    "items": ["t-shirt", "hoodie", "sweatshirt", "shorts", "jogger"],
    "about": "Indian casual wear with simple, comfortable everyday basics in relaxed fits"
  },
  {
    "domain": "whatwhenwear.com",
    "name": "What When Wear",
    "categories": ["top", "bottom", "dress", "accessory"],
    "vibe": ["casual", "everyday", "contemporary", "wearable"],
    "gender": ["women"],
    "priceRange": "budget",
    "items": ["top", "dress", "skirt", "co-ord", "trouser"],
    "about": "Indian womenswear with practical everyday styles — easy pieces for real life, every occasion"
  },
  {
    "domain": "marchtee.in",
    "name": "March Tee",
    "categories": ["top", "accessory"],
    "vibe": ["graphic", "casual", "minimal", "clean", "everyday"],
    "gender": ["men", "women", "unisex"],
    "priceRange": "budget",
    "items": ["t-shirt", "polo", "sweatshirt"],
    "about": "Indian tee-first casual brand with clean graphic prints and minimal everyday essentials"
  },
  {
    "domain": "fullyfilmy.in",
    "name": "Fully Filmy",
    "categories": ["top", "accessory"],
    "vibe": ["graphic", "Bollywood", "pop-culture", "fun", "casual"],
    "gender": ["men", "women", "unisex"],
    "priceRange": "budget",
    "items": ["t-shirt", "hoodie", "sweatshirt"],
    "about": "Bollywood and Indian pop-culture apparel — film dialogue prints, retro film graphics, and desi nostalgia on tees"
  },
  {
    "domain": "wyoindia.com",
    "name": "WYO",
    "categories": ["top", "bottom", "outerwear"],
    "vibe": ["streetwear", "urban", "graphic", "casual", "bold"],
    "gender": ["men"],
    "priceRange": "budget",
    "items": ["t-shirt", "hoodie", "cargo", "shorts"],
    "about": "Indian streetwear label with bold graphic expressions and urban casual silhouettes"
  },
  {
    "domain": "burgerbae.com",
    "name": "BurgerBae",
    "categories": ["top", "bottom", "accessory"],
    "vibe": ["casual", "fun", "quirky", "graphic", "pop-culture"],
    "gender": ["men", "women"],
    "priceRange": "budget",
    "items": ["t-shirt", "shorts", "sweatshirt"],
    "about": "Playful Indian casual brand with fun food-inspired graphics and quirky pop-culture designs"
  },

  // ── Indian Ethnic, Fusion & Heritage ─────────────────────────────────────
  {
    "domain": "suta.in",
    "name": "Suta",
    "categories": ["dress", "top", "accessory"],
    "vibe": ["ethnic", "handloom", "artisanal", "natural", "sari", "traditional", "sustainable"],
    "gender": ["women"],
    "priceRange": "mid",
    "items": ["saree", "blouse", "kurta", "dupatta", "co-ord"],
    "about": "Suta revives handwoven Indian sarees and ethnic wear — natural fabrics, artisanal craft, and modern takes on tradition"
  },
  {
    "domain": "aachho.com",
    "name": "Aachho",
    "categories": ["dress", "top", "accessory"],
    "vibe": ["ethnic", "fusion", "handcraft", "traditional", "festive", "printed"],
    "gender": ["women"],
    "priceRange": "mid",
    "items": ["kurta", "dress", "co-ord set", "top", "skirt"],
    "about": "Indian ethnic and fusion wear with handcrafted details, block prints, and festive occasion styling"
  },
  {
    "domain": "jaypore.com",
    "name": "Jaypore",
    "categories": ["top", "dress", "bottom", "accessory"],
    "vibe": ["ethnic", "artisanal", "handcraft", "heritage", "craft", "Indian", "curated"],
    "gender": ["women"],
    "priceRange": "mid",
    "items": ["kurta", "dress", "saree", "dupatta", "jewellery", "scarf"],
    "about": "Curated Indian craft marketplace — handwoven textiles, block prints, embroidery, and artisan jewellery from across India"
  },
  {
    "domain": "koskii.com",
    "name": "Koskii",
    "categories": ["dress", "top", "bottom", "accessory"],
    "vibe": ["ethnic", "festive", "embellished", "party", "wedding", "traditional"],
    "gender": ["women"],
    "priceRange": "mid",
    "items": ["lehenga", "saree", "salwar suit", "kurta", "gown"],
    "about": "Indian festive and wedding wear — embellished lehengas, designer sarees, and party-ready occasion outfits"
  },
  {
    "domain": "houseofchikankari.com",
    "name": "House of Chikankari",
    "categories": ["top", "dress", "accessory"],
    "vibe": ["ethnic", "handcraft", "chikankari", "traditional", "Lucknow", "embroidered"],
    "gender": ["women"],
    "priceRange": "mid",
    "items": ["kurta", "co-ord set", "dress", "palazzo", "dupatta"],
    "about": "Authentic Lucknow chikankari — hand-embroidered ethnic wear in breathable fabrics with intricate traditional motifs"
  },
  {
    "domain": "karagiri.com",
    "name": "Karagiri",
    "categories": ["dress", "top", "accessory"],
    "vibe": ["ethnic", "saree", "traditional", "silk", "festive", "handwoven"],
    "gender": ["women"],
    "priceRange": "mid",
    "items": ["saree", "blouse", "kurta", "dupatta"],
    "about": "Curated Indian sarees and ethnic wear — silks, handlooms, and festive occasion dressing from across India"
  },
  {
    "domain": "itokri.com",
    "name": "iTokri",
    "categories": ["top", "dress", "accessory"],
    "vibe": ["ethnic", "handcraft", "artisanal", "handloom", "heritage", "craft"],
    "gender": ["women"],
    "priceRange": "mid",
    "items": ["saree", "kurta", "stole", "dupatta", "jewellery", "scarf"],
    "about": "Online platform for authentic Indian handcrafted textiles — handlooms, block prints, natural dyes, and artisan work"
  },
  {
    "domain": "gulaalclothes.com",
    "name": "Gulaal",
    "categories": ["dress", "top", "bottom", "accessory"],
    "vibe": ["ethnic", "festive", "embroidered", "traditional", "wedding", "vibrant"],
    "gender": ["women"],
    "priceRange": "mid",
    "items": ["lehenga", "salwar suit", "kurta set", "gown", "dupatta"],
    "about": "Indian festive and bridal wear with rich embroidery, vibrant colours, and occasion dressing for celebrations"
  },
  {
    "domain": "ambraee.com",
    "name": "Ambraee",
    "categories": ["dress", "top", "accessory"],
    "vibe": ["ethnic", "artisanal", "natural", "handcraft", "sustainable", "earthy"],
    "gender": ["women"],
    "priceRange": "mid",
    "items": ["kurta", "dress", "co-ord set", "dupatta"],
    "about": "Artisanal Indian womenswear with handcrafted techniques, natural dyes, and ethical slow-fashion production"
  },
  {
    "domain": "bunaai.com",
    "name": "Bunaai",
    "categories": ["top", "dress", "accessory"],
    "vibe": ["ethnic", "handwoven", "Rajasthan", "artisanal", "block-print", "fusion", "Jaipur"],
    "gender": ["women"],
    "priceRange": "mid",
    "items": ["kurta", "co-ord set", "dress", "dupatta", "skirt"],
    "about": "Jaipur-based label with block-printed and hand-dyed ethnic wear — traditional Rajasthani craft in contemporary silhouettes"
  },
  {
    "domain": "roopkala.com",
    "name": "Roopkala",
    "categories": ["dress", "top", "accessory"],
    "vibe": ["ethnic", "traditional", "embroidered", "festive", "Indian"],
    "gender": ["women"],
    "priceRange": "mid",
    "items": ["salwar suit", "kurta", "dupatta", "lehenga"],
    "about": "Indian ethnic wear with traditional embroidery and festive occasion styling across salwar suits and kurta sets"
  },
  {
    "domain": "janasya.com",
    "name": "Janasya",
    "categories": ["top", "dress", "bottom"],
    "vibe": ["ethnic", "casual", "everyday", "traditional", "comfortable"],
    "gender": ["women"],
    "priceRange": "budget",
    "items": ["kurta", "kurti", "palazzo", "salwar", "co-ord"],
    "about": "Everyday Indian ethnic and kurta wear for women — comfortable, affordable, and occasion-ready everyday looks"
  },
  {
    "domain": "truebrowns.com",
    "name": "TrueBrowns",
    "categories": ["top", "dress", "bottom", "accessory"],
    "vibe": ["ethnic", "fusion", "contemporary", "minimal", "earthy", "festive", "premium"],
    "gender": ["women"],
    "priceRange": "premium",
    "items": ["kurta", "co-ord set", "dress", "trouser", "blazer"],
    "about": "Contemporary Indian womenswear bridging ethnic and modern — minimal palettes, quality fabrics, and elevated festive dressing"
  },
  {
    "domain": "theloom.in",
    "name": "The Loom",
    "categories": ["top", "dress", "accessory"],
    "vibe": ["ethnic", "handloom", "artisanal", "traditional", "natural", "sustainable"],
    "gender": ["women"],
    "priceRange": "mid",
    "items": ["saree", "kurta", "dupatta", "stole"],
    "about": "Handloom-forward Indian ethnic wear — woven traditions, natural fibres, and sustainable production"
  },
  {
    "domain": "labelkanupriya.com",
    "name": "Label Kanupriya",
    "categories": ["top", "dress", "accessory"],
    "vibe": ["ethnic", "fusion", "contemporary", "festive", "minimal"],
    "gender": ["women"],
    "priceRange": "mid",
    "items": ["kurta", "co-ord set", "dress", "jacket"],
    "about": "Indian fusion wear label blending ethnic heritage with modern silhouettes for the contemporary woman"
  },
  {
    "domain": "chidiyaa.com",
    "name": "Chidiyaa",
    "categories": ["top", "dress", "accessory"],
    "vibe": ["ethnic", "block-print", "handcraft", "traditional", "artisanal", "nature"],
    "gender": ["women"],
    "priceRange": "mid",
    "items": ["kurta", "dress", "co-ord set", "scarf", "dupatta"],
    "about": "Hand block-printed Indian womenswear — nature-inspired motifs, natural dyes, and artisan craft from Jaipur"
  },
  {
    "domain": "okhai.com",
    "name": "Okhai",
    "categories": ["top", "dress", "bottom", "accessory"],
    "vibe": ["ethnic", "handcraft", "artisanal", "sustainable", "tribal", "embroidered"],
    "gender": ["women"],
    "priceRange": "mid",
    "items": ["kurta", "dress", "dupatta", "tote", "scarf"],
    "about": "Artisan-made Indian ethnic wear — tribal embroidery and handwork by rural craftswomen, sustainably produced"
  },
  {
    "domain": "bunai.com",
    "name": "Bunai",
    "categories": ["top", "outerwear", "accessory"],
    "vibe": ["handknit", "artisanal", "natural", "Himalayan", "knitwear"],
    "gender": ["women", "men"],
    "priceRange": "premium",
    "items": ["sweater", "cardigan", "shawl", "scarf", "poncho"],
    "about": "Himalayan hand-knitted knitwear — traditional craft in natural wools and earthy colours, slow-made with care"
  },
  {
    "domain": "faridagupta.com",
    "name": "Farida Gupta",
    "categories": ["top", "dress", "accessory"],
    "vibe": ["ethnic", "fusion", "chikankari", "embroidered", "relaxed", "contemporary"],
    "gender": ["women"],
    "priceRange": "mid",
    "items": ["kurta", "co-ord set", "dress", "top", "dupatta"],
    "about": "Relaxed Indian ethnic wear with chikankari and embroidery — easy fusion silhouettes for everyday and occasion"
  },
  {
    "domain": "suvasa.com",
    "name": "Suvasa",
    "categories": ["dress", "top", "accessory"],
    "vibe": ["ethnic", "fusion", "contemporary", "natural", "Indian"],
    "gender": ["women"],
    "priceRange": "mid",
    "items": ["kurta", "co-ord set", "dress", "dupatta"],
    "about": "Contemporary Indian ethnic wear with a clean, natural sensibility — quality fabrics and refined fusion silhouettes"
  },
  {
    "domain": "mulmul.com",
    "name": "Mulmul",
    "categories": ["dress", "top", "accessory"],
    "vibe": ["ethnic", "cotton", "handloom", "relaxed", "natural", "everyday", "traditional"],
    "gender": ["women"],
    "priceRange": "mid",
    "items": ["kurta", "saree", "dress", "co-ord", "dupatta"],
    "about": "Mulmul cotton and handloom Indian ethnic wear — breathable, natural fabrics in relaxed traditional silhouettes"
  },

  // ── Indian Western & Contemporary Womenswear ──────────────────────────────
  {
    "domain": "fablestreet.com",
    "name": "FableStreet",
    "categories": ["top", "bottom", "dress", "outerwear"],
    "vibe": ["workwear", "smart casual", "contemporary", "minimal", "professional", "polished"],
    "gender": ["women"],
    "priceRange": "mid",
    "items": ["blouse", "shirt", "trouser", "blazer", "dress", "skirt", "co-ord"],
    "about": "Indian womenswear for the working woman — professional, polished styles in quality fabrics for office and beyond"
  },
  {
    "domain": "femella.in",
    "name": "Femella",
    "categories": ["top", "dress", "bottom", "accessory"],
    "vibe": ["casual", "contemporary", "fun", "everyday", "youthful"],
    "gender": ["women"],
    "priceRange": "budget",
    "items": ["top", "dress", "skirt", "shorts", "co-ord set"],
    "about": "Indian women's casual and contemporary fashion — fun prints, easy silhouettes, and affordable everyday wearables"
  },
  {
    "domain": "twentydresses.com",
    "name": "Twenty Dresses",
    "categories": ["dress", "top", "bottom", "accessory"],
    "vibe": ["casual", "feminine", "contemporary", "everyday", "affordable"],
    "gender": ["women"],
    "priceRange": "budget",
    "items": ["dress", "top", "jumpsuit", "skirt", "co-ord"],
    "about": "Indian contemporary womenswear with feminine designs — dresses, tops, and co-ords for everyday and occasions"
  },
  {
    "domain": "letsdressup.com",
    "name": "LetsDressUp",
    "categories": ["dress", "top", "bottom", "accessory"],
    "vibe": ["party", "festive", "contemporary", "feminine", "glamour"],
    "gender": ["women"],
    "priceRange": "budget",
    "items": ["dress", "top", "co-ord", "jumpsuit", "skirt"],
    "about": "Indian womenswear for parties and occasions — glam co-ords, embellished dresses, and festive-ready outfits"
  },
  {
    "domain": "newme.in",
    "name": "NEWME",
    "categories": ["top", "bottom", "dress", "accessory"],
    "vibe": ["fast-fashion", "trendy", "y2k", "casual", "bold", "Gen-Z"],
    "gender": ["women"],
    "priceRange": "budget",
    "items": ["top", "dress", "skirt", "jeans", "co-ord"],
    "about": "Indian fast fashion for Gen-Z women — trend-driven styles, bold prints, and Y2K-inspired casual looks at low prices"
  },
  {
    "domain": "slikk.in",
    "name": "Slikk",
    "categories": ["top", "dress", "bottom", "accessory"],
    "vibe": ["contemporary", "casual", "everyday", "youthful"],
    "gender": ["women"],
    "priceRange": "budget",
    "items": ["top", "dress", "co-ord", "skirt", "trouser"],
    "about": "Indian contemporary womenswear with easy, everyday styles for the young modern woman"
  },
  {
    "domain": "freakins.com",
    "name": "Freakins",
    "categories": ["bottom", "top", "dress", "outerwear"],
    "vibe": ["denim", "casual", "streetwear", "y2k", "urban", "contemporary"],
    "gender": ["women", "men"],
    "priceRange": "mid",
    "items": ["jeans", "denim jacket", "shorts", "co-ord", "top"],
    "about": "Indian denim-first brand with contemporary washes and fits — jeans, denim co-ords, and casual streetwear"
  },
  {
    "domain": "tokyotalkies.in",
    "name": "Tokyo Talkies",
    "categories": ["top", "dress", "bottom", "outerwear"],
    "vibe": ["casual", "contemporary", "everyday", "Korean", "Asian-inspired"],
    "gender": ["women"],
    "priceRange": "budget",
    "items": ["top", "dress", "co-ord", "skirt", "jacket"],
    "about": "Indian womenswear with East Asian fashion influences — contemporary casual styles with Korean-inspired silhouettes"
  },
  {
    "domain": "berrylush.com",
    "name": "Berrylush",
    "categories": ["top", "dress", "bottom", "accessory"],
    "vibe": ["feminine", "floral", "casual", "romantic", "contemporary", "printed"],
    "gender": ["women"],
    "priceRange": "budget",
    "items": ["top", "dress", "skirt", "co-ord", "jumpsuit"],
    "about": "Indian womenswear with feminine prints, florals, and easy silhouettes for everyday and casual occasions"
  },
  {
    "domain": "madglame.com",
    "name": "MadGlame",
    "categories": ["dress", "top", "accessory"],
    "vibe": ["party", "glam", "bold", "festive", "occasion"],
    "gender": ["women"],
    "priceRange": "budget",
    "items": ["dress", "top", "co-ord", "jumpsuit"],
    "about": "Indian party and glam womenswear — embellished, bold, and occasion-ready styles for celebrations"
  },
  {
    "domain": "luluandsky.com",
    "name": "Lulu & Sky",
    "categories": ["top", "dress", "bottom", "accessory"],
    "vibe": ["bohemian", "casual", "romantic", "festival", "relaxed", "printed"],
    "gender": ["women"],
    "priceRange": "mid",
    "items": ["top", "dress", "skirt", "co-ord", "jumpsuit"],
    "about": "Indian boho-influenced women's fashion — flowy fabrics, eclectic prints, and festival-ready romantic styling"
  },
  {
    "domain": "coverstory.in",
    "name": "Cover Story",
    "categories": ["top", "dress", "bottom", "outerwear"],
    "vibe": ["contemporary", "minimal", "professional", "casual", "everyday", "polished"],
    "gender": ["women"],
    "priceRange": "mid",
    "items": ["blazer", "shirt", "dress", "trouser", "skirt", "co-ord"],
    "about": "Indian contemporary womenswear with a clean, polished sensibility — from workwear to weekend in refined fabrics"
  },
  {
    "domain": "saltattire.com",
    "name": "Salt Attire",
    "categories": ["top", "dress", "bottom"],
    "vibe": ["minimalist", "contemporary", "casual", "clean", "everyday", "quiet"],
    "gender": ["women"],
    "priceRange": "budget",
    "items": ["top", "dress", "skirt", "trouser", "co-ord"],
    "about": "Indian minimalist womenswear in clean, quiet palettes — understated everyday pieces with simple elegance"
  },
  {
    "domain": "quaclothing.com",
    "name": "Qua Clothing",
    "categories": ["top", "dress", "bottom", "accessory"],
    "vibe": ["contemporary", "feminine", "casual", "everyday"],
    "gender": ["women"],
    "priceRange": "budget",
    "items": ["top", "dress", "co-ord", "skirt", "trouser"],
    "about": "Indian womenswear with contemporary everyday styles — feminine pieces for the modern Indian woman"
  },
  {
    "domain": "summersomewhere.com",
    "name": "Summer Somewhere",
    "categories": ["dress", "top", "bottom", "swimwear", "accessory"],
    "vibe": ["resort", "vacation", "tropical", "coastal", "relaxed", "summer"],
    "gender": ["women"],
    "priceRange": "mid",
    "items": ["dress", "swimsuit", "co-ord", "top", "skirt"],
    "about": "Indian resort and vacation womenswear — tropical prints, beach-ready styles, and easy holiday dressing"
  },
  {
    "domain": "thelabellife.com",
    "name": "The Label Life",
    "categories": ["top", "dress", "bottom", "outerwear", "accessory"],
    "vibe": ["contemporary", "curated", "celebrity", "minimal", "chic", "polished"],
    "gender": ["women"],
    "priceRange": "mid",
    "items": ["dress", "top", "blazer", "skirt", "co-ord", "trouser"],
    "about": "Indian curated womenswear with a celebrity-approved aesthetic — polished, contemporary pieces for the modern woman"
  },

  // ── Indian Menswear & Premium Essentials ──────────────────────────────────
  {
    "domain": "bombaishirtcompany.com",
    "name": "Bombay Shirt Company",
    "categories": ["top"],
    "vibe": ["tailored", "custom", "smart casual", "classic", "workwear", "professional"],
    "gender": ["men"],
    "priceRange": "mid",
    "items": ["shirt", "trousers", "suit", "kurta"],
    "about": "Mumbai's custom shirt brand — made-to-measure shirts in quality fabrics with personalised fit and styling"
  },
  {
    "domain": "creaturesofhabit.in",
    "name": "Creatures of Habit",
    "categories": ["top", "bottom", "accessory"],
    "vibe": ["minimal", "classic", "everyday", "relaxed", "quality basics"],
    "gender": ["men", "women"],
    "priceRange": "mid",
    "items": ["t-shirt", "sweatshirt", "trouser", "shorts", "hoodie"],
    "about": "Indian basics brand focused on quality everyday essentials — clean cuts, premium materials, and timeless design"
  },
  {
    "domain": "thepantproject.com",
    "name": "The Pant Project",
    "categories": ["bottom"],
    "vibe": ["tailored", "custom", "smart casual", "workwear", "formal", "contemporary"],
    "gender": ["men"],
    "priceRange": "mid",
    "items": ["trouser", "chino", "shorts", "cargo", "jeans"],
    "about": "Indian custom trouser brand — made-to-measure pants in varied fabrics and fits for work and weekend"
  },
  {
    "domain": "andamen.com",
    "name": "Andamen",
    "categories": ["top", "bottom", "outerwear"],
    "vibe": ["smart casual", "premium", "workwear", "classic", "contemporary", "polished"],
    "gender": ["men"],
    "priceRange": "premium",
    "items": ["shirt", "trouser", "blazer", "t-shirt", "chino"],
    "about": "Indian premium menswear with a smart-casual and professional aesthetic — quality fabrics and refined tailoring"
  },
  {
    "domain": "damensch.com",
    "name": "DaMensch",
    "categories": ["top", "bottom", "innerwear"],
    "vibe": ["basics", "premium", "everyday", "quality", "minimal", "comfortable"],
    "gender": ["men"],
    "priceRange": "mid",
    "items": ["t-shirt", "underwear", "shorts", "loungewear", "sweatshirt"],
    "about": "Indian premium basics and innerwear for men — super-combed cotton, breathable fabrics, and timeless everyday fit"
  },
  {
    "domain": "bummer.store",
    "name": "Bummer",
    "categories": ["innerwear", "bottom", "top"],
    "vibe": ["casual", "fun", "premium", "everyday", "comfortable", "playful"],
    "gender": ["men", "women"],
    "priceRange": "mid",
    "items": ["underwear", "boxers", "socks", "loungewear"],
    "about": "Indian premium underwear and loungewear — fun prints, super-soft fabrics, and exceptional everyday comfort"
  },
  {
    "domain": "thequirkbox.com",
    "name": "The Quirk Box",
    "categories": ["top", "bottom", "accessory"],
    "vibe": ["quirky", "graphic", "casual", "bold", "fun", "printed"],
    "gender": ["men"],
    "priceRange": "mid",
    "items": ["shirt", "t-shirt", "trouser", "shorts"],
    "about": "Indian menswear with personality — bold prints, quirky graphics, and fun silhouettes for the expressive dresser"
  },
  {
    "domain": "nicobar.com",
    "name": "Nicobar",
    "categories": ["top", "bottom", "dress", "accessory", "home"],
    "vibe": ["resort", "minimal", "clean", "tropical", "contemporary", "Indian luxury"],
    "gender": ["men", "women"],
    "priceRange": "mid",
    "items": ["shirt", "dress", "trouser", "kurta", "tote"],
    "about": "Indian lifestyle and fashion brand with a clean, resort-inspired aesthetic — quality fabrics and contemporary island sensibility"
  },
  {
    "domain": "aristobrat.com",
    "name": "Aristobrat",
    "categories": ["top", "bottom", "outerwear"],
    "vibe": ["streetwear", "urban", "premium", "graphic", "contemporary"],
    "gender": ["men"],
    "priceRange": "mid",
    "items": ["t-shirt", "hoodie", "jacket", "shorts", "cargo"],
    "about": "Indian premium streetwear with quality-first construction and urban graphics for the discerning young man"
  },
  {
    "domain": "perona.in",
    "name": "Perona",
    "categories": ["top", "bottom", "outerwear"],
    "vibe": ["smart casual", "contemporary", "minimal", "everyday", "relaxed"],
    "gender": ["men"],
    "priceRange": "mid",
    "items": ["shirt", "t-shirt", "trouser", "shorts", "jacket"],
    "about": "Indian contemporary menswear with clean, minimal aesthetics and relaxed smart-casual silhouettes"
  },
  {
    "domain": "kardo.in",
    "name": "Kardo",
    "categories": ["top", "bottom", "outerwear"],
    "vibe": ["minimal", "contemporary", "handloom", "natural", "Indian", "artisanal"],
    "gender": ["men", "women"],
    "priceRange": "premium",
    "items": ["shirt", "trouser", "jacket", "kurta", "co-ord"],
    "about": "Indian handloom and contemporary clothing — natural fabrics, minimal construction, and quiet artisan craftsmanship"
  },
  {
    "domain": "korra.in",
    "name": "Korra",
    "categories": ["top", "bottom", "outerwear"],
    "vibe": ["workwear", "professional", "smart casual", "minimal", "tailored"],
    "gender": ["men"],
    "priceRange": "mid",
    "items": ["shirt", "trouser", "blazer", "t-shirt", "chino"],
    "about": "Indian professional and smart-casual menswear — tailored pieces for the modern office and beyond"
  },
  {
    "domain": "rarerabbit.in",
    "name": "Rare Rabbit",
    "categories": ["top", "bottom", "outerwear", "accessory"],
    "vibe": ["smart casual", "premium", "contemporary", "European", "minimal", "polished"],
    "gender": ["men"],
    "priceRange": "mid",
    "items": ["shirt", "t-shirt", "trouser", "jacket", "blazer", "shorts"],
    "about": "Indian premium smart-casual brand with a European sensibility — quality fabrics, refined fits, and polished everyday style"
  },
  {
    "domain": "powerplayapparel.com",
    "name": "Power Play Apparel",
    "categories": ["top", "bottom", "outerwear"],
    "vibe": ["casual", "streetwear", "bold", "urban", "menswear"],
    "gender": ["men"],
    "priceRange": "budget",
    "items": ["t-shirt", "shirt", "shorts", "cargo", "hoodie"],
    "about": "Indian menswear brand with bold casual and street-influenced styles for the young urban man"
  },

  // ── Indian Activewear, Athleisure & Loungewear ────────────────────────────
  {
    "domain": "blissclub.com",
    "name": "BlissClub",
    "categories": ["activewear", "bottom", "top"],
    "vibe": ["athletic", "minimal", "premium", "comfortable", "movement", "women's sport"],
    "gender": ["women"],
    "priceRange": "mid",
    "items": ["leggings", "shorts", "sports bra", "hoodie", "t-shirt"],
    "about": "India's premium women's activewear — high-performance fabrics, inclusive sizing, and movement-first design"
  },
  {
    "domain": "zymrat.com",
    "name": "Zymrat",
    "categories": ["activewear", "top", "bottom"],
    "vibe": ["athletic", "performance", "urban", "sport", "minimal", "technical"],
    "gender": ["men", "women"],
    "priceRange": "mid",
    "items": ["leggings", "shorts", "t-shirt", "jacket", "sports bra", "jogger"],
    "about": "Indian performance activewear with technical fabrics — gym-ready athletic-urban crossover for serious training"
  },
  {
    "domain": "cavaathleisure.com",
    "name": "Cava Athleisure",
    "categories": ["activewear", "bottom", "top"],
    "vibe": ["athleisure", "casual", "comfortable", "everyday", "sport", "relaxed"],
    "gender": ["women", "men"],
    "priceRange": "mid",
    "items": ["leggings", "shorts", "top", "hoodie", "sweatshirt"],
    "about": "Indian athleisure brand blending sport and comfort for the everyday active lifestyle"
  },
  {
    "domain": "aastey.com",
    "name": "Aastey",
    "categories": ["activewear", "bottom", "top"],
    "vibe": ["sustainable", "athleisure", "minimal", "eco", "comfortable", "inclusive"],
    "gender": ["women"],
    "priceRange": "mid",
    "items": ["leggings", "shorts", "sports bra", "t-shirt", "dress"],
    "about": "Indian sustainable activewear for women — recycled fabrics, inclusive sizing, and design for all bodies"
  },
  {
    "domain": "nobero.com",
    "name": "Nobero",
    "categories": ["activewear", "bottom", "top"],
    "vibe": ["athletic", "urban", "streetwear", "sport", "modern", "functional"],
    "gender": ["men", "women"],
    "priceRange": "mid",
    "items": ["shorts", "t-shirt", "jogger", "jacket", "leggings"],
    "about": "Indian sport and athleisure brand combining athletic function with street-ready design for active urban lifestyles"
  },
  {
    "domain": "kicaactive.com",
    "name": "Kica Active",
    "categories": ["activewear", "bottom", "top"],
    "vibe": ["athletic", "feminine", "performance", "comfortable", "sport", "yoga"],
    "gender": ["women"],
    "priceRange": "mid",
    "items": ["leggings", "shorts", "sports bra", "tank", "jacket"],
    "about": "Indian women's activewear with feminine aesthetics and performance materials for yoga, gym, and active life"
  },
  {
    "domain": "aestheticbodies.com",
    "name": "Aesthetic Bodies",
    "categories": ["activewear", "top", "bottom"],
    "vibe": ["athletic", "aesthetic", "gym", "performance", "fitted"],
    "gender": ["men", "women"],
    "priceRange": "mid",
    "items": ["t-shirt", "shorts", "leggings", "sports bra", "jogger"],
    "about": "Indian fitness apparel brand with an aesthetic-first approach — form-fitting, performance-driven activewear for the gym"
  },
  {
    "domain": "silvertraq.com",
    "name": "Silvertraq",
    "categories": ["activewear", "top", "bottom", "footwear"],
    "vibe": ["athletic", "performance", "sport", "technical", "running"],
    "gender": ["men", "women"],
    "priceRange": "mid",
    "items": ["t-shirt", "shorts", "leggings", "jacket", "sneaker"],
    "about": "Indian performance activewear and footwear for serious athletes — technical fabrics and sport-first design"
  },
  {
    "domain": "prakritifashion.com",
    "name": "Prakriti",
    "categories": ["activewear", "top", "bottom"],
    "vibe": ["yoga", "wellness", "sustainable", "comfortable", "natural", "mindful"],
    "gender": ["women"],
    "priceRange": "mid",
    "items": ["leggings", "top", "shorts", "yoga wear"],
    "about": "Indian yoga and wellness activewear with a mindful, natural approach — sustainable fabrics for movement and wellbeing"
  },
  {
    "domain": "hummel.in",
    "name": "Hummel India",
    "categories": ["activewear", "top", "bottom", "footwear", "accessory"],
    "vibe": ["sport", "athletic", "retro", "Scandinavian", "team sport"],
    "gender": ["men", "women"],
    "priceRange": "mid",
    "items": ["t-shirt", "shorts", "track jacket", "sneaker", "football kit"],
    "about": "Danish sportswear brand's Indian presence — Scandinavian athletic heritage with team sport and lifestyle collections"
  },
  {
    "domain": "cultsport.com",
    "name": "Cultsport",
    "categories": ["activewear", "footwear", "top", "bottom"],
    "vibe": ["athletic", "sport", "performance", "Indian", "everyday", "affordable"],
    "gender": ["men", "women"],
    "priceRange": "budget",
    "items": ["t-shirt", "shorts", "jogger", "sneaker", "leggings"],
    "about": "Indian fitness apparel and footwear by Cult.fit — performance-ready activewear for everyday training at accessible prices"
  },
  {
    "domain": "versatyl.com",
    "name": "Versatyl",
    "categories": ["activewear", "top", "bottom", "outerwear"],
    "vibe": ["technical", "outdoor", "adventure", "functional", "gorpcore", "utility"],
    "gender": ["men", "women"],
    "priceRange": "mid",
    "items": ["jacket", "shorts", "t-shirt", "cargo", "base layer"],
    "about": "Indian technical outdoor and adventure apparel — functional, durable gear for trails, travel, and active exploration"
  },
  {
    "domain": "prolinefitnessworld.com",
    "name": "Proline",
    "categories": ["activewear", "top", "bottom"],
    "vibe": ["athletic", "sport", "retro", "classic", "everyday"],
    "gender": ["men", "women"],
    "priceRange": "budget",
    "items": ["t-shirt", "shorts", "track pant", "jacket"],
    "about": "Classic Indian sportswear brand with athletic staples — reliable performance wear at accessible everyday prices"
  },
  {
    "domain": "unstoppableapparel.com",
    "name": "Unstoppable Apparel",
    "categories": ["activewear", "top", "bottom"],
    "vibe": ["gym", "athletic", "performance", "bold", "motivational"],
    "gender": ["men", "women"],
    "priceRange": "mid",
    "items": ["t-shirt", "shorts", "jogger", "tank", "hoodie"],
    "about": "Indian gym and training apparel with performance fabrics and bold athletic design for motivated movers"
  },
  {
    "domain": "aligne.co",
    "name": "Aligne",
    "categories": ["top","bottom","dress","outerwear"],
    "vibe": ["contemporary","minimalist","everyday","tailored"],
    "gender": ["women"],
    "priceRange": "mid",
    "items": ["blazer","trousers","knit dress","shirt","coat"],
    "about": "London contemporary womenswear — considered tailoring and elevated everyday staples"
  },
  {
    "domain": "asket.com",
    "name": "ASKET",
    "categories": ["top","bottom","outerwear"],
    "vibe": ["minimalist","sustainable","everyday","quiet-luxury"],
    "gender": ["men"],
    "priceRange": "premium",
    "items": ["t-shirt","oxford shirt","merino sweater","chino","jeans"],
    "about": "Permanent-collection menswear in pursuit of the perfect wardrobe essentials, made transparently"
  },
  {
    "domain": "bandofoutsiders.com",
    "name": "Band of Outsiders",
    "categories": ["top","bottom","outerwear","accessory"],
    "vibe": ["contemporary","minimalist","preppy"],
    "gender": ["men","women"],
    "priceRange": "premium",
    "items": ["shirt","blazer","trousers","tee","knit"],
    "about": "Reimagined preppy tailoring with a clean, modern sensibility"
  },
  {
    "domain": "cutsclothing.com",
    "name": "Cuts",
    "categories": ["top","bottom"],
    "vibe": ["minimalist","everyday","active","contemporary"],
    "gender": ["men"],
    "priceRange": "mid",
    "items": ["t-shirt","polo","hoodie","jogger","henley"],
    "about": "Elevated everyday basics with a refined athletic fit and technical cotton"
  },
  {
    "domain": "damsonmadder.com",
    "name": "Damson Madder",
    "categories": ["dress","top","bottom","outerwear"],
    "vibe": ["contemporary","bohemian","maximalist","sustainable"],
    "gender": ["women"],
    "priceRange": "mid",
    "items": ["dress","jeans","blouse","knit","jacket"],
    "about": "Playful, conscious London womenswear with print, volume and vintage spirit"
  },
  {
    "domain": "districtvision.com",
    "name": "District Vision",
    "categories": ["top","bottom","accessory","outerwear"],
    "vibe": ["active","minimalist","outdoor","performance"],
    "gender": ["men","women"],
    "priceRange": "premium",
    "items": ["running tee","shorts","sunglasses","jacket","tights"],
    "about": "Mindful running and movement apparel with performance eyewear, calm and functional"
  },
  {
    "domain": "djerfavenue.com",
    "name": "Djerf Avenue",
    "categories": ["top","bottom","dress","outerwear"],
    "vibe": ["contemporary","everyday","coastal","feminine"],
    "gender": ["women"],
    "priceRange": "mid",
    "items": ["blazer","trousers","knit","dress","shirt"],
    "about": "Inclusive, feel-good Scandinavian womenswear built on confidence and everyday glamour"
  },
  {
    "domain": "folkclothing.com",
    "name": "Folk",
    "categories": ["top","bottom","outerwear"],
    "vibe": ["minimalist","casual","contemporary","heritage-workwear"],
    "gender": ["men","women"],
    "priceRange": "premium",
    "items": ["shirt","trousers","overshirt","knit","jacket"],
    "about": "British design-led label — considered cuts, tactile fabrics and quiet detail"
  },
  {
    "domain": "frankandoak.com",
    "name": "Frank And Oak",
    "categories": ["top","bottom","outerwear","footwear"],
    "vibe": ["casual","sustainable","minimalist","everyday"],
    "gender": ["men","women"],
    "priceRange": "mid",
    "items": ["flannel shirt","denim","sweater","chino","parka"],
    "about": "Canadian everyday essentials made sustainably for modern city life"
  },
  {
    "domain": "houseofsunny.co.uk",
    "name": "House of Sunny",
    "categories": ["dress","top","bottom","outerwear"],
    "vibe": ["contemporary","maximalist","streetwear","resort"],
    "gender": ["women"],
    "priceRange": "mid",
    "items": ["knit dress","trousers","top","coat","jacket"],
    "about": "London cult label — sculptural knits and statement seasonal pieces"
  },
  {
    "domain": "kitristudio.com",
    "name": "Kitri",
    "categories": ["dress","top","bottom","outerwear"],
    "vibe": ["contemporary","feminine","maximalist","occasion"],
    "gender": ["women"],
    "priceRange": "mid",
    "items": ["dress","blouse","skirt","knit","blazer"],
    "about": "London womenswear with print, colour and a distinctive feminine point of view"
  },
  {
    "domain": "meandem.com",
    "name": "ME+EM",
    "categories": ["top","bottom","dress","outerwear"],
    "vibe": ["contemporary","minimalist","tailored","quiet-luxury"],
    "gender": ["women"],
    "priceRange": "premium",
    "items": ["trousers","shirt","dress","knit","blazer"],
    "about": "British womenswear engineering flattering, functional pieces that last"
  },
  {
    "domain": "ministryofsupply.com",
    "name": "Ministry of Supply",
    "categories": ["top","bottom","outerwear"],
    "vibe": ["minimalist","active","performance","formal"],
    "gender": ["men","women"],
    "priceRange": "premium",
    "items": ["dress shirt","blazer","trousers","polo","tee"],
    "about": "Performance professional wear engineered with technical, comfortable fabrics"
  },
  {
    "domain": "mizzenandmain.com",
    "name": "Mizzen+Main",
    "categories": ["top","bottom","outerwear"],
    "vibe": ["formal","active","performance","everyday"],
    "gender": ["men"],
    "priceRange": "premium",
    "items": ["dress shirt","polo","trousers","henley","blazer"],
    "about": "Performance menswear — dress shirts and tailoring in stretch, breathable fabric"
  },
  {
    "domain": "mottandbow.com",
    "name": "Mott & Bow",
    "categories": ["bottom","top","outerwear"],
    "vibe": ["denim","everyday","minimalist","casual"],
    "gender": ["men","women"],
    "priceRange": "mid",
    "items": ["jeans","tee","jacket","shirt","shorts"],
    "about": "NYC denim specialists — premium-fit jeans and soft everyday basics"
  },
  {
    "domain": "nanushka.com",
    "name": "Nanushka",
    "categories": ["top","bottom","dress","outerwear"],
    "vibe": ["contemporary","minimalist","luxury","resort"],
    "gender": ["men","women"],
    "priceRange": "luxury",
    "items": ["vegan leather jacket","dress","trousers","knit","shirt"],
    "about": "Budapest house of modern bohemian luxury, known for vegan leather and fluid tailoring"
  },
  {
    "domain": "nnnormal.com",
    "name": "NNormal",
    "categories": ["footwear","top","bottom","accessory"],
    "vibe": ["outdoor","active","performance","minimalist"],
    "gender": ["men","women"],
    "priceRange": "premium",
    "items": ["trail shoe","tee","shorts","jacket","cap"],
    "about": "Kilian Jornet's outdoor brand — durable, low-impact trail and mountain gear"
  },
  {
    "domain": "nobodyschild.com",
    "name": "Nobody's Child",
    "categories": ["dress","top","bottom","outerwear"],
    "vibe": ["contemporary","sustainable","feminine","everyday"],
    "gender": ["women"],
    "priceRange": "budget",
    "items": ["dress","blouse","skirt","jumpsuit","blazer"],
    "about": "London sustainable womenswear — feminine, responsible everyday style"
  },
  {
    "domain": "norse-store.com",
    "name": "Norse Projects",
    "categories": ["top","bottom","outerwear","footwear","accessory"],
    "vibe": ["minimalist","casual","heritage-workwear","contemporary"],
    "gender": ["men","women"],
    "priceRange": "premium",
    "items": ["shirt","trousers","jacket","knit","cap"],
    "about": "Scandinavian utility-meets-design — clean, functional everyday menswear and more"
  },
  {
    "domain": "oliversapparel.com",
    "name": "Olivers Apparel",
    "categories": ["top","bottom","outerwear"],
    "vibe": ["active","minimalist","performance","everyday"],
    "gender": ["men"],
    "priceRange": "premium",
    "items": ["shorts","tee","jogger","trousers","jacket"],
    "about": "Versatile performance menswear that moves from workout to everyday"
  },
  {
    "domain": "onia.com",
    "name": "Onia",
    "categories": ["swimwear","top","bottom","outerwear"],
    "vibe": ["coastal","resort","minimalist","contemporary"],
    "gender": ["men","women"],
    "priceRange": "premium",
    "items": ["swim trunks","bikini","linen shirt","dress","tee"],
    "about": "New York resort and swim label built for the water and warm-weather ease"
  },
  {
    "domain": "organicbasics.com",
    "name": "Organic Basics",
    "categories": ["underwear","top","bottom"],
    "vibe": ["minimalist","sustainable","organic","everyday"],
    "gender": ["men","women"],
    "priceRange": "mid",
    "items": ["briefs","t-shirt","socks","bralette","sweater"],
    "about": "Copenhagen sustainable basics — underwear and essentials in responsible fabrics"
  },
  {
    "domain": "percivalclo.com",
    "name": "Percival",
    "categories": ["top","bottom","outerwear"],
    "vibe": ["contemporary","casual","preppy","heritage-workwear"],
    "gender": ["men"],
    "priceRange": "premium",
    "items": ["overshirt","knit","trousers","tee","jacket"],
    "about": "London menswear with wit — characterful knits, shirts and easy tailoring"
  },
  {
    "domain": "public-rec.com",
    "name": "Public Rec",
    "categories": ["bottom","top","outerwear"],
    "vibe": ["active","everyday","minimalist","casual"],
    "gender": ["men","women"],
    "priceRange": "premium",
    "items": ["jogger","trousers","hoodie","tee","polo"],
    "about": "All-day comfort apparel — refined joggers and elevated leisure staples"
  },
  {
    "domain": "realisationpar.com",
    "name": "Réalisation Par",
    "categories": ["dress","top","bottom"],
    "vibe": ["resort","feminine","contemporary","bohemian"],
    "gender": ["women"],
    "priceRange": "mid",
    "items": ["slip dress","skirt","top","midi dress","trousers"],
    "about": "Cult slip dresses and print-led pieces with a sun-soaked, vintage femininity"
  },
  {
    "domain": "rhone.com",
    "name": "Rhone",
    "categories": ["top","bottom","outerwear"],
    "vibe": ["active","performance","minimalist","everyday"],
    "gender": ["men"],
    "priceRange": "premium",
    "items": ["training tee","jogger","polo","shorts","commuter trousers"],
    "about": "Premium men's performance apparel for training and the workday alike"
  },
  {
    "domain": "rowingblazers.com",
    "name": "Rowing Blazers",
    "categories": ["top","bottom","outerwear","accessory"],
    "vibe": ["preppy","maximalist","heritage","contemporary"],
    "gender": ["men","women"],
    "priceRange": "premium",
    "items": ["rugby shirt","blazer","knit","polo","trousers"],
    "about": "Subversive preppy classics — rugbys, blazers and bold heritage style"
  },
  {
    "domain": "satisfyrunning.com",
    "name": "Satisfy",
    "categories": ["top","bottom","outerwear","accessory"],
    "vibe": ["active","performance","streetwear","outdoor"],
    "gender": ["men","women"],
    "priceRange": "luxury",
    "items": ["running tee","shorts","jacket","tights","cap"],
    "about": "High-performance running gear with a distinctive, technical streetwear edge"
  },
  {
    "domain": "saturdaysnyc.com",
    "name": "Saturdays NYC",
    "categories": ["top","bottom","outerwear","accessory"],
    "vibe": ["casual","minimalist","coastal","contemporary"],
    "gender": ["men"],
    "priceRange": "premium",
    "items": ["shirt","tee","trousers","jacket","knit"],
    "about": "New York surf-meets-design menswear — relaxed, considered everyday style"
  },
  {
    "domain": "sezane.com",
    "name": "Sézane",
    "categories": ["top","bottom","dress","outerwear","accessory"],
    "vibe": ["contemporary","feminine","heritage","quiet-luxury"],
    "gender": ["women"],
    "priceRange": "premium",
    "items": ["blouse","knit","dress","trousers","coat"],
    "about": "Parisian womenswear — timeless French elegance made responsibly"
  },
  {
    "domain": "staud.clothing",
    "name": "STAUD",
    "categories": ["dress","top","bottom","accessory","outerwear"],
    "vibe": ["contemporary","feminine","maximalist","resort"],
    "gender": ["women"],
    "priceRange": "premium",
    "items": ["dress","knit","skirt","bag","top"],
    "about": "LA womenswear blending elevated ease with playful, statement design"
  },
  {
    "domain": "thereformation.com",
    "name": "Reformation",
    "categories": ["dress","top","bottom","outerwear"],
    "vibe": ["contemporary","sustainable","feminine","resort"],
    "gender": ["women"],
    "priceRange": "premium",
    "items": ["dress","jeans","blouse","skirt","knit"],
    "about": "LA label of effortless, sustainable femininity — slip dresses and vintage-inspired cuts"
  },
  {
    "domain": "toddsnyder.com",
    "name": "Todd Snyder",
    "categories": ["top","bottom","outerwear","footwear","accessory"],
    "vibe": ["heritage-workwear","contemporary","preppy","tailored"],
    "gender": ["men"],
    "priceRange": "premium",
    "items": ["blazer","oxford shirt","trousers","knit","jacket"],
    "about": "New York menswear — refined American tailoring with heritage sensibility"
  },
  {
    "domain": "universalworks.co.uk",
    "name": "Universal Works",
    "categories": ["top","bottom","outerwear"],
    "vibe": ["heritage-workwear","casual","minimalist","contemporary"],
    "gender": ["men","women"],
    "priceRange": "premium",
    "items": ["bakers jacket","trousers","overshirt","knit","tee"],
    "about": "Nottingham label of relaxed, utilitarian design rooted in workwear and craft"
  },
  {
    "domain": "vuoriclothing.com",
    "name": "Vuori",
    "categories": ["top","bottom","outerwear"],
    "vibe": ["active","everyday","coastal","performance"],
    "gender": ["men","women"],
    "priceRange": "premium",
    "items": ["jogger","tee","hoodie","shorts","leggings"],
    "about": "California performance apparel inspired by coastal living and movement"
  },
  {
    "domain": "wearpact.com",
    "name": "Pact",
    "categories": ["top","bottom","underwear"],
    "vibe": ["organic","sustainable","everyday","minimalist"],
    "gender": ["men","women"],
    "priceRange": "budget",
    "items": ["t-shirt","underwear","leggings","socks","dress"],
    "about": "Organic-cotton everyday basics made fair-trade and softly sustainable"
  },
  {
    "domain": "westernrise.com",
    "name": "Western Rise",
    "categories": ["top","bottom","outerwear"],
    "vibe": ["minimalist","active","performance","outdoor"],
    "gender": ["men"],
    "priceRange": "premium",
    "items": ["tech trousers","button-down","tee","jacket","polo"],
    "about": "Versatile technical menswear built to travel light and perform anywhere"
  },
  {
    "domain": "withjean.com",
    "name": "With Jéan",
    "categories": ["dress","top","bottom"],
    "vibe": ["feminine","resort","contemporary","romantic"],
    "gender": ["women"],
    "priceRange": "mid",
    "items": ["dress","top","skirt","set","blouse"],
    "about": "Australian label of romantic, feminine dresses and occasion-ready pieces"
  },
  {
    "domain": "wythe.com",
    "name": "Wythe",
    "categories": ["top","bottom","outerwear","accessory"],
    "vibe": ["heritage-workwear","casual","contemporary","preppy"],
    "gender": ["men"],
    "priceRange": "premium",
    "items": ["camp shirt","flannel","trousers","knit","cap"],
    "about": "New York heritage menswear — vintage-rooted American sportswear and workwear"
  },
  {
    "domain": "bewakoof.com",
    "name": "Bewakoof",
    "categories": ["top","bottom","outerwear","accessory"],
    "vibe": ["casual","streetwear","everyday","quirky"],
    "gender": ["men","women"],
    "priceRange": "budget",
    "items": ["graphic tee","oversized tee","joggers","hoodie","shirt"],
    "about": "Indian pop-culture label — affordable graphic tees, oversized fits and everyday casualwear"
  },
  {
    "domain": "bhaane.com",
    "name": "Bhaane",
    "categories": ["top","bottom","outerwear","dress"],
    "vibe": ["contemporary","minimalist","casual","indie"],
    "gender": ["men","women"],
    "priceRange": "premium",
    "items": ["shirt","trousers","dress","jacket","tee"],
    "about": "New Delhi contemporary label — easy, design-led separates with an understated cool"
  },
  {
    "domain": "bummer.in",
    "name": "Bummer",
    "categories": ["innerwear","top","bottom"],
    "vibe": ["everyday","casual","cozy","quirky"],
    "gender": ["men","women"],
    "priceRange": "budget",
    "items": ["boxers","briefs","loungewear","tee","co-ord"],
    "about": "India's fun innerwear and loungewear brand — soft micromodal basics in bold prints"
  },
  {
    "domain": "campussutra.com",
    "name": "Campus Sutra",
    "categories": ["top","bottom","outerwear"],
    "vibe": ["casual","active","streetwear","everyday"],
    "gender": ["men","women"],
    "priceRange": "budget",
    "items": ["t-shirt","jacket","shirt","joggers","sweatshirt"],
    "about": "Affordable Indian casualwear — everyday tees, jackets and athleisure for young India"
  },
  {
    "domain": "doodlage.in",
    "name": "Doodlage",
    "categories": ["dress","top","bottom","outerwear"],
    "vibe": ["sustainable","contemporary","organic","ethnic"],
    "gender": ["women"],
    "priceRange": "premium",
    "items": ["dress","shirt","co-ord","skirt","jacket"],
    "about": "New Delhi sustainable label upcycling factory waste into modern, conscious womenswear"
  },
  {
    "domain": "dressfolk.com",
    "name": "Dressfolk",
    "categories": ["dress","top","bottom"],
    "vibe": ["ethnic","heritage","organic","minimalist"],
    "gender": ["women"],
    "priceRange": "premium",
    "items": ["handloom saree","kurta","dress","co-ord","top"],
    "about": "Handloom-forward Indian label celebrating indigenous weaves in modern silhouettes"
  },
  {
    "domain": "faballey.com",
    "name": "FabAlley",
    "categories": ["dress","top","bottom","outerwear"],
    "vibe": ["contemporary","formal","everyday","feminine"],
    "gender": ["women"],
    "priceRange": "mid",
    "items": ["dress","jumpsuit","blazer","top","co-ord"],
    "about": "Indian contemporary womenswear — workwear, party and everyday edits with a fashion-forward edge"
  },
  {
    "domain": "fabnest.in",
    "name": "Fabnest",
    "categories": ["dress","top","bottom"],
    "vibe": ["contemporary","everyday","feminine","casual"],
    "gender": ["women"],
    "priceRange": "budget",
    "items": ["dress","co-ord","top","skirt","jumpsuit"],
    "about": "Affordable Indian womenswear — breezy dresses and co-ords for everyday and occasion"
  },
  {
    "domain": "kharakapas.com",
    "name": "Khara Kapas",
    "categories": ["dress","top","bottom"],
    "vibe": ["organic","minimalist","ethnic","heritage"],
    "gender": ["women"],
    "priceRange": "premium",
    "items": ["cotton dress","kurta","skirt","co-ord","top"],
    "about": "Indian slow-fashion label working in pure cottons with timeless, handcrafted ease"
  },
  {
    "domain": "kica.in",
    "name": "KICA",
    "categories": ["activewear","top","bottom"],
    "vibe": ["active","seamless","everyday","performance"],
    "gender": ["women"],
    "priceRange": "mid",
    "items": ["leggings","sports bra","tank","joggers","tee"],
    "about": "Indian activewear for women — supportive, second-skin pieces for movement and rest"
  },
  {
    "domain": "libas.in",
    "name": "Libas",
    "categories": ["dress","top","bottom"],
    "vibe": ["ethnic","contemporary","everyday","feminine"],
    "gender": ["women"],
    "priceRange": "mid",
    "items": ["kurta set","suit","kurta","dress","co-ord"],
    "about": "Leading Indian ethnicwear brand — kurtas, suits and fusion pieces for every occasion"
  },
  {
    "domain": "littleboxindia.com",
    "name": "Little Box India",
    "categories": ["dress","top","bottom"],
    "vibe": ["casual","everyday","feminine","contemporary"],
    "gender": ["women"],
    "priceRange": "budget",
    "items": ["dress","top","co-ord","jumpsuit","skirt"],
    "about": "Affordable Indian womenswear — trend-led dresses and casuals for the everyday wardrobe"
  },
  {
    "domain": "newme.asia",
    "name": "Newme",
    "categories": ["dress","top","bottom","outerwear"],
    "vibe": ["contemporary","streetwear","everyday","feminine"],
    "gender": ["women"],
    "priceRange": "budget",
    "items": ["dress","top","co-ord","jeans","jacket"],
    "about": "Fast-moving Indian womenswear label translating runway trends into accessible everyday style"
  },
  {
    "domain": "okhai.org",
    "name": "Okhai",
    "categories": ["dress","top","bottom","accessory"],
    "vibe": ["ethnic","organic","heritage","artisan"],
    "gender": ["women"],
    "priceRange": "mid",
    "items": ["hand-embroidered dress","kurta","top","jacket","co-ord"],
    "about": "Artisan-led Indian label of hand-embroidered, handcrafted pieces supporting rural craftswomen"
  },
  {
    "domain": "snitch.com",
    "name": "Snitch",
    "categories": ["top","bottom","outerwear"],
    "vibe": ["streetwear","contemporary","trend","casual"],
    "gender": ["men"],
    "priceRange": "mid",
    "items": ["shirt","t-shirt","trousers","jacket","co-ord"],
    "about": "Fast-fashion Indian menswear — trend-driven shirts, tees and tailoring for young men"
  },
  {
    "domain": "suvasa.in",
    "name": "Suvasa",
    "categories": ["dress","top","bottom"],
    "vibe": ["ethnic","heritage","organic","everyday"],
    "gender": ["women"],
    "priceRange": "mid",
    "items": ["hand-block kurta","dress","co-ord","top","suit"],
    "about": "Indian label of hand-block-printed cottons — everyday ethnic with traditional craft"
  },
  {
    "domain": "thesouledstore.com",
    "name": "The Souled Store",
    "categories": ["top","bottom","outerwear","accessory"],
    "vibe": ["streetwear","casual","quirky","everyday"],
    "gender": ["men","women"],
    "priceRange": "budget",
    "items": ["graphic tee","oversized tee","hoodie","joggers","shirt"],
    "about": "India's pop-culture merch and casualwear brand — licensed graphics, oversized tees and fun basics"
  },
  {
    "domain": "thesummerhouse.in",
    "name": "The Summer House",
    "categories": ["dress","top","bottom"],
    "vibe": ["sustainable","minimalist","contemporary","resort"],
    "gender": ["women"],
    "priceRange": "premium",
    "items": ["dress","co-ord","top","trousers","skirt"],
    "about": "Bengaluru sustainable label of fluid, easy resortwear in natural, responsible fabrics"
  },
  {
    "domain": "tjori.com",
    "name": "Tjori",
    "categories": ["dress","top","bottom","accessory"],
    "vibe": ["ethnic","heritage","organic","feminine"],
    "gender": ["women"],
    "priceRange": "mid",
    "items": ["kurta","dress","co-ord","suit","top"],
    "about": "Indian heritage-meets-wellness label — handcrafted ethnicwear rooted in natural fabrics"
  },
  {
    "domain": "urbanofashion.com",
    "name": "Urbano Fashion",
    "categories": ["bottom","top","outerwear"],
    "vibe": ["denim","casual","streetwear","everyday"],
    "gender": ["men"],
    "priceRange": "budget",
    "items": ["jeans","cargo","t-shirt","shirt","joggers"],
    "about": "Indian denim and casual menswear — jeans, cargos and everyday street staples"
  },
  {
    "domain": "veirdo.in",
    "name": "Veirdo",
    "categories": ["top","bottom","outerwear"],
    "vibe": ["streetwear","casual","quirky","everyday"],
    "gender": ["men","women"],
    "priceRange": "budget",
    "items": ["oversized tee","graphic tee","shirt","joggers","hoodie"],
    "about": "Indian streetwear label — oversized graphic tees and easy everyday casuals"
  },
  {
    "domain": "anubhutee.com",
    "name": "Anubhutee",
    "categories": ["dress","top","bottom"],
    "vibe": ["ethnic","contemporary","feminine","everyday"],
    "gender": ["women"],
    "priceRange": "budget",
    "items": ["kurta set","kurta","dress","co-ord","suit"],
    "about": "Indian ethnicwear label — printed kurtas, suits and fusion sets for everyday and festive wear"
  },
  {
    "domain": "baccabucci.com",
    "name": "Bacca Bucci",
    "categories": ["footwear","accessory"],
    "vibe": ["streetwear","casual","sport","everyday"],
    "gender": ["men"],
    "priceRange": "mid",
    "items": ["sneakers","boots","slides","loafers","sandals"],
    "about": "Indian men's footwear brand — chunky sneakers, boots and street-ready styles"
  },
  {
    "domain": "bluorng.com",
    "name": "Bluorng",
    "categories": ["top","bottom","outerwear"],
    "vibe": ["streetwear","contemporary","bold","casual"],
    "gender": ["men","women"],
    "priceRange": "mid",
    "items": ["graphic tee","sweatshirt","cargo","shirt","jacket"],
    "about": "New Delhi streetwear label blending Indian motifs with global street culture"
  },
  {
    "domain": "boldfit.in",
    "name": "Boldfit",
    "categories": ["activewear","top","bottom","accessory"],
    "vibe": ["active","workout","performance","sport"],
    "gender": ["men","women"],
    "priceRange": "budget",
    "items": ["gym tee","joggers","sports bra","shorts","tank"],
    "about": "Indian fitness brand — performance gymwear and training gear for everyday athletes"
  },
  {
    "domain": "dennislingo.com",
    "name": "Dennis Lingo",
    "categories": ["top","bottom","outerwear"],
    "vibe": ["casual","everyday","streetwear","contemporary"],
    "gender": ["men"],
    "priceRange": "budget",
    "items": ["shirt","t-shirt","jacket","trousers","sweatshirt"],
    "about": "Indian men's casualwear — shirts, tees and layering staples for the everyday wardrobe"
  },
  {
    "domain": "hubberholme.com",
    "name": "Hubberholme",
    "categories": ["top","bottom","outerwear"],
    "vibe": ["casual","contemporary","everyday","minimalist"],
    "gender": ["men"],
    "priceRange": "mid",
    "items": ["shirt","t-shirt","trousers","jacket","polo"],
    "about": "Indian menswear label of clean, contemporary casuals and easy tailoring"
  },
  {
    "domain": "indya.com",
    "name": "Indya",
    "categories": ["dress","top","bottom","accessory"],
    "vibe": ["ethnic","contemporary","feminine","resort"],
    "gender": ["women"],
    "priceRange": "mid",
    "items": ["kurta","fusion dress","drape saree","co-ord","lehenga"],
    "about": "Indian fusion-wear brand — modern ethnic and indo-western pieces for celebrations"
  },
  {
    "domain": "jaipurkurti.com",
    "name": "Jaipur Kurti",
    "categories": ["dress","top","bottom"],
    "vibe": ["ethnic","heritage","everyday","feminine"],
    "gender": ["women"],
    "priceRange": "budget",
    "items": ["kurta","kurta set","dress","palazzo","co-ord"],
    "about": "Jaipur-rooted ethnicwear — block-print kurtas and easy Indian everyday staples"
  },
  {
    "domain": "jodilife.com",
    "name": "Jodi",
    "categories": ["dress","top","bottom"],
    "vibe": ["maximalist","quirky","artistic","resort"],
    "gender": ["women"],
    "priceRange": "premium",
    "items": ["printed dress","co-ord","kaftan","top","skirt"],
    "about": "Indian label of joyful, print-led pieces — playful botanical and folk-art prints"
  },
  {
    "domain": "kalkifashion.com",
    "name": "Kalki Fashion",
    "categories": ["dress","top","bottom","accessory"],
    "vibe": ["ethnic","formal","heritage","occasion"],
    "gender": ["women"],
    "priceRange": "premium",
    "items": ["lehenga","saree","gown","anarkali","suit"],
    "about": "Indian occasion-wear house — lehengas, sarees and couture-inspired festive dressing"
  },
  {
    "domain": "ketch.in",
    "name": "Ketch",
    "categories": ["top","bottom","outerwear"],
    "vibe": ["casual","streetwear","trend","everyday"],
    "gender": ["men"],
    "priceRange": "budget",
    "items": ["t-shirt","shirt","joggers","jacket","co-ord"],
    "about": "Affordable Indian menswear — trend-led tees, shirts and street casuals"
  },
  {
    "domain": "neemans.com",
    "name": "Neeman's",
    "categories": ["footwear"],
    "vibe": ["sustainable","minimalist","everyday","casual"],
    "gender": ["men","women"],
    "priceRange": "mid",
    "items": ["wool sneakers","slip-ons","loafers","sliders","trainers"],
    "about": "Indian sustainable footwear made from merino wool and natural materials"
  },
  {
    "domain": "rustorange.com",
    "name": "Rust Orange",
    "categories": ["dress","top","bottom"],
    "vibe": ["contemporary","casual","feminine","everyday"],
    "gender": ["women"],
    "priceRange": "budget",
    "items": ["dress","co-ord","top","jumpsuit","skirt"],
    "about": "Indian womenswear — easy dresses and co-ords in soft prints for everyday style"
  },
  {
    "domain": "sassafras.in",
    "name": "SASSAFRAS",
    "categories": ["dress","top","bottom","outerwear"],
    "vibe": ["contemporary","streetwear","trend","feminine"],
    "gender": ["women"],
    "priceRange": "budget",
    "items": ["dress","top","jeans","co-ord","blazer"],
    "about": "Indian western-wear brand — fashion-forward tops, dresses and denim for young women"
  },
  {
    "domain": "soch.com",
    "name": "Soch",
    "categories": ["dress","top","bottom"],
    "vibe": ["ethnic","heritage","feminine","occasion"],
    "gender": ["women"],
    "priceRange": "mid",
    "items": ["saree","kurta set","kurta","lehenga","gown"],
    "about": "Indian ethnicwear brand — sarees, suits and festive pieces in vibrant prints and weaves"
  },
  {
    "domain": "solethreads.com",
    "name": "Sole Threads",
    "categories": ["footwear","accessory"],
    "vibe": ["casual","everyday","coastal","sport"],
    "gender": ["men","women"],
    "priceRange": "budget",
    "items": ["flip-flops","sliders","sneakers","clogs","sandals"],
    "about": "Indian everyday footwear — fun flip-flops, sliders and casual slip-ons"
  },
  {
    "domain": "tistabene.com",
    "name": "Tistabene",
    "categories": ["accessory","top","bottom"],
    "vibe": ["ethnic","contemporary","casual","everyday"],
    "gender": ["men","women"],
    "priceRange": "budget",
    "items": ["pocket square","jacket","kurta","stole","tie"],
    "about": "Indian label of menswear accessories and fusion ethnic pieces"
  },
  {
    "domain": "tokyotalkies.com",
    "name": "Tokyo Talkies",
    "categories": ["dress","top","bottom","outerwear"],
    "vibe": ["contemporary","streetwear","trend","feminine"],
    "gender": ["women"],
    "priceRange": "budget",
    "items": ["top","dress","jeans","co-ord","jacket"],
    "about": "Indian western-wear brand — on-trend tops, denim and dresses for everyday fashion"
  },
  {
    "domain": "yoho.in",
    "name": "YOHO",
    "categories": ["footwear","accessory"],
    "vibe": ["casual","streetwear","everyday","sport"],
    "gender": ["men"],
    "priceRange": "mid",
    "items": ["sneakers","loafers","boots","slides","sandals"],
    "about": "Indian men's footwear brand — comfort-led sneakers, loafers and casual styles"
  },
  {
    "domain": "proyog.com",
    "name": "Proyog",
    "categories": ["activewear","top","bottom"],
    "vibe": ["active","organic","sustainable","seamless"],
    "gender": ["women","men"],
    "priceRange": "premium",
    "items": ["yoga leggings","organic tee","bra top","shorts","joggers"],
    "about": "Indian organic yogawear made from natural fibres for movement and ease"
  },
  {
    "domain": "studiomedium.in",
    "name": "Studio Medium",
    "categories": ["dress","top","bottom"],
    "vibe": ["indian-ethnic","handcrafted","sustainable","contemporary"],
    "gender": ["women"],
    "priceRange": "premium",
    "items": ["dress","co-ord set","top","trouser"],
    "about": "New Delhi handwoven, resist-dyed sustainable womenswear at the intersection of craft and art"
  },
  {
    "domain": "ofrida.com",
    "name": "Ofrida",
    "categories": ["dress","top","bottom"],
    "vibe": ["contemporary","artistic","sustainable"],
    "gender": ["women"],
    "priceRange": "mid",
    "items": ["dress","top","trouser"],
    "about": "Noida womenswear blending hand-painted abstract art with sustainable fashion"
  },
  {
    "domain": "banithni.com",
    "name": "Banithni",
    "categories": ["dress","top","bottom"],
    "vibe": ["indian-ethnic","everyday"],
    "gender": ["women"],
    "priceRange": "budget",
    "items": ["kurti","kurta set","dress"],
    "about": "Jaipur affordable women's ethnic and cotton apparel"
  },
  {
    "domain": "dayandage.in",
    "name": "Day & Age",
    "categories": ["top","bottom","dress"],
    "vibe": ["contemporary","sustainable","quirky"],
    "gender": ["women"],
    "priceRange": "mid",
    "items": ["top","bottom","dress"],
    "about": "Jaipur slow-design label crafting vintage-fabric and current-season garments"
  },
  {
    "domain": "escapebyaishwarya.com",
    "name": "Escape by Aishwarya",
    "categories": ["dress","top","bottom","accessory"],
    "vibe": ["contemporary","minimalist","modern-indian"],
    "gender": ["women"],
    "priceRange": "premium",
    "items": ["dress","top","jumpsuit","co-ord set"],
    "about": "Contemporary womenswear for the modern Indian woman — chic dresses, coords and jumpsuits"
  },
  {
    "domain": "pashaindia.com",
    "name": "Pasha India",
    "categories": ["top","bottom","dress"],
    "vibe": ["indian-ethnic","contemporary","print"],
    "gender": ["women"],
    "priceRange": "mid",
    "items": ["kurta set","saree","lehenga","jumpsuit","kaftan"],
    "about": "Print-led contemporary Indian womenswear with bold prints and simple silhouettes"
  },
  {
    "domain": "oodeypore.in",
    "name": "Oodeypore",
    "categories": ["top","bottom","dress"],
    "vibe": ["indian-ethnic","handcrafted","heritage"],
    "gender": ["women"],
    "priceRange": "mid",
    "items": ["kurta set","dress","co-ord set"],
    "about": "Udaipur label using traditional hand-printing and modal fabrics, stitched by village artisans"
  },
  {
    "domain": "asmishop.in",
    "name": "Asmi",
    "categories": ["dress","top","bottom","outerwear"],
    "vibe": ["sustainable","contemporary","minimalist","handcrafted"],
    "gender": ["women"],
    "priceRange": "premium",
    "items": ["dress","tunic","co-ord set","jacket","lehenga","saree"],
    "about": "Asmi by Mayank Modi — sustainable designer womenswear in organic Chanderi and silk"
  },
  {
    "domain": "masoomm.com",
    "name": "Masoomm",
    "categories": ["dress","top","bottom"],
    "vibe": ["feminine","floral","artisanal","indo-western"],
    "gender": ["women"],
    "priceRange": "mid",
    "items": ["dress","maxi dress","suit set","co-ord set"],
    "about": "Jaipur brand crafting soft feminine floral-embroidered dresses and suits"
  },
  {
    "domain": "houseofdesigners.in",
    "name": "House of Designers",
    "categories": ["top","bottom","dress","jewelry","accessory"],
    "vibe": ["designer","contemporary","curated"],
    "gender": ["women","men"],
    "priceRange": "premium",
    "items": ["shirt","dress","kurta","jewellery"],
    "about": "Multi-designer marketplace curating Indian designer womenswear, jewellery and accessories"
  },
  {
    "domain": "seedstore.co.in",
    "name": "Seedstore",
    "categories": ["top","bottom","accessory"],
    "vibe": ["streetwear","quirky","casual"],
    "gender": ["women","men"],
    "priceRange": "budget",
    "items": ["cargo","trouser","tee","cap","shorts"],
    "about": "Mumbai unconventional apparel — quirky tees, caps and cargos at accessible prices"
  },
  {
    "domain": "fardaclothing.com",
    "name": "Farda",
    "categories": ["top","bottom","outerwear"],
    "vibe": ["streetwear","utility","contemporary"],
    "gender": ["women","men"],
    "priceRange": "premium",
    "items": ["cargo","jacket","tee","shorts"],
    "about": "Unisex high-street streetwear making utility cargos, jackets and oversized tees"
  },
  {
    "domain": "kardo.co",
    "name": "Kardo",
    "categories": ["top","bottom","outerwear"],
    "vibe": ["heritage","artisanal","contemporary","workwear"],
    "gender": ["men"],
    "priceRange": "premium",
    "items": ["shirt","trouser","jacket"],
    "about": "Delhi slow-fashion menswear handcrafting shirts, trousers and jackets from Indian craft textiles"
  },
  {
    "domain": "bombaim.in",
    "name": "Bombaim",
    "categories": ["dress","top","bottom","jewelry","accessory"],
    "vibe": ["luxury","designer","heritage"],
    "gender": ["women"],
    "priceRange": "luxury",
    "items": ["dress","kurta set","lehenga","co-ord set","jewellery"],
    "about": "Multi-designer luxury house for Indian womenswear pret, occasion and bridal"
  },
  {
    "domain": "bluebrew.in",
    "name": "Bluebrew",
    "categories": ["top","bottom"],
    "vibe": ["streetwear","denim","casual"],
    "gender": ["women","men"],
    "priceRange": "mid",
    "items": ["jeans","tee","shorts","skirt"],
    "about": "Made-in-India denim and streetwear with better fits and fabrics for Indians"
  },
  {
    "domain": "anitadongre.com",
    "name": "Anita Dongre",
    "categories": ["dress","top","bottom","jewelry"],
    "vibe": ["indian-ethnic","luxury","bridal"],
    "gender": ["women","men"],
    "priceRange": "luxury",
    "items": ["lehenga","saree","anarkali","sherwani"],
    "about": "Celebrated Indian luxury couture house — bridal lehengas, handcrafted pret and menswear"
  },
  {
    "domain": "ornatejewels.com",
    "name": "Ornate Jewels",
    "categories": ["jewelry"],
    "vibe": ["fine-jewelry","luxury","everyday"],
    "gender": ["women"],
    "priceRange": "premium",
    "items": ["ring","earring","necklace","bracelet"],
    "about": "Factory-to-consumer 925 silver and gemstone fine jewellery — everyday luxury"
  },
  {
    "domain": "johargram.co.in",
    "name": "Johargram",
    "categories": ["top","bottom","outerwear","accessory"],
    "vibe": ["sustainable","streetwear","indian-ethnic"],
    "gender": ["women","men"],
    "priceRange": "mid",
    "items": ["co-ord set","trench coat","shawl","stole"],
    "about": "Ranchi sustainable streetwear reviving Jharkhand tribal textiles and handlooms"
  },
  {
    "domain": "twamev.com",
    "name": "Twamev",
    "categories": ["top","bottom","outerwear","dress"],
    "vibe": ["indian-ethnic","luxury","wedding"],
    "gender": ["men","women"],
    "priceRange": "luxury",
    "items": ["kurta set","sherwani","nehru jacket","lehenga"],
    "about": "Luxury Indian occasion and wedding wear blending heritage with modern tailoring"
  }
];

// ── Brand directory ───────────────────────────────────────────────────────────
// Display name for every registry domain. New entries already carry an inline
// `name`; this map backfills the human-facing name for the rest. It powers
// brand-specific search ("show me shirts from Allbirds") and the "From {brand}"
// label, and is the single place to keep brand names in sync with the registry.
export const BRAND_NAMES: Record<string, string> = {
  "anubhutee.com": "Anubhutee",
  "baccabucci.com": "Bacca Bucci",
  "bluorng.com": "Bluorng",
  "boldfit.in": "Boldfit",
  "dennislingo.com": "Dennis Lingo",
  "hubberholme.com": "Hubberholme",
  "indya.com": "Indya",
  "jaipurkurti.com": "Jaipur Kurti",
  "jodilife.com": "Jodi",
  "kalkifashion.com": "Kalki Fashion",
  "ketch.in": "Ketch",
  "neemans.com": "Neeman's",
  "rustorange.com": "Rust Orange",
  "sassafras.in": "SASSAFRAS",
  "soch.com": "Soch",
  "solethreads.com": "Sole Threads",
  "tistabene.com": "Tistabene",
  "tokyotalkies.com": "Tokyo Talkies",
  "yoho.in": "YOHO",
  "proyog.com": "Proyog",
  "bewakoof.com": "Bewakoof",
  "bhaane.com": "Bhaane",
  "bummer.in": "Bummer",
  "campussutra.com": "Campus Sutra",
  "doodlage.in": "Doodlage",
  "dressfolk.com": "Dressfolk",
  "faballey.com": "FabAlley",
  "fabnest.in": "Fabnest",
  "kharakapas.com": "Khara Kapas",
  "kica.in": "KICA",
  "libas.in": "Libas",
  "littleboxindia.com": "Little Box India",
  "newme.asia": "Newme",
  "okhai.org": "Okhai",
  "snitch.com": "Snitch",
  "suvasa.in": "Suvasa",
  "thesouledstore.com": "The Souled Store",
  "thesummerhouse.in": "The Summer House",
  "tjori.com": "Tjori",
  "urbanofashion.com": "Urbano Fashion",
  "veirdo.in": "Veirdo",
  "aligne.co": "Aligne",
  "asket.com": "ASKET",
  "bandofoutsiders.com": "Band of Outsiders",
  "cutsclothing.com": "Cuts",
  "damsonmadder.com": "Damson Madder",
  "districtvision.com": "District Vision",
  "djerfavenue.com": "Djerf Avenue",
  "folkclothing.com": "Folk",
  "frankandoak.com": "Frank And Oak",
  "houseofsunny.co.uk": "House of Sunny",
  "kitristudio.com": "Kitri",
  "meandem.com": "ME+EM",
  "ministryofsupply.com": "Ministry of Supply",
  "mizzenandmain.com": "Mizzen+Main",
  "mottandbow.com": "Mott & Bow",
  "nanushka.com": "Nanushka",
  "nnnormal.com": "NNormal",
  "nobodyschild.com": "Nobody's Child",
  "norse-store.com": "Norse Projects",
  "oliversapparel.com": "Olivers Apparel",
  "onia.com": "Onia",
  "organicbasics.com": "Organic Basics",
  "percivalclo.com": "Percival",
  "public-rec.com": "Public Rec",
  "realisationpar.com": "Réalisation Par",
  "rhone.com": "Rhone",
  "rowingblazers.com": "Rowing Blazers",
  "satisfyrunning.com": "Satisfy",
  "saturdaysnyc.com": "Saturdays NYC",
  "sezane.com": "Sézane",
  "staud.clothing": "STAUD",
  "thereformation.com": "Reformation",
  "toddsnyder.com": "Todd Snyder",
  "universalworks.co.uk": "Universal Works",
  "vuoriclothing.com": "Vuori",
  "wearpact.com": "Pact",
  "westernrise.com": "Western Rise",
  "withjean.com": "With Jéan",
  "wythe.com": "Wythe",
  "gymsharkusa.myshopify.com": "Gymshark",
  "skimsbody.myshopify.com": "SKIMS",
  "aloyoga.com": "Alo Yoga",
  "kith.com": "Kith",
  "fashionnova.com": "Fashion Nova",
  "allbirds.com": "Allbirds",
  "taylorstitch.com": "Taylor Stitch",
  "marinelayer.com": "Marine Layer",
  "bombas.myshopify.com": "Bombas",
  "chubbies.myshopify.com": "Chubbies",
  "goodamerican.com": "Good American",
  "faherty.myshopify.com": "Faherty Brand",
  "pangaia.com": "Pangaia",
  "spanx-com.myshopify.com": "Spanx",
  "outdoorvoices.com": "Outdoor Voices",
  "toa.st": "Toast",
  "backalleybodega.com": "Back Alley Bodega",
  "dissh.com.au": "DISSH",
  "porterjames.com": "Porter James",
  "caseycasey.eu": "Casey Casey",
  "luroq.com": "Luroq London",
  "luso.com.pk": "LUSO",
  "effelements.in": "Eff",
  "favrics.com": "FAVRICS",
  "fromherman.com": "Herman",
  "loomforma.com": "LoomForma",
  "pegador.com": "Pegador",
  "commas.cc": "Commas",
  "finaldraftclo.com": "Final Draft",
  "wearneutralground.com": "Neutral Ground",
  "sweatscollective.com": "SWEATS",
  "gentag.store": "gentag",
  "antifragilecompany.in": "AntiFragile",
  "itsashirt.gr": "It's A Shirt",
  "circolo1901.it": "Circolo 1901",
  "limited-clothing.co.uk": "Limited",
  "laurenmanoogian.com": "Lauren Manoogian",
  "borderlineofficial.com": "Borderline",
  "stosi.in": "Stosi",
  "studiopeterjohn.com": "Peter John",
  "lacorsia.co": "La Corsia",
  "commonleisureweb.com": "Common Leisure",
  "ladywhiteco.com": "Lady White",
  "slvrlake.myshopify.com": "SLVRLAKE",
  "studionicholson.com": "Studio Nicholson",
  "haruhar.com": "Haru Har",
  "coverchord.com": "Coverchord",
  "lionessfashion.com": "Lioness Fashion",
  "and-daughter.com": "&Daughter",
  "vahro.in": "Vahro",
  "desiminimals.com": "Desi Minimals",
  "lovepangolin.com": "Love Pangolin",
  "chapter2drip.com": "Chapter 2",
  "friendswithfrank.com": "Friends with Frank",
  "shop-crowd.com": "CROWD",
  "assemblylabel.com": "Assembly Label",
  "solacetheory.com": "Solace Theory",
  "hemblanks.com": "HemBlanks",
  "yurofficial.com": "YUR",
  "theruesociety.com": "The Rue Society",
  "malverra.com": "Malverra",
  "myfriendjoni.com": "myfriendjoni",
  "kartikresearch.com": "Kartik Research",
  "ceucle.com": "Ceucle",
  "pariya.in": "Pariya",
  "aimeleondore.com": "Aime Leon Dore",
  "hommeyusa.myshopify.com": "Hommey",
  "primulaveri.com": "Primulaveri",
  "elkacollective.com": "Elka Collective",
  "selectedhomme.in": "Selected India",
  "rarabarefoot.in": "Rara Bare Foot",
  "maisonx.in": "Maison X",
  "elvntee.in": "Elvn Tee",
  "wearbrun.com": "Brun",
  "wearloqo.com": "Loqo",
  "theminimalcloset.in": "The Minimal Closet",
  "sleepscientist.in": "Sleep Scientist",
  "urbanmonkey.com": "Urban Monkey",
  "wearcomet.com": "Comet",
  "milkandwhisky.in": "Milk&Whisky",
  "pepeinner.com": "Innerwear by Pepe",
  "monkstory.com": "Monk Story",
  "stooky.in": "Stooky",
  "senso.myshopify.com": "Senso",
  "tezzo.in": "Tezzo",
  "andreanthony.co.id": "Andre Anthony",
  "shopdozo.com": "Dozo",
  "thekiots.com": "Kiots",
  "urbansocks.in": "Urban Socks",
  "hzyclo.com": "Hzy",
  "lamastore.in": "Lama Store",
  "xyxxcrew.com": "XYXX Crew",
  "biancajeswant.com": "Bianca Jeswant",
  "saphed.com": "Saphed",
  "theater.xyz": "Theater",
  "asos.myshopify.com": "Asos",
  "biasedblack.com": "Biased Black",
  "thebearhouse.com": "The Bear House",
  "kairo.store": "Kairo Store",
  "harlanholden.ph": "Harlan Holden",
  "kaicollections.com": "Kai Collections",
  "musclemind.com": "Muscle Mind",
  "ballerathletik.com": "Baller Athletik",
  "jeffs.myshopify.com": "Jeff's",
  "moderaegy.myshopify.com": "Modera",
  "ludic.life": "Ludic",
  "doodledept.com": "Doodle Dept",
  "thestylevault.ae": "The Style Vault",
  "classymastour.fr": "Classy Mastour",
  "theforbiddenfruit.in": "The Forbidden Fruit",
  "koa.com.pk": "Koa",
  "botnia.in": "Botnia",
  "orr.store": "Orr",
  "oldlinenmill.com": "Old Linen Mill",
  "asslcollectionparis.com": "Assl Collection Paris",
  "shopnirvanaa.com": "Nirvanaa",
  "bamboovogue.in": "Bamboo Vogue",
  "mugasa.co.in": "Mugasa",
  "lunaco.in": "Lunaco",
  "daxuen.com": "Daxuen",
  "wtflex.in": "What The Flex",
  "surmaye.com": "Surmaye",
  "thedeer.in": "The Deer",
  "themusk.in": "The Musk India",
  "oziss.in": "Oziss",
  "whipped.store": "Whipped",
  "gangafashions.com": "Ganga",
  "dushaamai.com": "Dusha Amai",
  "lininworld.com": "Linin",
  "themisnomer.com": "The Misnomer",
  "vanshitaaz.in": "Vanshitaaz",
  "sergebasics.com": "Serge",
  "bayek.fr": "Bayek",
  "coteleparis.com": "Cotele Paris",
  "mariniclothing.com": "Marini",
  "almostgods.com": "Almost Gods",
  "11-11.in": "11.11",
  "shopunrush.com": "Unrush",
  "kissagoi.com": "Kissa Goi",
  "ikaibyraginiahuja.com": "Ikai",
  "sofiedhoore.be": "Sofie D'Hoore",
  "bysera.zid.store": "SERA",
  "aritzia.com": "Aritzia",
  "slowsteadyclub.com": "SlowSteadyClub",
  "bananaclub.co.in": "Banana Club",
  "bohemegoods.com": "BOHEME",
  "turnblack.in": "Turn Black",
  "jucca.it": "Jucca",
  "camper.com": "Camper",
  "menspoem.in": "Men's Poem",
  "atpco.it": "AT.P.CO",
  "marksandspencer.in": "Marks & Spencer",
  "offonclothing.com": "Offon",
  "thatie.ru": "Thatie",
  "pertestore.ru": "Perte",
  "sensclothing.com": "Sens",
  "herbyh.design": "Her by H",
  "ekke.co": "Ekke",
  "amoslook.com": "Amos Look",
  "studiodoe.cc": "Studio Doe",
  "noconcept.ru": "No Concept",
  "mimpikita.com.my": "Kita&Co",
  "jhoola.com.tr": "Jhoola",
  "dirtymanners.com": "Dirty Manners",
  "towards.website": "Toward(s)",
  "blueowl.us": "Blue Owl",
  "morrisonshop.com": "Morrison",
  "payalkhandwala.com": "Payal Khandwala",
  "dashanddot.com": "Dast & Dot",
  "azaadclo.com": "Azaad",
  "ourlegacy.com": "Our Legacy",
  "harah.in": "Harah",
  "houseofmasaba.com": "House of Masaba",
  // Indian Streetwear & Casual
  "snitch.co.in": "SNITCH",
  "thehouseofrare.com": "The House of Rare",
  "bonkerscorner.com": "Bonkers Corner",
  "redwolf.in": "Redwolf",
  "theindiangarageco.com": "The Indian Garage Co.",
  "beyoung.in": "Beyoung",
  "bombaytrooper.com": "Bombay Trooper",
  "powerlook.in": "Powerlook",
  "franklywearing.com": "Frankly Wearing",
  "mydesignation.in": "Mydesignation",
  "styched.com": "Styched",
  "whatwhenwear.com": "What When Wear",
  "marchtee.in": "March Tee",
  "fullyfilmy.in": "Fully Filmy",
  "wyoindia.com": "WYO",
  "burgerbae.com": "BurgerBae",
  // Indian Ethnic, Fusion & Heritage
  "suta.in": "Suta",
  "aachho.com": "Aachho",
  "jaypore.com": "Jaypore",
  "koskii.com": "Koskii",
  "houseofchikankari.com": "House of Chikankari",
  "karagiri.com": "Karagiri",
  "itokri.com": "iTokri",
  "gulaalclothes.com": "Gulaal",
  "ambraee.com": "Ambraee",
  "bunaai.com": "Bunaai",
  "roopkala.com": "Roopkala",
  "janasya.com": "Janasya",
  "truebrowns.com": "TrueBrowns",
  "theloom.in": "The Loom",
  "labelkanupriya.com": "Label Kanupriya",
  "chidiyaa.com": "Chidiyaa",
  "okhai.com": "Okhai",
  "bunai.com": "Bunai",
  "faridagupta.com": "Farida Gupta",
  "suvasa.com": "Suvasa",
  "mulmul.com": "Mulmul",
  // Indian Western & Contemporary Womenswear
  "fablestreet.com": "FableStreet",
  "femella.in": "Femella",
  "twentydresses.com": "Twenty Dresses",
  "letsdressup.com": "LetsDressUp",
  "newme.in": "NEWME",
  "slikk.in": "Slikk",
  "freakins.com": "Freakins",
  "tokyotalkies.in": "Tokyo Talkies",
  "berrylush.com": "Berrylush",
  "madglame.com": "MadGlame",
  "luluandsky.com": "Lulu & Sky",
  "coverstory.in": "Cover Story",
  "saltattire.com": "Salt Attire",
  "quaclothing.com": "Qua Clothing",
  "summersomewhere.com": "Summer Somewhere",
  "thelabellife.com": "The Label Life",
  // Indian Menswear & Premium Essentials
  "bombaishirtcompany.com": "Bombay Shirt Company",
  "creaturesofhabit.in": "Creatures of Habit",
  "thepantproject.com": "The Pant Project",
  "andamen.com": "Andamen",
  "damensch.com": "DaMensch",
  "bummer.store": "Bummer",
  "thequirkbox.com": "The Quirk Box",
  "nicobar.com": "Nicobar",
  "aristobrat.com": "Aristobrat",
  "perona.in": "Perona",
  "kardo.in": "Kardo",
  "korra.in": "Korra",
  "rarerabbit.in": "Rare Rabbit",
  "powerplayapparel.com": "Power Play Apparel",
  // Indian Activewear, Athleisure & Loungewear
  "blissclub.com": "BlissClub",
  "zymrat.com": "Zymrat",
  "cavaathleisure.com": "Cava Athleisure",
  "aastey.com": "Aastey",
  "nobero.com": "Nobero",
  "kicaactive.com": "Kica Active",
  "aestheticbodies.com": "Aesthetic Bodies",
  "silvertraq.com": "Silvertraq",
  "prakritifashion.com": "Prakriti",
  "hummel.in": "Hummel India",
  "cultsport.com": "Cultsport",
  "versatyl.com": "Versatyl",
  "prolinefitnessworld.com": "Proline",
  "unstoppableapparel.com": "Unstoppable Apparel",
};

// Reduce a domain to a comparable brand token, e.g.
// "gymsharkusa.myshopify.com" -> "gymsharkusa", "wearbrun.com" -> "brun".
// Kept in sync with cleanBrandName() in GlobalCatalogService.
export function cleanBrandToken(domain: string): string {
  if (!domain) return "";
  let c = domain.toLowerCase().trim();
  c = c.replace(/^(https?:\/\/)?(www\.)?/, "").split("/")[0];
  if (c.includes(".myshopify.com")) {
    const parts = c.replace(/\.myshopify\.com$/, "").split(".");
    c = parts[parts.length - 1];
  } else {
    const parts = c.split(".");
    const tlds = new Set(["com", "co", "uk", "org", "net", "store", "in", "us", "ca", "au", "io", "website", "me", "ph", "ae", "fr", "eu", "gr", "it", "id", "xyz", "cc", "be", "pk", "tr", "my", "ru", "design", "life"]);
    const nonTlds = parts.filter(p => !tlds.has(p));
    c = nonTlds.length > 0 ? nonTlds[nonTlds.length - 1] : parts[0];
  }
  c = c.replace(/[\-_]/g, "");
  c = c.replace(/^(shop|weare|the|buy|get|official|studio|wear)/i, "");
  c = c.replace(/(shop|store|clothing|brand|official|studio|wear|collective|denim)$/i, "");
  return c;
}

/** Human-facing brand name for a store profile. */
export function brandDisplayName(p: StoreProfile): string {
  return p.name || BRAND_NAMES[p.domain] || cleanBrandToken(p.domain);
}

// ── Category taxonomy ───────────────────────────────────────────────────────────
// Brands are tagged with flat top-level categories (top, bottom, dress, …). This
// taxonomy expands each one into the subcategories and sub-sub item types it covers,
// so the AI understands the full structure of what each brand can sell and can map a
// user's request ("oxford shirt", "selvedge denim", "chelsea boots") to the right
// brands and a clean, specific searchQuery.
export const CATEGORY_TAXONOMY: Record<string, { label: string; subcategories: Record<string, string[]> }> = {
  top: {
    label: "Tops",
    subcategories: {
      "shirts": ["oxford shirt", "linen shirt", "flannel", "button-down", "overshirt", "camp collar shirt"],
      "t-shirts & tees": ["crew neck tee", "v-neck tee", "graphic tee", "pocket tee", "long-sleeve tee", "ringer tee"],
      "polos & henleys": ["polo", "henley", "rugby shirt"],
      "blouses & tops": ["blouse", "tank top", "camisole", "crop top", "bodysuit", "tube top"],
      "knitwear": ["sweater", "jumper", "turtleneck", "cardigan", "knit polo", "roll-neck", "mock-neck", "crew-neck knit", "chunky knit", "merino sweater", "cashmere cardigan"],
    },
  },
  bottom: {
    label: "Bottoms",
    subcategories: {
      "trousers & pants": ["chinos", "dress pants", "cargo pants", "wide-leg trousers", "pleated trousers", "tailored trouser", "linen trouser", "tweed trouser", "leather trouser", "culottes"],
      "jeans & denim": ["slim jeans", "straight jeans", "wide jeans", "selvedge denim", "baggy jeans"],
      "shorts": ["chino shorts", "denim shorts", "athletic shorts", "linen shorts"],
      "skirts": ["mini skirt", "midi skirt", "maxi skirt", "pleated skirt", "denim skirt"],
      "activewear bottoms": ["leggings", "joggers", "sweatpants", "track pants", "bike shorts"],
    },
  },
  dress: {
    label: "Dresses & One-Pieces",
    subcategories: {
      "dresses": ["mini dress", "midi dress", "maxi dress", "slip dress", "shirt dress", "wrap dress"],
      "jumpsuits & rompers": ["jumpsuit", "romper", "playsuit"],
      "ethnic & occasion": ["gown", "kurta", "saree", "lehenga", "co-ord set"],
    },
  },
  outerwear: {
    label: "Outerwear",
    subcategories: {
      "jackets": ["denim jacket", "bomber", "trucker jacket", "field jacket", "windbreaker", "harrington"],
      "coats": ["overcoat", "trench coat", "wool coat", "parka", "puffer", "raincoat"],
      "blazers & suiting": ["blazer", "sport coat", "suit", "waistcoat"],
      "suits & formal": ["two-piece suit", "three-piece suit", "tuxedo", "waistcoat", "suit jacket"],
      "sweatshirts": ["hoodie", "crewneck sweatshirt", "zip-up", "quarter-zip"],
      "vests": ["gilet", "puffer vest", "fleece vest"],
    },
  },
  footwear: {
    label: "Footwear",
    subcategories: {
      "sneakers": ["low-top", "high-top", "runners", "trainers", "court sneakers"],
      "boots": ["chelsea boots", "chukka", "work boots", "ankle boots", "combat boots"],
      "formal shoes": ["loafers", "derbies", "oxfords", "monk straps", "brogues"],
      "sandals & slides": ["sandals", "slides", "espadrilles", "mules"],
    },
  },
  underwear: {
    label: "Underwear, Loungewear & Socks",
    subcategories: {
      "underwear": ["boxers", "briefs", "trunks", "bralette", "panties"],
      "loungewear & sleepwear": ["pajamas", "robe", "loungewear set", "nightwear"],
      "shapewear": ["shapewear", "bodysuit", "smoothing brief"],
      "socks & hosiery": ["socks", "no-show socks", "tights", "stockings"],
    },
  },
  accessory: {
    label: "Accessories",
    subcategories: {
      "bags": ["tote", "backpack", "crossbody", "weekender", "wallet", "belt bag", "handbag", "clutch", "shoulder bag", "bucket bag", "mini bag", "duffle bag", "messenger bag"],
      "headwear": ["cap", "beanie", "bucket hat", "wide-brim hat"],
      "small accessories": ["belt", "scarf", "gloves", "sunglasses", "tie"],
      "jewelry": ["necklace", "bracelet", "ring", "earrings"],
    },
  },
  swimwear: {
    label: "Swimwear & Beach",
    subcategories: {
      "swimwear": ["bikini", "one-piece", "swimsuit", "swim trunks", "board shorts", "rash guard"],
      "beach cover-ups": ["sarong", "kaftan", "beach shirt", "cover-up dress"],
    },
  },
  jewellery: {
    label: "Jewellery & Fine Accessories",
    subcategories: {
      "fine jewellery": ["gold necklace", "pearl earrings", "diamond ring", "bracelet", "anklet"],
      "fashion jewellery": ["hoop earrings", "stud earrings", "chain necklace", "cuff bracelet", "ring set"],
      "watches": ["watch", "smartwatch"],
    },
  },
  apparel: {
    label: "General Apparel (full range)",
    subcategories: {
      "mixed": ["tops", "bottoms", "outerwear", "accessories"],
    },
  },
};

// ── Geo-ranking ─────────────────────────────────────────────────────────────────
// Maps country codes to broad regions for tiered proximity boost.

export const GEO_REGIONS: Record<string, string> = {
  // South Asia
  IN: 'SA', PK: 'SA', BD: 'SA', LK: 'SA', NP: 'SA',
  // North America
  US: 'NA', CA: 'NA', MX: 'NA',
  // Europe
  GB: 'EU', FR: 'EU', IT: 'EU', DE: 'EU', NL: 'EU', BE: 'EU', SE: 'EU',
  DK: 'EU', ES: 'EU', PT: 'EU', CH: 'EU', NO: 'EU', FI: 'EU', PL: 'EU',
  AT: 'EU', GR: 'EU', RU: 'EU', IE: 'EU',
  // Oceania
  AU: 'OC', NZ: 'OC',
  // Southeast Asia
  ID: 'SEA', MY: 'SEA', PH: 'SEA', SG: 'SEA', TH: 'SEA', VN: 'SEA',
  // East Asia
  CN: 'EA', JP: 'EA', KR: 'EA', TW: 'EA', HK: 'EA',
  // Middle East
  AE: 'ME', SA: 'ME', QA: 'ME', KW: 'ME', TR: 'ME',
}

// Country overrides for brands whose TLD doesn't reveal their origin.
// Covers Indian brands on .com, Australian labels, European brands, etc.
const STORE_COUNTRIES: Record<string, string> = {
  // ── Indian brands on .com ──
  'houseofmasaba.com': 'IN', 'payalkhandwala.com': 'IN', 'jaypore.com': 'IN',
  'koskii.com': 'IN', 'gulaalclothes.com': 'IN', 'ambraee.com': 'IN',
  'bunaai.com': 'IN', 'truebrowns.com': 'IN', 'chidiyaa.com': 'IN',
  'okhai.com': 'IN', 'faridagupta.com': 'IN', 'mulmul.com': 'IN',
  'fablestreet.com': 'IN', 'berrylush.com': 'IN', 'twentydresses.com': 'IN',
  'thelabellife.com': 'IN', 'letsdressup.com': 'IN', 'madglame.com': 'IN',
  'luluandsky.com': 'IN', 'nicobar.com': 'IN', 'andamen.com': 'IN',
  'damensch.com': 'IN', 'thequirkbox.com': 'IN', 'aristobrat.com': 'IN',
  'blissclub.com': 'IN', 'zymrat.com': 'IN', 'aastey.com': 'IN',
  'nobero.com': 'IN', 'kicaactive.com': 'IN', 'aestheticbodies.com': 'IN',
  'silvertraq.com': 'IN', 'cultsport.com': 'IN', 'versatyl.com': 'IN',
  'unstoppableapparel.com': 'IN', 'prolinefitnessworld.com': 'IN',
  'bonkerscorner.com': 'IN', 'thehouseofrare.com': 'IN',
  'theindiangarageco.com': 'IN', 'franklywearing.com': 'IN',
  'whatwhenwear.com': 'IN', 'styched.com': 'IN', 'burgerbae.com': 'IN',
  'freakins.com': 'IN', 'summersomewhere.com': 'IN', 'saltattire.com': 'IN',
  'quaclothing.com': 'IN', 'bombaishirtcompany.com': 'IN',
  'thepantproject.com': 'IN', 'powerplayapparel.com': 'IN',
  'desiminimals.com': 'IN', 'haruhar.com': 'IN',
  'kissagoi.com': 'IN', 'gangafashions.com': 'IN', 'shopnirvanaa.com': 'IN',
  'biasedblack.com': 'IN', 'chapter2drip.com': 'IN', 'monkstory.com': 'IN',
  'ikaibyraginiahuja.com': 'IN', 'lovepangolin.com': 'IN',
  'wearloqo.com': 'IN', 'wearbrun.com': 'IN', 'kartikresearch.com': 'IN',
  'wearcomet.com': 'IN', 'surmaye.com': 'IN', 'dushaamai.com': 'IN',
  'oldlilenmill.com': 'IN', 'almostgods.com': 'IN', 'femella.in': 'IN',
  '11-11.in': 'IN', 'shopunrush.com': 'IN', 'biancajeswant.com': 'IN',
  'suvasa.com': 'IN', 'roopkala.com': 'IN', 'janasya.com': 'IN',
  'theloom.in': 'IN', 'bunai.com': 'IN', 'labelkanupriya.com': 'IN',
  'prakritifashion.com': 'IN', 'itokri.com': 'IN', 'aachho.com': 'IN',
  'themusk.in': 'IN', 'lininworld.com': 'IN', 'themisnomer.com': 'IN',
  // ── Australian brands on .com ──
  'assemblylabel.com': 'AU', 'friendswithfrank.com': 'AU', 'morrisonshop.com': 'AU',
  'commas.cc': 'AU', 'lionessfashion.com': 'AU', 'elkacollective.com': 'AU',
  'hommeyusa.myshopify.com': 'AU', 'theruesociety.com': 'AU',
  'myfriendjoni.com': 'AU', 'porterjames.com': 'AU', 'commonleisureweb.com': 'AU',
  'solacetheory.com': 'AU',
  // ── Japanese brands on .com/.jp (origin Japan — dropped from the roster; a
  //    US/Canadian brand that merely USES Japanese fabric is NOT tagged here) ──
  'coverchord.com': 'JP', 'momotaro-jeans.com': 'JP', 'chupsocks.com': 'JP',
  'purebluejapan.jp': 'JP',
  // ── European brands on .com ──
  'ourlegacy.com': 'SE', 'studionicholson.com': 'GB', 'toa.st': 'GB',
  'and-daughter.com': 'GB', 'pangaia.com': 'GB', 'luroq.com': 'GB',
  'limited-clothing.co.uk': 'GB', 'asslcollectionparis.com': 'FR',
  'coteleparis.com': 'FR', 'mariniclothing.com': 'IT',
  // ── US brands (explicitly tagged to avoid any TLD ambiguity) ──
  'aimeleondore.com': 'US', 'ladywhiteco.com': 'US', 'laurenmanoogian.com': 'US',
  'taylorstitch.com': 'US', 'marinelayer.com': 'US', 'outdoorvoices.com': 'US',
  'allbirds.com': 'US', 'fashionnova.com': 'US', 'kith.com': 'US',
  'aloyoga.com': 'US', 'goodamerican.com': 'US',
  // ── Indian brands on .com/.co (TLD doesn't reveal country) ──
  'ofrida.com': 'IN', 'banithni.com': 'IN', 'escapebyaishwarya.com': 'IN',
  'pashaindia.com': 'IN', 'masoomm.com': 'IN',
  'fardaclothing.com': 'IN', 'kardo.co': 'IN', 'anitadongre.com': 'IN',
  'ornatejewels.com': 'IN', 'twamev.com': 'IN',
}

/** Return the ISO-3166-1 alpha-2 country code for a store domain. */
export function getStoreCountry(domain: string): string {
  const d = domain.toLowerCase().replace(/^www\./, '')
  if (STORE_COUNTRIES[d]) return STORE_COUNTRIES[d]
  if (d.endsWith('.in') || d.endsWith('.co.in')) return 'IN'
  if (d.endsWith('.co.uk') || d.endsWith('.org.uk') || d.endsWith('.uk')) return 'GB'
  if (d.endsWith('.com.au') || d.endsWith('.net.au')) return 'AU'
  if (d.endsWith('.ca')) return 'CA'
  if (d.endsWith('.jp') || d.endsWith('.co.jp')) return 'JP'
  if (d.endsWith('.fr')) return 'FR'
  if (d.endsWith('.it')) return 'IT'
  if (d.endsWith('.de')) return 'DE'
  if (d.endsWith('.nl')) return 'NL'
  if (d.endsWith('.be')) return 'BE'
  if (d.endsWith('.gr')) return 'GR'
  if (d.endsWith('.ru')) return 'RU'
  if (d.endsWith('.pk')) return 'PK'
  if (d.endsWith('.id')) return 'ID'
  if (d.endsWith('.ph')) return 'PH'
  if (d.endsWith('.com.my') || d.endsWith('.my')) return 'MY'
  if (d.endsWith('.com.tr') || d.endsWith('.tr')) return 'TR'
  if (d.endsWith('.ae') || d.endsWith('.com.ae')) return 'AE'
  if (d.endsWith('.zid.store')) return 'AE'  // Zid is a Saudi/Gulf e-commerce platform
  return 'US'  // default for .com / .myshopify.com
}

// Discern's live roster is US + Europe + India + Australia only — every other
// market (Japan and the rest of East Asia, SE Asia, the Middle East, the rest
// of South Asia) is dropped entirely. Classification uses the getStoreCountry signal the
// app's own geo-boost scoring relies on (not a fresh guess at each brand's
// origin), so it's exactly as reliable as that existing, already-audited
// mapping; "Europe" is any country whose GEO_REGIONS entry is 'EU'. Every
// consumer imports UCP_REGISTRY (this filtered constant), never
// UCP_REGISTRY_ALL, so search, the featured feed, brand detection, and the
// brand-health cron all stay within these three markets with no other change.
const KEPT_COUNTRIES = new Set(['US', 'IN', 'AU'])
export const UCP_REGISTRY: StoreProfile[] = UCP_REGISTRY_ALL.filter(s => {
  const cc = getStoreCountry(s.domain)
  return KEPT_COUNTRIES.has(cc) || GEO_REGIONS[cc] === 'EU'
})

// ── Best / featured brands ──────────────────────────────────────────────────────
// Hand-picked icons: the most respected, design-forward names in the roster. These
// lead the featured rails and get the strongest quality bias in search ranking.
export const ICON_BRANDS = new Set<string>([
  'ourlegacy.com', 'studionicholson.com', 'aimeleondore.com', 'fearofgod.com',
  'elder-statesman.com', 'toteme-studio.com', 'casablancaparis.com', 'norseprojects.com',
  'johnelliott.com', 'ganni.com', 'veja-store.com', 'kith.com', 'taylorstitch.com',
  'pangaia.com', '3sixteen.com', 'nudiejeans.com',
  'citizensofhumanity.com', 'agolde.com', 'thefrankieshop.com', 'mejuri.com',
  'laurenmanoogian.com', 'oscardelarenta.com', 'reigningchamp.com', 'caseycasey.eu',
  'corridornyc.com', 'merzbschwanen.com', 'portugueseflannel.com', 'cdlp.com',
])

// Verified-good brands: well-regarded for quality, design, or craft but tagged
// mid/budget on price (priceRange drives budget filtering, so we don't retag it).
// This is a manual audit of the roster's reputable names — sustainable basics,
// respected denim/menswear, and India's leading handloom/artisanal labels — so
// they surface in the featured rails and get the same gentle search lift as
// premium brands. Re-audit whenever new brands are added.
export const VERIFIED_GOOD_BRANDS = new Set<string>([
  // International — quality basics, sustainable, respected craft
  'everlane.com', 'buckmason.com', 'waxlondon.com', 'nakedandfamousdenim.com',
  'wonderlooper.com', 'kotn.com', 'colorfulstandard.com', 'girlfriend.com',
  'outdoorvoices.com', 'allbirds.com', 'marinelayer.com', 'tentree.com',
  'camper.com', 'rothys.com', 'thursdayboots.com', 'saxxunderwear.com',
  'michaelstars.com', 'bombas.myshopify.com', 'patta.nl',
  'bather.com', 'outclass.ca', 'assemblylabel.com', 'alphaindustries.com',
  'tenthousand.cc', 'knix.com', 'vessi.com', 'intentionallyblank.us',
  'whimsyandrow.com', 'deadstock.ca',
  // India — leading handloom, artisanal and respected contemporary labels
  'nicobar.com', 'jaypore.com', 'okhai.com', 'itokri.com', 'suta.in',
  'mulmul.com', 'fablestreet.com', 'bombaishirtcompany.com', 'korra.in',
  'rarerabbit.in', 'thehouseofrare.com', 'chidiyaa.com', 'thepantproject.com',
  'damensch.com', 'theloom.in', 'aachho.com', 'perona.in', 'coverstory.in',
])

// Quality tier for a brand, used for the featured rails and the search quality bias.
// 3 = hand-picked icon, 2 = luxury, 1 = premium or verified-good, 0 = everything else.
export function brandQualityScore(domain: string): number {
  const d = domain.toLowerCase().replace(/^www\./, '')
  if (ICON_BRANDS.has(d)) return 3
  const profile = UCP_REGISTRY.find(s => s.domain.toLowerCase().replace(/^www\./, '') === d)
  if (profile?.priceRange === 'luxury') return 2
  if (profile?.priceRange === 'premium') return 1
  if (VERIFIED_GOOD_BRANDS.has(d)) return 1
  return 0
}

// All "best" brand domains (icons + luxury + premium), icons first, for featured
// rails. The caller decides how many to fan out to.
export function bestBrandDomains(): string[] {
  const icons: string[] = []
  const luxury: string[] = []
  const premium: string[] = []
  const good: string[] = []
  for (const s of UCP_REGISTRY) {
    const d = s.domain.toLowerCase().replace(/^www\./, '')
    if (ICON_BRANDS.has(d)) icons.push(s.domain)
    else if (s.priceRange === 'luxury') luxury.push(s.domain)
    else if (s.priceRange === 'premium') premium.push(s.domain)
    else if (VERIFIED_GOOD_BRANDS.has(d)) good.push(s.domain)
  }
  return [...icons, ...luxury, ...premium, ...good]
}

// ── Vibe glossary ───────────────────────────────────────────────────────────────
// Each brand carries one or more vibe tags. This explains what each tag signals so
// the AI can match a shopper's described mood/style/use-case to the right brands.
export const VIBE_GLOSSARY: Record<string, string> = {
  // Performance
  workout: "gym & training gear — performance fabrics, gym/training sets",
  sport: "athletic, sporty styling with a technical, performance edge",
  active: "activewear & athleisure built for movement",
  seamless: "smooth second-skin basics; sculpting, bonded, no-VPL construction",
  // Casual & Easy
  casual: "everyday relaxed wear that's easy to throw on and style",
  coastal: "Breton stripe, linen, nautical, beach and harbour vibes — Marine Layer energy",
  resort: "vacation-ready cover-ups, printed shirts, light fabrics — poolside to dinner",
  cozy: "soft, comfortable, loungey — knits, fleece, easy comfort",
  // Elevated & Refined
  minimalist: "clean, pared-back design — neutral palette, no logo, quality fabric over decoration",
  "quiet-luxury": "no-logo cashmere/silk/linen, elevated neutrals — Loro Piana energy",
  "old-money": "heritage classics, prep-adjacent, patina over trend — Brooks Brothers energy",
  preppy: "popped collar, chinos, loafers, collegiate Ivy League aesthetic",
  formal: "dressy and tailored — office, occasion and elevated wear",
  luxury: "premium, high-end, designer-grade fabrics and craftsmanship",
  // Street & Urban
  streetwear: "urban and hype-driven — oversized fits, bold graphics, statement pieces",
  denim: "jeans-led or denim-forward collections",
  // Heritage & Craft
  organic: "natural & sustainable fabrics, eco-conscious, quiet minimalist design",
  "heritage-workwear": "duck canvas, selvedge denim, chore coats — Carhartt/Taylor Stitch energy",
  artisan: "handcrafted, slow fashion, natural textiles — woven, knitted, printed by hand",
  sustainable: "certified eco, recycled materials, closed-loop production focus",
  // Aesthetic
  bohemian: "flowing linen, embroidered cotton, global influence — free-spirited and layered",
  "dark-academia": "tweed, herringbone, turtleneck, scholarly layering — library chic",
  maximalist: "pattern-mixing, bold colour, layered jewellery — more is more",
  artistic: "sculptural, avant-garde, gallery-worthy — Comme des Garçons energy",
  // Activity
  outdoor: "rugged and utility-driven — hiking, travel and nature-ready",
  gorpcore: "technical outdoor wear worn in the city — Gore-Tex, trail shoes, fleece",
  // Cultural
  japanese: "Japanese design sensibility — oversized, deconstructed, natural, precise",
  "indian-ethnic": "kurtas, block prints, dupattas, traditional Indian craft modernized",
  french: "Parisian ease, effortlessly chic, understated femininity",
  bodycon: "figure-hugging, curve-celebrating silhouettes — fitted dresses, contour knitwear",
};

/** Human-readable catalog language(s) for a store, from its `languages` field or TLD. */
export function storeLanguageLabel(store: StoreProfile): string {
  const LANG_NAMES: Record<string, string> = {
    en: "English", ja: "Japanese", it: "Italian", fr: "French",
    gr: "Greek", el: "Greek", ru: "Russian", tr: "Turkish",
    nl: "Dutch", de: "German", es: "Spanish", id: "Indonesian",
  };
  if (store.languages && store.languages.length > 0) {
    return store.languages.map(l => LANG_NAMES[l] || l).join("/");
  }
  const d = store.domain.toLowerCase();
  if (d.includes("coverchord")) return "Japanese/English";
  if (d.endsWith(".jp")) return "Japanese/English";
  if (d.endsWith(".gr")) return "Greek/English";
  if (d.endsWith(".it")) return "Italian/English";
  if (d.endsWith(".fr")) return "French/English";
  if (d.endsWith(".ru")) return "Russian/English";
  if (d.endsWith(".tr")) return "Turkish/English";
  if (d.endsWith(".be")) return "Dutch/French/English";
  if (d.endsWith(".co.id")) return "Indonesian/English";
  return "English";
}

/** One directory line per brand: name, domain, categories, vibes and catalog language. */
export function buildBrandDirectory(): string {
  return UCP_REGISTRY.map(store => {
    const name = brandDisplayName(store);
    const cats = store.categories.join(", ");
    const vibes = store.vibe.length > 0 ? store.vibe.join(", ") : "general";
    const lang = storeLanguageLabel(store);
    const genderPart = store.gender ? ` | ${store.gender.join(", ")}` : "";
    const pricePart = store.priceRange ? ` | price: ${store.priceRange}` : "";
    const itemsPart = store.items ? ` | items: ${store.items.join(", ")}` : "";
    const aboutPart = store.about ? ` | ${store.about}` : "";
    return `- ${name} — ${store.domain}${genderPart}${pricePart} | sells: [${cats}]${itemsPart} | style: [${vibes}] | language: ${lang}${aboutPart}`;
  }).join("\n");
}

/** Compact directory — same as buildBrandDirectory but omits the verbose `about` field (~40% fewer tokens). */
export function buildCompactBrandDirectory(): string {
  return UCP_REGISTRY.map(store => {
    const name = brandDisplayName(store);
    const cats = store.categories.join(", ");
    const vibes = store.vibe.length > 0 ? store.vibe.join(", ") : "general";
    const lang = storeLanguageLabel(store);
    const genderPart = store.gender ? ` | ${store.gender.join(", ")}` : "";
    const pricePart = store.priceRange ? ` | price: ${store.priceRange}` : "";
    const itemsPart = store.items ? ` | items: ${store.items.join(", ")}` : "";
    return `- ${name} — ${store.domain}${genderPart}${pricePart} | sells: [${cats}]${itemsPart} | style: [${vibes}] | language: ${lang}`;
  }).join("\n");
}

/** Human-readable category taxonomy (categories → subcategories → item types). */
export function buildCategoryTaxonomy(): string {
  return Object.entries(CATEGORY_TAXONOMY).map(([key, val]) => {
    const subs = Object.entries(val.subcategories)
      .map(([sub, items]) => `    • ${sub}: ${items.join(", ")}`)
      .join("\n");
    return `${val.label} [${key}]\n${subs}`;
  }).join("\n");
}

/** Human-readable vibe glossary. */
export function buildVibeGlossary(): string {
  return Object.entries(VIBE_GLOSSARY).map(([k, v]) => `- ${k}: ${v}`).join("\n");
}

// Display names too generic to match on their own (real English words).
// These brands are still reachable via category search, just not by the bare word.
const GENERIC_BRAND_WORDS = new Set(["limited"]);

function normalizeForBrandMatch(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9& ]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Detect explicit brand mentions in a free-text query and return the matching
 * store domains (empty when the user didn't name a brand). Powers
 * brand-specific search like "linen shirt from Taylor Stitch" or "show me Allbirds".
 */
export function detectBrandsInQuery(query: string): string[] {
  if (!query) return [];
  const q = " " + normalizeForBrandMatch(query) + " ";
  const qDespaced = q.replace(/[ &]/g, "");
  const matched: string[] = [];

  for (const p of UCP_REGISTRY) {
    const display = normalizeForBrandMatch(brandDisplayName(p));
    const token = cleanBrandToken(p.domain);
    let hit = false;

    // 1) Whole display-name phrase (handles multi-word brands like "taylor stitch")
    if (display.length >= 3 && !GENERIC_BRAND_WORDS.has(display) && q.includes(" " + display + " ")) {
      hit = true;
    }
    // 2) Despaced display name ("aime leon dore" -> "aimeleondore")
    const displayDespaced = display.replace(/[ &]/g, "");
    if (!hit && displayDespaced.length >= 5 && !GENERIC_BRAND_WORDS.has(displayDespaced) && qDespaced.includes(displayDespaced)) {
      hit = true;
    }
    // 3) Domain-derived token (catches "gymshark" -> gymsharkusa, "brun" -> wearbrun)
    if (!hit && token.length >= 5 && !GENERIC_BRAND_WORDS.has(token) && qDespaced.includes(token)) {
      hit = true;
    }

    if (hit) matched.push(p.domain.toLowerCase().trim());
  }

  return Array.from(new Set(matched));
}
