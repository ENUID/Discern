import { bestBrandDomains } from '../stores'

/**
 * WHICH BRANDS THE CORPUS ASKS NEXT, and why it is not the featured route's
 * page selector.
 *
 * Every scoped row the corpus holds was written by shopper traffic on
 * /api/featured at page 0 — 18 merchants out of a 458-brand registry, 10.5% of
 * the 172-brand featured pool. Not because the fan-out is narrow, but because
 * page 0 is the only page anyone ever loaded.
 *
 * THE FEATURED ROUTE CANNOT BE WALKED TO FIX THAT. It re-seeds its shuffle per
 * page — `seededShuffle(pool, page * 7 + 11)` — so consecutive pages are
 * windows over DIFFERENT permutations and partition nothing. Measured over all
 * seven pages it can produce: 123 of 172 brands reached, 49 unreachable by any
 * page at all, and page 7 wraps back to 0. A job walking those pages would
 * plateau at 71.5% forever.
 *
 * A FIXED SLICE PARTITIONS IT. `bestBrandDomains()` is a stable, versioned
 * array; slicing it at fixed offsets covers every element exactly once:
 *
 *   offset 0, 28, 56, 84, 112, 140, 168  ->  28+28+28+28+28+28+4 = 172
 *
 * Seven runs, complete coverage, no overlap, no state to persist.
 *
 * PURE, AND IN lib/ RATHER THAN IN THE ROUTE. A Next.js App Router file may
 * only export the handler and a fixed set of config fields — exporting these
 * from route.ts fails the build with "fillSliceCount is not a valid Route
 * export field". They live here so they can be imported, and so the seven-slice
 * partition can be tested directly rather than inferred from one day's run.
 */

/** One slice, matching the featured feed's own fan-out width so a run costs
 *  about what one page load costs and fits inside a single BATCH_SIZE round. */
export const FILL_SLICE = 28

/** ceil(172 / 28). Computed from the pool rather than written down, so a brand
 *  added to the registry cannot silently fall outside the rotation. */
export function fillSliceCount(pool: string[] = bestBrandDomains()): number {
  return Math.max(1, Math.ceil(pool.length / FILL_SLICE))
}

/**
 * WHICH SLICE TODAY. UTC day-of-year, so the answer does not depend on the
 * server's timezone, modulo the slice count so it is always in range.
 * Deterministic: the same date always selects the same brands, which is what
 * lets the rotation be stateless — no cursor, no table, no lock.
 */
export function fillOffset(now: Date = new Date(), pool: string[] = bestBrandDomains()): number {
  const y = now.getUTCFullYear()
  const dayOfYear = Math.floor(
    (Date.UTC(y, now.getUTCMonth(), now.getUTCDate()) - Date.UTC(y, 0, 1)) / 86_400_000,
  )
  return (dayOfYear % fillSliceCount(pool)) * FILL_SLICE
}

/** The brands this run will ask. A plain slice — no shuffle, no seed. */
export function fillBrands(offset: number, pool: string[] = bestBrandDomains()): string[] {
  return pool.slice(offset, offset + FILL_SLICE)
}
