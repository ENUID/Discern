// A strip has to hold what it is labelled. Every case below arrived on a real
// screenshot in a strip it did not belong to, and every one got there the same
// way: the exclusion was written as a PHRASE, so an adjective wedged into the
// middle walked straight past it. "denim dress" never matched "Blue Outline
// Denim Short Dress".
import { productMatchesGarmentKey } from '../queryParser.ts'
const cases = [
  ['Blue Outline Denim Short Dress', 'jean', false],
  ['Blue Denim Jumpsuit', 'jean', false],
  ['Zahra Printed T-shirt & Track Pant Set', 'tshirt', false],
  ['Robin Jodhpur Pant - Denim', 'jean', true],
  ['Slim Fit Denim Jeans', 'jean', true],
  ['Everyday T-shirt - Black', 'tshirt', true],
  ['Wide Leg Wool Trouser', 'trouser', true],
  ['Linen Shorts in Black', 'short', true],
]
let bad = 0
for (const [title, key, want] of cases) {
  const got = productMatchesGarmentKey({ title, tags: [], description: '' }, key)
  const ok = got === want
  if (!ok) bad++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${key.padEnd(8)} ${want ? 'keeps ' : 'drops '} ${title}`)
}
console.log(bad ? `\n${bad} FAILING` : '\nall good')
process.exit(bad)
