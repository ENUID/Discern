# DISCERN — REPOSITORY AUDIT

Against `Discern_phases.md` v2.0 (§91 Phase 0, §112 master instruction).
Repository: **`ENUID/From`** — the spec says `ENUID/Discern`; that is the first
discrepancy and worth confirming before anything is filed against the wrong name.

First written at `dc66b2b` as audit-only. **Revised at `4d516a5`**, after
Phases A, B and C were approved and shipped — because a gap report that
describes a repository which no longer exists is worse than none when the
question is what to build next. Rows that have moved are marked **DONE** with
the commit that moved them; nothing has been deleted, so the original reading
is still legible beside the current one.

**Status: Phases A, B, C shipped and verified on production. Phase D proposed,
awaiting approval.**

---

## 0. THE HEADLINE

The spec's read of the repository is broadly right and wrong in three specific,
consequential places. It says (§2.3) the repo "is not an empty shell" and "has
already started moving toward the architecture described." That is true. But:

| Spec says | Reality |
|---|---|
| §2.5 "garment-profile system already exists" | **Correct.** `lib/fashion/garmentProfile.ts` + `lib/services/enrichProduct.ts` |
| §16 embeddings | **Absent.** No embedding, no vector index, nowhere |
| §44 "already contains Zod. Use runtime validation" | ~~1 import, effectively absent~~ → **DONE** `4d516a5`. The model's answer is Zod-validated at one boundary; the route holds zero prose regexes |
| §42 recommendation trace | **Absent.** No trace id anywhere — this is Phase D |
| §55 evaluation dataset | ~~Absent~~ → **DONE** `300d7ae`. 149 scenarios, 8 groups, 0.2s, no model, gating every push |

The single most important structural fact is the one §72 already names, now
measured:

```
                                      at audit    now (4d516a5)
app/api/ai/stylist/route.ts        2,992 lines    2,978 lines, 26 imports
features/v2/DiscernV2.tsx          3,892 lines    3,892 lines
lib/stores.ts                      5,929 lines    5,929 lines
lib/services/GlobalCatalogService  1,764 lines    1,764 lines
```

Two files still hold ~6,900 lines of decision logic and UI. Phases A–C moved
almost none of that, and deliberately: they put contracts and measurement
AROUND the compression rather than cutting into it. That was the right order —
route.ts encodes dozens of specific fixes, each with a comment naming the bug
it prevents, and there was until this week no evaluation set that could tell
you if a refactor had dropped one. There is now.

The compression itself is Phase E, and it is still the largest risk here.

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

> **DONE — `4d516a5` (Phase C).** One Zod-validated boundary
> (`lib/stylist/answer.ts`) with three strategies tried in turn: json →
> tokens → prose. The grammar was MOVED, not rewritten — nothing about what
> the model is asked for changed, because doing that while three of four
> providers are out of quota is the most dangerous edit available here. The
> route now holds zero prose regexes; everything downstream reads a typed
> object. `answerVia` reports which strategy answered, so the migration to
> JSON is visible rather than assumed. Live, it currently reads `tokens`.

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

> **DONE — `cbc611b` (Phase A).** Profiles now persist to a `garment_profiles`
> table, keyed by the full §15 identity (product + image + schema + prompt +
> model), no TTL, on by default. Proven by running the enrichment twice with
> the module registry cleared between: a cold start returns three profiles and
> makes **zero** vision calls. A dead cache still returns profiles by falling
> back to vision, so it can never be worse than before it existed.
>
> The paragraph below is the original finding, kept because it is the clearest
> statement of why this mattered.

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
| 15 | durable enrichment cache | **DONE** `cbc611b` — Convex, full §15 cache identity |
| 16 | embeddings | **MISSING** — entirely |
| 18 | preference confidence | **MISSING** |
| 21 | validated intent schema | **PARTIAL** — the model's ANSWER is validated (`4d516a5`); the shopper's INTENT still is not |
| 22–23 | session state + refinement ops | **MISSING** — no session object; follow-ups re-parse from history |
| 42 | recommendation trace | **MISSING** |
| 44 | structured contract, no prose parsing | **DONE** `4d516a5` — Zod boundary, zero regexes in the route |
| 49 | provider adapters | **PARTIAL** — 4 clients, no shared interface |
| 50 | prompt registry | **MISSING** — the heavy prompt is ~700 lines inline in route.ts |
| 55–58 | evaluation set, criteria, error taxonomy | **DONE** `300d7ae` — 149 scenarios, §58 labels, gates every push |
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

## 13. MIGRATION PLAN — THREE DONE, THREE TO GO

Ordered by value-per-risk rather than by the spec's numbering, and revised
against what is now true rather than what was true when it was written.

**Phase A — persist enrichment (§15). DONE, `cbc611b`.** Smallest change,
largest immediate return: the reading already worked, it just did not survive
a cold start. Zero vision calls on a fresh process, proven by clearing the
module registry between runs.

**Phase B — evaluation set (§55–56). DONE, `300d7ae`.** 149 scenarios, no
model, 0.2s, §58 labels, gating every push. It found four real bugs on its
first run — plural t-shirts resolving to button-ups, "tshirts" matching
nothing at all, "shirt dress" and "dress shirt" both resolving to `shirt`, and
seven cultural occasions compiling to nothing whatsoever. Everything after
this is measurable; nothing before it was.

**Phase C — structured output (§44). DONE, `4d516a5`.** One Zod boundary,
three strategies, grammar preserved. Zero prose regexes left in the route.

---

**Phase D — trace + admin view (§42, §71). NEXT.**

§3 lists thirteen questions the architecture cannot answer, and every one of
them is a variant of *why did we show this?* Three of the pieces now exist and
are not joined up: the judge reports its outcome, `answerVia` reports which
strategy read the model, `modelTrace` reports why the chain gave up. What is
missing is a recommendation id that ties them together and survives the
request.

It is next for a specific reason rather than by elimination. Every quality
question asked this week — why leather sandals for a denim clog, why blazers
for a casual party, why an outfit with nothing under it — was answered by me
re-running the request by hand and reading intermediate output that is thrown
away in production. That does not scale past one person, and it is the
difference between diagnosing a bad recommendation and guessing at it. It is
also the prerequisite for §59's learning loop: an event cannot be tied to the
decision that produced it if the decision has no id.

**Phase E — extract the pipeline (§72).** After D, not before. route.ts is
still 2,978 lines with 26 imports, and it encodes dozens of hard-won fixes
each carrying a comment naming the bug it prevents. Refactoring that without
an evaluation set was reckless; with B in place it is merely difficult, and
with D in place a regression becomes traceable rather than mysterious. This
remains the largest risk in the repository.

**Phase F — embeddings (§16).** Real visual retrieval, and correctly last: it
is the biggest build, and `sameGarment` already covers the common case by
verifying the shortlist the word search returned. What it cannot do is
RETRIEVE a piece the words never found — that is what an index buys, and it is
the honest answer to "find me this exact one" for a catalogue of 472 brands.

**Deliberately deferred:** §60/§88 — no Postgres, no Redis, no vector DB, no
Kubernetes. Convex is not the constraint; it took Phase A without complaint.

---

### Carried, not forgotten

Held at the founder's instruction to finish the phases first. Each is real and
each is small:

| | what | why it is not urgent |
|---|---|---|
| t-shirt retrieval leak | parsing is correct now; the catalogue still pads a thin result with near-misses rather than showing an empty page | a deliberate existing tradeoff that conflicts with §26's hard-constraint rule — a product call, not an engineering one |
| fit vocabulary | the parser says `wide-leg`, §10.2 canonises `wide` | the parser is more precise, not wrong; the two have simply never been reconciled |
| root `convex/` | dead duplicate, 6 files, single-table schema, not deployed | harmless until someone reads it and believes it |
| module-level globals | `lastJudgeOutcome`, `providerOut` are shared across concurrent requests | `lastSameGarment` is keyed by image and cannot bleed; the others can, and Phase D is where per-request state gets a home |
| Cerebras | `HTTP 402 payment required` | not a code problem, and no phase fixes it |

## 14. THE ONE QUESTION I CANNOT ANSWER FROM THE SPEC

§89 prescribes one phase at a time with review between. §13 of this audit
proposes an order that differs from the spec's numbering, because the spec's
Phase 1 (domain schemas) has no measurable effect until Phase 4, whereas
persisting enrichment pays for itself on the next cold start.

**Answered:** this order was chosen, and A, B and C are shipped.

The question that replaces it is narrower. Phase D adds a recommendation trace
and an internal view onto it — which is engineering, not product judgment, and
needs no decision from anyone. Phase E does need one, and it is worth asking
before rather than during: **route.ts holds dozens of fixes whose only record
is a comment naming the bug each one prevents.** The evaluation set now covers
the deterministic layers, and it does not cover retrieval purity or anything
that needs a live catalogue. So an extraction can be verified against 149
scenarios and a production build, and NOT against "does the app still behave".

That gap is closeable — a live end-to-end suite is a real thing to build — but
it costs provider quota to run, which is the one resource currently absent.
Phase E should either wait for that, or proceed knowing the safety net has a
hole in it. Per §90.20, which of those is a call I am not making alone.
