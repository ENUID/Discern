'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useQuery } from 'convex/react'
import { api } from '@/convex/_generated/api'
import { useConvexAuthProof } from '@/hooks/useConvexAuthProof'
import {
  shopperGender, shopperProfileLine, shopperSizes, shopperWardrobeLine,
  type TasteProfileLike,
} from './shopperProfile'
import type { StylistContext } from './askStylist'
import { readDeviceGender } from '@/lib/shopperPrefs'

/** Everything Fabrics is told about the shopper, gathered once.
 *
 *  The v1 UI assembled this inline and no other surface could reach it, which
 *  is why v2 was asking the same model a materially poorer question: no
 *  gender, no sizes, no wardrobe, no memory, no currency. Signed out, every
 *  Convex query skips and the whole thing collapses to currency and country —
 *  which is correct, not a degraded path: those are the only two facts we have
 *  about a visitor who has not told us anything.
 */
export function useStylistContext(opts: {
  buyerCurrency?: string
  buyerCountry?: string
  savedProducts?: Array<{ title?: string; vendor?: string; price?: number; currency?: string }>
  recentSearches?: string[]
}): StylistContext {
  const { data: session } = useSession()
  const email = session?.user?.email ?? undefined
  const authProof = useConvexAuthProof(email)
  const scope = email && authProof ? { userEmail: email, authProof } : 'skip'

  // Whoever is holding the phone, when the account has not been asked. Read
  // after mount, never during render — localStorage does not exist on the
  // server and reading it in a useMemo body is a hydration mismatch waiting
  // to happen.
  const [deviceGender, setDeviceGender] = useState<string | undefined>(undefined)
  useEffect(() => {
    const sync = () => setDeviceGender(readDeviceGender() ?? undefined)
    sync()
    window.addEventListener('discern:shopsFor', sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener('discern:shopsFor', sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const memory = useQuery(api.stylistMemory.getStylistMemory, scope as never)
  const taste = useQuery(api.tasteProfile.getTasteProfile, scope as never) as TasteProfileLike

  const { buyerCurrency, buyerCountry, savedProducts, recentSearches } = opts

  return useMemo<StylistContext>(() => ({
    buyerCurrency,
    buyerCountry,
    memorySummary: (memory as { summary?: string } | undefined)?.summary ?? undefined,
    // The account first: a fact someone stated about themselves outranks a tap
    // on whatever device they happen to be holding.
    shopperGender: shopperGender(taste) ?? deviceGender,
    shopperProfile: shopperProfileLine(taste),
    shopperSizes: shopperSizes(taste),
    shopperWardrobe: shopperWardrobeLine(taste),
    // Free-tier personalisation — every shopper gets these; memorySummary above
    // is the premium one.
    savedProducts: savedProducts?.slice(0, 12),
    recentSearches: recentSearches?.slice(0, 8),
  }), [buyerCurrency, buyerCountry, memory, taste, savedProducts, recentSearches, deviceGender])
}
