const http = require('http')
const seen = []
let reply = 'farda men ecru cotton short sleeve embroidered shirt'
const server = http.createServer((req, res) => {
  let b = ''; req.on('data', c => b += c)
  req.on('end', () => {
    seen.push(b)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: reply } }] }))
  })
})
server.listen(4848, async () => {
  process.env.GROQ_API_KEY = 'mock'; process.env.GROQ_BASE_URL = 'http://127.0.0.1:4848'
  const { describeGarment } = require('/home/user/From/web/.vt/dg.cjs')
  const cases = [
    ['a clean answer',        'farda men ecru cotton short sleeve embroidered shirt'],
    ['quoted and shouty',     '"MEN NAVY LINEN SHIRT"'],
    ['a refusal',             "I'm sorry, I can't identify people or brands in images."],
    ['a whole paragraph',     'This appears to be a beautiful cream coloured shirt with intricate hand embroidery across the shoulders and chest area which suggests artisanal production'],
    ['nothing at all',        ''],
    ['a refusal, other words', 'I am unable to determine the brand from this photograph'],
    ['not clothing at all',   'a wooden chair in a bright room'],
  ]
  for (const [name, r] of cases) {
    reply = r
    const out = await describeGarment('data:image/png;base64,AAA')
    console.log(`${name.padEnd(22)} → ${out === null ? '(rejected, stylist keeps control)' : out}`)
  }
  const b = seen[0] || ''
  console.log('\nasks for the brand name first:', /BRAND NAME/.test(b))
  console.log('tells it to ignore app chrome:', /screenshot of an app/.test(b))
  console.log('one image per call:', (b.match(/"type":"image_url"/g) || []).length)
  server.close()
})
