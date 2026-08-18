// The HOW TO STYLE panel on a wide screen: does the look sit under its
// heading, or in a column of its own with a gap between them?
const { chromium } = require('/home/user/From/web/node_modules/playwright-core')
const PLATE = c => 'data:image/svg+xml;base64,' + Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="${c}"/></svg>`).toString('base64')
const piece = (id, title) => ({ id, title, handle: id, price: 4498, currency: 'INR',
  store_url: 'https://brand.example.com/products/' + id, media: [{ url: PLATE('#3a3a3e') }],
  options: [{ name: 'Size', values: ['M', 'L'] }], variants: [], description: 'A piece.' })

;(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] })
  let bad = 0
  for (const [name, w, h] of [['iPad 1180', 1180, 820], ['laptop 1440', 1440, 900], ['phone 390', 390, 844]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h } })
    const p = await ctx.newPage()
    await p.route('**/api/featured', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"products":[]}' }))
    await p.route('**/api/product-names', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"names":{}}' }))
    await p.route('**/api/product-images**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"images":[],"colors":[],"byColor":{}}' }))
    await p.route('**/api/style-with', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      groups: [
        { label: 'Under it', products: [piece('u1', 'GULAB')] },
        { label: 'Trousers', products: [piece('t1', 'Pravah Trousers')] },
        { label: 'Shoes',    products: [piece('s1', "Men's Porto Black Shoes")] },
      ] }) }))
    await p.route('**/api/ai/stylist', r => r.fulfill({ status: 200, contentType: 'application/x-ndjson',
      body: JSON.stringify({ type: 'result', reply: 'ok', searchQuery: 'shirt',
        foundProducts: [piece('p1', "Rare Rabbit Men's Velto Black Polyester Collared Shirt")] }) + '\n' }))

    await p.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded', timeout: 120000 })
    await p.waitForSelector('textarea', { timeout: 60000 }); await p.waitForTimeout(2500)
    const ta = await p.$('textarea'); await ta.click(); await ta.type('a black shirt')
    await p.waitForTimeout(200); await p.click('.v2-send'); await p.waitForTimeout(3500)
    const tile = await p.$('.v2-tile-btn, .v2-sec-hero .v2-shot')
    if (tile) { await tile.scrollIntoViewIfNeeded(); await tile.click(); await p.waitForTimeout(2500) }
    await p.evaluate(() => [...document.querySelectorAll('.v2-acc-pill')].find(x => /STYLE/i.test(x.textContent))?.click())
    await p.waitForSelector('.v2-look', { timeout: 25000 }).catch(() => {})
    await p.waitForTimeout(1200)

    const g = await p.evaluate(() => {
      const head = document.querySelector('.v2-panel-head')
      const look = document.querySelector('.v2-look')
      if (!head || !look) return { look: !!look }
      const h = head.getBoundingClientRect(), l = look.getBoundingClientRect()
      return { headLeft: Math.round(h.left), lookLeft: Math.round(l.left),
               indent: Math.round(l.left - h.left), lookW: Math.round(l.width),
               below: l.top >= h.bottom - 2 }
    })
    if (!g.look && g.look !== undefined && g.headLeft === undefined) { console.log(`${name.padEnd(12)} NO PANEL`); bad++; await ctx.close(); continue }
    const ok = g.below && Math.abs(g.indent) <= 24
    if (!ok) bad++
    console.log(`${name.padEnd(12)} head@${g.headLeft}  look@${g.lookLeft}  indent=${g.indent}px  width=${g.lookW}  ${g.below ? 'below the heading' : 'BESIDE THE HEADING'}  ${ok ? 'ok' : 'MISALIGNED'}`)
    await ctx.close()
  }
  console.log(bad === 0 ? '\nPASS the look sits under its heading at every width' : `\nFAIL ${bad} misaligned`)
  await b.close(); process.exit(bad === 0 ? 0 : 1)
})().catch(e => { console.error('HARNESS FAILED', e.message); process.exit(2) })
