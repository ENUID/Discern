# Current repository audit

**HEAD:** `56bfad0` (Phase 1b) · **Method:** imports followed from entry points and read at source. Filenames, comments and prior audit documents were treated as claims to verify, not as evidence.

**Scale:** 242 tracked files · 58 modules / 18,624 lines in `web/lib` · 36 API routes · 22 Convex files, 23 tables, 78 functions · 34 test scripts · `route.ts` 1,833 lines · `GlobalCatalogService.ts` 1,447 lines.

**Where earlier documents are contradicted by the current source, the source wins.** Contradictions are listed in §19.

---

## 1. Exact current architecture

```
BROWSER
  app/(shop)/page.tsx  → features/v2/Boutique.tsx (626)
  app/v2/page.tsx      → same component (alias route)
       └─ features/v2/DiscernV2.tsx (3,892)   ← the whole shopping UI
          features/stylist/askStylist.ts (149) ← the only caller of the stylist API
                    │ POST /api/ai/stylist   NDJSON stream
                    ▼
  app/api/ai/stylist/route.ts :390 runStylistRequest()   ← ALL ORCHESTRATION
       1,833 lines · 15 finish() exits · no planner, no loop, no state machine
       │
       ├─ lib/stylist/{limits,usage,trace,traceStore,prompts,answer,retrieval,providers}.ts
       ├─ lib/intent/routing.ts · lib/intentCompiler.ts · lib/queryParser.ts
       ├─ lib/fashion/{outfitKnowledge,garmentProfile,lookbook,palette,taxonomy,
       │              exactMatch,suggestQuery,intentRouter}.ts
       ├─ lib/services/GlobalCatalogService.ts ── 90 Shopify MCP endpoints
       │     ├─ lib/catalog/{productFilters,concepts}.ts
       │     ├─ lib/services/relevanceRerank.ts → lib/ai/infer.ts   ← LADDER 2
       │     └─ lib/services/{sameGarment,wornGender,enrichProduct,brandHealth}.ts
       └─ lib/stylist/providers.ts                                  ← LADDER 1

CONVEX  23 tables / 78 functions — sessions, taste, traces, quality signals,
        trend concepts, brand health, caches. NO products table.

CRON    6 jobs (web/vercel.json) — 3 close a loop into live retrieval,
        3 report to humans.
```

The route is the orchestrator. Phase E moved implementations out of it; control flow never left. Every "what happens next" is an `if` inside one function.

## 2. Exact runtime request flow

```
POST /api/ai/stylist { question, messages, images, products, savedProducts,
                       recentSearches, buyerCurrency, buyerCountry, mode, … }

 route.ts:404  stylistRateLimited()      limits.ts:43   30/min/IP
 route.ts:412  startTrace()              trace.ts:103   HEAVY PATH ONLY
 middleware.ts resolveShopperContext()   country + currency cookies
 route.ts:519  tasteProfile = [gender, profile, bag vendors, avg spend,
                               recent searches].filter(Boolean).join()   ← A STRING

 :717  mode==='load-more'    → re-run stored query, exclude shown ids     → EXIT
 :757  mode==='wardrobe-scan'→ wardrobeVisionChat + parseWardrobeToken    → EXIT

 :808  FAST PATH   (no images, no pinned products)
        compileIntent()   intentCompiler.ts:382  regex + vocab + zod, NO MODEL
          ├─ hit → multiCategorySearch() | GlobalCatalogService.search()
          │        reply = multiCategoryReplyText()  ← A TEMPLATE STRING
          │        logAiUsage({path:'fast', provider:'none'})             → EXIT
          └─ miss → fall through

 :896  HEAVY PATH
        isHeavyQuery()            routing.ts   denylist
        selectKnowledgeModules()  knowledgeModules.ts  keyword-gated blocks
        images.length>0 → vision sub-path (:1030 visionAttempts[])
        stylistChat(messages, combinedSystem, opts, heavy)  providers.ts:61
          wrapped in withDeadline(…, chatDeadline, null)    route.ts:1247
          chatDeadline = min(requestDeadline − 14_000, now + 34_000)
        self-heal retry when no token emitted               route.ts:1292
        parseStylistAnswer(raw)   answer.ts:194   json → tokens → prose

        ── POST-MODEL PIPELINE, one ordered function, ~500 lines ──
        search token → catalog (11 inline call sites) → dedupeById
        → INITIAL_RESULT_CAP(8) → looksFrom() → groundReplyInProducts() :223
        → exactMatchNote → linkPinnedProductMentions → stripEmphasis
        → stripUnverifiableClaims
 finish({reply, foundProducts, foundProductGroups, looks, outfitSlots, …})
 runAfterResponse(saveTrace)   traceStore.ts:48
```

`REQUEST_BUDGET_MS = 52_000` (`route.ts:350`) against `maxDuration = 60`.

## 3. Exact AI/model flow

| Stage | File | Model? | Path |
|---|---|---|---|
| Intent compile | `intentCompiler.ts:382` | **No** — regex + vocab tables | — |
| Heavy reply | `route.ts:1247` | Yes | `stylistChat` |
| Self-heal retry | `route.ts:1292` | Yes | `stylistChat` |
| Grounding pass | `route.ts:223` | Yes | `stylistChat` |
| Query refine | `retrieval.ts:404` | Yes | `groqChat` **direct** |
| Relevance judge | `relevanceRerank.ts:539,552` | Yes | `infer` |
| Garment profile | `enrichProduct.ts:63` | Yes (vision) | `groqVisionChat` direct |
| Same-garment | `sameGarment.ts` | Yes (vision) | own fan-out |
| Worn gender | `wornGender.ts` | Yes (vision) | own fan-out |
| Photo description | `describeGarment.ts:63` | Yes (vision) | `groqVisionChat` direct |
| Wardrobe scan | `route.ts:762` | Yes (vision) | `wardrobeVisionChat` |
| 4 of 6 crons | `app/api/cron/*` | Yes | `groqChat` direct |

A normal heavy answer makes **two** model calls (reply + grounding), three with self-heal, plus one judge call per search.

## 4. Exact provider-access paths

**Three paths. Two cooldown stores. No single gateway.**

```
LADDER 1  lib/stylist/providers.ts:61  stylistChat()
   cerebras → gemini → groq(70b) → groq(8b) → nvidia
   order flips on cerebrasFits (8,192 window; flip at 26,768 prompt chars)
   order flips again on useGemini (heavy vs light)
   budget LADDER_MS 34s · first rung 55% · ATTEMPT_MS 11s is a FLOOR
   cooldown → lib/stylist/limits.ts markProviderOut()  10 min
   5 call sites, all in route.ts

LADDER 2  lib/ai/infer.ts:77  infer()
   cerebras → groqDirect → nvidia → gemini → openrouter
   cooldown → lib/providerCooldown.ts        ← A DIFFERENT STORE
   2 callers: relevanceRerank.ts:9, product-names/route.ts:2
   Its header says "One ladder, used by everything that needs a language model."

DIRECT    groqChat() — 12 files, no ladder, no shared cooldown.
   lib/groq.ts:506 states it is the OpenRouter client; infer.ts:8 calls
   openrouter/free "the single least reliable pool we have".
```

A provider that 429s the judge is **not** skipped by the stylist ladder, and vice versa.

## 5. Exact retrieval flow

```
STAGE 0  90 store keyword searches         ← RECALL IS OUTSOURCED
   GlobalCatalogService.search():1015
   getCategoryDomains():318 → deprioritizeDead()  brandHealth.ts:76
   2 rounds × 45 stores  ·  fetchStore():481  ·  STORE_PAGE_LIMIT 40
   each brand runs ITS OWN Shopify search. Nothing is indexed here.
STAGE 1  applyConceptRelevance()   catalog/concepts.ts  keyword groups + minKeep floor
STAGE 2  productFilters            isNonFashion/gender DELETE · colour/size REORDER
STAGE 3  applyFiltersAndSort():775 budget · currency · perVendorCap · sort
STAGE 4  rerankByRelevance():454
           bm25Scores():231       real BM25, title ×2.5, own IDF  ← LEXICAL, NOT SEMANTIC
           llmRelevanceScores():310  batch LLM scoring of top-N
             judgeWithHeadStart():159 · persistent rerank cache
             getRelevanceAdjustment():282   ← learned, live
             trendContextLine():328         ← learned, live
             houseTaste()  lookbook.ts:563  ← 16-look statistics as prompt text
STAGE 5  houseTaste sort · composeOutfit()  outfitKnowledge.ts:400
```

**17 `GlobalCatalogService.search(...)` call sites:** 11 `route.ts`, 2 `retrieval.ts`, 2 `catalog/search`, 1 `featured`, 1 `style-with`.

**No embeddings. No vector index. No semantic retrieval.** The word "embedding" appears in exactly two places in the repository: a comment at `sameGarment.ts:16` describing what Pinterest does, and `OPENAI_SETUP.md` (§19).

## 6. Exact product-understanding flow

`parseProduct():616` is the only normalisation. Shopify shape → `UcpProduct` (`:82`): id, title, vendor, price, currency, image, tags, description, options.

Two behaviours worth naming:
- **Returns `null` when there is no image** — the product silently disappears, uncounted.
- **Reads `variants[0]` only** — a product available in one size reads as available in all. `readAvailability():605` handles six field spellings but is applied to that one variant.

Everything else understood about a product is computed **per request and discarded**: `productGenderSignal`, `productColorFamilies`, `pieceFormality`, `matchStyles`, `taxonomyGarmentKey`. Only `garment_profiles` (vision) is persisted, and only for products that happen to reach `looksFrom`.

## 7. Exact fashion reasoning flow

All deterministic. No model.

| Function | File | What it decides |
|---|---|---|
| `readOccasion` / `OCCASIONS` | `outfitKnowledge.ts:93-292` | ~200 hand-written lines: slots, palette, fabrics, formality |
| `outfitPlan` | `:472` | query + gender → `{slots, palette, fabrics, formality}` |
| `coherence` | `:357` | colour families + formality spread + "the echo" |
| `pieceFormality` | `:352` | garment text → 1–5 |
| `worksWith` | `garmentProfile.ts:187` | formality gap · volume pairing · pattern scale |
| `outfitTones` / `houseTaste` | `lookbook.ts` | per-slot colour story from 16 reference looks |
| `GARMENT_VOCAB` etc. | `queryParser.ts` (1,065 lines) | garment keys, exclusions, colour vocabulary |

## 8. Exact outfit construction flow

```
outfitPlan()          → slots/palette/fabrics/formality
multiCategorySearch() retrieval.ts:98 — one separately-ranked search PER SLOT
   outfitTones() per-slot colour · 2-rung colour fallback :211
   price band: median ×4 / ÷4; an entirely out-of-band slot is kept whole
   cross-group dedupe
composeOutfit()       outfitKnowledge.ts:400
   exhaustive over ≤3^5 combinations
   score = relevance×0.65 + coherence×0.35     ← a real objective function
looksFrom()           retrieval.ts:327
   profilesFor()  ← vision profiles; returns EMPTY MAP when unconfigured,
                     silently falling back to the text path
   composeOutfitsWithProfiles(… worksWith …) | composeOutfits(…)
```

This is genuine bounded combinatorial optimisation, not prompt formatting.

## 9. Exact personalization flow

`route.ts:519` builds **one string** from gender, profile, saved-bag vendors, mean saved price, recent searches. It is used three ways: pasted into the system prompt as SHOPPER MEMORY (`:944`), passed to `search()` as `_tasteProfile`, and included in the rerank cache key.

Convex `taste_profile`, `stylist_memory`, `shopper_shelf`, `search_history` store prose and product lists. There is no user vector, no preference model, and **no record anywhere of a rejected recommendation**.

## 10. Exact evaluation/testing flow

`npm run verify` → `scripts/verify.js` → 22 checks, all deterministic, no model.

`eval.js` loads exactly seven pure modules: `queryParser`, `outfitKnowledge`, `garmentProfile`, `exactMatch`, `suggestQuery`, `stylist/answer`, `intent/routing`. `eval/scenarios.json` — 183 cases: occasion 49, routing 34, garments 26, categoryCorrectness 24, answerContract 21, exactIntent 11, compatibility 7, lossyCompilation 6, suggestion 5.

The file states its own scope: *"Each case names what the DETERMINISTIC layers must conclude — no model call."*

**Nothing measures whether a returned product was right.** No Recall@K, no NDCG, no constraint-satisfaction check, no human-rated sample, no A/B.

## 11. Exact observability flow

`trace.ts:103/124/131/154/167` → `traceStore.ts:48 saveTrace` via `runAfterResponse` → Convex `recommendation_traces`. Caps: 300-char strings, 40 steps, 24 products. `STYLIST_TRACE=off` disables.

`usage.ts:56 logAiUsage` — 1-in-5 success sampling, failures always kept, → `user_events` → `/api/ai/stylist/health`.

Read surfaces: `/api/admin/traces`, `/api/admin/analytics`, `/api/ai/stylist/health` — all `ADMIN_SECRET`/`CRON_SECRET` gated.

**Gaps:** the fast path never calls `startTrace`. There are no metrics, no counters, no alerting. Degraded rate is not observable without querying by hand.

## 12. Exact learning/feedback loops

**Three close into live behaviour:**

| Loop | Written by | Read by | Effect |
|---|---|---|---|
| Quality signals | `cron/quality-feedback` → `relevance_adjustments` | `relevanceAdjustments.ts:67` | per-product score nudge at `relevanceRerank.ts:282` |
| Trend concepts | `cron/style-signals` → `trend_concepts` | `trendConcepts.ts:51` | judge prompt line at `relevanceRerank.ts:328` |
| Brand health | `brandHealth.ts:47` in-process | `deprioritizeDead():76` | store selection at `GlobalCatalogService.ts:395` |

**Three report to humans only:** `learning-analyst` → `learning_insights` → admin dashboard; `vocab-review` → `vocab_candidates` → `/admin/vocab`; `retention` → prunes `user_events`.

`usage.ts:75` explains why the vocabulary stays hand-reviewed. That reasoning is sound and should survive.

## 13. Exact security boundaries

| Surface | State |
|---|---|
| Auth | NextAuth — Google OAuth + email-OTP credentials (`lib/auth.ts:51,101`); Convex writes gated by `convexAuthProof.ts` (10-min TTL proof) |
| Admin | Single shared `ADMIN_SECRET` across 7 routes. No rotation, no audit log |
| Cron | `CRON_SECRET` |
| Billing | Stripe webhook signature verified (`billing/webhook`) |
| SSRF | `ssrfGuard.ts safeParseStoreUrl` on `shipping`, `product-images`, `sizeguide`. **`fetchStore():481` does not use it** — the fixed registry is the only boundary |
| Rate limits | 8 of 36 routes |
| Secret redaction | `lib/redact.ts` on trace/error paths |

**Unauthenticated and unrated:** `featured` (triggers a 90-store fan-out at `:110`), `product-images` and `sizeguide` (fetch arbitrary registry URLs), `rates`.

## 14. Exact deployment architecture

Vercel Root Directory = `web` (confirmed in dashboard). `web/vercel.json` is the only deployment config — six crons, build command runs `npx convex deploy` when `VERCEL_ENV=production` and `CONVEX_DEPLOY_KEY` is set, then `npm run build`. `"Include files outside the root directory"` is **enabled**, so the whole repo uploads. `"Skip deployments when no changes to the root directory"` is **disabled**, so every push to `main` deploys.

Convex also deploys independently via `.github/workflows/convex-deploy.yml` (`working-directory: web`, `paths: web/convex/**`).

Root `package.json` holds two local convenience scripts and nothing else.

## 15. Exact database/Convex architecture

23 tables, 78 functions:

- **Identity/commerce** — `users`, `verification_codes`, `subscriptions`, `community_allowlist`, `saved_products`, `shopper_shelf`
- **Shopper state** — `taste_profile`, `stylist_memory`, `stylist_sessions`, `search_history`
- **Learning** — `quality_signals`, `relevance_adjustments`, `trend_concepts`, `vocab_candidates`, `learning_insights`, `brand_health`
- **Caches** — `search_cache`, `rerank_cache`, `garment_profiles`, `image_order`
- **Observability** — `user_events`, `recommendation_traces`
- **Ops** — `retention`

**There is no products table.** Nothing in Convex stores a product except `saved_products` (a shopper's own bag) and `search_cache` (result sets with a TTL). A cache is not a product database.

## 16. Exact frontend architecture

One screen. `app/(shop)/page.tsx` and `app/v2/page.tsx` both render `features/v2/Boutique.tsx` (626), which hosts `features/v2/DiscernV2.tsx` (3,892 lines — the entire shopping UI). `features/stylist/askStylist.ts` (149) is the only caller of the stylist API. Three admin pages, plus privacy and terms. `components/` totals 508 lines across 6 files.

## 17. All duplicated implementations

| Duplication | Locations |
|---|---|
| Provider ladder | `lib/stylist/providers.ts:61` · `lib/ai/infer.ts:77` — different orders |
| Cooldown store | `lib/stylist/limits.ts markProviderOut` · `lib/providerCooldown.ts` |
| Token estimator | `usage.ts:40` · `infer.ts:61` — identical `chars/4` |
| Vision fan-out | `sameGarment.ts` · `wornGender.ts` · `enrichProduct.ts` · `describeGarment.ts` — four independent ladders |
| Persistent-cache read/write shape | `persistentSearchCache` · `persistentRerankCache` · `persistentProfileCache` — same timeout-race pattern three times |
| Brand health state | `brandHealth.ts` · `deadBrands.ts` — two modules over the same concern |

## 18. All dead/unreachable code still present

Phase 1 removed 73 files. What remains:

- **`OPENAI_SETUP.md`** — documents a system that does not exist (§19). Not code, but actively misleading.
- **`lib/services/imageClassifier.ts`** (228 lines) — reachable from `/api/image-order` only; that route has no caller in `features/`. Worth confirming before any action.
- **`app/v2/page.tsx`** — an alias of `/`, deliberately kept.

No other unreachable module was found. The import graph resolves 355 specifiers across 274 source files with no orphans besides the above.

## 19. All misleading names, comments and documentation

**`OPENAI_SETUP.md` is the most misleading document in the repository.** It describes, as if current:

- `OPENAI_API_KEY`, `OPENAI_EMBED_MODEL=text-embedding-3-small`, `OPENAI_EMBED_DIMENSIONS=768` — **zero `OPENAI_*` references exist in any source file**
- `GET /api/ai/embed` with an `embed_status` payload — **no such route**
- `/api/ai/chat` — **no such route**
- `/api/shopify/sync` — **no such route**
- `Convex vectorSearch` and `products.embedding_status` — **no vector search, no products table**

It is the only place in the repository that claims embeddings exist. Its companion scripts (`embed:pending`, `worker:embed`, pointing at a nonexistent file) were removed in Phase 1; the document was not.

**Other misleading names:**

| Name | Reality |
|---|---|
| `lib/groq.ts` | The **OpenRouter** client. Its own comment says so at `:506` |
| `lib/ai/infer.ts` header | *"One ladder, used by everything that needs a language model"* — **2 callers**; 12 files bypass it |
| `JSON_ANSWER_INSTRUCTION` (`answer.ts:72`) | Defined, **never sent to any model**. The JSON branch of `parseStylistAnswer` always fails |
| `looksFrom` comment (`retrieval.ts:322`) | Claims "black shirts and white shirts" is declined. The guard is on slot *class*; two `top` strips compose. Recorded in `scripts/retrieval.js` |
| `findGarmentGroupIndex` (`concepts.ts`) | Returns **0**, not −1, when no garment is named — "the historical assumption" |
| SYSTEM prompt | *"YOU ARE A DECISION ENGINE, NOT A SEARCH ENGINE"* — the code ranks a list |

**Contradictions with earlier audit documents** (source is authoritative):

- `PHASE_E_EXTRACTION_PLAN.md` §E4 estimates "~700 lines of string constants". Measured: **174 lines** of prompt text.
- `ARCHITECTURE_AUDIT.md`, `DISCERN_REPO_AUDIT.md`, `PHASE_E_EXTRACTION_PLAN.md` all predate Phase E completion and describe a 3,037-line route. It is **1,833**.
- `ARCHITECTURE_STATE.md` §7 lists `lib/currency.ts` and root `convex/` as present. **Both were deleted in Phase 1.**
- An earlier statement in session that `scratch/ollama/` contained "an entire second application" was an overstatement: it was **2 route files**. Deleted in Phase 1 regardless.

## 20. All module-level mutable state

| Module | State | Assessment |
|---|---|---|
| `stylist/limits.ts` | 5 — buckets, breaker counters, `providerOut` | **Legitimate.** Singleton by design; `scripts/limits.js` asserts exactly one instance |
| `relevanceRerank.ts` | 5 — `cache`, `judged`, `judging`, LLM window counters | Legitimate cache/dedupe |
| `GlobalCatalogService.ts` | 3 — `lruCache`, sweep timestamp, `lastSameGarment` | Cache legitimate; see §21 |
| `providerCooldown.ts`, `gemini.ts` | provider health, live model | Legitimate, but duplicated (§17) |
| `trendConcepts`, `relevanceAdjustments`, `deadBrands` | 3 each — value, `lastLoad`, `loading` | Legitimate refresh-cache pattern |
| `enrichProduct`, `wornGender`, `imageClassifier` | `BoundedCache` | Legitimate |
| `usage.ts:54` | `aiUsageCounter` | Legitimate sampler |
| `exchangeRates.ts` | `serverCache` | Legitimate |

## 21. All cross-request state

**One `export let` remains in the entire codebase:**

`GlobalCatalogService.ts:70 lastSameGarment` — a single-entry vision verdict. It is **explicitly keyed by the photograph**: `sameGarmentVerdictFor(image)` at `:73` refuses to answer about a different image, so two shoppers holding up different pictures cannot read each other's verdict. The residual cost is eviction, not leakage: a concurrent request loses the verdict and pays for a second vision call.

`lastJudgeOutcome` and `lastJudgeDetail` were removed in `135f7f7`; `scripts/judge-scope.js` asserts their absence and that ten interleaved requests cross zero times.

## 22. All network boundaries

| Boundary | File | Guard |
|---|---|---|
| 90 Shopify MCP endpoints | `GlobalCatalogService.ts:580` | `AbortSignal.timeout(5000)`; registry only, **no SSRF guard** |
| MCP (brand health cron) | `cron/brand-health` | `CRON_SECRET` |
| MCP + arbitrary URL | `product-images` | `safeParseStoreUrl`; **no rate limit, no auth** |
| Arbitrary URL | `shipping`, `sizeguide` | `safeParseStoreUrl`; `sizeguide` unrated |
| Product image | `palette.ts` | `AbortSignal.timeout` |
| OpenRouter / Groq / Gemini / Cerebras / NVIDIA | provider clients | per-rung timeouts + cooldown |
| `open.er-api.com` | `exchangeRates.ts` | cached |
| `ipapi.co` | `analytics/identify` | third-party IP geolocation |
| Convex | many | `serverSecret` / `authProof` |

## 23. All model boundaries

`stylistChat` (5 sites) · `infer` (2) · `groqChat` (12 files) · `groqVisionChat` (3) · `wardrobeVisionChat` (2) · `cerebrasVisionChat`, `nvidiaVisionChat` (`route.ts:1030`) · per-provider clients inside `sameGarment` / `wornGender`.

## 24. All places where untrusted data enters prompts

| Site | Payload | Sanitisation |
|---|---|---|
| `prompts.ts:82` `productBlock` | **700 chars of merchant description** | whitespace collapse only — **no HTML strip, no instruction filtering** |
| `prompts.ts:288` `compactProductLine` | 160 chars | HTML stripped |
| `relevanceRerank.ts:223, 302` | description into the judge prompt | HTML stripped |
| `route.ts` | shopper utterance, images, pinned product titles/vendors | length caps only |
| `trendContextLine():328` | model-generated trend words from a cron | none |

A merchant who controls a product description controls up to 700 characters inside the system prompt.

## 25. All places where model output becomes application behaviour

`parseStylistAnswer` (`answer.ts:194`) → `fromJson` (always fails, §19) → `fromTokens` → prose. The real contract is the bracket grammar: `SEARCH_RE :126`, `OUTFIT_RE :127`, `OUTFITS_RE :128`.

Downstream, the extracted `search` string becomes a live catalogue query; `outfit`/`outfits` become per-slot searches; `[PRODUCT:N]` becomes a rendered card (`route.ts:111, 1337`); `[COMPARE:` becomes a comparison table (`:171`); `[WARDROBE:` becomes a persisted wardrobe scan; `[PHOTO:N]` selects one of the shopper's own images.

`linkPinnedProductMentions` (`route.ts:66`) additionally converts prose "product 6" into a card token.

## 26. All caches and their keys

| Cache | Key | Scope | TTL |
|---|---|---|---|
| Catalog LRU `GlobalCatalogService.ts:181` | `makeCacheKey():227` = `{query, countryCode, brandDomains}` | in-process, 300 entries | 15 min; 60 s empty |
| Rerank memo `relevanceRerank.ts:68` | `cacheKey():203` = hash(query + sorted ids + tasteProfile) | in-process | — |
| Judged memo `:104` | `judgedKey():107` = `intent + NUL + productId` | in-process | `JUDGED_MAX` eviction |
| In-flight judge `:150` | `intentKey(query)` | in-process | duration of call |
| Persistent search / rerank / profile | Convex tables | cross-instance | table TTL |
| `enrichProduct` / `wornGender` / `imageClassifier` | image URL | `BoundedCache` | — |
| `providerCooldown`, `limits.providerOut` | provider name | in-process | 10 min |

**The catalog LRU caches the fetch pool, not the filtered result** — budget/sort/concepts/size are applied per request at `:1055/:1125/:1200`, so their absence from the key is correct, not a collision.

## 27. All cache collision risks

1. **`intentKey` collapse — measured.** `outfitKnowledge.ts:528` produced **four distinct keys for ten distinct queries**: `"men white linen shirt"`, `"women black wool coat"` and `"women cream knit cardigan"` all → `"-|-|neutral|-"`; `"men green cotton shorts"` → `"-|-|-|-"`. This key governs the `judged` memo, the persistent rerank cache and the in-flight dedupe.
2. **`tasteProfile` as a cache-key component.** Shoppers with matching derived strings share a rerank ordering; those with no memory all share the `""` bucket.
3. **`lastSameGarment` single entry** — eviction, not leakage.

## 28. All failure/fallback behaviour

- **Ladder:** rung failure → next; empty content and leaked reasoning treated as failure; all rungs failing → throws with the full trail.
- **`withDeadline` (`route.ts:366-377`) resolves its fallback on rejection** — the trail is destroyed and reported as `"the whole chain ran past the reply deadline"` (`:1237`). Measured in production: a reply degraded in **8.7 s against a 34 s budget**.
- **`withoutTheModel` (`:1494`)** — rescue catalogue search. On a conversational turn this returns products for a greeting.
- **Breaker:** `heavy && modelLooksDown()` serves the catalogue directly (`route.ts:1398`). The breaker is **not** inside the ladder.
- **Retrieval:** `refineSearchQuery` fires once on zero results; multi-category falls back to a plain rung; an errored slot is dropped, not the whole answer.
- **Diagnostics:** `logAiUsage`, `recordVocabMiss`, `saveTrace` all `.catch(() => {})`.

## 29. All timeout behaviour

`maxDuration` 60 · `REQUEST_BUDGET_MS` 52,000 · `chatDeadline` = min(deadline − 14,000, now + 34,000) · `LADDER_MS` 34,000 · `ATTEMPT_MS` 11,000 **floor** · `STORE_TIMEOUT_MS` 5,000 · `STORE_SOFT_MS` 2,600 · rerank `TIMEOUT_MS` env · persistent cache reads 1,500–1,800 · profile write 2,500 · vision timeouts env-tunable.

Budget split measured: five rungs over 1,000 ms → `550 / 112 / 112 / 111 / 112`.

## 30. All rate-limit behaviour

`stylistRateLimited` — 30/min/IP, sweep every 5 min (`limits.ts:43`). `makeIpRateLimiter` on 7 further routes. **8 of 36 routes.** `featured` is unauthenticated, unrated, and triggers a 90-store fan-out.

`relevanceRerank.ts:51` caps LLM judge calls per rolling minute; over budget falls back to BM25 order.

## 31. All provider cooldown/breaker behaviour

- `limits.ts` — breaker opens on 3 consecutive failures, 60 s cooldown, then one probe. `markProviderOut` 10 min on quota/401/403/billing patterns. **A timeout is deliberately not remembered.**
- `providerCooldown.ts` — the second, independent store used by `infer`, `groq`, `gemini`.
- Cooldown key is the **base provider name**, so one 429 from one groq model removes **both** groq rungs for 10 minutes.

## 32. All current production risks

1. **The model pools are exhausted.** Measured 2026-08-25: 3 of 5 smoke queries degraded, worsening across runs with no code change.
2. **The error trail is destroyed before anyone can read it** (§28).
3. **A greeting triggers a rescue search** — "hey" returns eight unrelated products when the model is down.
4. **`parseProduct` drops imageless products silently** — unmeasured recall loss.
5. **Two cooldown stores** — quota burned rediscovering dead providers.
6. **`featured` is an unauthenticated 90-store amplifier.**
7. **Single shared `ADMIN_SECRET`**, no rotation or audit.
8. **`fetchStore` outside the SSRF policy.**
9. `REQUEST_BUDGET_MS` 52 s leaves 8 s of headroom under `maxDuration` 60.

## 33. All current quality risks

- **Nothing measures answer quality.** Every improvement is unfalsifiable until this changes.
- `intentKey` collisions serve one query's judgement to another.
- `minKeep` pads pages with near-misses, so a full page is not evidence of a good page — and `results.length < 4` is the only weakness test.
- `profilesFor` returning an empty map silently downgrades outfit composition to title strings.
- `findGarmentGroupIndex` returning 0 means a colour-only request treats its first concept group as the garment.
- Untrusted merchant prose reaches both the stylist prompt and the judge prompt.

## 34. All scalability bottlenecks

Every search is a live 90-way fan-out with a 15-minute **in-process** LRU — ten concurrent users is up to 900 outbound requests, and instance restarts drop the cache. `STORE_PAGE_LIMIT 40` is documented as measured-optimal; raising it made things worse. Judge cost is capped per minute, so ranking silently degrades to BM25 under load.

## 35. All cost bottlenecks

Per heavy query: up to 90 MCP fetches + 2–3 stylist model calls + 1 judge call + optional vision. Free tiers are shared across all users. `AI_USAGE_SAMPLE_N` exists because observing the system was one of its heaviest consumers. **Vision enrichment is per request rather than per product** — the largest avoidable cost.

## 36. Missing capabilities for the target architecture

Owned product store · ingestion · embeddings · vector or filtered-brute-force search · hybrid fusion · typed shopper state · constraint model · decision planner · weakness detection · re-planning · explicit decision scoring · tradeoff reasoning · confidence · counterfactuals · product/outfit relationship persistence · per-variant availability · retrieval and decision benchmarks · A/B infrastructure · metrics and alerting · rejection capture.

---

# Capability matrix

Status: **IMPL** implemented · **PART** partial · **DEAD** unreachable · **DUP** duplicated · **MISS** missing.

| Capability | Status | Files / evidence | Q | Discern-specific | Prod-ready | Missing work |
|---|---|---|---|---|---|---|
| Shopper understanding | PART | `queryParser.ts` (1,065), `intentCompiler.ts:382`, `intent/routing.ts` | 6 | Yes | Yes | occasion/climate/size never reach a typed brief |
| Constraint extraction | PART | `intentCompiler.ts:382` → zod `SearchToolSchema` | 5 | Yes | Yes | no `ShopperBrief`; constraints travel as loose args |
| Conversational context | PART | `enrichHistory` `prompts.ts:59`; last-20; `stylist_sessions` | 5 | Partly | Yes | no session decision memory |
| Product understanding | PART | `parseProduct:616`; filters computed then discarded | 5 | Yes | Partly | persist it; per-variant availability |
| Product ingestion | **MISS** | — | 0 | — | No | harvest `fetchStore` output |
| Product persistence | **MISS** | 23 tables, none holds a product | 0 | — | No | `products` table + upsert |
| Fashion understanding | **IMPL** | `outfitKnowledge.ts:93-292,352,357`, `garmentProfile.ts:187`, `lookbook.ts`, `palette.ts` | 8 | **Yes** | Yes | none — protect it |
| Semantic retrieval | **MISS** | zero embeddings | 0 | — | No | corpus first |
| Lexical retrieval | **IMPL** | `bm25Scores():231` | 7 | Partly | Yes | runs over a borrowed pool |
| Hybrid retrieval | **MISS** | — | 0 | — | No | depends on corpus |
| Candidate generation | **IMPL** | `search():1015`, 90 stores × 40 | 6 | Yes | Yes | recall is outsourced |
| Candidate filtering | **IMPL** | `catalog/productFilters.ts`, `concepts.ts`; 57 tests | 7 | Yes | Yes | none |
| Candidate ranking | **IMPL** | `applyFiltersAndSort():775`, `houseTaste` | 7 | Yes | Yes | unmeasured |
| Candidate judging | **IMPL** | `relevanceRerank.ts:454` + cache + cost cap | 7 | Yes | Partly | `intentKey` collisions |
| Outfit construction | **IMPL** | `composeOutfit():400` | 8 | **Yes** | Yes | prefilter + repair |
| Outfit compatibility | **IMPL** | `coherence():357`, `worksWith():187` | 7 | **Yes** | Partly | starved of vision profiles |
| Personalization | PART | `route.ts:519` — a joined string | 3 | Partly | Partly | typed state; capture rejections |
| Decision planning | **MISS** | `runStylistRequest` linear, 15 exits | 1 | No | No | the planner |
| Decision making | PART | a model reads a list and names a pick | 4 | Partly | Partly | utility function |
| Trade-off reasoning | **MISS** | no code compares options on any axis | 1 | No | No | `Tradeoff` contract |
| Structured decisions | PART | `StylistAnswerSchema:52`; instruction **never sent** | 4 | Yes | Partly | send it; retire the grammar |
| Explanation generation | PART | model prose, regex-extracted | 4 | Partly | Yes | generate from structure |
| Provenance | PART | `trace.ts`; **fast path untraced** | 6 | Yes | Partly | trace the fast path |
| AI orchestration | **DUP** | `providers.ts:61` + `infer.ts:77` + 12 direct callers | 5 | No | Partly | one gateway |
| Provider routing | **IMPL** | `providers.ts:61`; 70 checks | 7 | No | Yes | consolidate |
| Cost-aware routing | PART | size-based ordering; judge cap; usage sampling | 5 | Partly | Partly | per-task budgets |
| Vision | **IMPL** | 5 call paths | 6 | Yes | Partly | dedupe; move to ingest |
| Embeddings | **MISS** | — | 0 | — | No | after corpus |
| Evaluation | PART | 22 checks, 183 parser scenarios | 3 | Partly | No | quality benchmarks |
| Benchmark | **MISS** | no Recall@K, NDCG, constraint satisfaction | 0 | — | No | golden sets |
| A/B testing | **MISS** | — | 0 | — | No | before tuning |
| Observability | PART | `trace.ts`, `usage.ts`, admin routes | 5 | Yes | Partly | metrics, alerting, fast path |
| Failure recovery | **IMPL** | ladder, breaker, cooldown, rescue | 7 | Partly | Partly | stop swallowing the trail |
| Controlled learning | PART | 3 closed loops, 3 human loops | 5 | **Yes** | Yes | rejection signal |
| Security | PART | NextAuth, authProof, SSRF on 3 of 4 | 5 | No | Partly | prompt injection, `fetchStore`, admin secret |
| Scalability | PART | in-process LRU, 90-way fan-out | 4 | No | Partly | owned corpus |

---

# A. Genuinely excellent — protect

`lib/fashion/` (OCCASIONS, `coherence`, `worksWith`, `composeOutfit`, `houseTaste`, `outfitTones`) · `lib/stores.ts` (472 curated brands) · `lib/stylist/prompts.ts` (54,823 chars, SHA-256 guarded) · `lib/catalog/productFilters.ts` (delete-vs-reorder split, 37 tests) · `lib/stylist/limits.ts` (singleton proof) · `relevanceRerank.ts` · the three closed learning loops · `scripts/` (22 checks, 70 ladder behaviours, a concurrency proof).

# B. Merely generic infrastructure

Provider ladders · rate limit / breaker / cooldown · LRU and bounded caches · trace store · usage sampling · Convex schema · NextAuth + Stripe wiring · SSRF guard · exchange rates.

# C. Misleading or architectural debt

`OPENAI_SETUP.md` · three model paths and two cooldown stores · `groq.ts` is OpenRouter · `infer.ts` claims universality · `JSON_ANSWER_INSTRUCTION` never sent · the route is still the orchestrator · `withDeadline` swallowing rejections · four vision fan-outs · `intentKey` collapse · overstated guard comments.

# D. Missing

See §36. The five that gate everything: **quality measurement**, **owned product representation**, **typed shopper state**, **a decision layer**, **one model gateway**.

# E. Recommended phase order

```
 2  Security — merchant-content prompt boundary
 3  Security — fetchStore under the SSRF policy
 4  Hard constraint satisfaction (typed, deterministic)
 5  Retrieval quality benchmark
 6  AI gateway consolidation
 7  Owned product snapshots (shadow)
 8  Product understanding at ingest
 9  Hybrid retrieval experiment (revert if it loses)
10  Structured decision contract
11  Decision state
12  Planner (maxReplans = 0)
13  Decision scoring
14  Quality / learning loop
15  Production observability
16  Final architecture review
```

# F. Smallest safe next phase

**Phase 2 — the merchant-content prompt-injection boundary.** `prompts.ts:82` and `relevanceRerank.ts:223,302`. One function plus a test file.

# G. Not to be touched in Phase 2

`lib/fashion/**` · `lib/catalog/**` · `lib/stylist/providers.ts` · `lib/stylist/limits.ts` · `GlobalCatalogService.ts` · `web/convex/**` · all six crons · `web/vercel.json` · **the prompt text itself** — SHA-256 checksums must still pass.

# H. Acceptance tests for Phase 2

1. `npm run verify` green at 22 before and after; `scripts/prompts.js` checksums **unchanged**.
2. New security harness: instruction-like merchant text, fake section headers, injected tokens and 4,000-char payloads all survive as inert data.
3. `characterize.js` identical except where a fixture is deliberately hostile.
4. A benign description still contributes its fashion attributes.
5. Diff touches no file under `lib/fashion/`, `lib/catalog/`, `web/convex/`.

# I. Rollback

One commit, `git revert`. The sanitiser is a pure function behind a single call site.

# J. Evidence that would stop or change the plan

- Checksums change → prompt text moved; stop.
- `characterize.js` differs on benign fixtures → sanitisation is lossy; narrow it.
- Judge ranking shifts on benign products → description carried more signal than expected.
- A provider recovers → re-run the smoke check; may reprioritise phase 3.
- Constraint benchmark shows satisfaction already high → reorder retrieval ahead of the decision layer.
- Hybrid retrieval loses to the baseline → revert, keep the fan-out, end the corpus programme.
