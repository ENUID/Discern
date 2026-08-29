/**
 * Keeping what the catalogue found.
 *
 * A search reaches up to ninety stores, parses what they send into canonical
 * products, shows about eight of them, and throws the rest away when the LRU
 * expires fifteen minutes later. This is the one line that keeps them.
 *
 * WRITE-ONLY. Nothing here reads the corpus, and convex/products.ts exports no
 * query, so a corpus record cannot reach a shopper by any route. Live
 * retrieval, dedupe, filters, ranking, the judge, outfits and the client wire
 * format are all exactly as they were; the write happens behind the response
 * and the response does not know about it.
 *
 * NOTHING HERE MAY REACH THE SHOPPER, INCLUDING ITS FAILURES. Every path is
 * caught, counted and dropped. A Convex that is down, an oversized batch, a
 * malformed row: the page is identical, and the products are simply seen again
 * on the next search that surfaces them. That is the same bargain
 * persistentProfileCache and persistentSearchCache already make, and it is why
 * there is no queue, no retry framework and no job table here — the retry is
 * the next shopper asking a similar question.
 */
import { ConvexHttpClient } from 'convex/browser'
import { anyApi } from 'convex/server'
import { createHash } from 'crypto'
import { BoundedCache } from '../boundedCache'
import type { CanonicalProduct } from '../catalog/product'

/** On by default: an empty corpus is the thing this exists to fix. Set
 *  CORPUS_WRITE=off to stop writing without removing the seam — the same
 *  switch shape persistentSearchCache and persistentProfileCache already use. */
function enabled(): boolean {
  return (process.env.CORPUS_WRITE ?? 'on').toLowerCase() === 'on'
}

function client(): ConvexHttpClient | null {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL
  return url ? new ConvexHttpClient(url) : null
}

/** Matching garmentProfiles.getMany/setMany, which is the repository's own
 *  answer to how many rows one Convex mutation should touch. */
const BATCH = 64

// THERE IS NO PER-SEARCH CAP, and there was.
//
// It capped at four batches on the argument that products past it "are written
// by the next search that surfaces them". That argument was false, and
// measurement said so: `entry.products` is in STORE RESPONSE order, because
// ingest() fires per store the moment each one resolves. So the cap kept the
// fastest products and dropped the slowest — and because the pool order is
// stable and the search cache is warm, it dropped THE SAME ONES on every
// repeat. Over ten identical searches of a 300-product pool the same 44
// products were skipped ten times. Slow merchants were not delayed, they were
// permanently excluded, and load-more could not compensate because load-more
// does not write at all.
//
// Freshness is the cost control instead, in the two layers below — the local
// memo and the server bucket. Between them the price of a search is
// proportional to what is genuinely NEW in it, which falls to nothing as the
// corpus warms: exactly the argument persistentProfileCache already makes for
// itself.

const WRITE_TIMEOUT_MS = 4000

// ── What this instance has already offered ──────────────────────────────────
//
// The freshness bucket in convex/products.ts stops the WRITE. It cannot stop
// the CALL: to reach it the writer must send the batch and the handler must
// read every row to discover there is nothing to do. Measured on a
// 1,000-product pool at 150ms latency, a hundred identical observations cost
// 1,600 round-trips, 100,000 index reads and about 2.5 seconds of after() work
// EACH — for a thousand writes that all happened on the first one.
//
// So the writer remembers what it recently put on the wire. Two layers, and
// they are not redundant:
//
//   THIS MEMO          saves a warm instance the round trip entirely. Process-
//                      local, so it knows only what THIS lambda has sent.
//   THE SERVER BUCKET  stays authoritative: it is what protects a cold
//                      instance, and two instances writing at once, neither of
//                      which this memo can see. It is unchanged.
//
// KEYED BY PRODUCT KEY, VALUED BY TIME **AND HASH**. Time alone would suppress
// a garment whose price had just changed, which is the one thing the corpus
// exists to record. A changed hash is always a miss.
//
// AND ONLY RECORDED WHEN THE WRITE SUCCEEDED. Marking a product remembered
// because we tried would leave a failed batch unretried for a quarter of an
// hour, which contradicts the bargain the rest of this file makes — that a
// product missed by one write is seen again on the next search.

/** Same interval as LAST_SEEN_BUCKET_MS in convex/products.ts, and it must
 *  stay that way: a memo that forgot sooner would spend round trips the server
 *  would refuse to act on, and one that forgot later would hold back a
 *  freshness update the server was ready to make. */
const LOCAL_BUCKET_MS = 15 * 60 * 1000

/** Ten thousand, matching enrichProduct's `mem` — the repository's largest
 *  BoundedCache and the one with the closest job: a per-product memo consulted
 *  across searches, whose comment reads "ten thousand of them is a few
 *  megabytes and covers far more than any one instance will see". The others
 *  sit at 6,000 (wornGender, palette), 4,000 (imageClassifier, product-names)
 *  and 2,000 (shipping, product-images, sizeguide).
 *
 *  Conservative in memory terms: an entry here is a timestamp and a hex digest
 *  rather than a fourteen-field GarmentProfile, so ten thousand of these cost
 *  roughly a megabyte against that precedent's several.
 *
 *  Eviction is safe by construction. A forgotten key is offered again, which
 *  is exactly what a cold instance does, and the server bucket still declines
 *  to write it. */
export const CORPUS_MEMO_MAX = 10_000

const offered = new BoundedCache<string, { at: number; hash: string }>(CORPUS_MEMO_MAX)

// ── Counters ────────────────────────────────────────────────────────────────
// Cumulative for the life of the process, like GlobalCatalogService's corpus
// observation and brandHealth's counters. SCOPED DELIBERATELY, and the names
// say which population each one measures — none of these is a catalogue census
// and none of them may be read as one:
//
//   offered / distinctKeys   per WRITE, over the pool a search assembled. A
//                            product observed by three searches is offered
//                            three times and contributes its key three times.
//                            `distinctKeys` is distinct WITHIN one write, not
//                            across the process — this module holds no set of
//                            everything it has ever seen, and claiming a
//                            unique-catalogue count would require one.
//   inserted/updated/unchanged/refreshed  as Convex reported them, which is
//                            the only place the distinction is actually known.
//                            `unchanged` is a re-observation that cost NO
//                            write at all; `refreshed` is one that crossed the
//                            freshness bucket and moved lastSeenAt.
//   quarantined              rows written with status 'quarantined'.
//   skipped                  lacking an identity. Distinct from localSkips.
//   localSkips               already offered by THIS instance, unchanged,
//                            inside the freshness bucket — so no round trip
//                            was spent. Never merged with `skipped`: one is a
//                            broken product, the other is a saving.
//   merchants                distinct merchants seen since process start —
//                            bounded by the 458-brand registry.
export type CorpusWriteObservation = {
  offered: number
  distinctKeys: number
  inserted: number
  updated: number
  unchanged: number
  refreshed: number
  quarantined: number
  skipped: number
  localSkips: number
  writeFailures: number
  batches: number
  merchants: number
}

const counters = {
  offered: 0,
  distinctKeys: 0,
  inserted: 0,
  updated: 0,
  unchanged: 0,
  refreshed: 0,
  quarantined: 0,
  skipped: 0,
  localSkips: 0,
  writeFailures: 0,
  batches: 0,
  merchants: new Set<string>(),
}

export function corpusWriteObservation(): CorpusWriteObservation {
  return {
    offered: counters.offered,
    distinctKeys: counters.distinctKeys,
    inserted: counters.inserted,
    updated: counters.updated,
    unchanged: counters.unchanged,
    refreshed: counters.refreshed,
    quarantined: counters.quarantined,
    skipped: counters.skipped,
    localSkips: counters.localSkips,
    writeFailures: counters.writeFailures,
    batches: counters.batches,
    merchants: counters.merchants.size,
  }
}

// ── The content hash ────────────────────────────────────────────────────────
/**
 * What "this garment has changed" means, defined once.
 *
 * INCLUDED — every value a merchant states or that parseProduct derives from
 * one, in a fixed order:
 *
 *   title · vendor · currency · inStock
 *   price      ONLY when there are no variants — see REDUNDANT SCALARS
 *   imageUrl   ONLY when there is no media    — see REDUNDANT SCALARS
 *   description · descriptionHtml · tags · categories
 *   options[]  { name, values[] }
 *   media[]    { type, url, alt }
 *   variants[] { id, title, price, availability, options[{name,label}], media[{url,alt}] }
 *
 * EXCLUDED, and each for a reason rather than for brevity:
 *
 *   key, merchant, sourceId   identity. They select the row; they are not its
 *                             contents, and a hash over them could never move.
 *   source.fetchedAt          a clock reading. Including it would make every
 *                             observation a change and lastChangedAt useless.
 *   via, schema               provenance about the pipeline, not the garment.
 *   display_price,
 *   display_currency          facts about a SHOPPER — see Phase 2.
 *   relevance/judge/bm25      facts about one REQUEST.
 *   status                    derived from price and URL, which are already in
 *                             the hash; hashing it too would double-count.
 *   storeUrl                  see REDUNDANT SCALARS.
 *
 * REDUNDANT SCALARS, and why hashing them made the hash wrong.
 *
 * The sorting below is defeated if a value was read off an array POSITIONALLY
 * before the sort ran, and three were. parseProduct opens with
 * `const variant = raw.variants?.[0] ?? {}` and reads `price`, `currency` and
 * `store_url` off that one positional pick; `image_url` is `raw.media[0].url`.
 * So a store returning the same unchanged garment with its variants the other
 * way round produced a different `price`, a different `store_url`, a different
 * hash, a spurious lastChangedAt and a full row rewrite — while `variants[]`,
 * sorted by id, was byte-identical. Measured, not theorised: driving the real
 * fan-out twice over one garment with only the variant order changed moved the
 * hash, `price` 4750 -> 6200 and `store_url` from one variant's URL to
 * another's. Sorting an array whose scalars have already been extracted from
 * it buys nothing.
 *
 * The fix is not to canonicalise those scalars — that would mean changing
 * which price a shopper is shown, which is a retrieval change and not this
 * one's business. It is that WHEN THE ARRAY IS PRESENT THE SCALAR IS ALREADY
 * IN THE HASH, twice over:
 *
 *   price      every variant's price is in the sorted variants[]. The scalar
 *              is one of them, chosen by position. Hashed only when `variants`
 *              is empty, where the scalar is the only price there is.
 *   imageUrl   it IS media[0].url. Hashed only when `media` is empty.
 *   storeUrl   dropped unconditionally, because there is no canonical
 *              counterpart to fall back to: CanonicalProduct.variants does not
 *              carry the per-variant URL. Identity already argues for this —
 *              catalog/product.ts opens its identity note with "A URL is not
 *              identity: parseProduct builds store_url three different ways
 *              and one of them invents it from the domain and the id." THE
 *              COST, stated rather than hidden: a merchant that changes ONLY a
 *              product's URL, moving no price, title, image or stock, no
 *              longer registers as a change.
 *
 * `currency` STAYS, positional though it is. A store quoting two currencies
 * across one product's variants is pathological, and currency is the change
 * most worth catching — it is how a localisation shift shows up at all.
 *
 * WHAT THIS DOES NOT FIX, and must not: reordering `media` still moves the
 * hash. That is not a false positive. media[0] decides the photograph the
 * shopper sees, so a store reordering it HAS changed the record. Dropping the
 * redundant `imageUrl` removes the double-count, not the signal.
 *
 * DETERMINISM, in two halves.
 *
 * Object keys look after themselves: every object below is built as a literal
 * with its keys in a fixed written order, and JSON.stringify emits string keys
 * in insertion order.
 *
 * ARRAYS DO NOT, and the first draft of this function got that wrong. It
 * hashed every array in the order the store happened to send it, so a store
 * listing the same tags in a different order — the same garment, unchanged —
 * produced a different hash, a spurious lastChangedAt and a full row rewrite.
 * That corrupts the one signal the corpus exists to record. Measured: six
 * kinds of pure reordering all moved the hash.
 *
 * So arrays are split by what they actually are:
 *
 *   SET-LIKE, sorted before hashing — order carries nothing
 *     tags          a bag of labels
 *     categories    a bag of taxonomy ids
 *     variants      identified by `id`; a store reordering them has not
 *                   changed a single garment
 *     options       identified by `name`; Size-then-Color and Color-then-Size
 *                   are the same product
 *
 *   SEQUENCE-LIKE, left exactly as sent — order IS content
 *     media         media[0] decides image_url, so reordering media changes
 *                   which photograph the shopper sees
 *     options[].values   XS,S,M,L is a size run, not a bag of labels
 *
 * Nothing else is canonicalised. Sorting an array whose order means something
 * would hide a real change, which is the same defect pointed the other way.
 *
 * sha256 rather than the sha1 profileKey uses, because these are not the same
 * job. profileKey is an index entry — short, collision-tolerable, never
 * compared for equality against an adversary. This is a change detector: a
 * collision would mean a real merchant change is invisible forever, which is
 * the one failure this field exists to prevent.
 */
export function contentHash(p: CanonicalProduct): string {
  // Copied before sorting. These arrays belong to a pooled canonical product
  // that other requests are reading; hashing must never reorder them in place.
  const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

  // Hoisted out of the literal below only so the two redundancy tests can ask
  // whether the canonical array is there. Both are built exactly as they were.
  const media = (p.media ?? []).map(m => ({ type: m.type, url: m.url, alt: m.alt ?? null }))
  const variants = [...(p.variants ?? [])]
    .map(v => ({
      id: v.id,
      title: v.title,
      price: v.price,
      availability: v.availability,
      options: [...(v.options ?? [])]
        .map(o => ({ name: o.name, label: o.label }))
        .sort((a, b) => byText(a.name, b.name)),
      media: (v.media ?? []).map(m => ({ url: m.url, alt: m.alt ?? null })),
    }))
    .sort((a, b) => byText(a.id, b.id))

  const content = {
    title: p.title,
    vendor: p.vendor,
    // null rather than an absent key, so the hashed shape is one fixed set of
    // keys whatever a merchant sent. See REDUNDANT SCALARS above for why these
    // two are conditional and why storeUrl is gone altogether.
    price: variants.length > 0 ? null : p.price,
    currency: p.currency,
    imageUrl: media.length > 0 ? null : p.image_url,
    inStock: p.in_stock,
    description: p.description ?? null,
    descriptionHtml: p.description_html ?? null,
    tags: [...(p.tags ?? [])].sort(byText),
    categories: p.categories ? [...p.categories].sort(byText) : null,
    options: [...(p.options ?? [])]
      .map(o => ({ name: o.name, values: o.values }))     // values NOT sorted
      .sort((a, b) => byText(a.name, b.name)),
    media,
    variants,
  }
  return createHash('sha256').update(JSON.stringify(content)).digest('hex')
}

// ── Status ──────────────────────────────────────────────────────────────────
/**
 * Phase 0's quality semantics, and no new ones.
 *
 * Everything Phase 0 rejects — no id, no photograph, non-fashion, off-registry
 * — never reaches this function: those products were dropped in ingest() and
 * are not in the pool. What is left is what Phase 0 calls QUARANTINABLE: a
 * record an owned corpus would hold back for review rather than serve, being
 * either unpriced or unreachable.
 *
 * It changes NOTHING about the live page. The product stays in the pool, is
 * ranked, and is shown exactly as it was before this file existed. The status
 * is a note in the corpus about a record, not a filter on a shopper.
 *
 * 'unavailable' is intentionally unreachable here. Absence from one search is a
 * fact about a query, and a dead endpoint is brand_health's business — neither
 * is evidence that a garment has been withdrawn.
 */
function statusOf(p: CanonicalProduct): 'active' | 'quarantined' {
  if (!Number.isFinite(p.price) || p.price <= 0) return 'quarantined'
  try { new URL(p.store_url) } catch { return 'quarantined' }
  return 'active'
}

type Row = {
  // merchant::sourceId::COUNTRY — see corpusRowKey. NOT CanonicalProduct.key,
  // which stays merchant::sourceId and stays on the wire product untouched.
  key: string; merchant: string; sourceId: string
  title: string; vendor: string; price: number; currency: string
  storeUrl: string; imageUrl: string; inStock: boolean
  payload: string; via: string; schema: number
  contentHash: string; status: 'active' | 'quarantined'
  // Optional on the wire for the same reason it is optional in the schema: a
  // pool seeded from search_cache was parsed before provenance existed, and
  // those rows must still be writable rather than refused. Absent means
  // unrecorded, which the operator read counts as its own answer.
  //
  // Named that way deliberately: corpus-write.js walks lib/ for the literal
  // name of that query and fails if a file here mentions it, so "no production
  // module can reach the corpus" stays a grep anyone can run. That assertion
  // caught an earlier draft of this very comment, and the comment moved.
  currencyStated?: boolean
  availabilityStated?: boolean
  vendorSource?: 'merchant' | 'domain' | 'none'
  // The country segment of the key, stored as its own column so a reader does
  // not have to parse the key to group by it. Optional for the same reason as
  // the fields above: the rows written before this existed carry none, and
  // their country was never recorded and is not recoverable.
  country?: string
}

/** No country was recorded. Two characters, and deliberately not a country:
 *  ISO-3166-1 alpha-2 is [A-Z]{2}, so this can never collide with a real one.
 *  Distinct from a row that predates country scoping entirely, which has no
 *  third segment at all. */
export const UNKNOWN_COUNTRY = '--'

/**
 * WHAT THE CORPUS FILES A GARMENT UNDER: merchant::sourceId::COUNTRY.
 *
 * CanonicalProduct.key is merchant::sourceId and is NOT touched — it is
 * stamped onto the wire product, and nothing about retrieval changes. This is
 * the corpus's own key, and the extra segment is the difference between a
 * garment and an observation of a garment.
 *
 * WHY COUNTRY AND NOT CURRENCY. Country is what we send; currency is what
 * comes back. Merchants disagree about the second under an identical request —
 * cdlp.com answered USD in the same burst that judithandcharles.com and
 * nanushka.com answered INR — so keying on the answer would let one store's
 * localisation policy fragment identity while another's did not. Country also
 * governs availability, which currency cannot express at all.
 *
 * Appended, never restructured: segment 0 is still the merchant, so anything
 * reading the first segment still reads the merchant.
 */
export function corpusRowKey(p: CanonicalProduct): string {
  return `${p.key}::${p.source.country ?? UNKNOWN_COUNTRY}`
}

function toRow(p: CanonicalProduct): Row | null {
  // An identity or nothing. A product that reached here without one is not a
  // product this corpus can file — it would land under `::` alongside every
  // other such record. In practice this only guards the pool seeded from
  // search_cache, whose rows were parsed by whatever code was deployed when
  // they were written and predate provenance entirely.
  if (!p?.key || !p.source?.merchant || !p.source?.sourceId) return null

  return {
    key: corpusRowKey(p),
    merchant: p.source.merchant,
    sourceId: p.source.sourceId,
    title: p.title,
    vendor: p.vendor,
    price: p.price,
    currency: p.currency,
    storeUrl: p.store_url,
    imageUrl: p.image_url,
    inStock: p.in_stock,
    payload: JSON.stringify({
      variants: p.variants ?? [],
      media: p.media ?? [],
      options: p.options ?? [],
      description: p.description ?? null,
      description_html: p.description_html ?? null,
      tags: p.tags ?? [],
      categories: p.categories ?? null,
    }),
    via: p.source.via,
    schema: p.source.schema,
    contentHash: contentHash(p),
    status: statusOf(p),
    // NOT hashed. contentHash is over stable merchant state; whether the
    // merchant supplied a currency is a fact about the OBSERVATION, not about
    // the garment, so a row that gains provenance does not register as a
    // change and does not cost a write. Read with `?.` because a pool seeded
    // from search_cache predates the field entirely.
    currencyStated: p.source.stated?.currency,
    availabilityStated: p.source.stated?.availability,
    vendorSource: p.source.stated?.vendor,
    // The same token the key carries, so grouping by country needs no parsing.
    // NOT in contentHash: the key already separates countries, so two of them
    // are two rows whose hashes are never compared. Putting it in the hash
    // would rewrite every row and buy nothing.
    country: p.source.country ?? UNKNOWN_COUNTRY,
  }
}

/**
 * Write what this search found, and never let it matter to the search.
 *
 * Called through runAfterResponse, NOT as a floating promise. lib/afterResponse
 * spells out why: on serverless a promise nobody awaits is frozen the instant
 * the response flushes, so work started and not declared simply stops, usually
 * mid-flight and always silently. A corpus filled that way would be filled at
 * whatever rate the runtime happened to allow.
 */
export async function writeCorpus(products: readonly CanonicalProduct[]): Promise<void> {
  if (!enabled() || !products || products.length === 0) return
  const c = client()
  const secret = process.env.CONVEX_AUTH_SECRET
  if (!c || !secret) return

  // One row per key within this write. A pool should not contain the same key
  // twice — ingest dedupes — but sending duplicates would make the mutation do
  // the same read twice and report an insert followed by an unchanged, which
  // would be a counter that lies rather than a row that breaks.
  const rows = new Map<string, Row>()
  let skipped = 0
  for (const p of products) {
    const row = toRow(p)
    if (!row) { skipped++; continue }   // no identity — the only reason to skip
    rows.set(row.key, row)
  }

  counters.offered += products.length
  counters.distinctKeys += rows.size
  counters.skipped += skipped

  // What this instance has not already said, unchanged, in the last quarter
  // of an hour. A changed hash is always a miss — see the note on `offered`.
  const now = Date.now()
  const all: Row[] = []
  for (const r of Array.from(rows.values())) {
    const held = offered.get(r.key)
    if (held && held.hash === r.contentHash && now - held.at < LOCAL_BUCKET_MS) {
      counters.localSkips++
      continue
    }
    if (r.merchant) counters.merchants.add(r.merchant)
    if (r.status === 'quarantined') counters.quarantined++
    all.push(r)
  }
  if (all.length === 0) return
  for (let i = 0; i < all.length; i += BATCH) {
    const batch = all.slice(i, i + BATCH)
    counters.batches++
    try {
      const res = (await Promise.race([
        c.mutation(anyApi.products.upsertMany, { entries: batch, serverSecret: secret }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('corpus write timed out')), WRITE_TIMEOUT_MS)),
      ])) as { ok?: boolean; inserted?: number; updated?: number; unchanged?: number; refreshed?: number } | null
      if (res && res.ok) {
        counters.inserted += res.inserted ?? 0
        counters.updated += res.updated ?? 0
        counters.unchanged += res.unchanged ?? 0
        counters.refreshed += res.refreshed ?? 0
        // Remembered only now, and only for what actually landed.
        for (const r of batch) offered.set(r.key, { at: now, hash: r.contentHash })
      } else {
        counters.writeFailures++
      }
    } catch {
      // Counted and dropped. The next search that surfaces these products
      // writes them; nothing about this page changes either way.
      counters.writeFailures++
    }
  }
}
