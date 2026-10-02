import type { ModelInfo } from '../bridge/types'

/**
 * Pure catalog merging, kept apart from the store so it can be tested without
 * the bridge: `modelsStore.ts` reaches the Tauri IPC, and a module that imports
 * it cannot be loaded by the test runner.
 *
 * Known ids keep their curated metadata -- speed, intelligence and context are
 * hand-tuned per model and a live listing does not carry them. Unknown live ids
 * are appended, which is how new and stealth models reach the picker.
 */
export function mergeLiveModels(base: ModelInfo[], live: ModelInfo[]): ModelInfo[] {
  const seen = new Set(base.map((m) => m.id))
  const extra = live.filter((m) => !seen.has(m.id))
  return extra.length > 0 ? [...base, ...extra] : base
}
