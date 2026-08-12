// Composing an outfit rather than assembling one. The bug this covers is not a
// crash — it is four individually excellent pieces that do not go together,
// which no type checker and no end-to-end run can see.
import { coherence, pieceFormality, composeOutfit } from './outfitKnowledge.ts'

let bad = 0
const check = (ok, label, extra) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra !== undefined ? '  ' + JSON.stringify(extra) : ''}`)
  if (!ok) bad++
}

// ── the judgement itself ────────────────────────────────────────────────────
const navySuit = [{ text: 'navy wool blazer' }, { text: 'white cotton shirt' }, { text: 'grey wool trouser' }, { text: 'black leather derby' }]
const clash    = [{ text: 'red blazer' }, { text: 'green shirt' }, { text: 'orange trouser' }, { text: 'purple sneaker' }]
const mismatch = [{ text: 'navy wool blazer' }, { text: 'grey sweatpant' }, { text: 'white sneaker' }]

check(coherence(navySuit) > coherence(clash), 'four colours score worse than neutrals plus one',
  { tidy: coherence(navySuit), clash: coherence(clash) })
check(coherence(navySuit) > coherence(mismatch), 'a blazer over sweatpants scores worse than a suit',
  { tidy: coherence(navySuit), mismatch: coherence(mismatch) })

check(pieceFormality('navy wool blazer') === 4, 'a blazer is dressed')
check(pieceFormality('grey sweatpant') === 1, 'sweatpants are not')
check(pieceFormality('a thing') === undefined, 'and an unknown piece says so rather than guessing')

// ── the choice ──────────────────────────────────────────────────────────────
// Each slot's FIRST candidate is what pure relevance would have picked. Slot 2
// leads with something that clashes and holds a neutral behind it; a composer
// should reach past the clash.
const slots = [
  { products: [{ t: 'navy wool blazer' }] },
  { products: [{ t: 'bright orange shirt' }, { t: 'white cotton shirt' }] },
  { products: [{ t: 'grey wool trouser' }] },
]
const out = composeOutfit(slots, p => p.t)
check(out[1].products[0].t === 'white cotton shirt',
  'the lead of a slot changes so the leads go together', { led: out[1].products[0].t })
check(out[1].products.length === slots[1].products.length,
  'and nothing is thrown away — the other option is still there', { kept: out[1].products.map(p => p.t) })
check(out[0].products[0].t === 'navy wool blazer', 'a slot with one candidate is untouched')

// Relevance still wins when nothing is gained by moving.
const tidy = [
  { products: [{ t: 'navy wool blazer' }, { t: 'charcoal blazer' }] },
  { products: [{ t: 'white cotton shirt' }, { t: 'cream shirt' }] },
]
const same = composeOutfit(tidy, p => p.t)
check(same[0].products[0].t === 'navy wool blazer' && same[1].products[0].t === 'white cotton shirt',
  'when the top picks already work, they stay the top picks')

check(composeOutfit([{ products: [{ t: 'x' }] }], p => p.t).length === 1, 'one slot is not an outfit and is left alone')
check(composeOutfit([], p => p.t).length === 0, 'and neither is none')

console.log(bad ? `\n${bad} FAILING` : '\nall good')
process.exit(bad)
