/**
 * Pick a colour, and does the whole page follow?
 *
 * Reported on AGAMA - SKY DENIM, a sandal in four colourways. True Black was
 * selected and the page showed:
 *
 *   the lead photograph   black       correct
 *   every shot under it   blue        the default colourway
 *   the checkout strip    blue        under the words "True Black"
 *
 * The last one is the expensive one: a wrong picture beside a Checkout button.
 *
 * And separately: opening any piece showed a soft, blurred photograph that
 * sharpened a few seconds later. The catalogue hands over ?width=400 — a tile
 * size — and the product page draws it across the full column, so the first
 * thing anyone sees is a thumbnail stretched to three times its size until
 * /api/product-images returns the same shots at 2048.
 *
 * The fixture below is built to produce exactly those conditions: four
 * colourways, per-variant media, a byColor map whose keys are cased
 * DIFFERENTLY from the swatch names (which is the real-world mismatch — one
 * comes from the store's products.json, the other from the UCP feed), and
 * catalogue URLs at width=400.
 */
const { chromium } = require('/home/user/From/web/node_modules/playwright-core')

const CDN = 'https://cdn.shopify.com/s/files/1/0001/agama'
const shot = (name, w = 400) => `${CDN}/${name}.jpg?width=${w}`

const COLOURS = ['Sky Denim', 'True Black', 'Rust', 'Olive']
const variant = (colour, size, n) => ({
  id: `gid://v/${colour}-${size}`,
  title: `${colour} / ${size}`,
  availability: true,
  options: [{ name: 'Colour', label: colour }, { name: 'Size', label: size }],
  media: [{ url: shot(`${colour.toLowerCase().replace(/ /g, '-')}-${n}`) }],
})

const PRODUCT = {
  id: 'gid://shopify/Product/agama',
  title: 'AGAMA - SKY DENIM',
  handle: 'agama-sky-denim',
  vendor: 'Tezzo',
  price: 1799, currency: 'INR', display_price: 1799, display_currency: 'INR',
  store_url: 'https://tezzo.example.com/products/agama-sky-denim',
  image_url: shot('sky-denim-1'),
  media: [{ url: shot('sky-denim-1') }, { url: shot('sky-denim-2') }],
  in_stock: true,
  description: 'A cork-footbed slide in washed denim.',
  options: [
    { name: 'Colour', values: COLOURS },
    { name: 'Size', values: ['7', '8', '9'] },
  ],
  variants: COLOURS.flatMap(c => [variant(c, '7', 1), variant(c, '8', 2)]),
  tags: ['sandal'],
}

// Keys deliberately upper-cased: the store and the feed spell it differently,
// and an exact-match lookup between them is what silently missed.
const BY_COLOR = {}
for (const c of COLOURS) {
  BY_COLOR[c.toUpperCase()] = [
    shot(`${c.toLowerCase().replace(/ /g, '-')}-1`, 2048),
    shot(`${c.toLowerCase().replace(/ /g, '-')}-2`, 2048),
  ]
}

const colourOf = (url) => COLOURS.find(c => url.includes(c.toLowerCase().replace(/ /g, '-'))) ?? '?'

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

  for (const [name, w, h] of [['phone 390', 390, 844], ['iPad 1180', 1180, 820]]) {
    console.log(`\n── ${name} ${'─'.repeat(Math.max(0, 56 - name.length))}`)
    const ctx = await b.newContext({ viewport: { width: w, height: h } })
    const p = await ctx.newPage()

    // Every product photograph resolves to a coloured plate, so what is on
    // screen can be read back without the network.
    await p.route('**/cdn.shopify.com/**', route => {
      const fill = { 'Sky Denim': '#6f9fd8', 'True Black': '#242424', Rust: '#b4552f', Olive: '#6b7a45' }[colourOf(route.request().url())] ?? '#ccc'
      route.fulfill({ status: 200, contentType: 'image/svg+xml',
        body: `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="700"><rect width="600" height="700" fill="${fill}"/></svg>` })
    })
    await p.route('**/api/featured', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"products":[]}' }))
    await p.route('**/api/product-names', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"names":{}}' }))
    await p.route('**/api/product-images**', r => r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ images: BY_COLOR['SKY DENIM'], colors: COLOURS, byColor: BY_COLOR }) }))
    await p.route('**/api/ai/stylist', r => r.fulfill({ status: 200, contentType: 'application/x-ndjson',
      body: JSON.stringify({ type: 'result', reply: 'Here.', searchQuery: 'denim sandals', foundProducts: [PRODUCT] }) + '\n' }))

    await p.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded', timeout: 120000 })
    await p.waitForSelector('textarea', { timeout: 60000 })
    await p.waitForTimeout(2000)
    const ta = await p.$('textarea')
    await ta.click(); await ta.type('denim sandals')
    await p.waitForTimeout(150); await p.click('.v2-send')
    await p.waitForTimeout(3500)

    const tile = await p.$('.v2-tile-btn, .v2-sec-hero .v2-shot')
    if (!tile) { check(false, 'the product opens'); await ctx.close(); continue }
    await tile.scrollIntoViewIfNeeded(); await tile.click()
    await p.waitForSelector('.v2-pdp-img', { timeout: 20000 })
    await p.waitForTimeout(2500)

    // ── the blur ────────────────────────────────────────────────────────────
    const first = await p.$eval('.v2-pdp-img', el => ({ src: el.getAttribute('src'), drawn: el.getBoundingClientRect().width }))
    const asked = Number(new URL(first.src).searchParams.get('width') || 0)
    check(asked >= first.drawn, 'the first photograph is asked for at least as wide as it is drawn',
      `asked ${asked}px, drawn ${Math.round(first.drawn)}px`)
    check(asked > 400, 'not the catalogue tile size', `${asked}px`)

    // ── the colourway ───────────────────────────────────────────────────────
    await p.click('.v2-pill')                       // the colour pill
    await p.waitForTimeout(500)
    const swatch = await p.$(`.v2-picker button[aria-label*="True Black"], .v2-picker button:nth-child(2)`)
    if (swatch) { await swatch.click() } else {
      await p.evaluate(() => {
        const b = [...document.querySelectorAll('.v2-picker button')].find(x => /true black/i.test(x.textContent || x.getAttribute('aria-label') || ''))
        b?.click()
      })
    }
    await p.waitForTimeout(1200)

    const after = await p.evaluate(() => ({
      gallery: [...document.querySelectorAll('.v2-pdp-img')].map(el => el.getAttribute('src')),
      thumb: document.querySelector('.v2-cart-thumb')?.getAttribute('src') ?? null,
      label: document.querySelector('.v2-cart-color')?.textContent ?? '',
    }))

    const galleryColours = after.gallery.map(colourOf)
    check(after.label.includes('True Black'), 'the strip says the colour that was picked', after.label.trim())
    check(galleryColours.every(c => c === 'True Black'),
      'EVERY photograph on the page is that colourway', `[${galleryColours.join(', ')}]`)
    check(after.thumb && colourOf(after.thumb) === 'True Black',
      'and so is the picture beside Checkout', after.thumb ? colourOf(after.thumb) : 'missing')

    await ctx.close()
  }

  await b.close()
  console.log('\n' + (bad === 0
    ? 'the colour you pick is the colour on every photograph, sharp from the first paint'
    : `${bad} FAILED`))
  process.exit(bad === 0 ? 0 : 1)
})()
