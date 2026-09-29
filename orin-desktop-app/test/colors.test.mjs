import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { ICON_HUES, describeFile, isSurfaceSafe } from '../ui/src/design/colors.ts'

const tokens = await readFile(new URL('../ui/src/design/tokens.css', import.meta.url), 'utf8')

test('the semantic role names are declared', () => {
  for (const name of [
    '--color-brand', '--color-brand-hover', '--color-accent-surface',
    '--color-accent-line', '--color-icon-blue',
  ]) {
    assert.ok(tokens.includes(`${name}:`), `tokens.css must declare ${name}`)
  }
})

test('every icon descriptor is declared and distinct from brand', () => {
  const declared = tokens.match(/--icon-[a-z]+:/g) ?? []
  assert.equal(declared.length, Object.keys(ICON_HUES).length, 'one token per descriptor')
  for (const descriptor of Object.keys(ICON_HUES)) {
    assert.ok(tokens.includes(`--icon-${descriptor}:`), `missing --icon-${descriptor}`)
  }
  // File-type icons must not simply be the brand colour.
  const brandLine = tokens.match(/--color-brand:\s*([^;]+);/)?.[1]?.trim()
  for (const match of tokens.matchAll(/--icon-([a-z]+):\s*([^;]+);/g)) {
    assert.notEqual(match[2].trim(), brandLine, `--icon-${match[1]} must not be brand`)
  }
})

test('C and C++ files are recognised as source', () => {
  for (const name of ['main.c', 'parser.h', 'util.hpp', 'a/b/core.cpp']) {
    assert.equal(describeFile(name), 'source', name)
  }
})

test('every common file kind gets a sensible descriptor', () => {
  const cases = {
    'README.md': 'docs', 'notes.txt': 'docs',
    'package.json': 'config', 'Cargo.toml': 'config', '.env': 'config', 'dockerfile': 'config',
    'CMakeLists.txt': 'config', 'schema.sql': 'data', 'data.csv': 'data',
    'app.css': 'style', 'icon.svg': 'style',
    'main.rs': 'script', 'index.ts': 'script', 'run.sh': 'script',
    'app.exe': 'binary', 'lib.so': 'binary',
    'bundle.zip': 'archive',
    'parser_test.go': 'test', 'a.spec.ts': 'test',
    'logo.png': 'image', 'photo.jpg': 'image',
  }
  for (const [name, expected] of Object.entries(cases)) {
    assert.equal(describeFile(name), expected, name)
  }
})

test('paths and odd input are handled without throwing', () => {
  assert.equal(describeFile(''), 'source')
  assert.equal(describeFile('C:\\work\\Makefile'), 'config')
  assert.equal(describeFile('.gitignore'), 'config')
})

test('brand is never a full-page background', () => {
  // A brand value used as a solid surface fill is the failure this rule prevents.
  assert.equal(isSurfaceSafe('#e08a3c', 'background'), false)
  assert.equal(isSurfaceSafe('var(--accent)', 'canvas'), false)
  // A translucent overlay is a legitimate surface use.
  assert.equal(isSurfaceSafe('rgba(224,138,60,0.14)', 'background'), true)
  // Any non-surface role is fine regardless of the value.
  assert.equal(isSurfaceSafe('#e08a3c', 'text'), true)
  assert.equal(isSurfaceSafe('#e08a3c', 'border'), true)
})
