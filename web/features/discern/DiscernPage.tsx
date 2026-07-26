'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useSession, signIn, signOut } from 'next-auth/react'
import { useQuery, useMutation } from 'convex/react'
import { api } from '@/convex/_generated/api'
import { useDiscernChat } from './hooks/useDiscernChat'
import { useConvexAuthProof, fetchConvexAuthProof } from '@/hooks/useConvexAuthProof'
import { formatMoney, convertCurrencyAmount } from '@/lib/currency'
import type { ShopperContext } from '@/lib/shopperContext'
import { ExchangeRates } from '@/lib/exchangeRates'
import type { Product } from '@/components/ProductCard'
import { BRAND_NAMES, UCP_REGISTRY, cleanBrandToken } from '@/lib/stores'
import { TAGLINES, shuffledIndices } from './taglines'
import DOMPurify from 'dompurify'

// ── Palette ───────────────────────────────────────────────────────────────────
// Cool neutral system (Apple/Linear-style) — near-black/gray/white, one
// restrained accent color reserved for primary actions and confidence
// badges. Previously a warm ink-brown theme; every usage below still flows
// through these same constant names, so the whole app repaints from here.
const INK   = "#1D1D1F"   // near-black (primary text/UI)
const INK2  = "#3A3A3C"   // dark gray (secondary emphasis)
const INK3  = "#8E8E93"   // mid gray (tertiary/secondary text)
const BRD   = "rgba(0,0,0,0.08)"
const BG    = "#FFFFFF"   // pure white
const BG2   = "#FFFFFF"   // white (no beige anywhere — separation comes from borders)
const ACCENT = "#0071E3"  // restrained accent — primary actions, confidence badges only
const SANS  = "'DM Sans', system-ui, sans-serif"
const SERIF = "'Cormorant Garamond', Georgia, serif"
const SEASON = "'TANMeringue', 'Bodoni Moda', Georgia, serif"
const GEIST = "'Geist', 'DM Sans', system-ui, sans-serif"
// Wordmark-only face — licensed PP Gatwick (Ultralight), self-hosted via
// @font-face in app/globals.css. Never used for body/UI text, only the
// literal brand mark rendered by DiscernLogo below. Jost kept as the
// fallback in the stack in case the webfont fails to load.
const WORDMARK = "'PP Gatwick', 'Jost', 'Geist', 'DM Sans', system-ui, sans-serif"

// ── One-time localStorage migration: from → discern (the FROM → Discern
// rebrand) ───────────────────────────────────────────────────────────────────
// Every browser key this app has ever written was brand-prefixed: the "from:"
// colon namespace (explore cache, stylist history, every individual session
// blob, saved products, size-guide unit) plus two underscore-style keys
// (from_user_name — the shopper's display name; from_admin_secret handled on
// its own page). Runs at module load, before any component's useState
// initializer reads localStorage, so every read below sees the migrated key
// immediately. Copies forward only (never deletes the old key, and never
// overwrites an already-migrated new key), so it's safe to run on every page
// load and can't lose data even if it partially ran before.
function migrateBrandedLocalStorage() {
  if (typeof window === 'undefined') return
  try {
    const copy = (oldKey: string, newKey: string) => {
      if (localStorage.getItem(newKey) === null) {
        const val = localStorage.getItem(oldKey)
        if (val !== null) localStorage.setItem(newKey, val)
      }
    }
    // The "from:" colon namespace — generic, covers every key of that shape.
    for (const oldKey of Object.keys(localStorage).filter(k => k.startsWith('from:'))) {
      copy(oldKey, 'discern:' + oldKey.slice('from:'.length))
    }
    // The one underscore-style user-data key this page owns.
    copy('from_user_name', 'discern_user_name')
  } catch {}
}
migrateBrandedLocalStorage()

// ── Spring physics hook ───────────────────────────────────────────────────────
// Runs a damped spring in a RAF loop; returns live animated value.
function useSpring(target: number, stiffness = 220, damping = 26): number {
  const pos = useRef(target)
  const vel = useRef(0)
  const raf = useRef<number | null>(null)
  const [value, set] = useState(target)

  useEffect(() => {
    const tick = () => {
      const disp = pos.current - target
      const acc  = -stiffness * disp - damping * vel.current
      vel.current += acc / 60
      pos.current += vel.current / 60
      set(pos.current)
      if (Math.abs(disp) > 5e-4 || Math.abs(vel.current) > 5e-4) {
        raf.current = requestAnimationFrame(tick)
      }
    }
    if (raf.current) cancelAnimationFrame(raf.current)
    raf.current = requestAnimationFrame(tick)
    return () => { if (raf.current) cancelAnimationFrame(raf.current) }
  }, [target, stiffness, damping])

  return value
}

// ── Mouse-tracking specular highlight ────────────────────────────────────────
function useLight(elRef: React.RefObject<HTMLDivElement | null>) {
  const [pos, setPos] = useState({ x: 0.28, y: 0.22 })
  useEffect(() => {
    const el = elRef.current; if (!el) return
    const move = (e: MouseEvent) => {
      const r = el.getBoundingClientRect()
      setPos({
        x: Math.max(0, Math.min(1, (e.clientX - r.left)  / r.width)),
        y: Math.max(0, Math.min(1, (e.clientY - r.top)   / r.height)),
      })
    }
    el.addEventListener('mousemove', move)
    return () => el.removeEventListener('mousemove', move)
  }, [elRef])
  return pos
}

// ── Discern wordmark ─────────────────────────────────────────────────────────────
// Fabrics mark — a fanned set of fabric swatches pinned at the base, the way a
// stylist flips through a swatch book to choose materials. Original to Fabrics.
function FabricsIcon({ size = 15, stroke = 'currentColor', strokeWidth = 1.0 }: { size?: number; stroke?: string; strokeWidth?: number }) {
  // The whole craft of Fabrics in one mark: a spool of thread, its thread
  // running out into a woven running-stitch, then up through a needle — spool,
  // weave, thread and needle unified into a single line-art glyph.
  const bold = strokeWidth * 1.4
  const thin = strokeWidth * 0.85
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke}
      strokeLinecap="round" strokeLinejoin="round">
      {/* spool — caps, sides, wound thread */}
      <path strokeWidth={bold} d="M3.4 6.4 L6.8 6.4 M3.4 12 L6.8 12"/>
      <path strokeWidth={bold} d="M4.3 6.6 L4.3 11.8 M5.9 6.6 L5.9 11.8"/>
      <path strokeWidth={thin} d="M4.3 8.2 L5.9 8.5 M4.3 10 L5.9 10.3"/>
      {/* the thread runs out into a woven running-stitch */}
      <path strokeWidth={bold} d="M5.9 9.5 C 8 9.5, 8 12.5, 10 12.5 C 12 12.5, 12 9.5, 14 9.5"/>
      {/* needle, with the thread passing up through its eye */}
      <line strokeWidth={bold} x1="12.8" y1="16.9" x2="19.4" y2="7.7"/>
      <ellipse strokeWidth={thin + 0.15} cx="18.5" cy="9" rx="0.55" ry="1.25" transform="rotate(55 18.5 9)"/>
      <path strokeWidth={thin} d="M14 9.5 C 15.3 9.7, 16.5 9.2, 17.6 8.6"/>
    </svg>
  )
}

function DiscernLogo({ size = 28, color = "#000000", showTag = true }: { size?: number; color?: string; showTag?: boolean }) {
  const markSize = Math.round(size * 1.05)
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: Math.round(size * 0.25), userSelect: 'none' }}>
      <img
        src="/discern-mark-v2.png"
        alt="Discern"
        width={markSize}
        height={markSize}
        style={{ display: 'block', objectFit: 'contain', flexShrink: 0, borderRadius: Math.round(markSize * 0.22) }}
      />
      <span style={{ display: 'flex', alignItems: 'baseline', gap: Math.round(size * 0.2) }}>
        {(() => {
          const wordmarkSize = Math.round(size * 0.95)
          // PP Gatwick only ships Ultralight (200) and Bold (700) here, no
          // in-between weight file — Ultralight alone reads too thin at
          // logo size, Bold reads too heavy. -webkit-text-stroke adds a
          // hairline outline in the same color as the fill, visually
          // thickening the strokes without switching weight entirely.
          // A ratio tuned in desktop Chromium (2.2%, ~0.6px at this size)
          // still read visibly thinner than the reference once checked on
          // a real device (iOS Safari) — sub-1px stroke widths round/
          // antialias less faithfully there than in a desktop headless
          // browser. Bumped up with a firmer minimum so it holds its
          // weight across engines; WebkitFontSmoothing keeps it crisp
          // instead of blurry-thin. Firefox ignores -webkit-text-stroke and
          // shows unstroked Ultralight, a graceful (if thinner) fallback.
          const strokeWidth = Math.max(0.9, +(wordmarkSize * 0.038).toFixed(2))
          return (
            <span style={{ fontFamily: WORDMARK, fontSize: wordmarkSize, fontWeight: 200, color,
              letterSpacing: '0.04em', lineHeight: 1, WebkitFontSmoothing: 'antialiased',
              WebkitTextStroke: `${strokeWidth}px ${color}` } as React.CSSProperties}>
              DISCERN
            </span>
          )
        })()}
        {showTag && (
          <span style={{ fontFamily: SANS, fontSize: Math.round(size * 0.42), fontWeight: 400,
            letterSpacing: '0.08em', color: 'rgba(0,0,0,0.4)', lineHeight: 1,
            position: 'relative', top: Math.round(size * -0.08) }}>
            | Early Access
          </span>
        )}
      </span>
    </span>
  )
}

// Six-box OTP entry — replaces a single free-text field with one focused
// digit slot per box (auto-advancing, backspace-to-previous, and a full
// paste/fast-type into any box redistributes the remaining digits forward).
function OtpBoxInput({ value, onChange, length = 6, autoFocus = false, boxSize = 46 }:
  { value: string; onChange: (v: string) => void; length?: number; autoFocus?: boolean; boxSize?: number }) {
  const refs = useRef<(HTMLInputElement | null)[]>([])
  const digits = Array.from({ length }, (_, i) => value[i] ?? '')

  function setDigit(i: number, raw: string) {
    const clean = raw.replace(/\D/g, '')
    if (!clean) { onChange(value.slice(0, i) + value.slice(i + 1)); return }
    if (clean.length > 1) {
      // Paste or fast native-autofill — spread starting at this box.
      const next = digits.slice()
      for (let j = 0; j < clean.length && i + j < length; j++) next[i + j] = clean[j]
      const joined = next.join('')
      onChange(joined)
      refs.current[Math.min(i + clean.length, length - 1)]?.focus()
      return
    }
    const next = digits.slice()
    next[i] = clean
    onChange(next.join(''))
    if (i < length - 1) refs.current[i + 1]?.focus()
  }

  function handleKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !digits[i] && i > 0) refs.current[i - 1]?.focus()
  }

  return (
    <div style={{ display: 'flex', gap: Math.round(boxSize * 0.22), justifyContent: 'center' }}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={el => { refs.current[i] = el }}
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={length}
          value={d}
          autoFocus={autoFocus && i === 0}
          onChange={e => setDigit(i, e.target.value)}
          onKeyDown={e => handleKeyDown(i, e)}
          onFocus={e => e.target.select()}
          className="fr-otp-box"
          style={{
            width: boxSize, height: Math.round(boxSize * 1.17), textAlign: 'center', fontSize: Math.round(boxSize * 0.43), fontWeight: 600,
            fontFamily: SANS, color: INK, background: BG2, borderRadius: Math.round(boxSize * 0.26),
            border: `1.5px solid ${BRD}`, outline: 'none',
          }}
        />
      ))}
    </div>
  )
}

// Map the few .myshopify.com registry domains to their real storefront so the
// logo service can resolve them; everything else uses its own domain.
const LOGO_DOMAIN: Record<string, string> = {
  'gymsharkusa.myshopify.com': 'gymshark.com',
  'skimsbody.myshopify.com': 'skims.com',
  'bombas.myshopify.com': 'bombas.com',
  'chubbies.myshopify.com': 'chubbiesshorts.com',
  'faherty.myshopify.com': 'fahertybrand.com',
  'spanx-com.myshopify.com': 'spanx.com',
  'slvrlake.myshopify.com': 'slvrlake-denim.com',
  'hommeyusa.myshopify.com': 'gethommey.com.au',
  'senso.myshopify.com': 'senso.com.au',
  'jeffs.myshopify.com': 'studiojeffs.com',
  'asos.myshopify.com': 'asos.com',
}
function logoDomain(domain: string): string {
  return LOGO_DOMAIN[domain] || domain
}

// Brand logo with a graceful typographic monogram fallback.
function BrandLogo({ domain, name, size = 44 }: { domain: string; name: string; size?: number }) {
  const [failed, setFailed] = useState(false)
  const initial = (name.replace(/[^A-Za-z0-9]/g, '').charAt(0) || '?').toUpperCase()
  if (failed) {
    return (
      <div style={{ width: size, height: size, borderRadius: '50%', background: '#F2EDE9',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        fontFamily: SERIF, fontSize: size * 0.46, fontWeight: 500, color: '#1D1D1F' }}>
        {initial}
      </div>
    )
  }
  return (
    <img src={`https://logo.clearbit.com/${logoDomain(domain)}`} alt="" loading="lazy"
      onError={() => setFailed(true)}
      style={{ width: size, height: size, borderRadius: '50%', objectFit: 'contain',
        background: '#fff', border: '1px solid rgba(0,0,0,0.08)', flexShrink: 0 }} />
  )
}

// ── Collapsible accordion row (H&M editorial style) ───────────────────────────
function Accordion({ label, children, defaultOpen = false }: { label: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{ borderTop: `1px solid ${BRD}` }}>
      <button onClick={() => setOpen(o => !o)} style={{
        width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "17px 0", background: "transparent", border: "none", cursor: "pointer", textAlign: "left",
      }}>
        <span style={{ fontFamily: SANS, fontSize: 12, fontWeight: 600, letterSpacing: ".07em", textTransform: "uppercase", color: INK }}>{label}</span>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth="1.6" strokeLinecap="round">
          <line x1="5" y1="12" x2="19" y2="12" />
          {!open && <line x1="12" y1="5" x2="12" y2="19" />}
        </svg>
      </button>
      <div style={{ display: "grid", gridTemplateRows: open ? "1fr" : "0fr", transition: "grid-template-rows .28s cubic-bezier(.32,.72,0,1)" }}>
        <div style={{ overflow: "hidden" }}>
          <div style={{ paddingBottom: 18 }}>{children}</div>
        </div>
      </div>
    </div>
  )
}

// ── Product helpers ───────────────────────────────────────────────────────────
// Signals that an image shows a person/model wearing the item.
const MODEL_HINTS = /(model|wearing|worn|lifestyle|on[-_ ]?body|onbody|outfit|\blook\b|\bfit\b|person|portrait|editorial|campaign|street|styled?)/i
// Signals that an image is a product-only / flat / studio shot.
const FLAT_HINTS  = /(flat[-_ ]?lay|flatlay|pack[-_ ]?shot|packshot|still[-_ ]?life|product[-_ ]?(shot|only)|ghost|mannequin|swatch|fabric|\bdetail\b|close[-_ ]?up|closeup|back[-_ ]?view|folded|hanger|cut[-_ ]?out|cutout|\blabel\b|white[-_ ]?bg|on[-_ ]?white)/i

// Read the original pixel dimensions encoded in a Shopify CDN URL — either the
// "_800x1067" path segment or width/height query params — and return height ÷
// width. On-body / model shots are almost always portrait (ratio > 1); flat
// packshots are square or landscape. Returns null when no dimensions are found.
function imageAspect(url: string): number | null {
  let w = 0
  let h = 0
  const path = url.match(/_(\d{2,5})x(\d{2,5})(?:_|\.|@|\?|$)/i)
  if (path) { w = +path[1]; h = +path[2] }
  if (!w || !h) {
    const wm = url.match(/[?&](?:width|w)=(\d+)/i)
    const hm = url.match(/[?&](?:height|h)=(\d+)/i)
    if (wm && hm) { w = +wm[1]; h = +hm[2] }
  }
  if (!w || !h) return null
  return h / w
}

// Score a single image for "shows a person wearing it". Aspect ratio is the
// strongest signal (portrait = on-body shot, square/landscape = flat packshot);
// alt/filename keywords refine it. Higher = more likely a model shot.
function imageScore(url: string, alt = ''): number {
  const hay = `${alt} ${url}`
  let s = 0
  const ratio = imageAspect(url)
  if (ratio != null) {
    if (ratio >= 1.15) s += 4        // clearly portrait — model shot
    else if (ratio <= 0.95) s -= 3   // square or landscape — flat/packshot
  }
  if (MODEL_HINTS.test(hay)) s += 2
  if (FLAT_HINTS.test(hay))  s -= 3
  return s
}

// Reorder a flat list of image URLs model-first, keeping all of them (stable
// within equal scores). Used for the detail gallery where every image stays
// swipeable but on-body shots should lead.
function rankImageUrls(urls: string[]): string[] {
  return urls
    .map((url, idx) => ({ url, idx, s: imageScore(url) }))
    .sort((a, b) => b.s - a.s || a.idx - b.idx)
    .map(x => x.url)
}

// ── Social proof ("327 bought") ──────────────────────────────────────────────
// A believable, stable per-product count that grows slowly over time so it reads
// as organic demand, never a hardcoded gimmick. The base is derived from the
// product id (stable across reloads), and it ticks up by a small per-product
// amount every few days — so a piece at 430 today might read 433 next week, not
// flicker every second. Pure function of (id, today) — no storage, no randomness.
function socialProofCount(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  const base = 110 + (h % 780)                       // 110–889 to start
  const STEP_DAYS = 3                                // grows once every ~3 days
  const epochDay = Math.floor(Date.UTC(2026, 0, 1) / 86400000)
  const today = Math.floor(Date.now() / 86400000)
  const steps = Math.max(0, Math.floor((today - epochDay) / STEP_DAYS))
  const perStep = 1 + (h % 8)                        // +1 to +8 each step, per product
  return base + steps * perStep
}

// Compact view-style formatting: 430, 1.2K, 3.4M.
function formatCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K'
  return String(n)
}

// Collect every product image (full gallery), drop video/3d media, and order
// model/lifestyle shots first. Returns a de-duplicated list of image URLs.
function getProductImages(p: Product): string[] {
  type Img = { url: string; alt: string; idx: number }
  const seen = new Set<string>()
  const imgs: Img[] = []
  const push = (url?: string, alt?: string, type?: string) => {
    if (!url || seen.has(url)) return
    if (type && !/image|photo/i.test(type)) return   // skip video / model_3d / external_video
    seen.add(url)
    imgs.push({ url, alt: alt || '', idx: imgs.length })
  }
  // Full product gallery first, then variant-specific media, then the thumbnail fallback.
  p.media?.forEach(m => push(m.url, (m as { alt?: string }).alt, m.type))
  p.variants?.forEach(v => v.media?.forEach(m => push(m.url, (m as { alt?: string }).alt)))
  if (p.image_url) push(p.image_url)

  const score = (im: Img) => {
    return imageScore(im.url, im.alt)
  }
  const ranked = imgs.map(im => ({ im, s: score(im) }))
  // Prefer model shots: drop the ones we can confidently tell are product-only,
  // but never empty the gallery — fall back to all images if filtering leaves none.
  const modelFirst = ranked.filter(r => r.s >= 0)
  const base = modelFirst.length > 0 ? modelFirst : ranked
  base.sort((a, b) => b.s - a.s || a.im.idx - b.im.idx)
  return base.map(r => r.im.url)
}
// Images tied to a specific colour variant, model-first. Returns [] when the
// product carries no media for that colour, so callers fall back to the full
// gallery. Powers colour-swatch → image swapping on cards and in the drawer.
function getColorVariantImages(p: Product, color: string | null): string[] {
  if (!color) return []
  const want = color.toLowerCase()
  const urls: string[] = []
  for (const v of p.variants ?? []) {
    if (!v.options?.some(o => o.label?.toLowerCase() === want)) continue
    for (const m of v.media ?? []) if (m?.url) urls.push(m.url)
  }
  return rankImageUrls(Array.from(new Set(urls)))
}

// The single image to show on a grid card: the top-ranked (model-first) image
// from the gallery, falling back to the raw catalog thumbnail.
function heroImage(p: Product): string {
  return getProductImages(p)[0] || p.image_url || ''
}

// ── Grid card image carousel ──────────────────────────────────────────────────
// Horizontal-swipe image browser for product grid cells. Pointer events handle
// swipe detection so they don't conflict with the parent cell's touch-based
// long-press handlers (which use touch events on a different event track).
function CardCarousel({ images, onOpen }: { images: string[]; onOpen: () => void }) {
  const [idx, setIdx] = useState(0)
  const startX = useRef(0)
  const startY = useRef(0)
  const active = useRef(false)
  const swiped = useRef(false)

  // Show every image, ordered on-body-first so the card leads with a model shot
  // and flat packshots trail (renders instantly in heuristic order first).
  const imgs = useModelFirstOrder(images)

  if (imgs.length === 0) {
    return (
      <div style={{ width:'100%',height:'100%',background:'#e4e4e4',display:'flex',alignItems:'center',justifyContent:'center' }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={INK3} strokeWidth="1.4" opacity=".4">
          <path d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
    )
  }

  // Curation can shrink the list after a swipe, so clamp the active index.
  const cur = Math.min(idx, imgs.length - 1)

  return (
    <>
      <div style={{ position:'absolute',inset:0,zIndex:1,overflow:'hidden',background:'#EEEEEE' }}>
        <div style={{ position:'absolute',top:0,bottom:0,width:'60%',
          background:'linear-gradient(90deg,#EEEEEE 0%,#F4F4F4 35%,#F6F6F6 50%,#F4F4F4 65%,#EEEEEE 100%)',
          animation:'sk-sweep 2s ease-in-out infinite',willChange:'transform' }} />
      </div>
      <img key={imgs[cur]} src={imgs[cur]} alt="" draggable={false} decoding="async"
        style={{ position:'relative',zIndex:2,opacity:0 }}
        onLoad={e => { (e.target as HTMLImageElement).style.opacity = '1' }}
      />
      {/* Interaction layer: swipe detection + tap-to-open, sits above the image */}
      <div
        style={{ position:'absolute',inset:0,zIndex:3,WebkitTouchCallout:'none',touchAction:'pan-y' } as React.CSSProperties}
        onPointerDown={e => {
          active.current = true; swiped.current = false
          startX.current = e.clientX; startY.current = e.clientY
          e.currentTarget.setPointerCapture(e.pointerId)
          e.stopPropagation()
        }}
        onPointerMove={e => {
          if (!active.current || imgs.length <= 1) return
          const dx = Math.abs(e.clientX - startX.current)
          const dy = Math.abs(e.clientY - startY.current)
          if (dx > dy && dx > 8) swiped.current = true
        }}
        onPointerUp={e => {
          if (!active.current) return
          active.current = false
          const dx = e.clientX - startX.current
          const dy = e.clientY - startY.current
          if (imgs.length > 1 && Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 30) {
            swiped.current = true
            setIdx(i => dx < 0 ? Math.min(i + 1, imgs.length - 1) : Math.max(i - 1, 0))
          }
        }}
        onPointerCancel={() => { active.current = false }}
        onClick={e => {
          e.stopPropagation()
          if (!swiped.current) onOpen()
          swiped.current = false
        }}
      />
      {imgs.length > 1 && (
        <div style={{ position:'absolute',bottom:8,left:'50%',transform:'translateX(-50%)',display:'flex',gap:4,zIndex:4,pointerEvents:'none' }}>
          {imgs.map((_, i) => (
            <div key={i} style={{ width:5,height:5,borderRadius:'50%',
              background: i === cur ? 'rgba(255,255,255,.92)' : 'rgba(255,255,255,.35)',
              transition:'background .15s' }} />
          ))}
        </div>
      )}
    </>
  )
}

// ── Explore tile — progressively upgrades to the on-body / model gallery ──────
// Feed products only carry the store's primary image (usually a flat packshot).
// The real model shots live in the product's full gallery (product.json), which
// we fetch lazily here (cached) and rank model-first, so the tile shows the
// model wearing the piece instead of a lame packshot — without blocking the feed.
const _galleryCache = new Map<string, string[]>()
const _galleryPending = new Map<string, Promise<string[]>>()
function fetchGallery(storeUrl: string): Promise<string[]> {
  const cached = _galleryCache.get(storeUrl)
  if (cached) return Promise.resolve(cached)
  const inflight = _galleryPending.get(storeUrl)
  if (inflight) return inflight
  const job = fetch(`/api/product-images?url=${encodeURIComponent(storeUrl)}`)
    .then(r => (r.ok ? r.json() : null))
    .then(d => (Array.isArray(d?.images) ? (d.images as string[]) : []))
    .catch(() => [] as string[])
    .then(imgs => { _galleryCache.set(storeUrl, imgs); _galleryPending.delete(storeUrl); return imgs })
  _galleryPending.set(storeUrl, job)
  return job
}

function ExploreTile({ p, animDelay, pressHandlers, onOpen }: {
  p: Product
  animDelay: string
  pressHandlers: Record<string, unknown>
  onOpen: () => void
}) {
  const base = useMemo(() => getProductImages(p), [p.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const [imgs, setImgs] = useState<string[]>(base)
  useEffect(() => {
    setImgs(base)
    if (!p.store_url) return
    let cancelled = false
    fetchGallery(p.store_url).then(g => {
      if (cancelled || g.length === 0) return
      // Full gallery first (has the model shots), then any catalog images not in
      // it; rankImageUrls puts model/on-body shots ahead of flat packshots.
      const merged = rankImageUrls([...g, ...base.filter(u => !g.includes(u))])
      if (merged.length > 0) setImgs(merged)
    })
    return () => { cancelled = true }
  }, [p.id, p.store_url]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="fr-mtile" role="button" tabIndex={0} style={{ animationDelay: animDelay }}
      {...pressHandlers}
      onKeyDown={e => e.key === 'Enter' && onOpen()}>
      <CardCarousel images={imgs} onOpen={onOpen} />
      <div className="fr-mtile-views">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
        </svg>
        {formatCount(socialProofCount(p.id))}
      </div>
    </div>
  )
}

// ── Colour-name → CSS swatch ─────────────────────────────────────────────────
// Maps fashion colour vocabulary to a displayable swatch. Falls back to CSS
// named colours, then a neutral, so an unknown name never renders blank.
const COLOR_CSS: Record<string, string> = {
  black:'#1c1a18', jet:'#1c1a18', onyx:'#1c1a18', charcoal:'#39383a', graphite:'#3c3b3d',
  white:'#f4f1ea', ivory:'#f1ecde', cream:'#ece4d2', ecru:'#ddd2bd', chalk:'#efe9dc',
  beige:'#d9cab0', sand:'#d8c4a0', stone:'#cabfa9', oatmeal:'#ddd2bd', oat:'#ddd2bd',
  natural:'#e2d8c4', nude:'#e0cdb6', bone:'#e8e0cf', linen:'#e7ddc8',
  tan:'#c9a87c', camel:'#b78b56', khaki:'#9c8b5e', taupe:'#9c8d79', mushroom:'#b3a692',
  brown:'#6b4a2f', chocolate:'#4b3220', coffee:'#5a4233', cognac:'#8a4f2a', mocha:'#5e463a', caramel:'#a9743e',
  navy:'#23314d', blue:'#3a5a8c', 'light blue':'#9fb6d4', 'sky blue':'#a8c5e0', sky:'#a8c5e0',
  denim:'#41618a', indigo:'#2f3c66', cobalt:'#1f3c88', royal:'#23409a', teal:'#1f6f6f', turquoise:'#3fb3ab', aqua:'#79c7c2',
  grey:'#9a9892', gray:'#9a9892', silver:'#c4c2bb', slate:'#5b6670', ash:'#a8a6a0',
  green:'#3f6b46', olive:'#6b6a3a', sage:'#9aa784', forest:'#2c4631', 'dark green':'#2c4631',
  khakigreen:'#6b6a3a', mint:'#bcdcc6', emerald:'#1f7a52', moss:'#5a6238', pistachio:'#b9c79a',
  red:'#a83232', burgundy:'#5e2030', maroon:'#5a1f2a', wine:'#5e2030', oxblood:'#4a1f24', cherry:'#9c2738',
  rust:'#9c4b2a', terracotta:'#b56b4a', brick:'#9a4a36', orange:'#cf7330', coral:'#e08a6e', peach:'#edb89a', apricot:'#e7a772', salmon:'#e69684',
  pink:'#e0a7b4', blush:'#e9c9cf', rose:'#d99aa6', dusty:'#cba3a8', fuchsia:'#b13b73', magenta:'#a83271', hotpink:'#d44a87',
  purple:'#6b4a86', lilac:'#c5b6da', lavender:'#cabfe0', violet:'#6f5499', plum:'#5e3a5b', mauve:'#9c7d92', aubergine:'#43283f',
  yellow:'#e3c14a', mustard:'#c79a3a', gold:'#c0a04e', butter:'#ecdfa6', lemon:'#ecdf7e',
  neutral:'#c2b8a6',
  multicolor:'linear-gradient(135deg,#d98a6e,#9ab6d4,#c79a3a)', multi:'linear-gradient(135deg,#d98a6e,#9ab6d4,#c79a3a)',
  print:'linear-gradient(135deg,#cdbfae,#b9a98f)', floral:'linear-gradient(135deg,#d9b3c0,#a8c5a0)', patterned:'linear-gradient(135deg,#cdbfae,#b9a98f)', stripe:'repeating-linear-gradient(45deg,#23314d 0 4px,#f4f1ea 4px 8px)', striped:'repeating-linear-gradient(45deg,#23314d 0 4px,#f4f1ea 4px 8px)', check:'repeating-linear-gradient(45deg,#6b4a2f 0 4px,#e7ddc8 4px 8px)', plaid:'repeating-linear-gradient(45deg,#5e2030 0 4px,#23314d 4px 8px)',
}
function colorToCss(name: string): string {
  const n = name.toLowerCase().trim()
  if (COLOR_CSS[n]) return COLOR_CSS[n]
  // Longest key contained in the name (handles "Light Blue Marl", "Dark Olive").
  const keys = Object.keys(COLOR_CSS).sort((a, b) => b.length - a.length)
  for (const k of keys) if (n.includes(k)) return COLOR_CSS[k]
  // CSS understands many single-word colours (olive, teal, maroon…) — try it.
  if (/^[a-z]+$/.test(n)) return n
  return '#bdb6ab'
}

// Pull a colour word out of a product title ("…Shirt in Warm Grey", "Tee - Ivory")
// so single-colourway products still show a swatch. null when none is found.
function inferTitleColor(title: string): string | null {
  const t = ` ${title.toLowerCase()} `
  const keys = Object.keys(COLOR_CSS).filter(k => k.length >= 3).sort((a, b) => b.length - a.length)
  for (const k of keys) {
    const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (new RegExp(`[\\s\\-/(]${esc}[\\s\\-/)]`).test(t)) return k
  }
  return null
}

// A display colour name for single-colourway products (those with no Color
// option). Titles usually carry it as a trailing segment — "…Shirt – Ice Blue".
// We take that segment when it reads like a colour, else fall back to any colour
// word found anywhere in the title. Title-cased for display.
function inferSheetColorName(title: string): string | null {
  const tc = (s: string) => s.replace(/\b\w/g, m => m.toUpperCase())
  const segs = title.split(/[–—|]| - /).map(s => s.trim()).filter(Boolean)
  if (segs.length > 1) {
    const last = segs[segs.length - 1]
    if (last.length <= 22 && inferTitleColor(last)) return tc(last)
  }
  const w = inferTitleColor(title)
  return w ? tc(w) : null
}

// The swatches to display for a product. Multi-colour products return their
// option values (interactive — they swap images). Single-colour products
// return one inferred swatch so every card shows a colourway.
function displaySwatches(p: Product): { colors: string[]; interactive: boolean } {
  const opt = getProductColors(p)
  if (opt.length > 0) return { colors: opt, interactive: true }
  const inferred = inferTitleColor(p.title)
  return { colors: inferred ? [inferred] : ['neutral'], interactive: false }
}

// ── Dominant-colour sampling ──────────────────────────────────────────────────
// Title text lies about colour ("Linen Shirt" is a fabric, not a hue), so the
// only reliable swatch is the garment itself. We load a tiny copy of the
// product image (Shopify CDN sends CORS headers) and average the centre region
// — where the garment sits on a flat-lay or a model's torso — to get the exact
// colour. Cached per URL; falls back to the name-based swatch when sampling
// can't run (non-CORS store, decode error).
const _swatchColorCache = new Map<string, string>()
const _swatchPending = new Map<string, Promise<string | null>>()

function _thumbForSampling(url: string): string {
  try {
    const u = new URL(url.startsWith('//') ? `https:${url}` : url)
    if (u.hostname.includes('shopify') || u.hostname.includes('cdn.shopify.com')) {
      u.searchParams.set('width', '80')
      u.searchParams.delete('height')
      return u.toString()
    }
  } catch { /* fall through */ }
  return url
}

function sampleImageColor(url: string): Promise<string | null> {
  if (_swatchColorCache.has(url)) return Promise.resolve(_swatchColorCache.get(url)!)
  const inflight = _swatchPending.get(url)
  if (inflight) return inflight
  const job = new Promise<string | null>(resolve => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.decoding = 'async'
    img.onload = () => {
      try {
        const S = 32
        const cv = document.createElement('canvas')
        cv.width = S; cv.height = S
        const ctx = cv.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings)
        if (!ctx) return resolve(null)
        ctx.drawImage(img, 0, 0, S, S)
        // Centre 40–70% box → the garment, away from background edges.
        const a = Math.floor(S * 0.32), b = Math.ceil(S * 0.68)
        const px = ctx.getImageData(a, a, b - a, b - a).data
        let r = 0, g = 0, bl = 0, n = 0
        for (let i = 0; i < px.length; i += 4) {
          if (px[i + 3] < 128) continue
          r += px[i]; g += px[i + 1]; bl += px[i + 2]; n++
        }
        if (!n) return resolve(null)
        const css = `rgb(${Math.round(r / n)}, ${Math.round(g / n)}, ${Math.round(bl / n)})`
        _swatchColorCache.set(url, css)
        resolve(css)
      } catch { resolve(null) }
    }
    img.onerror = () => resolve(null)
    img.src = _thumbForSampling(url)
  })
  _swatchPending.set(url, job)
  return job
}

function useSwatchColor(url?: string | null): string | null {
  const [color, setColor] = useState<string | null>(() => (url ? _swatchColorCache.get(url) ?? null : null))
  useEffect(() => {
    if (!url) { setColor(null); return }
    const cached = _swatchColorCache.get(url)
    if (cached) { setColor(cached); return }
    let cancelled = false
    sampleImageColor(url).then(c => { if (!cancelled && c) setColor(c) })
    return () => { cancelled = true }
  }, [url])
  return color
}

// ── On-body ordering (model shot first, flat packshot last) ───────────────────
// Pixel/filename heuristics can't tell a skin-coloured GARMENT (terracotta,
// beige, tan) laid flat from a person wearing it, and some store CDNs block the
// browser from reading pixels at all. So the reliable signal — the shape of a
// person — is computed server-side by the vision model (/api/image-order) and
// cached per product. Here we just fetch that ordering and cache it client-side,
// rendering instantly in the incoming heuristic order and upgrading when it
// resolves. The vision call runs at most once per product, ever.
const _imageOrderCache = new Map<string, string[]>()
const _imageOrderPending = new Map<string, Promise<string[]>>()

function fetchImageOrder(urls: string[]): Promise<string[]> {
  const key = urls.join('|')
  const cached = _imageOrderCache.get(key)
  if (cached) return Promise.resolve(cached)
  const inflight = _imageOrderPending.get(key)
  if (inflight) return inflight
  const job = fetch('/api/image-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ urls }),
  })
    .then(r => (r.ok ? r.json() : null))
    .then((d: { order?: string[] } | null) =>
      Array.isArray(d?.order) && d!.order.length > 0 ? d!.order : urls)
    .catch(() => urls)
    .then(order => {
      _imageOrderCache.set(key, order)
      _imageOrderPending.delete(key)
      return order
    })
  _imageOrderPending.set(key, job)
  return job
}

// Reorder a gallery on-body-first. Renders immediately in the order it's given
// (already heuristic-ranked upstream), then swaps to the vision-accurate order.
function useModelFirstOrder(urls: string[]): string[] {
  const key = urls.join('|')
  const [order, setOrder] = useState<string[]>(urls)
  useEffect(() => {
    setOrder(urls)
    if (urls.length < 2) return
    let cancelled = false
    fetchImageOrder(urls).then(next => {
      if (!cancelled && next.join('|') !== key) setOrder(next)
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return order
}

// A single colour swatch. Shows the EXACT garment colour sampled from its image
// when available, falling back to the name-based hue. Used on cards (small
// square) and in the detail sheet (larger round).
function ColorSwatch({ name, imageUrl, size, shape, selected, available, onClick }: {
  name: string; imageUrl?: string | null; size: number; shape: 'square' | 'round'
  selected: boolean; available: boolean; onClick?: () => void
}) {
  const sampled = useSwatchColor(imageUrl)
  const bg = sampled ?? colorToCss(name)
  const radius = shape === 'round' ? '50%' : `${Math.max(2, Math.round(size * 0.16))}px`
  const ring = Math.max(1.5, size * 0.09)
  return (
    <button type="button" title={name} aria-label={name}
      onClick={onClick ? e => { e.stopPropagation(); if (available) onClick() } : undefined}
      style={{
        width: size, height: size, borderRadius: radius, padding: 0, background: bg,
        border: selected ? `1px solid ${INK}` : '1px solid rgba(0,0,0,0.22)',
        boxShadow: selected ? `0 0 0 ${ring}px ${BG}, 0 0 0 ${ring + 1}px ${INK}` : 'none',
        opacity: available ? 1 : 0.34, position: 'relative', display: 'inline-block',
        cursor: onClick && available ? 'pointer' : 'default', transition: 'box-shadow .15s',
      }}>
      {!available && size >= 20 && (
        <span style={{ position: 'absolute', inset: 0, display: 'flex', pointerEvents: 'none' }}>
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            <line x1={size * 0.2} y1={size * 0.8} x2={size * 0.8} y2={size * 0.2} stroke={INK} strokeWidth="1.1" />
          </svg>
        </span>
      )}
    </button>
  )
}

// ── Product meta — the editorial caption under each grid image ────────────────
// Title (uppercase) + a quick "bag it" plus, price, and colour swatches. When
// the product has real colour variants, the swatches are tappable and drive
// the card's image (via activeColor / onSelectColor).
function ProductMeta({ p, rates, saved, onSave, onOpen, activeColor, onSelectColor }: {
  p: Product; rates: ExchangeRates; saved: boolean; onSave: () => void; onOpen: () => void
  activeColor?: string | null; onSelectColor?: (c: string) => void
}) {
  const avail = getColorAvailability(p)
  const { colors, interactive } = displaySwatches(p)
  const heroImg = getProductImages(p)[0] || p.image_url
  return (
    <div onClick={onOpen} style={{ padding: '9px 4px 0', display: 'flex', flexDirection: 'column', gap: 5, cursor: 'pointer' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <h3 style={{
          fontFamily: SANS, fontSize: 11, fontWeight: 500, letterSpacing: '.045em', textTransform: 'uppercase',
          color: INK, lineHeight: 1.35, margin: 0,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>{p.title}</h3>
        <button type="button" aria-label={saved ? 'In your bag' : 'Add to bag'}
          onClick={e => { e.stopPropagation(); onSave() }}
          style={{ flexShrink: 0, width: 20, height: 20, marginTop: 1, padding: 0, border: 'none', background: 'none',
            cursor: 'pointer', color: INK, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            {/* Handle drawn in white when filled — otherwise it's the same
                color as the solid fill and disappears into a blank blob. */}
            <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" fill={saved ? 'currentColor' : 'none'} />
            <line x1="3" y1="6" x2="21" y2="6" stroke={saved ? '#fff' : 'currentColor'} />
            <path d="M16 10a4 4 0 0 1-8 0" stroke={saved ? '#fff' : 'currentColor'} />
          </svg>
        </button>
      </div>
      <div style={{ fontFamily: SANS, fontSize: 12.5, color: INK, fontWeight: 500, letterSpacing: '.01em' }}>
        {formatMoney(p.price, p.currency, p.base_currency, rates)}
      </div>
      {colors.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 1 }}>
          {colors.slice(0, 6).map(c => {
            const isAvail = avail[c] !== false
            const on = interactive && (activeColor ?? colors[0]) === c
            // Sample the colour from its own variant image; for a single-colour
            // product the hero IS that colour, so sample that. Multi-colour
            // variants without their own media fall back to the name swatch.
            const variantImg = interactive ? getColorVariantImages(p, c)[0] : undefined
            const sampleImg = variantImg ?? ((!interactive || colors.length === 1) ? heroImg : undefined)
            return (
              <ColorSwatch key={c} name={c} imageUrl={sampleImg} size={13} shape="square"
                selected={on} available={isAvail}
                onClick={interactive && isAvail ? () => onSelectColor?.(c) : undefined} />
            )
          })}
          {colors.length > 6 && (
            <span style={{ fontFamily: SANS, fontSize: 10, color: INK3, lineHeight: '13px' }}>+{colors.length - 6}</span>
          )}
        </div>
      )}
    </div>
  )
}

function getDescriptionText(p: Product): string {
  if (!p.description) return ''
  return p.description
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n').replace(/<\/li>/gi, '\n')
    .replace(/<[^>]*>/g, '').trim()
}

function sanitizeHtml(html: string): string {
  if (typeof window === 'undefined') return ''
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } })
}

const SIZE_TABLE_KWS = /\b(size|chest|waist|hip|inseam|sleeve|shoulder|length|neck|bust|height|weight|measurements?|XS|XL|XXL)\b/i

// ── Unit conversion ───────────────────────────────────────────────────────────
const FRAC_TO_DEC: Record<string, number> = {
  '½': 0.5, '¼': 0.25, '¾': 0.75,
  '⅓': 0.333, '⅔': 0.667,
  '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
}

function parseMeasNum(s: string): number {
  const lastChar = s.slice(-1)
  const frac = FRAC_TO_DEC[lastChar] ?? 0
  const base = parseFloat(frac > 0 ? s.slice(0, -1) : s)
  return isNaN(base) ? NaN : base + frac
}

function fmtConverted(n: number, toUnit: 'in' | 'cm'): string {
  if (toUnit === 'cm') return Math.round(n).toString()
  const rounded = Math.round(n * 2) / 2
  const whole = Math.floor(rounded)
  return rounded === whole ? String(whole) : `${whole}½`
}

function convertMeasurement(v: string, fromUnit: 'in' | 'cm' | '', toUnit: 'in' | 'cm'): string {
  if (!fromUnit || fromUnit === toUnit || !v || v === '—') return v
  const factor = fromUnit === 'in' ? 2.54 : 1 / 2.54
  if (v.includes('×')) {
    return v.replace(/\d+(?:[.,]\d+)?(?:[½¼¾⅓⅔⅛⅜⅝⅞])?/g, m => {
      const n = parseMeasNum(m); return isNaN(n) ? m : fmtConverted(n * factor, toUnit)
    })
  }
  const rng = v.match(/^(\d[\d½¼¾⅓⅔⅛⅜⅝⅞]*)\s*[-–]\s*(\d[\d½¼¾⅓⅔⅛⅜⅝⅞]*)$/)
  if (rng) {
    const a = parseMeasNum(rng[1]), b = parseMeasNum(rng[2])
    if (!isNaN(a) && !isNaN(b)) return `${fmtConverted(a * factor, toUnit)}–${fmtConverted(b * factor, toUnit)}`
  }
  const n = parseMeasNum(v)
  return isNaN(n) ? v : fmtConverted(n * factor, toUnit)
}

// ── International size reference data ────────────────────────────────────────
const INTL_W_HDR = ['XS', 'S', 'M', 'L', 'XL', 'XXL']
const INTL_W: { sys: string; vals: string[] }[] = [
  { sys: 'US',    vals: ['0–2',  '4–6',  '8–10', '12–14', '16',  '18–20'] },
  { sys: 'UK',    vals: ['4–6',  '8–10', '12–14','16–18', '20',  '22–24'] },
  { sys: 'EU',    vals: ['32–34','36–38','40–42', '44–46', '48',  '50–52'] },
  { sys: 'IT',    vals: ['36–38','40–42','44–46', '48–50', '52',  '54–56'] },
  { sys: 'AU/NZ', vals: ['6–8',  '10–12','14–16', '18–20', '22',  '24–26'] },
  { sys: 'JP',    vals: ['5–7',  '9–11', '13–15', '17–19', '21',  '23–25'] },
]
const INTL_M_HDR = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL']
const INTL_M: { sys: string; vals: string[] }[] = [
  { sys: 'EU/IT', vals: ['44',  '46',  '48–50', '52', '54–56', '58', '60'] },
  { sys: 'UK',    vals: ['34',  '36',  '38–40', '42', '44–46', '48', '50'] },
  { sys: 'JP',    vals: ['S',   'M',   'L',     'LL', '3L',    '4L', '5L'] },
]

function extractSizeTables(html: string): string | null {
  const found: string[] = []
  // HTML tables with size keywords
  const tableRe = /<table[\s\S]*?<\/table>/gi
  let m: RegExpExecArray | null
  while ((m = tableRe.exec(html)) !== null) {
    if (SIZE_TABLE_KWS.test(m[0])) found.push(m[0])
  }
  if (found.length) return found.join('')

  // Images whose src/alt suggests a size chart (common: brand embeds a chart image in description)
  const imgRe = /<img[^>]+>/gi
  while ((m = imgRe.exec(html)) !== null) {
    const tag = m[0]
    if (/size.?chart|size.?guide|sizing|measurement/i.test(tag) && /src=/i.test(tag)) {
      const srcMatch = tag.match(/src=["']([^"']+)["']/i)
      if (srcMatch && !srcMatch[1].startsWith('data:')) {
        found.push(tag.replace(/<img/, '<img style="max-width:100%;height:auto;display:block"'))
      }
    }
  }
  return found.length ? `<div>${found.join('')}</div>` : null
}

function stripSizeTables(html: string): string {
  return html
    .replace(/<table[\s\S]*?<\/table>/gi, t => SIZE_TABLE_KWS.test(t) ? '' : t)
    // Also strip size chart images already shown in the size guide section
    .replace(/<img[^>]+>/gi, tag => /size.?chart|size.?guide|sizing|measurement/i.test(tag) ? '' : tag)
    .replace(/\n{3,}/g, '\n\n').trim()
}

const MATERIAL_KW = /material|fabric|composition|fiber|blend|cotton|linen|wool|silk|leather|polyester|nylon|viscose|cashmere|denim|hemp|spandex|lyocell|tencel|modal|bamboo|rayon|acrylic|elastane/i
const CARE_KW = /\b(care|wash|dry|iron|clean|bleach|tumble|hand.?wash|machine|delicate)\b/i

function extractMaterial(p: Product): string {
  const matTag = p.tags?.find(t => MATERIAL_KW.test(t))
  if (matTag) {
    const v = matTag.split('=>').pop()?.trim()
    if (v) return v
  }
  const descText = p.description_html
    ? p.description_html.replace(/<[^>]*>/g, ' ')
    : getDescriptionText(p)
  const m = descText.match(/\d+%?\s*(?:cotton|linen|wool|silk|hemp|polyester|nylon|viscose|cashmere|denim|spandex|lyocell|tencel|modal|bamboo|rayon|acrylic|elastane)/i)
  if (m) return m[0]
  const single = descText.match(/\b(?:cotton|linen|wool|silk|hemp|polyester|leather|canvas|cashmere|denim|viscose|nylon|spandex)\b/i)
  return single?.[0] || ''
}

// ── Internal Shopify tag patterns — never shown to shoppers ──────────────────
const INTERNAL_TAG_RE = /^(akeneo|categorybatch|online.?pos|offline.?pos|price_|tt_|fb_|ig_|ggl_|_label_|all.?product|new.?arrival|build.?your|bundl|wishlist|oos_|featured_|pf_)/i
const INTERNAL_TAG_EXACT = new Set([
  'online-pos', 'offline-pos', 'all-products', 'new-arrivals', 'sale', 'clearance',
  'build-your-wishlist', 'featured', 'trending', 'bundle', 'bundleable',
  'all', 'new',
])
const HEX_IN_TAG   = /#[0-9a-fA-F]{3,8}/
const TIMESTAMP_IN_TAG = /\b\d{9,10}\b/

function isInternalTag(t: string): boolean {
  if (HEX_IN_TAG.test(t)) return true
  if (TIMESTAMP_IN_TAG.test(t)) return true
  if (INTERNAL_TAG_RE.test(t)) return true
  if (INTERNAL_TAG_EXACT.has(t.toLowerCase())) return true
  // colon-value tags where value is purely numeric (akeneo_updated_at:1746219500)
  if (/:\d+$/.test(t)) return true
  // long hyphenated/underscored machine codes (4+ segments, 20+ chars)
  if (/^[a-z0-9_-]+$/.test(t) && t.split(/[-_]/).length > 3 && t.length > 20) return true
  return false
}

function humanizeTagValue(t: string): string {
  // "key:value" format — extract the value
  if (t.includes(':') && !t.startsWith('http')) {
    const value = t.split(':').slice(1).join(':').trim()
    if (!value || /^\d+$/.test(value)) return ''  // skip bare numbers
    return value.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  }
  // kebab-case / snake_case → Title Case
  return t.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim()
}

function extractCareTags(p: Product): string[] {
  return (p.tags || [])
    .filter(t => CARE_KW.test(t))
    .map(t => {
      const raw = t.split('=>').pop()?.trim() || t
      return humanizeTagValue(raw)
    })
    .filter(Boolean)
}

function extractDetailTags(p: Product): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const t of (p.tags || [])) {
    if (!t || t.length < 2 || t.length > 100) continue
    if (MATERIAL_KW.test(t) || CARE_KW.test(t)) continue
    if (t.includes('=>')) continue
    if (isInternalTag(t)) continue
    const display = humanizeTagValue(t)
    if (!display || display.length < 2) continue
    const key = display.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(display)
  }
  return result
}
// Normalize verbose size names → standard abbreviations for display only.
// Internal state / variant matching always uses the raw Shopify value.
const SIZE_ABBREV: Record<string, string> = {
  'extra small':                           'XS',
  'x-small':                               'XS',
  'x small':                               'XS',
  'small':                                 'S',
  'medium':                                'M',
  'large':                                 'L',
  'extra large':                           'XL',
  'x-large':                               'XL',
  'x large':                               'XL',
  'extra extra large':                     'XXL',
  'double extra large':                    'XXL',
  'xx-large':                              'XXL',
  'xx large':                              'XXL',
  '2x-large':                              'XXL',
  'extra extra extra large':               'XXXL',
  'triple extra large':                    'XXXL',
  'xxx-large':                             'XXXL',
  'xxx large':                             'XXXL',
  '3x-large':                              'XXXL',
  'extra extra extra extra large':         '4XL',
  'xxxx-large':                            '4XL',
  '4x-large':                              '4XL',
  'extra extra extra extra extra large':   '5XL',
  'xxxxx-large':                           '5XL',
  '5x-large':                              '5XL',
  '6x-large':                              '6XL',
  'extra extra extra extra extra extra large': '6XL',
}
function normalizeSizeLabel(raw: string): string {
  return SIZE_ABBREV[raw.toLowerCase().trim()] ?? raw
}

function getProductSizes(p: Product): string[] {
  return p.options?.find(o => o.name.toLowerCase().includes('size'))?.values || []
}
function getProductColors(p: Product): string[] {
  return p.options?.find(o => /colou?r/i.test(o.name))?.values || []
}
// Map each size value → whether it's available. A size is in stock if ANY
// variant carrying it is available — a single sold-out colourway must never
// grey out a size that's stocked elsewhere. When `color` is given, scope the
// check to that colourway so the size grid reflects the selected colour.
function getSizeAvailability(p: Product, color?: string | null): Record<string, boolean> {
  const map: Record<string, boolean> = {}
  const sizeOpt = p.options?.find(o => o.name.toLowerCase().includes('size'))
  if (!sizeOpt) return map
  const want = color?.toLowerCase() ?? null
  for (const val of sizeOpt.values) {
    const variants = (p.variants ?? []).filter(v =>
      v.options.some(o => o.label === val) &&
      (!want || v.options.some(o => o.label?.toLowerCase() === want)),
    )
    // No matching variant → assume available (catalog data is often partial).
    map[val] = variants.length === 0 ? true : variants.some(v => v.availability)
  }
  return map
}
// Map each colour value → whether any variant in that colour is available.
// Uses `.some()` so a colour stays selectable as long as one size is in stock.
function getColorAvailability(p: Product): Record<string, boolean> {
  const map: Record<string, boolean> = {}
  const colorOpt = p.options?.find(o => /colou?r/i.test(o.name))
  if (!colorOpt) return map
  for (const val of colorOpt.values) {
    const variants = (p.variants ?? []).filter(v => v.options.some(o => o.label === val))
    map[val] = variants.length === 0 ? true : variants.some(v => v.availability)
  }
  return map
}
// ── Size guide parsing ────────────────────────────────────────────────────────
type SizeRow   = { label: string; values: string[] }
type SizeTable = { label: string; headers: string[]; rows: SizeRow[]; unit: 'in' | 'cm' | '' }

function sgStripTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim()
}

// Recognises standard garment size labels including composite forms:
// "S", "XL", "S (0-4)", "M/L", "S/M (0-6)", "XXL", "1X", "38", etc.
const SG_SIZE_CORE = /^(XXS|XS|S|M|L|XL|XXL|XXXL|XXXXL|4XL|5XL|6XL|1X|2X|3X|4X|\d{1,3}|One ?Size|OS|OSFA)/i
function isSizeLike(s: string): boolean {
  const clean = s.trim()
  // Must START with a known size token; optional suffix like "/M", " (0-4)", " - XL"
  if (!SG_SIZE_CORE.test(clean)) return false
  // Must not be a plain measurement word like "Natural Waist", "Low Hip", etc.
  if (/waist|chest|bust|hip|inseam|sleeve|shoulder|neck|length|height|weight/i.test(clean)) return false
  return true
}

// Flip a table so sizes become column headers and measurements become row labels.
// Input:  headers=["NECK","CHEST","WAIST"], rows=[{label:"XS", values:[…]}, …]
// Output: headers=["XS","S","M",…],         rows=[{label:"NECK", values:[…]}, …]
function transposeTable(t: { headers: string[]; rows: SizeRow[] }): { headers: string[]; rows: SizeRow[] } {
  return {
    headers: t.rows.map(r => r.label),
    rows: t.headers.map((h, hi) => ({
      label: h,
      values: t.rows.map(r => r.values[hi] ?? ''),
    })),
  }
}

// Infer a human-readable section label from measurement names in the table.
function inferTableLabel(measurementLabels: string[]): string {
  const txt = measurementLabels.join(' ').toLowerCase()
  const hasInseam  = /inseam|leg\b|rise\b/.test(txt)
  const hasBust    = /bust|chest/.test(txt)
  const hasSleeve  = /sleeve/.test(txt)
  const hasHip     = /\bhip\b/.test(txt)
  const hasWaist   = /waist/.test(txt)
  if (hasInseam)               return 'Bottoms'
  if (hasSleeve || hasBust)    return 'Tops'
  if (hasHip && hasWaist && !hasBust) return 'Bottoms'
  if (hasHip && !hasBust)      return 'Bottoms'
  return ''
}

// Strip noisy prefixes like "Measurements for", "*All sizes are approximate"
function cleanSectionLabel(raw: string): string {
  return raw
    .replace(/^\*?\s*measurements?\s+(?:for\s+)?/i, '')
    .replace(/^\*?\s*all\s+sizes\s+are\s+approximate\s*/i, '')
    .replace(/\*.*$/, '')  // remove trailing asterisk notes
    .trim()
}

// Extract the last meaningful title/heading from the HTML preceding a <table>.
// Handles any gap (paragraphs, disclaimers) between the heading and the table.
function extractSectionLabel(prev: string): string {
  // 1. Heading tags: h1-h6, caption — most semantic, search whole chunk
  const hMatches = Array.from(prev.matchAll(/<(?:h[1-6]|caption)[^>]*>([\s\S]*?)<\/(?:h[1-6]|caption)>/gi))
  if (hMatches.length > 0) {
    const text = cleanSectionLabel(sgStripTags(hMatches[hMatches.length - 1][1]))
    if (text.length >= 2 && text.length <= 80) return text
  }
  // 2. strong / b tags
  const sMatches = Array.from(prev.matchAll(/<(?:strong|b)[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi))
  for (let j = sMatches.length - 1; j >= 0; j--) {
    const text = cleanSectionLabel(sgStripTags(sMatches[j][1]))
    if (text.length >= 2 && text.length <= 80 && /[A-Za-z]/.test(text)) return text
  }
  // 3. p / div tags that look like short titles (not measurement disclaimers)
  const pMatches = Array.from(prev.matchAll(/<(?:p|div)[^>]*>([\s\S]*?)<\/(?:p|div)>/gi))
  for (let j = pMatches.length - 1; j >= 0; j--) {
    const text = cleanSectionLabel(sgStripTags(pMatches[j][1]))
    if (text.length >= 3 && text.length <= 60 && /^[A-Z]/.test(text) &&
        !/approximate|disclaimer|note\b|inch|cm\b/i.test(text)) return text
  }
  return ''
}

function parseOneTable(tableHtml: string): { headers: string[]; rows: SizeRow[] } | null {
  const rawRows: string[][] = []
  const trRe = /<tr(?:\s[^>]*)?>[\s\S]*?<\/tr>/gi
  let trM: RegExpExecArray | null
  while ((trM = trRe.exec(tableHtml)) !== null) {
    const cells: string[] = []
    const tdRe = /<(?:th|td)(?:\s[^>]*)?>[\s\S]*?<\/(?:th|td)>/gi
    let tdM: RegExpExecArray | null
    while ((tdM = tdRe.exec(trM[0])) !== null) {
      const inner = tdM[0].replace(/^<(?:th|td)[^>]*>/, '').replace(/<\/(?:th|td)>$/, '')
      cells.push(sgStripTags(inner))
    }
    if (cells.length > 1) rawRows.push(cells)
  }
  if (rawRows.length < 2) return null
  const headers = rawRows[0].slice(1).filter(h => h.length > 0)
  if (!headers.length) return null
  const rows = rawRows.slice(1)
    .map(r => ({ label: r[0] ?? '', values: r.slice(1, headers.length + 1) }))
    .filter(r => r.label.trim() && r.values.some(v => v.trim()))
  return rows.length ? { headers, rows } : null
}

function parseSizeGuideHtml(html: string): SizeTable[] {
  const tables: SizeTable[] = []
  const sections = html.split(/<table(?:\s[^>]*)?>/)
  for (let i = 1; i < sections.length; i++) {
    const tableHtml = '<table>' + sections[i].split('</table>')[0] + '</table>'
    if (!SIZE_TABLE_KWS.test(tableHtml)) continue
    const parsed = parseOneTable(tableHtml)
    if (!parsed) continue

    // Find the last meaningful heading anywhere in the preceding HTML chunk
    const label = extractSectionLabel(sections[i - 1])

    // Auto-orient: if majority of row labels are size names (XS, S, M…),
    // the table is stored sizes-as-rows — transpose so sizes become columns.
    const sizeLikeCount = parsed.rows.filter(r => isSizeLike(r.label)).length
    const tbl = sizeLikeCount > parsed.rows.length / 2 ? transposeTable(parsed) : parsed

    // If heading extraction found nothing, infer from measurement names in the table
    const finalLabel = label || inferTableLabel(tbl.rows.map(r => r.label))

    tables.push(normalizeTable({ label: finalLabel, ...tbl, unit: '' }))
  }
  return tables
}

// Split headers into groups of 3 for the range selector buttons
function chunkHeaders(headers: string[], size = 3): string[][] {
  const chunks: string[][] = []
  for (let i = 0; i < headers.length; i += size) chunks.push(headers.slice(i, i + size))
  return chunks
}

// ── Size-table normalization ────────────────────────────────────────────────

// Title-case a measurement row label; preserve size abbreviations (XS, S/M…)
function titleCaseLabel(s: string): string {
  if (!s) return s
  if (isSizeLike(s.trim())) return s.trim().toUpperCase()
  return s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
}

// Detect a unit mentioned anywhere in a string
function detectUnit(s: string): 'in' | 'cm' | '' {
  if (/\bcm\b/i.test(s)) return 'cm'
  if (/\binch(es)?\b|^\s*in\s*$|"/i.test(s)) return 'in'
  return ''
}

// Strip unit annotation from a column header; return clean text + detected unit
function cleanHeader(h: string): { clean: string; unit: 'in' | 'cm' | '' } {
  const unit = detectUnit(h)
  const clean = h
    .replace(/\s*[\(\[]\s*in\s+cm\s*[\)\]]/gi, '')
    .replace(/\s*[\(\[]\s*centimetres?\s*[\)\]]/gi, '')
    .replace(/\s*[\(\[]\s*cm\s*[\)\]]/gi, '')
    .replace(/\s*[\(\[]\s*in\s+inch(es)?\s*[\)\]]/gi, '')
    .replace(/\s*[\(\[]\s*inch(es)?\s*[\)\]]/gi, '')
    .replace(/\s*[\(\[]\s*"\s*[\)\]]/gi, '')
    .replace(/\s*-\s*cm$/i, '').replace(/\s*\(cm\)$/i, '')
    .replace(/\s*-\s*in$/i, '').replace(/\s*\(in\)$/i, '')
    .trim()
  return { clean: clean || h.trim(), unit }
}

// Format cell values: replace "x" dimension separator with "×"
function humanizeValue(v: string): string {
  if (!v || v === '—') return v
  return v.replace(/(\d[\d.,½¼¾⅓⅔⅛⅜⅝⅞]*)\s*[xX]\s*(\d[\d.,½¼¾⅓⅔⅛⅜⅝⅞]*)/g, '$1 × $2')
}

// Normalize a full table: clean headers, title-case labels, format values, infer unit
function normalizeTable(t: SizeTable): SizeTable {
  // 1. Strip unit suffixes from column headers and collect the unit
  let unit: 'in' | 'cm' | '' = ''
  const cleanedHeaders = t.headers.map(h => {
    const { clean, unit: u } = cleanHeader(h)
    if (u && !unit) unit = u
    return clean
  })

  // 2. Try row labels
  if (!unit) unit = detectUnit(t.rows.map(r => r.label).join(' '))

  // 3. Try cell values
  if (!unit) {
    outer: for (const row of t.rows) {
      for (const v of row.values) {
        const u = detectUnit(v)
        if (u) { unit = u; break outer }
      }
    }
  }

  // 4. Infer from value magnitudes for garment tables
  if (!unit) {
    const isGarment = t.rows.some(r =>
      /\b(chest|waist|hip|inseam|sleeve|bust|body|shoulder|neck|length)\b/i.test(r.label)
    )
    if (isGarment) {
      const nums: number[] = []
      for (const row of t.rows)
        for (const v of row.values) {
          const m = v.match(/(\d+(?:\.\d+)?)/)
          if (m) nums.push(parseFloat(m[1]))
        }
      if (nums.length > 0) {
        const avg = nums.reduce((a, b) => a + b, 0) / nums.length
        unit = avg < 70 ? 'in' : 'cm'
      }
    }
  }

  const cleanedRows = t.rows.map(row => ({
    label: titleCaseLabel(row.label),
    values: row.values.map(humanizeValue),
  }))

  return { ...t, headers: cleanedHeaders, rows: cleanedRows, unit }
}

function getCheckoutUrl(p: Product, size: string | null, color: string | null): string {
  let v = p.variants?.[0]
  if (p.variants?.length) {
    const wantSize  = size  && p.options?.some(o => o.name.toLowerCase().includes('size'))
    const wantColor = color && p.options?.some(o => /colou?r/i.test(o.name))
    if (wantSize && wantColor) {
      v = p.variants.find(vt => vt.options.some(o => o.label === size) && vt.options.some(o => o.label === color))
       || p.variants.find(vt => vt.options.some(o => o.label === size))
       || p.variants[0]
    } else if (wantSize) {
      v = p.variants.find(vt => vt.options.some(o => o.label === size)) || p.variants[0]
    } else if (wantColor) {
      v = p.variants.find(vt => vt.options.some(o => o.label === color)) || p.variants[0]
    }
  }
  if (!v) return p.store_url
  try { const u = new URL(p.store_url); return `https://${u.hostname}/cart/${v.id.split('/').pop()}:1` }
  catch { return p.store_url }
}

// ── Stylist text renderer — bold, list-strip, [PRODUCT:N] chips, [PHOTO:N] pics ──
function renderStylistText(
  text: string,
  products: Product[],
  liveRates: ExchangeRates,
  onProductClick: (p: Product) => void,
  photos: string[] = []
): React.ReactNode {
  const cleaned = text
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/^\s*[-•]\s+/gm, '')
    // The model sometimes bolds a product/photo token (**[PRODUCT:0]**); since we
    // split on the token first, those ** would be orphaned into literal "**"
    // around the card. Unwrap any markup hugging a token up front.
    // Case-insensitive and space-tolerant on purpose: a free-tier model writes
    // "[product:0]" or "[PRODUCT: 0]" often enough, and a token that misses these
    // patterns renders as literal bracket text in the chat bubble.
    .replace(/\*{1,3}\s*(\[(?:PRODUCT|PHOTO):\s*\d+\])\s*\*{1,3}/gi, '$1')
    .replace(/\*{1,3}\s*(\[(?:PRODUCT|PHOTO):\s*\d+\])/gi, '$1')
    .replace(/(\[(?:PRODUCT|PHOTO):\s*\d+\])\s*\*{1,3}/gi, '$1')
    .trim()

  // Split on [PRODUCT:N] and [PHOTO:N] tokens
  const segments = cleaned.split(/(\[(?:PRODUCT|PHOTO):\s*\d+\])/gi)

  return (
    <>
      {segments.map((seg, si) => {
        // [PHOTO:N] — show one of the shopper's OWN uploaded photos back (the
        // outfit Fabrics chose), so "which outfit for X?" shows the picked look.
        const phm = seg.match(/^\[PHOTO:\s*(\d+)\]$/i)
        if (phm) {
          const url = photos[parseInt(phm[1], 10)]
          if (!url) return null
          return (
            <div key={si} style={{ marginTop: 10, width: 150, borderRadius: 12, overflow: 'hidden', border: `1px solid ${BRD}`, background: BG2 }}>
              <img src={url} alt="Your pick" style={{ width: '100%', display: 'block', objectFit: 'cover' }} />
            </div>
          )
        }
        const pm = seg.match(/^\[PRODUCT:\s*(\d+)\]$/i)
        if (pm) {
          const idx = parseInt(pm[1], 10)
          const p = products[idx]
          if (!p) return null
          const imgUrl = p.media?.[0]?.url || p.image_url || ''
          return (
            <button key={si} onClick={() => onProductClick(p)} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              background: 'rgba(0,0,0,0.04)', border: '1px solid rgba(0,0,0,0.10)',
              borderRadius: 12, padding: '8px 12px 8px 8px',
              cursor: 'pointer', marginTop: 10, textAlign: 'left', width: '100%',
              transition: 'background .14s',
            }}
              onPointerEnter={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.08)')}
              onPointerLeave={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.04)')}
            >
              <div style={{ width: 44, height: 56, borderRadius: 8, overflow: 'hidden', background: '#EEEEEE', flexShrink: 0 }}>
                {imgUrl && <img src={imgUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: SANS, fontSize: 12, fontWeight: 500, color: INK, lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', whiteSpace: 'normal' } as React.CSSProperties}>{p.title}</div>
                <div style={{ fontFamily: SANS, fontSize: 11, color: INK3, marginTop: 2 }}>{formatMoney(p.price, p.currency, p.base_currency, liveRates)}</div>
                <div style={{ fontFamily: SANS, fontSize: 9, letterSpacing: '.08em', textTransform: 'uppercase', color: INK3, marginTop: 3, opacity: 0.7 }}>Tap to view →</div>
              </div>
            </button>
          )
        }
        // Regular text — apply **bold** parsing
        const boldParts = seg.split(/\*\*([^*\n]+)\*\*/g)
        // No complete **pair** in this segment: strip any leftover unpaired **
        // so a stray marker never shows as literal asterisks.
        if (boldParts.length === 1) { const t = seg.replace(/\*\*/g, ''); return t || null }
        return (
          <span key={si}>
            {boldParts.map((bp, bi) =>
              bi % 2 === 1
                ? <strong key={bi} style={{ fontWeight: 700 }}>{bp}</strong>
                : bp || null
            )}
          </span>
        )
      })}
    </>
  )
}

// ── Typewriter reveal — assistant replies type in like Claude, instead of
// appearing all at once. Reveals whole words (and whole [PRODUCT:N] tokens,
// atomically, so a card never flickers through as raw bracket text) rather
// than characters, which reads more natural at conversational speed. ────────
function TypewriterText({ text, products, liveRates, onProductClick, animate, onDone, onReveal, photos }: {
  text: string
  products: Product[]
  liveRates: ExchangeRates
  onProductClick: (p: Product) => void
  animate: boolean
  onDone?: () => void
  onReveal?: () => void
  photos?: string[]
}): React.ReactNode {
  // Same case/space tolerance as renderStylistText, so a token always reveals
  // atomically instead of flickering through as raw bracket text.
  const tokens = useMemo(() => text.match(/\[(?:PRODUCT|PHOTO):\s*\d+\]|\S+|\s+/gi) || [], [text])
  const [count, setCount] = useState(animate ? 0 : tokens.length)

  useEffect(() => {
    if (!animate) { setCount(tokens.length); return }
    setCount(0)
    let i = 0
    let done = false
    const id = setInterval(() => {
      i += 2
      if (i >= tokens.length) {
        i = tokens.length
        clearInterval(id)
        if (!done) { done = true; onDone?.() }
      }
      setCount(i)
      // Keep the growing reply pinned in view as it types, so it never slides
      // down behind / below the floating search bar mid-reveal.
      onReveal?.()
    }, 16)
    return () => clearInterval(id)
    // Deliberately keyed on the text itself, not `animate`/`onDone` — a reply
    // is written once and never mutates, so this should run exactly once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])

  const revealed = tokens.slice(0, count).join('')
  return (
    <>
      {renderStylistText(revealed, products, liveRates, onProductClick, photos ?? [])}
      {animate && count < tokens.length && <span className="fr-type-caret" />}
    </>
  )
}

// Reads /api/ai/stylist's streamed NDJSON response: one `{type:'progress',
// icon, main, detail}` line per genuine backend transition (about to hit the
// catalog, catalog resolved with N real candidates, about to call the model,
// ...), fired via onProgress the instant each arrives, then a final
// `{type:'result', ...}` line carrying exactly the same payload shape this
// endpoint always returned. Shared by sendStylist and both "See more" loaders
// so live search and live pagination get identical, genuinely-synced tracking
// instead of three separate simulated schedules.
async function readStylistStream(res: Response, onProgress: (icon: string, main: string, detail?: string) => void): Promise<any> {
  if (!res.body) return null
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let result: any = null
  const handleLine = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed) return
    try {
      const obj = JSON.parse(trimmed)
      if (obj.type === 'progress') onProgress(obj.icon, obj.main, obj.detail)
      else if (obj.type === 'result') result = obj
    } catch { /* one malformed line shouldn't abort the whole read */ }
  }
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let newlineIdx
    while ((newlineIdx = buffer.indexOf('\n')) >= 0) {
      handleLine(buffer.slice(0, newlineIdx))
      buffer = buffer.slice(newlineIdx + 1)
    }
  }
  handleLine(buffer) // trailing content with no final newline
  return result
}

// ── Stylist loading phases — query-aware, operational progress steps ─────────
// Perplexity-style: each step names what is actually happening (reading the
// request, searching the catalog, filtering, ranking) rather than a simulated
// inner monologue. `icon` picks a distinct glyph per step in the stepper UI.
type StylistLoadingIcon = 'read' | 'search' | 'filter' | 'compare' | 'palette' | 'fabric' | 'value' | 'outfit' | 'curate'
// trace: a variable-length execution log for this step (2-4 lines typically),
// styled like a real operation trace — as many lines as the step genuinely
// has to report, never padded to a fixed count.
type StylistLoadingPhase = { main: string; icon: StylistLoadingIcon; trace: string[] }

// Client-side last-line guard, mirroring the server's own dedupeById — a
// product id must never render twice in the same result set, regardless of
// what produced the response.
function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  return items.filter(p => {
    if (!p?.id || seen.has(p.id)) return false
    seen.add(p.id)
    return true
  })
}

// Every "Found for you" row shows 13 products — a fetch that comes back with
// more (the server sends up to 4 rows' worth at once) renders as that many
// separate rows instead of one long lump, matching how foundProductBatches
// already renders one row per batch. A fetch with fewer than 13 just shows
// one shorter row — never padded to a fixed row count.
const PRODUCTS_PER_ROW = 13
function chunkIntoRows(count: number): number[] {
  const rows: number[] = []
  let remaining = count
  while (remaining > 0) {
    const size = Math.min(PRODUCTS_PER_ROW, remaining)
    rows.push(size)
    remaining -= size
  }
  return rows
}

// The tracker is now driven entirely by real backend events (see the NDJSON
// stream read in sendStylist/loadMoreStylistProducts/loadMoreGroupProducts)
// instead of a client-only simulated schedule. Every step shown was a genuine
// `send(...)` call on the server at the moment that operation actually
// started — no canned trace text, no fixed pacing, no padding once the real
// work runs long. This directly replaced three rounds of client-only fixes
// that couldn't actually solve the underlying complaint: the last step
// replaying the same lines 6-8 times while waiting (there was nothing real
// left to show), no correlation between backend completion and when the
// animation actually stopped, and the same staleness on "See more."
const STYLIST_FLICKER_GUARD_MS = 320

// ── Step icons ───────────────────────────────────────────────────────────────
// A single bespoke visual language, not a generic icon-font set — every glyph
// here is built from the same thread / needle / weave vocabulary as the
// FabricsIcon mark, so the tracker reads as something only Discern has, not a
// reskinned Feather/Lucide set. Search is a thread loop with a needle for a
// handle, not a magnifying glass; filter is a pin through narrowing pleats,
// not funnel lines; curate is a finishing thread-loop, not an AI sparkle.
function StylistStepIcon({ icon, size = 13 }: { icon: StylistLoadingIcon; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (icon) {
    case 'read':
      // A needle at the head of a stitched line — tracing/reading the thread of the request.
      return <svg {...common}>
        <circle cx="17.2" cy="6.2" r="1.25" fill="currentColor" stroke="none" />
        <path d="M16.2 7.2 13.6 9.8" />
        <path d="M13.1 10.3c-2.6 3-5.7 3.4-8.3.5" strokeDasharray="1.9 2.1" />
      </svg>
    case 'search':
      // Thread wound in a loop, needle as the handle — search, not a glass lens.
      return <svg {...common}>
        <circle cx="10" cy="10" r="6.3" />
        <path d="M14.5 14.5 19.6 19.6" />
        <circle cx="20.3" cy="20.3" r="1.05" fill="currentColor" stroke="none" />
      </svg>
    case 'filter':
      // A pin through narrowing pleats — fabric being tailored down, not funnel lines.
      return <svg {...common}>
        <circle cx="12" cy="3.3" r="1.05" fill="currentColor" stroke="none" />
        <path d="M12 4.3v15.8" />
        <path d="M4.5 7.6h15M7.5 12.5h9M10.5 17.4h3" />
      </svg>
    case 'compare':
      // A balance scale with two swatches on the pans, not generic scale-cups.
      return <svg {...common}>
        <path d="M12 3v16.3" />
        <path d="M9 20h6" />
        <path d="M5 7.2h5M14 7.2h5" />
        <rect x="3.2" y="7.2" width="4.9" height="3.7" rx="1" />
        <rect x="15.9" y="7.2" width="4.9" height="3.7" rx="1" />
      </svg>
    case 'palette':
      // Three graduated thread ends — a colour story, not a paint palette.
      return <svg {...common}>
        <circle cx="5.8" cy="17.2" r="1.95" fill="currentColor" stroke="none" />
        <circle cx="12" cy="11.6" r="2.55" fill="currentColor" stroke="none" />
        <circle cx="18.3" cy="6" r="3.05" fill="currentColor" stroke="none" />
      </svg>
    case 'fabric':
      // A woven swatch — plain-weave crosshatch, not a generic cloth drape.
      return <svg {...common}>
        <rect x="4" y="4" width="16" height="16" rx="2.2" />
        <path d="M4 12h16M12 4v16" />
      </svg>
    case 'value':
      // A price tag on a thread loop instead of a punched hole.
      return <svg {...common}>
        <path d="M12.6 3.3a1 1 0 0 1 .7-.3H19a1 1 0 0 1 1 1v5.7a1 1 0 0 1-.3.7l-9 9a1 1 0 0 1-1.4 0l-5.7-5.7a1 1 0 0 1 0-1.4z" />
        <circle cx="16.4" cy="7.6" r="1.3" />
      </svg>
    case 'outfit':
      // A garment on a hanger, hook curled like a thread end.
      return <svg {...common}>
        <path d="M12 4.2a1.8 1.8 0 1 1 1.8 1.8" />
        <path d="M12 6 2.5 11.8l1.6 2.7L12 10l7.9 4.5 1.6-2.7z" />
        <path d="M6.5 12 5 20.5h14L17.5 12" />
      </svg>
    case 'curate':
      // A finishing thread loop — the completed, curated result — not an AI sparkle.
      return <svg {...common}>
        <path d="M6.3 12c0-2.1 1.6-3.4 3.1-3.4 1.6 0 2.1 1.3 2.6 3.4.5 2.1 1 3.4 2.6 3.4 1.5 0 3.1-1.3 3.1-3.4S16.1 8.6 14.6 8.6c-1.6 0-2.1 1.3-2.6 3.4-.5 2.1-1 3.4-2.6 3.4-1.5 0-3.1-1.3-3.1-3.4z" />
      </svg>
  }
}

// ── Main component ────────────────────────────────────────────────────────────
export default function DiscernApp({
  initialShopperContext, initialRates,
}: { initialShopperContext: ShopperContext; initialRates: ExchangeRates }) {

  const {
    input, setInput,
    savedIds, savedProducts, shopperContext, rates,
    toggleSaved,
    isPremium, dailySearchesRemaining,
    showUpgradeSheet, setShowUpgradeSheet,
  } = useDiscernChat(initialShopperContext, initialRates)

  // ── Auth (optional — profile view only) ─────────────────────────────────────
  const { status: authStatus, data: session } = useSession()
  const onboardEmail = session?.user?.email ?? undefined
  const authProof = useConvexAuthProof(onboardEmail)

  // Feature flag: gate the whole app behind sign-in. Set `false` to let anyone
  // use Discern directly without an account.
  const REQUIRE_LOGIN = true

  // ── Stylist memory (Fabrics persistent context) ─────────────────────────────
  const stylistMemoryData = useQuery(
    api.stylistMemory.getStylistMemory,
    onboardEmail && authProof ? { userEmail: onboardEmail, authProof } : 'skip'
  )
  const stylistMemorySummary = stylistMemoryData?.summary ?? undefined

  // ── Taste profile (onboarding) ──────────────────────────────────────────────
  const tasteProfileData = useQuery(
    api.tasteProfile.getTasteProfile,
    onboardEmail && authProof ? { userEmail: onboardEmail, authProof } : 'skip'
  )
  // Gender from profile — passed to AI so all search/styling defaults to it.
  // Values: 'Men' | 'Women' | 'Both' | 'Non-binary'. undefined = not set.
  const shopperGenderFromProfile = useMemo(() => {
    if (!tasteProfileData?.sizes) return undefined
    const s = tasteProfileData.sizes as Record<string, string>
    return s.gender || undefined
  }, [tasteProfileData])

  // Full profile summary for Fabrics — gender + sizes so it never has to ask.
  const shopperProfileForStylist = useMemo(() => {
    if (!tasteProfileData?.sizes) return shopperGenderFromProfile || undefined
    const s = tasteProfileData.sizes as Record<string, string>
    const gender = s.gender || ''
    const genderLabel = gender && gender !== 'Both' && gender !== 'Non-binary'
      ? `${gender.toLowerCase()}'s `
      : ''
    const parts: string[] = []
    if (gender) parts.push(`shops for: ${gender.toLowerCase()}`)
    const sizeStr = [
      s.tops && `tops ${s.tops}`,
      s.bottoms && `bottoms ${s.bottoms}`,
      s.shoes && `shoes ${s.shoes}`,
    ].filter(Boolean).join(', ')
    if (sizeStr) parts.push(`${genderLabel}sizes: ${sizeStr}`)
    return parts.length > 0 ? parts.join(' | ') : undefined
  }, [tasteProfileData, shopperGenderFromProfile])
  // Structured sizes for the stylist request — used server-side as a real
  // catalog ranking signal (GlobalCatalogService), not just prose the model
  // reads. Kept separate from shopperProfileForStylist's formatted string so
  // the backend never has to parse sizes back out of prose.
  const shopperSizesForStylist = useMemo(() => {
    if (!tasteProfileData?.sizes) return undefined
    const s = tasteProfileData.sizes as Record<string, string>
    return { tops: s.tops || undefined, bottoms: s.bottoms || undefined, shoes: s.shoes || undefined }
  }, [tasteProfileData])
  // Formatted wardrobe summary for Fabrics — a prior "Scan my wardrobe" scan
  // is stored (tasteProfileData.wardrobe) but was never actually threaded
  // into the prompt; this is the fix. Kept short and prose-formatted, same
  // discipline as shopperProfileForStylist.
  const shopperWardrobeForStylist = useMemo(() => {
    const w = (tasteProfileData as any)?.wardrobe
    if (!w?.items?.length && !w?.summary) return undefined
    const itemsLine = (w.items ?? []).slice(0, 20).map((it: any) => `${it.color} ${it.type} (${it.style})`).join(', ')
    const gapsLine = w.gaps?.length ? `Known gaps: ${w.gaps.join(', ')}.` : ''
    return [w.summary, itemsLine ? `Owns: ${itemsLine}.` : '', gapsLine].filter(Boolean).join(' ') || undefined
  }, [tasteProfileData])
  const upsertProfile = useMutation(api.tasteProfile.upsertTasteProfile)
  const updateUserNameMutation = useMutation(api.users.updateUserName)
  const flagQualitySignal = useMutation(api.qualitySignals.flagResult)
  // Feeds the quality-feedback cron (relevance demotion) and the style-signals
  // trend cron — both read search_history, which had zero live writers before
  // this. Fire-and-forget, matching flagQualitySignal's pattern.
  const saveSearchHistoryMutation = useMutation(api.shop.saveSearchHistory)
  const trackEventMutation = useMutation(api.users.trackEvent)
  // Cross-device Fabrics history sync — see convex/stylistSessions.ts. Every
  // local session change pushes here (when signed in); on mount, any remote
  // session this device doesn't have gets pulled in to backfill the sidebar.
  const syncStylistSession = useMutation(api.stylistSessions.upsertStylistSession)
  // Debounce + dedupe state for the cross-device session push (see the persist
  // effect) — the write itself is cheap, but each one re-runs the reactive
  // session-list query against every stored session document.
  const sessionSyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sessionSyncLast  = useRef<string>('')
  const deleteSyncedStylistSession = useMutation(api.stylistSessions.deleteStylistSession)
  const remoteStylistSessions = useQuery(
    api.stylistSessions.listStylistSessions,
    onboardEmail && authProof ? { userEmail: onboardEmail, authProof } : 'skip'
  )
  const [settingsOpen, setSettingsOpen]         = useState(false)
  const [settingsView, setSettingsView]         = useState<'main' | 'profile'>('main')
  const [profileName, setProfileName]           = useState('')
  const [profileGender, setProfileGender]       = useState('')
  const [profileSizeTops, setProfileSizeTops]   = useState('')
  const [profileSizeBottoms, setProfileSizeBottoms] = useState('')
  const [profileSizeShoes, setProfileSizeShoes] = useState('')
  const [profileSaving, setProfileSaving]       = useState(false)
  const [profileError, setProfileError]         = useState('')
  const [showConsent, setShowConsent]           = useState(false)
  const [consentFromSettings, setConsentFromSettings] = useState(false)
  const [consentAnalytics, setConsentAnalytics] = useState(true)
  const [consentLocation, setConsentLocation]   = useState(true)
  const [consentSaving, setConsentSaving]       = useState(false)
  const [showOnboarding, setShowOnboarding]     = useState(false)
  const [onboardingStep, setOnboardingStep]     = useState(0)
  const [onboardGender, setOnboardGender]       = useState('')
  const [selectedStyles, setSelectedStyles]     = useState<string[]>([])
  const [onboardSizes, setOnboardSizes]         = useState({ tops: '', bottoms: '', shoes: '' })
  const [selectedBudget, setSelectedBudget]     = useState<number | null>(null)

  // Show consent sheet first (once, on first sign-in), then onboarding
  const userRecord = useQuery(api.users.getUserByEmail, onboardEmail && authProof ? { email: onboardEmail, authProof } : 'skip')
  useEffect(() => {
    if (authStatus !== 'authenticated') return
    if (userRecord === undefined) return // still loading
    if (userRecord && tasteProfileData === null) {
      setShowOnboarding(true)
    }
  }, [authStatus, tasteProfileData, userRecord])

  async function saveConsent() {
    if (!onboardEmail || consentSaving) return
    setConsentSaving(true)
    try {
      const body: Record<string, any> = { consentAnalytics, consentLocation }
      // If location consented, request GPS now
      if (consentLocation && 'geolocation' in navigator) {
        await new Promise<void>(resolve => {
          navigator.geolocation.getCurrentPosition(
            pos => { body.lat = pos.coords.latitude; body.lng = pos.coords.longitude; resolve() },
            () => resolve(),
            { timeout: 5000 }
          )
        })
      }
      await fetch('/api/analytics/identify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    } catch { /* best-effort */ } finally {
      setConsentSaving(false)
      setShowConsent(false)
      if (consentFromSettings) {
        setConsentFromSettings(false)
        setSettingsOpen(true)
      } else if (tasteProfileData === null) {
        setShowOnboarding(true)
      }
    }
  }

  function openProfileView() {
    const existingSizes = tasteProfileData?.sizes as any
    setProfileError('')
    setProfileName(userRecord?.name || session?.user?.name || '')
    setProfileGender(existingSizes?.gender || '')
    setProfileSizeTops(existingSizes?.tops || '')
    setProfileSizeBottoms(existingSizes?.bottoms || '')
    setProfileSizeShoes(existingSizes?.shoes || '')
    setSettingsView('profile')
  }

  async function saveProfile() {
    if (!onboardEmail || profileSaving) return
    // The cached proof can be momentarily absent (initial fetch still in flight,
    // or a transient failure right after sign-in). Try once to mint a fresh one
    // on demand before giving up, so a save isn't blocked on a timing gap — this
    // is the difference between "works on the next click" and "stuck for minutes".
    const proof = authProof ?? await fetchConvexAuthProof()
    if (!proof) {
      setProfileError("Couldn't reach the server. Please try again in a moment.")
      return
    }
    setProfileSaving(true)
    setProfileError('')
    // Never let the button hang on "Saving…" — if the Convex client can't reach
    // the backend, a mutation can stay pending forever (it never rejects). Race
    // every save against a timeout so the user always gets a definitive result.
    const withTimeout = <T,>(p: Promise<T>, ms = 12000): Promise<T> =>
      Promise.race([
        p,
        new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
      ])
    try {
      const sizes: Record<string, string> = {}
      if (profileSizeTops.trim()) sizes.tops = profileSizeTops.trim()
      if (profileSizeBottoms.trim()) sizes.bottoms = profileSizeBottoms.trim()
      if (profileSizeShoes.trim()) sizes.shoes = profileSizeShoes.trim()
      if (profileGender) sizes.gender = profileGender
      // Profile write first — this auto-provisions the user row if needed, so the
      // name update below (and everything else) can rely on the user existing.
      await withTimeout(upsertProfile({ userEmail: onboardEmail, sizes: Object.keys(sizes).length ? sizes : undefined, authProof: proof }))
      if (profileName.trim()) {
        await withTimeout(updateUserNameMutation({ email: onboardEmail, name: profileName.trim(), authProof: proof }))
      }
      setProfileSaving(false)
      setSettingsView('main')
    } catch (err) {
      // Surface the failure instead of swallowing it — a silent failure looked
      // identical to a save, which is why details appeared not to persist.
      console.error('[saveProfile] failed:', err)
      const timedOut = err instanceof Error && err.message === 'timeout'
      setProfileError(timedOut
        ? "Couldn't reach the server. Your changes weren't saved. Please try again."
        : "Couldn't save. Please try again.")
      setProfileSaving(false)
    }
  }

  async function finishOnboarding(skip = false) {
    if (!onboardEmail) { setShowOnboarding(false); return }
    const BUDGET_RANGES = [[0, 50], [50, 150], [150, 400], [400, 9999]]
    try {
      // Mint a proof on demand if the cached one hasn't landed yet, same as
      // saveProfile — otherwise a fast-finishing onboarding silently drops the
      // profile write.
      const proof = authProof ?? await fetchConvexAuthProof()
      if (!proof) throw new Error('auth proof not ready')
      const hasSizes = onboardSizes.tops || onboardSizes.bottoms || onboardSizes.shoes
      const sizesObj = (onboardGender || hasSizes)
        ? { ...onboardSizes, ...(onboardGender ? { gender: onboardGender } : {}) }
        : undefined
      await upsertProfile({
        userEmail: onboardEmail,
        styles: skip ? [] : selectedStyles,
        budgetMin: (!skip && selectedBudget !== null) ? BUDGET_RANGES[selectedBudget][0] : undefined,
        budgetMax: (!skip && selectedBudget !== null) ? BUDGET_RANGES[selectedBudget][1] : undefined,
        sizes: skip ? undefined : sizesObj,
        authProof: proof,
      })
    } catch { /* ignore */ }
    setShowOnboarding(false)
  }

  // ── UI state ────────────────────────────────────────────────────────────────
  const [userName, setUserName]       = useState(() => {
    if (typeof window === 'undefined') return ""
    return localStorage.getItem('discern_user_name') || ""
  })
  const [isEditingName, setIsEditing] = useState(false)
  const [nameInput, setNameInput]     = useState("")
  const [selectedProduct, setSelected]= useState<Product | null>(null)
  const [selectedSize, setSize]       = useState<string | null>(null)
  const [selectedColor, setColor]     = useState<string | null>(null)
  // Per-card selected colour in the results grid — keyed by product id so a
  // tapped swatch swaps that card's image without disturbing the others.
  const [cardColors, setCardColors]   = useState<Record<string, string>>({})
  const [activeImg, setActiveImg]     = useState(0)
  const [sheetY, setSheetY]           = useState(0)
  const [sheetSnap, setSheetSnap]     = useState<'full'|'half'>('full')
  const [isDragging, setIsDragging]   = useState(false)
  const [sidebarOpen, setSidebar]     = useState(false)
  const [sidebarView, setSidebarView] = useState<'nav' | 'saved' | 'profile'>('nav')
  const [inputHint, setInputHint]       = useState<string | null>(null)
  const [fetchedSizeGuide, setFetchedSizeGuide] = useState<string | null>(null)
  const [sizeGuideLoading, setSizeGuideLoading] = useState(false)
  const [sizeGuideOpen, setSizeGuideOpen]       = useState(false)
  const [sgTableIdx, setSgTableIdx]             = useState(0)
  const [sgGroupIdx, setSgGroupIdx]             = useState(0)
  const [sgDisplayUnit, setSgDisplayUnit]       = useState<'in' | 'cm' | null>(null)
  const [sgIntlGender, setSgIntlGender]         = useState<'w' | 'm'>('w')
  const [cleanDesc, setCleanDesc]               = useState<string | null>(null)
  const [cleanDescLoading, setCleanDescLoading] = useState(false)
  const [shippingInfo, setShippingInfo]         = useState<{ shipping: string; returns: string } | null>(null)
  const [fetchedProductImages, setFetchedProductImages] = useState<string[]>([])
  // Per-colour image map fetched from the brand's product.json — lets the sheet
  // show one colourway at a time. Keyed by colour value; looked up case-insensitively.
  const [fetchedColorImages, setFetchedColorImages] = useState<Record<string, string[]>>({})
  const [fetchedColors, setFetchedColors] = useState<string[]>([])
  const [loaded, setLoaded]             = useState(false)
  const [showExplore, setShowExplore]   = useState(false)
  // Explore feed — a random, Instagram-style mosaic of products from the best
  // brands (geo-aware). Fetched from /api/featured, cached so reopening is
  // instant, and paginated with infinite scroll.
  const [exploreFeed, setExploreFeed]   = useState<Product[]>(() => {
    if (typeof window === 'undefined') return []
    try { return JSON.parse(localStorage.getItem('discern:explore-feed') || '[]') } catch { return [] }
  })
  const [exploreFeedLoading, setExploreFeedLoading] = useState(false)
  const [exploreHasMore, setExploreHasMore] = useState(true)
  const [exploreSeed, setExploreSeed]   = useState(0)
  const exploreFeedRef = useRef<Product[]>([])
  const exploreBusyRef = useRef(false)
  const exploreBufferRef = useRef<Product[]>([])   // next page, prefetched for instant scroll
  const exploreSentinelRef = useRef<HTMLDivElement>(null)
  const exploreRefreshRef = useRef(0)              // bumps the brand window on refresh
  // Instagram-style pull-to-refresh: a spinner that follows the pull from the top
  // and fades out when the fresh feed has loaded.
  const [pullY, setPullY] = useState(0)
  const [pullRefreshing, setPullRefreshing] = useState(false)
  const pullStartY = useRef(0)
  const pulling = useRef(false)
  const [exploreToast, setExploreToast] = useState(false)
  const [exploreToastOut, setExploreToastOut] = useState(false)
  const [popupBlockedUrl, setPopupBlockedUrl] = useState<string | null>(null)
  const [exploreCache, setExploreCache] = useState<Product[]>(() => {
    if (typeof window === 'undefined') return []
    try { return JSON.parse(localStorage.getItem('discern:explore') || '[]') } catch { return [] }
  })
  const [productCtxMenu, setProductCtxMenu] = useState<{ product: Product; x: number; y: number; above: boolean } | null>(null)
  const [bagCtxMenu, setBagCtxMenu] = useState<{ product: Product; x: number; y: number; above: boolean } | null>(null)
  // ── Email OTP sign-in state ─────────────────────────────────────────────────
  const [otpEmail, setOtpEmail]         = useState('')
  const [otpCode, setOtpCode]           = useState('')
  const [otpStep, setOtpStep]           = useState<'email' | 'code'>('email')
  const [otpSending, setOtpSending]     = useState(false)
  const [otpVerifying, setOtpVerifying] = useState(false)
  const [otpError, setOtpError]         = useState<string | null>(null)
  const [otpResendIn, setOtpResendIn]   = useState(0)
  const [authUrlError, setAuthUrlError] = useState<string | null>(null)
  useEffect(() => {
    // Read error from URL params — NextAuth redirects here with ?error=XXX on failure
    const params = new URLSearchParams(window.location.search)
    const err = params.get('error')
    if (err) {
      const map: Record<string, string> = {
        Configuration: 'Google sign-in is not configured. Check GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Vercel.',
        OAuthSignin: 'Could not start Google sign-in. Try again.',
        OAuthCallback: 'Google sign-in failed. Make sure the redirect URI in Google Console is exactly: https://discern.enuid.com/api/auth/callback/google',
        OAuthAccountNotLinked: 'This email is already registered with a different sign-in method. Use email OTP instead.',
        AccessDenied: 'Sign-in was denied.',
        Verification: 'The sign-in link has expired or already been used.',
      }
      setAuthUrlError(map[err] ?? `Sign-in error: ${err}`)
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])
  useEffect(() => {
    if (otpResendIn <= 0) return
    const t = setTimeout(() => setOtpResendIn(s => Math.max(0, s - 1)), 1000)
    return () => clearTimeout(t)
  }, [otpResendIn])

  const [brandsOpen, setBrandsOpen]     = useState(false)
  const [brandQuery, setBrandQuery]     = useState('')
  const [activeBrand, setActiveBrand]   = useState<{ name: string; domain: string } | null>(null)
  // Every brand in the registry — not just the ones with a hand-set name — so
  // all ~370+ stores are browsable. Display name falls back name → BRAND_NAMES
  // → a cleaned domain token, and we de-dupe by domain.
  const allBrands = useMemo(() => {
    const seen = new Set<string>()
    const list: { domain: string; name: string }[] = []
    for (const s of UCP_REGISTRY) {
      const domain = s.domain
      if (seen.has(domain)) continue
      seen.add(domain)
      list.push({ domain, name: s.name || BRAND_NAMES[domain] || cleanBrandToken(domain) })
    }
    return list.sort((a, b) => a.name.localeCompare(b.name))
  }, [])
  const filteredBrands = useMemo(() => {
    const q = brandQuery.trim().toLowerCase()
    return q ? allBrands.filter(b => b.name.toLowerCase().includes(q)) : allBrands
  }, [allBrands, brandQuery])
  const openBrand = (b: { name: string; domain: string }) => {
    setBrandsOpen(false); setBrandQuery('')
    setActiveBrand(b)
    setShowExplore(false)
    sendStylist(b.name)
    setSidebar(false)
  }
  const [isWide, setIsWide]             = useState(() => typeof window !== 'undefined' ? window.innerWidth >= 768 : false)
  const [isMedium, setIsMedium]         = useState(() => typeof window !== 'undefined' ? window.innerWidth >= 768 : false)
  // Attach button — opens the device's native picker (Photo Library / Take
  // Photo / Choose Files / Drive) directly onto the wardrobe strip.
  const attachBtnFabricsRef = useRef<HTMLButtonElement>(null)
  const [windowWidth, setWindowWidth]   = useState(0)   // 0 = pre-mount; computed after hydration
  const [keyboardOffset, setKeyboardOffset] = useState(0)
  const [liveRates, setLiveRates]       = useState<ExchangeRates>(rates)
  const [tagText, setTagText]           = useState(TAGLINES[0])  // SSR-safe hero line; randomised client-side in effect
  const [tagVis, setTagVis]             = useState(true)
  const tagOrderRef                     = useRef<number[]>([])

  // ── Stylist sheet — conversational AI over specific product(s) ──────────────
  type StylistComparison = { rows: { label: string; values: string[] }[]; pick?: { index: number; reason: string } }
  type OutfitSlot = { query: string; slotCategory?: string | null; products: Product[] }
  // A single request can name 2+ distinct garment categories at once ("shirts
  // and shorts") without asking for one coordinated outfit — the backend
  // (multiCategorySearch in stylist/route.ts) splits that into one curated,
  // separately-ranked group per category instead of one ambiguous combined
  // search. When present, render each group as its own labeled strip instead
  // of the flat foundProducts list.
  // `batches` sizes each slide within a category: the initial fetch is the
  // first slide, and every "See more <category>" appends its result count as a
  // NEW slide/row in that same category (never extending one endless strip).
  type FoundProductGroup = { label: string; products: Product[]; query?: string; loadingMore?: boolean; hasNoMore?: boolean; batches?: number[] }
  // foundProductBatches sizes each row — chunked into groups of PRODUCTS_PER_ROW
  // (13) via chunkIntoRows, e.g. a 52-result fetch becomes [13, 13, 13, 13] — so
  // the flat foundProducts list renders as several short rows instead of one
  // long horizontally-scrolling line that keeps growing sideways forever.
  // trace: snapshot of the reasoning steps that played while this reply was
  // being produced (the same phases the live step tracker showed) — kept on
  // the message so "what did it think about" survives past the loading
  // animation, behind a collapsed "Show reasoning" toggle.
  type OutfitGroup = { label: string; products: Product[] }
  type StylistMsg = { role: 'user' | 'assistant'; content: string; comparison?: StylistComparison; comparisonProducts?: Product[]; images?: string[]; pinnedProducts?: Product[]; id?: string; foundProducts?: Product[]; foundProductGroups?: FoundProductGroup[]; foundProductBatches?: number[]; outfitSlots?: OutfitSlot[]; outfitGroups?: OutfitGroup[]; busy?: boolean; searchQuery?: string; loadingMore?: boolean; hasNoMore?: boolean; trace?: StylistLoadingPhase[] }
  type StylistHistoryEntry = { id: string; label: string; createdAt: number }
  // Guards against a shape mismatch from a pre-migration localStorage payload
  // (this app went through a chat-format architecture change) crashing the
  // render the first time a returning user's browser is read back — falls
  // back to a fresh, empty session instead of rendering garbled data.
  function parseStylistMsgs(raw: string | null): StylistMsg[] {
    if (!raw) return []
    try {
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return []
      const valid = parsed.every((m: any) =>
        m && typeof m === 'object' && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string'
      )
      if (!valid) return []
      // Strip TRANSIENT UI flags before restoring — these describe an in-flight
      // request, not durable message data. If a search/"See more" was mid-flight
      // when the session was persisted (refresh or session-switch), a saved
      // loadingMore/busy would render a spinner that never resolves.
      return (parsed as StylistMsg[]).map(m => {
        const { busy, loadingMore, ...rest } = m as any
        const foundProductGroups = Array.isArray((rest as any).foundProductGroups)
          ? (rest as any).foundProductGroups.map((g: any) => { const { loadingMore: _lm, ...gr } = g; return gr })
          : (rest as any).foundProductGroups
        return { ...rest, foundProductGroups }
      })
    } catch { return [] }
  }
  const [stylistProducts, setStylistProducts] = useState<Product[]>([])
  const STYLIST_HISTORY_LS = 'discern:stylist-history'
  // Tracks which session (if any) is currently open — an explicit empty
  // string means "fresh/new chat", distinct from "no marker written yet"
  // (a first-ever visit, or a page from before this existed), which falls
  // back to the old behavior of opening the most recent session.
  const STYLIST_ACTIVE_SESSION_LS = 'discern:stylist-active-session'
  const stylistSessionLS = (id: string) => `discern:stylist-session:${id}`
  const [stylistMsgs, setStylistMsgs]       = useState<StylistMsg[]>(() => {
    try {
      const activeId = localStorage.getItem(STYLIST_ACTIVE_SESSION_LS)
      if (activeId === '') return [] // explicit "new chat" was the last action
      if (activeId) {
        const raw = localStorage.getItem(stylistSessionLS(activeId))
        if (raw) return parseStylistMsgs(raw)
      }
      if (activeId === null) {
        // No marker ever written — pre-existing behavior for old sessions.
        const hist = JSON.parse(localStorage.getItem('discern:stylist-history') || '[]') as StylistHistoryEntry[]
        if (hist.length > 0) {
          const raw = localStorage.getItem(`discern:stylist-session:${hist[0].id}`)
          if (raw) return parseStylistMsgs(raw)
        }
      }
    } catch {}
    return []
  })
  const [stylistHistory, setStylistHistory] = useState<StylistHistoryEntry[]>(() => {
    try { return JSON.parse(localStorage.getItem('discern:stylist-history') || '[]') } catch { return [] }
  })
  // Messages already on screen at mount (restored history) render instantly;
  // only messages that arrive during THIS session get the typewriter reveal.
  const initialStylistMsgCount = useRef(stylistMsgs.length)
  // Indices whose typewriter reveal has already finished — an unrelated
  // re-render (e.g. a sibling message loading) must not restart them.
  const typedStylistIndices = useRef<Set<number>>(new Set())
  const [stylistRenameId, setStylistRenameId]   = useState<string | null>(null)
  const [stylistRenameVal, setStylistRenameVal] = useState('')
  const [stylistCtxMenu, setStylistCtxMenu]     = useState<{ id: string; label: string; x: number; y: number; above: boolean } | null>(null)
  const stylistRenameRef = useRef<HTMLInputElement>(null)
  const [stylistInput, setStylistInput]       = useState('')
  // Editing a previously-sent message — text and attached photos can be
  // changed, but no new photos can be added mid-edit. Saving truncates the
  // conversation from that point and re-asks with the edited version.
  const [editingMsgIndex, setEditingMsgIndex] = useState<number | null>(null)
  const [editText, setEditText]               = useState('')
  const [editImages, setEditImages]           = useState<string[]>([])
  const [stylistLoading, setStylistLoading]   = useState(false)
  // True for a brief moment once the reply has arrived but before it's shown —
  // lets the step tracker dissolve out cleanly instead of instantly swapping
  // for the reply.
  const [stylistDissolving, setStylistDissolving] = useState(false)
  // The home page IS the one conversation now — every "is a request in
  // flight" check in the UI reads Fabrics' own loading state.
  const loading = stylistLoading
  // Filled incrementally by real backend progress events (readStylistStream)
  // as a fresh search plays out — the last entry is always the active step,
  // everything before it is done. No separate "current index" state needed.
  const [stylistLoadingPhases, setStylistLoadingPhases] = useState<StylistLoadingPhase[]>([])
  // Which message's persisted reasoning trace is expanded (one at a time).
  const [openTraceIdx, setOpenTraceIdx] = useState<number | null>(null)
  // "See more" gets the same real-event-driven tracker as a fresh search —
  // only one "See more" can be in flight at a time (the button disables
  // while loading), so one shared phases array is enough.
  const [loadMorePhases, setLoadMorePhases] = useState<StylistLoadingPhase[]>([])
  const stylistScrollRef                      = useRef<HTMLDivElement>(null)
  const stylistSessionId                    = useRef<string | null>(null)
  // Wardrobe pieces the shopper owns — persist across the whole conversation as
  // context, so they can attach what they have and then ask Fabrics to build a
  // full outfit, find what's missing, or style combinations over many turns.
  const [wardrobeImages, setWardrobeImages] = useState<{ url: string }[]>([])
  const [wardrobeScanBusy, setWardrobeScanBusy] = useState(false)
  const wardrobeFileRef                     = useRef<HTMLInputElement>(null)
  // Products attached to the search bar — sending a query with these opens the stylist.
  const [barProducts, setBarProducts]       = useState<Product[]>([])

  const addBarProduct = (p: Product) => {
    setBarProducts(prev => (prev.some(x => x.id === p.id) || prev.length >= 8) ? prev : [...prev, p])
    setInputHint('Ask about your selection…')
    setTimeout(() => taRef.current?.focus(), 80)
  }
  const removeBarProduct = (id: string) => setBarProducts(prev => {
    const next = prev.filter(p => p.id !== id)
    if (next.length === 0) setInputHint(null)
    return next
  })
  function deleteStylistEntry(id: string) {
    setStylistHistory(prev => prev.filter(e => e.id !== id))
    try { localStorage.removeItem(stylistSessionLS(id)) } catch {}
    if (onboardEmail && authProof) {
      mergedRemoteSessionIds.current.add(id) // don't let the next pull resurrect what was just deleted
      deleteSyncedStylistSession({ userEmail: onboardEmail, sessionId: id, authProof }).catch(() => {})
    }
    if (stylistSessionId.current === id) {
      setStylistMsgs([])
      stylistSessionId.current = null
    }
  }
  function renameStylistEntry(id: string, newLabel: string) {
    setStylistHistory(prev => prev.map(e => e.id === id ? { ...e, label: newLabel } : e))
    // The main push effect only fires on stylistMsgs changes, so a rename
    // alone (no new message) would otherwise sit unsynced until the next
    // message in that session — push it immediately here instead.
    if (onboardEmail && authProof) {
      try {
        const raw = localStorage.getItem(stylistSessionLS(id))
        if (raw) syncStylistSession({ userEmail: onboardEmail, sessionId: id, label: newLabel, messages: raw, authProof }).catch(() => {})
      } catch {}
    }
  }

  // Wardrobe attach — the one photo-attach flow. Compresses client-side and
  // lands in the persistent wardrobeImages strip, shown for the whole conversation.
  const handleWardrobeFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    files.slice(0, 8 - wardrobeImages.length).forEach(file => {
      const reader = new FileReader()
      reader.onload = ev => {
        const dataUrl = ev.target?.result as string
        const img = new window.Image()
        img.onload = () => {
          const MAX = 768
          const ratio = Math.min(MAX / img.width, MAX / img.height, 1)
          const canvas = document.createElement('canvas')
          canvas.width  = Math.round(img.width * ratio)
          canvas.height = Math.round(img.height * ratio)
          canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
          const compressed = canvas.toDataURL('image/jpeg', 0.82)
          setWardrobeImages(prev => prev.length < 8 ? [...prev, { url: compressed }] : prev)
        }
        img.src = dataUrl
      }
      reader.readAsDataURL(file)
    })
    if (wardrobeFileRef.current) wardrobeFileRef.current.value = ''
  }

  // Structured wardrobe analysis — distinct from just attaching photos to a
  // normal chat message (which gets ad-hoc styling advice via the vision
  // path, but nothing persisted). This calls mode:'wardrobe-scan', which
  // extracts a structured item list and, when signed in, saves it via
  // tasteProfile.upsertWardrobeAnalysis so future turns (any conversation,
  // not just this one) can reference it — see shopperWardrobeForStylist.
  const scanWardrobe = async () => {
    if (wardrobeImages.length === 0 || wardrobeScanBusy) return
    const imgs = wardrobeImages.map(img => img.url)
    setWardrobeScanBusy(true)
    setWardrobeImages([])
    setStylistMsgs(prev => [...prev, { role: 'user', content: 'Scan my wardrobe', images: imgs }])
    try {
      const res = await fetch('/api/ai/stylist', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'wardrobe-scan', images: imgs, userEmail: onboardEmail, authProof }),
      })
      const data = await readStylistStream(res, () => {}) // no live tracker on this flow yet — just needs the final result
      setStylistMsgs(prev => [...prev, { role: 'assistant', content: data?.reply || "I couldn't quite make out your wardrobe pieces. Try clearer, well-lit photos?" }])
    } catch {
      setStylistMsgs(prev => [...prev, { role: 'assistant', content: 'Something went wrong scanning your wardrobe. Please try again.' }])
    } finally {
      setWardrobeScanBusy(false)
    }
  }

  const sendStylist = async (q: string, productsArg?: Product[], historyArg?: StylistMsg[], imagesArg?: { url: string }[]) => {
    const images   = imagesArg ?? []
    const question = q.trim() || (
      images.length > 0 ? 'Build me a complete outfit around these pieces.'
      : ''
    )
    let products = productsArg ?? stylistProducts
    const history  = historyArg ?? stylistMsgs
    // A follow-up about the pieces pinned a turn or two ago ("tell me about
    // these", "the selected ones", "details of the ones I picked", "what about
    // them") — the pins get cleared after each send, so without this the message
    // arrives with NO product data and the model hallucinates names, brands, and
    // colours (the reported lies). When the caller attached nothing for this
    // turn, carry the most recent turn's pinned products forward WITH their real
    // data, so it describes the actual pieces. Triggers on any back-reference to
    // the pinned items, OR on a short follow-up (<= 6 words) right after a turn
    // that had pins — both mean "keep talking about what I just pinned".
    // Deliberately narrow, because a false positive is WORSE than a miss: pinned
    // products suppress the fast path AND stop any new search ("pinned products
    // are the answer"), so wrongly attaching a stale pin surfaces zero products.
    // Hence: never when photos are attached this turn (a photo pick is its own
    // thing), only an explicit demonstrative back-reference, and only pins from
    // the IMMEDIATELY PRECEDING exchange (a recency window) rather than any pin
    // ever made in the session.
    if (productsArg === undefined && images.length === 0) {
      const refersToPinned = /\b(these|those|them)\b|\bthe (ones?|selection)\b/i.test(question)
      if (refersToPinned) {
        const RECENCY = 3 // last user msg + its reply + a little slack
        for (let k = history.length - 1; k >= Math.max(0, history.length - RECENCY); k--) {
          const pp = history[k]?.pinnedProducts
          if (pp && pp.length > 0) { products = pp; break }
        }
      }
    }
    if (!question || stylistLoading) return
    setStylistInput('')
    // A one-shot attach (wardrobe photo or any other image) — shown in the
    // sent bubble and sent to the vision model. Not persisted beyond this
    // one turn; the caller (doSearch) clears wardrobeImages right after
    // calling this, same as any other attachment.
    const capturedImages = images.map(i => i.url)
    // An empty history means a genuinely new conversation ONLY if we aren't
    // already in one. Editing and resending the FIRST message also passes an
    // empty (truncated) history, which used to mint a SECOND session id and a
    // second sidebar entry — forking one conversation into two and orphaning the
    // original. Reuse the open session in that case.
    const isNewSession = history.length === 0 && !stylistSessionId.current
    if (isNewSession) {
      const sessionId = `f-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      stylistSessionId.current = sessionId
      try { localStorage.setItem(STYLIST_ACTIVE_SESSION_LS, sessionId) } catch {}
      setStylistHistory(prev => [
        { id: sessionId, label: question.slice(0, 80), createdAt: Date.now() },
        ...prev,
      ].slice(0, 30))
    }
    // Attach the pieces this query is actually about (whether pinned via the
    // staging strip or "Ask Fabrics") to the user message, so they render right
    // beside the question in the thread instead of only in the staging strip.
    setStylistMsgs(prev => [...prev, { role: 'user', content: question, images: capturedImages.length > 0 ? capturedImages : undefined, pinnedProducts: products.length > 0 ? products.slice(0, 8) : undefined }])
    // Starts empty — every step shown from here on is a genuine backend
    // event (see readStylistStream), not a pre-built simulated schedule.
    setStylistLoadingPhases([])
    setStylistLoading(true)
    const requestStartedAt = Date.now()
    // The session this request belongs to. If the user opens a DIFFERENT
    // conversation before it returns, the result must be discarded — grafting
    // it onto the now-open session (by array index) corrupts that conversation
    // and the persist/sync effects then save the corruption cross-device.
    const originSession = stylistSessionId.current
    // Local mirror of the phases as they arrive, kept in lockstep with the
    // state setter below — needed so the FINAL list can be persisted onto
    // the message's `trace` field without racing React's state batching.
    const capturedPhases: StylistLoadingPhase[] = []
    const onProgress = (icon: string, main: string, detail?: string) => {
      const phase: StylistLoadingPhase = { icon: icon as StylistLoadingIcon, main, trace: detail ? [detail] : [] }
      capturedPhases.push(phase)
      setStylistLoadingPhases(prev => [...prev, phase])
    }
    try {
      const payloadProducts = products.map(p => ({
        id: p.id, title: p.title, vendor: p.vendor, price: p.price, currency: p.currency,
        material: extractMaterial(p) || undefined,
        description: (getDescriptionText(p) || '').slice(0, 900) || undefined,
        tags: (p.tags || []).filter(t => !isInternalTag(t)).slice(0, 20),
        options: p.options,
      }))
      const requestBody = JSON.stringify({
        products: payloadProducts,
        messages: history.map(m => ({
          role: m.role,
          content: m.content,
          foundProducts: m.foundProducts?.map(p => ({
            title: p.title, vendor: p.vendor,
            price: p.price, currency: p.currency,
          })),
        })),
        question,
        images: capturedImages,
        buyerCurrency: shopperContext?.currency,
        buyerCountry: shopperContext?.country,
        memorySummary: stylistMemorySummary,
        shopperGender: shopperGenderFromProfile,
        shopperProfile: shopperProfileForStylist,
        shopperSizes: shopperSizesForStylist,
        shopperWardrobe: shopperWardrobeForStylist,
        // Free-tier personalization — available to every shopper, not just
        // premium (memorySummary is premium-only).
        savedProducts: savedProducts.slice(0, 12).map(p => ({
          title: p.title, vendor: p.vendor, price: p.price, currency: p.currency,
        })),
        recentSearches: stylistHistory.slice(0, 8).map(h => h.label),
      })
      // One automatic retry on a TRANSIENT failure (a network blip, a cold
      // start, or hitting the app mid-deploy) — the exact "Something went wrong
      // reaching Fabrics" case. Only retries when the first attempt threw or
      // produced no result at all, so a real reply never re-sends (no double
      // AI cost); the progress tracker resets so it doesn't show stale steps.
      let data: any = null
      for (let attempt = 0; attempt < 2 && !data; attempt++) {
        if (attempt > 0) {
          await new Promise(r => setTimeout(r, 700))
          if (stylistSessionId.current !== originSession) return
          capturedPhases.length = 0
          setStylistLoadingPhases([])
        }
        try {
          const res = await fetch('/api/ai/stylist', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: requestBody,
          })
          // fetch does NOT reject on an HTTP error, so without this a 429/500
          // fell through as `data === null` and got retried — double-hitting the
          // rate limiter, or paying twice for a request whose AI work was already
          // done before the function died. Rate limits and server errors are not
          // the transient blip this retry is for; surface them instead.
          if (res.status === 429 || res.status >= 500) {
            data = { reply: res.status === 429
              ? "That was a lot of requests at once. Give it a few seconds and try again."
              : "Something went wrong on my end. Give it another go?" }
            break
          }
          data = await readStylistStream(res, onProgress)
        } catch (e) {
          if (attempt === 1) throw e // final attempt failed → outer catch shows the error
          console.warn('[stylist] transient request failure, retrying once:', e)
        }
      }
      // Show the reply the moment it's actually ready — reasoning time
      // genuinely varies by query and provider, so there's no fixed budget
      // to wait out anymore. Only guard against an instant flash for a
      // near-zero-latency response (a cached fast-path hit can resolve in
      // well under STYLIST_FLICKER_GUARD_MS).
      const elapsed = Date.now() - requestStartedAt
      if (elapsed < STYLIST_FLICKER_GUARD_MS) await new Promise(r => setTimeout(r, STYLIST_FLICKER_GUARD_MS - elapsed))
      // Bail if the user navigated to another conversation mid-flight.
      if (stylistSessionId.current !== originSession) return
      // Accept the response when it carries PRODUCTS even if the reply text came
      // back empty (a model whose whole output was just the [SEARCH:] token, with
      // the grounding rewrite timed out). Treating that as a failure threw away a
      // search that actually succeeded and showed "something went wrong" over a
      // full set of results. A tiny lead-in stands in for the missing prose.
      const hasAnyProducts = !!data && (
        (Array.isArray(data.foundProducts) && data.foundProducts.length > 0) ||
        (Array.isArray(data.foundProductGroups) && data.foundProductGroups.length > 0) ||
        (Array.isArray(data.outfitGroups) && data.outfitGroups.length > 0) ||
        (Array.isArray(data.outfitSlots) && data.outfitSlots.length > 0)
      )
      if (data && !data.reply && hasAnyProducts) data.reply = "Here's what I found for you."
      if (data?.reply) {
        // Let the step tracker dissolve out before the reply appears, instead
        // of an instant swap — a clean handoff, not a jump cut.
        setStylistDissolving(true)
        await new Promise(r => setTimeout(r, 130))
        // Normalize currency the same way the search path does: the product's
        // own `currency` (from the store feed) is its NATIVE/base currency, and
        // we display in the buyer's currency. Without this, stylist products
        // arrive with no base_currency and the detail view defaults the missing
        // base to USD — printing e.g. a ₹5,750 piece as "$5,750.00 · Live rate".
        const displayCur = shopperContext.currency || 'USD'
        const withCur = (p: any): Product => ({ ...p, base_currency: p.base_currency ?? p.currency ?? 'USD', currency: displayCur })
        const newProducts: Product[] = Array.isArray(data.foundProducts) && data.foundProducts.length > 0 ? dedupeById(data.foundProducts.map(withCur)) : []
        const foundProductGroups: FoundProductGroup[] | undefined = Array.isArray(data.foundProductGroups) && data.foundProductGroups.length > 0
          ? data.foundProductGroups.map((g: any) => ({ label: g.label, products: Array.isArray(g.products) ? dedupeById(g.products.map(withCur)) : [], query: typeof g.query === 'string' ? g.query : undefined })).filter((g: FoundProductGroup) => g.products.length > 0)
          : undefined
        const outfitSlots: OutfitSlot[] | undefined = Array.isArray(data.outfitSlots) && data.outfitSlots.length > 0
          ? data.outfitSlots.map((s: any) => ({ ...s, products: Array.isArray(s.products) ? s.products.map(withCur) : s.products }))
          : undefined
        // Multiple distinct looks ("create three outfits") — each its own carded group.
        const outfitGroups: OutfitGroup[] | undefined = Array.isArray(data.outfitGroups) && data.outfitGroups.length > 0
          ? data.outfitGroups.map((g: any) => ({ label: String(g.label || 'Outfit'), products: Array.isArray(g.products) ? dedupeById(g.products.map(withCur)) : [] })).filter((g: OutfitGroup) => g.products.length > 0)
          : undefined
        // Products Fabrics surfaces from a search/outfit live ONLY in the chat
        // message (foundProducts / outfitSlots below). The pinned strip at the
        // top is reserved exclusively for pieces the user attached themselves.
        const updatedMsgs = [...history, { role: 'user' as const, content: question }, { role: 'assistant' as const, content: data.reply }]
        // Snapshot the products this comparison was built from onto the message,
        // so an old comparison never re-renders against a later pinned set (the
        // ★ pick / pick card would otherwise point at the wrong product).
        const comparisonProducts = data.comparison ? products.slice() : undefined
        setStylistMsgs(prev => [...prev, { role: 'assistant', content: data.reply, comparison: data.comparison || undefined, comparisonProducts, foundProducts: newProducts.length > 0 ? newProducts : undefined, foundProductGroups, foundProductBatches: (!foundProductGroups && newProducts.length > 0) ? chunkIntoRows(newProducts.length) : undefined, outfitSlots, outfitGroups, busy: data.busy === true, searchQuery: typeof data.searchQuery === 'string' ? data.searchQuery : undefined, trace: capturedPhases.length > 0 ? capturedPhases : undefined,
          // The pieces this reply is ABOUT — the products the shopper pinned for
          // this turn. [PRODUCT:N] in the reply text is 0-indexed into exactly
          // this set (the server's "STORE PRODUCTS"), so the tappable card must
          // resolve against it, never the live global result strip.
          pinnedProducts: products.length > 0 ? products.slice(0, 8) : undefined }])
        // Total products actually surfaced — across the single strip, per-category
        // GROUPS (multi-garment searches), and outfit slots. Counting only
        // newProducts logged grouped/outfit searches as 0 results, which then
        // mis-flagged successful searches as "returned nothing" and poisoned the
        // learning loop.
        const surfacedCount = newProducts.length
          + (foundProductGroups?.reduce((n, g) => n + g.products.length, 0) ?? 0)
          + (outfitSlots?.reduce((n, s) => n + (s.products?.length ?? 0), 0) ?? 0)
          + (outfitGroups?.reduce((n, g) => n + g.products.length, 0) ?? 0)
        if (typeof data.searchQuery === 'string' && data.searchQuery.trim() && onboardEmail && authProof) {
          saveSearchHistoryMutation({ userEmail: onboardEmail, query: data.searchQuery.trim(), resultCount: surfacedCount, authProof }).catch(() => {})
        }
        // Analytics: record every search — anonymous ones too — so the admin
        // dashboard reflects total usage, not just signed-in shoppers. Attributed
        // to a user only when a verified email+proof is present; otherwise logged
        // anonymously. Fire-and-forget, never blocks the reply.
        if (typeof data.searchQuery === 'string' && data.searchQuery.trim()) {
          trackEventMutation({
            event: 'search',
            // `query` = the concept the AI searched on (for grouping top searches);
            // `raw` = the shopper's message VERBATIM, word for word, so the activity
            // feed shows exactly what they typed, not just "shirt".
            properties: { query: data.searchQuery.trim().slice(0, 120), raw: question.slice(0, 200), resultCount: surfacedCount },
            ...(onboardEmail && authProof ? { email: onboardEmail, authProof } : {}),
          }).catch(() => {})
        }
        // Learning loop — IMPRESSIONS. Every product Fabrics actually put in
        // front of the shopper is logged (compact id/title/vendor, capped), so
        // the nightly engagement cron can compare "shown" against "saved /
        // opened / flagged" and learn which pieces earn attention for a
        // concept and which are shown-but-ignored. Fire-and-forget.
        {
          const shown: { id: string; title: string; vendor?: string }[] = []
          const seen = new Set<string>()
          const collect = (p: any) => {
            if (!p || !p.id || seen.has(p.id) || shown.length >= 8) return
            seen.add(p.id)
            shown.push({ id: String(p.id), title: String(p.title ?? '').slice(0, 70), vendor: p.vendor ? String(p.vendor).slice(0, 60) : undefined })
          }
          newProducts.forEach(collect)
          foundProductGroups?.forEach(g => g.products.forEach(collect))
          outfitSlots?.forEach(s => (s.products || []).forEach(collect))
          outfitGroups?.forEach(g => g.products.forEach(collect))
          if (shown.length > 0) {
            trackEventMutation({
              event: 'impression',
              properties: { query: typeof data.searchQuery === 'string' ? data.searchQuery.trim().slice(0, 120) : undefined, products: shown },
              ...(onboardEmail && authProof ? { email: onboardEmail, authProof } : {}),
            }).catch(() => {})
          }
        }
        // Background memory compression — non-blocking, premium users only
        if (isPremium && onboardEmail && updatedMsgs.length >= 4) {
          fetch('/api/ai/stylist-memory', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: updatedMsgs }),
          }).catch(() => {})
        }
      } else {
        setStylistMsgs(prev => [...prev, { role: 'assistant', content: "Something went wrong. Try again?" }])
      }
    } catch (err) {
      // Was silently swallowed — logging it is the only way a future report
      // like "it broke after a few searches" is diagnosable at all, since
      // this fires on a network failure or unparseable response, not on any
      // path the server's own graceful-degradation JSON replies go through.
      console.error('[stylist] request failed:', err)
      setStylistMsgs(prev => [...prev, { role: 'assistant', content: 'Something went wrong reaching Fabrics. Give it another go in a moment.' }])
    } finally {
      // Only the request belonging to the CURRENTLY open conversation may clear
      // the loading state. A stale request finishing after the user started a new
      // chat would otherwise kill the new request's step tracker and re-enable
      // the composer mid-flight, allowing a concurrent double-send.
      if (stylistSessionId.current === originSession) {
        setStylistLoading(false)
        setStylistDissolving(false)
      }
    }
  }
  // Pin products and ask about them — continues the one ongoing conversation
  // (or starts it, if this is the first message of the session).
  const openStylistWith = (products: Product[], query: string) => {
    // Don't persist into a lingering pinned strip — the products attach to THIS
    // query's message (see sendStylist) and show inline with it. Persisting made
    // them hang around "still pinned" after the answer, which read as a bug.
    sendStylist(query, products)
  }

  // ── Edit a sent message ───────────────────────────────────────────────────
  // Text is freely editable; attached photos can only be removed, never
  // added, during an edit — attaching something new is a fresh message.
  function startEditMsg(i: number, m: StylistMsg) {
    if (stylistLoading) return
    setEditingMsgIndex(i)
    setEditText(m.content)
    setEditImages(m.images || [])
  }
  function cancelEditMsg() {
    setEditingMsgIndex(null)
  }
  function saveEditMsg(i: number) {
    const text = editText.trim()
    if (!text && editImages.length === 0) return
    // Carry the message's own pinned products through the edit-resend, not a
    // persistent global pin (which no longer exists).
    const origPins = stylistMsgs[i]?.pinnedProducts
    const truncated = stylistMsgs.slice(0, i)
    setStylistMsgs(truncated)
    setEditingMsgIndex(null)
    sendStylist(text, origPins, truncated, editImages.map(url => ({ url })))
  }

  // "See more" re-runs the same reasoned search (BM25 + LLM judge, mode:
  // 'load-more' in stylist/route.ts) excluding what's already shown, and
  // appends the next best-of-best batch — same reasoning pipeline as a
  // fresh query, not a raw pagination dump. Drives the small icon+label row
  // (loadMorePhases, real backend events) in place of the button while it runs.
  const loadMoreStylistProducts = async (messageIndex: number) => {
    const msg = stylistMsgs[messageIndex]
    if (!msg || !msg.searchQuery || msg.loadingMore || msg.hasNoMore) return
    // messageIndex is only meaningful within the session that's open now — bail
    // on the result if the user switched, or we'd graft the products onto the
    // message at that index in a DIFFERENT conversation.
    const originSession = stylistSessionId.current
    setStylistMsgs(prev => prev.map((m, i) => i === messageIndex ? { ...m, loadingMore: true } : m))
    setLoadMorePhases([])
    const startedAt = Date.now()
    try {
      const excludeIds = (msg.foundProducts || []).map(p => p.id)
      const res = await fetch('/api/ai/stylist', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'load-more', query: msg.searchQuery, excludeIds,
          buyerCurrency: shopperContext.currency, buyerCountry: shopperContext.country,
        }),
      })
      const data = await readStylistStream(res, (icon, main, detail) => {
        setLoadMorePhases(prev => [...prev, { icon: icon as StylistLoadingIcon, main, trace: detail ? [detail] : [] }])
      })
      // Same small flicker guard as a fresh search — never hold longer than
      // the request actually took, just avoid an instant in-and-out flash.
      const elapsed = Date.now() - startedAt
      if (elapsed < STYLIST_FLICKER_GUARD_MS) await new Promise(r => setTimeout(r, STYLIST_FLICKER_GUARD_MS - elapsed))
      if (stylistSessionId.current !== originSession) return
      const displayCur = shopperContext.currency || 'USD'
      const withCur = (p: any): Product => ({ ...p, base_currency: p.base_currency ?? p.currency ?? 'USD', currency: displayCur })
      const fresh: Product[] = Array.isArray(data?.foundProducts) ? dedupeById(data.foundProducts.map(withCur)) : []
      setStylistMsgs(prev => prev.map((m, i) => {
        if (i !== messageIndex) return m
        const existingIds = new Set((m.foundProducts || []).map(p => p.id))
        const uniqueNew = fresh.filter(p => !existingIds.has(p.id))
        return {
          ...m,
          foundProducts: [...(m.foundProducts || []), ...uniqueNew],
          foundProductBatches: uniqueNew.length > 0 ? [...(m.foundProductBatches || []), ...chunkIntoRows(uniqueNew.length)] : m.foundProductBatches,
          // A transient backend failure (loadMoreError) is not exhaustion —
          // keep the button so the shopper can simply try again.
          // A null `data` (stream/HTTP error with no result line) is a FAILURE,
          // not exhaustion — require a real result before hiding "See more", so
          // a transient 5xx doesn't permanently remove the button.
          loadingMore: false, hasNoMore: !!data && !data.loadMoreError && uniqueNew.length === 0,
        }
      }))
    } catch {
      if (stylistSessionId.current === originSession) setStylistMsgs(prev => prev.map((m, i) => i === messageIndex ? { ...m, loadingMore: false } : m))
    }
  }

  // Same "See more" mechanic as loadMoreStylistProducts, scoped to one
  // category strip of a multi-category reply (e.g. "shirts and shorts" —
  // the Tops strip and the Bottoms strip each get their own reasoned
  // "See more" using that group's own category-scoped query, not the
  // flat foundProducts field those messages don't have).
  const loadMoreGroupProducts = async (messageIndex: number, groupIndex: number) => {
    const msg = stylistMsgs[messageIndex]
    const group = msg?.foundProductGroups?.[groupIndex]
    if (!group || !group.query || group.loadingMore || group.hasNoMore) return
    const originSession = stylistSessionId.current
    setStylistMsgs(prev => prev.map((m, i) => {
      if (i !== messageIndex || !m.foundProductGroups) return m
      return { ...m, foundProductGroups: m.foundProductGroups.map((g, gi) => gi === groupIndex ? { ...g, loadingMore: true } : g) }
    }))
    setLoadMorePhases([])
    const startedAt = Date.now()
    try {
      const excludeIds = group.products.map(p => p.id)
      const res = await fetch('/api/ai/stylist', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'load-more', query: group.query, excludeIds,
          buyerCurrency: shopperContext.currency, buyerCountry: shopperContext.country,
        }),
      })
      const data = await readStylistStream(res, (icon, main, detail) => {
        setLoadMorePhases(prev => [...prev, { icon: icon as StylistLoadingIcon, main, trace: detail ? [detail] : [] }])
      })
      const elapsed = Date.now() - startedAt
      if (elapsed < STYLIST_FLICKER_GUARD_MS) await new Promise(r => setTimeout(r, STYLIST_FLICKER_GUARD_MS - elapsed))
      if (stylistSessionId.current !== originSession) return
      const displayCur = shopperContext.currency || 'USD'
      const withCur = (p: any): Product => ({ ...p, base_currency: p.base_currency ?? p.currency ?? 'USD', currency: displayCur })
      const fresh: Product[] = Array.isArray(data?.foundProducts) ? dedupeById(data.foundProducts.map(withCur)) : []
      setStylistMsgs(prev => prev.map((m, i) => {
        if (i !== messageIndex || !m.foundProductGroups) return m
        return {
          ...m,
          foundProductGroups: m.foundProductGroups.map((g, gi) => {
            if (gi !== groupIndex) return g
            const existingIds = new Set(g.products.map(p => p.id))
            const uniqueNew = fresh.filter(p => !existingIds.has(p.id))
            // Each "See more" lands as its own NEW slide/row in this category —
            // append the fresh batch's size to `batches` (seeding it from the
            // initial fetch first), never fold it back into the first row.
            const batches = uniqueNew.length > 0
              ? [...(g.batches && g.batches.length > 0 ? g.batches : [g.products.length]), uniqueNew.length]
              : g.batches
            // Same rule as the flat list: a failed fetch keeps the button.
            return { ...g, products: [...g.products, ...uniqueNew], batches, loadingMore: false, hasNoMore: !!data && !data.loadMoreError && uniqueNew.length === 0 }
          }),
        }
      }))
    } catch {
      if (stylistSessionId.current !== originSession) return
      setStylistMsgs(prev => prev.map((m, i) => {
        if (i !== messageIndex || !m.foundProductGroups) return m
        return { ...m, foundProductGroups: m.foundProductGroups.map((g, gi) => gi === groupIndex ? { ...g, loadingMore: false } : g) }
      }))
    }
  }

  // Shared "Found for you" product card — used both by the flat single-search
  // strip and by each labeled group when a request spans multiple categories
  // (foundProductGroups). Identical markup either way, so the two render
  // paths never visually drift apart.
  function renderFoundProductCard(p: Product, saveQuery?: string) {
    const { colors: pc } = displaySwatches(p)
    const isSaved = savedIds.has(p.id)
    return (
      <div key={p.id} onClick={() => { if (productWasLong.current) { productWasLong.current = false; return }; setSelected(p) }}
        {...makePressHandlers((x, y) => {
          productWasLong.current = true
          const menuW = 200; const menuH = 160
          const above = y + 8 + menuH > window.innerHeight
          const my = Math.max(8, above ? y - menuH - 4 : y + 8)
          const mx = Math.max(8, Math.min(x, window.innerWidth - menuW - 8))
          ctxMenuOpenAt.current = Date.now()
          setProductCtxMenu({ product: p, x: mx, y: my, above })
        })}
        className="fr-pcard"
        style={{ flexShrink: 0, width: 118, cursor: 'pointer', WebkitTouchCallout: 'none', WebkitUserSelect: 'none' } as React.CSSProperties}>
        <div className="fr-pcard-imgwrap" style={{ width: 118, height: 189, borderRadius: 13, overflow: 'hidden', background: BG2, position: 'relative' }}>
          {getProductImages(p)[0] && <img className="fr-pcard-img" src={getProductImages(p)[0]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
          <button type="button" aria-label={isSaved ? 'In your bag' : 'Add to bag'}
            onClick={e => { e.stopPropagation(); toggleSaved(p, saveQuery) }}
            style={{ position: 'absolute', top: 6, right: 6, width: 26, height: 26, borderRadius: '50%', border: 'none',
              background: 'rgba(255,255,255,.92)', boxShadow: '0 1px 4px rgba(0,0,0,.18)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, color: INK }}>
            {/* Same bag glyph as the detail sheet's "Bag it" button (outline when
                not saved, filled when saved) — a "+" here read as ambiguous
                (add to list? follow?) where a bag icon reads as exactly what
                the action does, and matches the app's own "Bag it" language. */}
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" fill={isSaved ? 'currentColor' : 'none'} />
              <line x1="3" y1="6" x2="21" y2="6" stroke={isSaved ? '#fff' : 'currentColor'} />
              <path d="M16 10a4 4 0 0 1-8 0" stroke={isSaved ? '#fff' : 'currentColor'} />
            </svg>
          </button>
        </div>
        <div style={{ fontFamily: SANS, fontSize: 12.5, fontWeight: 500, letterSpacing: '-0.01em', color: INK, marginTop: 8, lineHeight: 1.25, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', whiteSpace: 'normal' } as React.CSSProperties}>{p.title}</div>
        <div style={{ fontFamily: SANS, fontSize: 11.5, color: INK3, marginTop: 2, fontVariantNumeric: 'tabular-nums', letterSpacing: '0.01em' }}>{formatMoney(p.price, p.currency, p.base_currency, liveRates)}</div>
        {pc.length > 0 && (
          <div style={{ display: 'flex', gap: 4, marginTop: 5, flexWrap: 'wrap' }}>
            {pc.slice(0, 5).map(c => (
              <ColorSwatch key={c} name={c} imageUrl={getColorVariantImages(p, c)[0] ?? getProductImages(p)[0]} size={10} shape="square" selected={false} available={true} />
            ))}
          </div>
        )}
      </div>
    )
  }

  // Glass interaction states
  const [barPressed, setBarPressed]   = useState(false)
  const [sendPressed, setSendPressed] = useState(false)
  const barRef      = useRef<HTMLDivElement>(null)

  // Spring values
  const barScale  = useSpring(barPressed  ? 0.982 : 1, 260, 28)
  const sendScale = useSpring(sendPressed ? 0.84  : 1, 380, 24)

  // Specular light position tracking
  const light = useLight(barRef)

  const nameRef       = useRef<HTMLInputElement>(null)
  const taRef         = useRef<HTMLTextAreaElement>(null)
  const dragHandleRef = useRef<HTMLDivElement>(null)
  const similarRef    = useRef<HTMLDivElement>(null)

  // Image carousel horizontal swipe
  const [imgDX, setImgDX]   = useState(0)
  const imgStartX = useRef(0)
  const imgStartY = useRef(0)
  const imgActive = useRef(false)
  const imgLockH  = useRef<null | boolean>(null)
  // Trackpad / mouse-wheel horizontal swipe for the desktop-and-tablet image
  // carousel. A two-finger horizontal trackpad gesture arrives as a stream of
  // wheel events with a dominant deltaX; we ACCUMULATE distance and step once
  // per ~threshold of travel, with a short cooldown between steps and an
  // idle-reset for a fresh gesture. This replaces the old "lock until idle"
  // model, whose idle timer was reset by every event — trackpad momentum kept
  // firing events after the fingers lifted, so the lock never released between
  // quick swipes and rapid/continuous swiping felt stuck.
  const imgWheelRef  = useRef<HTMLDivElement>(null)
  const wheelLastEv  = useRef(0)     // timestamp of the previous horizontal wheel event
  const sheetImgCount = useRef(0)
  const dragStartY    = useRef(0)
  const dragStartSnap = useRef<'full'|'half'>('full')
  const dragVel       = useRef(0)
  const dragLastY     = useRef(0)
  const dragLastT     = useRef(0)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wasLongPress   = useRef(false)
  const productWasLong = useRef(false)
  // Timestamp when a context menu last opened. The finger-lift after a long-press
  // fires a synthetic click on mobile — we ignore backdrop clicks within 500ms of
  // opening so the menu doesn't vanish the instant it appears.
  const ctxMenuOpenAt  = useRef(0)
  // Pointer-based long-press for product cards and bag items.
  // onContextMenu doesn't fire inside scrollable containers on iOS Safari,
  // so we use a 500ms timer started on pointerdown instead.
  const pressTimer  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pressStartX = useRef(0)
  const pressStartY = useRef(0)

  function cancelPressTimer() {
    if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null }
  }

  // Shared handlers for any card that should show a long-press menu.
  //
  // Uses touch events (not pointer events) for mobile because iOS Safari can
  // cancel pointer events inside scroll containers before 500ms, killing the
  // timer prematurely. Touch events are not cancelled for stationary holds.
  // Desktop right-click is handled separately via onContextMenu.
  function makePressHandlers(onLongPress: (x: number, y: number) => void) {
    return {
      // Desktop right-click — fire immediately, no timer needed.
      onContextMenu: (e: React.MouseEvent) => {
        e.preventDefault()
        if ((e as any).pointerType !== 'touch') {
          cancelPressTimer()
          onLongPress(e.clientX, e.clientY)
        }
      },
      // Touch long-press (iOS / Android / iPad).
      onTouchStart: (e: React.TouchEvent) => {
        const t = e.touches[0]
        if (!t) return
        pressStartX.current = t.clientX
        pressStartY.current = t.clientY
        cancelPressTimer()
        pressTimer.current = setTimeout(() => {
          pressTimer.current = null
          onLongPress(pressStartX.current, pressStartY.current)
        }, 500)
      },
      onTouchMove: (e: React.TouchEvent) => {
        if (!pressTimer.current) return
        const t = e.touches[0]
        if (!t) return
        const dx = t.clientX - pressStartX.current
        const dy = t.clientY - pressStartY.current
        // >10px movement means the user is scrolling — cancel the timer.
        if (dx * dx + dy * dy > 100) cancelPressTimer()
      },
      onTouchEnd:    () => cancelPressTimer(),
      onTouchCancel: () => cancelPressTimer(),
    }
  }

  // The home page IS the Fabrics conversation — one thread, no separate grid search.
  const hasConversation = stylistMsgs.length > 0
  // Most recent product results shown, for the Explore-cache persist effect and
  // the "similar items" panel on the product detail sheet.
  const lastProductMsg = [...stylistMsgs].reverse().find(m => m.role === 'assistant' && (m.foundProducts?.length || m.outfitSlots?.length))
  // Memoized on lastProductMsg (referentially stable across renders that don't
  // touch stylistMsgs) — a fresh array here on every render would make the
  // Explore-cache effect below re-fire and re-set state every render, an
  // infinite loop whenever showExplore and a product result are true together.
  const searchProducts: Product[] = useMemo(
    () => (lastProductMsg?.foundProducts || []).filter((p: Product) => p.in_stock),
    [lastProductMsg]
  )
  const canSend   = input.trim().length > 0 || wardrobeImages.length > 0 || barProducts.length > 0
  const hasName   = userName.length > 0

  // Fetch live exchange rates on mount — server caches for 1 h so this is cheap
  useEffect(() => {
    fetch('/api/rates')
      .then(r => r.ok ? r.json() : null)
      .then(fresh => { if (fresh && typeof fresh === 'object') setLiveRates(fresh) })
      .catch(() => {})
  }, [])

  useEffect(() => { setTimeout(() => setLoaded(true), 60) }, [])
  useEffect(() => {
    const check = () => {
      setIsWide(window.innerWidth >= 768)
      setIsMedium(window.innerWidth >= 768)
      setWindowWidth(window.innerWidth)
    }
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // Track keyboard height via visualViewport so the search bar and stylist
  // sheet always sit above the on-screen keyboard on iOS / Android.
  useEffect(() => {
    const vv = (window as any).visualViewport
    if (!vv) return
    const check = () => {
      const kbH = window.innerHeight - vv.height - vv.offsetTop
      setKeyboardOffset(kbH > 150 ? Math.round(kbH) : 0)
    }
    // focusout fires when the keyboard dismisses (any input/textarea loses focus).
    // visualViewport resize doesn't always fire on iPad after keyboard close,
    // so this is the reliable fallback reset.
    const onFocusOut = () => setTimeout(check, 150)
    vv.addEventListener('resize', check)
    vv.addEventListener('scroll', check)
    document.addEventListener('focusout', onFocusOut)
    return () => {
      vv.removeEventListener('resize', check)
      vv.removeEventListener('scroll', check)
      document.removeEventListener('focusout', onFocusOut)
    }
  }, [])

  // Block native browser context menu (image long-press sheet in Chrome/Brave/Firefox)
  // for any touch on a product card. Must be a native listener so it fires before
  // the browser decides to show its own menu.
  useEffect(() => {
    const block = (e: MouseEvent) => {
      if ((e.target as Element | null)?.closest('.fr-cell')) e.preventDefault()
    }
    document.addEventListener('contextmenu', block)
    return () => document.removeEventListener('contextmenu', block)
  }, [])

  // Rotating greeting tagline — changes every 13s, no repeats until all 12,000+
  // have cycled. Only runs while the home greeting is visible.
  const homeVisible = !hasConversation && !showExplore
  useEffect(() => {
    if (!homeVisible) return
    const order = shuffledIndices(TAGLINES.length)
    tagOrderRef.current = order
    let pos = 0
    // Immediately show a random tagline so every page load feels fresh
    setTagText(TAGLINES[order[pos]])
    const id = window.setInterval(() => {
      setTagVis(false)
      // 350ms > the 300ms linear fade-out — ensures old text is fully gone
      // before the new line appears, eliminating any visual overlap.
      window.setTimeout(() => {
        pos = (pos + 1) % order.length
        setTagText(TAGLINES[order[pos]])
        setTagVis(true)
      }, 350)
    }, 13000)
    return () => window.clearInterval(id)
  }, [homeVisible])

  // Prevent pull-to-refresh when dragging the sheet handle.
  // React touch listeners are passive by default, so we must attach directly.
  useEffect(() => {
    const el = dragHandleRef.current
    if (!el) return
    const block = (e: TouchEvent) => e.preventDefault()
    el.addEventListener('touchstart', block, { passive: false })
    el.addEventListener('touchmove',  block, { passive: false })
    return () => { el.removeEventListener('touchstart', block); el.removeEventListener('touchmove', block) }
  }, [])

  // Persist explore results so they survive page refresh
  useEffect(() => {
    if (showExplore && searchProducts.length > 0) {
      const toSave = searchProducts.filter(p => p.in_stock).slice(0, 20)
      setExploreCache(toSave)
      try { localStorage.setItem('discern:explore', JSON.stringify(toSave)) } catch {}
    }
  }, [showExplore, searchProducts])

  useEffect(() => { if (isEditingName && nameRef.current) { nameRef.current.focus(); nameRef.current.select() } }, [isEditingName])
  useEffect(() => { if (stylistRenameId && stylistRenameRef.current) { stylistRenameRef.current.focus(); stylistRenameRef.current.select() } }, [stylistRenameId])
  // Follow the growing reply/steps to the bottom — but only when the user is
  // already near the bottom, so we never yank them away mid-scroll while they
  // read earlier messages.
  const stickStylistToBottom = useCallback(() => {
    const el = stylistScrollRef.current
    if (!el) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 240) el.scrollTop = el.scrollHeight
  }, [])
  // Keep the stylist conversation scrolled to the latest activity — not just
  // new messages, but every step the tracker advances through and every
  // trace line it reveals, so the growing step list never runs on ahead of
  // what's actually visible on screen.
  useEffect(() => {
    const el = stylistScrollRef.current
    if (!el) return
    const toBottom = () => { el.scrollTop = el.scrollHeight }
    toBottom()
    // Re-run after layout paints — during streaming the content height keeps
    // growing and the reply→dissolve handoff shifts the layout AFTER the first
    // scroll fired, which left the newest message stranded under the floating
    // search bar. A post-paint pass (and one more a beat later, to cover the
    // ~220ms dissolve) guarantees the latest message settles fully in view.
    const raf = requestAnimationFrame(toBottom)
    const t = setTimeout(toBottom, 260)
    return () => { cancelAnimationFrame(raf); clearTimeout(t) }
  }, [stylistMsgs, stylistLoading, stylistLoadingPhases, stylistDissolving])

  // Restore the session ID that was actually active, matching stylistMsgs'
  // own restore logic above — not just "always the most recent one".
  useEffect(() => {
    if (stylistSessionId.current) return
    try {
      const activeId = localStorage.getItem(STYLIST_ACTIVE_SESSION_LS)
      if (activeId === '') return // fresh/new chat — stays null
      if (activeId) { stylistSessionId.current = activeId; return }
      if (activeId === null && stylistHistory.length > 0) {
        stylistSessionId.current = stylistHistory[0].id
      }
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Persist sidebar history list whenever it changes
  useEffect(() => {
    try { localStorage.setItem(STYLIST_HISTORY_LS, JSON.stringify(stylistHistory)) } catch {}
  }, [stylistHistory])

  // Persist the current session's full messages — including found products,
  // outfit slots, and comparisons — so refreshing or reopening from history
  // doesn't lose the actual results, only the text. Only the ACTIVE session
  // is written here (others are loaded on demand from history), so this
  // stays well within localStorage's quota even with a few dozen products.
  useEffect(() => {
    const id = stylistSessionId.current
    if (!id || stylistMsgs.length === 0) return
    let toSync = stylistMsgs
    try {
      localStorage.setItem(stylistSessionLS(id), JSON.stringify(stylistMsgs))
    } catch {
      // Quota exceeded (rare — a very long session with many searches) —
      // fall back to text-only so the conversation itself still survives.
      try {
        const slim = stylistMsgs.map(m => ({ role: m.role, content: m.content }))
        localStorage.setItem(stylistSessionLS(id), JSON.stringify(slim))
        toSync = slim as StylistMsg[]
      } catch {}
    }
    // Push to Convex so the same account sees this session on another
    // device — fire-and-forget, never blocks the local (already-persisted)
    // experience if the write fails or the shopper isn't signed in.
    //
    // DEBOUNCED + SLIMMED, because this was the single largest consumer of the
    // Convex I/O budget. It fired on EVERY stylistMsgs change (each message,
    // each "See more", each product load) and pushed the whole conversation
    // including base64 photo data URLs — and because the sidebar's session list
    // is a REACTIVE query, every one of those writes made it re-read all of this
    // account's session documents in full. Small edit, enormous amplification.
    if (onboardEmail && authProof) {
      const label = stylistHistory.find(h => h.id === id)?.label || toSync[0]?.content?.slice(0, 80) || 'Conversation'
      // Drop the two fields that dominate the payload and that a cross-device
      // restore doesn't need: base64 images (megabytes each) and the reasoning
      // trace. Everything that makes a restored conversation useful — text,
      // products, outfits, comparisons — is kept. localStorage still holds the
      // full fidelity copy for this device.
      const forSync = toSync.map(m => {
        const { images, trace, ...rest } = m as StylistMsg
        return rest
      })
      const payload = JSON.stringify(forSync)
      if (sessionSyncTimer.current) clearTimeout(sessionSyncTimer.current)
      sessionSyncTimer.current = setTimeout(() => {
        // Skip a re-push of byte-identical content (React can re-run this effect
        // for unrelated state changes; an identical write still costs a write
        // AND a full reactive re-read of every session).
        if (sessionSyncLast.current === payload) return
        sessionSyncLast.current = payload
        syncStylistSession({ userEmail: onboardEmail, sessionId: id, label, messages: payload, authProof }).catch(() => {})
      }, 4000)
    }
  }, [stylistMsgs, authProof])

  // Two-way cross-device sync for the history list. Pull side: backfill any
  // session Convex has for this account that this device doesn't have
  // locally yet — e.g. signing into the same account on a new phone. Prune
  // side: if a session this device previously confirmed existed on the
  // server (everSeenRemoteIds) has since disappeared from the live list —
  // deleted from this device or another one — drop it here too, so a
  // deletion actually shows up everywhere instead of only on the device
  // that made it. A session is only prune-eligible after being independently
  // confirmed present at least once remotely, so a conversation that was
  // just created here and hasn't round-tripped through Convex's live query
  // yet can never be mistaken for a deletion.
  const mergedRemoteSessionIds = useRef<Set<string>>(new Set())
  const everSeenRemoteIds = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!remoteStylistSessions) return // still loading — don't touch anything yet
    const remoteIds = new Set(remoteStylistSessions.map(r => r.sessionId))
    remoteIds.forEach(id => everSeenRemoteIds.current.add(id))

    const missing = remoteStylistSessions.filter(r =>
      !mergedRemoteSessionIds.current.has(r.sessionId) && !stylistHistory.some(h => h.id === r.sessionId)
    )
    const toRemove = stylistHistory.filter(h => everSeenRemoteIds.current.has(h.id) && !remoteIds.has(h.id))
    if (missing.length === 0 && toRemove.length === 0) return

    missing.forEach(r => {
      mergedRemoteSessionIds.current.add(r.sessionId)
      try { localStorage.setItem(stylistSessionLS(r.sessionId), r.messages) } catch {}
    })
    if (toRemove.length > 0) {
      toRemove.forEach(h => { try { localStorage.removeItem(stylistSessionLS(h.id)) } catch {} })
      if (toRemove.some(h => h.id === stylistSessionId.current)) {
        setStylistMsgs([])
        stylistSessionId.current = null
      }
    }

    setStylistHistory(prev => {
      const removeIds = new Set(toRemove.map(h => h.id))
      const kept = prev.filter(h => !removeIds.has(h.id))
      const additions = missing.map(r => ({ id: r.sessionId, label: r.label, createdAt: r.createdAt }))
      return [...kept, ...additions].sort((a, b) => b.createdAt - a.createdAt).slice(0, 30)
    })
  }, [remoteStylistSessions, stylistHistory])

  // One-time upload of conversations created on THIS device while logged out.
  // They live only in localStorage until now; push any the account doesn't
  // already have so history migrates to the account and reaches every other
  // device on the same email. Only local-only sessions are pushed (never ones
  // the server already lists), so this can't fight the prune/merge above.
  const reconciledSessionsOnLogin = useRef(false)
  useEffect(() => {
    if (!onboardEmail || !authProof || !remoteStylistSessions || reconciledSessionsOnLogin.current) return
    reconciledSessionsOnLogin.current = true
    const remoteIds = new Set(remoteStylistSessions.map(r => r.sessionId))
    for (const h of stylistHistory) {
      if (remoteIds.has(h.id) || everSeenRemoteIds.current.has(h.id)) continue
      let raw: string | null = null
      try { raw = localStorage.getItem(stylistSessionLS(h.id)) } catch {}
      if (raw && raw !== '[]') {
        syncStylistSession({ userEmail: onboardEmail, sessionId: h.id, label: h.label, messages: raw, authProof }).catch(() => {})
      }
    }
  }, [onboardEmail, authProof, remoteStylistSessions])

  useEffect(() => { if (selectedProduct) { setSize(null); setColor(null); setActiveImg(0); setSheetY(0); setSheetSnap('full'); setSizeGuideOpen(false); setSgTableIdx(0); setSgGroupIdx(0); setCleanDesc(null); setShippingInfo(null); setFetchedProductImages([]); setFetchedColorImages({}); setFetchedColors([]) } }, [selectedProduct])
  // When the shopper picks a colour in the drawer, jump the gallery back to the
  // first image of that colourway.
  useEffect(() => { setActiveImg(0) }, [selectedColor])

  // Learning loop — PRODUCT VIEWS. Opening a product detail is a strong
  // interest signal (stronger than an impression, weaker than a save). Logged
  // once per distinct product opened, attributed when signed in. Keyed on the
  // product id so navigating between products records each as its own view but
  // a re-render of the same open sheet doesn't double-count. Fire-and-forget.
  const lastViewLogged = useRef<string | null>(null)
  useEffect(() => {
    const p = selectedProduct as any
    // Reset on close so a genuine re-open of the SAME product later still logs
    // a fresh view (we only dedupe re-renders while the sheet stays open).
    if (!p || !p.id) { lastViewLogged.current = null; return }
    const id = String(p.id)
    if (lastViewLogged.current === id) return
    lastViewLogged.current = id
    trackEventMutation({
      event: 'product_view',
      properties: { productId: id, title: String(p.title ?? '').slice(0, 70), vendor: p.vendor ? String(p.vendor).slice(0, 60) : undefined },
      ...(onboardEmail && authProof ? { email: onboardEmail, authProof } : {}),
    }).catch(() => {})
  }, [selectedProduct, onboardEmail, authProof, trackEventMutation])
  useEffect(() => {
    if (taRef.current) {
      taRef.current.style.height = "auto"
      taRef.current.style.height = Math.min(taRef.current.scrollHeight, 120) + "px"
    }
  }, [input])


  const onHandleDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture(e.pointerId)
    const halfY = window.innerHeight * 0.44
    dragStartY.current  = e.clientY - (sheetSnap === 'half' ? halfY : 0)
    dragStartSnap.current = sheetSnap
    dragLastY.current = e.clientY
    dragLastT.current = Date.now()
    dragVel.current = 0
    setIsDragging(true)
  }
  const onHandleMove = (e: React.PointerEvent) => {
    if (!isDragging) return
    const now = Date.now(); const dt = now - dragLastT.current
    if (dt > 0) dragVel.current = (e.clientY - dragLastY.current) / dt
    dragLastY.current = e.clientY; dragLastT.current = now
    setSheetY(Math.max(0, e.clientY - dragStartY.current))
  }
  const onHandleUp = () => {
    if (!isDragging) return; setIsDragging(false)
    const vh = window.innerHeight
    const halfY = vh * 0.44
    const vel = dragVel.current        // px/ms, positive = downward
    const fastDown = vel > 0.5
    const fastUp   = vel < -0.5

    if (dragStartSnap.current === 'full') {
      // from full: fast flick or dragged past 20% → go half; even further or second flick → close
      if (fastDown || sheetY > vh * 0.55) { setSelected(null); setSheetY(0) }
      else if (sheetY > vh * 0.18)        { setSheetSnap('half'); setSheetY(halfY) }
      else                                { setSheetSnap('full'); setSheetY(0) }
    } else {
      // from half: flick/drag down → close, flick/drag up → full
      if (fastDown || sheetY > vh * 0.65) { setSelected(null); setSheetY(0) }
      else if (fastUp || sheetY < vh * 0.25){ setSheetSnap('full'); setSheetY(0) }
      else                                  { setSheetSnap('half'); setSheetY(halfY) }
    }
  }

  // ── Image carousel swipe (horizontal) ──
  const onImgDown = (e: React.PointerEvent) => {
    imgStartX.current = e.clientX
    imgStartY.current = e.clientY
    imgActive.current = true
    imgLockH.current = null
    setImgDX(0)
  }
  const onImgMove = (e: React.PointerEvent, count: number) => {
    if (!imgActive.current) return
    const dx = e.clientX - imgStartX.current
    const dy = e.clientY - imgStartY.current
    if (imgLockH.current === null) {
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
        imgLockH.current = Math.abs(dx) > Math.abs(dy)
        if (imgLockH.current) { try { (e.currentTarget as Element).setPointerCapture(e.pointerId) } catch {} }
      }
    }
    if (imgLockH.current) {
      let d = dx
      // rubber-band resistance at the ends
      if ((activeImg === 0 && d > 0) || (activeImg >= count - 1 && d < 0)) d *= 0.35
      setImgDX(d)
    }
  }
  const onImgUp = (count: number) => {
    if (!imgActive.current) return
    imgActive.current = false
    if (imgLockH.current) {
      const threshold = 48
      if (imgDX < -threshold && activeImg < count - 1) setActiveImg(activeImg + 1)
      else if (imgDX > threshold && activeImg > 0)     setActiveImg(activeImg - 1)
    }
    imgLockH.current = null
    setImgDX(0)
  }

  const doSearch = async () => {
    if (!canSend || loading) return
    // Products attached → take the query to the stylist page instead of searching.
    if (barProducts.length > 0) {
      const q = input.trim() || (barProducts.length > 1 ? 'Compare these for me' : 'Tell me about this piece')
      openStylistWith(barProducts, q)
      setBarProducts([]); setInput(''); setInputHint(null)
      return
    }

    // Visual search: photos go straight into Fabrics' own vision flow — one
    // model call that reasons about the photo directly, instead of the old
    // two-call round-trip (describe the photo as text, then search on that).
    // Attached as a one-shot image on THIS message (shows in the sent bubble,
    // same as any photo attach) and cleared from the bar right after — it
    // used to persist silently forever, which both looked stuck/broken (the
    // thumbnail never left the input bar) and meant every later, unrelated
    // message kept re-sending the same photo through the vision model.
    if (wardrobeImages.length > 0) {
      const text = input.trim()
      setShowExplore(false); setActiveBrand(null)
      sendStylist(text, undefined, undefined, wardrobeImages)
      setWardrobeImages([])
      setInput(''); setInputHint(null)
      return
    }

    const q = input.trim(); if (!q) return
    setShowExplore(false); setActiveBrand(null)
    sendStylist(q); setInput(''); setInputHint(null)
  }
  const saveName = () => {
    const n = nameInput.trim()
    setUserName(n)
    try { localStorage.setItem('discern_user_name', n) } catch { /* private mode / quota */ }
    setIsEditing(false)
  }
  // Enter sends (like every chat app); Shift+Enter drops to a new line.
  const kd = (e: React.KeyboardEvent) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSearch() } }
  const handleReset = () => {
    setStylistMsgs([]); setStylistProducts([]); setWardrobeImages([])
    stylistSessionId.current = null
    // Mark "fresh chat" explicitly so a refresh doesn't silently snap back
    // to whatever session was last active.
    try { localStorage.setItem(STYLIST_ACTIVE_SESSION_LS, '') } catch {}
    setInput(''); setInputHint(null); setActiveBrand(null)
  }

  // Keep a ref mirror of the feed so the infinite-scroll loader can dedupe
  // without re-subscribing the observer on every append.
  useEffect(() => { exploreFeedRef.current = exploreFeed }, [exploreFeed])

  // Fetch one page of the Explore feed (geo-aware, category-diversified via
  // /api/featured). `page` rotates the brand window so each scroll pulls new
  // brands; `excludeIds` avoids repeats. Normalised to the buyer's currency.
  const explorePageRef = useRef(0)
  const fetchExploreBatch = async (page: number, excludeIds: string[]): Promise<Product[]> => {
    const res = await fetch('/api/featured', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        buyerCurrency: shopperContext.currency,
        buyerCountry: shopperContext.country,
        gender: shopperGenderFromProfile,
        page,
        excludeIds: excludeIds.slice(-300),
      }),
    })
    const data = await res.json()
    const items: Product[] = Array.isArray(data?.products) ? data.products : []
    const displayCur = shopperContext.currency || 'USD'
    return items
      .filter(p => p && p.in_stock && getProductImages(p)[0])
      .map(p => ({ ...p, base_currency: p.base_currency ?? p.currency ?? 'USD', currency: displayCur }))
  }

  // Initial load (or background refresh) — replaces the feed with page 0.
  const exploreDryRef = useRef(0)

  // Append products to the feed, dropping any that duplicate one already shown —
  // by id AND by lead image, so the same (or a visually identical) product never
  // appears twice / next to itself.
  const appendExplore = (incoming: Product[]) => {
    setExploreFeed(prev => {
      const seenId = new Set(prev.map(p => p.id))
      const seenImg = new Set(prev.map(p => getProductImages(p)[0]).filter(Boolean))
      const add: Product[] = []
      for (const p of incoming) {
        const img = getProductImages(p)[0]
        if (seenId.has(p.id) || (img && seenImg.has(img))) continue
        seenId.add(p.id); if (img) seenImg.add(img)
        add.push(p)
      }
      return add.length ? [...prev, ...add] : prev
    })
  }

  // Fire N rotating pages CONCURRENTLY and return their combined fresh products
  // (deduped against everything already shown or buffered). Parallel fetching is
  // the key to instant loading: 3 pages land in one ~2.5s round-trip, not three.
  const fetchExplorePages = async (count: number): Promise<Product[]> => {
    const exclude = [...exploreFeedRef.current, ...exploreBufferRef.current].map(p => p.id)
    const pages: number[] = []
    for (let i = 0; i < count; i++) pages.push(++explorePageRef.current)
    const results = await Promise.all(
      pages.map(pg => fetchExploreBatch(pg, exclude).catch(() => [] as Product[]))
    )
    const seen = new Set(exclude)
    const fresh: Product[] = []
    for (const batch of results) for (const p of batch) {
      if (!seen.has(p.id)) { seen.add(p.id); fresh.push(p) }
    }
    return fresh
  }

  // Keep ~1 page prefetched so the next scroll-load is instant. Fetches ONE
  // page at a time (guarded), topping up whenever the buffer is drained. Single
  // light calls keep the per-request load low so brands don't time out.
  const EXPLORE_BUFFER_TARGET = 60
  const fillExploreBuffer = async () => {
    if (exploreBusyRef.current || !exploreHasMore) return
    if (exploreBufferRef.current.length >= EXPLORE_BUFFER_TARGET) return
    exploreBusyRef.current = true
    let again = false
    try {
      const fresh = await fetchExplorePages(1)
      if (fresh.length === 0) {
        exploreDryRef.current += 1
        if (exploreDryRef.current >= 20) setExploreHasMore(false)
      } else {
        exploreDryRef.current = 0
        exploreBufferRef.current = [...exploreBufferRef.current, ...fresh]
        again = exploreBufferRef.current.length < EXPLORE_BUFFER_TARGET
      }
    } catch { /* will retry on next trigger */ }
    finally {
      exploreBusyRef.current = false
      if (again && exploreHasMore) fillExploreBuffer()   // keep the buffer topped up
    }
  }

  // Initial load (or refresh) — one light page, shown as soon as it lands, then
  // the buffer warms in the background.
  const loadExploreFeed = async () => {
    if (exploreBusyRef.current) return
    exploreBusyRef.current = true
    setExploreFeedLoading(true)
    try {
      explorePageRef.current = 0
      exploreDryRef.current = 0
      exploreBufferRef.current = []
      const fresh = await fetchExplorePages(1)
      if (fresh.length) {
        setExploreFeed(fresh)
        setExploreHasMore(true)
        try { localStorage.setItem('discern:explore-feed', JSON.stringify(fresh.slice(0, 80))) } catch {}
      }
    } catch { /* keep whatever is cached */ }
    finally { setExploreFeedLoading(false); exploreBusyRef.current = false; fillExploreBuffer() }
  }

  // Refresh (button or pull): jump to a different brand window and REPLACE the
  // feed with a fresh set. Always works on demand — it is NOT blocked by a
  // background buffer fill (only ignores rapid double-taps), so the toggle never
  // feels stuck. Each refresh lands on new brands.
  const exploreRefreshingRef = useRef(false)
  const refreshExplore = async () => {
    if (exploreRefreshingRef.current) return   // ignore rapid double-taps only
    exploreRefreshingRef.current = true
    exploreBusyRef.current = true              // block background fills during refresh
    setExploreFeedLoading(true)
    try {
      exploreRefreshRef.current += 1
      explorePageRef.current = exploreRefreshRef.current * 7   // new window each refresh
      exploreDryRef.current = 0
      exploreBufferRef.current = []
      setExploreHasMore(true)
      setExploreSeed(Math.floor((exploreRefreshRef.current * 3) % 7))
      const fresh = await fetchExplorePages(1)
      if (fresh.length) {
        setExploreFeed(fresh)
        try { localStorage.setItem('discern:explore-feed', JSON.stringify(fresh.slice(0, 80))) } catch {}
      }
    } catch { /* keep current feed on failure */ }
    finally {
      setExploreFeedLoading(false)
      exploreBusyRef.current = false
      exploreRefreshingRef.current = false
      fillExploreBuffer()
    }
  }

  // Infinite scroll — drain the prefetched buffer instantly when it's ready, then
  // refill in the background. The brand window rotates the whole roster, so it
  // keeps surfacing new brands/categories; only stops after the roster cycles.
  const loadMoreExplore = async () => {
    // Instant path: serve a page from the prefetched buffer, keep the rest.
    if (exploreBufferRef.current.length > 0) {
      const take = exploreBufferRef.current.slice(0, 50)
      exploreBufferRef.current = exploreBufferRef.current.slice(50)
      appendExplore(take)
      fillExploreBuffer()   // top the buffer back up in the background
      return
    }
    // Buffer not ready yet — fetch one page directly, then warm the buffer.
    if (exploreBusyRef.current || !exploreHasMore) return
    exploreBusyRef.current = true
    setExploreFeedLoading(true)
    try {
      const fresh = await fetchExplorePages(1)
      if (fresh.length === 0) {
        exploreDryRef.current += 1
        if (exploreDryRef.current >= 20) setExploreHasMore(false)
      } else {
        exploreDryRef.current = 0
        appendExplore(fresh)
      }
    } catch { /* leave the feed as-is; observer will retry on next scroll */ }
    finally { setExploreFeedLoading(false); exploreBusyRef.current = false; fillExploreBuffer() }
  }
  const loadMoreExploreRef = useRef(loadMoreExplore)
  loadMoreExploreRef.current = loadMoreExplore

  // Open the Explore view: clear any active search/brand, show the feed
  // instantly from cache, and top it up if empty. Each open re-rolls the mosaic.
  const openExplore = () => {
    setSidebar(false)
    handleReset()
    setShowExplore(true)
    setExploreSeed(Math.floor(Math.random() * 7))  // varies the mosaic rhythm each open
    setExploreHasMore(true)
    exploreDryRef.current = 0
    explorePageRef.current = 0
    exploreBufferRef.current = []
    setPullY(0)
    setPullRefreshing(false)
    pulling.current = false
    // Always fetch a fresh page on open. Any cached feed still shows instantly
    // (it seeds the initial state), but we refresh so a stale/sparse cache from
    // a previous session is replaced with a full one.
    loadExploreFeed()
  }

  // Prefetch the feed shortly after load (once, if no cache) so the first time
  // the shopper opens Explore it's already there — instant.
  useEffect(() => {
    if (exploreFeedRef.current.length > 0) return
    const t = setTimeout(() => { if (exploreFeedRef.current.length === 0) loadExploreFeed() }, 1500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Infinite-scroll observer for the Explore mosaic. rootMargin pre-loads well
  // before the sentinel is visible so batches chain seamlessly.
  useEffect(() => {
    if (!showExplore || !exploreHasMore) return
    const sentinel = exploreSentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) loadMoreExploreRef.current() },
      { rootMargin: '3500px', threshold: 0 }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [showExplore, exploreHasMore, exploreFeed.length])

  // The colour currently selected in the drawer (falls back to the first one).
  // The colour list shown in the sheet: prefer the colourways parsed from the
  // brand's product.json (most reliable — they're the real variants), falling
  // back to the catalog options when the fetch hasn't returned (or had none).
  const _catalogColors = selectedProduct ? getProductColors(selectedProduct) : []
  // Real colour options: product.json first, then catalog. When a product has
  // none (single-colour pieces encode the colour in their title), infer one
  // swatch so the popup always shows a colourway — sampled from the photo.
  const _realColors = fetchedColors.length > 0 ? fetchedColors : _catalogColors
  const _hasRealColors = _realColors.length > 0
  const _inferredColor = selectedProduct && !_hasRealColors
    ? inferSheetColorName(selectedProduct.title)
    : null
  const sheetColorList = _hasRealColors
    ? _realColors
    : _inferredColor ? [_inferredColor] : []
  const _activeSheetColor = selectedProduct
    ? (selectedColor || sheetColorList[0] || null)
    : null
  // Only narrow the gallery to a colourway when the shopper explicitly taps one
  // — opening the popup shows the full set of photos. Inferred single colours
  // never filter (they have no separate media).
  const _imageColor = _hasRealColors ? selectedColor : null
  const _fetchedColorImages = (() => {
    if (!_imageColor) return [] as string[]
    const want = _imageColor.toLowerCase()
    const key = Object.keys(fetchedColorImages).find(k => k.toLowerCase() === want)
    return key ? rankImageUrls(fetchedColorImages[key]) : []
  })()
  const _colorImages = _fetchedColorImages.length > 0
    ? _fetchedColorImages
    : (_imageColor && selectedProduct) ? getColorVariantImages(selectedProduct, _imageColor) : []
  // Merge catalog images with the full gallery fetched from product.json.
  // Fetched images take precedence (higher quality, more complete); any catalog
  // images not already present are appended so nothing is lost.
  const _catalogImages = selectedProduct ? getProductImages(selectedProduct) : []
  const _sheetImagesRaw = _colorImages.length > 0
    // A colour is selected and has its own media — show only that colourway.
    ? _colorImages
    : fetchedProductImages.length > 0
      ? (() => {
          const fetchedSet = new Set(fetchedProductImages)
          const extra = _catalogImages.filter(u => !fetchedSet.has(u))
          // Reorder the combined set model-first so on-body shots lead the gallery.
          return rankImageUrls([...fetchedProductImages, ...extra])
        })()
      : _catalogImages
  // Curate + order on-body-first via vision (model shots lead, one product shot
  // trails, redundant/low-quality frames dropped). Returns the best 5–6.
  const sheetImages = useModelFirstOrder(_sheetImagesRaw)
  // Curation can shrink the gallery after the user has swiped — keep the active
  // index in range so the slider never lands on a blank panel.
  useEffect(() => {
    setActiveImg(i => (i >= sheetImages.length ? Math.max(0, sheetImages.length - 1) : i))
  }, [sheetImages.length])
  // Keep the ref in sync so the (imperatively-attached) wheel listener always
  // sees the current gallery length without re-binding on every change.
  sheetImgCount.current = sheetImages.length
  // Trackpad horizontal swipe on the wide (desktop/tablet) image pane. Attached
  // natively with { passive:false } so we can preventDefault the browser's
  // two-finger back/forward navigation while a gallery gesture is in flight.
  useEffect(() => {
    const el = imgWheelRef.current
    if (!el || !isWide || !selectedProduct) return
    // A trackpad flick arrives as a dense burst of wheel events (~16-30ms apart)
    // followed by a decaying momentum tail. A NEW, separate swipe only starts
    // after a quiet gap. So: step ONE image on the leading edge of a gesture,
    // then ignore every following event until a gap this long proves the finger
    // lifted and a fresh swipe began. One deliberate swipe = one image, momentum
    // never runs through the gallery, and a second swipe still lands as long as
    // there's a natural pause between them.
    const NEW_GESTURE_GAP = 120 // ms of quiet since the last horizontal event = new swipe
    const onWheel = (e: WheelEvent) => {
      const count = sheetImgCount.current
      if (count <= 1) return
      // Keep the gesture clock ticking on EVERY wheel event of the stream,
      // including the sub-2px and vertical-dominant ones. Updating it only for
      // events that pass the filters below let a gentle drag (deltaX oscillating
      // ~1-3px) or a brief diagonal stretch look like a brand-new gesture every
      // time an event happened to clear the floor, stepping several images per
      // swipe. The clock must measure "did the fingers lift", not "did we act".
      const now = e.timeStamp
      const gap = now - wheelLastEv.current
      wheelLastEv.current = now
      // Only claim clearly-horizontal motion; leave vertical scroll alone.
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) || Math.abs(e.deltaX) < 2) return
      e.preventDefault() // stop the browser's two-finger back/forward nav
      if (gap <= NEW_GESTURE_GAP) return // same gesture (incl. momentum tail) — ignore
      if (e.deltaX > 0) setActiveImg(i => Math.min(count - 1, i + 1))
      else setActiveImg(i => Math.max(0, i - 1))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => { el.removeEventListener('wheel', onWheel) }
  }, [isWide, selectedProduct])
  const sheetDesc      = selectedProduct ? getDescriptionText(selectedProduct) : ''
  const sheetDescRaw   = selectedProduct?.description_html
    ? sanitizeHtml(selectedProduct.description_html)
    : null
  const sheetSizeTable = sheetDescRaw ? extractSizeTables(sheetDescRaw) : null
  const sheetDescHtml  = sheetDescRaw
    ? (sheetSizeTable ? stripSizeTables(sheetDescRaw) : sheetDescRaw)
    : null
  const sheetMaterial  = selectedProduct ? extractMaterial(selectedProduct) : ''
  const sheetCareTags  = selectedProduct ? extractCareTags(selectedProduct) : []
  const sheetDetailTags= selectedProduct ? extractDetailTags(selectedProduct) : []
  const sheetSizes     = selectedProduct ? getProductSizes(selectedProduct) : []
  const sheetColors    = sheetColorList
  const sizeAvail      = selectedProduct ? getSizeAvailability(selectedProduct, _activeSheetColor) : {}
  const colorAvail     = selectedProduct ? getColorAvailability(selectedProduct) : {}
  const effectiveColor = selectedColor || (sheetColors.length > 0 ? sheetColors[0] : null)
  // The image a colour swatch samples from: that colourway's first photo (from
  // product.json, then catalog variant media). For a single-colour product the
  // hero IS that colour. Multi-colour without media → undefined → name swatch.
  const swatchImageFor = (c: string): string | undefined => {
    if (!selectedProduct) return undefined
    const want = c.toLowerCase()
    const key = Object.keys(fetchedColorImages).find(k => k.toLowerCase() === want)
    const fromFetch = key ? fetchedColorImages[key][0] : undefined
    const fromCatalog = getColorVariantImages(selectedProduct, c)[0]
    const variantImg = fromFetch ?? fromCatalog
    return variantImg ?? (sheetColors.length === 1 ? sheetImages[0] : undefined)
  }
  const checkoutUrl   = selectedProduct ? getCheckoutUrl(selectedProduct, selectedSize, effectiveColor) : '#'
  // Open the brand's checkout in a centered popup window so Discern stays open
  // behind it. (The brand's checkout lives on its own domain and blocks being
  // embedded in an iframe, so a popup window is as close to in-app as possible.)
  const openCheckout = (url: string) => {
    if (!url || url === '#') return
    const w = 460, h = 760
    const left = Math.round(window.screenX + Math.max(0, (window.outerWidth - w) / 2))
    const top  = Math.round(window.screenY + Math.max(0, (window.outerHeight - h) / 2))
    // Empty string name = new unnamed window every click (not '_blank' which ignores features).
    // Minimal features: popup=yes + dimensions is all modern browsers need.
    const win = window.open(url, '', `popup=yes,width=${w},height=${h},left=${left},top=${top}`)
    if (win) {
      win.focus()
    } else {
      // Popup was blocked — store URL so the toast can offer a fallback link.
      setPopupBlockedUrl(url)
      setTimeout(() => setPopupBlockedUrl(null), 8000)
    }
  }
  // Link straight to this product's own page so the shopper lands on the exact
  // item (where the brand's own size guide / fit info lives), not a generic page.
  const sizeGuideUrl  = selectedProduct?.store_url || null
  const sheetStoreHost= selectedProduct ? (() => { try { return new URL(selectedProduct.store_url).hostname.replace('www.', '') } catch { return '' } })() : ''
  const sheetBrandName = selectedProduct ? (() => {
    // Try BRAND_NAMES lookup first (keyed by domain), then vendor, then domain fallback
    if (sheetStoreHost) {
      const match = Object.entries(BRAND_NAMES).find(([domain]) =>
        sheetStoreHost === domain || sheetStoreHost.endsWith('.' + domain) || domain.endsWith('.' + sheetStoreHost)
      )
      if (match) return match[1]
    }
    return selectedProduct.vendor || sheetStoreHost || 'the brand'
  })() : ''
  const similarItems  = selectedProduct
    ? (searchProducts.length ? searchProducts : exploreCache).filter(p => p.id !== selectedProduct.id).slice(0, 12)
    : []

  // ── Find more like this ───────────────────────────────────────────────────
  // Build a clean, brand-free query from the product so the result spans the
  // whole roster (not just this brand). Worst case it falls back to the title —
  // the search either returns matches or the normal empty state shows. Never breaks.
  function buildMoreLikeQuery(p: Product): string {
    const vendor = (p.vendor || '').toLowerCase().trim()
    let base = (p.title || '').trim()
    if (vendor && vendor.length >= 3) {
      base = base.replace(new RegExp(vendor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), ' ')
    }
    // drop marketing filler so the garment/colour/material lead the query
    base = base
      .replace(/\b(the|new|classic|signature|limited|edition|collection|unisex|men'?s|women'?s)\b/ig, ' ')
      .replace(/[|–—•·]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    const mat = extractMaterial(p)
    const firstMat = mat ? mat.split(/[,;]+/)[0].trim() : ''
    let q = base
    if (firstMat && firstMat.length >= 3 && !base.toLowerCase().includes(firstMat.toLowerCase())) {
      q = `${firstMat} ${base}`.trim()
    }
    q = q.slice(0, 120).trim()
    return q || (p.title || '').slice(0, 120) || 'similar pieces'
  }

  function findMoreLikeThis(p: Product | null) {
    if (!p || loading) return
    const q = buildMoreLikeQuery(p)
    setSelected(null)        // close the detail sheet
    setShowExplore(false); setActiveBrand(null)   // result renders as a Fabrics reply, not inside Explore
    sendStylist(q)           // continues the one conversation with a fresh search
  }

  // ── Learning loop: flag a result as a bad match ───────────────────────────
  // Highest-signal training data for tuning the search. Fire-and-forget, with
  // a one-shot confirmation; failures are swallowed so feedback never blocks.
  const [flaggedIds, setFlaggedIds] = useState<Set<string>>(new Set())
  function flagBadMatch(p: Product | null) {
    if (!p || flaggedIds.has(p.id)) return
    setFlaggedIds(prev => new Set(prev).add(p.id))
    const q = [...stylistMsgs].reverse().find(m => m.role === 'user')?.content || ''
    flagQualitySignal({
      userEmail: onboardEmail,
      authProof: onboardEmail ? (authProof ?? undefined) : undefined,
      query: String(q).slice(0, 200),
      productId: p.id,
      productTitle: p.title,
      vendor: p.vendor,
      signal: 'bad_match',
    }).catch(() => { /* never block on feedback */ })
    // Immediate, visible effect: pull the flagged product out of the results
    // right now, from both the flat list and every category strip. The daily
    // quality-feedback cron is what teaches future searches (cross-session);
    // this is what makes "not what I searched for" feel like it did something
    // this second, instead of leaving the wrong item sitting in the results.
    setStylistMsgs(prev => prev.map(m => {
      if (m.role !== 'assistant') return m
      const removedIdx = m.foundProducts?.findIndex(x => x.id === p.id) ?? -1
      const foundProducts = m.foundProducts?.filter(x => x.id !== p.id)
      // Removing from foundProducts SHIFTS the array, and [PRODUCT:N] tokens in
      // the reply are 0-indexed into that exact array — so without remapping,
      // flagging one item makes every later card point at the wrong product and
      // the prose stops matching the cards (the very mismatch the grounding pass
      // exists to prevent). Renumber the tokens, and drop the one whose product
      // just went away. Only when the tokens actually index foundProducts: on a
      // pinned reply they index pinnedProducts and must be left alone.
      let content = m.content
      if (removedIdx >= 0 && !(m.pinnedProducts && m.pinnedProducts.length > 0) && /\[PRODUCT:\d+\]/i.test(content)) {
        content = content
          .replace(/\[PRODUCT:(\d+)\]/gi, (whole, n: string) => {
            const i = parseInt(n, 10)
            if (i === removedIdx) return ''
            return i > removedIdx ? `[PRODUCT:${i - 1}]` : whole
          })
          .replace(/[ \t]{2,}/g, ' ')
      }
      // Drop a category strip that just lost its last product, so flagging the
      // only item in a group doesn't leave an empty labeled strip with a lone
      // "See more" button behind.
      const foundProductGroups = m.foundProductGroups
        ?.map(g => ({ ...g, products: g.products.filter(x => x.id !== p.id) }))
        .filter(g => g.products.length > 0)
      // Outfit rows too — the comment above promised "every category strip", but
      // a piece shown inside an "Outfit N" row or an outfit slot was being left
      // on screen after the shopper explicitly rejected it.
      const outfitGroups = m.outfitGroups
        ?.map(g => ({ ...g, products: g.products.filter(x => x.id !== p.id) }))
        .filter(g => g.products.length > 0)
      const outfitSlots = m.outfitSlots
        ?.map(s => ({ ...s, products: (s.products || []).filter((x: Product) => x.id !== p.id) }))
        .filter(s => s.products.length > 0)
      return { ...m, content, foundProducts, foundProductGroups, outfitGroups, outfitSlots }
    }))
  }

  // Restore/persist unit preference across products
  useEffect(() => {
    const s = localStorage.getItem('discern:sg-unit')
    if (s === 'in' || s === 'cm') setSgDisplayUnit(s)
  }, [])

  // Fetch size guide inline — runs after sheetSizeTable is derived, so ref is valid
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!selectedProduct || sheetSizeTable) { setFetchedSizeGuide(null); setSizeGuideLoading(false); return }
    const storeUrl = selectedProduct.store_url
    if (!storeUrl) { setFetchedSizeGuide(null); return }
    let cancelled = false
    setSizeGuideLoading(true)
    setFetchedSizeGuide(null)
    fetch(`/api/sizeguide?url=${encodeURIComponent(storeUrl)}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setFetchedSizeGuide(d.html ? sanitizeHtml(d.html) : null) })
      .catch(() => { if (!cancelled) setFetchedSizeGuide(null) })
      .finally(() => { if (!cancelled) setSizeGuideLoading(false) })
    return () => { cancelled = true }
  }, [selectedProduct?.id, sheetSizeTable])

  useEffect(() => {
    // Guarded — a throw here (Safari private mode / quota) would escape the
    // effect and surface as a render error just from toggling cm/in.
    try { if (sgDisplayUnit) localStorage.setItem('discern:sg-unit', sgDisplayUnit) } catch { /* ignore */ }
  }, [sgDisplayUnit])

  // AI-clean the product description — strips marketing fluff, CTAs, shipping text
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const raw = sheetDesc.trim()
    if (!selectedProduct || !raw) { setCleanDesc(null); return }
    let cancelled = false
    setCleanDescLoading(true)
    fetch('/api/description', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: selectedProduct.id,
        title: selectedProduct.title,
        vendor: selectedProduct.vendor,
        type: selectedProduct.product_type,
        rawText: raw,
      }),
    })
      .then(r => r.json())
      .then(d => { if (!cancelled) setCleanDesc(d.text || null) })
      .catch(() => { if (!cancelled) setCleanDesc(null) })
      .finally(() => { if (!cancelled) setCleanDescLoading(false) })
    return () => { cancelled = true }
  }, [selectedProduct?.id])

  // Fetch shipping & returns from brand policy pages
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const storeUrl = selectedProduct?.store_url
    if (!storeUrl) { setShippingInfo(null); return }
    let cancelled = false
    fetch(`/api/shipping?url=${encodeURIComponent(storeUrl)}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setShippingInfo(d.data ?? null) })
      .catch(() => { if (!cancelled) setShippingInfo(null) })
    return () => { cancelled = true }
  }, [selectedProduct?.id])

  // Fetch full product image gallery from Shopify product.json.
  // The Catalog API often returns only 1 image; this fills in the rest.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setFetchedProductImages([])
    setFetchedColorImages({})
    setFetchedColors([])
    const storeUrl = selectedProduct?.store_url
    if (!storeUrl) return
    let cancelled = false
    fetch(`/api/product-images?url=${encodeURIComponent(storeUrl)}`)
      .then(r => r.json())
      .then(d => {
        if (cancelled) return
        if (Array.isArray(d.images) && d.images.length > 0) setFetchedProductImages(d.images)
        if (d.byColor && typeof d.byColor === 'object') setFetchedColorImages(d.byColor)
        if (Array.isArray(d.colors) && d.colors.length > 0) setFetchedColors(d.colors)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [selectedProduct?.id])

  // Parse size guide HTML into structured interactive data
  const parsedSizeTables = useMemo(() => {
    const html = sheetSizeTable || fetchedSizeGuide
    if (!html) return []
    return parseSizeGuideHtml(html)
  }, [sheetSizeTable, fetchedSizeGuide])

  const sgTable   = parsedSizeTables[sgTableIdx] ?? null
  const sgEffectiveUnit = sgDisplayUnit ?? (sgTable?.unit || null)
  const sgChunks  = sgTable ? chunkHeaders(sgTable.headers) : []

  // Which columns of the international reference to show — only the letter sizes
  // the brand actually carries. If no letter sizes in headers, intl section is hidden.
  const sgIntlCols = useMemo(() => {
    if (!sgTable) return null
    const brandHdrs = new Set(sgTable.headers.map(h => h.toUpperCase().trim()))
    const refHdr = sgIntlGender === 'w' ? INTL_W_HDR : INTL_M_HDR
    const cols = refHdr
      .map((h, i) => ({ h, i }))
      .filter(({ h }) => brandHdrs.has(h))
    return cols.length > 0 ? cols : null
  }, [sgTable, sgIntlGender])
  const sgChunk   = sgChunks[sgGroupIdx] ?? []
  // Indices of current chunk's columns in the full headers array
  const sgColStart = sgGroupIdx * 3

  return (
    <div style={{ fontFamily: SANS, background: "#ffffff", height: "100dvh", width: "100%", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>

      {/* ── SVG filter for glass edge refraction ── */}
      <svg width="0" height="0" style={{ position: 'absolute' }}>
        <defs>
          <filter id="glass-refract" x="-5%" y="-5%" width="110%" height="110%">
            <feTurbulence type="fractalNoise" baseFrequency="0.018 0.012" numOctaves="2" seed="4" result="noise"/>
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="2.2" xChannelSelector="R" yChannelSelector="G"/>
          </filter>
        </defs>
      </svg>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400&family=DM+Sans:wght@300;400;500&display=swap');
        html,body{margin:0;padding:0;background:#fff;min-height:100%;width:100%;}
        *{box-sizing:border-box;-webkit-tap-highlight-color:transparent;-webkit-font-smoothing:antialiased;margin:0;padding:0;}
        ::-webkit-scrollbar{display:none;}

        /* ── Outer wrapper & shell ──
           The app fills the whole device — phone, tablet or laptop — rather than a
           fixed phone-width strip. Only on very large monitors do we cap the width
           and centre it so the layout never stretches absurdly wide.
           height:100% on html/body + position:fixed on the shell prevents the iOS
           Safari address-bar resize from triggering background repaints that look
           like zoom-in/zoom-out flicker on every device. */
        html,body{height:100%;overflow:hidden;}
        .fr-wrap{display:flex;align-items:stretch;justify-content:center;
          position:fixed;inset:0;
          background:#ffffff;}
        .fr-shell{width:100%;max-width:1600px;position:relative;display:flex;flex-direction:column;
          overflow:hidden;overscroll-behavior:none;
          background:#ffffff;}
        @media(min-width:1601px){
          .fr-wrap{background:#f2ede8;}
          .fr-shell{box-shadow:0 0 0 1px rgba(0,0,0,.06);}
        }

        /* ── Header ── */
        /* Translucent + blurred itself (not flat opaque white) — so the header's
           own bottom edge already has a soft, frosted quality instead of being a
           hard-edged solid block that a separate blur patch gets glued beneath.
           backdrop-filter here has nothing to blur in normal flow (the header
           doesn't overlap content itself), but it keeps the surface consistent
           with the ::after melt zone right below it, so there's no visible seam. */
        /* Same blur radius and translucency on both the header itself and the
           melt strip below it (FR_HEADER_BLUR) — they used to differ slightly
           (14px vs 12px, plain rgba vs a masked strip), which read as two
           different surfaces glued together instead of one continuous one. */
        .fr-header{display:flex;align-items:center;justify-content:space-between;position:relative;
          padding:max(10px,env(safe-area-inset-top,0px)) max(16px,calc(env(safe-area-inset-right,0px) + 12px)) 6px max(16px,calc(env(safe-area-inset-left,0px) + 12px));
          flex-shrink:0;z-index:10;background:rgba(255,255,255,.86);
          backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);}
        /* Soft blurred melt starting a little INSIDE the header's own bottom
           edge and extending past it — overlapping the boundary itself (not
           starting exactly at it) is what removes the seam/border-line feeling
           and makes the header and the content below read as one continuous
           surface. A real backdrop-blur fading via a mask, not a flat color
           gradient painted on top — a color wash looks like a dirty smudge
           wherever high-contrast content (a dark message bubble) scrolls
           underneath; blur-with-a-fading-mask genuinely softens whatever's
           there instead, the way a native translucent nav bar does. */
        .fr-header::after{content:'';position:absolute;left:0;right:0;bottom:-32px;height:44px;
          background:rgba(255,255,255,.86);
          backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);
          -webkit-mask-image:linear-gradient(to bottom, rgba(0,0,0,.55) 0%, rgba(0,0,0,.85) 27%, rgba(0,0,0,.4) 60%, rgba(0,0,0,0) 100%);
          mask-image:linear-gradient(to bottom, rgba(0,0,0,.55) 0%, rgba(0,0,0,.85) 27%, rgba(0,0,0,.4) 60%, rgba(0,0,0,0) 100%);
          pointer-events:none;z-index:1;}

        /* ── Content area (body + floating bar share this space) ── */
        .fr-content{flex:1;min-height:0;position:relative;overflow:hidden;}

        /* ── Body ── */
        .fr-body{position:absolute;inset:0;overflow-y:auto;overflow-x:hidden;scrollbar-width:none;display:flex;flex-direction:column;padding-top:28px;padding-bottom:calc(max(156px, env(safe-area-inset-bottom, 0px) + 144px));overscroll-behavior-y:contain;-webkit-overflow-scrolling:touch;scroll-behavior:smooth;}
        .fr-body.home{justify-content:flex-start;padding-top:clamp(48px,10vh,80px);overflow:hidden;padding-bottom:0;}

        /* ── Search bar wrap ── */
        .fr-bar-wrap{
          position:absolute;bottom:0;left:0;right:0;
          z-index:10;
          padding:12px clamp(12px,4vw,18px) max(28px,env(safe-area-inset-bottom,0px));
          /* Scrim: content fades into the page before it reaches the floating
             bar, instead of bleeding through the transparent gap around it. */
          background:linear-gradient(to top, #ffffff 58%, rgba(255,255,255,0.88) 80%, rgba(255,255,255,0) 100%);
          pointer-events:none;
        }
        .fr-bar-wrap > *{pointer-events:auto;}
        @media(min-width:768px){
          .fr-bar-wrap{
            padding-bottom:max(16px,env(safe-area-inset-bottom,0px));
          }
        }

        /* ── Greeting ── */
        .fr-greet{padding:0 clamp(16px,5vw,24px) clamp(16px,4vw,24px);
          opacity:0;transform:translateY(8px);transition:opacity .5s,transform .5s;}
        .fr-greet.in{opacity:1;transform:translateY(0);}

        /* ── Grid — 2 col mobile → 3 col large phone/small tablet → 4 col iPad & up
           4 columns is the industry standard for fashion e-commerce on desktop
           (Net-a-Porter, SSENSE, Farfetch all cap at 4 — gives images room to breathe).
           Only very wide monitors (1500px+) step up to 5. */
        .fr-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:26px 10px;width:100%;flex-shrink:0;padding:0 10px;box-sizing:border-box;}
        @media(min-width:600px){.fr-grid{grid-template-columns:repeat(3,1fr);gap:30px 14px;padding:0 14px;}}
        @media(min-width:820px){.fr-grid{grid-template-columns:repeat(4,1fr);}}
        @media(min-width:1500px){.fr-grid{grid-template-columns:repeat(5,1fr);}}
        .fr-card{display:flex;flex-direction:column;opacity:0;animation:fr-fi .35s ease forwards;}
        .fr-cell{aspect-ratio:3/4;position:relative;overflow:hidden;cursor:pointer;background:#F2F2F2;-webkit-touch-callout:none;user-select:none;-webkit-user-select:none;touch-action:manipulation;}
        .fr-cell img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .4s,opacity .35s;-webkit-touch-callout:none;pointer-events:none;user-select:none;-webkit-user-select:none;}
        .fr-card:hover .fr-cell img{transform:scale(1.03);}
        /* In-chat product cards: a soft lift + image push on hover, a crisp
           press on tap, and a hairline that gives the image edge definition on
           white — the premium "these are considered picks" feel. */
        .fr-pcard{transition:transform .3s cubic-bezier(.22,.61,.36,1);will-change:transform;opacity:0;animation:fr-fi .42s ease forwards;}
        .fr-pcard:nth-child(1){animation-delay:.02s}.fr-pcard:nth-child(2){animation-delay:.06s}
        .fr-pcard:nth-child(3){animation-delay:.10s}.fr-pcard:nth-child(4){animation-delay:.14s}
        .fr-pcard:nth-child(5){animation-delay:.18s}.fr-pcard:nth-child(6){animation-delay:.22s}
        .fr-pcard:nth-child(7){animation-delay:.26s}.fr-pcard:nth-child(n+8){animation-delay:.30s}
        .fr-pcard-imgwrap{box-shadow:inset 0 0 0 1px rgba(0,0,0,.045);transition:box-shadow .3s cubic-bezier(.22,.61,.36,1);}
        .fr-pcard-img{transition:transform .55s cubic-bezier(.22,.61,.36,1);will-change:transform;}
        @media(hover:hover){
          .fr-pcard:hover{transform:translateY(-4px);}
          .fr-pcard:hover .fr-pcard-imgwrap{box-shadow:inset 0 0 0 1px rgba(0,0,0,.045),0 14px 30px -10px rgba(0,0,0,.20),0 3px 8px rgba(0,0,0,.06);}
          .fr-pcard:hover .fr-pcard-img{transform:scale(1.05);}
        }
        .fr-pcard:active{transform:translateY(-1px) scale(.988);transition-duration:.12s;}
        @keyframes fr-fi{to{opacity:1;}}

        /* ── Explore mosaic — Instagram-style feed: a uniform 3-across grid of
           tall 4:5 portrait tiles, every tile the same size. Tight gaps; the
           portrait ratio shows fashion full-length. ── */
        /* Instagram-style: 3 columns, edge-to-edge, tiny 2px gaps → full-width tiles */
        .fr-mosaic{display:grid;grid-template-columns:repeat(3,1fr);gap:2px;width:100%;padding:0 0 28px;box-sizing:border-box;}
        @media(min-width:900px){.fr-mosaic{grid-template-columns:repeat(4,1fr);gap:2px;}}
        @media(min-width:1400px){.fr-mosaic{grid-template-columns:repeat(5,1fr);}}
        .fr-mtile{position:relative;overflow:hidden;cursor:pointer;background:#F2F2F2;aspect-ratio:3/4;opacity:0;animation:fr-fi .5s ease forwards;-webkit-touch-callout:none;user-select:none;-webkit-user-select:none;touch-action:manipulation;}
        .fr-mtile img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .5s cubic-bezier(.22,.61,.36,1);pointer-events:none;user-select:none;}
        .fr-mtile:hover img{transform:scale(1.045);}
        .fr-mtile-views{position:absolute;left:7px;bottom:6px;z-index:5;display:flex;align-items:center;gap:3px;
          font-family:${SANS};font-size:10px;font-weight:500;color:#fff;letter-spacing:.01em;opacity:.92;
          text-shadow:0 1px 3px rgba(0,0,0,.45);pointer-events:none;}
        .fr-mtile-views svg{filter:drop-shadow(0 1px 2px rgba(0,0,0,.4));flex-shrink:0;opacity:.95;}
        /* "Thinking" indicator: three short stitches laid in sequence — a tiny
           running seam, not generic loading dots. Cohesive with the stitched
           step connector. */
        .fr-dot{width:7px;height:2.5px;border-radius:2px;background:${INK3};display:inline-block;transform-origin:center;animation:fr-breathe 1.4s infinite ease-in-out both;}
        .fr-dot:nth-child(1){animation-delay:-.28s}.fr-dot:nth-child(2){animation-delay:-.14s}
        @keyframes fr-breathe{0%,100%{opacity:.18;transform:scaleX(.55);}50%{opacity:.95;transform:scaleX(1);}}
        @keyframes fr-bounce{0%,80%,100%{transform:scale(.5);opacity:.4}40%{transform:scale(1);opacity:1}}

        .fr-card:nth-child(1){animation-delay:.00s}.fr-card:nth-child(2){animation-delay:.05s}
        .fr-card:nth-child(3){animation-delay:.10s}.fr-card:nth-child(4){animation-delay:.15s}
        .fr-card:nth-child(5){animation-delay:.20s}.fr-card:nth-child(6){animation-delay:.25s}
        .fr-card:nth-child(n+7){animation-delay:.30s}

        /* ── Sidebar ── */
        .fr-sb{position:absolute;top:0;left:0;bottom:0;width:min(290px,86%);z-index:200;
          transform:translateX(-100%);transition:transform .34s cubic-bezier(.32,.72,0,1);
          display:flex;flex-direction:column;
          background:#ffffff;
          border-right:0.5px solid rgba(0,0,0,.08);
          box-shadow:8px 0 48px rgba(0,0,0,.10);
          border-radius:inherit;}
        .fr-sb.open{transform:translateX(0);}
        .fr-ov{position:absolute;inset:0;background:rgba(0,0,0,0);z-index:199;pointer-events:none;
          transition:background .34s;border-radius:inherit;}
        .fr-ov.open{background:rgba(0,0,0,.18);pointer-events:all;backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px);}
        .fr-hi{display:flex;align-items:center;gap:14px;padding:13px 18px;cursor:pointer;border-radius:12px;
          transition:background .12s;font-family:'DM Sans',sans-serif;font-size:14px;color:${INK};font-weight:300;
          -webkit-touch-callout:none;touch-action:pan-y;}
        .fr-hi:hover{background:rgba(0,0,0,.05);}
        .fr-hi.on{background:rgba(0,0,0,.07);font-weight:400;}

        /* ── Search bar pill ── */
        .fr-bar{
          position:relative;overflow:hidden;
          display:flex;flex-direction:column;gap:10px;
          width:100%;max-width:min(820px,96vw);margin:0 auto;
          border-radius:24px;border:none;
          padding:18px 18px 10px 12px;
          will-change:transform;
          background:rgba(255,255,255,0.82);
          box-shadow:
            0 8px 32px rgba(0,0,0,.10),
            0 2px 8px rgba(0,0,0,.06),
            inset 0 1.5px 0 rgba(255,255,255,.98),
            inset 0 -0.5px 0 rgba(0,0,0,.04);
        }

        /* Textarea */
        .fr-bar-top{display:flex;align-items:flex-end;gap:8px;}
        .fr-bar-btm{display:flex;align-items:center;gap:6px;}
        .fr-bar-right{display:flex;align-items:center;gap:8px;margin-left:auto;}
        .fr-ta{flex:1;border:none;background:transparent;font-family:'DM Sans',sans-serif;
          font-size:16px;color:${INK};caret-color:${INK};resize:none;overflow:hidden;
          min-height:24px;max-height:120px;line-height:1.55;padding:0;display:block;outline:none;width:100%;}
        .fr-ta::placeholder{color:rgba(0,0,0,.28);}

        /* Icon buttons */
        .fr-icon-btn{
          width:34px;height:34px;border-radius:50%;border:none;cursor:pointer;flex-shrink:0;
          display:flex;align-items:center;justify-content:center;touch-action:manipulation;
          color:${INK2};
          background:#ffffff;
          box-shadow:0 2px 8px rgba(0,0,0,.10),inset 0 1px 0 rgba(255,255,255,.95),inset 0 -0.5px 0 rgba(0,0,0,.06);
          transition:background .15s,box-shadow .15s,transform .1s;
        }
        .fr-icon-btn:hover{
          background:#ffffff;
          box-shadow:0 3px 12px rgba(0,0,0,.13),inset 0 1px 0 #fff,inset 0 -0.5px 0 rgba(0,0,0,.07);
          transform:translateY(-0.5px);
        }
        .fr-icon-btn:active{transform:scale(0.93);}

        /* Send button — while a request is in flight this becomes a plain
           light "busy" pill (bordered, black stop-square icon) instead of
           the dark send-arrow state, so it's visually obvious the button
           won't act as send right now while the shopper is still free to
           type and queue up their next message underneath it. */
        .fr-send-btn{
          width:36px;height:36px;border-radius:50%;touch-action:manipulation;
          background:${loading ? '#ffffff' : (canSend ? INK : 'rgba(0,0,0,.18)')};
          border:${loading ? `1px solid ${BRD}` : 'none'};
          display:flex;align-items:center;justify-content:center;
          cursor:${loading ? 'default' : (canSend ? 'pointer' : 'default')};
          flex-shrink:0;
          box-shadow:${loading
            ? '0 2px 8px rgba(0,0,0,.08)'
            : canSend
              ? '0 4px 14px rgba(0,0,0,.35),0 1px 4px rgba(0,0,0,.2),inset 0 1px 0 rgba(255,255,255,.12)'
              : 'none'};
          transition:background .2s,box-shadow .2s;
        }

        /* Bottom sheet — phone */
        .fr-sheet{
          position:absolute;bottom:0;left:0;right:0;border-radius:24px 24px 0 0;
          display:flex;flex-direction:column;z-index:101;
          background:#ffffff;
          border-top:0.5px solid rgba(0,0,0,.08);
          box-shadow:
            0 -1px 0 rgba(0,0,0,.05),
            0 -24px 64px rgba(0,0,0,.10);
        }
        /* On tablet/laptop/desktop (768px+) the sheet becomes a centred
           side-by-side card — iPad, tablets and laptops all get the two-column
           product view. Phones in portrait keep the bottom-sheet behaviour. */
        @media(min-width:768px){
          .fr-sheet{
            top:50%;left:50%;
            right:auto;bottom:auto;
            width:min(1000px,94vw);
            height:min(680px,88vh);
            min-height:0;
            border-radius:28px;
            border:0.5px solid rgba(0,0,0,.07);
            box-shadow:
              0 0 0 0.5px rgba(0,0,0,.04),
              0 8px 40px rgba(0,0,0,.14),
              0 32px 80px rgba(0,0,0,.10);
          }
          .fr-drag{display:none;}
        }
        .fr-sheet-ov{position:absolute;inset:0;background:rgba(0,0,0,0);z-index:100;
          pointer-events:none;transition:background .36s;border-radius:inherit;}
        .fr-sheet-ov.vis{background:rgba(0,0,0,.28);pointer-events:all;
          backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);}
        .fr-drag{padding:10px 0 6px;display:flex;justify-content:center;flex-shrink:0;
          cursor:ns-resize;touch-action:none;user-select:none;}
        .fr-drag-pill{width:34px;height:4px;background:rgba(0,0,0,.14);border-radius:2px;}

        /* Sizes — boxed grid (H&M editorial) */
        .fr-szbox{font-family:'DM Sans',sans-serif;font-size:13px;color:${INK};
          background:#fff;border:1px solid ${BRD};padding:14px 0;cursor:pointer;
          text-align:center;transition:border-color .15s;position:relative;}
        .fr-szbox:hover{border-color:${INK3};z-index:1;}
        .fr-szbox.on{border:1.5px solid ${INK};z-index:2;}
        .fr-szbox.dis{color:${INK3};text-decoration:line-through;cursor:default;opacity:.45;}
        .fr-szbox.dis:hover{border-color:${BRD};}

        /* HTML description rendering */
        .fr-html{font-family:'DM Sans',sans-serif;font-size:13px;color:${INK2};line-height:1.7;font-weight:300;}
        .fr-html p{margin-bottom:10px;}.fr-html p:last-child{margin-bottom:0;}
        .fr-html ul,.fr-html ol{padding-left:18px;margin-bottom:10px;}
        .fr-html li{margin-bottom:5px;}
        .fr-html h1,.fr-html h2,.fr-html h3,.fr-html h4{font-size:12px;font-weight:600;color:${INK};margin-bottom:8px;margin-top:12px;letter-spacing:.05em;text-transform:uppercase;}
        .fr-html b,.fr-html strong{font-weight:500;color:${INK};}
        .fr-html em,.fr-html i{font-style:italic;}
        .fr-html table{width:100%;border-collapse:collapse;font-size:12px;}
        .fr-html th{background:rgba(0,0,0,0.05);font-weight:600;text-transform:uppercase;letter-spacing:.05em;font-size:10px;color:${INK};}
        .fr-html th,.fr-html td{padding:9px 12px;border:1px solid rgba(0,0,0,0.10);text-align:left;vertical-align:middle;}
        .fr-html tr:nth-child(even) td{background:rgba(0,0,0,0.025);}
        /* Size guide modal */
        .fr-sz-modal{font-family:'DM Sans',sans-serif;}
        .fr-sz-modal table{width:auto;min-width:max-content;white-space:nowrap;border-collapse:collapse;font-size:12px;}
        .fr-sz-modal th{background:rgba(0,0,0,.05);font-weight:600;text-transform:uppercase;letter-spacing:.05em;font-size:10px;color:${INK};padding:9px 14px;border:1px solid rgba(0,0,0,.1);text-align:left;vertical-align:middle;}
        .fr-sz-modal td{padding:9px 14px;border:1px solid rgba(0,0,0,.1);text-align:left;vertical-align:middle;color:${INK2};font-weight:300;}
        .fr-sz-modal tr:nth-child(even) td{background:rgba(0,0,0,.025);}
        .fr-sz-modal img{max-width:100%;height:auto;display:block;}

        /* ADD button — full width */
        .fr-add{display:block;width:100%;padding:17px;border:none;cursor:pointer;touch-action:manipulation;
          font-family:'DM Sans',sans-serif;font-size:12px;font-weight:500;letter-spacing:.14em;
          text-transform:uppercase;text-align:center;text-decoration:none;
          background:${INK};color:#fff;transition:background .18s;}
        .fr-add:hover{background:#3d1c0c;}
        .fr-add.warn{background:#fff;color:${INK3};border:1px solid ${BRD};cursor:default;pointer-events:none;}

        /* Results bar */
        .fr-results-bar{display:flex;justify-content:space-between;align-items:center;
          padding:10px 14px 6px;font-family:'DM Sans',sans-serif;font-size:10px;color:${INK3};}


        @keyframes fr-bounce{0%,100%{transform:translateY(0);opacity:.2;}50%{transform:translateY(-6px);opacity:1;}}
        @keyframes sk-sweep{0%{transform:translateX(-100%);}100%{transform:translateX(300%);}}
        @keyframes spin{to{transform:rotate(360deg);}}
        @keyframes ctxIn{0%{opacity:0;transform:scale(0.60);}55%{opacity:1;transform:scale(1.04);}80%{transform:scale(0.98);}100%{opacity:1;transform:scale(1);}}
        @keyframes toastIn{0%{opacity:0;transform:translateX(-50%) translateY(18px) scale(0.88);}60%{opacity:1;transform:translateX(-50%) translateY(-4px) scale(1.03);}80%{transform:translateX(-50%) translateY(2px) scale(0.99);}100%{opacity:1;transform:translateX(-50%) translateY(0) scale(1);}}
        @keyframes toastOut{0%{opacity:1;transform:translateX(-50%) translateY(0) scale(1);}100%{opacity:0;transform:translateX(-50%) translateY(14px) scale(0.88);}}
        @keyframes sheetUp{0%{transform:translateY(100%);}100%{transform:translateY(0);}}
        @keyframes fadeScale{0%{opacity:0;transform:scale(0.94);}100%{opacity:1;transform:scale(1);}}

        /* Auth/consent gate — CSS-only responsive so correct layout is applied
           before JS hydrates, eliminating the bottom-sheet flash on tablet/desktop. */
        .fr-gate-outer{position:fixed;inset:0;z-index:4000;display:flex;align-items:flex-end;justify-content:center;background:rgba(28,12,4,0.28);backdrop-filter:blur(4px) saturate(130%);-webkit-backdrop-filter:blur(4px) saturate(130%);}
        .fr-gate-card{
          width:100%;
          background:#ffffff;
          color:${INK};
          border-radius:28px 28px 0 0;
          padding:28px 24px 36px;
          border-top:1px solid rgba(0,0,0,.08);
          box-shadow:0 -12px 60px rgba(28,12,4,.22);
          animation:sheetUp .34s cubic-bezier(.32,.72,0,1);
          max-height:94vh;
          overflow-y:auto;
        }
        .fr-gate-handle{width:40px;height:4px;border-radius:4px;background:rgba(0,0,0,.18);margin:-8px auto 20px;}
        @media(min-width:768px){
          .fr-gate-outer{align-items:center;padding:18px;}
          .fr-gate-card{max-width:420px;border-radius:26px;padding:36px 32px 28px;box-shadow:0 28px 80px rgba(28,12,4,.28);animation:fadeScale .28s cubic-bezier(.32,.72,0,1);}
          .fr-gate-handle{display:none;}
        }
        /* Settings sheet */
        .fr-settings-outer{position:fixed;inset:0;z-index:3800;display:flex;align-items:flex-end;justify-content:center;background:rgba(28,12,4,0.38);backdrop-filter:blur(20px) saturate(180%);-webkit-backdrop-filter:blur(20px) saturate(180%);}
        .fr-settings-card{
          width:100%;
          background:#ffffff;
          color:${INK};
          border-radius:26px 26px 0 0;
          display:flex;flex-direction:column;max-height:88vh;
          border-top:1px solid rgba(0,0,0,.08);
          box-shadow:0 -8px 48px rgba(28,12,4,.18);
          animation:sheetUp .32s cubic-bezier(.32,.72,0,1);
        }
        @media(min-width:768px){
          .fr-settings-outer{align-items:center;padding:18px;}
          .fr-settings-card{max-width:440px;border-radius:24px;max-height:85vh;animation:fadeScale .26s cubic-bezier(.32,.72,0,1);}
        }

        @keyframes glassSpring{0%{opacity:0;transform:scale(0.82) translateY(28px);}45%{opacity:1;transform:scale(1.035) translateY(-7px);}65%{transform:scale(0.978) translateY(4px);}80%{transform:scale(1.012) translateY(-2px);}91%{transform:scale(0.994) translateY(1px);}100%{opacity:1;transform:scale(1) translateY(0);}}
        @keyframes glassSweep{0%{transform:translateX(-120%) skewX(-20deg);opacity:0;}10%{opacity:1;}90%{opacity:1;}100%{transform:translateX(350%) skewX(-20deg);opacity:0;}}
        @keyframes glassFloat{0%,100%{transform:translateY(0px);}50%{transform:translateY(-4px);}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(5px);}to{opacity:1;transform:translateY(0);}}
        @keyframes fr-step-in{from{opacity:0;transform:scale(0.7);}to{opacity:1;transform:scale(1);}}
        @keyframes fr-step-glow{0%,100%{box-shadow:0 0 0 0 rgba(0,0,0,0.18);}50%{box-shadow:0 0 0 5px rgba(0,0,0,0.06);}}
        @keyframes fr-caret-blink{0%,55%{opacity:1;}56%,100%{opacity:0;}}
        .fr-step-active{animation:fr-step-in .25s cubic-bezier(.32,.9,.4,1), fr-step-glow 1.8s ease-in-out .25s infinite;}
        .fr-step-pop{animation:fr-step-in .22s cubic-bezier(.32,.9,.4,1);}
        .fr-type-caret{display:inline-block;width:2px;height:1em;background:currentColor;margin-left:1px;vertical-align:text-bottom;animation:fr-caret-blink 1s step-start infinite;}
        @keyframes fr-shine{0%{background-position:200% center;}100%{background-position:-200% center;}}
        .fr-shine{background:linear-gradient(90deg,#9a9a9f 0%,#9a9a9f 35%,#1D1D1F 50%,#9a9a9f 65%,#9a9a9f 100%);background-size:220% auto;-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent;animation:fr-shine 2.7s cubic-bezier(.4,0,.2,1) infinite;}
        /* Active loading-step label: a soft light glides across the ink text —
           slower and gentler than a spinner blink, so it reads as "considering"
           rather than "loading". */
        .fr-shimmer{background:linear-gradient(90deg,#9a9a9f 0%,#9a9a9f 32%,#1D1D1F 48%,#1D1D1F 52%,#9a9a9f 68%,#9a9a9f 100%);background-size:220% auto;-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent;animation:fr-shine 2.7s cubic-bezier(.4,0,.2,1) infinite;}
        /* Smooth comet-tail spinner for the active step node (conic + ring mask). */
        .fr-ring{width:14px;height:14px;border-radius:50%;flex-shrink:0;background:conic-gradient(from 0deg,rgba(29,29,31,0) 0%,rgba(29,29,31,.16) 42%,#1D1D1F 100%);-webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 1.7px),#000 calc(100% - 1.7px));mask:radial-gradient(farthest-side,transparent calc(100% - 1.7px),#000 calc(100% - 1.7px));animation:spin .95s linear infinite;}
        /* Larger ring for the active step node — a semantic step icon sits inside it. */
        .fr-ring2{width:22px;height:22px;border-radius:50%;background:conic-gradient(from 0deg,rgba(29,29,31,0) 0%,rgba(29,29,31,.15) 42%,#1D1D1F 100%);-webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 1.7px),#000 calc(100% - 1.7px));mask:radial-gradient(farthest-side,transparent calc(100% - 1.7px),#000 calc(100% - 1.7px));animation:spin 1s linear infinite;}
        /* Checkmark that draws itself in as a step completes. */
        @keyframes fr-draw{from{stroke-dashoffset:15;}to{stroke-dashoffset:0;}}
        .fr-tick{stroke-dasharray:15;animation:fr-draw .34s ease .04s both;}
        /* Soft breathing halo behind the active spinner, drawing the eye to it. */
        @keyframes fr-halo{0%,100%{box-shadow:0 0 0 0 rgba(29,29,31,.11);}50%{box-shadow:0 0 0 6px rgba(29,29,31,0);}}
        .fr-node-active{width:14px;height:14px;border-radius:50%;display:flex;flex-shrink:0;animation:fr-halo 2.2s ease-in-out infinite;}
        /* Connector = a RUNNING STITCH between steps: it first draws itself down
           (scaleY), then the stitches march gently downward, like a seam being
           sewn — Discern's atelier signature, not a generic progress line. */
        @keyframes fr-thread{from{transform:scaleY(0);}to{transform:scaleY(1);}}
        @keyframes fr-stitch{from{background-position-y:0;}to{background-position-y:6px;}}
        .fr-thread{transform-origin:top center;background:repeating-linear-gradient(to bottom,rgba(29,29,31,.32) 0 3px,transparent 3px 6px);animation:fr-thread .45s cubic-bezier(.32,.9,.4,1) both, fr-stitch 1.15s linear .35s infinite;}
        button{cursor:pointer;} a{color:inherit;}
        .fr-msg-edit-btn{opacity:0;transition:opacity .15s ease;}
        .fr-msg-hover:hover .fr-msg-edit-btn,.fr-msg-hover:focus-within .fr-msg-edit-btn{opacity:.55;}
        .fr-msg-edit-btn:hover{opacity:1 !important;}
        .fr-otp-box{transition:border-color .12s ease,box-shadow .12s ease;}
        .fr-otp-box:focus{border-color:${INK} !important;box-shadow:0 0 0 3px rgba(0,0,0,0.12);}
      `}</style>

      {/* Attach input — the one photo picker, persistent wardrobe pieces for outfit-building */}
      <input ref={wardrobeFileRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={handleWardrobeFile} />

      {/* ── Mandatory account gate ── */}
      {/* Blocks the app until signed in. No close button, no dismiss-on-tap, fixed
          so it never scrolls away. Email-OTP unifies sign-up and sign-in (a code
          to a new email creates the account; to an existing one, signs in), and
          Google does the same — so there is no separate login screen to add. */}
      {REQUIRE_LOGIN && authStatus === 'unauthenticated' && (
        <div className="fr-gate-outer">
          <div className="fr-gate-card">
            <div className="fr-gate-handle" />

            {/* Logo */}
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 22 }}>
              <DiscernLogo size={28} color="#000000" />
            </div>

            <div style={{ fontFamily: SERIF, fontSize: 'clamp(22px,4vw,32px)', fontWeight: 500, color: INK, textAlign: 'center', lineHeight: 1.2, letterSpacing: '-.01em', whiteSpace: 'nowrap' }}>
              {otpStep === 'code' ? 'Check your email' : 'Decide Better.'}
            </div>
            <div style={{ fontFamily: SANS, fontSize: 13, color: INK3, textAlign: 'center', marginTop: 8, marginBottom: 24, lineHeight: 1.65, whiteSpace: 'pre-line' }}>
              {otpStep === 'code'
                ? `We sent a 6-digit code to\n${otpEmail}`
                : "Describe what you're looking for.\nDiscern helps you decide what to buy."}
            </div>

            {authUrlError && (
              <div style={{ fontFamily: SANS, fontSize: 12, color: '#c0392b', background: 'rgba(192,57,43,0.06)', border: '1px solid rgba(192,57,43,0.15)', borderRadius: 10, padding: '10px 12px', marginBottom: 14, lineHeight: 1.5 }}>
                {authUrlError}
              </div>
            )}

            {otpStep === 'email' && (
              <>
                <button type="button" onClick={() => signIn('google', { callbackUrl: window.location.origin + '/' })}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                    padding: '13px 16px', borderRadius: 30, background: '#fff', border: `1px solid ${BRD}`,
                    fontFamily: SANS, fontSize: 14, fontWeight: 500, color: INK, cursor: 'pointer', marginBottom: 18 }}>
                  <svg width="17" height="17" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8c-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4C12.955 4 4 12.955 4 24s8.955 20 20 20s20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"/><path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4C16.318 4 9.656 8.337 6.306 14.691z"/><path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"/><path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002l6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"/></svg>
                  Continue with Google
                </button>

                <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '0 0 18px' }}>
                  <div style={{ flex: 1, height: 1, background: BRD }} />
                  <span style={{ fontFamily: SANS, fontSize: 11, color: INK3, letterSpacing: '.08em' }}>OR</span>
                  <div style={{ flex: 1, height: 1, background: BRD }} />
                </div>

                <form onSubmit={async e => {
                  e.preventDefault()
                  if (!otpEmail.trim() || otpSending) return
                  setOtpError(null); setOtpSending(true)
                  try {
                    const r = await fetch('/api/auth/send-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: otpEmail.trim() }) })
                    const d = await r.json()
                    if (!r.ok) throw new Error(d.error || 'Failed to send code')
                    setOtpStep('code'); setOtpResendIn(60)
                  } catch (err: any) { setOtpError(err.message) } finally { setOtpSending(false) }
                }}>
                  <input type="email" value={otpEmail} placeholder="name@email.com" onChange={e => setOtpEmail(e.target.value)} autoComplete="email"
                    style={{ width: '100%', boxSizing: 'border-box', padding: '13px 16px', borderRadius: 12, marginBottom: 12,
                      border: `1px solid ${BRD}`, fontFamily: SANS, fontSize: 14, color: INK, background: BG2, outline: 'none' }} />
                  {otpError && <div style={{ fontFamily: SANS, fontSize: 12, color: '#c0392b', marginBottom: 12 }}>{otpError}</div>}
                  <button type="submit" disabled={otpSending || !otpEmail.trim()}
                    style={{ width: '100%', padding: '14px', borderRadius: 30, background: INK, color: '#fff', border: 'none',
                      cursor: otpSending ? 'default' : 'pointer', fontFamily: SANS, fontSize: 14, fontWeight: 500,
                      opacity: otpSending || !otpEmail.trim() ? 0.5 : 1 }}>
                    {otpSending ? 'Sending…' : 'Continue with email'}
                  </button>
                </form>
              </>
            )}

            {otpStep === 'code' && (
              <form onSubmit={async e => {
                e.preventDefault()
                if (!otpCode.trim() || otpVerifying) return
                setOtpError(null); setOtpVerifying(true)
                try {
                  const result = await signIn('email-otp', { email: otpEmail.trim(), code: otpCode.trim(), redirect: false })
                  if (result?.error) throw new Error(result.error === 'CredentialsSignin' ? 'Invalid or expired code, try again' : `Sign-in failed: ${result.error}`)
                  setOtpStep('email'); setOtpCode('')
                } catch (err: any) { setOtpError(err.message) } finally { setOtpVerifying(false) }
              }}>
                <div style={{ marginBottom: 12 }}>
                  <OtpBoxInput value={otpCode} onChange={setOtpCode} autoFocus />
                </div>
                {otpError && <div style={{ fontFamily: SANS, fontSize: 12, color: '#c0392b', marginBottom: 12, textAlign: 'center' }}>{otpError}</div>}
                <button type="submit" disabled={otpCode.length < 6 || otpVerifying}
                  style={{ width: '100%', padding: '14px', borderRadius: 30, background: INK, color: '#fff', border: 'none',
                    cursor: otpCode.length < 6 || otpVerifying ? 'default' : 'pointer', fontFamily: SANS, fontSize: 13, fontWeight: 600,
                    letterSpacing: '.08em', textTransform: 'uppercase', opacity: otpCode.length < 6 || otpVerifying ? 0.5 : 1, marginBottom: 12 }}>
                  {otpVerifying ? 'Verifying…' : 'Verify & continue'}
                </button>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <button type="button" onClick={() => { setOtpStep('email'); setOtpCode(''); setOtpError(null) }}
                    style={{ background: 'none', border: 'none', fontFamily: SANS, fontSize: 12, color: INK3, cursor: 'pointer', padding: 0 }}>← Change email</button>
                  <button type="button" disabled={otpResendIn > 0} onClick={async () => {
                    if (otpResendIn > 0) return
                    setOtpError(null); setOtpSending(true)
                    try {
                      const r = await fetch('/api/auth/send-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: otpEmail.trim() }) })
                      const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Failed'); setOtpResendIn(60)
                    } catch (err: any) { setOtpError(err.message) } finally { setOtpSending(false) }
                  }} style={{ background: 'none', border: 'none', fontFamily: SANS, fontSize: 12, color: otpResendIn > 0 ? INK3 : INK, cursor: otpResendIn > 0 ? 'default' : 'pointer', padding: 0, opacity: otpResendIn > 0 ? 0.45 : 1 }}>
                    {otpResendIn > 0 ? `Resend in ${otpResendIn}s` : 'Resend code'}
                  </button>
                </div>
              </form>
            )}

            <div style={{ fontFamily: SANS, fontSize: 11, color: INK3, textAlign: 'center', marginTop: 22, lineHeight: 1.7, opacity: 0.75 }}>
              By continuing, you agree to our{' '}
              <a href="/terms" target="_blank" rel="noopener" style={{ color: INK3, textDecoration: 'underline', textUnderlineOffset: 2 }}>Terms</a>
              {' '}and{' '}
              <a href="/privacy" target="_blank" rel="noopener" style={{ color: INK3, textDecoration: 'underline', textUnderlineOffset: 2 }}>Privacy Policy</a>.
            </div>
          </div>
        </div>
      )}

      {/* ── User consent sheet (shown once after first sign-in) ── */}
      {showConsent && (
        <div className="fr-gate-outer" style={{ zIndex: 4100 }}>
          <div className="fr-gate-card">
            <div className="fr-gate-handle" />
            {consentFromSettings && (
              <button onClick={() => { setShowConsent(false); setConsentFromSettings(false); setSettingsOpen(true) }}
                style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', padding: '0 0 16px', fontFamily: SANS, fontSize: 13, color: INK3 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
                Back
              </button>
            )}
            <div style={{ fontFamily: SERIF, fontSize: 'clamp(22px,3.5vw,26px)', fontWeight: 500, color: INK, marginBottom: 6 }}>A quick word on data</div>
            <div style={{ fontFamily: SANS, fontSize: 13, color: INK3, lineHeight: 1.65, marginBottom: 26 }}>
              Discern uses data only to make your experience better: smarter searches, better recommendations. We never sell it or share it. Choose what you're comfortable with.
            </div>

            {/* Toggle rows */}
            {[
              { key: 'analytics' as const, label: 'Usage analytics', desc: "Helps us improve search quality and understand what's working. Country, device type, and session data. No browsing history." },
              { key: 'location' as const, label: 'Precise location', desc: "Show prices in your local currency and surface brands that ship to you. Your coordinates are never shared." },
            ].map(({ key, label, desc }) => {
              const on = key === 'analytics' ? consentAnalytics : consentLocation
              const setOn = key === 'analytics' ? setConsentAnalytics : setConsentLocation
              return (
                <div key={key} onClick={() => setOn(!on)} style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: '14px 0', borderTop: `1px solid ${BRD}`, cursor: 'pointer' }}>
                  {/* Toggle pill */}
                  <div style={{ flexShrink: 0, marginTop: 2, width: 44, height: 26, borderRadius: 13, background: on ? INK : 'rgba(0,0,0,.12)', transition: 'background .18s', position: 'relative' }}>
                    <div style={{ position: 'absolute', top: 3, left: on ? 21 : 3, width: 20, height: 20, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,.18)', transition: 'left .18s' }} />
                  </div>
                  <div>
                    <div style={{ fontFamily: SANS, fontSize: 14, fontWeight: 600, color: INK, marginBottom: 3 }}>{label}</div>
                    <div style={{ fontFamily: SANS, fontSize: 12, color: INK3, lineHeight: 1.55 }}>{desc}</div>
                  </div>
                </div>
              )
            })}

            <button onClick={saveConsent} disabled={consentSaving}
              style={{ width: '100%', marginTop: 24, padding: '14px', borderRadius: 30, background: INK, color: '#fff', border: 'none', fontFamily: SANS, fontSize: 13, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', opacity: consentSaving ? 0.55 : 1, cursor: consentSaving ? 'default' : 'pointer' }}>
              {consentSaving ? 'Saving…' : 'Save & continue'}
            </button>
            <button onClick={() => {
              setShowConsent(false)
              if (consentFromSettings) { setConsentFromSettings(false); setSettingsOpen(true) }
              else if (tasteProfileData === null) setShowOnboarding(true)
            }}
              style={{ width: '100%', marginTop: 10, padding: '10px', borderRadius: 30, background: 'none', border: 'none', fontFamily: SANS, fontSize: 12, color: INK3, cursor: 'pointer' }}>
              {consentFromSettings ? 'Cancel' : 'Decline all & continue'}
            </button>
          </div>
        </div>
      )}

      {/* ── Settings sheet ── */}
      {settingsOpen && (
        <div className="fr-settings-outer" onClick={() => setSettingsOpen(false)}>
          <div className="fr-settings-card" onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div style={{ padding: '14px 18px 0', flexShrink: 0 }}>
              <div style={{ width: 36, height: 4, borderRadius: 4, background: 'rgba(0,0,0,.14)', margin: '0 auto 14px' }} />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                {settingsView === 'profile' ? (
                  <button onClick={() => setSettingsView('main')} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', fontFamily: SANS, fontSize: 15, fontWeight: 500, color: INK, padding: 0 }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
                    My Profile
                  </button>
                ) : (
                  <span style={{ fontFamily: SANS, fontSize: 17, fontWeight: 600, color: INK }}>Settings</span>
                )}
                <button onClick={() => { setSettingsOpen(false); setSettingsView('main') }} style={{ width: 30, height: 30, borderRadius: '50%', background: 'rgba(0,0,0,.07)', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
              {settingsView === 'main' && (
                <div style={{ background: 'rgba(0,0,0,.04)', borderRadius: 12, padding: '10px 14px', marginBottom: 18 }}>
                  <div style={{ fontFamily: SANS, fontSize: 13, color: INK3 }}>{session?.user?.email || ''}</div>
                </div>
              )}
            </div>

            {/* Scrollable body */}
            <div style={{ overflowY: 'auto', flex: 1, padding: '0 18px 32px', scrollbarWidth: 'none' } as React.CSSProperties}>

            {settingsView === 'profile' ? (
              /* ── Profile edit view ── */
              <div>
                {/* Avatar / name display */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 24 }}>
                  <div style={{ width: 64, height: 64, borderRadius: '50%', overflow: 'hidden', background: 'rgba(0,0,0,.08)', marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {session?.user?.image
                      ? <img src={session.user.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="rgba(0,0,0,.35)" strokeWidth="1.5" strokeLinecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
                    }
                  </div>
                  <div style={{ fontFamily: SANS, fontSize: 12, color: INK3 }}>{session?.user?.email || ''}</div>
                </div>

                {/* Full name */}
                <div style={{ marginBottom: 18 }}>
                  <label style={{ display: 'block', fontFamily: SANS, fontSize: 11, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: INK3, opacity: 0.7, marginBottom: 8 }}>Full name</label>
                  <input value={profileName} onChange={e => setProfileName(e.target.value)}
                    placeholder="Your name"
                    style={{ width: '100%', padding: '12px 14px', borderRadius: 12, border: `1px solid ${BRD}`, fontFamily: SANS, fontSize: 15, color: INK, background: 'rgba(255,255,255,0.7)', outline: 'none', boxSizing: 'border-box' }} />
                </div>

                {/* Gender */}
                <div style={{ marginBottom: 22 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
                    <label style={{ display: 'block', fontFamily: SANS, fontSize: 11, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: INK3, opacity: 0.7 }}>I am</label>
                    <span style={{ fontFamily: SANS, fontSize: 10, color: INK3, opacity: 0.6 }}>sets your default search</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    {([
                      { g: 'Men', icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="6" r="3.5"/><path d="M6 21v-2a6 6 0 0 1 12 0v2"/><line x1="9" y1="15" x2="15" y2="15"/></svg> },
                      { g: 'Women', icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="6" r="3.5"/><path d="M8 21l4-10 4 10"/><path d="M7 17h10"/></svg> },
                    ] as const).map(({ g, icon }) => {
                      const active = profileGender === g
                      return (
                        <button key={g} onClick={() => setProfileGender(active ? '' : g)} style={{
                          padding: '12px 16px', borderRadius: 12,
                          border: `1.5px solid ${active ? INK : BRD}`,
                          background: active ? INK : 'rgba(255,255,255,0.7)',
                          cursor: 'pointer', transition: 'all .15s',
                          display: 'flex', alignItems: 'center', gap: 8,
                          color: active ? '#fff' : INK,
                        }}>
                          {icon}
                          <span style={{ fontFamily: SANS, fontSize: 13, fontWeight: 600, color: active ? '#fff' : INK }}>{g}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Sizes */}
                <div style={{ marginBottom: 24 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
                    <label style={{ display: 'block', fontFamily: SANS, fontSize: 11, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: INK3, opacity: 0.7 }}>Sizes</label>
                    <span style={{ fontFamily: SANS, fontSize: 10, color: INK3, opacity: 0.6 }}>Fabrics uses this for fit advice</span>
                  </div>
                  <div style={{ background: 'rgba(0,0,0,.03)', borderRadius: 14, overflow: 'hidden' }}>
                    {[
                      { label: 'Tops', value: profileSizeTops, set: setProfileSizeTops, placeholder: profileGender === 'Women' ? 'XS, S, M, L…' : profileGender === 'Men' ? 'S, M, L, XL…' : 'e.g. M, L, 38' },
                      { label: 'Bottoms', value: profileSizeBottoms, set: setProfileSizeBottoms, placeholder: profileGender === 'Women' ? '26, 28, 30, 32…' : profileGender === 'Men' ? '30, 32, 34, 36…' : 'e.g. 32, W30 L32' },
                      { label: 'Shoes', value: profileSizeShoes, set: setProfileSizeShoes, placeholder: profileGender === 'Women' ? '6, 7, 8, EU 38…' : profileGender === 'Men' ? '9, 10, 11, EU 43…' : 'e.g. EU 42, UK 8' },
                    ].map(({ label, value, set, placeholder }, i) => (
                      <div key={label} style={{ borderTop: i > 0 ? `0.5px solid rgba(0,0,0,.07)` : 'none', display: 'flex', alignItems: 'center', padding: '12px 14px', gap: 12 }}>
                        <div style={{ fontFamily: SANS, fontSize: 14, color: INK, width: 72, flexShrink: 0 }}>{label}</div>
                        <input value={value} onChange={e => set(e.target.value)} placeholder={placeholder}
                          style={{ flex: 1, border: 'none', background: 'transparent', fontFamily: SANS, fontSize: 14, color: INK, outline: 'none', textAlign: 'right' }} />
                      </div>
                    ))}
                  </div>
                </div>

                {profileError && (
                  <div style={{ fontFamily: SANS, fontSize: 12.5, color: '#B81C1C', textAlign: 'center', marginBottom: 12 }}>
                    {profileError}
                  </div>
                )}
                <button onClick={saveProfile} disabled={profileSaving}
                  style={{ width: '100%', padding: '14px', borderRadius: 30, background: INK, color: '#fff', border: 'none', fontFamily: SANS, fontSize: 13, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', opacity: profileSaving ? 0.55 : 1, cursor: profileSaving ? 'default' : 'pointer' }}>
                  {profileSaving ? 'Saving…' : 'Save profile'}
                </button>
              </div>
            ) : (
              /* ── Main settings view ── */
              <div>
              {/* Account section */}
              <div style={{ fontFamily: SANS, fontSize: 11, fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase', color: INK3, opacity: 0.6, marginBottom: 8 }}>Account</div>
              <div style={{ background: 'rgba(0,0,0,.03)', borderRadius: 14, overflow: 'hidden', marginBottom: 20 }}>
                {[
                  {
                    label: 'My Profile',
                    sub: userRecord?.name ? userRecord.name : 'Name, sizes, gender',
                    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={INK2} strokeWidth="1.7" strokeLinecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>,
                    action: () => openProfileView(),
                  },
                  {
                    label: isPremium ? 'Community Member' : 'Free plan',
                    sub: isPremium ? 'Your plan is active' : 'All features included',
                    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={INK2} strokeWidth="1.7" strokeLinecap="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>,
                    action: undefined,
                    badge: null,
                  },
                ].map(({ label, sub, icon, action, badge }, i, arr) => (
                  <div key={label}>
                    <button onClick={action} disabled={!action}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '13px 14px', background: 'none', border: 'none', cursor: action ? 'pointer' : 'default', textAlign: 'left' }}
                      onPointerDown={e => action && (e.currentTarget.style.background = 'rgba(0,0,0,.05)')}
                      onPointerUp={e => (e.currentTarget.style.background = 'none')}
                      onPointerLeave={e => (e.currentTarget.style.background = 'none')}>
                      <div style={{ flexShrink: 0 }}>{icon}</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontFamily: SANS, fontSize: 14, fontWeight: 500, color: INK }}>{label}</div>
                        <div style={{ fontFamily: SANS, fontSize: 12, color: INK3, marginTop: 1 }}>{sub}</div>
                      </div>
                      {badge && <span style={{ fontFamily: SANS, fontSize: 11, fontWeight: 600, color: '#fff', background: INK, borderRadius: 20, padding: '3px 10px', letterSpacing: '.04em' }}>{badge}</span>}
                      {action && !badge && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={INK3} strokeWidth="1.8" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>}
                    </button>
                    {i < arr.length - 1 && <div style={{ height: '0.5px', background: 'rgba(0,0,0,.08)', margin: '0 14px' }} />}
                  </div>
                ))}
              </div>

              {/* Privacy section */}
              <div style={{ fontFamily: SANS, fontSize: 11, fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase', color: INK3, opacity: 0.6, marginBottom: 8 }}>Privacy</div>
              <div style={{ background: 'rgba(0,0,0,.03)', borderRadius: 14, overflow: 'hidden', marginBottom: 20 }}>
                {[
                  {
                    label: 'Data & Consent',
                    sub: 'Manage what Discern can collect',
                    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={INK2} strokeWidth="1.7" strokeLinecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
                    action: () => { setSettingsOpen(false); setConsentFromSettings(true); setShowConsent(true) },
                  },
                  {
                    label: 'Privacy Policy',
                    sub: 'How Discern handles your data',
                    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={INK2} strokeWidth="1.7" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>,
                    href: '/privacy',
                  },
                ].map(({ label, sub, icon, action, href }: any, i, arr) => (
                  <div key={label}>
                    {href ? (
                      <a href={href} target="_blank" rel="noopener" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 14px', textDecoration: 'none' }}>
                        <div style={{ flexShrink: 0 }}>{icon}</div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontFamily: SANS, fontSize: 14, fontWeight: 500, color: INK }}>{label}</div>
                          <div style={{ fontFamily: SANS, fontSize: 12, color: INK3, marginTop: 1 }}>{sub}</div>
                        </div>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={INK3} strokeWidth="1.8" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
                      </a>
                    ) : (
                      <button onClick={action} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '13px 14px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
                        onPointerDown={e => (e.currentTarget.style.background = 'rgba(0,0,0,.05)')}
                        onPointerUp={e => (e.currentTarget.style.background = 'none')}
                        onPointerLeave={e => (e.currentTarget.style.background = 'none')}>
                        <div style={{ flexShrink: 0 }}>{icon}</div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontFamily: SANS, fontSize: 14, fontWeight: 500, color: INK }}>{label}</div>
                          <div style={{ fontFamily: SANS, fontSize: 12, color: INK3, marginTop: 1 }}>{sub}</div>
                        </div>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={INK3} strokeWidth="1.8" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
                      </button>
                    )}
                    {i < arr.length - 1 && <div style={{ height: '0.5px', background: 'rgba(0,0,0,.08)', margin: '0 14px' }} />}
                  </div>
                ))}
              </div>

              {/* Sign out */}
              <button onClick={() => signOut({ callbackUrl: window.location.origin + '/' })}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '13px 14px', background: 'rgba(0,0,0,.03)', borderRadius: 14, border: 'none', cursor: 'pointer', textAlign: 'left' }}
                onPointerDown={e => (e.currentTarget.style.background = 'rgba(192,57,43,.08)')}
                onPointerUp={e => (e.currentTarget.style.background = 'rgba(0,0,0,.03)')}
                onPointerLeave={e => (e.currentTarget.style.background = 'rgba(0,0,0,.03)')}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#c0392b" strokeWidth="1.7" strokeLinecap="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                <span style={{ fontFamily: SANS, fontSize: 14, fontWeight: 500, color: '#c0392b' }}>Sign out</span>
              </button>

              </div>
            )}
            </div>
          </div>
        </div>
      )}

      {/* ── Shared attach menu — root level, outside transform wrappers ── */}
      <div className="fr-wrap">
        <div className="fr-shell">

          {/* ── Sidebar overlay ── */}
          <div className={`fr-ov ${sidebarOpen ? "open" : ""}`} onClick={() => setSidebar(false)} />

          {/* ── Sidebar ── */}
          <div className={`fr-sb ${sidebarOpen ? "open" : ""}`}>

            {/* Header: Discern logo + avatar */}
            <div style={{
              padding: "clamp(22px,5vw,30px) 20px 14px",
              display: "flex", alignItems: "center", justifyContent: "space-between",
              flexShrink: 0,
            }}>
              <DiscernLogo size={24} color="#000000" showTag={false} />
              <div
                onClick={() => setSettingsOpen(true)}
                style={{
                  width: 38, height: 38, borderRadius: "50%",
                  background: sidebarView === 'profile' ? INK : "#ffffff",
                  boxShadow: "0 4px 16px rgba(0,0,0,.12), 0 1px 4px rgba(0,0,0,.07), inset 0 1px 0 rgba(255,255,255,.95)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  cursor: "pointer", flexShrink: 0, userSelect: "none",
                  overflow: "hidden", transition: "background 0.18s",
                }}>
                {session?.user?.image ? (
                  <img src={session.user.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : hasName ? (
                  <span style={{ fontFamily: SANS, fontSize: 15, fontWeight: 500, color: sidebarView === 'profile' ? '#fff' : INK }}>
                    {(session?.user?.name || userName).charAt(0).toUpperCase()}
                  </span>
                ) : (
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={sidebarView === 'profile' ? '#fff' : INK3} strokeWidth="1.7" strokeLinecap="round">
                    <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
                  </svg>
                )}
              </div>
            </div>

            {/* New chat button */}
            <div style={{ padding: "0 20px 14px", flexShrink: 0 }}>
              <button
                onClick={() => { handleReset(); setSidebarView('nav'); setSidebar(false) }}
                style={{
                  width: "100%", padding: "11px 16px", borderRadius: 12,
                  background: INK, border: "none", cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                  fontFamily: SANS, fontSize: 13, fontWeight: 400, color: "#fff",
                  letterSpacing: ".01em", transition: "opacity .15s",
                }}
                onPointerEnter={e => (e.currentTarget.style.opacity = ".8")}
                onPointerLeave={e => (e.currentTarget.style.opacity = "1")}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
                New chat
              </button>
            </div>

            {/* Fixed nav items — Explore / Brand Collections / Bag */}
            <div style={{ padding: "4px 12px 4px", flexShrink: 0 }}>

              {/* Explore — coming soon */}
              <div className="fr-hi" onClick={() => {
                setSidebar(false)
                setExploreToastOut(false)
                setExploreToast(true)
                setTimeout(() => setExploreToastOut(true), 2200)
                setTimeout(() => setExploreToast(false), 2650)
              }}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={INK3} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5z"/>
                  <path d="M19 3l.8 2.2L22 6l-2.2.8L19 9l-.8-2.2L16 6l2.2-.8z"/>
                  <path d="M5 17l.5 1.5L7 19l-1.5.5L5 21l-.5-1.5L3 19l1.5-.5z"/>
                </svg>
                Explore
              </div>

              {/* Brand Collections — coming soon */}
              <div className="fr-hi" onClick={() => {
                setSidebar(false)
                setExploreToastOut(false)
                setExploreToast(true)
                setTimeout(() => setExploreToastOut(true), 2200)
                setTimeout(() => setExploreToast(false), 2650)
              }}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={INK3} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7" rx="1"/>
                  <rect x="14" y="3" width="7" height="7" rx="1"/>
                  <rect x="3" y="14" width="7" height="7" rx="1"/>
                  <rect x="14" y="14" width="7" height="7" rx="1"/>
                </svg>
                Brand Collections
              </div>

              {/* Bag (saved products) */}
              <div className={`fr-hi${sidebarView === 'saved' ? ' on' : ''}`} onClick={() => setSidebarView(v => v === 'saved' ? 'nav' : 'saved')}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={INK3} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
                  <line x1="3" y1="6" x2="21" y2="6"/>
                  <path d="M16 10a4 4 0 0 1-8 0"/>
                </svg>
                Bag
                {savedProducts.length > 0 && (
                  <span style={{ marginLeft: 'auto', fontFamily: SANS, fontSize: 11, fontWeight: 500, color: INK, background: "rgba(0,0,0,.07)", borderRadius: 20, padding: "2px 8px" }}>
                    {savedProducts.length}
                  </span>
                )}
              </div>

            </div>

            {/* Divider */}
            <div style={{ height: 1, background: "rgba(0,0,0,.06)", margin: "4px 20px 8px", flexShrink: 0 }} />

            {/* Scrollable recents / bag content */}
            <div style={{ flex: 1, overflowY: "auto", scrollbarWidth: "none", padding: "0 12px", overscrollBehaviorY: "contain" }}>
              {sidebarView === 'profile' ? (
                <div style={{ padding: '32px 16px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>

                  {authStatus === 'authenticated' ? (<>
                    {/* Avatar */}
                    <div style={{
                      width: 80, height: 80, borderRadius: '50%', overflow: 'hidden',
                      background: INK, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      marginBottom: 16, flexShrink: 0,
                    }}>
                      {session?.user?.image ? (
                        <img src={session.user.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <span style={{ fontFamily: SANS, fontSize: 28, fontWeight: 500, color: '#fff' }}>
                          {(session?.user?.name || userName || '?').charAt(0).toUpperCase()}
                        </span>
                      )}
                    </div>

                    {/* Name */}
                    <div style={{ fontFamily: SANS, fontSize: 17, fontWeight: 600, color: INK, marginBottom: 4, textAlign: 'center', letterSpacing: '-0.01em' }}>
                      {session?.user?.name || userName || 'Your account'}
                    </div>

                    {/* Email */}
                    <div style={{ fontFamily: SANS, fontSize: 13, color: INK3, textAlign: 'center', opacity: 0.55, marginBottom: 28 }}>
                      {session?.user?.email || ''}
                    </div>

                    {/* Plan badge — only shown for Community members */}
                    {isPremium && (
                      <div style={{
                        padding: '8px 14px', borderRadius: 20, marginBottom: 20,
                        background: 'rgba(60,110,55,0.08)',
                        border: '1px solid rgba(60,110,55,0.18)',
                        display: 'inline-flex', alignItems: 'center', gap: 7,
                      }}>
                        <span style={{ fontFamily: SANS, fontSize: 11, fontWeight: 600, letterSpacing: '.07em', textTransform: 'uppercase', color: '#3d7a3a' }}>
                          Community Member
                        </span>
                      </div>
                    )}

                    {/* Upgrade button — kept for future re-enable */}
                    {false && !isPremium && (
                      <button
                        type="button"
                        onClick={() => { setSidebarView('nav'); setSidebar(false); setShowUpgradeSheet(true) }}
                        style={{
                          width: '100%', padding: '11px 16px', borderRadius: 10,
                          background: INK, border: 'none',
                          fontFamily: SANS, fontSize: 13, fontWeight: 600, color: '#fff',
                          cursor: 'pointer', marginBottom: 10, letterSpacing: '.01em',
                        }}
                      >
                        Join the Community
                      </button>
                    )}

                    {/* Divider */}
                    <div style={{ width: '100%', height: 1, background: 'rgba(0,0,0,0.07)', marginBottom: 16 }} />

                    {/* Sign out */}
                    <button
                      type="button"
                      onClick={() => signOut({ callbackUrl: window.location.origin + '/' })}
                      style={{
                        width: '100%', padding: '11px 16px', borderRadius: 10,
                        background: 'transparent', border: 'none',
                        display: 'flex', alignItems: 'center', gap: 10,
                        fontFamily: SANS, fontSize: 14, fontWeight: 400, color: INK3,
                        cursor: 'pointer', transition: 'background 0.12s',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.05)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                        <polyline points="16 17 21 12 16 7"/>
                        <line x1="21" y1="12" x2="9" y2="12"/>
                      </svg>
                      Sign out
                    </button>
                  </>) : (<>
                    {/* Not signed in — email OTP + Google */}
                    {authUrlError && (
                      <div style={{ fontFamily: SANS, fontSize: 12, color: '#c0392b', background: 'rgba(192,57,43,0.06)', border: '1px solid rgba(192,57,43,0.15)', borderRadius: 8, padding: '10px 12px', marginBottom: 14, lineHeight: 1.5 }}>
                        {authUrlError}
                      </div>
                    )}
                    <div style={{ fontFamily: SANS, fontSize: 15, fontWeight: 500, color: INK, marginBottom: 6, textAlign: 'center' }}>
                      {otpStep === 'code' ? 'Check your email' : 'Sign in'}
                    </div>
                    <div style={{ fontFamily: SANS, fontSize: 13, color: INK3, textAlign: 'center', opacity: 0.55, marginBottom: 22, lineHeight: 1.5 }}>
                      {otpStep === 'code'
                        ? `We sent a 6-digit code to ${otpEmail}`
                        : 'Your saves, sizes, and style — right where you left them.'}
                    </div>

                    {otpStep === 'email' ? (
                      <form onSubmit={async e => {
                        e.preventDefault()
                        if (!otpEmail.trim() || otpSending) return
                        setOtpError(null)
                        setOtpSending(true)
                        try {
                          const r = await fetch('/api/auth/send-code', {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ email: otpEmail.trim() }),
                          })
                          const d = await r.json()
                          if (!r.ok) throw new Error(d.error || 'Failed to send code')
                          setOtpStep('code')
                          setOtpResendIn(60)
                        } catch (err: any) {
                          setOtpError(err.message)
                        } finally {
                          setOtpSending(false)
                        }
                      }}>
                        <input
                          type="email" value={otpEmail} placeholder="your@email.com"
                          onChange={e => setOtpEmail(e.target.value)}
                          autoComplete="email"
                          style={{
                            width: '100%', boxSizing: 'border-box',
                            padding: '11px 14px', borderRadius: 10, marginBottom: 10,
                            border: `1px solid ${BRD}`, fontFamily: SANS, fontSize: 14, color: INK,
                            background: BG2, outline: 'none',
                          }}
                        />
                        {otpError && (
                          <div style={{ fontFamily: SANS, fontSize: 12, color: '#c0392b', marginBottom: 10 }}>{otpError}</div>
                        )}
                        <button type="submit" disabled={otpSending || !otpEmail.trim()} style={{
                          width: '100%', padding: '12px', borderRadius: 10, marginBottom: 10,
                          background: INK, color: '#fff', border: 'none', cursor: otpSending ? 'default' : 'pointer',
                          fontFamily: SANS, fontSize: 14, fontWeight: 600, opacity: otpSending || !otpEmail.trim() ? 0.5 : 1,
                        }}>
                          {otpSending ? 'Sending…' : 'Continue with email'}
                        </button>
                      </form>
                    ) : (
                      <form onSubmit={async e => {
                        e.preventDefault()
                        if (!otpCode.trim() || otpVerifying) return
                        setOtpError(null)
                        setOtpVerifying(true)
                        try {
                          const result = await signIn('email-otp', {
                            email: otpEmail.trim(),
                            code: otpCode.trim(),
                            redirect: false,
                          })
                          if (result?.error) throw new Error(
                            result.error === 'CredentialsSignin' ? 'Invalid or expired code, try again' : `Sign-in failed: ${result.error}`
                          )
                          setOtpStep('email')
                          setOtpCode('')
                        } catch (err: any) {
                          setOtpError(err.message)
                        } finally {
                          setOtpVerifying(false)
                        }
                      }}>
                        <div style={{ marginBottom: 10 }}>
                          <OtpBoxInput value={otpCode} onChange={setOtpCode} autoFocus boxSize={34} />
                        </div>
                        {otpError && (
                          <div style={{ fontFamily: SANS, fontSize: 12, color: '#c0392b', marginBottom: 10 }}>{otpError}</div>
                        )}
                        <button type="submit" disabled={otpCode.length < 6 || otpVerifying} style={{
                          width: '100%', padding: '12px', borderRadius: 10, marginBottom: 10,
                          background: INK, color: '#fff', border: 'none', cursor: otpCode.length < 6 || otpVerifying ? 'default' : 'pointer',
                          fontFamily: SANS, fontSize: 14, fontWeight: 600, opacity: otpCode.length < 6 || otpVerifying ? 0.5 : 1,
                        }}>
                          {otpVerifying ? 'Verifying…' : 'Verify code'}
                        </button>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                          <button type="button" onClick={() => { setOtpStep('email'); setOtpCode(''); setOtpError(null) }}
                            style={{ background: 'none', border: 'none', fontFamily: SANS, fontSize: 12, color: INK3, cursor: 'pointer', padding: 0 }}>
                            ← Change email
                          </button>
                          <button type="button" disabled={otpResendIn > 0} onClick={async () => {
                            if (otpResendIn > 0) return
                            setOtpError(null)
                            setOtpSending(true)
                            try {
                              const r = await fetch('/api/auth/send-code', {
                                method: 'POST', headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ email: otpEmail.trim() }),
                              })
                              const d = await r.json()
                              if (!r.ok) throw new Error(d.error || 'Failed')
                              setOtpResendIn(60)
                            } catch (err: any) {
                              setOtpError(err.message)
                            } finally {
                              setOtpSending(false)
                            }
                          }} style={{ background: 'none', border: 'none', fontFamily: SANS, fontSize: 12, color: otpResendIn > 0 ? INK3 : INK, cursor: otpResendIn > 0 ? 'default' : 'pointer', padding: 0, opacity: otpResendIn > 0 ? 0.45 : 1 }}>
                            {otpResendIn > 0 ? `Resend in ${otpResendIn}s` : 'Resend code'}
                          </button>
                        </div>
                      </form>
                    )}

                    {/* Divider */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '4px 0 12px' }}>
                      <div style={{ flex: 1, height: 1, background: BRD }} />
                      <span style={{ fontFamily: SANS, fontSize: 11, color: INK3, opacity: 0.5 }}>or</span>
                      <div style={{ flex: 1, height: 1, background: BRD }} />
                    </div>

                    {/* Google */}
                    <button
                      type="button"
                      onClick={() => signIn('google', { callbackUrl: window.location.origin + '/' })}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9,
                        padding: '11px 16px', borderRadius: 10,
                        background: 'rgba(0,0,0,0.04)', border: '1px solid rgba(0,0,0,0.08)',
                        fontFamily: SANS, fontSize: 14, fontWeight: 400, color: INK,
                        cursor: 'pointer', transition: 'background 0.12s',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.08)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.04)')}
                    >
                      <svg width="16" height="16" viewBox="0 0 18 18" style={{ flexShrink: 0 }}>
                        <path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18z"/>
                        <path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2a4.8 4.8 0 0 1-7.18-2.54H1.83v2.07A8 8 0 0 0 8.98 17z"/>
                        <path fill="#FBBC05" d="M4.5 10.52a4.8 4.8 0 0 1 0-3.04V5.41H1.83a8 8 0 0 0 0 7.18z"/>
                        <path fill="#EA4335" d="M8.98 4.18c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 0 0 1.83 5.4L4.5 7.49a4.77 4.77 0 0 1 4.48-3.31z"/>
                      </svg>
                      Continue with Google
                    </button>
                  </>)}

                </div>
              ) : sidebarView === 'nav' ? (
                <>
                  <p style={{ fontFamily: SANS, fontSize: 10, fontWeight: 500, letterSpacing: ".14em", textTransform: "uppercase", color: INK3, padding: "2px 8px 10px", opacity: .5 }}>Recent</p>
                  {stylistHistory.length === 0 ? (
                    <div style={{ padding: '12px 8px 4px' }}>
                      <p style={{ fontFamily: SANS, fontSize: 13, color: INK3, opacity: .45, marginBottom: 8 }}>No conversations yet!</p>
                      <p style={{ fontFamily: SANS, fontSize: 12, color: INK3, opacity: .35, lineHeight: 1.5 }}>Ask Fabrics to find, style, or compare anything — it'll show up here.</p>
                    </div>
                  ) : stylistHistory.map(h => (
                    <div key={h.id} className="fr-hi"
                      style={{ userSelect: 'none', WebkitUserSelect: 'none' } as React.CSSProperties}
                      onContextMenu={e => e.preventDefault()}
                      onClick={() => {
                        if (wasLongPress.current) { wasLongPress.current = false; return }
                        if (stylistSessionId.current !== h.id) {
                          // Restore this session's messages from localStorage
                          let restored: StylistMsg[] = []
                          try {
                            const raw = localStorage.getItem(stylistSessionLS(h.id))
                            restored = parseStylistMsgs(raw)
                          } catch { restored = [] }
                          setStylistMsgs(restored)
                          // Treat every restored message as already-typed. Without
                          // this, the typewriter re-animates the WHOLE history at
                          // once (each reply typing simultaneously, all fighting to
                          // scroll to the bottom), which reads as the app glitching.
                          initialStylistMsgCount.current = restored.length
                          typedStylistIndices.current = new Set(restored.map((_, i) => i))
                          // Per-message UI state belongs to the session we just
                          // left: an open editor or expanded trace at index N would
                          // otherwise reattach to a DIFFERENT message here, and
                          // "Save & resend" would truncate the new conversation.
                          setEditingMsgIndex(null)
                          setOpenTraceIdx(null)
                          stylistSessionId.current = h.id
                          try { localStorage.setItem(STYLIST_ACTIVE_SESSION_LS, h.id) } catch {}
                          setStylistProducts([])
                        }
                        setSidebar(false)
                      }}
                      onPointerDown={e => {
                        wasLongPress.current = false
                        const { clientX, clientY } = e
                        longPressTimer.current = setTimeout(() => {
                          wasLongPress.current = true
                          const menuW = 180; const menuH = 96
                          const above = clientY + 8 + menuH > window.innerHeight
                          const y = Math.max(8, above ? clientY - menuH - 4 : clientY + 8)
                          const x = Math.max(8, Math.min(clientX, window.innerWidth - menuW - 8))
                          ctxMenuOpenAt.current = Date.now()
                          setStylistCtxMenu({ id: h.id, label: h.label, x, y, above })
                        }, 550)
                      }}
                      onPointerUp={() => { if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null } }}
                      onPointerLeave={() => { if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null } }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                        <defs><clipPath id="fwcs"><circle cx="12" cy="12" r="9.6"/></clipPath></defs>
                        <circle cx="12" cy="12" r="9.6" stroke={INK3} strokeWidth="1.3" fill="none"/>
                        <g clipPath="url(#fwcs)" stroke={INK3} strokeWidth="1.05" strokeLinecap="butt">
                          <line x1="2.4" y1="8" x2="21.6" y2="8"/><line x1="2.4" y1="12" x2="21.6" y2="12"/><line x1="2.4" y1="16" x2="21.6" y2="16"/>
                          <line x1="8" y1="2.4" x2="8" y2="21.6"/><line x1="12" y1="2.4" x2="12" y2="21.6"/><line x1="16" y1="2.4" x2="16" y2="21.6"/>
                        </g>
                      </svg>
                      {stylistRenameId === h.id
                        ? <input ref={stylistRenameRef} value={stylistRenameVal}
                            onClick={e => e.stopPropagation()}
                            onChange={e => setStylistRenameVal(e.target.value)}
                            onBlur={() => { if (stylistRenameVal.trim()) renameStylistEntry(h.id, stylistRenameVal.trim()); setStylistRenameId(null) }}
                            onKeyDown={e => {
                              e.stopPropagation()
                              if (e.key === 'Enter') { if (stylistRenameVal.trim()) renameStylistEntry(h.id, stylistRenameVal.trim()); setStylistRenameId(null) }
                              if (e.key === 'Escape') setStylistRenameId(null)
                            }}
                            style={{ flex: 1, background: 'transparent', border: 'none', borderBottom: `1px solid ${INK3}`,
                              fontFamily: SANS, fontSize: 16, color: INK, outline: 'none', padding: '1px 0', minWidth: 0,
                              transform: 'scale(0.8125)', transformOrigin: 'left center' }}
                          />
                        : <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.label}</span>
                      }
                    </div>
                  ))}
                </>
              ) : (
                <>
                  <p style={{ fontFamily: SANS, fontSize: 10, fontWeight: 500, letterSpacing: ".14em", textTransform: "uppercase", color: INK3, padding: "2px 8px 10px", opacity: .5 }}>Bag</p>
                  {savedProducts.length === 0
                    ? <p style={{ fontFamily: SANS, fontSize: 13, color: INK3, padding: "4px 8px", opacity: .4 }}>Nothing saved yet</p>
                    : savedProducts.map(p => (
                        <div key={p.id} className="fr-hi"
                          style={{ gap: 10, userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' } as React.CSSProperties}
                          {...makePressHandlers((x, y) => {
                            wasLongPress.current = true
                            const menuW = 190; const menuH = 90
                            const above = y + 8 + menuH > window.innerHeight
                            const my = Math.max(8, above ? y - menuH - 4 : y + 8)
                            const mx = Math.max(8, Math.min(x, window.innerWidth - menuW - 8))
                            ctxMenuOpenAt.current = Date.now()
                            setBagCtxMenu({ product: p, x: mx, y: my, above })
                          })}
                          onClick={() => {
                            if (wasLongPress.current) { wasLongPress.current = false; return }
                            setSelected(p); setSidebar(false)
                          }}
                        >
                          <div style={{ width: 34, height: 42, borderRadius: 7, overflow: 'hidden', flexShrink: 0, background: '#e8e8e8' }}>
                            {p.image_url && <img src={p.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontFamily: SANS, fontSize: 13, fontWeight: 500, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</div>
                            <div style={{ fontFamily: SANS, fontSize: 11, color: INK3, marginTop: 2 }}>{formatMoney(p.price, p.currency, p.base_currency, liveRates)}</div>
                          </div>
                        </div>
                      ))
                  }
                </>
              )}
            </div>

          </div>

          {/* ── Header ── */}
          <div className="fr-header">
            {/* Left: hamburger + logo */}
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button onClick={() => setSidebar(true)} style={{
                width: 36, height: 36, borderRadius: "50%", border: "none",
                background: "#ffffff",
                boxShadow: "0 2px 8px rgba(0,0,0,.10), inset 0 1px 0 rgba(255,255,255,.95)",
                display: "flex", flexDirection: "column", alignItems: "flex-start",
                justifyContent: "center", gap: 4.5, padding: "8px 9px", cursor: "pointer",
                transition: "box-shadow .15s, transform .1s", flexShrink: 0,
              }}
                onPointerEnter={e => { e.currentTarget.style.boxShadow = "0 4px 14px rgba(0,0,0,.14), inset 0 1px 0 #fff"; e.currentTarget.style.transform = "translateY(-0.5px)" }}
                onPointerLeave={e => { e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,.10), inset 0 1px 0 rgba(255,255,255,.95)"; e.currentTarget.style.transform = "" }}
              >
                <span style={{ display: "block", width: 16, height: 1.5, background: INK, borderRadius: 1 }} />
                <span style={{ display: "block", width: 12, height: 1.5, background: INK, borderRadius: 1 }} />
              </button>
              <div onClick={() => { handleReset(); setShowExplore(false) }} style={{ cursor: 'pointer' }}>
                <DiscernLogo size={22} color="#000000" />
              </div>
            </div>
            {/* Right: compose / new chat */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                onClick={() => handleReset()}
                style={{
                  width: 36, height: 36, borderRadius: "50%", border: "none",
                  background: "#ffffff",
                  boxShadow: "0 2px 8px rgba(0,0,0,.10), inset 0 1px 0 rgba(255,255,255,.95)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  cursor: "pointer", flexShrink: 0, transition: "box-shadow .15s",
                }}
                onPointerEnter={e => (e.currentTarget.style.boxShadow = "0 4px 14px rgba(0,0,0,.14), inset 0 1px 0 #fff")}
                onPointerLeave={e => (e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,.10), inset 0 1px 0 rgba(255,255,255,.95)")}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 20h9"/>
                  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
                </svg>
              </button>
            </div>
          </div>

          {/* ── Content (body + floating bar share this space) ── */}
          <div className="fr-content">

          {/* ── Body ── */}
          {/* Explore uses the normal scrolling body (not the fixed `.home` layout,
              which disables scroll and adds the big top padding). */}
          <div className={`fr-body${hasConversation || showExplore ? '' : ' home'}`}
            ref={stylistScrollRef}
            onTouchStart={showExplore ? (e => {
              if (e.currentTarget.scrollTop <= 0 && !pullRefreshing) {
                pullStartY.current = e.touches[0].clientY; pulling.current = true
              } else pulling.current = false
            }) : undefined}
            onTouchMove={showExplore ? (e => {
              if (!pulling.current) return
              const dy = e.touches[0].clientY - pullStartY.current
              if (dy > 0 && e.currentTarget.scrollTop <= 0) setPullY(Math.min(dy * 0.5, 90))
              else { setPullY(0); if (e.currentTarget.scrollTop > 0) pulling.current = false }
            }) : undefined}
            onTouchEnd={showExplore ? (() => {
              if (!pulling.current) return
              pulling.current = false
              if (pullY >= 56) {
                setPullY(0)
                setPullRefreshing(true)
                refreshExplore().finally(() => setPullRefreshing(false))
              } else setPullY(0)
            }) : undefined}>

            {/* Pull-to-refresh spinner — sits in the space the pull opens at the
                top of the feed, spins while loading, then collapses + fades out. */}
            {showExplore && (
              <div style={{
                height: pullRefreshing ? 50 : pullY,
                overflow: 'hidden', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: pulling.current ? 'none' : 'height .32s cubic-bezier(.22,.61,.36,1)',
              }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={INK3} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  style={{
                    opacity: pullRefreshing ? 1 : Math.min(1, pullY / 56),
                    animation: pullRefreshing ? 'spin .7s linear infinite' : 'none',
                    transform: pullRefreshing ? 'none' : `rotate(${pullY * 4}deg)`,
                  }}>
                  <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                </svg>
              </div>
            )}

            {/* Greeting — home screen only, not on Explore */}
            {!hasConversation && !showExplore && <div className={`fr-greet${loaded ? ' in' : ''}`}>
              {(() => {
                const greetName = isEditingName ? (nameInput || "your name") : (hasName ? userName : "your name")
                // Scale "Hello, " fluidly from 72px (phone) up to 140px (large desktop).
                // windowWidth is 0 until after mount; fall back to 72px for SSR.
                const helloPx = windowWidth > 0
                  ? Math.min(140, Math.max(72, Math.round(windowWidth * 0.1)))
                  : 72
                // Name scales proportionally: same ratio as original (150 target-width / 0.52 char-width)
                // but now referenced to helloPx so it grows with the heading.
                const namePx = Math.min(helloPx, Math.max(20, Math.floor(helloPx * 2.08 / (Math.max(1, greetName.length) * 0.52))))
                return (
                <div style={{ fontFamily: SERIF, lineHeight: 1.08, letterSpacing: "-.02em", marginBottom: 10,
                  display: "flex", alignItems: "baseline", flexWrap: "nowrap", overflow: "hidden" }}>
                  <span style={{ fontWeight: 300, color: INK, fontSize: helloPx, flexShrink: 0, whiteSpace: "nowrap" }}>Hello,&nbsp;</span>
                  {isEditingName ? (
                    <input ref={nameRef} value={nameInput}
                      onChange={e => setNameInput(e.target.value)}
                      onBlur={saveName}
                      onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') { setNameInput(''); setIsEditing(false) } }}
                      maxLength={22} placeholder="your name"
                      style={{ fontFamily: SERIF, fontSize: namePx, fontWeight: 400, fontStyle: "italic", color: INK,
                        background: "transparent", border: "none",
                        borderBottom: `1.5px dashed ${INK}`,
                        paddingBottom: 1, letterSpacing: "-.02em", outline: "none",
                        width: `${Math.max(3, (nameInput.length || 8)) * 0.52}em`,
                        minWidth: 0, flexShrink: 1 }}
                    />
                  ) : (
                    <span onClick={() => { setNameInput(userName); setIsEditing(true) }}
                      style={{ fontFamily: SERIF, fontSize: namePx, fontWeight: 400, fontStyle: "italic", cursor: "pointer",
                        color: hasName ? INK : INK3,
                        borderBottom: `1.5px dashed ${hasName ? INK : 'rgba(0,0,0,.3)'}`,
                        paddingBottom: 1, minWidth: 0, flexShrink: 1 }}>
                      {hasName ? userName : "your name"}
                    </span>
                  )}
                </div>
                )
              })()}
              <p style={{
                fontFamily: SANS,
                fontSize: "clamp(8.5px,2.2vw,13px)",
                letterSpacing: ".06em",
                textTransform: "uppercase", color: INK3, lineHeight: 1.7,
                maxWidth: "95vw",
                minHeight: "1.7em",
                whiteSpace: "nowrap",
                overflow: "hidden",
                opacity: tagVis ? .5 : 0,
                transition: tagVis ? "opacity .42s ease" : "opacity .3s linear",
              }}>
                {tagText}
              </p>
            </div>
            }


            {/* Explore — random Instagram-style product feed */}
            {showExplore && (
              exploreFeed.length > 0 ? (
                <div className="fr-mosaic">
                  {exploreFeed.map((p, i) => (
                    <ExploreTile key={p.id} p={p}
                      animDelay={`${Math.min(i * 0.02, 0.4)}s`}
                      pressHandlers={makePressHandlers((x, y) => {
                        productWasLong.current = true
                        const menuW = 200; const menuH = 160
                        const above = y + 8 + menuH > window.innerHeight
                        const my = Math.max(8, above ? y - menuH - 4 : y + 8)
                        const mx = Math.max(8, Math.min(x, window.innerWidth - menuW - 8))
                        ctxMenuOpenAt.current = Date.now()
                        setProductCtxMenu({ product: p, x: mx, y: my, above })
                      })}
                      onOpen={() => { if (productWasLong.current) { productWasLong.current = false; return }; setSelected(p) }}
                    />
                  ))}
                  {exploreHasMore && <div ref={exploreSentinelRef} style={{ gridColumn: '1 / -1', height: 1 }} />}
                  {exploreFeedLoading && exploreFeed.length > 0 && (
                    <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 5, padding: '18px 0 28px' }}>
                      <span className="fr-dot" /><span className="fr-dot" /><span className="fr-dot" />
                    </div>
                  )}
                </div>
              ) : exploreFeedLoading && exploreFeed.length === 0 ? (
                <div className="fr-mosaic">
                  {Array.from({ length: 18 }).map((_, i) => (
                    <div key={i} className="fr-mtile sk-sweep" />
                  ))}
                </div>
              ) : (
                <div style={{ padding: "60px 28px", textAlign: "center" }}>
                  <p style={{ fontFamily: SERIF, fontSize: 20, fontWeight: 300, fontStyle: "italic", color: INK3, lineHeight: 1.5 }}>Couldn’t load the feed</p>
                  <span style={{ fontFamily: SANS, fontSize: 11, color: INK3, letterSpacing: ".1em", display: "block", marginTop: 8, opacity: .5 }}>Open Explore again to retry</span>
                </div>
              )
            )}

            {/* Brand profile header — shown when viewing a brand's catalog */}
            {activeBrand && (hasConversation || loading) && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '22px 24px 18px', gap: 10 }}>
                <BrandLogo domain={activeBrand.domain} name={activeBrand.name} size={64} />
                <div>
                  <h2 style={{ fontFamily: SEASON, fontSize: 'clamp(22px,6vw,28px)', fontWeight: 400, color: INK, letterSpacing: '.01em', lineHeight: 1.1 }}>{activeBrand.name}</h2>
                  <p style={{ fontFamily: SANS, fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: INK3, marginTop: 6 }}>
                    {loading ? 'Loading collection…' : `${searchProducts.length} ${searchProducts.length === 1 ? 'piece' : 'pieces'}`}
                  </p>
                </div>
                <div style={{ width: 36, height: 1, background: BRD, marginTop: 2 }} />
              </div>
            )}

            {/* Fabrics conversation — the one shopping surface, no separate grid search */}
            {hasConversation && !showExplore && (
              <div style={{ padding: '4px 20px 0' }}>
                {/* Pinned products now render just above the input bar (a compose
                    staging strip), and inline with the user message that asked
                    about them — never as a floating banner at the top of the
                    thread, which read as disconnected from the query. */}

                {/* Conversation thread */}
                {stylistMsgs.map((m, i) => (
                  <div key={i} style={{ marginBottom: 22, display: 'flex', flexDirection: 'column', alignItems: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                    {m.role === 'user' && editingMsgIndex === i ? (
                      <div style={{ width: '100%', maxWidth: 340 }}>
                        {editImages.length > 0 && (
                          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', justifyContent: 'flex-end', marginBottom: 6 }}>
                            {editImages.map((url, ii) => (
                              <div key={ii} style={{ position: 'relative', flexShrink: 0 }}>
                                <div style={{ width: 48, height: 48, borderRadius: 8, overflow: 'hidden', background: BG2, border: `1px solid ${BRD}` }}>
                                  <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                                </div>
                                {/* Remove only — an edit can drop a photo, never add a new one */}
                                <button type="button" onClick={() => setEditImages(prev => prev.filter((_, x) => x !== ii))}
                                  style={{ position: 'absolute', top: -5, right: -5, width: 18, height: 18, borderRadius: '50%', background: INK, border: '1.5px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 }}>
                                  <svg width="8" height="8" viewBox="0 0 10 10" fill="none"><path d="M2 2l6 6M8 2l-6 6" stroke="white" strokeWidth="1.8" strokeLinecap="round"/></svg>
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                        <textarea value={editText} onChange={e => setEditText(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEditMsg(i) } if (e.key === 'Escape') cancelEditMsg() }}
                          autoFocus rows={2}
                          // 16px, not 14 — iOS Safari force-zooms the viewport
                          // when a focused field is under 16px, and there's no
                          // clean way to zoom back out. 16px keeps focus put on
                          // every device (the main composer already uses 16 for
                          // the same reason).
                          style={{ width: '100%', fontFamily: SANS, fontSize: 16, lineHeight: 1.5, color: INK,
                            background: BG2, border: `1px solid ${BRD}`, borderRadius: 12, padding: '9px 14px',
                            resize: 'none', outline: 'none' }} />
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 6 }}>
                          <button type="button" onClick={cancelEditMsg}
                            style={{ fontFamily: SANS, fontSize: 11.5, fontWeight: 500, color: INK3, background: 'none', border: 'none', cursor: 'pointer', padding: '6px 10px' }}>
                            Cancel
                          </button>
                          <button type="button" onClick={() => saveEditMsg(i)} disabled={!editText.trim() && editImages.length === 0}
                            style={{ fontFamily: SANS, fontSize: 11.5, fontWeight: 600, color: '#fff', background: INK, border: 'none',
                              borderRadius: 20, cursor: 'pointer', padding: '7px 14px', opacity: (!editText.trim() && editImages.length === 0) ? .5 : 1 }}>
                            Save &amp; resend
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {m.role === 'user' && m.pinnedProducts && m.pinnedProducts.length > 0 && (
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end', marginBottom: 6, maxWidth: '88%' }}>
                            {m.pinnedProducts.map(p => (
                              <div key={p.id} onClick={() => setSelected(p)} style={{ width: 46, height: 58, borderRadius: 8, overflow: 'hidden', background: BG2, border: `1px solid ${BRD}`, cursor: 'pointer', flexShrink: 0 }}>
                                {getProductImages(p)[0] && <img src={getProductImages(p)[0]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
                              </div>
                            ))}
                          </div>
                        )}
                        {m.role === 'user' && m.images && m.images.length > 0 && (
                          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', justifyContent: 'flex-end', marginBottom: 6, maxWidth: '88%' }}>
                            {m.images.map((url, ii) => (
                              <div key={ii} style={{ width: 48, height: 48, borderRadius: 8, overflow: 'hidden', background: BG2, border: `1px solid ${BRD}` }}>
                                <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                              </div>
                            ))}
                          </div>
                        )}
                        <div className={m.role === 'user' ? 'fr-msg-hover' : undefined} style={{ display: 'flex', flexDirection: 'column', alignItems: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: m.role === 'assistant' ? 'min(88%, 680px)' : '88%' }}>
                          <div style={{ fontFamily: SANS, fontSize: 14, lineHeight: 1.6, letterSpacing: '-0.003em',
                            padding: m.role === 'user' ? '10px 15px' : 0,
                            background: m.role === 'user' ? INK : 'transparent',
                            color: m.role === 'user' ? '#fff' : INK2,
                            borderRadius: m.role === 'user' ? '18px 18px 5px 18px' : 0,
                            whiteSpace: 'pre-wrap', minWidth: 0 }}>
                            {m.role === 'assistant'
                              ? (m.busy
                                  ? <span className="fr-shine">{m.content}</span>
                                  : <TypewriterText text={m.content} products={(m.pinnedProducts && m.pinnedProducts.length > 0) ? m.pinnedProducts : (m.foundProducts && m.foundProducts.length > 0) ? m.foundProducts : stylistProducts} liveRates={liveRates}
                                      photos={stylistMsgs[i - 1]?.images}
                                      onProductClick={(p) => setSelected(p)}
                                      animate={i >= initialStylistMsgCount.current && !typedStylistIndices.current.has(i)}
                                      onReveal={stickStylistToBottom}
                                      onDone={() => { typedStylistIndices.current.add(i) }} />)
                              : m.content}
                          </div>
                          {m.role === 'user' && (
                            <button type="button" onClick={() => startEditMsg(i, m)} title="Edit message" className="fr-msg-edit-btn"
                              style={{ marginTop: 4, flexShrink: 0, width: 22, height: 22, padding: 0, border: 'none', background: 'none',
                                cursor: 'pointer', color: INK3, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                              </svg>
                            </button>
                          )}
                        </div>
                      </>
                    )}
                    {/* Persisted reasoning trace — the steps the live tracker showed
                        while this reply was produced, reviewable after the fact.
                        Collapsed to one quiet line; expands to a read-only version
                        of the same step layout (all steps in their "done" state). */}
                    {m.role === 'assistant' && m.trace && m.trace.length > 0 && (
                      <div style={{ marginTop: 6, width: '100%' }}>
                        <button type="button" onClick={() => setOpenTraceIdx(openTraceIdx === i ? null : i)}
                          style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', padding: '2px 0', cursor: 'pointer', fontFamily: SANS, fontSize: 11, fontWeight: 500, color: INK3 }}>
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
                            style={{ transform: openTraceIdx === i ? 'rotate(90deg)' : 'none', transition: 'transform .18s ease' }}>
                            <polyline points="9 18 15 12 9 6" />
                          </svg>
                          {openTraceIdx === i ? 'Hide reasoning' : `Show reasoning · ${m.trace.length} steps`}
                        </button>
                        {openTraceIdx === i && (
                          <div style={{ padding: '8px 2px 2px', animation: 'fadeUp .18s ease' }}>
                            {m.trace.map((phase, pi) => {
                              const isLast = pi === m.trace!.length - 1
                              return (
                                <div key={pi} style={{ display: 'flex', gap: 10 }}>
                                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                                    <div style={{ width: 16, height: 16, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.05)', color: 'rgba(0,0,0,.45)' }}>
                                      <StylistStepIcon icon={phase.icon} size={9} />
                                    </div>
                                    {!isLast && <div style={{ width: 1, flex: 1, minHeight: 10, marginTop: 2, marginBottom: 2, background: 'rgba(0,0,0,.1)' }} />}
                                  </div>
                                  <div style={{ paddingBottom: isLast ? 0 : 10, minWidth: 0 }}>
                                    <div style={{ fontFamily: SANS, fontSize: 11.5, fontWeight: 500, lineHeight: '16px', color: INK3 }}>{phase.main}</div>
                                    {phase.trace.length > 0 && (
                                      <div style={{ marginTop: 3 }}>
                                        {phase.trace.map((line, li) => (
                                          <div key={li} style={{ fontFamily: "'SF Mono',ui-monospace,Menlo,Consolas,monospace", fontSize: 10, lineHeight: '15px', color: 'rgba(0,0,0,.42)' }}>{line}</div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )}
                    {m.comparison && m.comparison.rows.length > 0 && (
                      <div style={{ marginTop: 10, width: '100%', maxWidth: 480, border: `1px solid ${BRD}`, borderRadius: 12, overflow: 'hidden' }}>
                        <div style={{ display: 'flex', borderBottom: `1px solid ${BRD}` }}>
                          <div style={{ width: 88, flexShrink: 0 }} />
                          {(m.comparisonProducts ?? stylistProducts).map((p, ci) => (
                            <div key={p.id} style={{ flex: 1, padding: '8px 4px', textAlign: 'center', borderLeft: `1px solid ${BRD}`, background: m.comparison!.pick?.index === ci ? 'rgba(0,0,0,0.05)' : 'transparent' }}>
                              <div style={{ fontFamily: SANS, fontSize: 9, fontWeight: 500, color: INK2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '0 3px', lineHeight: 1.3 }}>
                                {p.title.replace(/^\d[\d\s\-–—]*/, '').trim().split(' ').slice(0, 3).join(' ') || `${ci + 1}`}
                              </div>
                              {m.comparison!.pick?.index === ci && (
                                <div style={{ display: 'inline-block', fontFamily: SANS, fontSize: 7, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: '#fff', marginTop: 4, background: INK, borderRadius: 3, padding: '2px 5px' }}>★ Pick</div>
                              )}
                            </div>
                          ))}
                        </div>
                        {m.comparison.rows.map((row, ri) => (
                          <div key={ri} style={{ display: 'flex', borderBottom: ri < m.comparison!.rows.length - 1 ? `1px solid ${BRD}` : 'none' }}>
                            <div style={{ width: 88, flexShrink: 0, padding: '9px 10px', fontFamily: SANS, fontSize: 10, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: INK3 }}>{row.label}</div>
                            {(m.comparisonProducts ?? stylistProducts).map((p, ci) => (
                              <div key={ci} style={{ flex: 1, padding: '9px 8px', textAlign: 'center', fontFamily: SANS, fontSize: 12, color: INK2, borderLeft: `1px solid ${BRD}`, background: m.comparison!.pick?.index === ci ? 'rgba(0,0,0,0.05)' : 'transparent' }}>
                                {row.values[ci] ?? '—'}
                              </div>
                            ))}
                          </div>
                        ))}
                        {m.comparison.pick?.reason && (m.comparisonProducts ?? stylistProducts)[m.comparison.pick.index] && (
                          <div style={{ padding: '10px 12px', fontFamily: SANS, fontSize: 12, color: INK2, lineHeight: 1.5, background: 'rgba(0,0,0,0.03)', borderTop: `1px solid ${BRD}` }}>
                            <strong style={{ fontWeight: 600 }}>{(m.comparisonProducts ?? stylistProducts)[m.comparison.pick.index].title}:</strong> {m.comparison.pick.reason}
                          </div>
                        )}
                      </div>
                    )}
                    {/* The picked product itself — tappable, so the shopper can open,
                        save, or buy the one Fabrics chose, not just read its name. */}
                    {m.comparison && m.comparison.pick && (m.comparisonProducts ?? stylistProducts)[m.comparison.pick.index] && (
                      <div style={{ marginTop: 10, width: '100%', maxWidth: 480 }}>
                        <div style={{ fontFamily: SANS, fontSize: 10, fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase', color: INK3, marginBottom: 8 }}>Fabrics&rsquo; pick</div>
                        <div style={{ display: 'flex' }}>
                          {renderFoundProductCard((m.comparisonProducts ?? stylistProducts)[m.comparison.pick.index])}
                        </div>
                      </div>
                    )}
                    {m.role === 'assistant' && m.foundProductGroups && m.foundProductGroups.length > 0 && (
                      <div style={{ marginTop: 10, width: '100%' }}>
                        {/* One labeled strip per requested category (e.g. "shirts and
                            shorts" → Tops, then Bottoms) — each already the curated
                            best-of-best for that category, not the flat combined list. */}
                        {m.foundProductGroups.map((group, gi) => (
                          <div key={gi} style={{ marginTop: gi > 0 ? 14 : 0 }}>
                            <div style={{ fontFamily: SANS, fontSize: 10, fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase', color: INK3, marginBottom: 8 }}>{group.label}</div>
                            {/* Horizontal slide per category — one swipeable row,
                                not a two-column grid. Each "See more" lands as a
                                NEW slide/row below (see `batches`), so the same
                                category stacks fresh rows instead of endlessly
                                extending one strip. Consistent on every device. */}
                            {(() => {
                              const gb = group.batches && group.batches.length > 0 ? group.batches : [group.products.length]
                              const rows: Product[][] = []
                              let off = 0
                              for (const size of gb) { rows.push(group.products.slice(off, off + size)); off += size }
                              return rows.map((row, ri) => (
                                <div key={ri} style={{ display: 'flex', gap: 8, overflowX: 'auto', scrollbarWidth: 'none', paddingBottom: 2, marginTop: ri > 0 ? 10 : 0, WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>
                                  {row.map(p => renderFoundProductCard(p, m.searchQuery))}
                                </div>
                              ))
                            })()}
                            {group.query && !group.hasNoMore && (
                              group.loadingMore ? (
                                <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, padding: '9px 2px' }}>
                                  <span className="fr-node-active" style={{ position: 'relative', width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: INK }}>
                                    <span className="fr-ring2" style={{ position: 'absolute', inset: 0, width: 20, height: 20 }} />
                                    <StylistStepIcon icon={(loadMorePhases[loadMorePhases.length - 1]?.icon) ?? 'search'} size={10} />
                                  </span>
                                  <span style={{ fontFamily: SANS, fontSize: 12, color: INK2 }}>{loadMorePhases[loadMorePhases.length - 1]?.main ?? 'Searching for more'}</span>
                                </div>
                              ) : (
                                <button type="button" onClick={() => loadMoreGroupProducts(i, gi)}
                                  style={{ marginTop: 10, width: '100%', padding: '9px', borderRadius: 10, border: `1px solid ${BRD}`,
                                    background: 'transparent', fontFamily: SANS, fontSize: 11.5, fontWeight: 500, letterSpacing: '.04em',
                                    textTransform: 'uppercase', color: INK2, cursor: 'pointer' }}>
                                  See more {group.label.toLowerCase()}
                                </button>
                              )
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {m.role === 'assistant' && !m.foundProductGroups && m.foundProducts && m.foundProducts.length > 0 && (
                      <div style={{ marginTop: 10, width: '100%' }}>
                        <div style={{ fontFamily: SANS, fontSize: 10, fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase', color: INK3, marginBottom: 8 }}>Found for you</div>
                        {/* One row per "See more" batch — each fetch lands on its own
                            line instead of endlessly extending one horizontal strip. */}
                        {(() => {
                          const batches = m.foundProductBatches && m.foundProductBatches.length > 0
                            ? m.foundProductBatches
                            : [m.foundProducts!.length]
                          const rows: Product[][] = []
                          let offset = 0
                          for (const size of batches) {
                            rows.push(m.foundProducts!.slice(offset, offset + size))
                            offset += size
                          }
                          return rows.map((row, ri) => (
                            <div key={ri} style={{ display: 'flex', gap: 8, overflowX: 'auto', scrollbarWidth: 'none', paddingBottom: 2, marginTop: ri > 0 ? 10 : 0 } as React.CSSProperties}>
                              {row.map(p => renderFoundProductCard(p, m.searchQuery))}
                            </div>
                          ))
                        })()}
                        {m.searchQuery && !m.hasNoMore && (
                          m.loadingMore ? (
                            <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 8, padding: '11px 2px' }}>
                              <span className="fr-node-active" style={{ position: 'relative', width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: INK }}>
                                <span className="fr-ring2" style={{ position: 'absolute', inset: 0 }} />
                                <StylistStepIcon icon={(loadMorePhases[loadMorePhases.length - 1]?.icon) ?? 'search'} size={11} />
                              </span>
                              <span style={{ fontFamily: SANS, fontSize: 12.5, color: INK2 }}>{loadMorePhases[loadMorePhases.length - 1]?.main ?? 'Searching for more'}</span>
                            </div>
                          ) : (
                            <button type="button" onClick={() => loadMoreStylistProducts(i)}
                              style={{ marginTop: 14, width: '100%', padding: '11px', borderRadius: 12, border: `1px solid ${BRD}`,
                                background: 'transparent', fontFamily: SANS, fontSize: 12, fontWeight: 500, letterSpacing: '.04em',
                                textTransform: 'uppercase', color: INK2, cursor: 'pointer' }}>
                              See more
                            </button>
                          )
                        )}
                      </div>
                    )}
                    {m.role === 'assistant' && m.outfitGroups && m.outfitGroups.length > 0 && (
                      <div style={{ marginTop: 10, width: '100%' }}>
                        {/* Several distinct looks — "Outfit 1 / Outfit 2 / Outfit 3",
                            each its own labelled row of the pieces that make it up. */}
                        {m.outfitGroups.map((group, gi) => (
                          <div key={gi} style={{ marginTop: gi > 0 ? 16 : 0 }}>
                            <div style={{ fontFamily: SANS, fontSize: 10, fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase', color: INK3, marginBottom: 8 }}>{group.label}</div>
                            <div style={{ display: 'flex', gap: 8, overflowX: 'auto', scrollbarWidth: 'none', paddingBottom: 2, WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>
                              {group.products.map(p => renderFoundProductCard(p, m.searchQuery))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {m.role === 'assistant' && m.outfitSlots && m.outfitSlots.length > 0 && (
                      <div style={{ marginTop: 12, width: '100%', maxWidth: 480 }}>
                        <div style={{ fontFamily: SANS, fontSize: 10, fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase', color: INK3, marginBottom: 8 }}>Complete outfit</div>
                        {(() => {
                          // Dedup first so the total uses the same products as the cards.
                          const seenIds = new Set<string>()
                          const bests = m.outfitSlots!.map(slot => {
                            const b = slot.products.find(p => !seenIds.has(p.id)) ?? slot.products[0]
                            if (b) seenIds.add(b.id)
                            return b ?? null
                          })

                          // Total: convert every slot to the shopper's display currency
                          // before summing so mixed-currency outfits add up correctly.
                          const displayCurrency = shopperContext.currency || 'USD'
                          const total = bests.reduce((sum, p) => {
                            if (!p) return sum
                            return sum + convertCurrencyAmount(p.price, p.base_currency ?? p.currency, displayCurrency, liveRates)
                          }, 0)

                          const slots = bests.map((best, si) => {
                            if (!best) return null
                            const slot = m.outfitSlots![si]
                            const slotLabel = slot.slotCategory ?? (() => {
                              const t = `${slot.query} ${best.title} ${(best.tags || []).join(' ')}`.toLowerCase()
                              if (/shoe|sneaker|loafer|boot|sandal|trainer|oxford|derby|moccasin|footwear|slip.on|espadrille|pump|heel|clog/.test(t)) return 'Shoes'
                              if (/\bjacket\b|blazer|\bcoat\b|overcoat|parka|windbreaker|trench|bomber/.test(t)) return 'Outer'
                              if (/trouser|pant|\bjean\b|denim|chino|\bshort\b|skirt|legging/.test(t)) return 'Bottom'
                              if (/dress|jumpsuit|romper|overall|dungaree/.test(t)) return 'Dress'
                              if (/belt|watch|\bbag\b|tote|\bhat\b|\bcap\b|scarf|\btie\b|sock|bracelet|necklace|sunglasses/.test(t)) return 'Accessory'
                              return 'Top'
                            })()
                            const isSaved = savedIds.has(best.id)
                            return (
                              <div key={si} style={{ border: `1px solid ${BRD}`, borderRadius: 12, overflow: 'hidden', cursor: 'pointer', WebkitTouchCallout: 'none', WebkitUserSelect: 'none' } as React.CSSProperties}
                                onClick={() => { if (productWasLong.current) { productWasLong.current = false; return }; setSelected(best) }}
                                {...makePressHandlers((x, y) => {
                                  productWasLong.current = true
                                  const menuW = 200; const menuH = 160
                                  const above = y + 8 + menuH > window.innerHeight
                                  const my = Math.max(8, above ? y - menuH - 4 : y + 8)
                                  const mx = Math.max(8, Math.min(x, window.innerWidth - menuW - 8))
                                  ctxMenuOpenAt.current = Date.now()
                                  setProductCtxMenu({ product: best, x: mx, y: my, above })
                                })}>
                                <div style={{ height: 110, overflow: 'hidden', background: BG2, position: 'relative' }}>
                                  {getProductImages(best)[0] && <img src={getProductImages(best)[0]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                                  <div style={{ position: 'absolute', top: 6, left: 6, background: INK, color: '#fff', fontFamily: SANS, fontSize: 9, fontWeight: 600, padding: '2px 7px', borderRadius: 20, letterSpacing: '.05em' }}>
                                    {slotLabel}
                                  </div>
                                  <button type="button" aria-label={isSaved ? 'In your bag' : 'Add to bag'}
                                    onClick={e => { e.stopPropagation(); toggleSaved(best, slot.query) }}
                                    style={{ position: 'absolute', top: 5, right: 5, width: 22, height: 22, borderRadius: '50%', border: 'none',
                                      background: 'rgba(255,255,255,.92)', boxShadow: '0 1px 4px rgba(0,0,0,.18)', cursor: 'pointer',
                                      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, color: INK }}>
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                                      <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" fill={isSaved ? 'currentColor' : 'none'} />
                                      <line x1="3" y1="6" x2="21" y2="6" stroke={isSaved ? '#fff' : 'currentColor'} />
                                      <path d="M16 10a4 4 0 0 1-8 0" stroke={isSaved ? '#fff' : 'currentColor'} />
                                    </svg>
                                  </button>
                                </div>
                                <div style={{ padding: '7px 8px' }}>
                                  <div style={{ fontFamily: SANS, fontSize: 11, fontWeight: 500, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{best.title}</div>
                                  <div style={{ fontFamily: SANS, fontSize: 10, color: INK3 }}>{formatMoney(best.price, best.currency, best.base_currency, liveRates)}</div>
                                  {(() => { const { colors: sc } = displaySwatches(best); return sc.length > 0 ? (
                                    <div style={{ display: 'flex', gap: 4, marginTop: 5, flexWrap: 'wrap' }}>
                                      {sc.slice(0, 6).map(c => (
                                        <ColorSwatch key={c} name={c} imageUrl={getColorVariantImages(best, c)[0] ?? getProductImages(best)[0]} size={9} shape="square" selected={false} available={true} />
                                      ))}
                                    </div>
                                  ) : null })()}
                                </div>
                              </div>
                            )
                          })
                          return (
                            <>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>{slots}</div>
                              {total > 0 && (
                                <div style={{ marginTop: 8, fontFamily: SANS, fontSize: 11, color: INK2, textAlign: 'right' }}>
                                  Total outfit: {formatMoney(total, displayCurrency, displayCurrency, liveRates)}
                                </div>
                              )}
                            </>
                          )
                        })()}
                      </div>
                    )}
                  </div>
                ))}
                {stylistLoading && (
                  <div style={{ opacity: stylistDissolving ? 0 : 1, transition: 'opacity .2s ease' }}>
                    {/* Same plain step-list language as the persisted "Show reasoning"
                        toggle below (small circle icon, connecting thread, monospace
                        trace line, no card/border/spinner/shimmer) — live and
                        after-the-fact look identical. Every step here is a genuine
                        backend event (see readStylistStream) fired the instant that
                        operation actually started, so there's no "upcoming" state —
                        only steps that have already really happened, with the last
                        one active until the next real event or the final reply
                        arrives. Nothing is ever padded or replayed. */}
                    {stylistLoadingPhases.length === 0 ? (
                      // No real progress event has arrived yet — for small talk and
                      // casual chitchat, NONE ever will (the backend only emits them
                      // for real search/reasoning work), so this plain typing
                      // indicator is the entire loading state a light reply shows,
                      // not a placeholder for a tracker that's about to appear. A
                      // "Reading your message" / "Searching" claim here would be
                      // theater for something that needs no real work at all.
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 2px' }}>
                        <span className="fr-dot" /><span className="fr-dot" /><span className="fr-dot" />
                      </div>
                    ) : (
                      // Live tracker: one quiet line per REAL backend step.
                      // Completed steps settle into a small muted tick; the
                      // current one gets a spinning ring and a soft shimmer
                      // sweeping across its label (the sub-animation) so there's
                      // a genuine sense of live work without any noise. Each line
                      // rises in with a staggered fade. The full technical trace
                      // still lives in the collapsible "Show reasoning" below.
                      <div style={{ display: 'flex', flexDirection: 'column', padding: '3px 0' }}>
                        {stylistLoadingPhases.map((phase, pi) => {
                          const isLast = pi === stylistLoadingPhases.length - 1
                          return (
                            <div key={pi} style={{ display: 'flex', gap: 11, animation: 'fadeUp .34s cubic-bezier(.32,.9,.4,1) both' }}>
                              {/* Rail: the step node, plus a thin connector down to
                                  the next node so the steps read as one sequence. */}
                              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 22, flexShrink: 0 }}>
                                {isLast ? (
                                  // Active step: its own semantic icon (search, filter,
                                  // palette, compare…) sitting inside a live spinner ring,
                                  // so you can see exactly WHICH step is working.
                                  <span className="fr-node-active" style={{ position: 'relative', width: 22, height: 22, alignItems: 'center', justifyContent: 'center', color: INK }}>
                                    <span className="fr-ring2" style={{ position: 'absolute', inset: 0 }} />
                                    <StylistStepIcon icon={phase.icon} size={11} />
                                  </span>
                                ) : (
                                  // Completed step: settles into a filled tick.
                                  <span style={{ width: 16, height: 16, borderRadius: '50%', background: INK, display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'fadeScale .28s ease both' }}>
                                    <svg width="10" height="10" viewBox="0 0 11 11">
                                      <path className="fr-tick" d="M2.4 5.8 L4.5 7.9 L8.6 3.2" fill="none" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                                    </svg>
                                  </span>
                                )}
                                {!isLast && <span className="fr-thread" style={{ width: 2, flex: 1, minHeight: 9, marginTop: 3, marginBottom: 1 }} />}
                              </div>
                              <div style={{ paddingBottom: isLast ? 0 : 12, minHeight: 14, display: 'flex', alignItems: 'center', minWidth: 0 }}>
                                {isLast ? (
                                  <span className="fr-shimmer" style={{ fontFamily: SANS, fontSize: 12.5, fontWeight: 500, lineHeight: '16px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{phase.main}</span>
                                ) : (
                                  <span style={{ fontFamily: SANS, fontSize: 12, lineHeight: '16px', color: INK3, opacity: 0.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{phase.main}</span>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div style={{ height: 12 }} />
          </div>

          {/* ── Search bar — floats above content ── */}
          <div className="fr-bar-wrap" style={keyboardOffset > 0 ? { bottom: keyboardOffset } : undefined}>

            {/* Spring-animated wrapper */}
            <div style={{ transform: `scale(${barScale})`, transformOrigin: "center bottom", willChange: "transform" }}
              onPointerDown={() => setBarPressed(true)}
              onPointerUp={() => setBarPressed(false)}
              onPointerLeave={() => setBarPressed(false)}
            >
              <div ref={barRef} className="fr-bar">

                {/* Subtle top-edge highlight only */}
                <div style={{
                  position: 'absolute', top: 0, left: '15%', right: '15%', height: 1,
                  pointerEvents: 'none', zIndex: 0,
                  background: 'linear-gradient(to right, transparent, rgba(255,255,255,0.55) 40%, rgba(255,255,255,0.65) 50%, rgba(255,255,255,0.55) 60%, transparent)',
                }} />

                {/* Content — sits above overlays */}
                <div style={{ position: 'relative', zIndex: 1 }}>

                  {/* Product strip — attached products that send the query to the stylist */}
                  {barProducts.length > 0 && (
                    <div style={{
                      display: 'flex', gap: 8, overflowX: 'auto', padding: '10px 12px 0',
                      scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch',
                    } as React.CSSProperties}>
                      {barProducts.map(p => (
                        <div key={p.id} style={{ position: 'relative', flexShrink: 0 }}>
                          <div style={{ width: 44, height: 56, borderRadius: 8, overflow: 'hidden', background: BG2, border: '1px solid rgba(0,0,0,0.08)' }}>
                            {getProductImages(p)[0] && <img src={getProductImages(p)[0]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
                          </div>
                          <button type="button" onClick={() => removeBarProduct(p.id)}
                            style={{ position: 'absolute', top: -5, right: -5, width: 18, height: 18, borderRadius: '50%', background: '#1E1A16', border: '1.5px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 }}>
                            <svg width="9" height="9" viewBox="0 0 10 10" fill="none"><path d="M2 2l6 6M8 2l-6 6" stroke="white" strokeWidth="1.6" strokeLinecap="round"/></svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Image strip — appears above search bar when photos are attached */}
                  {wardrobeImages.length > 0 && (
                    <div style={{
                      display: 'flex', gap: 8, overflowX: 'auto', padding: '10px 12px 0',
                      scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch',
                    }}>
                      {wardrobeImages.map((img, idx) => (
                        <div key={idx} style={{ position: 'relative', flexShrink: 0 }}>
                          <img src={img.url} alt="" style={{
                            width: 72, height: 72, borderRadius: 10, objectFit: 'cover',
                            display: 'block', border: '1px solid rgba(0,0,0,0.08)',
                          }} />
                          {/* Remove button */}
                          <button
                            type="button"
                            onClick={() => setWardrobeImages(prev => prev.filter((_, i) => i !== idx))}
                            style={{
                              position: 'absolute', top: -6, right: -6,
                              width: 20, height: 20, borderRadius: '50%',
                              background: '#1E1A16', border: '1.5px solid #fff',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              cursor: 'pointer', padding: 0,
                            }}>
                            <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
                              <path d="M2 2l6 6M8 2l-6 6" stroke="white" strokeWidth="1.6" strokeLinecap="round"/>
                            </svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {wardrobeImages.length > 0 && (
                    <div style={{ padding: '6px 12px 0' }}>
                      <button type="button" onClick={scanWardrobe} disabled={wardrobeScanBusy}
                        style={{ fontFamily: SANS, fontSize: 11.5, fontWeight: 600, color: INK2, background: 'none', border: 'none',
                          padding: 0, cursor: wardrobeScanBusy ? 'default' : 'pointer', opacity: wardrobeScanBusy ? .5 : 1, textDecoration: 'underline', textUnderlineOffset: 2 }}>
                        {wardrobeScanBusy ? 'Scanning your wardrobe…' : 'Scan my wardrobe →'}
                      </button>
                    </div>
                  )}

                  {/* Row 1: input */}
                  <div className="fr-bar-top">
                    <textarea ref={taRef} className="fr-ta" rows={1}
                      placeholder={inputHint ?? "What are you looking for?"}
                      value={input} onChange={e => setInput(e.target.value)}
                      onKeyDown={kd} />
                  </div>

                  {/* Row 2: actions */}
                  <div className="fr-bar-btm">

                    {/* Attach — one button, wardrobe icon: add photos (of what you own, or want to find) */}
                    <div style={{ position: 'relative' }}>
                    <button ref={attachBtnFabricsRef} type="button" className="fr-icon-btn" disabled={wardrobeImages.length >= 8}
                      onClick={() => { wardrobeFileRef.current?.click() }} title="Add photos">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="4" y="2.5" width="16" height="18.5" rx="1.5"/><line x1="12" y1="2.5" x2="12" y2="21"/><line x1="9.6" y1="9" x2="9.6" y2="12.5"/><line x1="14.4" y1="9" x2="14.4" y2="12.5"/><line x1="6.5" y1="21" x2="6.5" y2="23"/><line x1="17.5" y1="21" x2="17.5" y2="23"/>
                      </svg>
                    </button>
                    </div>
                    <div className="fr-bar-right">
                      {/* Send with spring */}
                      <div style={{ transform: `scale(${sendScale})`, willChange: "transform" }}
                        onPointerDown={() => setSendPressed(true)}
                        onPointerUp={() => setSendPressed(false)}
                        onPointerLeave={() => setSendPressed(false)}
                      >
                        <button type="button" className="fr-send-btn" aria-label={loading ? 'Fabrics is working' : 'Send'} onClick={() => canSend && doSearch()}>
                          {loading
                            ? <div style={{ width: 11, height: 11, borderRadius: 3, background: INK }} />
                            : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="12" y1="19" x2="12" y2="5"/>
                                <polyline points="5 12 12 5 19 12"/>
                              </svg>
                          }
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

              </div>
            </div>
          </div>{/* end fr-bar-wrap */}
          </div>{/* end fr-content */}

          {/* ── Sheet overlay — tap/click outside to close on all devices ── */}
          <div className={`fr-sheet-ov ${selectedProduct ? "vis" : ""}`} onClick={() => setSelected(null)} />

          {/* ── Fabrics history context menu ── */}
          {stylistCtxMenu && (
            <>
              <div onClick={() => setStylistCtxMenu(null)}
                style={{ position: 'fixed', inset: 0, zIndex: 9000 }} />
              <div style={{
                position: 'fixed', left: stylistCtxMenu.x, top: stylistCtxMenu.y,
                zIndex: 9001, width: 160, borderRadius: 12, overflow: 'hidden',
                background: 'linear-gradient(160deg, rgba(255,255,255,0.96) 0%, rgba(245,245,248,0.94) 100%)',
                boxShadow: '0 0 0 0.5px rgba(255,255,255,0.9), 0 12px 36px rgba(0,0,0,0.18), 0 3px 10px rgba(0,0,0,0.10), inset 0 1px 0 rgba(255,255,255,1)',
                border: '0.5px solid rgba(180,180,190,0.35)',
                animation: 'ctxIn 0.22s cubic-bezier(0.34,1.36,0.64,1)',
                transformOrigin: stylistCtxMenu.above ? 'bottom left' : 'top left',
              }}>
                <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0,
                  background: 'linear-gradient(140deg, rgba(255,255,255,0.6) 0%, transparent 45%)' }} />
                <div onClick={() => { setStylistRenameId(stylistCtxMenu.id); setStylistRenameVal(stylistCtxMenu.label); setStylistCtxMenu(null) }}
                  style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center',
                    justifyContent: 'space-between', padding: '11px 14px', cursor: 'pointer', gap: 8,
                    fontFamily: '-apple-system,BlinkMacSystemFont,system-ui,sans-serif',
                    fontSize: 14, fontWeight: 400, color: '#1C1C1E' }}
                  onPointerDown={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.07)')}
                  onPointerUp={e => (e.currentTarget.style.background = '')}
                  onPointerLeave={e => (e.currentTarget.style.background = '')}>
                  <span>Rename</span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(60,60,67,0.6)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                </div>
                <div style={{ height: '0.5px', background: 'rgba(60,60,67,0.15)', position: 'relative', zIndex: 1 }} />
                <div onClick={() => { deleteStylistEntry(stylistCtxMenu.id); setStylistCtxMenu(null) }}
                  style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center',
                    justifyContent: 'space-between', padding: '11px 14px', cursor: 'pointer', gap: 8,
                    fontFamily: '-apple-system,BlinkMacSystemFont,system-ui,sans-serif',
                    fontSize: 14, fontWeight: 400, color: '#FF3B30' }}
                  onPointerDown={e => (e.currentTarget.style.background = 'rgba(255,59,48,0.08)')}
                  onPointerUp={e => (e.currentTarget.style.background = '')}
                  onPointerLeave={e => (e.currentTarget.style.background = '')}>
                  <span>Delete</span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FF3B30" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                    <path d="M10 11v6M14 11v6"/>
                    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                  </svg>
                </div>
              </div>
            </>
          )}

          {/* ── Brands roster — all working brands with logo + name ── */}
          {brandsOpen && (
            <div onClick={() => setBrandsOpen(false)}
              style={{ position: 'fixed', inset: 0, zIndex: 9992, background: 'rgba(0,0,0,0.42)', display: 'flex', alignItems: 'flex-end', backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)' } as React.CSSProperties}>
              <div onClick={e => e.stopPropagation()}
                style={{ width: '100%', maxWidth: 680, margin: '0 auto', background: '#fff', borderRadius: '18px 18px 0 0', display: 'flex', flexDirection: 'column', maxHeight: '92vh', animation: 'sheetUp .34s cubic-bezier(.32,.72,0,1)' }}>

                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px 12px', flexShrink: 0 }}>
                  <div>
                    <span style={{ fontFamily: SANS, fontSize: 11, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase', color: INK }}>Brands</span>
                    <span style={{ fontFamily: SANS, fontSize: 11, color: INK3, marginLeft: 8 }}>{allBrands.length}</span>
                  </div>
                  <button onClick={() => setBrandsOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, color: INK3, lineHeight: 0 }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>

                {/* Search */}
                <div style={{ padding: '0 20px 12px', flexShrink: 0 }}>
                  <input value={brandQuery} onChange={e => setBrandQuery(e.target.value)} placeholder="Search brands…"
                    style={{ width: '100%', fontFamily: SANS, fontSize: 14, color: INK, border: `1px solid ${BRD}`, borderRadius: 22, padding: '10px 16px', outline: 'none', background: BG2 }} />
                </div>

                {/* List */}
                <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '4px 12px 32px' } as React.CSSProperties}>
                  {filteredBrands.length === 0 ? (
                    <p style={{ fontFamily: SANS, fontSize: 13, color: INK3, padding: '20px 8px', opacity: .6 }}>No brands match “{brandQuery}”.</p>
                  ) : filteredBrands.map(b => (
                    <div key={b.domain} onClick={() => openBrand(b)} className="fr-hi"
                      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 8px', cursor: 'pointer' }}>
                      <BrandLogo domain={b.domain} name={b.name} size={40} />
                      <span style={{ fontFamily: SANS, fontSize: 14, fontWeight: 500, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</span>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={INK3} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 'auto', flexShrink: 0, opacity: .5 }}><polyline points="9 18 15 12 9 6"/></svg>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── Size Guide modal — interactive ── */}
          {sizeGuideOpen && (
            <div onClick={() => setSizeGuideOpen(false)}
              style={{ position: 'fixed', inset: 0, zIndex: 9998, background: 'rgba(0,0,0,0.42)', display: 'flex', alignItems: 'flex-end', backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)' } as React.CSSProperties}>
              <div onClick={e => e.stopPropagation()}
                style={{ width: '100%', maxWidth: 680, margin: '0 auto', background: '#fff', borderRadius: '18px 18px 0 0', display: 'flex', flexDirection: 'column', maxHeight: '86vh' }}>

                {/* ── Header ── */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 20px 14px', borderBottom: '1px solid rgba(0,0,0,0.08)', flexShrink: 0 }}>
                  <div>
                    <span style={{ fontFamily: SANS, fontSize: 11, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase', color: INK }}>Size Guide</span>
                    {parsedSizeTables.length === 1 && parsedSizeTables[0].label && (
                      <p style={{ fontFamily: SANS, fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: INK3, marginTop: 3 }}>{parsedSizeTables[0].label}</p>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {sgTable?.unit && (
                      <div style={{ display: 'flex', border: `1px solid rgba(0,0,0,0.18)`, overflow: 'hidden', borderRadius: 4 }}>
                        {(['in', 'cm'] as const).map(u => {
                          const active = (sgDisplayUnit ?? sgTable!.unit) === u
                          return (
                            <button key={u} onClick={() => setSgDisplayUnit(u === sgTable!.unit && !sgDisplayUnit ? u : u)}
                              style={{ padding: '5px 11px', fontFamily: SANS, fontSize: 10, fontWeight: 500,
                                letterSpacing: '.06em', border: 'none', cursor: 'pointer',
                                background: active ? INK : 'transparent',
                                color: active ? '#fff' : INK3, transition: 'all .15s' }}>
                              {u}
                            </button>
                          )
                        })}
                      </div>
                    )}
                    <button onClick={() => setSizeGuideOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, color: INK3, lineHeight: 0 }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  </div>
                </div>

                {sizeGuideLoading && !sheetSizeTable && !fetchedSizeGuide ? (
                  <p style={{ fontFamily: SANS, fontSize: 13, color: INK3, padding: '24px 20px', fontWeight: 300 }}>Loading…</p>
                ) : parsedSizeTables.length > 0 ? (
                  <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>

                    {/* ── Section tabs (multiple tables, e.g. Tops / Bottoms) ── */}
                    {parsedSizeTables.length > 1 && (
                      <div style={{ display: 'flex', borderBottom: '1px solid rgba(0,0,0,0.08)', flexShrink: 0, overflowX: 'auto', scrollbarWidth: 'none' }}>
                        {parsedSizeTables.map((t, i) => (
                          <button key={i} onClick={() => { setSgTableIdx(i); setSgGroupIdx(0) }}
                            style={{ flexShrink: 0, padding: '13px 16px', fontFamily: SANS, fontSize: 11, fontWeight: sgTableIdx === i ? 600 : 400,
                              letterSpacing: '.08em', textTransform: 'uppercase', color: sgTableIdx === i ? INK : INK3,
                              background: 'none', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
                              borderBottom: sgTableIdx === i ? `2px solid ${INK}` : '2px solid transparent',
                              marginBottom: -1 }}>
                            {t.label || `Table ${i + 1}`}
                          </button>
                        ))}
                      </div>
                    )}

                    {sgTable && (
                      <>
                        {/* ── Range selector — e.g. "XS – M | L – XXL | XXXL" ── */}
                        {sgChunks.length > 1 && (
                          <div style={{ padding: '20px 20px 0', flexShrink: 0 }}>
                            <p style={{ fontFamily: SANS, fontSize: 9, letterSpacing: '.14em', textTransform: 'uppercase', color: INK3, marginBottom: 10 }}>Select size range</p>
                            <div style={{ display: 'flex', gap: 8 }}>
                              {sgChunks.map((chunk, i) => {
                                const label = chunk.length > 1 ? `${chunk[0]} - ${chunk[chunk.length - 1]}` : chunk[0]
                                const on = sgGroupIdx === i
                                return (
                                  <button key={i} onClick={() => setSgGroupIdx(i)}
                                    style={{ flex: 1, padding: '11px 6px', fontFamily: SANS, fontSize: 11, fontWeight: 500,
                                      letterSpacing: '.04em', color: on ? '#fff' : INK,
                                      background: on ? INK : 'transparent',
                                      border: `1.5px solid ${on ? INK : 'rgba(0,0,0,0.20)'}`,
                                      borderRadius: 0, cursor: 'pointer', transition: 'all .15s' }}>
                                    {label}
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                        )}

                        {/* ── Measurement table ── */}
                        <div style={{ padding: '20px 20px 40px' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: SANS }}>
                            <thead>
                              <tr>
                                <th style={{ textAlign: 'left', padding: '0 0 16px', fontFamily: SANS, fontSize: 10, fontWeight: 400, letterSpacing: '.06em', textTransform: 'uppercase', color: INK3 }} />
                                {sgChunk.map(h => (
                                  <th key={h} style={{ textAlign: 'center', padding: '0 4px 16px', fontFamily: SANS, fontSize: 12, fontWeight: 700, letterSpacing: '.06em', color: INK }}>
                                    {h}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {sgTable.rows
                                .filter(row => row.values.slice(sgColStart, sgColStart + sgChunk.length).some(v => v.trim()))
                                .map((row, ri) => (
                                  <tr key={ri} style={{ borderTop: '1px solid rgba(0,0,0,0.07)' }}>
                                    <td style={{ padding: '14px 0', fontFamily: SANS, fontSize: 12, fontWeight: 600, color: INK, letterSpacing: '.02em' }}>
                                      {row.label}
                                    </td>
                                    {sgChunk.map((_, ci) => (
                                      <td key={ci} style={{ padding: '14px 4px', textAlign: 'center', fontFamily: SANS, fontSize: 12, fontWeight: 300, color: INK2 }}>
                                        {sgDisplayUnit ? convertMeasurement(row.values[sgColStart + ci] ?? '—', sgTable.unit, sgDisplayUnit) : (row.values[sgColStart + ci] ?? '—')}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                          <p style={{ fontFamily: SANS, fontSize: 10, color: INK3, letterSpacing: '.04em', marginTop: 16, lineHeight: 1.6 }}>
                            {sgEffectiveUnit
                              ? `All measurements in ${sgEffectiveUnit === 'in' ? 'inches' : 'centimetres'}. `
                              : ''}
                            Measurements may vary slightly. When in doubt, size up.
                          </p>
                          {/* ── International size reference — only shown when brand uses letter sizes ── */}
                          {sgIntlCols && (
                            <div style={{ marginTop: 28, borderTop: '1px solid rgba(0,0,0,0.07)', paddingTop: 18 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                                <span style={{ fontFamily: SANS, fontSize: 10, fontWeight: 600, letterSpacing: '.10em', textTransform: 'uppercase', color: INK2 }}>
                                  International Sizes
                                </span>
                                <div style={{ display: 'flex', border: `1px solid rgba(0,0,0,0.18)`, overflow: 'hidden', borderRadius: 4 }}>
                                  {(['Women', 'Men'] as const).map((g, gi) => {
                                    const gkey = gi === 0 ? 'w' : 'm'
                                    const on = sgIntlGender === gkey
                                    return (
                                      <button key={g} onClick={() => setSgIntlGender(gkey as 'w' | 'm')}
                                        style={{ padding: '5px 11px', fontFamily: SANS, fontSize: 10, fontWeight: 500,
                                          letterSpacing: '.04em', border: 'none', cursor: 'pointer',
                                          background: on ? INK : 'transparent',
                                          color: on ? '#fff' : INK3, transition: 'all .15s' }}>
                                        {g}
                                      </button>
                                    )
                                  })}
                                </div>
                              </div>
                              <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>
                                <table style={{ borderCollapse: 'collapse', fontFamily: SANS, fontSize: 11, minWidth: '100%' }}>
                                  <thead>
                                    <tr>
                                      <th style={{ textAlign: 'left', padding: '0 10px 8px 0', fontFamily: SANS, fontSize: 10, fontWeight: 500, color: INK3, whiteSpace: 'nowrap' }} />
                                      {sgIntlCols.map(({ h }) => (
                                        <th key={h} style={{ textAlign: 'center', padding: '0 6px 8px', fontFamily: SANS, fontSize: 11, fontWeight: 700, letterSpacing: '.04em', color: INK }}>
                                          {h}
                                        </th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {(sgIntlGender === 'w' ? INTL_W : INTL_M).map(row => (
                                      <tr key={row.sys} style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }}>
                                        <td style={{ padding: '8px 10px 8px 0', fontFamily: SANS, fontSize: 11, fontWeight: 600, color: INK2, whiteSpace: 'nowrap' }}>
                                          {row.sys}
                                        </td>
                                        {sgIntlCols.map(({ i }) => (
                                          <td key={i} style={{ textAlign: 'center', padding: '8px 6px', fontFamily: SANS, fontSize: 11, fontWeight: 300, color: INK3 }}>
                                            {row.vals[i]}
                                          </td>
                                        ))}
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                              <p style={{ fontFamily: SANS, fontSize: 9, color: INK3, letterSpacing: '.04em', marginTop: 10, lineHeight: 1.6 }}>
                                Standard reference only. Brands vary — always check the measurements above.
                              </p>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                ) : (sheetSizeTable || fetchedSizeGuide) ? (
                  // Fallback: image-based size guide
                  <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px 40px' } as React.CSSProperties}>
                    <div className="fr-sz-modal" dangerouslySetInnerHTML={{ __html: (sheetSizeTable || fetchedSizeGuide)! }} />
                  </div>
                ) : (
                  <div style={{ padding: '24px 20px 40px' }}>
                    <p style={{ fontFamily: SANS, fontSize: 13, color: INK3, fontWeight: 300, lineHeight: 1.7, marginBottom: 16 }}>
                      {sizeGuideLoading ? 'Loading size guide…' : "We couldn't load the size guide for this product."}
                    </p>
                    {!sizeGuideLoading && sizeGuideUrl && (
                      <a href={sizeGuideUrl} target="_blank" rel="noopener noreferrer"
                        style={{ fontFamily: SANS, fontSize: 13, color: INK, fontWeight: 500, textDecoration: 'underline', textUnderlineOffset: 3 }}>
                        View this product on {sheetBrandName || sheetStoreHost} →
                      </a>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Explore coming-soon toast ── */}
          {exploreToast && (
            <div style={{ position: 'fixed', bottom: 96, left: '50%', zIndex: 9999,
              background: INK, color: '#fff', borderRadius: 24,
              padding: '11px 22px', display: 'flex', alignItems: 'center', gap: 10,
              fontFamily: SANS, fontSize: 13, fontWeight: 400, letterSpacing: '.01em',
              boxShadow: '0 8px 32px rgba(0,0,0,0.32), 0 2px 8px rgba(0,0,0,0.18)', whiteSpace: 'nowrap',
              animation: `${exploreToastOut ? 'toastOut 0.42s cubic-bezier(0.4,0,1,1)' : 'toastIn 0.52s cubic-bezier(0.34,1.36,0.64,1)'} forwards`,
            }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: .7 }}>
                <path d="M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5z"/>
              </svg>
              Coming soon
            </div>
          )}

          {/* ── Popup-blocked toast ── */}
          {popupBlockedUrl && (
            <div style={{ position: 'fixed', bottom: 96, left: '50%', transform: 'translateX(-50%)', zIndex: 9999,
              background: INK, color: '#fff', borderRadius: 16,
              padding: '13px 20px', display: 'flex', alignItems: 'center', gap: 12,
              fontFamily: SANS, fontSize: 13, fontWeight: 400, letterSpacing: '.01em',
              boxShadow: '0 8px 32px rgba(0,0,0,0.28)', maxWidth: 'calc(100vw - 40px)',
              animation: 'toastIn 0.42s cubic-bezier(0.34,1.36,0.64,1) forwards',
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: .7, flexShrink: 0 }}>
                <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9h6M9 12h6M9 15h4"/>
              </svg>
              <span>Popup blocked — allow popups for this site in your browser, then try again.</span>
              <a href={popupBlockedUrl} target="_blank" rel="noopener noreferrer"
                onClick={() => setPopupBlockedUrl(null)}
                style={{ color: '#aed6b8', whiteSpace: 'nowrap', textDecoration: 'underline', fontWeight: 500 }}>
                Open in tab
              </a>
            </div>
          )}

          {/* ── Premium upgrade sheet ── */}
          {showUpgradeSheet && (
            <>
              <div
                onClick={() => setShowUpgradeSheet(false)}
                style={{ position: 'fixed', inset: 0, zIndex: 9100, background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(2px)' }}
              />
              <div style={{
                position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 9101,
                background: BG, borderRadius: '20px 20px 0 0',
                padding: '32px 24px 40px',
                boxShadow: '0 -8px 48px rgba(0,0,0,0.18)',
                animation: 'sheetUp .32s cubic-bezier(0.32,0.72,0,1)',
                maxWidth: 480, margin: '0 auto',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
                  <div>
                    <div style={{ fontFamily: SEASON, fontSize: 24, color: INK, letterSpacing: '0.02em', lineHeight: 1.1 }}>Discern Community</div>
                    <div style={{ fontFamily: SANS, fontSize: 13, color: INK3, marginTop: 5 }}>$20 / month. Cancel anytime.</div>
                  </div>
                  <button onClick={() => setShowUpgradeSheet(false)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: INK3 }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
                </div>

                {/* Community pitch */}
                <p style={{ fontFamily: SANS, fontSize: 13, color: INK2, lineHeight: 1.7, marginBottom: 20, fontWeight: 300 }}>
                  Discern is built independently — no VC, no team. One person building the shopping OS independent fashion deserved. $20/month gets you unlimited AI search, taste memory, Fabrics stylist, and everything else Discern ships — with no algorithm tax.
                </p>

                {/* Benefits */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 28 }}>
                  {[
                    ['Unlimited AI search', 'Every result ranked by taste intelligence, not keywords'],
                    ['Fabrics stylist with memory', 'Knows your sizes, budget, and saved pieces across sessions'],
                    ['Everything that ships', 'New features, stores, and tools — included automatically'],
                    ['Direct access', 'Shape what gets built — your feedback goes straight to the builder'],
                  ].map(([title, desc]) => (
                    <div key={title} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                      <div style={{ width: 20, height: 20, borderRadius: '50%', background: '#e8f0e8', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#3d7a3a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                      </div>
                      <div>
                        <div style={{ fontFamily: SANS, fontSize: 13, fontWeight: 600, color: INK }}>{title}</div>
                        <div style={{ fontFamily: SANS, fontSize: 12, color: INK3, marginTop: 1 }}>{desc}</div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* CTA */}
                <button
                  onClick={async () => {
                    try {
                      const r = await fetch('/api/billing/checkout', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({}),
                      })
                      const { url, error } = await r.json()
                      if (error) throw new Error(error)
                      window.location.href = url
                    } catch {
                      // fall through
                    }
                  }}
                  style={{
                    width: '100%', padding: '15px', borderRadius: 12,
                    background: INK, color: '#fff',
                    fontFamily: SANS, fontSize: 15, fontWeight: 600, letterSpacing: '.01em',
                    border: 'none', cursor: 'pointer',
                  }}
                >
                  Join the Community — $20/mo
                </button>
                <p style={{ fontFamily: SANS, fontSize: 11, color: INK3, textAlign: 'center', marginTop: 10, opacity: 0.55 }}>
                  Cancel anytime. No commitments.
                </p>
              </div>
            </>
          )}

          {/* ── Style onboarding sheet ── */}
          {showOnboarding && (
            <>
              <div
                onClick={() => finishOnboarding(true)}
                style={{ position: 'fixed', inset: 0, zIndex: 9100, background: 'rgba(0,0,0,0.38)', backdropFilter: 'blur(3px)' }}
              />
              {/* Tablet/desktop: centred popup. Phone: bottom sheet. */}
              <div style={{
                position: 'fixed', zIndex: 9101, pointerEvents: 'none',
                ...(isMedium
                  ? { inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }
                  : { left: 0, right: 0, bottom: 0 }),
              }}>
              <div style={{
                pointerEvents: 'auto',
                background: BG,
                borderRadius: isMedium ? '24px' : '24px 24px 0 0',
                padding: '28px 24px 44px',
                boxShadow: isMedium ? '0 24px 80px rgba(0,0,0,.28),0 0 0 0.5px rgba(0,0,0,.08)' : '0 -8px 48px rgba(0,0,0,0.18)',
                animation: isMedium ? 'fadeScale .28s cubic-bezier(0.32,0.72,0,1)' : 'sheetUp .32s cubic-bezier(0.32,0.72,0,1)',
                width: '100%', maxWidth: 480,
              }}>
                {/* Drag handle — phone only */}
                {!isMedium && <div style={{ width: 36, height: 4, borderRadius: 4, background: 'rgba(0,0,0,.12)', margin: '0 auto 22px' }} />}

                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                  <div>
                    <div style={{ fontFamily: SEASON, fontSize: 24, color: INK, letterSpacing: '0.01em', lineHeight: 1.1 }}>
                      {onboardingStep === 0 ? 'Who do you shop for?' : 'Your sizes'}
                    </div>
                    <div style={{ fontFamily: SANS, fontSize: 12, color: INK3, marginTop: 5, lineHeight: 1.5 }}>
                      {onboardingStep === 0
                        ? 'Discern shows the right clothes by default — no filtering every search'
                        : 'Fabrics uses this to advise on fit without asking every time'}
                    </div>
                  </div>
                  <button onClick={() => finishOnboarding(true)}
                    style={{ background: 'rgba(0,0,0,.06)', border: 'none', cursor: 'pointer', padding: 8, borderRadius: '50%', color: INK3, flexShrink: 0, marginLeft: 12 }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
                </div>

                {/* Progress bars */}
                <div style={{ display: 'flex', gap: 5, marginBottom: 28 }}>
                  {[0, 1].map(i => (
                    <div key={i} style={{
                      height: 3, flex: 1, borderRadius: 2,
                      background: i <= onboardingStep ? INK : BRD,
                      transition: 'background .2s',
                    }} />
                  ))}
                </div>

                {/* Step 0 — gender */}
                {onboardingStep === 0 && (
                  <div style={{ marginBottom: 24 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      {([
                        { g: 'Men', sub: 'menswear by default', icon: <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="6" r="3.5"/><path d="M6 21v-2a6 6 0 0 1 12 0v2"/><line x1="9" y1="15" x2="15" y2="15"/></svg> },
                        { g: 'Women', sub: 'womenswear by default', icon: <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="6" r="3.5"/><path d="M8 21l4-10 4 10"/><path d="M7 17h10"/></svg> },
                      ] as const).map(({ g, sub, icon }) => {
                        const active = onboardGender === g
                        return (
                          <button key={g} onClick={() => setOnboardGender(active ? '' : g)} style={{
                            padding: '22px 16px', borderRadius: 16,
                            border: `2px solid ${active ? INK : BRD}`,
                            background: active ? INK : 'rgba(255,255,255,0.6)',
                            cursor: 'pointer', transition: 'all .15s',
                            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                            color: active ? '#fff' : INK,
                          }}>
                            {icon}
                            <span style={{ fontFamily: SANS, fontSize: 15, fontWeight: 600, color: active ? '#fff' : INK }}>{g}</span>
                            <span style={{ fontFamily: SANS, fontSize: 11, color: active ? 'rgba(255,255,255,0.65)' : INK3 }}>{sub}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Step 1 — sizes */}
                {onboardingStep === 1 && (
                  <div style={{ marginBottom: 24 }}>
                    <div style={{ background: 'rgba(0,0,0,.03)', borderRadius: 16, overflow: 'hidden', marginBottom: 12 }}>
                      {[
                        { label: 'Tops', key: 'tops', placeholder: onboardGender === 'Women' ? 'XS, S, M, L…' : 'S, M, L, XL…' },
                        { label: 'Bottoms', key: 'bottoms', placeholder: onboardGender === 'Women' ? '26, 28, 30…' : '30, 32, 34…' },
                        { label: 'Shoes', key: 'shoes', placeholder: onboardGender === 'Women' ? '6, 7, 8, EU 38…' : '9, 10, 11, EU 43…' },
                      ].map(({ label, key, placeholder }, i) => (
                        <div key={key} style={{ borderTop: i > 0 ? `0.5px solid rgba(0,0,0,.07)` : 'none', display: 'flex', alignItems: 'center', padding: '13px 16px', gap: 14 }}>
                          <span style={{ fontFamily: SANS, fontSize: 13, color: INK2, width: 66, flexShrink: 0 }}>{label}</span>
                          <input
                            value={onboardSizes[key as 'tops' | 'bottoms' | 'shoes']}
                            onChange={e => setOnboardSizes(prev => ({ ...prev, [key]: e.target.value }))}
                            placeholder={placeholder}
                            style={{
                              flex: 1, border: 'none', background: 'transparent',
                              fontFamily: SANS, fontSize: 14, color: INK,
                              outline: 'none', textAlign: 'right',
                            }}
                          />
                        </div>
                      ))}
                    </div>
                    <div style={{ fontFamily: SANS, fontSize: 11, color: INK3, textAlign: 'center', lineHeight: 1.5 }}>
                      Fabrics will say &quot;go up a size — it runs small&quot; without asking what you wear
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div style={{ display: 'flex', gap: 10 }}>
                  <button onClick={() => {
                    if (onboardingStep < 1) setOnboardingStep(s => s + 1)
                    else finishOnboarding(false)
                  }} style={{
                    flex: 1, padding: '14px', borderRadius: 12,
                    background: INK, color: '#fff',
                    fontFamily: SANS, fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer',
                  }}>
                    {onboardingStep < 1 ? (onboardGender ? 'Next' : 'Skip for now') : 'Done'}
                  </button>
                  {onboardingStep === 1 && (
                    <button onClick={() => finishOnboarding(true)} style={{
                      padding: '14px 18px', borderRadius: 12,
                      background: 'transparent', color: INK3,
                      fontFamily: SANS, fontSize: 13, border: `1px solid ${BRD}`, cursor: 'pointer',
                    }}>
                      Skip
                    </button>
                  )}
                </div>
              </div>
              </div>
            </>
          )}

          {/* ── Bag item long-press menu — Ask stylist + Remove ── */}
          {bagCtxMenu && (
            <>
              <div onClick={() => { if (Date.now() - ctxMenuOpenAt.current < 500) return; setBagCtxMenu(null); wasLongPress.current = false }} style={{ position: 'fixed', inset: 0, zIndex: 9000 }} />
              <div style={{
                position: 'fixed', left: bagCtxMenu.x, top: bagCtxMenu.y, zIndex: 9001,
                width: 190, borderRadius: 12, overflow: 'hidden',
                background: 'linear-gradient(160deg, rgba(255,255,255,0.96) 0%, rgba(245,245,248,0.94) 100%)',
                boxShadow: '0 0 0 0.5px rgba(255,255,255,0.9), 0 12px 36px rgba(0,0,0,0.18), 0 3px 10px rgba(0,0,0,0.10), inset 0 1px 0 rgba(255,255,255,1)',
                border: '0.5px solid rgba(180,180,190,0.35)',
                animation: 'ctxIn 0.22s cubic-bezier(0.34,1.36,0.64,1)',
                transformOrigin: bagCtxMenu.above ? 'bottom left' : 'top left',
              }}>
                <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0,
                  background: 'linear-gradient(140deg, rgba(255,255,255,0.6) 0%, transparent 45%)' }} />
                {/* Ask your stylist */}
                <div onClick={() => {
                    if (Date.now() - ctxMenuOpenAt.current < 350) return
                    addBarProduct(bagCtxMenu.product)
                    setSidebar(false)
                    setBagCtxMenu(null)
                  }}
                  style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center',
                    justifyContent: 'space-between', padding: '11px 14px', cursor: 'pointer', gap: 8,
                    fontFamily: '-apple-system,BlinkMacSystemFont,system-ui,sans-serif',
                    fontSize: 14, fontWeight: 400, color: '#1C1C1E' }}
                  onPointerDown={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.07)')}
                  onPointerUp={e => (e.currentTarget.style.background = '')}
                  onPointerLeave={e => (e.currentTarget.style.background = '')}>
                  <span>Ask Fabrics</span>
                  <FabricsIcon size={14} stroke="rgba(60,60,67,0.6)" strokeWidth={1.05}/>
                </div>
                <div style={{ height: '0.5px', background: 'rgba(60,60,67,0.15)', position: 'relative', zIndex: 1 }} />
                {/* Remove from bag */}
                <div onClick={() => { if (Date.now() - ctxMenuOpenAt.current < 350) return; toggleSaved(bagCtxMenu.product); setBagCtxMenu(null) }}
                  style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center',
                    justifyContent: 'space-between', padding: '11px 14px', cursor: 'pointer', gap: 8,
                    fontFamily: '-apple-system,BlinkMacSystemFont,system-ui,sans-serif',
                    fontSize: 14, fontWeight: 400, color: '#FF3B30' }}
                  onPointerDown={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.07)')}
                  onPointerUp={e => (e.currentTarget.style.background = '')}
                  onPointerLeave={e => (e.currentTarget.style.background = '')}>
                  <span>Remove from bag</span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,59,48,0.8)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                  </svg>
                </div>
              </div>
            </>
          )}

          {/* ── Product card long-press context menu — Liquid Glass ── */}
          {productCtxMenu && (
            <>
              <div onClick={() => { if (Date.now() - ctxMenuOpenAt.current < 500) return; setProductCtxMenu(null); productWasLong.current = false }}
                style={{ position: 'fixed', inset: 0, zIndex: 9000 }} />
              <div style={{
                position: 'fixed',
                left: productCtxMenu.x, top: productCtxMenu.y,
                zIndex: 9001,
                width: 190,
                borderRadius: 12,
                overflow: 'hidden',
                background: 'linear-gradient(160deg, rgba(255,255,255,0.96) 0%, rgba(245,245,248,0.94) 100%)',
                boxShadow: '0 0 0 0.5px rgba(255,255,255,0.9), 0 12px 36px rgba(0,0,0,0.18), 0 3px 10px rgba(0,0,0,0.10), inset 0 1px 0 rgba(255,255,255,1)',
                border: '0.5px solid rgba(180,180,190,0.35)',
                animation: 'ctxIn 0.22s cubic-bezier(0.34,1.36,0.64,1)',
                transformOrigin: productCtxMenu.above ? 'bottom left' : 'top left',
              }}>
                <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0,
                  background: 'linear-gradient(140deg, rgba(255,255,255,0.6) 0%, transparent 45%)' }} />

                {/* Ask Fabrics — attaches the product to the input bar (visible,
                    focused, hinted) whether or not a conversation is already
                    open. Previously this appended straight into stylistProducts
                    when mid-conversation with zero feedback — no focus, no hint,
                    and the pinned chip rendered at the very TOP of the scrolling
                    thread where it was invisible after a few messages, plus it
                    silently stuck around to get attached to the next unrelated
                    question. Routing through the same barProducts path the
                    empty-state flow already uses fixes both. */}
                <div onClick={() => {
                    if (Date.now() - ctxMenuOpenAt.current < 350) return
                    addBarProduct(productCtxMenu.product)
                    setProductCtxMenu(null)
                  }}
                  style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center',
                    justifyContent: 'space-between', padding: '11px 14px', cursor: 'pointer', gap: 8,
                    fontFamily: '-apple-system,BlinkMacSystemFont,system-ui,sans-serif',
                    fontSize: 14, fontWeight: 400, color: '#1C1C1E' }}
                  onPointerDown={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.07)')}
                  onPointerUp={e => (e.currentTarget.style.background = '')}
                  onPointerLeave={e => (e.currentTarget.style.background = '')}>
                  <span>Ask Fabrics</span>
                  <FabricsIcon size={14} stroke="rgba(60,60,67,0.6)" strokeWidth={1.05}/>
                </div>

              </div>
            </>
          )}

          {/* ── Product sheet — liquid glass ── */}
          <div className="fr-sheet" style={isWide ? {
            // Desktop / tablet — centred landscape card, scale + fade
            height: "min(680px, 88vh)",
            transform: selectedProduct
              ? "translate(-50%, -50%) scale(1)"
              : "translate(-50%, -50%) scale(0.96)",
            opacity: selectedProduct ? 1 : 0,
            pointerEvents: selectedProduct ? "auto" : "none",
            transition: "transform .34s cubic-bezier(.32,.72,0,1), opacity .28s ease",
            willChange: "transform, opacity",
          } : {
            // Phone — slide up from bottom
            maxHeight: "92%",
            transform: selectedProduct
              ? `translateY(${isDragging ? sheetY : (sheetSnap === 'half' ? window.innerHeight * 0.44 : 0)}px)`
              : "translateY(100%)",
            transition: isDragging ? "none" : "transform .42s cubic-bezier(.32,.72,0,1)",
            willChange: "transform",
          }}>
            {selectedProduct && (
              <>
                {/* Drag handle — phone only; not needed on desktop (X button closes) */}
                {!isWide && (
                  <div ref={dragHandleRef} className="fr-drag" onPointerDown={onHandleDown} onPointerMove={onHandleMove} onPointerUp={onHandleUp} onPointerLeave={onHandleUp}>
                    <div className="fr-drag-pill" />
                  </div>
                )}


                {isWide ? (
                  /* ── Desktop / tablet: image left + details right ── */
                  <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

                    {/* Left — full-height 4:5 image, swipeable carousel (touch + trackpad) */}
                    <div ref={imgWheelRef} style={{ height: '100%', aspectRatio: '4 / 5', width: 'auto', maxWidth: '52%', flexShrink: 0, position: 'relative', overflow: 'hidden', borderRadius: '28px 0 0 28px', background: '#F2F2F2', touchAction: sheetImages.length > 1 ? 'none' : 'auto' }}
                      onPointerDown={sheetImages.length > 1 ? onImgDown : undefined}
                      onPointerMove={sheetImages.length > 1 ? (e => onImgMove(e, sheetImages.length)) : undefined}
                      onPointerUp={sheetImages.length > 1 ? (() => onImgUp(sheetImages.length)) : undefined}
                      onPointerCancel={sheetImages.length > 1 ? (() => onImgUp(sheetImages.length)) : undefined}
                    >
                      <div style={{ display: 'flex', height: '100%', transition: (imgActive.current && imgLockH.current) ? 'none' : 'transform .32s cubic-bezier(.32,.72,0,1)', transform: `translateX(calc(-${activeImg * 100}% + ${imgDX}px))` }}>
                        {sheetImages.length > 0 ? sheetImages.map((img, i) => (
                          <div key={i} style={{ width: '100%', height: '100%', flexShrink: 0 }}>
                            <img src={img} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', userSelect: 'none', pointerEvents: 'none' }} />
                          </div>
                        )) : (
                          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={INK3} strokeWidth="1.4" opacity=".4"><path d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" strokeLinecap="round" strokeLinejoin="round"/></svg>
                          </div>
                        )}
                      </div>
                      {sheetImages.length > 1 && (
                        <div style={{ position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 6 }}>
                          {sheetImages.map((_, i) => (
                            <div key={i} onClick={e => { e.stopPropagation(); setActiveImg(i) }}
                              style={{ width: 7, height: 7, borderRadius: '50%', cursor: 'pointer', transition: 'background .18s',
                                background: i === activeImg ? '#fff' : 'rgba(255,255,255,.5)',
                                boxShadow: '0 1px 4px rgba(0,0,0,.35)',
                              }} />
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Right — scrollable product details */}
                    <div style={{ flex: 1, overflowY: 'auto', scrollbarWidth: 'none' as const, display: 'flex', flexDirection: 'column', paddingBottom: 28, overscrollBehaviorY: 'contain' }}>

                      {/* Close row — X sits alone at the top, no overlap with content */}
                      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '14px 14px 0' }}>
                        <button onClick={() => setSelected(null)} aria-label="Close"
                          style={{ width: 30, height: 30, borderRadius: '50%', border: 'none', cursor: 'pointer', flexShrink: 0,
                            background: 'rgba(0,0,0,.07)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                            transition: 'background .15s' }}
                          onPointerEnter={e => (e.currentTarget.style.background = 'rgba(0,0,0,.14)')}
                          onPointerLeave={e => (e.currentTarget.style.background = 'rgba(0,0,0,.07)')}>
                          <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                            <path d="M1 1l10 10M11 1L1 11" stroke={INK} strokeWidth="1.6" strokeLinecap="round"/>
                          </svg>
                        </button>
                      </div>

                      {/* Title + save + price */}
                      <div style={{ padding: '12px 24px 0' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                          <h2 style={{ fontFamily: SANS, fontSize: 14, fontWeight: 500, color: INK, lineHeight: 1.3, letterSpacing: '.06em', textTransform: 'uppercase', flex: 1 }}>
                            {selectedProduct.title}
                          </h2>
                          <button onClick={() => toggleSaved(selectedProduct)} aria-label={savedIds.has(selectedProduct.id) ? 'In your bag' : 'Bag it'}
                            style={{ background: 'transparent', border: 'none', padding: '2px 4px', cursor: 'pointer', flexShrink: 0, marginTop: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" fill={savedIds.has(selectedProduct.id) ? INK : 'none'} />
                              <line x1="3" y1="6" x2="21" y2="6" stroke={savedIds.has(selectedProduct.id) ? '#fff' : INK} />
                              <path d="M16 10a4 4 0 0 1-8 0" stroke={savedIds.has(selectedProduct.id) ? '#fff' : INK} />
                            </svg>
                            <span style={{ fontFamily: SANS, fontSize: 8.5, letterSpacing: '.09em', textTransform: 'uppercase', color: INK, lineHeight: 1 }}>
                              {savedIds.has(selectedProduct.id) ? 'Bagged' : 'Bag it'}
                            </span>
                          </button>
                        </div>
                        <p style={{ fontFamily: SANS, fontSize: 18, color: INK, fontWeight: 700, marginTop: 10 }}>
                          {formatMoney(selectedProduct.price, selectedProduct.currency, selectedProduct.base_currency, liveRates)}
                        </p>
                        {selectedProduct.currency !== selectedProduct.base_currency ? (
                          <p style={{ fontFamily: SANS, fontSize: 11, color: INK3, marginTop: 3, fontWeight: 300 }}>
                            {formatMoney(selectedProduct.price, selectedProduct.base_currency, selectedProduct.base_currency, liveRates)} · Live rate
                          </p>
                        ) : (
                          <p style={{ fontFamily: SANS, fontSize: 11, color: INK3, marginTop: 3, fontWeight: 300 }}>Prices at checkout may vary</p>
                        )}
                      </div>

                      {sheetColors.length > 0 && (
                        <div style={{ padding: '18px 24px 0' }}>
                          <p style={{ fontFamily: SANS, fontSize: 12, marginBottom: 10, letterSpacing: '.02em' }}>
                            <span style={{ color: INK3 }}>Colour: </span><span style={{ color: INK }}>{effectiveColor}</span>
                          </p>
                          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                            {sheetColors.map(c => {
                              const on = effectiveColor === c
                              const avail = colorAvail[c] !== false
                              return (
                                <ColorSwatch key={c} name={c} imageUrl={swatchImageFor(c)} size={26} shape="round"
                                  selected={on} available={avail} onClick={() => avail && setColor(c)} />
                              )
                            })}
                          </div>
                        </div>
                      )}

                      <div style={{ padding: '16px 24px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontFamily: SANS, fontSize: 12, color: INK2 }}>
                          <span style={{ width: 7, height: 7, background: selectedProduct.in_stock ? '#3d5c3a' : '#c0392b', display: 'inline-block' }} />
                          {selectedProduct.in_stock ? 'In stock' : 'Out of stock'}
                        </span>
                      </div>

                      {sheetSizes.length > 0 && (
                        <div style={{ padding: '14px 24px 0' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                            <span style={{ fontFamily: SANS, fontSize: 11, color: INK3, letterSpacing: '.04em', textTransform: 'uppercase' }}>Size</span>
                            <button onClick={() => setSizeGuideOpen(true)} style={{ fontFamily: SANS, fontSize: 11, color: INK3, background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline', textUnderlineOffset: 3, letterSpacing: '.03em' }}>
                              {sizeGuideLoading && !sheetSizeTable && !fetchedSizeGuide ? 'Loading…' : 'Size Guide'}
                            </button>
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(sheetSizes.length, 6)},1fr)` }}>
                            {sheetSizes.map((s, i) => {
                              const avail = sizeAvail[s] !== false
                              const on = selectedSize === s
                              return (
                                <button key={s} disabled={!avail} onClick={() => avail && setSize(on ? null : s)}
                                  className={`fr-szbox${on ? ' on' : ''}${avail ? '' : ' dis'}`}
                                  style={{ marginLeft: i % 6 === 0 ? 0 : -1 }}>
                                  {normalizeSizeLabel(s)}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      )}

                      <div style={{ padding: '16px 24px 0' }}>
                        <button type="button"
                          className={`fr-add${sheetSizes.length > 0 && !selectedSize ? ' warn' : ''}`}
                          onClick={() => { if (sheetSizes.length > 0 && !selectedSize) return; openCheckout(checkoutUrl) }}>
                          {sheetSizes.length > 0 && !selectedSize ? 'Select a size' : 'Checkout'}
                        </button>
                        <button type="button"
                          onClick={() => findMoreLikeThis(selectedProduct)}
                          style={{
                            width: '100%', marginTop: 10, padding: '13px 0', cursor: 'pointer',
                            fontFamily: SANS, fontSize: 12, fontWeight: 600, letterSpacing: '.08em',
                            textTransform: 'uppercase', color: INK, background: 'transparent',
                            border: `1px solid ${INK}`,
                          }}>
                          Find more like this
                        </button>
                      </div>

                      <div style={{ padding: '14px 24px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontFamily: SANS, fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', color: INK3 }}>
                          From: {sheetBrandName}
                        </span>
                        <a href={selectedProduct.store_url} target="_blank" rel="noopener noreferrer"
                          style={{ fontFamily: SANS, fontSize: 11, fontWeight: 500, letterSpacing: '.06em', textTransform: 'uppercase', color: INK, textDecoration: 'underline', textUnderlineOffset: 3 }}>
                          Visit store
                        </a>
                      </div>

                      <div style={{ padding: '10px 24px 0' }}>
                        <button type="button" onClick={() => flagBadMatch(selectedProduct)} disabled={flaggedIds.has(selectedProduct.id)}
                          style={{ fontFamily: SANS, fontSize: 11, color: INK3, background: 'none', border: 'none', cursor: flaggedIds.has(selectedProduct.id) ? 'default' : 'pointer', padding: 0 }}>
                          {flaggedIds.has(selectedProduct.id) ? 'Thanks — noted.' : "Not what you searched for?"}
                        </button>
                      </div>

                      <div key={selectedProduct.id} style={{ padding: '16px 24px 0' }}>
                        {(sheetDesc || sheetDescHtml) && (
                          <Accordion label="Description & Fit" defaultOpen>
                            {cleanDescLoading && !cleanDesc ? (
                              <p style={{ fontFamily: SANS, fontSize: 13, color: INK3, fontWeight: 300, lineHeight: 1.7 }}>…</p>
                            ) : cleanDesc ? (
                              <p style={{ fontFamily: SANS, fontSize: 13, color: INK2, lineHeight: 1.75, fontWeight: 300, whiteSpace: 'pre-line' }}>{cleanDesc}</p>
                            ) : sheetDescHtml ? (
                              <div className="fr-html" dangerouslySetInnerHTML={{ __html: sheetDescHtml }} />
                            ) : (
                              <p style={{ fontFamily: SANS, fontSize: 13, color: INK2, lineHeight: 1.75, fontWeight: 300, whiteSpace: 'pre-line' }}>{sheetDesc}</p>
                            )}
                          </Accordion>
                        )}
                        {(sheetMaterial || sheetCareTags.length > 0) && (
                          <Accordion label="Materials & Care">
                            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
                              {sheetMaterial && sheetMaterial.split(/[,;]+/).map(m => m.trim()).filter(Boolean).map((m, i) => (
                                <li key={`mat-${i}`} style={{ fontFamily: SANS, fontSize: 13, color: INK2, fontWeight: 300, lineHeight: 1.5 }}>
                                  {'• '}{m.charAt(0).toUpperCase() + m.slice(1)}
                                </li>
                              ))}
                              {sheetCareTags.map((tag, i) => (
                                <li key={`care-${i}`} style={{ fontFamily: SANS, fontSize: 13, color: INK2, fontWeight: 300, lineHeight: 1.5 }}>
                                  {'• '}{tag}
                                </li>
                              ))}
                            </ul>
                          </Accordion>
                        )}
                        {sheetDetailTags.length > 0 && (
                          <Accordion label="Product Details">
                            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 7 }}>
                              {sheetDetailTags.slice(0, 16).map((tag, i) => (
                                <li key={i} style={{ fontFamily: SANS, fontSize: 13, color: INK2, fontWeight: 300, lineHeight: 1.5 }}>
                                  {'• '}{tag}
                                </li>
                              ))}
                            </ul>
                          </Accordion>
                        )}
                        <Accordion label="Delivery & Returns">
                          {shippingInfo ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                              {shippingInfo.shipping && (
                                <div>
                                  <p style={{ fontFamily: SANS, fontSize: 10, fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase', color: INK3, marginBottom: 8 }}>Shipping</p>
                                  {shippingInfo.shipping.split('\n').filter(l => l.trim()).map((line, i) => (
                                    <p key={i} style={{ fontFamily: SANS, fontSize: 13, color: INK2, fontWeight: 300, lineHeight: 1.6, marginBottom: 4 }}>{line.trim()}</p>
                                  ))}
                                </div>
                              )}
                              {shippingInfo.returns && (
                                <div>
                                  <p style={{ fontFamily: SANS, fontSize: 10, fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase', color: INK3, marginBottom: 8 }}>Returns</p>
                                  {shippingInfo.returns.split('\n').filter(l => l.trim()).map((line, i) => (
                                    <p key={i} style={{ fontFamily: SANS, fontSize: 13, color: INK2, fontWeight: 300, lineHeight: 1.6, marginBottom: 4 }}>{line.trim()}</p>
                                  ))}
                                </div>
                              )}
                            </div>
                          ) : (
                            <p style={{ fontFamily: SANS, fontSize: 13, color: INK2, lineHeight: 1.7, fontWeight: 300 }}>
                              Shipping and returns are handled directly by {sheetBrandName || 'the store'}. Delivery times and return windows vary. Check their policies at checkout.
                            </p>
                          )}
                        </Accordion>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* ── Phone: original stacked layout ── */
                  <div style={{ flex: 1, overflowY: "auto", scrollbarWidth: "none", paddingBottom: 24, overscrollBehaviorY: "contain" }}>
                    <div>
                      <div style={{ position: "relative", overflow: "hidden", touchAction: "pan-y" }}
                        onPointerDown={sheetImages.length > 1 ? onImgDown : undefined}
                        onPointerMove={sheetImages.length > 1 ? (e => onImgMove(e, sheetImages.length)) : undefined}
                        onPointerUp={sheetImages.length > 1 ? (() => onImgUp(sheetImages.length)) : undefined}
                        onPointerCancel={sheetImages.length > 1 ? (() => onImgUp(sheetImages.length)) : undefined}
                      >
                        <div style={{ display: "flex", transition: (imgActive.current && imgLockH.current) ? "none" : "transform .32s cubic-bezier(.32,.72,0,1)", transform: `translateX(calc(-${activeImg * 100}% + ${imgDX}px))` }}>
                          {sheetImages.length > 0 ? sheetImages.map((img, i) => (
                            <div key={i} style={{ width: "100%", flexShrink: 0 }}>
                              <img src={img} alt="" draggable={false} style={{ width: "100%", aspectRatio: "4/5", objectFit: "cover", background: "#f5f4f2", display: "block", userSelect: "none", pointerEvents: "none" }} />
                            </div>
                          )) : (
                            <div style={{ width: "100%", aspectRatio: "4/5", background: "#ebebeb", display: "flex", alignItems: "center", justifyContent: "center" }}>
                              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={INK3} strokeWidth="1.4" opacity=".4"><path d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" strokeLinecap="round" strokeLinejoin="round"/></svg>
                            </div>
                          )}
                        </div>
                        {sheetImages.length > 1 && (
                          <div style={{ position: "absolute", bottom: 12, left: 12, display: "flex", gap: 5 }}>
                            {sheetImages.map((_, i) => (
                              <div key={i} onClick={e => { e.stopPropagation(); setActiveImg(i) }}
                                style={{
                                  width: 9, height: 9, cursor: "pointer", transition: "background .18s",
                                  background: i === activeImg ? "#1A1A1A" : "rgba(255,255,255,.55)",
                                  border: i === activeImg ? "1px solid #1A1A1A" : "1px solid rgba(26,26,26,.45)",
                                  boxShadow: "0 0 0 0.5px rgba(255,255,255,.35)",
                                }} />
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {sheetImages.length > 1 && (
                      <div style={{ padding: "10px 16px 0", display: "flex", gap: 6, overflowX: "auto", scrollbarWidth: "none" }}>
                        {sheetImages.map((img, i) => (
                          <button key={i} onClick={() => setActiveImg(i)}
                            style={{ width: 46, height: 58, overflow: "hidden", padding: 0, border: `1.5px solid ${i === activeImg ? INK : 'transparent'}`, cursor: "pointer", background: "#ebebeb", flexShrink: 0, transition: "border-color .15s" }}>
                            <img src={img} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                          </button>
                        ))}
                      </div>
                    )}

                    <div style={{ padding: "18px 20px 0" }}>
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                        <h2 style={{ fontFamily: SANS, fontSize: "clamp(14px,4vw,16px)", fontWeight: 500, color: INK, lineHeight: 1.3, letterSpacing: ".01em", textTransform: "uppercase", flex: 1 }}>
                          {selectedProduct.title}
                        </h2>
                        <button onClick={() => toggleSaved(selectedProduct)} aria-label={savedIds.has(selectedProduct.id) ? 'In your bag' : 'Bag it'}
                          style={{ background: "transparent", border: "none", padding: "2px 4px", cursor: "pointer", flexShrink: 0, marginTop: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" fill={savedIds.has(selectedProduct.id) ? INK : "none"} />
                            <line x1="3" y1="6" x2="21" y2="6" stroke={savedIds.has(selectedProduct.id) ? '#fff' : INK} />
                            <path d="M16 10a4 4 0 0 1-8 0" stroke={savedIds.has(selectedProduct.id) ? '#fff' : INK} />
                          </svg>
                          <span style={{ fontFamily: SANS, fontSize: 8.5, letterSpacing: ".09em", textTransform: "uppercase", color: INK, lineHeight: 1 }}>
                            {savedIds.has(selectedProduct.id) ? 'Bagged' : 'Bag it'}
                          </span>
                        </button>
                      </div>
                      <p style={{ fontFamily: SANS, fontSize: "clamp(15px,4vw,17px)", color: INK, fontWeight: 700, marginTop: 8 }}>
                        {formatMoney(selectedProduct.price, selectedProduct.currency, selectedProduct.base_currency, liveRates)}
                      </p>
                      {selectedProduct.currency !== selectedProduct.base_currency ? (
                        <p style={{ fontFamily: SANS, fontSize: 11, color: INK3, marginTop: 3, fontWeight: 300 }}>
                          {formatMoney(selectedProduct.price, selectedProduct.base_currency, selectedProduct.base_currency, liveRates)} · Live rate
                        </p>
                      ) : (
                        <p style={{ fontFamily: SANS, fontSize: 11, color: INK3, marginTop: 3, fontWeight: 300 }}>Prices at checkout may vary</p>
                      )}
                    </div>

                    {sheetColors.length > 0 && (
                      <div style={{ padding: "18px 20px 0" }}>
                        <p style={{ fontFamily: SANS, fontSize: 12, marginBottom: 10, letterSpacing: ".02em" }}>
                          <span style={{ color: INK3 }}>Colour: </span><span style={{ color: INK }}>{effectiveColor}</span>
                        </p>
                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                          {sheetColors.map(c => {
                            const on = effectiveColor === c
                            const avail = colorAvail[c] !== false
                            return (
                              <ColorSwatch key={c} name={c} imageUrl={swatchImageFor(c)} size={26} shape="round"
                                selected={on} available={avail} onClick={() => avail && setColor(c)} />
                            )
                          })}
                        </div>
                      </div>
                    )}

                    <div style={{ padding: "18px 20px 0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 7, fontFamily: SANS, fontSize: 12, color: INK2 }}>
                        <span style={{ width: 7, height: 7, background: selectedProduct.in_stock ? "#3d5c3a" : "#c0392b", display: "inline-block" }} />
                        {selectedProduct.in_stock ? "In stock" : "Out of stock"}
                      </span>
                      {similarItems.length > 0 && (
                        <button onClick={() => similarRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
                          style={{ fontFamily: SANS, fontSize: 11, fontWeight: 500, letterSpacing: ".06em", textTransform: "uppercase", color: INK, background: "transparent", border: "none", textDecoration: "underline", textUnderlineOffset: 3, cursor: "pointer" }}>
                          View similar
                        </button>
                      )}
                    </div>

                    {sheetSizes.length > 0 && (
                      <div style={{ padding: "14px 20px 0" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                          <span style={{ fontFamily: SANS, fontSize: 11, color: INK3, letterSpacing: ".04em", textTransform: "uppercase" }}>Size</span>
                          <button onClick={() => setSizeGuideOpen(true)} style={{ fontFamily: SANS, fontSize: 11, color: INK3, background: "none", border: "none", cursor: "pointer", padding: 0, textDecoration: "underline", textUnderlineOffset: 3, letterSpacing: ".03em" }}>
                            {sizeGuideLoading && !sheetSizeTable && !fetchedSizeGuide ? 'Loading…' : 'Size Guide'}
                          </button>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(sheetSizes.length, 6)},1fr)` }}>
                          {sheetSizes.map((s, i) => {
                            const avail = sizeAvail[s] !== false
                            const on = selectedSize === s
                            return (
                              <button key={s} disabled={!avail} onClick={() => avail && setSize(on ? null : s)}
                                className={`fr-szbox${on ? " on" : ""}${avail ? "" : " dis"}`}
                                style={{ marginLeft: i % 6 === 0 ? 0 : -1 }}>
                                {normalizeSizeLabel(s)}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    <div style={{ padding: "16px 20px 0" }}>
                      <button type="button"
                        className={`fr-add${sheetSizes.length > 0 && !selectedSize ? " warn" : ""}`}
                        onClick={() => { if (sheetSizes.length > 0 && !selectedSize) return; openCheckout(checkoutUrl) }}>
                        {sheetSizes.length > 0 && !selectedSize ? "Select a size" : "Checkout"}
                      </button>
                      <button type="button"
                        onClick={() => findMoreLikeThis(selectedProduct)}
                        style={{
                          width: "100%", marginTop: 10, padding: "13px 0", cursor: "pointer",
                          fontFamily: SANS, fontSize: 12, fontWeight: 600, letterSpacing: ".08em",
                          textTransform: "uppercase", color: INK, background: "transparent",
                          border: `1px solid ${INK}`,
                        }}>
                        Find more like this
                      </button>
                    </div>

                    <div style={{ padding: "16px 20px 0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontFamily: SANS, fontSize: 11, letterSpacing: ".06em", textTransform: "uppercase", color: INK3 }}>
                        From: {sheetBrandName}
                      </span>
                      <a href={selectedProduct.store_url} target="_blank" rel="noopener noreferrer"
                        style={{ fontFamily: SANS, fontSize: 11, fontWeight: 500, letterSpacing: ".06em", textTransform: "uppercase", color: INK, textDecoration: "underline", textUnderlineOffset: 3 }}>
                        Visit store
                      </a>
                    </div>

                    <div style={{ padding: "10px 20px 0" }}>
                      <button type="button" onClick={() => flagBadMatch(selectedProduct)} disabled={flaggedIds.has(selectedProduct.id)}
                        style={{ fontFamily: SANS, fontSize: 11, color: INK3, background: "none", border: "none", cursor: flaggedIds.has(selectedProduct.id) ? "default" : "pointer", padding: 0 }}>
                        {flaggedIds.has(selectedProduct.id) ? "Thanks — noted." : "Not what you searched for?"}
                      </button>
                    </div>

                    <div key={selectedProduct.id} style={{ padding: "22px 20px 0" }}>
                      {(sheetDesc || sheetDescHtml) && (
                        <Accordion label="Description & Fit" defaultOpen>
                          {cleanDescLoading && !cleanDesc ? (
                            <p style={{ fontFamily: SANS, fontSize: 13, color: INK3, fontWeight: 300, lineHeight: 1.7 }}>…</p>
                          ) : cleanDesc ? (
                            <p style={{ fontFamily: SANS, fontSize: 13, color: INK2, lineHeight: 1.75, fontWeight: 300, whiteSpace: "pre-line" }}>{cleanDesc}</p>
                          ) : sheetDescHtml ? (
                            <div className="fr-html" dangerouslySetInnerHTML={{ __html: sheetDescHtml }} />
                          ) : (
                            <p style={{ fontFamily: SANS, fontSize: 13, color: INK2, lineHeight: 1.75, fontWeight: 300, whiteSpace: "pre-line" }}>{sheetDesc}</p>
                          )}
                        </Accordion>
                      )}
                      {(sheetMaterial || sheetCareTags.length > 0) && (
                        <Accordion label="Materials & Care">
                          <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
                            {sheetMaterial && sheetMaterial.split(/[,;]+/).map(m => m.trim()).filter(Boolean).map((m, i) => (
                              <li key={`mat-${i}`} style={{ fontFamily: SANS, fontSize: 13, color: INK2, fontWeight: 300, lineHeight: 1.5 }}>
                                {'• '}{m.charAt(0).toUpperCase() + m.slice(1)}
                              </li>
                            ))}
                            {sheetCareTags.map((tag, i) => (
                              <li key={`care-${i}`} style={{ fontFamily: SANS, fontSize: 13, color: INK2, fontWeight: 300, lineHeight: 1.5 }}>
                                {'• '}{tag}
                              </li>
                            ))}
                          </ul>
                        </Accordion>
                      )}
                      {sheetDetailTags.length > 0 && (
                        <Accordion label="Product Details">
                          <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 7 }}>
                            {sheetDetailTags.slice(0, 16).map((tag, i) => (
                              <li key={i} style={{ fontFamily: SANS, fontSize: 13, color: INK2, fontWeight: 300, lineHeight: 1.5 }}>
                                {'• '}{tag}
                              </li>
                            ))}
                          </ul>
                        </Accordion>
                      )}
                      <Accordion label="Delivery & Returns">
                        {shippingInfo ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                            {shippingInfo.shipping && (
                              <div>
                                <p style={{ fontFamily: SANS, fontSize: 10, fontWeight: 600, letterSpacing: ".1em", textTransform: "uppercase", color: INK3, marginBottom: 8 }}>Shipping</p>
                                {shippingInfo.shipping.split('\n').filter(l => l.trim()).map((line, i) => (
                                  <p key={i} style={{ fontFamily: SANS, fontSize: 13, color: INK2, fontWeight: 300, lineHeight: 1.6, marginBottom: 4 }}>{line.trim()}</p>
                                ))}
                              </div>
                            )}
                            {shippingInfo.returns && (
                              <div>
                                <p style={{ fontFamily: SANS, fontSize: 10, fontWeight: 600, letterSpacing: ".1em", textTransform: "uppercase", color: INK3, marginBottom: 8 }}>Returns</p>
                                {shippingInfo.returns.split('\n').filter(l => l.trim()).map((line, i) => (
                                  <p key={i} style={{ fontFamily: SANS, fontSize: 13, color: INK2, fontWeight: 300, lineHeight: 1.6, marginBottom: 4 }}>{line.trim()}</p>
                                ))}
                              </div>
                            )}
                          </div>
                        ) : (
                          <p style={{ fontFamily: SANS, fontSize: 13, color: INK2, lineHeight: 1.7, fontWeight: 300 }}>
                            Shipping and returns are handled directly by {sheetBrandName || "the store"}. Delivery times and return windows vary. Check their policies at checkout.
                          </p>
                        )}
                      </Accordion>
                    </div>

                    {similarItems.length > 0 && (
                      <div ref={similarRef} style={{ padding: "26px 0 0" }}>
                        <div style={{ padding: "0 20px", marginBottom: 14 }}>
                          <span style={{ fontFamily: SANS, fontSize: 12, fontWeight: 600, letterSpacing: ".07em", textTransform: "uppercase", color: INK }}>Similar items</span>
                        </div>
                        <div style={{ display: "flex", gap: 10, overflowX: "auto", scrollbarWidth: "none", padding: "0 20px 4px", touchAction: "pan-x", overscrollBehaviorX: "contain" }}>
                          {similarItems.map(p => (
                            <button key={p.id} onClick={() => setSelected(p)}
                              style={{ flexShrink: 0, width: 120, background: "transparent", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}>
                              <div style={{ width: 120, aspectRatio: "3/4", overflow: "hidden", background: "#F2F2F2", marginBottom: 7 }}>
                                {p.image_url && <img src={p.image_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
                              </div>
                              <div style={{ fontFamily: SANS, fontSize: 11.5, color: INK, lineHeight: 1.35, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.title}</div>
                              <div style={{ fontFamily: SANS, fontSize: 11.5, color: INK2, fontWeight: 600, marginTop: 3 }}>{formatMoney(p.price, p.currency, p.base_currency, liveRates)}</div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <div style={{ height: 28 }} />
                  </div>
                )}
              </>
            )}
          </div>

        </div>
      </div>
    </div>
  )
}
