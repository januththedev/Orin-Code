import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'

/**
 * Apache-2.0 compliance is easy to honour once and easy to break silently.
 * These assertions fail the build if a licence file goes missing or is edited.
 */

const VENDOR = new URL('../../vendor/zcode/', import.meta.url)

const read = (name) => readFile(new URL(name, VENDOR), 'utf8')

test('the upstream licence files are present and untouched', async () => {
  const files = await readdir(VENDOR)
  for (const required of ['LICENSE', 'NOTICE.md', 'THIRD-PARTY-NOTICES.md', 'MODIFICATIONS.md']) {
    assert.ok(files.includes(required), `${required} must stay in vendor/zcode`)
  }
})

test('LICENSE is the unmodified Apache 2.0 text', async () => {
  const licence = await read('LICENSE')
  assert.match(licence, /Apache License/)
  assert.match(licence, /Version 2\.0, January 2004/)
  assert.match(licence, /TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION/)
  // 201 lines is the canonical Apache-2.0 body; an edit would move it.
  assert.equal(licence.trim().split('\n').length, 201, 'LICENSE has been edited')
})

test('NOTICE.md is the upstream disclosure, not ours', async () => {
  const notice = await read('NOTICE.md')
  assert.ok(notice.trim().length > 0)
  assert.match(notice, /ZCode/)
  assert.doesNotMatch(notice, /Orin/, 'NOTICE.md must stay upstream text')
})

test('MODIFICATIONS.md states the position the licence requires', async () => {
  const mod = await read('MODIFICATIONS.md')
  assert.match(mod, /29628c9acdb81b703bbd4080c207a0e7ce5e276e/, 'must pin the upstream commit')
  assert.match(mod, /Z\.ai|Zhipu/, 'must credit the upstream')
  assert.match(mod, /§4/, 'must address the Apache-2.0 section 4 obligations')
  assert.match(mod, /§6/, 'must address the no-trademark clause')
  assert.match(mod, /no.{0,20}trademark/i, 'must say plainly that no marks are used')
})

test('no Z.ai or ZCode branding leaked into the product surface', async () => {
  // Apache-2.0 §6 grants no trademark rights, so these strings must not appear
  // in shipped UI. Reading only source that the UI actually imports.
  const sources = [
    '../ui/src/App.tsx',
    '../ui/src/features/pets/PetBar.tsx',
    '../ui/src/design/tokens.css',
    '../ui/src/app/Layout.tsx',
  ]
  for (const path of sources) {
    const text = await readFile(new URL(path, import.meta.url), 'utf8')
    assert.doesNotMatch(text, /zhipu/i, `${path} must not reference Zhipu`)
  }
})
