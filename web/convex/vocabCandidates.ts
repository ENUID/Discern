import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { verifyServerSecret } from "./lib/serverAuth";

/**
 * Vocabulary-miss capture and review.
 *
 * The garment/colour/material dictionaries in lib/queryParser.ts and
 * lib/intentCompiler.ts are hand-curated on purpose: zero latency, zero
 * dependencies, and no way for a bad synonym to quietly wreck matching. The
 * cost of that is they only learn when a human notices something missing.
 *
 * This table closes the observation half of that loop without touching the
 * decision half. The stylist route records queries the vocabulary could not
 * read; a weekly cron proposes canonical mappings; a human approves or rejects
 * at /admin/vocab. NOTHING here is read by live search — approving a row is a
 * recorded decision that justifies a reviewed edit to the dictionary files, not
 * a runtime switch.
 *
 * Server-to-server only, gated on serverSecret like every other internal table.
 */

/** Longest phrase we'll store. Anything beyond this is a sentence, not a term,
 *  and clusters badly. */
const MAX_PHRASE = 60;

/** Strip punctuation and collapse whitespace, but keep letters of every script
 *  — a lot of the catalogue is Indian wear, so an ASCII-only filter would
 *  quietly drop exactly the terms most likely to be missing. Deliberately a
 *  punctuation blocklist rather than a letter allowlist: unicode property
 *  escapes need an es6+ target, which this Convex tsconfig doesn't set. */
function normalise(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=_`~()\[\]"?<>|\\+@]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_PHRASE);
}

/** Record one miss. Idempotent per phrase — repeats bump `count`, which is what
 *  the review page sorts on, so a one-off typo never outranks a real gap. */
export const recordMiss = mutation({
  args: {
    phrase: v.string(),
    reason: v.string(),
    serverSecret: v.string(),
  },
  handler: async (ctx, args) => {
    if (!verifyServerSecret(args.serverSecret)) return { ok: false };
    const phrase = normalise(args.phrase);
    if (phrase.length < 3) return { ok: false, skipped: "too-short" };

    const now = Date.now();
    const existing = await ctx.db
      .query("vocab_candidates")
      .withIndex("by_phrase", (q) => q.eq("phrase", phrase))
      .first();

    if (existing) {
      // A phrase already ruled on stays ruled on; re-seeing it only updates
      // recency and volume, so a rejected term can't creep back into the queue.
      await ctx.db.patch(existing._id, {
        count: existing.count + 1,
        lastSeenAt: now,
      });
      return { ok: true, count: existing.count + 1 };
    }

    await ctx.db.insert("vocab_candidates", {
      phrase,
      count: 1,
      firstSeenAt: now,
      lastSeenAt: now,
      reason: args.reason.slice(0, 24),
      status: "new",
    });
    return { ok: true, count: 1 };
  },
});

/** Unreviewed misses, most frequent first — the cron's input and the review
 *  page's queue. */
export const listCandidates = query({
  args: {
    status: v.optional(v.string()),
    limit: v.optional(v.number()),
    serverSecret: v.string(),
  },
  handler: async (ctx, args) => {
    if (!verifyServerSecret(args.serverSecret)) return [];
    const status = args.status ?? "new";
    const rows = await ctx.db
      .query("vocab_candidates")
      .withIndex("by_status", (q) => q.eq("status", status))
      .collect();
    return rows
      .sort((a, b) => b.count - a.count || b.lastSeenAt - a.lastSeenAt)
      .slice(0, Math.min(args.limit ?? 100, 300))
      .map((r) => ({
        id: r._id,
        phrase: r.phrase,
        count: r.count,
        reason: r.reason,
        suggestion: r.suggestion ?? null,
        status: r.status,
        firstSeenAt: r.firstSeenAt,
        lastSeenAt: r.lastSeenAt,
      }));
  },
});

/** Attach the cron's proposed canonical mapping to a phrase. */
export const setSuggestion = mutation({
  args: {
    phrase: v.string(),
    suggestion: v.string(),
    serverSecret: v.string(),
  },
  handler: async (ctx, args) => {
    if (!verifyServerSecret(args.serverSecret)) return { ok: false };
    const row = await ctx.db
      .query("vocab_candidates")
      .withIndex("by_phrase", (q) => q.eq("phrase", normalise(args.phrase)))
      .first();
    if (!row || row.status !== "new") return { ok: false };
    await ctx.db.patch(row._id, { suggestion: args.suggestion.slice(0, 120) });
    return { ok: true };
  },
});

/** Record a human decision. This closes the row; it changes no search
 *  behaviour. The dictionary edit remains a reviewed code change. */
export const reviewCandidate = mutation({
  args: {
    id: v.id("vocab_candidates"),
    status: v.string(),
    reviewedBy: v.optional(v.string()),
    serverSecret: v.string(),
  },
  handler: async (ctx, args) => {
    if (!verifyServerSecret(args.serverSecret)) return { ok: false };
    if (args.status !== "approved" && args.status !== "rejected") {
      return { ok: false, error: "status must be approved or rejected" };
    }
    const row = await ctx.db.get(args.id);
    if (!row) return { ok: false, error: "not found" };
    await ctx.db.patch(args.id, {
      status: args.status,
      reviewedAt: Date.now(),
      reviewedBy: args.reviewedBy?.slice(0, 120),
    });
    return { ok: true };
  },
});

/** Drop reviewed rows older than the cutoff so the table stays small. Approved
 *  rows are kept longer than rejected ones — they're the evidence trail for a
 *  dictionary edit that may not have happened yet. */
export const pruneReviewed = mutation({
  args: { cutoff: v.number(), serverSecret: v.string() },
  handler: async (ctx, args) => {
    if (!verifyServerSecret(args.serverSecret)) return { ok: false, deleted: 0 };
    const rejected = await ctx.db
      .query("vocab_candidates")
      .withIndex("by_status", (q) => q.eq("status", "rejected"))
      .collect();
    let deleted = 0;
    for (const row of rejected) {
      if ((row.reviewedAt ?? row.lastSeenAt) < args.cutoff) {
        await ctx.db.delete(row._id);
        deleted++;
      }
    }
    return { ok: true, deleted };
  },
});
