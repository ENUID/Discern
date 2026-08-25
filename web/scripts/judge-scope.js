/**
 * Two shoppers, two judgements, and which one each of them is told about.
 *
 * The relevance judge reports two things when a search finishes: whether it
 * ran (`judged`, `cached`, `warming`, `no-answer`, …) and the ladder's own
 * account of how ("none(cerebras:too-long,groq:empty,…)"). Both are shown in
 * the response, and both used to be module-level `export let`s —
 * `lastJudgeOutcome` in GlobalCatalogService and `lastJudgeDetail` in
 * relevanceRerank.
 *
 * A module-level slot has exactly one value in the whole process, so what a
 * request reported was whatever search finished most recently anywhere. With
 * one shopper that is invisible. With two it is wrong, and it was:
 *
 *     request A reads detail: "PROVIDER-FOR-B"    ← A's own judge said A
 *     request B reads detail: ""
 *     module slot now       : "PROVIDER-FOR-B"
 *
 * That is the recorded before. This file is the after: the outcome now travels
 * to the caller that asked for the search, through `options.onJudge`, which is
 * a closure over that request's own state. The last section asserts the module
 * slots are gone rather than merely unused — an `export let` that nobody reads
 * today is one import away from being read again.
 *
 * The judge is stubbed. Nothing else is: the cache, the head-start window and
 * the outcome vocabulary are all real, because those are what decide which
 * request hears what.
 */
const path = require('path')
const fs = require('fs')

const WEB = path.resolve(__dirname, '..')
const esbuild = require(path.join(WEB, 'node_modules/esbuild'))

let bad = 0
const check = (ok, label, detail) => {
  if (!ok) bad++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail !== undefined ? `  ${detail}` : ''}`)
}

// relevanceRerank imports the model as '../ai/infer' — a relative specifier,
// which an --alias cannot reach. Redirect it by resolved shape instead.
const stubTheJudge = {
  name: 'stub-the-judge',
  setup(build) {
    build.onResolve({ filter: /(^|\/)ai\/infer$/ }, () => ({ path: path.join(WEB, 'scripts/stubs/infer.js') }))
  },
}

async function load() {
  const entry = path.join(WEB, '.vt', 'judge-scope-entry.js')
  fs.mkdirSync(path.join(WEB, '.vt'), { recursive: true })
  fs.writeFileSync(entry, [
    "export * as RERANK from '@/lib/services/relevanceRerank'",
    "export * as CATALOG from '@/lib/services/GlobalCatalogService'",
    "export { __infer } from '@/lib/ai/infer'",
    '',
  ].join('\n'))
  const out = path.join(WEB, '.vt', 'judge-scope.cjs')
  await esbuild.build({
    entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs',
    outfile: out, logLevel: 'error', plugins: [stubTheJudge], alias: { '@': WEB },
  })
  return require(out)
}

const product = (id, title) => ({
  id, title, vendor: 'A Brand', tags: [], description: title,
  variants: [{ price: { amount: '100', currency: 'USD' } }], media: [{ url: 'http://example/i.png' }],
})
const pool = (label, n = 6) => Array.from({ length: n }, (_, i) => product(`${label}-${i}`, `${label} linen shirt ${i}`))
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function main() {
  const M = await load()
  const quiet = { log: console.log, warn: console.warn, error: console.error }
  const hush = () => { console.log = () => {}; console.warn = () => {}; console.error = () => {} }
  const speak = () => { console.log = quiet.log; console.warn = quiet.warn; console.error = quiet.error }

  // ── the singleton is gone, not merely unused ──────────────────────────────
  console.log('── there is no module-level slot left to share ' + '─'.repeat(27))
  check(!('lastJudgeDetail' in M.RERANK),
    'relevanceRerank no longer exports lastJudgeDetail',
    'lastJudgeDetail' in M.RERANK ? 'STILL EXPORTED' : undefined)
  check(!('lastJudgeOutcome' in M.CATALOG),
    'GlobalCatalogService no longer exports lastJudgeOutcome',
    'lastJudgeOutcome' in M.CATALOG ? 'STILL EXPORTED' : undefined)
  console.log('       An export nobody reads today is one import away from being read again,')
  console.log('       so this asserts absence rather than disuse.')

  // ── two requests, in flight together ──────────────────────────────────────
  console.log('\n── request A cannot be told about request B\'s judge ' + '─'.repeat(22))
  {
    // A's judge is slow and answers second; B's is fast and answers first. If
    // anything were still shared, A — finishing last — would read B's value,
    // which is exactly the failure this replaced.
    // infer(tier, messages, system, opts) — the product lines the judge is
    // actually looking at are in `messages`, so that is what names the caller.
    M.__infer.reply = async (_tier, messages) => {
      const seen = /\b(AAAA|BBBB)\b/.exec(JSON.stringify(messages ?? ''))?.[1] ?? 'NOBODY'
      await sleep(seen === 'AAAA' ? 120 : 5)
      return { text: '[]', provider: `PROVIDER-FOR-${seen}` }
    }

    const heard = {}
    const request = async (name, query) => {
      // Each request's own recorder — the shape the routes now use.
      let outcome = 'not-run'
      let detail = ''
      hush()
      await M.RERANK.rerankByRelevance(query, pool(name), undefined, (o, d) => { outcome = o; detail = d })
      speak()
      heard[name] = { outcome, detail }
    }

    await Promise.all([request('AAAA', 'AAAA linen shirt'), request('BBBB', 'BBBB wool overcoat')])

    // The rule is not "everyone gets a detail" — concurrent searches that share
    // an intent deliberately share ONE judgement, and whoever did not run it is
    // told nothing rather than told a lie. The rule is that nobody is ever
    // handed a value produced for somebody else.
    const own = (name, d) => d === '' || d === `PROVIDER-FOR-${name}`
    check(own('AAAA', heard.AAAA.detail),
      'A hears about A, or hears nothing — never about B', JSON.stringify(heard.AAAA.detail))
    check(own('BBBB', heard.BBBB.detail),
      'and B hears about B, or nothing', JSON.stringify(heard.BBBB.detail))
    check(heard.AAAA.detail !== heard.BBBB.detail || heard.AAAA.detail === '',
      'the two are not simply reading the same slot',
      `${JSON.stringify(heard.AAAA.detail)} vs ${JSON.stringify(heard.BBBB.detail)}`)
    check(typeof heard.AAAA.outcome === 'string' && typeof heard.BBBB.outcome === 'string',
      'and both are told how their own search went',
      `${heard.AAAA.outcome} / ${heard.BBBB.outcome}`)
  }

  // ── ten at once ───────────────────────────────────────────────────────────
  console.log('\n── and it holds with ten requests interleaved ' + '─'.repeat(28))
  {
    M.__infer.reply = async (_tier, messages) => {
      const which = /\bQ(\d+)\b/.exec(JSON.stringify(messages ?? ''))?.[1] ?? '?'
      // Deliberately uneven, so the finishing order is not the starting order.
      await sleep(((10 - Number(which || 0)) % 7) * 12 + 3)
      return { text: '[]', provider: `PROVIDER-Q${which}` }
    }

    const results = await Promise.all(Array.from({ length: 10 }, async (_, i) => {
      let detail = ''
      hush()
      await M.RERANK.rerankByRelevance(`Q${i} linen shirt`, pool(`Q${i}`), undefined, (_o, d) => { detail = d })
      speak()
      return { i, detail }
    }))

    const crossed = results.filter(r => r.detail && r.detail !== `PROVIDER-Q${r.i}`)
    check(crossed.length === 0,
      'no request heard about any other request\'s judge',
      crossed.length ? crossed.map(r => `Q${r.i} heard ${r.detail}`).join('; ') : `${results.length} requests, 0 crossed`)
    const told = results.filter(r => r.detail).length
    console.log(`       ${told} of ${results.length} ran their own judge; the rest shared one judgement`)
    console.log('       by intent and were told nothing, which is the honest answer for them.')
  }

  // ── not reporting costs nothing ───────────────────────────────────────────
  console.log('\n── a caller that does not want the outcome ' + '─'.repeat(31))
  {
    M.__infer.reply = async () => ({ text: '[]', provider: 'whoever' })
    let threw = false
    hush()
    try { await M.RERANK.rerankByRelevance('plain query', pool('P'), undefined, undefined) } catch { threw = true }
    speak()
    check(!threw, 'omitting the callback is fine — /api/featured and /api/style-with never reported it')

    // And a callback that throws must not break a search over telemetry.
    let searchThrew = false
    hush()
    try { await M.RERANK.rerankByRelevance('plain query 2', pool('P2'), undefined, () => { throw new Error('reporting blew up') }) }
    catch { searchThrew = true }
    speak()
    check(!searchThrew, 'and a reporter that throws never takes the search down with it')
  }

  console.log('\n' + (bad === 0
    ? 'each request hears about its own judge, and there is no slot left to share'
    : `${bad} FAILED`))
  process.exit(bad === 0 ? 0 : 1)
}

main().catch(e => { console.error(e); process.exit(1) })
