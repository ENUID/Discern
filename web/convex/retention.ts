import { mutation } from "./_generated/server";
import { v } from "convex/values";

// Data retention — deletes analytics events older than a cutoff.
//
// Why this exists: user_events is by far the fastest-growing table (a row per
// search, per impression batch, per product view, per AI call) and it is only
// ever read by the admin dashboard over a trailing window. Rows older than that
// window are dead weight that costs twice: Database STORAGE continuously, and
// Database I/O every time a dashboard query scans past them.
//
// Storage is a current-state metric, so pruning lowers it immediately — unlike
// I/O, which is cumulative for the billing period. The aggregates the learning
// loop depends on (relevance_adjustments, trend_concepts, taste_profile) are
// derived and stored separately, so trimming raw events never erases what the
// system has already learned.
//
// Deliberately batched and idempotent: Convex mutations are transactional and
// time-bounded, so this deletes at most `limit` rows per call and reports
// whether more remain. The caller (app/api/cron/retention) loops until done.
export const pruneOldEvents = mutation({
  args: {
    serverSecret: v.string(),
    olderThanMs: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (!process.env.CONVEX_AUTH_SECRET || args.serverSecret !== process.env.CONVEX_AUTH_SECRET) {
      return { ok: false, reason: "unauthorized", deleted: 0, more: false };
    }
    const cutoff = Date.now() - args.olderThanMs;
    const limit = Math.max(1, Math.min(args.limit ?? 500, 2000));
    // Oldest-first over the time index, bounded — never a full-table scan.
    const rows = await ctx.db
      .query("user_events")
      .withIndex("by_created", (q) => q.lt("createdAt", cutoff))
      .take(limit);
    for (const r of rows) await ctx.db.delete(r._id);
    return { ok: true, deleted: rows.length, more: rows.length === limit };
  },
});
