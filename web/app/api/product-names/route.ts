import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { infer } from '@/lib/ai/infer'
import { groqChat, FAST_MODEL } from '@/lib/groq'
import { BoundedCache } from '@/lib/boundedCache'
import { makeIpRateLimiter } from '@/lib/rateLimit'
import { fenceUntrusted } from '@/lib/stylist/promptSafety'

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

/** A title is merchant writing that arrives here from a browser, and neither
 *  of those is ours. It goes into a prompt whose reply is parsed BY LINE —
 *  `3. Striped shirt` — so a newline inside a title was a way to write another
 *  item's name: send one containing "\n2. <anything>" and the loop below read
 *  it back as the name for item 2. Collapsing each field to one inert line is
 *  what removes that, and it is the function the stylist and the judge already
 *  use rather than a second sanitiser.
 *
 *  200 and 40 are the caps prompts.ts uses for a product title and an option
 *  name; nothing legible under a photograph needs more. */
const safeTitle = (t: unknown) => fenceUntrusted(t, 200)
const safeType = (t: unknown) => fenceUntrusted(t, 40)

/** What the cache is actually about.
 *
 *  It was keyed on the raw title — attacker-chosen — so anyone could name any
 *  title and every later caller asking about that title was served it: a
 *  cross-user write costing one request. The key is now a digest of the values
 *  that ACTUALLY reach the model, so two requests share an entry exactly when
 *  they would produce the same answer, and never otherwise. `type` belongs in
 *  it because the system prompt uses it — it is what the model names from when
 *  a title names no garment.
 *
 *  JSON.stringify around the pair rather than concatenation, so ["ab",""] and
 *  ["a","b"] cannot collapse into one key. */
const keyFor = (title: string, type?: string) =>
  createHash('sha256').update(JSON.stringify([safeTitle(title), safeType(type)])).digest('hex')

export async function POST(req: NextRequest) {
  if (isRateLimited(req)) return NextResponse.json({ names: {} }, { status: 429 })
  try {
    const body = await req.json()
    const items: Item[] = Array.isArray(body?.items) ? body.items.slice(0, 40) : []
    if (!items.length) return NextResponse.json({ names: {} })

    // The response stays keyed by the caller's own raw title — that is the
    // contract the grid reads, and it does not change.
    const names: Record<string, string> = {}
    const need: Item[] = []
    for (const it of items) {
      const raw = (it?.title ?? '').trim()
      if (!raw) continue
      const hit = cache.get(keyFor(raw, it?.type))
      if (hit !== undefined) names[raw] = hit
      else if (!need.some(n => n.title === raw)) need.push({ title: raw, type: it.type })
    }
    if (!need.length) return NextResponse.json({ names })

    // Every newline in this message is one we wrote. See safeTitle above.
    const userMsg = need
      .map((it, i) => {
        const t = safeTitle(it.title)
        const ty = safeType(it.type)
        return `${i + 1}. ${t}${ty ? ` [type: ${ty}]` : ''}`
      })
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
      const item = need[idx]
      const src = item?.title
      if (!src) continue
      // A model that ignores the word limit must not be allowed to put a
      // paragraph under a photograph.
      const name = m[2].replace(/^["'`]|["'`.]$/g, '').trim()
      if (!name || name.split(/\s+/).length > 7) continue
      cache.set(keyFor(src, item.type), name)
      names[src] = name
    }

    return NextResponse.json({ names })
  } catch {
    // The grid falls back to the raw titles, which is the state it was in
    // before this existed — never a blank caption.
    return NextResponse.json({ names: {} })
  }
}
