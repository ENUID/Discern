'use client'
/**
 * Discern v2 — the boutique interface.
 *
 * Built to the reference clips frame by frame. The whole surface is
 * image-first: content sits full-bleed and every control floats over it as a
 * frosted pill, so the UI never reads as chrome. Screens covered:
 *
 *   1. Hero            full-bleed media, three offset "polaroid" cards, serif
 *                      display headline, floating AI bar, Scroll-to-explore
 *   2. Answer          cream editorial page: serif title, subtitle, hero
 *                      product, "Discover all … ›"
 *   3. Editorial       dark full-bleed quote panel with ornament rules
 *   4. Mosaic          masonry product grid, heart on every tile
 *   5. Look panel      floating tray of the pieces in a look, with
 *                      "Discover the look" / "Other suggestions"
 *   6. Product         Back pill, stacked imagery, MATERIALS / HOW TO STYLE
 *                      accordions, add-to-cart tray with colour + size
 *   7. Loading         "Crafting your answer" / "Curating suggestions" over a
 *                      line-drawn illustration
 *
 * State is deliberately local and view-driven (`view`), so each screen can be
 * reasoned about on its own and the whole thing stays one mounted tree — no
 * route changes, so transitions can cross-fade.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { V2, V2_PROMPTS, V2_EDITORIAL } from './theme'

// ── Types ────────────────────────────────────────────────────────────────────
export type V2Product = {
  id: string
  title: string
  price?: number
  compareAt?: number
  currency?: string
  image: string
  images?: string[]
  vendor?: string
  colorName?: string
  colorCount?: number
  description?: string
  materials?: string
  howToStyle?: string
  sizes?: string[]
}

export type V2Section = {
  title: string
  subtitle?: string
  hero?: V2Product
  products: V2Product[]
}

type View = 'home' | 'results' | 'product'

// ── Spring (press feedback) ──────────────────────────────────────────────────
function useSpring(target: number, stiffness = 220, damping = 26): number {
  const pos = useRef(target)
  const vel = useRef(0)
  const raf = useRef<number | null>(null)
  const [value, set] = useState(target)
  useEffect(() => {
    const tick = () => {
      const disp = pos.current - target
      const acc = -stiffness * disp - damping * vel.current
      vel.current += acc / 60
      pos.current += vel.current / 60
      set(pos.current)
      if (Math.abs(disp) > 5e-4 || Math.abs(vel.current) > 5e-4) raf.current = requestAnimationFrame(tick)
    }
    if (raf.current) cancelAnimationFrame(raf.current)
    raf.current = requestAnimationFrame(tick)
    return () => { if (raf.current) cancelAnimationFrame(raf.current) }
  }, [target, stiffness, damping])
  return value
}

// ── Keyboard-aware offset ────────────────────────────────────────────────────
function useKeyboardOffset(): number {
  const [offset, setOffset] = useState(0)
  useEffect(() => {
    const vv = (window as any).visualViewport
    if (!vv) return
    const check = () => {
      const kb = window.innerHeight - vv.height - vv.offsetTop
      setOffset(kb > 150 ? Math.round(kb) : 0)
    }
    const blur = () => setTimeout(check, 150)
    vv.addEventListener('resize', check); vv.addEventListener('scroll', check)
    document.addEventListener('focusout', blur)
    return () => {
      vv.removeEventListener('resize', check); vv.removeEventListener('scroll', check)
      document.removeEventListener('focusout', blur)
    }
  }, [])
  return offset
}

// ── Rotating placeholder ─────────────────────────────────────────────────────
// Cycles the example prompts while the field is empty and unfocused, sliding
// each one up and out — this is how the reference teaches its capabilities.
function useRotatingPrompt(active: boolean): string {
  const [i, setI] = useState(0)
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setI(n => (n + 1) % V2_PROMPTS.length), 3800)
    return () => clearInterval(t)
  }, [active])
  return V2_PROMPTS[i]
}

const money = (n?: number, c = 'USD') =>
  typeof n === 'number'
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: c, maximumFractionDigits: 2 }).format(n)
    : ''

// ── Ornament rule (the little engraved divider) ───────────────────────────────
function Ornament({ light = false }: { light?: boolean }) {
  const c = light ? 'rgba(255,255,255,.7)' : V2.ink45
  return (
    <svg width="46" height="10" viewBox="0 0 46 10" fill="none" aria-hidden style={{ display: 'block', margin: '0 auto' }}>
      <path d="M1 5h13M32 5h13" stroke={c} strokeWidth=".7" />
      <path d="M18 5c2-3 4-3 5 0s3 3 5 0" stroke={c} strokeWidth=".7" fill="none" />
    </svg>
  )
}

function Heart({ filled, onClick, size = 34 }: { filled: boolean; onClick: (e: React.MouseEvent) => void; size?: number }) {
  return (
    <button type="button" aria-label={filled ? 'Saved' : 'Save'} onClick={onClick} className="v2-heart" style={{ width: size, height: size }}>
      <svg width={size * 0.44} height={size * 0.44} viewBox="0 0 24 24"
        fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6">
        <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1L12 21l7.7-7.6 1.1-1a5.5 5.5 0 0 0 0-7.8z" />
      </svg>
    </button>
  )
}

// ── Component ────────────────────────────────────────────────────────────────
export default function DiscernV2({
  heroMedia = '/v2/hero.jpg',
  heroPoster,
  onQuery,
}: {
  heroMedia?: string
  heroPoster?: string
  /** Resolve a shopper query into sections. Wire to /api/ai/stylist. */
  onQuery?: (q: string) => Promise<{ sections: V2Section[]; look?: V2Product[] }>
}) {
  const [view, setView] = useState<View>('home')
  const [input, setInput] = useState('')
  const [focused, setFocused] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingLabel, setLoadingLabel] = useState('Crafting your answer')
  const [sections, setSections] = useState<V2Section[]>([])
  const [look, setLook] = useState<V2Product[] | null>(null)
  const [lookOpen, setLookOpen] = useState(false)
  const [product, setProduct] = useState<V2Product | null>(null)
  const [saved, setSaved] = useState<Set<string>>(new Set())
  const [menuOpen, setMenuOpen] = useState(false)
  const [openAcc, setOpenAcc] = useState<'materials' | 'style' | null>(null)
  const [showScroll, setShowScroll] = useState(true)

  const taRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const kb = useKeyboardOffset()
  const [barPressed, setBarPressed] = useState(false)
  const [sendPressed, setSendPressed] = useState(false)
  const barScale = useSpring(barPressed ? 0.985 : 1, 260, 28)
  const sendScale = useSpring(sendPressed ? 0.86 : 1, 380, 24)
  const rotating = useRotatingPrompt(!focused && input.length === 0)

  const canSend = input.trim().length > 0

  // Grow the field with its content, up to 3 lines.
  useEffect(() => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 76) + 'px'
  }, [input, focused])

  const toggleSave = useCallback((id: string) => {
    setSaved(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])

  const submit = useCallback(async () => {
    const q = input.trim()
    if (!q || loading) return
    taRef.current?.blur()
    setLoadingLabel(Math.random() > 0.5 ? 'Crafting your answer' : 'Curating suggestions')
    setLoading(true)
    setLookOpen(false)
    try {
      const res = onQuery ? await onQuery(q) : { sections: [], look: undefined }
      setSections(res.sections ?? [])
      if (res.look?.length) { setLook(res.look); setLookOpen(true) }
      setView('results')
      scrollRef.current?.scrollTo({ top: 0, behavior: 'auto' })
    } finally {
      setLoading(false)
    }
  }, [input, loading, onQuery])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
  }

  // Hide the scroll hint once the shopper has actually scrolled.
  const onScroll = () => {
    const t = scrollRef.current?.scrollTop ?? 0
    setShowScroll(t < 40)
  }

  const openProduct = (p: V2Product) => {
    setProduct(p); setOpenAcc(null); setView('product')
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: 0, behavior: 'auto' }))
  }

  const heroIsVideo = /\.(mp4|webm|mov)$/i.test(heroMedia)

  return (
    <div className="v2-root">
      {/* ── Header — floats over the media, no background of its own ────────── */}
      <header className={`v2-head ${view !== 'home' ? 'solid' : ''}`}>
        <button className="v2-ic" aria-label="Menu" onClick={() => setMenuOpen(true)}>
          <svg width="18" height="18" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5" fill="none">
            <path d="M3 7h18M3 12h18M3 17h18" /></svg>
        </button>
        <button className="v2-ic" aria-label="History">
          <svg width="18" height="18" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5" fill="none">
            <path d="M3 12a9 9 0 1 0 3-6.7M3 4v4h4" /><path d="M12 7v5l3 2" /></svg>
        </button>
        <div className="v2-brand">
          <svg width="26" height="26" viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden>
            <path d="M20 5l9 7v16l-9 7-9-7V12z" /><path d="M20 12l4 3v10l-4 3-4-3V15z" />
          </svg>
          <span>DISCERN</span>
        </div>
        <button className="v2-ic" aria-label="Saved">
          <svg width="18" height="18" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5" fill="none">
            <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1L12 21l7.7-7.6 1.1-1a5.5 5.5 0 0 0 0-7.8z" /></svg>
        </button>
        <button className="v2-ic v2-bag" aria-label="Bag">
          <svg width="18" height="18" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5" fill="none">
            <path d="M6 7h12l-1 14H7L6 7z" /><path d="M9 7V5a3 3 0 0 1 6 0v2" /></svg>
          <i className="v2-dot" />
        </button>
      </header>

      {/* ── Scroller ────────────────────────────────────────────────────────── */}
      <div className="v2-scroll" ref={scrollRef} onScroll={onScroll}>

        {/* 1 ── HERO ─────────────────────────────────────────────────────────── */}
        {view === 'home' && (
          <section className="v2-hero">
            <div className="v2-hero-media">
              {heroIsVideo
                ? <video src={heroMedia} poster={heroPoster} autoPlay muted loop playsInline />
                : <img src={heroMedia} alt="" />}
              <div className="v2-hero-veil" />
            </div>

            {/* Three offset cards, gently floating out of phase */}
            <div className="v2-cards">
              {[0, 1, 2].map(i => (
                <figure key={i} className={`v2-card c${i}`}>
                  <img src={`/v2/card-${i + 1}.jpg`} alt="" />
                </figure>
              ))}
            </div>

            <div className="v2-hero-copy">
              <h1>Where ideas become<br />endless possibilities</h1>
              <p>Welcome to the AI Online Boutique</p>
            </div>
          </section>
        )}

        {/* 2 ── RESULTS ──────────────────────────────────────────────────────── */}
        {view === 'results' && (
          <section className="v2-results">
            {sections.map((s, si) => (
              <React.Fragment key={si}>
                <div className="v2-sec">
                  <h2 className="v2-sec-title">{s.title}</h2>
                  {s.subtitle && <p className="v2-sec-sub">{s.subtitle}</p>}
                  {s.hero && (
                    <div className="v2-sec-hero">
                      <button className="v2-shot" onClick={() => openProduct(s.hero!)}>
                        <img src={s.hero.image} alt={s.hero.title} />
                      </button>
                      <Heart filled={saved.has(s.hero.id)} onClick={e => { e.stopPropagation(); toggleSave(s.hero!.id) }} />
                    </div>
                  )}
                  <button className="v2-discover" onClick={() => s.hero && openProduct(s.hero)}>
                    Discover all {s.title} <span aria-hidden>›</span>
                  </button>
                </div>

                {/* 4 ── MOSAIC ─────────────────────────────────────────────── */}
                {s.products.length > 0 && (
                  <div className="v2-mosaic">
                    {s.products.map((p, i) => (
                      <div key={p.id} className={`v2-tile ${i % 5 === 1 || i % 5 === 2 ? 'tall' : ''}`}>
                        <button className="v2-tile-btn" onClick={() => openProduct(p)}>
                          <img src={p.image} alt={p.title} loading="lazy" />
                        </button>
                        <Heart filled={saved.has(p.id)} onClick={e => { e.stopPropagation(); toggleSave(p.id) }} />
                        <span className="v2-tile-name">{p.title} <i aria-hidden>›</i></span>
                      </div>
                    ))}
                  </div>
                )}

                {/* 3 ── EDITORIAL ──────────────────────────────────────────── */}
                {si < sections.length - 1 && (
                  <div className="v2-editorial">
                    <Ornament light />
                    <p>{V2_EDITORIAL[si % V2_EDITORIAL.length]}</p>
                    <Ornament light />
                  </div>
                )}
              </React.Fragment>
            ))}
          </section>
        )}

        {/* 6 ── PRODUCT ──────────────────────────────────────────────────────── */}
        {view === 'product' && product && (
          <section className="v2-pdp">
            {(product.images?.length ? product.images : [product.image]).map((src, i) => (
              <img key={i} className="v2-pdp-img" src={src} alt="" />
            ))}
            {product.description && (
              <div className="v2-pdp-copy">
                <h3>Description</h3>
                <p>{product.description}</p>
              </div>
            )}
          </section>
        )}
      </div>

      {/* ── Back pill (product view) ───────────────────────────────────────── */}
      {view === 'product' && (
        <button className="v2-back" onClick={() => setView('results')}>
          <span aria-hidden>‹</span> Back
        </button>
      )}

      {/* ── Accordion pills (product view) ─────────────────────────────────── */}
      {view === 'product' && product && (
        <div className="v2-acc" style={{ bottom: `calc(var(--tray) + ${kb}px)` }}>
          {(['materials', 'style'] as const).map(k => (
            <button key={k} className={`v2-acc-pill ${openAcc === k ? 'on' : ''}`}
              onClick={() => setOpenAcc(openAcc === k ? null : k)}>
              {k === 'materials' ? 'MATERIALS' : 'HOW TO STYLE'}
              <i aria-hidden>{openAcc === k ? '–' : '+'}</i>
            </button>
          ))}
        </div>
      )}
      {view === 'product' && product && openAcc && (
        <div className="v2-acc-body" style={{ bottom: `calc(var(--tray) + 54px + ${kb}px)` }}>
          {openAcc === 'materials' ? (product.materials || 'Composition details are being added for this piece.')
                                   : (product.howToStyle || 'Pair it back to tailored trousers and a soft leather shoe.')}
        </div>
      )}

      {/* 5 ── LOOK TRAY ───────────────────────────────────────────────────── */}
      {lookOpen && look && look.length > 0 && view !== 'product' && (
        <div className="v2-tray" style={{ bottom: `calc(var(--bar) + ${kb}px)` }}>
          <div className="v2-tray-row">
            {look.slice(0, 4).map(p => (
              <button key={p.id} className="v2-chip" onClick={() => openProduct(p)}>
                <img src={p.image} alt={p.title} />
              </button>
            ))}
            <Heart filled={look.every(p => saved.has(p.id))} size={44}
              onClick={() => look.forEach(p => toggleSave(p.id))} />
          </div>
          <div className="v2-tray-cta">
            <button className="v2-pill" onClick={() => look[0] && openProduct(look[0])}>Discover the look</button>
            <button className="v2-pill" onClick={() => { setInput('Other suggestions'); submit() }}>Other suggestions</button>
            <button className="v2-x" aria-label="Dismiss" onClick={() => setLookOpen(false)}>
              <svg width="13" height="13" viewBox="0 0 10 10"><path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
            </button>
          </div>
        </div>
      )}

      {/* Scroll hint */}
      {view === 'home' && showScroll && !focused && (
        <button className="v2-scrollhint" style={{ bottom: `calc(var(--bar) + ${kb}px)` }}
          onClick={() => scrollRef.current?.scrollBy({ top: window.innerHeight * .8, behavior: 'smooth' })}>
          <svg width="14" height="14" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" fill="none"><path d="M6 9l6 6 6-6" /></svg>
          Scroll to explore
        </button>
      )}

      {/* 7 ── LOADING ──────────────────────────────────────────────────────── */}
      {loading && (
        <div className="v2-loading">
          <Ornament />
          <h2>{loadingLabel === 'Curating suggestions'
            ? <>Curating <em>suggestions</em></>
            : <>Crafting your <em>answer</em></>}</h2>
          <svg className="v2-skyline" viewBox="0 0 400 90" fill="none" stroke={V2.ink45} strokeWidth=".8" aria-hidden>
            <circle cx="52" cy="20" r="7" />
            <path d="M0 78h400M14 78V56h16v22M30 78V44h10v34M40 78V52h22v26M62 78V38h8v40M70 78V58h26v20M96 78V48h18v30M114 78V64h22v14M136 78V42h9v36M145 78V60h30v18M175 78V50h16v28M191 78V66h26v12M217 78V46h10v32M227 78V58h24v20M251 78V54h18v24M269 78V64h28v14M297 78V44h9v34M306 78V60h26v18M332 78V52h16v26M348 78V66h24v12M372 78V56h14v22" />
            <path d="M22 56l-4 4h12l-4-4M144 42l-4 5h10l-4-5M301 44l-4 5h10l-4-5" />
          </svg>
        </div>
      )}

      {/* ── Menu ───────────────────────────────────────────────────────────── */}
      <div className={`v2-menu-ov ${menuOpen ? 'on' : ''}`} onClick={() => setMenuOpen(false)} />
      <nav className={`v2-menu ${menuOpen ? 'on' : ''}`} aria-hidden={!menuOpen}>
        <button className="v2-menu-x" aria-label="Close" onClick={() => setMenuOpen(false)}>
          <svg width="15" height="15" viewBox="0 0 10 10"><path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
        </button>
        <span className="v2-menu-eyebrow">Menu</span>
        <ul>{['New arrivals', 'Women', 'Men', 'Collections', 'The house', 'Contact'].map(x => <li key={x}>{x}</li>)}</ul>
        <Ornament />
      </nav>

      {/* ── AI BAR ─────────────────────────────────────────────────────────── */}
      <div className="v2-bar-wrap" style={{ bottom: kb }}>
        <div style={{ transform: `scale(${barScale})`, transformOrigin: 'center bottom' }}
          onPointerDown={() => setBarPressed(true)}
          onPointerUp={() => setBarPressed(false)}
          onPointerLeave={() => setBarPressed(false)}>
          <div className={`v2-bar ${focused ? 'focus' : ''} ${view === 'home' ? 'on-media' : ''}`}>
            <button className="v2-plus" aria-label="Add a photo">
              <svg width="15" height="15" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            </button>

            <div className="v2-field">
              <textarea
                ref={taRef} rows={1} value={input}
                onChange={e => setInput(e.target.value)}
                onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
                onKeyDown={onKeyDown}
                aria-label="Ask the boutique"
              />
              {input.length === 0 && (
                <span key={rotating} className="v2-ph">{focused ? 'Ask anything…' : rotating}</span>
              )}
            </div>

            {input.length > 0 && (
              <button className="v2-clear" aria-label="Clear" onClick={() => { setInput(''); taRef.current?.focus() }}>
                <svg width="12" height="12" viewBox="0 0 10 10"><path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
              </button>
            )}

            <div style={{ transform: `scale(${sendScale})` }}
              onPointerDown={() => setSendPressed(true)}
              onPointerUp={() => setSendPressed(false)}
              onPointerLeave={() => setSendPressed(false)}>
              <button className={`v2-send ${canSend ? 'on' : ''}`} aria-label="Send" onClick={submit} disabled={loading}>
                {loading
                  ? <Ornament />
                  : <svg width="15" height="15" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none">
                      <path d="M12 19V5M5 12l7-7 7 7" /></svg>}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Add-to-cart tray (product view) ────────────────────────────────── */}
      {view === 'product' && product && (
        <div className="v2-cart" style={{ bottom: kb }}>
          <img className="v2-cart-thumb" src={product.image} alt="" />
          <div className="v2-cart-meta">
            <span className="v2-cart-name">{product.title}</span>
            <span className="v2-cart-price">
              {money(product.price, product.currency)}
              {product.compareAt ? <em>{money(product.compareAt, product.currency)}</em> : null}
            </span>
            {(product.colorName || product.colorCount) && (
              <span className="v2-cart-color">
                {product.colorName}{product.colorCount ? ` | ${product.colorCount} colors` : ''}
              </span>
            )}
          </div>
          <Heart filled={saved.has(product.id)} onClick={() => toggleSave(product.id)} />
          <div className="v2-cart-cta">
            <button className="v2-buy">Add to cart</button>
            {product.colorCount ? <button className="v2-pill">See all colors</button> : null}
            {product.sizes?.length ? <button className="v2-pill">Select size</button> : null}
            <button className="v2-x" aria-label="Close" onClick={() => setView('results')}>
              <svg width="13" height="13" viewBox="0 0 10 10"><path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
            </button>
          </div>
        </div>
      )}

      <style jsx global>{`
        :root { --bar: 96px; --tray: 104px; }

        .v2-root{position:fixed;inset:0;background:${V2.bone};color:${V2.ink};
          font-family:${V2.sans};overflow:hidden;}

        /* ── Header ─────────────────────────────────────────────────────── */
        .v2-head{position:absolute;top:0;left:0;right:0;z-index:40;
          display:flex;align-items:center;gap:2px;
          padding:calc(env(safe-area-inset-top,0px) + 12px) 14px 12px;
          color:#fff;transition:color .45s ${V2.ease},background .45s ${V2.ease};
          background:linear-gradient(to bottom,rgba(0,0,0,.34),rgba(0,0,0,0));}
        .v2-head.solid{color:${V2.ink};background:linear-gradient(to bottom,${V2.bone} 62%,rgba(242,239,234,0));}
        .v2-ic{width:34px;height:34px;display:flex;align-items:center;justify-content:center;
          background:none;border:none;color:inherit;cursor:pointer;position:relative;
          -webkit-tap-highlight-color:transparent;}
        .v2-ic:active{transform:scale(.9);}
        .v2-brand{flex:1;display:flex;flex-direction:column;align-items:center;gap:1px;pointer-events:none;}
        .v2-brand span{font-family:${V2.serif};font-size:12.5px;letter-spacing:.34em;
          text-indent:.34em;font-weight:400;white-space:nowrap;}
        .v2-dot{position:absolute;top:7px;right:6px;width:5px;height:5px;border-radius:50%;
          background:currentColor;}

        /* ── Scroller ───────────────────────────────────────────────────── */
        .v2-scroll{position:absolute;inset:0;overflow-y:auto;overflow-x:hidden;
          -webkit-overflow-scrolling:touch;scrollbar-width:none;}
        .v2-scroll::-webkit-scrollbar{display:none;}

        /* ── 1. Hero ────────────────────────────────────────────────────── */
        .v2-hero{position:relative;min-height:100svh;display:flex;flex-direction:column;
          justify-content:flex-end;padding-bottom:calc(var(--bar) + 44px);}
        .v2-hero-media{position:absolute;inset:0;overflow:hidden;}
        .v2-hero-media img,.v2-hero-media video{width:100%;height:100%;object-fit:cover;display:block;}
        .v2-hero-veil{position:absolute;inset:0;
          background:linear-gradient(to bottom,rgba(20,17,14,.42) 0%,rgba(20,17,14,.12) 32%,rgba(20,17,14,.55) 78%,rgba(20,17,14,.72) 100%);}
        .v2-cards{position:relative;z-index:2;display:flex;align-items:center;justify-content:center;
          gap:10px;padding:0 16px;margin-bottom:auto;margin-top:calc(env(safe-area-inset-top,0px) + 96px);}
        .v2-card{margin:0;width:29%;aspect-ratio:3/4;overflow:hidden;flex-shrink:0;
          box-shadow:0 18px 46px rgba(0,0,0,.34);animation:v2-float 7s ease-in-out infinite;}
        .v2-card img{width:100%;height:100%;object-fit:cover;display:block;}
        .v2-card.c0{transform:translateY(14px) rotate(-1.4deg);animation-delay:-1.1s;}
        .v2-card.c1{width:36%;z-index:2;transform:translateY(-10px);}
        .v2-card.c2{transform:translateY(18px) rotate(1.6deg);animation-delay:-3.4s;}
        @keyframes v2-float{0%,100%{translate:0 0}50%{translate:0 -7px}}
        @media (prefers-reduced-motion:reduce){.v2-card{animation:none}}

        .v2-hero-copy{position:relative;z-index:2;text-align:center;color:#fff;padding:0 22px;}
        .v2-hero-copy h1{font-family:${V2.serif};font-weight:300;letter-spacing:-.01em;
          font-size:clamp(30px,8.6vw,46px);line-height:1.08;margin:0 0 12px;
          text-shadow:0 2px 26px rgba(0,0,0,.4);}
        .v2-hero-copy p{font-size:14px;font-weight:300;letter-spacing:.01em;margin:0;opacity:.92;}

        /* ── 2. Results ─────────────────────────────────────────────────── */
        .v2-results{padding-bottom:calc(var(--bar) + 40px);}
        .v2-sec{padding:clamp(64px,15vw,104px) 20px 0;text-align:center;}
        .v2-sec-title{font-family:${V2.serif};font-weight:300;font-size:clamp(27px,7.4vw,38px);
          line-height:1.1;margin:0 0 8px;letter-spacing:-.005em;}
        .v2-sec-sub{font-size:14px;font-weight:300;color:${V2.ink70};margin:0 0 30px;}
        .v2-sec-hero{position:relative;margin:0 auto;max-width:min(420px,88vw);}
        .v2-shot{display:block;width:100%;padding:0;border:none;background:${V2.boneDeep};cursor:pointer;}
        .v2-shot img{width:100%;aspect-ratio:3/4;object-fit:cover;display:block;}
        .v2-sec-hero .v2-heart{position:absolute;right:12px;bottom:12px;}
        .v2-discover{display:inline-flex;align-items:center;gap:7px;margin-top:16px;
          background:none;border:none;cursor:pointer;color:${V2.ink};
          font-size:14.5px;font-weight:400;padding:6px 2px;}
        .v2-discover span{font-size:17px;line-height:1;}

        /* ── 4. Mosaic ──────────────────────────────────────────────────── */
        .v2-mosaic{display:grid;grid-template-columns:1fr 1fr;gap:3px;padding:34px 3px 0;}
        @media(min-width:760px){.v2-mosaic{grid-template-columns:repeat(3,1fr);}}
        @media(min-width:1180px){.v2-mosaic{grid-template-columns:repeat(4,1fr);}}
        .v2-tile{position:relative;background:${V2.boneDeep};}
        .v2-tile-btn{display:block;width:100%;padding:0;border:none;background:none;cursor:pointer;}
        .v2-tile img{width:100%;aspect-ratio:3/4;object-fit:cover;display:block;
          transition:transform .7s ${V2.ease};}
        .v2-tile.tall img{aspect-ratio:2/3;}
        @media(hover:hover){.v2-tile:hover img{transform:scale(1.035);}}
        .v2-tile .v2-heart{position:absolute;right:9px;bottom:34px;}
        .v2-tile-name{display:block;padding:9px 4px 16px;font-size:13px;font-weight:400;
          color:${V2.ink};text-align:left;}
        .v2-tile-name i{font-style:normal;color:${V2.ink45};}

        /* ── 3. Editorial ───────────────────────────────────────────────── */
        .v2-editorial{margin-top:34px;padding:clamp(88px,24vw,150px) 26px;text-align:center;
          background:linear-gradient(150deg,#2A2E2C 0%,#1D2220 55%,#141817 100%);color:#fff;
          display:flex;flex-direction:column;gap:30px;align-items:center;}
        .v2-editorial p{font-family:${V2.serif};font-weight:300;font-size:clamp(23px,6.2vw,31px);
          line-height:1.28;margin:0;max-width:19ch;}

        /* ── 6. Product ─────────────────────────────────────────────────── */
        .v2-pdp{padding-bottom:calc(var(--tray) + 92px);background:${V2.bone};}
        .v2-pdp-img{width:100%;display:block;background:${V2.boneDeep};}
        .v2-pdp-copy{padding:38px 24px 10px;}
        .v2-pdp-copy h3{font-size:11px;letter-spacing:.16em;text-transform:uppercase;
          font-weight:500;color:${V2.ink70};margin:0 0 14px;}
        .v2-pdp-copy p{font-size:15px;line-height:1.62;font-weight:300;margin:0;color:${V2.ink};}

        .v2-back{position:absolute;z-index:45;top:calc(env(safe-area-inset-top,0px) + 58px);left:14px;
          display:flex;align-items:center;gap:7px;padding:9px 17px 9px 13px;border:none;
          border-radius:999px;cursor:pointer;font-size:14px;color:${V2.ink};
          background:${V2.glassLight};backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);
          box-shadow:0 3px 16px rgba(0,0,0,.10);}
        .v2-back span{font-size:17px;line-height:1;}

        /* Accordion pills */
        .v2-acc{position:absolute;z-index:44;left:14px;right:14px;display:flex;gap:9px;}
        .v2-acc-pill{display:inline-flex;align-items:center;gap:9px;padding:10px 15px;border:none;
          border-radius:999px;cursor:pointer;font-size:11.5px;letter-spacing:.11em;font-weight:500;
          color:#fff;background:${V2.glassDark};
          backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);}
        .v2-acc-pill i{font-style:normal;font-size:14px;opacity:.85;}
        .v2-acc-pill.on{background:rgba(28,27,25,.82);}
        .v2-acc-body{position:absolute;z-index:44;left:14px;right:14px;padding:16px 18px;
          border-radius:16px;font-size:13.5px;line-height:1.6;font-weight:300;color:#fff;
          background:${V2.glassDark};backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);
          animation:v2-rise .3s ${V2.ease};}

        /* ── 5. Look tray ───────────────────────────────────────────────── */
        .v2-tray{position:absolute;z-index:42;left:12px;right:12px;padding:11px;border-radius:22px;
          background:${V2.glassDark};backdrop-filter:blur(22px);-webkit-backdrop-filter:blur(22px);
          box-shadow:0 14px 44px rgba(0,0,0,.3);animation:v2-rise .4s ${V2.ease};color:#fff;}
        .v2-tray-row{display:flex;gap:8px;align-items:stretch;}
        .v2-chip{flex:1;min-width:0;aspect-ratio:3/4;padding:0;border:none;border-radius:9px;
          overflow:hidden;background:rgba(255,255,255,.1);cursor:pointer;
          box-shadow:inset 0 0 0 1px ${V2.glassEdge};}
        .v2-chip img{width:100%;height:100%;object-fit:cover;display:block;}
        .v2-tray-row .v2-heart{flex:1;height:auto;aspect-ratio:3/4;border-radius:9px;
          box-shadow:inset 0 0 0 1px ${V2.glassEdge};background:rgba(255,255,255,.06);}
        .v2-tray-cta{display:flex;gap:8px;margin-top:10px;align-items:center;}

        /* ── Shared pills ───────────────────────────────────────────────── */
        .v2-pill{flex:1;min-width:0;padding:12px 10px;border:none;border-radius:999px;cursor:pointer;
          font-size:13.5px;font-weight:400;color:#fff;background:rgba(255,255,255,.16);
          white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
          transition:background .18s ${V2.ease};}
        .v2-pill:active{background:rgba(255,255,255,.26);}
        .v2-x{width:40px;height:40px;flex-shrink:0;border:none;border-radius:50%;cursor:pointer;
          display:flex;align-items:center;justify-content:center;color:#fff;
          background:rgba(255,255,255,.16);}
        .v2-heart{border:none;border-radius:50%;cursor:pointer;display:flex;align-items:center;
          justify-content:center;color:${V2.ink};background:rgba(255,255,255,.78);
          backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
          box-shadow:0 2px 10px rgba(0,0,0,.13);transition:transform .16s ${V2.ease};}
        .v2-heart:active{transform:scale(.88);}

        .v2-scrollhint{position:absolute;z-index:41;left:50%;translate:-50% 0;
          display:inline-flex;align-items:center;gap:9px;padding:11px 20px;border:none;
          border-radius:999px;cursor:pointer;font-size:13.5px;color:#fff;
          background:${V2.glassDark};backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);
          animation:v2-fade .6s ${V2.ease};}

        /* ── 7. Loading ─────────────────────────────────────────────────── */
        .v2-loading{position:absolute;inset:0;z-index:60;background:${V2.bone};
          display:flex;flex-direction:column;align-items:center;justify-content:center;gap:26px;
          padding:0 24px calc(var(--bar) + 40px);animation:v2-fade .35s ${V2.ease};}
        .v2-loading h2{font-family:${V2.serif};font-weight:300;font-size:clamp(26px,7vw,34px);
          margin:0;letter-spacing:-.005em;}
        .v2-loading h2 em{font-style:italic;}
        .v2-skyline{width:min(430px,92vw);opacity:.5;
          stroke-dasharray:1400;stroke-dashoffset:1400;animation:v2-draw 3.4s ${V2.ease} forwards;}
        @keyframes v2-draw{to{stroke-dashoffset:0}}

        /* ── Menu ───────────────────────────────────────────────────────── */
        .v2-menu-ov{position:absolute;inset:0;z-index:70;background:rgba(16,14,12,0);
          pointer-events:none;transition:background .42s ${V2.ease};}
        .v2-menu-ov.on{background:rgba(16,14,12,.46);pointer-events:auto;
          backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);}
        .v2-menu{position:absolute;z-index:71;inset:0 auto 0 0;width:min(310px,86%);
          background:${V2.bone};padding:calc(env(safe-area-inset-top,0px) + 28px) 26px 30px;
          transform:translateX(-101%);transition:transform .46s ${V2.easeInOut};
          display:flex;flex-direction:column;gap:26px;
          box-shadow:14px 0 60px rgba(0,0,0,.16);}
        .v2-menu.on{transform:translateX(0);}
        .v2-menu-x{align-self:flex-end;width:34px;height:34px;border:none;background:none;
          color:${V2.ink};cursor:pointer;}
        .v2-menu-eyebrow{font-size:10.5px;letter-spacing:.2em;text-transform:uppercase;color:${V2.ink45};}
        .v2-menu ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:19px;}
        .v2-menu li{font-family:${V2.serif};font-size:25px;font-weight:300;cursor:pointer;
          transition:opacity .18s;}
        .v2-menu li:active{opacity:.55;}

        /* ── AI bar ─────────────────────────────────────────────────────── */
        .v2-bar-wrap{position:absolute;z-index:50;left:0;right:0;
          padding:14px clamp(12px,3.6vw,18px) calc(env(safe-area-inset-bottom,0px) + 16px);
          pointer-events:none;}
        .v2-bar-wrap>*{pointer-events:auto;}
        .v2-bar{display:flex;align-items:flex-end;gap:9px;padding:9px 9px 9px 10px;
          width:100%;max-width:min(680px,96vw);margin:0 auto;border-radius:30px;
          background:${V2.glassDark};backdrop-filter:blur(26px) saturate(150%);
          -webkit-backdrop-filter:blur(26px) saturate(150%);
          box-shadow:0 10px 40px rgba(0,0,0,.26),inset 0 1px 0 ${V2.glassEdge};
          transition:background .3s ${V2.ease},box-shadow .3s ${V2.ease};color:#fff;}
        .v2-bar.focus{background:rgba(26,24,21,.88);}
        .v2-plus,.v2-send,.v2-clear{flex-shrink:0;border:none;cursor:pointer;display:flex;
          align-items:center;justify-content:center;border-radius:50%;color:#fff;
          transition:background .2s ${V2.ease},transform .12s ${V2.ease};}
        .v2-plus{width:38px;height:38px;background:rgba(255,255,255,.13);}
        .v2-plus:active{transform:scale(.9);}
        .v2-clear{width:26px;height:26px;margin-bottom:6px;background:rgba(255,255,255,.16);}
        .v2-send{width:38px;height:38px;background:rgba(255,255,255,.13);}
        .v2-send.on{background:#fff;color:${V2.ink};}
        .v2-send:disabled{cursor:default;}

        .v2-field{position:relative;flex:1;min-width:0;padding:9px 0 8px;}
        .v2-field textarea{width:100%;border:none;background:none;outline:none;resize:none;
          font-family:${V2.sans};font-size:16px;line-height:1.42;color:#fff;
          max-height:76px;overflow-y:auto;display:block;caret-color:#fff;}
        .v2-ph{position:absolute;left:0;top:9px;pointer-events:none;font-size:16px;line-height:1.42;
          color:rgba(255,255,255,.62);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
          max-width:100%;animation:v2-ph .42s ${V2.ease};}
        @keyframes v2-ph{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:none}}

        /* ── Cart tray ──────────────────────────────────────────────────── */
        .v2-cart{position:absolute;z-index:50;left:12px;right:12px;
          margin-bottom:calc(env(safe-area-inset-bottom,0px) + 14px);
          display:grid;grid-template-columns:auto 1fr auto;gap:11px;align-items:center;
          padding:12px;border-radius:22px;color:#fff;
          background:${V2.glassDark};backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);
          box-shadow:0 14px 44px rgba(0,0,0,.32);animation:v2-rise .42s ${V2.ease};}
        .v2-cart-thumb{width:56px;height:72px;object-fit:cover;border-radius:8px;display:block;
          box-shadow:inset 0 0 0 1px ${V2.glassEdge};}
        .v2-cart-meta{min-width:0;display:flex;flex-direction:column;gap:3px;}
        .v2-cart-name{font-size:16px;font-weight:400;white-space:nowrap;overflow:hidden;
          text-overflow:ellipsis;}
        .v2-cart-price{font-size:13.5px;font-weight:400;display:flex;gap:8px;align-items:baseline;}
        .v2-cart-price em{font-style:normal;text-decoration:line-through;opacity:.55;font-size:12.5px;}
        .v2-cart-color{font-size:12.5px;opacity:.72;}
        .v2-cart-cta{grid-column:1/-1;display:flex;gap:8px;align-items:center;margin-top:2px;}
        .v2-buy{flex-shrink:0;padding:13px 26px;border:none;border-radius:999px;cursor:pointer;
          background:#fff;color:${V2.ink};font-size:14.5px;font-weight:400;
          transition:transform .12s ${V2.ease};}
        .v2-buy:active{transform:scale(.97);}

        @keyframes v2-rise{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
        @keyframes v2-fade{from{opacity:0}to{opacity:1}}

        /* Tablet / desktop: the bar centres and the tray never spans the full
           width, so the composition stays boutique rather than app-like. */
        @media(min-width:760px){
          :root{--bar:104px;}
          .v2-tray,.v2-cart{left:50%;translate:-50% 0;width:min(560px,92vw);}
          .v2-acc{left:50%;translate:-50% 0;width:min(560px,92vw);}
          .v2-acc-body{left:50%;translate:-50% 0;width:min(560px,92vw);}
          .v2-back{left:50%;margin-left:min(-280px,-46vw);}
        }
      `}</style>
    </div>
  )
}
