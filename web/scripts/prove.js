#!/usr/bin/env node
/**
 * The scorecard.
 *
 * e2e.js proves the app WORKS — that every screen and every path holds
 * together. It says nothing about whether the answers are any good, and "it
 * feels worse" against "I fixed it" is not an argument anyone can win. This is
 * the other half: a fixed set of questions, run against a real deployment,
 * scored on things that are FACTS rather than taste.
 *
 *   node scripts/prove.js                          against localhost
 *   BASE=https://discern.enuid.com node scripts/prove.js
 *   node scripts/prove.js --json > run.json        to keep and compare
 *
 * WHAT THIS CAN PROVE. That a request for a shirt returns shirts. That a man
 * is not shown womenswear. That "white" means white. That a budget is
 * respected, that every piece can actually be bought, that two garments come
 * back as two sections, that nothing is shown twice, and how long all of it
 * takes. Those are checkable without an opinion, and they are most of what
 * "the retrieval works" means.
 *
 * WHAT IT CANNOT. Whether the shirt it chose is the RIGHT shirt. Taste needs a
 * human, and the honest way to measure it is a blind comparison against a
 * baseline — see the note at the end of the run.
 *
 * THE GRADER IS DELIBERATELY DUMB AND SEPARATE. It does not import the app's
 * own matchers. Grading a search with the same code that performed it is
 * marking your own homework: a bug in the matcher would pass itself. Plain
 * word checks written here can be read and disagreed with, which is the point.
 */

const BASE = process.env.BASE || 'http://localhost:3000'
const AS_JSON = process.argv.includes('--json')
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7)

// ── The questions ───────────────────────────────────────────────────────────
// Real shapes of ask, not a wordlist: one garment, two garments, an occasion
// with no garment named, a typo, a full sentence, a budget, a named brand, and
// something the catalogue genuinely should not have.
const CASES = [
  { id: 'plain-garment', q: 'white shirt', gender: 'men',
    want: { garment: ['shirt'], colour: ['white', 'ivory', 'off-white', 'ecru', 'cream'], notWomens: true } },
  { id: 'colour-holds', q: 'black trousers', gender: 'men',
    want: { garment: ['trouser', 'pant', 'chino'], colour: ['black', 'charcoal', 'jet'], notWomens: true } },
  { id: 'womenswear', q: 'white shirt', gender: 'women',
    want: { garment: ['shirt', 'blouse'], colour: ['white', 'ivory', 'off-white', 'ecru', 'cream'], notMens: true } },
  { id: 'footwear', q: 'sneakers', gender: 'men',
    want: { garment: ['sneaker', 'trainer', 'low top', 'lows', 'runner', 'court', 'shoe'] } },
  { id: 'two-garments', q: 'shirts and trousers', gender: 'men',
    want: { sections: 2 } },
  { id: 'sneaker-is-a-shoe', q: 'shoes sneakers', gender: 'men',
    want: { sections: 1 } },
  { id: 'occasion-outfit', q: 'what do i wear to an interview', gender: 'men',
    want: { sectionsAtLeast: 3 } },
  { id: 'everyday-outfit', q: 'outfits i can wear casually every day', gender: 'men',
    want: { sectionsAtLeast: 3 } },
  { id: 'typo', q: 'i need shirts and trosuers for work', gender: 'men',
    want: { sections: 2 } },
  { id: 'sentence', q: 'i am going to a summer wedding and need something to wear', gender: 'men',
    want: { sectionsAtLeast: 2 } },
  { id: 'budget', q: 'shirt under 3000', gender: 'men', currency: 'INR',
    want: { garment: ['shirt'], maxPrice: 3000 } },
  { id: 'named-brand', q: 'comet sneakers', gender: 'men',
    want: { vendor: ['comet'] } },
  { id: 'material', q: 'linen shirt', gender: 'men',
    want: { garment: ['shirt'], material: ['linen'] } },
  // The question with no occasion in it at all. It used to resolve to nothing
  // deterministic, so the slot choice fell to the model, which answered "how do
  // I dress better" with a shirt, shorts and sandals — a beach outfit. The
  // house look answers it now, and these are the checks that say so.
  { id: 'open-style', q: 'i need to up my fashion sense give me some outfits', gender: 'men',
    want: { sectionsAtLeast: 2, notGarment: ['sandal', 'slider', 'flip flop', 'swim'] } },
  { id: 'no-womenswear', q: 'men shorts', gender: 'men',
    want: { garment: ['short'], notWomens: true } },
  { id: 'nonsense', q: 'hand knitted balaclava in vicuna', gender: 'men',
    want: { mayBeEmpty: true } },
]

// ── The grader ──────────────────────────────────────────────────────────────
const textOf = p => `${p?.title || ''} ${(p?.tags || []).join(' ')} ${p?.description || ''}`.toLowerCase()
const has = (text, words) => words.some(w => text.includes(w.toLowerCase()))

/** Words that only ever appear on womenswear, and vice versa. Kept narrow on
 *  purpose — "women's shirt" is decisive, "slim" is not. */
const WOMENS = ["women's", 'womens', ' women ', 'ladies', 'blouse', 'dress ', 'skirt', 'bralette']
const MENS = ["men's", ' mens ', ' men ', 'menswear']

function gradeProducts(products, want) {
  const rows = []
  for (const p of products) {
    const t = ' ' + textOf(p) + ' '
    const checks = {}
    if (want.garment) checks.garment = has(t, want.garment)
    // Some answers are wrong by what they CONTAIN rather than what they miss —
    // sandals in an answer about dressing better.
    if (want.notGarment) checks.notGarment = !has(t, want.notGarment)
    if (want.colour) checks.colour = has(t, want.colour)
    if (want.material) checks.material = has(t, want.material)
    if (want.vendor) checks.vendor = has(String(p?.vendor || '').toLowerCase(), want.vendor)
    if (want.notWomens) checks.gender = !has(t, WOMENS)
    if (want.notMens) checks.gender = !has(t, MENS)
    if (typeof want.maxPrice === 'number') {
      checks.budget = typeof p?.price !== 'number' || p.price <= want.maxPrice
    }
    // True of every product, every time: it has to be lookable-at and buyable.
    checks.shoppable = Boolean(
      (p?.media?.[0]?.url || p?.image_url) && p?.store_url && typeof p?.price === 'number',
    )
    rows.push(checks)
  }
  return rows
}

const pct = (n, d) => (d === 0 ? null : Math.round((n / d) * 100))

async function ask(body, ms = 90000) {
  const c = new AbortController()
  const timer = setTimeout(() => c.abort(), ms)
  const started = Date.now()
  try {
    const r = await fetch(`${BASE}/api/catalog/search`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: c.signal,
    })
    const text = await r.text()
    let data = null
    try { data = JSON.parse(text) } catch { /* reported as unparsed below */ }
    return { ms: Date.now() - started, ok: r.ok, data }
  } catch (e) {
    return { ms: Date.now() - started, ok: false, data: null, error: String(e.message || e) }
  } finally { clearTimeout(timer) }
}

;(async () => {
  const cases = ONLY ? CASES.filter(c => c.id === ONLY) : CASES
  const results = []

  for (const c of cases) {
    const res = await ask({
      q: c.q, gender: c.gender, country: 'IN', currency: c.currency || 'INR',
    })
    const products = res.data?.products ?? []
    const groups = res.data?.groups ?? []
    const rows = gradeProducts(products, c.want)

    const tally = {}
    for (const key of ['garment', 'notGarment', 'colour', 'material', 'vendor', 'gender', 'budget', 'shoppable']) {
      const applicable = rows.filter(r => key in r)
      if (applicable.length) tally[key] = pct(applicable.filter(r => r[key]).length, applicable.length)
    }

    const ids = products.map(p => String(p?.id ?? ''))
    const unique = new Set(ids).size === ids.length

    // A case fails on a structural expectation outright; the per-product tallies
    // are reported as percentages rather than pass/fail, because "9 of 12 were
    // white" is a more useful sentence than "failed".
    const structural = []
    const sectionCount = groups.length || (products.length ? 1 : 0)
    if (c.want.sections != null) {
      structural.push({ what: `${c.want.sections} section${c.want.sections === 1 ? '' : 's'}`, got: sectionCount, ok: sectionCount === c.want.sections })
    }
    // An outfit that comes back as four sections instead of three is a better
    // answer, not a worse one. "At least" is what the fixture actually means:
    // a real look rather than one flat list of everything.
    if (c.want.sectionsAtLeast != null) {
      structural.push({ what: `${c.want.sectionsAtLeast}+ sections`, got: sectionCount, ok: sectionCount >= c.want.sectionsAtLeast })
    }
    // A dead connection is not an empty result. Reporting "0 pieces" for a
    // server that never answered reads as a quality failure and sent me
    // looking for a regression that was not there.
    if (res.error) structural.push({ what: 'reached the server', got: res.error.slice(0, 60), ok: false })
    else if (!c.want.mayBeEmpty) structural.push({ what: 'returned something', got: products.length, ok: products.length > 0 })
    structural.push({ what: 'no duplicates', got: ids.length - new Set(ids).size, ok: unique })

    results.push({
      id: c.id, q: c.q, gender: c.gender, ms: res.ms,
      n: products.length,
      groups: groups.map(g => `${g.label}(${g.products?.length ?? 0})`),
      tally, structural,
      judge: res.data?.judge ?? 'unknown',
      vendors: Array.from(new Set(products.map(p => p?.vendor).filter(Boolean))).slice(0, 6),
      error: res.error,
    })

    if (!AS_JSON) {
      const bar = Object.entries(tally).map(([k, v]) => `${k} ${v}%`).join('  ')
      const bad = structural.filter(s => !s.ok)
      console.log(
        `${bad.length ? 'FAIL' : 'ok  '}  ${c.id.padEnd(18)} ${String(res.ms).padStart(6)}ms  ` +
        `${String(products.length).padStart(2)} pieces  ${bar}`,
      )
      if (results.at(-1).groups.length) console.log(`        ${results.at(-1).groups.join(' ')}`)
      for (const s of bad) console.log(`        MISSED ${s.what} — got ${s.got}`)
    }
  }

  // ── The scorecard ─────────────────────────────────────────────────────────
  const times = results.map(r => r.ms).sort((a, b) => a - b)
  const at = q => times[Math.min(times.length - 1, Math.floor(times.length * q))]
  const answered = results.filter(r => r.n > 0).length
  const structuralPass = results.filter(r => r.structural.every(s => s.ok)).length
  const avg = key => {
    const vals = results.map(r => r.tally[key]).filter(v => typeof v === 'number')
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null
  }

  const scorecard = {
    base: BASE,
    cases: results.length,
    answered: `${answered}/${results.length}`,
    structurallyCorrect: `${structuralPass}/${results.length}`,
    garmentCorrect: avg('garment'),
    colourCorrect: avg('colour'),
    genderCorrect: avg('gender'),
    materialCorrect: avg('material'),
    budgetRespected: avg('budget'),
    shoppable: avg('shoppable'),
    nothingWrong: avg('notGarment'),
    // The one number that separates "bad taste" from "the taste layer never
    // ran". Anything other than judged or cached means that page was keyword
    // order with filters on it.
    judged: `${results.filter(r => r.judge === 'judged' || r.judge === 'cached').length}/${results.length}`,
    judgeOutcomes: results.reduce((acc, r) => { acc[r.judge] = (acc[r.judge] ?? 0) + 1; return acc }, {}),
    latency: { p50: at(0.5), p90: at(0.9), max: times.at(-1) },
  }

  if (AS_JSON) {
    console.log(JSON.stringify({ scorecard, results }, null, 2))
    return
  }

  console.log('\n' + '─'.repeat(66))
  console.log(`SCORECARD  ${BASE}`)
  console.log('─'.repeat(66))
  console.log(`  answered                ${scorecard.answered}`)
  console.log(`  structurally correct    ${scorecard.structurallyCorrect}`)
  for (const [k, label] of [
    ['garmentCorrect', 'right garment'], ['colourCorrect', 'right colour'],
    ['genderCorrect', 'right gender'], ['materialCorrect', 'right material'],
    ['budgetRespected', 'inside budget'], ['shoppable', 'buyable'],
    ['nothingWrong', 'nothing out of place'],
  ]) {
    if (scorecard[k] != null) console.log(`  ${label.padEnd(23)} ${scorecard[k]}%`)
  }
  console.log(`  judge ran on            ${scorecard.judged}   ${JSON.stringify(scorecard.judgeOutcomes)}`)
  console.log(`  latency                 p50 ${scorecard.latency.p50}ms · p90 ${scorecard.latency.p90}ms · max ${scorecard.latency.max}ms`)
  console.log('─'.repeat(66))
  console.log('These are facts about the answers, not judgements of them. Whether')
  console.log('the shirt it chose is the RIGHT shirt needs a person: run the same')
  console.log('queries against a keyword baseline and have someone pick blind.')

  const failed = results.filter(r => r.structural.some(s => !s.ok)).length
  process.exit(Math.min(failed, 250))
})().catch(e => { console.error('SCORECARD FAILED', e); process.exit(255) })
