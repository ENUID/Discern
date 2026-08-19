import { NextRequest, NextResponse } from 'next/server'
import { geminiChat } from '@/lib/gemini'
import { GROQ_DIRECT_CONFIGURED, GROQ_DIRECT_SMART_MODEL, pingGroqDirect } from '@/lib/groq'
import { CEREBRAS_CONFIGURED, pingCerebras } from '@/lib/cerebras'
import { NVIDIA_CONFIGURED, pingNvidia } from '@/lib/nvidia'
import { makeIpRateLimiter } from '@/lib/rateLimit'

/**
 * Is the stylist's model layer up, and if not, why — readable on a phone.
 *
 * The full diagnostic next door needs CRON_SECRET in an Authorization header,
 * which you cannot send from a browser, so when the live site started failing
 * there was no way to find out what had failed without a laptop and the deploy
 * logs. That is too slow when the app is down.
 *
 * This is deliberately coarse. It never returns a key, a model id, a prompt, a
 * reply, or a provider's raw error text — only whether each provider is
 * configured, whether a one-token ping succeeded, and which KIND of failure it
 * was. That is enough to tell an expired key from an exhausted quota from a
 * network fault, and not enough to be worth anything to anyone else.
 */

export const maxDuration = 30
export const dynamic = 'force-dynamic'

const isRateLimited = makeIpRateLimiter(6, 60_000)

type Kind = 'ok' | 'not-configured' | 'auth' | 'quota' | 'timeout' | 'network' | 'unknown'

/** Provider errors are wildly inconsistent in shape; the words are not. */
function classify(err: unknown): Kind {
  const m = String((err as Error)?.message ?? err ?? '').toLowerCase()
  if (/401|403|unauthor|invalid api key|invalid_api_key|forbidden|permission/.test(m)) return 'auth'
  if (/429|quota|rate.?limit|exceeded|insufficient|billing|credit|payment/.test(m)) return 'quota'
  if (/timeout|timed out|abort|deadline/.test(m)) return 'timeout'
  if (/enotfound|econnrefused|econnreset|fetch failed|network|socket|dns/.test(m)) return 'network'
  return 'unknown'
}

/** The failure in the provider's own words, with anything secret taken out.
 *
 *  'unknown' means the five patterns above all missed, and the advice for it
 *  was "see the deploy logs" — which needs a laptop, the Vercel dashboard and
 *  someone who reads logs, at the exact moment the app is down. That is the
 *  situation this whole endpoint exists to avoid, and it was the answer for
 *  the one case that most needed an answer: gemini has been failing for days
 *  and the check could only say it could not say.
 *
 *  A model name retired out from under us, a rejected parameter, a 404 on a
 *  renamed endpoint — none of those match a keyword and all of them are named
 *  plainly in the response body. So the body is passed through, minus the
 *  parts that must never leave the server: bearer tokens, key=… parameters,
 *  and any long unbroken token that could be a credential. Bounded to a line,
 *  because this is a diagnosis and not a log tail. */
function redact(err: unknown): string {
  const raw = String((err as Error)?.message ?? err ?? '').replace(/\s+/g, ' ').trim()
  if (!raw) return ''
  return raw
    .replace(/(bearer\s+)\S+/gi, '$1[redacted]')
    .replace(/([?&](?:key|api_?key|access_?token|token)=)[^&\s"']+/gi, '$1[redacted]')
    .replace(/("(?:api_?key|key|token|authorization)"\s*:\s*")[^"]*/gi, '$1[redacted]')
    // Anything long enough and dense enough to be a key, whatever it is called.
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, '[redacted]')
    .slice(0, 300)
}

type Probe = { kind: Kind; detail?: string }

async function probe(configured: boolean, run: () => Promise<unknown>): Promise<Probe> {
  if (!configured) return { kind: 'not-configured' }
  try {
    await run()
    return { kind: 'ok' }
  } catch (e) {
    const kind = classify(e)
    // Only where the label alone is not the answer. 'quota' and 'auth' say
    // everything already; 'unknown' says nothing at all.
    return kind === 'ok' ? { kind } : { kind, detail: redact(e) || undefined }
  }
}

const ADVICE: Record<Kind, string> = {
  ok: 'working',
  'not-configured': 'no API key set for this provider in the deployment',
  auth: 'the API key is missing, wrong, or revoked',
  quota: 'the free tier or billing limit for this key is used up',
  timeout: 'the provider answered too slowly',
  network: 'the deployment could not reach the provider',
  unknown: 'failed for a reason this check cannot name — see the deploy logs',
}

export async function GET(req: NextRequest) {
  if (isRateLimited(req)) {
    return NextResponse.json({ error: 'checked too often — wait a minute' }, { status: 429 })
  }

  const [gemini, groq, cerebras, nvidia] = await Promise.all([
    probe(!!process.env.GOOGLE_AI_API_KEY, () =>
      geminiChat([{ role: 'user', content: 'ok' }], undefined, { max_tokens: 4 })),
    probe(GROQ_DIRECT_CONFIGURED, () => pingGroqDirect(GROQ_DIRECT_SMART_MODEL)),
    probe(CEREBRAS_CONFIGURED, () => pingCerebras()),
    probe(NVIDIA_CONFIGURED, () => pingNvidia()),
  ])

  const probes: Record<string, Probe> = { gemini, groq, cerebras, nvidia }
  const working = Object.entries(probes).filter(([, p]) => p.kind === 'ok').map(([n]) => n)

  return NextResponse.json({
    // The one line that matters. If this is false the stylist cannot answer and
    // the app is running on the catalogue alone.
    stylistCanAnswer: working.length > 0,
    working,
    // Unchanged shape: one word per provider, which is what anything reading
    // this endpoint already expects.
    providers: Object.fromEntries(Object.entries(probes).map(([name, p]) => [name, p.kind])),
    whatEachMeans: Object.fromEntries(
      Object.entries(probes).map(([name, p]) => [name, ADVICE[p.kind]]),
    ),
    // What the provider actually said, for the ones that failed. Absent when
    // everything is up.
    whatFailed: Object.fromEntries(
      Object.entries(probes).filter(([, p]) => p.detail).map(([name, p]) => [name, p.detail]),
    ),
    // The catalogue is a separate system and does not need any of the above.
    catalogueIsIndependent: true,
    checkedAt: new Date().toISOString(),
  }, {
    headers: { 'Cache-Control': 'no-store' },
  })
}
