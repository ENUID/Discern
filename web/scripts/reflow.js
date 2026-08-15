// "When I resize the window on iPad or laptop it collapses on each other
// rather than resizing itself." Measured: the status pill against the
// composer, at three sizes and across live resizes, while a search runs.
const { chromium } = require('/home/user/From/web/node_modules/playwright-core')

const geom = () => {
  const pill = document.querySelector('.v2-crafting')
  const bar = document.querySelector('.v2-bar')
  const wrap = document.querySelector('.v2-bar-wrap')
  if (!pill || !bar || !wrap) return { pill: !!pill }
  const a = pill.getBoundingClientRect(), v = bar.getBoundingClientRect()
  return {
    gap: Math.round(v.top - a.bottom),
    pillRight: Math.round(a.right), vw: window.innerWidth,
    offscreen: a.right > window.innerWidth + 1 || a.left < -1,
    barVar: getComputedStyle(document.querySelector('.v2-root')).getPropertyValue('--bar').trim(),
    wrapH: Math.round(wrap.getBoundingClientRect().height),
  }
}

;(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] })
  let bad = 0
  const say = (label, g) => {
    if (!g || g.pill === false) { console.log(`${label.padEnd(30)} NO PILL`); bad++; return }
    const ok = g.gap >= 2 && g.gap <= 24 && !g.offscreen
    if (!ok) bad++
    console.log(`${label.padEnd(30)} gap=${String(g.gap).padStart(4)}px  --bar=${g.barVar.padEnd(6)} barH=${g.wrapH}  ${ok ? 'ok' : (g.offscreen ? 'OFF SCREEN' : 'COLLAPSED')}`)
  }

  for (const [name, w, h] of [['phone 390', 390, 844], ['tablet 820', 820, 1180], ['laptop 1440', 1440, 900]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h } })
    const p = await ctx.newPage()
    await p.route('**/api/featured', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"products":[]}' }))
    await p.route('**/api/ai/stylist', async r => { await new Promise(s => setTimeout(s, 40000)); r.abort() })
    await p.route('**/api/catalog/search', async r => { await new Promise(s => setTimeout(s, 40000)); r.abort() })
    await p.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded', timeout: 120000 })
    await p.waitForSelector('textarea', { timeout: 60000 }); await p.waitForTimeout(2500)
    const ta = await p.$('textarea'); await ta.click()
    await ta.type('Build me a capsule wardrobe for work that I can also wear at the weekend')
    await p.waitForTimeout(400); await p.click('.v2-send'); await p.waitForTimeout(2200)
    say(name, await p.evaluate(geom))

    // The reported case: resize WHILE it is on screen.
    for (const nw of [Math.round(w * 0.55), Math.round(w * 1.4), w]) {
      await p.setViewportSize({ width: nw, height: h })
      await p.waitForTimeout(800)
      say(`  → resized to ${nw}`, await p.evaluate(geom))
    }
    await ctx.close()
  }
  console.log(bad === 0 ? '\nPASS the status line stays clear of the composer at every size' : `\nFAIL ${bad} broken states`)
  await b.close(); process.exit(bad === 0 ? 0 : 1)
})().catch(e => { console.error('HARNESS FAILED', e.message); process.exit(2) })
