
// Builds what it needs, so this is runnable from a clean checkout rather than
// only after some other command happened to leave a bundle behind.
const { execFileSync: _exec } = require('child_process')
const _fs = require('fs')
const _path = require('path')
const _WEB = _path.resolve(__dirname, '..')
function load(tsPath, name, replace) {
  const out = _path.join(_WEB, '.vt', name + '.cjs')
  _fs.mkdirSync(_path.join(_WEB, '.vt'), { recursive: true })
  _exec(_path.join(_WEB, 'node_modules/.bin/esbuild'), [
    _path.join(_WEB, tsPath), '--bundle', '--platform=node', '--format=cjs',
    '--outfile=' + out, '--log-level=error', '--alias:@=' + _WEB,
  ])
  // GEMINI_BASE is a module constant rather than an env var, so pointing the
  // client at the stand-in Google below means rewriting it in the bundle.
  if (replace) _fs.writeFileSync(out, _fs.readFileSync(out, 'utf8').split(replace[0]).join(replace[1]))
  return require(out)
}
/**
 * Does a retired Gemini model heal itself, and can it loop?
 *
 * gemini-2.0-flash was retired by Google and the provider ladder ran on two
 * rungs instead of four until somebody read the 404. The body had said, the
 * whole time:
 *
 *   "This model models/gemini-2.0-flash is no longer available. Please update
 *    your code to use models/gemini-3.6-flash for the latest features and
 *    improvements."
 *
 * So the successor is now read out of the error and adopted. The two things
 * that must hold are that it reads the RIGHT name out of real bodies, and that
 * it can never chase its own tail — a body naming the model we just asked for
 * has to return null, or a retirement becomes an infinite retry.
 *
 * The live call is exercised against a stand-in Google that 404s the old name
 * and answers the new one, so the retry, the adoption, and the "remember only
 * after it worked" rule are all actually run rather than reasoned about.
 */
const http = require('http')

const RETIRED_RE = /(?:no longer available|deprecated|not found)[\s\S]{0,200}?use\s+models\/([A-Za-z0-9][\w.-]{2,60})/i
const retiredModelReplacement = (body, asked) => {
  const m = RETIRED_RE.exec(body)
  const name = m?.[1]?.replace(/[.,"')\]}]+$/, '')
  return name && name !== asked ? name : null
}

const REAL_404 = JSON.stringify([{ error: {
  code: 404,
  message: 'This model models/gemini-2.0-flash is no longer available. Please update your code to use models/gemini-3.6-flash for the latest features and improvements.',
  status: 'NOT_FOUND',
} }])

// body, asked, expected
const CASES = [
  [REAL_404, 'gemini-2.0-flash', 'gemini-3.6-flash'],
  ['models/gemini-1.5-pro is deprecated, use models/gemini-3.6-pro instead.', 'gemini-1.5-pro', 'gemini-3.6-pro'],
  ['Model not found. Please use models/gemini-3.6-flash-lite.', 'gemini-2.0-flash', 'gemini-3.6-flash-lite'],
  // Must never loop: the body names the model we just asked for.
  ['models/gemini-3.6-flash is no longer available. use models/gemini-3.6-flash', 'gemini-3.6-flash', null],
  // Must not fire on unrelated failures.
  ['{"error":{"code":429,"message":"Resource has been exhausted"}}', 'gemini-3.6-flash', null],
  ['{"error":{"code":400,"message":"Invalid JSON payload"}}', 'gemini-3.6-flash', null],
  ['Payment required to access this resource. Visit your billing tab.', 'gemini-3.6-flash', null],
]

let bad = 0
console.log('── reading the successor out of the 404 ' + '─'.repeat(33))
for (const [body, asked, want] of CASES) {
  const got = retiredModelReplacement(body, asked)
  const ok = got === want
  if (!ok) bad++
  console.log(`${ok ? '  ok  ' : ' FAIL '}${String(got)}${ok ? '' : `  (want ${want})`}   ← ${body.slice(0, 62)}…`)
}

// ── the live path ───────────────────────────────────────────────────────────
let asked = []
const google = http.createServer((req, res) => {
  let b = ''
  req.on('data', c => (b += c))
  req.on('end', () => {
    const model = JSON.parse(b).model
    asked.push(model)
    if (model === 'gemini-2.0-flash') {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      return res.end(REAL_404)
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'styled' } }] }))
  })
})

google.listen(4951, async () => {
  process.env.GOOGLE_AI_API_KEY = 'mock'
  process.env.GEMINI_STYLIST_MODEL = 'gemini-2.0-flash'   // the retired one
  const { geminiChat } = load('lib/gemini.ts', 'gemini',
    ['https://generativelanguage.googleapis.com/v1beta/openai', 'http://127.0.0.1:4951'])

  console.log('\n── the live call ' + '─'.repeat(56))
  const first = await geminiChat([{ role: 'user', content: 'hello' }])
  const okFirst = first?.content === 'styled' && asked.join(' → ') === 'gemini-2.0-flash → gemini-3.6-flash'
  if (!okFirst) bad++
  console.log(`${okFirst ? '  ok  ' : ' FAIL '}first call: ${asked.join(' → ')}  content=${JSON.stringify(first?.content)}`)

  asked = []
  const second = await geminiChat([{ role: 'user', content: 'again' }])
  const okSecond = second?.content === 'styled' && asked.join(' → ') === 'gemini-3.6-flash'
  if (!okSecond) bad++
  console.log(`${okSecond ? '  ok  ' : ' FAIL '}second call: ${asked.join(' → ')}   (the dead name is not asked for twice)`)

  google.close()
  console.log('\n' + (bad === 0 ? 'a retirement heals itself, and cannot loop' : `${bad} FAILED`))
  process.exit(bad === 0 ? 0 : 1)
})
