import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The Settings → General version row shipped a hardcoded "0.1.0" and a
 * hardcoded "Orin AI desktop" caption, inside a v1.9.0 product. Every user
 * opening About was told the wrong version, and the caption still carried the
 * pre-rebrand product name. `scripts/visual-sweep.mjs` found it by screenshot.
 *
 * These assertions exist because that class of bug comes back: a literal looks
 * fine in review, renders fine, and is wrong on every single build.
 */

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const settingsSource = readFileSync(join(root, 'ui', 'src', 'features', 'settings', 'SettingsPage.tsx'), 'utf8')

test('the version row reads the version from the bridge, not a literal', () => {
  assert.match(
    settingsSource,
    /bridge\s*\n?\s*\.appInfo\(\)/,
    'SettingsPage must ask the bridge for the version',
  )
  // The value rendered next to the Version label must be the state, never a
  // string constant.
  assert.match(
    settingsSource,
    /<span className="setting-hint">\{appVersion \?\? 'unknown'\}<\/span>/,
    'the Version row must render the fetched version',
  )
})

const SETTINGS_VIEWS = ['SettingsPage.tsx', 'SkillsPage.tsx', 'ConnectorsPage.tsx', 'IntegrationsPage.tsx', 'CustomizePage.tsx']

/**
 * Strip comments before scanning. The fix for the stale product name carries a
 * comment that quotes the old string, and a naive substring check flags its own
 * explanation.
 */
const code = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1 ')

test('no stale version literal survives in the renderer', () => {
  const offenders = []
  for (const file of SETTINGS_VIEWS) {
    const text = readFileSync(join(root, 'ui', 'src', 'features', 'settings', file), 'utf8')
    const match = text.match(/setting-hint">(\d+\.\d+\.\d+)</)
    if (match) offenders.push(`${file} renders a literal version ${match[1]}`)
  }
  assert.deepEqual(offenders, [], 'version must not be hardcoded in the settings views')
})

test('the pre-rebrand product name is gone from the settings views', () => {
  for (const file of SETTINGS_VIEWS) {
    const text = code(readFileSync(join(root, 'ui', 'src', 'features', 'settings', file), 'utf8'))
    assert.doesNotMatch(
      text,
      /Orin AI desktop/,
      `${file} still calls the product "Orin AI desktop"; it is Orin Code`,
    )
  }
})

test('the app_info bridge command exists and is wired to the real version', async () => {
  // The Rust side owns the version, so assert the command name the renderer
  // calls is one the bridge actually exposes.
  const client = readFileSync(join(root, 'ui', 'src', 'bridge', 'client.ts'), 'utf8')
  assert.match(client, /appInfo:[\s\S]{0,120}invoke<[^>]*>\('app_info'\)/)

  const lib = readFileSync(join(root, 'src-tauri', 'src', 'lib.rs'), 'utf8')
  assert.match(lib, /bridge::app_info/, 'app_info must be registered as a Tauri command')
})
