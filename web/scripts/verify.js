/**
 * Everything that must be true before a push.
 *
 * WHY THIS EXISTS. A commit went to production that did not compile — a
 * function used in a route and never imported. The typecheck caught it. The
 * shell command wrapped around the typecheck threw the answer away:
 *
 *   npx tsc --noEmit 2>&1 | head -5 && echo CLEAN
 *
 * `head` exits 0 whether or not it printed errors, so `&& echo CLEAN` printed
 * CLEAN over the top of a TS2304 and the push went out. The deploy failed, and
 * the first anyone knew of it was a failure notice on a live site.
 *
 * So the check is a file rather than something retyped from memory at the end
 * of a long session, and it fails on OUTPUT, never on an exit code it did not
 * look at.
 *
 * `npm run verify` runs the fast half — the typecheck, the production build,
 * and every harness that needs nothing but node. That is what catches a broken
 * deploy, and it is what to run before pushing.
 *
 * `npm run verify -- --browser` adds the harnesses that drive a real Chromium
 * against a dev server. They need `npm run dev` already running on :3000 and
 * they are slower, which is why they are opt-in rather than in the way.
 */
const { execFileSync, execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const WEB = path.resolve(__dirname, '..')
const browser = process.argv.includes('--browser')

/** Harnesses that need only node. Each exits non-zero on failure. */
const UNIT = [
  // The evaluation set first: it is the broadest check and the cheapest.
  'eval.js',
  // Before and after every extraction — see PHASE_E_EXTRACTION_PLAN.md.
  'characterize.js',
  'exact-match.js',
  'trace.js',
  'limits.js',
  'usage.js',
  // Not a behaviour test: it hashes the prompts, so text cannot drift silently.
  'prompts.js',
  'retrieval.js',
  'ladder.js',
  'judge-scope.js',
  'profile-cache.js',
  'same-garment.js',
  'suggest-query.js',
  'occasion.js',
  'relevance.js',
  'ladder-budget.js',
  'status-redaction.js',
  'gemini-retired.js',
]

/** Harnesses that drive Chromium against a running dev server. */
const BROWSER = [
  'colorway.js',
  'suggestion-tap.js',
  'panel.js',
]

const results = []
let failed = 0

function step(name, run) {
  process.stdout.write(`  ${name.padEnd(34)}`)
  const started = Date.now()
  try {
    run()
    const secs = ((Date.now() - started) / 1000).toFixed(1)
    console.log(`ok    ${secs}s`)
    results.push({ name, ok: true })
  } catch (e) {
    console.log('FAIL')
    const out = [e.stdout, e.stderr].filter(Boolean).map(String).join('\n').trim()
    if (out) console.log(out.split('\n').map(l => `        ${l}`).slice(-25).join('\n'))
    else if (e.message) console.log(`        ${e.message}`)
    results.push({ name, ok: false })
    failed++
  }
}

console.log('\n── it has to compile ' + '─'.repeat(52))

step('typecheck', () => {
  // On OUTPUT, not on the exit code, and not through a pipe that discards it.
  // This is the exact check that was defeated by `| head -5 && echo CLEAN`.
  //
  // But "any output at all" is too blunt in the other direction: npm prints an
  // upgrade notice to stderr, which has nothing to do with the code and would
  // fail every run. Keep only lines that are actually a compiler diagnostic —
  // `path(line,col): error TSxxxx:` — so this cannot be defeated by noise in
  // either direction.
  const raw = execSync('npx tsc --noEmit 2>&1', { cwd: WEB, encoding: 'utf8' })
  const errors = raw.split('\n').filter(l => /error TS\d+:/.test(l))
  if (errors.length) {
    const err = new Error(`tsc reported ${errors.length} error(s)`)
    err.stdout = errors.join('\n')
    throw err
  }
})

console.log('\n── and it has to behave ' + '─'.repeat(50))

for (const s of UNIT) {
  if (!fs.existsSync(path.join(WEB, 'scripts', s))) continue
  step(s, () => execFileSync('node', [path.join(WEB, 'scripts', s)], { cwd: WEB, encoding: 'utf8', stdio: 'pipe' }))
}

// BEFORE the build, deliberately.
//
// `next build` writes .next, which is the same directory `next dev` is serving
// from. Running the build first corrupted the dev server's React manifests
// mid-run — every browser harness then loaded a 500 page and reported the app
// broken when nothing was wrong with it. Three red checks caused entirely by
// the order of this file.
if (browser) {
  console.log('\n── against a real browser ' + '─'.repeat(48))
  for (const s of BROWSER) {
    if (!fs.existsSync(path.join(WEB, 'scripts', s))) continue
    step(s, () => execFileSync('node', [path.join(WEB, 'scripts', s)], { cwd: WEB, encoding: 'utf8', stdio: 'pipe' }))
  }
} else {
  console.log('\n  (browser harnesses skipped — npm run dev, then verify -- --browser)')
}

console.log('\n── and it has to build ' + '─'.repeat(51))

step('production build', () => {
  // Last, for the reason above. The build does things the typecheck does not —
  // route collection, client/server boundary checks, bundling. A green tsc is
  // not a green deploy; that is what put a broken commit into production.
  execSync('npm run build', { cwd: WEB, encoding: 'utf8', stdio: 'pipe' })
})

const passed = results.filter(r => r.ok).length
console.log('\n' + (failed === 0
  ? `all clear — ${passed} checks, safe to push`
  : `${failed} FAILED of ${results.length} — do not push`))
process.exit(failed === 0 ? 0 : 1)
