import { NextRequest, NextResponse } from 'next/server'
import { randomInt } from 'crypto'
import { ConvexHttpClient } from 'convex/browser'
import { Resend } from 'resend'
import { api } from '@/convex/_generated/api'

export const runtime = 'nodejs'

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? 'Discern <no-reply@discern.enuid.com>'

// Per-email cooldown (enforced inside createCode) doesn't stop one IP from
// emailing many DIFFERENT addresses — unbounded email-bombing / Resend quota
// burn otherwise. Same in-memory sliding-window pattern used in api/ai/stylist.
const RATE_WINDOW_MS = 10 * 60_000
const RATE_MAX_REQUESTS = 8
const rateBuckets = new Map<string, { count: number; resetAt: number }>()
function isRateLimited(req: NextRequest): boolean {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const now = Date.now()
  const bucket = rateBuckets.get(ip)
  if (!bucket || now > bucket.resetAt) {
    rateBuckets.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS })
    return false
  }
  if (bucket.count >= RATE_MAX_REQUESTS) return true
  bucket.count++
  return false
}

function generateCode(): string {
  return String(randomInt(100000, 1000000))
}

function codeEmail(code: string): string {
  return `<!DOCTYPE html>
<html>
<body style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:420px;margin:0 auto;padding:40px 24px;color:#2C1206;background:#fff">
  <div style="margin-bottom:28px">
    <span style="font-size:20px;font-weight:400;letter-spacing:0.04em">Discern</span>
  </div>
  <h2 style="font-size:22px;font-weight:400;margin:0 0 10px;letter-spacing:0.01em">Your sign-in code</h2>
  <p style="font-size:14px;color:#9B7060;margin:0 0 28px;line-height:1.6">Enter this code to sign in to Discern. It expires in 15 minutes.</p>
  <div style="background:#F7F4F2;border-radius:12px;padding:20px;text-align:center;margin-bottom:28px">
    <span style="font-size:36px;font-weight:700;letter-spacing:0.25em;color:#2C1206">${code}</span>
  </div>
  <p style="font-size:12px;color:#9B7060;line-height:1.6;margin:0">If you didn't request this, you can ignore this email. Your account is secure.</p>
</body>
</html>`
}

export async function POST(req: NextRequest) {
  if (isRateLimited(req)) {
    return NextResponse.json({ error: 'Too many sign-in attempts. Please wait a few minutes and try again.' }, { status: 429 })
  }
  // Guard: surface missing config immediately instead of cryptic "Internal error"
  if (!process.env.RESEND_API_KEY) {
    console.error('[send-code] RESEND_API_KEY is not set')
    return NextResponse.json({ error: 'Email service not configured' }, { status: 503 })
  }
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    console.error('[send-code] NEXT_PUBLIC_CONVEX_URL is not set')
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
  }
  if (!process.env.CONVEX_AUTH_SECRET) {
    console.error('[send-code] CONVEX_AUTH_SECRET is not set')
    return NextResponse.json({ error: 'Sign-in is not configured (missing auth secret)' }, { status: 503 })
  }

  // Normalize and validate the Convex URL — a .convex.site URL or trailing
  // slash makes /api/mutation 404 with an empty body (empty Error message).
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL.trim().replace(/\/+$/, '')
  if (convexUrl.includes('.convex.site')) {
    console.error('[send-code] NEXT_PUBLIC_CONVEX_URL points to .convex.site:', convexUrl)
    return NextResponse.json(
      { error: 'Configuration error: NEXT_PUBLIC_CONVEX_URL must be the .convex.cloud deployment URL, not .convex.site' },
      { status: 503 },
    )
  }

  const convex = new ConvexHttpClient(convexUrl)
  const resend = new Resend(process.env.RESEND_API_KEY)
  try {
    const { email } = await req.json()
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return NextResponse.json({ error: 'Valid email required' }, { status: 400 })
    }

    const normalizedEmail = email.toLowerCase().trim()

    // Demo/reviewer account (e.g. YC): don't generate or email a real code —
    // sign-in uses the fixed demo code via the bypass in lib/auth.ts. Returning
    // ok here just lets the UI advance to the code-entry step. Defaults to the
    // shared YC address so no env setup is needed; DEMO_LOGIN_EMAIL overrides,
    // DEMO_LOGIN_DISABLED=1 turns it off.
    const demoEmail = (process.env.DEMO_LOGIN_EMAIL ?? 'mspw@discern.com').toLowerCase().trim()
    if (process.env.DEMO_LOGIN_DISABLED !== '1' && normalizedEmail === demoEmail) {
      return NextResponse.json({ ok: true })
    }

    const code = generateCode()

    try {
      const result = await convex.mutation(api.verificationCodes.createCode, {
        email: normalizedEmail,
        code,
        serverSecret: process.env.CONVEX_AUTH_SECRET,
      }) as any
      if (result?.ok === false && result.reason === 'rate_limited') {
        const wait = result.retryAfterSec ?? 60
        return NextResponse.json(
          { error: `Please wait ${wait} seconds before requesting a new code.` },
          { status: 429 },
        )
      }
      // A server-secret mismatch is an infra misconfig, not something the
      // shopper can act on — log it server-side, show a generic message. Never
      // echo secret metadata (lengths / configured-state) to the client.
      if (result?.ok === false && result.reason === 'unauthorized') {
        console.error('[send-code] createCode unauthorized — CONVEX_AUTH_SECRET mismatch between Vercel and Convex')
        return NextResponse.json(
          { error: 'Something went wrong sending your code. Please try again in a moment.' },
          { status: 500 },
        )
      }
    } catch (e: any) {
      // Real failure (not rate limiting). Convex redacts thrown Error messages
      // in prod, so collect every shape we can for the logs and the response.
      const msg: string = e?.message || e?.data?.message || (typeof e?.data === 'string' ? e.data : '') || ''
      let detail = msg
      if (!detail) {
        // Empty message = the HTTP call to Convex failed with an empty body
        // (wrong URL, paused deployment, network). Probe to name the failure.
        try {
          const probe = await fetch(`${convexUrl}/api/query`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: 'users:getUserByEmail', format: 'convex_encoded_json', args: [{ email: 'probe@example.com' }] }),
            signal: AbortSignal.timeout(5000),
          })
          detail = `Convex endpoint ${new URL(convexUrl).host} answered HTTP ${probe.status} ${probe.statusText}`.trim()
        } catch (probeErr: any) {
          detail = `Convex endpoint ${new URL(convexUrl).host} unreachable: ${probeErr?.message || 'network error'}`
        }
      }
      // Log the full internal detail server-side; return a generic message so
      // Convex host / HTTP-status / infra details never reach the client.
      console.error('[send-code] createCode failed:', detail)
      return NextResponse.json({ error: 'Something went wrong sending your code. Please try again in a moment.' }, { status: 500 })
    }

    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: `${code} — your Discern sign-in code`,
      html: codeEmail(code),
    })

    if (error) {
      console.error('[send-code] Resend error:', error)
      // Delete the code we just created so the user can retry immediately
      try { await convex.mutation(api.verificationCodes.deleteCode, { email: normalizedEmail, serverSecret: process.env.CONVEX_AUTH_SECRET! }) } catch {}
      const msg = (error as any)?.message ?? JSON.stringify(error)
      return NextResponse.json({ error: `Email could not be sent. Check your Resend configuration. (${msg})` }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error('[send-code]', err)
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 })
  }
}
