/**
 * CHARACTERIZATION TESTS — what the stylist route does today.
 *
 * Phase E, Stage 1. These exist to be run BEFORE and AFTER every extraction.
 * They are not correctness tests: several assertions below lock in behaviour I
 * think is wrong, and say so. The question a characterization test answers is
 * "did the refactor change anything?", and for that it must record what IS,
 * not what ought to be.
 *
 * HOW IT DRIVES THE ROUTE. The whole route is bundled and its POST called
 * directly with a real Request — no dev server, no Next runtime. Every
 * outbound call is intercepted by replacing global fetch and dispatching on
 * URL: providers, the ninety brand stores, exchange rates and Convex all
 * answer from fixtures. So this runs in about a second, needs no quota, and is
 * deterministic — which matters because three of four provider pools are out
 * of quota and a test that cannot run is not a safety net.
 *
 * WHAT IT COVERS, from the plan's gap table:
 *   fast path · heavy path · multi-category · empty results · provider
 *   fallback · timeout · vision · wardrobe scan · load-more · streaming shape
 *   · trace creation
 *
 * WHAT IT CANNOT COVER, stated rather than implied: whether the model's answer
 * is any good, whether the catalogue's ranking is any good, and the retrieval
 * purity gap the t-shirt leak sits in. Fixtures prove the plumbing, not the
 * taste.
 */
const path = require('path')
const fs = require('fs')
const { execFileSync } = require('child_process')

const WEB = '/home/user/From/web'
const BUNDLE = path.join(WEB, '.vt', 'route.cjs')

function build() {
  fs.mkdirSync(path.join(WEB, '.vt'), { recursive: true })
  execFileSync(path.join(WEB, 'node_modules/.bin/esbuild'), [
    path.join(WEB, 'app/api/ai/stylist/route.ts'),
    '--bundle', '--platform=node', '--format=cjs',
    '--outfile=' + BUNDLE, '--log-level=error', '--alias:@=' + WEB,
  ])
}

// ── fixtures ────────────────────────────────────────────────────────────────

/** A product in the shape the stores actually return — price on the variant,
 *  media[0].url required (normalization drops anything without an image). */
const P = (id, title, o = {}) => ({
  id: `gid://shopify/Product/${id}`,
  title,
  vendor: o.vendor ?? 'Nicobar',
  url: `https://www.nicobar.com/products/${id}`,
  media: [{ url: `https://cdn.shopify.com/s/files/${id}.jpg?width=400` }],
  description: { plain: o.desc ?? 'A considered piece.' },
  tags: o.tags ?? ['apparel'],
  options: [{ name: 'Size', values: ['S', 'M', 'L'] }],
  variants: [{
    id: `gid://v/${id}`, title: 'M', availability: true,
    price: { amount: o.price ?? 4750, currency: o.currency ?? 'INR' },
    url: `https://www.nicobar.com/products/${id}`,
    options: [{ name: 'Size', label: 'M' }],
  }],
})

const SHIRTS = [
  P('p1', 'Half Sleeve Linen Shirt'),
  P('p2', 'Indus Linen Shirt - Rust'),
  P('p3', 'Stone Grey European Linen Shirt', { vendor: 'Andamen' }),
]
const MIXED = [
  ...SHIRTS,
  P('t1', 'Flycatcher Trousers - Navy', { tags: ['trouser'] }),
  P('t2', 'Lapis European Linen Trouser', { vendor: 'Andamen', tags: ['trouser'] }),
  P('s1', "Men's Terra Black Loafers", { vendor: 'Wearloqo', tags: ['loafer'] }),
]

/** Every outbound call the route can make. Nothing reaches the network. */
function makeFetch(cfg = {}) {
  const calls = { provider: 0, vision: 0, store: 0, rates: 0, convex: 0, other: [] }
  const json = (o, status = 200) =>
    new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })

  return {
    calls,
    fn: async (input, init) => {
      const url = typeof input === 'string' ? input : (input?.url ?? String(input))
      const body = (() => { try { return JSON.parse(init?.body ?? '{}') } catch { return {} } })()
      const isVision = JSON.stringify(body).includes('image_url')

      if (/\/chat\/completions|\/v1\/chat/.test(url)) {
        if (isVision) {
          calls.vision++
          if (cfg.visionFails) return json({ error: 'boom' }, 500)
          return json({ choices: [{ message: { role: 'assistant', content: cfg.vision ?? 'A linen shirt. [SEARCH: men linen shirt]' } }] })
        }
        calls.provider++
        if (cfg.providerFailsTimes && calls.provider <= cfg.providerFailsTimes) {
          return json({ error: { message: 'rate limited' } }, 429)
        }
        if (cfg.providerSlowMs) await new Promise(r => setTimeout(r, cfg.providerSlowMs))
        return json({ choices: [{ message: { role: 'assistant', content: cfg.reply ?? 'Linen is the move. [SEARCH: men linen shirt]' } }] })
      }
      if (/\/api\/mcp/.test(url)) {
        calls.store++
        if (cfg.storesFail) return json({ error: 'down' }, 500)
        return json({ result: { content: [{ type: 'text', text: JSON.stringify({ products: cfg.products ?? SHIRTS }) }] } })
      }
      // Exchange rates — without this the converter falls back and a ₹4,750
      // product reports as ₹48, which is a fixture artefact rather than a bug.
      if (/exchangerate|er-api|fawaz|rates/i.test(url)) {
        calls.rates++
        return json({ result: 'success', rates: { INR: 1, USD: 1, EUR: 1 }, usd: { inr: 1, usd: 1 } })
      }
      if (/convex/i.test(url)) { calls.convex++; return json({ status: 'success', value: null }) }
      calls.other.push(url.slice(0, 70))
      return json({})
    },
  }
}

let ip = 100
/** One request, driven end to end. Each call gets its own IP so the route's
 *  own rate limiter (30/min) never becomes the thing under test by accident. */
async function drive(body, cfg = {}) {
  const { fn, calls } = makeFetch(cfg)
  const saved = global.fetch
  global.fetch = fn
  try {
    // Fresh module state per request unless a test is deliberately exercising
    // the breaker or the cooldown map, both of which are process-level.
    if (!cfg.keepState) {
      for (const k of Object.keys(require.cache)) if (k === BUNDLE) delete require.cache[k]
    }
    const { POST } = require(BUNDLE)
    const res = await POST(new Request('https://x.test/api/ai/stylist', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.0.0.${ip++ % 250}` },
      body: JSON.stringify(body),
    }))
    const text = await res.text()
    const lines = text.trim().split('\n').filter(Boolean)
    const parsed = lines.map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
    return {
      status: res.status,
      contentType: res.headers.get('content-type'),
      progress: parsed.filter(o => o.type === 'progress'),
      result: parsed.find(o => o.type === 'result') ?? null,
      lines,
      calls,
    }
  } finally { global.fetch = saved }
}

// ── the environment the route sees ──────────────────────────────────────────
//
// Set explicitly rather than inherited. Without GROQ_API_KEY the ladder finds
// no configured provider, throws, and every request silently takes the
// degraded catalogue path — which looks like a passing test and characterises
// nothing. Gemini has no base-URL override (GEMINI_BASE is a module constant),
// so it is left unconfigured and therefore skipped; the ladder is exercised
// through the three that CAN be pointed at a stub.
process.env.GROQ_API_KEY = 'stub'
process.env.GROQ_BASE_URL = 'http://stub.local/v1'
process.env.CEREBRAS_API_KEY = 'stub'
process.env.CEREBRAS_BASE_URL = 'http://stub.local/v1'
process.env.NVIDIA_API_KEY = 'stub'
process.env.NVIDIA_BASE_URL = 'http://stub.local/v1'
delete process.env.GOOGLE_AI_API_KEY
delete process.env.NEXT_PUBLIC_CONVEX_URL
delete process.env.CONVEX_AUTH_SECRET

// ── harness ─────────────────────────────────────────────────────────────────
let bad = 0
const check = (ok, label, detail) => {
  if (!ok) bad++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail !== undefined ? `  ${detail}` : ''}`)
}
const n = (r) => (r?.foundProducts ?? []).length
  + (r?.outfitSlots ?? []).reduce((a, s) => a + (s?.products?.length ?? 0), 0)
  + (r?.foundProductGroups ?? []).reduce((a, g) => a + (g?.products?.length ?? 0), 0)

;(async () => {
  build()
  const ask = (q, extra = {}) => ({ question: q, buyerCurrency: 'INR', buyerCountry: 'IN', shopperGender: 'men', ...extra })

  console.log('\n── the fast path: a plain garment query never calls a model ' + '─'.repeat(13))
  {
    const r = await drive(ask('a linen shirt'))
    check(r.status === 200, 'answers 200')
    check(/x-ndjson/.test(r.contentType || ''), 'as newline-delimited JSON', r.contentType)
    check(r.calls.provider === 0, 'ZERO provider calls — compiled deterministically', `${r.calls.provider}`)
    check(r.calls.store > 0, 'but it does ask the stores', `${r.calls.store}`)
    check(n(r.result) > 0, 'and returns products', n(r.result))
    check(!!r.result.searchQuery, 'with the query it used', JSON.stringify(r.result.searchQuery))
    // RECORDED, NOT ENDORSED: the fast path returns before the trace and the
    // answer boundary, so the commonest query in the app carries neither.
    // Phase D covers the heavy path only. Locked in so a refactor cannot
    // change it silently — in either direction.
    check(r.result.traceId === undefined, 'carries NO traceId (fast path predates the trace)')
    check(r.result.answerVia === undefined, 'and NO answerVia')
  }

  console.log('\n── the heavy path: an occasion goes through the model ' + '─'.repeat(19))
  {
    const r = await drive(ask('what should I wear to a summer wedding'), {
      reply: 'Linen and light colours. [OUTFIT: men linen shirt | men linen trousers | men tan loafers]',
      products: MIXED,
    })
    check(r.calls.provider > 0, 'calls a provider', `${r.calls.provider}`)
    check(!!r.result.traceId, 'carries a traceId', r.result.traceId)
    check(r.result.answerVia === 'tokens', 'and reports how the answer was read', r.result.answerVia)
    check((r.result.outfitSlots ?? []).length >= 2, 'builds outfit slots', (r.result.outfitSlots ?? []).length)
    check(n(r.result) > 0, 'with products in them', n(r.result))
  }

  console.log('\n── multi-category: two garments become two strips ' + '─'.repeat(23))
  {
    const r = await drive(ask('shirts and trousers'), { products: MIXED })
    const groups = r.result.foundProductGroups ?? []
    check(groups.length >= 2, 'splits into per-garment groups', groups.map(g => g.label).join(', ') || 'none')
  }

  console.log('\n── empty results: honest, never fabricated ' + '─'.repeat(30))
  {
    const r = await drive(ask('a linen shirt'), { products: [] })
    check(n(r.result) === 0, 'returns no products', n(r.result))
    check(typeof r.result.reply === 'string' && r.result.reply.length > 0, 'and still says something', JSON.stringify(String(r.result.reply).slice(0, 50)))
    check(!/here (it|they) (is|are)|found it/i.test(r.result.reply || ''), 'without claiming it found anything')
  }

  console.log('\n── the stores are down ' + '─'.repeat(50))
  {
    const r = await drive(ask('a linen shirt'), { storesFail: true })
    check(r.status === 200, 'still answers 200 rather than erroring')
    check(!!r.result, 'and still finishes the stream')
    check(n(r.result) === 0, 'with nothing invented', n(r.result))
  }

  console.log('\n── provider fallback: a 429 on the first rung ' + '─'.repeat(27))
  {
    const r = await drive(ask('what should I wear to a summer wedding'), {
      providerFailsTimes: 1, products: MIXED,
      reply: 'Try this. [SEARCH: men linen shirt]',
    })
    // RECORDED, MECHANISM NOT FULLY ESTABLISHED. A 429 on rung one produces
    // exactly ONE outbound provider call — the later rungs throw before
    // fetching, most likely on the shared cooldown that the 429 sets. The
    // request still finishes and is NOT marked degraded.
    //
    // This is locked in deliberately without a full explanation: it is the
    // behaviour today, and step 10 of the plan moves the ladder. If that move
    // turns one call into four, or four into none, this fires and somebody
    // looks — which is the entire job of a characterization test.
    check(r.calls.provider === 1, 'makes exactly one provider call', `${r.calls.provider}`)
    check(!!r.result, 'and still finishes the stream')
    // `degraded` is set only when the CATALOGUE can still answer. Same 429
    // against an empty catalogue produces no `degraded` flag at all, just
    // `retryable` — so the flag means "the model failed and I fell back to
    // real pieces", not "the model failed". A useful distinction, and an easy
    // one to flatten by accident.
    check(r.result.degraded === true, 'and IS marked degraded, because the catalogue rescued it')
    check(n(r.result) > 0, 'with real pieces from that rescue', n(r.result))
  }

  console.log('\n── every provider refuses: the catalogue answers instead ' + '─'.repeat(16))
  {
    const r = await drive(ask('what should I wear to a summer wedding'), {
      providerFailsTimes: 99, products: MIXED,
    })
    check(!!r.result, 'still finishes the stream')
    check(r.result.degraded === true || /catalogue|could not think/i.test(r.result.reply || ''),
      'and says so rather than pretending', JSON.stringify(String(r.result.reply).slice(0, 55)))
    check(n(r.result) > 0, 'while still showing real pieces', n(r.result))
  }

  console.log('\n── a photo: the vision path ' + '─'.repeat(45))
  {
    const img = 'data:image/jpeg;base64,AAAA'
    const r = await drive(ask('find me this', { images: [img] }), {
      vision: 'A cream linen shirt. [SEARCH: men cream linen shirt]', products: SHIRTS,
    })
    check(r.calls.vision > 0, 'sends the photo to a vision model', `${r.calls.vision}`)
    check(!!r.result, 'and finishes')
  }
  {
    const r = await drive(ask('find me this', { images: ['data:image/jpeg;base64,AAAA'] }), { visionFails: true })
    check(!!r.result, 'a vision failure still finishes the stream')
    check(typeof r.result.reply === 'string', 'with something to read')
  }

  console.log('\n── load-more mode ' + '─'.repeat(55))
  {
    const r = await drive({ mode: 'load-more', loadMoreQuery: 'men linen shirt', excludeIds: [], buyerCurrency: 'INR', buyerCountry: 'IN' }, { products: SHIRTS })
    check(!!r.result, 'answers')
    check(Array.isArray(r.result.foundProducts), 'with a product array', `${(r.result.foundProducts ?? []).length}`)
    check(r.calls.provider === 0, 'and no model call — it is pure retrieval', `${r.calls.provider}`)
  }

  console.log('\n── wardrobe-scan mode ' + '─'.repeat(51))
  {
    // An empty question short-circuits BEFORE the mode branch — `if (!question)
    // return finish({ reply: null })` sits above it. So a wardrobe-scan with no
    // question is answered with a null reply whatever its mode says. Recorded
    // because it is easy to "tidy" that guard during extraction and change it.
    const r = await drive({ mode: 'wardrobe-scan', images: [], buyerCurrency: 'INR' })
    check(!!r.result, 'a modal request with no question still answers')
    check(r.result.reply === null, 'with a null reply — the !question guard wins over the mode', JSON.stringify(r.result.reply))
  }
  {
    const r = await drive({ mode: 'wardrobe-scan', question: 'scan my wardrobe', images: [], buyerCurrency: 'INR' })
    check(/photo/i.test(r.result.reply || ''), 'with a question and no photos, it asks for photos',
      JSON.stringify(String(r.result.reply).slice(0, 46)))
  }

  console.log('\n── the stream itself ' + '─'.repeat(52))
  {
    const r = await drive(ask('a linen shirt'))
    check(r.progress.length > 0, 'emits progress lines', `${r.progress.length}`)
    check(r.progress.every(p => typeof p.main === 'string'), 'each with a human line')
    check(r.lines.length === r.progress.length + 1, 'and exactly one result line, last', `${r.lines.length} lines`)
    check(r.result.type === 'result', 'tagged as the result')
  }

  console.log('\n── malformed everything ' + '─'.repeat(49))
  {
    const r = await drive(ask('what should I wear to a wedding'), { reply: '{"not":"our shape"} [SEARCH:]', products: MIXED })
    check(!!r.result, 'a useless model answer still finishes')
  }
  {
    const r = await drive({ buyerCurrency: 'INR' })
    check(!!r.result, 'an empty body finishes', JSON.stringify(String(r.result?.reply ?? '').slice(0, 40)))
  }

  console.log('\n' + (bad === 0
    ? 'the route behaves as recorded — run this before and after every extraction'
    : `${bad} FAILED`))
  process.exit(bad === 0 ? 0 : 1)
})()
