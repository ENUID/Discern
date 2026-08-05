'use client'

/**
 * Sign-in for v2.
 *
 * The first version of this was a white card in the middle of the screen — a
 * generic auth modal that happened to be sitting inside v2. It matched nothing.
 * This is built out of v2's own language instead:
 *
 *   · Full-bleed. The boutique stays visible, blurred, behind a scrim. v2 is an
 *     imagery-first interface and its overlays float over the imagery rather
 *     than covering it with a panel.
 *   · The field IS the composer. v2's single signature control is a frosted
 *     pill you type into with a round button on its right. Signing in reuses
 *     that exact shape and weight, so the moment reads as the same app rather
 *     than a form bolted on. Nothing here is a boxed input.
 *   · One family, display weight. Per features/v2/theme.ts the type never
 *     switches face — display sizes get tighter tracking and more weight. The
 *     headline is Geist at editorial scale with -.035em tracking, the same
 *     register as "Know what to buy."
 *
 * Two behaviours carried over deliberately: it is never a wall (browsing needs
 * no account, and this is always dismissible), and the headline is the reason
 * you were asked rather than a generic "Sign in".
 *
 * Auth itself is the existing system — POST /api/auth/send-code, then
 * signIn('email-otp', {email, code}), plus signIn('google').
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { signIn } from 'next-auth/react'
import { V2 } from './theme'
import { ArrowUpIcon, CloseIcon } from '@/components/icons'

export type V2AuthReason = 'save' | 'bag' | 'orders' | 'account' | null

/** The reason is the headline. A generic one wastes the only moment you have. */
const COPY: Record<Exclude<V2AuthReason, null>, { eyebrow: string; title: string }> = {
  save:    { eyebrow: 'To keep this piece', title: 'Everything you save,\nwherever you are.' },
  bag:     { eyebrow: 'To hold your bag',   title: 'What you gather\nstays gathered.' },
  orders:  { eyebrow: 'To find your orders', title: 'Every order,\nin one place.' },
  account: { eyebrow: 'Your account',        title: 'Pick up exactly\nwhere you left off.' },
}

const CODE_LEN = 6

export default function V2Auth({
  open, reason, onClose, onSignedIn,
}: {
  open: boolean
  reason: V2AuthReason
  onClose: () => void
  onSignedIn?: () => void
}) {
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState<string[]>(Array(CODE_LEN).fill(''))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [cooldown, setCooldown] = useState(0)
  const emailRef = useRef<HTMLInputElement>(null)
  const cellRefs = useRef<Array<HTMLInputElement | null>>([])

  const copy = COPY[reason ?? 'account']
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())

  useEffect(() => {
    if (!open) return
    setStep('email'); setCode(Array(CODE_LEN).fill('')); setErr(''); setBusy(false)
    const t = setTimeout(() => emailRef.current?.focus(), 380)
    return () => clearTimeout(t)
  }, [open])

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  useEffect(() => {
    if (!open) return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [open, onClose])

  const sendCode = useCallback(async () => {
    const addr = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) { setErr('That address looks incomplete.'); return }
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/auth/send-code', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: addr }),
      })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        setErr(d?.error === 'rate_limited' ? 'Too many codes just now. Give it a minute.' : 'Could not send that code.')
        return
      }
      setStep('code'); setCooldown(30)
      setTimeout(() => cellRefs.current[0]?.focus(), 300)
    } catch {
      setErr('Could not reach the server.')
    } finally { setBusy(false) }
  }, [email])

  const verify = useCallback(async (full: string) => {
    setBusy(true); setErr('')
    try {
      const res = await signIn('email-otp', {
        email: email.trim().toLowerCase(), code: full, redirect: false,
      })
      if (res?.error) {
        setErr('That code did not match.')
        setCode(Array(CODE_LEN).fill('')); cellRefs.current[0]?.focus()
        return
      }
      onSignedIn?.(); onClose()
    } catch {
      setErr('Something went wrong signing you in.')
    } finally { setBusy(false) }
  }, [email, onClose, onSignedIn])

  /** Auto-advances, backspaces into the previous cell, and takes a pasted code
   *  into all six at once — the behaviours that separate a code field from six
   *  text boxes. */
  const setCell = (i: number, raw: string) => {
    const chars = raw.replace(/\D/g, '')
    if (!chars) { setCode(c => { const n = [...c]; n[i] = ''; return n }); return }
    setCode(c => {
      const n = [...c]
      for (let k = 0; k < chars.length && i + k < CODE_LEN; k++) n[i + k] = chars[k]
      setTimeout(() => cellRefs.current[Math.min(i + chars.length, CODE_LEN - 1)]?.focus(), 0)
      const full = n.join('')
      if (full.length === CODE_LEN && !n.includes('')) setTimeout(() => verify(full), 120)
      return n
    })
  }

  const onCellKey = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !code[i] && i > 0) cellRefs.current[i - 1]?.focus()
    if (e.key === 'ArrowLeft' && i > 0) cellRefs.current[i - 1]?.focus()
    if (e.key === 'ArrowRight' && i < CODE_LEN - 1) cellRefs.current[i + 1]?.focus()
  }

  if (!open) return null

  return (
    <>
      <div className="v2a-scrim" onClick={onClose} />
      <div className="v2a" role="dialog" aria-modal="true" aria-label="Sign in">
        <button className="v2a-x" aria-label="Close" onClick={onClose}><CloseIcon size={16} color="#fff" /></button>

        <div className="v2a-body">
          <span className="v2a-eyebrow">{step === 'email' ? copy.eyebrow : 'Check your email'}</span>
          <h2>{step === 'email' ? copy.title : `Six digits, sent to\n${email.trim().toLowerCase()}`}</h2>

          {step === 'email' ? (
            <>
              {/* The composer, reused. Same frosted pill, same round action on
                  the right — signing in is the same gesture as asking. */}
              <div className={`v2a-bar ${valid ? 'ready' : ''}`}>
                <input
                  ref={emailRef} type="email" inputMode="email" autoComplete="email"
                  value={email} placeholder="your email"
                  onChange={e => { setEmail(e.target.value); setErr('') }}
                  onKeyDown={e => { if (e.key === 'Enter' && valid && !busy) sendCode() }}
                  aria-label="Email address"
                />
                <button className="v2a-go" onClick={sendCode} disabled={!valid || busy} aria-label="Continue">
                  {busy ? <i className="v2a-spin" /> : <ArrowUpIcon size={16} color="#fff" />}
                </button>
              </div>

              <button
                className="v2a-alt"
                onClick={() => signIn('google', { callbackUrl: window.location.origin + '/v2' })}
              >
                Continue with Google
              </button>
            </>
          ) : (
            <>
              <div className="v2a-code">
                {code.map((c, i) => (
                  <input
                    key={i}
                    ref={el => { cellRefs.current[i] = el }}
                    value={c}
                    onChange={e => setCell(i, e.target.value)}
                    onKeyDown={e => onCellKey(i, e)}
                    inputMode="numeric"
                    autoComplete={i === 0 ? 'one-time-code' : 'off'}
                    maxLength={CODE_LEN}
                    aria-label={`Digit ${i + 1}`}
                    disabled={busy}
                  />
                ))}
              </div>
              <div className="v2a-quiets">
                <button disabled={cooldown > 0 || busy}
                  onClick={() => { setCode(Array(CODE_LEN).fill('')); sendCode() }}>
                  {cooldown > 0 ? `Send another in ${cooldown}s` : 'Send another code'}
                </button>
                <button onClick={() => { setStep('email'); setErr('') }}>Different email</button>
              </div>
            </>
          )}

          {err && <p className="v2a-err" role="alert">{err}</p>}
          <p className="v2a-fine">Browsing needs no account. This is only for what you keep.</p>
        </div>
      </div>

      <style>{`
        /* Full-bleed, over the boutique. The imagery stays — v2 never covers it
           with a panel. */
        .v2a-scrim{position:absolute;inset:0;z-index:85;background:rgba(18,17,16,.66);
          backdrop-filter:blur(30px) saturate(120%);-webkit-backdrop-filter:blur(30px) saturate(120%);
          animation:v2a-fade .42s ${V2.ease};}
        @keyframes v2a-fade{from{opacity:0}to{opacity:1}}

        .v2a{position:absolute;inset:0;z-index:86;display:flex;align-items:flex-end;justify-content:center;
          padding:0 20px calc(var(--bar, 84px) + env(safe-area-inset-bottom,0px) + 26px);pointer-events:none;
          font-family:${V2.sans};color:#fff;}
        .v2a-body{pointer-events:auto;width:100%;max-width:min(560px,92vw);
          animation:v2a-rise .52s ${V2.ease};}
        @keyframes v2a-rise{from{opacity:0;transform:translateY(26px)}to{opacity:1;transform:none}}

        .v2a-x{position:absolute;top:calc(env(safe-area-inset-top,0px) + 14px);right:16px;
          width:40px;height:40px;display:flex;align-items:center;justify-content:center;
          border:none;border-radius:50%;background:rgba(255,255,255,.13);cursor:pointer;pointer-events:auto;
          backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);}

        .v2a-eyebrow{display:block;font-size:11px;letter-spacing:.18em;text-transform:uppercase;
          color:rgba(255,255,255,.5);margin:0 0 14px;}
        /* One family, display weight, editorial scale — the register the rest of
           v2 sets its headlines in. */
        .v2a h2{font-family:${V2.display};font-weight:500;font-size:clamp(28px,6.6vw,42px);
          line-height:1.08;letter-spacing:-.035em;margin:0 0 30px;white-space:pre-line;}

        /* ── The composer, reused ─────────────────────────────────────────── */
        .v2a-bar{display:flex;align-items:center;gap:8px;padding:7px 7px 7px 20px;
          border-radius:30px;background:${V2.glassDark};
          backdrop-filter:blur(26px) saturate(150%);-webkit-backdrop-filter:blur(26px) saturate(150%);
          box-shadow:0 10px 40px rgba(0,0,0,.26),inset 0 1px 0 ${V2.glassEdge};
          transition:background .3s ${V2.ease};}
        .v2a-bar:focus-within{background:rgba(26,24,21,.9);}
        .v2a-bar input{flex:1;min-width:0;border:none;background:none;outline:none;
          font-family:${V2.sans};font-size:16px;color:#fff;padding:12px 0;}
        .v2a-bar input::placeholder{color:rgba(255,255,255,.42);}
        .v2a-go{flex-shrink:0;width:40px;height:40px;display:flex;align-items:center;justify-content:center;
          border:none;border-radius:50%;background:rgba(255,255,255,.13);cursor:pointer;
          transition:background .24s ${V2.ease},transform .14s ${V2.ease};}
        .v2a-bar.ready .v2a-go{background:#fff;}
        .v2a-bar.ready .v2a-go svg{stroke:${V2.ink};}
        .v2a-go:active{transform:scale(.88);}
        .v2a-go:disabled{cursor:default;}
        .v2a-spin{width:15px;height:15px;border:1.5px solid rgba(255,255,255,.3);border-top-color:#fff;
          border-radius:50%;animation:v2a-rot .7s linear infinite;}
        @keyframes v2a-rot{to{transform:rotate(360deg)}}

        .v2a-alt{width:100%;margin:12px 0 0;padding:15px;border-radius:30px;cursor:pointer;
          border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.07);
          backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);
          font-family:${V2.sans};font-size:14px;color:#fff;transition:background .24s ${V2.ease};}
        .v2a-alt:hover{background:rgba(255,255,255,.13);}

        /* ── Code ─────────────────────────────────────────────────────────── */
        .v2a-code{display:grid;grid-template-columns:repeat(6,1fr);gap:9px;}
        .v2a-code input{width:100%;aspect-ratio:1/1.2;text-align:center;border-radius:15px;
          border:1px solid rgba(255,255,255,.14);background:${V2.glassDark};
          backdrop-filter:blur(22px);-webkit-backdrop-filter:blur(22px);
          font-family:${V2.display};font-size:22px;font-weight:500;color:#fff;outline:none;
          transition:border-color .22s ${V2.ease},background .22s ${V2.ease};}
        .v2a-code input:focus{border-color:rgba(255,255,255,.62);background:rgba(26,24,21,.9);}

        .v2a-quiets{display:flex;gap:18px;justify-content:center;margin:18px 0 0;}
        .v2a-quiets button{border:none;background:none;cursor:pointer;padding:6px 2px;
          font-family:${V2.sans};font-size:12.5px;color:rgba(255,255,255,.55);
          transition:color .2s ${V2.ease};}
        .v2a-quiets button:hover:not(:disabled){color:#fff;}
        .v2a-quiets button:disabled{opacity:.45;cursor:default;}

        .v2a-err{font-size:12.5px;color:#FF9B93;margin:16px 0 0;}
        .v2a-fine{font-size:11px;line-height:1.5;color:rgba(255,255,255,.42);margin:22px 0 0;}

        @media(min-width:760px){
          .v2a{align-items:center;padding-bottom:0;}
          .v2a h2{font-size:clamp(34px,3.6vw,46px);}
        }
      `}</style>
    </>
  )
}
