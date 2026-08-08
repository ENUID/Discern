import { cookies, headers } from 'next/headers'
import Boutique from '@/features/v2/Boutique'
import { heroCopyIndex } from '@/features/v2/theme'
import {
  SHOPPER_COUNTRY_COOKIE,
  SHOPPER_CURRENCY_COOKIE,
  resolveShopperContext,
} from '@/lib/shopperContext'

/**
 * /v2 kept as an alias now that the boutique is the app at /. It was the
 * preview route for months, so anything already pointing here — a bookmark, a
 * link in a message — should land on the same screen rather than a 404.
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
