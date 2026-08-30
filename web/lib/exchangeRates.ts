export type ExchangeRates = Record<string, number>

const CACHE_TTL = 3600 * 1000 // 1 hour

type CachedRates = { rates: ExchangeRates; timestamp: number }

let serverCache: CachedRates | null = null

// ── Hardcoded fallback (used only when all live sources fail) ─────────────────
// Covers the ~40 most common buyer currencies so prices always display.
// Values are approximate mid-market rates vs USD as of 2025.
const FALLBACK_RATES: ExchangeRates = {
  USD: 1, EUR: 0.92, GBP: 0.79, JPY: 155, VND: 25450,
  CAD: 1.37, AUD: 1.52, CHF: 0.90, CNY: 7.24, HKD: 7.82,
  SGD: 1.34, KRW: 1360, INR: 83.5, BRL: 4.97, MXN: 17.1,
  SEK: 10.4, NOK: 10.6, DKK: 6.88, NZD: 1.63, ZAR: 18.6,
  THB: 35.5, IDR: 15900, MYR: 4.69, PHP: 56.5, TWD: 32.2,
  AED: 3.67, SAR: 3.75, QAR: 3.64, KWD: 0.308, TRY: 32.5,
  PLN: 4.00, CZK: 23.0, HUF: 360, RON: 4.57, ILS: 3.73,
  CLP: 935, COP: 3900, PEN: 3.71, ARS: 870, EGP: 48.5,
  PKR: 278, BDT: 110, NGN: 1580, KES: 130, GHS: 15.0,
}

/**
 * THE CURRENCIES THIS APPLICATION CLAIMS TO SUPPORT.
 *
 * Derived from FALLBACK_RATES rather than written out again, so there is one
 * list and it cannot drift: a currency the app cannot price in is a currency
 * the app does not support.
 *
 * WHY A CLOSED SET EXISTS AT ALL. The requested currency is caller-supplied —
 * four routes read it straight off a request body, and `parseBudget` lifts one
 * out of a shopper's typed sentence ("under €200"). It is then sent to every
 * merchant as `context.currency`, and the corpus files an observation under it.
 * Both of those need a bounded vocabulary: an unbounded one would let a caller
 * mint unlimited corpus rows and hand arbitrary strings to 458 third-party
 * stores. This set is versioned in git and no request can extend it.
 */
export const SUPPORTED_CURRENCIES: ReadonlySet<string> = new Set(Object.keys(FALLBACK_RATES))

/** The currency assumed when a caller names none. Matches normalizeCurrency's
 *  own default and every route's default, so "absent" and "USD" stay the same
 *  observation rather than becoming two. */
export const DEFAULT_REQUESTED_CURRENCY = 'USD'

/**
 * WHAT WE ASKED THE MERCHANT TO QUOTE IN — or nothing, if we cannot name it.
 *
 * Three outcomes, and the third is the point:
 *
 *   absent / empty   -> 'USD'   the app's default; unchanged from before
 *   supported        -> itself  upper-cased and trimmed
 *   anything else    -> null    UNNAMEABLE
 *
 * `null` is not "USD". It means this observation was made under a context the
 * app cannot name, so `context.currency` is omitted from the store call (the
 * merchant quotes its own default) and the corpus declines to file the
 * observation at all. Filing it would mean labelling a row with a context we
 * could not describe, which is the failure this whole phase exists to remove.
 *
 * NOT used for the currency a merchant ANSWERS with. That value is the
 * merchant speaking and is recorded verbatim by normalizeCurrency; allow-
 * listing it would silently rewrite what a store told us.
 */
export function resolveRequestedCurrency(raw?: string | null): string | null {
  const s = String(raw ?? '').trim().toUpperCase()
  if (!s) return DEFAULT_REQUESTED_CURRENCY
  return SUPPORTED_CURRENCIES.has(s) ? s : null
}
async function fetchOpenErApi(): Promise<ExchangeRates> {
  const res = await fetch('https://open.er-api.com/v6/latest/USD', {
    next: { revalidate: 3600 },
    signal: AbortSignal.timeout(4000),
  })
  if (!res.ok) throw new Error(`open.er-api HTTP ${res.status}`)
  const data = await res.json()
  if (!data?.rates || typeof data.rates !== 'object') throw new Error('open.er-api bad payload')
  return data.rates as ExchangeRates
}

// ── Source 2: @fawazahmed0/currency-api via jsDelivr CDN ─────────────────────
// Completely free, no rate limits, CDN-cached globally. Good backup.
async function fetchFawazCdn(): Promise<ExchangeRates> {
  const res = await fetch(
    'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json',
    { next: { revalidate: 3600 }, signal: AbortSignal.timeout(5000) },
  )
  if (!res.ok) throw new Error(`fawaz CDN HTTP ${res.status}`)
  const data = await res.json()
  const raw = data?.usd
  if (!raw || typeof raw !== 'object') throw new Error('fawaz CDN bad payload')
  // Response is { usd: { eur: 0.92, gbp: 0.79, ... } } — uppercase the keys
  const rates: ExchangeRates = { USD: 1 }
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
      rates[k.toUpperCase()] = v
    }
  }
  if (Object.keys(rates).length < 20) throw new Error('fawaz CDN too few rates')
  return rates
}

export async function getExchangeRates(): Promise<ExchangeRates> {
  const now = Date.now()

  // Hot path: in-memory cache still fresh
  if (serverCache && now - serverCache.timestamp < CACHE_TTL) {
    return serverCache.rates
  }

  // Try live sources in order; fall through to the next on any error
  for (const fetch of [fetchOpenErApi, fetchFawazCdn]) {
    try {
      const rates = await fetch()
      // Sanity: must include at least USD + EUR + GBP to be usable
      if (rates.USD && rates.EUR && rates.GBP) {
        serverCache = { rates, timestamp: now }
        return rates
      }
    } catch (err) {
      console.warn('[exchangeRates] source failed, trying next:', (err as Error).message)
    }
  }

  // Both live sources failed — serve stale cache if available, else hardcoded
  const fallback = serverCache?.rates ?? FALLBACK_RATES
  console.error('[exchangeRates] all live sources failed, using fallback rates')
  return fallback
}
