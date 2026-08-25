# DISCERN — REPOSITORY AUDIT

Against `Discern_phases.md` v2.0 (§91 Phase 0, §112 master instruction).
Repository: **`ENUID/From`** — the spec says `ENUID/Discern`; that is the first
discrepancy and worth confirming before anything is filed against the wrong name.

Commit audited: `dc66b2b`. No code was written for this document beyond one
defect fix noted in §9, which predated it.

**Status: audit only. Awaiting approval before Phase 1, per §112.**

---

## 0. THE HEADLINE

The spec's read of the repository is broadly right and wrong in three specific,
consequential places. It says (§2.3) the repo "is not an empty shell" and "has
already started moving toward the architecture described." That is true. But:

| Spec says | Reality |
|---|---|
| §2.5 "garment-profile system already exists" | **Correct.** `lib/fashion/garmentProfile.ts` + `lib/services/enrichProduct.ts` |
| §16 embeddings | **Absent.** No embedding, no vector index, nowhere |
| §44 "already contains Zod. Use runtime validation" | **1 import in the entire codebase.** Effectively absent |
| §42 recommendation trace | **Absent.** No trace id anywhere |
| §55 evaluation dataset | **Absent.** 21 harnesses exist, none is a scenario set |

The single most important structural fact is the one §72 already names, now
measured:

```
app/api/ai/stylist/route.ts     2,992 lines,  25 imports
features/v2/DiscernV2.tsx       3,892 lines
lib/stores.ts                   5,929 lines
lib/services/GlobalCatalogService.ts  1,764 lines
```

Two files hold ~6,900 lines of decision logic and UI. That is the compression
§3 describes, and it is the reason "why did it show this?" cannot be answered.

---

## 1. CURRENT ARCHITECTURE MAP

```
browser
  └─ app/page.tsx → features/v2/Boutique.tsx      (context assembly, product normalising)
       └─ features/v2/DiscernV2.tsx               (ALL UI: home, results, PDP, bag, panels)
            └─ features/stylist/askStylist.ts     (NDJSON reader, retries, budget)
                 └─ app/api/ai/stylist/route.ts   (THE ENGINE — 2,992 lines)
                      ├─ lib/queryParser.ts               deterministic parse
                      ├─ lib/intentCompiler.ts            intent → search args
                      ├─ lib/fashion/intentRouter.ts      heavy vs light routing
                      ├─ lib/fashion/outfitKnowledge.ts   occasion → slots/fabric/palette
                      ├─ lib/fashion/garmentProfile.ts    what a garment IS + worksWith()
                      ├─ lib/services/enrichProduct.ts    vision read, IN-MEMORY cache
                      ├─ lib/services/describeGarment.ts  photo → search line
                      ├─ lib/services/GlobalCatalogService.ts  UCP fan-out + rank
                      │    ├─ lib/services/relevanceRerank.ts  BM25 + LLM judge
                      │    └─ lib/services/sameGarment.ts      photo vs candidates
                      ├─ lib/{groq,gemini,cerebras,nvidia}.ts  provider ladder
                      └─ web/convex/*                     20 tables, 20 modules
```

**Two `convex/` directories exist.** `web/convex/` is live (20 tables). The root
`convex/` holds 6 files and a schema with a single `users` table. It is not the
deployed backend. Dead weight and an active trap for anyone reading the repo.

---

## 2. DATA FLOW

```
question + images + context
  → rate limit → parse body (25 fields)
  → route heavy/light (intentRouter)
  → [heavy] knowledge modules + style vocab injected into a ~5,500-token prompt
  → provider ladder (up to 4 rungs, front-loaded budget)
  → parse [SEARCH:] / [OUTFIT:] / [OUTFITS:] / [PRODUCT:N] tokens out of PROSE
  → GlobalCatalogService.search()  ×1 or ×4 (per slot)
       → ~90 store fan-out → normalise → dedupe → concept filter
       → palette re-rank → sameGarment (if photo) → BM25 + LLM judge
  → composeOutfit / composeOutfitsWithProfiles
  → honesty passes (exactMatch, stripEmphasis, suggestQuery)
  → NDJSON: many {progress} + one {result}
```

**§44 is violated at the centre of the system.** The model's answer is prose,
and the app recovers structure from it with regexes:

```
lib → app/api/ai/stylist/route.ts
  /\[SEARCH:\s*([^\]]+)\]/i
  /\[OUTFIT:\s*([^\]]+)\]/i
  /\[OUTFITS:\s*([^\]]+)\]/i
  /\[PRODUCT:\d{1,2}\]/
```

This is exactly the `LLM prose → frontend regex` pattern §44 forbids, one layer
earlier. Everything downstream — whether products appear at all — depends on a
model remembering a bracket grammar. Measured this week: the token was missed
often enough that three separate fallbacks now exist to paper over it
(`describeGarment`, the reply-garment surfacer, `suggestQuery`).

---

## 3. AI / MODEL FLOW

Ladder, in order, per request: **cerebras → gemini → groq(70B, 8B) → nvidia**,
re-ordered by `cerebrasFits` (8K context cap) and by a cooldown map.

Budget: `LADDER_MS` 34s, first rung 55%, rest split, floor 11s each.
Breaker opens after consecutive failures and skips the model entirely.

**Live provider state at audit time:**

| provider | state |
|---|---|
| cerebras | `HTTP 402 payment required` |
| gemini | ok (recovered; free tier) |
| groq | ok |
| nvidia | ok (recovered; free tier) |

Vision is separate: `wardrobeVisionChat` has its own gemini → cerebras → groq
chain. `groqVisionChat` is used directly by `enrichProduct` and
`describeGarment` — **those two do not fall back at all.**

---

## 4. UCP / SHOPIFY FLOW

`lib/stores.ts` — 5,929 lines, **472 brands**, hand-curated with categories,
vibe, gender, priceRange, items, about. Filtered to a US/India market set.

Search fans out to ~90 stores per query with a soft deadline, two rounds, and
per-store timeouts; failures feed `brandHealth`. Results are normalised to
`UcpProduct`, deduped by brand+title, currency-converted into `display_price`.

This layer is the healthiest part of the repository.

---

## 5. PRODUCT ENRICHMENT FLOW — **the biggest gap that already has code**

`enrichProduct.profilesFor()` reads garments once via vision into a
`GarmentProfile` (fit, volume, fabric, weight, drape, pattern, patternScale,
colour, formality, aesthetic, season, details, quality).

```
lib/services/enrichProduct.ts:29
  const mem = new BoundedCache<string, GarmentProfile>(10_000)
```

**In-memory only.** Not in any of the 20 Convex tables. Every cold start throws
away every profile and re-pays the vision cost, on providers that are out of
quota. §15 asks for a cache identity of *product id + image version + schema
version + prompt version + model version*; what exists is a process-local Map
keyed on product id alone.

This is the highest-value, lowest-risk item in the whole spec: the reading
already works, it just does not survive.

---

## 6. OUTFIT / RANKING FLOW

- `outfitPlan()` — occasion → slots, formality floor, palette, season fabrics
- `composeOutfitsWithProfiles()` — profile-based, weakest-pair-decides
- `worksWith(a,b)` — **already multiplicative**, matching §34/§35: formality
  gap ≥3 → ×0.15, pattern clash → ×0.4, season clash → ×0.45

§34–35 are, in substance, **already implemented**. Weights are literals rather
than configuration, and there is no evaluation data to tune them against.

Ranking: BM25 → LLM judge (0.7 llm + 0.3 bm25, <20 demoted). The judge reports
its own outcome (`judged | cached | warming | disabled | no-budget | no-answer |
too-few`) — this is the one place the system already meets §43's standard.

---

## 7. USER MEMORY FLOW

`web/convex/schema.ts` — 20 tables including `taste_profile`, `stylist_memory`,
`saved_products`, `search_history`, `user_events`, `quality_signals`,
`relevance_adjustments`, `learning_insights`.

The structure §17 asks for largely exists. What is missing is §18: preferences
have no confidence, and there is no distinction between *stated* and *inferred*.

§41 events: `impression`, `product_view`, `search`, `ai_usage` are recorded.
**None of `outfit_shown`, `outfit_rejected`, `slot_swapped`, `product_rejected`
exist.** The learning loop §59 describes has no rejection signal to learn from —
which is the same gap as the lookbook having 17 approved looks and 1 rejected.

---

## 8. UI FLOW

`DiscernV2.tsx` is 3,892 lines and contains home, results, product page, bag,
panels, the composer, and all CSS-in-JS. It receives products and prose; the
outfit structure it renders (`outfitSlots`) is real structured data, so §70 is
partially met for outfits and not met for anything else.

§6.1's opening — occasion chips before free text — does not exist. The home
screen is a hero plus a text box.

---

## 9. A DEFECT FOUND DURING THIS AUDIT (fixed, `dc66b2b`)

`sameGarment.ts` already existed and `GlobalCatalogService` already called it.
Earlier this week I wrote a second implementation over the top of it and wired a
second call into the stylist route — so every photo search made the same vision
comparison twice, on the same picture, against the same candidates, on providers
that are out of quota.

It compiled and passed every test, because a duplicate is not a type error and
no test asserted "one vision call per photo search". The route now reads the
verdict the catalogue already reached.

**This is the audit's argument in miniature.** Nothing was type-wrong; the
system simply had no way to notice it was doing the same work twice.

---

## 10. GAPS AGAINST THE SPEC

| § | Requirement | State |
|---|---|---|
| 8 | Canonical `DiscernProduct` | **MISSING** — `UcpProduct` and `V2Product` are two shapes, mapped by hand |
| 9 | source vs derived provenance | **MISSING** — `GarmentProfile` has `readBy`/`readAt`, nothing else does |
| 13 | attribute conflict resolution | **MISSING** — vision never meets merchant metadata |
| 15 | durable enrichment cache | **MISSING** — in-memory, see §5 |
| 16 | embeddings | **MISSING** — entirely |
| 18 | preference confidence | **MISSING** |
| 21 | validated intent schema | **PARTIAL** — `intentCompiler` returns typed args, unvalidated |
| 22–23 | session state + refinement ops | **MISSING** — no session object; follow-ups re-parse from history |
| 42 | recommendation trace | **MISSING** |
| 44 | structured contract, no prose parsing | **VIOLATED** — see §2 |
| 49 | provider adapters | **PARTIAL** — 4 clients, no shared interface |
| 50 | prompt registry | **MISSING** — the heavy prompt is ~700 lines inline in route.ts |
| 55–58 | evaluation set, criteria, error taxonomy | **MISSING** |
| 71 | decision-trace admin view | **PARTIAL** — analytics/community/vocab exist; no per-request trace |
| 77–78 | product quality score | **MISSING** |

**Already met, and should be preserved rather than rebuilt:** §10 ontology,
§20 lossy-compilation guard, §26 category correctness, §27 multi-category split,
§28 occasion translation, §34–35 multiplicative compatibility, §53 fallbacks,
§64 truthful progress, §84 no-result honesty.

---

## 11. FILE-BY-FILE

| File | Verdict | Why |
|---|---|---|
| `app/api/ai/stylist/route.ts` | **REFACTOR** | 2,992 lines. Extract per §72. Highest risk in the repo |
| `features/v2/DiscernV2.tsx` | **REFACTOR** | 3,892 lines, whole UI in one component |
| `lib/services/GlobalCatalogService.ts` | **KEEP** | Works. Extract rank/filter later |
| `lib/stores.ts` | **KEEP** | 472 curated brands — real proprietary asset |
| `lib/queryParser.ts` | **KEEP** | Ontology + exclusions; well tested |
| `lib/fashion/outfitKnowledge.ts` | **KEEP** | This is §28/§30 already built |
| `lib/fashion/garmentProfile.ts` | **KEEP** | This is §14/§34 already built |
| `lib/services/enrichProduct.ts` | **REFACTOR** | Persist the cache (§15) |
| `lib/services/relevanceRerank.ts` | **KEEP** | Reports its own outcome — the model to copy |
| `lib/{groq,gemini,cerebras,nvidia}.ts` | **REFACTOR** | Behind one interface (§49) |
| `web/convex/*` | **KEEP** | 20 tables, sound |
| `convex/` (root) | **REPLACE → delete** | Dead duplicate, 6 files, misleading |
| `lib/intentCompiler.ts` | **REFACTOR** | Becomes IntentService (§94) |
| `scripts/*.js` (21) | **KEEP** | Real regression harness; `npm run verify` gates pushes |
| — | **MISSING** | SessionState, RecommendationTrace, EvaluationCase, embeddings, prompt registry |

---

## 12. RISKS

1. **Quota, not code.** Cerebras needs paying; gemini/nvidia are free tiers that
   will exhaust again under real traffic. Half the quality problems this week
   traced to the clock, not the logic. No refactor fixes this.
2. **Module-level globals for per-request state.** `lastJudgeOutcome`,
   `lastSameGarment`, `providerOut` are shared across concurrent requests.
   `lastSameGarment` is keyed by image so it cannot bleed; the others can.
3. **Prose parsing is load-bearing.** Three fallbacks already exist because the
   token grammar is missed. Every new one adds surface.
4. **No evaluation set.** Every quality change this week was validated against
   one query at a time, by hand. That does not scale and cannot detect
   regressions.
5. **Refactoring route.ts is genuinely dangerous.** It encodes dozens of
   specific, hard-won fixes, each with a comment naming the bug it prevents.
   A clean rewrite would silently drop most of them.

---

## 13. PROPOSED MIGRATION PLAN

Ordered by value-per-risk, not by the spec's numbering.

**Phase A — persist enrichment (§15).** Smallest change, largest immediate
return: profiles already work, they just die on cold start. Add a Convex table
with the full §15 cache identity. No behaviour change, immediate cost drop.

**Phase B — evaluation set (§55–56).** 100–300 scenarios with expected intent
and criteria, run by `npm run verify`. Everything after this is measurable;
nothing before it is. This is the highest-leverage item in the document.

**Phase C — structured output (§44).** Replace token-grammar parsing with a
validated JSON contract, Zod at the boundary. Removes the fallbacks in §2 and
the whole class of "the model forgot the bracket".

**Phase D — trace + admin view (§42, §71).** Now that B exists to prove nothing
broke. Answers "why did it show this?" — the question §3 says is currently
unanswerable.

**Phase E — extract the pipeline (§72).** Only after B and D. Refactoring 2,992
lines without an evaluation set and a trace is how the hard-won fixes get lost.

**Phase F — embeddings (§16).** Real visual retrieval. Correctly the last of
these: it is the largest build and the current `sameGarment` verification
covers the common case.

**Deliberately deferred:** §60/§88 — no Postgres, no Redis, no vector DB, no
Kubernetes. Convex is not the constraint.

---

## 14. THE ONE QUESTION I CANNOT ANSWER FROM THE SPEC

§89 prescribes one phase at a time with review between. §13 of this audit
proposes an order that differs from the spec's numbering, because the spec's
Phase 1 (domain schemas) has no measurable effect until Phase 4, whereas
persisting enrichment pays for itself on the next cold start.

**Which order do you want — the spec's, or this one?** Per §90.20, that is a
product-judgment call and I am stopping rather than assuming.
