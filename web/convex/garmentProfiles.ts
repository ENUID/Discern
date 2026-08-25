import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { verifyServerSecret } from "./lib/serverAuth";

/**
 * Garment profiles that survive a cold start.
 *
 * Read and written in BATCHES on purpose. A single outfit request profiles
 * around eighteen garments, and eighteen round trips would cost more than the
 * vision call this exists to avoid. One query in, one mutation out.
 *
 * There is no TTL. A garment does not become a different garment, and the key
 * already carries the schema, prompt and model versions — so a change to any
 * of those stops addressing the old rows rather than requiring them to expire.
 */

/** Every profile we already hold, of the ones asked for. Missing keys are
 *  simply absent from the result; the caller reads that as "not seen yet". */
export const getMany = query({
  args: { keys: v.array(v.string()), serverSecret: v.string() },
  handler: async (ctx, args) => {
    if (!verifyServerSecret(args.serverSecret)) return [];
    // Bounded: a caller asking for a thousand keys is a bug, not a batch.
    const keys = args.keys.slice(0, 64);
    const out: { key: string; profile: string }[] = [];
    for (const key of keys) {
      const row = await ctx.db
        .query("garment_profiles")
        .withIndex("by_key", (q) => q.eq("key", key))
        .first();
      if (row) out.push({ key: row.key, profile: row.profile });
    }
    return out;
  },
});

/** Store what was just read. Best-effort; the caller ignores failures, because
 *  a profile that failed to save is only a profile that will be read again. */
export const setMany = mutation({
  args: {
    entries: v.array(v.object({
      key: v.string(),
      productId: v.string(),
      profile: v.string(),
    })),
    serverSecret: v.string(),
  },
  handler: async (ctx, args) => {
    if (!verifyServerSecret(args.serverSecret)) return { ok: false, written: 0 };
    let written = 0;
    for (const e of args.entries.slice(0, 64)) {
      const existing = await ctx.db
        .query("garment_profiles")
        .withIndex("by_key", (q) => q.eq("key", e.key))
        .first();
      if (existing) {
        await ctx.db.patch(existing._id, { profile: e.profile, createdAt: Date.now() });
      } else {
        await ctx.db.insert("garment_profiles", {
          key: e.key,
          productId: e.productId,
          profile: e.profile,
          createdAt: Date.now(),
        });
      }
      written++;
    }
    return { ok: true, written };
  },
});
