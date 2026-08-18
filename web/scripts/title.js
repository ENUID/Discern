// The heading a page of results gets. Reproduces the real logic against the
// exact mix from the screenshot: a "party shoes" search whose products the
// matcher reads as shoe, jean, sneaker, sandal, dress, loafer, accessory.
const SLOT_WORDS = { top:'tops', bottom:'trousers', outer:'outerwear', dress:'dresses', shoes:'shoes', accessory:'accessories' }
const plural = w => /s$/i.test(w) ? w : /(sh|ch|x|z)$/i.test(w) ? `${w}es` : `${w}s`

function heading(items) {   // items: [garmentWord, slot]
  const perGarment = new Map(), perSlot = new Map()
  let counted = 0
  for (const [g, sl] of items) {
    counted++
    if (g) perGarment.set(g, (perGarment.get(g) ?? 0) + 1)
    if (sl) perSlot.set(sl, (perSlot.get(sl) ?? 0) + 1)
  }
  const rank = m => [...m.entries()].sort((a,b) => b[1]-a[1])
  const topSlot = rank(perSlot)[0], topGarment = rank(perGarment)[0]
  let name = ''
  if (counted && topSlot && topSlot[1]/counted >= 0.6) {
    name = topGarment && topGarment[1]/counted >= 0.6
      ? plural(topGarment[0])
      : (SLOT_WORDS[topSlot[0]] ?? plural(topGarment?.[0] ?? ''))
  } else if (topGarment && counted && topGarment[1]/counted >= 0.4) name = plural(topGarment[0])
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : '(falls back to the query)'
}

const cases = {
  'party shoes (the screenshot)': [['sneaker','shoes'],['loafer','shoes'],['sneaker','shoes'],['sandal','shoes'],['shoe','shoes'],['loafer','shoes'],['sneaker','shoes'],['shoe','shoes']],
  'all sneakers':                 [['sneaker','shoes'],['sneaker','shoes'],['sneaker','shoes'],['sneaker','shoes']],
  'white shirts':                 [['shirt','top'],['shirt','top'],['shirt','top'],['shirt','top'],['shirt','top']],
  'trousers':                     [['trouser','bottom'],['trouser','bottom'],['jean','bottom'],['trouser','bottom']],
  'a genuine mix':                [['shirt','top'],['trouser','bottom'],['sneaker','shoes'],['jacket','outer']],
}
const OLD = { 'party shoes (the screenshot)': 'Shoe, jean, shoes, sneaker, accessories, sandal, dress & loafer' }
for (const [name, items] of Object.entries(cases)) {
  const before = OLD[name] ? `\n     was: ${OLD[name]}` : ''
  console.log(`${name.padEnd(30)} → ${heading(items)}${before}`)
}
