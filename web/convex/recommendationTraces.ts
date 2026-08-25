import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { verifyServerSecret } from "./lib/serverAuth";

/**
 * The record of one recommendation, kept long enough to answer a question
 * about it and no longer.
 */

/** Two weeks. Long enough that "it did something odd last Tuesday" is still
 *  answerable, short enough that this never becomes a second database. */
const TTL_MS = 14 * 24 * 60 * 60 * 1000;

export const record = mutation({
  args: {
    traceId: v.string(),
    question: v.string(),
    trace: v.string(),
    degraded: v.boolean(),
    serverSecret: v.string(),
  },
  handler: async (ctx, args) => {
    if (!verifyServerSecret(args.serverSecret)) return { ok: false };
    await ctx.db.insert("recommendation_traces", {
      traceId: args.traceId,
      question: args.question,
      trace: args.trace,
      degraded: args.degraded,
      createdAt: Date.now(),
    });
    return { ok: true };
  },
});

/** One trace by id. */
export const get = query({
  args: { traceId: v.string(), serverSecret: v.string() },
  handler: async (ctx, args) => {
    if (!verifyServerSecret(args.serverSecret)) return null;
    const row = await ctx.db
      .query("recommendation_traces")
      .withIndex("by_trace", (q) => q.eq("traceId", args.traceId))
      .first();
    if (!row) return null;
    if (Date.now() - row.createdAt > TTL_MS) return null;
    return { traceId: row.traceId, question: row.question, trace: row.trace, createdAt: row.createdAt };
  },
});

/** The most recent, newest first — what an admin view opens on. `degradedOnly`
 *  because the interesting ones are almost always the ones that went wrong. */
export const recent = query({
  args: {
    limit: v.optional(v.number()),
    degradedOnly: v.optional(v.boolean()),
    serverSecret: v.string(),
  },
  handler: async (ctx, args) => {
    if (!verifyServerSecret(args.serverSecret)) return [];
    const take = Math.min(Math.max(args.limit ?? 25, 1), 100);
    const rows = await ctx.db
      .query("recommendation_traces")
      .withIndex("by_created")
      .order("desc")
      .take(args.degradedOnly ? take * 4 : take);
    return rows
      .filter((r) => (args.degradedOnly ? r.degraded : true))
      .slice(0, take)
      .map((r) => ({
        traceId: r.traceId,
        question: r.question,
        degraded: r.degraded,
        createdAt: r.createdAt,
        trace: r.trace,
      }));
  },
});

/** Housekeeping — called by the retention cron alongside the other tables. */
export const prune = mutation({
  args: { serverSecret: v.string() },
  handler: async (ctx, args) => {
    if (!verifyServerSecret(args.serverSecret)) return { deleted: 0 };
    const cutoff = Date.now() - TTL_MS;
    const stale = await ctx.db
      .query("recommendation_traces")
      .withIndex("by_created")
      .order("asc")
      .take(200);
    let deleted = 0;
    for (const row of stale) {
      if (row.createdAt >= cutoff) break;
      await ctx.db.delete(row._id);
      deleted++;
    }
    return { deleted };
  },
});
