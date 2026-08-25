# Production smoke check — deployed E6 ladder

**Target:** `https://discern.enuid.com/api/ai/stylist`
**Date:** 2026-08-25, three runs between 22:03 and 22:11 UTC
**Deployed commit:** `05cf44b` (E6) — inferred, not confirmed; the app exposes no
build identifier, so this records the behaviour of *whatever was live at that time*.
**Method:** `node web/scripts/smoke.js` — five real shopper questions, read-only,
nothing written, no admin surface touched.

---

## Verdict

**No E6 regression.** The extraction is sound: every path still routes, retrieves,
and answers, and the two cases that exercise E5/E6 hardest (multi-garment strips,
occasion outfits) return correct, well-formed results with real products from real
brands.

**But production is degraded for a different, pre-existing reason,** and the smoke
check is what surfaced it. Two findings below.

---

## What was observed

| case | run 1 (22:03) | run 2 (22:06) | run 3 (22:10) |
|---|---|---|---|
| conversational — "hey" | ok, 7.2s, correct greeting | **degraded**, 15.8s | **degraded**, 14.5s |
| single garment — "white linen shirt" | ok, 13.1s, 8 products | ok, 9.5s | ok, 7.0s |
| two garments — "linen shirt and shorts for the beach" | ok, 15.8s, 2 strips | ok, 15.2s | ok, 11.8s |
| an occasion — "what do I wear to a job interview" | **degraded**, 31.6s, 4 strips | **degraded**, 23.3s | **degraded**, 17.5s |
| advice — "does navy go with brown shoes?" | ok, 22.9s, real answer | **degraded**, 17.1s | **degraded**, 8.7s |

Retrieval is healthy throughout. Every product-bearing case returned eight products
per strip from real brands (Taylorstitch, Corridor NYC, Colorful Standard), the
two-garment query returned exactly `Shirts, Shorts`, and the occasion query returned
exactly `Blazers, Shirts, Trousers, Dress Shoes`. That is E5 and the occasion planner
working correctly in production.

What fails is the **model reply**. A degraded turn shows the shopper:

> I could not think this one through, so here is what the catalogue has for it.
> Ask again and I will do it properly.

…plus, for a bare greeting, eight unrelated products from a rescue search on the
literal word "hey".

---

## Finding 1 — the model providers are failing in production

Degradation got worse across the three runs with **no code change between them**,
which rules out a code cause and points at a time-varying external condition: the
free-tier provider pools. This is consistent with the already-known
`Cerebras HTTP 402 payment required` and an exhausted Gemini free tier.

Eleven requests from one IP in ten minutes almost certainly contributed. Every heavy
turn makes several model calls (reply + self-heal + grounding + refine), and the
quotas are shared across every user of the app — so this smoke check is itself part
of what pushed the pools over.

**Not investigated further:** `/api/ai/stylist/health` reports exactly which pool is
refusing and why, but it is gated behind `CRON_SECRET`, which this session does not
have. That endpoint is the right next step and takes one command:

```
curl -H "Authorization: Bearer $CRON_SECRET" https://discern.enuid.com/api/ai/stylist/health
```

## Finding 2 — the reported cause is wrong, which is why this looked like slowness

Every degraded turn reported:

```
modelTrace: "the whole chain ran past the reply deadline"
```

That message is false, and provably so: run 3's advice query degraded in **8.7
seconds**, while the ladder's budget is 34 seconds. A 34-second timeout cannot
happen in 8.7 seconds.

The mechanism is `withDeadline` (`route.ts:366`):

```ts
work.then(
  (v) => { ... resolve(v) },
  () => { ... resolve(fallback) },   // ← a rejection becomes the fallback
)
```

It swallows rejections and resolves the fallback. So when `stylistChat` throws its
full diagnostic trail —

```
cerebras: HTTP 402 payment required | groq(...): HTTP 429 ... | gemini: ... | nvidia: ...
```

— the caller sees `msg === null`, takes the `!msg` branch (`route.ts:1234`), and
attributes it to the deadline. **The real error trail is discarded before anyone can
read it.** Every fast total-failure is misreported as a slow timeout, which is
exactly why the first reading of these results looked like a latency problem.

Both `withDeadline` and that branch are route code E6 did not touch.

---

## Why this is not an E6 regression

1. `stylistChat` moved byte-for-byte — all 207 lines verbatim, and
   `scripts/ladder.js` produces byte-identical output against the code on both
   sides of the move.
2. The failing branch (`withDeadline`, `chatDeadline`, the `!msg` fallback) is
   route code the E6 diff did not modify. The diff was import lines plus one
   deleted block, with no modified lines in the body.
3. Behaviour varied between run 1 and run 2 with zero code change in between.
4. The failure signature is provider-side: the ladder is reached, runs, and every
   rung refuses or hangs.

Per instruction, **no code was changed in response to this check.**

---

## Recommended, not done

Neither of these belongs in the catalog decomposition; both are worth their own
commit later.

1. **Stop discarding the ladder's error trail.** Capture the rejection before
   `withDeadline` swallows it and report the real reason, so "every provider is out
   of credit" never again reads as "the model was slow". The route already does
   exactly this at one other call site, which is where the pattern should come from.
2. **Do not rescue-search a greeting.** When the model is unavailable on a
   conversational turn, eight products for the word "hey" is worse than a short
   apology with none. The rescue search is right for a product question and wrong
   for chitchat.
3. **Fund or replace a provider pool.** The five-pool ladder is doing its job; it
   cannot answer when all five are spent.
