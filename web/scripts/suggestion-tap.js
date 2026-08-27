// The reply that came back with nothing to buy, and the one tap out of it.
//
// A shopper asked "outfits for a casual party", got three sentences of advice
// and no clothes, and their only way forward was to press-and-hold the
// paragraph, drag the selection handles, copy it, paste it into the composer
// and send it back by hand. They did it. It worked. This is the check that
// nobody has to do it again.
//
// Driven against a stubbed stylist so it tests the INTERFACE — the suggestion
// appearing, the tap loading the field, the row clearing itself, and the send
// carrying the suggested query rather than the advice. The wording of the
// query is scripts/suggest-query.js's job.
const { chromium } = require('playwright-core')

const REPLY =
  'For a casual party, you want to look intentional without looking like you ' +
  'tried too hard. Here are three distinct moods: an easy layered look, a ' +
  'resort-leaning textured shirt, and a sleek knit **elevated** baseline.'
const SUGGEST = 'men t-shirts, jeans and jackets for a casual party'

;(async () => {
  const b = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox'],
  })
  let bad = 0
  const check = (ok, label, detail) => {
    if (!ok) bad++
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  ${detail}` : ''}`)
  }

  for (const [name, w, h] of [['iPad 1180', 1180, 820], ['phone 390', 390, 844]]) {
    console.log(`\n── ${name} ${'─'.repeat(Math.max(0, 58 - name.length))}`)
    const ctx = await b.newContext({ viewport: { width: w, height: h } })
    const p = await ctx.newPage()
    const sent = []
    await p.route('**/api/featured', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"products":[]}' }))
    await p.route('**/api/product-names', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"names":{}}' }))
    await p.route('**/api/product-images**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"images":[],"colors":[],"byColor":{}}' }))
    await p.route('**/api/ai/stylist', async (r) => {
      try { sent.push(JSON.parse(r.request().postData() || '{}').question) } catch { sent.push(null) }
      r.fulfill({
        status: 200, contentType: 'application/x-ndjson',
        // No products, no searchQuery — the exact shape that strands a shopper.
        body: JSON.stringify({ type: 'result', reply: REPLY, suggest: SUGGEST, comparison: null }) + '\n',
      })
    })

    await p.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded', timeout: 120000 })
    await p.waitForSelector('textarea', { timeout: 60000 })
    await p.waitForTimeout(2200)

    const ta = await p.$('textarea')
    await ta.click()
    await ta.type('outfits for a casual party')
    await p.waitForTimeout(150)
    await p.click('.v2-send')
    await p.waitForSelector('.v2-said-use', { timeout: 30000 })

    // 1. The suggestion is offered, and it is the query — not the advice.
    const shown = await p.$eval('.v2-said-use-q', el => el.textContent.trim())
    check(shown === SUGGEST, 'offers the suggested query', `"${shown}"`)

    // 2. No raw markdown reaches the screen.
    const advice = await p.$eval('.v2-bar-said', el => el.textContent)
    check(!advice.includes('**'), 'no ** asterisks on screen')

    // 3. It is a real button — reachable by keyboard, not a div with a handler.
    const tag = await p.$eval('.v2-said-use', el => el.tagName)
    check(tag === 'BUTTON', 'is a button, not a tap-target div', tag)

    // 4. It sits UNDER the advice at full width, not squeezed beside it.
    const geo = await p.evaluate(() => {
      const box = document.querySelector('.v2-bar-said').getBoundingClientRect()
      const txt = document.querySelector('.v2-bar-said p').getBoundingClientRect()
      const use = document.querySelector('.v2-said-use').getBoundingClientRect()
      return { boxW: box.width, txtBottom: txt.bottom, useTop: use.top, useW: use.width }
    })
    check(geo.useTop >= geo.txtBottom - 1, 'sits below the answer', `${Math.round(geo.useTop - geo.txtBottom)}px under`)
    check(geo.useW / geo.boxW > 0.85, 'uses the width', `${Math.round(geo.useW / geo.boxW * 100)}%`)

    // 5. THE TAP. Field loads, row clears, nothing is sent yet.
    await p.click('.v2-said-use')
    await p.waitForTimeout(400)
    const after = await p.evaluate(() => ({
      value: document.querySelector('textarea').value,
      focused: document.activeElement === document.querySelector('textarea'),
      stillThere: !!document.querySelector('.v2-said-use'),
      adviceThere: !!document.querySelector('.v2-bar-said'),
    }))
    check(after.value === SUGGEST, 'the tap loads the composer', `"${after.value}"`)
    check(after.focused, 'and focuses it, ready to edit or send')
    check(!after.stillThere, 'the suggestion clears itself')
    check(!after.adviceThere, 'the block above the field is gone')
    check(sent.length === 1, 'the tap does NOT send — that stays the shopper\'s move', `${sent.length} request(s)`)

    // 6. Sending normally carries the SUGGESTED query, not the advice.
    await p.click('.v2-send')
    await p.waitForTimeout(2500)
    check(sent.length === 2 && sent[1] === SUGGEST, 'send carries the suggested query', JSON.stringify(sent[1]))

    await ctx.close()
  }

  await b.close()
  console.log('\n' + (bad === 0 ? 'one tap replaces press-hold-drag-copy-paste' : `${bad} FAILED`))
  process.exit(bad === 0 ? 0 : 1)
})()
