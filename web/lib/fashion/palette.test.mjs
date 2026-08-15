// Reading a garment's colour off its photograph, and deciding whether two
// garments belong together.
//
// The failures this guards against are not crashes. They are a cream sneaker
// scoring as "warm" and therefore fighting a rust trouser it actually sits
// beside perfectly, or a model's forearm being read as the product. Both
// happened during calibration and both are silent.
import { familyOf, goesWith } from './palette.ts'

let bad = 0
const check = (ok, label, extra) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra !== undefined ? '  ' + JSON.stringify(extra) : ''}`)
  if (!ok) bad++
}

// ── measured colours land in the right family ───────────────────────────────
const cases = [
  [{ r: 33, g: 32, b: 31 }, 'neutral', 'near-black'],
  [{ r: 245, g: 245, b: 243 }, 'neutral', 'white'],
  [{ r: 196, g: 197, b: 198 }, 'neutral', 'grey'],
  // The one that was wrong: cream carries a real warm hue and enough
  // saturation to escape a naive desaturation test.
  [{ r: 228, g: 218, b: 203 }, 'neutral', 'cream'],
  [{ r: 35, g: 33, b: 65 }, 'cool', 'ink blue'],
  [{ r: 40, g: 55, b: 95 }, 'cool', 'navy'],
  [{ r: 151, g: 161, b: 132 }, 'earth', 'olive'],
  [{ r: 120, g: 80, b: 45 }, 'earth', 'tan'],
  [{ r: 210, g: 90, b: 30 }, 'warm', 'rust orange'],
]
for (const [rgb, want, name] of cases) {
  const got = familyOf(rgb)
  check(got === want, `${name.padEnd(11)} reads ${want}`, got === want ? undefined : { got })
}

// ── pairing ─────────────────────────────────────────────────────────────────
const P = (families, plain = true, colours = [{ r: 0, g: 0, b: 0 }], variety = 1) =>
  ({ families, plain, colours, variety })

const neutralPlain = P(['neutral'])
const oneAccent = P(['earth'])
const otherAccent = P(['cool'])
const busyMany = P(['warm', 'jewel', 'pastel'], false, [{ r: 200, g: 40, b: 40 }], 4)

check(goesWith(neutralPlain, oneAccent) > goesWith(oneAccent, otherAccent),
  'neutral with an accent beats two unrelated accents',
  { neutral: goesWith(neutralPlain, oneAccent), clash: goesWith(oneAccent, otherAccent) })
check(goesWith(oneAccent, P(['earth'])) >= 0.9, 'two pieces in the same family agree')
check(goesWith(busyMany, busyMany) < goesWith(neutralPlain, neutralPlain),
  'two busy prints together score worst of all',
  { busy: goesWith(busyMany, busyMany), quiet: goesWith(neutralPlain, neutralPlain) })
check(goesWith(null, oneAccent) === 0.5,
  'a colour we could not read is neither right nor wrong')

// The echo: a colour genuinely shared between two pieces is a bonus, not a
// requirement — thirteen of the sixteen reference looks do it and three do not.
const brownShirt = P(['earth'], true, [{ r: 107, g: 91, b: 74 }])
const brownShoe = P(['earth'], true, [{ r: 110, g: 95, b: 78 }])
const greyShoe = P(['neutral'], true, [{ r: 150, g: 150, b: 152 }])
check(goesWith(brownShirt, brownShoe) >= goesWith(brownShirt, greyShoe),
  'a shoe that picks up the shirt scores at least as well as one that does not',
  { echo: goesWith(brownShirt, brownShoe), none: goesWith(brownShirt, greyShoe) })

console.log(bad ? `\n${bad} FAILING` : '\nall good')
process.exit(bad)
