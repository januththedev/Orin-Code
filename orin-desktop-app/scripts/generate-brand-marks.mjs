// Generates Orin's vector brand kit: the mark, mono and lockup variants, the
// app-icon plate, and one sprite per status pet.
//
// Everything is emitted as SVG from one script so the kit stays internally
// consistent -- the bolt in the app icon is the same path as the bolt in the
// wordmark, and the pet sprites are the same geometry the PetBar draws inline.
// Raster sizes come from `generate-brand-raster.mjs`, so a vector tweak does not
// mean hand-committing binaries.
//
// Run: node scripts/generate-brand-marks.mjs

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const logoDir = join(root, 'brand', 'logo')
const petDir = join(root, 'brand', 'pets')
mkdirSync(logoDir, { recursive: true })
mkdirSync(petDir, { recursive: true })

/**
 * The mark, on a 24-unit grid. Optically rather than geometrically centred: a
 * bolt's diagonals read heavier than its flats, so without this it looks like
 * it is top-heavy and falling short.
 */
const BOLT = 'M13.4 3.2 6.1 13.0h4.1l-1.1 7.8 7.3-9.8h-4.1z'

const AMBER = '#e08a3c'
const INK = '#1c1c1a'
const PAPER = '#f7f5f1'

/**
 * Wordmark letterforms on a 10x10 cap box, built from rounded rects and
 * polygons rather than hand-written bezier contours.
 *
 * The first attempt drew each glyph as one path with a subpath for the
 * counter, and the O came out wrong: the outer contour spanned 0..10.6 while
 * the counter spanned 0.3..4.0, so it hugged the left edge and the letter read
 * as a filled shape with a slit. Composing from primitives makes the geometry
 * checkable by eye -- a ring is two concentric rounded rects, and a diagonal is
 * a quad -- and `fill-rule: evenodd` turns the ring into a real counter.
 *
 * Still no webfont: the logo must render identically wherever it is placed.
 */
const roundRect = (x, y, w, h, r) =>
  `M${round(x + r)} ${round(y)}h${round(w - 2 * r)}a${r} ${r} 0 0 1 ${r} ${r}v${round(h - 2 * r)}` +
  `a${r} ${r} 0 0 1 ${-r} ${r}h${round(-(w - 2 * r))}a${r} ${r} 0 0 1 ${-r} ${-r}v${round(-(h - 2 * r))}` +
  `a${r} ${r} 0 0 1 ${r} ${-r}z`

/** A ring: outer shape plus a concentric counter, punched by evenodd. */
const ring = (x, y, w, h, r, wall) =>
  `    <path fill-rule="evenodd" d="${roundRect(x, y, w, h, r)}${roundRect(x + wall, y + wall, w - wall * 2, h - wall * 2, Math.max(0.4, r - wall))}"/>`

const LETTERS = [
  // O -- a true ring, counter centred by construction.
  (x) => `  <g transform="translate(${x} 0)">\n${ring(0, 0, 10, 10, 2.6, 2.1)}\n  </g>`,
  // R -- stem, ring bowl over its top half, then a splayed leg.
  (x) =>
    `  <g transform="translate(${x} 0)">\n` +
    `    <rect x="0" y="0" width="2.1" height="10"/>\n` +
    `    <path fill-rule="evenodd" d="${roundRect(0, 0, 8.4, 5.6, 1.9)}${roundRect(2.1, 2.1, 4.2, 1.4, 0.6)}"/>\n` +
    `    <path d="M5.4 5.1h2.6l2.2 4.9H7.6z"/>\n` +
    `  </g>`,
  // I -- a bare stem, the geometric choice, wider tracking does the rest.
  (x) => `  <g transform="translate(${x} 0)">\n    <rect x="0" y="0" width="2.1" height="10"/>\n  </g>`,
  // N -- two stems bridged by a quad, which is what makes it read as N and
  // not as two bars.
  (x) =>
    `  <g transform="translate(${x} 0)">\n` +
    `    <rect x="0" y="0" width="2.1" height="10"/>\n` +
    `    <rect x="7.9" y="0" width="2.1" height="10"/>\n` +
    `    <path d="M1.7 0h2.4l5.5 10H7.1z"/>\n` +
    `  </g>`,
]
const LETTER_W = 10
const TRACKING = 3
const WORD_SCALE = 1.6
const wordWidth = LETTERS.length * LETTER_W + (LETTERS.length - 1) * TRACKING
const wordHeight = 10 * WORD_SCALE

const svg = (width, height, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">\n${body}\n</svg>\n`

const write = (dir, name, contents) => {
  writeFileSync(join(dir, name), contents)
  console.log(`  ${name}`)
}

const round = (n) => Number(n.toFixed(2))

/**
 * Clear space around every lockup. Without it the final stem of the N sat
 * exactly on the viewBox edge and was visibly clipped in a raster, and the
 * bolt was flush to the left. A logo needs somewhere to breathe.
 */
const PAD = 6

/** The wordmark as a positioned group, so every lockup reuses one definition. */
const wordmark = (x, y, fill) =>
  `  <g transform="translate(${round(x)} ${round(y)}) scale(${WORD_SCALE})" fill="${fill}">\n` +
  LETTERS.map((glyph, i) => glyph(i * (LETTER_W + TRACKING))).join('\n') +
  '\n  </g>'

/** The bolt scaled to `size` and placed at (x, y). */
const mark = (x, y, size, fill) =>
  `  <path d="${BOLT}" transform="translate(${round(x)} ${round(y)}) scale(${round(size / 24) / 1})" fill="${fill}"/>`

console.log('brand/logo:')

// Flexible default: bolt alone, transparent, inherits nothing.
write(logoDir, 'orin-mark.svg', svg(24, 24, `  <path d="${BOLT}" fill="${AMBER}"/>`))

// Mono: one colour, for 16px favicons, single-colour print, and emboss.
write(logoDir, 'orin-mark-mono.svg', svg(24, 24, `  <path d="${BOLT}" fill="currentColor"/>`))

// Plates, for app icons and avatars where the mark needs its own ground.
write(logoDir, 'orin-appicon-dark.svg', svg(24, 24, `  <rect x="1" y="1" width="22" height="22" rx="5.5" fill="${INK}"/>\n${mark(4.2, 4.2, 15.6, AMBER)}`))
write(logoDir, 'orin-appicon-light.svg', svg(24, 24, `  <rect x="1" y="1" width="22" height="22" rx="5.5" fill="${PAPER}"/>\n${mark(4.2, 4.2, 15.6, AMBER)}`))

// 1024px plate, the source for every raster size and for store listings.
{
  const plate = 956
  const inset = (1024 - plate) / 2
  const markSize = plate * 0.62
  write(
    logoDir,
    'orin-appicon-1024.svg',
    svg(1024, 1024, `  <rect x="${inset}" y="${inset}" width="${plate}" height="${plate}" rx="${plate * 0.24}" fill="${INK}"/>\n${mark((1024 - markSize) / 2, (1024 - markSize) / 2 + markSize * 0.02, markSize, AMBER)}`),
  )
}

// Horizontal lockup: bolt, gap, wordmark, all on one optical centre line.
{
  const markSize = Math.max(wordHeight, 22)
  const space = 11
  const width = markSize + space + wordWidth * WORD_SCALE
  const height = Math.max(markSize, wordHeight)
  write(
    logoDir,
    'orin-lockup-horizontal.svg',
    svg(
      round(width + PAD * 2),
      round(height + PAD * 2),
      `${mark(PAD, PAD + (height - markSize) / 2, markSize, AMBER)}\n${wordmark(PAD + markSize + space, PAD + (height - wordHeight) / 2, INK)}`,
    ),
  )
}

// Stacked lockup, for square placements.
{
  const markSize = 34
  const gapY = 13
  const width = Math.max(markSize, wordWidth * WORD_SCALE)
  const height = markSize + gapY + wordHeight
  write(
    logoDir,
    'orin-lockup-stacked.svg',
    svg(
      round(width + PAD * 2),
      round(height + PAD * 2),
      `${mark(PAD + (width - markSize) / 2, PAD, markSize, AMBER)}\n${wordmark(PAD + (width - wordWidth * WORD_SCALE) / 2, PAD + markSize + gapY, INK)}`,
    ),
  )
}

// Reversed lockup, for dark headers where ink-on-paper is unavailable.
{
  const markSize = 22
  const space = 11
  const width = markSize + space + wordWidth * WORD_SCALE
  const height = Math.max(markSize, wordHeight)
  write(
    logoDir,
    'orin-lockup-reversed.svg',
    svg(
      round(width + PAD * 2),
      round(height + PAD * 2),
      `${mark(PAD, PAD + (height - markSize) / 2, markSize, AMBER)}\n${wordmark(PAD + markSize + space, PAD + (height - wordHeight) / 2, PAPER)}`,
    ),
  )
}

// --- pets ------------------------------------------------------------------------

/**
 * Pet geometry is imported from the runtime model rather than restated here, so
 * the sprite files in brand/pets and the sprites the app draws are the same
 * definition. The first version of this script carried its own copy of the
 * paths, which is exactly the arrangement that lets brand assets and product
 * drift apart silently.
 */
const { PETS, PET_EYE_INK } = await import('../ui/src/features/pets/petModel.ts')

console.log('brand/pets:')
for (const [id, pet] of Object.entries(PETS)) {
  write(petDir, `orin-pet-${id}.svg`, svg(24, 24, `  <path d="${pet.body}" fill="currentColor"/>\n  <g fill="${PET_EYE_INK}">${pet.eyes}</g>`))
  // 256px plate for the pet window and docs. The ground is the brand ink, not
  // a tint of the pet's own hue: a plate and a pet in the same colour with no
  // contrast between them render as one solid square, and the silhouette --
  // the whole point of the sprite -- disappears.
  const pad = 54
  const size = 256 - pad * 2
  write(
    petDir,
    `orin-pet-${id}-plate.svg`,
    svg(
      256,
      256,
      `  <rect x="10" y="10" width="236" height="236" rx="58" fill="${INK}"/>\n` +
        `  <g transform="translate(${pad} ${pad}) scale(${round(size / 24)})"><path d="${pet.body}" fill="currentColor"/></g>`,
    ),
  )
}

console.log('\nDone. Raster sizes: node scripts/generate-brand-raster.mjs')
