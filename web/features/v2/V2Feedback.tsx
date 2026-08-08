'use client'

import { useEffect, useState } from 'react'
import { V2 } from './theme'
import { CloseIcon } from '@/components/icons'

/**
 * Somewhere to say something.
 *
 * One sheet for every kind of thing a shopper wants to tell us — a bug, an
 * idea, a complaint — because making them choose the right channel first is how
 * you stop hearing about the bugs.
 *
 * The three types are a hint to whoever reads it, not a gate — Other is a real
 * answer rather than a leftover. The message and the sender's address are both
 * required: a report nobody can reply to usually ends the conversation there.
 */

const KINDS = ['Bug', 'Idea', 'Other'] as const
type Kind = (typeof KINDS)[number]

export default function V2Feedback({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [kind, setKind] = useState<Kind>('Bug')
  const [message, setMessage] = useState('')
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setKind('Bug'); setMessage(''); setError(null); setSent(false)
  }, [open])

  useEffect(() => {
    if (!open) return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [open, onClose])

  /** Both fields, not just the message: a report nobody can reply to is usually
   *  the end of the conversation. Checked here as well as on the server, so the
   *  button is honest about what it will do rather than failing after the tap. */
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())
  const canSend = message.trim().length > 0 && emailOk

  const send = async () => {
    if (!canSend || sending) return
    setSending(true); setError(null)
    try {
      const r = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind, message: message.trim(), email: email.trim(),
          // Which screen they were on. The single most useful thing a bug
          // report can carry, and the one thing nobody ever remembers to say.
          path: typeof window !== 'undefined' ? window.location.pathname : '',
        }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d?.error || 'That did not send.')
      setSent(true)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSending(false)
    }
  }

  if (!open) return null

  return (
    <>
      <div className="v2f-outer" onClick={onClose}>
        <div className="v2f-card" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true"
          aria-label="Send feedback">
          <button className="v2f-x" aria-label="Close" onClick={onClose}><CloseIcon size={15} /></button>

          {sent ? (
            <div className="v2f-done">
              <h2>Thank you.</h2>
              <p>It came through, and it came to me. I’ll write back.</p>
              <button className="v2f-send" onClick={onClose}>Close</button>
            </div>
          ) : (
            <>
              <h2>Tell me what’s wrong</h2>
              <p className="v2f-sub">
                A bug, an idea, or something that simply annoyed you. This goes
                straight to me, not to a support queue, and I read every one.
              </p>

              <div className="v2f-kinds" role="group" aria-label="What is this about">
                {KINDS.map(k => (
                  <button key={k} type="button" className={kind === k ? 'on' : ''}
                    aria-pressed={kind === k} onClick={() => setKind(k)}>{k}</button>
                ))}
              </div>

              <label className="v2f-label" htmlFor="v2f-msg">Message</label>
              <textarea id="v2f-msg" className="v2f-msg" rows={5} value={message}
                onChange={e => setMessage(e.target.value)}
                placeholder="What happened, or what would make this better?" />

              <label className="v2f-label" htmlFor="v2f-mail">Your email</label>
              <input id="v2f-mail" className="v2f-mail" type="email" required value={email}
                onChange={e => setEmail(e.target.value)} placeholder="name@email.com"
                autoComplete="email" inputMode="email" />
              <p className="v2f-note">So I can write back to you.</p>

              {error && <div className="v2f-err">{error}</div>}

              <button className="v2f-send" onClick={send} disabled={!canSend || sending}>
                {sending ? 'Sending…' : 'Send'}
              </button>
            </>
          )}
        </div>
      </div>

      <style jsx global>{`
        .v2f-outer{position:absolute;inset:0;z-index:120;display:flex;align-items:flex-end;justify-content:center;
          background:rgba(16,14,12,.5);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);
          animation:v2f-fade .22s ${V2.ease};}
        .v2f-card{position:relative;width:100%;max-width:min(460px,96vw);
          margin:0 auto calc(env(safe-area-inset-bottom,0px) + 12px);
          padding:26px 22px calc(env(safe-area-inset-bottom,0px) + 22px);
          border-radius:24px;color:#fff;background:rgba(28,27,26,.94);
          backdrop-filter:blur(30px) saturate(140%);-webkit-backdrop-filter:blur(30px) saturate(140%);
          border:1px solid rgba(255,255,255,.12);box-shadow:0 -10px 60px rgba(0,0,0,.4);
          max-height:88svh;overflow-y:auto;animation:v2f-rise .3s ${V2.ease};}
        @media(min-width:600px){
          .v2f-outer{align-items:center;}
          .v2f-card{margin:0;border-radius:22px;}
        }
        .v2f-x{position:absolute;top:16px;right:16px;width:34px;height:34px;display:flex;align-items:center;
          justify-content:center;border:none;border-radius:50%;cursor:pointer;color:#fff;
          background:rgba(255,255,255,.12);}
        .v2f-card h2{font-family:${V2.editorial};font-weight:400;font-size:30px;line-height:1.1;
          margin:0 0 8px;padding-right:44px;}
        .v2f-sub{font-size:13.5px;line-height:1.55;opacity:.62;margin:0 0 22px;}
        .v2f-kinds{display:flex;gap:8px;margin-bottom:20px;}
        .v2f-kinds button{flex:1;min-height:44px;padding:11px 10px;border-radius:12px;cursor:pointer;
          font-family:${V2.sans};font-size:13.5px;color:#fff;background:rgba(255,255,255,.08);
          border:1px solid rgba(255,255,255,.16);transition:background .16s,border-color .16s;}
        .v2f-kinds button.on{background:#fff;color:${V2.ink};border-color:transparent;font-weight:500;}
        .v2f-label{display:flex;align-items:baseline;gap:7px;font-size:12px;opacity:.6;margin-bottom:7px;}
        .v2f-label em{font-style:normal;font-size:11px;opacity:.7;}
        /* 16px on every field: below that iOS zooms the page in on focus. */
        .v2f-msg,.v2f-mail{width:100%;box-sizing:border-box;padding:13px 14px;border-radius:12px;
          background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.16);color:#fff;
          font-family:${V2.sans};font-size:16px;line-height:1.5;outline:none;
          transition:border-color .18s,background .18s;}
        .v2f-msg{resize:vertical;min-height:112px;margin-bottom:18px;}
        .v2f-mail{margin-bottom:8px;}
        .v2f-note{font-size:12px;opacity:.5;margin:0 0 20px;}
        .v2f-msg:focus,.v2f-mail:focus{border-color:rgba(255,255,255,.5);background:rgba(255,255,255,.11);}
        .v2f-msg::placeholder,.v2f-mail::placeholder{color:rgba(255,255,255,.34);}
        .v2f-err{font-size:13px;color:#ff9c8f;margin-bottom:14px;}
        .v2f-send{width:100%;min-height:48px;border:none;border-radius:14px;cursor:pointer;background:#fff;
          color:${V2.ink};font-family:${V2.sans};font-size:15px;font-weight:500;
          transition:opacity .16s;}
        .v2f-send:disabled{opacity:.42;cursor:default;}
        .v2f-done{text-align:center;padding:14px 0 4px;}
        .v2f-done p{font-size:13.5px;opacity:.62;margin:0 0 24px;}
        @keyframes v2f-fade{from{opacity:0}to{opacity:1}}
        @keyframes v2f-rise{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:none}}
        @media(prefers-reduced-motion:reduce){
          .v2f-outer,.v2f-card{animation:none}
        }
      `}</style>
    </>
  )
}
