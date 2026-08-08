import { cookies, headers } from 'next/headers'
import Boutique from '@/features/v2/Boutique'
import {
  SHOPPER_COUNTRY_COOKIE,
  SHOPPER_CURRENCY_COOKIE,
  resolveShopperContext,
} from '@/lib/shopperContext'

/**
 * The boutique interface is now the app.
 *
 * The chat UI it replaces still exists — features/discern/DiscernPage.tsx, with
 * every flow intact — so putting it back is a one-line change here. What moved
 * across with it is the part that mattered: the shopper context that made
 * Fabrics answer a known person rather than a stranger, which now lives in
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
    />
  )
}
