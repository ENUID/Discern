'use client'

/**
 * Sign-in for v2.
 *
 * Third attempt, and the two earlier ones were wrong in opposite directions. The
 * first was a white card that matched nothing. The second went full-bleed, which
 * on a phone meant a whole screen of blurred nothing with a paragraph floating
 * at the bottom — and it left a large empty area above the copy where an image
 * plainly belonged.
 *
 * This is a compact sheet, image-led:
 *
 *   · It is sized like the rest of v2's overlays, not like a takeover. A phone
 *     gets a sheet, not a screen.
 *   · The image comes first, and it is the actual piece you were trying to keep.
 *     The words underneath refer to that image rather than to accounts in the
 *     abstract, which is what makes the moment specific instead of generic.
 *   · The copy is plain. Earlier drafts reached for aphorisms — "Nothing good
 *     should have to be found twice" — which is exactly the register that reads
 *     as written-by-a-machine. A sign-in should say what it is and get out of
 *     the way. Two short lines, no slogans.
 *
 * It is never a wall: browsing needs no account, and this is always dismissible.
 *
 * Auth is the existing system — POST /api/auth/send-code, then
 * signIn('email-otp', {email, code}), plus signIn('google').
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { signIn } from 'next-auth/react'
import { V2 } from './theme'
import { ArrowUpIcon, CloseIcon } from '@/components/icons'

export type V2AuthReason = 'save' | 'bag' | 'orders' | 'account' | null

/** Plain, two lines, no slogans. The image carries the specificity. */
const COPY: Record<Exclude<V2AuthReason, null>, { title: string; sub: string }> = {
  save:    { title: 'Save this piece', sub: 'Sign in to keep it.' },
  bag:     { title: 'Keep your bag',   sub: 'Sign in so it is still here later.' },
  orders:  { title: 'Your orders',     sub: 'Sign in to see them.' },
  account: { title: 'Sign in',         sub: 'For your saves and your bag.' },
}

const CODE_LEN = 6

export default function V2Auth({
  open, reason, image, onClose, onSignedIn,
}: {
  open: boolean
  reason: V2AuthReason
  /** The piece this was triggered by. The copy refers to it, so it is the
   *  whole reason the sheet has a picture at all. */
  image?: string
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
    const t = setTimeout(() => emailRef.current?.focus(), 360)
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
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) { setErr('Check the address.'); return }
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/auth/send-code', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: addr }),
      })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        setErr(d?.error === 'rate_limited' ? 'Too many just now. Wait a minute.' : 'That did not send.')
        return
      }
      setStep('code'); setCooldown(30)
      setTimeout(() => cellRefs.current[0]?.focus(), 280)
    } catch {
      setErr('No connection.')
    } finally { setBusy(false) }
  }, [email])

  const verify = useCallback(async (full: string) => {
    setBusy(true); setErr('')
    try {
      const res = await signIn('email-otp', {
        email: email.trim().toLowerCase(), code: full, redirect: false,
      })
      if (res?.error) {
        setErr('Wrong code.')
        setCode(Array(CODE_LEN).fill('')); cellRefs.current[0]?.focus()
        return
      }
      onSignedIn?.(); onClose()
    } catch {
      setErr('That did not work.')
    } finally { setBusy(false) }
  }, [email, onClose, onSignedIn])

  /** Auto-advances, backspaces into the previous cell, and takes a pasted code
   *  into all six at once. */
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
      <div className="v2a-wrap" role="dialog" aria-modal="true" aria-label="Sign in">
        <div className="v2a">
          <button className="v2a-x" aria-label="Close" onClick={onClose}><CloseIcon size={14} /></button>

          {/* The piece itself. Without it the sheet is a form, and the words
              above the fields have nothing to point at. */}
          {image && <div className="v2a-shot"><img src={image} alt="" /></div>}

          <div className="v2a-pad">
            {step === 'email' ? (
              <>
                <h2>{copy.title}</h2>
                <p className="v2a-sub">{copy.sub}</p>

                <div className={`v2a-bar ${valid ? 'ready' : ''}`}>
                  <input
                    ref={emailRef} type="email" inputMode="email" autoComplete="email"
                    value={email} placeholder="Email"
                    onChange={e => { setEmail(e.target.value); setErr('') }}
                    onKeyDown={e => { if (e.key === 'Enter' && valid && !busy) sendCode() }}
                    aria-label="Email address"
                  />
                  <button className="v2a-go" onClick={sendCode} disabled={!valid || busy} aria-label="Continue">
                    {busy ? <i className="v2a-spin" /> : <ArrowUpIcon size={15} color="#fff" />}
                  </button>
                </div>

                <button
                  className="v2a-alt"
                  onClick={() => signIn('google', { callbackUrl: window.location.origin + '/v2' })}
                >
                  <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
                    <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8c-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4C12.955 4 4 12.955 4 24s8.955 20 20 20s20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"/>
                    <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4C16.318 4 9.656 8.337 6.306 14.691z"/>
                    <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"/>
                    <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002l6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"/>
                  </svg>
                  Continue with Google
                </button>
              </>
            ) : (
              <>
                <h2>Enter the code</h2>
                <p className="v2a-sub">Sent to {email.trim().toLowerCase()}</p>

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
                    {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend'}
                  </button>
                  <button onClick={() => { setStep('email'); setErr('') }}>Change email</button>
                </div>
              </>
            )}

            {err && <p className="v2a-err" role="alert">{err}</p>}
          </div>
        </div>
      </div>

      <style>{`
        .v2a-scrim{position:absolute;inset:0;z-index:85;background:rgba(20,18,16,.4);
          backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);animation:v2a-fade .3s ${V2.ease};}
        @keyframes v2a-fade{from{opacity:0}to{opacity:1}}

        /* A sheet, not a screen. It stops well short of the edges on a phone,
           which is the whole difference from the version this replaces. */
        .v2a-wrap{position:absolute;inset:0;z-index:86;display:flex;align-items:center;
          justify-content:center;padding:20px;pointer-events:none;}
        .v2a{pointer-events:auto;position:relative;width:100%;max-width:340px;
          background:${V2.bone};border-radius:18px;overflow:hidden;
          box-shadow:0 26px 70px rgba(0,0,0,.4);font-family:${V2.sans};color:${V2.ink};
          animation:v2a-pop .4s ${V2.ease};}
        @keyframes v2a-pop{from{opacity:0;transform:scale(.9)}to{opacity:1;transform:none}}

        .v2a-x{position:absolute;top:12px;right:12px;z-index:2;width:28px;height:28px;
          display:flex;align-items:center;justify-content:center;border:none;border-radius:50%;
          background:rgba(255,255,255,.85);cursor:pointer;color:${V2.ink};
          backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);}

        /* The piece. 4:3 so it reads as a picture rather than a banner, and it
           is the first thing in the sheet. */
        .v2a-shot{width:100%;aspect-ratio:4/3;background:${V2.boneDeep};overflow:hidden;}
        .v2a-shot img{width:100%;height:100%;object-fit:cover;display:block;}

        .v2a-pad{padding:20px 20px 22px;}
        .v2a h2{font-family:${V2.display};font-weight:600;font-size:19px;letter-spacing:-.02em;
          margin:0 0 4px;}
        .v2a-sub{font-size:13px;line-height:1.45;color:${V2.ink45};margin:0 0 16px;
          overflow-wrap:anywhere;}

        .v2a-bar{display:flex;align-items:center;gap:6px;padding:5px 5px 5px 14px;
          border-radius:26px;background:rgba(26,26,28,.055);
          border:1px solid rgba(26,26,28,.08);transition:border-color .22s ${V2.ease};}
        .v2a-bar:focus-within{border-color:rgba(26,26,28,.3);}
        .v2a-bar input{flex:1;min-width:0;border:none;background:none;outline:none;
          font-family:${V2.sans};font-size:15px;color:${V2.ink};padding:10px 0;}
        .v2a-bar input::placeholder{color:rgba(26,26,28,.32);}
        .v2a-go{flex-shrink:0;width:34px;height:34px;display:flex;align-items:center;
          justify-content:center;border:none;border-radius:50%;background:rgba(26,26,28,.22);
          cursor:pointer;transition:background .22s ${V2.ease},transform .12s ${V2.ease};}
        .v2a-bar.ready .v2a-go{background:${V2.ink};}
        .v2a-go:active{transform:scale(.9);}
        .v2a-spin{width:13px;height:13px;border:1.5px solid rgba(255,255,255,.35);
          border-top-color:#fff;border-radius:50%;animation:v2a-rot .7s linear infinite;}
        @keyframes v2a-rot{to{transform:rotate(360deg)}}

        .v2a-alt{width:100%;margin:9px 0 0;padding:11px;border-radius:26px;cursor:pointer;
          display:flex;align-items:center;justify-content:center;gap:9px;
          border:1px solid rgba(26,26,28,.12);background:none;
          font-family:${V2.sans};font-size:13.5px;color:${V2.ink};transition:background .2s ${V2.ease};}
        .v2a-alt:hover{background:rgba(26,26,28,.04);}

        .v2a-code{display:grid;grid-template-columns:repeat(6,1fr);gap:6px;}
        .v2a-code input{width:100%;aspect-ratio:1/1.2;text-align:center;border-radius:10px;
          border:1px solid rgba(26,26,28,.12);background:rgba(26,26,28,.04);
          font-family:${V2.display};font-size:17px;font-weight:500;color:${V2.ink};outline:none;
          transition:border-color .2s ${V2.ease};}
        .v2a-code input:focus{border-color:${V2.ink};}

        .v2a-quiets{display:flex;gap:16px;margin:14px 0 0;}
        .v2a-quiets button{border:none;background:none;cursor:pointer;padding:2px 0;
          font-family:${V2.sans};font-size:12.5px;color:${V2.ink45};transition:color .2s ${V2.ease};}
        .v2a-quiets button:hover:not(:disabled){color:${V2.ink};}
        .v2a-quiets button:disabled{opacity:.5;cursor:default;}

        .v2a-err{font-size:12.5px;color:#B3261E;margin:12px 0 0;}
      `}</style>
    </>
  )
}
