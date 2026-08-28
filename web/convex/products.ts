import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { verifyServerSecret } from "./lib/serverAuth";

/**
 * The owned product corpus — writes only.
 *
 * THERE IS NO QUERY IN THIS FILE, and that is the design rather than an
 * omission. This phase's hardest guarantee is that nothing the corpus holds can
 * reach a shopper: no ranking may read it, no filter may consult it, no
 * retrieval path may fall back to it. Exporting no read function makes that
 * true by construction — there is nothing to call — instead of true by
 * everybody remembering. A later phase that genuinely needs to read the corpus
 * adds the query then, deliberately, with its own tests.
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
      status: v.union(v.literal("active"), v.literal("quarantined"), v.literal("unavailable")),
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
        status: e.status,
        lastSeenAt: now,
        lastChangedAt: now,
      });
      updated++;
    }

    return { ok: true, inserted, updated, unchanged, refreshed };
  },
});
