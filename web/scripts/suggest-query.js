
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
 * Is the suggested query actually a good query?
 *
 * The first case is the screenshot: "outfits for a casual party" produced a
 * paragraph of advice, no clothes, and a shopper press-and-holding the text to
 * copy it back into the composer by hand. What should have been offered
 * instead is a sendable query — and "sendable" here has a specific, checkable
 * meaning, because the retrieval machinery reads queries in a particular way.
 *
 * So each case is asserted against the same properties the search itself
 * depends on, not against a hand-written expected string:
 *
 *   it names garments        or the catalogue filter has no concept groups and
 *                            the search flattens into a keyword sweep
 *   it names 2+ for a look   the threshold where both search paths split into
 *                            per-garment strips instead of one merged list
 *   at most 2 adjectives     every extra one is another MANDATORY group, and
 *                            four of them retrieve nothing
 *   it keeps the occasion    that is the rerank query — what the judge reads
 *   it states a gender       menswear and womenswear are different searches
 *   no markdown              it goes into a search box, not a renderer
 */
const { suggestQuery, plainWords } = load('lib/fashion/suggestQuery.ts', 'sq')
const { decomposeQuery } = load('lib/queryParser.ts', 'qp')

// The reply from the screenshot, asterisks included — that is how it was shown.
const CASUAL_PARTY_REPLY =
  'For a casual party, you want to look intentional without looking like you tried too hard. ' +
  'Here are three distinct moods: an easy layered look, a resort-leaning textured shirt, ' +
  'and a sleek knit **elevated** baseline.'

const CASES = [
  {
    name: 'the screenshot',
    question: 'outfits for a casual party',
    reply: CASUAL_PARTY_REPLY,
    gender: 'men',
    wantOccasion: 'casual party',
    wantGarments: 2,
  },
  {
    name: 'occasion the reply never named a garment for',
    question: 'what should I wear to a job interview',
    reply: 'Keep it quiet and well cut. Nothing loud, nothing new-looking.',
    gender: 'men',
    wantOccasion: 'a job interview',
    wantGarments: 2,
  },
  {
    name: 'the model named the pieces',
    question: 'what should I wear to a summer wedding in Delhi',
    reply: 'A pastel linen kurta paired with off-white trousers and soft leather loafers keeps you cool.',
    gender: 'men',
    wantOccasion: 'a summer wedding in delhi',
    wantGarments: 2,
  },
  {
    name: 'womenswear',
    question: 'outfits for a beach holiday',
    reply: 'Think loose linen shirts over swimwear, with a sandal you can walk in.',
    gender: 'women',
    wantOccasion: 'a beach holiday',
    wantGarments: 2,
  },
  {
    name: 'a single garment, not an outfit',
    question: 'something in linen',
    reply: 'A linen shirt is the easiest way in.',
    gender: 'men',
    wantGarments: 1,
    // "in linen" is a fibre, not an event. Appending it produced "men linen
    // shirts for in linen" — the fibre worn twice and read as an occasion.
    wantNoOccasionClause: true,
  },
]

// No garment anywhere → nothing better to offer than what they typed.
const NULL_CASES = [
  ['hello', 'Hi. What are you shopping for?', 'men'],
  ['what do you think of quiet luxury', 'It is mostly a marketing word for good cloth.', 'men'],
]

let bad = 0
const check = (ok, label, detail) => {
  if (!ok) bad++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  ${detail}` : ''}`)
}

for (const c of CASES) {
  const out = suggestQuery(c.question, c.reply, c.gender)
  console.log(`\n── ${c.name} ${'─'.repeat(Math.max(0, 60 - c.name.length))}`)
  console.log(`   asked:     "${c.question}"`)
  console.log(`   suggested: "${out}"`)
  if (!out) { check(false, 'produced a query'); continue }

  const parts = decomposeQuery(out)
  check(parts.garmentKeys.length >= c.wantGarments,
    `names ${c.wantGarments}+ garment${c.wantGarments > 1 ? 's' : ''}`, `[${parts.garmentKeys.join(', ')}]`)
  check(parts.materials.length + parts.colors.length <= 2,
    'at most two adjectives', `${parts.materials.length} material + ${parts.colors.length} colour`)
  check(!!parts.gender, 'states a gender', parts.gender || '(none)')
  check(!/[*_`#\[\]]/.test(out), 'no markdown survives')
  check(out.toLowerCase() !== c.question.toLowerCase(), 'is not just the question back')
  if (c.wantOccasion) {
    check(out.toLowerCase().includes(c.wantOccasion), 'keeps the occasion for the judge', `"${c.wantOccasion}"`)
  }
  if (c.wantNoOccasionClause) {
    check(!/\bfor\b/.test(out), 'invents no occasion')
  }
  // It has to read as English. "for to a job interview" and "for in linen"
  // both passed every property check above and neither is a sentence.
  check(!/\bfor\s+(?:to|at|in|on|for|with)\b/.test(out), 'no doubled preposition')
  check(!/\s{2,}|^\s|\s$/.test(out), 'no stray whitespace')
}

console.log(`\n── nothing worth suggesting ${'─'.repeat(45)}`)
for (const [q, r, g] of NULL_CASES) {
  const out = suggestQuery(q, r, g)
  check(out === null, `stays quiet on "${q}"`, out ? `got "${out}"` : '')
}

console.log(`\n── markdown ${'─'.repeat(61)}`)
const MD = [
  ['a sleek knit **elevated** baseline', 'a sleek knit elevated baseline'],
  ['*italic* and _under_ and `code`', 'italic and under and code'],
  ['## Heading\nbody', 'Heading body'],
  ['a [link](http://x.com) here', 'a link here'],
]
for (const [raw, want] of MD) {
  const got = plainWords(raw)
  check(got === want, JSON.stringify(raw), got === want ? '' : `got ${JSON.stringify(got)}`)
}

console.log('\n' + (bad === 0 ? 'every suggestion is a query the search can actually use' : `${bad} FAILED`))
process.exit(bad === 0 ? 0 : 1)
