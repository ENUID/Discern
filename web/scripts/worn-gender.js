// Self-contained: the stand-in provider lives in this process, so it cannot
// die between being started and being called — which is what defeated the
// last five attempts to verify this.
//   node scripts/worn-gender.js
//
// Requires the bundle: npx esbuild lib/services/wornGender.ts --bundle \
//   --format=cjs --platform=node --outfile=.vt/wg.cjs
const http = require('http')

const seen = []
const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', c => body += c)
  req.on('end', () => {
    seen.push(body)
    const n = Number((body.match(/These are (\d+) photograph/) || [])[1]) || 0
    // Alternate man/woman so a demotion is visible and provable.
    const arr = Array.from({ length: n }, (_, i) => ({ i, worn: i % 2 ? 'woman' : 'man' }))
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify(arr) } }] }))
  })
})

server.listen(4646, async () => {
  process.env.GROQ_API_KEY = 'mock'
  process.env.GROQ_BASE_URL = 'http://127.0.0.1:4646'
  const { wornGenderFor } = require(require('path').join(__dirname, '..', '.vt', 'wg.cjs'))

  const urls = Array.from({ length: 6 }, (_, i) => `https://cdn.shopify.com/p${i}.jpg`)
  const t0 = Date.now()
  const out = await wornGenderFor(urls)
  console.log(`read   ${Date.now() - t0}ms  ->`, JSON.stringify(out))

  const t1 = Date.now()
  await wornGenderFor(urls)
  console.log(`cache  ${Date.now() - t1}ms  (no second request)`)

  console.log('requests the provider received:', seen.length)
  console.log('asked for the worn field:', /worn/.test(seen[0] || ''))
  console.log('sent thumbnails not full images:', /width=320/.test(seen[0] || ''))

  // Indices restart per batch (5 then 1), so the alternation is 4/2 — the
  // point is that every slot got a real read rather than 'unclear'.
  const unclear = out.filter(w => w === 'unclear').length
  const decided = out.length - unclear
  console.log(`\nread back: ${out.filter(w => w === 'man').length} man, ${out.filter(w => w === 'woman').length} woman, ${unclear} unclear`)
  const ok = decided === urls.length && seen.length === 2 && /worn/.test(seen[0] || '') && /width=320/.test(seen[0] || '')
  console.log(ok ? 'PASS every piece was read from its photograph' : 'FAIL')
  server.close()
})
