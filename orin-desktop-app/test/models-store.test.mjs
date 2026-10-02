import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { mergeLiveModels } from '../ui/src/stores/modelCatalog.ts'

/**
 * The model picker was reported broken. The cause was not the picker:
 *
 *   - Composer kept its list in component state and live-fetched from the
 *     literal 'openrouter'.
 *   - Settings -> Models fetched every configured provider, then kept only
 *     `models.length` and threw the list away.
 *
 * So any key that was not OpenRouter -- Groq, DeepSeek, Mistral, xAI, Together,
 * Fireworks -- was invisible in the picker while Settings cheerfully reported
 * how many models it had. These pin the fix at the data-flow level, so the
 * picker UI stays exactly as it is.
 */

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (p) => readFileSync(join(root, p), 'utf8')

const groqModels = [
  { id: 'groq/llama-3.3-70b-versatile', provider: 'groq', label: 'Llama 3.3 70B', tier: 'fast', speed: 3, intelligence: 2, contextTokens: 131072 },
  { id: 'groq/kimi-k2', provider: 'groq', label: 'Kimi K2', tier: 'balanced', speed: 3, intelligence: 3, contextTokens: 131072 },
]

test('a live fetch keeps curated metadata and appends unknown ids', () => {
  const curated = [{ id: 'mock/orin-offline', provider: 'mock', label: 'Orin Offline', tier: 'balanced', speed: 1, intelligence: 1, contextTokens: 32000 }]
  const merged = mergeLiveModels(curated, groqModels)
  assert.equal(merged.length, 3)
  assert.equal(merged[0].label, 'Orin Offline', 'the curated entry keeps its metadata')
  assert.ok(merged.some((m) => m.id === 'groq/llama-3.3-70b-versatile'))

  // A live id that already exists must not appear twice.
  const again = mergeLiveModels(merged, groqModels)
  assert.equal(again.length, merged.length, 're-fetching must not duplicate')
  // An empty fetch is a no-op rather than a reallocation.
  assert.equal(mergeLiveModels(merged, []), merged)
})

test('the composer no longer hardcodes a single provider', () => {
  const composer = read('ui/src/features/chat/Composer.tsx')
  assert.doesNotMatch(
    composer,
    /modelsFetch\(\s*['"]openrouter['"]/,
    'the picker must not fetch from one hardcoded provider',
  )
  // It should read the shared catalog rather than owning one.
  assert.match(composer, /usePickerModels\(\)/, 'the picker should read the shared model store')
  assert.doesNotMatch(
    composer,
    /useState<ModelInfo\[\]>/,
    'the picker must not keep its own model list in component state',
  )
})

test('Settings keeps the fetched list, not just the count', () => {
  const settings = read('ui/src/features/settings/SettingsPage.tsx')
  assert.doesNotMatch(
    settings,
    /setModelCounts/,
    'Settings must not keep a count-only local copy; the list belongs in the store',
  )
  assert.match(settings, /refreshProvider\(providerId\)/, 'Settings should refresh through the shared store')
})

test('the shared store fetches every keyed provider, not one', () => {
  const store = read('ui/src/stores/modelsStore.ts')
  assert.match(store, /\.filter\(\(p\) => p\.hasKey\)/, 'the store must select providers by whether a key is stored')
  assert.match(store, /refreshKeyedProviders/, 'loading the catalog must also refresh keyed providers')
  // A provider with no key 401s; fetching it would only add noise.
  assert.doesNotMatch(store, /hasKey\s*\?\s*.*:\s*true/, 'providers without a key must not be fetched')
})

test('the store is what the picker reads, so the two cannot drift again', () => {
  const store = read('ui/src/stores/modelsStore.ts')
  // The curated catalog is the offline floor and must load before any network.
  const loadAt = store.indexOf('bridge.modelsList()')
  const refreshAt = store.indexOf('refreshKeyedProviders()')
  assert.ok(loadAt > 0 && refreshAt > loadAt, 'the curated catalog must load before the live fetch')
})
