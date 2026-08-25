/**
 * The prompts, byte for byte.
 *
 * Most of what this app does is not code, it is instructions. Roughly 170 lines
 * of text tell the model who it is, what it may say, which tokens to emit and
 * when to stay quiet — and none of that is reachable by a normal test. A test
 * can assert that a reply came back; it cannot notice that a sentence lost a
 * clause on the way past a "tidy up the formatting" commit.
 *
 * So this harness does not test behaviour at all. It hashes each prompt and
 * compares it to a checksum recorded when the text was moved out of the route,
 * which makes accidental drift impossible and deliberate change a two-step
 * ritual:
 *
 *     node scripts/prompts.js            → fails, and shows what changed
 *     node scripts/prompts.js --update   → records the new hash, on purpose
 *
 * Committing the updated checksum is the signature. That is the whole point:
 * nobody can change what this app says to a model without it appearing in a
 * diff that a human has to look at.
 *
 * It also fails on a prompt with no checksum. A new prompt added to PROMPTS is
 * caught here; a new prompt NOT added to PROMPTS is invisible, which is why the
 * registry comment in prompts.ts says what it says.
 */
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const { execFileSync } = require('child_process')

const WEB = path.resolve(__dirname, '..')
const CHECKSUMS = path.join(WEB, 'lib/stylist/prompts.checksums.json')
const update = process.argv.includes('--update')

// Bundle the module rather than parsing it: SYSTEM and VISION_SYSTEM both
// interpolate FASHION_KNOWLEDGE, so the only honest thing to hash is the string
// the model actually receives, not the source that produces it.
const bundle = path.join(WEB, '.vt', 'prompts.cjs')
fs.mkdirSync(path.join(WEB, '.vt'), { recursive: true })
execFileSync(path.join(WEB, 'node_modules/.bin/esbuild'), [
  path.join(WEB, 'lib/stylist/prompts.ts'),
  '--bundle', '--platform=node', '--format=cjs',
  '--outfile=' + bundle, '--log-level=error', '--alias:@=' + WEB,
])
const { PROMPTS, PROMPT_VERSIONS } = require(bundle)

const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex')

const recorded = fs.existsSync(CHECKSUMS)
  ? JSON.parse(fs.readFileSync(CHECKSUMS, 'utf8'))
  : { prompts: {} }

const names = Object.keys(PROMPTS).sort()
const known = Object.keys(recorded.prompts || {}).sort()

let bad = 0
const check = (ok, label, detail) => {
  if (!ok) bad++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail !== undefined ? `  ${detail}` : ''}`)
}

console.log('── every prompt, hashed ' + '─'.repeat(49))

const next = {}
for (const name of names) {
  const text = PROMPTS[name]
  const digest = sha(text)
  next[name] = { sha256: digest, chars: text.length, lines: text.split('\n').length }

  const was = recorded.prompts?.[name]
  if (!was) {
    if (update) {
      console.log(`  new  ${name}  recorded (${text.length} chars)`)
    } else {
      check(false, name, 'NO CHECKSUM RECORDED — add it deliberately with --update')
    }
    continue
  }
  if (was.sha256 === digest) {
    check(true, name, `${text.length} chars, ${was.sha256.slice(0, 12)}…`)
    continue
  }
  if (update) {
    console.log(`  edit ${name}  ${was.chars} → ${text.length} chars, ${was.sha256.slice(0, 12)}… → ${digest.slice(0, 12)}…`)
  } else {
    check(false, name, 'CHANGED')
    console.log(`       was  ${was.chars} chars / ${was.lines} lines  ${was.sha256}`)
    console.log(`       now  ${text.length} chars / ${next[name].lines} lines  ${digest}`)
    const delta = text.length - was.chars
    console.log(`       ${delta > 0 ? '+' : ''}${delta} characters.`)
    console.log('       If you meant it: node scripts/prompts.js --update, and commit the checksum.')
  }
}

// A checksum with no prompt behind it means a prompt was deleted or renamed.
for (const name of known) {
  if (!names.includes(name)) {
    if (update) console.log(`  gone ${name}  removed from the registry`)
    else check(false, name, 'recorded, but no longer exported from PROMPTS')
  }
}

// The version label and the checksum are two halves of one fact.
for (const name of names) {
  if (PROMPT_VERSIONS[name] === undefined) check(false, name, 'has no entry in PROMPT_VERSIONS')
}

if (update) {
  fs.writeFileSync(CHECKSUMS, JSON.stringify({
    note: 'SHA-256 of each prompt as the model receives it. Written by scripts/prompts.js --update. Editing this file by hand defeats the guard.',
    prompts: next,
  }, null, 2) + '\n')
  console.log(`\nrecorded ${names.length} checksums → lib/stylist/prompts.checksums.json`)
  process.exit(0)
}

console.log('\n' + (bad === 0
  ? `${names.length} prompts unchanged, byte for byte`
  : `${bad} FAILED — a prompt changed. Deliberate? --update. Not deliberate? revert it.`))
process.exit(bad === 0 ? 0 : 1)
