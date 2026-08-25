# Where the code stands

Written at `d1de870`, after Phase E (E1–E6), the production smoke check, the
`lastJudgeOutcome` fix and the first two catalog extractions. Everything below
is measured, not estimated.

---

## 1. The diff, in one line

**13 commits · 48 files · +4,252 / −33,490 lines.**

The large deletion is Stage 0 (dead implementation removed, its reasoning kept
in `docs/architecture/`). The additions are eleven new modules and eight new
test harnesses.

## 2. What happened to the route

`app/api/ai/stylist/route.ts` was one 3,037-line file holding rate limiting,
usage logging, intent routing, every prompt, retrieval orchestration, the
provider ladder, and the post-model pipeline.

| commit | step | route.ts |
|---|---|---|
| `0c17e19` | Stage 0 — dead code removed | 3,037 |
| `cfdb73c` | Stage 1 — characterization tests | 3,037 |
| `9b63100` | E1 — limits, breaker, cooldowns | 2,978 |
| `c79ce0c` | E2 — usage diagnostics | 2,905 |
| `9df9382` | E3 — intent routing | 2,670 |
| `e8af912` | E4 — prompts + SHA-256 guard | 2,405 |
| `f9bdad5` | E5 — retrieval orchestration | 2,035 |
| `05cf44b` | E6 — provider ladder | 1,817 |
| `d1de870` | catalog work (route +16 for the judge recorder) | 1,833 |

**3,037 → 1,833 lines, and 1,204 of them moved rather than vanished.**

## 3. The module map

```
app/api/ai/stylist/route.ts     1,833   transport + the post-model pipeline
lib/services/GlobalCatalogService.ts  1,447   fetch, cache, normalize, sort
lib/services/relevanceRerank.ts   622   the judge
lib/stylist/retrieval.ts          409   one sentence → several searches
lib/stylist/prompts.ts            340   every word put in front of a model
lib/intent/routing.ts             269   which kind of question is this
lib/catalog/productFilters.ts     259   what a product IS
lib/stylist/providers.ts          258   five free tiers and their clock
lib/stylist/answer.ts             199   the model's reply, parsed
lib/stylist/trace.ts              171   what happened, per request
lib/catalog/concepts.ts           144   does this match what was asked
lib/stylist/limits.ts             128   rate limit, breaker, cooldown
lib/stylist/usage.ts              104   what this cost, what it could not read
lib/stylist/traceStore.ts          92   traces, written after the response
```

Each module owns one question and says in its header why its numbers are what
they are. Nothing in this list is a framework; every one of them is a move.

## 4. The test suite

`npm run verify` — **22 checks**, and eight of them did not exist before this
work:

| harness | what it protects |
|---|---|
| `eval.js` | 183 scenarios across 9 groups |
| `characterize.js` | the route end to end, through a real `Request` |
| `prompts.js` | SHA-256 per prompt — text cannot drift silently |
| `retrieval.js` | 59 checks: the questions asked of ninety stores |
| `ladder.js` | 70 checks: provider order, budget, cooldown, 429 |
| `judge-scope.js` | 9 checks: no request hears another's judge outcome |
| `catalog-filters.js` | 37 checks: what deletes a product vs what moves it |
| `catalog-concepts.js` | 20 checks: one garment per search, and the floor |

Plus the pre-existing `limits`, `usage`, `trace`, `exact-match`,
`profile-cache`, `same-garment`, `suggest-query`, `occasion`, `relevance`,
`ladder-budget`, `status-redaction`, `gemini-retired`.

**Discipline held throughout: characterize → move → verify → inspect → commit.**
Every extraction was proved byte-identical two or three ways — every moved line
verbatim, the harness output identical on both sides of the move, and for E6
the full `characterize.js` output identical across all 189 lines but the random
per-request trace id.

## 5. Cross-request state — the actual position

**Fixed.** `lastJudgeOutcome` (GlobalCatalogService) and `lastJudgeDetail`
(relevanceRerank) were `export let` singletons. Reproduced first:

```
request A reads detail: "PROVIDER-FOR-B"    ← A's own judge said A
```

Both deleted. The outcome now travels through `options.onJudge`, a closure over
the caller's own state, passed at all 18 search sites. `judge-scope.js` asserts
the exports are *gone* rather than unused, and that ten interleaved requests
cross zero times.

**Already correct.** `lastSameGarment` is the same shape but explicitly keyed:
`sameGarmentVerdictFor(image)` refuses to answer about a different photograph,
so two shoppers holding up different pictures can never read each other's
verdict. It holds only one entry, so a concurrent request can *lose* a verdict
and pay for a second vision call — a cost, not a correctness bug.

**Legitimate and deliberate.** The rate-limit buckets, the breaker, the provider
cooldown map, the LRU search cache, the judge memo and the exchange-rate cache
are all process-level on purpose. `limits.ts` documents why, and
`scripts/limits.js` asserts there is exactly *one* of each by reaching the same
counter through two import paths.

## 6. Production, as of the smoke check

Recorded in full in `PRODUCTION_SMOKE_E6.md`. Retrieval is healthy: real
products from real brands, correct strips for multi-garment and occasion
queries. **The model providers are failing** — free tiers appear spent, and
degradation worsened across three runs with no code change between them.

A second finding, pre-existing and not fixed: `withDeadline` swallows
rejections, so a ladder that throws its full trail arrives at the caller as
`null` and is reported as *"the whole chain ran past the reply deadline"*. One
run degraded in 8.7 seconds against a 34-second budget — a timeout that cannot
have been one. **The real diagnostic is discarded before anyone can read it**,
which is why this first read as latency rather than as spent keys.

## 7. What is still in GlobalCatalogService

1,447 lines, in these sections:

| section | ~lines | notes |
|---|---|---|
| Types | 60 | `UcpProduct` — imported by four modules |
| Config | 30 | timeouts, batch sizes, cache TTLs |
| LRU cache | 65 | deliberate process-level state |
| Category → domain mapping | 160 | which of 472 brands to ask |
| EN→JA translation | 20 | Japanese-catalog stores |
| Utilities | 45 | price conversion, domain matching |
| Per-store MCP fetch | 130 | the network boundary |
| Product normalization | 175 | Shopify's shape → ours |
| Filter + sort | 140 | budget, currency, dedupe, ordering |
| Main search | 530 | the orchestrator |

Clean seams remain at **fetch** (the network boundary), **normalization**
(pure, and the source of the "no image means no product" rule), and **the LRU
cache**. The 530-line `search` orchestrator should be extracted *last*, if at
all — it is where the caching, rounds, judge and taste layers interleave.

## 8. Carried, deliberately not done

- **t-shirt retrieval leak.** Parsing is correct; the catalogue pads with
  near-misses because `minKeep` is a floor. Now asserted in
  `catalog-concepts.js` so tightening it is a visible decision, not an
  accident.
- **Fit vocabulary.** `wide-leg` vs the spec's `wide`.
- **Cerebras HTTP 402.** Billing, not code.
- **The fast path carries no trace.**
- **The rescue search on a greeting.** When the model is down, "hey" returns
  eight unrelated products. Right for a product question, wrong for chitchat.
- **The discarded ladder error trail** (§6). One commit, high value.
- **Root `convex/` duplicate.**

## 9. What I would do next, in order

1. **Restore the providers.** Nothing else matters while every pool is spent.
   `/api/ai/stylist/health` names which one, and needs `CRON_SECRET`.
2. **Stop discarding the ladder's error trail.** Small, and it makes every
   future production question answerable.
3. **Finish the catalog decomposition** — fetch, then normalization, then the
   cache. Leave `search` itself.
4. **Then the full repository audit**, comparing the code against the original
   Discern architecture to find what genuinely remains missing.

Step 4 is the one worth protecting from the other three. The point of an audit
is to find what is absent — and that is only meaningful once the code has
stopped moving.
