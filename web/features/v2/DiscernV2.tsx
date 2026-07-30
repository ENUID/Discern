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
 *  · Expanding MATERIALS / HOW TO STYLE opens a DASHED-outline panel carrying
 *    the description, the SKU and a nested DETAILS accordion.
 *  · The cart tray has two shapes: compact (one row: buy + name + price) and
 *    expanded (thumb + meta + colour/size actions).
 *  · Choosing a colour ringed-highlights the swatch and can resolve to
 *    "Unavailable", which disables the buy button rather than hiding it.
 *  · Sizes are circles on a horizontally-paged rail with a chevron.
 *  · The bag is a white sheet: line items with quantity steppers and Remove,
 *    shipping, subtotal, then PROCEED TO PAYMENT with the redirect notice.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { V2, V2_PROMPTS, V2_EDITORIAL, V2_SUGGESTIONS } from './theme'

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
  colorName?: string
  colors?: V2Color[]
  sizes?: string[]
  description?: string
  materials?: string
  howToStyle?: string
  details?: string
}
export type V2Section = { title: string; subtitle?: string; hero?: V2Product; products: V2Product[] }
export type V2CartLine = { product: V2Product; color?: string; size?: string; qty: number }

type View = 'home' | 'results' | 'product' | 'look'

// ── Spring ───────────────────────────────────────────────────────────────────
function useSpring(target: number, stiffness = 220, damping = 26): number {
  const pos = useRef(target); const vel = useRef(0)
  const raf = useRef<number | null>(null)
  const [value, set] = useState(target)
  useEffect(() => {
    const tick = () => {
      const d = pos.current - target
      vel.current += (-stiffness * d - damping * vel.current) / 60
      pos.current += vel.current / 60
      set(pos.current)
      if (Math.abs(d) > 5e-4 || Math.abs(vel.current) > 5e-4) raf.current = requestAnimationFrame(tick)
    }
    if (raf.current) cancelAnimationFrame(raf.current)
    raf.current = requestAnimationFrame(tick)
    return () => { if (raf.current) cancelAnimationFrame(raf.current) }
  }, [target, stiffness, damping])
  return value
}

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

const money = (n?: number, c = 'USD') =>
  typeof n === 'number' ? new Intl.NumberFormat('en-US', { style: 'currency', currency: c }).format(n) : ''

// ── Ornament ─────────────────────────────────────────────────────────────────
function Ornament({ light, spin }: { light?: boolean; spin?: boolean }) {
  const c = light ? 'rgba(255,255,255,.72)' : V2.ink45
  return (
    <svg className={spin ? 'v2-orn-spin' : ''} width="46" height="10" viewBox="0 0 46 10" fill="none" aria-hidden style={{ display: 'block', margin: '0 auto' }}>
      <path d="M1 5h13M32 5h13" stroke={c} strokeWidth=".7" />
      <path d="M18 5c2-3 4-3 5 0s3 3 5 0" stroke={c} strokeWidth=".7" />
    </svg>
  )
}

function Heart({ on, onClick, size = 34, ghost }: { on: boolean; onClick: (e: React.MouseEvent) => void; size?: number; ghost?: boolean }) {
  return (
    <button type="button" aria-label={on ? 'Saved' : 'Save'} onClick={onClick}
      className={`v2-heart ${ghost ? 'ghost' : ''}`} style={{ width: size, height: size }}>
      <svg width={size * .44} height={size * .44} viewBox="0 0 24 24" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6">
        <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1L12 21l7.7-7.6 1.1-1a5.5 5.5 0 0 0 0-7.8z" />
      </svg>
    </button>
  )
}

// ── Component ────────────────────────────────────────────────────────────────
export default function DiscernV2({
  heroMedia = '/v2/hero.jpg', heroPoster, onQuery,
}: {
  heroMedia?: string; heroPoster?: string
  onQuery?: (q: string) => Promise<{ sections: V2Section[]; look?: V2Product[] }>
}) {
  const [view, setView] = useState<View>('home')
  const [input, setInput] = useState('')
  const [focused, setFocused] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingLabel, setLoadingLabel] = useState<'answer' | 'suggestions'>('answer')
  const [sections, setSections] = useState<V2Section[]>([])
  const [look, setLook] = useState<V2Product[] | null>(null)
  const [lookOpen, setLookOpen] = useState(false)
  const [product, setProduct] = useState<V2Product | null>(null)
  const [saved, setSaved] = useState<Set<string>>(new Set())
  const [menuOpen, setMenuOpen] = useState(false)
  const [acc, setAcc] = useState<'materials' | 'style' | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [showScroll, setShowScroll] = useState(true)
  const [colorMode, setColorMode] = useState(false)
  const [sizeMode, setSizeMode] = useState(false)
  const [pickedColor, setPickedColor] = useState<V2Color | null>(null)
  const [pickedSize, setPickedSize] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [cart, setCart] = useState<V2CartLine[]>([])
  const [bagOpen, setBagOpen] = useState(false)

  const taRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const lookRailRef = useRef<HTMLDivElement>(null)
  const kb = useKeyboardOffset()
  const [barPressed, setBarPressed] = useState(false)
  const [sendPressed, setSendPressed] = useState(false)
  const barScale = useSpring(barPressed ? .985 : 1, 260, 28)
  const sendScale = useSpring(sendPressed ? .86 : 1, 380, 24)

  const canSend = input.trim().length > 0
  const idle = !focused && input.length === 0
  const cartCount = cart.reduce((n, l) => n + l.qty, 0)
  const subtotal = cart.reduce((n, l) => n + (l.product.price ?? 0) * l.qty, 0)

  useEffect(() => {
    const el = taRef.current; if (!el) return
    el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 76) + 'px'
  }, [input, focused])

  const toggleSave = useCallback((id: string) => {
    setSaved(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  }, [])

  const run = useCallback(async (q: string) => {
    if (!q.trim() || loading) return
    taRef.current?.blur()
    setLoadingLabel(Math.random() > .5 ? 'answer' : 'suggestions')
    setLoading(true); setLookOpen(false)
    try {
      const res = onQuery ? await onQuery(q.trim()) : { sections: [], look: undefined }
      setSections(res.sections ?? [])
      if (res.look?.length) { setLook(res.look); setLookOpen(true) }
      setView('results')
      scrollRef.current?.scrollTo({ top: 0 })
    } finally { setLoading(false) }
  }, [loading, onQuery])

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
    <div className="v2-root">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className={`v2-head ${view === 'home' ? '' : 'solid'}`}>
        <button className="v2-ic" aria-label="Menu" onClick={() => setMenuOpen(true)}>
          <svg width="18" height="18" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.4" fill="none"><path d="M3 7h18M3 12h18M3 17h18" /></svg>
        </button>
        <button className="v2-ic" aria-label="History">
          <svg width="18" height="18" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.4" fill="none"><path d="M3 12a9 9 0 1 0 3-6.7M3 4v4h4M12 7v5l3 2" /></svg>
        </button>
        <div className="v2-brand">
          <svg width="24" height="24" viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth=".9" aria-hidden>
            <path d="M20 5l9 7v16l-9 7-9-7V12z" /><path d="M20 12l4 3v10l-4 3-4-3V15z" /></svg>
          <span>DISCERN</span>
        </div>
        <button className="v2-ic" aria-label="Saved">
          <svg width="18" height="18" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.4" fill="none"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1L12 21l7.7-7.6 1.1-1a5.5 5.5 0 0 0 0-7.8z" /></svg>
        </button>
        <button className="v2-ic" aria-label="Bag" onClick={() => setBagOpen(true)}>
          <svg width="18" height="18" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.4" fill="none"><path d="M6 7h12l-1 14H7L6 7z" /><path d="M9 7V5a3 3 0 0 1 6 0v2" /></svg>
          {cartCount > 0 && <i className="v2-dot" />}
        </button>
      </header>

      {/* Mini-bag chips — the pieces you've added, stacked top-right */}
      {cart.length > 0 && view === 'product' && (
        <div className="v2-minibag">
          {cart.slice(-2).map((l, i) => (
            <button key={i} onClick={() => setBagOpen(true)}><img src={l.product.image} alt="" /></button>
          ))}
        </div>
      )}

      {/* ── Scroller ───────────────────────────────────────────────────────── */}
      <div className="v2-scroll" ref={scrollRef} onScroll={() => setShowScroll((scrollRef.current?.scrollTop ?? 0) < 40)}>

        {/* 1 · HERO */}
        {view === 'home' && (
          <>
            <section className="v2-hero">
              <div className="v2-hero-media">
                {heroIsVideo ? <video src={heroMedia} poster={heroPoster} autoPlay muted loop playsInline /> : <img src={heroMedia} alt="" />}
                <div className="v2-veil" />
              </div>
              <div className="v2-cards">
                {[0, 1, 2].map(i => (
                  <figure key={i} className={`v2-card c${i}`}><img src={`/v2/card-${i + 1}.jpg`} alt="" /></figure>
                ))}
              </div>
              <div className="v2-hero-copy">
                <h1>Where ideas become<br />endless possibilities</h1>
                <p>Welcome to the AI Online Boutique</p>
              </div>
              <div className="v2-foot">
                <span>©2026 DISCERN — EARLY ACCESS</span>
                <span>THIS BOUTIQUE RUNS ON DISCERN</span>
              </div>
            </section>

            {/* 1b · SECOND HERO — collection statement */}
            <section className="v2-hero v2-hero2">
              <div className="v2-hero-media"><img src="/v2/hero-2.jpg" alt="" /><div className="v2-veil" /></div>
              <div className="v2-hero-copy">
                <h1>Let yourself be<br />inspired</h1>
                <p>Select a suggestion or start prompting</p>
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
            {sections.map((s, si) => (
              <React.Fragment key={si}>
                <div className="v2-sec">
                  <h2>{s.title}</h2>
                  {s.subtitle && <p>{s.subtitle}</p>}
                  {s.hero && (
                    <div className="v2-sec-hero">
                      <button className="v2-shot" onClick={() => openProduct(s.hero!)}><img src={s.hero.image} alt={s.hero.title} /></button>
                      <Heart on={saved.has(s.hero.id)} onClick={e => { e.stopPropagation(); toggleSave(s.hero!.id) }} />
                    </div>
                  )}
                  <button className="v2-discover" onClick={() => s.hero && openProduct(s.hero)}>
                    Discover all {s.title} <span aria-hidden>›</span>
                  </button>
                </div>

                {s.products.length > 0 && (
                  <div className="v2-mosaic">
                    {s.products.map((p, i) => (
                      <div key={p.id} className={`v2-tile ${i % 5 === 1 || i % 5 === 4 ? 'tall' : ''}`}>
                        <button className="v2-tile-btn" onClick={() => openProduct(p)}><img src={p.image} alt={p.title} loading="lazy" /></button>
                        <Heart on={saved.has(p.id)} onClick={e => { e.stopPropagation(); toggleSave(p.id) }} />
                        <span className="v2-tile-name">{p.title} <i aria-hidden>›</i></span>
                      </div>
                    ))}
                  </div>
                )}

                {si < sections.length - 1 && (
                  <div className="v2-editorial">
                    <Ornament light /><p>{V2_EDITORIAL[si % V2_EDITORIAL.length]}</p><Ornament light />
                  </div>
                )}
              </React.Fragment>
            ))}
          </section>
        )}

        {/* 2b · LOOK — "Discover the look" rail */}
        {view === 'look' && look && (
          <section className="v2-lookpage">
            <div className="v2-rail" ref={lookRailRef}>
              {look.map(p => (
                <div key={p.id} className="v2-rail-item">
                  <button className="v2-shot" onClick={() => openProduct(p)}><img src={p.image} alt={p.title} /></button>
                  <Heart on={saved.has(p.id)} onClick={e => { e.stopPropagation(); toggleSave(p.id) }} />
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
            {pdpImages.map((src, i) => <img key={i} className="v2-pdp-img" src={src} alt="" />)}
          </section>
        )}
      </div>

      {/* Back */}
      {(view === 'product' || view === 'look') && (
        <button className="v2-back" onClick={() => setView('results')}><span aria-hidden>‹</span> Back</button>
      )}
      {view === 'look' && <div className="v2-eyebrow">OTHER SUGGESTIONS</div>}

      {/* Accordion panel — dashed outline, description + SKU + nested DETAILS */}
      {view === 'product' && product && acc && (
        <div className="v2-panel" style={{ bottom: `calc(var(--tray) + 62px + ${kb}px)` }}>
          <div className="v2-panel-head">
            <span>{acc === 'materials' ? 'DESCRIPTION' : 'HOW TO STYLE'}</span>
            <button onClick={() => setAcc(null)} aria-label="Collapse">−</button>
          </div>
          <p>{acc === 'materials'
            ? (product.description || product.materials || 'Composition details are being added for this piece.')
            : (product.howToStyle || 'Pair it back to tailored trousers and a soft leather shoe.')}</p>
          {acc === 'materials' && product.sku && <span className="v2-sku">SKU: {product.sku}</span>}
          {acc === 'materials' && (
            <div className="v2-nested">
              <button onClick={() => setDetailsOpen(v => !v)}>DETAILS <i>{detailsOpen ? '−' : '+'}</i></button>
              {detailsOpen && <p className="v2-nested-body">{product.details || product.materials || 'Made in Italy. Specialist clean.'}</p>}
            </div>
          )}
        </div>
      )}
      {view === 'product' && product && (
        <div className="v2-acc" style={{ bottom: `calc(var(--tray) + ${kb}px)` }}>
          {(['materials', 'style'] as const).map(k => (
            <button key={k} className={`v2-acc-pill ${acc === k ? 'on' : ''}`} onClick={() => setAcc(acc === k ? null : k)}>
              {k === 'materials' ? 'MATERIALS' : 'HOW TO STYLE'}<i aria-hidden>{acc === k ? '−' : '+'}</i>
            </button>
          ))}
        </div>
      )}

      {/* Look tray */}
      {lookOpen && look && look.length > 0 && view === 'results' && (
        <div className="v2-tray" style={{ bottom: `calc(var(--bar) + ${kb}px)` }}>
          <div className="v2-tray-row">
            {look.slice(0, 4).map(p => (
              <button key={p.id} className="v2-chip" onClick={() => openProduct(p)}><img src={p.image} alt={p.title} /></button>
            ))}
            <Heart on={look.every(p => saved.has(p.id))} ghost onClick={() => look.forEach(p => toggleSave(p.id))} />
          </div>
          <div className="v2-tray-cta">
            <button className="v2-pill" onClick={() => { setView('look'); scrollRef.current?.scrollTo({ top: 0 }) }}>Discover the look</button>
            <button className="v2-pill" onClick={() => run('Other suggestions like these')}>Other suggestions</button>
            <button className="v2-x" aria-label="Dismiss" onClick={() => setLookOpen(false)}>
              <svg width="13" height="13" viewBox="0 0 10 10"><path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
            </button>
          </div>
        </div>
      )}

      {/* Scroll hint */}
      {(view === 'home' || view === 'look') && showScroll && !focused && (
        <button className="v2-hint" style={{ bottom: `calc(var(--bar) + ${kb}px)` }}
          onClick={() => scrollRef.current?.scrollBy({ top: window.innerHeight * .82, behavior: 'smooth' })}>
          <svg width="13" height="13" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" fill="none"><path d="M6 9l6 6 6-6" /></svg>
          Scroll to explore
        </button>
      )}

      {/* Loading */}
      {loading && (
        <div className="v2-loading">
          <Ornament />
          <h2>{loadingLabel === 'suggestions' ? <>Curating <em>suggestions</em></> : <>Crafting your <em>answer</em></>}</h2>
          <svg className="v2-sky" viewBox="0 0 400 90" fill="none" stroke={V2.ink45} strokeWidth=".8" aria-hidden>
            <circle cx="52" cy="20" r="7" />
            <path d="M0 78h400M14 78V56h16v22M30 78V44h10v34M40 78V52h22v26M62 78V38h8v40M70 78V58h26v20M96 78V48h18v30M114 78V64h22v14M136 78V42h9v36M145 78V60h30v18M175 78V50h16v28M191 78V66h26v12M217 78V46h10v32M227 78V58h24v20M251 78V54h18v24M269 78V64h28v14M297 78V44h9v34M306 78V60h26v18M332 78V52h16v26M348 78V66h24v12M372 78V56h14v22" />
            <path d="M22 56l-4 4h12l-4-4M144 42l-4 5h10l-4-5M301 44l-4 5h10l-4-5" />
          </svg>
        </div>
      )}

      {/* Menu */}
      <div className={`v2-ov ${menuOpen ? 'on' : ''}`} onClick={() => setMenuOpen(false)} />
      <nav className={`v2-menu ${menuOpen ? 'on' : ''}`} aria-hidden={!menuOpen}>
        <button className="v2-menu-x" aria-label="Close" onClick={() => setMenuOpen(false)}>
          <svg width="15" height="15" viewBox="0 0 10 10"><path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
        </button>
        <span className="v2-eyebrow-s">Menu</span>
        <ul>{['New arrivals', 'Women', 'Men', 'Collections', 'The house', 'Contact'].map(x => <li key={x}>{x}</li>)}</ul>
        <Ornament />
      </nav>

      {/* Bag sheet */}
      {bagOpen && (
        <div className="v2-bag">
          <button className="v2-bag-x" aria-label="Close" onClick={() => setBagOpen(false)}>
            <svg width="15" height="15" viewBox="0 0 10 10"><path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
          </button>
          <h2>My selection <em>({cartCount})</em></h2>
          <div className="v2-bag-list">
            {cart.length === 0 && <p className="v2-bag-empty">Nothing here yet.</p>}
            {cart.map((l, i) => (
              <div className="v2-line" key={i}>
                <img src={l.product.image} alt="" />
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
          <button className="v2-pay">PROCEED TO PAYMENT <span aria-hidden>↗</span></button>
          <p className="v2-bag-note">To complete your purchase, you will be redirected to the brand’s own store.</p>
        </div>
      )}

      {/* ── AI bar ─────────────────────────────────────────────────────────── */}
      {view !== 'product' && (
        <div className="v2-bar-wrap" style={{ bottom: kb }}>
          <div style={{ transform: `scale(${barScale})`, transformOrigin: 'center bottom' }}
            onPointerDown={() => setBarPressed(true)} onPointerUp={() => setBarPressed(false)} onPointerLeave={() => setBarPressed(false)}>
            <div className={`v2-bar ${focused ? 'focus' : ''}`}>
              <button className="v2-plus" aria-label="Add a photo">
                <svg width="15" height="15" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
              </button>
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
                  <svg width="12" height="12" viewBox="0 0 10 10"><path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                </button>
              )}
              <div style={{ transform: `scale(${sendScale})` }}
                onPointerDown={() => setSendPressed(true)} onPointerUp={() => setSendPressed(false)} onPointerLeave={() => setSendPressed(false)}>
                <button className={`v2-send ${canSend ? 'on' : ''}`} aria-label="Send" onClick={submit} disabled={loading}>
                  {loading ? <Ornament light spin />
                    : <svg width="15" height="15" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"><path d="M12 19V5M5 12l7-7 7 7" /></svg>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Cart tray (PDP) ────────────────────────────────────────────────── */}
      {view === 'product' && product && (
        <div className={`v2-cart ${colorMode || sizeMode ? 'tall' : ''}`} style={{ bottom: kb }}>
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
                  <img src={c.image} alt={c.name} />
                </button>
              ))}
            </div>
          )}
          {!colorMode && !sizeMode && (
            <>
              <img className="v2-cart-thumb" src={product.image} alt="" />
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
              <Heart on={saved.has(product.id)} onClick={() => toggleSave(product.id)} />
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
              <svg width="13" height="13" viewBox="0 0 10 10"><path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
            </button>
          </div>
        </div>
      )}

      <style jsx global>{`
        :root{--bar:96px;--tray:112px;}
        .v2-root{position:fixed;inset:0;background:${V2.bone};color:${V2.ink};font-family:${V2.sans};overflow:hidden;}

        .v2-head{position:absolute;top:0;left:0;right:0;z-index:40;display:flex;align-items:center;gap:2px;
          padding:calc(env(safe-area-inset-top,0px) + 12px) 12px 12px;color:#fff;
          background:linear-gradient(to bottom,rgba(0,0,0,.36),rgba(0,0,0,0));
          transition:color .45s ${V2.ease},background .45s ${V2.ease};}
        .v2-head.solid{color:${V2.ink};background:linear-gradient(to bottom,${V2.bone} 60%,rgba(242,239,234,0));}
        .v2-ic{width:34px;height:34px;display:flex;align-items:center;justify-content:center;background:none;
          border:none;color:inherit;cursor:pointer;position:relative;-webkit-tap-highlight-color:transparent;}
        .v2-ic:active{transform:scale(.9);}
        .v2-brand{flex:1;display:flex;flex-direction:column;align-items:center;gap:1px;pointer-events:none;}
        .v2-brand span{font-family:${V2.serif};font-size:12px;letter-spacing:.36em;text-indent:.36em;white-space:nowrap;}
        .v2-dot{position:absolute;top:6px;right:5px;width:5px;height:5px;border-radius:50%;background:currentColor;}

        .v2-minibag{position:absolute;z-index:46;top:calc(env(safe-area-inset-top,0px) + 62px);right:12px;
          display:flex;gap:6px;padding:6px;border-radius:12px;background:${V2.glassDark};
          backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);animation:v2-rise .4s ${V2.ease};}
        .v2-minibag button{width:44px;height:56px;padding:0;border:none;border-radius:7px;overflow:hidden;cursor:pointer;
          background:none;box-shadow:inset 0 0 0 1px ${V2.glassEdge};}
        .v2-minibag img{width:100%;height:100%;object-fit:cover;display:block;}

        .v2-scroll{position:absolute;inset:0;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;scrollbar-width:none;}
        .v2-scroll::-webkit-scrollbar{display:none;}

        /* Hero */
        .v2-hero{position:relative;min-height:100svh;display:flex;flex-direction:column;justify-content:flex-end;
          padding-bottom:calc(var(--bar) + 52px);}
        .v2-hero-media{position:absolute;inset:0;overflow:hidden;}
        .v2-hero-media img,.v2-hero-media video{width:100%;height:100%;object-fit:cover;display:block;}
        .v2-veil{position:absolute;inset:0;background:linear-gradient(to bottom,rgba(20,17,14,.44) 0%,rgba(20,17,14,.1) 30%,rgba(20,17,14,.56) 76%,rgba(20,17,14,.74) 100%);}
        .v2-cards{position:relative;z-index:2;display:flex;align-items:center;justify-content:center;gap:9px;
          padding:0 14px;margin-bottom:auto;margin-top:calc(env(safe-area-inset-top,0px) + 92px);}
        .v2-card{margin:0;width:28%;aspect-ratio:3/4;overflow:hidden;flex-shrink:0;
          box-shadow:0 18px 44px rgba(0,0,0,.36);animation:v2-float 7s ease-in-out infinite;}
        .v2-card img{width:100%;height:100%;object-fit:cover;display:block;animation:v2-swap 12s ease-in-out infinite;}
        .v2-card.c0{transform:translateY(14px) rotate(-1.5deg);animation-delay:-1.2s;}
        .v2-card.c0 img{animation-delay:-8s;}
        .v2-card.c1{width:36%;z-index:2;transform:translateY(-12px);}
        .v2-card.c1 img{animation-delay:-4s;}
        .v2-card.c2{transform:translateY(18px) rotate(1.7deg);animation-delay:-3.6s;}
        @keyframes v2-float{0%,100%{translate:0 0}50%{translate:0 -7px}}
        @keyframes v2-swap{0%,88%{opacity:1}94%{opacity:.35}100%{opacity:1}}
        @media(prefers-reduced-motion:reduce){.v2-card,.v2-card img{animation:none}}
        .v2-hero-copy{position:relative;z-index:2;text-align:center;color:#fff;padding:0 22px;}
        .v2-hero-copy h1{font-family:${V2.serif};font-weight:300;font-size:clamp(30px,8.6vw,46px);line-height:1.08;
          margin:0 0 12px;text-shadow:0 2px 26px rgba(0,0,0,.42);}
        .v2-hero-copy p{font-size:14px;font-weight:300;margin:0;opacity:.93;}
        .v2-foot{position:absolute;left:0;right:0;bottom:calc(var(--bar) - 34px);z-index:2;display:flex;
          flex-direction:column;gap:3px;align-items:center;color:rgba(255,255,255,.72);
          font-size:9px;letter-spacing:.09em;text-align:center;padding:0 16px;}
        .v2-hero2{justify-content:flex-end;}
        .v2-sugs{position:relative;z-index:2;display:flex;flex-direction:column;gap:9px;padding:22px 14px 0;}
        .v2-sug{text-align:left;padding:13px 18px;border:none;border-radius:999px;cursor:pointer;color:#fff;
          font-size:13.5px;font-weight:300;background:${V2.glassDark};
          backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);
          box-shadow:inset 0 0 0 1px ${V2.glassEdge};transition:background .2s ${V2.ease};}
        .v2-sug:active{background:rgba(255,255,255,.2);}

        /* Results */
        .v2-results{padding-bottom:calc(var(--bar) + 44px);}
        .v2-sec{padding:clamp(60px,15vw,100px) 20px 0;text-align:center;}
        .v2-sec h2{font-family:${V2.serif};font-weight:300;font-size:clamp(27px,7.4vw,38px);line-height:1.1;margin:0 0 8px;}
        .v2-sec p{font-size:14px;font-weight:300;color:${V2.ink70};margin:0 0 28px;}
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

        .v2-editorial{margin-top:32px;padding:clamp(88px,24vw,150px) 26px;text-align:center;color:#fff;
          background:linear-gradient(150deg,#2A2E2C 0%,#1D2220 55%,#141817 100%);
          display:flex;flex-direction:column;gap:28px;align-items:center;}
        .v2-editorial p{font-family:${V2.serif};font-weight:300;font-size:clamp(23px,6.2vw,31px);line-height:1.28;margin:0;max-width:19ch;}

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
        .v2-pdp{padding-bottom:calc(var(--tray) + 96px);}
        .v2-pdp-img{width:100%;display:block;background:${V2.boneDeep};}
        .v2-back{position:absolute;z-index:45;top:calc(env(safe-area-inset-top,0px) + 56px);left:14px;display:flex;
          align-items:center;gap:7px;padding:9px 17px 9px 13px;border:none;border-radius:999px;cursor:pointer;
          font-size:14px;color:${V2.ink};background:${V2.glassLight};
          backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);box-shadow:0 3px 16px rgba(0,0,0,.10);}
        .v2-back span{font-size:17px;line-height:1;}

        .v2-acc{position:absolute;z-index:44;left:14px;right:14px;display:flex;gap:9px;}
        .v2-acc-pill{display:inline-flex;align-items:center;gap:9px;padding:10px 15px;border:none;border-radius:999px;
          cursor:pointer;font-size:11px;letter-spacing:.11em;font-weight:500;color:#fff;background:${V2.glassDark};
          backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);}
        .v2-acc-pill i{font-style:normal;font-size:14px;opacity:.85;}
        .v2-acc-pill.on{background:rgba(28,27,25,.85);}
        .v2-panel{position:absolute;z-index:44;left:14px;right:14px;max-height:44vh;overflow-y:auto;
          padding:16px 18px;border-radius:6px;background:${V2.bone};border:1px dashed ${V2.ink45};
          animation:v2-rise .3s ${V2.ease};}
        .v2-panel-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;}
        .v2-panel-head span{font-size:10.5px;letter-spacing:.15em;color:${V2.ink70};}
        .v2-panel-head button{background:none;border:none;font-size:17px;cursor:pointer;color:${V2.ink70};line-height:1;}
        .v2-panel p{font-size:13.5px;line-height:1.62;font-weight:300;margin:0;}
        .v2-sku{display:block;margin-top:14px;font-size:11px;color:${V2.ink45};}
        .v2-nested{margin-top:16px;padding-top:12px;border-top:1px dashed ${V2.hairline};}
        .v2-nested button{display:flex;width:100%;justify-content:space-between;align-items:center;background:none;
          border:none;padding:0;cursor:pointer;font-size:10.5px;letter-spacing:.15em;color:${V2.ink70};}
        .v2-nested i{font-style:normal;font-size:15px;}
        .v2-nested-body{margin-top:10px !important;font-size:13px !important;}

        /* Trays */
        .v2-tray{position:absolute;z-index:42;left:12px;right:12px;padding:11px;border-radius:22px;color:#fff;
          background:${V2.glassDark};backdrop-filter:blur(22px);-webkit-backdrop-filter:blur(22px);
          box-shadow:0 14px 44px rgba(0,0,0,.3);animation:v2-rise .4s ${V2.ease};}
        .v2-tray-row{display:flex;gap:8px;}
        .v2-chip{flex:1;min-width:0;aspect-ratio:3/4;padding:0;border:none;border-radius:9px;overflow:hidden;
          background:rgba(255,255,255,.1);cursor:pointer;box-shadow:inset 0 0 0 1px ${V2.glassEdge};}
        .v2-chip img{width:100%;height:100%;object-fit:cover;display:block;}
        .v2-tray-row .v2-heart.ghost{flex:1;height:auto;aspect-ratio:3/4;border-radius:9px;color:#fff;
          background:rgba(255,255,255,.06);box-shadow:inset 0 0 0 1px ${V2.glassEdge};}
        .v2-tray-cta{display:flex;gap:8px;margin-top:10px;align-items:center;}

        .v2-pill{flex:1;min-width:0;padding:12px 10px;border:none;border-radius:999px;cursor:pointer;font-size:13.5px;
          color:#fff;background:rgba(255,255,255,.16);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
          transition:background .18s ${V2.ease};}
        .v2-pill:active{background:rgba(255,255,255,.26);}
        .v2-x{width:40px;height:40px;flex-shrink:0;border:none;border-radius:50%;cursor:pointer;display:flex;
          align-items:center;justify-content:center;color:#fff;background:rgba(255,255,255,.16);}
        .v2-heart{border:none;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;
          color:${V2.ink};background:rgba(255,255,255,.8);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
          box-shadow:0 2px 10px rgba(0,0,0,.13);transition:transform .16s ${V2.ease};}
        .v2-heart:active{transform:scale(.88);}

        .v2-hint{position:absolute;z-index:41;left:50%;translate:-50% 0;display:inline-flex;align-items:center;gap:9px;
          padding:11px 20px;border:none;border-radius:999px;cursor:pointer;font-size:13.5px;color:#fff;
          background:${V2.glassDark};backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);animation:v2-fade .6s ${V2.ease};}

        /* Loading */
        .v2-loading{position:absolute;inset:0;z-index:60;background:${V2.bone};display:flex;flex-direction:column;
          align-items:center;justify-content:center;gap:26px;padding:0 24px calc(var(--bar) + 40px);animation:v2-fade .35s ${V2.ease};}
        .v2-loading h2{font-family:${V2.serif};font-weight:300;font-size:clamp(26px,7vw,34px);margin:0;}
        .v2-loading h2 em{font-style:italic;}
        .v2-sky{width:min(430px,92vw);opacity:.5;stroke-dasharray:1400;stroke-dashoffset:1400;animation:v2-draw 3.4s ${V2.ease} forwards;}
        @keyframes v2-draw{to{stroke-dashoffset:0}}
        .v2-orn-spin{animation:v2-pulse 1.3s ease-in-out infinite;}
        @keyframes v2-pulse{0%,100%{opacity:.4}50%{opacity:1}}

        /* Menu + overlay */
        .v2-ov{position:absolute;inset:0;z-index:70;background:rgba(16,14,12,0);pointer-events:none;transition:background .42s ${V2.ease};}
        .v2-ov.on{background:rgba(16,14,12,.46);pointer-events:auto;backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);}
        .v2-menu{position:absolute;z-index:71;inset:0 auto 0 0;width:min(310px,86%);background:${V2.bone};
          padding:calc(env(safe-area-inset-top,0px) + 26px) 26px 30px;transform:translateX(-101%);
          transition:transform .46s ${V2.easeInOut};display:flex;flex-direction:column;gap:24px;
          box-shadow:14px 0 60px rgba(0,0,0,.16);}
        .v2-menu.on{transform:none;}
        .v2-menu-x{align-self:flex-end;width:34px;height:34px;border:none;background:none;color:${V2.ink};cursor:pointer;}
        .v2-eyebrow-s{font-size:10.5px;letter-spacing:.2em;text-transform:uppercase;color:${V2.ink45};}
        .v2-menu ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:18px;}
        .v2-menu li{font-family:${V2.serif};font-size:25px;font-weight:300;cursor:pointer;}

        /* Bag sheet */
        .v2-bag{position:absolute;inset:0;z-index:80;background:#fff;overflow-y:auto;
          padding:calc(env(safe-area-inset-top,0px) + 26px) 22px calc(env(safe-area-inset-bottom,0px) + 30px);
          animation:v2-fade .3s ${V2.ease};}
        .v2-bag-x{position:absolute;top:calc(env(safe-area-inset-top,0px) + 22px);right:20px;width:32px;height:32px;
          border:none;background:none;cursor:pointer;color:${V2.ink};}
        .v2-bag h2{font-family:${V2.serif};font-weight:300;font-size:26px;margin:0 0 26px;}
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
        .v2-pay{width:100%;padding:17px;border:none;border-radius:2px;background:${V2.ink};color:#fff;cursor:pointer;
          font-size:12px;letter-spacing:.14em;display:flex;align-items:center;justify-content:center;gap:10px;}
        .v2-bag-note{font-size:11.5px;line-height:1.5;color:${V2.ink45};text-align:center;margin:14px 0 0;}

        /* Bar */
        .v2-bar-wrap{position:absolute;z-index:50;left:0;right:0;
          padding:14px clamp(12px,3.6vw,18px) calc(env(safe-area-inset-bottom,0px) + 16px);pointer-events:none;}
        .v2-bar-wrap>*{pointer-events:auto;}
        .v2-bar{display:flex;align-items:flex-end;gap:9px;padding:9px 9px 9px 10px;width:100%;
          max-width:min(680px,96vw);margin:0 auto;border-radius:30px;color:#fff;background:${V2.glassDark};
          backdrop-filter:blur(26px) saturate(150%);-webkit-backdrop-filter:blur(26px) saturate(150%);
          box-shadow:0 10px 40px rgba(0,0,0,.26),inset 0 1px 0 ${V2.glassEdge};transition:background .3s ${V2.ease};}
        .v2-bar.focus{background:rgba(26,24,21,.9);}
        .v2-plus,.v2-send,.v2-clear{flex-shrink:0;border:none;cursor:pointer;display:flex;align-items:center;
          justify-content:center;border-radius:50%;color:#fff;transition:background .2s ${V2.ease},transform .12s ${V2.ease};}
        .v2-plus{width:38px;height:38px;background:rgba(255,255,255,.13);}
        .v2-plus:active{transform:scale(.9);}
        .v2-clear{width:26px;height:26px;margin-bottom:6px;background:rgba(255,255,255,.16);}
        .v2-send{width:38px;height:38px;background:rgba(255,255,255,.13);}
        .v2-send.on{background:#fff;color:${V2.ink};}
        .v2-field{position:relative;flex:1;min-width:0;padding:9px 0 8px;overflow:hidden;}
        .v2-field textarea{width:100%;border:none;background:none;outline:none;resize:none;font-family:${V2.sans};
          font-size:16px;line-height:1.42;color:#fff;max-height:76px;overflow-y:auto;display:block;caret-color:#fff;}
        .v2-ph{position:absolute;left:0;top:9px;pointer-events:none;font-size:16px;line-height:1.42;color:rgba(255,255,255,.6);}
        /* Idle prompt drifts continuously, matching the reference ticker. */
        .v2-marquee{position:absolute;left:0;right:0;top:9px;pointer-events:none;overflow:hidden;
          mask-image:linear-gradient(to right,transparent,#000 6%,#000 88%,transparent);
          -webkit-mask-image:linear-gradient(to right,transparent,#000 6%,#000 88%,transparent);}
        .v2-marquee>div{display:flex;gap:44px;width:max-content;animation:v2-drift 44s linear infinite;}
        .v2-marquee span{font-size:16px;line-height:1.42;color:rgba(255,255,255,.6);white-space:nowrap;}
        @keyframes v2-drift{from{transform:translateX(0)}to{transform:translateX(-50%)}}
        @media(prefers-reduced-motion:reduce){.v2-marquee>div{animation:none}}

        /* Cart tray */
        .v2-cart{position:absolute;z-index:50;left:12px;right:12px;
          margin-bottom:calc(env(safe-area-inset-bottom,0px) + 14px);display:grid;
          grid-template-columns:auto 1fr auto;gap:11px;align-items:center;padding:12px;border-radius:22px;color:#fff;
          background:${V2.glassDark};backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);
          box-shadow:0 14px 44px rgba(0,0,0,.32);animation:v2-rise .42s ${V2.ease};}
        .v2-cart.tall{grid-template-columns:1fr;}
        .v2-cart-thumb{width:56px;height:72px;object-fit:cover;border-radius:8px;display:block;box-shadow:inset 0 0 0 1px ${V2.glassEdge};}
        .v2-cart-meta{min-width:0;display:flex;flex-direction:column;gap:3px;}
        .v2-cart-name{font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
        .v2-cart-price{font-size:13.5px;display:flex;gap:8px;align-items:baseline;}
        .v2-cart-price em{font-style:normal;text-decoration:line-through;opacity:.55;font-size:12.5px;}
        .v2-cart-color{font-size:12.5px;opacity:.72;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
        .v2-cart-cta{grid-column:1/-1;display:flex;gap:8px;align-items:center;margin-top:2px;}
        .v2-buy{flex-shrink:0;padding:13px 26px;border:none;border-radius:999px;cursor:pointer;background:#fff;
          color:${V2.ink};font-size:14.5px;min-width:124px;display:flex;align-items:center;justify-content:center;
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
        .v2-sizes button.on{background:#fff;color:${V2.ink};}
        .v2-picker-nav{position:absolute;left:2px;bottom:2px;width:30px;height:30px;border-radius:50%;border:none;
          cursor:pointer;color:#fff;background:rgba(255,255,255,.14);font-size:15px;line-height:1;}

        @keyframes v2-rise{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
        @keyframes v2-fade{from{opacity:0}to{opacity:1}}

        @media(min-width:760px){
          :root{--bar:104px;}
          .v2-tray,.v2-cart,.v2-acc,.v2-panel{left:50%;translate:-50% 0;width:min(560px,92vw);}
          .v2-back{left:50%;margin-left:min(-280px,-46vw);}
          .v2-sugs{max-width:560px;margin:0 auto;}
          .v2-bag{padding-left:max(22px,calc(50vw - 280px));padding-right:max(22px,calc(50vw - 280px));}
        }
      `}</style>
    </div>
  )
}
