// Does answering "Shopping for" actually change what the server is told?
const { chromium } = require('/home/user/From/web/node_modules/playwright-core')
;(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] })
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()

  const sent = []
  await page.route('**/api/ai/stylist', async r => {
    try { sent.push(JSON.parse(r.request().postData() || '{}').shopperGender) } catch { sent.push('(unparsed)') }
    await r.fulfill({ status: 200, contentType: 'application/x-ndjson',
      body: JSON.stringify({ type: 'result', reply: 'ok', searchQuery: 'x', foundProducts: [] }) + '\n' })
  })
  await page.route('**/api/catalog/search', async r => {
    try { sent.push('catalog:' + JSON.parse(r.request().postData() || '{}').gender) } catch {}
    await r.fulfill({ status: 200, contentType: 'application/json', body: '{"products":[],"groups":[]}' })
  })
  await page.route('**/api/featured', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"products":[]}' }))

  await page.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded', timeout: 120000 })
  await page.waitForTimeout(6000)

  const before = await page.evaluate(() => localStorage.getItem('discern.v2.shopsFor'))
  const visible = await page.evaluate(() => !!document.querySelector('.v2-shopsfor'))
  console.log('ask shown to a new visitor:', visible, visible ? 'PASS' : 'FAIL')
  console.log('stored before answering:', JSON.stringify(before))

  // Answer it
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.v2-shopsfor-b')].find(x => x.textContent.trim() === 'Men')
    b.scrollIntoView(); b.click()
  })
  await page.waitForTimeout(600)
  const after = await page.evaluate(() => localStorage.getItem('discern.v2.shopsFor'))
  const goneNow = await page.evaluate(() => !document.querySelector('.v2-shopsfor'))
  console.log('stored after answering:', JSON.stringify(after), after === 'Men' ? 'PASS' : 'FAIL')
  console.log('ask disappears once answered:', goneNow, goneNow ? 'PASS' : 'FAIL')

  // Search, and see what the server is told
  const ta = await page.$('textarea'); await ta.click(); await ta.type('a linen shirt')
  await page.waitForTimeout(200); await page.click('.v2-send'); await page.waitForTimeout(6000)
  console.log('gender the server was sent:', JSON.stringify(sent))
  console.log(sent.includes('Men') ? 'PASS the search carries it' : 'FAIL the search did not carry it')

  // And it survives a reload
  await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(5000)
  const stillGone = await page.evaluate(() => !document.querySelector('.v2-shopsfor'))
  console.log('still answered after reload:', stillGone, stillGone ? 'PASS' : 'FAIL')

  await browser.close()
})().catch(e => { console.error('HARNESS FAILED', e); process.exit(1) })
