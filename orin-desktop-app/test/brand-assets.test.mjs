import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { SOUND_ASSETS, SOUND_ASSET_BASE, soundAssetUrl } from '../ui/src/design/soundAssets.ts'
import { PETS, PET_IDS, PET_EYE_INK } from '../ui/src/features/pets/petModel.ts'

/**
 * The brand kit has two renderings of one design, which is where drift lives:
 *
 *   sound.ts synthesises the cues at runtime; generate-brand-sounds.py renders
 *   the same cues to WAV from the same table.
 *   petModel.ts draws the pets; generate-brand-marks.mjs emits the same
 *   geometry to brand/pets/*.svg.
 *
 * Nothing enforces the correspondence at runtime, so a cue or a pet added to
 * one side and not the other would ship silently. These tests are that
 * enforcement.
 */

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const brandDir = join(root, 'brand')
const publicSoundDir = join(root, 'ui', 'public', 'brand')

// --- sounds ----------------------------------------------------------------------

test('every synthesised cue has a rendered WAV, and no WAV exists without a cue', async () => {
  // sound.ts keeps TONES module-private, so the cue set is read from the file
  // rather than exported purely for this assertion.
  const source = readFileSync(join(root, 'ui', 'src', 'design', 'sound.ts'), 'utf8')
  const block = source.slice(source.indexOf('const TONES'), source.indexOf('export const MASTER_GAIN'))
  const cues = [...block.matchAll(/^\s{2}([a-z]+):\s*\[/gm)].map((m) => m[1]).sort()
  const assets = Object.keys(SOUND_ASSETS).sort()
  assert.deepEqual(assets, cues, 'SOUND_ASSETS and the TONES table must cover the same cues')
  assert.ok(cues.length >= 5, `expected the five documented cues, parsed ${JSON.stringify(cues)}`)
})

test('every cue file is present, non-empty, and served from the public dir', () => {
  for (const [cue, file] of Object.entries(SOUND_ASSETS)) {
    const served = join(root, 'ui', 'public', SOUND_ASSET_BASE.replace(/^\//, ''), file)
    assert.ok(existsSync(served), `${cue}: ${file} is missing from ${served} -- run scripts/generate-brand-sounds.py`)
    assert.ok(statSync(served).size > 1024, `${cue}: ${file} is suspiciously small`)
    assert.equal(soundAssetUrl(cue), `${SOUND_ASSET_BASE}/${file}`)
  }
})

test('the WAVs are real 16-bit mono PCM at 44.1kHz, not empty or mislabelled', () => {
  // Read the RIFF header directly: a file that exists and has bytes is not the
  // same as a file a decoder will accept.
  for (const [cue, file] of Object.entries(SOUND_ASSETS)) {
    const buf = readFileSync(join(publicSoundDir, file))
    assert.equal(buf.subarray(0, 4).toString('ascii'), 'RIFF', `${cue}: not a RIFF file`)
    assert.equal(buf.subarray(8, 12).toString('ascii'), 'WAVE', `${cue}: not a WAVE file`)
    // "fmt " chunk, then the format fields.
    const fmt = buf.subarray(12, 16).toString('ascii')
    assert.equal(fmt, 'fmt ', `${cue}: first chunk should be fmt `)
    const channels = buf.readUInt16LE(22)
    const sampleRate = buf.readUInt32LE(24)
    const bits = buf.readUInt16LE(34)
    assert.equal(channels, 1, `${cue}: expected mono`)
    assert.equal(sampleRate, 44_100, `${cue}: expected 44.1kHz`)
    assert.equal(bits, 16, `${cue}: expected 16-bit`)
  }
})

test('no WAV is silent', () => {
  // A generator bug that zeroes the buffer still produces a valid RIFF file,
  // so decode a little of the data chunk and prove there is signal in it.
  for (const [cue, file] of Object.entries(SOUND_ASSETS)) {
    const buf = readFileSync(join(publicSoundDir, file))
    const dataAt = buf.indexOf('data', 12, 'ascii')
    assert.ok(dataAt > 0, `${cue}: no data chunk`)
    const start = dataAt + 8
    let peak = 0
    for (let i = start; i + 1 < buf.length; i += 2) {
      peak = Math.max(peak, Math.abs(buf.readInt16LE(i)))
    }
    assert.ok(peak > 100, `${cue}: ${file} looks silent (peak ${peak})`)
  }
})

// --- pets ------------------------------------------------------------------------

test('every pet has a sprite file and a plate, generated from the shared model', () => {
  for (const id of PET_IDS) {
    for (const suffix of ['', '-plate']) {
      const path = join(brandDir, 'pets', `orin-pet-${id}${suffix}.svg`)
      assert.ok(existsSync(path), `${path} is missing -- run scripts/generate-brand-marks.mjs`)
    }
    const svg = readFileSync(join(brandDir, 'pets', `orin-pet-${id}.svg`), 'utf8')
    // The sprite must carry the exact geometry the runtime draws, not a lookalike.
    assert.ok(svg.includes(PETS[id].body), `${id}: sprite body does not match petModel`)
  }
})

test('pet eyes are brand ink, and every pet has a hue and a silhouette', () => {
  assert.equal(PET_EYE_INK, '#1c1c1a')
  const bodies = new Set()
  for (const id of PET_IDS) {
    const spec = PETS[id]
    assert.ok(spec.name, `${id}: needs a name`)
    assert.ok(Number.isFinite(spec.hue), `${id}: needs a numeric hue`)
    assert.ok(spec.body.startsWith('M'), `${id}: body should be a path starting at a moveto`)
    assert.ok(spec.eyes.length > 0, `${id}: needs eyes`)
    bodies.add(spec.body)
  }
  // Three pets that share one silhouette would be a colour swatch, not a roster.
  assert.equal(bodies.size, PET_IDS.length, 'each pet needs a distinct silhouette')
})

// --- logo ------------------------------------------------------------------------

test('the logo kit covers the sizes a real product needs', () => {
  const expected = [
    'orin-mark.svg',
    'orin-mark-mono.svg',
    'orin-appicon-dark.svg',
    'orin-appicon-light.svg',
    'orin-appicon-1024.svg',
    'orin-lockup-horizontal.svg',
    'orin-lockup-stacked.svg',
    'orin-lockup-reversed.svg',
  ]
  for (const name of expected) {
    assert.ok(existsSync(join(brandDir, 'logo', name)), `brand/logo/${name} is missing`)
  }
})

test('no logo renders with content flush against its own edge', async () => {
  // The N's right stem originally sat exactly on the viewBox edge and was
  // visibly clipped in a raster. Checking the markup for that is unreliable --
  // transforms nest, so a group at x=0 inside an already-padded group is fine.
  // Rasterising and looking at the border pixels tests the thing that actually
  // matters: whether the rendered image has somewhere to breathe.
  const { Resvg } = await import('@resvg/resvg-js')
  const logoDir = join(brandDir, 'logo')
  for (const name of readdirSync(logoDir).filter((f) => f.endsWith('.svg'))) {
    const svg = readFileSync(join(logoDir, name), 'utf8')
    // The plates are meant to be full-bleed: the rounded square IS the art.
    if (name.startsWith('orin-appicon')) continue
    const image = new Resvg(svg, { fitTo: { mode: 'width', value: 128 }, background: 'rgba(0,0,0,0)' }).render()
    const { width, height } = image
    const pixels = image.pixels
    const alphaAt = (x, y) => pixels[(y * width + x) * 4 + 3]
    const edge = [
      alphaAt(0, Math.floor(height / 2)),
      alphaAt(width - 1, Math.floor(height / 2)),
      alphaAt(Math.floor(width / 2), 0),
      alphaAt(Math.floor(width / 2), height - 1),
    ]
    for (const [i, a] of edge.entries()) {
      assert.equal(a, 0, `${name}: edge ${['left', 'right', 'top', 'bottom'][i]} is not clear -- content is flush with the viewBox`)
    }
  }
})
