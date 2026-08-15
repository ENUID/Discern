import { NextRequest, NextResponse } from 'next/server'
import { infer } from '@/lib/ai/infer'
import { groqChat, FAST_MODEL } from '@/lib/groq'
import { BoundedCache } from '@/lib/boundedCache'
import { makeIpRateLimiter } from '@/lib/rateLimit'

/**
 * Short display names for a set of products.
 *
 * Catalogue titles are written for a search engine, not a reader: "Rare Rabbit
 * Men's Fivo Dusky Brown Cotton Fabric Half Sleeve Collared Regular Fit Striped
 * Shirt" is four lines under a photograph and says less than three words would.
 * The opposite failure is just as common — a title that is only a style code or
 * a first name, like "KUNAL", which names nothing at all.
 *
 * One call per result set, not per product: the grid asks once with every raw
 * title and gets the whole list back. Cached per title, so a piece that shows up
 * in a later search is already named.
 */

const cache = new BoundedCache<string, string>(4000)
const isRateLimited = makeIpRateLimiter(30, 60_000)

const SYSTEM = `You rename fashion products for display under a photograph in a boutique grid.

For each numbered input title, return a short display name.

RULES:
- 2 to 5 words. Never more.
- Name the garment. Every name must end with the item itself (shirt, blazer, cardigan, trousers, loafers, tote).
- Keep at most two distinguishing details that a shopper would actually use: colour, fabric, sleeve length, neckline, silhouette. Choose the ones that set this piece apart.
- Drop the brand name, "Men's"/"Women's", size, fit codes, SKUs, style names, and filler words like "Fabric", "Regular Fit", "Collared", "Premium", "Stylish".
- If the title is only a person's name, a style code, or otherwise names no garment, infer the garment from the product type given and name it plainly.
- Sentence case: capitalise the first word and proper nouns only. Not Title Case, not ALL CAPS.
- No punctuation at the end. No quotes. No brand names.

Return one line per input, in the same order, formatted exactly as:
<number>. <name>

Nothing else. No preamble, no blank lines.`

type Item = { title?: string; type?: string }

export async function POST(req: NextRequest) {
  if (isRateLimited(req)) return NextResponse.json({ names: {} }, { status: 429 })
  try {
    const body = await req.json()
    const items: Item[] = Array.isArray(body?.items) ? body.items.slice(0, 40) : []
    if (!items.length) return NextResponse.json({ names: {} })

    const names: Record<string, string> = {}
    const need: Item[] = []
    for (const it of items) {
      const raw = (it?.title ?? '').trim()
      if (!raw) continue
      const hit = cache.get(raw)
      if (hit !== undefined) names[raw] = hit
      else if (!need.some(n => n.title === raw)) need.push({ title: raw, type: it.type })
    }
    if (!need.length) return NextResponse.json({ names })

    const userMsg = need
      .map((it, i) => `${i + 1}. ${it.title}${it.type ? ` [type: ${it.type}]` : ''}`)
      .join('\n')

    // The shared ladder, not the OpenRouter default. A caption arriving from
    // whichever provider is up beats no caption because one pool was capped.
    const msg = await infer('fast', [{ role: 'user', content: userMsg }], SYSTEM,
      { max_tokens: 40 * need.length + 60, temperature: 0.2 })

    // "3. Striped half-sleeve shirt" -> need[2]
    for (const line of (msg.text ?? '').split('\n')) {
      const m = line.match(/^\s*(\d+)\s*[.)]\s*(.+?)\s*$/)
      if (!m) continue
      const idx = Number(m[1]) - 1
      const src = need[idx]?.title
      if (!src) continue
      // A model that ignores the word limit must not be allowed to put a
      // paragraph under a photograph.
      const name = m[2].replace(/^["'`]|["'`.]$/g, '').trim()
      if (!name || name.split(/\s+/).length > 7) continue
      cache.set(src, name)
      names[src] = name
    }

    return NextResponse.json({ names })
  } catch {
    // The grid falls back to the raw titles, which is the state it was in
    // before this existed — never a blank caption.
    return NextResponse.json({ names: {} })
  }
}
