/**
 * The evaluation set. §55–58.
 *
 * WHY THIS IS THE MOST IMPORTANT SCRIPT IN THE REPOSITORY.
 *
 * Every quality change made this week was checked the same way: run one query
 * by hand, read the answer, decide whether it looked better. That finds the bug
 * in front of you and it cannot see the three you just caused somewhere else.
 * It is also unrepeatable — nobody can run "did it look better" again next
 * month against a different model.
 *
 * This turns "the recommendations feel bad" into a number that moves.
 *
 * WHAT IT DOES NOT DO, on purpose: it calls no model and hits no network. The
 * layers under test are the DETERMINISTIC ones — which occasion a sentence
 * names, which garments, which products are the right category, whether two
 * pieces go together, what a stranded reply should have asked. Those decide
 * what is even eligible to be retrieved, so they set the ceiling on everything
 * a model does afterwards; and being deterministic they can run on every push,
 * in under a second, for nothing, while three of four provider pools are out of
 * quota. A live end-to-end suite is worth building too, and it is a different
 * thing with a different cost.
 *
 * Failures are labelled with the §58 taxonomy so a run says what KIND of wrong
 * it got, not just how many.
 */
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const WEB = path.resolve(__dirname, '..')
function load(tsPath, name) {
  const out = path.join(WEB, '.vt', name + '.cjs')
  fs.mkdirSync(path.join(WEB, '.vt'), { recursive: true })
  execFileSync(path.join(WEB, 'node_modules/.bin/esbuild'), [
    path.join(WEB, tsPath), '--bundle', '--platform=node', '--format=cjs',
    '--outfile=' + out, '--log-level=error', '--alias:@=' + WEB,
  ])
  return require(out)
}

const qp = load('lib/queryParser.ts', 'qp')
const ok = load('lib/fashion/outfitKnowledge.ts', 'ok')
const gp = load('lib/fashion/garmentProfile.ts', 'gp')
const em = load('lib/fashion/exactMatch.ts', 'em')
const sq = load('lib/fashion/suggestQuery.ts', 'sq')
const an = load('lib/stylist/answer.ts', 'an')
const rt = load('lib/intent/routing.ts', 'rt')

const S = JSON.parse(fs.readFileSync(path.join(WEB, 'eval/scenarios.json'), 'utf8'))

// ── §58 error taxonomy ──────────────────────────────────────────────────────
const failures = []
const fail = (label, id, detail) => failures.push({ label, id, detail })
let ran = 0

const arr = (x) => (Array.isArray(x) ? x : [])
const has = (list, want) => want.every(w => list.includes(w))

// ── occasion ────────────────────────────────────────────────────────────────
for (const c of arr(S.occasion)) {
  if (!c.q) continue
  ran++
  const got = ok.readOccasion(c.q)
  const key = got ? got.key : null
  if (key !== c.occasion) {
    fail('wrong_occasion', c.id, `"${c.q}" → ${key} (want ${c.occasion})`)
    continue
  }
  if (c.formality != null && got && got.formality !== c.formality) {
    fail('wrong_formality', c.id, `${key} formality ${got.formality} (want ${c.formality})`)
  }
  if (c.season != null) {
    const season = ok.readSeason(c.q)
    if (season !== c.season) fail('wrong_season', c.id, `season ${season} (want ${c.season})`)
  }
  if (c.fabrics) {
    const plan = ok.outfitPlan(c.q, c.gender)
    const fabrics = arr(plan && plan.fabrics)
    if (!c.fabrics.some(f => fabrics.some(g => g.includes(f)))) {
      fail('wrong_material', c.id, `fabrics [${fabrics.join(', ')}] (want one of ${c.fabrics.join(', ')})`)
    }
  }
  if (c.slots) {
    const plan = ok.outfitPlan(c.q, c.gender)
    const slots = arr(plan && plan.slots)
    if (!has(slots, c.slots)) {
      fail('missing_constraint', c.id, `slots [${slots.join(', ')}] (want ${c.slots.join(', ')})`)
    }
  }
}

// ── garment extraction ──────────────────────────────────────────────────────
for (const c of arr(S.garments)) {
  if (!c.q) continue
  ran++
  const d = qp.decomposeQuery(c.q)
  const keys = arr(d.garmentKeys)
  if (c.garments && !has(keys, c.garments)) {
    fail('wrong_category', c.id, `"${c.q}" → [${keys.join(', ')}] (want ${c.garments.join(', ')})`)
  }
  for (const banned of arr(c.notGarments)) {
    if (keys.includes(banned)) fail('wrong_category', c.id, `"${c.q}" wrongly read as ${banned}`)
  }
  if (c.garments && c.garments.length === 0 && keys.length > 0) {
    fail('wrong_category', c.id, `"${c.q}" invented garments [${keys.join(', ')}]`)
  }
  for (const m of arr(c.materials)) {
    if (!arr(d.materials).includes(m)) fail('wrong_material', c.id, `missed material ${m}`)
  }
  for (const col of arr(c.colors)) {
    if (!arr(d.colors).includes(col)) fail('wrong_color', c.id, `missed colour ${col}`)
  }
  for (const f of arr(c.fits)) {
    if (!arr(d.fits).includes(f)) fail('wrong_fit', c.id, `missed fit ${f}`)
  }
}

// ── category correctness (§26) ──────────────────────────────────────────────
const hay = (t, tags) => `${t} ${arr(tags).join(' ')}`.toLowerCase().replace(/[_/|>]+/g, ' ')
for (const c of arr(S.categoryCorrectness)) {
  if (!c.key) continue
  ran++
  const entry = qp.GARMENT_VOCAB[c.key]
  if (!entry) { fail('wrong_category', c.id, `unknown garment key ${c.key}`); continue }
  const got = qp.matchesGarmentExclusion(hay(c.title, c.tags), entry.product)
  if (got !== c.excluded) {
    fail('wrong_category', c.id,
      `${c.excluded ? 'should be excluded from' : 'should survive'} ${c.key}: "${c.title}"`)
  }
}

// ── compatibility (§96) ─────────────────────────────────────────────────────
const P = (o) => Object.assign({
  garment: 'shirt', fit: 'regular', volume: 'fitted', fabric: 'cotton',
  weight: 'mid', drape: 'crisp', pattern: 'plain', patternScale: 'none',
  colour: 'white', formality: 3, aesthetic: 'minimal', season: 'all',
  details: [], quality: 2,
}, o)
const PIECES = {
  formalBlazer:        P({ garment: 'blazer', formality: 5, fabric: 'wool', drape: 'structured', aesthetic: 'tailored', colour: 'black', weight: 'mid' }),
  gymShort:            P({ garment: 'short', formality: 1, fabric: 'polyester', drape: 'fluid', aesthetic: 'sport', colour: 'black', weight: 'light' }),
  summerLinenShirt:    P({ garment: 'shirt', formality: 2, fabric: 'linen', season: 'summer', weight: 'light', drape: 'fluid', colour: 'ecru' }),
  winterTweedTrouser:  P({ garment: 'trouser', formality: 3, fabric: 'tweed', season: 'winter', weight: 'heavy', drape: 'structured', colour: 'charcoal' }),
  largeFloralShirt:    P({ garment: 'shirt', pattern: 'floral', patternScale: 'large', formality: 2, fabric: 'blend', colour: 'cream', season: 'summer' }),
  largeCheckTrouser:   P({ garment: 'trouser', pattern: 'check', patternScale: 'large', formality: 3, fabric: 'wool', colour: 'charcoal', season: 'winter' }),
  canvasSneaker:       P({ garment: 'sneaker', formality: 2, fabric: 'canvas', aesthetic: 'sport', colour: 'white' }),
  boxyLinenShirt:      P({ garment: 'shirt', volume: 'boxy', fit: 'relaxed', fabric: 'linen', formality: 2, colour: 'ecru', season: 'summer', drape: 'fluid', weight: 'light' }),
  wideCreamTrouser:    P({ garment: 'trouser', fit: 'wide', volume: 'boxy', fabric: 'cotton', formality: 2, colour: 'cream', season: 'summer', drape: 'fluid', weight: 'light' }),
  woolTrouser:         P({ garment: 'trouser', formality: 4, fabric: 'wool', drape: 'structured', aesthetic: 'tailored', colour: 'charcoal' }),
  tanLoafer:           P({ garment: 'loafer', formality: 3, fabric: 'leather', colour: 'tan', drape: 'structured' }),
}
for (const c of arr(S.compatibility)) {
  if (!c.a) continue
  ran++
  const a = PIECES[c.a], b = PIECES[c.b]
  if (!a || !b) { fail('bad_combination', c.id, `unknown piece ${c.a}/${c.b}`); continue }
  const score = gp.worksWith(a, b)
  if (c.max != null && score > c.max) {
    fail('bad_combination', c.id, `${c.a} + ${c.b} scored ${score.toFixed(2)} (must be ≤ ${c.max})`)
  }
  if (c.min != null && score < c.min) {
    fail('bad_combination', c.id, `${c.a} + ${c.b} scored ${score.toFixed(2)} (must be ≥ ${c.min})`)
  }
}

// ── exact-piece intent ──────────────────────────────────────────────────────
for (const c of arr(S.exactIntent)) {
  if (!c.q) continue
  ran++
  const got = em.wantsTheExactPiece(c.q)
  if (got !== c.exact) {
    fail('wrong_product_relevance', c.id, `"${c.q}" read as ${got ? 'exact' : 'similar'}`)
  }
}

// ── the suggested query, when a reply has nothing to buy ────────────────────
for (const c of arr(S.suggestion)) {
  if (!c.q) continue
  ran++
  const line = sq.suggestQuery(c.q, c.reply, c.gender)
  if (c.expectNull) {
    if (line) fail('poor_personalization', c.id, `should stay quiet, offered "${line}"`)
    continue
  }
  if (!line) { fail('missing_constraint', c.id, 'offered nothing'); continue }
  const d = qp.decomposeQuery(line)
  if (arr(d.garmentKeys).length < (c.minGarments || 1)) {
    fail('wrong_category', c.id, `"${line}" names ${arr(d.garmentKeys).length} garment(s)`)
  }
  if (!d.gender) fail('missing_constraint', c.id, `"${line}" states no gender`)
  if (arr(d.materials).length + arr(d.colors).length > 2) {
    fail('missing_constraint', c.id, `"${line}" carries too many mandatory adjectives`)
  }
  if (/[*_`#]/.test(line)) fail('hallucinated_fact', c.id, `"${line}" carries markdown`)
}

// ── intent routing: which path does this sentence take? ─────────────────────
for (const c of arr(S.routing)) {
  if (!c.q) continue
  ran++
  if (c.heavy !== undefined && rt.isHeavyQuery(c.q) !== c.heavy) {
    fail('missing_constraint', c.id, `"${c.q}" routed ${rt.isHeavyQuery(c.q) ? 'heavy' : 'light'} (want ${c.heavy ? 'heavy' : 'light'})`)
  }
  if (c.greeting !== undefined && rt.isBareGreeting(c.q) !== c.greeting) {
    fail('conversation_state_loss', c.id, `"${c.q}" read as ${rt.isBareGreeting(c.q) ? 'a bare greeting' : 'a request'}`)
  }
  if (c.reaction !== undefined && rt.isReactionOnly(c.q) !== c.reaction) {
    fail('conversation_state_loss', c.id, `"${c.q}" read as ${rt.isReactionOnly(c.q) ? 'feedback' : 'a request'}`)
  }
  if (c.product !== undefined && rt.isProductIntent(c.q) !== c.product) {
    fail('wrong_product_relevance', c.id, `"${c.q}" product intent ${rt.isProductIntent(c.q)}`)
  }
  if (c.follow !== undefined && rt.isActionFollowThrough(c.q, c.last || '') !== c.follow) {
    fail('conversation_state_loss', c.id, `"${c.q}" after "${(c.last || '').slice(0, 30)}" → ${rt.isActionFollowThrough(c.q, c.last || '')}`)
  }
  if (c.slotLabel && rt.outfitSlotInfo(c.q).label !== c.slotLabel) {
    fail('wrong_category', c.id, `"${c.q}" labelled ${rt.outfitSlotInfo(c.q).label} (want ${c.slotLabel})`)
  }
  if (c.clean && rt.cleanSubQuery(c.q) !== c.clean) {
    fail('missing_constraint', c.id, `"${c.q}" cleaned to "${rt.cleanSubQuery(c.q)}" (want "${c.clean}")`)
  }
  if (c.keys) {
    const got = rt.separatedGarmentKeys(c.q)
    if (!has(got, c.keys) || got.length !== c.keys.length) {
      fail('wrong_category', c.id, `"${c.q}" → [${got.join(', ')}] (want ${c.keys.join(', ')})`)
    }
  }
}

// ── §44: the answer contract ────────────────────────────────────────────────
for (const c of arr(S.answerContract)) {
  if (c.raw === undefined) continue
  ran++
  const a = an.parseStylistAnswer(c.raw)
  if (c.via && a.via !== c.via) {
    fail('hallucinated_fact', c.id, `read via ${a.via} (want ${c.via})`)
    continue
  }
  if (c.search && a.search !== c.search) {
    fail('missing_constraint', c.id, `search ${JSON.stringify(a.search)} (want ${JSON.stringify(c.search)})`)
  }
  if (c.noSearch && (a.search || a.outfit || a.outfits)) {
    fail('hallucinated_fact', c.id, 'invented an instruction from an answer that carried none')
  }
  if (c.reply && a.reply !== c.reply) {
    fail('missing_constraint', c.id, `reply ${JSON.stringify(a.reply)} (want ${JSON.stringify(c.reply)})`)
  }
  if (c.outfit && JSON.stringify(a.outfit) !== JSON.stringify(c.outfit)) {
    fail('missing_constraint', c.id, `outfit ${JSON.stringify(a.outfit)}`)
  }
  if (c.outfits && arr(a.outfits).length !== c.outfits) {
    fail('missing_constraint', c.id, `${arr(a.outfits).length} looks (want ${c.outfits})`)
  }
  if (c.noOutfit && a.outfit) {
    fail('missing_constraint', c.id, 'read several looks as one')
  }
  if (c.outfitLen != null && arr(a.outfit).length !== c.outfitLen) {
    fail('missing_constraint', c.id, `outfit of ${arr(a.outfit).length} (want ${c.outfitLen})`)
  }
}

// ── §20: unrecognised meaning must not be silently dropped ─────────────────
for (const c of arr(S.lossyCompilation)) {
  if (!c.q) continue
  ran++
  // The guard: an occasion word the tables do not know must not compile down to
  // just its garment. Either the parser recognises it, or the query keeps it.
  const known = ok.readOccasion(c.q) !== null
  const compiled = qp.buildMandatoryConcepts(c.q)
  const flat = JSON.stringify(compiled).toLowerCase()
  const kept = flat.includes(c.residue.toLowerCase())
  if (!known && !kept) {
    fail('conversation_state_loss', c.id,
      `"${c.q}" — "${c.residue}" is neither recognised nor carried into the query`)
  }
}

// ── report ──────────────────────────────────────────────────────────────────
const byLabel = {}
for (const f of failures) (byLabel[f.label] ??= []).push(f)

console.log(`\n── ${ran} scenarios ${'─'.repeat(Math.max(0, 54 - String(ran).length))}`)
if (failures.length === 0) {
  console.log('  every scenario passed')
} else {
  for (const [label, list] of Object.entries(byLabel).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n  ${label}  (${list.length})`)
    for (const f of list) console.log(`    ${f.id.padEnd(22)} ${f.detail}`)
  }
}

const passed = ran - new Set(failures.map(f => f.id)).size
const pct = ran ? Math.round((passed / ran) * 100) : 0
console.log(`\n  ${passed}/${ran} scenarios clean  (${pct}%)`)

// A threshold rather than perfection: this set is meant to be added to, and a
// suite that must be 100% is a suite nobody adds a hard case to.
const FLOOR = Number(process.env.EVAL_FLOOR ?? 100)
if (pct < FLOOR) {
  console.log(`\n  below the floor of ${FLOOR}% — do not push`)
  process.exit(1)
}
console.log('')
