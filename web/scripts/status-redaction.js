/**
 * Can a key get out through the status endpoint?
 *
 * /api/ai/stylist/status is public and unauthenticated — deliberately, so the
 * app can be diagnosed from a phone when it is down. It now passes the
 * provider's own error text through, because "failed for a reason this check
 * cannot name" was the answer in the one case that needed a name. Provider
 * errors quote the request back at you, and the request carries the key.
 *
 * So the redaction is the only thing standing between a public endpoint and a
 * credential, and it gets a test that runs on real key shapes: Google's AIzaSy
 * prefix, OpenAI's sk-proj-, a bearer header, a query parameter, a JSON field.
 *
 * The last two cases are the other half of the job — a redaction that ate the
 * diagnosis would be safe and useless. A retired model name and an HTTP status
 * must both survive intact.
 */
const { execFileSync } = require('child_process')
const fs = require('fs'), path = require('path')
const WEB = '/home/user/From/web'
function load(tsPath, name) {
  const out = path.join(WEB, '.vt', name + '.cjs')
  fs.mkdirSync(path.join(WEB, '.vt'), { recursive: true })
  execFileSync(path.join(WEB, 'node_modules/.bin/esbuild'), [
    path.join(WEB, tsPath), '--bundle', '--platform=node', '--format=cjs',
    '--outfile=' + out, '--log-level=error', '--alias:@=' + WEB,
  ])
  return require(out)
}
// The real module, not a copy of it pasted into the test. A copy passes
// forever while the thing it was copied from drifts.
const redact = load('lib/redact.ts', 'redact').redactSecrets

/** Anything shaped like a credential, however it was labelled. */
const SECRETISH = /AIzaSy|sk-proj-|sk-ant-|gsk_|nvapi-|csk-|[A-Za-z0-9_-]{24,}/

// text, must still contain (or null)
const CASES = [
  ['Gemini HTTP 400: Bearer AIzaSyD-1a2B3c4D5e6F7g8H9i0JkLmNoPqRsTuV rejected', null],
  ['fetch https://generativelanguage.googleapis.com/v1?key=AIzaSyD1a2B3c4D5e6F7g8H9i0Jk failed', null],
  ['auth error {"api_key":"sk-proj-abc123def456ghi789jkl012mno","code":401}', null],
  ['Cerebras HTTP 401 {"authorization":"csk-9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c"}', null],
  ['Groq HTTP 403 gsk_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0 revoked', null],
  // The diagnosis itself must survive.
  ['Gemini HTTP 404: {"error":{"code":404,"message":"models/gemini-2.0-flash is not found for API version v1beta","status":"NOT_FOUND"}}', 'gemini-2.0-flash is not found'],
  ['Gemini HTTP 429 (rate limited)', 'HTTP 429'],
  ['NVIDIA HTTP 400: unsupported parameter reasoning_effort', 'reasoning_effort'],
]

let bad = 0
for (const [text, mustKeep] of CASES) {
  const out = redact(text)
  const leaked = SECRETISH.test(out)
  const lost = mustKeep != null && !out.includes(mustKeep)
  if (leaked || lost) bad++
  console.log(
    `${leaked ? ' LEAK ' : lost ? ' LOST ' : '  ok  '}${out}` +
    (lost ? `\n        expected to keep: "${mustKeep}"` : '')
  )
}

console.log('\n' + (bad === 0 ? 'no secrets survive, every diagnosis does' : `${bad} FAILED`))
process.exit(bad === 0 ? 0 : 1)
