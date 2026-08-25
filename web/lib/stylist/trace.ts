/**
 * Why did we show this?
 *
 * §3 of the build spec lists thirteen questions the architecture cannot
 * answer, and every one is a variant of that. This week each of them was
 * answered the same way: re-run the request by hand, read intermediate output
 * that production throws away, work backwards. That found the leather sandals
 * shown for a denim clog, the blazers for a casual party, and the outfit with
 * nothing under it — and it does not scale past one person sitting at a
 * terminal with the quota to re-run things.
 *
 * The pieces already existed and were not joined up. The judge reports its own
 * outcome. `answerVia` reports which strategy read the model. `modelTrace`
 * reports why the chain gave up. `outfitTrace` reports why an outfit came back
 * empty. Each is written to a console nobody outside the deploy can read, and
 * none of them can be tied to the others or to the request that produced them.
 *
 * This is the id that ties them together, and the record that survives the
 * request.
 *
 * PER REQUEST, NEVER A MODULE GLOBAL. `lastJudgeOutcome` and `providerOut` are
 * module-level and shared by every concurrent request on the instance — fine
 * for "is the taste layer running at all", wrong for "what happened to THIS
 * shopper's question". The audit lists that as a live risk; this does not add
 * to it.
 *
 * BOUNDED AND REDACTED. A trace is diagnostic, not a log tail: every string is
 * capped, every list is capped, product entries carry an id and a title and
 * nothing else, and the shopper's own question is stored but their email,
 * their photographs and every provider key are not. A trace that is expensive
 * to keep gets turned off, and a trace that is turned off answers nothing.
 */

/** One thing that happened, in order. */
export type TraceStep = {
  at: number
  step: string
  detail?: string
}

export type TracedProduct = { id: string; title: string; vendor?: string }

export type Trace = {
  id: string
  startedAt: number
  question: string
  gender?: string
  country?: string
  currency?: string
  /** heavy = the path that can search; light = conversational. */
  route?: string
  /** How the model's answer was read: json | tokens | prose. */
  answerVia?: string
  /** What it asked the catalogue for. */
  searchQuery?: string
  outfitQueries?: string[]
  /** Which occasion the tables read, and what that implied. */
  occasion?: string
  slots?: string[]
  /** The taste layer's own account of itself. */
  judge?: string
  judgeDetail?: string
  /** Why the model chain gave up, when it did. */
  modelTrace?: string
  /** Why an outfit produced nothing, when it did. */
  outfitTrace?: string[]
  /** Whether a photograph was compared against the candidates, and the answer. */
  sameGarment?: { matched: boolean; confidence: number; why?: string }
  /** What was actually shown, in the order it was shown. */
  shown?: TracedProduct[]
  /** Whether the shopper got the degraded catalogue answer. */
  degraded?: boolean
  steps: TraceStep[]
  ms?: number
}

const CAP = {
  string: 300,
  question: 500,
  steps: 40,
  products: 24,
  queries: 8,
  title: 120,
}

const cap = (s: unknown, n = CAP.string): string =>
  String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)

/**
 * A trace id a person can read out loud.
 *
 * Not a UUID: this number's job is to be copied from a screen into a support
 * conversation or an admin box. Time-ordered so traces sort naturally, and
 * short enough to say.
 */
export function newTraceId(now = Date.now(), rand = Math.random): string {
  const t = now.toString(36)
  const r = Math.floor(rand() * 36 ** 4).toString(36).padStart(4, '0')
  return `r-${t}-${r}`
}

/** Start recording. Cheap enough to do unconditionally. */
export function startTrace(input: {
  question: string
  gender?: string | null
  country?: string | null
  currency?: string | null
  now?: number
}): Trace {
  const startedAt = input.now ?? Date.now()
  return {
    id: newTraceId(startedAt),
    startedAt,
    question: cap(input.question, CAP.question),
    gender: input.gender ? cap(input.gender, 20) : undefined,
    country: input.country ? cap(input.country, 8) : undefined,
    currency: input.currency ? cap(input.currency, 8) : undefined,
    steps: [],
  }
}

/** Record a step. Silently ignored past the cap — a trace that grows without
 *  limit is a memory leak wearing a diagnostic's clothes. */
export function step(t: Trace | null, name: string, detail?: string): void {
  if (!t || t.steps.length >= CAP.steps) return
  t.steps.push({ at: Date.now() - t.startedAt, step: cap(name, 60), detail: detail ? cap(detail) : undefined })
}

/** Merge in what is known. Every field is optional and unknown keys are
 *  ignored, so a caller can hand over whatever it happens to have. */
export function note(t: Trace | null, fields: Partial<Trace>): void {
  if (!t) return
  if (fields.route) t.route = cap(fields.route, 20)
  if (fields.answerVia) t.answerVia = cap(fields.answerVia, 20)
  if (fields.searchQuery) t.searchQuery = cap(fields.searchQuery, 200)
  if (fields.outfitQueries) t.outfitQueries = fields.outfitQueries.slice(0, CAP.queries).map(q => cap(q, 200))
  if (fields.occasion) t.occasion = cap(fields.occasion, 40)
  if (fields.slots) t.slots = fields.slots.slice(0, CAP.queries).map(x => cap(x, 30))
  if (fields.judge) t.judge = cap(fields.judge, 20)
  if (fields.judgeDetail) t.judgeDetail = cap(fields.judgeDetail, 60)
  if (fields.modelTrace) t.modelTrace = cap(fields.modelTrace)
  if (fields.outfitTrace) t.outfitTrace = fields.outfitTrace.slice(0, CAP.queries).map(x => cap(x))
  if (fields.sameGarment) t.sameGarment = fields.sameGarment
  if (fields.degraded !== undefined) t.degraded = fields.degraded
}

/**
 * What the shopper was actually shown, in order.
 *
 * Id, title and brand only. A trace is not a place to keep a second copy of
 * the catalogue — and the price, the variants and the images are all
 * recoverable from the id, which is the point of having one.
 */
export function shown(t: Trace | null, products: unknown[]): void {
  if (!t || !Array.isArray(products)) return
  t.shown = products.slice(0, CAP.products).map((p) => {
    const o = p as { id?: unknown; title?: unknown; vendor?: unknown }
    return {
      id: cap(o?.id, 80),
      title: cap(o?.title, CAP.title),
      vendor: o?.vendor ? cap(o.vendor, 60) : undefined,
    }
  })
}

/** Seal it. */
export function finishTrace(t: Trace | null): Trace | null {
  if (!t) return null
  t.ms = Date.now() - t.startedAt
  return t
}
