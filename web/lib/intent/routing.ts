/**
 * Which kind of question is this?
 *
 * Nine pure functions that read a shopper's sentence and decide how the route
 * should treat it: is this a request or a reaction, does it want products or
 * conversation, is it a follow-up to something already offered, and which
 * garment does each half of it name. Extracted from the route in Phase E,
 * step E3 — **moved, not rewritten**. Every pattern, threshold and word list
 * below is byte-identical to what it replaced.
 *
 * UNDER `intent/`, NOT `ai/`. These route on what the SHOPPER meant, and never
 * touch a model, a provider or a prompt — the decision they make is which path
 * the request takes, not which model answers it. Filed beside the parser and
 * the compiler, which read the same sentence for the same reason.
 *
 * They are also the cheapest and most consequential decisions in the system:
 * every one runs on every request, in microseconds, before anything is
 * fetched or generated. isHeavyQuery alone decides whether a shopper reaches
 * the path that can search at all — which is why its default INVERTED at some
 * point from a whitelist of shopping words to a denylist of things that are
 * not requests. "I have an interview on Friday" contains no word the old list
 * knew, and could never search.
 */
import {
  classifyQuerySlot, decomposeQuery, slotLabelFor,
  GARMENT_CATEGORY, GARMENT_VOCAB, type SlotCategory,
} from '@/lib/queryParser'
import { wantsProducts } from '@/lib/fashion/intentRouter'

// Conversational filler that carries no search signal — stripped from a
// category subquery so a store gets "men trousers", not "men i need some
// trousers" (which can dilute Shopify's keyword match). Only whole-word,
// leading/trailing-safe removals; garment/color/material words are never here.
const SUBQUERY_FILLER = /\b(?:i|need|want|some|any|a|an|the|please|show|find|get|me|looking|for|would|like|could|you|help|hey|hi|hello|can|could|pls|plz|and|also|maybe|something|to|wear|buy|shop|shopping)\b/gi

// Clean a per-category subquery down to real search signal (gender, color,
// material, occasion, the garment) by dropping conversational filler. Falls
// back to the raw stripped query if filler removal would empty it.
export function cleanSubQuery(q: string): string {
  const cleaned = q.replace(SUBQUERY_FILLER, ' ').replace(/\s+/g, ' ').trim()
  return cleaned.length >= 2 ? cleaned : q.trim()
}

// Human, plural slot labels per garment key — "Shirts", "T-Shirts", "Trousers",
// "Kurtas" — so each strip is named by the actual garment, not a generic
// Top/Bottom. Falls back to the slot label for anything unmapped.
const GARMENT_DISPLAY: Record<string, string> = {
  shirt: 'Shirts', tshirt: 'T-Shirts', blouse: 'Blouses', polo: 'Polos', tank: 'Tanks',
  sweater: 'Sweaters', hoodie: 'Hoodies', cardigan: 'Cardigans', henley: 'Henleys', turtleneck: 'Turtlenecks',
  trouser: 'Trousers', jean: 'Jeans', chino: 'Chinos', short: 'Shorts', skirt: 'Skirts', legging: 'Leggings',
  cargo: 'Cargos', jogger: 'Joggers', sweatpant: 'Sweatpants', culotte: 'Culottes', capri: 'Capris',
  jacket: 'Jackets', blazer: 'Blazers', coat: 'Coats', vest: 'Vests', bomber: 'Bombers', denimJacket: 'Denim Jackets', windbreaker: 'Windbreakers',
  dress: 'Dresses', jumpsuit: 'Jumpsuits', bodysuit: 'Bodysuits', gown: 'Gowns',
  shoe: 'Shoes', sneaker: 'Sneakers', boot: 'Boots', loafer: 'Loafers', sandal: 'Sandals', heel: 'Heels', derby: 'Dress Shoes', espadrille: 'Espadrilles', clog: 'Clogs', mule: 'Mules', flat: 'Flats',
  kurta: 'Kurtas', kurti: 'Kurtis', saree: 'Sarees', lehenga: 'Lehengas', anarkali: 'Anarkalis', kaftan: 'Kaftans', palazzo: 'Palazzos', churidar: 'Churidars', sharara: 'Shararas', gharara: 'Ghararas', dhoti: 'Dhotis', salwarKameez: 'Salwar Kameez', sherwani: 'Sherwanis', nehruJacket: 'Nehru Jackets', bandhgala: 'Bandhgalas', dupatta: 'Dupattas',
  bag: 'Bags', tote: 'Totes', backpack: 'Backpacks', hat: 'Hats', scarf: 'Scarves', belt: 'Belts', sock: 'Socks', sunglasses: 'Sunglasses', watch: 'Watches', jewelry: 'Jewelry', wallet: 'Wallets',
}
export function garmentLabel(key: string): string {
  if (GARMENT_DISPLAY[key]) return GARMENT_DISPLAY[key]
  const cat = GARMENT_CATEGORY[key]
  return cat ? slotLabelFor(cat) : 'Pieces'
}

// The DISTINCT garments a query names, in order, collapsing compounds to one
// ("dress shirt" → shirt only) — the split unit for multi-category results, so
// "shirts, trousers and tshirts" yields three garments (shirt, trouser, tshirt)
// even though shirt and tshirt share the broad "top" slot.
export function separatedGarmentKeys(query: string): string[] {
  // Collapse the hyphenated/spaced spellings of compound garments into their
  // single-token vocab form FIRST. Splitting on non-alphanumerics turns
  // "t-shirt" into ["t","shirt"], and multi-word vocab terms are skipped below,
  // so "a white t-shirt" used to resolve to the key `shirt` — labelling the
  // strip "Shirts" and then filtering out every actual t-shirt. Only the
  // unhyphenated spellings ever routed correctly.
  const words = query.toLowerCase()
    .replace(/\bt[\s-]+shirts?\b/g, 'tshirt')
    .replace(/\btank[\s-]+tops?\b/g, 'tank')
    .replace(/\bpolo[\s-]+shirts?\b/g, 'polo')
    .replace(/\bsweat[\s-]+shirts?\b/g, 'sweatshirt')
    .split(/[^a-z0-9]+/).filter(Boolean)
  const wordKey: (string | null)[] = words.map(w => {
    const ws = w.replace(/s$/, '') // tolerate a plural the vocab lists only in singular ("tshirts" → "tshirt")
    for (const [key, entry] of Object.entries(GARMENT_VOCAB)) {
      if (!GARMENT_CATEGORY[key]) continue
      for (const t of entry.query) {
        if (t.includes(' ') || t.includes('-')) continue
        if (t === w || t.replace(/s$/, '') === ws) return key
      }
    }
    return null
  })
  const consumed = new Set<number>()
  for (let i = 0; i + 1 < words.length; i++) {
    const a = wordKey[i], b = wordKey[i + 1]
    if (!a || !b) continue
    if (a === 'dress') consumed.add(i)
    else if (b === 'dress') consumed.add(i)
    else if (a === 'shirt' && b === 'jacket') consumed.add(i)
  }
  const keys: string[] = []
  words.forEach((_, i) => {
    if (consumed.has(i)) return
    const k = wordKey[i]
    if (k && !keys.includes(k)) keys.push(k)
  })
  return keys
}

/**
 * A first message with nothing in it to answer — a bare hello.
 *
 * Only these earn the introduction. This exists because the first-message
 * context block used to tell the model to introduce itself "then ask what they
 * need" on EVERY new conversation, including ones that opened with a real
 * question. The shopper asked for something and got "Hi, I'm Fabrics, what do
 * you need?" back, which reads as though nobody listened. Anything that is not
 * a bare greeting is a request and must be answered on the spot.
 */
export function isBareGreeting(question: string): boolean {
  const t = question.toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!t) return true
  if (t.split(' ').length > 4) return false
  return /^(hi|hey|hello|yo|hiya|heya|howdy|sup|hi there|hey there|hello there|good (morning|afternoon|evening)|are you there|you there|anyone there|test|testing)$/.test(t)
}

export function isHeavyQuery(question: string): boolean {
  // Any recognized garment is a shopping intent — use the real vocabulary
  // (robust plurals / synonyms / Indian wear) so "shirts", "overshirts",
  // "kurta" route to the path that can actually SEARCH, not the chat path.
  if (decomposeQuery(question.toLowerCase()).garmentKeys.length > 0) return true
  // Everything else that is not plainly small talk. This used to be a
  // whitelist of shopping words and is now a denylist of the few things that
  // are not requests — see lib/fashion/intentRouter.ts for why the default had
  // to invert. "I have an interview on Friday" contains no word the old list
  // knew and could never search; that is the bug this fixes.
  return wantsProducts(question)
}

// A reaction to what was just shown — "I like it", "this is better than before",
// "not the best", "love the shoes", "meh". This is FEEDBACK, not a new order, so
// it must NOT trigger another outfit build / search. Route it to the light chat
// path (which can't emit [OUTFIT:]/[SEARCH:] and replies short and warm), unless
// the shopper also asked for a change (handled by the wantsChange guard, and by
// naming a garment — that's a real request, not pure feedback).
export function isReactionOnly(question: string): boolean {
  const q = question.trim().toLowerCase()
  if (q.length === 0 || q.length > 70) return false
  if (decomposeQuery(q).garmentKeys.length > 0) return false // names a garment → a request, not just a reaction
  const reaction = /\bi (like|love|prefer|hate|don'?t like)\b|\b(like|love|hate) (it|this|that|these|them)\b|\blooks? (good|great|nice|amazing|perfect|cool)\b|(^|\W)(much |way |even |so much )?better( than| then| now)?(\W|$)|\bnot (the best|bad|great|feeling it)\b|\b(pretty good|perfect|amazing|meh|hmm+|not sure|so-?so|good one|nice one|that works|love this)\b/.test(q)
  if (!reaction) return false
  const wantsChange = /\b(another|different|more|others?|instead|swap|change|replace|show me|find|search|get me|blue|red|black|white|green|olive|beige|formal|casual|cheaper|pricier|bigger|smaller|else|new|add|remove|without|with a)\b/.test(q)
  return !wantsChange
}

// Whether a message genuinely intends to FIND or BUILD products — a garment is
// named, or a clear find/show/outfit/style verb. Used ONLY to gate the
// "Thinking through the styling" indicator: a plain conversational turn that
// merely routed heavy ("also I need your help", "no, a coding project") should
// not show a styling animation. If a real search does happen, it streams its
// own progress once it actually starts, so nothing is lost by being strict here.
export function isProductIntent(question: string): boolean {
  const q = question.toLowerCase()
  if (decomposeQuery(q).garmentKeys.length > 0) return true
  return /\bfind\b|\bshow me\b|\blook(ing)? for\b|\brecommend\b|\bsuggest\b|\bsearch\b|\boutfits?\b|\bpieces?\b|\bbuild.{0,12}(look|outfit)\b|\bwhat.{0,12}wear\b|\bwear (to|for|with)\b|\bstyle (me|this|a|an|my|for)\b|\bpair (with|it)\b|\bdress (for|me)\b|\bwardrobe\b/.test(q)
}

// ── Outfit slot naming + coherence ───────────────────────────────────────────
// A layering piece worn OVER a base top (overshirt / shacket / shirt-jacket /
// blazer / jacket / cardigan / coat / gilet). These read as the OUTER layer of
// an outfit, never a second "Top" — promoting them to the 'outer' slot is how
// an outfit avoids showing two tops.
const OUTFIT_LAYER_RE = /\b(over-?shirts?|shackets?|shirt[- ]jackets?|blazers?|bombers?|jackets?|cardigans?|overcoats?|trench(?:es|coats?)?|parkas?|puffers?|coats?|gilets?|waistcoats?|dusters?|nehru jackets?)\b/i

// Human, specific slot labels straight from the query's own words — "Overshirt",
// "Tee", "Chinos", "Loafers" — instead of the generic Top/Bottom/Shoes. Ordered
// most-specific first; the first pattern that matches wins.
const OUTFIT_SLOT_NAMES: [RegExp, string][] = [
  [/\bover-?shirts?|shackets?|shirt[- ]jackets?\b/i, 'Overshirt'],
  [/\bblazers?\b/i, 'Blazer'],
  [/\bbombers?\b/i, 'Bomber'],
  [/\b(denim|jean|trucker) jackets?\b/i, 'Denim Jacket'],
  [/\bnehru jackets?\b/i, 'Nehru Jacket'],
  [/\bjackets?\b/i, 'Jacket'],
  [/\bcardigans?\b/i, 'Cardigan'],
  [/\b(overcoats?|trench(?:es|coats?)?|parkas?|puffers?|coats?)\b/i, 'Coat'],
  [/\b(gilets?|waistcoats?|vests?)\b/i, 'Vest'],
  [/\bhoodies?|sweatshirts?\b/i, 'Hoodie'],
  [/\b(sweaters?|jumpers?|pullovers?|knitwear|knit tops?)\b/i, 'Sweater'],
  [/\bturtlenecks?|roll[- ]?necks?\b/i, 'Turtleneck'],
  [/\bhenleys?\b/i, 'Henley'],
  [/\bpolos?\b/i, 'Polo'],
  [/\bt-?shirts?|tees?\b/i, 'Tee'],
  [/\bkurtis?\b/i, 'Kurti'],
  [/\bkurtas?\b/i, 'Kurta'],
  [/\bblouses?\b/i, 'Blouse'],
  [/\btanks?|camisoles?\b/i, 'Tank'],
  [/\bshirts?\b/i, 'Shirt'],
  [/\bchinos?\b/i, 'Chinos'],
  [/\b(jeans?|denim)\b/i, 'Jeans'],
  [/\b(joggers?|sweatpants|track pants)\b/i, 'Joggers'],
  [/\bcargos?\b/i, 'Cargos'],
  [/\bshorts?\b/i, 'Shorts'],
  [/\bskirts?\b/i, 'Skirt'],
  [/\bpalazzos?\b/i, 'Palazzo'],
  [/\bchuridars?\b/i, 'Churidar'],
  [/\b(trousers?|pants|slacks)\b/i, 'Trousers'],
  [/\bloafers?\b/i, 'Loafers'],
  [/\b(sneakers?|trainers?)\b/i, 'Sneakers'],
  [/\bboots?\b/i, 'Boots'],
  [/\b(sandals?|slides?|floaters?)\b/i, 'Sandals'],
  [/\b(heels?|pumps?|stilettos?)\b/i, 'Heels'],
  [/\b(derby|derbies|oxfords?|brogues?|dress shoes?)\b/i, 'Dress Shoes'],
  [/\b(mules?|flats?|espadrilles?|shoes?|footwear)\b/i, 'Shoes'],
  [/\bdress(es)?\b/i, 'Dress'],
  [/\bsarees?|saris?\b/i, 'Saree'],
  [/\blehengas?\b/i, 'Lehenga'],
  [/\bjumpsuits?|rompers?\b/i, 'Jumpsuit'],
  [/\bbelts?\b/i, 'Belt'],
  [/\b(bags?|totes?|backpacks?|clutch(?:es)?)\b/i, 'Bag'],
  [/\b(hats?|caps?|beanies?)\b/i, 'Hat'],
  [/\bscarves?|scarf\b/i, 'Scarf'],
  [/\bwatch(?:es)?\b/i, 'Watch'],
  [/\bsunglasses|shades\b/i, 'Sunglasses'],
]
export function outfitSlotInfo(query: string): { label: string; slotCat: SlotCategory | null } {
  const isLayer = OUTFIT_LAYER_RE.test(query)
  let label = 'Piece'
  for (const [re, name] of OUTFIT_SLOT_NAMES) { if (re.test(query)) { label = name; break } }
  // A layer always occupies the OUTER slot so it never collides with the base top.
  const slotCat = isLayer ? 'outer' : classifyQuerySlot(query)
  return { label, slotCat }
}

// A short reply ("casual", "neutral", "no", "blue") right after Fabrics asked a
// styling question ("what vibe?", "what colours?"). These carry no garment of
// their own, so without this they route to the chat path and Fabrics just asks
// ANOTHER question instead of searching — the exact "it keeps saying got it and
// never finds anything" loop. Routing them heavy lets it deliver [SEARCH:].
export function isShoppingContinuation(question: string, lastAssistant: string): boolean {
  const q = question.trim()
  if (q.length === 0 || q.length > 40) return false // a real new message, not a terse answer
  const la = (lastAssistant || '').trim()
  if (!la.endsWith('?')) return false               // the assistant wasn't asking
  const laLower = la.toLowerCase()
  return (
    /\bvibe\b|\boccasion\b|\bcolou?rs?\b|\baiming for\b|\bwhat are you\b|\bwhat.{0,12}(wear|looking|need|after)\b|\baccessor|\bfit\b|\bbudget\b|\bstyle\b|\bformal or\b|\bcasual or\b/.test(laLower) ||
    decomposeQuery(laLower).garmentKeys.length > 0
  )
}

// A short approval ("ok", "yes", "go") or a nudge ("where is the outfit",
// "you didn't") right after Fabrics PROPOSED or PROMISED a look but didn't
// actually build it. On its own a bare "ok" routes to the lightweight chat
// path, which can't emit [OUTFIT:]/[SEARCH:] — so the model just says "on it"
// and the shopper has to ask again. Detecting this forces the heavy path so the
// build happens immediately, no second prompt needed.
export function isActionFollowThrough(question: string, lastAssistant: string): boolean {
  const q = question.toLowerCase().trim()
  const approves =
    /^(ok(ay)?|k|yes|yep|yeah|ya|sure|sounds good|that works|perfect|go|go ahead|do it|build it|make it|show me|please( do)?|continue|yes please)\b[.!]?$/.test(q) ||
    /\bwhere('?s| is| are)\b.*\b(outfit|look|it|them|product|piece)/.test(q) ||
    /\b(again|still (waiting|nothing)|you (didn'?t|haven'?t)|i asked|do what i asked)\b/.test(q)
  if (!approves) return false
  const la = lastAssistant.toLowerCase()
  return (
    /\bon it\b|how does that sound|sound good|want me to|shall i|let me (put|build|pull|find)|i'?ll (put|build|pull|find)|putting together|let'?s (create|build|do)|imagining|here'?s (a|the) (look|outfit)/.test(la) ||
    /\b(shirt|trouser|short|shoe|loafer|sneaker|boot|blazer|jacket|coat|dress|knit|linen|cotton|wool)\b/.test(la)
  )
}
