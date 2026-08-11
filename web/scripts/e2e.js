#!/usr/bin/env node
/**
 * The whole journey, end to end, at three widths.
 *
 * Every other harness this app has ever had checked one thing in isolation:
 * the pill, the dock, the drawer, the bag. That is how a regression gets
 * through — each piece passes its own test and the walk from "I need shoes" to
 * a brand's checkout still breaks in the middle, because nothing ever walked
 * it. This does. One browser session per screen size, opened once, driven the
 * whole way through, asserting at every step, and it never reloads to get
 * itself out of trouble.
 *
 *   node scripts/e2e.js               against a dev server on :3000
 *   BASE=https://discern.enuid.com node scripts/e2e.js
 *   node scripts/e2e.js --live        also hit the real catalogue and stylist
 *   node scripts/e2e.js --live-only   skip the browser, check the endpoints
 *
 * --live-only exists because some sandboxes let a plain fetch out to the
 * internet but will not let a browser through their proxy. The endpoints can
 * still be checked from there; the journey has to be run against something
 * local.
 *
 * The journey runs against stubbed endpoints on purpose. Brand stores go down,
 * model providers run out of quota, and neither is a reason for this to report
 * that the interface is broken — those are what --live is for, and it is a
 * separate report at the end. What the stubs pin down is everything between
 * the request and the shopper's eyes, which is where the bugs have actually
 * been.
 *
 * Exit code is the number of failures, so CI can just look at it.
 */

const path = require('path')
const { chromium } = require(path.join(__dirname, '..', 'node_modules', 'playwright-core'))

const BASE = process.env.BASE || 'http://localhost:3000'
const ONLY_LIVE = process.argv.includes('--live-only')
const LIVE = ONLY_LIVE || process.argv.includes('--live')
const SHOTS = process.env.SHOTS || null
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

const SCREENS = [
  { name: 'phone', width: 390, height: 844, mobile: true },
  { name: 'tablet', width: 820, height: 1180, mobile: true },
  { name: 'laptop', width: 1440, height: 900, mobile: false },
]

// ── the goods ───────────────────────────────────────────────────────────────
// Flat colour plates with their name written across them, so a screenshot of a
// failure says which image was showing rather than leaving it to be guessed.
const plate = (label, fill) => 'data:image/svg+xml;base64,' + Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200">`
  + `<rect width="900" height="1200" fill="${fill}"/>`
  + `<text x="450" y="620" font-size="64" text-anchor="middle" fill="#fff" `
  + `font-family="sans-serif">${label}</text></svg>`).toString('base64')

const COLOURWAYS = [
  { name: 'Navy', hex: '#26304a' },
  { name: 'Camel', hex: '#b09070' },
  { name: 'Ink', hex: '#1d2330' },
]

/** A piece as a brand's catalogue really returns it: several photographs, a
 *  size axis and a colour axis, one variant per combination, and tags that are
 *  where the material line comes from. */
const piece = (id, title, opts = {}) => ({
  id: `e2e-${id}`,
  title,
  handle: `e2e-${id}`,
  price: opts.price ?? 2400,
  currency: opts.currency ?? 'INR',
  vendor: opts.vendor ?? 'Atelier Nine',
  store_url: 'https://brand.example.com/products/' + id,
  media: [1, 2, 3, 4, 5, 6].map(n => ({ url: plate(`${title} · ${n}`, n % 2 ? '#4a4a52' : '#8f8f92') })),
  options: [
    { name: 'Size', values: ['S', 'M', 'L', 'XL'] },
    { name: 'Color', values: COLOURWAYS.map(c => c.name) },
  ],
  variants: COLOURWAYS.flatMap((c, ci) => ['S', 'M', 'L', 'XL'].map((s, si) => ({
    id: `gid://shopify/ProductVariant/${id}${ci}${si}`,
    options: [{ label: s }, { label: c.name }],
    availability: true,
    media: [{ url: plate(`${title} · ${c.name}`, c.hex) }],
  }))),
  tags: ['cotton', 'wool'],
  description: 'Woven in a mill that has been at it since 1902. Cut long in the body.',
})

const SHIRTS = [1, 2, 3, 4].map(n => piece(`shirt${n}`, `Oxford shirt ${n}`))
const TROUSERS = [1, 2, 3, 4].map(n => piece(`trouser${n}`, `Wool trouser ${n}`, { price: 3800 }))
const MORE_SHIRTS = [5, 6].map(n => piece(`shirt${n}`, `Poplin shirt ${n}`))

const TWO_STRIPS = {
  type: 'result',
  reply: 'Two shapes that go together: a shirt with body, and a trouser that holds a crease.',
  searchQuery: 'shirts and trousers',
  foundProducts: [...SHIRTS, ...TROUSERS],
  foundProductGroups: [
    { label: 'Shirt', query: 'oxford shirts', products: SHIRTS },
    { label: 'Trouser', query: 'wool trousers', products: TROUSERS },
  ],
}

// Progress lines exactly as the backend emits them: several, arriving together
// at the end of the stream. Every one of them has to be seen — that is the
// whole reason the interface queues them instead of rendering the latest.
const STEPS = [
  { icon: 'read', main: 'Reading your request', detail: 'two garments' },
  { icon: 'search', main: 'Searching 62 brand catalogues', detail: 'live' },
  { icon: 'narrow', main: 'Narrowing to your size and country', detail: 'IN' },
  { icon: 'judge', main: 'Comparing 48 pieces', detail: 'fabric, cut, price' },
  { icon: 'swatch', main: 'Matching colours', detail: 'navy, camel' },
  { icon: 'assemble', main: 'Laying them out', detail: '' },
]

const COMPARISON = {
  type: 'result',
  reply: 'Here is how they sit against each other:',
  comparison: {
    rows: [
      { label: 'Fabric', values: ['100% Supima cotton', 'Cotton blend'] },
      { label: 'Cut', values: ['Regular', 'Slim'] },
      { label: 'Price', values: ['₹2,400', '₹1,900'] },
    ],
    pick: { index: 0, reason: 'The Supima holds its shape and will outlast the blend by years.' },
  },
}

const ndjson = (...objs) => objs.map(o => JSON.stringify(o)).join('\n') + '\n'

// ── the recorder ────────────────────────────────────────────────────────────
/** The status pill is the one part of this that cannot be checked by looking
 *  at the page afterwards: by the time the results are up, every step it
 *  narrated is gone. So the page records them as they happen. */
const RECORDER = () => {
  window.__e2e = { steps: [], errors: [] }
  const note = () => {
    const line = document.querySelector('.v2-crafting-line')
    if (!line) return
    const text = (line.textContent || '').replace(/\s+/g, ' ').trim()
    if (!text) return
    const icon = document.querySelector('.v2-step-ic svg')
    const last = window.__e2e.steps[window.__e2e.steps.length - 1]
    if (last && last.text === text) return
    window.__e2e.steps.push({ text, icon: !!icon, at: performance.now() })
  }
  const start = () => {
    new MutationObserver(note).observe(document.body, {
      childList: true, subtree: true, characterData: true,
    })
    note()
  }
  if (document.body) start()
  else document.addEventListener('DOMContentLoaded', start)
  window.addEventListener('error', e => window.__e2e.errors.push(String(e.message)))
  // Checkout leaves for the brand's own site. Catch it rather than navigate.
  window.__opened = []
  window.open = u => { window.__opened.push(String(u)); return { focus() {}, set opener(_) {} } }
}

// ── overlap ─────────────────────────────────────────────────────────────────
/** "Nothing may overlap" as an assertion.
 *
 *  The hard part is that plenty of this interface overlaps on purpose: the bag
 *  button sits on the photograph, the placeholder sits on the textarea, the
 *  drawer sits on the page. What is a bug is two things in the SAME layer
 *  colliding — a heading running into a price, a control cut in half by its
 *  neighbour.
 *
 *  So a pair is only compared when it is genuinely in one layer: neither
 *  element is positioned out of flow itself, and both answer to the same
 *  positioned ancestor. Leaves only, since a paragraph wrapping a span is not
 *  two things fighting, and only things a shopper reads or presses — a
 *  decorative wash behind a heading is not a collision. */
const OVERLAP = () => {
  const WANT = 'button, a, h1, h2, h3, p, span, li, input, textarea, label, em, strong'
  const SKIP = ['.v2-ov', '.v2-veil', '.v2-bag-ov', '.v2-menu', '.v2-pop', '.v2-tray']
  const vis = el => {
    const s = getComputedStyle(el)
    if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return false
    const r = el.getBoundingClientRect()
    return r.width > 2 && r.height > 2 && r.bottom > 0 && r.top < innerHeight
  }
  const flow = el => getComputedStyle(el).position === 'static'
  const els = [...document.querySelectorAll(WANT)].filter(el => {
    if (SKIP.some(s => el.closest(s))) return false
    if (!vis(el)) return false
    // Deliberately lifted out of flow — it is meant to sit on something.
    if (!flow(el)) return false
    // Leaves only: a paragraph wrapping a span is not two things colliding.
    return ![...el.querySelectorAll(WANT)].some(vis)
  })
  const hits = []
  for (let i = 0; i < els.length; i++) {
    for (let j = i + 1; j < els.length; j++) {
      const a = els[i], b = els[j]
      if (a.contains(b) || b.contains(a)) continue
      // Different layers. One is drawn over the other on purpose.
      if (a.offsetParent !== b.offsetParent) continue
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect()
      const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left)
      const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top)
      if (w <= 2 || h <= 2) continue
      // A sliver of shared box is normal kerning slop; a real collision covers
      // a meaningful share of the smaller of the two.
      const area = w * h
      const small = Math.min(ra.width * ra.height, rb.width * rb.height)
      if (area / small < 0.25) continue
      hits.push({
        a: (a.className || a.tagName) + ' · ' + (a.textContent || '').trim().slice(0, 24),
        b: (b.className || b.tagName) + ' · ' + (b.textContent || '').trim().slice(0, 24),
        cover: +(area / small).toFixed(2),
      })
    }
  }
  return hits.slice(0, 6)
}

// ── the harness ─────────────────────────────────────────────────────────────
function reporter(screen) {
  const fails = []
  return {
    fails,
    check(ok, label, detail) {
      const line = `  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + JSON.stringify(detail) : ''}`
      console.log(line)
      if (!ok) fails.push(`${screen}: ${label}${detail ? ' ' + JSON.stringify(detail) : ''}`)
    },
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function shoot(page, name) {
  if (!SHOTS) return
  try { await page.screenshot({ path: path.join(SHOTS, name + '.png') }) } catch { /* not the point */ }
}

async function journey(browser, screen) {
  console.log(`\n══ ${screen.name} · ${screen.width}×${screen.height} ${'═'.repeat(28)}`)
  const { check, fails } = reporter(screen.name)

  const ctx = await browser.newContext({
    viewport: { width: screen.width, height: screen.height },
    isMobile: screen.mobile, hasTouch: screen.mobile,
    locale: 'en-IN',
  })
  await ctx.addInitScript(RECORDER)
  const page = await ctx.newPage()

  const crashes = []
  page.on('pageerror', e => crashes.push(String(e.message)))

  // ── the stubs ─────────────────────────────────────────────────────────────
  const json = (r, body) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  await page.route('**/api/featured', r => json(r, { products: [] }))
  await page.route('**/api/product-names', r => json(r, { names: {} }))
  await page.route('**/api/image-order', r => json(r, { order: [] }))
  await page.route('**/api/product-images**', r => json(r, {
    images: [1, 2, 3, 4, 5, 6, 7, 8].map(n => plate(`gallery ${n}`, n % 2 ? '#39424f' : '#5c5c62')),
    colors: COLOURWAYS.map(c => c.name), byColor: {},
  }))
  // Empty on purpose for most of the run: the catalogue rescue is a distinct
  // scene at the end, and if it were always armed a broken stylist path would
  // pass by accident.
  let catalogueHas = []
  await page.route('**/api/catalog/search', r => json(r, { products: catalogueHas, groups: [] }))

  // The stylist. One route, several scenes, chosen by what was actually sent —
  // which also proves the request carries what it is supposed to carry.
  let sent = null
  let scene = 'search'
  await page.route('**/api/ai/stylist', async r => {
    let body = {}
    try { body = JSON.parse(r.request().postData() || '{}') } catch { /* defaults */ }
    sent = body
    const stream = b => r.fulfill({ status: 200, contentType: 'application/x-ndjson', body: b })

    if (body.mode === 'load-more') {
      return stream(ndjson({ type: 'result', reply: '', foundProducts: MORE_SHIRTS }))
    }
    if (Array.isArray(body.products) && body.products.length) return stream(ndjson(COMPARISON))
    if (scene === 'dead') return r.fulfill({ status: 503, contentType: 'application/json', body: '{}' })
    await sleep(1400)
    return stream(ndjson(...STEPS.map(s => ({ type: 'progress', ...s })), TWO_STRIPS))
  })

  // ── 1 · arrive ────────────────────────────────────────────────────────────
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 120000 })
  await page.waitForSelector('textarea', { timeout: 60000 })
  await sleep(3500)
  const home = await page.evaluate(() => ({
    hero: !!document.querySelector('.v2-hero-copy'),
    composer: !!document.querySelector('.v2-bar textarea'),
    wordmark: document.querySelector('.v2-brand')?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
    sideways: document.documentElement.scrollWidth > innerWidth + 1,
  }))
  check(home.hero && home.composer, 'the door opens onto a hero and somewhere to type', home)
  check(!home.sideways, 'and the page does not scroll sideways')
  await shoot(page, `e2e-${screen.name}-1-home`)

  // ── 2 · ask for two garments ──────────────────────────────────────────────
  const ta = await page.$('textarea')
  await ta.click()
  await ta.type('i need shirts and trosuers for work')   // the typo is deliberate
  await sleep(200)
  await page.click('.v2-send')

  // Let the steps run. The stream lands all six at once; the interface has to
  // pace them out, and this is the window in which that must happen.
  await sleep(1200)
  const midflight = await page.evaluate(() => {
    const p = document.querySelector('.v2-crafting')
    const bar = document.querySelector('.v2-bar')
    const pr = p?.getBoundingClientRect(), br = bar?.getBoundingClientRect()
    return {
      pill: !!p,
      gap: pr && br ? +(br.top - pr.bottom).toFixed(1) : null,
      alignedLeft: pr && br ? Math.abs(pr.left - br.left) <= 1.5 : null,
      inside: pr ? pr.right <= innerWidth + 0.5 : null,
    }
  })
  check(midflight.pill === true, 'a search says so while it runs')
  check(midflight.alignedLeft === true, 'the pill starts where the composer starts', midflight)
  check(midflight.gap !== null && midflight.gap >= 2 && midflight.gap <= 16,
    'and sits just above it, not adrift', { gap: midflight.gap })
  check(midflight.inside === true, 'and stays inside the screen')
  await shoot(page, `e2e-${screen.name}-2-searching`)

  await page.waitForSelector('.v2-results', { timeout: 60000 })
  await sleep(1200)

  // ── 3 · every step was seen, each with its own icon ───────────────────────
  const steps = await page.evaluate(() => window.__e2e.steps)
  const narrated = steps.map(s => s.text)
  const wanted = STEPS.map(s => s.main)
  const missed = wanted.filter(w => !narrated.some(n => n.includes(w)))
  check(missed.length === 0, 'every step the backend reported was actually shown',
    { shown: narrated.length, missed })
  check(steps.every(s => s.icon), 'and each one carried an icon, not a spinner',
    { withoutIcon: steps.filter(s => !s.icon).map(s => s.text) })
  const gaps = steps.slice(1).map((s, i) => Math.round(s.at - steps[i].at))
  check(gaps.every(g => g >= 60), 'none of them flashed past below a readable dwell', { gaps })

  // ── 4 · two garments, two strips, honest headings ─────────────────────────
  const strips = await page.evaluate(() => ({
    headings: [...document.querySelectorAll('.v2-sec h2')].map(h => h.textContent.trim()),
    tiles: document.querySelectorAll('.v2-tile, .v2-sec-hero').length,
    home: !!document.querySelector('.v2-hero-copy'),
    retry: !!document.querySelector('.v2-retry'),
  }))
  check(strips.headings.length === 2, 'asking for two things gives two sections', strips.headings)
  check(!strips.home && !strips.retry, 'and it stayed on the results, with no "try again"')
  check(strips.headings.every(h => h.length > 0 && !/trosuers|i need/i.test(h)),
    'the headings name the clothes, not the question typed back', strips.headings)
  check(strips.tiles >= 8, 'both strips are populated', { tiles: strips.tiles })
  await shoot(page, `e2e-${screen.name}-3-results`)

  // ── 5 · See more extends a strip rather than repeating it ─────────────────
  const before = await page.evaluate(() => document.querySelectorAll('.v2-tile, .v2-sec-hero').length)
  const more = await page.$('.v2-more')
  if (more) {
    await more.scrollIntoViewIfNeeded()
    await more.click()
    await sleep(2500)
    const after = await page.evaluate(() => ({
      tiles: document.querySelectorAll('.v2-tile, .v2-sec-hero').length,
      ids: [...document.querySelectorAll('.v2-tile-name')].map(n => n.textContent.trim()),
    }))
    check(after.tiles > before, 'See more lengthens the page', { before, after: after.tiles })
    check(new Set(after.ids).size === after.ids.length, 'without showing the same piece twice')
    check(Array.isArray(sent?.excludeIds) && sent.excludeIds.length > 0,
      'because it tells the backend what is already on screen',
      { excluded: sent?.excludeIds?.length })
  } else {
    check(false, 'a strip offers more of itself')
  }

  // ── 6 · bag from a tile, and the drawer knows ─────────────────────────────
  const bagged = await page.evaluate(() => {
    const b = document.querySelector('.v2-tile .v2-bagbtn') || document.querySelector('.v2-bagbtn')
    if (!b) return null
    b.click()
    return { hearts: document.querySelectorAll('.v2-heart').length }
  })
  check(bagged !== null, 'a tile can be bagged from the grid')
  await sleep(500)
  const badge = await page.evaluate(() => {
    const b = document.querySelector('.v2-tile .v2-bagbtn') || document.querySelector('.v2-bagbtn')
    return { on: b?.classList.contains('on'), hearts: document.querySelectorAll('.v2-heart').length }
  })
  check(badge.on === true, 'and says so')
  check(badge.hearts === 0, 'there is no heart left anywhere — one verb, not two')

  await page.click('.v2-menu-btn'); await sleep(800)
  const drawer = await page.evaluate(() => {
    const items = [...document.querySelectorAll('.v2-menu-nav button')]
    return {
      items: items.map(b => b.textContent.replace(/\s+/g, ' ').trim()),
      bag: items.find(b => /Bag/.test(b.textContent))?.querySelector('em')?.textContent ?? null,
      recents: [...document.querySelectorAll('.v2-menu-recent .v2-recent-row, .v2-menu-recent button')]
        .map(b => b.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 4),
      newChat: !!document.querySelector('.v2-newchat'),
      overlaps: null,
    }
  })
  check(drawer.bag === '1', 'the drawer bag holds what was bagged from the grid', { bag: drawer.bag })
  check(!drawer.items.some(i => /Saved/.test(i)), 'and "Saved" is gone', drawer.items)
  check(drawer.recents.length > 0, 'recents remembers the question', drawer.recents)
  check(drawer.newChat, 'and there is a way to start again')
  await shoot(page, `e2e-${screen.name}-4-drawer`)
  await page.keyboard.press('Escape'); await sleep(700)

  // ── 7 · the product page ──────────────────────────────────────────────────
  const tile = await page.$('.v2-tile-btn, .v2-sec-hero .v2-shot')
  await tile.scrollIntoViewIfNeeded(); await tile.click()
  await page.waitForSelector('.v2-pdp-img', { timeout: 30000 })
  await sleep(2500)

  // Everything below the second photograph is deliberately lazy — a twelve-shot
  // gallery must not fetch twelve full-size files before the first one paints.
  // So the assertion is not "all nine are loaded the instant the page opens",
  // which would be a bug if it were true; it is "scroll the column and every
  // one of them arrives".
  await page.evaluate(async () => {
    const col = document.querySelector('.v2-scroll') || document.scrollingElement
    for (let y = 0; y < col.scrollHeight; y += 600) {
      col.scrollTop = y
      await new Promise(r => setTimeout(r, 140))
    }
  })
  await sleep(2500)

  const pdp = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('.v2-pdp-img')]
    const rects = imgs.map(i => i.getBoundingClientRect())
    const col = document.querySelector('.v2-pdp-col')?.getBoundingClientRect()
    const loaded = imgs.filter(i => i.complete !== false && (i.naturalWidth ?? 1) > 0).length
    return {
      count: imgs.length,
      loaded,
      vertical: rects.every((r, i) => i === 0 || r.top >= rects[i - 1].top - 1),
      widths: [...new Set(rects.map(r => Math.round(r.width)))],
      centred: col ? Math.abs((col.left + col.width / 2) - innerWidth / 2) < 3 : null,
      sideways: document.documentElement.scrollWidth > innerWidth + 1,
      buy: document.querySelector('.v2-buy')?.textContent?.trim() ?? null,
      materials: [...document.querySelectorAll('.v2-mat-list li')].map(l => l.textContent.trim()),
      pills: [...document.querySelectorAll('.v2-pill')].map(b => b.textContent.replace(/\s+/g, ' ').trim()),
    }
  })
  check(pdp.count >= 6, 'the product page shows every photograph, not a thumbnail', { images: pdp.count })
  check(pdp.loaded === pdp.count, 'and every one of them arrives as you scroll to it',
    { loaded: pdp.loaded, of: pdp.count })
  check(pdp.vertical, 'stacked top to bottom — a column, never a filmstrip')
  check(pdp.widths.length === 1, 'one column width, so nothing is out of line', { widths: pdp.widths })
  check(pdp.centred === true, 'centred in the window')
  check(!pdp.sideways, 'and the page still does not scroll sideways')
  check(pdp.buy === 'Checkout', 'the action is Checkout, not add-to-cart', { action: pdp.buy })
  check(pdp.materials.length === 0 || pdp.materials.every(m => !/[_{}]|^[a-z]+[A-Z]/.test(m)),
    'materials read as facts, not as keys out of a database', pdp.materials.slice(0, 3))
  await shoot(page, `e2e-${screen.name}-5-pdp`)

  // ── 8 · colour lives in the dock, and it changes the pictures ─────────────
  const colourPill = pdp.pills.find(p => COLOURWAYS.some(c => new RegExp(c.name, 'i').test(p)))
  check(!!colourPill, 'the dock names the colour you are looking at', { pills: pdp.pills })
  const strayRow = await page.evaluate(() => document.querySelectorAll('.v2-pdp-colors button').length)
  check(strayRow === 0, 'and there is no second swatch row floating over the photographs')

  // "The colours change the pictures" means the photographs, not the dock's
  // own thumbnail — the lead shot on the page is what a shopper is looking at
  // when they tap a swatch.
  const shotBefore = await page.evaluate(() =>
    document.querySelector('.v2-pdp-img')?.getAttribute('src')?.slice(-64) ?? null)
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.v2-pill')].find(x => /navy|camel|ink|colour|color/i.test(x.textContent))
    b?.click()
  })
  await sleep(700)
  const swatches = await page.evaluate(() => document.querySelectorAll('.v2-swatches button').length)
  check(swatches >= 2, 'the colourways open in the dock beside the sizes', { swatches })
  await page.evaluate(() => {
    const all = [...document.querySelectorAll('.v2-swatches button')]
    const off = all.find(b => !b.classList.contains('on')) || all[1]
    off?.click()
  })
  await sleep(900)
  const shotAfter = await page.evaluate(() => ({
    lead: document.querySelector('.v2-pdp-img')?.getAttribute('src')?.slice(-64) ?? null,
    named: document.querySelector('.v2-cart-color')?.textContent?.trim() ?? null,
  }))
  check(shotAfter.lead !== shotBefore, 'choosing a colour changes the photographs',
    { named: shotAfter.named })

  // ── 9 · checkout stops and asks, because nobody is signed in ──────────────
  await page.evaluate(() => {
    const p = [...document.querySelectorAll('.v2-pill')].find(b => /Select size|Size /.test(b.textContent))
    p?.click()
  })
  await sleep(600)
  await page.evaluate(() => {
    const m = [...document.querySelectorAll('.v2-sizes button')].find(b => b.textContent.trim() === 'M')
    m?.click()
  })
  await sleep(600)
  await page.evaluate(() => document.querySelector('.v2-buy')?.click())
  await sleep(1600)
  const gate = await page.evaluate(() => ({
    opened: window.__opened.length,
    sheet: !!document.querySelector('.v2a-card'),
    exit: !!document.querySelector('.v2a-x, .v2a-handle'),
  }))
  check(gate.opened === 0, 'checkout does not send anybody to a store without an account')
  check(gate.sheet === true, 'it asks them to sign in first')
  // A sheet you cannot leave is a trap, and this one had no handle, no ✕, a
  // guarded backdrop and a guarded Escape. Changing your mind after pressing
  // Checkout is an ordinary thing to do.
  check(gate.exit === true, 'and there is a way back out of it')
  await shoot(page, `e2e-${screen.name}-6-gate`)
  await page.keyboard.press('Escape'); await sleep(800)
  check(!(await page.$('.v2a-card')), 'Escape really closes it')

  // ── 10 · overlap sweep, on the busiest screen in the app ──────────────────
  const collide = await page.evaluate(OVERLAP)
  check(collide.length === 0, 'nothing overlaps on the product page', collide)

  // ── 11 · the pin survives the walk back, and comes back as a comparison ───
  await page.evaluate(() => document.querySelector('.v2-back')?.click())
  await sleep(1200)
  const pin = await page.evaluate(() => {
    const c = document.querySelector('.v2-pinned')
    const bar = document.querySelector('.v2-bar')
    return { there: !!c, inBar: !!(c && bar && bar.contains(c)), text: c?.querySelector('span')?.textContent?.trim() ?? null }
  })
  check(pin.there && pin.inBar, 'the piece you opened is still the subject when you come back', pin)

  const ta2 = await page.$('textarea')
  await ta2.click(); await ta2.type('is this better than a blend')
  await sleep(250)
  await page.click('.v2-send')
  await page.waitForSelector('.v2-cmp-grid', { timeout: 30000 })
  await sleep(900)
  const cmp = await page.evaluate(() => ({
    labels: [...document.querySelectorAll('.v2-cmp-label')].map(x => x.textContent.trim()),
    won: document.querySelectorAll('.v2-cmp-cell.won').length,
    pick: document.querySelector('.v2-cmp-pick')?.textContent?.trim() ?? null,
    fits: (document.querySelector('.v2-cmp-grid')?.getBoundingClientRect().right ?? 0) <= innerWidth + 0.5,
  }))
  check(cmp.labels.length === 3, 'a question about a pinned piece answers as a table', cmp.labels)
  check(cmp.won === 3, 'with the recommendation marked in every row')
  check(/Supima/.test(cmp.pick || ''), 'and the reason given')
  check(cmp.fits, 'and it fits the screen')
  check(Array.isArray(sent?.products) && sent.products.length === 1,
    'the pinned piece really went with the question', { carried: sent?.products?.length })
  check(!(await page.$('.v2-pinned')), 'and the pin clears once it has been asked')

  // ── 12 · the wordmark goes home, and does not lose the session ────────────
  await page.click('.v2-brand'); await sleep(1000)
  const back = await page.evaluate(() => ({
    home: !!document.querySelector('.v2-hero-copy'),
    results: !!document.querySelector('.v2-results'),
  }))
  check(back.home && !back.results, 'DISCERN | BETA goes home', back)

  // ── 13 · a reload keeps the session ──────────────────────────────────────
  // A recent takes you back to that search, and that restored page is what
  // has to survive a reload. Both halves matter: the drawer entry has to run,
  // and the result has to still be there after F5.
  await page.click('.v2-menu-btn'); await sleep(800)
  const recentGo = await page.$('.v2-recent-go')
  check(!!recentGo, 'a recent search can be reopened from the drawer')
  await recentGo.click()
  await page.waitForSelector('.v2-results', { timeout: 60000 })
  await sleep(1500)
  const bagCount = () => page.evaluate(() => {
    const b = [...document.querySelectorAll('.v2-menu-nav button')].find(x => /Bag/.test(x.textContent))
    return b?.querySelector('em')?.textContent ?? null
  })
  const preReload = await page.evaluate(() => ({
    results: !!document.querySelector('.v2-results'),
    headings: [...document.querySelectorAll('.v2-sec h2')].map(h => h.textContent.trim()),
  }))
  // Two by now, and both on purpose: one bagged off the grid, and the piece
  // that went through Checkout — pressing Checkout puts it in the bag so it is
  // where you would look for it if you come back.
  const bagBefore = await bagCount()
  check(preReload.results && preReload.headings.length === 2,
    'and it comes back as the page it was', preReload.headings)

  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('textarea', { timeout: 60000 })
  await sleep(5000)
  const postReload = await page.evaluate(() => ({
    results: !!document.querySelector('.v2-results'),
    headings: [...document.querySelectorAll('.v2-sec h2')].map(h => h.textContent.trim()),
    home: !!document.querySelector('.v2-hero-copy'),
  }))
  check(postReload.results && !postReload.home,
    'a refresh does not throw the session away', postReload)
  check(JSON.stringify(postReload.headings) === JSON.stringify(preReload.headings),
    'the same page comes back, not a re-run',
    { before: preReload.headings, after: postReload.headings })
  const bagAfter = await bagCount()
  check(bagAfter === bagBefore && Number(bagAfter) >= 1,
    'and the bag is still holding what was put in it', { before: bagBefore, after: bagAfter })

  // ── 14 · the model dies mid-session and the clothes still arrive ──────────
  scene = 'dead'
  catalogueHas = SHIRTS
  await page.evaluate(() => document.querySelector('.v2-newbtn')?.click())
  await sleep(900)
  const ta3 = await page.$('textarea')
  await ta3.click(); await ta3.type('a shirt for a wedding')
  await sleep(250)
  await page.click('.v2-send')
  await sleep(9000)
  const rescued = await page.evaluate(() => ({
    results: !!document.querySelector('.v2-results'),
    tiles: document.querySelectorAll('.v2-tile, .v2-sec-hero').length,
    apology: document.querySelector('.v2-empty h2')?.textContent?.trim() ?? null,
    home: !!document.querySelector('.v2-hero-copy'),
  }))
  check(rescued.results && rescued.tiles > 0,
    'the model going down does not empty the screen — the catalogue answers', rescued)
  check(!rescued.apology, 'and it is clothes, not an apology')
  check(!rescued.home, 'and it never dumps the shopper back on the home page')
  await shoot(page, `e2e-${screen.name}-7-rescued`)

  // ── 15 · and when even the catalogue has nothing, it says so plainly ──────
  catalogueHas = []
  await page.evaluate(() => document.querySelector('.v2-newbtn')?.click())
  await sleep(900)
  const ta4 = await page.$('textarea')
  await ta4.click(); await ta4.type('a hand knitted balaclava in vicuna')
  await sleep(250)
  await page.click('.v2-send')
  await sleep(9000)
  const nothing = await page.evaluate(() => ({
    heading: document.querySelector('.v2-empty h2')?.textContent?.trim() ?? null,
    retry: !!document.querySelector('.v2-retry'),
    home: !!document.querySelector('.v2-hero-copy'),
    loading: !!document.querySelector('.v2-crafting'),
  }))
  check(!!nothing.heading, 'a dead end is stated on the page', nothing)
  check(nothing.retry, 'with a way to try again')
  check(!nothing.home, 'and still not a bounce to the home page')
  check(!nothing.loading, 'and the spinner stopped')

  // ── 16 · a plain question is a conversation, not a search ─────────────────
  scene = 'search'
  await page.unroute('**/api/ai/stylist')
  await page.route('**/api/ai/stylist', r => r.fulfill({
    status: 200, contentType: 'application/x-ndjson',
    body: ndjson({ type: 'result', reply: 'Navy and olive sit in the same cool family, so they read as one palette.' }),
  }))
  await page.evaluate(() => document.querySelector('.v2-newbtn')?.click())
  await sleep(900)
  const ta5 = await page.$('textarea')
  await ta5.click(); await ta5.type('does navy go with olive')
  await sleep(250)
  await page.click('.v2-send')
  await sleep(4500)
  const chat = await page.evaluate(() => {
    const said = document.querySelector('.v2-bar-said')
    const bar = document.querySelector('.v2-bar')
    return {
      said: !!said,
      inBar: !!(said && bar && bar.contains(said)),
      text: said?.querySelector('p')?.textContent?.trim() ?? null,
      empty: !!document.querySelector('.v2-empty'),
      bars: document.querySelectorAll('.v2-bar').length,
    }
  })
  check(chat.said && chat.inBar, 'an answer in words lands inside the composer', { bars: chat.bars })
  check(/navy/i.test(chat.text || ''), 'and it is the whole answer', { text: (chat.text || '').slice(0, 40) })
  check(!chat.empty, 'a conversation is not an error')

  // ── 17 · overlap sweep on the home screen and the results ────────────────
  const homeCollide = await page.evaluate(OVERLAP)
  check(homeCollide.length === 0, 'nothing overlaps on the home screen', homeCollide)

  // A sweep that cannot fail proves nothing. Put two elements on top of each
  // other in the ordinary flow and make sure it says so, then take them away.
  const canFail = await page.evaluate(sweep => {
    const host = document.createElement('div')
    host.style.cssText = 'position:relative;width:200px;height:60px'
    host.innerHTML = '<p style="position:absolute;left:0;top:0;width:180px;height:40px">one</p>'
      + '<p style="position:absolute;left:10px;top:6px;width:180px;height:40px">two</p>'
    // Both children are out of flow, which the sweep skips — so re-home them
    // as static boxes forced onto the same spot with a negative margin.
    host.innerHTML = '<p style="margin:0;width:180px;height:40px">one</p>'
      + '<p style="margin:-36px 0 0;width:180px;height:40px">two</p>'
    document.body.appendChild(host)
    const found = new Function('return (' + sweep + ')()')()
    host.remove()
    return found.length
  }, OVERLAP.toString())
  check(canFail > 0, 'and the sweep would have said so if anything did', { caught: canFail })

  // ── 18 · nothing threw ───────────────────────────────────────────────────
  const pageErrors = await page.evaluate(() => window.__e2e.errors)
  check(crashes.length === 0, 'no uncaught exception during the whole journey', crashes.slice(0, 3))
  check(pageErrors.length === 0, 'and nothing errored in the window either', pageErrors.slice(0, 3))

  await ctx.close()
  return fails
}

// ── the live pass ───────────────────────────────────────────────────────────
/** Stubs prove the interface. This proves the two endpoints behind it are
 *  really talking to brand stores and a model — separately, so an outage
 *  reports as an outage rather than as a broken app. */
async function live() {
  console.log(`\n══ live · real endpoints ${'═'.repeat(31)}`)
  const { check, fails } = reporter('live')
  const post = async (route, body, ms) => {
    const c = new AbortController()
    const t = setTimeout(() => c.abort(), ms)
    try {
      const r = await fetch(BASE + route, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: c.signal,
      })
      return { ok: r.ok, text: await r.text() }
    } catch (e) {
      return { ok: false, text: String(e) }
    } finally { clearTimeout(t) }
  }

  const cat = await post('/api/catalog/search',
    { q: 'shirts and trousers', gender: 'men', country: 'IN', currency: 'INR' }, 70000)
  let parsed = null
  try { parsed = JSON.parse(cat.text) } catch { /* reported below */ }
  const groups = (parsed?.groups ?? []).map(g => `${g.label}(${g.products.length})`)
  check(cat.ok && (parsed?.products?.length ?? 0) > 0,
    'the catalogue answers without a model', { products: parsed?.products?.length ?? 0, groups })
  check(groups.length >= 2, 'and two garments still come back as two strips', groups)

  const sty = await post('/api/ai/stylist', { question: 'i need shoes' }, 90000)
  let result = null
  for (const line of sty.text.split('\n')) {
    const t = line.trim(); if (!t) continue
    try { const o = JSON.parse(t); if (o.type === 'result') result = o } catch { /* partial */ }
  }
  check(sty.ok, 'the stylist route responds')
  check((result?.foundProducts?.length ?? 0) > 0 || (result?.foundProductGroups?.length ?? 0) > 0,
    'and brings back real pieces', { products: result?.foundProducts?.length ?? 0, busy: result?.busy ?? false })

  // Not an assertion: a provider being out of quota is somebody else's
  // outage, and failing the run over it would teach everyone to ignore the
  // run. It is printed so the number is in front of you when the answers get
  // worse.
  try {
    const s = await fetch(BASE + '/api/ai/stylist/status')
    console.log('  providers:', (await s.text()).slice(0, 300))
  } catch { console.log('  providers: unreachable') }
  return fails
}

;(async () => {
  // A sandbox that reaches the outside world through a proxy has to tell the
  // browser about it too, or every run against a deployed URL reports as a
  // connection reset and looks like the site is down.
  const all = []
  if (!ONLY_LIVE) {
    const proxy = process.env.HTTPS_PROXY || process.env.https_proxy
    const browser = await chromium.launch({
      executablePath: CHROME,
      args: ['--no-sandbox'],
      ...(proxy && !BASE.startsWith('http://localhost') ? { proxy: { server: proxy } } : {}),
    })
    try {
      for (const screen of SCREENS) {
        try { all.push(...(await journey(browser, screen))) }
        catch (e) { all.push(`${screen.name}: the journey stopped — ${e.message}`); console.log(`  STOP  ${e.message}`) }
      }
    } finally { await browser.close() }
  }

  if (LIVE) {
    try { all.push(...(await live())) }
    catch (e) { all.push(`live: ${e.message}`) }
  }

  console.log('\n' + '═'.repeat(60))
  if (!all.length) {
    console.log(ONLY_LIVE ? 'All good. The endpoints answer.' : 'All good. The journey holds at every width.')
  }
  else {
    console.log(`${all.length} failing:`)
    for (const f of all) console.log('  · ' + f)
  }
  process.exit(Math.min(all.length, 250))
})().catch(e => { console.error('HARNESS FAILED', e); process.exit(255) })
