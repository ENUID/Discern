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
import { ArrowUpIcon, BagIcon, ChevronIcon, CloseIcon, HeartIcon, HistoryIcon, PlusIcon } from '@/components/icons'
import { useSession } from 'next-auth/react'
import { V2, V2_PROMPTS, V2_SUGGESTIONS, V2_LOADING } from './theme'
import V2Auth, { type V2AuthReason } from './V2Auth'

// ── Types ────────────────────────────────────────────────────────────────────
export type V2Color = { name: string; code?: string; image: string; available?: boolean }
export type V2Product = {
  id: string
  title: string
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
  sizes?: string[]
  description?: string
  materials?: string
  howToStyle?: string
  details?: string
}
/** One exchange. The answer and the products it produced are one object,
 *  because they are one response — the reply used to be sliced to 90 characters
 *  as a caption and otherwise thrown away. */
export type V2Turn = {
  id: string
  question: string
  answer?: string
  didSearch: boolean
  sections: V2Section[]
}
/** Transcript entry sent back to the stylist so follow-ups have context. */
export type V2Msg = { role: 'user' | 'assistant'; content: string }
export type V2Section = { title: string; subtitle?: string; hero?: V2Product; products: V2Product[] }
export type V2CartLine = { product: V2Product; color?: string; size?: string; qty: number }

type View = 'home' | 'results' | 'product' | 'look'

// ── Keyboard offset ──────────────────────────────────────────────────────────
function useKeyboardOffset(): number {
  const [o, setO] = useState(0)
  useEffect(() => {
    const vv = (window as any).visualViewport; if (!vv) return
    const check = () => { const k = window.innerHeight - vv.height - vv.offsetTop; setO(k > 150 ? Math.round(k) : 0) }
    const blur = () => setTimeout(check, 150)
    vv.addEventListener('resize', check); vv.addEventListener('scroll', check)
    document.addEventListener('focusout', blur)
    return () => { vv.removeEventListener('resize', check); vv.removeEventListener('scroll', check); document.removeEventListener('focusout', blur) }
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
function Progress({ light }: { light?: boolean }) {
  return (
    <span className={`v2-prog ${light ? 'light' : ''}`} aria-hidden>
      <i />
    </span>
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

function Heart({ on, onClick, size = 34, ghost }: { on: boolean; onClick: (e: React.MouseEvent) => void; size?: number; ghost?: boolean }) {
  return (
    <button type="button" aria-label={on ? 'Saved' : 'Save'} onClick={onClick}
      className={`v2-heart ${ghost ? 'ghost' : ''}`} style={{ width: size, height: size }}>
      <HeartIcon size={Math.round(size * .44)} filled={on} />
    </button>
  )
}

// ── Component ────────────────────────────────────────────────────────────────
export default function DiscernV2({
  heroMedia = '/v2/hero.jpg', heroPoster, onQuery, onFeatured,
}: {
  heroMedia?: string; heroPoster?: string
  onQuery?: (q: string, history: V2Msg[]) => Promise<{
    sections: V2Section[]; look?: V2Product[]
    answer?: string; didSearch?: boolean; light?: boolean
  }>
  /** Real catalogue imagery for the three hero cards. Supplying this is what
   *  keeps the opening screen from depending on hand-placed jpgs. */
  onFeatured?: () => Promise<string[]>
}) {
  const [view, setView] = useState<View>('home')
  const [input, setInput] = useState('')
  const [focused, setFocused] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadPhase, setLoadPhase] = useState(0)
  // Turns, not sections. Each query used to replace the results wholesale, so
  // the previous answer and its products were destroyed on every follow-up.
  const [turns, setTurns] = useState<V2Turn[]>([])
  /** A one-line reply that surfaces at the composer and fades. Small talk must
   *  not become a spread in what is otherwise a lookbook. */
  const [look, setLook] = useState<V2Product[] | null>(null)
  const [lookOpen, setLookOpen] = useState(false)
  const [product, setProduct] = useState<V2Product | null>(null)
  // Saved kept the ids only, so there was no way to render a saved list even
  // though the hearts worked — the products themselves were thrown away. Keep
  // the piece, not just its id.
  const [saved, setSaved] = useState<Map<string, V2Product>>(new Map())
  const [savedOpen, setSavedOpen] = useState(false)
  const [histOpen, setHistOpen] = useState(false)
  const [asked, setAsked] = useState<string[]>([])
  const [photos, setPhotos] = useState<string[]>([])
  const { status: authStatus } = useSession()
  const [authReason, setAuthReason] = useState<V2AuthReason>(null)
  /** Ask for an account only at the moment one is genuinely needed, and say
   *  which moment it was. Returns false when the caller should stop. */
  const requireAccount = useCallback((why: Exclude<V2AuthReason, null>) => {
    if (authStatus === 'authenticated') return true
    setAuthReason(why)
    return false
  }, [authStatus])
  const [menuOpen, setMenuOpen] = useState(false)
  const [acc, setAcc] = useState<'materials' | 'style' | null>(null)
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
  const [cardSeed, setCardSeed] = useState(0)
  const [artwork, setArtwork] = useState<string[]>([])
  const [headHidden, setHeadHidden] = useState(false)

  // ── Focus containment ──────────────────────────────────────────────────────
  // Opening the bag used to leave the content behind it fully tabbable: Tab
  // walked through five hidden controls before it ever reached the sheet's own
  // Close button, then carried on out into the composer. A visual scrim is not
  // a focus boundary, so the background is marked `inert` while an overlay is
  // up. Set imperatively — React 18 does not accept `inert` as a prop.
  //
  // The header is only inerted for the bag, never for the menu: the menu's
  // toggle lives in the header and doubles as its close, so inerting it there
  // would trap the user with no way out.
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    // Whitelist by structure rather than by naming the background pieces: the
    // first attempt listed them and missed two (the scroll hint and the
    // composer are direct children of the root, not of .v2-scroll), so focus
    // still escaped. Anything not named here gets inerted.
    const live = bagOpen ? ['v2-bag', 'v2-bag-ov']
      : menuOpen ? ['v2-head', 'v2-menu', 'v2-ov']
      : null
    const touched: HTMLElement[] = []
    if (live) {
      for (const el of Array.from(root.children) as HTMLElement[]) {
        if (live.some(c => el.classList.contains(c))) continue
        el.setAttribute('inert', '')
        touched.push(el)
      }
    } else {
      // With nothing open the menu is still mounted. Its list items already
      // manage tabIndex, but the mailto link in its footer does not, so it
      // stayed in the tab order permanently.
      const menu = root.querySelector('.v2-menu') as HTMLElement | null
      if (menu) { menu.setAttribute('inert', ''); touched.push(menu) }
    }
    return () => touched.forEach(n => n.removeAttribute('inert'))
  }, [bagOpen, menuOpen])

  const taRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const lookRailRef = useRef<HTMLDivElement>(null)
  const kb = useKeyboardOffset()

  const barVar = useMeasuredVar('--bar', 96)

  const canSend = input.trim().length > 0
  const idle = !focused && input.length === 0
  const cartCount = cart.reduce((n, l) => n + l.qty, 0)
  const subtotal = cart.reduce((n, l) => n + (l.product.price ?? 0) * l.qty, 0)

  // ── Checkout ───────────────────────────────────────────────────────────────
  // Discern never takes payment: every line hands off to the brand that sells
  // it. The button had no handler at all, so the bag was a dead end — items in,
  // subtotal shown, nothing out. A bag can hold several brands, so this opens
  // one tab per distinct store rather than pretending there is a single basket.
  //
  // Browsers only reliably allow ONE window.open per user gesture, so anything
  // after the first is likely to be blocked. Rather than fail silently, blocked
  // stores are surfaced as real links the shopper can click themselves.
  const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, '') } catch { return u } }
  const payHosts = useMemo(
    () => Array.from(new Set(cart.map(l => l.product.storeUrl).filter((u): u is string => !!u))),
    [cart],
  )
  const checkout = useCallback(() => {
    if (!cart.length) return
    if (!payHosts.length) { setBlockedStores([]); return }
    const blocked: string[] = []
    payHosts.forEach((url, i) => {
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
  }, [cart, payHosts])

  // DETAILS reads as a short list of construction facts, one per line — split
  // whatever the catalog gives us on the separators it actually uses.
  const detailLines = useMemo(() => {
    const raw = product?.details || product?.materials || ''
    const parts = raw.split(/\s*[\n•;]\s*|\.\s+(?=[A-Z])/).map(s => s.trim()).filter(Boolean)
    return parts.length ? parts.slice(0, 8) : ['Made in Italy', 'Specialist clean only']
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

  const styleWith = useMemo(() => {
    if (!product) return []
    const pool = (look?.length ? look : sections.flatMap(s => [...(s.hero ? [s.hero] : []), ...s.products]))
    return pool.filter(p => p.id !== product.id && p.image).slice(0, 4)
  }, [product, look, sections])

  useEffect(() => {
    const el = taRef.current; if (!el) return
    el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 76) + 'px'
  }, [input, focused])

  // The wait is narrated as a sequence, not one frozen label: the phrases
  // cross-fade in order for as long as the work takes.
  useEffect(() => {
    if (!loading) return
    const t = setInterval(() => setLoadPhase(n => (n + 1) % V2_LOADING.length), 2100)
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
  }, [])

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

  // Takes the product, not an id — see the `saved` declaration. Saving is the
  // first thing that genuinely needs an account, so it is the first thing that
  // asks for one; un-saving never does.
  const toggleSave = useCallback((p: V2Product) => {
    const already = saved.has(p.id)
    if (!already && !requireAccount('save')) return
    setSaved(prev => {
      const n = new Map(prev)
      if (already) n.delete(p.id); else n.set(p.id, p)
      return n
    })
  }, [saved, requireAccount])

  /** Attached photos become object URLs for the strip; they are revoked when
   *  cleared so a long session does not leak them. */
  const addPhotos = useCallback((files: FileList | null) => {
    if (!files?.length) return
    const urls = Array.from(files).slice(0, 4).map(f => URL.createObjectURL(f))
    setPhotos(p => [...p, ...urls].slice(0, 4))
  }, [])
  const dropPhoto = useCallback((url: string) => {
    setPhotos(p => p.filter(u => u !== url))
    URL.revokeObjectURL(url)
  }, [])

  const run = useCallback(async (q: string) => {
    if (!q.trim() || loading) return
    setAsked(a => [q.trim(), ...a.filter(x => x !== q.trim())].slice(0, 12))
    taRef.current?.blur()
    setLoadPhase(0)
    setLoading(true); setLookOpen(false)
    const question = q.trim()
    // Clear the composer on send. It was only ever emptied by the manual Clear
    // button, so asking a second question appended it to the first.
    setInput('')
    // The transcript so far, so a follow-up like "cheaper" has something to
    // refine rather than arriving as a fresh conversation.
    const history: V2Msg[] = turns.slice(0, 4).reverse().flatMap(t => ([
      { role: 'user' as const, content: t.question },
      ...(t.answer ? [{ role: 'assistant' as const, content: t.answer }] : []),
    ]))
    try {
      const res = onQuery
        ? await onQuery(question, history)
        : { sections: [], look: undefined, answer: undefined, didSearch: false, light: false }
      const sections = res.sections ?? []

      // Nothing to show, and nothing was searched — a greeting, an aside. The
      // reference boutique answers every query with a selection or with
      // nothing; it never writes a sentence on the page. So this leaves the
      // shopper exactly where they were rather than inventing a surface to put
      // prose on.
      if (!sections.length && !res.didSearch) {
        setLoading(false)
        return
      }

      setTurns(prev => [{
        id: `${prev.length}-${question.slice(0, 24)}`,
        question, answer: res.answer, didSearch: res.didSearch === true, sections,
      }, ...prev].slice(0, 12))
      if (res.look?.length) { setLook(res.look); setLookOpen(true) }
    } catch (e) {
      // A failed lookup still lands on the results view — the empty state says
      // so plainly, which is calmer than an error dialog over the boutique.
      console.error('[v2] query failed:', e)
      setTurns(prev => [{ id: `err-${prev.length}`, question, didSearch: true, sections: [] }, ...prev])
    } finally {
      setView('results')
      scrollRef.current?.scrollTo({ top: 0 })
      setLoading(false)
    }
  }, [loading, onQuery, turns])

  // Browsing entries genuinely are searches. The rest are destinations, and
  // used to be searches for their own label.
  const MENU = [
    { label: 'New in',  go: () => run('new in') },
    { label: 'Women',   go: () => run('womenswear') },
    { label: 'Men',     go: () => run('menswear') },
    { label: 'Saved',   go: () => { if (requireAccount('save')) setSavedOpen(true) } },
    { label: 'Orders',  go: () => { if (requireAccount('orders')) setBagOpen(true) } },
    { label: 'Help',    go: () => run('how does Discern work') },
  ]

  const submit = () => run(input)

  const openProduct = (p: V2Product) => {
    setProduct(p); setAcc(null); setDetailsOpen(false)
    setColorMode(false); setSizeMode(false)
    setPickedColor(p.colors?.[0] ?? null); setPickedSize(null)
    setView('product')
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: 0 }))
  }

  const addToCart = () => {
    if (!product || adding) return
    setAdding(true)
    setTimeout(() => {
      setCart(c => [...c, { product, color: pickedColor?.name ?? product.colorName, size: pickedSize ?? undefined, qty: 1 }])
      setAdding(false); setColorMode(false); setSizeMode(false)
    }, 850)
  }

  const setQty = (i: number, d: number) =>
    setCart(c => c.map((l, x) => x === i ? { ...l, qty: Math.max(1, l.qty + d) } : l))

  const heroIsVideo = /\.(mp4|webm|mov)$/i.test(heroMedia)
  const pdpImages = useMemo(() => {
    if (!product) return []
    if (pickedColor?.image) return [pickedColor.image, ...(product.images ?? []).slice(1)]
    return product.images?.length ? product.images : [product.image]
  }, [product, pickedColor])
  const soldOut = pickedColor ? pickedColor.available === false : false

  return (
    <div className="v2-root" ref={rootRef} style={{ ...barVar.style }}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className={`v2-head ${view === 'home' ? '' : 'solid'} ${headHidden ? 'up' : ''}`}>
        {/* The trigger stays put and morphs into the close control while the
            menu is open, exactly as the reference does — you shut the menu
            from the button you opened it with. */}
        <button className={`v2-ic v2-menu-btn ${menuOpen ? 'x' : ''}`}
          aria-label={menuOpen ? 'Close menu' : 'Menu'} aria-expanded={menuOpen}
          onClick={() => setMenuOpen(v => !v)}>
          <svg width="18" height="18" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.67"
            strokeLinecap="round" fill="none" aria-hidden>
            {/* Three separately-classed bars, NOT the shared MenuIcon: the
                hamburger morphs into an X, and .v2-menu-btn.x animates these
                three paths individually. A single-path icon silently kills that
                transition. Weight still follows the app's optical constant. */}
            <path className="v2-bun-t" d="M3.6 7h16.8" /><path className="v2-bun-m" d="M3.6 12h16.8" /><path className="v2-bun-b" d="M3.6 17h16.8" />
          </svg>
          <em>{menuOpen ? 'Close' : 'Menu'}</em>
        </button>
        <button className="v2-ic" aria-label="History"
          onClick={() => setHistOpen(v => !v)} aria-expanded={histOpen}>
          <HistoryIcon size={18} />
        </button>
        <div className="v2-brand">
          <svg width="24" height="24" viewBox="0 0 40 40" fill="none" strokeLinecap="round" strokeLinejoin="round" stroke="currentColor" strokeWidth="2.08" aria-hidden>
            <path d="M20 5l9 7v16l-9 7-9-7V12z" /><path d="M20 12l4 3v10l-4 3-4-3V15z" /></svg>
          <span>DISCERN</span>
        </div>
        <button className="v2-ic" aria-label="Saved"
          onClick={() => { if (requireAccount('save')) setSavedOpen(true) }}>
          <HeartIcon size={18} />
          {saved.size > 0 && <i className="v2-dot" />}
        </button>
        <button className="v2-ic" aria-label="Bag" onClick={() => setBagOpen(true)}>
          <BagIcon size={18} />
          {cartCount > 0 && <i className="v2-dot" />}
        </button>
      </header>

      {/* Mini-bag chips — the pieces you've added, stacked top-right */}
      {cart.length > 0 && view === 'product' && (
        <div className="v2-minibag">
          {cart.slice(-2).map((l, i) => (
            <button key={i} onClick={() => setBagOpen(true)}><Img src={l.product.image} /></button>
          ))}
        </div>
      )}

      {/* ── Scroller ───────────────────────────────────────────────────────── */}
      <div className="v2-scroll" ref={scrollRef} onScroll={onScroll}>

        {/* 1 · HERO */}
        {view === 'home' && (
          <>
            <section className="v2-hero">
              <div className="v2-hero-media">
                {heroIsVideo ? <video src={heroMedia} poster={heroPoster} autoPlay muted loop playsInline /> : <Img src={heroMedia} />}
                <div className="v2-veil" />
              </div>
              {/* Three cards, unequal, the middle one tallest — and on a wide
                  screen a pair of arrows sits either side of the trio. */}
              <div className="v2-cards">
                <button className="v2-cards-nav prev" aria-label="Previous" onClick={() => setCardSeed(n => n - 1)}>‹</button>
                {[0, 1, 2].map(i => (
                  <figure key={i} className={`v2-card c${i}`}>
                    <Img src={artwork.length
                      ? artwork[(((cardSeed + i) % artwork.length) + artwork.length) % artwork.length]
                      : `/v2/card-${((cardSeed + i) % 3 + 3) % 3 + 1}.jpg`} />
                  </figure>
                ))}
                <button className="v2-cards-nav next" aria-label="Next" onClick={() => setCardSeed(n => n + 1)}>›</button>
              </div>
              <div className="v2-hero-copy">
                <h1><span>Know what</span> <span>to buy.</span></h1>
                <p>Describe what you want. Get an answer, not a list.</p>
              </div>
            </section>

            {/* 1b · COLLECTION — the editorial screen between the hero and the
                prompt panel: title, season line, and one pill into the
                suggestions. */}
            <section className="v2-hero v2-hero2">
              <div className="v2-hero-media"><Img src="/v2/hero-2.jpg" /><div className="v2-veil" /></div>
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
            <section className="v2-hero v2-hero3">
              <div className="v2-hero-media"><Img src="/v2/hero-3.jpg" /><div className="v2-veil" /></div>
              <div className="v2-hero-copy">
                <h1><span>Start</span> <span>anywhere.</span></h1>
                <p>Pick one, or ask for something else.</p>
              </div>
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
          <section className="v2-results">
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
              {turn.sections.length === 0 && turn.didSearch && (
                <div className="v2-empty">
                  <h2>No match</h2>
                  <p>Nothing in the catalogue genuinely fits that. Change the colour, fabric or budget and I’ll look again.</p>
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
                      <Heart on={saved.has(s.hero.id)} onClick={e => { e.stopPropagation(); toggleSave(s.hero!) }} />
                    </div>
                  )}
                  <button className="v2-discover" onClick={() => s.hero && openProduct(s.hero)}>
                    See all {s.title} <span aria-hidden>›</span>
                  </button>
                </div>

                {s.products.length > 0 && (
                  <>
                    {/* Desktop reads as an editorial line above a horizontal
                        carousel; phone keeps the masonry. Same markup, the
                        breakpoint swaps the layout. */}
                    <h3 className="v2-inspired v2-rise">More options</h3>
                    <div className="v2-mosaic">
                      {s.products.map((p, i) => (
                        <div key={p.id} className={`v2-tile ${i % 5 === 1 || i % 5 === 4 ? 'tall' : ''}`}>
                          <button className="v2-tile-btn" onClick={() => openProduct(p)}><Img src={p.image} alt={p.title} loading="lazy" /></button>
                          <Heart on={saved.has(p.id)} onClick={e => { e.stopPropagation(); toggleSave(p) }} />
                          <span className="v2-tile-name">{p.title} <i aria-hidden>›</i></span>
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
          <section className="v2-lookpage">
            <div className="v2-rail" ref={lookRailRef}>
              {look.map(p => (
                <div key={p.id} className="v2-rail-item">
                  <button className="v2-shot" onClick={() => openProduct(p)}><Img src={p.image} alt={p.title} /></button>
                  <Heart on={saved.has(p.id)} onClick={e => { e.stopPropagation(); toggleSave(p) }} />
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
          <section className="v2-pdp">
            {pdpImages.map((src, i) => <Img key={i} className="v2-pdp-img" src={src} />)}

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
                      <Heart on={saved.has(p.id)} onClick={e => { e.stopPropagation(); toggleSave(p) }} />
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
                <span>Materials</span>
                <button onClick={() => setAcc(null)} aria-label="Collapse">−</button>
              </div>
              {composition && <span className="v2-comp">{composition}</span>}
              <p>{product.materials || product.description || 'Composition details are being added for this piece.'}</p>
            </div>
          )}
          {acc === 'style' && (
            <div className="v2-panel light">
              <div className="v2-panel-head">
                <span>Wear it with</span>
                <button onClick={() => setAcc(null)} aria-label="Collapse">−</button>
              </div>
              {styleWith.length > 0 ? (
                <div className="v2-style-grid">
                  {styleWith.map(p => (
                    <button key={p.id} className="v2-style-cell" onClick={() => openProduct(p)}>
                      <Img src={p.image} alt={p.title} />
                      <i aria-hidden>+</i>
                    </button>
                  ))}
                </div>
              ) : (
                <p>{product.howToStyle || 'Works with straight trousers and a plain leather shoe.'}</p>
              )}
            </div>
          )}
          <div className="v2-acc">
            {(['materials', 'style'] as const).map(k => (
              <button key={k} className={`v2-acc-pill ${acc === k ? 'on' : ''}`} onClick={() => setAcc(acc === k ? null : k)}>
                {k === 'materials' ? 'Materials' : 'Wear it with'}<i aria-hidden>{acc === k ? '−' : '+'}</i>
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
            <button className="v2-picker-nav" aria-label="Back" onClick={() => setSizeMode(false)}>‹</button>
          </div>
        )}
        {colorMode && (
          <div className="v2-swatches">
            {(product.colors ?? []).map(c => (
              <button key={c.name} className={pickedColor?.name === c.name ? 'on' : ''} onClick={() => setPickedColor(c)}>
                <Img src={c.image} alt={c.name} />
              </button>
            ))}
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
            <Heart on={saved.has(product.id)} onClick={() => toggleSave(product)} />
          </>
        )}
        <div className="v2-cart-cta">
          <button className={`v2-buy ${soldOut ? 'off' : ''}`} onClick={addToCart} disabled={adding || soldOut}>
            {soldOut ? 'Unavailable' : adding ? <i className="v2-spin" /> : 'Add to cart'}
          </button>
          {product.colors?.length ? (
            <button className="v2-pill" onClick={() => { setColorMode(v => !v); setSizeMode(false) }}>See all colors</button>
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
            <Heart on={look.every(p => saved.has(p.id))} ghost onClick={() => look.forEach(p => toggleSave(p))} />
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

      {/* Scroll hint */}
      {(view === 'home' || view === 'look') && showScroll && !focused && (
        <button className="v2-hint" style={{ bottom: `calc(var(--bar) + ${kb}px)` }}
          onClick={() => scrollRef.current?.scrollBy({ top: window.innerHeight * .82, behavior: 'smooth' })}>
          <ChevronIcon size={13} />
          Scroll to explore
        </button>
      )}

      {/* Waiting has two shapes in the reference. The first search takes over
          the screen — there is nothing behind it worth keeping. Every search
          after that keeps your results on screen and narrates itself with a
          small pill instead. */}
      {loading && turns.length > 0 && (
        <div className="v2-crafting" style={{ bottom: `calc(var(--bar) + 54px + ${kb}px)` }}>
          <Progress light />
          <span>{V2_LOADING[loadPhase][0]}{V2_LOADING[loadPhase][1]}</span>
        </div>
      )}
      {loading && turns.length === 0 && (
        <div className="v2-loading">
          <h2 key={loadPhase}>{V2_LOADING[loadPhase][0]}<em>{V2_LOADING[loadPhase][1]}</em></h2>
          <Progress />
        </div>
      )}

      {/* Menu */}
      <div className={`v2-ov ${menuOpen ? 'on' : ''}`} onClick={() => setMenuOpen(false)} />
      <nav className={`v2-menu ${menuOpen ? 'on' : ''}`} aria-hidden={!menuOpen}>
        <span className="v2-eyebrow-s">Menu</span>
        {/* 'Saved', 'Orders' and 'Help' used to run a catalogue search for their
            own label, so tapping Help searched the shop for the word "help".
            Browsing entries still search; the rest go where they say. */}
        <ul>{MENU.map(m => (
          <li key={m.label}>
            <button tabIndex={menuOpen ? 0 : -1} onClick={() => { setMenuOpen(false); m.go() }}>
              {m.label}
            </button>
          </li>
        ))}</ul>
        <div className="v2-menu-meta">
          <a href="mailto:help@discern.com">help@discern.com</a>
        </div>
      </nav>

      {/* Saved — the hearts finally have somewhere to lead. Same sheet family as
          the bag, because both are "things you have set aside". */}
      {savedOpen && (
        <>
        <div className="v2-bag-ov" onClick={() => setSavedOpen(false)} />
        <div className="v2-bag">
          <button className="v2-bag-x" aria-label="Close" onClick={() => setSavedOpen(false)}>
            <CloseIcon size={15} />
          </button>
          <h2>Saved <em>({saved.size})</em></h2>
          {saved.size === 0 ? (
            <p className="v2-bag-empty">Nothing saved yet. Tap the heart on anything worth coming back to.</p>
          ) : (
            <div className="v2-saved-grid">
              {Array.from(saved.values()).map(p => (
                <div className="v2-saved-cell" key={p.id}>
                  <button className="v2-shot" onClick={() => { setSavedOpen(false); openProduct(p) }}>
                    <Img src={p.image} alt={p.title} />
                  </button>
                  <Heart on onClick={e => { e.stopPropagation(); toggleSave(p) }} />
                  <span className="v2-saved-name">{p.title}</span>
                  <span className="v2-saved-price">{money(p.price, p.currency)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        </>
      )}

      {/* History — this session's questions. The button existed with no handler;
          the list is the natural thing behind it. */}
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
            {cart.map((l, i) => (
              <div className="v2-line" key={i}>
                <Img src={l.product.image} />
                <div>
                  <span className="v2-line-name">{l.product.title}</span>
                  <span className="v2-line-price">{money(l.product.price, l.product.currency)}</span>
                  {l.color && <span className="v2-line-meta">Color: {l.color}</span>}
                  {l.size && <span className="v2-line-meta">Size: {l.size}</span>}
                  {l.product.sku && <span className="v2-line-sku">SKU: {l.product.sku}</span>}
                  <div className="v2-qty">
                    Quantity: <button onClick={() => setQty(i, -1)} aria-label="Decrease">−</button>
                    <b>{l.qty}</b>
                    <button onClick={() => setQty(i, 1)} aria-label="Increase">+</button>
                    <button className="v2-remove" onClick={() => setCart(c => c.filter((_, x) => x !== i))}>Remove</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="v2-bag-sum">
            <div><span>Shipping Costs</span><span>FREE</span></div>
            <div><span>Subtotal (tax incl.)</span><span>{money(subtotal)}</span></div>
          </div>
          <button className="v2-pay" onClick={checkout} disabled={!cart.length}>
            Checkout <span aria-hidden>↗</span>
          </button>
          <p className="v2-bag-note">
            {blockedStores.length
              ? 'Your browser blocked the new tab. Open the brand directly:'
              : payHosts.length > 1
                ? `Your bag spans ${payHosts.length} brands — each opens in its own tab.`
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
            <div className={`v2-bar ${focused ? 'focus' : ''}`}>
              {/* Was a button with no handler at all — it offered to take a photo
                  and did nothing. A label over a hidden input keeps the same
                  glyph and hit area while actually opening the picker. */}
              <label className="v2-plus" aria-label="Add a photo">
                <PlusIcon size={15} />
                <input type="file" accept="image/*" multiple hidden
                  onChange={e => addPhotos(e.target.files)} />
              </label>
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
              <div className="v2-field">
                <textarea ref={taRef} rows={1} value={input} onChange={e => setInput(e.target.value)}
                  onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }}
                  aria-label="Ask the boutique" />
                {input.length === 0 && (
                  idle
                    ? <div className="v2-marquee" aria-hidden><div>{[...V2_PROMPTS, ...V2_PROMPTS].map((p, i) => <span key={i}>{p}</span>)}</div></div>
                    : <span className="v2-ph">Ask anything…</span>
                )}
              </div>
              {input.length > 0 && (
                <button className="v2-clear" aria-label="Clear" onClick={() => { setInput(''); taRef.current?.focus() }}>
                  <CloseIcon size={12} />
                </button>
              )}
              <button className={`v2-send ${canSend ? 'on' : ''}`} aria-label="Send" onClick={submit} disabled={loading}>
                {loading ? <Progress light />
                  : <ArrowUpIcon size={15} />}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Legal line — the reference parks it at the very bottom of the window,
          under the bar: centred and stacked on a phone, split to the two
          corners on a wide screen. */}
      {view === 'home' && (
        <div className={`v2-foot ${focused ? 'off' : ''}`}>
          <span>© 2026 Discern</span>
          <span>Early access</span>
        </div>
      )}

      <style jsx global>{`
        :root{--bar:96px;}
        .v2-root{position:fixed;inset:0;background:${V2.bone};color:${V2.ink};font-family:${V2.sans};overflow:hidden;}

        /* Above the menu scrim (70): the trigger doubles as the close control,
           so it has to stay reachable while the menu is open. */
        .v2-head{position:absolute;top:0;left:0;right:0;z-index:72;display:flex;align-items:center;gap:2px;
          padding:calc(env(safe-area-inset-top,0px) + 12px) 12px 12px;color:#fff;
          background:linear-gradient(to bottom,rgba(0,0,0,.36),rgba(0,0,0,0));
          transition:color .45s ${V2.ease},background .45s ${V2.ease},transform .42s ${V2.ease},opacity .3s ${V2.ease};}
        .v2-head.up{transform:translateY(-102%);opacity:0;pointer-events:none;}
        .v2-head.solid{color:${V2.ink};background:linear-gradient(to bottom,${V2.bone} 60%,rgba(242,239,234,0));}
        .v2-ic{width:34px;height:34px;display:flex;align-items:center;justify-content:center;background:none;
          border:none;color:inherit;cursor:pointer;position:relative;-webkit-tap-highlight-color:transparent;}
        /* The circle stays 34px because that is the drawing; the touch target
           does not. This pseudo-element pads the hit area out to the 44px
           minimum without moving a pixel of what is on screen. */
        .v2-ic::before{content:'';position:absolute;left:50%;top:50%;width:44px;height:44px;
          transform:translate(-50%,-50%);}
        .v2-ic:active{transform:scale(.9);}
        .v2-brand{flex:1;display:flex;flex-direction:column;align-items:center;gap:1px;pointer-events:none;}
        .v2-brand span{font-family:${V2.display};font-size:12px;letter-spacing:.36em;text-indent:.36em;white-space:nowrap;}
        .v2-dot{position:absolute;top:6px;right:5px;width:5px;height:5px;border-radius:50%;background:currentColor;}

        /* ── A spread: one exchange, answer then evidence ─────────────────── */
        .v2-spread{margin:0 0 8vh;}
        .v2-spread:last-child{margin-bottom:4vh;}
        /* The answer sticks while its own products scroll past, so the question
           being answered is never off-screen and out of mind. */


        /* Saved grid — two up, image-led, the name and price quiet beneath. */
        .v2-saved-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px 12px;}
        .v2-saved-cell{position:relative;display:flex;flex-direction:column;}
        .v2-saved-cell .v2-shot{width:100%;aspect-ratio:3/4;overflow:hidden;border:none;padding:0;
          background:${V2.boneDeep};cursor:pointer;border-radius:8px;}
        .v2-saved-cell .v2-shot img{width:100%;height:100%;object-fit:cover;display:block;}
        .v2-saved-cell .v2-heart{position:absolute;top:6px;right:6px;}
        .v2-saved-name{font-size:12.5px;margin:9px 0 2px;line-height:1.3;}
        .v2-saved-price{font-size:12px;color:${V2.ink45};}
        @media(min-width:760px){.v2-saved-grid{grid-template-columns:repeat(3,1fr);}}

        /* History — same panel language as the menu, anchored under its button. */
        .v2-hist{position:absolute;z-index:80;left:12px;right:12px;
          top:calc(env(safe-area-inset-top,0px) + 52px);max-width:340px;
          background:${V2.glassDark};backdrop-filter:blur(22px);-webkit-backdrop-filter:blur(22px);
          border:1px solid ${V2.glassEdge};border-radius:16px;padding:18px 18px 14px;
          color:#fff;animation:v2-pop .34s ${V2.ease};max-height:66vh;overflow-y:auto;}
        .v2-hist ul{list-style:none;margin:8px 0 0;padding:0;display:flex;flex-direction:column;gap:2px;}
        .v2-hist li button{width:100%;text-align:left;background:none;border:none;cursor:pointer;
          color:#fff;font-family:${V2.sans};font-size:14px;line-height:1.4;padding:9px 8px;
          border-radius:8px;transition:background .18s ${V2.ease};}
        .v2-hist li button:hover{background:rgba(255,255,255,.1);}
        .v2-hist-empty{font-size:13px;color:rgba(255,255,255,.55);margin:10px 0 4px;}

        .v2-minibag{position:absolute;z-index:46;top:calc(env(safe-area-inset-top,0px) + 62px);right:12px;
          display:flex;gap:6px;padding:6px;border-radius:12px;background:${V2.glassDark};
          backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);animation:v2-rise .4s ${V2.ease};}
        .v2-minibag button{width:44px;height:56px;padding:0;border:none;border-radius:7px;overflow:hidden;cursor:pointer;
          background:none;box-shadow:inset 0 0 0 1px ${V2.glassEdge};}
        .v2-minibag img{width:100%;height:100%;object-fit:cover;display:block;}

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
        .v2-hero{position:relative;min-height:100svh;display:flex;flex-direction:column;justify-content:center;
          padding-bottom:calc(var(--bar) + 54px);padding-top:calc(env(safe-area-inset-top,0px) + 74px);}
        .v2-hero-media{position:absolute;inset:0;overflow:hidden;}
        .v2-hero-media img,.v2-hero-media video{width:100%;height:100%;object-fit:cover;display:block;}
        .v2-veil{position:absolute;inset:0;background:linear-gradient(to bottom,rgba(20,17,14,.44) 0%,rgba(20,17,14,.1) 30%,rgba(20,17,14,.56) 76%,rgba(20,17,14,.74) 100%);}
        .v2-cards{position:relative;z-index:2;display:flex;align-items:center;justify-content:center;gap:9px;
          padding:0 14px;margin:0 0 30px;}
        .v2-card{margin:0;width:28%;aspect-ratio:3/4;overflow:hidden;flex-shrink:0;
          box-shadow:0 18px 44px rgba(0,0,0,.36);animation:v2-float 7s ease-in-out infinite;}
        .v2-card img{width:100%;height:100%;object-fit:cover;display:block;animation:v2-swap 12s ease-in-out infinite;}
        /* The outer two mirror each other exactly. They were -1.5deg/+1.7deg at
           14px/18px, so the right card leaned 0.2deg further and sat 4px lower
           than the left — a lopsided fan reads as a mistake rather than as a
           casual stack, because the eye checks a symmetric arrangement against
           its own centre line. The float animation below still offsets their
           phase, which is what keeps the deck from looking mechanical. */
        .v2-card.c0{transform:translateY(16px) rotate(-1.6deg);animation-delay:-1.2s;}
        .v2-card.c0 img{animation-delay:-8s;}
        .v2-card.c1{width:36%;z-index:2;transform:translateY(-12px);}
        .v2-card.c1 img{animation-delay:-4s;}
        .v2-card.c2{transform:translateY(16px) rotate(1.6deg);animation-delay:-3.6s;}
        @keyframes v2-float{0%,100%{translate:0 0}50%{translate:0 -7px}}
        @keyframes v2-swap{0%,88%{opacity:1}94%{opacity:.35}100%{opacity:1}}
        @media(prefers-reduced-motion:reduce){.v2-card,.v2-card img{animation:none}}
        .v2-hero-copy{position:relative;z-index:2;text-align:center;color:#fff;padding:0 22px;}
        .v2-hero-copy h1{font-family:${V2.display};font-weight:600;font-size:clamp(34px,9.4vw,50px);line-height:1.05;letter-spacing:-.035em;
          margin:0 0 12px;text-shadow:0 2px 26px rgba(0,0,0,.42);}
        .v2-hero-copy h1 span{display:block;}
        .v2-hero-copy p{font-size:14px;font-weight:400;margin:0;opacity:.93;}
        /* Below the bar, hard against the bottom of the window. */
        .v2-foot{position:absolute;left:0;right:0;bottom:calc(env(safe-area-inset-bottom,0px) + 5px);z-index:51;
          display:flex;flex-direction:column;gap:2px;align-items:center;color:rgba(255,255,255,.5);
          font-size:10.5px;text-align:center;padding:0 16px;pointer-events:none;
          transition:opacity .3s ${V2.ease};}
        .v2-foot.off{opacity:0;}
        .v2-hero2,.v2-hero3{justify-content:flex-end;}
        .v2-hero3{padding-bottom:calc(var(--bar) + 20px);}
        .v2-hero2 .v2-hero-copy{margin-bottom:auto;margin-top:auto;}
        .v2-hero2{padding-bottom:calc(var(--bar) + 54px);}
        .v2-one span{display:block;}
        .v2-inspire-cta{margin-top:20px;padding:11px 22px;border:none;border-radius:999px;cursor:pointer;
          color:#fff;font-size:12.5px;font-weight:400;background:${V2.glassDark};
          backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);
          box-shadow:inset 0 0 0 1px ${V2.glassEdge};transition:background .22s ${V2.ease};}
        .v2-inspire-cta:hover{background:rgba(255,255,255,.18);}
        /* Arrows either side of the hero trio — wide screens only. */
        .v2-cards-nav{display:none;position:absolute;top:50%;translate:0 -50%;z-index:3;
          width:34px;height:34px;border:none;border-radius:50%;cursor:pointer;color:#fff;font-size:17px;
          background:rgba(255,255,255,.12);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
          transition:background .2s ${V2.ease};}
        .v2-cards-nav:hover{background:rgba(255,255,255,.24);}
        .v2-cards-nav.prev{left:calc(50% - 340px);}
        .v2-cards-nav.next{right:calc(50% - 340px);}
        .v2-sugs{position:relative;z-index:2;display:flex;flex-direction:column;gap:9px;padding:22px 14px 0;}
        .v2-sug{text-align:left;padding:13px 18px;border:none;border-radius:999px;cursor:pointer;color:#fff;
          font-size:13.5px;font-weight:400;background:${V2.glassDark};
          backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);
          box-shadow:inset 0 0 0 1px ${V2.glassEdge};transition:background .2s ${V2.ease};}
        .v2-sug:active{background:rgba(255,255,255,.2);}

        /* Results */
        .v2-results{padding-bottom:calc(var(--bar) + 44px);}
        .v2-sec{padding:clamp(60px,15vw,100px) 20px 0;text-align:center;}
        .v2-sec h2{font-family:${V2.display};font-weight:600;letter-spacing:-.03em;font-size:clamp(27px,7.4vw,38px);line-height:1.1;margin:0 0 8px;}
        .v2-sec p{font-size:14px;font-weight:400;color:${V2.ink70};margin:0 0 28px;}
        .v2-sec-hero{position:relative;margin:0 auto;max-width:min(420px,88vw);}
        .v2-shot{display:block;width:100%;padding:0;border:none;background:${V2.boneDeep};cursor:pointer;}
        .v2-shot img{width:100%;aspect-ratio:3/4;object-fit:cover;display:block;}
        .v2-sec-hero .v2-heart{position:absolute;right:12px;bottom:12px;}
        .v2-discover{display:inline-flex;align-items:center;gap:7px;margin-top:15px;background:none;border:none;
          cursor:pointer;color:${V2.ink};font-size:14.5px;padding:6px 2px;}
        .v2-discover span{font-size:17px;line-height:1;}

        .v2-mosaic{display:grid;grid-template-columns:1fr 1fr;gap:3px;padding:32px 3px 0;align-items:start;}
        @media(min-width:760px){.v2-mosaic{grid-template-columns:repeat(3,1fr);}}
        @media(min-width:1180px){.v2-mosaic{grid-template-columns:repeat(4,1fr);}}
        .v2-tile{position:relative;background:${V2.boneDeep};}
        .v2-tile-btn{display:block;width:100%;padding:0;border:none;background:none;cursor:pointer;}
        .v2-tile img{width:100%;aspect-ratio:3/4;object-fit:cover;display:block;transition:transform .7s ${V2.ease};}
        .v2-tile.tall img{aspect-ratio:2/3;}
        @media(hover:hover){.v2-tile:hover img{transform:scale(1.035);}}
        .v2-tile .v2-heart{position:absolute;right:9px;bottom:38px;}
        .v2-tile-name{display:block;padding:9px 5px 16px;font-size:12.5px;text-align:left;}
        .v2-tile-name i{font-style:normal;color:${V2.ink45};}

        /* Look page */
        .v2-lookpage{padding:calc(env(safe-area-inset-top,0px) + 108px) 0 calc(var(--bar) + 70px);}
        .v2-rail{display:flex;gap:12px;overflow-x:auto;padding:0 16px;scroll-snap-type:x mandatory;scrollbar-width:none;}
        .v2-rail::-webkit-scrollbar{display:none;}
        .v2-rail-item{position:relative;flex:0 0 auto;width:min(66vw,260px);scroll-snap-align:center;}
        .v2-rail-item .v2-heart{position:absolute;right:10px;top:calc(100% - 78px);}
        .v2-rail-name{display:block;padding:10px 2px 0;font-size:12.5px;}
        .v2-rail-name i{font-style:normal;color:${V2.ink45};}
        .v2-rail-nav{display:flex;gap:12px;justify-content:center;padding-top:22px;}
        .v2-rail-nav button{width:34px;height:34px;border-radius:50%;border:1px solid ${V2.hairline};
          background:none;cursor:pointer;font-size:16px;color:${V2.ink};line-height:1;}
        .v2-eyebrow{position:absolute;z-index:44;top:calc(env(safe-area-inset-top,0px) + 108px);left:20px;
          font-size:10.5px;letter-spacing:.16em;color:${V2.ink70};}

        /* PDP */
        .v2-pdp{padding-bottom:300px;}
        .v2-pdp-img{width:100%;display:block;background:${V2.boneDeep};}
        .v2-back{position:absolute;z-index:45;top:calc(env(safe-area-inset-top,0px) + 56px);left:14px;display:flex;
          align-items:center;gap:6px;padding:7px 14px 7px 11px;border:none;border-radius:999px;cursor:pointer;
          font-size:12.5px;color:${V2.ink};background:${V2.glassLight};
          backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);box-shadow:0 3px 16px rgba(0,0,0,.10);}
        .v2-back span{font-size:17px;line-height:1;}

        /* One column: panel, pills, tray. Nothing here is positioned against
           anything else, so nothing here can land on top of anything else. */
        .v2-dock{position:absolute;z-index:52;left:12px;right:12px;display:flex;flex-direction:column;
          align-items:stretch;gap:10px;margin-bottom:calc(env(safe-area-inset-bottom,0px) + 14px);}
        .v2-acc{display:flex;gap:9px;}
        .v2-acc-pill{display:inline-flex;align-items:center;gap:7px;padding:8px 13px;border:none;border-radius:999px;
          cursor:pointer;font-size:11.5px;letter-spacing:0;font-weight:500;color:#fff;background:${V2.glassDark};
          backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);}
        .v2-acc-pill i{font-style:normal;font-size:12px;opacity:.85;}
        .v2-acc-pill.on{background:rgba(28,27,25,.85);}
        .v2-panel{max-height:42vh;overflow-y:auto;
          padding:16px 18px;border-radius:18px;color:#fff;background:${V2.glassDark};
          backdrop-filter:blur(22px);-webkit-backdrop-filter:blur(22px);
          box-shadow:0 14px 44px rgba(0,0,0,.3);animation:v2-rise .3s ${V2.ease};}
        .v2-panel-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;}
        .v2-panel-head span{font-size:11.5px;letter-spacing:0;font-weight:500;opacity:.8;}
        .v2-panel-head button{background:none;border:none;font-size:17px;cursor:pointer;color:inherit;opacity:.75;line-height:1;}
        .v2-panel p{font-size:13.5px;line-height:1.62;font-weight:400;margin:0;}
        /* HOW TO STYLE lifts a light card instead of the dark one. */
        .v2-panel.light{color:${V2.ink};background:${V2.glassLight};border:1px solid rgba(255,255,255,.5);max-height:38vh;}
        .v2-style-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;}
        .v2-style-cell{position:relative;padding:0;border:none;cursor:pointer;background:rgba(255,255,255,.55);
          aspect-ratio:1/1;overflow:hidden;border-radius:4px;}
        .v2-style-cell img,.v2-style-cell .v2-img-ph{width:100%;height:100%;object-fit:cover;display:block;}
        .v2-style-cell i{position:absolute;right:6px;bottom:6px;width:19px;height:19px;border-radius:50%;
          background:rgba(255,255,255,.9);color:${V2.ink};font-style:normal;font-size:13px;line-height:19px;
          text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.18);}
        .v2-sku{display:block;margin-top:14px;font-size:11px;opacity:.6;}
        .v2-comp{display:block;margin-bottom:8px;font-size:12px;letter-spacing:.06em;}

        /* The quiet, in-place "still working" note for follow-up searches. */
        .v2-crafting{position:absolute;z-index:45;left:50%;translate:-50% 0;display:flex;align-items:center;gap:9px;
          padding:8px 15px;border-radius:999px;color:#fff;background:${V2.glassDark};
          backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);
          box-shadow:inset 0 0 0 1px ${V2.glassEdge};font-size:12.5px;font-weight:400;white-space:nowrap;
          animation:v2-fade .3s ${V2.ease};}

        /* In-flow dashed card at the foot of the product page. */
        .v2-doc{margin:34px 16px 0;padding:2px 18px 6px;border-top:1px solid ${V2.hairline};border-bottom:1px solid ${V2.hairline};}
        .v2-doc-row{display:flex;width:100%;justify-content:space-between;align-items:center;background:none;
          border:none;padding:15px 0;cursor:pointer;color:inherit;font-size:13px;font-weight:500;}
        .v2-doc-row i{font-style:normal;font-size:15px;opacity:.6;}
        .v2-doc-body p{margin:0 0 14px;font-size:13.5px;line-height:1.62;font-weight:400;}
        .v2-doc-sku{display:block;margin-bottom:12px;font-size:11px;color:${V2.ink45};}
        .v2-doc-list{list-style:none;margin:0 0 14px;padding:0;display:flex;flex-direction:column;gap:5px;}
        .v2-doc-list li{font-size:13px;line-height:1.5;font-weight:400;}
        .v2-other{margin-top:38px;}
        .v2-eyebrow-in{font-size:12.5px;font-weight:500;color:${V2.ink45};text-align:center;margin-bottom:16px;}
        .v2-nested{margin-top:16px;padding-top:12px;border-top:1px solid rgba(255,255,255,.16);}
        .v2-nested button{display:flex;width:100%;justify-content:space-between;align-items:center;background:none;
          border:none;padding:0;cursor:pointer;font-size:10.5px;letter-spacing:.15em;color:inherit;opacity:.75;}
        .v2-nested i{font-style:normal;font-size:15px;}
        .v2-nested-body{margin-top:10px !important;font-size:13px !important;}

        /* Trays */
        .v2-tray{position:absolute;z-index:42;left:12px;right:12px;padding:9px;border-radius:18px;color:#fff;
          background:${V2.glassDark};backdrop-filter:blur(22px);-webkit-backdrop-filter:blur(22px);
          box-shadow:0 14px 44px rgba(0,0,0,.3);animation:v2-rise .4s ${V2.ease};}
        .v2-tray-row{display:flex;gap:8px;}
        .v2-chip{flex:1;min-width:0;aspect-ratio:1/1;padding:0;border:none;border-radius:8px;overflow:hidden;
          background:rgba(255,255,255,.1);cursor:pointer;box-shadow:inset 0 0 0 1px ${V2.glassEdge};}
        .v2-chip img{width:100%;height:100%;object-fit:cover;display:block;}
        .v2-tray-row .v2-heart.ghost{flex:1;height:auto;aspect-ratio:1/1;border-radius:8px;color:#fff;
          background:rgba(255,255,255,.06);box-shadow:inset 0 0 0 1px ${V2.glassEdge};}
        .v2-tray-cta{display:flex;gap:7px;margin-top:8px;align-items:center;}

        .v2-pill{flex:1;min-width:0;padding:10px 6px;border:none;border-radius:999px;cursor:pointer;font-size:11.5px;
          color:#fff;background:rgba(255,255,255,.16);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
          transition:background .18s ${V2.ease};}
        .v2-pill:active{background:rgba(255,255,255,.26);}
        .v2-x{width:34px;height:34px;flex-shrink:0;border:none;border-radius:50%;cursor:pointer;display:flex;
          align-items:center;justify-content:center;color:#fff;background:rgba(255,255,255,.16);}
        .v2-heart{border:none;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;
          color:${V2.ink};background:rgba(255,255,255,.8);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
          box-shadow:0 2px 10px rgba(0,0,0,.13);transition:transform .16s ${V2.ease};}
        .v2-heart:active{transform:scale(.88);}

        .v2-hint{position:absolute;z-index:41;left:50%;translate:-50% 0;margin-bottom:14px;display:inline-flex;align-items:center;gap:9px;
          padding:11px 20px;border:none;border-radius:999px;cursor:pointer;font-size:13.5px;color:#fff;
          background:${V2.glassDark};backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);animation:v2-fade .6s ${V2.ease};}

        /* Loading */
        .v2-loading{position:absolute;left:0;right:0;top:0;bottom:calc(var(--bar) - 10px);z-index:39;
          background:${V2.bone};display:flex;flex-direction:column;
          align-items:center;justify-content:center;gap:26px;padding:0 24px;animation:v2-fade .35s ${V2.ease};}
        .v2-loading h2{font-family:${V2.display};font-weight:600;font-size:clamp(24px,6.4vw,32px);letter-spacing:-.03em;margin:0;
          animation:v2-phrase .5s ${V2.ease};}
        @keyframes v2-phrase{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
        .v2-loading h2 em{font-style:normal;color:${V2.ink45};}
        .v2-prog{display:block;width:132px;height:2px;border-radius:2px;overflow:hidden;
          background:rgba(26,26,28,.12);}
        .v2-prog.light{width:26px;background:rgba(255,255,255,.24);}
        .v2-prog i{display:block;width:40%;height:100%;border-radius:2px;background:${V2.ink};
          animation:v2-sweep 1.15s ${V2.easeInOut} infinite;}
        .v2-prog.light i{background:#fff;}
        @keyframes v2-sweep{0%{transform:translateX(-100%)}100%{transform:translateX(250%)}}

        /* Menu + overlay */
        .v2-ov{position:absolute;inset:0;z-index:70;background:rgba(16,14,12,0);pointer-events:none;transition:background .42s ${V2.ease};}
        .v2-ov.on{background:rgba(16,14,12,.46);pointer-events:auto;backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);}
        /* The menu grows out of the trigger it was opened from rather than
           sliding in as a slab — origin top-left, scale + fade, one easing. */
        .v2-menu{position:absolute;z-index:71;left:12px;top:calc(env(safe-area-inset-top,0px) + 52px);
          width:min(320px,calc(100% - 24px));border-radius:16px;color:#fff;background:${V2.glassDark};
          backdrop-filter:blur(26px);-webkit-backdrop-filter:blur(26px);
          border:1px solid ${V2.glassEdge};box-shadow:0 26px 70px rgba(0,0,0,.34);
          padding:22px 22px 20px;display:flex;flex-direction:column;gap:20px;
          transform-origin:top left;transform:scale(.9);opacity:0;pointer-events:none;
          transition:transform .42s ${V2.ease},opacity .3s ${V2.ease};}
        .v2-menu.on{transform:none;opacity:1;pointer-events:auto;}
        .v2-eyebrow-s{font-size:12px;font-weight:500;opacity:.5;}
        .v2-menu ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:11px;}
        .v2-menu li button{font-family:${V2.display};font-size:26px;font-weight:500;letter-spacing:-.025em;cursor:pointer;
          background:none;border:none;padding:0;color:inherit;text-align:left;line-height:1.18;
          transition:opacity .2s ${V2.ease};}
        .v2-menu li button:hover{opacity:.62;}
        .v2-menu-meta{display:flex;justify-content:space-between;gap:18px;padding-top:16px;
          border-top:1px solid rgba(255,255,255,.16);font-size:12px;}
        .v2-menu-meta div{display:flex;flex-direction:column;gap:5px;}
        .v2-menu-meta div:first-child{opacity:.55;}
        .v2-menu-meta a{color:inherit;text-decoration:none;}
        .v2-menu-cta{display:flex;align-items:center;gap:10px;justify-content:center;cursor:pointer;
          padding:14px;border:1px solid rgba(255,255,255,.28);border-radius:2px;background:none;
          color:#fff;font-size:11px;letter-spacing:.16em;transition:background .24s ${V2.ease};}
        .v2-menu-cta:hover{background:rgba(255,255,255,.1);}
        /* Hamburger → ✕ on the trigger itself. */
        .v2-menu-btn svg path{transition:transform .34s ${V2.ease},opacity .2s ${V2.ease};transform-origin:center;}
        .v2-menu-btn.x .v2-bun-t{transform:translateY(5px) rotate(45deg);}
        .v2-menu-btn.x .v2-bun-b{transform:translateY(-5px) rotate(-45deg);}
        .v2-menu-btn.x .v2-bun-m{opacity:0;}

        /* Bag sheet */
        .v2-bag-ov{position:absolute;inset:0;z-index:79;background:rgba(20,18,16,.34);
          backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);animation:v2-fade .3s ${V2.ease};}
        /* Scales up from the centre rather than sliding, and stops short of the
           edges so the blurred boutique stays visible around it. */
        .v2-bag{position:absolute;z-index:80;inset:calc(env(safe-area-inset-top,0px) + 54px) 12px
          calc(env(safe-area-inset-bottom,0px) + 16px);background:#fff;overflow-y:auto;border-radius:16px;
          padding:26px 22px 30px;box-shadow:0 30px 90px rgba(0,0,0,.4);
          animation:v2-pop .42s ${V2.ease};transform-origin:center;}
        @keyframes v2-pop{from{opacity:0;transform:scale(.86)}to{opacity:1;transform:none}}
        .v2-bag-x{position:absolute;top:22px;right:20px;width:32px;height:32px;
          border:none;background:none;cursor:pointer;color:${V2.ink};}
        .v2-bag h2{font-family:${V2.display};font-weight:600;font-size:24px;letter-spacing:-.025em;margin:0 0 26px;}
        .v2-bag h2 em{font-style:normal;}
        .v2-bag-empty{font-size:14px;color:${V2.ink45};}
        .v2-line{display:flex;gap:14px;padding-bottom:22px;margin-bottom:22px;}
        .v2-line>img{width:74px;height:98px;object-fit:cover;flex-shrink:0;background:${V2.boneDeep};}
        .v2-line>div{display:flex;flex-direction:column;gap:3px;min-width:0;}
        .v2-line-name{font-size:14.5px;}
        .v2-line-price{font-size:14px;margin-bottom:6px;}
        .v2-line-meta{font-size:12.5px;color:${V2.ink70};}
        .v2-line-sku{font-size:11px;color:${V2.ink45};}
        .v2-qty{display:flex;align-items:center;gap:7px;margin-top:8px;font-size:12.5px;color:${V2.ink70};}
        .v2-qty button{width:20px;height:20px;border:none;background:none;cursor:pointer;font-size:14px;color:${V2.ink70};}
        .v2-qty b{font-weight:400;color:${V2.ink};}
        .v2-remove{width:auto !important;margin-left:8px;text-decoration:underline;font-size:12.5px !important;}
        .v2-bag-sum{border-top:1px solid ${V2.hairline};padding-top:16px;display:flex;flex-direction:column;gap:9px;margin-bottom:22px;}
        .v2-bag-sum div{display:flex;justify-content:space-between;font-size:13.5px;}
        .v2-pay{width:100%;padding:16px;border:none;border-radius:12px;background:${V2.ink};color:#fff;cursor:pointer;
          font-size:14px;font-weight:500;display:flex;align-items:center;justify-content:center;gap:10px;}
        /* An empty bag must not offer a live Checkout — it was fully clickable
           at zero items, which is a promise the button could not keep. */
        .v2-pay:disabled{opacity:.34;cursor:not-allowed;}
        .v2-bag-note{font-size:11.5px;line-height:1.5;color:${V2.ink45};text-align:center;margin:14px 0 0;}
        /* Only rendered when the browser refused a tab, so the shopper still has
           a way through to the brand. */
        .v2-bag-fallback{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin:10px 0 0;}
        .v2-bag-fallback a{font-size:12px;padding:7px 12px;border-radius:999px;
          border:1px solid rgba(0,0,0,.14);color:inherit;text-decoration:none;}
        .v2-bag-fallback a:hover{background:rgba(0,0,0,.05);}

        /* Bar */
        .v2-bar-wrap.home{padding-bottom:calc(env(safe-area-inset-bottom,0px) + 38px);}
        .v2-bar-wrap{position:absolute;z-index:50;left:0;right:0;
          padding:14px clamp(12px,3.6vw,18px) calc(env(safe-area-inset-bottom,0px) + 16px);pointer-events:none;}
        .v2-bar-wrap>*{pointer-events:auto;}
        .v2-bar{display:flex;align-items:flex-end;gap:8px;padding:7px 7px 7px 9px;width:100%;
          max-width:min(680px,96vw);margin:0 auto;border-radius:30px;color:#fff;background:${V2.glassDark};
          backdrop-filter:blur(26px) saturate(150%);-webkit-backdrop-filter:blur(26px) saturate(150%);
          box-shadow:0 10px 40px rgba(0,0,0,.26),inset 0 1px 0 ${V2.glassEdge};transition:background .3s ${V2.ease};}
        .v2-bar.focus{background:rgba(26,24,21,.9);}
        .v2-plus,.v2-send,.v2-clear{flex-shrink:0;border:none;cursor:pointer;display:flex;align-items:center;
          justify-content:center;border-radius:50%;color:#fff;transition:background .2s ${V2.ease},transform .12s ${V2.ease};}
        .v2-plus{width:38px;height:38px;background:rgba(255,255,255,.13);
          display:flex;align-items:center;justify-content:center;border-radius:50%;
          cursor:pointer;flex-shrink:0;color:inherit;}
        .v2-plus:active{transform:scale(.9);}
        /* Attached photos sit above the field, inside the same glass bar. */
        .v2-shots{display:flex;gap:7px;flex-wrap:wrap;width:100%;order:-1;margin:0 0 9px;}
        .v2-shot-chip{position:relative;width:44px;height:44px;border-radius:8px;overflow:hidden;}
        .v2-shot-chip img{width:100%;height:100%;object-fit:cover;display:block;}
        .v2-shot-chip button{position:absolute;top:2px;right:2px;width:15px;height:15px;
          display:flex;align-items:center;justify-content:center;border:none;border-radius:50%;
          background:rgba(0,0,0,.62);cursor:pointer;padding:0;}
        .v2-plus:active{transform:scale(.9);}
        .v2-clear{width:26px;height:26px;margin-bottom:6px;background:rgba(255,255,255,.16);}
        .v2-send{width:33px;height:33px;background:rgba(255,255,255,.13);
          transition:transform .16s ${V2.ease},background .2s ${V2.ease};}
        .v2-send:active{transform:scale(.86);}
        .v2-bar-press{transform-origin:center bottom;transition:transform .2s ${V2.ease};}
        .v2-bar-press:active{transform:scale(.985);}
        .v2-send.on{background:#fff;color:${V2.ink};}
        .v2-field{position:relative;flex:1;min-width:0;padding:9px 0 8px;overflow:hidden;}
        .v2-field textarea{width:100%;border:none;background:none;outline:none;resize:none;font-family:${V2.sans};
          font-size:16px;line-height:1.42;color:#fff;max-height:76px;overflow-y:auto;display:block;caret-color:#fff;}
        .v2-ph{position:absolute;left:0;top:9px;pointer-events:none;font-size:16px;line-height:1.42;color:rgba(255,255,255,.6);}
        /* Idle prompt drifts continuously, matching the reference ticker. */
        .v2-marquee{position:absolute;left:0;right:0;top:9px;pointer-events:none;overflow:hidden;
          mask-image:linear-gradient(to right,transparent,#000 9%,#000 91%,transparent);
          -webkit-mask-image:linear-gradient(to right,transparent,#000 9%,#000 91%,transparent);}
        .v2-marquee>div{display:flex;gap:44px;width:max-content;animation:v2-drift 44s linear infinite;}
        .v2-marquee span{font-size:16px;line-height:1.42;color:rgba(255,255,255,.6);white-space:nowrap;}
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
          grid-template-columns:auto 1fr auto;gap:11px;align-items:center;padding:12px;border-radius:22px;color:#fff;
          background:${V2.glassDark};backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);
          box-shadow:0 14px 44px rgba(0,0,0,.32);animation:v2-rise .42s ${V2.ease};}
        .v2-cart.tall{grid-template-columns:1fr;}
        .v2-cart-thumb{width:56px;height:72px;object-fit:cover;border-radius:8px;display:block;box-shadow:inset 0 0 0 1px ${V2.glassEdge};}
        .v2-cart-meta{min-width:0;display:flex;flex-direction:column;gap:3px;}
        .v2-cart-name{font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
        .v2-cart-price{font-size:12px;display:flex;gap:8px;align-items:baseline;}
        .v2-cart-price em{font-style:normal;text-decoration:line-through;opacity:.55;font-size:11px;}
        .v2-cart-price em::before{content:'|';text-decoration:none;display:inline-block;margin-right:8px;opacity:.7;}
        .v2-cart-color{font-size:11.5px;opacity:.72;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
        .v2-cart-cta{grid-column:1/-1;display:flex;gap:8px;align-items:center;margin-top:2px;}
        .v2-buy{flex-shrink:0;padding:11px 16px;border:none;border-radius:999px;cursor:pointer;background:#fff;
          color:${V2.ink};font-size:12.5px;min-width:92px;display:flex;align-items:center;justify-content:center;
          transition:transform .12s ${V2.ease};}
        .v2-buy:active{transform:scale(.97);}
        .v2-buy.off{background:rgba(255,255,255,.3);color:rgba(255,255,255,.75);cursor:default;}
        .v2-spin{width:15px;height:15px;border-radius:50%;border:1.6px solid ${V2.ink45};border-top-color:${V2.ink};
          animation:v2-rot .7s linear infinite;display:block;}
        @keyframes v2-rot{to{transform:rotate(360deg)}}

        .v2-swatches{display:flex;gap:9px;padding:2px;}
        .v2-swatches button{flex:1;aspect-ratio:3/4;padding:0;border:none;border-radius:9px;overflow:hidden;
          cursor:pointer;background:rgba(255,255,255,.08);box-shadow:inset 0 0 0 1px ${V2.glassEdge};}
        .v2-swatches button.on{box-shadow:0 0 0 2px #fff;}
        .v2-swatches img{width:100%;height:100%;object-fit:cover;display:block;}
        .v2-picker{position:relative;padding:4px 2px 2px;text-align:center;}
        .v2-picker-t{display:block;font-size:13px;opacity:.85;margin-bottom:14px;}
        .v2-sizes{display:flex;gap:10px;overflow-x:auto;scrollbar-width:none;padding:0 4px 4px;justify-content:center;}
        .v2-sizes::-webkit-scrollbar{display:none;}
        .v2-sizes button{flex:0 0 auto;width:44px;height:44px;border-radius:50%;cursor:pointer;font-size:13.5px;
          color:#fff;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.18);}
        .v2-sizes button.on{background:transparent;color:#fff;border-color:#fff;box-shadow:0 0 0 1px #fff;}
        .v2-picker-nav{position:absolute;left:2px;bottom:2px;width:30px;height:30px;border-radius:50%;border:none;
          cursor:pointer;color:#fff;background:rgba(255,255,255,.14);font-size:15px;line-height:1;}

        @keyframes v2-rise{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
        @keyframes v2-fade{from{opacity:0}to{opacity:1}}

        .v2-menu-btn em{display:none;}
        .v2-inspired{display:none;}

        /* Missing art reads as unphotographed paper, never as a broken tile:
           it keeps the element's exact geometry so layout never shifts when the
           real image lands. A faint diagonal grain keeps it from looking like a
           rendering failure. */
        .v2-img-ph{display:block;width:100%;height:100%;min-height:inherit;
          background:
            repeating-linear-gradient(135deg,rgba(28,27,25,.028) 0 2px,transparent 2px 9px),
            linear-gradient(160deg,${V2.boneDeep} 0%,#DFDAD2 55%,${V2.boneDeep} 100%);}
        .v2-hero-media .v2-img-ph{position:absolute;inset:0;
          background:
            repeating-linear-gradient(135deg,rgba(255,255,255,.03) 0 2px,transparent 2px 10px),
            linear-gradient(165deg,#3B3833 0%,#2A2724 48%,#1E1C1A 100%);}
        .v2-card .v2-img-ph,.v2-shot .v2-img-ph,.v2-tile-btn .v2-img-ph{aspect-ratio:3/4;}
        .v2-pdp-img.v2-img-ph{aspect-ratio:3/4;}
        .v2-cart-thumb.v2-img-ph{width:56px;height:72px;border-radius:8px;}

        /* Nothing-found */
        .v2-empty{padding:clamp(90px,22vw,150px) 26px;text-align:center;display:flex;
          flex-direction:column;align-items:center;gap:20px;}
        .v2-empty h2{font-family:${V2.display};font-weight:600;letter-spacing:-.025em;font-size:clamp(26px,6.6vw,34px);margin:0;}
        .v2-empty p{font-size:14px;font-weight:400;color:${V2.ink70};margin:0;max-width:30ch;line-height:1.6;}

        @media(min-width:760px){
          :root{--bar:104px;}
          .v2-tray{left:50%;translate:-50% 0;width:min(560px,92vw);}
          .v2-dock{left:50%;right:auto;translate:-50% 0;width:min(560px,92vw);}
          .v2-back{left:50%;margin-left:min(-280px,-46vw);}
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
          .v2-menu-btn{width:auto;gap:9px;padding:0 6px;}
          .v2-menu-btn em{display:inline;font-style:normal;font-size:11px;letter-spacing:.16em;
            text-transform:uppercase;}
          .v2-brand span{font-size:13px;}

          /* Hero: one-line headline, tighter card cluster */
          .v2-hero-copy h1{font-size:clamp(44px,4.4vw,64px);line-height:1.04;}
          .v2-hero-copy h1 span{display:inline;}
          .v2-hero-copy p{font-size:15px;}
          .v2-cards{gap:16px;margin-top:126px;}
          .v2-card{width:172px;}
          .v2-card.c1{width:206px;}
          /* Legal lines sit in opposite corners, not stacked centre */
          .v2-foot{flex-direction:row;justify-content:space-between;padding:0 26px;bottom:14px;font-size:9.5px;}
          .v2-cards-nav{display:block;}

          /* Results: editorial line + horizontal carousel of full-height cards */
          .v2-sec{padding-top:clamp(80px,7vw,120px);}
          .v2-sec h2{font-size:clamp(34px,3.1vw,46px);}
          .v2-inspired{display:block;font-family:${V2.display};font-weight:600;letter-spacing:-.02em;font-size:clamp(24px,2.1vw,30px);
            text-align:center;margin:clamp(56px,5vw,84px) 0 26px;}
          .v2-mosaic{display:flex;grid-template-columns:none;gap:2px;padding:0 0 8px;
            overflow-x:auto;scroll-snap-type:x proximity;scrollbar-width:none;align-items:flex-start;}
          .v2-mosaic::-webkit-scrollbar{display:none;}
          .v2-tile{flex:0 0 auto;width:clamp(240px,19vw,300px);scroll-snap-align:start;}
          .v2-tile img,.v2-tile.tall img{aspect-ratio:3/4;}
          .v2-tile .v2-heart{bottom:44px;right:11px;}
          .v2-tile-name{padding:11px 3px 20px;font-size:13px;}

          .v2-sec-hero{max-width:440px;}

          /* Product page: imagery scrolls sideways, one screen tall */
          .v2-pdp{display:flex;height:100svh;overflow-x:auto;overflow-y:hidden;padding:0;
            scroll-snap-type:x proximity;scrollbar-width:none;}
          .v2-pdp::-webkit-scrollbar{display:none;}
          .v2-pdp-img{width:auto;height:100%;flex:0 0 auto;object-fit:cover;scroll-snap-align:center;}

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

          .v2-cart{left:26px;right:auto;translate:none;width:min(430px,36vw);padding:15px;}
          .v2-cart-thumb{width:64px;height:82px;}
          .v2-cart-name{font-size:18px;}
          .v2-buy{padding:14px 30px;font-size:15px;}

          .v2-tray{left:50%;translate:-50% 0;width:min(620px,54vw);}
          .v2-bar{max-width:min(560px,44vw);}
          .v2-lookpage{padding-top:150px;}
          .v2-rail-item{width:clamp(260px,21vw,320px);}
          .v2-eyebrow{left:26px;top:150px;}
          .v2-minibag{right:26px;top:86px;}
        }
      `}</style>
    </div>
  )
}
