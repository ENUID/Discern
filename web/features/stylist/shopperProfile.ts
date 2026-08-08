// ── What Fabrics knows about the shopper ─────────────────────────────────────
// The stylist endpoint takes a dozen context fields beyond the question itself,
// and they are what separate "search the catalogue" from "answer for THIS
// person": gender and sizes decide what is even eligible, the wardrobe decides
// what would be a duplicate, saved pieces and recent searches carry taste.
//
// These derivations used to live inside DiscernPage as four useMemo bodies, so
// only the v1 UI could reach them. They are pure functions here so both
// surfaces build the same payload from the same rules — a second copy would
// drift, and the failure mode of drift is silent: the model simply answers a
// slightly different person on one of the two screens.

/** The `sizes` blob on a taste profile is a loose string map written by
 *  onboarding; nothing guarantees a key is present. */
type SizeMap = Record<string, string | undefined>

export type TasteProfileLike = {
  sizes?: unknown
  wardrobe?: {
    summary?: string
    items?: Array<{ color?: string; type?: string; style?: string }>
    gaps?: string[]
  }
} | null | undefined

const sizesOf = (p: TasteProfileLike): SizeMap | undefined => {
  const s = (p as { sizes?: unknown } | null | undefined)?.sizes
  return s && typeof s === 'object' ? (s as SizeMap) : undefined
}

/** 'Men' | 'Women' | 'Both' | 'Non-binary'; undefined when onboarding never
 *  asked. Passed separately from the prose profile because search defaults to
 *  it server-side. */
export function shopperGender(profile: TasteProfileLike): string | undefined {
  return sizesOf(profile)?.gender || undefined
}

/** One prose line — gender and sizes — so the model never has to ask for
 *  something the shopper already told us. */
export function shopperProfileLine(profile: TasteProfileLike): string | undefined {
  const s = sizesOf(profile)
  if (!s) return shopperGender(profile)
  const gender = s.gender || ''
  const genderLabel = gender && gender !== 'Both' && gender !== 'Non-binary'
    ? `${gender.toLowerCase()}'s `
    : ''
  const parts: string[] = []
  if (gender) parts.push(`shops for: ${gender.toLowerCase()}`)
  const sizeStr = [
    s.tops && `tops ${s.tops}`,
    s.bottoms && `bottoms ${s.bottoms}`,
    s.shoes && `shoes ${s.shoes}`,
  ].filter(Boolean).join(', ')
  if (sizeStr) parts.push(`${genderLabel}sizes: ${sizeStr}`)
  return parts.length > 0 ? parts.join(' | ') : undefined
}

/** Structured sizes, kept separate from the prose line: the backend ranks the
 *  catalogue on these directly and should never have to parse them back out of
 *  a sentence. */
export function shopperSizes(profile: TasteProfileLike) {
  const s = sizesOf(profile)
  if (!s) return undefined
  return { tops: s.tops || undefined, bottoms: s.bottoms || undefined, shoes: s.shoes || undefined }
}

/** A prior "scan my wardrobe" pass, formatted short. This is what stops Fabrics
 *  recommending the coat the shopper already owns. */
export function shopperWardrobeLine(profile: TasteProfileLike): string | undefined {
  const w = profile?.wardrobe
  if (!w?.items?.length && !w?.summary) return undefined
  const itemsLine = (w.items ?? []).slice(0, 20)
    .map(it => `${it.color} ${it.type} (${it.style})`).join(', ')
  const gapsLine = w.gaps?.length ? `Known gaps: ${w.gaps.join(', ')}.` : ''
  return [w.summary, itemsLine ? `Owns: ${itemsLine}.` : '', gapsLine]
    .filter(Boolean).join(' ') || undefined
}
