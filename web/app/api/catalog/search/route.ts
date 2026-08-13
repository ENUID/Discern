import { NextRequest, NextResponse } from 'next/server'
import { GlobalCatalogService, lastJudgeOutcome } from '@/lib/services/GlobalCatalogService'
import {
  normalizeFashionTypos, buildMandatoryConcepts, classifyQuerySlot,
  GARMENT_VOCAB, decomposeQuery, dropGenericWhenSpecific,
} from '@/lib/queryParser'
import { compileIntent } from '@/lib/intentCompiler'
import { outfitPlan } from '@/lib/fashion/outfitKnowledge'
import { makeIpRateLimiter } from '@/lib/rateLimit'

/**
 * The catalogue, without the model.
 *
 * /api/ai/stylist is the good answer and it depends on a language model, which
 * means it depends on somebody else's quota, uptime and latency. When that
 * fails there is nothing wrong with the catalogue — the brands are up, the
 * products are there — and yet the shopper was getting an apology and an empty
 * screen, because every path to a product ran through the model.
 *
 * This is the path that does not. It reads the question with the same
 * deterministic machinery the stylist uses before it ever calls a model — the
 * typo corrector, the occasion planner, the intent compiler, the concept
 * builder — and searches. No styling, no reasoning, no prose. Just the pieces.
 *
 * The interface calls it whenever the stylist comes back with nothing, so a
 * model outage costs the quality of the answer and never the answer itself.
 */

export const maxDuration = 60

/** A ceiling on this route, and a second chance under it.
 *
 *  It fans out to brand stores, each with its own 5s timeout, in two rounds,
 *  and then the relevance judge runs on top. Fourteen seconds was under that on
 *  a cold function, so the race resolved to the fallback — an EMPTY array — and
 *  the shopper was told nothing reached the catalogue while ninety stores were
 *  mid-reply. That is the "ask again" that kept coming back: not a failure, a
 *  stopwatch.
 *
 *  So the ceiling is realistic, and a timeout no longer discards the work. The
 *  slow path is retried once against a much narrower fan-out, which is fast
 *  enough to finish and returns real pieces instead of an apology. */
const BUDGET_MS = 26_000
const RETRY_MS = 9_000
/** One strip's own ceiling.
 *
 *  Generous on purpose: every strip is a full fan-out over ninety brand stores
 *  plus the relevance judge, and 24s cut the second strip of "shirts and
 *  trousers" — the request came back as shirts alone, which is the exact bug
 *  this split exists to prevent. They run concurrently, so a higher ceiling
 *  costs no wall-clock; it only stops a strip being thrown away just before it
 *  would have answered. Still well inside the route's own 60s. */
const STRIP_MS = 38_000

const perStrip = <T,>(work: Promise<T[]>): Promise<T[]> =>
  Promise.race([work.catch(() => [] as T[]), new Promise<T[]>(r => setTimeout(() => r([] as T[]), STRIP_MS))])

async function byDeadline<T>(work: Promise<T>, fallback: T, retry?: () => Promise<T>): Promise<T> {
  const timeout = Symbol('deadline')
  const first = await Promise.race([
    work.catch(() => fallback),
    new Promise<typeof timeout>(r => setTimeout(() => r(timeout), BUDGET_MS)),
  ])
  if (first !== timeout) return first as T
  if (!retry) return fallback
  console.warn('[catalog/search] over budget — retrying narrow')
  return Promise.race([
    retry().catch(() => fallback),
    new Promise<T>(r => setTimeout(() => r(fallback), RETRY_MS)),
  ])
}
export const dynamic = 'force-dynamic'

// Same shape of protection as the other unauthenticated endpoints: this one
// fans out to brand stores, so it must not be scriptable into a load generator.
const isRateLimited = makeIpRateLimiter(20, 60_000)

type Group = { label: string; query: string; products: unknown[] }

export async function POST(req: NextRequest) {
  if (isRateLimited(req)) {
    return NextResponse.json({ products: [], groups: [], reason: 'rate-limited' }, { status: 429 })
  }

  let body: any = {}
  try { body = await req.json() } catch { /* defaults below */ }

  const raw = typeof body?.q === 'string' ? body.q.trim().slice(0, 300) : ''
  if (!raw) return NextResponse.json({ products: [], groups: [], reason: 'empty-query' })

  const q = normalizeFashionTypos(raw)
  const countryCode: string | null =
    typeof body?.country === 'string' && body.country.trim() ? body.country.trim().toUpperCase() : null
  const currency: string =
    typeof body?.currency === 'string' && body.currency.trim() ? body.currency.trim().toUpperCase() : 'USD'
  const gender: string | null = typeof body?.gender === 'string' ? body.gender.trim() : null
  const sizes = body?.sizes && typeof body.sizes === 'object' ? body.sizes : {}

  const sizeFor = (text: string): string | null => {
    const slot = classifyQuerySlot(text)
    if (slot === 'top' || slot === 'outer' || slot === 'dress') return sizes.tops || null
    if (slot === 'bottom') return sizes.bottoms || null
    if (slot === 'shoes') return sizes.shoes || null
    return null
  }

  // Gender is prepended rather than trusted to be in the sentence: "what do I
  // wear to an interview" carries none, and menswear and womenswear are
  // different searches.
  const g = /^w/i.test(gender || '') ? 'women' : /^m/i.test(gender || '') ? 'men' : ''
  const withGender = (s: string) =>
    g && !decomposeQuery(s).gender ? `${g} ${s}`.trim() : s

  try {
    // Three shapes of request, and they have to be told apart in this order —
    // getting it wrong is what turned "shirts and trousers" into trousers.
    //
    //   two or more garments named  → one strip each, exactly what was asked
    //   one garment named          → that garment, even if an occasion is also
    //                                named: "shoes for work" wants shoes, not a
    //                                blazer and a shirt
    //   no garment named           → the occasion decides the slots
    //
    // The single-search path below compiles to ONE garment (the compiler keeps
    // the most specific hit), so a two-garment request that reaches it loses
    // one of them silently. The stylist route splits the same way; these two
    // have to agree or the same sentence gets two different answers depending
    // on which path served it.
    // "shoes and sneakers" is one request; a sneaker is a shoe. The generic
    // word loses to the specific one in the same slot — see the helper.
    const named = dropGenericWhenSpecific(decomposeQuery(q).garmentKeys)
    const plan = named.length > 0 ? null : outfitPlan(q, gender)
    const slots: string[] = named.length >= 2 ? named.slice(0, 4)
      : (plan && plan.slots.length >= 2 ? plan.slots.slice(0, 4) : [])

    if (slots.length >= 2) {
      // Only an occasion contributes a fabric; a named garment is taken as
      // asked, without a fibre nobody mentioned.
      const fabric = plan?.fabrics[0] ?? ''
      // Each strip gets its OWN deadline, not one shared across all of them.
      // A single budget wrapped around Promise.all means the slowest slot
      // decides for every slot: two searches over ninety stores each, plus the
      // relevance judge, went past it and the race resolved to an empty array —
      // so "shirts and trousers" fell through to the single-search path and came
      // back as trousers alone. A slow strip should cost that strip, nothing
      // else.
      const groups = (await Promise.all(slots.map(async (slot) => {
        const term = GARMENT_VOCAB[slot]?.query[0] || slot
        const sub = withGender([fabric, term].filter(Boolean).join(' '))
        try {
          const found = await perStrip(GlobalCatalogService.search(
            sub, undefined, [], countryCode, true, buildMandatoryConcepts(sub),
            'relevance', currency, { fastFirstPage: true }, [], undefined, sub, sizeFor(sub),
          ))
          const label = term.charAt(0).toUpperCase() + term.slice(1)
          return { label, query: sub, products: found.slice(0, 8) } as Group
        } catch {
          return { label: term, query: sub, products: [] } as Group
        }
      }))).filter(gr => gr.products.length > 0)

      if (groups.length) {
        const seen = new Set<string>()
        const flat = groups.flatMap(gr => gr.products).filter((p: any) => {
          const id = String(p?.id ?? '')
          if (!id || seen.has(id)) return false
          seen.add(id)
          return true
        })
        // Whether the taste layer actually ran. Without it a page is a keyword
        // search with filters on it, and that is indistinguishable from bad
        // taste unless it is said.
        return NextResponse.json({ products: flat, groups, query: q, plan: plan?.occasion ?? 'named-garments', judge: lastJudgeOutcome })
      }
    }

    // Otherwise: one search, compiled if the sentence compiles and taken
    // literally if it does not.
    const compiled = compileIntent(withGender(q), currency)
    const term = compiled?.args.searchQuery || withGender(q)
    const runSearch = (opts: Record<string, unknown>) => GlobalCatalogService.search(
      term, compiled?.args.budgetMax, [], countryCode, true,
      compiled?.args.mandatoryConcepts || buildMandatoryConcepts(term),
      compiled?.args.sort || 'relevance', compiled?.args.budgetCurrency || currency,
      opts, [], undefined, raw, sizeFor(term),
    )
    const found = await byDeadline(
      runSearch({ fastFirstPage: true }),
      [] as any[],
      // Second pass with the judge off: the pool is already fetched and cached
      // by then, so this returns the keyword-ordered page in a fraction of the
      // time. A worse order is a far better answer than none.
      () => runSearch({ fastFirstPage: true, sort: 'trust_desc' as never }),
    )
    return NextResponse.json({ products: found.slice(0, 12), groups: [], query: term, judge: lastJudgeOutcome })
  } catch (e) {
    console.error('[catalog/search] failed:', e)
    return NextResponse.json({ products: [], groups: [], reason: 'search-failed' }, { status: 200 })
  }
}
