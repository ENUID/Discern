import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { makeIpRateLimiter } from '@/lib/rateLimit'

/**
 * Anything a shopper wants to say — a bug, an idea, a complaint.
 *
 * Sends to the inbox rather than storing it: there is no screen to read a
 * feedback table on, so a row in a database nobody opens is the same as no
 * feedback at all.
 *
 * The sender's own address is required and becomes `replyTo`, so hitting reply
 * in the inbox writes back to them. Without it a bug report is a dead end — no
 * way to ask the one follow-up question that usually resolves it.
 */

// Every message has to be sent *from* something, and it has to be an address on
// a domain Resend has verified — a shopper's own Gmail cannot be forged into
// this slot. What it must not be is a no-reply: this is a conversation, so the
// envelope says feedback@ and `replyTo` below points at the person who wrote.
// Its own variable rather than the shared RESEND_FROM_EMAIL, so feedback does
// not inherit whatever the sign-in codes are sent from.
const FROM_EMAIL = process.env.FEEDBACK_FROM_EMAIL ?? 'Discern Feedback <feedback@discern.enuid.com>'
// Goes to a person, not a queue. Overridable by env so it can be changed
// without a deploy, but the default is the address that is actually read.
const TO_EMAIL = process.env.FEEDBACK_TO_EMAIL ?? 'd0fourmir@gmail.com'

/** Deliberately permissive — this rejects blanks and obvious typos, not unusual
 *  but legitimate addresses. The real proof an address works is the reply. */
const looksLikeEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)

// Unauthenticated and it sends mail, so it needs a ceiling. Six a minute is far
// more than anyone writing in good faith produces, and stops the form being a
// way to post mail through this inbox at volume.
const isRateLimited = makeIpRateLimiter(6, 60_000)

const KINDS = ['Bug', 'Idea', 'Other'] as const
type Kind = (typeof KINDS)[number]

/** Whatever arrives here is typed by a stranger and lands in an inbox, so it
 *  goes out as text with the HTML specials neutralised. */
const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export async function POST(req: NextRequest) {
  if (isRateLimited(req)) {
    return NextResponse.json({ error: 'That is a lot of feedback at once. Try again shortly.' }, { status: 429 })
  }
  try {
    const body = await req.json()
    const message = String(body?.message ?? '').trim()
    if (!message) return NextResponse.json({ error: 'Say something first.' }, { status: 400 })
    if (message.length > 4000) {
      return NextResponse.json({ error: 'That is longer than this form can send. Email us instead.' }, { status: 400 })
    }

    const kind: Kind = KINDS.includes(body?.kind) ? body.kind : 'Other'

    // Required, not optional: without it there is no way to reply, and a bug
    // report you cannot ask a follow-up question about is usually a dead end.
    const from = String(body?.email ?? '').trim().slice(0, 200)
    if (!from) return NextResponse.json({ error: 'Add your email so I can reply.' }, { status: 400 })
    if (!looksLikeEmail(from)) {
      return NextResponse.json({ error: 'That email does not look right.' }, { status: 400 })
    }
    const path = String(body?.path ?? '').trim().slice(0, 200)
    const agent = (req.headers.get('user-agent') ?? '').slice(0, 200)

    /** Somebody took the trouble to write in. Losing that because of an
     *  environment variable is the worst trade in this codebase.
     *
     *  This used to answer 500 "Feedback is not configured yet." and drop the
     *  message on the floor. The key is set in production and missing
     *  everywhere else, so the failure is invisible until the day it isn't —
     *  and on that day every bug report and every piece of praise goes in the
     *  bin while the shopper is told, truthfully but uselessly, that something
     *  is not configured.
     *
     *  So the message is written to the log in a shape that can be grepped and
     *  recovered, and the shopper is told it landed. Which is true: it reached
     *  the company. That it reached a log rather than an inbox is our problem
     *  to fix, not theirs to absorb. */
    const keep = (why: string) => {
      console.error(`[feedback:UNSENT ${why}] ${JSON.stringify({ kind, from, path, message, agent })}`)
    }

    if (!process.env.RESEND_API_KEY) {
      keep('no-key')
      return NextResponse.json({ ok: true, delivered: false })
    }

    const resend = new Resend(process.env.RESEND_API_KEY)
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: TO_EMAIL,
      // Reply goes straight to the person who wrote in.
      replyTo: from,
      // A stable, searchable prefix: every one of these can be found with
      // "[Discern feedback]" and filtered on in a mail client.
      subject: `[Discern feedback] ${kind} — ${message.slice(0, 60).replace(/\s+/g, ' ')}`,
      // A plain-text part alongside the HTML. Mail without one is more likely to
      // be treated as bulk, and it is what shows in the inbox preview line.
      text: [
        `${kind} from ${from}`,
        path ? `Screen: ${path}` : '',
        '',
        message,
        '',
        agent,
      ].filter(Boolean).join('\n'),
      html: `<div style="font-family:ui-sans-serif,system-ui,sans-serif;font-size:14px;line-height:1.6;color:#1a1a1c">
  <p style="margin:0 0 4px"><strong>${esc(kind)}</strong></p>
  <p style="margin:0 0 18px;color:#6b6b70"><a href="mailto:${esc(from)}" style="color:#6b6b70">${esc(from)}</a>${path ? ` · ${esc(path)}` : ''}</p>
  <div style="white-space:pre-wrap;padding:14px 16px;background:#f4f3f1;border-radius:10px">${esc(message)}</div>
  <p style="margin:18px 0 0;color:#9a9a9e;font-size:12px">${esc(agent)}</p>
</div>`,
    })

    if (error) {
      // Same reasoning as the missing key above: the send failed, the message
      // must not. Asking somebody to retype a paragraph because our mail
      // provider had a bad minute is how feedback stops arriving at all.
      console.error('[feedback] Resend error:', error)
      keep('send-failed')
      return NextResponse.json({ ok: true, delivered: false })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[feedback]', err)
    return NextResponse.json({ error: 'Something went wrong sending that.' }, { status: 500 })
  }
}
