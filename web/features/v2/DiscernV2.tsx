'use client'
/**
 * Discern v2 — the boutique interface, built to the reference clips.
 *
 * Every screen, control and micro-state below was read off the clips frame by
 * frame. Notable behaviours that are easy to get wrong and are deliberate here:
 *
 *  · The idle prompt in the bar MARQUEES horizontally (a slow continuous
 *    left drift), it does not cross-fade between suggestions.
 *  · The hero's three cards each swap their image independently on a stagger,
 *    so the trio is never in phase.
 *  · The look tray is CONTEXTUAL — its four chips are the pieces of whichever
 *    look is currently on screen, and it re-populates as you scroll.
 *  · The two PDP pills open DIFFERENT surfaces: MATERIALS a dark frosted card
 *    (composition, SKU, nested DETAILS), HOW TO STYLE a light card holding a
 *    grid of pieces that complete the look.
 *  · The cart tray has two shapes: compact (one row: buy + name + price) and
 *    expanded (thumb + meta + colour/size actions).
 *  · Choosing a colour ringed-highlights the swatch and can resolve to
 *    "Unavailable", which disables the buy button rather than hiding it.
 *  · Sizes are circles on a horizontally-paged rail with a chevron.
 *  · The bag is a white sheet: line items with quantity steppers and Remove,
 *    shipping, subtotal, then PROCEED TO PAYMENT with the redirect notice.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppraiseIcon, ArrowUpIcon, AssembleIcon, BagIcon, ChevronIcon, CloseIcon, DocumentIcon, EditIcon, ExternalLinkIcon, HeartIcon, HistoryIcon, NarrowIcon, PlusIcon, RailIcon, ReadingIcon, SwatchIcon, SparkleIcon, TagIcon, TrashIcon, UserIcon } from '@/components/icons'
import { useSession, signOut } from 'next-auth/react'
import { V2, V2_PROMPTS, V2_SUGGESTIONS, V2_LOADING, V2_HERO_COPY } from './theme'
import V2Auth, { type V2AuthReason } from './V2Auth'
import V2Feedback from './V2Feedback'
import V2Profile from './V2Profile'
import { readDeviceGender, writeDeviceGender } from '@/lib/shopperPrefs'
import { buildCartLinks } from './cartLink'
import { useSyncedShelf } from './useSyncedShelf'
import { productSlotCategories, type SlotCategory } from '@/lib/queryParser'

// ── Types ────────────────────────────────────────────────────────────────────
export type V2Color = { name: string; code?: string; image: string; available?: boolean }
export type V2Product = {
  id: string
  /** Short display name, written for a caption under a photograph. */
  title: string
  /** The catalogue's own title, kept alongside the short one. Nothing displays
   *  it — a name like "KUNAL" or a four-line keyword string is no better on a
   *  product page than in a grid, and the brand handoff goes by storeUrl, not by
   *  name. It is here so the raw name is not lost. */
  fullTitle?: string
  price?: number
  compareAt?: number
  currency?: string
  image: string
  images?: string[]
  vendor?: string
  sku?: string
  /** The brand's own product page. Checkout hands off to it — without this the
   *  bag is a dead end, which is exactly what it was. */
  storeUrl?: string
  colorName?: string
  colors?: V2Color[]
  /** The brand's variants, kept so checkout can resolve the exact one the
   *  shopper picked and hand the store a cart link rather than a product page. */
  variants?: Array<{ id?: string; options?: Array<{ label?: string }>; availability?: boolean }>
  sizes?: string[]
  description?: string
  materials?: string
  howToStyle?: string
  details?: string
  /** The store's own words for what this is. Nothing renders them — they exist
   *  so HOW TO STYLE can work out which slot the piece occupies. A great many
   *  listings are titled "RONALD" or "OLBIA" and say "Men > Shirts" only in
   *  their tags, and dropping the tags here is why those pieces got no styling
   *  answer at all. */
  tags?: string[]
  categories?: string[]
  productType?: string
}
/** One exchange. The answer and the products it produced are one object,
 *  because they are one response — the reply used to be sliced to 90 characters
 *  as a caption and otherwise thrown away. */
export type V2Turn = {
  id: string
  question: string
  answer?: string
  didSearch: boolean
  /** The request broke rather than answering. Kept apart from an empty result
   *  because "nothing fits that" and "that never got through" are different
   *  facts, and only one of them is worth offering to try again. */
  failed?: boolean
  /** Failed because of load rather than a break. Different sentence, same page. */
  busy?: boolean
  /** A side-by-side, when the answer was "which of these". */
  comparison?: { rows: { label: string; values: string[] }[]; pick?: { index: number; reason: string } }
  sections: V2Section[]
}
/** Transcript entry sent back to the stylist so follow-ups have context. */
export type V2Msg = { role: 'user' | 'assistant'; content: string }
export type V2Section = {
  title: string; subtitle?: string; hero?: V2Product; products: V2Product[]
  /** The query that produced this strip, so "See more" can ask for the next
   *  page of the same thing rather than guessing from the heading — which names
   *  the clothes, not the search. */
  query?: string
}
export type V2CartLine = { product: V2Product; color?: string; size?: string; qty: number }

type View = 'home' | 'results' | 'product' | 'look'

/** The brand behind a store link, as a person would name it. */
const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, '') } catch { return u } }

// ── Keyboard offset ──────────────────────────────────────────────────────────
/** How far the software keyboard has pushed the bottom of the window up.
 *
 *  The composer sits at `bottom: this`, so anything wrong here is visible
 *  immediately as a bar floating in the middle of the screen with a band of
 *  empty page under it — which is exactly what it did.
 *
 *  The old rule was "if the visual viewport is more than 150px shorter than
 *  the window, that is the keyboard". On iOS that is not true. Safari's own
 *  toolbar collapsing and expanding resizes the visual viewport too, and
 *  during that animation `vv.height` and `window.innerHeight` are read from
 *  different moments — so a scroll that minimised the address bar could
 *  produce a reading of two hundred-odd pixels, latch it, and leave it there,
 *  because nothing fires afterwards to correct it.
 *
 *  The fix is a rule that cannot be fooled by a toolbar: an offset is only
 *  real while something is focused that a keyboard could be open for. Safari's
 *  chrome is not a text field. Everything else — the >150 floor, the recheck
 *  after blur — stays, and the recheck is now several, spread across the
 *  keyboard's dismissal, because a single one at 150ms measured the animation
 *  rather than its end. */
function useKeyboardOffset(): number {
  const [o, setO] = useState(0)
  useEffect(() => {
    const vv = (window as any).visualViewport; if (!vv) return
    const typing = () => {
      const el = document.activeElement as HTMLElement | null
      if (!el) return false
      return el.tagName === 'TEXTAREA'
        || (el.tagName === 'INPUT' && !/^(file|checkbox|radio|button|submit|hidden)$/i.test((el as HTMLInputElement).type))
        || el.isContentEditable
    }
    const check = () => {
      if (!typing()) { setO(0); return }
      const k = window.innerHeight - vv.height - vv.offsetTop
      setO(k > 150 ? Math.round(k) : 0)
    }
    // The keyboard leaves over about a third of a second and does not always
    // fire a resize when it lands, so this walks it down instead of guessing
    // one moment.
    const settle = () => [0, 150, 320, 550].forEach(t => setTimeout(check, t))
    vv.addEventListener('resize', check); vv.addEventListener('scroll', check)
    document.addEventListener('focusout', settle)
    document.addEventListener('focusin', check)
    window.addEventListener('orientationchange', settle)
    return () => {
      vv.removeEventListener('resize', check); vv.removeEventListener('scroll', check)
      document.removeEventListener('focusout', settle)
      document.removeEventListener('focusin', check)
      window.removeEventListener('orientationchange', settle)
    }
  }, [])
  return o
}

// ── Measured layout vars ─────────────────────────────────────────────────────
// The bar changes height with its content (a wrapped query), and the look
// tray and scroll hint sit on top of it, so --bar is measured rather than
// guessed — a stale constant parks them underneath it.
function useMeasuredVar(name: string, fallback: number) {
  const [el, setEl] = useState<HTMLElement | null>(null)
  const [px, setPx] = useState(fallback)
  useEffect(() => {
    if (!el) { setPx(fallback); return }
    // Distance from the element's top edge to the bottom of the viewport, not
    // its own height — that folds in its bottom margin and safe-area inset, so
    // anything positioned at this offset clears the whole occupied strip.
    const measure = () => {
      const r = el.getBoundingClientRect()
      const host = el.offsetParent?.getBoundingClientRect().bottom ?? window.innerHeight
      setPx(Math.max(0, Math.round(host - r.top)))
    }
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    measure()
    window.addEventListener('resize', measure)
    return () => { ro.disconnect(); window.removeEventListener('resize', measure) }
  }, [el, fallback])
  return { ref: setEl, style: { [name]: `${px}px` } as React.CSSProperties }
}

const money = (n?: number, c = 'USD') =>
  typeof n === 'number' ? new Intl.NumberFormat('en-US', { style: 'currency', currency: c }).format(n) : ''

// ── Progress line ────────────────────────────────────────────────────────────
// The only decoration on the page, and it is load-bearing: it says work is
// happening. A hairline that sweeps, nothing more.
/** The icon for whatever the search is doing right now.
 *
 *  The endpoint labels every stage it reports — read, search, filter, curate,
 *  fabric, outfit — and those labels were being thrown away, so five different
 *  stages looked like one. Anything unrecognised falls back to the reading
 *  glyph, so a new stage added on the server can never leave a hole here. */
function StepIcon({ name }: { name?: string }) {
  const size = 14
  switch (name) {
    case 'search': return <span className="v2-step-ic" key="search"><RailIcon size={size} /></span>
    case 'filter': return <span className="v2-step-ic" key="filter"><NarrowIcon size={size} /></span>
    case 'curate': return <span className="v2-step-ic" key="curate"><AppraiseIcon size={size} /></span>
    case 'fabric': return <span className="v2-step-ic" key="fabric"><SwatchIcon size={size} /></span>
    case 'outfit': return <span className="v2-step-ic" key="outfit"><AssembleIcon size={size} /></span>
    default:       return <span className="v2-step-ic" key="read"><ReadingIcon size={size} /></span>
  }
}

function Progress({ light }: { light?: boolean }) {
  return (
    <span className={`v2-prog ${light ? 'light' : ''}`} aria-hidden>
      <i />
    </span>
  )
}

/** The opening film, kept running.
 *
 *  autoPlay + loop + muted + playsInline is the correct declaration and is not
 *  sufficient on a phone. iOS pauses a video when the tab is backgrounded, when
 *  the browser is switched away from, and under Low Power Mode, and it does not
 *  resume on its own — so the hero was a still frame for anyone who had left
 *  the tab and come back, which is most people. Nothing in the interface offers
 *  a play button, so a paused video simply looks like a broken one.
 *
 *  So the element is asked to resume on every event that can have stopped it,
 *  and on any pause it did not ask for. play() rejects when the browser refuses
 *  (Low Power Mode does refuse); the poster stays up in that case, which is the
 *  correct degraded state and not worth reporting.
 */
/** The one question the catalogue cannot answer for itself.
 *
 *  Gender is a HARD filter server-side — say men and you are never shown a
 *  women's piece — and it is the only one that cannot be inferred, because
 *  almost no sentence carries it. "A linen shirt" names none. "Something for a
 *  beach party" names none. Guessing is a coin flip that is wrong for half the
 *  people who ask, so the filter correctly does nothing while it is unknown,
 *  and a shopper sees a mixed page and reasonably calls it broken.
 *
 *  It was only settable on a Convex account, three taps behind a menu, which
 *  meant every signed-out visitor searched with it blank. So: asked once, in
 *  one tap, right before the first search, and never shown again. It answers
 *  onto the device; the account still wins when it holds an answer.
 *
 *  Deliberately not a modal. Nothing here blocks — the shopper can ignore it
 *  and search anyway, exactly as they can today, and the only thing they lose
 *  is the filter they never knew about. */
function ShopsFor() {
  const [known, setKnown] = useState<boolean | null>(null)   // null = not read yet

  useEffect(() => { setKnown(readDeviceGender() !== null) }, [])

  // Server render and first paint show nothing: reading localStorage during
  // render is a hydration mismatch, and a control that flashes in and out is
  // worse than one that arrives a beat late.
  if (known !== false) return null

  const pick = (g: 'Men' | 'Women' | 'Both') => { writeDeviceGender(g); setKnown(true) }

  return (
    <div className="v2-shopsfor" role="group" aria-label="Who are you shopping for?">
      <span className="v2-shopsfor-q">Shopping for</span>
      <div className="v2-shopsfor-opts">
        {(['Men', 'Women', 'Both'] as const).map(g => (
          <button key={g} type="button" className="v2-shopsfor-b" onClick={() => pick(g)}>{g}</button>
        ))}
      </div>
    </div>
  )
}

function HeroVideo({ src, poster }: { src: string; poster?: string }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const resume = () => {
      if (document.hidden) return
      const p = el.play()
      if (p && typeof p.catch === 'function') p.catch(() => { /* refused; poster stands */ })
    }
    resume()
    // Autoplay can be refused outright, and the commonest reason on a phone is
    // Low Power Mode rather than anything we did — iOS simply will not start a
    // video below the battery threshold, and it draws its own play button over
    // the frame to say so. A user gesture lifts that ban, so the first touch
    // or scroll anywhere on the page starts the film, once.
    const kick = () => {
      resume()
      for (const ev of ['pointerdown', 'touchstart', 'scroll', 'keydown'] as const) {
        window.removeEventListener(ev, kick)
      }
    }
    for (const ev of ['pointerdown', 'touchstart', 'scroll', 'keydown'] as const) {
      window.addEventListener(ev, kick, { passive: true, once: false })
    }
    const onPause = () => { if (!el.ended) resume() }
    el.addEventListener('pause', onPause)
    el.addEventListener('stalled', resume)
    el.addEventListener('loadeddata', resume)
    for (const ev of ['visibilitychange', 'pageshow', 'focus'] as const) {
      (ev === 'visibilitychange' ? document : window).addEventListener(ev, resume)
    }
    return () => {
      for (const ev of ['pointerdown', 'touchstart', 'scroll', 'keydown'] as const) {
        window.removeEventListener(ev, kick)
      }
      el.removeEventListener('pause', onPause)
      el.removeEventListener('stalled', resume)
      el.removeEventListener('loadeddata', resume)
      document.removeEventListener('visibilitychange', resume)
      window.removeEventListener('pageshow', resume)
      window.removeEventListener('focus', resume)
    }
  }, [src])
  return (
    <video ref={ref} src={src} poster={poster} autoPlay muted loop playsInline
      preload="auto" disableRemotePlayback aria-hidden />
  )
}

/** Images fail quietly and look deliberate. A missing hero or card must read as
 *  an unphotographed surface, never as a broken tile — so the element keeps its
 *  geometry and drops to a warm paper wash instead of showing the browser's
 *  torn-image glyph. This is what lets the whole composition stand up before
 *  the art has been dropped in. */
function Img({ src, alt = '', className, ...rest }: React.ImgHTMLAttributes<HTMLImageElement>) {
  // Track WHICH src failed, not a bare boolean — a boolean cleared in an effect
  // races the browser and lets the torn-image glyph back in.
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const ref = useRef<HTMLImageElement>(null)
  // The page is server-rendered, so the browser starts (and can finish) loading
  // these before React hydrates. An image that already 404'd by then fired its
  // error with no handler attached, and onError never fires again — which is why
  // missing art still showed a broken tile. Re-check on mount: a finished image
  // with zero intrinsic width is a failed one.
  useEffect(() => {
    const el = ref.current
    if (el && el.complete && el.naturalWidth === 0 && src) setFailedSrc(src)
  }, [src])
  if (!src || failedSrc === src) return <span className={`v2-img-ph ${className ?? ''}`} aria-hidden />
  return <img ref={ref} src={src} alt={alt} className={className} onError={() => setFailedSrc(src)} {...rest} />
}

/** Bag it, or take it out again.
 *
 *  This was a heart, and a heart went to a private "saved" list that led
 *  nowhere — a second collection to maintain, parallel to the bag, that no
 *  shopper ever asked for and that could not be bought from. One list now: what
 *  you tap here is in the bag in the sidebar, and the bag is the thing you check
 *  out with.
 *
 *  `just` drives the confirmation. A control that changes state silently makes
 *  people tap twice, and on a grid of forty tiles the tap is the only feedback
 *  there is. */
function BagBtn({ on, just, onClick, size = 34, ghost }: {
  on: boolean; just?: boolean; onClick: (e: React.MouseEvent) => void; size?: number; ghost?: boolean
}) {
  return (
    <button type="button" aria-label={on ? 'In your bag — remove' : 'Add to bag'} aria-pressed={on}
      onClick={onClick} className={`v2-bagbtn ${on ? 'on' : ''} ${just ? 'just' : ''} ${ghost ? 'ghost' : ''}`}
      style={{ width: size, height: size }}>
      <BagIcon size={Math.round(size * .44)} />
      {on && <i className="v2-bagbtn-dot" aria-hidden />}
    </button>
  )
}

/** What Fabrics said, with the pieces it named drawn where it named them.
 *
 *  When a question carries pinned pieces the endpoint does not only answer in
 *  prose — it re-inserts [PRODUCT:N] into the reply, right after the sentence
 *  that recommends each one, so the words and the garment arrive together.
 *  v1 rendered those. v2 printed the reply straight into a <p>, so somebody
 *  comparing four pieces read "the navy blazer and grey trousers are the
 *  strongest pairing. [PRODUCT:2] [PRODUCT:0]". The tokens were never a bug in
 *  the backend; they were an instruction nobody was listening to.
 *
 *  [PHOTO:N] is the same for photographs the shopper attached. A token
 *  pointing at something that is not there is dropped rather than shown: a
 *  reference with nothing behind it should leave no trace at all. */
function SaidBody({ text, refs, photos, onOpen }: {
  text: string
  refs: V2Product[]
  photos: string[]
  onOpen: (p: V2Product) => void
}) {
  const parts = text
    // The model sometimes bolds a token; strip the emphasis off it so the
    // token still matches whole.
    .replace(/\*\*\s*(\[(?:PRODUCT|PHOTO):\s*\d{1,2}\])\s*\*\*/gi, '$1')
    .split(/(\[(?:PRODUCT|PHOTO):\s*\d{1,2}\])/i)
    .filter(Boolean)

  const prose: React.ReactNode[] = []
  const cards: React.ReactNode[] = []
  parts.forEach((seg, i) => {
    const m = seg.match(/^\[(PRODUCT|PHOTO):\s*(\d{1,2})\]$/i)
    // Pushed as text, not wrapped in a span: two inline spans in one
    // paragraph share line boxes by definition, and every overlap check ever
    // written reads that as a collision.
    if (!m) { if (seg.trim()) prose.push(seg); return }
    const n = Number(m[2])
    if (/photo/i.test(m[1])) {
      const src = photos[n]
      if (src) cards.push(<img key={`p${i}`} className="v2-said-shot" src={src} alt="" />)
      return
    }
    const pr = refs[n]
    if (!pr) return
    cards.push(
      <button key={`c${i}`} className="v2-said-card" title={pr.title} onClick={() => onOpen(pr)}>
        <Img src={pr.image} alt="" />
        <span>{pr.title}</span>
      </button>,
    )
  })

  return (
    <div className="v2-said-body">
      <p>{prose}</p>
      {cards.length > 0 && <div className="v2-said-cards">{cards}</div>}
    </div>
  )
}

// ── Component ────────────────────────────────────────────────────────────────
export default function DiscernV2({
  heroMedia = '/v2/hero.mp4', heroPoster, onQuery, onLoadMore, onStyleWith, onFeatured, onSearched, onSavedChange, heroCopy = 0,
  buyerCountry,
  buyerCurrency,
  renames,
}: {
  heroMedia?: string; heroPoster?: string
  onQuery?: (q: string, history: V2Msg[], images: string[], onProgress?: (step: { text: string; icon?: string }) => void, pinned?: V2Product[]) => Promise<{
    sections: V2Section[]; look?: V2Product[]
    answer?: string; didSearch?: boolean; light?: boolean; failed?: boolean; busy?: boolean
    comparison?: { rows: { label: string; values: string[] }[]; pick?: { index: number; reason: string } }
  }>
  /** The next page of one strip: the query, and everything already shown. */
  onLoadMore?: (query: string, excludeIds: string[]) => Promise<V2Product[]>
  /** What to wear with the open piece, decided by its own colour and cut
   *  rather than by whatever happened to be in the last search. */
  onStyleWith?: (product: V2Product) => Promise<V2Section[]>
  /** Real catalogue imagery for the three hero cards. Supplying this is what
   *  keeps the opening screen from depending on hand-placed jpgs. */
  onFeatured?: () => Promise<string[]>
  /** Every question asked, so the layer above can feed them back as taste. */
  onSearched?: (q: string) => void
  /** The saved list, mirrored up for the same reason: what someone keeps is
   *  the strongest free signal of what they like. */
  onSavedChange?: (saved: V2Product[]) => void
  /** Index into V2_HERO_COPY, resolved on the server from the clock. */
  heroCopy?: number
  /** Where the shopper is, resolved server-side from the request. Shown on the
   *  account so the geo-scoped prices and brands are not a silent decision. */
  buyerCountry?: string
  /** What the shopper's money is in. The bag totals in it; the lines stay in
   *  whatever the brand charges, because that is what will be taken. */
  buyerCurrency?: string
  /** Readable captions for catalogue titles, keyed by the raw title. They
   *  arrive a second or so after the grid does, so this is only ever a
   *  caption: the product page and the bag keep the piece's real name, which
   *  is what the shopper is actually buying. */
  renames?: Record<string, string>
}) {
  const [view, setView] = useState<View>('home')
  const [input, setInput] = useState('')
  const [focused, setFocused] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadPhase, setLoadPhase] = useState(0)
  /** What the backend says it is doing, when it says anything. The canned
   *  sequence below is the fallback for the seconds before the first line
   *  arrives — not the narration itself, which it used to be. */
  const [livePhase, setLivePhase] = useState<{ text: string; icon?: string } | null>(null)

  /** Every step the backend reported, shown in order and each given long enough
   *  to be read.
   *
   *  The lines arrived and were displayed immediately, which meant the fast
   *  ones — parsing the request, choosing the brands — flashed past in a frame
   *  and the shopper only ever saw the last. Work that took eight seconds
   *  looked like one thing happening. So arrivals go into a queue and a
   *  minimum dwell is enforced per line; if the search finishes while lines are
   *  still queued the queue drains at speed rather than being dropped, because
   *  the point is that the shopper sees WHAT was done, not that each frame gets
   *  its full share of a wait that is already over.
   */
  const stepQueue = useRef<Array<{ text: string; icon?: string }>>([])
  const stepShownAt = useRef(0)
  const stepTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const MIN_DWELL = 620
  // The tail, once the answer is already in hand. While work is genuinely in
  // flight a line is worth reading and the shopper is waiting anyway; after
  // the clothes have arrived the same pacing is just a queue replaying itself
  // in front of a finished page. Fast enough to read as motion rather than as
  // a wait, slow enough that no line is skipped outright.
  const DRAIN_DWELL = 120

  const pumpSteps = useCallback((finishing: boolean) => {
    if (stepTimer.current) { clearTimeout(stepTimer.current); stepTimer.current = null }
    if (stepQueue.current.length === 0) return
    const dwell = finishing || stepQueue.current.length > 2 ? DRAIN_DWELL : MIN_DWELL
    const waited = Date.now() - stepShownAt.current
    const show = () => {
      const next = stepQueue.current.shift()
      if (!next) return
      stepShownAt.current = Date.now()
      setLivePhase(next)
      if (stepQueue.current.length) pumpSteps(finishing)
    }
    // Never show two lines in one tick. React batches state set in the same
    // task, so back-to-back shows collapse into a single render and the middle
    // line is never painted — the step happened, was recorded, and nobody saw
    // it. The first line of a search is exempt: nothing precedes it, so it can
    // appear at once.
    const first = stepShownAt.current === 0
    if (first) show()
    else stepTimer.current = setTimeout(show, Math.max(90, dwell - waited))
  }, [])

  /** Let the queue finish before the pill goes away.
   *
   *  Without this the last two or three steps are still waiting their turn when
   *  the answer lands, and the shopper never learns that the fabric was weighed
   *  or the look assembled. Capped hard: this is a few hundred milliseconds of
   *  narration, never a delay anybody notices as one. */
  const drainSteps = useCallback(() => new Promise<void>(resolve => {
    const queued = stepQueue.current.length
    if (queued === 0) return resolve()
    pumpSteps(true)
    // The cap follows the queue instead of being a flat number. It was 900ms,
    // which is four lines at the drain rate — so a six-step search silently
    // dropped its last two, which are the interesting ones. Still bounded, and
    // a whole six-step narration costs about a second.
    // Each remaining line costs a dwell plus the guaranteed frame between
    // renders, so the cap has to allow for both or the last line is scheduled
    // and then cut off a beat before it paints.
    // Sized to the queue, with a ceiling that is only ever reached by an
    // unusually long narration. A flat 800 truncated the last two lines of an
    // ordinary six-step search — the interesting two — which is the bug this
    // whole queue exists to prevent. Six lines now cost about 1.1s rather than
    // the 2.6s they used to, and none of them is dropped.
    // The cap is a safety net, not the pace. The interval below finishes the
    // moment the queue empties, so the real cost is queued x dwell — a cap
    // tuned tighter than that does nothing but truncate the last line, which
    // is the bug this queue exists to prevent. What made the tail shorter is
    // the dwell itself (190ms to 120ms), not this number.
    const cap = setTimeout(finish, Math.min(2000, queued * (DRAIN_DWELL + 90) + 400))
    const tick = setInterval(() => { if (stepQueue.current.length === 0) finish() }, 40)
    function finish() { clearTimeout(cap); clearInterval(tick); resolve() }
  }), [pumpSteps])

  const pushStep = useCallback((step: { text: string; icon?: string }) => {
    const last = stepQueue.current[stepQueue.current.length - 1]
    if (last?.text === step.text) return          // the same line twice is one line
    stepQueue.current.push(step)
    pumpSteps(false)
  }, [pumpSteps])
  /** Something Fabrics said that had no products attached to it. Shown above
   *  the composer until the next question, because a stylist who answers you
   *  out loud and is never heard is indistinguishable from a broken app. */
  const [said, setSaid] = useState<string | null>(null)
  /** The pieces that answer is about, so a [PRODUCT:N] inside it can be drawn.
   *  Held beside the words rather than read off `pinned`, which empties the
   *  moment the question is sent. */
  const [saidRefs, setSaidRefs] = useState<V2Product[]>([])
  /** And the photographs it was sent, for [PHOTO:N], for the same reason. */
  const [saidPhotos, setSaidPhotos] = useState<string[]>([])
  /** The pieces the next question is about — Ask Fabrics, held back.
   *
   *  The endpoint has always been able to answer ABOUT pieces rather than
   *  search for new ones, and this is the field that reaches it. Everything
   *  that used to fill it has been removed on purpose: opening a piece no
   *  longer pins it, tiles no longer answer a long press, and the chip that
   *  showed the selection is gone with them. It was showing context in the
   *  composer for a feature that is not ready, and asking about two pinned
   *  pieces went out as an ordinary search and came back with socks.
   *
   *  The wiring stays because it is correct and because turning it back on is
   *  three call sites, not a rebuild. Nothing sets it today, so nothing is
   *  sent and nothing is drawn. */
  const [pinned, setPinned] = useState<V2Product[]>([])
  // Turns, not sections. Each query used to replace the results wholesale, so
  // the previous answer and its products were destroyed on every follow-up.
  const [turns, setTurns] = useState<V2Turn[]>([])
  /** A one-line reply that surfaces at the composer and fades. Small talk must
   *  not become a spread in what is otherwise a lookbook. */
  const [look, setLook] = useState<V2Product[] | null>(null)
  const [lookOpen, setLookOpen] = useState(false)
  const [product, setProduct] = useState<V2Product | null>(null)
  /** The piece that was just bagged, for the moment the control confirms it.
   *  Cleared on a timer — see bagIt. */
  const [justBagged, setJustBagged] = useState<string | null>(null)
  /** How many pieces were in the bag when the drawer was last opened. The
   *  drawer is shut when something is bagged, so the confirmation on the tile
   *  is what the shopper sees at the time; this is what tells them, the next
   *  time they open the drawer, where the piece went. */
  const [bagSeen, setBagSeen] = useState(0)
  const bagFirstWrite = useRef(true)
  /** True once the local stores have been read — the sync must not push an
   *  empty bag over a full one during the first render. */
  const [shelfReady, setShelfReady] = useState(false)
  const [histOpen, setHistOpen] = useState(false)
  const [asked, setAsked] = useState<string[]>([])
  /** Which recent is being renamed, by its current text. */
  const [renaming, setRenaming] = useState<string | null>(null)
  const renameAsked = useCallback((from: string, to: string) => {
    const next = to.trim()
    setRenaming(null)
    if (!next || next === from) return
    setAsked(a => {
      const out = a.map(x => (x === from ? next : x))
      // A rename onto an existing entry would leave two identical rows, and the
      // list is keyed by its text.
      return out.filter((x, i) => out.indexOf(x) === i)
    })
  }, [])
  const [photos, setPhotos] = useState<string[]>([])
  const { status: authStatus, data: session } = useSession()
  const [authReason, setAuthReason] = useState<V2AuthReason>(null)
  /** Ask for an account only at the moment one is genuinely needed. Returns
   *  false when the caller should stop.
   *
   *  It used to carry the picture of the piece that triggered the ask, for a
   *  sheet that led with it. That sheet was replaced by the chat UI's card,
   *  which has no picture — so the argument, and the state behind it, had been
   *  dead ever since. */
  const requireAccount = useCallback((why: Exclude<V2AuthReason, null>) => {
    if (authStatus === 'authenticated') return true
    setAuthReason(why)
    return false
  }, [authStatus])
  const [menuOpen, setMenuOpen] = useState(false)
  /** The drawer shows either its navigation or the account, exactly as the chat
   *  UI's sidebar did — the avatar swaps between them rather than opening a
   *  separate screen. */
  const [menuView, setMenuView] = useState<'nav' | 'profile'>('nav')
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [acc, setAcc] = useState<'materials' | 'style' | null>(null)
  /** Rows of pieces that go with the open one. Fetched the first time the
   *  panel is opened for a piece and held while that piece is open. */
  const [styleRows, setStyleRows] = useState<V2Section[] | null>(null)
  const [styleBusy, setStyleBusy] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [descOpen, setDescOpen] = useState(true)
  const [showScroll, setShowScroll] = useState(true)
  const [colorMode, setColorMode] = useState(false)
  const [sizeMode, setSizeMode] = useState(false)
  const [pickedColor, setPickedColor] = useState<V2Color | null>(null)
  const [pickedSize, setPickedSize] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [cart, setCart] = useState<V2CartLine[]>([])
  const [bagOpen, setBagOpen] = useState(false)
  const [blockedStores, setBlockedStores] = useState<string[]>([])
  /** Catalogue imagery. It fed the hero trio; with that gone it survives as the
   *  picture the sign-in sheet leads with when the ask isn't tied to a piece. */
  const [artwork, setArtwork] = useState<string[]>([])
  const [headHidden, setHeadHidden] = useState(false)

  // ── Focus containment ──────────────────────────────────────────────────────
  // Opening the bag used to leave the content behind it fully tabbable: Tab
  // walked through five hidden controls before it ever reached the sheet's own
  // Close button, then carried on out into the composer. A visual scrim is not
  // a focus boundary, so the background is marked `inert` while an overlay is
  // up. Set imperatively — React 18 does not accept `inert` as a prop.
  //
  // The header is inerted for the drawer too, now that the drawer covers it —
  // it used to stay live because the trigger doubled as the close, but a
  // control underneath an opaque panel is not a way out. The drawer carries its
  // own close, and Escape and the scrim both still work.
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    // Whitelist by structure rather than by naming the background pieces: the
    // first attempt listed them and missed two (the scroll hint and the
    // composer are direct children of the root, not of .v2-scroll), so focus
    // still escaped. Anything not named here gets inerted.
    const live = bagOpen ? ['v2-bag', 'v2-bag-ov']
      : menuOpen ? ['v2-menu', 'v2-ov']
      : null
    const touched: HTMLElement[] = []
    if (live) {
      for (const el of Array.from(root.children) as HTMLElement[]) {
        if (live.some(c => el.classList.contains(c))) continue
        el.setAttribute('inert', '')
        touched.push(el)
      }
    } else {
      // With nothing open the drawer is still mounted, just translated out of
      // frame. Its own controls manage tabIndex, but that is easy to forget on
      // the next thing added to it, so the whole panel is inerted while closed.
      const menu = root.querySelector('.v2-menu') as HTMLElement | null
      if (menu) { menu.setAttribute('inert', ''); touched.push(menu) }
    }
    return () => touched.forEach(n => n.removeAttribute('inert'))
  }, [bagOpen, menuOpen])

  useEffect(() => {
    try {
      // The bag outlives the visit — someone who bags a coat on the train and
      // opens the app at home should still have the coat. Local rather than on
      // the account, because bagging is allowed before sign-in and only
      // checkout asks who you are.
      const raw = localStorage.getItem('discern.v2.bag')
      if (raw) {
        const list = JSON.parse(raw) as V2CartLine[]
        if (Array.isArray(list)) setCart(list.filter(l => l?.product?.id))
      }
      const rawAsked = localStorage.getItem('discern.v2.asked')
      if (rawAsked) {
        const list = JSON.parse(rawAsked) as string[]
        if (Array.isArray(list)) setAsked(list.filter(x => typeof x === 'string'))
      }
    } catch { /* private mode, quota, or a shape from an older build */ }
    setShelfReady(true)
  }, [])

  useEffect(() => {
    // Skip the mount pass. Both effects flush in the same commit, so this one
    // would otherwise run with the empty initial Map — after the read above had
    // already happened but before its setSaved landed — and write the store
    // back as empty. Hydration re-renders, and that second pass persists.
    if (bagFirstWrite.current) { bagFirstWrite.current = false; return }
    try {
      localStorage.setItem('discern.v2.bag', JSON.stringify(cart))
      localStorage.setItem('discern.v2.asked', JSON.stringify(asked))
    } catch { /* nothing worth breaking a bag over */ }
  }, [cart, asked])

  // ── The same account, on every device ────────────────────────────────────
  // Signed out this does nothing and the two stores above are the whole story.
  // Signed in, the account row is the truth: bag a coat on the phone and it is
  // in the bag on the laptop; delete a recent on the laptop and it is gone from
  // the phone. See useSyncedShelf for why the first exchange is a union and
  // every one after it is a replacement.
  const adoptShelf = useCallback((shelf: { bag: V2CartLine[]; recents: string[] }) => {
    setCart(shelf.bag.filter(l => l?.product?.id))
    setAsked(shelf.recents)
  }, [])
  useSyncedShelf({ bag: cart as never, recents: asked, onRemote: adoptShelf as never, ready: shelfReady })

  // What is in the bag is the strongest taste signal there is — stronger than
  // the saved list this replaced, because it is what someone intends to pay
  // for. It goes to the stylist with every question.
  useEffect(() => { onSavedChange?.(cart.map(l => l.product)) }, [cart, onSavedChange])

  // ── The session survives a refresh ─────────────────────────────────────────
  // Everything a search produced lived in React state only, so a reload — or
  // iOS quietly discarding a backgrounded tab, which happens constantly on a
  // phone — threw away the answer, the question, and the whole history. The
  // shopper's only route back was the drawer's recents, which re-ran the search
  // from scratch and cost another model call for an answer we already had.
  //
  // sessionStorage rather than local: this is one visit's conversation, and a
  // browser reopened next week should not resume mid-sentence. Recents (`asked`)
  // are the long-lived record and stay where they are.
  const RESTORE_KEY = 'discern.v2.session'
  const restored = useRef(false)
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(RESTORE_KEY)
      if (!raw) { restored.current = true; return }
      const s = JSON.parse(raw) as { turns?: V2Turn[]; view?: View; said?: string | null }
      if (Array.isArray(s.turns) && s.turns.length) {
        setTurns(s.turns)
        // Only back to the results page. A restored product page would be a
        // page the shopper never navigated to in this session, and the piece
        // may not even be in stock any more.
        if (s.view === 'results' || s.view === 'product' || s.view === 'look') setView('results')
      }
      if (typeof s.said === 'string') setSaid(s.said)
    } catch { /* private mode, quota, or a shape from an older build */ }
    restored.current = true
  }, [])

  useEffect(() => {
    // Wait for the read above, or the first commit writes the empty initial
    // state over the very thing we are about to restore.
    if (!restored.current) return
    try {
      // Two turns, not twelve. Each one carries whole product objects with
      // image URLs and variants, and sessionStorage throws past a few MB —
      // silently losing the write, which is worse than storing less.
      const slim = turns.slice(0, 2)
      sessionStorage.setItem(RESTORE_KEY, JSON.stringify({ turns: slim, view, said }))
    } catch {
      // Over quota: keep the most recent turn alone rather than nothing.
      try {
        sessionStorage.setItem(RESTORE_KEY, JSON.stringify({ turns: turns.slice(0, 1), view, said }))
      } catch { /* give up quietly; the session is still fine in memory */ }
    }
  }, [turns, view, said])

  // Escape closes the topmost open layer. Every one of these inerts the rest of
  // the page while it is up, so without this the only way out is finding the
  // right scrim or close button — the sign-in card already handled its own key,
  // these did not. Order matches the z-index stack, so with two layers open
  // Escape peels the front one rather than the one underneath.
  useEffect(() => {
    if (!(bagOpen || histOpen || menuOpen || lookOpen)) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // The sign-in card is the front layer and closes itself. Peeling the bag
      // out from under it left the card stranded over a page with nothing
      // behind it — and worse, it left no way out at all, because closing the
      // bag re-rendered this component, which tore down and re-added the
      // card's own Escape listener mid-dispatch. A listener removed while an
      // event is being dispatched is never called for that event, so the key
      // that was supposed to close the card silently did nothing.
      if (authReason !== null) return
      e.stopPropagation()
      if (bagOpen) setBagOpen(false)
      else if (histOpen) setHistOpen(false)
      else if (menuOpen) { setMenuOpen(false); setMenuView('nav') }
      else setLookOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [bagOpen, histOpen, menuOpen, lookOpen, authReason])

  /** The caption for a piece. A better name if one has arrived, its own
   *  otherwise — never a wait for one. */
  const captionOf = useCallback(
    (p: V2Product) => (renames && renames[p.title]) || p.title,
    [renames],
  )

  const taRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const lookRailRef = useRef<HTMLDivElement>(null)
  const kb = useKeyboardOffset()

  // Same number as the CSS default below it — a different one here would
  // reintroduce the jump on the first paint after hydration.
  const barVar = useMeasuredVar('--bar', 129)

  const canSend = input.trim().length > 0
  const idle = !focused && input.length === 0
  const cartCount = cart.reduce((n, l) => n + l.qty, 0)
  /** Which lines this checkout is for.
   *
   *  Held as the ones NOT going, so a piece added later is in the order by
   *  default and nothing has to be kept in step with the cart. A single-brand
   *  bag therefore still checks out in one tap; the ticks are there for the
   *  case that was broken — several pieces, and no way to say which of them
   *  you meant. */
  const [dropped, setDropped] = useState<Set<string>>(new Set())
  /** Which brand this checkout is for. One at a time, always.
   *
   *  A bag of seven pieces from five brands drew five Checkout buttons, which
   *  is a menu of decisions where there should be one action. The reason it
   *  did that is real — a browser allows one new tab per tap, so five brands
   *  genuinely cannot be opened at once — but the answer is to check out one
   *  brand at a time, not to put the problem on screen. So the selection is
   *  scoped to a brand: ticking a piece from another brand moves the whole
   *  selection there, and there is one Checkout button that always knows
   *  exactly where it is going. */
  const [selectedHost, setSelectedHost] = useState<string | null>(null)
  const lineKey = (l: V2CartLine) => `${l.product.id}|${l.color ?? ''}|${l.size ?? ''}`
  const hostOfLine = (l: V2CartLine) => hostOf(l.product.storeUrl || '')
  /** The brand in focus — the chosen one while it is still in the bag, and
   *  otherwise whatever the bag starts with, so it is never stale or empty. */
  const activeHost = useMemo(() => {
    if (selectedHost && cart.some(l => hostOfLine(l) === selectedHost)) return selectedHost
    return cart.length ? hostOfLine(cart[0]) : null
  }, [selectedHost, cart])
  const picked = useMemo(
    () => cart.filter(l => hostOfLine(l) === activeHost && !dropped.has(lineKey(l))),
    [cart, dropped, activeHost],
  )
  /** Ticking a piece. Within the brand in focus it is an ordinary toggle;
   *  outside it, it moves the focus and brings that brand in whole. */
  const togglePick = useCallback((l: V2CartLine) => {
    const key = lineKey(l)
    const h = hostOfLine(l)
    if (h !== activeHost) {
      setSelectedHost(h)
      setDropped(d => { const n = new Set(d); n.delete(key); return n })
      return
    }
    setDropped(d => {
      const n = new Set(d)
      if (n.has(key)) n.delete(key); else n.add(key)
      return n
    })
  }, [activeHost])

  /** Live rates, fetched the first time the bag is opened rather than on every
   *  page load — nothing before this point needs them. */
  const [rates, setRates] = useState<Record<string, number> | null>(null)
  useEffect(() => {
    if (!bagOpen || rates) return
    let gone = false
    fetch('/api/rates')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!gone && d && typeof d === 'object' && !d.error) setRates(d) })
      .catch(() => { /* the honest per-currency total below still stands */ })
    return () => { gone = true }
  }, [bagOpen, rates])

  /** What the selected lines come to.
   *
   *  It used to be one number with no currency on it at all — `money(subtotal)`
   *  falls back to USD — so a bag of rupee-priced pieces reported a dollar
   *  total, and the number itself was the sum of amounts in whatever
   *  currencies the brands happened to charge in, added together as if they
   *  were the same unit. Both halves of that are wrong and the second is worse
   *  than the first.
   *
   *  So: total per currency first, which is always true. One currency, one
   *  total. Several, and it converts into the shopper's own currency at the
   *  live rate — and if a rate for any of them is missing it does NOT guess,
   *  it shows each currency on its own line. A total labelled in a currency it
   *  was never converted into is how you tell somebody ₹14,897 is $14,897. */
  const totals = useMemo(() => {
    const by = new Map<string, number>()
    for (const l of picked) {
      const c = (l.product.currency || 'USD').toUpperCase()
      by.set(c, (by.get(c) ?? 0) + (l.product.price ?? 0) * l.qty)
    }
    return Array.from(by.entries()).map(([currency, amount]) => ({ currency, amount }))
  }, [picked])

  const target = (buyerCurrency || totals[0]?.currency || 'USD').toUpperCase()
  const converted = useMemo(() => {
    if (totals.length <= 1) return null
    if (!rates || !rates[target]) return null
    if (!totals.every(t => rates[t.currency])) return null
    return totals.reduce((n, t) => n + (t.amount / rates[t.currency]) * rates[target], 0)
  }, [totals, rates, target])



  // ── Checkout ───────────────────────────────────────────────────────────────
  // Discern never takes payment: every line hands off to the brand that sells
  // it. The button had no handler at all, so the bag was a dead end — items in,
  // subtotal shown, nothing out. A bag can hold several brands, so this opens
  // one tab per distinct store rather than pretending there is a single basket.
  //
  // Browsers only reliably allow ONE window.open per user gesture, so anything
  // after the first is likely to be blocked. Rather than fail silently, blocked
  // stores are surfaced as real links the shopper can click themselves.
  const host = hostOf

  /** One cart link per store, built from what the shopper picked. The matching
   *  and grouping rules live in ./cartLink, tested directly — they decide where
   *  someone's money goes and should not need a browser to verify. */
  const payLinks = useMemo(() => buildCartLinks(cart), [cart])

  /** Hand off to the brands. Takes the lines explicitly so the product page can
   *  check out one piece without the rest of the bag coming with it. */
  const checkoutLines = useCallback((lines: V2CartLine[]) => {
    if (!lines.length) return
    // An account before the handoff: past this point the order lives on the
    // brand's site, and without one there is no way to tell the shopper what
    // they bought or where it went. The sheet this raises cannot be dismissed —
    // see isMandatory in V2Auth — because a checkout you can wave away is just
    // a button that does nothing.
    if (!requireAccount('checkout')) return
    const links = buildCartLinks(lines)
    if (!links.length) { setBlockedStores([]); return }
    const blocked: string[] = []
    links.forEach((url, i) => {
      // The first open rides the click gesture; later ones usually will not.
      // NOT 'noopener' in the feature string: with it, window.open returns null
      // by specification, so a perfectly successful tab is indistinguishable
      // from a blocked one and every checkout claimed to be blocked. Opening
      // plainly and severing `opener` afterwards gives the same protection
      // while keeping the handle that tells us whether it actually worked.
      const w = window.open(url, '_blank')
      if (!w) { blocked.push(url); return }
      try { w.opener = null } catch { /* cross-origin: already isolated */ }
      if (i === 0) w.focus?.()
    })
    setBlockedStores(blocked)
  }, [requireAccount])

  /** The bag sheet's own button: everything in it. */
  const checkout = useCallback(() => checkoutLines(cart), [cart, checkoutLines])

  // DETAILS reads as a short list of construction facts, one per line — split
  // whatever the catalog gives us on the separators it actually uses.
  const detailLines = useMemo(() => {
    const raw = product?.details || product?.materials || ''
    const parts = raw.split(/\s*[\n•;,]\s*|\.\s+(?=[A-Z])/).map(s => s.trim()).filter(Boolean)

    // These come from the store's own tag list, which is written for a search
    // index, not for a person: "RRDENIM", "similar_product_rare-rr-denim",
    // "Group_Supima Cotton", "MATERIAL_100% Supima Cotton". Printing them under
    // MATERIALS is printing somebody's database.
    //
    // What is worth keeping is a fibre statement. Keys, slugs and style codes
    // go; what is left is deduplicated by the fibre it names, keeping the
    // richest phrasing — so "Group_Supima Cotton", "Material Group_Supima
    // Cotton" and "MATERIAL_100% Supima Cotton" collapse to the one that
    // actually says the percentage.
    const KEYWORDS = /^(material|materials|group|fabric|composition|comp|made of|type)\b[\s_:-]*/i
    const kept: string[] = []
    for (const part of parts) {
      let t = part.replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
      // strip repeated leading keys: "Material Group Supima Cotton"
      for (let i = 0; i < 3 && KEYWORDS.test(t); i++) t = t.replace(KEYWORDS, '').trim()
      if (!t) continue
      if (/[a-z0-9]+-[a-z0-9-]{3,}/i.test(t)) continue       // similar-product-rare-rr-denim
      if (/^[A-Z0-9]{4,}$/.test(t)) continue                  // RRDENIM, a style code
      if (t.length < 3 || t.length > 90) continue
      if (/^[\d\s.%]+$/.test(t)) continue
      if (t === t.toUpperCase() && t.length > 4 && !/%/.test(t)) {
        t = t.charAt(0) + t.slice(1).toLowerCase()
      }
      kept.push(t.charAt(0).toUpperCase() + t.slice(1))
    }
    // Collapse by fibre: two lines naming the same fibre are one fact, and the
    // one carrying a percentage is the one worth showing.
    const fibreOf = (t: string) => t.toLowerCase().replace(/[^a-z]/g, '')
    const best = new Map<string, string>()
    for (const t of kept) {
      const k = fibreOf(t)
      const prev = best.get(k)
      if (!prev || (/%/.test(t) && !/%/.test(prev))) best.set(k, t)
    }
    const clean = Array.from(best.values()).filter((t, _i, all) =>
      // drop a line whose fibre is already spelled out inside a longer one
      !all.some(o => o !== t && fibreOf(o).includes(fibreOf(t)) && /%/.test(o)))
    return clean.length ? clean.slice(0, 6) : []
  }, [product])

  // The reference leads the MATERIALS panel with the composition in caps.
  const composition = useMemo(() => {
    const m = (product?.materials || product?.description || '').match(/\d{1,3}\s*%\s*[A-Za-z][A-Za-z\s]*/g)
    return m?.length ? m.map(s => s.replace(/\s+/g, ' ').trim()).slice(0, 3).join(', ').toUpperCase() : ''
  }, [product])

  // Pieces offered under HOW TO STYLE. The current look is the truest answer to
  // "what finishes this"; failing that, fall back to the rest of the results.
  /** The newest turn's results — what "the current results" meant before turns
   *  existed. */
  const sections = useMemo(() => turns[0]?.sections ?? [], [turns])

  // Asked for once per piece, and only when the panel is actually opened —
  // it searches every brand for three or four garments and reads the colour
  // off each photograph, which is not work to do speculatively for a shopper
  // who never taps it.
  //
  // The guard is a ref rather than the state itself, and that is the whole
  // trick. Keyed on `styleBusy`, this effect re-ran the moment it set that
  // flag, its cleanup fired, and the in-flight request was discarded as stale
  // before it could ever land — the panel sat on "Looking for what goes with
  // it…" for ever. A ref changes without re-running anything.
  const styleFor = useRef<string | null>(null)
  useEffect(() => { setStyleRows(null); styleFor.current = null }, [product?.id])
  useEffect(() => {
    if (acc !== 'style' || !product || !onStyleWith) return
    if (styleFor.current === product.id) return
    styleFor.current = product.id
    setStyleBusy(true)
    onStyleWith(product)
      .then(rows => setStyleRows(rows))
      .catch(() => setStyleRows([]))
      .finally(() => setStyleBusy(false))
  }, [acc, product, onStyleWith])

  /** What to wear it WITH.
   *
   *  This took the first four things in the results, which for a t-shirt search
   *  is four more t-shirts — an outfit suggestion made entirely of the garment
   *  you are already looking at. A piece is styled by what sits in the OTHER
   *  slots, so this picks one per slot in wear order and never repeats the
   *  slot the product itself occupies. */
  const styleWith = useMemo(() => {
    if (!product) return []
    const pool = (look?.length ? look : sections.flatMap(s => [...(s.hero ? [s.hero] : []), ...s.products]))
      .filter(p => p.id !== product.id && p.image)

    const slotsOf = (p: V2Product) =>
      productSlotCategories({ title: p.title, tags: [], description: p.description })
    const mine = slotsOf(product)

    const ORDER: SlotCategory[] = ['outer', 'top', 'bottom', 'dress', 'shoes', 'accessory']
    const picked: V2Product[] = []
    const used = new Set<SlotCategory>()
    for (const slot of ORDER) {
      if (mine.has(slot)) continue
      const hit = pool.find(p => !picked.includes(p) && slotsOf(p).has(slot))
      if (hit) { picked.push(hit); used.add(slot) }
      if (picked.length === 4) break
    }
    return picked
  }, [product, look, sections])

  useEffect(() => {
    const el = taRef.current; if (!el) return
    // 76px is three lines. A paragraph typed into it was clipped with its top
    // out of reach and no way to scroll back, which is what "it gets stuck"
    // meant. It grows to a third of the screen and scrolls inside itself after
    // that, the way every other composer does.
    const cap = Math.max(76, Math.min(200, Math.round(window.innerHeight * 0.3)))
    el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, cap) + 'px'
  }, [input, focused])

  // The wait is narrated as a sequence, not one frozen label: the phrases
  // cross-fade in order for as long as the work takes.
  useEffect(() => {
    if (!loading) return
    // Advance and hold. It used to wrap with % length, so a long search went
    // "Almost there" and then back to "Reading your request" — which is not
    // slow, it is broken, and it is the first thing anyone notices.
    const t = setInterval(() => setLoadPhase(n => Math.min(n + 1, V2_LOADING.length - 1)), 2100)
    return () => clearInterval(t)
  }, [loading])

  // The chrome gets out of the way as you read down and comes back the moment
  // you head up again — the same behaviour the clips show.
  const lastY = useRef(0)
  const onScroll = useCallback(() => {
    const y = scrollRef.current?.scrollTop ?? 0
    setShowScroll(y < 40)
    const dy = y - lastY.current
    if (Math.abs(dy) > 6) {
      setHeadHidden(y > 90 && dy > 0)
      lastY.current = y
    }
    trackBarSurface()
  }, [])

  /** Which way round the composer is painted.
   *
   *  The bar floats over whatever happens to be under it — the film on the
   *  opening screen, bone paper on a results page, a photograph on a product
   *  page. One fixed treatment cannot stay legible across all three: dark glass
   *  disappears into the film. So the surfaces declare themselves with
   *  data-surface, the bar samples what is actually behind it, and flips.
   *
   *  Sampled rather than derived from `view` because a single screen is not one
   *  surface: the home scroller runs the dark film into the light prompt panel,
   *  and the bar has to change halfway down it.
   */
  const [onDark, setOnDark] = useState(true)
  const trackBarSurface = useCallback(() => {
    const bar = document.querySelector('.v2-bar')
    if (!bar) return
    const r = bar.getBoundingClientRect()
    // Just above the bar's own top edge, at its centre: the last content the
    // bar is actually sitting on.
    const el = document.elementFromPoint(
      Math.round(r.left + r.width / 2),
      Math.max(1, Math.round(r.top) - 6),
    )
    const marked = el?.closest('[data-surface]') as HTMLElement | null
    setOnDark(marked?.dataset.surface !== 'light')
  }, [])

  useEffect(() => {
    trackBarSurface()
    const id = setTimeout(trackBarSurface, 60) // after the view's own transition
    return () => clearTimeout(id)
  }, [view, loading, trackBarSurface])

  // Sections arrive rather than appear: each one fades and lifts into place the
  // first time it comes into view, then stays put.
  useEffect(() => {
    const root = scrollRef.current
    if (!root || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      entries => entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target) } }),
      // No inset on the bottom edge: with one, anything that comes to rest
      // inside that band at full scroll would never reveal and would sit at
      // zero opacity for good. Entering the viewport at all is the trigger.
      { root, rootMargin: '0px', threshold: 0.01 },
    )
    root.querySelectorAll<HTMLElement>('.v2-rise:not(.in)').forEach(el => {
      // A zero-size element (one hidden at this breakpoint) can never
      // intersect, so observing it would strand it at zero opacity if the
      // viewport later widened and revealed it. Nothing to animate — mark it
      // arrived and move on.
      if (!el.offsetWidth && !el.offsetHeight) el.classList.add('in')
      else io.observe(el)
    })
    return () => io.disconnect()
  }, [turns, view])

  useEffect(() => {
    if (!onFeatured) return
    let live = true
    onFeatured()
      .then(urls => { if (live && urls.length) setArtwork(urls) })
      .catch(() => { /* the hero degrades to its paper surfaces */ })
    return () => { live = false }
  }, [onFeatured])

  // No account asked for. The bag lives on this device until checkout, which is
  // the only thing that stops and asks who you are.
  /** Whether a piece is already in the bag. Used by every tile, so it is worth
   *  not rebuilding a Set on each of forty renders. */
  const bagIds = useMemo(() => new Set(cart.map(l => l.product.id)), [cart])
  const inBag = useCallback((id: string) => bagIds.has(id), [bagIds])

  const bagIt = useCallback((p: V2Product) => {
    if (bagIds.has(p.id)) {
      setCart(c => c.filter(l => l.product.id !== p.id))
      setJustBagged(null)
      return
    }
    // From a tile there is no colour or size chosen yet — that is what the
    // product page is for. The line carries what is known, and checkout resolves
    // the variant from it.
    setCart(c => [...c, { product: p, color: p.colorName, qty: 1 }])
    setJustBagged(p.id)
    // Long enough to read "Bagged", short enough not to sit there as a second
    // permanent state — the filled bag is what says it is in.
    setTimeout(() => setJustBagged(cur => (cur === p.id ? null : cur)), 1400)
  }, [bagIds])

  /** Attached photos are compressed to 768px JPEG data URLs, the same pipeline
   *  the chat UI used. They were object URLs before, which render fine in the
   *  strip and mean nothing to a server — a `blob:` handle is private to this
   *  document, so the photos were only ever decorative. The vision model needs
   *  the bytes, so it gets them inline. */
  const addPhotos = useCallback((files: FileList | null) => {
    if (!files?.length) return
    Array.from(files).slice(0, 4).forEach(file => {
      const reader = new FileReader()
      reader.onload = ev => {
        const src = ev.target?.result
        if (typeof src !== 'string') return
        const im = new window.Image()
        im.onload = () => {
          const MAX = 768
          const ratio = Math.min(MAX / im.width, MAX / im.height, 1)
          const canvas = document.createElement('canvas')
          canvas.width = Math.round(im.width * ratio)
          canvas.height = Math.round(im.height * ratio)
          canvas.getContext('2d')?.drawImage(im, 0, 0, canvas.width, canvas.height)
          setPhotos(p => p.length < 4 ? [...p, canvas.toDataURL('image/jpeg', 0.82)] : p)
        }
        im.src = src
      }
      reader.readAsDataURL(file)
    })
  }, [])
  const dropPhoto = useCallback((url: string) => {
    setPhotos(p => p.filter(u => u !== url))
  }, [])

  const run = useCallback(async (q: string) => {
    if (!q.trim() || loading) return
    setAsked(a => [q.trim(), ...a.filter(x => x !== q.trim())].slice(0, 12))
    taRef.current?.blur()
    setLoadPhase(0); setLivePhase(null)
    // A new question starts a new narration; anything still queued belongs to
    // the last one.
    stepQueue.current = []
    stepShownAt.current = 0
    if (stepTimer.current) { clearTimeout(stepTimer.current); stepTimer.current = null }
    setLoading(true); setLookOpen(false)
    const question = q.trim()
    // The transcript so far, so a follow-up like "cheaper" has something to
    // refine rather than arriving as a fresh conversation.
    const history: V2Msg[] = turns.slice(0, 4).reverse().flatMap(t => ([
      { role: 'user' as const, content: t.question },
      ...(t.answer ? [{ role: 'assistant' as const, content: t.answer }] : []),
    ]))
    // Captured before the await so a photo added mid-flight belongs to the next
    // turn, not this one — and so the strip can clear on completion regardless.
    const sentPhotos = photos
    // Captured with the photos and cleared in the same place: a pin belongs to
    // the question asked while it was showing, not to the next one.
    const sentPinned = pinned.length ? pinned : undefined
    onSearched?.(question)
    /** Whether this turn produced something worth showing a page for. */
    let show = false
    try {
      const res = onQuery
        ? await onQuery(question, history, sentPhotos, pushStep, sentPinned)
        : { sections: [], look: undefined, answer: undefined, didSearch: false, light: false }
      const sections = res.sections ?? []

      // Nothing found and nothing searched — a greeting, an aside, or a
      // question Fabrics answered in words. The page stays where it is, which
      // is right; what was NOT right is that the answer went in the bin. The
      // comment that used to sit here said replies "surface briefly at the
      // composer", and no such surface was ever built, so every conversational
      // turn looked from the outside like the app doing nothing at all: you
      // typed a sentence, watched it load, and got the home screen back.
      //
      // A failed request produces the same empty shape and is handled by the
      // flag rather than falling in here.
      if (!sections.length && !res.didSearch && !res.failed && !res.comparison) {
        const words = res.answer?.trim()
        // No products AND no words is not an answer, it is a dropped request.
        // Treated as one, so it lands on the results view with a way to try
        // again instead of quietly restoring the home screen — which is
        // indistinguishable from the app having done nothing.
        if (!words) {
          setTurns(prev => [{ id: `empty-${prev.length}`, question, didSearch: false, failed: true, busy: res.busy === true, sections: [] }, ...prev].slice(0, 12))
          // Return, do not fall through. The push below would add a SECOND
          // turn for the same question — an ordinary empty one — and the
          // results view renders only the newest, so the failure state was
          // recorded and then immediately hidden behind a blank page.
          show = true
          setInput('')
          setSaid(null); setSaidRefs([]); setSaidPhotos([])
          return
        }
        setInput('')
        setSaid(words)
        // What the reply is talking about. Without these a [PRODUCT:2] the
        // backend deliberately placed has nothing to draw and shows through as
        // the literal characters.
        setSaidRefs(sentPinned ?? []); setSaidPhotos(sentPhotos)
        setLoading(false)
        return
      }
      setSaid(null); setSaidRefs([]); setSaidPhotos([])

      setTurns(prev => [{
        id: `${prev.length}-${question.slice(0, 24)}`,
        question, answer: res.answer, didSearch: res.didSearch === true,
        failed: res.failed === true, busy: res.busy === true,
        comparison: res.comparison, sections,
      }, ...prev].slice(0, 12))
      if (res.look?.length) { setLook(res.look); setLookOpen(true) }
      show = true
    } catch (e) {
      // A failed lookup still lands on the results view — the empty state says
      // so plainly, which is calmer than an error dialog over the boutique.
      console.error('[v2] query failed:', e)
      setTurns(prev => [{ id: `err-${prev.length}`, question, didSearch: false, failed: true, sections: [] }, ...prev])
      show = true
    } finally {
      // Cleared here, not at send: the reference keeps what you asked visible in
      // the bar for the whole wait, so the query and the loading state read as
      // one continuous act, and the bar only empties once there is something to
      // look at. Clearing on send made the question vanish the instant you
      // committed to it. (It previously never cleared at all, which is what let
      // a second question concatenate onto the first.)
      setInput('')
      // The attached photos belonged to this question; leaving them in the bar
      // silently re-sent them with every follow-up.
      if (sentPhotos.length) setPhotos(p => p.filter(u => !sentPhotos.includes(u)))
      if (sentPinned) setPinned([])
      // Only leave the page when there is a page to leave for. `finally` runs
      // on the early return above too, so a turn that produced nothing to show
      // still navigated to the results view — which then had no turn to render.
      // That is the blank screen after the searching animation.
      // Finish the narration before the pill leaves, so every step the
      // backend reported is actually seen.
      await drainSteps()
      if (show) {
        setView('results')
        scrollRef.current?.scrollTo({ top: 0 })
      }
      setLoading(false)
    }
  }, [loading, onQuery, onSearched, photos, turns, pushStep, drainSteps, pinned])

  /** The menu carries what the chat UI's sidebar carried: start again, the
   *  things you have set aside, and what you asked before.
   *
   *  Gone: New in / Women / Men, which ran a catalogue search for their own
   *  label — a department store's spine grafted onto something whose whole
   *  argument is that you say what you want instead of narrowing down to it.
   *  Gone with them: Orders, which opened the bag and was never orders, and
   *  Help, which searched the shop for "how does Discern work". The chat UI's
   *  Explore and Brand Collections are not here either; both were coming-soon
   *  toasts, and a menu is a promise that a thing exists. */
  const MENU = [
    // Neither of these is built. They are listed because they are coming, and
    // marked so nobody taps twice waiting for something to happen — the chat UI
    // popped a toast instead, which said the same thing and then vanished.
    { label: 'Explore', icon: <SparkleIcon size={16} />, count: 0, soon: true, go: () => {} },
    { label: 'Brands',  icon: <TagIcon size={16} />,     count: 0, soon: true, go: () => {} },
    { label: 'Bag', icon: <BagIcon size={16} />, count: cartCount, soon: false,
      go: () => { setBagOpen(true); setBagSeen(cartCount) } },
    { label: 'History', icon: <HistoryIcon size={16} />, count: 0, soon: false,
      go: () => setHistOpen(true) },
  ]

  /** The letter on the avatar, as the sidebar had it. */
  const initial = (session?.user?.name || session?.user?.email || '').trim().charAt(0).toUpperCase()

  /** Back to a blank page, as the chat UI's New chat did. */
  /** Back to the opening screen, keeping everything. Distinct from New chat,
   *  which deliberately throws the turn away. */
  const goHome = useCallback(() => {
    setProduct(null); setLookOpen(false); setView('home'); setSaid(null); setSaidRefs([]); setSaidPhotos([]); setPinned([])
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: 0 }))
  }, [])

  const newSearch = useCallback(() => {
    setTurns([]); setLook(null); setLookOpen(false); setProduct(null)
    setInput(''); setPhotos([]); setView('home'); setSaid(null); setSaidRefs([]); setSaidPhotos([]); setPinned([])
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: 0 }))
  }, [])

  const submit = () => run(input)

  /** Ask for the next page of one strip.
   *
   *  Everything already on screen is sent as excludeIds, so the endpoint does
   *  not hand back what the shopper is already looking at. A page that comes
   *  back empty is not a failure — it is the end of the catalogue for that
   *  query — and the button says so rather than staying hopeful. */
  const [moreBusy, setMoreBusy] = useState<number | null>(null)
  const [moreDone, setMoreDone] = useState<Set<string>>(new Set())

  const loadMore = useCallback(async (turnId: string, sectionIndex: number) => {
    if (!onLoadMore || moreBusy !== null) return
    const turn = turns.find(t => t.id === turnId)
    const section = turn?.sections[sectionIndex]
    if (!turn || !section) return
    const query = section.query || turn.question
    setMoreBusy(sectionIndex)
    try {
      const seen = turn.sections.flatMap(x => [...(x.hero ? [x.hero] : []), ...x.products]).map(p => p.id)
      const more = await onLoadMore(query, seen)
      if (!more.length) {
        setMoreDone(prev => new Set(prev).add(`${turnId}:${sectionIndex}`))
        return
      }
      setTurns(prev => prev.map(t => t.id !== turnId ? t : {
        ...t,
        sections: t.sections.map((x, i) => i !== sectionIndex ? x
          : { ...x, products: [...x.products, ...more.filter((m: V2Product) => !seen.includes(m.id))] }),
      }))
    } catch {
      setMoreDone(prev => new Set(prev).add(`${turnId}:${sectionIndex}`))
    } finally {
      setMoreBusy(null)
    }
  }, [onLoadMore, moreBusy, turns])

  const openProduct = (p: V2Product) => {
    setProduct(p); setAcc(null); setDetailsOpen(false)
    setColorMode(false); setSizeMode(false)
    setPickedColor(p.colors?.[0] ?? null); setPickedSize(null)
    setView('product')
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: 0 }))
  }

  /** Straight to the brand's checkout with this one piece, in the colour and
   *  size chosen on this page.
   *
   *  It goes through the bag rather than around it: the line has to exist for
   *  buildCartLinks to resolve a variant, and if the shopper comes back the
   *  piece is where they would look for it. What is skipped is the step where
   *  they are told to go and find the bag themselves. */
  const buyNow = () => {
    if (!product || adding) return
    setAdding(true)
    const line: V2CartLine = {
      product, color: pickedColor?.name ?? product.colorName,
      size: pickedSize ?? undefined, qty: 1,
    }
    setCart(c => {
      const rest = c.filter(l => l.product.id !== product.id)
      return [...rest, line]
    })
    setColorMode(false); setSizeMode(false)
    // One frame for the cart state to land, since checkout reads payLinks off
    // it. Kept as a paint-boundary rather than a guessed delay.
    requestAnimationFrame(() => {
      setAdding(false)
      checkoutLines([line])
    })
  }

  const setQty = (i: number, d: number) =>
    setCart(c => c.map((l, x) => x === i ? { ...l, qty: Math.max(1, l.qty + d) } : l))

  const heroIsVideo = /\.(mp4|webm|mov)$/i.test(heroMedia)

  /** The brand's full gallery for the open product, fetched on demand.
   *
   *  A search result carries one or two thumbnails at ?width=400 — enough for a
   *  tile, nowhere near a product page. The chat UI already pulled the real set
   *  from /api/product-images (every shot the store publishes, at 2048, plus
   *  the colour→images map); this screen never did, so tapping a piece showed a
   *  single upscaled thumbnail where the reference shows eight photographs.
   */
  const [gallery, setGallery] = useState<{
    images: string[]
    colors: string[]
    byColor: Record<string, string[]>
  } | null>(null)

  useEffect(() => {
    setGallery(null)
    const url = product?.storeUrl
    if (!url) return
    let cancelled = false
    // The id goes with the url: it is the UCP product id, and it is what lets
    // the gallery come from the protocol rather than from scraping the store's
    // own JSON.
    fetch(`/api/product-images?url=${encodeURIComponent(url)}`
      + (product?.id ? `&id=${encodeURIComponent(product.id)}` : ''))
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (cancelled || !d) return
        if (Array.isArray(d.images) && d.images.length > 0) {
          setGallery({
            images: d.images,
            colors: Array.isArray(d.colors) ? d.colors : [],
            byColor: d.byColor && typeof d.byColor === 'object' ? d.byColor : {},
          })
          // Then, separately, ask which of them have a person in them.
          // Stores publish in whatever order the merchandiser uploaded, which is
          // very often a flat packshot first — a cropped rectangle of fabric,
          // which is exactly the "zoomed cloth" that opens instead of the
          // garment. /api/image-order classifies and puts the on-body shots
          // first. It is a second request on purpose: the gallery is already on
          // screen by the time this lands, so a slow or failed classifier costs
          // a reorder, never the pictures.
          fetch('/api/image-order', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ urls: d.images.slice(0, 12) }),
          })
            .then(r => (r.ok ? r.json() : null))
            .then(o => {
              if (cancelled || !Array.isArray(o?.order) || o.order.length === 0) return
              const ordered = o.order.filter((u: unknown): u is string => typeof u === 'string')
              const rest = d.images.filter((u: string) => !ordered.includes(u))
              setGallery(g => (g ? { ...g, images: [...ordered, ...rest] } : g))
            })
            .catch(() => { /* publish order stands */ })
        }
      })
      .catch(() => { /* the thumbnails below still stand the page up */ })
    return () => { cancelled = true }
  }, [product?.id, product?.storeUrl])

  const pdpImages = useMemo(() => {
    if (!product) return []
    // A picked colour narrows the gallery to that colourway — the whole point
    // of byColor — and only falls back to the swatch's single image.
    const forColor = pickedColor?.name ? gallery?.byColor?.[pickedColor.name] : undefined
    if (forColor?.length) return forColor

    if (gallery?.images.length) {
      // No byColor map from this store — plenty publish variants without one.
      // Choosing a colour then changed nothing on screen, which makes the
      // picker look broken even though the variant really was selected. The
      // colourway's own shot leads instead, so the page always answers the tap.
      const lead = pickedColor?.image
      if (!lead) return gallery.images
      const rest = gallery.images.filter(u => u !== lead)
      return [lead, ...rest]
    }

    if (pickedColor?.image) return [pickedColor.image, ...(product.images ?? []).filter(u => u !== pickedColor.image)]
    return product.images?.length ? product.images : [product.image]
  }, [product, pickedColor, gallery])
  const soldOut = pickedColor ? pickedColor.available === false : false

  return (
    <div className="v2-root" ref={rootRef} style={{ ...barVar.style }}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className={`v2-head ${view === 'home' ? '' : 'solid'} ${headHidden ? 'up' : ''}`}>
        {/* The trigger stays put and morphs into the close control while the
            menu is open, exactly as the reference does — you shut the menu
            from the button you opened it with. */}
        {/* The chat UI's own pair, drawn the same way: two unequal bars in a
            white disc, and a pencil opposite. Two bars, not three, and the
            shorter one second — that asymmetry is the mark. No morph to an X
            any more, because the drawer covers this button and carries its own
            close. */}
        <button className="v2-ic v2-round v2-menu-btn" aria-label="Menu" aria-expanded={menuOpen}
          onClick={() => setMenuOpen(true)}>
          <span className="v2-bun" aria-hidden>
            <i /><i />
          </span>
        </button>
        {/* Recents, saved and the bag all used to sit up here as three more
            icons. They belong in the drawer with everything else you can go to,
            which leaves the header holding what a header should: one way in,
            and the name of the thing. */}
        <div className="v2-head-gap" />
        {/* The wordmark is the way home, as it is on every shop on the
            internet. It was inert, so the only route back from a product page
            was Back, and from a results page there was none at all. It goes to
            the opening screen without clearing the conversation — the recents
            and the bag are untouched, and New chat is still the thing that
            starts over. */}
        <button className="v2-brand" onClick={goHome} aria-label="Discern — home">
          <span>DISCERN</span>
          <i>BETA</i>
        </button>
        {/* Opposite the menu, as the chat UI had it: the way back to a blank
            page. Hidden on the home screen, which is already that page. */}
        <button className={`v2-ic v2-round v2-newbtn ${view === 'home' ? 'gone' : ''}`}
          aria-label="New chat" onClick={newSearch}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.88" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
        </button>
      </header>

      {/* The mini-bag used to sit here: thumbnails of the last two things
          bagged, floating over the top-right of the product page. It showed
          the wrong thing at the wrong moment — you open a piece to look at it
          and the corner shows two OTHER pieces — and the bag in the drawer
          already carries the count. Removed rather than fixed; there was no
          question it answered. */}

      {/* ── Scroller ───────────────────────────────────────────────────────── */}
      <div className="v2-scroll" ref={scrollRef} onScroll={onScroll} data-surface="light">

        {/* 1 · HERO */}
        {view === 'home' && (
          <>
            <section className="v2-hero" data-surface="dark">
              <div className="v2-hero-media">
                {heroIsVideo ? <HeroVideo src={heroMedia} poster={heroPoster} /> : <Img src={heroMedia} />}
                <div className="v2-veil" />
              </div>
              {/* The card trio that used to sit here is gone. Its art came from
                  the featured feed, so before that resolved — and whenever it
                  returned nothing — three blank plates covered the film and the
                  headline. The film is the opening image. */}
              <div className="v2-hero-copy">
                <h1>{V2_HERO_COPY[heroCopy % V2_HERO_COPY.length].head}</h1>
                <p>{V2_HERO_COPY[heroCopy % V2_HERO_COPY.length].sub}</p>
              </div>
            </section>

            {/* 1b · COLLECTION — the editorial screen between the hero and the
                prompt panel: title, season line, and one pill into the
                suggestions. */}
            <section className="v2-hero v2-hero2" data-surface="dark">
              {/* No src: /v2/hero-2.jpg has never existed, so this asked for it and got a
                  404 on every single page load. The panel is not empty without it —
                  .v2-hero-media .v2-img-ph is a designed dark gradient with a woven
                  texture, which is what has actually been on screen all along and
                  reads as deliberate. Drop a hero-2.jpg into public/v2 and put the
                  src back to use a photograph instead; nothing else needs touching. */}
              <div className="v2-hero-media"><Img /><div className="v2-veil" /></div>
              <div className="v2-hero-copy">
                <h1 className="v2-one"><span>Pages from Landscapes</span></h1>
                <p>Fall-Winter 2026 Collection</p>
                <button className="v2-inspire-cta"
                  onClick={() => scrollRef.current?.scrollBy({ top: window.innerHeight, behavior: 'smooth' })}>
                  Let yourself be inspired
                </button>
              </div>
            </section>

            {/* 1c · INSPIRE — the prompt panel proper */}
            <section className="v2-hero v2-hero3" data-surface="dark">
              <div className="v2-hero-media"><Img /><div className="v2-veil" /></div>
              <div className="v2-hero-copy">
                <h1><span>Start</span> <span>anywhere.</span></h1>
                <p>Pick one, or ask for something else.</p>
              </div>
              <ShopsFor />
              <div className="v2-sugs">
                {V2_SUGGESTIONS.map(s => (
                  <button key={s} className="v2-sug" onClick={() => { setInput(s); run(s) }}>{s}</button>
                ))}
              </div>
            </section>
          </>
        )}

        {/* 2 · RESULTS */}
        {view === 'results' && (
          <section className="v2-results" data-surface="light">
            {turns.slice(0, 1).map(turn => (
            <div className="v2-spread" key={turn.id}>
              {/* Nothing goes above the products. Not the answer, not a
                  headline, not the question. When Fabrics has found something,
                  the pieces are the answer and prose on top of them is just
                  noise between the shopper and what they came to see. When it
                  has only words — advice, a greeting — those surface briefly at
                  the composer and clear, so the scroll never stops being a
                  lookbook. The stylist still runs, still remembers, still
                  reasons; it simply does it without narrating. */}

              {/* "No match" is only honest when a search actually ran. It used
                  to fire for every conversational turn, so asking "does navy go
                  with olive" was answered by blaming the catalogue. */}
              {/* A side-by-side. The endpoint has always been able to build one
                  — "which of these two" returns rows of attributes and usually a
                  pick — and nothing here read the field, so a comparison came
                  back as prose with nothing to look at. */}
              {turn.comparison && turn.comparison.rows.length > 0 && (
                <div className="v2-cmp">
                  <div className="v2-cmp-grid" style={{
                    gridTemplateColumns: `auto repeat(${turn.comparison.rows[0].values.length}, minmax(0,1fr))`,
                  }}>
                    {turn.comparison.rows.map((row, ri) => (
                      <React.Fragment key={row.label + ri}>
                        <span className="v2-cmp-label">{row.label}</span>
                        {row.values.map((v, vi) => (
                          <span key={vi} className={`v2-cmp-cell ${turn.comparison?.pick?.index === vi ? 'won' : ''}`}>{v}</span>
                        ))}
                      </React.Fragment>
                    ))}
                  </div>
                  {turn.comparison.pick && <p className="v2-cmp-pick">{turn.comparison.pick.reason}</p>}
                </div>
              )}

              {turn.sections.length === 0 && turn.didSearch && !turn.failed && (
                <div className="v2-empty">
                  <h2>No match</h2>
                  <p>Nothing in the catalogue genuinely fits that. Change the colour, fabric or budget and I’ll look again.</p>
                </div>
              )}

              {/* The search broke. Blaming the catalogue here would be a lie —
                  it was never asked. The question is still on the page and one
                  tap sends it again, which is the whole reason this view exists
                  instead of a silent return to the home screen. */}
              {turn.failed && (
                <div className="v2-empty">
                  <h2>{turn.busy ? 'Busy right now' : 'That didn’t get through'}</h2>
                  <p>{turn.busy
                    ? 'A lot of people are asking at once. Give it a few seconds and ask again.'
                    : 'Nothing reached the catalogue, so there is nothing to show yet.'}</p>
                  <button className="v2-retry" onClick={() => run(turn.question)}>
                    Ask again
                  </button>
                </div>
              )}
            {turn.sections.map((s, si) => (
              <React.Fragment key={si}>
                <div className="v2-sec v2-rise">
                  <h2>{s.title}</h2>
                  {s.subtitle && <p>{s.subtitle}</p>}
                  {s.hero && (
                    <div className="v2-sec-hero">
                      <button className="v2-shot" onClick={() => openProduct(s.hero!)}><Img src={s.hero.image} alt={s.hero.title} /></button>
                      <BagBtn on={inBag(s.hero.id)} just={justBagged === s.hero.id} onClick={e => { e.stopPropagation(); bagIt(s.hero!) }} />
                    </div>
                  )}
                  {s.title && (
                    <button className="v2-discover" onClick={() => s.hero && openProduct(s.hero)}>
                      Discover all {s.title} <span aria-hidden>›</span>
                    </button>
                  )}
                  {/* The next page of the same search. The endpoint has always
                      supported this — it takes the query and the ids already
                      shown and returns what it has not sent yet — and nothing
                      here asked, so a results page was however much came back
                      and no deeper. */}
                  {(s.query || turn.didSearch) && onLoadMore && (
                    <button className="v2-more" disabled={moreBusy === si}
                      onClick={() => loadMore(turn.id, si)}>
                      {moreBusy === si ? 'Looking…'
                        : moreDone.has(`${turn.id}:${si}`) ? 'That is everything'
                        : 'See more'}
                    </button>
                  )}
                </div>

                {s.products.length > 0 && (
                  <>
                    {/* The grid follows the hero directly. There used to be a
                        "More options" line here — a heading nobody wrote,
                        naming nothing, in a layout whose whole argument is that
                        the clothes speak. Desktop still swaps to a horizontal
                        carousel at the breakpoint. */}
                    <div className="v2-mosaic">
                      {s.products.map((p, i) => (
                        <div key={p.id} className={`v2-tile ${i % 5 === 1 || i % 5 === 4 ? 'tall' : ''}`}>
                          <button className="v2-tile-btn" onClick={() => openProduct(p)}><Img src={p.image} alt={p.title} loading="lazy" /></button>
                          <BagBtn on={inBag(p.id)} just={justBagged === p.id} onClick={e => { e.stopPropagation(); bagIt(p) }} />
                          <span className="v2-tile-name">{captionOf(p)} <i aria-hidden>›</i></span>
                        </div>
                      ))}
                    </div>
                  </>
                )}

              </React.Fragment>
            ))}
            </div>
            ))}
          </section>
        )}

        {/* 2b · LOOK — "Discover the look" rail */}
        {view === 'look' && look && (
          <section className="v2-lookpage" data-surface="light">
            <div className="v2-rail" ref={lookRailRef}>
              {look.map(p => (
                <div key={p.id} className="v2-rail-item">
                  <button className="v2-shot" onClick={() => openProduct(p)}><Img src={p.image} alt={p.title} /></button>
                  <BagBtn on={inBag(p.id)} just={justBagged === p.id} onClick={e => { e.stopPropagation(); bagIt(p) }} />
                  <span className="v2-rail-name">{p.title} <i aria-hidden>›</i></span>
                </div>
              ))}
            </div>
            <div className="v2-rail-nav">
              <button onClick={() => lookRailRef.current?.scrollBy({ left: -260, behavior: 'smooth' })} aria-label="Previous">‹</button>
              <button onClick={() => lookRailRef.current?.scrollBy({ left: 260, behavior: 'smooth' })} aria-label="Next">›</button>
            </div>
          </section>
        )}

        {/* 3 · PRODUCT */}
        {view === 'product' && product && (
          <section className="v2-pdp" data-surface="light">
            {/* One column, top to bottom, on every screen. It used to become a
                horizontal filmstrip past 760px — a sideways scroll nobody
                expects on a product page, and the reason a laptop showed the
                pieces lying on their side. A wide screen gets a wider column
                and more air, not a different gesture. */}
            <div className="v2-pdp-col">
              {pdpImages.map((src, i) => (
                <Img key={src} className="v2-pdp-img" src={src}
                  alt={i === 0 ? product.title : ''}
                  // The first two carry the page; everything below the fold
                  // waits until it is scrolled to. Without this a twelve-shot
                  // gallery at 2048 fetches twelve full-size photographs before
                  // the first one paints.
                  loading={i < 2 ? 'eager' : 'lazy'}
                  {...(i === 0 ? { fetchPriority: 'high' as const } : {})}
                  decoding="async" />
              ))}
              {/* While the real gallery is still coming, hold its shape. The
                  thumbnail is up, so the page is readable; these stop it
                  jumping when eight more photographs land under it. */}
              {!gallery && (product.images?.length ?? 0) < 2 && (
                <>
                  <span className="v2-pdp-img v2-img-ph" aria-hidden />
                  <span className="v2-pdp-img v2-img-ph" aria-hidden />
                </>
              )}
            </div>

            {/* After the photographs the page itself carries a dashed-outline
                card with two independently collapsible rows — description and
                details. This is in the scroll, not a floating panel; the
                floating panels belong to the MATERIALS / HOW TO STYLE pills. */}
            <div className="v2-doc">
              <button className="v2-doc-row" onClick={() => setDescOpen(v => !v)} aria-expanded={descOpen}>
                Description <i aria-hidden>{descOpen ? '−' : '+'}</i>
              </button>
              {descOpen && (
                <div className="v2-doc-body">
                  <p>{product.description || 'No description supplied for this piece.'}</p>
                  {product.sku && <span className="v2-doc-sku">SKU: {product.sku}</span>}
                </div>
              )}
              <button className="v2-doc-row" onClick={() => setDetailsOpen(v => !v)} aria-expanded={detailsOpen}>
                Details <i aria-hidden>{detailsOpen ? '−' : '+'}</i>
              </button>
              {detailsOpen && (
                <ul className="v2-doc-list">
                  {detailLines.map((l, i) => <li key={i}>{l}</li>)}
                </ul>
              )}
            </div>

            {styleWith.length > 0 && (
              <div className="v2-other">
                <div className="v2-eyebrow-in">More like this</div>
                <div className="v2-rail">
                  {styleWith.map(p => (
                    <div key={p.id} className="v2-rail-item">
                      <button className="v2-shot" onClick={() => openProduct(p)}><Img src={p.image} alt={p.title} /></button>
                      <BagBtn on={inBag(p.id)} just={justBagged === p.id} onClick={e => { e.stopPropagation(); bagIt(p) }} />
                      <span className="v2-rail-name">{p.title} <i aria-hidden>›</i></span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}
      </div>

      {/* Back */}
      {(view === 'product' || view === 'look') && (
        <button className="v2-back" onClick={() => setView('results')}><span aria-hidden>‹</span> Back</button>
      )}
      {view === 'look' && <div className="v2-eyebrow">More like this</div>}

      {/* Product dock — the panel, the two pills and the buy tray are one
          column, so they cannot overlap each other whatever their heights
          turn out to be. */}
      {view === 'product' && product && (
        <div className="v2-dock" style={{ bottom: kb }}>
          {acc === 'materials' && (
            <div className="v2-panel">
              <div className="v2-panel-head">
                <span>MATERIALS</span>
                <button onClick={() => setAcc(null)} aria-label="Collapse">−</button>
              </div>
              {composition && <span className="v2-comp">{composition}</span>}
              {/* The cleaned lines, not the raw tag list — see detailLines.
                  When a store publishes no composition at all, say that;
                  the placeholder that used to sit here claimed a provenance
                  and a care instruction nobody here has verified. */}
              {detailLines.length > 0
                ? <ul className="v2-mat-list">{detailLines.map(d => <li key={d}>{d}</li>)}</ul>
                : <p>{product.description
                      ? product.description
                      : 'This brand does not publish a fabric composition for this piece.'}</p>}
            </div>
          )}
          {acc === 'style' && (
            <div className="v2-panel light">
              <div className="v2-panel-head">
                <span>HOW TO STYLE</span>
                <button onClick={() => setAcc(null)} aria-label="Collapse">−</button>
              </div>
              {/* A row per slot, each one a real answer to "what goes with
                  THIS" — searched across every brand and ranked against the
                  open piece's own colour and formality. Falls back to the
                  pieces already on the page while that is in flight, so the
                  panel is never empty. */}
              {/* One piece per slot, laid out as the look reads: the trouser,
                  the shoe, the layer. Not a row of ten each — that is a search
                  result, and the shopper already had one of those. */}
              {styleRows && styleRows.length > 0 ? (
                <div className="v2-look">
                  {styleRows.map(row => row.products[0] ? (
                    <button key={row.title} className="v2-look-piece" onClick={() => openProduct(row.products[0])}>
                      <Img src={row.products[0].image} alt={row.products[0].title} loading="lazy" />
                      <span className="v2-look-slot">{row.title}</span>
                      <span className="v2-look-name">{row.products[0].title}</span>
                    </button>
                  ) : null)}
                </div>
              ) : styleBusy || styleWith.length > 0 ? (
                <>
                  {styleBusy && <p className="v2-style-wait">Looking for what goes with it…</p>}
                  <div className="v2-style-grid">
                    {styleWith.map(p => (
                      <button key={p.id} className="v2-style-cell" onClick={() => openProduct(p)}>
                        <Img src={p.image} alt={p.title} />
                        <i aria-hidden>+</i>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                /* No invented styling advice about a garment this app has
                   not seen. Either there are real pieces to pair it with or
                   there is a way to go and find some. */
                <p>{product.howToStyle
                  || 'Nothing in this search to pair it with yet — ask what to wear it with and I’ll pull the pieces.'}</p>
              )}
            </div>
          )}
          <div className="v2-acc">
            {(['materials', 'style'] as const).map(k => (
              <button key={k} className={`v2-acc-pill ${acc === k ? 'on' : ''}`} onClick={() => setAcc(acc === k ? null : k)}>
                {k === 'materials' ? 'MATERIALS' : 'HOW TO STYLE'}<i aria-hidden>{acc === k ? '−' : '+'}</i>
              </button>
            ))}
          </div>
      <div className={`v2-cart ${colorMode || sizeMode ? 'tall' : ''}`}>
        {sizeMode && (
          <div className="v2-picker">
            <span className="v2-picker-t">Select your size</span>
            <div className="v2-sizes">
              {(product.sizes ?? ['44', '46', '48', '50', '52', '54']).map(s => (
                <button key={s} className={pickedSize === s ? 'on' : ''} onClick={() => { setPickedSize(s); setSizeMode(false) }}>{s}</button>
              ))}
            </div>
          </div>
        )}
        {colorMode && (
          <div className="v2-picker">
            <span className="v2-picker-t">{pickedColor?.name ?? 'Choose a colour'}</span>
            <div className="v2-swatches">
            {(product.colors ?? []).map(c => (
              <button key={c.name} title={c.name} aria-label={c.name}
                aria-pressed={pickedColor?.name === c.name}
                className={pickedColor?.name === c.name ? 'on' : ''}
                onClick={() => { setPickedColor(c); setColorMode(false) }}>
                <Img src={c.image} alt="" />
              </button>
            ))}
            </div>
          </div>
        )}
        {!colorMode && !sizeMode && (
          <>
            <Img className="v2-cart-thumb" src={product.image} />
            <div className="v2-cart-meta">
              <span className="v2-cart-name">{product.title}</span>
              <span className="v2-cart-price">
                {money(product.price, product.currency)}
                {product.compareAt ? <em>{money(product.compareAt, product.currency)}</em> : null}
              </span>
              <span className="v2-cart-color">
                {(pickedColor?.name ?? product.colorName) ?? ''}
                {pickedColor?.code ? ` (${pickedColor.code})` : ''}
                {product.colors?.length ? ` | ${product.colors.length} colors` : ''}
                {pickedSize ? ` | Size ${pickedSize}` : ''}
              </span>
            </div>
            <BagBtn on={inBag(product.id)} just={justBagged === product.id} onClick={() => bagIt(product)} />
          </>
        )}
        <div className="v2-cart-cta">
          {/* Checkout, not "add to cart". Someone who opened a piece, chose a
              colour and a size has decided; making them add it, find the bag
              and press a second button is a step invented by supermarkets.
              Bagging is still there — it is the control beside the price, for
              when they want to keep looking. */}
          <button className={`v2-buy ${soldOut ? 'off' : ''}`} onClick={buyNow} disabled={adding || soldOut}>
            {soldOut ? 'Unavailable' : adding ? <i className="v2-spin" /> : 'Checkout'}
          </button>
          {(product.colors?.length ?? 0) > 1 ? (
            <button className="v2-pill" onClick={() => { setColorMode(v => !v); setSizeMode(false) }}>
              {pickedColor?.name ?? product.colorName ?? 'Colour'}
            </button>
          ) : null}
          <button className="v2-pill" onClick={() => { setSizeMode(v => !v); setColorMode(false) }}>
            {pickedSize ? `Size ${pickedSize}` : 'Select size'}
          </button>
          <button className="v2-x" aria-label="Close" onClick={() => setView('results')}>
            <CloseIcon size={13} />
          </button>
        </div>
      </div>
        </div>
      )}

      {/* Look tray */}
      {lookOpen && look && look.length > 0 && view === 'results' && (
        <div className="v2-tray" style={{ bottom: `calc(var(--bar) + ${kb}px)` }}>
          {!focused && <div className="v2-tray-row">
            {look.slice(0, 4).map(p => (
              <button key={p.id} className="v2-chip" onClick={() => openProduct(p)}><Img src={p.image} alt={p.title} /></button>
            ))}
            <BagBtn on={look.every(p => inBag(p.id))} ghost onClick={() => look.forEach(p => bagIt(p))} />
          </div>}
          <div className="v2-tray-cta">
            <button className="v2-pill" onClick={() => { setView('look'); scrollRef.current?.scrollTo({ top: 0 }) }}>Discover the look</button>
            <button className="v2-pill" onClick={() => run('Other suggestions like these')}>Other suggestions</button>
            {!focused && (
              <button className="v2-x" aria-label="Dismiss" onClick={() => setLookOpen(false)}>
                <CloseIcon size={13} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Scroll hint. Never while a search is running: the loading screen is the
          only thing that should be asking for attention, and inviting a scroll
          into a page that is about to be replaced is a dead offer. */}
      {(view === 'home' || view === 'look') && showScroll && !focused && !loading && (
        <button className="v2-hint" style={{ bottom: `calc(var(--bar) + ${kb}px)` }}
          onClick={() => scrollRef.current?.scrollBy({ top: window.innerHeight * .82, behavior: 'smooth' })}>
          <ChevronIcon size={13} />
          Scroll to explore
        </button>
      )}

      {/* Waiting shows the shape of what is coming rather than a word in the
          middle of an empty screen. The skeleton is the results page with its
          pictures not yet in — heading, lead image, then the grid — so the page
          does not jump when the real thing replaces it.

          The status sits low and left, just above the composer: it is a
          progress report, not the subject of the screen, and centring it made
          it the thing you looked at. */}
      {loading && (
        <div className="v2-skel" aria-hidden>
          <div className="v2-skel-head" />
          <div className="v2-skel-hero" />
          <div className="v2-skel-grid">
            {[0, 1, 2, 3].map(i => (
              <div className="v2-skel-cell" key={i} style={{ animationDelay: `${i * 90}ms` }}>
                <div className="v2-skel-img" />
                <div className="v2-skel-line" />
              </div>
            ))}
          </div>
        </div>
      )}
      {/* Sits just clear of the bar rather than floating above it: the status
          belongs to the question still sitting in the composer, and 22px of air
          read as two unrelated things. --bar is the bar's top edge, so the
          number below is the whole gap. */}
      {loading && (
        <div className="v2-crafting" style={{ bottom: `calc(var(--bar) - var(--bar-air) + 8px + ${kb}px)` }}
          role="status" aria-live="polite">
          {/* Icon and words are one step and swap together, keyed on the text.
              Without the key React keeps one node and mutates its textContent,
              so neither the crossfade nor the shimmer ever restarts. */}
          <StepIcon name={livePhase?.icon} />
          <span key={livePhase?.text ?? loadPhase} className="v2-crafting-line">
            {livePhase?.text ?? V2_LOADING[loadPhase][0] + V2_LOADING[loadPhase][1]}
          </span>
        </div>
      )}

      {/* Menu */}
      <div className={`v2-ov ${menuOpen ? 'on' : ''}`} onClick={() => setMenuOpen(false)} />
      <nav className={`v2-menu ${menuOpen ? 'on' : ''}`} aria-hidden={!menuOpen}>
        {/* The chat UI's sidebar, item for item, on this app's surface: the
            brand and an avatar that opens the account, a primary action, the
            fixed destinations, then everything you have asked, then sign-out at
            the base. */}
        <div className="v2-menu-top">
          {/* The mark lives here and nowhere else. Beside the wordmark it was
              competing with it at a size too small to read as anything; on its
              own, against the drawer's dark glass, it has room to be a mark. */}
          <img className="v2-menu-logo" src="/favicon.png" alt="Discern" width={34} height={34} />
          <button className={`v2-avatar ${menuView === 'profile' ? 'on' : ''}`} aria-label="Account"
            aria-pressed={menuView === 'profile'} tabIndex={menuOpen ? 0 : -1}
            onClick={() => setMenuView(v => v === 'profile' ? 'nav' : 'profile')}>
            {initial ? <span>{initial}</span> : <UserIcon size={15} />}
          </button>
        </div>

        {menuView === 'profile' ? (
          /* The account, as the chat UI's sidebar showed it: a large avatar, the
             name, the email beneath, and the way out. Signed out it says what an
             account is for and offers one — voluntarily. Nothing here blocks;
             the only thing that stops and asks is checkout. */
          <div className="v2-profile">
            <div className="v2-profile-face">
              {session?.user?.image
                ? <img src={session.user.image} alt="" />
                : initial ? <span>{initial}</span> : <UserIcon size={30} />}
            </div>
            <div className="v2-profile-name">
              {session?.user?.name || (authStatus === 'authenticated' ? 'Your account' : 'Not signed in')}
            </div>
            {session?.user?.email && <div className="v2-profile-mail">{session.user.email}</div>}

            {authStatus === 'authenticated' ? (
              <>
                {/* The four facts the stylist actually uses. Nothing here could
                    set them before, so every v2 shopper searched as a stranger
                    while the request quietly carried empty fields. */}
                <V2Profile country={buyerCountry} />
                <button className="v2-profile-act" tabIndex={menuOpen ? 0 : -1}
                  onClick={() => { setMenuOpen(false); setMenuView('nav'); signOut() }}>
                  <ExternalLinkIcon size={15} />
                  Sign out
                </button>
              </>
            ) : (
              <>
                {/* Sizes live on the account (Convex); saved pieces live on this
                    device. Saying both follow you would be the same untrue
                    promise the checkout sheet used to make. */}
                <p className="v2-profile-why">
                  An account remembers your sizes, so you are not asked for them again.
                  You only need one to check out.
                </p>
                <button className="v2-profile-act primary" tabIndex={menuOpen ? 0 : -1}
                  onClick={() => { setMenuOpen(false); setMenuView('nav'); requireAccount('account') }}>
                  Sign in
                </button>
              </>
            )}
          </div>
        ) : (
          <>
        <button className="v2-newchat" tabIndex={menuOpen ? 0 : -1}
          onClick={() => { setMenuOpen(false); newSearch() }}>
          <PlusIcon size={13} />
          New chat
        </button>

        <ul className="v2-menu-nav">
          {MENU.map(m => (
            <li key={m.label}>
              <button className={m.soon ? 'soon' : ''} tabIndex={menuOpen ? 0 : -1}
                aria-disabled={m.soon || undefined}
                onClick={() => { if (m.soon) return; setMenuOpen(false); m.go() }}>
                {m.icon}
                {m.label}
                {m.soon ? <em className="soon">Soon</em>
                  : m.count ? <em className={m.label === 'Bag' && m.count > bagSeen ? 'count bump' : 'count'}>{m.count}</em>
                  : null}
              </button>
            </li>
          ))}
        </ul>

        {/* Everything asked this session, as the sidebar's recents were. */}
        <div className="v2-menu-recent">
          <span className="v2-eyebrow-s">Recent</span>
          {asked.length === 0 ? (
            <p className="v2-menu-empty">Nothing asked yet.</p>
          ) : (
            <ul>{asked.slice(0, 12).map(q => (
              <li key={q} className="v2-recent-row">
                {renaming === q ? (
                  <input
                    className="v2-recent-input"
                    defaultValue={q}
                    autoFocus
                    aria-label="Rename"
                    onKeyDown={e => {
                      if (e.key === 'Enter') renameAsked(q, (e.target as HTMLInputElement).value)
                      if (e.key === 'Escape') setRenaming(null)
                    }}
                    onBlur={e => renameAsked(q, e.target.value)}
                  />
                ) : (
                  <>
                    <button className="v2-recent-go" tabIndex={menuOpen ? 0 : -1}
                      onClick={() => { setMenuOpen(false); run(q) }}>{q}</button>
                    <span className="v2-recent-acts">
                      <button aria-label={`Rename ${q}`} tabIndex={menuOpen ? 0 : -1}
                        onClick={() => setRenaming(q)}><EditIcon size={13} /></button>
                      <button aria-label={`Delete ${q}`} tabIndex={menuOpen ? 0 : -1}
                        onClick={() => setAsked(a => a.filter(x => x !== q))}><TrashIcon size={13} /></button>
                    </span>
                  </>
                )}
              </li>
            ))}</ul>
          )}
        </div>
          </>
        )}

        {/* Feedback sits at the foot rather than among the destinations: it is
            not a place in the app, it is the way out of a problem, and the foot
            of the drawer is where you look once nothing else has helped.
            Sign-out used to be here and now lives in the account view alone —
            two ways out of an account is one more than anyone needs, and this is
            the more useful thing to have within reach. */}
        {menuView === 'nav' && (
          <div className="v2-menu-meta">
            <button className="v2-feedback-btn" tabIndex={menuOpen ? 0 : -1}
              onClick={() => { setMenuOpen(false); setFeedbackOpen(true) }}>
              <DocumentIcon size={14} />
              Feedback
            </button>
          </div>
        )}
      </nav>

      {/* Saved — the hearts finally have somewhere to lead. Same sheet family as
          the bag, because both are "things you have set aside". */}
      {histOpen && (
        <>
        <div className="v2-ov on" onClick={() => setHistOpen(false)} />
        <nav className="v2-hist" aria-label="Recent questions">
          <span className="v2-eyebrow-s">This session</span>
          {asked.length === 0 ? (
            <p className="v2-hist-empty">Nothing asked yet.</p>
          ) : (
            <ul>{asked.map(q => (
              <li key={q}>
                <button onClick={() => { setHistOpen(false); run(q) }}>{q}</button>
              </li>
            ))}</ul>
          )}
        </nav>
        </>
      )}

      <V2Feedback open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />

      <V2Auth
        open={authReason !== null}
        reason={authReason}
        onClose={() => setAuthReason(null)}
      />

      {/* Bag sheet */}
      {bagOpen && (
        <>
        <div className="v2-bag-ov" onClick={() => setBagOpen(false)} />
        <div className="v2-bag">
          <button className="v2-bag-x" aria-label="Close" onClick={() => setBagOpen(false)}>
            <CloseIcon size={15} />
          </button>
          <h2>Bag <em>({cartCount})</em></h2>
          <div className="v2-bag-list">
            {cart.length === 0 && <p className="v2-bag-empty">Nothing here yet.</p>}
            {cart.map((l, i) => {
              const key = lineKey(l)
              const on = hostOfLine(l) === activeHost && !dropped.has(key)
              return (
              // Which pieces this checkout is for. The piece itself is the
              // control — you press the thing you mean and it draws a border
              // around itself. A tick box beside it was a second object
              // explaining the first, in a list that is already made of the
              // things being chosen.
              //
              // Not a <button>: it contains the quantity steppers and Remove,
              // and a button inside a button is invalid and unpredictable. A
              // checkbox role carries the same meaning to a screen reader and
              // lets the inner controls stay real buttons.
              <div className={`v2-line ${on ? 'on' : 'off'}`} key={key}
                role="checkbox" aria-checked={on} tabIndex={0}
                aria-label={`${l.product.title} — ${on ? 'in this checkout' : 'not in this checkout'}`}
                onClick={() => togglePick(l)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePick(l) }
                }}>
                <Img src={l.product.image} />
                <div>
                  <span className="v2-line-name">{l.product.title}</span>
                  {/* What this line costs, not what one of it costs. The
                      subtotal has always multiplied by the quantity; the line
                      above it did not, so three pairs of the same sneaker read
                      ₹4,299.00 and the two numbers disagreed on the same
                      screen. The unit price stays visible beside it, because
                      once a line is multiplied you have to be able to see what
                      it was multiplied from. */}
                  <span className="v2-line-price">
                    {money((l.product.price ?? 0) * l.qty, l.product.currency)}
                    {l.qty > 1 && <em>{l.qty} × {money(l.product.price, l.product.currency)}</em>}
                  </span>
                  {l.color && <span className="v2-line-meta">Color: {l.color}</span>}
                  {l.size && <span className="v2-line-meta">Size: {l.size}</span>}
                  <span className="v2-line-meta">{l.product.vendor || hostOfLine(l)}</span>
                  {l.product.sku && <span className="v2-line-sku">SKU: {l.product.sku}</span>}
                  <div className="v2-qty">
                    Quantity:
                    <button onClick={e => { e.stopPropagation(); setQty(i, -1) }} aria-label="Decrease">−</button>
                    <b>{l.qty}</b>
                    <button onClick={e => { e.stopPropagation(); setQty(i, 1) }} aria-label="Increase">+</button>
                    <button className="v2-remove"
                      onClick={e => { e.stopPropagation(); setCart(c => c.filter((_, x) => x !== i)) }}>Remove</button>
                  </div>
                </div>
              </div>
            )})}
          </div>
          <div className="v2-bag-sum">
            <div><span>Shipping Costs</span><span>FREE</span></div>
            {converted !== null ? (
              <>
                <div><span>Subtotal (tax incl.)</span><span>{money(converted, target)}</span></div>
                <div className="v2-bag-fx">
                  <span>{totals.map(t => money(t.amount, t.currency)).join('  +  ')}</span>
                  <span>at today’s rate</span>
                </div>
              </>
            ) : totals.length === 0 ? (
              <div><span>Subtotal (tax incl.)</span><span>{money(0, target)}</span></div>
            ) : (
              // One row per currency. Adding rupees to dollars and printing one
              // number is not a subtotal, it is a fiction.
              totals.map(t => (
                <div key={t.currency}>
                  <span>Subtotal (tax incl.){totals.length > 1 ? ` · ${t.currency}` : ''}</span>
                  <span>{money(t.amount, t.currency)}</span>
                </div>
              ))
            )}
          </div>
          <button className="v2-pay" onClick={() => checkoutLines(picked)} disabled={!picked.length}>
            Checkout <span aria-hidden>↗</span>
          </button>
          <p className="v2-bag-note">
            {/* One sentence, always the same one. What used to be here counted
                brands and warned about separate checkouts — an explanation of
                the interface's own problem, printed where a shopper is trying
                to buy something. The problem is gone; so is the sentence. */}
            {blockedStores.length
              ? 'Your browser blocked the new tab. Open the brand directly:'
              : 'Checkout happens on the brand’s own store.'}
          </p>
          {blockedStores.length > 0 && (
            <div className="v2-bag-fallback">
              {blockedStores.map(u => (
                <a key={u} href={u} target="_blank" rel="noopener noreferrer">{host(u)}</a>
              ))}
            </div>
          )}
        </div>
        </>
      )}

      {/* ── AI bar ─────────────────────────────────────────────────────────── */}
      {view !== 'product' && (
        <div className={`v2-bar-wrap ${view === 'home' ? 'home' : ''}`} ref={barVar.ref} style={{ bottom: kb }}>
          <div className="v2-bar-press">
            {/* Two rows, the field on its own line above the controls — the
                shape the chat composer had. Anywhere in the bar that isn't a
                control focuses the field: at this size most of its area is
                margin, and margin that looks like a text field should behave
                like one. */}
            <div className={`v2-bar ${focused ? 'focus' : ''} ${onDark ? '' : 'inverted'}`}
              onMouseDown={e => {
                if (e.target !== e.currentTarget &&
                    !(e.target as HTMLElement).classList?.contains('v2-bar-top')) return
                e.preventDefault()
                taRef.current?.focus()
              }}>
              {photos.length > 0 && (
                <div className="v2-shots" aria-label="Attached photos">
                  {photos.map(u => (
                    <span className="v2-shot-chip" key={u}>
                      <img src={u} alt="" />
                      <button aria-label="Remove photo" onClick={() => dropPhoto(u)}>
                        <CloseIcon size={9} color="#fff" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              {/* What Fabrics said when it had nothing to show for it.
                  This was a second slab floating above the composer, so a reply
                  arrived as a new bar stacked on the bar — two things where the
                  shopper is used to one. It belongs inside: the composer is
                  already the place you talk to it, so an answer appears in the
                  same pane the question was typed into and clears with the next
                  one. */}
              {said && !loading && (
                <div className="v2-bar-said" role="status" aria-live="polite">
                  <SaidBody text={said} refs={saidRefs} photos={saidPhotos} onOpen={openProduct} />
                  <button className="v2-bar-said-x" aria-label="Dismiss" onClick={() => { setSaid(null); setSaidRefs([]); setSaidPhotos([]) }}>
                    <CloseIcon size={12} />
                  </button>
                </div>
              )}
              <div className="v2-bar-top">
                <div className="v2-field">
                  <textarea ref={taRef} rows={1} value={input} onChange={e => setInput(e.target.value)}
                    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }}
                    aria-label="Ask the boutique" />
                  {input.length === 0 && (
                    // The drifting prompts are for an empty screen with nothing
                    // said yet. Running them underneath a reply puts two lines
                    // of unrelated text in one pane, and the marquee's half-cut
                    // words read as a layout fault rather than as motion.
                    idle && !said
                      ? <div className="v2-marquee" aria-hidden><div>{[...V2_PROMPTS, ...V2_PROMPTS].map((p, i) => <span key={i}>{p}</span>)}</div></div>
                      : <span className="v2-ph">Ask anything…</span>
                  )}
                </div>
              </div>
              <div className="v2-bar-btm">
                {/* Was a button with no handler at all — it offered to take a photo
                    and did nothing. A label over a hidden input keeps the same
                    glyph and hit area while actually opening the picker. */}
                <label className="v2-plus" aria-label="Add a photo">
                  <PlusIcon size={15} />
                  <input type="file" accept="image/*" multiple hidden
                    onChange={e => addPhotos(e.target.files)} />
                </label>
                <div className="v2-bar-right">
                  {/* Busy is its own state, not the send state with a spinner
                      dropped into it. It used to keep the filled treatment while
                      a search ran and draw a white progress bar on white — a
                      blank disc. It is now an outline with a stop mark, drawn in
                      whatever colour the bar is currently using, so it stays
                      legible on the film and on paper alike. */}
                  <button className={`v2-send ${loading ? 'busy' : canSend ? 'on' : ''}`}
                    aria-label={loading ? 'Searching' : 'Send'} onClick={submit} disabled={loading}>
                    {loading
                      ? <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
                          <rect width="10" height="10" rx="2" fill="currentColor" />
                        </svg>
                      : <ArrowUpIcon size={15} />}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        /* --bar is the composer wrapper measured from the bottom, and the
           wrapper carries --bar-air of padding above the bar itself. Anything
           anchored to --bar is therefore that much higher than it looks, which
           is why the two are named: a gap can be stated against the bar's real
           top edge instead of guessed at. */
        /* 129 is the composer's real resting height on a results page, and
            151 on the home screen where it carries extra bottom padding. The
            default was 96, so on every cold load the status pill, the scroll
            hint and the look tray were anchored 55px too low — over the field
            itself — and then jumped up the moment the measurement landed.
            Starting at the true value makes that jump imperceptible; the
            measurement still corrects it for a taller composer. */
        :root{--bar:129px;--bar-air:14px;}
        /* ── The column ──────────────────────────────────────────────────────
           The composer is the one element on screen at every moment, so it
           defines where the middle is. Everything that floats — the status
           pill, a spoken answer, the look tray — is positioned against these
           rather than against the window, because "18px from the left edge" is
           the phone's answer and on a laptop it puts the pill a third of a
           screen away from the bar it belongs to.

           --gut is the wrapper's own padding; --col-w is exactly what .v2-bar
           resolves to (min(820px, the space inside the gutters)); --col-l is
           that column's left edge. On a phone --col-l collapses to --gut, which
           is the behaviour these rules already had. */
        .v2-root{
          --gut:clamp(12px,3.6vw,18px);
          --col-w:min(820px,calc(100% - 2 * var(--gut)));
          --col-l:max(var(--gut),calc((100% - var(--col-w)) / 2));
        }
        .v2-root{position:fixed;inset:0;background:${V2.bone};color:${V2.ink};font-family:${V2.sans};overflow:hidden;}

        /* Above the menu scrim (70): the trigger doubles as the close control,
           so it has to stay reachable while the menu is open. */
        .v2-head{position:absolute;top:0;left:0;right:0;z-index:72;display:flex;align-items:center;gap:2px;min-height:58px;
          padding:calc(env(safe-area-inset-top,0px) + 12px) 12px 12px;color:#fff;
          background:linear-gradient(to bottom,rgba(0,0,0,.36),rgba(0,0,0,0));
          transition:color .45s ${V2.ease},background .45s ${V2.ease},transform .42s ${V2.ease},opacity .3s ${V2.ease};}
        .v2-head.up{transform:translateY(-102%);opacity:0;pointer-events:none;}
        .v2-head.solid{color:${V2.ink};background:linear-gradient(to bottom,${V2.bone} 60%,rgba(242,239,234,0));}
        /* A white disc with the chat UI's shadow, on both surfaces: over the
           film it is what makes the controls readable at all, and on paper it is
           the same button it always was. */
        .v2-ic.v2-round{width:36px;height:36px;border-radius:50%;background:#fff;color:${V2.ink};
          box-shadow:0 2px 8px rgba(0,0,0,.10),inset 0 1px 0 rgba(255,255,255,.95);
          transition:box-shadow .15s,transform .1s,opacity .25s ${V2.ease};}
        .v2-ic.v2-round:hover{box-shadow:0 4px 14px rgba(0,0,0,.14),inset 0 1px 0 #fff;transform:translateY(-.5px);}
        .v2-ic.v2-round:active{transform:scale(.93);}
        /* Two bars, 16 and 12, 1.5 tall, left-aligned — the chat UI's geometry. */
        .v2-bun{display:flex;flex-direction:column;align-items:flex-start;gap:4.5px;}
        .v2-bun i{display:block;height:1.5px;border-radius:1px;background:currentColor;}
        .v2-bun i:first-child{width:16px;}
        .v2-bun i:last-child{width:12px;}
        .v2-ic{width:34px;height:34px;display:flex;align-items:center;justify-content:center;background:none;
          border:none;color:inherit;cursor:pointer;position:relative;-webkit-tap-highlight-color:transparent;}
        /* The circle stays 34px because that is the drawing; the touch target
           does not. This pseudo-element pads the hit area out to the 44px
           minimum without moving a pixel of what is on screen. */
        .v2-ic::before{content:'';position:absolute;left:50%;top:50%;width:44px;height:44px;
          transform:translate(-50%,-50%);}
        /* Same trick, everywhere else it was owed. Each of these draws smaller
           than 44px on purpose; only the hit area grows, so nothing on screen
           moves. Square targets get a centred 44x44 box, wide-but-short ones
           only need the height stretched. .v2-hint is already absolutely
           positioned, so it establishes the containing block itself and must
           not be reset to relative. */
        .v2-send,.v2-inspire-cta,.v2-sug{position:relative;}
        .v2-send::before{content:'';position:absolute;left:50%;top:50%;
          width:44px;height:44px;transform:translate(-50%,-50%);}
        .v2-inspire-cta::before,.v2-hint::before,.v2-sug::before{content:'';position:absolute;
           left:0;right:0;top:50%;height:44px;transform:translateY(-50%);}
        .v2-ic:active{transform:scale(.9);}
        /* One row, one baseline: mark, wordmark, stage. Stacking the mark above
           the words made the lockup taller than the menu button beside it, so
           the mark floated over the icons' centre line and the whole thing read
           as misaligned. Centred on the window rather than on the space the
           icons leave, which is the only way it holds when the menu button
           grows a label on a wide screen. */
        /* pointer-events was none while this was decorative; it is the way
           home now, so it has to be reachable — and it needs a real target,
           because the wordmark itself is 13px of tracked-out caps. */
        .v2-brand{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
          border:none;background:none;padding:0;cursor:pointer;color:inherit;
          display:flex;align-items:center;}
        .v2-brand::before{content:'';position:absolute;left:50%;top:50%;
          width:calc(100% + 24px);height:44px;transform:translate(-50%,-50%);}
        .v2-head-gap{flex:1;}
        .v2-newbtn{transition:opacity .25s ${V2.ease},transform .25s ${V2.ease};}
        .v2-newbtn.gone{opacity:0;pointer-events:none;transform:scale(.85);}
        .v2-brand span{font-family:${V2.display};font-size:13px;font-weight:500;letter-spacing:.34em;
          text-indent:.34em;white-space:nowrap;line-height:1;}
        /* The rule needs air on both sides. The wordmark's trailing letter-space
           is not enough on its own — without a margin the divider sits against
           the N and reads as another letter. */
        .v2-brand i{font-style:normal;font-size:8px;letter-spacing:.18em;text-indent:.18em;opacity:.55;
          line-height:1;margin-left:11px;padding-left:11px;border-left:1px solid currentColor;align-self:center;}
        .v2-dot{position:absolute;top:6px;right:5px;width:5px;height:5px;border-radius:50%;background:currentColor;}

        /* ── A spread: one exchange, answer then evidence ─────────────────── */
        .v2-spread{margin:0 0 8vh;}
        .v2-spread:last-child{margin-bottom:4vh;}
        /* The answer sticks while its own products scroll past, so the question
           being answered is never off-screen and out of mind. */


        /* Saved grid — two up, image-led, the name and price quiet beneath. */
        /* History — same panel language as the menu, anchored under its button. */
        .v2-hist{position:absolute;z-index:80;left:12px;right:12px;
          top:calc(env(safe-area-inset-top,0px) + 52px);max-width:340px;
          background:${V2.glassDark};backdrop-filter:blur(22px);-webkit-backdrop-filter:blur(22px);
          border:1px solid ${V2.glassEdge};border-radius:24px;padding:18px 18px 14px;
          color:#fff;animation:v2-pop .34s ${V2.ease};max-height:66vh;overflow-y:auto;}
        .v2-hist ul{list-style:none;margin:8px 0 0;padding:0;display:flex;flex-direction:column;gap:2px;}
        .v2-hist li button{width:100%;text-align:left;background:none;border:none;cursor:pointer;
          color:#fff;font-family:${V2.sans};font-size:14px;line-height:1.4;padding:9px 8px;
          border-radius:12px;transition:background .18s ${V2.ease};}
        .v2-hist li button:hover{background:rgba(255,255,255,.1);}
        .v2-hist-empty{font-size:13px;color:rgba(255,255,255,.55);margin:10px 0 4px;}


        .v2-scroll{position:absolute;inset:0;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;
          scrollbar-width:none;overscroll-behavior-y:contain;scroll-behavior:smooth;}
        .v2-scroll::-webkit-scrollbar{display:none;}

        /* Reveal-on-enter. One curve, one distance — used by every section so
           the whole page feels like a single piece of choreography. */
        .v2-rise{opacity:0;transform:translateY(22px);
          transition:opacity .7s ${V2.ease},transform .7s ${V2.ease};}
        .v2-rise.in{opacity:1;transform:none;}
        .v2-intro{font-family:${V2.display};font-weight:600;font-size:clamp(27px,7.6vw,38px);line-height:1.1;letter-spacing:-.03em;
          text-align:center;margin:0;padding:clamp(74px,20vw,120px) 24px 0;}
        .v2-scroll::-webkit-scrollbar{display:none;}

        /* Hero */
        /* The copy sits low, not centred. Centred, it landed across the middle of
           the frame — over the face, where a portrait carries most of its
           detail, and where the veil is at its lightest (10% at the 30% mark).
           Low, it has the darkest part of the gradient behind it and the film
           has its subject back. It is also where the reference sets its own
           opening line. */
        .v2-hero{position:relative;min-height:100svh;display:flex;flex-direction:column;justify-content:flex-end;
          padding-bottom:calc(var(--bar) + 96px);padding-top:calc(env(safe-area-inset-top,0px) + 74px);}
        .v2-hero-media{position:absolute;inset:0;overflow:hidden;}
        .v2-hero-media img,.v2-hero-media video{width:100%;height:100%;object-fit:cover;display:block;}
        /* iOS draws a start-playback button over any video it has refused to
           autoplay — and the commonest reason is Low Power Mode, nothing we
           did. Android draws its own controls. Neither belongs on a backdrop:
           this is scenery, not a player, and a play button over it reads as
           something broken. */
        .v2-hero-media video::-webkit-media-controls,
        .v2-hero-media video::-webkit-media-controls-start-playback-button,
        .v2-hero-media video::-webkit-media-controls-play-button,
        .v2-hero-media video::-webkit-media-controls-panel,
        .v2-hero-media video::-webkit-media-controls-overlay-play-button{
          display:none !important;-webkit-appearance:none;appearance:none;opacity:0;}
        /* Weighted to the foot of the frame, under the copy. */
        .v2-veil{position:absolute;inset:0;background:linear-gradient(to bottom,rgba(20,17,14,.40) 0%,rgba(20,17,14,.06) 26%,rgba(20,17,14,.30) 55%,rgba(20,17,14,.68) 82%,rgba(20,17,14,.80) 100%);}
        .v2-hero-copy{position:relative;z-index:2;text-align:center;color:#fff;padding:0 22px;max-width:640px;margin:0 auto;}
        .v2-hero-copy h1{font-family:${V2.display};font-weight:600;font-size:clamp(34px,9.4vw,50px);line-height:1.05;letter-spacing:-.035em;
          margin:0 0 12px;text-shadow:0 2px 26px rgba(0,0,0,.42);}
        .v2-hero-copy h1{text-wrap:balance;}
        .v2-hero-copy p{font-size:14px;font-weight:400;margin:0;opacity:.93;}
        /* Below the bar, hard against the bottom of the window. */
        .v2-hero2,.v2-hero3{justify-content:flex-end;}
        .v2-hero3{padding-bottom:calc(var(--bar) + 20px);}
        
        .v2-hero2{padding-bottom:calc(var(--bar) + 54px);}
        .v2-one span{display:block;}
        .v2-inspire-cta{margin-top:20px;padding:11px 22px;border:none;border-radius:999px;cursor:pointer;
          color:#fff;font-size:13px;font-weight:400;background:${V2.glassDark};
          backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);
          box-shadow:inset 0 0 0 1px ${V2.glassEdge};transition:background .22s ${V2.ease};}
        .v2-inspire-cta:hover{background:rgba(255,255,255,.18);}
        .v2-sugs{position:relative;z-index:2;display:flex;flex-direction:column;gap:9px;padding:22px 14px 0;}
        .v2-shopsfor{position:relative;z-index:2;display:flex;align-items:center;justify-content:center;
          flex-wrap:wrap;gap:10px;padding:18px 14px 0;}
        .v2-shopsfor-q{font-size:13px;letter-spacing:.04em;color:rgba(255,255,255,.72);}
        .v2-shopsfor-opts{display:flex;gap:7px;}
        .v2-shopsfor-b{min-height:44px;padding:9px 16px;border-radius:999px;cursor:pointer;
          font-size:14px;color:#fff;background:rgba(255,255,255,.14);
          border:1px solid rgba(255,255,255,.28);backdrop-filter:blur(8px);}
        .v2-shopsfor-b:hover{background:rgba(255,255,255,.24);}
        .v2-sug{text-align:left;padding:13px 18px;border:none;border-radius:999px;cursor:pointer;color:#fff;
          font-size:13px;font-weight:400;background:${V2.glassDark};
          backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);
          box-shadow:inset 0 0 0 1px ${V2.glassEdge};transition:background .2s ${V2.ease};}
        .v2-sug:active{background:rgba(255,255,255,.2);}

        /* Results */
        .v2-results{padding-bottom:calc(var(--bar) + 44px);}
        .v2-sec{padding:clamp(60px,15vw,100px) 20px 0;text-align:center;}
        .v2-sec h2{font-family:${V2.display};font-weight:600;letter-spacing:-.03em;font-size:clamp(27px,7.4vw,38px);line-height:1.1;margin:0 0 8px;}
        .v2-sec p{font-size:14px;font-weight:400;color:${V2.ink70};margin:0 0 28px;}
        .v2-sec-hero{position:relative;margin:0 auto;max-width:min(420px,88vw);}
        /* From the first multi-column layout onward the hero is two grid
           columns wide, so its edges sit on the tiles' edges. The phone keeps
           its own centred composition — at two columns "two columns" is the
           whole width, which is not the same picture. */
        @media(min-width:760px){
          .v2-sec{padding-left:var(--grid-pad);padding-right:var(--grid-pad);}
          .v2-sec-hero{max-width:calc(
            (100% - (var(--grid-cols) - 1) * var(--grid-gap)) / var(--grid-cols) * 2 + var(--grid-gap));}
          /* Two columns wide at 3:4 is taller than a laptop window, and a lead
             image nobody can see past is not a lead image. Capped in height and
             cropped rather than narrowed, so the width — which is what carries
             the alignment — is untouched. */
          .v2-sec-hero .v2-shot img{aspect-ratio:auto;height:min(58vh,660px);}
        }
        .v2-shot{display:block;width:100%;padding:0;border:none;background:${V2.boneDeep};cursor:pointer;}
        .v2-shot img{width:100%;aspect-ratio:3/4;object-fit:cover;display:block;}
        .v2-sec-hero .v2-bagbtn{position:absolute;right:12px;bottom:12px;}
        .v2-discover{display:inline-flex;align-items:center;gap:7px;margin-top:15px;background:none;border:none;
          cursor:pointer;color:${V2.ink};font-size:14px;padding:6px 2px;}
        .v2-discover span{font-size:17px;line-height:1;}
        /* Quieter than Discover all: that opens a piece, this extends a list.
           Full width under the grid, where the eye already is after scrolling
           to the end of it. */
        .v2-more{display:block;width:100%;min-height:44px;margin:26px 0 0;
          border:1px solid ${V2.hairline};border-radius:12px;background:none;cursor:pointer;
          color:${V2.ink70};font-family:${V2.sans};font-size:13px;transition:background .16s;}
        .v2-more:hover{background:rgba(26,26,28,.04);}
        .v2-more:disabled{cursor:default;opacity:.6;}

        /* Gutters, and air at the edges. The tiles were 3px apart and flush to
           the screen, so the grid read as one sheet of photographs rather than
           as separate pieces. */
        /* One grid, declared once, so the lead image and the tiles under it
           can be made to share edges. The hero was a fixed 340px sitting over a
           1154px grid on a laptop — centred, but visibly unrelated to
           everything below it, which is what reads as misaligned. */
        .v2-results{--grid-gap:12px;--grid-cols:2;--grid-pad:12px;}
        /* Four from the first multi-column layout up, not three then four. An
           odd column count cannot hold a centred hero that is a whole number of
           columns wide — two columns centred over three straddles the middle
           one, which is exactly what reads as misjudged. Four columns and a
           two-column hero land on each other at every width. */
        @media(min-width:760px){.v2-results{--grid-cols:4;--grid-pad:0px;}}
        @media(min-width:1024px){.v2-results{--grid-gap:20px;}}
        .v2-mosaic{display:grid;grid-template-columns:repeat(var(--grid-cols),1fr);
          gap:22px var(--grid-gap);padding:32px var(--grid-pad) 0;}
        /* The grey was the tile's own background showing through under the
           caption. Only the image needs a plate to load against. */
        .v2-tile{position:relative;display:flex;flex-direction:column;}
        .v2-tile-btn{display:block;width:100%;padding:0;border:none;cursor:pointer;background:${V2.boneDeep};}
        /* Holding a photograph in a shop is not a request to save or share it.
           iOS offers its own Save Image / Share sheet over any long-pressed
           image, which lands on top of the app and has nothing to do with
           shopping — so the callout is refused and the photographs are not
           text to be selected. */
        .v2-tile-btn,.v2-shot,.v2-tile img,.v2-shot img,.v2-pdp-img,.v2-cart-thumb{
          -webkit-touch-callout:none;-webkit-user-select:none;user-select:none;}
        /* Every tile the same height. The grid alternated 3/4 and 2/3 tiles as a
           masonry, which staggered the rows and left the names on a ragged
           baseline — the reference runs an even two-up where each row reads as
           a pair. The .tall class is kept as a no-op so nothing depends on it. */
        .v2-tile img,.v2-tile.tall img{width:100%;aspect-ratio:3/4;object-fit:cover;display:block;transition:transform .7s ${V2.ease};}
        @media(hover:hover){.v2-tile:hover img{transform:scale(1.035);}}
        .v2-tile .v2-bagbtn{position:absolute;right:9px;bottom:38px;}
        /* Two lines, always. A caption that ran to four lines pushed its
           neighbour's photograph down and the grid lost its rows — which is what
           made the tiles look like different sizes when every image is identical.
           Fixed height, clipped, so each row starts on the same line. */
        .v2-tile-name{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;
          padding:10px 2px 0;font-size:13px;line-height:1.35;height:calc(2 * 1.35em + 10px);text-align:left;}
        .v2-tile-name i{font-style:normal;color:${V2.ink45};}

        /* Look page */
        .v2-lookpage{padding:calc(env(safe-area-inset-top,0px) + 108px) 0 calc(var(--bar) + 70px);}
        .v2-rail{display:flex;gap:12px;overflow-x:auto;padding:0 16px;scroll-snap-type:x mandatory;scrollbar-width:none;}
        .v2-rail::-webkit-scrollbar{display:none;}
        .v2-rail-item{position:relative;flex:0 0 auto;width:min(66vw,260px);scroll-snap-align:center;}
        .v2-rail-item .v2-bagbtn{position:absolute;right:10px;top:calc(100% - 78px);}
        .v2-rail-name{display:block;padding:10px 2px 0;font-size:13px;}
        .v2-rail-name i{font-style:normal;color:${V2.ink45};}
        .v2-rail-nav{display:flex;gap:12px;justify-content:center;padding-top:22px;}
        .v2-rail-nav button{width:34px;height:34px;border-radius:50%;border:1px solid ${V2.hairline};
          background:none;cursor:pointer;font-size:16px;color:${V2.ink};line-height:1;}
        .v2-eyebrow{position:absolute;z-index:44;top:calc(env(safe-area-inset-top,0px) + 108px);left:20px;
          font-size:11px;letter-spacing:.16em;color:${V2.ink70};}

        /* PDP */
        /* The header floats over the scroller, so the first photograph used to run
           under it — the model's head behind the wordmark. The page starts below
           the bar instead, which is also what lets the whole image be seen. */
        .v2-pdp{padding-top:calc(env(safe-area-inset-top,0px) + 64px);padding-bottom:300px;}
        .v2-pdp-col{display:flex;flex-direction:column;gap:3px;}
        /* 3/4 held before the file arrives, so a gallery landing under the fold
           does not shove the page around while it is being read. object-fit
           covers the difference for the rare square or 4/5 shot. */
        .v2-pdp-img{width:100%;display:block;aspect-ratio:3/4;object-fit:cover;
          background:${V2.boneDeep};}
        /* Colourways */
        .v2-back{position:absolute;z-index:45;top:calc(env(safe-area-inset-top,0px) + 56px);left:14px;display:flex;
          align-items:center;gap:6px;padding:7px 14px 7px 11px;border:none;border-radius:999px;cursor:pointer;
          font-size:13px;color:${V2.ink};background:${V2.glassLight};
          backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);box-shadow:0 3px 16px rgba(0,0,0,.10);}
        .v2-back span{font-size:17px;line-height:1;}

        /* One column: panel, pills, tray. Nothing here is positioned against
           anything else, so nothing here can land on top of anything else. */
        .v2-dock{position:absolute;z-index:52;left:12px;right:12px;display:flex;flex-direction:column;
          align-items:stretch;gap:10px;margin-bottom:calc(env(safe-area-inset-bottom,0px) + 14px);}
        .v2-acc{display:flex;gap:9px;}
        /* Set as the reference sets them: uppercase, tracked out. */
        .v2-acc-pill{display:inline-flex;align-items:center;gap:7px;padding:8px 13px;border:none;border-radius:999px;
          letter-spacing:.08em;
          cursor:pointer;font-size:12px;letter-spacing:0;font-weight:500;color:#fff;background:${V2.glassDark};
          backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);}
        .v2-acc-pill i{font-style:normal;font-size:12px;opacity:.85;}
        .v2-acc-pill.on{background:rgba(28,27,25,.85);}
        /* 42vh fitted the old two-by-two grid. Three rows of pieces is taller
           than that, so the last one sat behind the dock — the row a shopper
           is least likely to have thought of, which is the one worth showing.
           It scrolls inside itself and stops short of the dock rather than
           under it. */
        .v2-panel{max-height:min(56vh,calc(100dvh - var(--bar) - 150px));overflow-y:auto;
          overscroll-behavior:contain;
          padding:16px 18px;border-radius:24px;color:#fff;background:${V2.glassDark};
          backdrop-filter:blur(22px);-webkit-backdrop-filter:blur(22px);
          box-shadow:0 14px 44px rgba(0,0,0,.3);animation:v2-rise .3s ${V2.ease};}
        .v2-panel-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;}
        .v2-panel-head span{font-size:12px;letter-spacing:0;font-weight:500;opacity:.8;}
        .v2-panel-head button{background:none;border:none;font-size:17px;cursor:pointer;color:inherit;opacity:.75;line-height:1;}
        .v2-panel p{font-size:13px;line-height:1.62;font-weight:400;margin:0;}
        /* HOW TO STYLE lifts a light card instead of the dark one. */
        .v2-panel.light{color:${V2.ink};background:${V2.glassLight};border:1px solid rgba(255,255,255,.5);max-height:38vh;}
        /* One row per slot: trousers, shoes, a layer. Each scrolls sideways
           on its own so ten options cost one row of height rather than five,
           and the panel stays a panel rather than becoming a second page. */
        /* The look: one piece per slot, side by side, read left to right the
           way it would be worn. Three tiles fit a phone without scrolling,
           which is the point — a look you have to scroll is a list. */
        .v2-look{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;}
        .v2-look-piece{position:relative;padding:0;border:none;background:none;cursor:pointer;
          color:inherit;text-align:left;display:flex;flex-direction:column;gap:6px;}
        .v2-look-piece img,.v2-look-piece .v2-img-ph{width:100%;aspect-ratio:3/4;object-fit:cover;
          display:block;border-radius:6px;background:rgba(255,255,255,.5);}
        .v2-look-slot{font-size:9.5px;letter-spacing:.11em;text-transform:uppercase;opacity:.55;}
        .v2-look-name{font-size:11px;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;
          -webkit-box-orient:vertical;overflow:hidden;margin-top:-3px;}
        @media(min-width:760px){.v2-look{grid-template-columns:repeat(3,minmax(0,150px));}}
        .v2-style-wait{font-size:12px;color:${V2.ink45};margin:0 0 10px;}
        .v2-style-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;}
        .v2-style-cell{position:relative;padding:0;border:none;cursor:pointer;background:rgba(255,255,255,.55);
          aspect-ratio:1/1;overflow:hidden;border-radius:4px;}
        .v2-style-cell img,.v2-style-cell .v2-img-ph{width:100%;height:100%;object-fit:cover;display:block;}
        .v2-style-cell i{position:absolute;right:6px;bottom:6px;width:19px;height:19px;border-radius:50%;
          background:rgba(255,255,255,.9);color:${V2.ink};font-style:normal;font-size:13px;line-height:19px;
          text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.18);}
        .v2-sku{display:block;margin-top:14px;font-size:11px;opacity:.6;}
        .v2-comp{display:block;margin-bottom:8px;font-size:12px;letter-spacing:.06em;}
        /* One fact per line, the way a composition reads on a care label. A
           comma-run of tags reads as data; this reads as a garment. */
        .v2-mat-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:7px;}
        .v2-mat-list li{font-size:13px;line-height:1.5;opacity:.88;}

        /* The quiet, in-place "still working" note for follow-up searches. */
        .v2-crafting{position:absolute;z-index:45;left:var(--col-l);max-width:var(--col-w);display:flex;align-items:center;gap:9px;
          padding:8px 15px;border-radius:999px;color:#fff;background:${V2.glassDark};
          backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);
          box-shadow:inset 0 0 0 1px ${V2.glassEdge};font-size:13px;font-weight:400;white-space:nowrap;
          overflow:hidden;text-overflow:ellipsis;
          animation:v2-fade .3s ${V2.ease};}

        /* The answer, inside the bar. It takes the bar's own colours through
           currentColor, so it inverts with it over paper and never needs a
           second palette. Capped and scrollable: a long answer must not push
           the field it was typed into off the screen. */
        .v2-bar-said{display:flex;align-items:flex-start;gap:10px;
          margin:0 2px 4px;padding:0 0 11px;
          /* Both stated: the fallback holds where color-mix is not available,
             and it has to be a tint of currentColor so the rule survives the
             bar inverting over paper. */
          border-bottom:1px solid rgba(255,255,255,.16);
          border-bottom-color:color-mix(in srgb, currentColor 18%, transparent);
          max-height:30svh;overflow-y:auto;overscroll-behavior:contain;
          animation:v2-fade .26s ${V2.ease};}
        .v2-bar-said p{margin:0;font-size:14px;line-height:1.55;font-weight:400;opacity:.9;}
        /* What the next question is about. Inside the bar, above the field, in
           the bar's own colours — the same place an attached photo appears,
           because they are the same kind of thing: something travelling with
           the message. */
        .v2-pinned{display:flex;align-items:center;gap:9px;margin:0 2px 8px;padding:6px 8px 6px 6px;
          border-radius:12px;background:rgba(255,255,255,.1);
          background:color-mix(in srgb, currentColor 10%, transparent);
          animation:v2-fade .24s ${V2.ease};}
        .v2-pinned img{width:28px;height:34px;object-fit:cover;border-radius:7px;flex-shrink:0;display:block;}
        .v2-pinned span{flex:1;min-width:0;font-size:12px;opacity:.8;white-space:nowrap;
          overflow:hidden;text-overflow:ellipsis;}
        .v2-pinned b{font-weight:500;opacity:1;}
        .v2-pinned button{position:relative;flex-shrink:0;width:20px;height:20px;display:flex;
          align-items:center;justify-content:center;border:none;border-radius:50%;cursor:pointer;
          color:inherit;opacity:.6;background:rgba(255,255,255,.16);
          background:color-mix(in srgb, currentColor 16%, transparent);}
        .v2-pinned button:hover{opacity:.95;}
        .v2-pinned button::before{content:'';position:absolute;left:50%;top:50%;width:44px;height:44px;
          transform:translate(-50%,-50%);}
        /* ── A reply that names pieces ──────────────────────────────────────
           The prose keeps the composer's own type; the pieces it named sit
           under it as a row you can scroll and open, because a recommendation
           you cannot look at is only half of one. */
        .v2-said-body{flex:1;min-width:0;}
        .v2-said-cards{display:flex;gap:8px;margin-top:9px;overflow-x:auto;
          scrollbar-width:none;padding-bottom:2px;}
        .v2-said-cards::-webkit-scrollbar{display:none;}
        .v2-said-card{flex:0 0 auto;width:64px;padding:0;border:none;background:none;
          cursor:pointer;color:inherit;text-align:left;}
        .v2-said-card img{width:64px;height:80px;object-fit:cover;border-radius:8px;display:block;
          background:rgba(255,255,255,.08);
          background:color-mix(in srgb, currentColor 8%, transparent);}
        .v2-said-card span{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;
          overflow:hidden;margin-top:5px;font-size:10.5px;line-height:1.3;opacity:.62;}
        @media(hover:hover){.v2-said-card:hover span{opacity:.95;}}
        .v2-said-shot{flex:0 0 auto;width:64px;height:80px;object-fit:cover;border-radius:8px;display:block;}

        .v2-bar-said-x{position:relative;flex-shrink:0;width:22px;height:22px;margin-top:1px;
          display:flex;align-items:center;justify-content:center;border:none;border-radius:50%;
          color:inherit;cursor:pointer;opacity:.55;transition:opacity .14s;
          background:rgba(255,255,255,.16);
          background:color-mix(in srgb, currentColor 16%, transparent);}
        .v2-bar-said-x:hover{opacity:.85;}
        .v2-bar-said-x::before{content:'';position:absolute;left:50%;top:50%;width:44px;height:44px;
          transform:translate(-50%,-50%);}
        .v2-bar-said-x::before{content:'';position:absolute;left:50%;top:50%;width:44px;height:44px;
          transform:translate(-50%,-50%);}

        /* In-flow dashed card at the foot of the product page. */
        .v2-doc{margin:34px 16px 0;padding:2px 18px 6px;border-top:1px solid ${V2.hairline};border-bottom:1px solid ${V2.hairline};}
        .v2-doc-row{display:flex;width:100%;justify-content:space-between;align-items:center;background:none;
          border:none;padding:15px 0;cursor:pointer;color:inherit;font-size:13px;font-weight:500;}
        .v2-doc-row i{font-style:normal;font-size:15px;opacity:.6;}
        .v2-doc-body p{margin:0 0 14px;font-size:13px;line-height:1.62;font-weight:400;}
        .v2-doc-sku{display:block;margin-bottom:12px;font-size:11px;color:${V2.ink45};}
        .v2-doc-list{list-style:none;margin:0 0 14px;padding:0;display:flex;flex-direction:column;gap:5px;}
        .v2-doc-list li{font-size:13px;line-height:1.5;font-weight:400;}
        .v2-other{margin-top:38px;}
        .v2-eyebrow-in{font-size:13px;font-weight:500;color:${V2.ink45};text-align:center;margin-bottom:16px;}
        .v2-nested{margin-top:16px;padding-top:12px;border-top:1px solid rgba(255,255,255,.16);}
        .v2-nested button{display:flex;width:100%;justify-content:space-between;align-items:center;background:none;
          border:none;padding:0;cursor:pointer;font-size:11px;letter-spacing:.15em;color:inherit;opacity:.75;}
        .v2-nested i{font-style:normal;font-size:15px;}
        .v2-nested-body{margin-top:10px !important;font-size:13px !important;}

        /* Trays */
        .v2-tray{position:absolute;z-index:42;left:var(--col-l);right:auto;width:var(--col-w);box-sizing:border-box;padding:9px;border-radius:24px;color:#fff;
          background:${V2.glassDark};backdrop-filter:blur(22px);-webkit-backdrop-filter:blur(22px);
          box-shadow:0 14px 44px rgba(0,0,0,.3);animation:v2-rise .4s ${V2.ease};}
        .v2-tray-row{display:flex;gap:8px;}
        .v2-chip{flex:1;min-width:0;aspect-ratio:1/1;padding:0;border:none;border-radius:12px;overflow:hidden;
          background:rgba(255,255,255,.1);cursor:pointer;box-shadow:inset 0 0 0 1px ${V2.glassEdge};}
        .v2-chip img{width:100%;height:100%;object-fit:cover;display:block;}
        .v2-tray-row .v2-bagbtn.ghost{flex:1;height:auto;aspect-ratio:1/1;border-radius:12px;color:#fff;
          background:rgba(255,255,255,.06);box-shadow:inset 0 0 0 1px ${V2.glassEdge};}
        .v2-tray-cta{display:flex;gap:7px;margin-top:8px;align-items:center;}

        /* Grows to share the row, but only up to a size a pill should be —
           with the colours moved onto the page there is one pill left here, and
           an unbounded flex:1 stretched it into a slab half the bar wide. */
        .v2-pill{flex:0 1 auto;max-width:220px;min-width:84px;padding:10px 16px;border:none;border-radius:999px;cursor:pointer;font-size:12px;
          color:#fff;background:rgba(255,255,255,.16);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
          transition:background .18s ${V2.ease};}
        .v2-pill:active{background:rgba(255,255,255,.26);}
        .v2-x{width:34px;height:34px;flex-shrink:0;border:none;border-radius:50%;cursor:pointer;display:flex;
          align-items:center;justify-content:center;color:#fff;background:rgba(255,255,255,.16);}
        /* Bag it. Ink-on-white at rest, inverted once it is in — the fill is
           the state, so a glance at a grid says which pieces are already
           yours without reading anything. */
        .v2-bagbtn{position:relative;border:none;border-radius:50%;cursor:pointer;display:flex;
          align-items:center;justify-content:center;
          color:${V2.ink};background:rgba(255,255,255,.82);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
          box-shadow:0 2px 10px rgba(0,0,0,.13);
          transition:transform .18s ${V2.ease},background .18s linear,color .18s linear;}
        .v2-bagbtn:active{transform:scale(.86);}
        .v2-bagbtn.on{background:${V2.ink};color:${V2.bone};}
        /* The confirmation: one firm pulse, then it settles into the filled
           state. Long enough to see, short enough not to be an animation you
           have to wait out. */
        .v2-bagbtn.just{animation:v2-bagged .52s ${V2.ease};}
        @keyframes v2-bagged{
          0%{transform:scale(1)} 34%{transform:scale(1.22)} 62%{transform:scale(.94)} 100%{transform:scale(1)}
        }
        .v2-bagbtn-dot{position:absolute;top:5px;right:5px;width:5px;height:5px;border-radius:50%;
          background:currentColor;opacity:.9;}

        .v2-hint{position:absolute;z-index:41;left:50%;translate:-50% 0;margin-bottom:14px;display:inline-flex;align-items:center;gap:9px;
          padding:11px 20px;border:none;border-radius:999px;cursor:pointer;font-size:13px;color:#fff;
          background:${V2.glassDark};backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);animation:v2-fade .6s ${V2.ease};}

        /* Loading */
        /* ── Waiting ────────────────────────────────────────────────────────
           The results page with its pictures not yet in. Same geometry as the
           real thing — the section heading, the lead image, then the grid — so
           nothing moves when the products arrive. It replaced a word centred in
           an empty screen, which told the shopper the app was busy and nothing
           about what was coming. */
        /* Every number here is taken from the results page rather than chosen:
           .v2-sec's top padding, its heading's line-height and margin,
           .v2-sec-hero's max-width, and .v2-mosaic's own padding and gutters.
           Measured against the real thing — same columns, same gutters, hero
           within a couple of pixels — because a skeleton whose geometry is
           merely similar makes the page jump at the moment it is replaced,
           which is worse than no skeleton at all. */
        .v2-skel{position:absolute;inset:0;z-index:39;overflow:hidden;
          padding:clamp(60px,15vw,100px) 0 calc(var(--bar) + 60px);
          background:${V2.bone};animation:v2-fade .2s ${V2.ease};}
        /* The heading plate is the h2's own clamp multiplied by its 1.1
           line-height, and the hero sits on the h2's 8px bottom margin — so the
           lead image lands where the real one will rather than near it. */
        .v2-skel-head{width:52%;max-width:220px;height:clamp(29.7px,8.14vw,41.8px);
          margin:0 auto 8px;border-radius:12px;}
        .v2-skel-hero{width:min(420px,88vw);aspect-ratio:3/4;margin:0 auto;border-radius:12px;}
        .v2-skel-grid{display:grid;grid-template-columns:1fr 1fr;gap:22px 12px;padding:32px 12px 0;}
        .v2-skel-cell{display:flex;flex-direction:column;gap:10px;animation:v2-skel-in .5s ${V2.ease} backwards;}
        .v2-skel-img{width:100%;aspect-ratio:3/4;border-radius:12px;}
        .v2-skel-line{width:70%;height:12px;border-radius:999px;}
        /* One shimmer for every plate, so the whole page breathes together
           rather than each tile pulsing on its own clock. */
        .v2-skel-head,.v2-skel-hero,.v2-skel-img,.v2-skel-line{
          background:linear-gradient(100deg,${V2.boneDeep} 20%,rgba(255,255,255,.85) 42%,${V2.boneDeep} 64%);
          background-size:220% 100%;animation:v2-shimmer 1.5s linear infinite;}
        @keyframes v2-shimmer{from{background-position:130% 0}to{background-position:-30% 0}}
        @keyframes v2-skel-in{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
        @media(min-width:760px){.v2-skel-grid{grid-template-columns:repeat(3,1fr);}}
        /* The results page changes its own padding, heading size and hero width
           above 1024; the skeleton follows each of them. */
        @media(min-width:1024px){
          .v2-skel{padding-top:clamp(80px,7vw,120px);}
          .v2-skel-head{height:clamp(37.4px,3.41vw,50.6px);}
          .v2-skel-hero{width:min(340px,26vw);}
        }
        @media(min-width:1180px){
          .v2-skel{padding-left:clamp(20px,3vw,44px);padding-right:clamp(20px,3vw,44px);}
          .v2-skel-grid{grid-template-columns:repeat(4,1fr);gap:30px 20px;padding:40px 0 0;}
        }
        @media(prefers-reduced-motion:reduce){
          .v2-skel-head,.v2-skel-hero,.v2-skel-img,.v2-skel-line{animation:none;background:${V2.boneDeep};}
          .v2-skel-cell{animation:none}
        }
        /* An indeterminate track. The travelling block used to be 40% of a
           26px rail inside the status pill — ten pixels sliding back and forth,
           which read as a glitch rather than as work happening. Wider rail,
           slower travel, and it eases at both ends instead of snapping back. */
        .v2-prog{display:block;width:132px;height:2px;border-radius:2px;overflow:hidden;
          background:rgba(26,26,28,.12);flex-shrink:0;}
        .v2-prog.light{width:46px;background:rgba(255,255,255,.22);}
        .v2-prog i{display:block;width:45%;height:100%;border-radius:2px;background:${V2.ink};
          animation:v2-travel 1.35s ${V2.easeInOut} infinite;}
        .v2-prog.light i{background:#fff;}
        @keyframes v2-travel{
          0%{transform:translateX(-105%)} 55%{transform:translateX(125%)}
          56%{transform:translateX(125%)} 100%{transform:translateX(-105%)}
        }
        @media(prefers-reduced-motion:reduce){
          .v2-prog i{animation:v2-pulse 1.6s ease-in-out infinite;width:100%}
          @keyframes v2-pulse{0%,100%{opacity:.3}50%{opacity:1}}
        }
        /* Each status line replaces the one before it rather than the text
           mutating in place, so the pill reads as a sequence of steps. */
        /* The light passes THROUGH the words rather than sitting on them: the
           gradient is clipped to the glyphs, its bright stop is a lift of the
           text's own colour rather than a white flare, and it travels slowly.
           A hard specular sweep reads as a loading bar dropped on the text;
           this reads as the line being alive. */
        .v2-crafting-line{
          animation:v2-line .26s ${V2.ease}, v2-glow 2.8s linear .3s infinite;
          background-image:linear-gradient(100deg,rgba(255,255,255,.6) 0%,rgba(255,255,255,.6) 40%,rgba(255,255,255,1) 50%,rgba(255,255,255,.6) 60%,rgba(255,255,255,.6) 100%);
          background-size:300% 100%;background-position:170% 0;
          -webkit-background-clip:text;background-clip:text;
          color:transparent;-webkit-text-fill-color:transparent;}
        @keyframes v2-line{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
        @keyframes v2-glow{from{background-position:170% 0}to{background-position:-70% 0}}
        /* The icon arrives with its line, so the two read as one step landing
           rather than a static badge beside moving text. */
        .v2-step-ic{display:flex;align-items:center;justify-content:center;flex-shrink:0;
          opacity:.92;animation:v2-line .3s ${V2.ease};}
        @media(prefers-reduced-motion:reduce){
          .v2-crafting-line{animation:none;background:none;color:#fff;-webkit-text-fill-color:#fff;}
          .v2-step-ic{animation:none;}}

        /* ── Drawer + scrim ────────────────────────────────────────────────
           A full-height panel that slides in from the left edge, which is what
           the chat UI had. It used to be a rounded card that grew out of the
           trigger — a window floating in the corner, which read as a popup
           rather than as the app's spine. The mechanics are the chat UI's
           exactly: 290px wide capped at 86% of the screen, the same
           translateX(-100%) to 0, the same .34s on the same curve, and a scrim
           that fades over the same duration. Only the surface is this app's —
           dark glass rather than white. */
        .v2-ov{position:absolute;inset:0;z-index:73;background:rgba(16,14,12,0);pointer-events:none;
          transition:background .34s;}
        .v2-ov.on{background:rgba(16,14,12,.4);pointer-events:auto;backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px);}
        /* A flipping surface's whole palette is four values: an ink channel
           every tint is expressed against, the paper it sits on, and the pair
           for solid buttons. Stated once here and once on the feedback sheet,
           so those two surfaces are one system and either can be repainted from
           its own block rather than by hunting through forty rgba literals. */
        .v2-menu{position:absolute;z-index:74;top:0;left:0;bottom:0;width:min(290px,86%);
          --srf-ink-rgb:255,255,255;
          --srf-paper:rgba(28,27,26,.86);
          --srf-fill:#fff;
          --srf-fill-ink:${V2.ink};
          color:rgb(var(--srf-ink-rgb));background:var(--srf-paper);
          backdrop-filter:blur(30px) saturate(140%);-webkit-backdrop-filter:blur(30px) saturate(140%);
          border-right:1px solid rgba(var(--srf-ink-rgb),.12);box-shadow:8px 0 48px rgba(0,0,0,.34);
          padding:calc(env(safe-area-inset-top,0px) + 24px) 16px calc(env(safe-area-inset-bottom,0px) + 20px);
          display:flex;flex-direction:column;gap:18px;overflow-y:auto;overscroll-behavior:contain;
          transform:translateX(-100%);pointer-events:none;
          transition:transform .34s cubic-bezier(.32,.72,0,1);}
        .v2-menu.on{transform:translateX(0);pointer-events:auto;}
                .v2-eyebrow-s{font-size:11px;font-weight:500;opacity:.42;letter-spacing:.04em;padding-left:6px;}
                .v2-menu-top{display:flex;align-items:center;justify-content:space-between;padding:0 6px;}
        .v2-menu-logo{width:34px;height:34px;border-radius:12px;display:block;object-fit:cover;
          box-shadow:0 2px 10px rgba(0,0,0,.28);}
        .v2-avatar{position:relative;width:36px;height:36px;border-radius:50%;border:none;cursor:pointer;flex-shrink:0;
          display:flex;align-items:center;justify-content:center;color:inherit;
          background:rgba(var(--srf-ink-rgb),.12);font-family:${V2.sans};font-size:14px;font-weight:500;}
                .v2-avatar:hover{background:rgba(var(--srf-ink-rgb),.2);}
        /* The disc is 36 because that is the drawing; the finger gets 44. */
        .v2-avatar::before{content:'';position:absolute;left:50%;top:50%;width:44px;height:44px;
          transform:translate(-50%,-50%);}
        .v2-newchat{display:flex;align-items:center;justify-content:center;gap:7px;width:100%;
          min-height:44px;padding:11px 16px;border-radius:12px;border:none;cursor:pointer;
          background:var(--srf-fill);color:var(--srf-fill-ink);font-family:${V2.sans};font-size:13px;font-weight:500;
          transition:opacity .15s;}
        .v2-newchat:hover{opacity:.86;}
        /* The fixed destinations. A row, not a headline — the chat UI's shape:
           icon, label, and a count when there is one. */
        .v2-menu-nav{display:flex;flex-direction:column;gap:2px;}
        ul.v2-menu-nav li button{display:flex;align-items:center;gap:13px;width:100%;min-height:44px;
          padding:11px 6px;border-radius:12px;border:none;cursor:pointer;background:none;color:inherit;
          font-family:${V2.sans};font-size:14px;font-weight:400;letter-spacing:0;text-align:left;
          transition:background .12s;}
        ul.v2-menu-nav li button:hover{background:rgba(var(--srf-ink-rgb),.08);opacity:1;}
        ul.v2-menu-nav li button em{margin-left:auto;font-style:normal;font-size:11px;font-weight:500;
          background:rgba(var(--srf-ink-rgb),.14);border-radius:999px;padding:2px 8px;}
        /* The count answers when something lands in it. The drawer is usually
           shut when a piece is bagged, so this is not the confirmation — the
           button on the tile is. It is what makes the connection between the
           two obvious the first time someone opens the drawer after bagging. */
        ul.v2-menu-nav li button em.bump{animation:v2-bump .5s ${V2.ease};
          background:var(--srf-fill);color:var(--srf-fill-ink);}
        @keyframes v2-bump{0%{transform:scale(1)}40%{transform:scale(1.3)}100%{transform:scale(1)}}
        /* Listed, not live. Dimmed so the row reads as an announcement rather
           than a control, and the tag says when. */
        ul.v2-menu-nav li button.soon{opacity:.45;cursor:default;}
        ul.v2-menu-nav li button.soon:hover{background:none;}
        ul.v2-menu-nav li button em.soon{background:none;border:1px solid rgba(var(--srf-ink-rgb),.28);border-radius:999px;
          font-size:10px;letter-spacing:.06em;text-transform:uppercase;padding:2px 7px;}
        .v2-menu-empty{margin:0;font-size:13px;opacity:.45;}
        /* Account view */
        .v2-avatar.on{background:var(--srf-fill);color:var(--srf-fill-ink);}
        .v2-profile{display:flex;flex-direction:column;align-items:center;text-align:center;
          padding:14px 6px 10px;gap:0;}
        .v2-profile-face{width:78px;height:78px;border-radius:50%;overflow:hidden;flex-shrink:0;
          display:flex;align-items:center;justify-content:center;margin-bottom:16px;
          background:rgba(var(--srf-ink-rgb),.12);color:inherit;font-family:${V2.sans};font-size:28px;font-weight:500;}
        .v2-profile-face img{width:100%;height:100%;object-fit:cover;display:block;}
        .v2-profile-name{font-family:${V2.sans};font-size:17px;font-weight:600;letter-spacing:-.01em;margin-bottom:4px;}
        .v2-profile-mail{font-size:13px;opacity:.55;margin-bottom:26px;}
        .v2-profile-why{font-size:13px;line-height:1.55;opacity:.6;margin:6px 0 20px;max-width:230px;}
        .v2-profile-act{display:flex;align-items:center;justify-content:center;gap:9px;width:100%;
          min-height:44px;padding:12px 16px;border-radius:12px;border:1px solid rgba(var(--srf-ink-rgb),.2);
          background:none;color:inherit;font-family:${V2.sans};font-size:14px;cursor:pointer;
          transition:background .14s;}
        .v2-profile-act:hover{background:rgba(var(--srf-ink-rgb),.08);}
        .v2-profile-act.primary{background:var(--srf-fill);color:var(--srf-fill-ink);border-color:transparent;font-weight:500;}
        /* Sign out is not the next step after Save — one commits the form, the
           other leaves the account. Sitting flush they read as one control cut
           in half, so the sizes block ends and this begins. */
        .v2p + .v2-profile-act{margin-top:14px;}
        /* Recents: the row is the query, its controls sit at the end and only
           come up on hover or focus, so the list reads as a list of questions
           rather than a list of questions and four icons. */
        .v2-recent-row{display:flex;align-items:center;gap:4px;min-height:44px;border-radius:12px;
          transition:background .12s;}
        .v2-recent-row:hover{background:rgba(var(--srf-ink-rgb),.07);}
        .v2-menu li button.v2-recent-go{flex:1;min-width:0;min-height:44px;padding:9px 6px;font-family:${V2.sans};font-size:13px;
          font-weight:400;letter-spacing:0;opacity:.86;background:none;border:none;color:inherit;
          text-align:left;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
        .v2-recent-acts{display:flex;gap:2px;padding-right:6px;opacity:0;transition:opacity .14s;}
        .v2-recent-row:hover .v2-recent-acts,.v2-recent-acts:focus-within{opacity:.7;}
        .v2-recent-acts button{position:relative;width:30px;height:30px;display:flex;align-items:center;
          justify-content:center;background:none;border:none;color:inherit;cursor:pointer;border-radius:50%;}
        .v2-recent-acts button::before{content:'';position:absolute;left:50%;top:50%;width:44px;height:44px;
          transform:translate(-50%,-50%);}
        .v2-recent-acts button:hover{background:rgba(var(--srf-ink-rgb),.12);}
        .v2-recent-input{flex:1;min-width:0;margin:2px 6px;padding:7px 9px;border-radius:12px;
          background:rgba(var(--srf-ink-rgb),.1);border:1px solid rgba(var(--srf-ink-rgb),.22);color:inherit;
          font-family:${V2.sans};font-size:16px;outline:none;}
        /* Touch has no hover, so the controls are simply always there. */
        @media(hover:none){.v2-recent-acts{opacity:.55;}}
        .v2-menu-x{width:34px;height:34px;margin:-8px -8px -8px 0;display:flex;align-items:center;
          justify-content:center;background:none;border:none;color:inherit;cursor:pointer;
          position:relative;opacity:.7;}
        .v2-menu-x::before{content:'';position:absolute;left:50%;top:50%;width:44px;height:44px;
          transform:translate(-50%,-50%);}
        .v2-menu ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:11px;}
        .v2-menu li button{font-family:${V2.display};font-size:26px;font-weight:500;letter-spacing:-.025em;cursor:pointer;
          background:none;border:none;padding:0;color:inherit;text-align:left;line-height:1.18;
          transition:opacity .2s ${V2.ease};}
        .v2-menu li button:hover{opacity:.62;}
        /* The list reads big — 26px type — but a line of text is only ~31px
           tall, so the primary navigation was the smallest target on the page.
           The expander fills the 11px gap and a little of the neighbour's; the
           later item wins the ~2px of shared edge, which beats a dead band. */
        .v2-menu li button:not(.v2-menu-nav *),.v2-menu-meta button{position:relative;}
        .v2-menu li button:not(.v2-menu-nav *)::before,.v2-menu-meta button::before{content:'';position:absolute;
          left:0;right:0;top:50%;height:44px;transform:translateY(-50%);}
        .v2-menu-recent{padding-top:16px;border-top:1px solid rgba(var(--srf-ink-rgb),.14);flex:1;min-height:0;
          display:flex;flex-direction:column;gap:8px;overflow-y:auto;overscroll-behavior:contain;}
        .v2-menu-recent ul{gap:1px;}
        .v2-menu-recent li button{font-family:${V2.sans};font-size:14px;font-weight:400;letter-spacing:0;
          opacity:.82;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;display:block;}
        .v2-menu-meta{margin-top:auto;display:flex;justify-content:flex-end;gap:18px;padding-top:16px;
          border-top:1px solid rgba(var(--srf-ink-rgb),.16);font-size:12px;}
        .v2-menu-meta div{display:flex;flex-direction:column;gap:5px;}
        .v2-menu-meta div:first-child{opacity:.55;}
        .v2-menu-meta button{background:none;border:none;padding:0;color:inherit;font:inherit;cursor:pointer;opacity:.72;}
        /* A real button rather than a quiet footer link — it is the one thing
           here somebody reaches for while something is going wrong — but not a
           second full-width slab under New chat. Solid so it reads as a
           control, compact so it does not compete with what opens the panel,
           and right-hung so it closes it. Still 44 tall: smaller is a matter of
           width, never of what a thumb has to hit. */
        .v2-menu-meta .v2-feedback-btn{display:flex;align-items:center;justify-content:center;gap:7px;
          min-height:44px;padding:0 15px;border-radius:12px;opacity:1;border:none;
          background:var(--srf-fill);color:var(--srf-fill-ink);
          font-family:${V2.sans};font-size:13px;font-weight:500;transition:opacity .14s;}
        .v2-menu-meta .v2-feedback-btn:hover{opacity:.86;}
        .v2-menu-cta{display:flex;align-items:center;gap:10px;justify-content:center;cursor:pointer;
          padding:14px;border:1px solid rgba(var(--srf-ink-rgb),.28);border-radius:2px;background:none;
          color:inherit;font-size:11px;letter-spacing:.16em;transition:background .24s ${V2.ease};}
        .v2-menu-cta:hover{background:rgba(var(--srf-ink-rgb),.1);}
        /* Hamburger → ✕ on the trigger itself. */

        /* Bag sheet */
        .v2-bag-ov{position:absolute;inset:0;z-index:79;background:rgba(20,18,16,.34);
          backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);animation:v2-fade .3s ${V2.ease};}
        /* Scales up from the centre rather than sliding, and stops short of the
           edges so the blurred boutique stays visible around it. */
        .v2-bag{position:absolute;z-index:80;inset:calc(env(safe-area-inset-top,0px) + 54px) 12px
          calc(env(safe-area-inset-bottom,0px) + 16px);background:#fff;overflow-y:auto;border-radius:24px;
          padding:26px 22px 30px;box-shadow:0 30px 90px rgba(0,0,0,.4);
          animation:v2-pop .42s ${V2.ease};transform-origin:center;}
        @keyframes v2-pop{from{opacity:0;transform:scale(.86)}to{opacity:1;transform:none}}
        .v2-bag-x{position:absolute;top:22px;right:20px;width:32px;height:32px;
          border:none;background:none;cursor:pointer;color:${V2.ink};}
        /* The close button lives at the top right of this sheet, so the
           heading reserves its width. It fits today at "Bag (1)"; it would not
           at a longer count or a translation, and a title sliding under a
           control is the kind of thing nobody sees until it ships. */
        .v2-bag h2{font-family:${V2.display};font-weight:600;font-size:24px;letter-spacing:-.025em;
          margin:0 44px 26px 0;}
        .v2-bag h2 em{font-style:normal;}
        .v2-bag-empty{font-size:14px;color:${V2.ink45};}
        .v2-line{display:flex;gap:14px;padding-bottom:22px;margin-bottom:22px;}
        .v2-line>img{width:74px;height:98px;object-fit:cover;flex-shrink:0;background:${V2.boneDeep};}
        .v2-line>div{display:flex;flex-direction:column;gap:3px;min-width:0;}
        .v2-line-name{font-size:14px;}
        .v2-line-price{font-size:14px;margin-bottom:6px;display:flex;align-items:baseline;gap:8px;}
        .v2-line-price em{font-style:normal;font-size:12px;color:${V2.ink45};}
        .v2-line-meta{font-size:13px;color:${V2.ink70};}
        .v2-line-sku{font-size:11px;color:${V2.ink45};}
        .v2-qty{display:flex;align-items:center;gap:7px;margin-top:8px;font-size:13px;color:${V2.ink70};}
        .v2-qty button{width:20px;height:20px;border:none;background:none;cursor:pointer;font-size:14px;color:${V2.ink70};}
        .v2-qty b{font-weight:400;color:${V2.ink};}
        .v2-remove{width:auto !important;margin-left:8px;text-decoration:underline;font-size:13px !important;}
        /* Selection is a border around the piece, drawn on the line itself.
           The border is always present and only changes colour, so choosing
           something never nudges the layout by a pixel. */
        .v2-line{position:relative;cursor:pointer;border:1.5px solid transparent;border-radius:14px;
          padding:12px;margin-bottom:10px;
          transition:border-color .18s ${V2.ease},background .18s ${V2.ease};}
        .v2-line.on{border-color:${V2.ink};background:rgba(0,0,0,.015);}
        @media(hover:hover){.v2-line:not(.on):hover{border-color:${V2.hairline};}}
        .v2-line:focus-visible{outline:2px solid ${V2.ink};outline-offset:3px;}
        /* Unselected stays legible rather than greyed out — the border says
           which pieces are going, and a bag you cannot read is worse than one
           that makes you look twice. */
        .v2-line.off{opacity:.62;}
        .v2-bag-fx{color:${V2.ink45};font-size:12px !important;}
        .v2-bag-sum{border-top:1px solid ${V2.hairline};padding-top:16px;display:flex;flex-direction:column;gap:9px;margin-bottom:22px;}
        .v2-bag-sum div{display:flex;justify-content:space-between;font-size:13px;}
        .v2-pay{width:100%;padding:16px;border:none;border-radius:12px;background:${V2.ink};color:#fff;cursor:pointer;
          font-size:14px;font-weight:500;display:flex;align-items:center;justify-content:center;gap:10px;}
        /* An empty bag must not offer a live Checkout — it was fully clickable
           at zero items, which is a promise the button could not keep. */
        .v2-pay:disabled{opacity:.34;cursor:not-allowed;}
        .v2-bag-note{font-size:12px;line-height:1.5;color:${V2.ink45};text-align:center;margin:14px 0 0;}
        /* Only rendered when the browser refused a tab, so the shopper still has
           a way through to the brand. */
        .v2-bag-fallback{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin:10px 0 0;}
        .v2-bag-fallback a{font-size:12px;padding:7px 12px;border-radius:999px;
          border:1px solid rgba(0,0,0,.14);color:inherit;text-decoration:none;}
        .v2-bag-fallback a:hover{background:rgba(0,0,0,.05);}

        /* Bar */
        .v2-bar-wrap.home{padding-bottom:calc(env(safe-area-inset-bottom,0px) + 38px);}
        .v2-bar-wrap{position:absolute;z-index:50;left:0;right:0;
          padding:var(--bar-air) clamp(12px,3.6vw,18px) calc(env(safe-area-inset-bottom,0px) + 16px);pointer-events:none;}
        .v2-bar-wrap>*{pointer-events:auto;}
        /* Geometry taken from the chat composer: 820px, a 24px radius rather
           than a pill, and the field stacked above its controls. Horizontal
           padding stays symmetric because the bar is centred with margin auto,
           so unequal sides would shift every child off-centre; top and bottom
           are unequal on purpose, since the control row carries its own optical
           inset. Only the dimensions came across — the glass is v2's. */
        /* ── The bar contrasts with what is behind it ──────────────────────
           Dark glass is the resting state and it inverts to light over the bone
           paper of a results page. Tried the other way round — white at rest —
           and it was worse in both places: heavy over the film, and on a
           results page a white bar on bone is a control you have to hunt for.

           Both states are the same pane: same radius, same blur, same three
           insets — a hairline all the way round, a brighter line along the top
           where light would catch an edge, a fainter one along the bottom for
           thickness. Only the polarity changes, so it reads as the bar adapting
           rather than as two different controls swapping places.

           The rim inverts with it. A white rim on a white bar is no rim at all,
           so the light state takes a dark hairline and keeps the white specular;
           the dark state does the opposite. */
        .v2-bar{display:flex;flex-direction:column;gap:10px;padding:18px 16px 10px;width:100%;
          max-width:min(820px,96vw);margin:0 auto;border-radius:24px;
          color:#fff;background:rgba(28,27,26,.82);
          backdrop-filter:blur(26px) saturate(160%);-webkit-backdrop-filter:blur(26px) saturate(160%);
          box-shadow:
            0 14px 46px rgba(0,0,0,.34),
            0 2px 8px rgba(0,0,0,.16),
            inset 0 0 0 1px rgba(255,255,255,.18),
            inset 0 1px 0 rgba(255,255,255,.46),
            inset 0 -1px 0 rgba(255,255,255,.13);
          /* Fast enough to feel like a property of the bar rather than an
             animation played at it, and linear because an eased fade at this
             size reads as a stutter. Every property that changes is listed:
             a shorthand that misses one leaves that part snapping. */
          transition:background .16s linear,color .16s linear,box-shadow .16s linear;}
        .v2-bar.focus{background:rgba(22,21,20,.92);}
        .v2-plus,.v2-send{background:rgba(255,255,255,.14);color:#fff;}
        .v2-send.on{background:#fff;color:${V2.ink};}
        .v2-send.busy{background:none;color:#fff;}
        .v2-field textarea{color:#fff;caret-color:#fff;}
        .v2-ph,.v2-marquee span{color:rgba(255,255,255,.6);}
        .v2-shot-chip button{background:rgba(0,0,0,.62);}

        /* Over paper: the same pane, inverted to light. */
        .v2-bar.inverted{color:${V2.ink};background:rgba(248,247,245,.88);
          box-shadow:
            0 14px 46px rgba(0,0,0,.16),
            0 2px 8px rgba(0,0,0,.06),
            inset 0 0 0 1px rgba(26,26,28,.12),
            inset 0 1px 0 rgba(255,255,255,.95),
            inset 0 -1px 0 rgba(26,26,28,.05);}
        .v2-bar.inverted.focus{background:rgba(252,251,250,.96);}
        .v2-bar.inverted .v2-plus,.v2-bar.inverted .v2-send{
          background:rgba(26,26,28,.08);color:${V2.ink};}
        .v2-bar.inverted .v2-send.on{background:${V2.ink};color:#fff;}
        .v2-bar.inverted .v2-send.busy{background:none;color:${V2.ink};}
        .v2-bar.inverted .v2-field textarea{color:${V2.ink};caret-color:${V2.ink};}
        .v2-bar.inverted .v2-ph,.v2-bar.inverted .v2-marquee span{color:rgba(26,26,28,.5);}
        .v2-bar.inverted .v2-shot-chip button{background:rgba(0,0,0,.5);}
        .v2-plus,.v2-send{flex-shrink:0;border:none;cursor:pointer;display:flex;align-items:center;
          justify-content:center;border-radius:50%;transition:background .16s linear,color .16s linear,transform .12s ${V2.ease};}
        .v2-plus{width:38px;height:38px;display:flex;align-items:center;justify-content:center;
          border-radius:50%;cursor:pointer;flex-shrink:0;}
        .v2-plus:active{transform:scale(.9);}
        /* Attached photos sit above the field, inside the same glass bar. The
           column gap spaces them now, so the old order/margin overrides that
           faked a row break in a single-line flex bar are gone. */
        .v2-shots{display:flex;gap:7px;flex-wrap:wrap;}
        .v2-bar-top{display:flex;align-items:flex-end;gap:8px;}
        .v2-bar-btm{display:flex;align-items:center;gap:6px;}
        .v2-bar-right{display:flex;align-items:center;gap:8px;margin-left:auto;}
        .v2-shot-chip{position:relative;width:44px;height:44px;border-radius:12px;overflow:hidden;}
        .v2-shot-chip img{width:100%;height:100%;object-fit:cover;display:block;}
        .v2-shot-chip button{position:absolute;top:2px;right:2px;width:15px;height:15px;
          display:flex;align-items:center;justify-content:center;border:none;border-radius:50%;
          cursor:pointer;padding:0;}
        .v2-plus:active{transform:scale(.9);}
        .v2-send{width:33px;height:33px;
          transition:transform .16s ${V2.ease},background .16s linear,color .16s linear;}
        .v2-send:active{transform:scale(.86);}
        .v2-bar-press{transform-origin:center bottom;transition:transform .2s ${V2.ease};}
        .v2-bar-press:active{transform:scale(.985);}
        .v2-send.busy{background:none;box-shadow:inset 0 0 0 1.25px currentColor;opacity:.75;}
        .v2-send.busy svg{animation:v2-pulse 1.1s ${V2.easeInOut} infinite;}
        @keyframes v2-pulse{0%,100%{opacity:1}50%{opacity:.35}}
        .v2-field{position:relative;flex:1;min-width:0;overflow:hidden;}
        .v2-field textarea{width:100%;border:none;background:none;outline:none;resize:none;font-family:${V2.sans};
          font-size:16px;line-height:1.42;max-height:min(200px,30svh);overflow-y:auto;display:block;
          -webkit-overflow-scrolling:touch;overscroll-behavior:contain;}
        .v2-ph{position:absolute;left:0;top:0;pointer-events:none;font-size:16px;line-height:1.42;}
        /* Idle prompt drifts continuously, matching the reference ticker. */
        .v2-marquee{position:absolute;left:0;right:0;top:0;pointer-events:none;overflow:hidden;
          mask-image:linear-gradient(to right,transparent,#000 9%,#000 91%,transparent);
          -webkit-mask-image:linear-gradient(to right,transparent,#000 9%,#000 91%,transparent);}
        .v2-marquee>div{display:flex;gap:44px;width:max-content;animation:v2-drift 44s linear infinite;}
        .v2-marquee span{font-size:16px;line-height:1.42;white-space:nowrap;}
        @keyframes v2-drift{from{transform:translateX(0)}to{transform:translateX(-50%)}}
        @media(prefers-reduced-motion:reduce){
          .v2-marquee>div{animation:none}
          .v2-rise{opacity:1;transform:none;transition:none}
          .v2-scroll{scroll-behavior:auto}
          .v2-head.up{transform:none;opacity:1;pointer-events:auto}
          .v2-bag,.v2-panel,.v2-crafting,.v2-tray{animation:none}
        }

        /* Cart tray */
        .v2-cart{display:grid;
          grid-template-columns:auto 1fr auto;gap:11px;align-items:center;padding:12px;border-radius:24px;color:#fff;
          background:${V2.glassDark};backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);
          box-shadow:0 14px 44px rgba(0,0,0,.32);animation:v2-rise .42s ${V2.ease};}
        .v2-cart.tall{grid-template-columns:minmax(0,1fr);}
        .v2-cart>*{min-width:0;}
        .v2-cart-thumb{width:56px;height:72px;object-fit:cover;border-radius:12px;display:block;box-shadow:inset 0 0 0 1px ${V2.glassEdge};}
        .v2-cart-meta{min-width:0;display:flex;flex-direction:column;gap:3px;}
        .v2-cart-name{font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
        .v2-cart-price{font-size:12px;display:flex;gap:8px;align-items:baseline;}
        .v2-cart-price em{font-style:normal;text-decoration:line-through;opacity:.55;font-size:11px;}
        .v2-cart-price em::before{content:'|';text-decoration:none;display:inline-block;margin-right:8px;opacity:.7;}
        .v2-cart-color{font-size:12px;opacity:.72;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
                /* Add to cart, colours, size and close is four controls; on a narrow
           phone the third was being cut off at the edge. They wrap now. */
        .v2-cart-cta{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:2px;}
        .v2-cart-cta .v2-x{margin-left:auto;}
        .v2-buy{flex-shrink:0;padding:11px 16px;border:none;border-radius:999px;cursor:pointer;background:#fff;
          color:${V2.ink};font-size:13px;min-width:92px;display:flex;align-items:center;justify-content:center;
          transition:transform .12s ${V2.ease};}
        .v2-buy:active{transform:scale(.97);}
        .v2-buy.off{background:rgba(255,255,255,.3);color:rgba(255,255,255,.75);cursor:default;}
        .v2-spin{width:15px;height:15px;border-radius:50%;border:1.6px solid ${V2.ink45};border-top-color:${V2.ink};
          animation:v2-rot .7s linear infinite;display:block;}
        @keyframes v2-rot{to{transform:rotate(360deg)}}

                /* Swatches are chips, not plates. flex:1 with a 3/4 ratio meant a
           product with a single colourway filled the dock with one enormous
           picture. */
        /* The same row as .v2-sizes, because it is the same kind of choice —
           one control in the same place answering "which one". It used to be a
           wrapping grid of 64px cards, which read as a different feature living
           in the same drawer. Scrolls rather than wraps so eight colourways
           cannot make the dock twice as tall, and 'safe center' keeps the first
           swatch reachable when it does overflow. */
        .v2-swatches{display:flex;gap:10px;overflow-x:auto;scrollbar-width:none;padding:0 4px 4px;
          justify-content:flex-start;justify-content:safe center;scroll-snap-type:x proximity;}
        .v2-swatches::-webkit-scrollbar{display:none;}
        .v2-swatches button{flex:0 0 auto;scroll-snap-align:center;width:44px;height:44px;padding:0;
          border:none;border-radius:50%;overflow:hidden;cursor:pointer;
          background:rgba(255,255,255,.1);box-shadow:inset 0 0 0 1px ${V2.glassEdge};
          transition:box-shadow .16s ${V2.ease};}
        .v2-swatches button.on{box-shadow:0 0 0 2px #fff;}
        .v2-swatches img{width:100%;height:100%;object-fit:cover;display:block;}
        .v2-picker{position:relative;padding:4px 2px 2px;text-align:center;}
        .v2-picker-t{display:block;font-size:13px;opacity:.85;margin-bottom:14px;}
                .v2-sizes{display:flex;gap:10px;overflow-x:auto;scrollbar-width:none;padding:0 4px 4px;
          justify-content:flex-start;justify-content:safe center;scroll-snap-type:x proximity;}
        .v2-sizes::-webkit-scrollbar{display:none;}
        .v2-sizes button{flex:0 0 auto;scroll-snap-align:center;width:44px;height:44px;border-radius:50%;cursor:pointer;font-size:13px;
          color:#fff;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.18);}
        .v2-sizes button.on{background:transparent;color:#fff;border-color:#fff;box-shadow:0 0 0 1px #fff;}


        /* ── Reaching 44 ───────────────────────────────────────────────────
           Every control below is drawn smaller than a finger on purpose. The
           expander is a centred ::before, so the hit area grows and nothing on
           screen moves. Declared last: several of these have a matching rule
           earlier in the sheet at equal specificity, and source order is what
           decides. Elements already absolutely positioned establish their own
           containing block and must not be reset. */
        .v2-discover,.v2-acc-pill,.v2-buy,.v2-pill,.v2-x,.v2-remove,.v2-qty button{position:relative;}
        .v2-bagbtn::before,.v2-back::before,.v2-x::before,.v2-bag-x::before,
        .v2-qty button::before,.v2f-x::before{content:'';position:absolute;left:50%;top:50%;
          width:44px;height:44px;transform:translate(-50%,-50%);}
        .v2-discover::before,.v2-acc-pill::before,.v2-remove::before{content:'';position:absolute;
          left:0;right:0;top:50%;height:44px;transform:translateY(-50%);}
        /* These two carry real labels, so they grow rather than hide a target
           behind a smaller drawing. */
        .v2-buy,.v2-pill{min-height:44px;}


        /* ── One material ──────────────────────────────────────────────────
           Everything that floats over content is the same pane of glass, so it
           takes the same edge as the composer: a hairline all the way round, a
           brighter line where light would catch the top, and a fainter one
           along the bottom for thickness. Before this there were three
           treatments and two surfaces with no edge at all, which is why the
           scroll pill beside the bar looked like a different substance.

           Two tiers, because they sit at two heights: the small pills rest just
           above the page, the docks and trays float well clear of it. Declared
           late so it settles the several rules above it that set box-shadow at
           the same specificity. */
        /* The scroll hint keeps the drop shadow but not the rim: it is a
           prompt, not a control, and an outlined pill directly above the
           composer competed with it. */
        .v2-hint{box-shadow:0 6px 20px rgba(0,0,0,.22);}
        .v2-acc-pill,.v2-inspire-cta,.v2-sug,.v2-crafting{
          box-shadow:
            0 6px 20px rgba(0,0,0,.22),
            inset 0 0 0 1px rgba(255,255,255,.18),
            inset 0 1.2px 0 rgba(255,255,255,.34),
            inset 0 -1px 0 rgba(255,255,255,.10);}
        .v2-cart,.v2-tray{
          box-shadow:
            0 14px 44px rgba(0,0,0,.34),
            0 2px 8px rgba(0,0,0,.16),
            inset 0 0 0 1px rgba(255,255,255,.18),
            inset 0 1px 0 rgba(255,255,255,.44),
            inset 0 -1px 0 rgba(255,255,255,.12);}

        @keyframes v2-rise{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
        @keyframes v2-fade{from{opacity:0}to{opacity:1}}


        /* Missing art reads as unphotographed paper, never as a broken tile:
           it keeps the element's exact geometry so layout never shifts when the
           real image lands. A faint diagonal grain keeps it from looking like a
           rendering failure. */
        /* A photograph that has not arrived yet. The sweep is what separates
           "loading" from "broken" — a still grey rectangle reads as a picture
           that failed, and this page can hold ten of them at once while the
           2048s come down. */
        .v2-img-ph{display:block;width:100%;height:100%;min-height:inherit;position:relative;overflow:hidden;
          background:
            repeating-linear-gradient(135deg,rgba(28,27,25,.028) 0 2px,transparent 2px 9px),
            linear-gradient(160deg,${V2.boneDeep} 0%,#DFDAD2 55%,${V2.boneDeep} 100%);}
        .v2-img-ph::after{content:'';position:absolute;inset:0;
          background:linear-gradient(100deg,transparent 20%,rgba(255,255,255,.55) 50%,transparent 80%);
          transform:translateX(-100%);animation:v2-sweep 1.5s ${V2.ease} infinite;}
        @keyframes v2-sweep{to{transform:translateX(100%)}}
        @media(prefers-reduced-motion:reduce){.v2-img-ph::after{animation:none;opacity:.3}}
        .v2-hero-media .v2-img-ph{position:absolute;inset:0;
          background:
            repeating-linear-gradient(135deg,rgba(255,255,255,.03) 0 2px,transparent 2px 10px),
            linear-gradient(165deg,#3B3833 0%,#2A2724 48%,#1E1C1A 100%);}
        .v2-shot .v2-img-ph,.v2-tile-btn .v2-img-ph{aspect-ratio:3/4;}
        .v2-pdp-img.v2-img-ph{aspect-ratio:3/4;}
        .v2-cart-thumb.v2-img-ph{width:56px;height:72px;border-radius:12px;}

        /* Nothing-found */
        .v2-empty{padding:clamp(90px,22vw,150px) 26px;text-align:center;display:flex;
          flex-direction:column;align-items:center;gap:20px;}
        .v2-empty h2{font-family:${V2.display};font-weight:600;letter-spacing:-.025em;font-size:clamp(26px,6.6vw,34px);margin:0;}
        .v2-empty p{font-size:14px;font-weight:400;color:${V2.ink70};margin:0;max-width:30ch;line-height:1.6;}
        /* A comparison is read across, so it is a grid with hairlines and no
           card around it — the page is already the card. The chosen column is
           marked by weight, not colour: "best" here is a judgement, not a
           status. */
        .v2-cmp{max-width:min(680px,92vw);margin:0 auto;padding:clamp(52px,12vw,88px) var(--grid-pad) 0;text-align:left;}
        .v2-cmp-grid{display:grid;gap:0;font-size:13px;line-height:1.5;}
        .v2-cmp-label{padding:12px 14px 12px 0;color:${V2.ink45};font-size:11px;letter-spacing:.04em;
          text-transform:uppercase;border-top:1px solid ${V2.hairline};white-space:nowrap;}
        .v2-cmp-cell{padding:12px 14px 12px 0;border-top:1px solid ${V2.hairline};color:${V2.ink70};}
        .v2-cmp-cell.won{color:${V2.ink};font-weight:500;}
        .v2-cmp-pick{margin:18px 0 0;font-size:14px;line-height:1.6;color:${V2.ink};}
        @media(min-width:760px){.v2-cmp-grid{font-size:14px;}}
        .v2-empty .v2-retry{min-height:44px;padding:0 20px;border-radius:12px;border:none;cursor:pointer;
          background:${V2.ink};color:${V2.bone};font-family:${V2.sans};font-size:14px;font-weight:500;
          transition:opacity .15s;}
        .v2-empty .v2-retry:hover{opacity:.86;}

        @media(min-width:760px){
          :root{--bar:129px;}
          .v2-tray{left:var(--col-l);right:auto;translate:none;width:var(--col-w);}
          /* The controls sit under the photographs and share their width, so
             the page reads as one column instead of a panel floating across the
             corner of the first shot. Same expression as .v2-pdp-col. */
          .v2-dock{left:50%;right:auto;translate:-50% 0;width:min(620px,58vw);}
          /* Only the product page narrows to a photo column; every other
             floating surface shares the composer's. */
          .v2-back{left:50%;margin-left:min(-310px,-29vw);}
          .v2-sugs{max-width:560px;margin:0 auto;}
          /* On a wide screen the sheet hugs its contents and centres, instead
             of stretching into a tall column of empty white. */
          .v2-bag{left:50%;right:auto;top:50%;bottom:auto;translate:-50% -50%;
            width:min(560px,92vw);height:auto;max-height:min(78vh,760px);}
        }

        /* ── Desktop / laptop ────────────────────────────────────────────────
           The reference desktop is a different composition, not the phone
           stretched: the menu button carries a text label, results become a
           full-height horizontal carousel under an editorial line, the product
           page scrolls its imagery sideways, and the legal lines split to
           opposite corners. */
        @media(min-width:1024px){
          :root{--bar:112px;}

          .v2-head{padding:20px 26px;gap:6px;}
          .v2-brand span{font-size:15px;}

          /* Hero: one-line headline, tighter card cluster */
          .v2-hero-copy h1{font-size:clamp(44px,4.4vw,64px);line-height:1.04;}
          .v2-hero-copy p{font-size:15px;}

          /* Results keep the phone's even grid on a wide screen — they used to
             become a full-bleed horizontal carousel, which ran edge to edge
             under the floating composer and read as content colliding with the
             bar. The column is bounded and centred instead, so the page has
             margins on a desktop the way it does on a phone. */
          .v2-results{max-width:1240px;margin:0 auto;padding-left:clamp(20px,3vw,44px);
            padding-right:clamp(20px,3vw,44px);}
          .v2-sec{padding:clamp(80px,7vw,120px) var(--grid-pad) 0;}
          .v2-sec h2{font-size:clamp(34px,3.1vw,46px);}
          .v2-mosaic{row-gap:30px;padding-top:40px;}
          .v2-tile .v2-bagbtn{bottom:44px;right:11px;}
          .v2-tile-name{padding:11px 3px 0;font-size:13px;}

          /* Exactly two grid columns and the gap between them, so the lead
             image's edges land on the tiles' edges rather than near them. It
             stays the biggest thing on the page without floating free of it. */
          .v2-sec-hero{max-width:calc(
            (100% - (var(--grid-cols) - 1) * var(--grid-gap)) / var(--grid-cols) * 2 + var(--grid-gap));}

          /* Product page: imagery scrolls sideways, one screen tall. The top
             inset is not decoration — the phone layout already cleared the
             floating header and this one did not, so the first photograph ran
             underneath the wordmark here while being clear of it there.
             border-box keeps the strip one screen tall with the inset inside
             it, so the pictures still fit without scrolling vertically. */
          /* The same page, wider. A measured column rather than the full
             window: a photograph stretched to 1600px is a worse photograph, and
             a product page that scrolls sideways is a filmstrip, which is what
             this was. */
          .v2-pdp{padding:calc(env(safe-area-inset-top,0px) + 92px) 0 340px;}
          .v2-pdp-col{width:min(620px,58vw);margin:0 auto;gap:6px;}

          /* Controls sit left-of-centre over that imagery, larger */
          .v2-acc-pill{font-size:12px;padding:9px 15px;}
          .v2-panel{max-height:52vh;
            display:grid;grid-template-columns:1.4fr 1fr;gap:26px;align-items:start;}
          .v2-panel-head{grid-column:1;}
          .v2-panel p{grid-column:1;}
          .v2-sku{grid-column:1;}
          .v2-nested{grid-column:2;grid-row:1/4;margin-top:0;padding-top:0;border-top:none;
            border-left:1px dashed ${V2.hairline};padding-left:26px;}
          .v2-back{left:26px;margin-left:0;top:76px;}

          .v2-cart{padding:15px;}
          .v2-cart-thumb{width:64px;height:82px;}
          .v2-cart-name{font-size:18px;}
          .v2-buy{padding:14px 30px;font-size:15px;}

          .v2-tray{left:50%;translate:-50% 0;width:min(620px,54vw);}
          /* The bar used to narrow to 44vw here. It keeps the chat composer's
             820px at every width instead — the tray sits above it rather than
             beside it, so there was nothing to make room for. */
          .v2-lookpage{padding-top:150px;}
          .v2-rail-item{width:clamp(260px,21vw,320px);}
          .v2-eyebrow{left:26px;top:150px;}
        }
      `}</style>
    </div>
  )
}
