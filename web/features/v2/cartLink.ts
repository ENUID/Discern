// ── Handing the order to the brand ───────────────────────────────────────────
// Discern never takes payment. Checkout sends the shopper to the store that
// sells the piece — and it sends them to a cart, not a product page, so the
// thing they chose here is already in the basket when they land.
//
// Shopify reads /cart/<variantId>:<qty>, comma-separated for several lines.
//
// Pure, and separate from the interface, because the matching has real rules in
// it — which variant answers a size and a colour, what to do when a store lists
// only one of those, how lines from one brand combine — and rules that decide
// where someone's money goes should be testable without a browser.

export type CartVariant = { id?: string; options?: Array<{ label?: string }> }

export type CartProduct = {
  storeUrl?: string
  sizes?: string[]
  colors?: Array<{ name: string }>
  variants?: CartVariant[]
}

export type CartLineish = {
  product: CartProduct
  size?: string
  color?: string
  qty: number
}

/** The variant the shopper actually chose.
 *
 *  Both options when the store offers both, else whichever one it offers, else
 *  the first. Falling back to the first is deliberate rather than lazy: a store
 *  with a single variant lists no options at all, and that variant is still the
 *  right one to buy.
 */
export function variantFor(p: CartProduct, size?: string, color?: string): CartVariant | undefined {
  const vs = p.variants
  if (!vs?.length) return undefined
  const has = (label?: string) => (v: CartVariant) => (v.options ?? []).some(o => o.label === label)
  const wantSize = size && p.sizes?.length
  const wantColor = color && p.colors?.length
  if (wantSize && wantColor) return vs.find(v => has(size)(v) && has(color)(v)) ?? vs.find(has(size)) ?? vs[0]
  if (wantSize) return vs.find(has(size)) ?? vs[0]
  if (wantColor) return vs.find(has(color)) ?? vs[0]
  return vs[0]
}

/** Shopify ids arrive as gid://shopify/ProductVariant/123; the cart wants 123. */
const numericId = (id?: string) => (id ? String(id).split('/').pop() : undefined)

/**
 * One link per store.
 *
 * Lines from the same brand combine into a single cart, so a two-piece order
 * from one label is one checkout rather than two tabs. A line whose variant id
 * is missing falls back to that product's own page — a malformed cart link is a
 * store error page, and the product page at least works.
 */
export function buildCartLinks(cart: CartLineish[]): string[] {
  const byOrigin = new Map<string, { origin: string; parts: string[]; fallback: string }>()
  for (const line of cart) {
    const store = line.product.storeUrl
    if (!store) continue
    let origin: string
    try { origin = new URL(store).origin } catch { continue }
    const entry = byOrigin.get(origin) ?? { origin, parts: [], fallback: store }
    const id = numericId(variantFor(line.product, line.size, line.color)?.id)
    if (id) entry.parts.push(`${id}:${Math.max(1, Math.trunc(line.qty) || 1)}`)
    byOrigin.set(origin, entry)
  }
  return Array.from(byOrigin.values())
    .map(e => (e.parts.length ? `${e.origin}/cart/${e.parts.join(',')}` : e.fallback))
}
