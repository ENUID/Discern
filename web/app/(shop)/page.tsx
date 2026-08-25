import { cookies, headers } from 'next/headers'
import Boutique from '@/features/v2/Boutique'
import { heroCopyIndex } from '@/features/v2/theme'
import {
  SHOPPER_COUNTRY_COOKIE,
  SHOPPER_CURRENCY_COOKIE,
  resolveShopperContext,
} from '@/lib/shopperContext'

/**
 * The boutique interface is now the app.
 *
 * The chat UI it replaced was deleted in Stage 0 — 8,357 unreachable lines that
 * every audit and every search was still reading. Its reasoning is preserved in
 * docs/architecture/v1-decisions.md, and the implementation is one `git show`
 * away if a product decision ever brings that interface back. What moved across
 * with it is the part that mattered: the shopper context that made Fabrics
 * answer a known person rather than a stranger, which now lives in
 * features/stylist and is shared rather than owned by one screen.
 *
 * Currency and country are resolved here, on the server, from the request's own
 * geo headers — the client cannot see them, and they decide what prices the
 * shopper is quoted.
 */
export default async function Page() {
  const headerStore = await headers()
  const cookieStore = await cookies()

  const shopperContext = resolveShopperContext({
    countryHeader: headerStore.get('x-vercel-ip-country'),
    acceptLanguage: headerStore.get('accept-language'),
    cookieCountry: cookieStore.get(SHOPPER_COUNTRY_COOKIE)?.value,
    cookieCurrency: cookieStore.get(SHOPPER_CURRENCY_COOKIE)?.value,
  })

  return (
    <Boutique
      buyerCurrency={shopperContext.currency}
      buyerCountry={shopperContext.country}
      heroCopy={heroCopyIndex(Date.now())}
    />
  )
}
