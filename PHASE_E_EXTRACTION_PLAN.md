# PHASE E — EXTRACTION PLAN

`web/app/api/ai/stylist/route.ts` — 3,037 lines, 26 imports, at `33ac8c9`.

**Plan only. No code. Awaiting approval, per the instruction and §112.**

Constraint accepted and load-bearing throughout: **no behaviour, prompt, schema,
provider selection, retrieval logic or output grammar changes in this phase.**
Every module below is a *move*, and where a move is not provably behaviour-
preserving this document says so rather than proposing it.

---

## 0. THE HONEST HEADLINE

This file is not badly written. It is a decision engine that has been debugged
in production for months, and nearly every oddity in it is load-bearing —
`grep -c "the exact reported bug\|which is the bug\|which is what"` finds
dozens of comments naming a specific incident. **The risk of this phase is not
that the code is hard to understand. It is that it is understood too shallowly
and a fix is dropped.**

Three properties make it genuinely hard to cut:

1. **Fifteen exit points**, each `finish()`-ing a different response shape.
2. **Eleven request-scoped mutable variables** rewritten across ~500 lines of
   post-processing, in an order where several steps read what earlier ones
   wrote.
3. **Seven closures** that capture request state (`applyGenderDefault`,
   `sizeForQuery`, `rescueSearch`, `withoutTheModel`, `beginSpeculativeSearch`,
   `bagPrices`, `nothingShown`) and are called from many places.

A "clean" extraction that turns those into parameters is where fixes die.

---

## 1. RESPONSIBILITY INVENTORY

Everything currently inside the file, grouped by what it is actually for.

| # | Responsibility | Lines (approx) | Nature |
|---|---|---|---|
| R1 | HTTP transport, NDJSON stream, `send`/`finish` | 1481–1530 | pure plumbing |
| R2 | IP rate limiting | 1437–1479 | pure, shared state |
| R3 | Request body parsing (25 fields) | 1596–1700 | pure |
| R4 | Usage/analytics logging | 41–117 | side-effect, DB |
| R5 | Intent routing (heavy/light/feedback/follow-through) | 569–726 | pure |
| R6 | Prompt assembly (SYSTEM, CHAT, VISION, FASHION_KNOWLEDGE) | 1013–1193 | data |
| R7 | Provider ladder (`stylistChat`) + breaker | 730–941, 1544–1570 | I/O, shared state |
| R8 | Vision path (photo → words) | ~2100–2300 | I/O |
| R9 | Retrieval orchestration (`multiCategorySearch`, 17 call sites) | 236–463 + inline | I/O |
| R10 | Outfit composition (`looksFrom`, slot building) | 465–503, 2684–2806 | pure-ish |
| R11 | Answer parsing boundary | 2512–2525 | **already extracted** |
| R12 | Post-processing pipeline (10 ordered steps) | 2537–3003 | **the hard part** |
| R13 | Response construction (15 `finish` shapes) | scattered | plumbing |
| R14 | Error handling + degraded fallback (`withoutTheModel`) | 1820–1870 | control flow |
| R15 | Tracing | 1589–1594 + calls | **already extracted** |
| R16 | Mode branches (default / load-more / wardrobe-scan) | 1909–2007 | control flow |

---

## 2. STATE

### 2.1 Shared mutable state — module level, survives across requests

| Symbol | Line | Purpose | Extraction hazard |
|---|---|---|---|
| `aiUsageCounter` | 67 | sampling counter for usage logging | **safe** — sampling only |
| `providerOut` | 942 | provider→cooldown-until, quota discoveries | **must stay one instance.** Two copies = each request re-discovers a dead provider. Already a known cross-request bleed |
| `stylistBuckets` | 1437 | IP→rate-limit window | **must stay one instance.** Two copies = double the effective rate limit |
| `lastStylistSweep` | 1443 | last GC of the bucket map | safe |
| `modelFailures` | 1546 | breaker counter | **must stay one instance.** Two copies = breaker never trips |
| `breakerOpenedAt` | 1547 | breaker open timestamp | as above |

**This is the single largest correctness risk in the phase.** All six are
module-scoped singletons that work *because* there is exactly one module. Any
extraction that results in two import paths to the same logic, or a factory
called per-request, silently disables a protection. Every one must move as a
*single* module imported by everything that needs it — never duplicated, never
re-instantiated.

### 2.2 Request-scoped mutable state — inside `runStylistRequest`

`foundProducts`, `foundProductGroups`, `reply2`, `honestyNote`, `outfitSlots`,
`outfitTrace`, `outfitGroups`, `surfacedFromReply`, `modelTrace`, `raw`,
`speculative` — eleven variables, written and re-read across R12.

`trace` is also request-scoped and already correct (Phase D).

### 2.3 Closures capturing request state

`applyGenderDefault`, `sizeForQuery`, `rescueSearch`, `withoutTheModel`,
`beginSpeculativeSearch`, `bagPrices`, `nothingShown`. Each closes over the
parsed body. `rescueSearch` additionally closes over `requestDeadline`,
`countryCode`, `buyerCurrency`, `tasteProfile`, `onSearchProgress`,
`shopperGender`, `images` — seven captures.

---

## 3. IMPLICIT ORDERING DEPENDENCIES

The post-model pipeline (R12) is a sequence, not a set. Confirmed by reading
execution order 2537 → 3003:

```
 1. parse answer                        → searchQuery, outfitQueries, outfitSets
 2. applyGenderDefault                  MUST be after 1, before any retrieval
 3. placePinnedCards / linkPinned       MUST be after tokens are stripped (1)
 4. search / multiCategorySearch        writes foundProducts, honestyNote
 5. outfit slot build                   writes outfitSlots, outfitTrace
 6. outfits ([OUTFITS:]) build          writes outfitGroups
 7. "nothingShown" guarantee retry      reads 4,5,6 — must be after all three
 8. surfaceFromReply fallback           only if 4,5,6 produced nothing
 9. groundReplyInProducts               only if model searched AND !8
10. sameGarment verdict                 reads foundProducts from 4
11. exactMatchNote + stripUnverifiable  MUST be after 10 (needs the verdict)
12. stripEmphasis                       MUST be last text step — after 11
13. suggestQuery                        MUST be after 12 (reads final reply2)
14. trace note/shown/keep               after everything
15. finish                              last
```

**Five of these are order-critical and none is enforced by a type.** 11-before-12
in particular was a bug fixed this week: appending the honest note *after*
`stripEmphasis` left raw markdown in the note. An extraction that reorders any
of these compiles cleanly and breaks silently.

**Mitigation:** the pipeline moves as ONE function with the steps in place, not
as ten composable stages. Composability here is the thing that would break it.

---

## 4. PROPOSED MODULES

Ordered by ascending risk. **Each step is independently shippable and
independently revertable.** Nothing below changes a prompt, a schema, provider
order, retrieval logic or the output grammar.

---

### E1 — `lib/stylist/limits.ts` (rate limit + breaker + provider cooldown)

1. **Moves:** `stylistBuckets`, `STYLIST_MAX`, `STYLIST_WIN`, `lastStylistSweep`,
   `STYLIST_SWEEP_EVERY`, `stylistRateLimited`, `modelFailures`,
   `breakerOpenedAt`, `BREAKER_TRIP_AT`, `BREAKER_COOLDOWN_MS`,
   `modelLooksDown`, `noteModelFailure`, `noteModelSuccess`, `providerOut`,
   `PROVIDER_OUT_MS`, `isRateLimited`.
2. **Stays:** every call site, unchanged.
3. **Interface:**
   `rateLimited(req): boolean` · `modelLooksDown(): boolean` ·
   `noteModelFailure(): void` · `noteModelSuccess(): void` ·
   `markProviderOut(name, ms): void` · `providerIsOut(name): boolean` ·
   `isRateLimitError(err): boolean`
4. **Depends on:** `NextRequest` only.
5. **Could change:** **nothing, if and only if there is exactly one instance.**
   The whole risk is duplication. `providerOut` is currently read inside
   `stylistChat`; moving it means `stylistChat` imports it rather than closing
   over it — same object, different lookup.
6. **Proof:** a new `scripts/limits.js` asserting (a) the 31st request in a
   window is refused and the 30th is not, (b) the breaker opens on the 3rd
   consecutive failure and closes after cooldown, (c) `noteModelSuccess` resets
   the counter, (d) **module identity** — importing from two paths yields the
   same counter, which is the failure mode this step risks.

**Risk: LOW.** Self-contained, no request state, testable without a model.

---

### E2 — `lib/stylist/usage.ts` (analytics + vocab misses)

1. **Moves:** `convexUsageClient`, `estimateTokens`, `AI_USAGE_SAMPLE_N`,
   `aiUsageCounter`, `logAiUsage`, `recordVocabMiss`.
2. **Stays:** call sites.
3. **Interface:** `logAiUsage(info): void` · `recordVocabMiss(q, reason): void` ·
   `estimateTokens(text): number`
4. **Depends on:** `convex/browser`, `@/convex/_generated/api`, `anyApi`,
   `NEXT_PUBLIC_CONVEX_URL`, `CONVEX_AUTH_SECRET`.
5. **Could change:** the sampling counter is shared — same duplication hazard as
   E1, lower stakes (over-sampling costs Convex ops, not correctness).
6. **Proof:** extend `scripts/trace.js` or add `scripts/usage.js`: sampling
   fires 1-in-N, a missing Convex URL is inert rather than throwing, and both
   functions are fire-and-forget (never awaited, never reject).

**Risk: LOW.** Pure side-effect, already failure-silent.

---

### E3 — `lib/stylist/intent.ts` (routing predicates)

1. **Moves:** `isBareGreeting`, `isHeavyQuery`, `isReactionOnly`,
   `isProductIntent`, `isShoppingContinuation`, `isActionFollowThrough`,
   `OUTFIT_LAYER_RE`, `separatedGarmentKeys`, `garmentLabel`, `outfitSlotInfo`,
   `cleanSubQuery`, `SUBQUERY_FILLER`, `GARMENT_DISPLAY`.
2. **Stays:** call sites; `applyGenderDefault` **stays in the handler** (it
   closes over the shopper profile).
3. **Interface:** the six predicates as named exports, plus
   `separatedGarmentKeys(q)`, `garmentLabel(key)`, `outfitSlotInfo(q)`,
   `cleanSubQuery(q)`.
4. **Depends on:** `@/lib/queryParser`, `@/lib/fashion/intentRouter`.
5. **Could change:** **nothing.** All are pure string→boolean/string.
6. **Proof:** these are exactly what `eval/scenarios.json` already covers.
   Add a `routing` group asserting each predicate against ~30 real questions
   from the existing occasion/garment sets — heavy vs light, reaction vs
   request, follow-through vs new ask. Runs with no model.

**Risk: LOW.** Pure functions, and the evaluation set already exercises the
vocabulary they sit on.

---

### E4 — `lib/stylist/prompts.ts` (the prompt registry, §50)

1. **Moves:** `SYSTEM`, `CHAT_SYSTEM`, `VISION_SYSTEM`, `FASHION_KNOWLEDGE`,
   `GROUNDING_SYSTEM`, `productBlock`, `compactProductLine`, `enrichHistory` —
   ~700 lines of string constants.
2. **Stays:** every call site; **the text is copied byte-for-byte.**
3. **Interface:** named exports, plus a `PROMPT_VERSIONS` map so §50's
   versioning has somewhere to live later.
4. **Depends on:** nothing.
5. **Could change:** **nothing, if the bytes are identical.** This is the one
   step where a stray whitespace edit is a real behaviour change — the prompt
   is the model's entire instruction set.
6. **Proof:** a byte-level assertion. `scripts/prompts.js` compares a SHA-256
   of each exported constant against a checksum recorded at extraction time.
   Any edit — including whitespace — fails the check until the checksum is
   deliberately updated. This is stronger than any behavioural test and it is
   the correct guarantee for text that is not code.

**Risk: LOW mechanically, HIGH if done carelessly.** Mitigated entirely by the
checksum: it cannot silently drift.

---

### E5 — `lib/stylist/retrieval.ts` (retrieval orchestration)

1. **Moves:** `multiCategorySearch`, `looksFrom`, `multiCategoryReplyText`,
   `refineSearchQuery`, `brandNameOf`, `stripBrandNames`, `dedupeById`,
   `INITIAL_RESULT_CAP`, `MULTI_CATEGORY_PER_GROUP_CAP`, `imageOf`.
2. **Stays:** all 17 inline `GlobalCatalogService.search(...)` call sites —
   **they stay exactly where they are.** Each carries a different budget,
   different concepts, a different fallback and a different comment naming the
   bug it prevents. Unifying them is a behaviour change and is out of scope.
3. **Interface:** `multiCategorySearch(...)` with its current 8-parameter
   signature unchanged · `looksFrom(groups)` · `refineSearchQuery(...)` ·
   `dedupeById(items)`.
4. **Depends on:** `GlobalCatalogService`, `queryParser`, `outfitKnowledge`,
   `enrichProduct`, `garmentProfile`, `groqChat`.
5. **Could change:** `multiCategorySearch` takes a `sizeForQuery` *closure* as a
   parameter today — that already works and must not become a value.
   `refineSearchQuery` makes a model call; moving it must not change which
   model (`FAST_MODEL`) or its `max_tokens: 40`.
6. **Proof:** `multiCategorySearch` is the one piece here that can be tested
   without a network — its *query planning* is deterministic. `scripts/retrieval.js`
   with a stubbed `GlobalCatalogService` asserting: "shirts and trousers" plans
   two strips not one; an occasion with no garment plans the table's slots; the
   season's fabric is prepended for an occasion and not for a named garment;
   each strip's label is the garment's display name. That covers the
   decision-making; the fetching is unchanged code.

**Risk: MEDIUM.** Large surface, but the seams are already function boundaries.

---

### E6 — `lib/stylist/providers.ts` (the ladder)

1. **Moves:** `stylistChat`, `Attempt`, `GROQ_8B`, `GROQ_70B`,
   `cerebrasFits`/`CEREBRAS_CONTEXT_CAP`, `ATTEMPT_MS`, `LADDER_MS`,
   `FIRST_SHARE`, `BUSY_REPLY`.
2. **Stays:** call sites; **provider order, model choice, `reasoning_effort`,
   context cap and budget arithmetic all byte-identical.**
3. **Interface:** `stylistChat(messages, system, opts, useGemini): Promise<{role, content, provider}>`
   — the current signature, unchanged.
4. **Depends on:** the four provider clients, E1 (`providerOut`, breaker),
   `stripThinkTags`/`stripAiDashes`/`stripSafetyLabels`/`looksLikeLeakedReasoning`,
   `STYLIST_ATTEMPT_MS`, `STYLIST_LADDER_MS`.
5. **Could change:** **the ladder ORDER is the behaviour here.** The
   `cerebrasFits` branch reorders attempts by estimated prompt size; the
   front-loaded budget gives rung 1 55%; the last rung takes everything left.
   Each was a fix. None may move.
6. **Proof:** `scripts/ladder-budget.js` **already covers the budget
   arithmetic** and must keep passing unchanged. Add to it: an assertion that
   the *composed order* for a given (`useGemini`, `cerebrasFits`, cooldown
   state) matches a recorded table — so a reordering fails rather than ships.

**Risk: MEDIUM-HIGH.** Small code, enormous blast radius. Shipped alone.

---

### E7 — the handler itself: **NOT extracted in this phase**

`runStylistRequest` (1595–3037) keeps R3, R8, R12, R13, R14, R16 and all seven
closures.

**Why this is the recommendation rather than a failure of nerve:**

- R12's ten steps have five order-critical edges that no type enforces.
- Fifteen exit points each build a different response shape; a shared builder
  would have to reproduce all fifteen exactly.
- Seven closures capture seven pieces of request state between them.
- The evaluation set **does not cover** retrieval purity or live behaviour — so
  an extraction here can be verified against 149 scenarios and a build, and not
  against "does the app still work."

After E1–E6 the handler is roughly **1,400–1,600 lines** and contains only
request-scoped orchestration: parse, branch by mode, call the model, run the
pipeline, finish. That is a legible file. Cutting further is Phase E2, and it
should be gated on a live end-to-end suite, which needs provider quota.

---

## 5. WHAT COULD CHANGE, IN ONE PLACE

Ranked. Every one is a *risk of the move*, not a proposed change.

| Risk | Where | Mitigation |
|---|---|---|
| Duplicated singleton silently disables the breaker or rate limit | E1 | module-identity test |
| A byte changes in a prompt | E4 | SHA-256 checksum per constant |
| Provider order or budget shifts | E6 | recorded order table + existing budget harness |
| A pipeline step reorders | E7 (avoided) | not extracted |
| A `finish` shape loses a field | E7 (avoided) | not extracted |
| `sizeForQuery` closure becomes a value | E5 | signature kept, closure passed |
| Import cycle (`groq` ⇄ `cerebras` already deferred at runtime) | E6 | keep the existing dynamic `import()` |

---

## 6. SEQUENCE AND ACCEPTANCE

Six commits, each independently revertable, each with `npm run verify` green
(now 13 checks, 149 scenarios) **and** a production smoke check.

```
E1 limits      →  verify + smoke
E2 usage       →  verify + smoke
E3 intent      →  verify + smoke + new routing scenarios
E4 prompts     →  verify + smoke + checksum harness
E5 retrieval   →  verify + smoke + new retrieval harness
E6 providers   →  verify + smoke + order table
```

A phase step is done when: `npm run verify` is green, the production smoke
check returns a full answer with products for a known query, and the diff for
that step contains **no change to any string literal, numeric constant, or
call order** — checkable mechanically, and I would rather it be checked that
way than asserted.

Expected end state: route.ts ~1,400–1,600 lines, 6 new modules, ~4 new
harnesses, zero behaviour change.

---

## 7. WHAT I WOULD ASK BEFORE STARTING

1. **E6 alone, or E1–E5 first?** The ladder is the smallest diff and the
   largest blast radius. I would ship E1–E5, watch production for a day, then
   do E6 on its own — but that is a judgment about your appetite, not a
   technical fact.
2. **Is ~1,500 lines an acceptable end state for this phase?** Cutting to the
   §72 target of a thin transport layer means extracting R12, and I do not
   think that is safe without a live suite.
3. **The prompt checksum will fail the first time anyone edits a prompt on
   purpose.** That is the intent, and it means a deliberate two-line ritual
   (edit, update checksum). Confirm you want that friction — it is the only
   real guard on 700 lines of text that no test can otherwise see.

**Stopping here for approval.**
