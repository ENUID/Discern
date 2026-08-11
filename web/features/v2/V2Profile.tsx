'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useQuery, useMutation } from 'convex/react'
import { api } from '@/convex/_generated/api'
import { useConvexAuthProof } from '@/hooks/useConvexAuthProof'
import { V2 } from './theme'

/**
 * Who the shopper is, in the four facts the stylist actually uses.
 *
 * The plumbing for this already existed — gender and sizes travel with every
 * request and the catalogue ranks on them — but nothing in this interface could
 * write them, so for every shopper here they were empty. The model was told
 * "no gender, no sizes" on every search and answered accordingly. This is the
 * missing half.
 *
 * Sizes are free text, as they were in the chat UI, because size systems are
 * not a closed set: UK 8, EU 38, 30x32 and M all have to be sayable. The
 * catalogue treats them as a soft ranking signal rather than a filter, so an
 * unusual value costs nothing.
 */

const GENDERS = ['Men', 'Women'] as const
type Gender = (typeof GENDERS)[number]

// An account written before this — or by the chat UI, which offered four —
// can still hold a value these two chips cannot show. It reads back as
// unselected, and the backend still understands the old values (route.ts
// branches on 'Both'), so nothing breaks; it is only overwritten if the
// shopper picks one of these.
const asGender = (v: unknown): Gender | '' =>
  (GENDERS as readonly string[]).includes(v as string) ? (v as Gender) : ''

const FIELDS = [
  { key: 'tops' as const, label: 'Tops', hint: (g?: string) => (g === 'Women' ? 'XS, S, M…' : 'S, M, L, XL…') },
  { key: 'bottoms' as const, label: 'Bottoms', hint: (g?: string) => (g === 'Women' ? '26, 28, 30…' : '30, 32, 34…') },
  { key: 'shoes' as const, label: 'Shoes', hint: (g?: string) => (g === 'Women' ? '6, 7, EU 38…' : '9, 10, EU 43…') },
]

type Sizes = { tops: string; bottoms: string; shoes: string }
const EMPTY: Sizes = { tops: '', bottoms: '', shoes: '' }

// The country arrives as a two-letter code because that is what the catalogue
// needs. Nobody reads "shopping from IE" as a sentence, so spell it out where
// the browser can, and fall back to the code where it cannot.
const countryName = (code: string) => {
  try {
    return new Intl.DisplayNames(undefined, { type: 'region' }).of(code.toUpperCase()) ?? code
  } catch {
    return code
  }
}

export default function V2Profile({ country }: { country?: string }) {
  const { data: session, status } = useSession()
  const email = session?.user?.email ?? undefined
  const authProof = useConvexAuthProof(email)
  const scope = email && authProof ? { userEmail: email, authProof } : 'skip'

  const profile = useQuery(api.tasteProfile.getTasteProfile, scope as never) as
    { sizes?: Record<string, string>
      wardrobe?: { summary?: string; items?: Array<{ color?: string; type?: string }> } }
    | undefined | null
  const save = useMutation(api.tasteProfile.upsertTasteProfile)

  const [gender, setGender] = useState<Gender | ''>('')
  const [sizes, setSizes] = useState<Sizes>(EMPTY)
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle')

  // Fill in from the account once, when it arrives. Keyed on the query landing
  // rather than on mount, because Convex resolves after the first render.
  const loaded = profile !== undefined
  useEffect(() => {
    if (!loaded || !profile?.sizes) return
    const s = profile.sizes
    setGender(asGender(s.gender))
    setSizes({ tops: s.tops ?? '', bottoms: s.bottoms ?? '', shoes: s.shoes ?? '' })
  }, [loaded, profile])

  const dirty = useMemo(() => {
    const s = profile?.sizes ?? {}
    // Compared against the normalised value, so an account holding an old
    // four-way answer does not open with Save already lit.
    return asGender(s.gender) !== gender
      || (s.tops ?? '') !== sizes.tops
      || (s.bottoms ?? '') !== sizes.bottoms
      || (s.shoes ?? '') !== sizes.shoes
  }, [profile, gender, sizes])

  // ── The wardrobe ──────────────────────────────────────────────────────────
  // The stylist reads this on every request — shopperWardrobe is what stops it
  // recommending the coat you already own — and until now nothing in this
  // interface could write it, so it was empty for every v2 shopper. The chat UI
  // had the scan; this is that, in the place the other facts about you live.
  //
  // The endpoint owns the vision call and the save (mode: 'wardrobe-scan'), so
  // this is a file picker, a compressor and a status line.
  const [scanning, setScanning] = useState(false)
  const [scanNote, setScanNote] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  /** 768px JPEG data URLs, the same pipeline the composer uses for photos. A
   *  raw phone photograph is several megabytes and four of them will not fit in
   *  a request body. */
  const compress = (file: File) => new Promise<string | null>(resolve => {
    const reader = new FileReader()
    reader.onload = ev => {
      const img = new Image()
      img.onload = () => {
        const scale = Math.min(1, 768 / Math.max(img.width, img.height))
        const c = document.createElement('canvas')
        c.width = Math.round(img.width * scale)
        c.height = Math.round(img.height * scale)
        const ctx2d = c.getContext('2d')
        if (!ctx2d) return resolve(null)
        ctx2d.drawImage(img, 0, 0, c.width, c.height)
        resolve(c.toDataURL('image/jpeg', 0.82))
      }
      img.onerror = () => resolve(null)
      img.src = String(ev.target?.result ?? '')
    }
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(file)
  })

  const scanWardrobe = async (files: FileList | null) => {
    if (!files?.length || scanning || !email || !authProof) return
    setScanning(true)
    setScanNote(null)
    try {
      // Four is the endpoint's own working limit and plenty for a rail.
      const images = (await Promise.all(Array.from(files).slice(0, 4).map(compress)))
        .filter((x): x is string => !!x)
      if (!images.length) { setScanNote('Those photos could not be read.'); return }

      const res = await fetch('/api/ai/stylist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'wardrobe-scan', images, userEmail: email, authProof }),
      })
      // The endpoint streams progress then one result line, same as a search.
      const text = await res.text()
      let data: any = null
      for (const line of text.split('\n')) {
        const t = line.trim()
        if (!t) continue
        try { const o = JSON.parse(t); if (o.type === 'result') data = o } catch { /* partial */ }
      }
      const n = Array.isArray(data?.wardrobeScan?.items) ? data.wardrobeScan.items.length : 0
      setScanNote(
        n > 0
          ? `Read ${n} ${n === 1 ? 'piece' : 'pieces'}. Fabrics will style around what you already own.`
          : (data?.reply || 'Nothing legible in those. Try clearer, well-lit photos.'),
      )
    } catch {
      setScanNote('That did not go through. Try again.')
    } finally {
      setScanning(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  /** What the account already knows, said back in one line. Without it the
   *  button is a promise with no evidence behind it — and a shopper who scanned
   *  months ago has no way to tell whether it took. */
  const wardrobeLine = useMemo(() => {
    const w = profile?.wardrobe
    const n = w?.items?.length ?? 0
    if (!n && !w?.summary) return ''
    const kinds = Array.from(new Set((w?.items ?? []).map(i => (i.type || '').toLowerCase()).filter(Boolean)))
    const named = kinds.slice(0, 3).join(', ')
    return n
      ? `${n} ${n === 1 ? 'piece' : 'pieces'} on file${named ? ` — ${named}${kinds.length > 3 ? '…' : ''}` : ''}.`
      : (w?.summary ?? '')
  }, [profile])

  const commit = async () => {
    if (!email || !authProof || !dirty || state === 'saving') return
    setState('saving')
    try {
      await save({
        userEmail: email,
        authProof,
        // Merged, not replaced: the wardrobe scan writes into this same blob and
        // saving from here must not wipe it.
        sizes: { ...(profile?.sizes ?? {}), ...sizes, ...(gender ? { gender } : {}) },
      })
      setState('saved')
      setTimeout(() => setState('idle'), 2200)
    } catch {
      setState('idle')
    }
  }

  if (status !== 'authenticated') return null

  return (
    <div className="v2p">
      <span className="v2p-eyebrow">Your sizes</span>
      <p className="v2p-why">
        What you put here goes with every question you ask, so Fabrics stops
        guessing and the catalogue stops offering you things you cannot wear.
      </p>

      <div className="v2p-genders" role="group" aria-label="Shopping for">
        {GENDERS.map(g => (
          <button key={g} type="button" className={gender === g ? 'on' : ''} aria-pressed={gender === g}
            onClick={() => setGender(prev => (prev === g ? '' : g))}>{g}</button>
        ))}
      </div>

      <div className="v2p-rows">
        {FIELDS.map(f => (
          <div className="v2p-row" key={f.key}>
            <label htmlFor={`v2p-${f.key}`}>{f.label}</label>
            <input
              id={`v2p-${f.key}`}
              value={sizes[f.key]}
              onChange={e => setSizes(prev => ({ ...prev, [f.key]: e.target.value }))}
              onBlur={commit}
              placeholder={f.hint(gender || undefined)}
              autoComplete="off"
            />
          </div>
        ))}
      </div>

      <div className="v2p-wardrobe">
        <span className="v2p-eyebrow">Your wardrobe</span>
        <p className="v2p-why">
          Photograph what you already own and Fabrics stops offering it back to
          you — and starts filling the gaps instead.
        </p>
        {wardrobeLine && <p className="v2p-known">{wardrobeLine}</p>}
        <input ref={fileRef} type="file" accept="image/*" multiple hidden
          onChange={e => scanWardrobe(e.target.files)} />
        <button className="v2p-scan" disabled={scanning}
          onClick={() => fileRef.current?.click()}>
          {scanning ? 'Reading your photos…' : wardrobeLine ? 'Scan again' : 'Scan my wardrobe'}
        </button>
        {scanNote && <p className="v2p-scannote">{scanNote}</p>}
      </div>

      {country && (
        <p className="v2p-where">
          Shopping from <b>{countryName(country)}</b> — prices and brands are shown for there.
        </p>
      )}

      <button className="v2p-save" onClick={commit} disabled={!dirty || state === 'saving'}>
        {state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : dirty ? 'Save' : 'Saved'}
      </button>

      <style jsx global>{`
        .v2p{width:100%;text-align:left;margin-top:26px;padding-top:22px;
          border-top:1px solid rgba(var(--srf-ink-rgb),.14);}
        .v2p-eyebrow{display:block;font-size:11px;font-weight:500;opacity:.42;letter-spacing:.04em;
          margin-bottom:8px;}
        .v2p-why{font-size:13px;line-height:1.55;opacity:.6;margin:0 0 18px;}
        .v2p-genders{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:18px;}
        .v2p-genders button{min-height:44px;padding:10px 14px;border-radius:12px;cursor:pointer;
          font-family:${V2.sans};font-size:13px;color:inherit;background:rgba(var(--srf-ink-rgb),.08);
          border:1px solid rgba(var(--srf-ink-rgb),.16);transition:background .16s,border-color .16s;}
        .v2p-genders button.on{background:var(--srf-fill);color:var(--srf-fill-ink);border-color:transparent;font-weight:500;}
        .v2p-rows{display:flex;flex-direction:column;gap:8px;margin-bottom:18px;}
        .v2p-row{display:flex;align-items:center;gap:12px;min-height:44px;padding:0 14px;
          border-radius:12px;background:rgba(var(--srf-ink-rgb),.07);
          border:1px solid rgba(var(--srf-ink-rgb),.14);}
        .v2p-row label{flex:0 0 74px;font-size:13px;opacity:.62;}
        /* 16px: below that iOS zooms the page in when the field takes focus. */
        .v2p-row input{flex:1;min-width:0;border:none;background:none;outline:none;color:inherit;
          font-family:${V2.sans};font-size:16px;text-align:right;padding:11px 0;}
        .v2p-row input::placeholder{color:rgba(var(--srf-ink-rgb),.32);}
        .v2p-wardrobe{margin-bottom:18px;padding-top:18px;
          border-top:1px solid rgba(var(--srf-ink-rgb),.12);}
        .v2p-known{font-size:12px;line-height:1.5;opacity:.62;margin:0 0 12px;}
        .v2p-scan{width:100%;min-height:44px;border-radius:12px;cursor:pointer;
          font-family:${V2.sans};font-size:13px;color:inherit;
          background:rgba(var(--srf-ink-rgb),.08);
          border:1px solid rgba(var(--srf-ink-rgb),.18);transition:background .16s;}
        .v2p-scan:disabled{opacity:.55;cursor:default;}
        .v2p-scannote{font-size:12px;line-height:1.5;opacity:.7;margin:10px 0 0;}
        .v2p-where{font-size:12px;line-height:1.5;opacity:.5;margin:0 0 18px;}
        .v2p-where b{font-weight:500;opacity:.85;}
        .v2p-save{width:100%;min-height:44px;border-radius:12px;border:none;cursor:pointer;
          background:var(--srf-fill);color:var(--srf-fill-ink);font-family:${V2.sans};font-size:14px;font-weight:500;
          transition:opacity .16s;}
        .v2p-save:disabled{opacity:.4;cursor:default;}
      `}</style>
    </div>
  )
}
