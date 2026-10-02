import { create } from 'zustand'
import { bridge } from '../bridge/client'
import type { ModelInfo, ProviderInfo } from '../bridge/types'
import { mergeLiveModels } from './modelCatalog'

/**
 * One model catalog, shared by the composer picker and Settings → Models.
 *
 * This exists because the two surfaces disagreed, and the disagreement is what
 * broke the picker:
 *
 *   - The composer kept its model list in component state and live-fetched
 *     from the literal string 'openrouter'. Nothing else ever reached it.
 *   - Settings → Models fetched EVERY provider the user had configured -- and
 *     then kept only `models.length`, discarding the list it had just paid for.
 *
 * So a user with a Groq, DeepSeek, Mistral, xAI, Together or Fireworks key saw
 * "24 models" in Settings and then found those models absent from the picker,
 * which offered only the 8 curated entries plus OpenRouter's live list. The
 * provider configuration had not visibly broken; it had been silently ignored.
 *
 * The fix is the data flow, not the interface. Nothing about how the picker
 * looks or behaves changes -- it reads the same list from here instead of from
 * its own component state.
 */
interface ModelsState {
  /** Curated catalog plus every live model, keyed and de-duplicated by id. */
  models: ModelInfo[]
  /** Ids that are known, so a later live fetch cannot duplicate them. */
  loaded: boolean
  refreshing: Record<string, boolean>
  counts: Record<string, number>
  errors: Record<string, string>

  /** Curated catalog first: instant, and correct with no network at all. */
  load: () => Promise<void>
  /** Fetch one provider's live catalog and merge it in. */
  refreshProvider: (providerId: string) => Promise<number>
  /** Fetch every provider the user has a key for. Never rejects. */
  refreshKeyedProviders: () => Promise<void>
}


export const useModelsStore = create<ModelsState>((set, get) => ({
  models: [],
  loaded: false,
  refreshing: {},
  counts: {},
  errors: {},

  load: async () => {
    if (get().loaded) return
    try {
      const list = await bridge.modelsList()
      set({ models: list, loaded: true })
    } catch {
      set({ loaded: true })
    }
    // The curated catalog is only the floor. Without this the picker would show
    // eight models forever, because the composer's own fetch was pinned to one
    // provider and Settings threw its results away.
    await get().refreshKeyedProviders()
  },

  refreshProvider: async (providerId) => {
    if (get().refreshing[providerId]) return get().counts[providerId] ?? 0
    set((s) => ({ refreshing: { ...s.refreshing, [providerId]: true }, errors: { ...s.errors, [providerId]: '' } }))
    try {
      const live = await bridge.modelsFetch(providerId)
      set((s) => ({
        models: mergeLiveModels(s.models, live),
        counts: { ...s.counts, [providerId]: live.length },
        errors: live.length === 0 ? { ...s.errors, [providerId]: 'No models returned.' } : s.errors,
      }))
      return live.length
    } catch (error) {
      set((s) => ({ errors: { ...s.errors, [providerId]: String(error) } }))
      return 0
    } finally {
      set((s) => ({ refreshing: { ...s.refreshing, [providerId]: false } }))
    }
  },

  refreshKeyedProviders: async () => {
    let providers: ProviderInfo[] = []
    try {
      providers = await bridge.providersList()
    } catch {
      return
    }
    const keyed = providers.filter((p) => p.hasKey).map((p) => p.id)
    // A provider without a key 401s and would only add noise, so only the ones
    // the user has actually configured are fetched.
    await Promise.all(keyed.map((id) => get().refreshProvider(id).catch(() => 0)))
  },
}))

/** The picker's list, plus whether it is usable yet. */
export function usePickerModels(): ModelInfo[] {
  return useModelsStore((s) => s.models)
}
