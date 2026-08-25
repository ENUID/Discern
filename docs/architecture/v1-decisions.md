# V1 DECISIONS — knowledge preserved from deleted code

`features/discern/DiscernPage.tsx` (7,174 lines), `lib/_parked/ai-chat-route.ts`
(989 lines) and the `_parked/` component and hook directories were deleted in
Stage 0. They had no live imports; `app/(shop)/page.tsx` renders `Boutique` →
`DiscernV2`.

**The implementation is gone. This is what it knew.**

Every entry below was a comment in that code explaining *why* something was
done — usually written after a specific bug. Several still constrain v2, and
those are marked **STILL BINDING**. The rest are recorded because a future
decision may re-open the same question, and re-learning any of them costs a
production incident.

Source line numbers refer to the files at `07ff485`, the last commit before
deletion, recoverable with `git show 07ff485:web/features/discern/DiscernPage.tsx`.

---

## 1. Z-INDEX LAYERING — **STILL BINDING**

*(L44–68)*

Overlay stacking was once fourteen magic numbers grown by "pick one higher than
the last thing": `4100 / 9000 / 9001 / 9100 / 9101 / 9992 / 9998 / 9999`. Two
consequences, both real:

- **The mandatory sign-in gate sat at 4100 — below every sheet, menu, modal and
  toast.** It is documented as a hard block with no dismiss, so anything that
  opened over it silently defeated it.
- Sheets, modals and menus were interleaved (sheet 9101 vs modal 9992 vs menu
  9001) with no rule about which wins.

The replacement is a named scale, top wins, gaps of 100 so a layer can be
inserted without renumbering:

```
base 0 · raised 1 · sticky 10 · nav 100 · scrim 1000
sheet 1100 · menu 1200 · modal 1300 · gate 1400 · toast 1500
```

The ordering has reasons, not just numbers: a **menu sits above its sheet
because it is spawned from one**; the **gate sits above ordinary app UI because
nothing may be reachable behind it**; **toasts sit above everything because they
are transient and must never be the thing that is covered**.

> **Binding on v2.** `DiscernV2.tsx` uses bare numeric z-indexes. It has not yet
> reproduced this bug, but it has not adopted the guard either. Any future
> overlay work should port this scale rather than rediscover it.

## 2. SSR HYDRATION: NEVER MEASURE THE WINDOW IN AN INITIALIZER — **STILL BINDING**

*(L2101)*

Two booleans were initialised by reading `window.innerWidth`. The server has no
window and always renders the narrow branch, so on any screen wider than 768px
the client's hydration pass disagreed with the server HTML — which React reports
as an unpatchable attribute mismatch.

**The shape that works:** initialise to a neutral value (`false`, `0`), then fill
in the real measurement in an effect after mount.

> **Binding on v2.** `DiscernV2.tsx` uses exactly this shape in
> `useMeasuredVar` and `useKeyboardOffset`. The reason is here.

## 3. PINNED PRODUCTS: A RECENCY WINDOW, AND WHY IT IS DELIBERATELY NARROW

*(L2341)*

Pins are cleared after each send. A follow-up like *"tell me about these"* or
*"the ones I picked"* therefore arrived with **no product data at all**, and the
model hallucinated names, brands and colours — the reported lies.

The fix carries the previous turn's pinned products forward with their real
data. It triggers on an explicit demonstrative back-reference, **or** a short
follow-up (≤ 6 words) immediately after a turn that had pins.

**Why it is narrow, and must stay narrow:** a false positive is worse than a
miss. Pinned products *suppress the fast path* and *stop any new search*
("pinned products are the answer"), so wrongly attaching a stale pin surfaces
**zero** products. Hence: never when photos are attached this turn (a photo pick
is its own thing), only an explicit back-reference, and only pins from the
**immediately preceding** exchange — not any pin ever made in the session.

## 4. `[PRODUCT:N]` IS INDEXED INTO THE PINNED SET, NOT THE RESULT STRIP — **STILL BINDING**

*(L2554)*

`[PRODUCT:N]` in a reply is 0-indexed into exactly the products the shopper
pinned for **that turn** — the server's "STORE PRODUCTS" block. The tappable
card must resolve against that set, never against the live global result strip.

> **Binding on v2.** `route.ts` already strips `[PRODUCT:N]` when nothing is
> pinned, for this reason: *"a [PRODUCT:N] the model wrote points at products it
> never saw."* This is the other half of that rule.

## 5. VISION: ONE CALL, NOT A TWO-CALL ROUND TRIP

*(L3334)*

Photos go straight into the stylist's own vision flow — one model call that
reasons about the photo directly — replacing an older two-call round trip
(describe the photo as text, then search on that text).

Two bugs came from the photo *persisting* in the input bar: it looked stuck or
broken (the thumbnail never left), and **every later, unrelated message
re-sent the same photo through the vision model**. A photo is attached one-shot
to the message it was added to, and cleared immediately after.

> Worth reading alongside the denim-clog incident of Aug 2026, where the
> describe-then-search shape produced "men leather sandals" for a denim clog.
> V1 had already concluded the round trip was the wrong shape.

## 6. TOUCH EVENTS, NOT POINTER EVENTS, FOR LONG-PRESS ON iOS

*(L2893)*

iOS Safari can cancel **pointer** events inside a scroll container before 500ms,
killing a long-press timer prematurely. **Touch** events are not cancelled for
stationary holds. Desktop right-click is handled separately via `onContextMenu`.

## 7. TRACKPAD MOMENTUM: ONE SWIPE MUST BE ONE IMAGE

*(L3653)*

A trackpad flick arrives as a dense burst of wheel events (~16–30ms apart)
followed by a decaying momentum tail. Stepping per event ran the whole gallery
on one gesture.

The rule: step **once** on the leading edge, then ignore every following event
until a quiet gap proves the finger lifted and a fresh swipe began.

## 8. SIZE AVAILABILITY IS PER-COLOURWAY — **STILL BINDING**

*(L1112)*

A size is in stock if **any** variant carrying it is available — a single
sold-out colourway must never grey out a size that is stocked elsewhere. When a
colour is selected, scope the check to that colourway so the grid reflects it.

> **Binding on v2.** `Boutique.tsx`'s `toColors` carries the same rule
> ("Available if ANY size in this colour is") and the Aug 2026 colourway fix
> extended it to images. Same principle, arrived at twice.

## 9. WORDMARK RENDERING ACROSS ENGINES

*(L191)*

PP Gatwick ships only Ultralight (200) and Bold (700) — no in-between weight.
Ultralight alone reads too thin at logo size, Bold too heavy.
`-webkit-text-stroke` adds a hairline outline in the fill colour, thickening the
strokes without switching weight.

**A ratio tuned in desktop Chromium (2.2%, ~0.6px) still read visibly thinner on
a real iOS device** — sub-1px stroke widths round and antialias less faithfully
there than in a desktop headless browser. Bumped with a firmer minimum.
Firefox ignores `-webkit-text-stroke` entirely and shows unstroked Ultralight,
a graceful if thinner fallback.

> Generalisable: **a visual tuned only in headless Chromium is not tuned.**

## 10. IMAGERY: PROGRESSIVE UPGRADE TO THE ON-BODY SHOT

*(L551)*

Feed products carry only the store's primary image, usually a flat packshot. The
model shots live in the product's full gallery, fetched lazily and cached, then
ranked model-first — so a tile shows the piece worn rather than a packshot,
**without blocking the feed**.

## 11. TYPEWRITER REVEAL: WHOLE WORDS AND WHOLE TOKENS

*(L1480)*

Replies reveal by **word**, not character — more natural at conversational
speed — and `[PRODUCT:N]` tokens reveal **atomically**, so a card never flickers
through as raw bracket text on its way in.

## 12. ROWS ARE NOT PADDED TO A FIXED COUNT

*(L1590)*

Each "Found for you" row shows 13 products. A fetch returning more renders as
that many separate rows, not one long lump. A fetch returning fewer shows one
shorter row — **never padded**.

## 13. THE `from:` → `discern:` LOCALSTORAGE MIGRATION — **STILL BINDING**

*(L71+)*

Every browser key the app ever wrote was brand-prefixed under `from:` — explore
cache, stylist history, every session blob, saved products, size-guide unit —
plus `from_user_name`.

The migration runs **at module load, before any component's `useState`
initializer reads localStorage**, so every read sees the migrated key. It
copies forward only: never deletes the old key, never overwrites an
already-migrated one, and is therefore safe to run on every page load.

> **Binding.** Any returning shopper from before the rebrand still depends on
> this. It lived in the deleted file. **Before deleting, confirm v2 either
> carries it or no longer needs it** — see the open question in
> `v2-migration-notes.md`.

---

## FROM THE PARKED GRID-SEARCH ROUTE

`lib/_parked/ai-chat-route.ts` was `/api/ai/chat` — the home page's grid search,
before the app unified onto one conversational surface. Deliberately moved out
of `app/api/` so Next.js would not build or serve it.

**14. Mandatory concepts always lead with the product type.** *(L511)*
Never leave `mandatoryConcepts` empty for a product search. The primary garment
is always the first group; a colour becomes its own group with catalogue
synonyms — `"black shirt"` → `[["shirt","shirts","tee","top"], ["black","jet
black","noir"]]`. On a new request for a different item, **drop the old
concepts** and carry only what was asked for now.

> Live in `queryParser.buildMandatoryConcepts`. The rule predates it.

**15. Brand fallback.** *(L263)* When a named brand returns nothing — no UCP, or
no match — retry across the whole roster with the brand stripped, and **flag it
so the reply can say so** rather than coming up silently empty.

> Live in `route.ts` as the `detectBrandsInQuery` honesty path.

**16. Multilingual concept groups.** *(L511)* Concept groups carried
translations inline — `["bag","bags","backpack","tote","túi"]`. The Japanese
translation layer in `GlobalCatalogService` is the descendant of this idea.
