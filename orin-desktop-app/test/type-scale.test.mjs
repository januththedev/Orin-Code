import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import {
  CSS_VAR,
  ROLE_VAR,
  TYPE_ROLES,
  UI_FONT_SIZE_DEFAULT,
  UI_FONT_SIZE_MAX,
  UI_FONT_SIZE_MIN,
  clampUiFontSize,
  isAllowedFontSize,
  scaleFor,
  sizeFor,
} from '../ui/src/design/typeScale.ts'

const UI_DIR = new URL('../ui/src/', import.meta.url)

async function cssFiles(dir = UI_DIR, found = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const url = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir)
    if (entry.isDirectory()) await cssFiles(url, found)
    else if (entry.name.endsWith('.css')) found.push(url)
  }
  return found
}

test('the scale matches ZCode DESIGN.md at the default base', () => {
  assert.deepEqual(scaleFor(14), { xl: 18, lg: 16, base: 14, caption: 13, sm: 12, xs: 10, '2xs': 9 })
})

test('the whole scale moves together with the base', () => {
  // Every role must stay the same distance from the base at every size, so a
  // role always means the same thing relative to body text.
  for (const role of TYPE_ROLES) {
    const offset = sizeFor(role, UI_FONT_SIZE_DEFAULT) - UI_FONT_SIZE_DEFAULT
    assert.equal(sizeFor(role, UI_FONT_SIZE_MIN) - UI_FONT_SIZE_MIN, offset, `${role} at min`)
    assert.equal(sizeFor(role, UI_FONT_SIZE_MAX) - UI_FONT_SIZE_MAX, offset, `${role} at max`)
  }
  // Roles must stay ordered, or "base" stops meaning body text.
  for (const base of [UI_FONT_SIZE_MIN, UI_FONT_SIZE_DEFAULT, UI_FONT_SIZE_MAX]) {
    const s = scaleFor(base)
    assert.ok(
      s.xl > s.lg && s.lg > s.base && s.base > s.caption && s.caption > s.sm && s.sm > s.xs && s.xs > s['2xs'],
      `scale must be strictly ordered at base ${base}: ${JSON.stringify(s)}`,
    )
  }
})

test('a corrupt stored font size cannot break the scale', () => {
  assert.equal(clampUiFontSize(undefined), UI_FONT_SIZE_DEFAULT)
  assert.equal(clampUiFontSize(NaN), UI_FONT_SIZE_DEFAULT)
  assert.equal(clampUiFontSize('16'), UI_FONT_SIZE_DEFAULT)
  assert.equal(clampUiFontSize(-100), UI_FONT_SIZE_MIN)
  assert.equal(clampUiFontSize(9999), UI_FONT_SIZE_MAX)
  assert.equal(clampUiFontSize(16), 16)
  assert.equal(clampUiFontSize(15.6), 16)
})

test('scaling is driven by one custom property, never the root font size', async () => {
  const store = await readFile(new URL('../ui/src/stores/settingsStore.ts', import.meta.url), 'utf8')
  assert.match(store, new RegExp(`'${CSS_VAR}'`), 'the setting must write --ui-font-size')
  assert.doesNotMatch(store, /documentElement\.style\.fontSize|setProperty\('font-size'|style\.setProperty\("font-size"/,
    'scaling must never mutate the root font size')
  // Nor may any stylesheet do it.
  for (const file of await cssFiles()) {
    const text = await readFile(file, 'utf8')
    assert.doesNotMatch(text, /html\s*\{[^}]*font-size\s*:/is, `${file} must not set the root font size`)
  }
})

test('every role maps to a declared custom property', async () => {
  const tokens = await readFile(new URL('../ui/src/design/tokens.css', import.meta.url), 'utf8')
  for (const role of TYPE_ROLES) {
    const variable = ROLE_VAR[role]
    assert.ok(tokens.includes(`${variable}:`), `tokens.css must declare ${variable}`)
  }
  assert.match(tokens, new RegExp(`${CSS_VAR}:\\s*${UI_FONT_SIZE_DEFAULT}px`), 'tokens.css must seed the base')
})

test('interface stylesheets use the scale, not hardcoded pixel sizes', async () => {
  const offenders = []
  for (const file of await cssFiles()) {
    if (file.pathname.endsWith('tokens.css')) continue
    const text = await readFile(file, 'utf8')
    // Match innermost `selector { declarations }` blocks so a nested @media
    // still yields its real selector, and a content-level exemption is judged
    // against the rule that actually contains the declaration.
    for (const [, selector, declarations] of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/font-size\s*:/i.test(declarations)) continue
      if (isAllowedFontSize(declarations, selector)) continue
      const line = declarations.split(';').find((d) => /font-size/i.test(d))?.trim()
      offenders.push(`${file.pathname.split('/').pop()} ${selector.trim().replace(/\s+/g, ' ')} → ${line}`)
    }
  }
  assert.deepEqual(offenders, [], `hardcoded interface font sizes found:\n${offenders.join('\n')}`)
})

test('content-level type is still allowed its own size', () => {
  assert.equal(isAllowedFontSize('font-size: 12px', '.message-content {'), true)
  assert.equal(isAllowedFontSize('font-size: 12px', '.monaco-editor .view-line {'), true)
  assert.equal(isAllowedFontSize('font-size: 12px', '.diff-line {'), true)
  assert.equal(isAllowedFontSize('font-size: 12px', '.terminal-pane {'), true)
  assert.equal(isAllowedFontSize('font-size: 13px', '.settings-row label {'), false)
})
