# V1 → V2 MIGRATION NOTES

Written during Stage 0, at the moment the v1 implementation was deleted.
Companion to `v1-decisions.md`, which preserves what the deleted code knew.

---

## WHAT WAS DELETED, AND WHY IT WAS SAFE

| Path | Lines | Evidence |
|---|---|---|
| `features/discern/` | 8,357 | v1 chat UI. No live import — proved by transitive reachability from all 72 Next.js entry points |
| `lib/_parked/` | 1,081 | `/api/ai/chat`, deliberately moved out of `app/api/` so Next.js would not serve it |
| `features/discern/{components,hooks}/_parked/` | 603 | parked by naming convention, imported only by the parked v1 page |

**9,585 lines — 21% of 44,710.**

The proof was a dependency walk, not a grep: every `page.tsx`, `route.ts`,
`layout.tsx`, `middleware.ts` and Convex function as roots, following
`import` / `export from` / dynamic `import()` / `require()` transitively through
`@/` and relative specifiers. 140 files reachable, 46 not. Of the 46, all but
these were test harnesses (invoked by `npm`, not imported), generated Convex
types, and build configuration.

## THE LIVE SURFACE

```
app/(shop)/page.tsx  →  features/v2/Boutique.tsx  →  features/v2/DiscernV2.tsx
                                    ↓
                        features/stylist/askStylist.ts
                                    ↓
                        app/api/ai/stylist/route.ts
```

`app/v2/page.tsx` also exists and renders the same component tree.

---

## THE ONE BINDING ITEM, AND HOW IT WAS RESOLVED

`v1-decisions.md` §13 records a localStorage migration that ran at module load,
copying every `from:`-prefixed key to `discern:`. It was marked **STILL
BINDING** on first reading, because a returning pre-rebrand shopper would
depend on it and it lived only in the file being deleted.

**It does not bind.** Checked before deleting:

| | keys |
|---|---|
| v1 migrated | `from:*` → `discern:*` (colon namespace), `from_user_name` |
| live v2 writes | `discern.v2.shopsFor`, `discern.v2.asked`, `discern.v2.bag` (**dot** namespace) |

Live v2 uses a different namespace entirely. The three `'discern:shopsFor'`
hits in `lib/shopperPrefs.ts` and `features/stylist/useStylistContext.ts` are a
**CustomEvent name**, not a storage key — `window.dispatchEvent(new
CustomEvent('discern:shopsFor', …))`.

So the migration only ever fed the v1 UI, which is deleted with it. No live read
path loses anything.

**What is genuinely lost:** a shopper who last used the app before the rebrand
and never returned still has orphaned `from:*` data in their browser. It was
already orphaned — nothing live read the `discern:` colon keys either. If v1
data ever needs recovering, the migration is at
`git show 07ff485:web/features/discern/DiscernPage.tsx` around L71.

---

## WHAT V2 INHERITED, AND WHAT IT DID NOT

### Inherited, arrived at independently

Both codebases converged on the same rules, which is the strongest evidence they
are correct:

- **Per-colourway size availability** — v1 §8, v2 in `Boutique.toColors`
- **Neutral-then-measure for SSR** — v1 §2, v2 in `useMeasuredVar` /
  `useKeyboardOffset`
- **Brand fallback with an honest reply** — v1 §15, v2 in `route.ts`
- **Mandatory concepts always lead with the garment** — v1 §14, v2 in
  `queryParser.buildMandatoryConcepts`

### Not inherited — open gaps

| v1 knew | v2 status |
|---|---|
| **Named z-index scale** (§1) | v2 uses bare numbers. The sign-in-gate-below-every-sheet bug has not recurred, but nothing prevents it |
| **`[PRODUCT:N]` resolves against the pinned set** (§4) | v2 strips the token when nothing is pinned — the other half of the rule. The positive case is implemented; the reasoning was only in v1 |
| **Pinned-product recency window** (§3) | v2 has no equivalent. A follow-up like "tell me about these" after pins are cleared has the same hallucination exposure v1 documented |
| **Touch, not pointer, for long-press on iOS** (§6) | v2 has no long-press menus. Applies if they return |
| **Trackpad momentum guard** (§7) | v2's gallery is vertical scroll; not applicable today |

**The pinned-product recency window is the one worth revisiting.** v1 documented
a real reported bug — the model inventing product names when a follow-up arrived
with pins already cleared — and the fix is not present in v2. It is not urgent
because v2's pinning flow differs, but the exposure is the same shape.

---

## WHY THE V1 UI IS NOT COMING BACK

Recorded so this is not re-litigated: keeping 8,357 lines of unreachable code
"just in case" made the active architecture harder to read, and every audit,
line count and search read a repository a fifth larger than the one that runs.

Reviving that interface is a **product** decision, and if it is ever made the
implementation is one `git show` away. What is not one command away is the
reasoning — which is why `v1-decisions.md` exists.

---

## FOR THE NEXT AUDIT

Repository size after Stage 0 is recorded in `ARCHITECTURE_AUDIT.md`. Three
orphan candidates were found **outside** the approved deletion scope and were
deliberately left alone:

| Path | Lines | Note |
|---|---|---|
| `components/IntersectionSentinel.tsx` | 37 | zero live references |
| `features/landing/HeroPrompt.tsx` | 79 | zero live importers |
| `scratch/` | ~50 files | ad-hoc developer debug scripts, never part of the build |

These were not deleted because the approved scope was the v1 and `_parked`
implementation. They are listed so the next pass does not have to rediscover
them.
