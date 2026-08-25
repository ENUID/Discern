# PRODUCTION ARCHITECTURE AUDIT

Measured at `2317da0`. Every number below comes from the working tree, not from
the earlier audit — several had moved.

**Audit only when written. STAGE 0 IS NOW COMPLETE** — see §11, appended after
execution. Everything from §1 onward describes the repository *before* Stage 0
and is left unedited so the before/after is legible.

---

## 0. THE FINDING THAT CHANGES THE PRIORITY ORDER

The brief lists four large files. There is a fifth, and it is the largest in
the repository:

```
7,174  web/features/discern/DiscernPage.tsx      ← nothing imports it
5,929  web/lib/stores.ts
3,892  web/features/v2/DiscernV2.tsx
3,037  web/app/api/ai/stylist/route.ts           (2,978 at the last audit; Phase D added 59)
1,764  web/lib/services/GlobalCatalogService.ts
  989  web/lib/_parked/ai-chat-route.ts          ← parked by name
```

`app/(shop)/page.tsx` renders `Boutique` → `DiscernV2`. **No live route imports
`DiscernPage`.** Grepping every import across `app/`, `features/v2/`,
`features/stylist/` and `lib/` returns nothing but comments referring to it in
the past tense.

```
features/discern/           8,352 lines   dead
lib/_parked/ + _parked/     1,233 lines   dead by naming convention
                           ─────────
                            9,585 lines   ≈ 21% of 44,710
```

**A fifth of this codebase is unreachable.** That matters more than any
extraction below, because every audit, every "route.ts is 3,037 lines" comparison
and every future search is currently reading a repository one-fifth larger than
the one that runs. Deleting it is a one-commit change with a zero-line diff to
anything live — and it must be *proved* dead, not assumed, which §8 below sets out.

---

## 1. RESPONSIBILITY MAP — THE LARGEST FILES

### 1.1 `app/api/ai/stylist/route.ts` — 3,037 lines, 26 imports

Fully mapped in `PHASE_E_EXTRACTION_PLAN.md`. Summary here; that document is
the detail.

| | |
|---|---|
| **Should remain** | HTTP/NDJSON transport, body parsing, mode branching, the 10-step ordered post-processing pipeline, 15 exit shapes, 7 request-capturing closures |
| **Should move** | rate limit + breaker + `providerOut`; usage logging; routing predicates; ~700 lines of prompts; retrieval orchestration; the provider ladder |
| **Module-global state** | `aiUsageCounter`, `providerOut`, `stylistBuckets`, `lastStylistSweep`, `modelFailures`, `breakerOpenedAt` — **six singletons that work because there is exactly one module** |
| **Request-scoped state** | 11 mutable variables + `trace` |
| **AI calls** | 9 sites (4 text providers, 4 vision, 1 refine) |
| **DB calls** | 3 (`users.trackEvent`, `vocabCandidates.recordMiss`, `tasteProfile.upsertWardrobeAnalysis`) |
| **Regression risk** | **HIGH** — five order-critical edges in the pipeline, none enforced by a type |

### 1.2 `lib/stores.ts` — 5,929 lines

**This is a data asset, and it should stay one.**

```
5,097 lines   UCP_REGISTRY_ALL — 472 hand-curated brands
  832 lines   code: 12 functions, 7 lookup tables
```

86% of the file is one array. Splitting 472 brand records across files buys
nothing and costs the ability to read the registry as a whole.

| | |
|---|---|
| **Should remain** | `UCP_REGISTRY_ALL`, `BRAND_NAMES`, `CATEGORY_TAXONOMY`, `GEO_REGIONS`, `ICON_BRANDS`, `VERIFIED_GOOD_BRANDS`, `VIBE_GLOSSARY` — the data |
| **Should move** | the 832 lines of behaviour: `detectBrandsInQuery`, `brandQualityScore`, `bestBrandDomains`, `getStoreCountry`, `cleanBrandToken`, `brandDisplayName`, `storeLanguageLabel`, and the four `build*` prompt-string builders |
| **Target** | `lib/catalog/brands/registry.ts` (data, ~5,100) + `lib/catalog/brands/lookup.ts` + `lib/catalog/brands/quality.ts` + `lib/catalog/brands/directory.ts` (the prompt builders — these belong with prompts, not with data) |
| **Module-global state** | none mutable. `UCP_REGISTRY` is a filtered `const` derived at module load |
| **Regression risk** | **LOW.** Pure functions over static data. `detectBrandsInQuery` is the only subtle one — its match order and `GENERIC_BRAND_WORDS` guard are load-bearing |

### 1.3 `lib/services/GlobalCatalogService.ts` — 1,764 lines

Nine coherent sections, already separated by comment banners. This is the
cleanest split in the repository.

| Section | Lines | Responsibility | Target |
|---|---|---|---|
| Types | 57–118 | `UcpProduct`, `CatalogProgress`, debug | `lib/catalog/types.ts` |
| Config | 119–146 | timeouts, caps, currencies | `lib/catalog/config.ts` |
| LRU cache | 147–213 | per-query result cache | `lib/catalog/cache.ts` |
| Category→domain | 214–372 | which brands to ask | `lib/catalog/planning/domains.ts` |
| Concept relevance | 373–483 | **eligibility** — `applyConceptRelevance`, `garmentHaystack` | `lib/catalog/filters/concepts.ts` |
| Non-fashion / gender / colour / size | 484–716 | **eligibility** — four hard/soft filters | `lib/catalog/filters/` |
| JA translation | 717–737 | Japanese store queries | `lib/catalog/planning/translate.ts` |
| MCP fetch | 785–917 | **retrieval** — per-store fan-out | `lib/catalog/ucp/fetch.ts` |
| Normalization | 918–1093 | UCP → `UcpProduct`, currency | `lib/catalog/normalize.ts` |
| Filter + sort | 1094–1235 | **ranking** | `lib/catalog/ranking/` |
| Main search | 1236–1764 | orchestration + palette + same-garment | `lib/catalog/search.ts` |

| | |
|---|---|
| **Module-global state** | `lruCache` (a real process cache, concurrency-safe by key); `lastJudgeOutcome` and `lastSameGarment` — **two cross-request bleeds.** `lastSameGarment` is keyed by image so it cannot mis-attribute; `lastJudgeOutcome` can |
| **Regression risk** | **MEDIUM.** The sections are clean, but `search()` reads the filters in a specific order and the `minKeep` fallback (`onGarment.length >= min(minKeep, n) ? onGarment : scored`) is the t-shirt leak — do not "fix" it during extraction |

### 1.4 `features/v2/DiscernV2.tsx` — 3,892 lines

| | |
|---|---|
| **Contains** | 9 sub-components, 2 hooks, 1 default export holding **55 `useState`**, 22 `useEffect`, 428 CSS rules, and 4 views (home / results / product / look) |
| **Should move** | `useKeyboardOffset`, `useMeasuredVar` → `features/v2/hooks/`; `StepIcon`, `Progress`, `ShopsFor`, `HeroVideo`, `Img`, `BagBtn`, `SaidBody` → `features/v2/components/`; the 428-rule CSS block → `features/v2/styles.ts`; `atWidth`, `colorKey`, `imagesForColor`, `money`, `toThePoint` → `features/v2/lib/` |
| **Should remain (this phase)** | the default export: view routing, the 55 state atoms, the composer, and the JSX for all four views |
| **Regression risk** | **MEDIUM-HIGH.** 55 state atoms with real interdependencies (colour ↔ gallery ↔ cart thumbnail, verified by `scripts/colorway.js`). Extracting views means threading dozens of props or introducing context — the latter is a behaviour change |

---

## 2. TARGET DIRECTORY TREE — DERIVED FROM THE CODE

Not the brief's tree copied down; the brief's tree *reconciled with what exists*.
Differences are justified in §2.1.

```
lib/
  ai/
    providers/        groq.ts gemini.ts cerebras.ts nvidia.ts   (exist, move)
    gateway/          ladder.ts  breaker.ts  cooldown.ts        (from route)
    prompts/          stylist.ts chat.ts vision.ts grounding.ts fashionCore.ts
                      registry.ts  checksums.json
    answer/           schema.ts  parse.ts                       (exists: lib/stylist/answer.ts)
  intent/
    routing.ts        (from route: 6 predicates)
    compiler.ts       (exists: lib/intentCompiler.ts)
    parser.ts         (exists: lib/queryParser.ts)
  fashion/
    ontology/         garmentVocab  exclusions  taxonomy        (from queryParser)
    garmentProfile/   profile.ts  enrich.ts  cache.ts           (exist)
    compatibility/    worksWith.ts                              (from garmentProfile)
    outfit/           plan.ts  compose.ts  looks.ts             (exist + from route)
    knowledge/        occasions.ts seasons.ts lookbook.ts       (exist)
  catalog/
    types.ts config.ts cache.ts normalize.ts search.ts
    ucp/fetch.ts
    planning/domains.ts translate.ts
    filters/concepts.ts gender.ts colour.ts size.ts nonFashion.ts
    ranking/sort.ts rerank.ts
    matching/sameGarment.ts palette.ts
    brands/registry.ts lookup.ts quality.ts directory.ts
    health/brandHealth.ts deadBrands.ts
  observability/
    trace.ts  traceStore.ts  redact.ts  usage.ts                (mostly exist)
  evaluation/
    scenarios.json  runner.ts  taxonomy.ts                      (exist as eval/ + scripts/)
app/api/ai/stylist/route.ts                                     thin
features/v2/
  DiscernV2.tsx     orchestrator
  components/  hooks/  lib/  styles.ts
```

### 2.1 Where I deviate from the brief's tree, and why

| Brief proposes | I propose | Reason |
|---|---|---|
| `lib/recommendation/{generation,ranking,judging,diversity}` | **not created yet** | Generation and diversity do not exist as code. Creating empty directories for them documents an intention as though it were an implementation — §19's "do not write speculative documentation" applied to structure |
| `lib/user/{profile,session,preferences}` | `lib/user/profile.ts` only | Session and refinement state genuinely do not exist. One file with a real thing in it beats three with placeholders. The boundary is established without pretending |
| `lib/ai/routing/` | `lib/intent/routing.ts` | The predicates route on *shopper intent*, not on model choice. Under `ai/` they read as provider routing, which is what `gateway/` is |
| `lib/ai/schemas/` | `lib/ai/answer/schema.ts` | One schema exists. A `schemas/` directory holding one file is a folder waiting to be justified |
| `lib/catalog/ucp/` | kept, narrow | Only the MCP fetch is UCP-specific. Normalization and filters are ours and must not sit under a vendor's name |

---

## 3. EXTRACTION SEQUENCE

Twelve steps. Each independently revertable, each green on `npm run verify`
(13 checks, 149 scenarios) **and** a production smoke check.

| # | Step | Files | Risk | New test required first |
|---|---|---|---|---|
| 0 | **Delete dead code** | `features/discern/`, `lib/_parked/`, `_parked/` | **LOW** | reachability proof (§8) |
| 1 | `lib/observability/` | trace, traceStore, redact, usage | LOW | exists (`scripts/trace.js`) |
| 2 | `lib/ai/gateway/` — limits, breaker, cooldown | from route | **LOW but sharp** | **module-identity test** |
| 3 | `lib/intent/routing.ts` | 6 predicates from route | LOW | routing scenarios (+30 cases) |
| 4 | `lib/ai/prompts/` | ~700 lines from route | LOW mechanically | **SHA-256 checksum harness** |
| 5 | `lib/catalog/brands/` | 832 lines out of stores.ts | LOW | brand-lookup harness |
| 6 | `lib/ai/answer/` | move `lib/stylist/answer.ts` | LOW | exists (21 scenarios) |
| 7 | `lib/catalog/{types,config,cache,normalize}` | from GCS | LOW | normalization harness |
| 8 | `lib/catalog/filters/` | 5 filters from GCS | **MEDIUM** | filter harness — order matters |
| 9 | `lib/catalog/{ucp,planning,ranking}` | from GCS | **MEDIUM** | retrieval-planning harness |
| 10 | `lib/ai/gateway/ladder.ts` | `stylistChat` from route | **MEDIUM-HIGH** | provider-order table |
| 11 | `features/v2/{components,hooks,lib,styles}` | from DiscernV2 | **MEDIUM** | existing browser harnesses |
| 12 | Documentation | 5 `.md` files | none | — |

**The route becomes thin only after 2, 3, 4, 10.** Expected: 3,037 → ~1,500.
Getting below that means extracting the ordered pipeline, which §7 argues
against in this phase.

---

## 4. RISK ASSESSMENT

| Risk | Step | Why it is real | Mitigation |
|---|---|---|---|
| **Duplicated singleton** silently disables breaker or rate limit | 2 | Six module globals work *because* there is one module. Two import paths or a per-request factory = two breakers that never trip | module-identity test asserting the same counter through both paths |
| **A prompt byte changes** | 4 | 700 lines of text no behavioural test can see | SHA-256 per constant, checked in CI |
| **Provider order shifts** | 10 | `cerebrasFits` reorders by prompt size; first rung gets 55%; last rung takes the remainder. Each was a fix | recorded order table + existing `ladder-budget.js` |
| **Filter order changes** | 8 | `search()` applies concept → non-fashion → gender → colour → size in a fixed order; `minKeep` fallback is the known t-shirt leak | filter harness asserting the sequence, and **not fixing the leak here** |
| **React state coupling breaks** | 11 | colour ↔ gallery ↔ cart thumbnail is a real dependency chain | `scripts/colorway.js` already proves it; run before and after |
| **Deleting live code** | 0 | 9,585 lines is a large delete | build + full verify + production smoke; the diff must show zero change to any reachable module |
| **Import cycle** | 2, 10 | `groq` ⇄ `cerebras` already needs a deferred `import()` | keep the existing dynamic import; add a cycle check |

---

## 5. TESTS NEEDED BEFORE EACH EXTRACTION

Existing coverage: 13 checks, 149 scenarios, 3 browser harnesses.

**New, and each must exist and pass before its step begins:**

1. `scripts/module-identity.js` — the same counter through two import paths (step 2)
2. `scripts/prompts.js` — SHA-256 per prompt constant (step 4)
3. `eval` `routing` group, ~30 cases — heavy vs light, reaction vs request (step 3)
4. `scripts/brands.js` — `detectBrandsInQuery` match order, generic-word guard (step 5)
5. `scripts/normalize.js` — UCP → `UcpProduct`, currency conversion, `display_price` (step 7)
6. `scripts/filters.js` — the five filters, **in order**, with the `minKeep` fallback asserted as-is (step 8)
7. `scripts/provider-order.js` — composed ladder order per (`useGemini`, `cerebrasFits`, cooldown) (step 10)

**Characterization tests (§17), before any of it**, all fixture-driven, no quota:

| Path | Coverage today | Fixture needed |
|---|---|---|
| fast path | partial (eval) | ✔ stub catalogue |
| heavy path | none end-to-end | ✔ stub provider + catalogue |
| provider fallback | budget only | ✔ stub 4 providers, force failures |
| vision path | none | ✔ stub vision |
| wardrobe scan | **none** | ✔ |
| load more | **none** | ✔ |
| multi-category | planning only | ✔ |
| empty results | none | ✔ |
| malformed model output | ✔ (21 answer scenarios) | — |
| timeout | budget arithmetic only | ✔ slow stub |
| trace creation | ✔ | — |
| stream completion | **none** | ✔ NDJSON reader assertion |

**Honestly documented as untestable without quota:** real model output quality,
real catalogue relevance, and the retrieval purity gap the t-shirt leak sits in.
Fixtures prove the plumbing, not the taste.

---

## 6. FILES THAT SHOULD REMAIN LARGE

| File | Lines | Why |
|---|---|---|
| `lib/stores.ts` → `catalog/brands/registry.ts` | ~5,100 after code moves out | 472 curated brand records. A coherent data asset and the repository's most proprietary one |
| `lib/fashion/knowledge/occasions.ts` | ~400 | One curated table; splitting per-occasion destroys the ability to compare them |
| `eval/scenarios.json` | grows | It is *supposed* to grow. One file, one purpose |
| `lib/ai/prompts/stylist.ts` | ~400 | One prompt. Splitting it by section would make the checksum meaningless |

---

## 7. FILES THAT MUST BE BROKEN APART

| File | Now | After | Owner reason |
|---|---|---|---|
| `route.ts` | 3,037 | ~1,500 | holds 6 responsibilities that are not HTTP |
| `GlobalCatalogService.ts` | 1,764 | ~400 + 11 modules | retrieval, filtering, ranking and normalization are four different questions |
| `stores.ts` | 5,929 | 5,100 data + 4 modules | behaviour must not live in a data file |
| `DiscernV2.tsx` | 3,892 | ~2,400 + components/hooks/styles | a 428-rule stylesheet is not a component |

---

## 8. DEAD AND DUPLICATE CODE

| Path | Lines | Evidence | Proof required before deleting |
|---|---|---|---|
| `features/discern/` | 8,352 | no import from any live path; `app/(shop)/page.tsx` renders `Boutique` | grep every import; build; full verify; production smoke |
| `lib/_parked/ai-chat-route.ts` | 989 | parked by name, 3 references all in comments | same |
| `features/discern/{components,hooks}/_parked/` | 244 | parked by name | same |
| **root `convex/`** | 6 files | duplicate of `web/convex/`; single-table schema; **not deployed** | confirm `vercel.json` deploys `web/convex` only |

**~9,585 lines, ≈21% of the repository.**

One caveat I will not skip: `features/discern/` contains the v1 chat UI, and
some of its comments are the only written record of why certain v2 decisions
were made. Before deletion I would extract those into a `docs/` note — losing
the code is fine, losing the reasoning is not.

---

## 9. PROPOSED PHASE E IMPLEMENTATION PLAN

Supersedes `PHASE_E_EXTRACTION_PLAN.md`, which covered only `route.ts`.

**Stage 0 — delete the dead fifth.** One commit, before anything else. Every
subsequent grep, audit and search then reads the real repository.

**Stage 1 — characterization tests.** Steps in §5. This is the safety net the
earlier plan said was missing; building it *first* is what makes the rest
routine rather than brave.

**Stage 2 — low-risk extractions.** Steps 1, 2, 3, 5, 6, 7 (observability,
gateway limits, routing, brands, answer, catalog primitives).

**Stage 3 — the prompt registry.** Step 4, with the checksum.

**Stage 4 — catalog decomposition.** Steps 8, 9.

**Stage 5 — the ladder.** Step 10, alone, watched for a day.

**Stage 6 — frontend.** Step 11.

**Stage 7 — documentation.** Step 12: `ARCHITECTURE.md`, `AI_ARCHITECTURE.md`,
`DATA_FLOW.md`, `PROVIDER_ARCHITECTURE.md`, `RECOMMENDATION_ARCHITECTURE.md` —
each describing code that exists by then, and **`RECOMMENDATION_ARCHITECTURE.md`
saying plainly which parts are not built**, because generation, diversity and
judging-as-a-separate-stage are not.

**Not in this pass, per §22:** embeddings, UI redesign, algorithm changes,
database migration, prompt rewriting, provider changes.

---

## 10. WHAT I WOULD ASK BEFORE STARTING

1. **Delete the dead fifth first, or leave it?** I recommend deleting — but it
   is 9,585 lines including the v1 UI, and if there is any intention of
   reviving that surface the answer changes completely.
2. **Characterization tests before or during?** §17 says before. That is ~7
   fixture harnesses covering paths with no coverage at all today (wardrobe
   scan, load-more, streaming). It is real work before any file moves, and it
   is the difference between a safe refactor and a hopeful one.
3. **Is ~1,500 lines an acceptable end state for `route.ts` in this pass?**
   Going thinner means extracting the 10-step ordered pipeline, whose five
   order-critical edges no type enforces.
4. **The prompt checksum adds deliberate friction** — editing a prompt becomes
   edit-then-update-checksum. Confirm that is wanted.

**Stopping here for approval.**


---

## 11. STAGE 0 — EXECUTED

Approved with one condition: preserve the reasoning before deleting. Done in
the order set out, with the result of each step.

**1–2. Identified and confirmed.** A transitive dependency walk, not a grep:
all 72 Next.js entry points (`page`/`route`/`layout`/`middleware`) plus every
Convex function as roots, following `import`, `export from`, dynamic `import()`
and `require()` through `@/` and relative specifiers.

```
  reachable      140 files
  unreachable     46 files
```

Of the 46, all but the deletion set were test harnesses (invoked by `npm`, not
imported), generated Convex types, and build configuration — correctly
unreachable by import and not dead.

**3–4. Reasoning extracted.** 44 decision-bearing comment blocks mined from the
condemned files and distilled into:

- `docs/architecture/v1-decisions.md` — 16 entries, five marked **STILL
  BINDING** on v2
- `docs/architecture/v2-migration-notes.md` — what v2 inherited, what it did
  not, and why the v1 UI is not returning

The most valuable are the z-index scale (a named layering order, written after
the mandatory sign-in gate was found sitting *below* every sheet and modal in
the app), the SSR rule against measuring the window in a state initializer, and
the pinned-product recency window — **the last of which v2 does not have**, and
which is now recorded as an open exposure rather than lost.

**5. Searched again.** Six remaining textual references, all comments, zero
imports. Each was corrected in place so no comment points at a file that no
longer exists.

**One binding item resolved before deleting rather than after.** §13 of
`v1-decisions.md` records a localStorage migration (`from:` → `discern:`) that
ran at module load and lived only in the condemned file. Checked: live v2 uses
a **different namespace** (`discern.v2.*`, dot-separated), and the three
`'discern:shopsFor'` hits elsewhere are a *CustomEvent name*, not a storage key.
The migration fed only the v1 UI. Nothing live loses a read path.

**6. Deleted.**

```
  features/discern/                       8,357
  lib/_parked/                            1,081
  features/discern/{components,hooks}/_parked/   (within the above)
                                        ───────
                                          9,430
```

**7. Verified.** `npm run verify` — 13 checks, 149 scenarios, typecheck and
production build all green after deletion.

**8. New repository size, measured:**

| | before | after |
|---|---|---|
| total lines (ts/tsx) | 44,710 | **35,281** |
| unreachable lines | 14,416 | 4,978 |
| unreachable, excluding harnesses and config | 9,430 | **0** |

Every remaining unreachable line is a test harness, a generated type, or build
configuration. **The repository now contains no dead implementation.**

The four large files are unchanged and unaffected — `stores.ts` 5,929,
`DiscernV2.tsx` 3,892, `route.ts` 3,037, `GlobalCatalogService.ts` 1,764. That
is the point: Stage 0 removed what nothing reaches, and touched nothing that
runs.

**Three orphan candidates outside the approved scope were left alone**, and are
listed in `v2-migration-notes.md` so the next pass need not rediscover them:
`components/IntersectionSentinel.tsx` (37), `features/landing/HeroPrompt.tsx`
(79), and `scratch/` (~50 ad-hoc debug scripts, never in the build).

**9. Next:** the characterization tests of §5, before the first extraction.
