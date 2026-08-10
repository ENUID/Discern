import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { authProofValidator, verifyAuthProof } from "./lib/authProof";

/**
 * The bag and the recents, on the account rather than in one browser.
 *
 * These lived in localStorage, which means the same person signed in on a
 * phone, a laptop and a tablet had three separate bags and three separate
 * histories: bag a coat on the train, open the laptop at home, empty bag.
 * Deleting a recent on one device left it sitting on the other two.
 *
 * One row per account, written whole. A bag is small and is always read and
 * written in full, and a whole-document write is atomic — so two devices
 * saving at once cannot interleave into a half-merged bag. The loser of that
 * race simply reads the winner's copy on its next subscription tick, which is
 * the correct outcome for a shelf.
 */

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

export const getShelf = query({
  args: { userEmail: v.string(), authProof: authProofValidator },
  handler: async (ctx, args) => {
    if (!(await verifyAuthProof(args.authProof, args.userEmail))) return null;
    const user = await getUserByEmail(ctx, args.userEmail);
    if (!user) return null;
    const row = await ctx.db
      .query("shopper_shelf")
      .withIndex("by_user", (q: any) => q.eq("userId", user._id))
      .first();
    if (!row) return null;
    return { bag: row.bag ?? [], recents: row.recents ?? [], updatedAt: row.updatedAt };
  },
});

export const setShelf = mutation({
  args: {
    userEmail: v.string(),
    bag: v.optional(v.any()),
    recents: v.optional(v.array(v.string())),
    authProof: authProofValidator,
  },
  handler: async (ctx, args) => {
    if (!(await verifyAuthProof(args.authProof, args.userEmail))) throw new Error("Unauthorized");
    const user = await getOrCreateUser(ctx, args.userEmail);
    if (!user) throw new Error("User not found");

    const existing = await ctx.db
      .query("shopper_shelf")
      .withIndex("by_user", (q: any) => q.eq("userId", user._id))
      .first();

    // Only what was sent is replaced, so a device that only touched the bag
    // cannot blank the recents by omitting them.
    const next: any = { updatedAt: Date.now() };
    if (args.bag !== undefined) next.bag = args.bag;
    if (args.recents !== undefined) next.recents = args.recents.slice(0, 40);

    if (existing) {
      await ctx.db.patch(existing._id, next);
      return existing._id;
    }
    return ctx.db.insert("shopper_shelf", { userId: user._id, ...next });
  },
});
