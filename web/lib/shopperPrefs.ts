'use client'

/**
 * The one thing we have to know, kept on the device.
 *
 * Gender is a hard filter in the catalogue: a shopper who says "men" is never
 * shown a bona fide women's piece. It is also the only filter that cannot be
 * inferred — most sentences name no gender at all ("a linen shirt", "something
 * for a beach party"), and guessing is a coin flip that gets it wrong for half
 * the people who ask.
 *
 * It lived only on the Convex account, three taps behind a menu, so every
 * signed-out visitor and every account that never opened that sheet searched
 * with it blank — and a blank gender means the filter has nothing to filter
 * toward and quietly does nothing. That is the whole of "why am I being shown
 * womenswear": not a broken filter, an unanswered question.
 *
 * So it lives on the device too, the same way the bag does. Answerable in one
 * tap, by anyone, signed in or not. The account still wins when it has an
 * answer — a stated fact on your profile should not be overridden by a tap on
 * a borrowed phone.
 */

export type ShopperGender = 'Men' | 'Women' | 'Both'

const KEY = 'discern.v2.shopsFor'

export function readDeviceGender(): ShopperGender | null {
  if (typeof window === 'undefined') return null
  try {
    const v = window.localStorage.getItem(KEY)
    return v === 'Men' || v === 'Women' || v === 'Both' ? v : null
  } catch {
    // Private mode, storage disabled, quota. Not knowing is survivable;
    // throwing on the way to a search is not.
    return null
  }
}

export function writeDeviceGender(g: ShopperGender): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(KEY, g)
    // Same-tab listeners: the storage event only fires in OTHER tabs, so the
    // component that asked the question would not hear its own answer.
    window.dispatchEvent(new CustomEvent('discern:shopsFor', { detail: g }))
  } catch { /* see above */ }
}

/** True when nobody has answered yet, on this device or on the account. */
export function genderUnknown(accountGender?: string | null): boolean {
  const a = (accountGender ?? '').trim()
  if (a) return false
  return readDeviceGender() === null
}
