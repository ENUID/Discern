import { NextRequest, NextResponse } from 'next/server'
import { bestBrandDomains } from '@/lib/stores'
import { GlobalCatalogService } from '@/lib/services/GlobalCatalogService'
import { fillBrands, fillOffset, fillSliceCount } from '@/lib/services/corpusFill'

export const runtime = 'nodejs'
export const maxDuration = 300

/**
 * FILLING THE CORPUS ON PURPOSE, RATHER THAN AS A SIDE EFFECT OF ONE PAGE.
 *
 * The slice arithmetic — and the argument for why it is a fixed slice and not
 * the featured route's re-seeded page — lives in lib/services/corpusFill.ts,
 * because a Next.js route file may export only its handler and a fixed set of
 * config fields. This file is the boundary: authenticate, pick today's slice,
 * hand it to the catalogue, report the run.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It changes no shopper path — /api/featured
 * is untouched and this endpoint serves nobody. It adds no depth: every
 * merchant still yields at most STORE_BROWSE_LIMIT products, and going past
 * that needs cursor pagination against products.json, which is a different
 * phase with its own evidence. It collects one country and one currency; the
 * corpus key already has room for more and needs no migration to accept them.
 */

/**
 * Secured with CRON_SECRET, the same bearer pattern brand-health and every
 * other cron in this app already uses. The check is FIRST: an unauthenticated
 * request must not reach a single merchant, so there is no fan-out, no corpus
 * write and no outbound call above this line.
 */
export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || secret !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const pool = bestBrandDomains()
  const offset = fillOffset(new Date(), pool)
  const brands = fillBrands(offset, pool)

  if (brands.length === 0) {
    return NextResponse.json({ ok: true, offset, brands: 0, fetched: 0, note: 'empty slice' })
  }

  // THE CONTEXT IS THE POINT. Empty query, US, USD, and — the two that decide
  // whether anything is filed at all — no rerankQuery and no budgetMax, so
  // storeCtx.intent stays null and storeCtx.priceMaxMinor stays null. That is
  // exactly the `nameableContext` the write seam requires; a pool fetched under
  // free-form intent or a price filter answers a narrower question than "what
  // does this shop sell" and is deliberately not written.
  //
  // Through GlobalCatalogService rather than around it: the fan-out, the
  // safeFetch boundary, parseProduct, dedupe and the corpus write are the same
  // ones a shopper's page uses. A second fetch path here would be a second
  // thing to keep correct.
  let products: Awaited<ReturnType<typeof GlobalCatalogService.search>> = []
  try {
    products = await GlobalCatalogService.search(
      '',                 // browse, not search — STORE_BROWSE_LIMIT applies
      undefined,          // no budget  -> no filters.price.max
      [],                 // nothing excluded
      'US',               // the canonical corpus country
      true,
      [],
      'relevance',
      'USD',              // the canonical requested currency; key stays 3-segment
      {},                 // no judge, no progress, not load-more
      brands,             // THIS slice, and nothing else
      undefined,          // no taste profile
      undefined,          // no rerankQuery -> no intent
      null,
      null,
    )
  } catch {
    // A slice that throws is a slice, not an outage. One dead merchant is
    // already absorbed inside fetchStore; this catches anything above it so the
    // cron reports rather than 500s, and tomorrow's run takes the next slice.
    return NextResponse.json({ ok: false, offset, brands: brands.length, fetched: 0 })
  }

  // Bounded and countable: how many brands were asked, and how many products
  // the page-shaped result carries. The corpus's own numbers come from
  // products:census, not from here — this endpoint reports the RUN.
  return NextResponse.json({
    ok: true,
    offset,
    slices: fillSliceCount(pool),
    brands: brands.length,
    sampleBrands: brands.slice(0, 5),
    fetched: products.length,
    country: 'US',
    requestedCurrency: 'USD',
  })
}
