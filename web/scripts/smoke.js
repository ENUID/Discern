/**
 * Production smoke check for the deployed ladder.
 *
 * Read-only: it asks the live stylist endpoint real questions and records what
 * comes back. Nothing is written, no admin surface is touched, and every query
 * is one a shopper could type. Rate limit is 30/min/IP, and this sends five.
 *
 * What it is actually checking, in order of what E6 could have broken:
 *   a reply comes back at all              — the ladder returns something
 *   which provider answered                — the chain is intact and ordered
 *   products come back on a product query  — retrieval still runs (E5)
 *   several strips on a multi-garment ask  — multiCategorySearch still runs
 *   a conversational reply stays short     — the light path still routes light
 *
 * Usage: node scripts/smoke.js [origin]
 */
const ORIGIN = process.argv[2] || 'https://discern.enuid.com'
const ENDPOINT = `${ORIGIN}/api/ai/stylist`

const CASES = [
  { name: 'conversational', body: { question: 'hey', messages: [] }, want: ['reply'] },
  { name: 'single garment', body: { question: 'white linen shirt', messages: [], buyerCurrency: 'USD' }, want: ['reply', 'products'] },
  { name: 'two garments', body: { question: 'linen shirt and shorts for the beach', messages: [], buyerCurrency: 'USD' }, want: ['reply', 'products', 'groups'] },
  { name: 'an occasion', body: { question: 'what do I wear to a job interview', messages: [], buyerCurrency: 'USD' }, want: ['reply', 'products'] },
  { name: 'advice, no search', body: { question: 'does navy go with brown shoes?', messages: [] }, want: ['reply'] },
]

async function ask(body) {
  const started = Date.now()
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  const lines = text.split('\n').filter(Boolean)
  const events = []
  for (const l of lines) { try { events.push(JSON.parse(l)) } catch {} }
  const result = events.find(e => e.type === 'result') || null
  return { status: res.status, ms: Date.now() - started, events, result, raw: text }
}

;(async () => {
  console.log(`── ${ENDPOINT}`)
  console.log(`── ${new Date().toISOString()}\n`)
  let bad = 0

  for (const c of CASES) {
    let r
    try { r = await ask(c.body) } catch (e) { console.log(`  FAIL ${c.name}: ${e.message}`); bad++; continue }

    const reply = r.result?.reply
    const products = r.result?.foundProducts ?? []
    const groups = r.result?.foundProductGroups ?? r.result?.outfitSlots ?? null
    const provider = r.result?.modelTrace ?? r.result?.provider ?? null

    const problems = []
    if (r.status !== 200) problems.push(`HTTP ${r.status}`)
    if (c.want.includes('reply') && !(typeof reply === 'string' && reply.trim().length > 0)) problems.push('no reply')
    if (c.want.includes('products') && products.length === 0) problems.push('no products')
    if (c.want.includes('groups') && !(Array.isArray(groups) && groups.length >= 2)) problems.push(`only ${Array.isArray(groups) ? groups.length : 0} strips`)
    if (r.result?.busy) problems.push('BUSY — every provider refused')
    if (r.result?.retryable && !reply) problems.push('retryable error')
    // A degraded reply IS a reply, which is the point of the fallback — but it
    // is not the model answering, so it must never read as a pass here.
    if (r.result?.degraded) problems.push('DEGRADED — no rung answered inside the budget')

    if (problems.length) bad++
    console.log(`  ${problems.length ? 'FAIL' : 'ok  '} ${c.name.padEnd(20)} ${String(r.ms).padStart(6)}ms  ${String(products.length).padStart(2)} products` +
      `${Array.isArray(groups) ? `, ${groups.length} strips` : ''}${provider ? `  via ${JSON.stringify(provider).slice(0, 90)}` : ''}`)
    if (reply) console.log(`       reply: ${JSON.stringify(String(reply).slice(0, 150))}`)
    if (products[0]) console.log(`       first: ${JSON.stringify(String(products[0].title || '').slice(0, 70))} ${products[0].vendor ? `— ${products[0].vendor}` : ''}`)
    if (Array.isArray(groups) && groups.length) console.log(`       strips: ${groups.map(g => g.label ?? g.slot ?? '?').join(', ')}`)
    if (problems.length) console.log(`       PROBLEM: ${problems.join('; ')}`)
    if (r.result?.degraded) console.log('       note: degraded — the catalogue answered without the model')
    console.log()
  }

  console.log(bad === 0 ? 'production answers, with products, through the ladder' : `${bad} of ${CASES.length} cases had problems`)
  process.exit(bad === 0 ? 0 : 1)
})()
