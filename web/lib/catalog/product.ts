/**
 * What a product IS, as opposed to what one request thought of it.
 *
 * A search reaches ninety stores, parses what they send, and keeps the result
 * in a pool shared by everybody who asks the same question. Four things then
 * happen to those objects on the way to a page, and only one of them is about
 * the garment:
 *
 *   THE MERCHANT SAID IT        title, price, variants, stock — facts, theirs
 *   OUR CODE DERIVED IT         gender signal, colour family, BM25 — pure
 *                               functions in this directory, no storage
 *   A MODEL INFERRED IT         GarmentProfile — versioned, stored separately,
 *                               reached through a side map, never a field here
 *   THIS REQUEST DECIDED IT     the judge's score, the shopper's currency
 *
 * The first is `CanonicalProduct`. The last is `RankingSignals`. They were the
 * same object, and the pool being shared is what made that expensive: a
 * shopper's currency, written onto a pooled product while their request was
 * still waiting on the judge, was read back by the next shopper on the same
 * query. `scripts/canonical-product.js` reproduces it.
 *
 * The middle two are DELIBERATELY ABSENT from this file. The deterministic
 * derivations already live as pure functions next door in productFilters.ts
 * and concepts.ts and hold no state; the model inference already lives in
 * lib/fashion/garmentProfile.ts with its own schema and prompt versions and
 * its own Convex table. Giving either a type here would create a second place
 * for the same knowledge to live, which is the thing most worth not doing.
 *
 * NOTHING HERE IS WIRED INTO A CACHE KEY YET. `productKey` is the name the
 * owned corpus will file a garment under; the existing search, rerank and
 * garment-profile keys are untouched, because re-keying a live cache is a
 * behaviour change and belongs to the phase that builds the corpus.
 */

/** Bump when a field is added, removed, or its meaning changes. Recorded on
 *  every product so a stored snapshot can say which shape it was written in. */
export const CANONICAL_SCHEMA_VERSION = 1

/**
 * Where a record came from — the answer to "did the merchant tell us this?"
 *
 * Deliberately NOT a per-field tag. Twenty fields times five provenance
 * attributes is bookkeeping nobody reads, and it is not needed: which
 * CONTAINER a value lives in already answers the question without ambiguity.
 * Anything on a CanonicalProduct is merchant-stated or a named normalisation
 * of something merchant-stated; anything a model concluded is on a
 * GarmentProfile, which carries its own model and timestamp; anything one
 * request decided is in RankingSignals, which is thrown away with the request.
 */
export type ProductProvenance = Readonly<{
  /** The store's own domain, lowercased and www-stripped. */
  merchant: string
  /** The id the merchant used, verbatim, with no validation of any kind — see
   *  the note above productKey on why that is not a global name for a
   *  garment. */
  sourceId: string
  /** How it was retrieved. One value today; named so a second ingest path is
   *  distinguishable from this one rather than silently indistinguishable. */
  via: 'ucp-mcp'
  /** When this snapshot was read. A price is only true as of a moment. */
  fetchedAt: number
  /** Which shape it was written in. */
  schema: typeof CANONICAL_SCHEMA_VERSION
  /**
   * WHICH OF THE NORMALISATIONS WERE THE MERCHANT'S WORD.
   *
   * The note above says a per-field tag is bookkeeping nobody reads, and for
   * merchant-vs-model-vs-request that is still true: the container answers it.
   * It does not answer a fourth question the design did not anticipate — did
   * the merchant say this, or did parseProduct supply it? Three of the named
   * normalisations INVENT a value rather than normalise one, and each is
   * indistinguishable from a stated value once it is a string in a row:
   *
   *   currency      absent -> 'USD'                 (normalizeCurrency)
   *   availability  absent -> in_stock true         (no variant reports)
   *   vendor        absent -> title-cased domain token, then 'Independent'
   *
   * A corpus that stores the result and not this cannot tell a garment priced
   * in dollars from one whose price has no currency at all. So this records
   * only which BRANCH ran — never a second copy of the value, which would be
   * the duplicate-knowledge problem the note above guards against.
   *
   * Read by the corpus and by nothing else. No filter, ranking, judge or wire
   * field consults it.
   */
  stated: Readonly<{
    /** The source sent a currency. False means `currency` is the USD default. */
    currency: boolean
    /** Some variant (or the product) reported a real availability signal.
     *  False means `in_stock` is the optimistic default, not an observation. */
    availability: boolean
    /** Which vendor branch ran. 'domain' is the title-cased domain token;
     *  'none' is the 'Independent' sentinel. */
    vendor: 'merchant' | 'domain' | 'none'
  }>
}>

/**
 * Merchant facts, and named deterministic normalisations of merchant facts.
 *
 * The normalisations are worth naming because each can be wrong independently
 * of the merchant, which is exactly the distinction a recommendation benchmark
 * has to be able to make. As of this version they are: `price` (minor to major
 * units, with a zero-decimal currency table), `currency` (upper-cased, default
 * USD), `store_url` (absolutised, and SYNTHESISED from domain + id when the
 * store sends none), `image_url` (first of product or variant media, CDN-
 * narrowed), `in_stock` (a three-way aggregation over the raw variant
 * signals), `description` (the longest of five candidates, one of which is
 * HTML reduced to text) and `vendor` (falling back to a title-cased domain
 * token). Every one of those is in parseProduct and none of them is the
 * merchant speaking directly.
 *
 * Readonly because a ranking is not allowed to edit a garment. That is a
 * compile-time statement of the invariant `scripts/canonical-product.js`
 * checks at runtime.
 */
export type CanonicalProduct = Readonly<{
  /** merchant::sourceId — see productKey. Stable across price and title
   *  changes, across two shoppers, and across two rankings. */
  key: string
  source: ProductProvenance

  id: string
  title: string
  vendor: string
  price: number
  currency: string
  store_url: string
  image_url: string
  in_stock: boolean
  tags: string[]
  description?: string
  description_html?: string
  options?: { name: string; values: string[] }[]
  media?: Array<{ type: string; url: string; alt?: string }>
  variants?: Array<{
    id: string
    title: string
    price: number
    availability: boolean
    options: Array<{ name: string; label: string }>
    media?: Array<{ url: string; alt?: string }>
  }>
  /** The store's own product type. Read by garmentHaystack and genderHaystack
   *  and, as of this version, populated by nothing — UCP does not send it and
   *  parseProduct has never set it. Kept declared rather than deleted because
   *  removing it changes both haystack strings by a space, and conceptHit does
   *  substring matching for multi-word terms. Populating it is corpus-phase
   *  work with its own evaluation. */
  product_type?: string
  /** Shopify standard taxonomy ids, e.g. 'gid://shopify/TaxonomyCategory/aa-8-8'. */
  categories?: string[]
}>

/**
 * What ONE request concluded about a product. Never a fact about the garment,
 * therefore never a field on it.
 *
 * `bm25`, `judgeScore` and `judgeReason` are written by relevanceRerank when a
 * caller supplies somewhere to put them. `displayPrice` and `displayCurrency`
 * are declared here because they are the clearest example of the category — a
 * price in the SHOPPER's currency is a fact about the shopper — and are still
 * projected onto the wire object today, on a copy the request owns, because
 * the interface reads them from there. Moving that projection behind this type
 * is a serialisation-boundary change and belongs with the corpus phase.
 */
export type RankingSignals = {
  bm25?: number
  judgeScore?: number
  judgeReason?: string
  displayPrice?: number
  displayCurrency?: string
}

/** One request's opinions, keyed by CanonicalProduct.key. Lives for the length
 *  of a request and is then dropped. Never persisted, never shared. */
export type RankingState = Map<string, RankingSignals>

// ── Identity ────────────────────────────────────────────────────────────────
// A URL is not identity: parseProduct builds store_url three different ways
// and one of them invents it from the domain and the id, so the same garment
// yields different URLs depending on which fields its store happened to send.
// A price is not identity either, nor a title — both are merchant state that
// changes while the garment stays the same piece of clothing.
//
// What IS stable is the pair (which shop, what that shop calls it), and the
// shop has to be in there.
//
// AN EARLIER VERSION OF THIS COMMENT SAID a Shopify GID carries a per-shop
// numeric id and that two stores would therefore eventually collide. That was
// an assumption, it was never verified, and it is wrong — Shopify allocates
// product ids from a global sequence. The accurate statement is narrower and
// still sufficient: parseProduct copies `raw.id` VERBATIM, with no validation
// of shape, length or prefix, from 458 independent UCP endpoints. UCP is a
// protocol, not Shopify. Nothing obliges an implementation to send a GID, and
// nothing in this codebase checks that one did.
//
// What has actually been measured, and only this: fourteen live /api/mcp
// requests to the seven brands holding two registry entries each. Five domains
// answered, nine did not. Of the 180 products that came back, 180 ids were
// Shopify GIDs, 0 were bare numerics, 0 were anything else, and there were 0
// cross-merchant duplicates. That is a sample of five stores. It says nothing
// about the other 453, and it is not a population claim — the collision rate
// across the registry is unknown, and lib/services/GlobalCatalogService's
// corpus counters exist to measure it rather than continue guessing.
//
// Qualifying by merchant costs one string concatenation and removes the
// question. That is the whole argument for it.
//
// NO ALIAS MAP. Those same seven brands — snitch, okhai, suvasa, newme,
// tokyotalkies, bummer, kardo — each hold two registry domains, and whether a
// pair is one shop behind two names or two shops sharing a brand is UNRESOLVED.
// No pair had both members answer, so the evidence required to merge them was
// never obtained, and merging them on the strength of a matching brand name
// would be exactly the kind of inference this file exists to avoid. They stay
// as seven pairs of distinct merchants until observation settles it.

/** The store, named the one way. Accepts a URL or a bare domain; answers ''
 *  rather than throwing, because a product with an unreadable origin should
 *  degrade to unidentified rather than take a search down. */
export function merchantKey(urlOrDomain?: string | null): string {
  const raw = String(urlOrDomain ?? '').trim()
  if (!raw || /\s/.test(raw)) return ''
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`)
    const host = u.hostname.toLowerCase().replace(/^www\./, '')
    // A hostname with no dot is a bare word ("localhost", a typo, a sentence
    // fragment), not a store — and calling one of those a merchant would file
    // every product from every such input under one key.
    return host.includes('.') ? host : ''
  } catch {
    return ''
  }
}

type Identifiable = {
  source?: { merchant?: string; sourceId?: string }
  store_url?: string
  id?: string
}

/** The name the owned corpus will file this garment under.
 *
 *  Prefers the provenance block, and falls back to the URL and the id so a
 *  product deserialised from an older persisted snapshot — which predates
 *  provenance — still gets a key rather than an exception. */
export function productKey(p: Identifiable): string {
  const merchant = p.source?.merchant || merchantKey(p.store_url)
  const sourceId = p.source?.sourceId || p.id || ''
  return `${merchant}::${sourceId}`
}

/** One buyable line of one product. Hangs off the product key for the same
 *  reason the product key hangs off the merchant: a variant id is only unique
 *  inside the shop that issued it. */
export function variantKey(p: Identifiable, variant: { id?: string }): string {
  return `${productKey(p)}::${variant?.id ?? ''}`
}
