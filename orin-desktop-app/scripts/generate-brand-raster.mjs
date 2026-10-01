// Rasterises the vector brand kit to the PNG sizes surfaces actually ask for.
//
// Kept separate from generate-brand-marks.mjs so the SVGs stay the source of
// truth: a vector tweak regenerates these in one step instead of leaving stale
// binaries at a dozen sizes.
//
// Run: node scripts/generate-brand-raster.mjs

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const brandDir = join(root, 'brand')
const pngDir = join(brandDir, 'png')
mkdirSync(pngDir, { recursive: true })

/** Rasterise one SVG at a given width. `recolor` replaces `currentColor`. */
function rasterise(svgPath, width, recolor) {
  let svg = readFileSync(svgPath, 'utf8')
  if (recolor) svg = svg.split('currentColor').join(recolor)
  return new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    background: 'rgba(0,0,0,0)',
  })
    .render()
    .asPng()
}

// The pet hues, matching --pet-hue in petModel.ts. The sprite itself is
// colour-agnostic; this is what makes each one distinct as a file.
const PET_HUE = { bolt: '#e08a3c', ember: '#e8834a', slate: '#4f8fd0' }

function emit(svgName, outName, width, recolor) {
  const svgPath = join(brandDir, 'logo', svgName)
  const outPath = join(pngDir, outName)
  writeFileSync(outPath, rasterise(svgPath, width, recolor))
  return outName
}

console.log('brand/png:')

// App icon, the full ladder the Tauri bundler and Windows want.
emit('orin-appicon-1024.svg', 'orin-appicon-1024.png', 1024)
for (const size of [512, 256, 128, 64, 48, 32, 16]) {
  emit('orin-appicon-1024.svg', `orin-appicon-${size}.png`, size)
}

// Lockups and the bare mark, at web sizes.
emit('orin-lockup-horizontal.svg', 'orin-lockup-horizontal-512.png', 512)
emit('orin-lockup-stacked.svg', 'orin-lockup-stacked-512.png', 512)
emit('orin-mark.svg', 'orin-mark-256.png', 256)
emit('orin-mark-mono.svg', 'orin-mark-mono-256.png', 256, '#1c1c1a')

// Pet sprites at bar size and at pet-window size, in their own hue.
for (const [id, hue] of Object.entries(PET_HUE)) {
  const sprite = rasterise(join(brandDir, 'pets', `orin-pet-${id}.svg`), 128, hue)
  writeFileSync(join(pngDir, `orin-pet-${id}-128.png`), sprite)
  const plate = rasterise(join(brandDir, 'pets', `orin-pet-${id}-plate.svg`), 256, hue)
  writeFileSync(join(pngDir, `orin-pet-${id}-plate-256.png`), plate)
  console.log(`  orin-pet-${id}-128.png, orin-pet-${id}-plate-256.png`)
}

const count = readdirSync(pngDir).filter((f) => f.endsWith('.png')).length
console.log(`\n${count} PNG files in brand/png`)

