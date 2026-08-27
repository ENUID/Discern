/**
 * Does it actually look at the candidates, and will it say no?
 *
 * The shopper's question was "find me this exact one, not similar". Until now
 * every photo search was one-way — read the picture, write words, search the
 * words — so the model never saw what came back and the answer could only ever
 * be a hope. A blue denim clog was described as "men leather sandals" and eight
 * leather sandals were presented as the exact pair.
 *
 * This is the step that closes the loop. The thing worth testing hardest is not
 * that it can find a match: it is that it can REFUSE. "None of these is that
 * piece" is a real answer to "find me the exact one", and the one no amount of
 * word-matching could ever have produced.
 *
 * Run against a stand-in vision endpoint rather than a live provider, so the
 * parsing, the confidence floor, the timeout and the failure paths are all
 * exercised deterministically — and so this passes with three of four provider
 * pools out of quota, which is the state of the world today.
 */
// Builds what it needs, so this is runnable from a clean checkout rather than
// only after some other command happened to leave a bundle behind.
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const WEB = path.resolve(__dirname, '..')
function load(tsPath, name) {
  const out = path.join(WEB, '.vt', name + '.cjs')
  fs.mkdirSync(path.join(WEB, '.vt'), { recursive: true })
  execFileSync(path.join(WEB, 'node_modules/.bin/esbuild'), [
    path.join(WEB, tsPath), '--bundle', '--platform=node', '--format=cjs',
    '--outfile=' + out, '--log-level=error', '--alias:@=' + WEB,
  ])
  return require(out)
}

const http = require('http')

const PORT = 4953
let lastPrompt = ''
let reply = ''
let delayMs = 0

const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', c => (body += c))
  req.on('end', () => {
    lastPrompt = body
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: reply } }] }))
    }, delayMs)
  })
})

const PHOTO = 'data:image/jpeg;base64,AAAA'
const SHOP = [
  'https://cdn.shopify.com/s/files/1/1/mugger-dark-denim.jpg?width=400',
  'https://cdn.shopify.com/s/files/1/1/mugger-sky-denim.jpg?width=400',
  'https://cdn.shopify.com/s/files/1/1/ibiza-navy-slider.jpg?width=400',
]

let bad = 0
const check = (ok, label, detail) => {
  if (!ok) bad++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  ${detail}` : ''}`)
}

server.listen(PORT, async () => {
  process.env.GROQ_API_KEY = 'mock'
  process.env.GROQ_BASE_URL = `http://127.0.0.1:${PORT}`
  process.env.SAME_GARMENT_TIMEOUT_MS = '3500'   // above the 3s floor, so the box is real
  delete process.env.GOOGLE_AI_API_KEY   // skip gemini, land on the groq rung
  delete process.env.CEREBRAS_API_KEY
  delete process.env.NVIDIA_API_KEY

  const { findSameGarment } = load('lib/services/sameGarment.ts', 'sg')
  const { exactMatchNote } = load('lib/fashion/exactMatch.ts', 'em')

  console.log('── it can say YES ' + '─'.repeat(55))
  reply = '{"same": 2, "confidence": 88, "closest": 2, "why": "same buckle, same stitch"}'
  let v = await findSameGarment(PHOTO, SHOP)
  check(v.sameIndex === 1, 'picks the right candidate (1-based 2 → index 1)', `sameIndex=${v.sameIndex}`)
  check(v.confidence === 88, 'carries the confidence through')
  check(v.why === 'same buckle, same stitch', 'carries the reason through')

  console.log('\n── it can say NO, which is the point ' + '─'.repeat(36))
  reply = '{"same": 0, "confidence": 91, "closest": 1, "why": "different sole and no buckle"}'
  v = await findSameGarment(PHOTO, SHOP)
  check(v.sameIndex === null, 'no match is null, not a guess', `sameIndex=${v.sameIndex}`)
  check(v.closestIndex === 0, 'still reports the nearest thing for ranking')
  const noteNo = exactMatchNote('find me this exact one, not similar', 'men denim sandals',
    [{ title: 'MUGGER - DARK DENIM' }], v)
  check(/none of them is that piece/i.test(noteNo), 'and the shopper is told plainly', `"${noteNo}"`)

  console.log('\n── a hedged yes is a no ' + '─'.repeat(49))
  // 55% is the model shrugging. The question was "is this the EXACT one".
  reply = '{"same": 1, "confidence": 55, "closest": 1, "why": "similar shape"}'
  v = await findSameGarment(PHOTO, SHOP)
  check(v.sameIndex === null, 'below the confidence floor, a match is not claimed', `conf=${v.confidence}`)

  console.log('\n── it sends the pictures, in order ' + '─'.repeat(38))
  reply = '{"same": 0, "confidence": 90, "closest": 1, "why": "x"}'
  await findSameGarment(PHOTO, SHOP)
  const sent = JSON.parse(lastPrompt)
  const parts = sent.messages[sent.messages.length - 1].content
  const imgs = parts.filter(p => p.type === 'image_url').map(p => p.image_url.url)
  check(imgs.length === 4, "the shopper's photo plus three candidates", `${imgs.length} images`)
  check(imgs[0] === PHOTO, "the shopper's photo goes FIRST — the prompt numbers from it")
  check(imgs.slice(1).every(u => /width=384/.test(u)),
    'candidates are requested at a readable thumbnail size', imgs[1])

  console.log('\n── every failure is an honest no-verdict ' + '─'.repeat(32))
  reply = 'I think probably the second one looks close'      // not JSON
  check((await findSameGarment(PHOTO, SHOP)).sameIndex === null, 'prose instead of JSON')
  reply = '{"same": 9, "confidence": 99, "closest": 1}'      // out of range
  check((await findSameGarment(PHOTO, SHOP)).sameIndex === null, 'an index that is not on the page')
  reply = '{"same": 1, "confidence": 95, "closest": 1}'
  check((await findSameGarment(PHOTO, [])).sameIndex === null, 'no candidates at all')
  check((await findSameGarment('', SHOP)).sameIndex === null, 'no photo at all')

  delayMs = 9000                                             // well past the box
  let started = Date.now()
  const timed = await findSameGarment(PHOTO, SHOP)
  let took = Date.now() - started
  check(timed.sameIndex === null, 'a slow provider')
  check(took < 4500, 'and it gives up inside its own timeout', `${took}ms`)

  // The caller's remaining budget wins when it is tighter than the default —
  // the comparison is the last thing a photo search does and is routinely
  // reached with only a few seconds left. A call that outlives the request
  // spends the quota and is thrown away.
  started = Date.now()
  await findSameGarment(PHOTO, SHOP, 3200)
  took = Date.now() - started
  check(took < 4200, "obeys the caller's tighter budget", `${took}ms`)

  // But never shorter than it takes to be worth asking at all.
  started = Date.now()
  await findSameGarment(PHOTO, SHOP, 200)
  took = Date.now() - started
  check(took >= 2900, 'and never below the floor where a call is pointless', `${took}ms`)
  delayMs = 0

  process.env.SAME_GARMENT_VISION = 'off'
  check((await findSameGarment(PHOTO, SHOP)).sameIndex === null, 'switched off entirely')
  process.env.SAME_GARMENT_VISION = 'on'

  server.close()
  console.log('\n' + (bad === 0
    ? 'it looks at the candidates, and it is willing to say none of them'
    : `${bad} FAILED`))
  process.exit(bad === 0 ? 0 : 1)
})
