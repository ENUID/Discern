#!/usr/bin/env node
/**
 * The whole product, every way in.
 *
 * e2e.js walks the JOURNEY and prove.js scores the ANSWERS. Neither asks the
 * question that has produced every serious bug this app has had: when a step
 * fails, does anybody find out?
 *
 * Every real defect found so far was a silent success. A page that rendered
 * and never hydrated. A strip that vanished because an empty result got
 * cached. A judge that ran perfectly and was shown to nobody. A filter with
 * nothing to filter toward. In every case the system behaved exactly as built,
 * the build was wrong, and nothing anywhere said so.
 *
 * So this walks every endpoint the product has and asks three things:
 *
 *   1. does it answer at all
 *   2. when given nonsense, does it fail HONESTLY — a status, or a reason a
 *      human could read — rather than 200 OK with an empty body
 *   3. is there a way forward from the failure, or is it a dead end
 *
 * A route that returns `{products: []}` with no `reason` is the shape being
 * hunted here: indistinguishable, from outside, from a catalogue that simply
 * had nothing. That ambiguity is what cost this project days.
 *
 *   node scripts/audit.js
 *   BASE=https://discern.enuid.com node scripts/audit.js
 *   node scripts/audit.js --json > audit.json
 *
 * Exit code is the number of findings.
 */

const BASE = process.env.BASE || 'http://localhost:3000'
const AS_JSON = process.argv.includes('--json')

const findings = []
const rows = []

const note = (severity, route, what, detail) => {
  findings.push({ severity, route, what, detail })
}

async function hit(method, path, body, { timeout = 45000 } = {}) {
  const t0 = Date.now()
  try {
    const res = await fetch(BASE + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout),
    })
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch { /* not json, that is data too */ }
    return { status: res.status, ms: Date.now() - t0, json, text, ok: res.ok }
  } catch (e) {
    return { status: 0, ms: Date.now() - t0, json: null, text: String(e.message), ok: false, threw: true }
  }
}

/** Did this answer say anything a person could act on? An empty result with a
 *  stated reason is a good answer. An empty result with no reason is the bug
 *  this file exists to find. */
function speaks(json) {
  if (!json || typeof json !== 'object') return false
  for (const k of ['reason', 'error', 'message', 'detail', 'judge', 'judgeDetail']) {
    if (json[k] !== undefined && json[k] !== null && json[k] !== '') return true
  }
  return false
}

function countsIn(json) {
  if (!json || typeof json !== 'object') return null
  for (const k of ['products', 'groups', 'names', 'images', 'items', 'outfitSlots']) {
    if (Array.isArray(json[k])) return { key: k, n: json[k].length }
  }
  return null
}

const record = (route, probe, r, verdict, extra = '') => {
  rows.push({ route, probe, status: r.status, ms: r.ms, verdict, extra })
}

// ── the public surface, as a shopper's browser actually uses it ─────────────
const PROBES = [
  // route,               method, body,                                    what it is
  ['/api/rates', 'GET', null, 'exchange rates'],
  ['/api/featured', 'GET', null, 'the opening feed'],
  ['/api/catalog/search', 'POST', { q: 'linen shirt', gender: 'Men', currency: 'INR', country: 'IN' }, 'search, ordinary'],
  ['/api/catalog/search', 'POST', { q: 'hand knitted balaclava in vicuna', gender: 'Men' }, 'search, nothing to find'],
  ['/api/catalog/search', 'POST', {}, 'search, no question'],
  ['/api/catalog/search', 'POST', { q: '   ' }, 'search, blank question'],
  ['/api/catalog/search', 'POST', { q: 'x'.repeat(5000) }, 'search, absurd length'],
  ['/api/style-with', 'POST', { product: { id: 'x', title: 'Olive Cotton Shirt', image: '', tags: ['Men > Shirts'] }, gender: 'Men', currency: 'INR' }, 'how to style'],
  ['/api/style-with', 'POST', {}, 'how to style, no product'],
  ['/api/style-with', 'POST', { product: { title: 'Silver Bracelet', tags: ['jewellery'] } }, 'how to style, unplaceable'],
  ['/api/product-names', 'POST', { titles: ['RONALD', 'KEDAR'] }, 'nicer captions'],
  ['/api/product-names', 'POST', {}, 'captions, nothing asked'],
  ['/api/product-images', 'POST', { productId: 'x', images: [] }, 'gallery ordering'],
  ['/api/sizeguide', 'POST', { vendor: 'x', title: 'shirt' }, 'size guide'],
  ['/api/shipping', 'POST', { storeUrl: 'https://example.com', country: 'IN' }, 'shipping read'],
  ['/api/description', 'POST', { title: 'Oxford shirt', vendor: 'x' }, 'written description'],
  ['/api/feedback', 'POST', { message: 'audit probe, please ignore', email: 'audit@example.com' }, 'feedback'],
  ['/api/ai/stylist/status', 'GET', null, 'which providers are up'],
  ['/api/ai/stylist/health', 'GET', null, 'provider detail (guarded)'],
  ['/api/community/me', 'GET', null, 'community membership'],
  ['/api/auth/convex-token', 'GET', null, 'convex auth proof'],
]

// Routes that must NOT be reachable without credentials. A 200 here is the
// finding, not the failure.
const GUARDED = [
  ['/api/admin/analytics', 'GET', null],
  ['/api/admin/brand-health', 'GET', null],
  ['/api/admin/vocab', 'GET', null],
  ['/api/admin/community-access', 'GET', null],
  ['/api/cron/brand-health', 'GET', null],
  ['/api/cron/retention', 'GET', null],
  ['/api/cron/quality-feedback', 'GET', null],
  ['/api/cron/style-signals', 'GET', null],
  ['/api/cron/vocab-review', 'GET', null],
  ['/api/cron/learning-analyst', 'GET', null],
  ['/api/admin/analytics/report', 'GET', null],
]

async function main() {
  console.log(`\nAUDIT  ${BASE}\n${'─'.repeat(74)}`)

  console.log('\nTHE SHOPPER-FACING SURFACE')
  for (const [path, method, body, what] of PROBES) {
    const r = await hit(method, path, body)
    const c = countsIn(r.json)
    let verdict = 'ok'
    let extra = c ? `${c.n} ${c.key}` : ''

    if (r.threw) {
      verdict = 'THREW'
      note('high', path, 'the request never completed', r.text.slice(0, 120))
    } else if (r.status >= 500) {
      verdict = 'SERVER ERROR'
      note('high', path, `returned ${r.status}`, String(r.text).slice(0, 160))
    } else if (r.status === 200 && c && c.n === 0 && !speaks(r.json)) {
      // The exact shape this file exists to catch.
      verdict = 'SILENT EMPTY'
      note('high', path, 'answered 200 with nothing and no reason',
        `a caller cannot tell this from a genuine empty result — ${what}`)
    } else if (r.status === 200 && !c && !speaks(r.json) && !r.text.trim()) {
      verdict = 'SILENT EMPTY'
      note('high', path, 'answered 200 with an empty body', what)
    } else if (r.status === 400 || r.status === 422) {
      verdict = `rejected ${r.status}`
      if (!speaks(r.json)) note('medium', path, `rejected with ${r.status} but said why in no readable field`, what)
    } else if (r.status === 401 || r.status === 403) {
      verdict = `guarded ${r.status}`
    } else if (r.status === 429) {
      verdict = 'rate limited'
    }
    if (speaks(r.json) && !extra) extra = Object.entries(r.json).filter(([k]) => ['reason', 'error', 'judge'].includes(k)).map(([k, v]) => `${k}=${v}`).join(' ')
    if (r.ms > 20000) note('medium', path, `took ${(r.ms / 1000).toFixed(1)}s`, `${what} — a shopper is waiting on this`)

    record(path, what, r, verdict, extra)
    console.log(`  ${String(r.status).padStart(3)}  ${String(r.ms + 'ms').padStart(8)}  ${what.padEnd(30)} ${verdict === 'ok' ? '' : verdict}  ${extra}`)
  }

  console.log('\nROUTES THAT MUST REFUSE A STRANGER')
  for (const [path, method, body] of GUARDED) {
    const r = await hit(method, path, body, { timeout: 20000 })
    const open = r.status === 200
    if (open) note('high', path, 'answered 200 without credentials', 'an admin or cron route reachable by anyone')
    console.log(`  ${String(r.status).padStart(3)}  ${path.padEnd(42)} ${open ? 'OPEN — anyone can call this' : 'refused'}`)
  }

  // ── the report ────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(74)}`)
  const high = findings.filter(f => f.severity === 'high')
  const med = findings.filter(f => f.severity === 'medium')
  console.log(`FINDINGS   ${high.length} serious · ${med.length} worth fixing\n`)
  for (const f of [...high, ...med]) {
    console.log(`  [${f.severity}] ${f.route}`)
    console.log(`         ${f.what}`)
    console.log(`         ${f.detail}\n`)
  }
  if (findings.length === 0) console.log('  Nothing. Every route answered, and every empty answer said why.\n')

  if (AS_JSON) {
    require('fs').writeFileSync('audit.json', JSON.stringify({ base: BASE, rows, findings }, null, 2))
    console.log('  written to audit.json')
  }
  process.exit(findings.length)
}

main().catch(e => { console.error('AUDIT FAILED', e); process.exit(99) })
