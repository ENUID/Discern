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
 * `replyTo` is set to the sender's address when they leave one, so a reply goes
 * back to them rather than to the from-address, which is a no-reply.
 */

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? 'Discern <no-reply@discern.enuid.com>'
const TO_EMAIL = process.env.FEEDBACK_TO_EMAIL ?? 'no-reply@enuid.com'

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
    const from = String(body?.email ?? '').trim().slice(0, 200)
    const path = String(body?.path ?? '').trim().slice(0, 200)
    const agent = (req.headers.get('user-agent') ?? '').slice(0, 200)

    if (!process.env.RESEND_API_KEY) {
      console.error('[feedback] RESEND_API_KEY is not set; nothing was sent')
      return NextResponse.json({ error: 'Feedback is not configured yet.' }, { status: 500 })
    }

    const resend = new Resend(process.env.RESEND_API_KEY)
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: TO_EMAIL,
      // The address is only a reply-to when it looks like one; a malformed value
      // would have Resend reject the whole send and lose the feedback with it.
      ...(from.includes('@') ? { replyTo: from } : {}),
      subject: `Discern ${kind.toLowerCase()} — ${message.slice(0, 60).replace(/\s+/g, ' ')}`,
      html: `<div style="font-family:ui-sans-serif,system-ui,sans-serif;font-size:14px;line-height:1.6;color:#1a1a1c">
  <p style="margin:0 0 4px"><strong>${esc(kind)}</strong></p>
  <p style="margin:0 0 18px;color:#6b6b70">${esc(from) || 'no address left'}${path ? ` · ${esc(path)}` : ''}</p>
  <div style="white-space:pre-wrap;padding:14px 16px;background:#f4f3f1;border-radius:10px">${esc(message)}</div>
  <p style="margin:18px 0 0;color:#9a9a9e;font-size:12px">${esc(agent)}</p>
</div>`,
    })

    if (error) {
      console.error('[feedback] Resend error:', error)
      return NextResponse.json({ error: 'That did not send. Try again in a moment.' }, { status: 502 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[feedback]', err)
    return NextResponse.json({ error: 'Something went wrong sending that.' }, { status: 500 })
  }
}
