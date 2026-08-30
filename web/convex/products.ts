import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { verifyServerSecret } from "./lib/serverAuth";
import { verifyAdminSecret } from "./lib/adminAuth";

/**
 * The owned product corpus — one write, one read, and the read is not for the
 * shopper.
 *
 * THIS FILE USED TO SAY "there is no query here, and that is the design rather
 * than an omission" — the guarantee being that nothing the corpus holds could
 * reach a page, made true by there being nothing to call. That sentence also
 * said a later phase would add a read "deliberately, with its own tests". This
 * is that phase, so the sentence is being honoured rather than quietly
 * deleted.
 *
 * WHAT CHANGED, AND WHAT DID NOT. `inspect` below is guarded by ADMIN_SECRET,
 * the same gate analytics.ts and learningInsights.ts already use for reads
 * about other people's data, and it is not importable from anywhere a shopper's
 * request can reach: scripts/corpus-inspect.js asserts that no file under
 * app/, lib/ or features/ mentions it. Retrieval, ranking, filtering and the
 * writer are all exactly as they were. The corpus still cannot influence a
 * page; it can now be looked at by whoever holds the operator secret.
 *
 * WHY A READ WAS NEEDED AT ALL. The table was committed and CI-green and had
 * never been deployed — convex-deploy.yml did not list this branch — so the
 * corpus was provably empty and nothing in the repository could say so. A
 * write-only store that cannot be observed is indistinguishable from one that
 * is not working.
 *
 * UPSERT BY read-then-patch-or-insert, because Convex has no unique constraint
 * to lean on. This is the same shape garmentProfiles.setMany and searchCache.set
 * already use: look the row up on its index, patch it if it is there, insert it
 * if it is not. One index read per product is the cost of that, and it is why
 * the caller batches.
 *
 * BOUNDED AT 64 per call, matching garmentProfiles.getMany/setMany. A caller
 * asking to write a thousand products in one mutation is a bug rather than a
 * batch, and Convex mutations are transactional and time-bounded — a long one
 * is a long transaction.
 *
 * BEST-EFFORT BY CONTRACT. The caller ignores what comes back except to count
 * it. A product that failed to store is a product that will be seen again on
 * the next search that surfaces it, which is the same bargain
 * persistentProfileCache and persistentSearchCache already make.
 */
/**
 * How often a re-observation is worth a write.
 *
 * DERIVED, NOT CHOSEN. GlobalCatalogService caches a search's product pool for
 * CACHE_TTL_MS = 15 minutes (convex/searchCache.ts enforces the same 15 on the
 * persistent copy). A repeated identical search inside that window is answered
 * from the cached pool without contacting a single store — so a lastSeenAt
 * written inside it records a CACHE HIT, not a sighting of the garment. Fifteen
 * minutes is therefore the exact floor below which a freshness write carries no
 * information at all, and every write at or above it corresponds to a genuine
 * re-fetch from the merchant.
 *
 * Measured before this existed: ten identical warm searches produced forty
 * mutations and 2,560 row writes for 256 garments, none of which learned
 * anything. Now they produce none.
 *
 * IT DOES NOT COLLAPSE lastSeenAt INTO lastChangedAt. The two still answer
 * different questions — "when did a merchant last confirm this garment exists"
 * versus "when did its price, title or stock last move" — and a garment that
 * has not changed in a year still has its lastSeenAt refreshed every fifteen
 * minutes it is genuinely fetched. Only the duplicate writes are gone, and
 * `by_last_seen` keeps meaning what it says: everything a future staleness
 * sweep needs is accurate to within one search-cache lifetime.
 */
const LAST_SEEN_BUCKET_MS = 15 * 60 * 1000;

export const upsertMany = mutation({
  args: {
    entries: v.array(v.object({
      key: v.string(),
      merchant: v.string(),
      sourceId: v.string(),
      title: v.string(),
      vendor: v.string(),
      price: v.number(),
      currency: v.string(),
      storeUrl: v.string(),
      imageUrl: v.string(),
      inStock: v.boolean(),
      payload: v.string(),
      via: v.string(),
      schema: v.number(),
      contentHash: v.string(),
      // Which normalisations the merchant actually supplied. Optional so a
      // writer that has not been redeployed yet is still accepted — a row
      // arriving without them records "unrecorded" rather than being refused.
      currencyStated: v.optional(v.boolean()),
      availabilityStated: v.optional(v.boolean()),
      vendorSource: v.optional(v.union(v.literal("merchant"), v.literal("domain"), v.literal("none"))),
      country: v.optional(v.string()),
      requestedCurrency: v.optional(v.string()),
      status: v.union(v.literal("active"), v.literal("quarantined")),
    })),
    serverSecret: v.string(),
  },
  handler: async (ctx, args) => {
    if (!verifyServerSecret(args.serverSecret)) {
      return { ok: false, inserted: 0, updated: 0, unchanged: 0, refreshed: 0 };
    }

    let inserted = 0, updated = 0, unchanged = 0, refreshed = 0;
    const now = Date.now();

    for (const e of args.entries.slice(0, 64)) {
      const held = await ctx.db
        .query("products")
        .withIndex("by_key", (q) => q.eq("key", e.key))
        .first();

      if (!held) {
        await ctx.db.insert("products", {
          ...e,
          firstSeenAt: now,
          lastSeenAt: now,
          lastChangedAt: now,
        });
        inserted++;
        continue;
      }

      // Seen again, and the merchant has not moved. The only thing that could
      // be newly true is that the garment still exists — and inside the
      // freshness bucket even that is not news, because a search repeated
      // within it never asked a store. So: nothing at all is written.
      //
      // lastChangedAt is not touched on either branch. It must not drift on a
      // re-observation, or it stops meaning "when this garment last changed"
      // and starts meaning "when we last looked", which is what lastSeenAt is
      // already for.
      if (held.contentHash === e.contentHash) {
        if (now - held.lastSeenAt < LAST_SEEN_BUCKET_MS) {
          unchanged++;
          continue;
        }
        await ctx.db.patch(held._id, { lastSeenAt: now });
        refreshed++;
        continue;
      }

      // The merchant moved. Current state and payload are replaced; identity
      // is not. `key`, `merchant` and `sourceId` are re-sent identical by the
      // writer and firstSeenAt is deliberately absent from the patch — a
      // garment does not acquire a new birthday because its price changed.
      await ctx.db.patch(held._id, {
        title: e.title,
        vendor: e.vendor,
        price: e.price,
        currency: e.currency,
        storeUrl: e.storeUrl,
        imageUrl: e.imageUrl,
        inStock: e.inStock,
        payload: e.payload,
        via: e.via,
        schema: e.schema,
        contentHash: e.contentHash,
        // Provenance travels with the state it describes. A merchant that
        // starts sending a currency it previously omitted has changed what we
        // know, and the row should stop claiming otherwise — though this is
        // not in the hash and never on its own causes a write. When the writer
        // sends nothing, patching undefined clears the field, which is the
        // honest reading: unrecorded, not false.
        currencyStated: e.currencyStated,
        availabilityStated: e.availabilityStated,
        vendorSource: e.vendorSource,
        // Re-sent identical by the writer — the country is part of the key, so
        // a row can never change country without becoming a different row. The
        // requested currency is the same kind of fact: it is either the fourth
        // key segment or the default that omits it, so a row cannot change it
        // without becoming a different row either.
        country: e.country,
        requestedCurrency: e.requestedCurrency,
        status: e.status,
        lastSeenAt: now,
        lastChangedAt: now,
      });
      updated++;
    }

    return { ok: true, inserted, updated, unchanged, refreshed };
  },
});

// ── Inspection ──────────────────────────────────────────────────────────────

/** Bounded like every other admin read in this schema — analytics.ts uses 3000
 *  for user_events, saved_products, quality_signals and users alike, and
 *  reports `capped` when it hits it. A corpus that outgrows this is read in
 *  windows, never in one unbounded scan. */
const INSPECT_SCAN_CAP = 3000;

/** The rows handed back for eye-inspection. Deliberately far below the scan
 *  cap: this is for looking at, not for exporting. */
const SAMPLE_CAP = 100;

/** Parsing `payload` is the only expensive thing here — a few kilobytes of
 *  JSON per row — so it happens for the sample alone and the proportions it
 *  yields are labelled as sample-derived rather than passed off as corpus-wide. */
const PAYLOAD_SAMPLE = SAMPLE_CAP;

function idShapeOf(id: string): "gid" | "numeric" | "other" {
  if (id.startsWith("gid://")) return "gid";
  return /^\d+$/.test(id) ? "numeric" : "other";
}

const bump = (m: Record<string, number>, k: string) => { m[k] = (m[k] ?? 0) + 1; };

/**
 * What the corpus currently holds, for an operator.
 *
 * READ-ONLY, ADMIN-GUARDED, AND BOUNDED. It walks `by_last_seen` — an index,
 * newest first, so the ordering is deterministic and the read is a bounded
 * index range rather than a table scan — and stops at INSPECT_SCAN_CAP.
 * Everything it reports is therefore "of the most recently seen N rows", and
 * `capped` says whether N was the limit. It does not return `payload`: the
 * three proportions that need it are computed here, over the sample, and the
 * bytes stay on the server.
 *
 * NOT A CATALOGUE, and nothing this returns should be described as one. The
 * corpus is an accumulated, demand-shaped, latency-biased sample of the
 * post-dedupe pool — stores slower than STORE_SOFT_MS never reach the write
 * seam, load-more and cache-seeded searches are excluded, and brands no query
 * selects are never fetched. `total` below is rows observed, not garments that
 * exist.
 */
export const inspect = query({
  args: { adminSecret: v.string(), sampleSize: v.optional(v.number()) },
  handler: async (ctx, args) => {
    if (!verifyAdminSecret(args.adminSecret)) return null;

    const rows = await ctx.db
      .query("products")
      .withIndex("by_last_seen")
      .order("desc")
      .take(INSPECT_SCAN_CAP);

    const byStatus: Record<string, number> = {};
    const byVia: Record<string, number> = {};
    const bySchema: Record<string, number> = {};
    const byIdShape: Record<string, number> = { gid: 0, numeric: 0, other: 0 };
    const merchants = new Set<string>();
    const perMerchant: Record<string, number> = {};
    const sourceIdMerchants: Record<string, string[]> = {};
    const imageCounts: Record<string, number> = {};
    const titleCounts: Record<string, number> = {};

    let inStock = 0;
    let firstSeenMin = Infinity, firstSeenMax = -Infinity;
    let lastSeenMin = Infinity, lastSeenMax = -Infinity;
    let lastChangedMin = Infinity, lastChangedMax = -Infinity;
    let defaultedCurrency = 0, defaultedTitle = 0, defaultedVendor = 0, unpriced = 0;
    // What the merchant actually supplied, from each row's own provenance
    // rather than by re-reading the value. `currencyUSD` below cannot answer
    // this — 'USD' is 'USD' either way — and vendorIndependent measured a
    // sentinel the domain fallback almost never lets happen. `unrecorded` is
    // rows written before provenance existed; folding them into either answer
    // would be inventing a fact about them.
    const currencySource = { stated: 0, defaultedUSD: 0, unrecorded: 0 };
    const availabilitySource = { stated: 0, assumedInStock: 0, unrecorded: 0 };
    const vendorSourceCounts = { merchant: 0, domain: 0, none: 0, unrecorded: 0 };
    // Rows per observation country. `unscoped` is the legacy shape: written
    // before country scoping, two-segment key, no country ever recorded.
    // Counted separately rather than guessed at.
    const byCountry: Record<string, number> = {};
    const byRequestedCurrency: Record<string, number> = {};

    for (const r of rows) {
      bump(byStatus, r.status);
      bump(byVia, r.via);
      bump(bySchema, String(r.schema));
      bump(byIdShape, idShapeOf(r.sourceId));
      merchants.add(r.merchant);
      bump(perMerchant, r.merchant);

      const seen = sourceIdMerchants[r.sourceId] ?? [];
      if (!seen.includes(r.merchant)) seen.push(r.merchant);
      sourceIdMerchants[r.sourceId] = seen;

      if (r.imageUrl) bump(imageCounts, r.imageUrl);
      bump(titleCounts, r.title.toLowerCase().replace(/\s+/g, " ").trim());

      if (r.inStock) inStock++;
      // The defaults parseProduct applies when a merchant said nothing. They
      // are indistinguishable from real values in the row, so counting the
      // sentinels is the only visibility there is.
      if (r.currency === "USD") defaultedCurrency++;
      if (r.title === "Untitled") defaultedTitle++;
      if (r.vendor === "Independent") defaultedVendor++;
      if (!(r.price > 0)) unpriced++;

      if (r.currencyStated === undefined) currencySource.unrecorded++;
      else if (r.currencyStated) currencySource.stated++;
      else currencySource.defaultedUSD++;

      if (r.availabilityStated === undefined) availabilitySource.unrecorded++;
      else if (r.availabilityStated) availabilitySource.stated++;
      else availabilitySource.assumedInStock++;

      if (r.vendorSource === undefined) vendorSourceCounts.unrecorded++;
      else bump(vendorSourceCounts as Record<string, number>, r.vendorSource);

      bump(byCountry, r.country === undefined ? "unscoped" : r.country);
      // The currency we ASKED in, never the one the merchant answered with.
      // `unrecorded` is a row written before the field existed and is NOT the
      // same answer as "USD" — the key omits the segment for both, so this
      // column is the only place the two can be told apart.
      bump(byRequestedCurrency, r.requestedCurrency === undefined ? "unrecorded" : r.requestedCurrency);

      if (r.firstSeenAt < firstSeenMin) firstSeenMin = r.firstSeenAt;
      if (r.firstSeenAt > firstSeenMax) firstSeenMax = r.firstSeenAt;
      if (r.lastSeenAt < lastSeenMin) lastSeenMin = r.lastSeenAt;
      if (r.lastSeenAt > lastSeenMax) lastSeenMax = r.lastSeenAt;
      if (r.lastChangedAt < lastChangedMin) lastChangedMin = r.lastChangedAt;
      if (r.lastChangedAt > lastChangedMax) lastChangedMax = r.lastChangedAt;
    }

    const wanted = Math.max(0, Math.min(args.sampleSize ?? SAMPLE_CAP, SAMPLE_CAP));
    const sampleRows = rows.slice(0, wanted);

    let withVariants = 0, withCategories = 0, withDescription = 0;
    for (const r of rows.slice(0, PAYLOAD_SAMPLE)) {
      try {
        const p = JSON.parse(r.payload) as {
          variants?: unknown[]; categories?: unknown[] | null; description?: string | null;
        };
        if (Array.isArray(p.variants) && p.variants.length > 0) withVariants++;
        if (Array.isArray(p.categories) && p.categories.length > 0) withCategories++;
        if (typeof p.description === "string" && p.description.length > 0) withDescription++;
      } catch { /* an unreadable payload is one row, not a failed inspection */ }
    }
    const payloadScanned = Math.min(rows.length, PAYLOAD_SAMPLE);

    return {
      stats: {
        // Rows EXAMINED by this bounded scan — "of the most recently seen
        // INSPECT_SCAN_CAP", never a census. `capped` says whether the cap was
        // the reason the number stopped where it did.
        total: rows.length,
        capped: rows.length >= INSPECT_SCAN_CAP,
        byStatus, byVia, bySchema, byIdShape, byCountry, byRequestedCurrency,
        distinctMerchants: merchants.size,
        perMerchant,
        inStock,
        firstSeenAt: rows.length ? { min: firstSeenMin, max: firstSeenMax } : null,
        lastSeenAt: rows.length ? { min: lastSeenMin, max: lastSeenMax } : null,
        lastChangedAt: rows.length ? { min: lastChangedMin, max: lastChangedMax } : null,
        duplicateSourceIdsAcrossMerchants:
          Object.values(sourceIdMerchants).filter((m) => m.length > 1).length,
        duplicateImageUrls: Object.values(imageCounts).filter((n) => n > 1).length,
        duplicateTitles: Object.values(titleCounts).filter((n) => n > 1).length,
        defaulted: {
          // Rows whose stored value EQUALS the sentinel. `currencyUSD` counts
          // stated dollars and defaulted ones alike, which is exactly why
          // `provenance` below exists. vendorIndependent is GONE: it counted a
          // branch the domain fallback pre-empts, so it read 0 while the
          // fallback ran on every row.
          currencyUSD: defaultedCurrency,
          titleUntitled: defaultedTitle,
          unpriced,
        },
        // WHAT THE MERCHANT ACTUALLY SAID, read from each row's recorded
        // provenance rather than re-derived from the value. This is the
        // counter that can tell a garment priced in dollars from one whose
        // price carries no currency at all, and a brand name from a
        // title-cased domain token wearing one.
        provenance: {
          currency: currencySource,
          availability: availabilitySource,
          vendor: vendorSourceCounts,
        },
        payloadSample: { scanned: payloadScanned, withVariants, withCategories, withDescription },
      },
      sample: sampleRows.map((r) => ({
        key: r.key, merchant: r.merchant, sourceId: r.sourceId,
        title: r.title, vendor: r.vendor, price: r.price, currency: r.currency,
        storeUrl: r.storeUrl, imageUrl: r.imageUrl, inStock: r.inStock,
        via: r.via, schema: r.schema,
        firstSeenAt: r.firstSeenAt, lastSeenAt: r.lastSeenAt, lastChangedAt: r.lastChangedAt,
        contentHash: r.contentHash, status: r.status,
      })),
    };
  },
});
