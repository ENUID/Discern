/**
 * Does a cold start still pay to read the same garment again?
 *
 * enrichProduct held its garment profiles in a process-local Map. On Vercel an
 * instance is torn down between shoppers, so every cold start threw away every
 * profile and re-paid the vision cost — for garments this app had already
 * looked at hundreds of times, on providers whose free tiers are exhausted.
 *
 * The thing to prove is therefore not that the cache stores things. It is that
 * the SECOND process makes no vision calls at all. So this runs the enrichment
 * twice against a stand-in Convex and a stand-in vision endpoint, with the
 * module registry cleared in between to simulate the cold start, and counts.
 *
 * The other half matters just as much: §15 asks for a cache identity of
 * product + image + schema + prompt + model, because a profile read by an
 * older prompt against an older field set is not the same answer. Reusing it
 * would turn a saving into a source of stale wrong data. Each of those is
 * asserted to change the key.
 */
const http = require('http')
const path = require('path')
const fs = require('fs')
const { execFileSync } = require('child_process')

const WEB = path.resolve(__dirname, '..')
function build(tsPath, name) {
  const out = path.join(WEB, '.vt', name + '.cjs')
  fs.mkdirSync(path.join(WEB, '.vt'), { recursive: true })
  execFileSync(path.join(WEB, 'node_modules/.bin/esbuild'), [
    path.join(WEB, tsPath), '--bundle', '--platform=node', '--format=cjs',
    '--outfile=' + out, '--log-level=error', '--alias:@=' + WEB,
  ])
  return out
}

const PROFILE = {
  garment: 'shirt', fit: 'relaxed', volume: 'boxy', fabric: 'linen',
  weight: 'light', drape: 'fluid', pattern: 'plain', patternScale: 'none',
  colour: 'ecru', formality: 2, aesthetic: 'minimal', season: 'summer',
  details: ['camp collar'], quality: 2,
}

let visionCalls = 0
const store = new Map()          // stands in for the garment_profiles table

// One server plays both parts: Convex over /api/..., the vision model otherwise.
const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', c => (body += c))
  req.on('end', () => {
    const json = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)) }
    if (req.url.includes('/api/query')) {
      const { args } = JSON.parse(body)
      const keys = args?.[0]?.keys ?? []
      const rows = keys.filter(k => store.has(k)).map(k => ({ key: k, profile: store.get(k) }))
      return json({ status: 'success', value: rows })
    }
    if (req.url.includes('/api/mutation')) {
      const { args } = JSON.parse(body)
      for (const e of (args?.[0]?.entries ?? [])) store.set(e.key, e.profile)
      return json({ status: 'success', value: { ok: true, written: (args?.[0]?.entries ?? []).length } })
    }
    visionCalls++
    return json({ choices: [{ message: { role: 'assistant', content: JSON.stringify(PROFILE) } }] })
  })
})

const PORT = 4957
const PRODUCTS = [
  { id: 'p1', title: 'Boxy Linen Camp Shirt', description: '', image_url: 'https://cdn.shopify.com/p1.jpg' },
  { id: 'p2', title: 'Wide Cream Trousers', description: '', image_url: 'https://cdn.shopify.com/p2.jpg' },
  { id: 'p3', title: 'Tan Leather Loafers', description: '', image_url: 'https://cdn.shopify.com/p3.jpg' },
]

let bad = 0
const check = (ok, label, detail) => {
  if (!ok) bad++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  ${detail}` : ''}`)
}

/** A fresh process, as far as module state is concerned. */
function coldStart() {
  for (const k of Object.keys(require.cache)) {
    if (k.includes('/.vt/')) delete require.cache[k]
  }
  return require(build('lib/services/enrichProduct.ts', 'enrich'))
}

server.listen(PORT, async () => {
  const base = `http://127.0.0.1:${PORT}`
  process.env.GROQ_API_KEY = 'mock'
  process.env.GROQ_BASE_URL = base
  process.env.NEXT_PUBLIC_CONVEX_URL = base
  process.env.CONVEX_AUTH_SECRET = 'mock-secret'
  process.env.PROFILE_PERSISTENT_CACHE = 'on'
  process.env.ENRICH_TIMEOUT_MS = '8000'

  console.log('── first run: nothing is known ' + '─'.repeat(42))
  let { profilesFor } = coldStart()
  let got = await profilesFor(PRODUCTS)
  check(got.size === 3, 'reads all three garments', `${got.size} profiles`)
  check(visionCalls === 3, 'and pays for three vision calls', `${visionCalls} calls`)
  await new Promise(r => setTimeout(r, 400))   // the write is not awaited
  check(store.size === 3, 'what it read is stored', `${store.size} rows`)

  console.log('\n── the same process again: memory answers ' + '─'.repeat(31))
  const before = visionCalls
  got = await profilesFor(PRODUCTS)
  check(got.size === 3, 'still three profiles')
  check(visionCalls === before, 'and no vision call at all', `${visionCalls - before} calls`)

  console.log('\n── A COLD START: the whole point ' + '─'.repeat(40))
  visionCalls = 0
  ;({ profilesFor } = coldStart())
  got = await profilesFor(PRODUCTS)
  check(got.size === 3, 'a fresh process still knows all three', `${got.size} profiles`)
  check(visionCalls === 0, 'WITHOUT paying for a single vision call', `${visionCalls} calls`)

  console.log('\n── the cache identity (§15) ' + '─'.repeat(45))
  const { profileKey } = require(build('lib/services/persistentProfileCache.ts', 'ppc'))
  const k = profileKey('p1', 'https://cdn.shopify.com/p1.jpg', 'qwen-vision')
  check(profileKey('p2', 'https://cdn.shopify.com/p1.jpg', 'qwen-vision') !== k, 'a different product is a different key')
  check(profileKey('p1', 'https://cdn.shopify.com/p1-v2.jpg', 'qwen-vision') !== k, 'a RESHOT product is a different key')
  check(profileKey('p1', 'https://cdn.shopify.com/p1.jpg', 'other-model') !== k, 'a different model is a different key')
  check(profileKey('p1', 'https://cdn.shopify.com/p1.jpg', 'qwen-vision') === k, 'and the same inputs are the same key')

  console.log('\n── it must never make things worse ' + '─'.repeat(38))
  // Convex unreachable: the vision pass has to run exactly as it did before.
  process.env.NEXT_PUBLIC_CONVEX_URL = 'http://127.0.0.1:1'   // nothing listening
  visionCalls = 0
  ;({ profilesFor } = coldStart())
  got = await profilesFor(PRODUCTS)
  check(got.size === 3, 'a dead cache still returns profiles', `${got.size}`)
  check(visionCalls === 3, 'by falling back to vision, as before', `${visionCalls} calls`)
  process.env.NEXT_PUBLIC_CONVEX_URL = base

  // Switched off: straight to vision, nothing stored.
  process.env.PROFILE_PERSISTENT_CACHE = 'off'
  const rows = store.size
  visionCalls = 0
  ;({ profilesFor } = coldStart())
  await profilesFor([{ id: 'p9', title: 'New Piece', description: '', image_url: 'https://cdn.shopify.com/p9.jpg' }])
  await new Promise(r => setTimeout(r, 300))
  check(visionCalls === 1, 'switched off, it reads as it always did')
  check(store.size === rows, 'and writes nothing', `${store.size} rows`)

  server.close()
  console.log('\n' + (bad === 0
    ? 'a cold start costs nothing it has already paid for'
    : `${bad} FAILED`))
  process.exit(bad === 0 ? 0 : 1)
})
