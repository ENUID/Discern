import { NextRequest, NextResponse } from 'next/server'
import { ConvexHttpClient } from 'convex/browser'
import { groqChat } from '@/lib/groq'
import { anyApi } from 'convex/server'
import { decomposeQuery } from '@/lib/queryParser'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Weekly vocabulary review.
 *
 * Reads the queries the hand-curated dictionaries failed on, asks the model —
 * once, in a single batched call — what canonical term each one is reaching
 * for, and attaches that as a *suggestion*. A human then approves or rejects
 * each at /admin/vocab.
 *
 * The suggestion changes nothing on its own. Approving records the decision;
 * the dictionary edit in lib/queryParser.ts stays a reviewed code change, so a
 * bad synonym can never reach live matching without someone having read it.
 *
 * One LLM call per week, off the hot path — the same shape and budget as the
 * style-signals cron.
 */

// anyApi (not the generated typed api): the generated types are only rebuilt by
// `npx convex dev/deploy`, which the Vercel build runs — same pattern as every
// other server-side caller of a new function.

/** Rows the vocabulary can already read need no suggestion — they landed here
 *  because the catalogue was thin, not because we misunderstood the words. */
function alreadyUnderstood(phrase: string): boolean {
  return decomposeQuery(phrase).garmentKeys.length > 0
}

export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || secret !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!process.env.CONVEX_AUTH_SECRET || !process.env.NEXT_PUBLIC_CONVEX_URL) {
    return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  }

  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL)
  const serverSecret = process.env.CONVEX_AUTH_SECRET

  try {
    const candidates: Array<{ phrase: string; count: number; suggestion: string | null }> =
      await convex.query(anyApi.vocabCandidates.listCandidates, { status: 'new', limit: 120, serverSecret })

    // Only phrases the vocabulary genuinely could not read, seen more than once,
    // and not already carrying a suggestion from a previous run.
    const needsSuggestion = (candidates ?? [])
      .filter(c => c.count >= 2 && !c.suggestion && !alreadyUnderstood(c.phrase))
      .slice(0, 40)

    if (needsSuggestion.length === 0) {
      return NextResponse.json({ ok: true, message: 'Nothing new to review', suggested: 0 })
    }

    const prompt = `Each line below is a fashion shopping query our garment dictionary failed to recognise. For each, name the single canonical garment or attribute term it is reaching for, or "unknown" if it isn't a garment at all.

Return ONLY a JSON object mapping each input line to its canonical term:
{"co ord set":"two-piece set","jorts":"denim shorts","asdfgh":"unknown"}

Lines:
${needsSuggestion.map(c => `- ${c.phrase}`).join('\n')}`

    let mapping: Record<string, string> = {}
    try {
      const raw = await groqChat(
        [{ role: 'user', content: prompt }],
        'You map colloquial fashion terms to canonical garment names. Return only valid JSON.',
        undefined,
        { temperature: 0, max_tokens: 700 },
      )
      const text = (raw as any)?.content ?? (raw as any)?.choices?.[0]?.message?.content ?? ''
      const match = text.match(/\{[\s\S]*\}/)
      if (match) mapping = JSON.parse(match[0])
    } catch (e) {
      // Never silent: an empty mapping in the logs must be distinguishable from
      // "the model looked and found nothing to suggest".
      console.error('[vocab-review] suggestion pass failed:', e)
      return NextResponse.json({ ok: false, error: 'suggestion pass failed', suggested: 0 }, { status: 200 })
    }

    let suggested = 0
    for (const [phrase, term] of Object.entries(mapping)) {
      const clean = String(term ?? '').trim()
      if (!clean || clean.toLowerCase() === 'unknown') continue
      try {
        const res = await convex.mutation(anyApi.vocabCandidates.setSuggestion, {
          phrase, suggestion: clean, serverSecret,
        })
        if ((res as any)?.ok) suggested++
      } catch (e) {
        console.error('[vocab-review] could not attach suggestion for', phrase, e)
      }
    }

    // Keep the table small: rejected rows older than 60 days have served their
    // purpose. Approved rows are kept — they are the evidence trail for a
    // dictionary edit that may not have been made yet.
    let pruned = 0
    try {
      const res = await convex.mutation(anyApi.vocabCandidates.pruneReviewed, {
        cutoff: Date.now() - 60 * 24 * 60 * 60 * 1000,
        serverSecret,
      })
      pruned = (res as any)?.deleted ?? 0
    } catch (e) {
      console.error('[vocab-review] prune failed:', e)
    }

    console.log(`[vocab-review] reviewed ${needsSuggestion.length}, suggested ${suggested}, pruned ${pruned}`)
    return NextResponse.json({ ok: true, reviewed: needsSuggestion.length, suggested, pruned })
  } catch (e) {
    console.error('[vocab-review] failed:', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
