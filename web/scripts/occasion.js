
// Builds what it needs, so this is runnable from a clean checkout rather than
// only after some other command happened to leave a bundle behind.
const { execFileSync: _exec } = require('child_process')
const _fs = require('fs')
const _path = require('path')
const _WEB = _path.resolve(__dirname, '..')
function load(tsPath, name) {
  const out = _path.join(_WEB, '.vt', name + '.cjs')
  _fs.mkdirSync(_path.join(_WEB, '.vt'), { recursive: true })
  _exec(_path.join(_WEB, 'node_modules/.bin/esbuild'), [
    _path.join(_WEB, tsPath), '--bundle', '--platform=node', '--format=cjs',
    '--outfile=' + out, '--log-level=error', '--alias:@=' + _WEB,
  ])
  return require(out)
}
/**
 * Does a stated formality survive the word next to it?
 *
 * A shopper asked for "outfits for a casual party" and the occasion table
 * answered blazer, shirt, trouser, loafer. `party` belongs to cocktail,
 * cocktail is formality 4, and it is checked long before weekend — so the word
 * casual was in the sentence and lost to the word party.
 *
 * That is the same regression PLACE_BEATS_PARTY was written for, one step
 * along: there, "beach party" came back with blazers because beach lost to
 * party. A place beats a gathering because it says WHERE. A formality beats it
 * because it says HOW DRESSY, which is the only thing the slots encode.
 *
 * Most of the cases below are the ones that must NOT move. A rule like this is
 * easy to write so broadly that "casual Friday at the office" stops being work.
 */
const { readOccasion } = load('lib/fashion/outfitKnowledge.ts', 'ok')

// query, expected occasion key, why it is the interesting case
const CASES = [
  // The report.
  ['outfits for a casual party', 'weekend', 'the screenshot: was cocktail, blazers for a casual party'],
  ['casual party', 'weekend', 'bare form'],
  ['a casual night out', 'weekend', 'gathering word other than party'],
  ['casual get-together with friends', 'weekend', 'hyphenated gathering'],

  // Dressier compounds are not casual, they are their own thing.
  ['smart casual party', 'cocktail', 'smart casual is dressier, not a kind of casual'],
  ['business casual drinks', 'work', 'business casual is an office dress code'],

  // Gatherings with no formality stated must be untouched.
  ['cocktail party', 'cocktail', ''],
  ['christmas party', 'cocktail', ''],
  ['new years eve party', 'cocktail', ''],
  ['night out with the boys', 'cocktail', ''],

  // A place still beats both — the rule this one is modelled on.
  ['casual beach party', 'holiday', 'place beats formality beats gathering'],
  ['casual pool party', 'holiday', ''],

  // "casual" next to something that is NOT a generic gathering changes nothing.
  ['casual friday at the office', 'work', 'the obvious over-reach, guarded against'],
  ['casual dinner', 'dinner', ''],
  ['casual wedding', 'wedding-guest', 'a wedding is a wedding'],

  // Untouched by any of this.
  ['what should I wear to a wedding', 'wedding-guest', ''],
  ['a job interview', 'interview', ''],
  ['what do I wear to the gym', 'gym', ''],
]

let bad = 0
for (const [q, want, why] of CASES) {
  const got = readOccasion(q)?.key ?? null
  const ok = got === want
  if (!ok) bad++
  console.log(
    `${ok ? '  ok  ' : ' FAIL '}${q.padEnd(34)} → ${String(got).padEnd(14)}` +
    (ok ? (why ? `  ${why}` : '') : `  WANT ${want}`)
  )
}

console.log('\n' + (bad === 0 ? 'a stated formality beats the gathering it describes, and nothing else moved' : `${bad} FAILED`))
process.exit(bad === 0 ? 0 : 1)
