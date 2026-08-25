/**
 * Five free tiers in a row, and the clock they share.
 *
 * `stylistChat` decides which model this app asks, in what order, for how long
 * each, and what it remembers when one refuses. Every one of those decisions is
 * load-bearing and none of them is visible from the outside: a wrong order
 * still returns an answer, a wrong timeout still returns an answer, a lost
 * cooldown still returns an answer. They just cost the shopper time or quality
 * or quota, quietly, forever.
 *
 * So this pins the decisions rather than the output:
 *
 *   THE FOUR ORDERINGS      light/heavy × fits/does-not-fit Cerebras' window
 *   THE WINDOW ITSELF       the exact prompt size where Cerebras is demoted
 *   THE BUDGET SPLIT        55% to the first rung, the rest divided, everything
 *                           left to a lone last rung
 *   WHAT IS REMEMBERED      a spent key, yes; a slow request, no
 *   WHAT IS REPORTED        the rung that actually answered
 *   WHAT IS NOT SHARED      two requests in flight never see each other
 *
 * Only the four provider modules are stubbed. The cooldown map, the token
 * estimate and the text cleaners are real, because those are the behaviour.
 *
 * Written BEFORE the ladder moved out of route.ts in Phase E step E6, and run
 * against the code on both sides of the move.
 */
const path = require('path')
const fs = require('fs')
const { execFileSync } = require('child_process')

const WEB = path.resolve(__dirname, '..')
const out = path.join(WEB, '.vt', 'ladder.cjs')
fs.mkdirSync(path.join(WEB, '.vt'), { recursive: true })
execFileSync(path.join(WEB, 'node_modules/.bin/esbuild'), [
  path.join(WEB, 'scripts/stubs/ladder-entry.js'),
  '--bundle', '--platform=node', '--format=cjs', '--outfile=' + out, '--log-level=error',
  '--alias:@/lib/gemini=' + path.join(WEB, 'scripts/stubs/gemini.js'),
  '--alias:@/lib/cerebras=' + path.join(WEB, 'scripts/stubs/cerebras.js'),
  '--alias:@/lib/nvidia=' + path.join(WEB, 'scripts/stubs/nvidia.js'),
  '--alias:@/lib/groq=' + path.join(WEB, 'scripts/stubs/groq-ladder.js'),
  '--alias:@=' + WEB,
])
const L = require(out)

let bad = 0
const check = (ok, label, detail) => {
  if (!ok) bad++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail !== undefined ? `  ${detail}` : ''}`)
}
const same = (got, want, label) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  check(ok, label, ok ? undefined : `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)
}

// The ladder's own logging is correct behaviour, not harness output — but it
// is also the only place the per-rung time cap is stated, so it is captured
// rather than dropped. LOG holds everything the module said during the last
// ladder() call.
const LOG = []
const quiet = { log: console.log, warn: console.warn, error: console.error }
const sink = (...a) => { LOG.push(a.map(String).join(' ')) }
const hush = () => { console.log = sink; console.warn = sink; console.error = sink }
const speak = () => { console.log = quiet.log; console.warn = quiet.warn; console.error = quiet.error }
/** Every per-rung time cap the ladder announced, in order. */
const capsFromLog = () => LOG.map(l => /exceeded (\d+)ms/.exec(l)).filter(Boolean).map(m => Number(m[1]))

const HI = [{ role: 'user', content: 'hi' }]
/** Long enough that prompt + 1200 max_tokens + 300 slack overruns Cerebras' 8K window. */
const HUGE = [{ role: 'user', content: 'x'.repeat(40_000) }]

/**
 * Run the ladder against a fake set of providers, recording the rungs it tried.
 * `behave(rungName)` decides what each rung does.
 */
async function ladder(opts = {}) {
  const tried = []
  L.__limits.providerOut().clear()
  for (const p of opts.out ?? []) L.markProviderOut(p)
  if (opts.gemini === false) delete process.env.GOOGLE_AI_API_KEY
  else process.env.GOOGLE_AI_API_KEY = 'stub-key'
  L.__nvidia.configure(opts.nvidia !== false)

  LOG.length = 0
  const behave = opts.behave ?? (async (n) => ({ role: 'assistant', content: `${n} replied` }))
  const record = (name) => async (...a) => { tried.push(name); return behave(name, ...a) }
  L.__gemini.reply = record('gemini')
  L.__cerebras.reply = record('cerebras')
  L.__nvidia.reply = record('nvidia')
  L.__groq.reply = async (m, s, t, o) => { tried.push(`groq(${o.model})`); return behave(`groq(${o.model})`, m, s, t, o) }

  hush()
  let reply = null, threw = null
  try {
    reply = await L.stylistChat(opts.messages ?? HI, opts.system ?? 'system prompt', opts.opts, opts.heavy ?? false)
  } catch (e) { threw = e }
  speak()
  return { tried, reply, threw, outNow: [...L.__limits.providerOut().keys()].sort() }
}

async function main() {
  process.env.STYLIST_ATTEMPT_MS = '40'
  process.env.STYLIST_LADDER_MS = '600'

  // ── the four orderings ────────────────────────────────────────────────────
  console.log('── which model gets asked first, and why ' + '─'.repeat(33))
  {
    const dead = async (n) => { throw new Error(`${n} is down`) }

    same((await ladder({ behave: dead })).tried,
      ['cerebras', 'groq(stub-8b)', 'groq(stub-70b)', 'gemini', 'nvidia'],
      'chitchat, prompt fits: cerebras leads, the fast 8b next, gemini late, nvidia last')

    same((await ladder({ heavy: true, behave: dead })).tried,
      ['cerebras', 'gemini', 'groq(stub-70b)', 'groq(stub-8b)', 'nvidia'],
      'depth: cerebras still leads, then gemini, and groq goes 70b before 8b')

    same((await ladder({ heavy: true, messages: HUGE, behave: dead })).tried,
      ['gemini', 'groq(stub-70b)', 'groq(stub-8b)', 'cerebras', 'nvidia'],
      'depth, prompt too big: CEREBRAS IS DEMOTED TO FOURTH rather than truncated')

    same((await ladder({ messages: HUGE, behave: dead })).tried,
      ['groq(stub-8b)', 'groq(stub-70b)', 'cerebras', 'gemini', 'nvidia'],
      'chitchat, prompt too big: groq leads and cerebras drops behind it')

    same((await ladder({ gemini: false, nvidia: false, behave: dead })).tried,
      ['cerebras', 'groq(stub-8b)', 'groq(stub-70b)'],
      'a provider with no key is not a rung at all')

    same((await ladder({ nvidia: false, behave: dead })).tried.slice(-1), ['gemini'],
      'and nvidia is a pure safety net — never reached unless it is configured')
  }

  // ── the window ────────────────────────────────────────────────────────────
  console.log('\n── the exact prompt size that demotes cerebras ' + '─'.repeat(27))
  {
    // 8192 window − 1200 default completion − 300 slack = 6692 prompt tokens,
    // and the estimate is chars/4, so the edge is 26,768 characters.
    const firstRungAt = async (chars) => (await ladder({
      heavy: true, system: '', messages: [{ role: 'user', content: 'x'.repeat(chars) }],
      behave: async (n) => { throw new Error(n) },
    })).tried[0]

    check(await firstRungAt(26_764) === 'cerebras', 'at 26,764 characters cerebras still leads')
    check(await firstRungAt(26_768) === 'gemini', 'at 26,768 it does not — a four-character difference', 'the window is real, not a rule of thumb')
    check(await firstRungAt(1_000) === 'cerebras', 'a fresh conversation fits easily')

    // The completion budget counts against the same window.
    const big = { heavy: true, system: '', messages: [{ role: 'user', content: 'x'.repeat(20_000) }], behave: async (n) => { throw new Error(n) } }
    check((await ladder({ ...big, opts: { max_tokens: 500 } })).tried[0] === 'cerebras',
      'asking for a short reply keeps cerebras in front')
    check((await ladder({ ...big, opts: { max_tokens: 3000 } })).tried[0] === 'gemini',
      'and asking for a long one demotes it — prompt AND completion share the window')
  }

  // ── success, failure, and what is reported ────────────────────────────────
  console.log('\n── which rung answered, and what it says it was ' + '─'.repeat(26))
  {
    const first = await ladder({})
    same(first.tried, ['cerebras'], 'a first-rung success ends the request outright')
    check(first.reply.provider === 'cerebras', 'and the reply names the rung that answered', first.reply.provider)
    check(first.reply.content === 'cerebras replied', 'carrying that rung\'s content', JSON.stringify(first.reply.content))
    check(first.reply.role === 'assistant', 'and its role')

    const second = await ladder({ behave: async (n) => { if (n === 'cerebras') throw new Error('boom'); return { role: 'assistant', content: `${n} replied` } } })
    same(second.tried, ['cerebras', 'groq(stub-8b)'], 'a first-rung failure falls to the next one and stops there')
    check(second.reply.provider === 'groq(stub-8b)',
      'and the reply names the SECOND rung — including which groq model', second.reply.provider)

    const empty = await ladder({ behave: async (n) => (n === 'cerebras' ? { role: 'assistant', content: '' } : { role: 'assistant', content: `${n} replied` }) })
    same(empty.tried, ['cerebras', 'groq(stub-8b)'], 'empty content counts as a failure, not as an answer')

    const lastOnly = await ladder({
      behave: async (n) => { if (n !== 'nvidia') throw new Error(`${n} down`); return { role: 'assistant', content: 'nvidia replied' } },
    })
    same(lastOnly.tried, ['cerebras', 'groq(stub-8b)', 'groq(stub-70b)', 'gemini', 'nvidia'],
      'the safety net is reached only after every other pool has failed')
    check(lastOnly.reply.provider === 'nvidia', 'and it answers', lastOnly.reply.provider)

    const lastFails = await ladder({ behave: async (n) => { throw new Error(`${n} down`) } })
    check(lastFails.reply === null && lastFails.threw instanceof Error,
      'when the last rung fails too, the ladder throws rather than returning empty')
    const trail = lastFails.threw.message
    check(trail.split(' | ').length === 5, 'the error carries every rung it tried', `${trail.split(' | ').length} entries`)
    check(/cerebras: cerebras down/.test(trail) && /nvidia: nvidia down/.test(trail),
      'each with its own reason, first to last — this is the whole diagnostic trail')
  }

  // ── a refusal is remembered; slowness is not ──────────────────────────────
  console.log('\n── what a failure costs the NEXT request ' + '─'.repeat(33))
  {
    const r = await ladder({ behave: async (n) => { if (n === 'cerebras') throw new Error('HTTP 429 rate limit exceeded'); return { role: 'assistant', content: `${n} replied` } } })
    same(r.tried, ['cerebras', 'groq(stub-8b)'],
      'A 429 DOES NOT END THE REQUEST — the ladder falls through and answers')
    check(r.tried.length === 2, 'two outbound calls, not one', `${r.tried.length} calls`)
    same(r.outNow, ['cerebras'], 'and the refusing provider is put on cooldown')

    for (const msg of ['HTTP 429', 'quota exceeded', 'insufficient credit', 'HTTP 401', 'unauthorized', 'invalid api key', 'billing required']) {
      const x = await ladder({ behave: async (n) => { if (n === 'cerebras') throw new Error(msg); return { role: 'assistant', content: 'ok' } } })
      check(x.outNow.includes('cerebras'), `"${msg}" is remembered`)
    }
    for (const msg of ['HTTP 500', 'fetch failed', 'socket hang up']) {
      const x = await ladder({ behave: async (n) => { if (n === 'cerebras') throw new Error(msg); return { role: 'assistant', content: 'ok' } } })
      check(!x.outNow.includes('cerebras'), `"${msg}" is NOT — a broken request can be a one-off`)
    }

    // A timeout is not an error and must not be remembered either.
    const slow = await ladder({
      behave: async (n) => {
        if (n === 'cerebras') { await new Promise(res => setTimeout(res, 5_000)); return { role: 'assistant', content: 'too late' } }
        return { role: 'assistant', content: `${n} replied` }
      },
    })
    same(slow.tried, ['cerebras', 'groq(stub-8b)'], 'a rung that hangs is abandoned and the next one runs')
    same(slow.outNow, [], 'and a SLOW provider is never put on cooldown — that really can be a one-off')
    check(/cerebras: timeout/.test(JSON.stringify(slow.reply) + (slow.threw?.message ?? '')) === false,
      'the shopper still gets an answer', slow.reply.provider)
  }

  // ── an already-cold provider ──────────────────────────────────────────────
  console.log('\n── a provider we already know is out ' + '─'.repeat(37))
  {
    const r = await ladder({ out: ['cerebras'], behave: async (n) => { throw new Error(n) } })
    same(r.tried, ['groq(stub-8b)', 'groq(stub-70b)', 'gemini', 'nvidia'],
      'it is skipped without spending a single millisecond on it')

    // THE MECHANISM BEHIND "only one provider was called". The cooldown key is
    // the BASE name, so one 429 from one groq model takes BOTH groq rungs off
    // the next request. Four rungs become two; with cerebras out as well, one.
    const r2 = await ladder({ out: ['groq'], behave: async (n) => { throw new Error(n) } })
    same(r2.tried, ['cerebras', 'gemini', 'nvidia'],
      'and one refusal from ONE groq model removes BOTH groq rungs — the key is the base name')

    const r3 = await ladder({ out: ['cerebras', 'groq', 'gemini'] })
    same(r3.tried, ['nvidia'], 'three pools out leaves exactly ONE outbound call for the whole request')

    const all = await ladder({ out: ['cerebras', 'groq', 'gemini', 'nvidia'], behave: async (n) => { throw new Error(n) } })
    same(all.tried, ['cerebras', 'groq(stub-8b)', 'groq(stub-70b)', 'gemini', 'nvidia'],
      'but when EVERY pool is out it tries them all anyway rather than failing without asking')
  }

  // ── the breaker is not in here ────────────────────────────────────────────
  console.log('\n── the breaker, and where it actually lives ' + '─'.repeat(30))
  {
    L.noteModelFailure(); L.noteModelFailure(); L.noteModelFailure()
    check(L.modelLooksDown() === true, 'three consecutive failures open the breaker')

    const r = await ladder({})
    same(r.tried, ['cerebras'],
      'and stylistChat RUNS ANYWAY — the breaker is not a check inside the ladder')
    check(r.reply.provider === 'cerebras', 'it answers normally with the breaker wide open', r.reply.provider)
    console.log('       The breaker gates the ROUTE\'s heavy path (`if (heavy && modelLooksDown())`),')
    console.log('       which serves the catalogue directly instead of calling this at all.')
    console.log('       Recorded because "the breaker protects the ladder" is the obvious wrong guess.')
    L.noteModelSuccess()
    check(L.modelLooksDown() === false, 'and a success closes it again')
  }

  // ── reasoning_effort ──────────────────────────────────────────────────────
  console.log('\n── how hard cerebras is asked to think ' + '─'.repeat(35))
  {
    await ladder({})
    same(L.__cerebras.lastOpts, { reasoning_effort: 'low' }, 'chitchat asks for low effort')
    await ladder({ heavy: true, opts: { max_tokens: 900, temperature: 0.4 } })
    same(L.__cerebras.lastOpts, { max_tokens: 900, temperature: 0.4, reasoning_effort: 'medium' },
      "depth asks for MEDIUM, never high — 'high' overran the 8K window and returned raw reasoning as the answer")
  }

  // ── the budget ────────────────────────────────────────────────────────────
  console.log('\n── the clock, and who gets most of it ' + '─'.repeat(36))
  {
    process.env.STYLIST_ATTEMPT_MS = '10'
    process.env.STYLIST_LADDER_MS = '1000'
    const started = Date.now()
    const r = await ladder({ behave: async () => { await new Promise(res => setTimeout(res, 9_000)) } })
    const caps = capsFromLog()
    const took = Date.now() - started

    // The caps are derived from the clock, so the tail rungs land a millisecond
    // either side of 112 run to run. The arithmetic is what is pinned, not the
    // jitter: 55% of 1,000 to the first, the remaining 450 split four ways.
    check(caps.length === 5, 'every rung got a turn inside one budget', `${caps.length} rungs`)
    check(caps[0] >= 545 && caps[0] <= 550,
      'the FIRST rung takes 55% of the budget — floor(1000 × 0.55)', `${caps[0]}ms`)
    check(caps.slice(1, 4).every(c => c >= 105 && c <= 120),
      'the middle rungs divide what is left, evenly — floor(450 / rungs remaining)',
      caps.slice(1, 4).join(', ') + 'ms')
    check(caps[4] >= 105 && caps[4] <= 130, 'and the last takes the remainder', `${caps[4]}ms`)
    check(caps[0] > caps[1] * 4, 'the primary is not starved to keep four fallbacks in reserve',
      `${caps[0]}ms vs ${caps[1]}ms`)
    check(Math.abs(caps.reduce((a, b) => a + b, 0) - 1000) < 40,
      'and the five together are the budget, not a multiple of it',
      `${caps.reduce((a, b) => a + b, 0)}ms of 1000`)
    check(took >= 990 && took < 1_300, 'and the whole ladder lands on its budget', `${took}ms`)
    check(r.threw instanceof Error && /timeout/.test(r.threw.message), 'every rung times out and the ladder gives up')

    // A lone rung gets everything that is left rather than the 11s floor.
    await ladder({ out: ['cerebras', 'groq', 'gemini'], behave: async () => { await new Promise(res => setTimeout(res, 9_000)) } })
    const soloCaps = capsFromLog()
    check(soloCaps.length === 1 && soloCaps[0] > 900,
      'a lone provider gets the WHOLE remaining budget — nothing is held back for a fallback that does not exist',
      `${soloCaps[0]}ms`)

    // ATTEMPT_MS is a floor, not a cap.
    process.env.STYLIST_ATTEMPT_MS = '5000'
    process.env.STYLIST_LADDER_MS = '10'
    const t2 = Date.now()
    await ladder({ out: ['cerebras', 'groq', 'gemini'], behave: async () => { await new Promise(res => setTimeout(res, 9_000)) } })
    const floorCaps = capsFromLog()
    check(floorCaps[0] === 5000 && Date.now() - t2 >= 4_900,
      'and STYLIST_ATTEMPT_MS is a FLOOR: an exhausted budget still allows one full attempt',
      `${floorCaps[0]}ms`)

    process.env.STYLIST_ATTEMPT_MS = '40'
    process.env.STYLIST_LADDER_MS = '600'
  }

  // ── leaked reasoning ──────────────────────────────────────────────────────
  console.log('\n── a rung that narrates its thinking is discarded ' + '─'.repeat(24))
  {
    const leak = 'The user wants a linen shirt for a beach wedding in June. '
      + 'We need to check the season and the hemisphere first, because a June wedding '
      + 'is winter in Sydney and high summer in London and the answer is not the same. '
      + 'Let us think about what fabric weight suits humid heat, then pick a colour. '
      + 'The rules say to lead with a verdict and never use an em dash anywhere. '
      + 'Should we also suggest a second option, or commit to one? Commit to one. '
      + 'Final answer: a white linen camp collar shirt with stone linen trousers.'
    check(leak.length >= 350, 'the sample is long enough to be judged at all', `${leak.length} chars`)

    const r = await ladder({ behave: async (n) => ({ role: 'assistant', content: n === 'cerebras' ? leak : `${n} replied` }) })
    same(r.tried, ['cerebras', 'groq(stub-8b)'],
      'narrated chain-of-thought is thrown away and the next rung is asked instead')
    check(r.reply.provider === 'groq(stub-8b)', 'so the shopper never sees it', r.reply.provider)

    const tagged = await ladder({ behave: async (n) => ({ role: 'assistant', content: n === 'cerebras' ? '<think>secret</think>A white linen shirt.' : 'x' }) })
    same(tagged.tried, ['cerebras'], 'a <think> block is stripped rather than discarded — the answer after it is real')
    check(tagged.reply.content === 'A white linen shirt.', 'and only the answer survives', JSON.stringify(tagged.reply.content))

    const dashes = await ladder({ behave: async () => ({ role: 'assistant', content: 'A linen shirt — light and breathable.' }) })
    check(!dashes.reply.content.includes('—'), 'em dashes are removed on every rung, whatever the prompt said',
      JSON.stringify(dashes.reply.content))
  }

  // ── two shoppers at once ──────────────────────────────────────────────────
  console.log('\n── two requests in flight never see each other ' + '─'.repeat(27))
  {
    L.__limits.providerOut().clear()
    process.env.GOOGLE_AI_API_KEY = 'stub-key'
    L.__nvidia.configure(true)

    // A is slow and answered by cerebras; B is fast, and its cerebras rung
    // refuses so it falls to groq. If anything in the ladder were request-
    // shared, B's fall-through or B's error trail would reach A.
    L.__cerebras.reply = async (m) => {
      const who = m[0].content
      if (who === 'B') throw new Error('HTTP 429 rate limit exceeded')
      await new Promise(res => setTimeout(res, 80))
      return { role: 'assistant', content: 'answer for A' }
    }
    L.__groq.reply = async (m) => ({ role: 'assistant', content: `groq answer for ${m[0].content}` })
    L.__gemini.reply = async () => ({ role: 'assistant', content: 'gemini' })
    L.__nvidia.reply = async () => ({ role: 'assistant', content: 'nvidia' })

    hush()
    const [a, b] = await Promise.all([
      L.stylistChat([{ role: 'user', content: 'A' }], 'system prompt', undefined, false),
      L.stylistChat([{ role: 'user', content: 'B' }], 'system prompt', undefined, false),
    ])
    speak()

    check(a.content === 'answer for A', "the slow request keeps its own answer", JSON.stringify(a.content))
    check(b.content === 'groq answer for B', "and the fast one keeps its own", JSON.stringify(b.content))
    check(a.provider === 'cerebras' && b.provider === 'groq(stub-8b)',
      'each reports the rung that answered IT, not the other', `${a.provider} / ${b.provider}`)

    // Everything the ladder mutates per request — the error trail, the attempt
    // list, the chain, the start time — is declared inside the function. The
    // ONLY thing they share is the cooldown map, and that is deliberate.
    check(L.__limits.providerOut().has('cerebras'),
      "B's 429 reached the shared cooldown, which is the ONE thing the two requests have in common")
    check(a.content === 'answer for A',
      "and it did not reach A, already in flight past its own filter — a cooldown set mid-request never rewrites a chain already chosen")
  }

  console.log('\n' + (bad === 0
    ? 'the ladder asks the same providers in the same order, for the same time, and remembers the same refusals'
    : `${bad} FAILED`))
  process.exit(bad === 0 ? 0 : 1)
}

main().catch(e => { speak(); console.error(e); process.exit(1) })
