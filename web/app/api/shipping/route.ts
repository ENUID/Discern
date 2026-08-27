import { NextRequest, NextResponse } from 'next/server'
import { groqChat, FAST_MODEL } from '@/lib/groq'
import { BoundedCache } from '@/lib/boundedCache'
import { safeParseStoreUrl, safeFetch } from '@/lib/ssrfGuard'
import { UCP_REGISTRY } from '@/lib/stores'
import { makeIpRateLimiter } from '@/lib/rateLimit'
import { fenceUntrusted } from '@/lib/stylist/promptSafety'

const cache = new BoundedCache<string, { shipping: string; returns: string } | null>(2000)

// Unauthenticated, and each cache miss costs several outbound page fetches
// plus one LLM call — limit per IP so it can't be scripted into a quota
// drain or used to hammer stores' policy pages through us.
const isRateLimited = makeIpRateLimiter(20, 60_000)

/** True when this host is one of the brands Discern actually carries.
 *
 *  Same check, same registry and same exact-match rule as
 *  /api/product-images and GlobalCatalogService — not a second allowlist.
 *  Without it this route would fetch any public host a caller named, which
 *  combined with the hostname-predicate bypasses closed alongside it was a
 *  working unauthenticated request forgery. */
function isRegisteredStore(hostname: string): boolean {
  const h = hostname.toLowerCase().trim()
  return UCP_REGISTRY.some(s => s.domain.toLowerCase().trim() === h)
}

// Shopify standard policy pages + common custom slugs
function policyUrls(base: string) {
  try {
    const { protocol, hostname } = new URL(base)
    const o = `${protocol}//${hostname}`
    return {
      shipping: [
        `${o}/policies/shipping-policy`,
        `${o}/pages/shipping`,
        `${o}/pages/delivery`,
        `${o}/pages/shipping-information`,
      ],
      returns: [
        `${o}/policies/refund-policy`,
        `${o}/pages/returns`,
        `${o}/pages/returns-exchanges`,
        `${o}/pages/refund-policy`,
      ],
    }
  } catch {
    return null
  }
}

/** How much of a policy page the model reads. extractText applies it while
 *  stripping the markup; the boundary below restates it so fencing can never
 *  hand the model more than the extractor already allowed. */
const POLICY_CHARS = 2500

function extractText(html: string, maxChars = POLICY_CHARS): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|h[1-6]|section|article|tr)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&[a-z]+;/g, ' ')
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n')
    .trim().slice(0, maxChars)
}

async function fetchPage(urls: string[]): Promise<string | null> {
  for (const url of urls) {
    try {
      const controller = new AbortController()
      const id = setTimeout(() => controller.abort(), 6000)
      const res = await safeFetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html',
        },
        cache: 'force-cache',
        next: { revalidate: 3600 },
      } as RequestInit)
      clearTimeout(id)
      if (!res.ok) continue
      const text = extractText(await res.text())
      if (text.length > 80) return text
    } catch {
      continue
    }
  }
  return null
}

const SYSTEM = `You extract shipping and returns information from brand policy pages.

Output format — use EXACTLY this structure (omit a section if no info found):

SHIPPING
• [one fact per bullet]

RETURNS
• [one fact per bullet]

Rules:
- Use only the bullet character • (never dashes, hyphens, or em dashes)
- Each bullet is one short factual statement
- Keep bullets brief and specific: timeframes, costs, conditions, free thresholds
- Do not add commentary, headings other than SHIPPING/RETURNS, or filler text
- Do not invent information that is not in the source text
- If genuinely nothing is found for a section, omit it entirely`

export async function GET(req: NextRequest) {
  if (isRateLimited(req)) return NextResponse.json({ data: null }, { status: 429 })
  const raw = req.nextUrl.searchParams.get('url')
  if (!raw) return NextResponse.json({ data: null })

  const parsed = safeParseStoreUrl(raw)
  if (!parsed) return NextResponse.json({ data: null })
  // policyUrls below builds /policies/* and /pages/* on the given origin — a
  // storefront is the only destination this was meant for. Same null answer as
  // an unreadable URL, so the public contract does not change.
  if (!isRegisteredStore(parsed.hostname)) return NextResponse.json({ data: null })

  const cached = cache.get(raw)
  if (cached !== undefined) return NextResponse.json({ data: cached })

  const urls = policyUrls(raw)
  if (!urls) return NextResponse.json({ data: null })

  const [shippingText, returnsText] = await Promise.all([
    fetchPage(urls.shipping),
    fetchPage(urls.returns),
  ])

  if (!shippingText && !returnsText) {
    cache.set(raw, null)
    return NextResponse.json({ data: null })
  }

  // extractText above removes the tags. It deliberately keeps the LINE breaks —
  // <br> and every closing block tag become newlines — and that is the part a
  // merchant can still write with. The labels below are ours, and the reply is
  // split back out by matching /SHIPPING\n/ and /RETURNS\n/ on the model's
  // output, so a policy page that emits those words at the start of a line is
  // writing in our own hand. Measured against a page that tries: three lines
  // beginning "SHIPPING" and five beginning "RETURNS" reached the model, where
  // exactly one of each is ours, alongside a run of box drawing and the
  // untrusted fence markers themselves.
  //
  // So each page is reduced to one inert line by the same function the stylist
  // prompt and the relevance judge already use. Every newline in the message
  // below is then one we wrote. The words are untouched — a real policy may
  // legitimately say almost anything — and 2500 is the cap extractText already
  // applied, restated here so the boundary cannot silently widen it.
  const safeShipping = fenceUntrusted(shippingText, POLICY_CHARS)
  const safeReturns = fenceUntrusted(returnsText, POLICY_CHARS)

  const combined = [
    safeShipping && `SHIPPING PAGE:\n${safeShipping}`,
    safeReturns && `RETURNS PAGE:\n${safeReturns}`,
  ].filter(Boolean).join('\n\n---\n\n')

  try {
    const msg = await groqChat(
      [{ role: 'user', content: combined }],
      SYSTEM,
      undefined,
      { max_tokens: 300, temperature: 0.05, model: FAST_MODEL }
    )

    const raw_out = (msg?.content ?? '').trim()

    // Split the AI output into shipping and returns sections
    const shippingMatch = raw_out.match(/SHIPPING\s*\n([\s\S]*?)(?=RETURNS|$)/i)
    const returnsMatch  = raw_out.match(/RETURNS\s*\n([\s\S]*?)$/i)

    const data = {
      shipping: shippingMatch?.[1]?.trim() || '',
      returns:  returnsMatch?.[1]?.trim()  || '',
    }

    if (!data.shipping && !data.returns) {
      cache.set(raw, null)
      return NextResponse.json({ data: null })
    }

    cache.set(raw, data)
    return NextResponse.json({ data })
  } catch {
    cache.set(raw, null)
    return NextResponse.json({ data: null })
  }
}
