// Provider lives in-process so it cannot die between start and call.
const http = require('http')
const seen = []
const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', c => body += c)
  req.on('end', () => {
    seen.push(body)
    // Pretend candidate 3 is the same garment.
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant',
      content: '{"same": 3, "confidence": 88, "closest": 3}' } }] }))
  })
})
server.listen(4747, async () => {
  process.env.GROQ_API_KEY = 'mock'
  process.env.GROQ_BASE_URL = 'http://127.0.0.1:4747'
  const { findSameGarment } = require('/home/user/From/web/.vt/sg.cjs')
  const cands = Array.from({ length: 6 }, (_, i) => `https://cdn.shopify.com/c${i}.jpg`)
  const t0 = Date.now()
  const r = await findSameGarment('data:image/png;base64,AAAA', cands)
  console.log(`answered in ${Date.now() - t0}ms ->`, JSON.stringify(r))
  const b = seen[0] || ''
  const imgs = (b.match(/"type":"image_url"/g) || []).length
  console.log('images sent:', imgs, '(1 wanted + 6 candidates)')
  console.log('asked which is the SAME garment:', /SAME GARMENT/.test(b))
  console.log('warned against colour-only matches:', /NOT the same garment/.test(b))
  console.log('sent candidates as thumbnails:', /width=384/.test(b))
  const ok = r.sameIndex === 2 && imgs === 7 && /SAME GARMENT/.test(b) && /width=384/.test(b)
  console.log('\n' + (ok ? 'PASS the photograph is compared against the candidates' : 'FAIL'))
  server.close()
})
