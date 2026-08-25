import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    email: v.string(),
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    role: v.optional(v.literal("buyer")),
    passwordHash: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    // Consent
    consentAnalytics: v.optional(v.boolean()),
    consentLocation: v.optional(v.boolean()),
    consentGivenAt: v.optional(v.number()),
    // Geo + device (collected after consent)
    country: v.optional(v.string()),
    countryCode: v.optional(v.string()),
    city: v.optional(v.string()),
    timezone: v.optional(v.string()),
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
    deviceType: v.optional(v.string()),   // "mobile" | "tablet" | "desktop"
    browser: v.optional(v.string()),
    os: v.optional(v.string()),
    language: v.optional(v.string()),
    ipAddress: v.optional(v.string()),
    lastSeenAt: v.optional(v.number()),
  }).index("by_email", ["email"]),

  saved_products: defineTable({
    userId: v.id("users"),
    product: v.any(),
    savedAt: v.number(),
    // The search query that produced this product, when known — an implicit
    // "good match" signal read by the quality-feedback cron (a save is a much
    // stronger relevance signal than a view, and this is what actually links
    // it back to the query/concept that surfaced it). Absent for saves with
    // no message context (e.g. from the detail sheet outside a search reply).
    query: v.optional(v.string()),
  }).index("by_user", ["userId"])
    .index("by_user_product", ["userId", "product.id"]),

  // ── One shelf per account, shared by every device ────────────────────────
  // The bag and the recents lived in the browser, so the same person signed in
  // on a phone, a laptop and a tablet had three different bags and three
  // different histories. Bagging a coat on the train and opening the laptop at
  // home showed an empty bag.
  //
  // One row, replaced whole on each write rather than a row per line: a bag is
  // small, it is always read and written in full, and a document write is
  // atomic — which means two devices cannot interleave into a half-merged bag.
  // `updatedAt` is what lets a device tell a stale local copy from a fresh one.
  shopper_shelf: defineTable({
    userId: v.id("users"),
    /** Cart lines, exactly as the interface holds them. */
    bag: v.optional(v.any()),
    /** Questions asked, newest first. */
    recents: v.optional(v.array(v.string())),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),

  search_history: defineTable({
    userId: v.id("users"),
    query: v.string(),
    resultCount: v.number(),
    createdAt: v.number(),
  }).index("by_user", ["userId"])
    // Time-window reads (recent-searches / trend cron) range on this instead of
    // scanning the whole table when a low-traffic window never fills the .take.
    .index("by_created", ["createdAt"]),

  subscriptions: defineTable({
    userId: v.id("users"),
    plan: v.union(v.literal("free"), v.literal("premium")),
    stripeCustomerId: v.optional(v.string()),
    stripeSubscriptionId: v.optional(v.string()),
    currentPeriodEnd: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_user", ["userId"])
    .index("by_stripe_customer", ["stripeCustomerId"])
    .index("by_stripe_subscription", ["stripeSubscriptionId"]),

  taste_profile: defineTable({
    userId: v.id("users"),
    styles: v.optional(v.array(v.string())),
    budgetMin: v.optional(v.number()),
    budgetMax: v.optional(v.number()),
    currency: v.optional(v.string()),
    sizes: v.optional(v.any()),
    colors: v.optional(v.array(v.string())),
    occasions: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
    wardrobe: v.optional(v.object({
      items: v.array(v.object({
        type: v.string(),
        color: v.string(),
        style: v.string(),
        occasions: v.array(v.string()),
      })),
      summary: v.string(),
      gaps: v.array(v.string()),
      analyzedAt: v.number(),
    })),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),

  stylist_memory: defineTable({
    userId: v.id("users"),
    summary: v.string(),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),

  verification_codes: defineTable({
    email: v.string(),
    code: v.string(),
    expiresAt: v.number(),
    used: v.boolean(),
    attempts: v.optional(v.number()),
  }).index("by_email", ["email"]),

  // Event stream — one row per meaningful user action (search, save, flag, outfit_view…).
  // Queried by the style-signals cron and the admin dashboard.
  user_events: defineTable({
    userId: v.optional(v.id("users")),
    event: v.string(),              // "search" | "save" | "flag" | "outfit_view" | "page_view" …
    properties: v.optional(v.any()),
    country: v.optional(v.string()),
    city: v.optional(v.string()),
    deviceType: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_user", ["userId"])
    .index("by_event", ["event"])
    .index("by_created", ["createdAt"])
    // Composite so a per-event time window (e.g. the 24h ai_usage summary) is a
    // bounded index range, not a full scan of every event of that type ever.
    .index("by_event_created", ["event", "createdAt"]),

  // Admin-managed allowlist: emails granted Community access without a Stripe sub.
  // Managed via the private /api/admin/community-access route (ADMIN_SECRET protected).
  community_allowlist: defineTable({
    email: v.string(),
    note: v.optional(v.string()),       // who/why — for the admin's own reference
    grantedAt: v.number(),
  }).index("by_email", ["email"]),

  // Learning loop: explicit relevance feedback. A shopper flagging a result as
  // a bad match is the highest-signal training data the search can get — these
  // accumulate for periodic review and rerank/threshold tuning.
  quality_signals: defineTable({
    userId: v.optional(v.id("users")),
    query: v.string(),
    productId: v.string(),
    productTitle: v.optional(v.string()),
    vendor: v.optional(v.string()),
    signal: v.union(v.literal("bad_match"), v.literal("good_match")),
    reason: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_signal", ["signal"])
    .index("by_query", ["query"]),

  // Learning loop, second half: aggregated relevance_adjustments computed
  // periodically (web/app/api/cron/quality-feedback) from quality_signals
  // (explicit bad-match flags) and saved_products (implicit good-match via
  // a query-linked save). Read on every live search via a cheap in-memory
  // cache (lib/services/relevanceAdjustments.ts) to suppress/demote a
  // product or vendor that's been repeatedly flagged for a given concept.
  relevance_adjustments: defineTable({
    scope: v.union(v.literal("product"), v.literal("vendor")),
    conceptKey: v.string(),   // canonical garment key from lib/queryParser's decomposeQuery, "general" if none
    targetId: v.string(),     // productId (scope=product) or lowercased vendor (scope=vendor)
    score: v.number(),        // signed: POSITIVE demotes (flags / shown-but-ignored), NEGATIVE promotes (save/open engagement). Subtracted from the normalized BM25 score.
    badCount: v.number(),
    goodCount: v.number(),
    distinctFlaggers: v.number(), // distinct users behind badCount — gates vendor-level demotion
    updatedAt: v.number(),
  }).index("by_key", ["scope", "conceptKey", "targetId"])
    .index("by_concept", ["conceptKey"]),

  // Queries the hand-curated vocabulary failed to understand — logged by the
  // stylist route whenever a product search comes back empty and needs the
  // broad-net rescue, whether or not that rescue succeeded. A weekly cron (web/app/api/cron/vocab-review) clusters these
  // into suggested canonical mappings, and a human approves or rejects them at
  // /admin/vocab.
  //
  // DELIBERATELY INERT: nothing here feeds live matching. The dictionaries in
  // lib/queryParser.ts and lib/intentCompiler.ts stay hand-curated, because a
  // wrong synonym auto-merged into the hot path is a silent, hard-to-trace
  // search regression. Approving a row records the decision as evidence for a
  // reviewed code change; it does not alter behaviour by itself.
  vocab_candidates: defineTable({
    phrase: v.string(),           // normalised miss, e.g. "co ord set"
    count: v.number(),            // how many times it has been seen
    firstSeenAt: v.number(),
    lastSeenAt: v.number(),
    reason: v.string(),           // "no-results" | "weak-match"
    suggestion: v.optional(v.string()),  // cron's proposed canonical mapping
    status: v.string(),           // "new" | "approved" | "rejected"
    reviewedAt: v.optional(v.number()),
    reviewedBy: v.optional(v.string()),
  }).index("by_phrase", ["phrase"])
    .index("by_status", ["status", "count"]),

  // Emerging style trends distilled from real search volume by the
  // style-signals cron (web/app/api/cron/style-signals) every ~2 days.
  // Read by the LLM relevance judge as light context ("what shoppers are
  // gravitating toward right now"), never as a filter — see
  // lib/services/trendConcepts.ts. Small table, replaced wholesale each run;
  // firstSeenAt survives replacement so a persistent trend shows its age.
  trend_concepts: defineTable({
    concept: v.string(),      // lowercased short phrase, e.g. "quiet luxury"
    firstSeenAt: v.number(),
    lastSeenAt: v.number(),
  }).index("by_concept", ["concept"]),

  // AI-analyst output — the self-improving loop's "brain". A weekly cron (and
  // an on-demand admin action) feeds the aggregated analytics report to the LLM
  // and stores its concrete improvement recommendations here. Read by the
  // dashboard + folded into the downloadable report. Pruned to the last ~20.
  learning_insights: defineTable({
    createdAt: v.number(),
    windowDays: v.number(),
    content: v.string(),          // Markdown recommendations
    model: v.optional(v.string()),
  }).index("by_created", ["createdAt"]),

  // Persisted brand health from the daily probe. consecutiveDown drives
  // auto-pruning: a store down for several days running is skipped in search
  // until it recovers (a healthy probe resets the counter).
  brand_health: defineTable({
    domain: v.string(),
    healthy: v.boolean(),
    lastProductCount: v.number(),
    consecutiveDown: v.number(),
    lastProbedAt: v.number(),
  }).index("by_domain", ["domain"]),

  // Persistent search cache — lets the existing 15-minute result cache survive
  // serverless cold starts. Same freshness window as in-memory; entries past
  // TTL are ignored. Discovery only — checkout/detail always hit the live store.
  search_cache: defineTable({
    key: v.string(),         // hash of query + country + brands
    products: v.string(),    // JSON-encoded product snapshot (capped)
    createdAt: v.number(),
  }).index("by_key", ["key"]),

  // Persistent rerank-judge cache — lets relevanceRerank.ts's LLM relevance
  // scoring survive serverless cold starts, exact same problem/shape as
  // search_cache above but for the LLM judge's per-product scores instead of
  // raw catalog results. The in-memory version (relevanceRerank.ts's own
  // `cache` Map) is wiped on every cold start, so on Vercel it rarely
  // actually hits; this is the real token-savings mechanism — identical or
  // near-identical searches across different shoppers/instances stop
  // re-paying the LLM judge cost. Longer TTL than search_cache (read-time
  // filtered, no separate expiry cron) since relevance ordering for a given
  // query+candidate-set is stable over hours, not minutes.
  rerank_cache: defineTable({
    key: v.string(),         // hash of query + sorted candidate product ids (relevanceRerank.ts's cacheKey)
    ids: v.string(),         // JSON-encoded string[] — reranked product id order
    scores: v.string(),      // JSON-encoded Record<id, number> — final blended 0-1 score
    createdAt: v.number(),
  }).index("by_key", ["key"]),

  // Vision-classified image ordering — caches the model-shot-first ordering for
  // a product's photo set so the costly vision call runs once per product, ever.
  // Orderings are stable, so there is no TTL; the key is a hash of the URL set.
  image_order: defineTable({
    key: v.string(),         // hash of the image URL set
    order: v.string(),       // JSON array of URLs, on-body shots first
    createdAt: v.number(),
  }).index("by_key", ["key"]),

  // Fabrics conversation threads — previously localStorage-only (from:stylist-
  // history / from:stylist-session:*), meaning a signed-in shopper's actual
  // conversations were stuck on whichever device created them. One row per
  // session, mirroring the client's own per-session localStorage shape
  // (sessionId is the same id the client already generates), so a device that
  // signs in with the same account can pull sessions it doesn't have locally.
  stylist_sessions: defineTable({
    userId: v.id("users"),
    sessionId: v.string(),
    label: v.string(),
    messages: v.string(),      // JSON-encoded StylistMsg[] — same shape as the localStorage blob
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_user", ["userId"])
    .index("by_user_session", ["userId", "sessionId"]),

  // What a garment IS, read once by a vision model and kept.
  //
  // enrichProduct.ts held these in a process-local Map, so every cold start
  // threw away every profile and re-paid the vision cost — on providers whose
  // free tiers are exhausted. A garment does not become a different garment,
  // so this is the one cache in the system with nothing to go stale: it is
  // pure saving.
  //
  // No TTL, deliberately. Freshness is handled by the KEY instead (product +
  // image + schema version + prompt version + model): change any of those and
  // the old row simply stops being addressed. A time limit would only throw
  // away correct answers and buy another vision call.
  garment_profiles: defineTable({
    key: v.string(),          // productId|image|schemaV|promptV|model
    productId: v.string(),    // for finding every profile of one product
    profile: v.string(),      // JSON-encoded GarmentProfile
    createdAt: v.number(),
  }).index("by_key", ["key"])
    .index("by_product", ["productId"]),
});
