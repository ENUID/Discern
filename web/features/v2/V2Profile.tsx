'use client'

import { useEffect, useMemo, useState } from 'react'
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

const GENDERS = ['Women', 'Men', 'Both', 'Non-binary'] as const
type Gender = (typeof GENDERS)[number]

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
    { sizes?: Record<string, string> } | undefined | null
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
    setGender((GENDERS as readonly string[]).includes(s.gender) ? (s.gender as Gender) : '')
    setSizes({ tops: s.tops ?? '', bottoms: s.bottoms ?? '', shoes: s.shoes ?? '' })
  }, [loaded, profile])

  const dirty = useMemo(() => {
    const s = profile?.sizes ?? {}
    return (s.gender ?? '') !== gender
      || (s.tops ?? '') !== sizes.tops
      || (s.bottoms ?? '') !== sizes.bottoms
      || (s.shoes ?? '') !== sizes.shoes
  }, [profile, gender, sizes])

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
          border-top:1px solid rgba(255,255,255,.14);}
        .v2p-eyebrow{display:block;font-size:11px;font-weight:500;opacity:.42;letter-spacing:.04em;
          margin-bottom:8px;}
        .v2p-why{font-size:13px;line-height:1.55;opacity:.6;margin:0 0 18px;}
        .v2p-genders{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:18px;}
        .v2p-genders button{min-height:44px;padding:10px 14px;border-radius:12px;cursor:pointer;
          font-family:${V2.sans};font-size:13px;color:#fff;background:rgba(255,255,255,.08);
          border:1px solid rgba(255,255,255,.16);transition:background .16s,border-color .16s;}
        .v2p-genders button.on{background:#fff;color:${V2.ink};border-color:transparent;font-weight:500;}
        .v2p-rows{display:flex;flex-direction:column;gap:8px;margin-bottom:18px;}
        .v2p-row{display:flex;align-items:center;gap:12px;min-height:44px;padding:0 14px;
          border-radius:12px;background:rgba(255,255,255,.07);
          border:1px solid rgba(255,255,255,.14);}
        .v2p-row label{flex:0 0 74px;font-size:13px;opacity:.62;}
        /* 16px: below that iOS zooms the page in when the field takes focus. */
        .v2p-row input{flex:1;min-width:0;border:none;background:none;outline:none;color:#fff;
          font-family:${V2.sans};font-size:16px;text-align:right;padding:11px 0;}
        .v2p-row input::placeholder{color:rgba(255,255,255,.32);}
        .v2p-where{font-size:12px;line-height:1.5;opacity:.5;margin:0 0 18px;}
        .v2p-where b{font-weight:500;opacity:.85;}
        .v2p-save{width:100%;min-height:44px;border-radius:12px;border:none;cursor:pointer;
          background:#fff;color:${V2.ink};font-family:${V2.sans};font-size:14px;font-weight:500;
          transition:opacity .16s;}
        .v2p-save:disabled{opacity:.4;cursor:default;}
      `}</style>
    </div>
  )
}
