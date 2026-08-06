'use client'

/**
 * Sign-in for v2.
 *
 * This is the main app's account gate (DiscernPage.tsx, the .fr-gate-card
 * block), ported across unchanged in structure and wording. Only the skin is
 * different: the frosted dark glass the menu and composer are cut from, Geist
 * throughout instead of the warm palette and Cormorant serif, and v2's radii and
 * easing.
 *
 * That is deliberate and it is the correction to three earlier attempts. Each of
 * those invented a new layout and new copy from scratch — a full-bleed takeover,
 * headlines like "Nothing good should have to be found twice" — and each was
 * worse than the thing that already worked. The main app's gate is designed,
 * shipped and understood. It did not need reimagining, only redressing.
 *
 * Same flow, same words, same order:
 *   logo · title · sub · Google · OR · email · Continue with email
 *   code step: six boxes · Verify & continue · Change email / Resend
 *   terms and privacy underneath
 */

import { useEffect, useRef, useState } from 'react'
import { signIn } from 'next-auth/react'
import { V2 } from './theme'

export type V2AuthReason = 'save' | 'bag' | 'orders' | 'account' | null

const LEN = 6

/** Six boxes, ported from the main app's OtpBoxInput — same paste-spreading and
 *  backspace behaviour, restyled. */
function OtpBoxes({ value, onChange, autoFocus }: { value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  const refs = useRef<(HTMLInputElement | null)[]>([])
  const digits = Array.from({ length: LEN }, (_, i) => value[i] ?? '')

  useEffect(() => { if (autoFocus) setTimeout(() => refs.current[0]?.focus(), 260) }, [autoFocus])

  function setDigit(i: number, raw: string) {
    const clean = raw.replace(/\D/g, '')
    if (!clean) { onChange(value.slice(0, i) + value.slice(i + 1)); return }
    const next = digits.slice()
    if (clean.length > 1) {
      for (let j = 0; j < clean.length && i + j < LEN; j++) next[i + j] = clean[j]
      onChange(next.join(''))
      refs.current[Math.min(i + clean.length, LEN - 1)]?.focus()
      return
    }
    next[i] = clean
    onChange(next.join(''))
    if (i < LEN - 1) refs.current[i + 1]?.focus()
  }

  return (
    <div className="v2a-otp">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={el => { refs.current[i] = el }}
          value={d}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={LEN}
          aria-label={`Digit ${i + 1}`}
          onChange={e => setDigit(i, e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Backspace' && !digits[i] && i > 0) refs.current[i - 1]?.focus()
            if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus()
            if (e.key === 'ArrowRight' && i < LEN - 1) refs.current[i + 1]?.focus()
          }}
        />
      ))}
    </div>
  )
}

export default function V2Auth({
  open, onClose, onSignedIn,
}: {
  open: boolean
  reason?: V2AuthReason
  image?: string
  onClose: () => void
  onSignedIn?: () => void
}) {
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resendIn, setResendIn] = useState(0)

  useEffect(() => {
    if (!open) return
    setStep('email'); setCode(''); setError(null)
  }, [open])

  useEffect(() => {
    if (resendIn <= 0) return
    const t = setTimeout(() => setResendIn(n => n - 1), 1000)
    return () => clearTimeout(t)
  }, [resendIn])

  useEffect(() => {
    if (!open) return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [open, onClose])

  const send = async () => {
    if (!email.trim() || sending) return
    setError(null); setSending(true)
    try {
      const r = await fetch('/api/auth/send-code', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Failed to send code')
      setStep('code'); setResendIn(60)
    } catch (err: any) { setError(err.message) } finally { setSending(false) }
  }

  if (!open) return null

  return (
    <>
      <div className="v2a-outer" onClick={onClose}>
        <div className="v2a-card" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Sign in">
          <div className="v2a-handle" />

          <div className="v2a-logo">DISCERN</div>

          <div className="v2a-title">{step === 'code' ? 'Verify your email' : 'Decide better.'}</div>
          <div className="v2a-sub">
            {step === 'code'
              ? 'Enter the code we sent to your email.'
              : 'Stop comparing tabs.\nStart understanding fashion.'}
          </div>

          {step === 'email' && (
            <>
              <button type="button" className="v2a-google"
                onClick={() => signIn('google', { callbackUrl: window.location.origin + '/v2' })}>
                <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden><path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8c-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4C12.955 4 4 12.955 4 24s8.955 20 20 20s20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"/><path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4C16.318 4 9.656 8.337 6.306 14.691z"/><path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"/><path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002l6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"/></svg>
                Continue with Google
              </button>

              <div className="v2a-or"><span>OR</span></div>

              <form onSubmit={e => { e.preventDefault(); send() }}>
                <input className="v2a-email" type="email" value={email} placeholder="name@email.com"
                  autoComplete="email" onChange={e => setEmail(e.target.value)} />
                {error && <div className="v2a-err">{error}</div>}
                <button type="submit" className="v2a-primary" disabled={sending || !email.trim()}>
                  {sending ? 'Sending…' : 'Continue with email'}
                </button>
              </form>
            </>
          )}

          {step === 'code' && (
            <form onSubmit={async e => {
              e.preventDefault()
              if (code.length < LEN || verifying) return
              setError(null); setVerifying(true)
              try {
                const result = await signIn('email-otp', { email: email.trim(), code: code.trim(), redirect: false })
                if (result?.error) throw new Error(result.error === 'CredentialsSignin' ? 'Invalid or expired code, try again' : `Sign-in failed: ${result.error}`)
                onSignedIn?.(); onClose()
              } catch (err: any) { setError(err.message) } finally { setVerifying(false) }
            }}>
              <OtpBoxes value={code} onChange={setCode} autoFocus />
              {error && <div className="v2a-err center">{error}</div>}
              <button type="submit" className="v2a-primary" disabled={code.length < LEN || verifying}>
                {verifying ? 'Verifying…' : 'Continue'}
              </button>
              <div className="v2a-row">
                <button type="button" onClick={() => { setStep('email'); setCode(''); setError(null) }}>← Change email</button>
                <button type="button" disabled={resendIn > 0} onClick={send}>
                  {resendIn > 0 ? `Didn't get it? ${resendIn}s` : "Didn't get it? Resend"}
                </button>
              </div>
            </form>
          )}

          <div className="v2a-terms">
            By continuing, you agree to our{' '}
            <a href="/terms" target="_blank" rel="noopener">Terms</a> &{' '}
            <a href="/privacy" target="_blank" rel="noopener">Privacy</a>.
          </div>
        </div>
      </div>

      <style>{`
        /* Dark glass, the same frosted chrome the menu and the composer are cut
           from, rather than the bag sheet's white. Geometry is untouched — this
           is the main app's gate, only the surface differs. */
        .v2a-outer{position:absolute;inset:0;z-index:86;display:flex;align-items:flex-end;
          justify-content:center;background:rgba(16,15,14,.46);
          backdrop-filter:blur(10px) saturate(130%);-webkit-backdrop-filter:blur(10px) saturate(130%);}
        .v2a-card{width:100%;color:#fff;border-radius:28px 28px 0 0;
          padding:28px 24px 36px;max-height:94vh;overflow-y:auto;
          background:${V2.glassDark};
          backdrop-filter:blur(30px) saturate(160%);-webkit-backdrop-filter:blur(30px) saturate(160%);
          border-top:1px solid ${V2.glassEdge};
          box-shadow:0 -14px 60px rgba(0,0,0,.4),inset 0 1px 0 ${V2.glassEdge};
          font-family:${V2.sans};animation:v2a-up .34s ${V2.ease};}
        @keyframes v2a-up{from{transform:translateY(100%)}to{transform:none}}
        .v2a-handle{width:40px;height:4px;border-radius:4px;background:rgba(255,255,255,.26);margin:-8px auto 20px;}

        .v2a-logo{font-family:${V2.sans};font-size:10px;font-weight:400;letter-spacing:.42em;
          text-indent:.42em;text-align:center;margin:0 0 26px;color:rgba(255,255,255,.42);}
        /* Magazine cover, not app header. Large, light, generous, and set in the
           serif — this single contrast is most of what separates editorial from
           iOS. Weight stays at 400: Instrument Serif carries at size and any
           extra weight makes it shout. */
        .v2a-title{font-family:${V2.editorial};font-size:clamp(38px,10vw,52px);font-weight:400;
          text-align:center;line-height:1.02;letter-spacing:-.018em;color:#fff;}
        /* Small, sans, and a lot of air under it. Quiet enough that the headline
           does the work. */
        .v2a-sub{font-family:${V2.sans};font-size:13px;font-weight:300;
          color:rgba(255,255,255,.5);text-align:center;margin:16px 0 34px;
          line-height:1.85;letter-spacing:.005em;white-space:pre-line;overflow-wrap:anywhere;}

        /* Google keeps its white plate — the mark is drawn for light ground and
           inverting it would break the brand asset. */
        .v2a-google{width:100%;display:flex;align-items:center;justify-content:center;gap:10px;
          padding:13px 16px;border-radius:30px;background:#fff;border:none;
          font-family:${V2.sans};font-size:14px;font-weight:500;color:#1A1A1C;cursor:pointer;
          margin-bottom:18px;transition:opacity .2s ${V2.ease};}
        .v2a-google:hover{opacity:.9;}

        .v2a-or{display:flex;align-items:center;gap:12px;margin:0 0 18px;}
        .v2a-or::before,.v2a-or::after{content:'';flex:1;height:1px;background:rgba(255,255,255,.16);}
        .v2a-or span{font-size:11px;color:rgba(255,255,255,.45);letter-spacing:.08em;}

        .v2a-email{width:100%;box-sizing:border-box;padding:13px 16px;border-radius:12px;margin-bottom:12px;
          border:1px solid rgba(255,255,255,.16);font-family:${V2.sans};font-size:14px;color:#fff;
          background:rgba(255,255,255,.07);outline:none;transition:border-color .2s ${V2.ease},background .2s ${V2.ease};}
        .v2a-email:focus{border-color:rgba(255,255,255,.5);background:rgba(255,255,255,.11);}
        .v2a-email::placeholder{color:rgba(255,255,255,.38);}

        /* Inverted from the main app: on dark glass the primary action is the
           light one. */
        .v2a-primary{width:100%;padding:14px;border-radius:30px;background:#fff;color:${V2.ink};
          border:none;cursor:pointer;font-family:${V2.sans};font-size:14px;font-weight:500;
          transition:opacity .2s ${V2.ease};}
        .v2a-primary:disabled{opacity:.4;cursor:default;}

        .v2a-otp{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-bottom:12px;}
        .v2a-otp input{width:100%;aspect-ratio:1/1.1;text-align:center;border-radius:12px;
          border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.07);
          font-family:${V2.display};font-size:19px;font-weight:500;color:#fff;outline:none;
          transition:border-color .2s ${V2.ease},background .2s ${V2.ease};}
        .v2a-otp input:focus{border-color:rgba(255,255,255,.62);background:rgba(255,255,255,.12);}

        .v2a-row{display:flex;justify-content:space-between;gap:16px;margin-top:16px;}
        .v2a-row button{background:none;border:none;padding:0;cursor:pointer;
          font-family:${V2.sans};font-size:12px;color:rgba(255,255,255,.5);transition:color .2s ${V2.ease};}
        .v2a-row button:disabled{opacity:.45;cursor:default;}
        .v2a-row button:not(:disabled):hover{color:#fff;}

        .v2a-err{font-family:${V2.sans};font-size:12px;color:#FF9B93;margin-bottom:12px;}
        .v2a-err.center{text-align:center;}

        .v2a-terms{font-size:11px;color:rgba(255,255,255,.42);text-align:center;margin-top:22px;
          line-height:1.7;}
        .v2a-terms a{color:rgba(255,255,255,.6);text-decoration:underline;text-underline-offset:2px;}

        @media(min-width:600px){
          .v2a-outer{align-items:center;padding:18px;}
          .v2a-card{max-width:420px;border-radius:26px;padding:36px 32px 28px;
            border:1px solid ${V2.glassEdge};
            box-shadow:0 28px 80px rgba(0,0,0,.46),inset 0 1px 0 ${V2.glassEdge};
            animation:v2a-pop .28s ${V2.ease};}
          @keyframes v2a-pop{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:none}}
          .v2a-handle{display:none;}
        }
      `}</style>
    </>
  )
}
