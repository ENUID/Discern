import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { authProofValidator, verifyAuthProof } from "./lib/authProof";

// Cross-device sync for Fabrics conversation threads. Previously these lived
// only in localStorage (from:stylist-history / from:stylist-session:*), so a
// shopper signed into the same account on a second device saw none of their
// history. This mirrors that same per-session shape in Convex — the client
// keeps localStorage as its fast, offline-first read/write path and layers
// this on top: pushes each session here after every change (when signed in),
// and pulls on mount to backfill any sessions this device doesn't have yet.
//
// SECURITY: every function here requires authProof (see lib/authProof.ts) —
// this is real conversation content (styling requests, sizes, wardrobe
// details) plus a destructive delete, so it's the most sensitive of the
// per-user Convex tables. args.userEmail is never trusted on its own; it
// must match the independently-verified proof or the call is rejected.

async function getUserByEmail(ctx: any, email: string) {
  return ctx.db
    .query("users")
    .withIndex("by_email", (q: any) => q.eq("email", email.toLowerCase().trim()))
    .first();
}

async function getOrCreateUser(ctx: any, email: string) {
  const normalized = email.toLowerCase().trim();
  const existing = await getUserByEmail(ctx, normalized);
  if (existing) return existing;
  const id = await ctx.db.insert("users", {
    email: normalized,
    role: "buyer",
    createdAt: Date.now(),
  });
  return ctx.db.get(id);
}

// Most recent 30 sessions, newest first — same cap the client already
// applies to its own localStorage history list.
export const listStylistSessions = query({
  args: { userEmail: v.string(), authProof: authProofValidator },
  handler: async (ctx, args) => {
    if (!(await verifyAuthProof(args.authProof, args.userEmail))) return [];
    const user = await getUserByEmail(ctx, args.userEmail);
    if (!user) return [];
    // take(30), not collect() — this is a REACTIVE query that re-runs on every
    // session write, and Convex bills on documents READ, so collecting every
    // session (each carrying a full serialized conversation) just to slice 30 in
    // JS multiplied this account's read bandwidth by however many sessions it
    // had. Bounded at the same 30 the client shows.
    const rows = await ctx.db
      .query("stylist_sessions")
      .withIndex("by_user", (q: any) => q.eq("userId", user._id))
      .order("desc")
      .take(30);
    return rows
      .sort((a: any, b: any) => b.updatedAt - a.updatedAt)
      .map((r: any) => ({ sessionId: r.sessionId, label: r.label, messages: r.messages, createdAt: r.createdAt, updatedAt: r.updatedAt }));
  },
});

export const upsertStylistSession = mutation({
  args: {
    userEmail: v.string(),
    sessionId: v.string(),
    label: v.string(),
    messages: v.string(),
    authProof: authProofValidator,
  },
  handler: async (ctx, args) => {
    if (!(await verifyAuthProof(args.authProof, args.userEmail))) return;
    const user = await getOrCreateUser(ctx, args.userEmail);
    if (!user) return;
    const existing = await ctx.db
      .query("stylist_sessions")
      .withIndex("by_user_session", (q: any) => q.eq("userId", user._id).eq("sessionId", args.sessionId))
      .first();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { label: args.label, messages: args.messages, updatedAt: now });
    } else {
      await ctx.db.insert("stylist_sessions", {
        userId: user._id, sessionId: args.sessionId, label: args.label, messages: args.messages,
        createdAt: now, updatedAt: now,
      });
    }
  },
});

export const deleteStylistSession = mutation({
  args: { userEmail: v.string(), sessionId: v.string(), authProof: authProofValidator },
  handler: async (ctx, args) => {
    if (!(await verifyAuthProof(args.authProof, args.userEmail))) return;
    const user = await getUserByEmail(ctx, args.userEmail);
    if (!user) return;
    const existing = await ctx.db
      .query("stylist_sessions")
      .withIndex("by_user_session", (q: any) => q.eq("userId", user._id).eq("sessionId", args.sessionId))
      .first();
    if (existing) await ctx.db.delete(existing._id);
  },
});
