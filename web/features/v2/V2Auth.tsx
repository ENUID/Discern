'use client'

/**
 * Sign-in for v2.
 *
 * Two decisions shape this, and both are deliberate departures from the main
 * app's gate:
 *
 * 1. It is NOT a wall. The main app blocks everything behind a mandatory,
 *    non-dismissible gate before a shopper has seen a single product. v2 is a
 *    discovery interface — the whole premise is that you browse first — so this
 *    is summoned only at the moment an account is actually required (saving a
 *    piece, opening the bag, looking at orders) and can always be dismissed
 *    back to what you were doing.
 *
 * 2. It says why. The headline is the reason you were asked, not a generic
 *    "Sign in". Being interrupted is annoying; being interrupted by something
 *    that clearly knows what you were mid-way through is not. That single
 *    detail is most of the difference between this feeling considered and
 *    feeling like a toll gate.
 *
 * Auth itself is the existing system, not a parallel one: POST /api/auth/send-code
 * then signIn('email-otp', {email, code}), plus signIn('google') — exactly the
 * calls the main app makes (DiscernPage.tsx:4341-4386).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { signIn } from 'next-auth/react'
import { V2 } from './theme'
import { CloseIcon } from '@/components/icons'

export type V2AuthReason = 'save' | 'bag' | 'orders' | 'account' | null

/** The reason is the headline. Anything generic here wastes the moment. */
const COPY: Record<Exclude<V2AuthReason, null>, { title: string; sub: string }> = {
  save:    { title: 'Keep this piece.', sub: 'An account holds what you save, on every device you use.' },
  bag:     { title: 'Your bag, kept.', sub: 'Sign in so what you gather is still here when you come back.' },
  orders:  { title: 'Find your orders.', sub: 'Orders live with your account, wherever you bought them.' },
  account: { title: 'Welcome back.', sub: 'Your saves, your bag and what Discern knows about your taste.' },
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

  // Reset on every open so a dismissed half-finished attempt never reappears.
  useEffect(() => {
    if (!open) return
    setStep('email'); setCode(Array(CODE_LEN).fill('')); setErr(''); setBusy(false)
    const t = setTimeout(() => emailRef.current?.focus(), 320)
    return () => clearTimeout(t)
  }, [open])

  // Resend cooldown, so the button can say what it is doing rather than
  // silently rejecting a second tap.
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
        setErr(d?.error === 'rate_limited' ? 'Too many codes just now. Give it a minute.' : 'Could not send that code. Try again?')
        return
      }
      setStep('code'); setCooldown(30)
      setTimeout(() => cellRefs.current[0]?.focus(), 260)
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
        setErr('That code did not match. Check it, or send a new one.')
        setCode(Array(CODE_LEN).fill(''))
        cellRefs.current[0]?.focus()
        return
      }
      onSignedIn?.()
      onClose()
    } catch {
      setErr('Something went wrong signing you in.')
    } finally { setBusy(false) }
  }, [email, onClose, onSignedIn])

  /** One cell per character. Auto-advances, backspaces into the previous cell,
   *  and accepts a pasted code into all six at once — the small behaviours that
   *  separate a real code field from six text boxes. */
  const setCell = (i: number, raw: string) => {
    const chars = raw.replace(/\D/g, '')
    if (!chars) {
      setCode(c => { const n = [...c]; n[i] = ''; return n })
      return
    }
    setCode(c => {
      const n = [...c]
      for (let k = 0; k < chars.length && i + k < CODE_LEN; k++) n[i + k] = chars[k]
      const next = Math.min(i + chars.length, CODE_LEN - 1)
      setTimeout(() => cellRefs.current[next]?.focus(), 0)
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
      <div className="v2a-ov" onClick={onClose} />
      <div className="v2a" role="dialog" aria-modal="true" aria-label="Sign in">
        <button className="v2a-x" aria-label="Close" onClick={onClose}><CloseIcon size={15} /></button>

        <h2>{copy.title}</h2>
        <p className="v2a-sub">{copy.sub}</p>

        {step === 'email' ? (
          <>
            <label className="v2a-field">
              <span>Email</span>
              <input
                ref={emailRef} type="email" inputMode="email" autoComplete="email"
                value={email} placeholder="you@example.com"
                onChange={e => { setEmail(e.target.value); setErr('') }}
                onKeyDown={e => { if (e.key === 'Enter' && !busy) sendCode() }}
              />
            </label>
            <button className="v2a-go" onClick={sendCode} disabled={busy || !email.trim()}>
              {busy ? <i className="v2a-spin" /> : 'Continue'}
            </button>
            <div className="v2a-or"><span>or</span></div>
            <button
              className="v2a-alt"
              onClick={() => signIn('google', { callbackUrl: window.location.origin + '/v2' })}
            >
              Continue with Google
            </button>
          </>
        ) : (
          <>
            <p className="v2a-sent">
              Six digits, sent to <b>{email.trim().toLowerCase()}</b>.
            </p>
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
            <button
              className="v2a-quiet"
              disabled={cooldown > 0 || busy}
              onClick={() => { setCode(Array(CODE_LEN).fill('')); sendCode() }}
            >
              {cooldown > 0 ? `Send another in ${cooldown}s` : 'Send another code'}
            </button>
            <button className="v2a-quiet" onClick={() => { setStep('email'); setErr('') }}>
              Use a different email
            </button>
          </>
        )}

        {err && <p className="v2a-err" role="alert">{err}</p>}
        <p className="v2a-fine">Browsing needs no account. This is only for what you keep.</p>
      </div>

      <style>{`
        .v2a-ov{position:absolute;inset:0;z-index:79;background:rgba(20,18,16,.34);
          backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);animation:v2a-fade .3s ${V2.ease};}
        @keyframes v2a-fade{from{opacity:0}to{opacity:1}}
        /* Same family as the bag sheet: pops from the centre, stops short of the
           edges so the boutique stays visible around it. */
        .v2a{position:absolute;z-index:80;left:50%;top:50%;transform:translate(-50%,-50%);
          width:min(420px,calc(100% - 24px));max-height:calc(100% - 96px);overflow-y:auto;
          background:${V2.bone};border-radius:18px;padding:34px 28px 26px;
          box-shadow:0 30px 90px rgba(0,0,0,.42);animation:v2a-pop .42s ${V2.ease};
          font-family:${V2.sans};color:${V2.ink};}
        @keyframes v2a-pop{from{opacity:0;transform:translate(-50%,-46%) scale(.9)}
          to{opacity:1;transform:translate(-50%,-50%) scale(1)}}
        .v2a-x{position:absolute;top:18px;right:16px;width:32px;height:32px;display:flex;
          align-items:center;justify-content:center;border:none;background:none;cursor:pointer;color:${V2.ink};}
        .v2a h2{font-family:${V2.display};font-weight:600;font-size:27px;letter-spacing:-.03em;
          line-height:1.12;margin:0 0 8px;}
        .v2a-sub{font-size:13.5px;line-height:1.55;color:${V2.ink70};margin:0 0 26px;}

        /* A hairline-underlined field, not a box — one less rectangle on screen. */
        .v2a-field{display:block;margin:0 0 18px;}
        .v2a-field span{display:block;font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;
          color:${V2.ink45};margin:0 0 7px;}
        .v2a-field input{width:100%;border:none;border-bottom:1px solid ${V2.hairline};background:none;
          font-family:${V2.sans};font-size:16px;color:${V2.ink};padding:7px 0 9px;outline:none;
          transition:border-color .22s ${V2.ease};}
        .v2a-field input::placeholder{color:rgba(26,26,28,.28);}
        .v2a-field input:focus{border-bottom-color:${V2.ink};}

        .v2a-go{width:100%;padding:15px;border:none;border-radius:11px;background:${V2.ink};color:${V2.bone};
          font-family:${V2.sans};font-size:14px;font-weight:500;cursor:pointer;display:flex;
          align-items:center;justify-content:center;min-height:50px;transition:opacity .2s ${V2.ease};}
        .v2a-go:disabled{opacity:.32;cursor:not-allowed;}
        .v2a-spin{width:15px;height:15px;border:1.5px solid rgba(244,243,241,.3);border-top-color:${V2.bone};
          border-radius:50%;animation:v2a-rot .7s linear infinite;}
        @keyframes v2a-rot{to{transform:rotate(360deg)}}

        .v2a-or{display:flex;align-items:center;gap:12px;margin:20px 0;color:${V2.ink45};font-size:11px;}
        .v2a-or::before,.v2a-or::after{content:'';flex:1;height:1px;background:${V2.hairline};}

        .v2a-alt{width:100%;padding:14px;border:1px solid ${V2.hairline};border-radius:11px;background:none;
          font-family:${V2.sans};font-size:14px;color:${V2.ink};cursor:pointer;transition:background .2s ${V2.ease};}
        .v2a-alt:hover{background:rgba(26,26,28,.04);}

        .v2a-sent{font-size:13.5px;line-height:1.55;color:${V2.ink70};margin:0 0 20px;}
        .v2a-sent b{font-weight:500;color:${V2.ink};}
        /* One cell per digit. Wide tracking and a real baseline make a code feel
           like a code rather than a password. */
        .v2a-code{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin:0 0 22px;}
        .v2a-code input{width:100%;aspect-ratio:1/1.15;text-align:center;border:none;
          border-bottom:1.5px solid ${V2.hairline};background:rgba(26,26,28,.03);border-radius:9px 9px 4px 4px;
          font-family:${V2.display};font-size:21px;font-weight:500;color:${V2.ink};outline:none;
          transition:border-color .2s ${V2.ease},background .2s ${V2.ease};}
        .v2a-code input:focus{border-bottom-color:${V2.ink};background:rgba(26,26,28,.06);}

        .v2a-quiet{display:block;width:100%;padding:9px;border:none;background:none;cursor:pointer;
          font-family:${V2.sans};font-size:12.5px;color:${V2.ink45};transition:color .2s ${V2.ease};}
        .v2a-quiet:hover:not(:disabled){color:${V2.ink};}
        .v2a-quiet:disabled{opacity:.5;cursor:default;}

        .v2a-err{font-size:12.5px;line-height:1.5;color:#B3261E;margin:14px 0 0;}
        .v2a-fine{font-size:11px;line-height:1.5;color:${V2.ink45};margin:22px 0 0;text-align:center;}

        @media(min-width:760px){
          .v2a{padding:40px 34px 30px;}
          .v2a h2{font-size:31px;}
        }
      `}</style>
    </>
  )
}
