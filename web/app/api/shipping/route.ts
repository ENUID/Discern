import { NextRequest, NextResponse } from 'next/server'
import { groqChat, FAST_MODEL } from '@/lib/groq'
import { BoundedCache } from '@/lib/boundedCache'
import { safeParseStoreUrl, safeFetch } from '@/lib/ssrfGuard'
import { makeIpRateLimiter } from '@/lib/rateLimit'

const cache = new BoundedCache<string, { shipping: string; returns: string } | null>(2000)

// Unauthenticated, and each cache miss costs several outbound page fetches
// plus one LLM call — limit per IP so it can't be scripted into a quota
// drain or used to hammer stores' policy pages through us.
const isRateLimited = makeIpRateLimiter(20, 60_000)

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

function extractText(html: string, maxChars = 2500): string {
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

  if (!safeParseStoreUrl(raw)) return NextResponse.json({ data: null })

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

  const combined = [
    shippingText && `SHIPPING PAGE:\n${shippingText}`,
    returnsText && `RETURNS PAGE:\n${returnsText}`,
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
