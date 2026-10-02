import { create } from 'zustand'
import { bridge } from '../bridge/client'

/**
 * Provider and model configuration, ported from ZCode's
 * `packages/provider/src/config/{provider-config,model-config}.ts` and
 * `shared/src/model-config.ts`.
 *
 * Two things are preserved that are easy to flatten by accident:
 *
 *   1. **Two layers.** Built-in rules ship with the app; the user edits a
 *      SPARSE personal overlay, and the two are merged on read
 *      (`ProviderConfigLayerSnapshot`, `ProviderSettingsFormProjection`). The
 *      renderer only ever writes the overlay -- that is what lets a user pin a
 *      model without freezing the shipped catalog, and why "restore" is
 *      deleting a key rather than rewriting a default.
 *
 *   2. **Sparse is meaningful.** Every field is optional, and a missing field
 *      means "inherit". That is not a typing convenience: it is how an app
 *      update adds a property without clobbering a user's choices.
 *
 * The shapes below are ZCode's schema field for field.
 */

export interface ModelInputFormat {
  supportsText?: boolean
  supportsImage?: boolean
  supportsVideo?: boolean
  supportsAudio?: boolean
  supportsPdf?: boolean
}

export interface ModelOutputFormat {
  supportsText?: boolean
}

export interface ModelProperties {
  requiresMfjsToolSchema?: boolean
  /** Positive integer; the schema rejects 0 and negatives. */
  contextWindow?: number
  inputFormat?: ModelInputFormat | null
  outputFormat?: ModelOutputFormat | null
  supportsToolCall?: boolean
  supportsJsonSchemaOutput?: boolean
  supportsNativeWebSearch?: boolean
  supportsMidConversationSystem?: boolean
}

export interface EnumOptionSpec {
  /** Ordered weakest to strongest. The first entry is the lowest public tier. */
  values?: readonly string[] | null
  map?: Record<string, unknown> | null
}

export interface LimitOptionSpec {
  max?: number | null
  map?: Record<string, unknown> | null
}

export interface ModelOptionSpecs {
  reasoningLevel?: EnumOptionSpec | null
  maxOutputTokens?: LimitOptionSpec | null
}

export interface ModelConfig {
  enabled?: boolean
  properties?: ModelProperties | null
  optionSpecs?: ModelOptionSpecs | null
}

export type ProviderApiType = 'anthropic-messages' | 'openai-chat-completions' | 'openai-responses'

export type ProviderAccess =
  | { type: 'api-key'; apiKey?: string | null; apiKeyManagementUrl?: string | null }
  | { type: 'custom-endpoint' }

export interface ProviderConfig {
  label?: string
  group?: 'standard-personal' | 'zai-family' | 'bigmodel-family'
  access?: ProviderAccess
  api?: { type?: ProviderApiType; baseUrl?: string; headers?: Record<string, string> }
  builtinModelIds?: string[]
  personalModelIds?: string[]
  modelOrder?: string[]
  visibility?: 'visible' | 'hidden'
}

export type ProviderConfigOverlay = Record<string, ProviderConfig>
export type ModelConfigOverlay = Record<string, ModelConfig>

interface ProviderConfigState {
  /** User edits only. Built-in rules live in the Rust core. */
  overlay: { providers: ProviderConfigOverlay; models: ModelConfigOverlay }
  hydrated: boolean
  hydrate: () => Promise<void>

  setProvider: (providerId: string, patch: Partial<ProviderConfig>) => Promise<void>
  setModel: (modelId: string, patch: Partial<ModelConfig>) => Promise<void>
  clearModel: (modelId: string) => Promise<void>
  clearProvider: (providerId: string) => Promise<void>

  effectiveModel: (modelId: string) => ModelConfig | undefined
  isModelEnabled: (modelId: string, builtinEnabled: boolean) => boolean
  /** ZCode validates the complete form; this reports the sparse overlay's issues. */
  validateModel: (modelId: string) => string[]
}

const KEY = 'provider_config'

/** ZCode's validation, over the fields the overlay can actually set. */
export function validateModelConfig(modelId: string, config: ModelConfig): string[] {
  const issues: string[] = []
  if (config.properties?.contextWindow !== undefined) {
    const value = config.properties.contextWindow
    if (!Number.isInteger(value) || value <= 0) issues.push('contextWindow must be a positive integer')
  }
  if (config.optionSpecs?.reasoningLevel?.values !== undefined && config.optionSpecs.reasoningLevel.values !== null) {
    const values = config.optionSpecs.reasoningLevel.values
    if (values.length === 0) issues.push('reasoningLevel.values must not be empty')
    if (new Set(values).size !== values.length) issues.push('reasoningLevel.values must not repeat')
    if (values.some((value) => value.trim().length === 0)) issues.push('reasoningLevel.values must be non-empty strings')
  }
  if (config.optionSpecs?.maxOutputTokens?.max !== undefined && config.optionSpecs.maxOutputTokens.max !== null) {
    const value = config.optionSpecs.maxOutputTokens.max
    if (!Number.isInteger(value) || value <= 0) issues.push('maxOutputTokens.max must be a positive integer')
  }
  void modelId
  return issues
}

function persist(overlay: { providers: ProviderConfigOverlay; models: ModelConfigOverlay }): void {
  void bridge.storeSet(KEY, overlay).catch(() => {})
}

export const useProviderConfigStore = create<ProviderConfigState>((set, get) => ({
  overlay: { providers: {}, models: {} },
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return
    try {
      const saved = await bridge.storeGet<{ providers?: ProviderConfigOverlay; models?: ModelConfigOverlay }>(KEY)
      if (saved && typeof saved === 'object') {
        set({ overlay: { providers: saved.providers ?? {}, models: saved.models ?? {} }, hydrated: true })
        return
      }
    } catch {
      // fall through to defaults
    }
    set({ hydrated: true })
  },

  setProvider: async (providerId, patch) => {
    const providers = { ...get().overlay.providers, [providerId]: { ...get().overlay.providers[providerId], ...patch } }
    const overlay = { ...get().overlay, providers }
    set({ overlay })
    persist(overlay)
  },

  setModel: async (modelId, patch) => {
    const current = get().overlay.models[modelId] ?? {}
    const next = { ...current, ...patch }
    const issues = validateModelConfig(modelId, next)
    // ZCode refuses an incomplete form rather than storing it, so a bad value
    // cannot reach the picker and break a request at send time.
    if (issues.length > 0) throw new Error(issues.join('; '))
    const models = { ...get().overlay.models, [modelId]: next }
    const overlay = { ...get().overlay, models }
    set({ overlay })
    persist(overlay)
  },

  // Restore means DELETING the key, so the model falls back to the built-in
  // rules. Writing the default back would freeze a value the app may later
  // change.
  clearModel: async (modelId) => {
    const models = { ...get().overlay.models }
    delete models[modelId]
    const overlay = { ...get().overlay, models }
    set({ overlay })
    persist(overlay)
  },

  clearProvider: async (providerId) => {
    const providers = { ...get().overlay.providers }
    delete providers[providerId]
    const overlay = { ...get().overlay, providers }
    set({ overlay })
    persist(overlay)
  },

  effectiveModel: (modelId) => get().overlay.models[modelId],

  // Absent means inherit, so the built-in flag decides unless the overlay
  // speaks. ZCode's ModelConfig.overlay treats a missing `enabled` as
  // "no opinion", not as false.
  isModelEnabled: (modelId, builtinEnabled) => {
    const explicit = get().overlay.models[modelId]?.enabled
    return explicit === undefined ? builtinEnabled : explicit
  },

  validateModel: (modelId) => {
    const config = get().overlay.models[modelId]
    return config ? validateModelConfig(modelId, config) : []
  },
}))
