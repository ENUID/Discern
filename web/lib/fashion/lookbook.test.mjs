// The house eye must stay a description of the lookbook, not an assertion
// about it. Every number in the prompt block is derived, so the way this
// breaks is silently: somebody edits the prose, the counts stop matching the
// looks, and the judge is told something the reference set does not support.
import { LOOKS, lookbookStats, houseTaste } from './lookbook.ts'

let bad = 0
const check = (ok, label, extra) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + JSON.stringify(extra) : ''}`)
  if (!ok) bad++
}

const s = lookbookStats()
const block = houseTaste()

check(LOOKS.length >= 16, 'the lookbook has the looks in it', { looks: LOOKS.length })
check(new Set(LOOKS.map(l => l.id)).size === LOOKS.length, 'every look has its own id')
check(LOOKS.every(l => l.layers.length > 0 && l.bottom), 'every look says what it is made of')

// Every count the block prints has to be findable in the array.
const nums = (block.match(/\b\d+\b/g) || []).map(Number)
check(nums.includes(s.n) && nums.includes(s.wide) && nums.includes(s.echo) && nums.includes(s.thirdLayer),
  'the numbers in the block come from the looks', { n: s.n, wide: s.wide, echo: s.echo, third: s.thirdLayer })
check(s.wide === LOOKS.filter(l => l.verdict === 'yes' && l.bottomVolume === 'wide').length,
  'the proportion claim is counted, not asserted')
check(s.bottomTones[0].count >= s.bottomTones[1].count, 'the palette is reported in order of how often it appears')

// The guard is the whole reason this is safe to ship off sixteen photographs.
check(/tiebreaker, not a filter/.test(block), 'the block says it is a tiebreaker rather than a filter')
check(/their words win/.test(block), 'and that a stated preference beats the house')

// Short enough to sit under a rubric without burying it.
check(block.length < 1800, 'and it stays short enough not to drown the rubric', { chars: block.length })

if (s.rejected === 0) {
  console.log('\nNOTE  no rejected looks yet — the set says what good is, never what near-miss is not.')
}
console.log(bad ? `\n${bad} FAILING` : '\nall good')
process.exit(bad)
