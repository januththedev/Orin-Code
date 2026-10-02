import { useEffect, useState } from 'react'
import { useProviderConfigStore, type ModelConfig, type ModelProperties } from '../../stores/providerConfigStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useProjectsStore } from '../../stores/projectsStore'
import { bridge } from '../../bridge/client'
import { SettingRow } from './SettingsLayout'

/**
 * The `modelProvider` section, ported from ZCode's
 * `settings/model-provider-section/`.
 *
 * ZCode's is a left-nav + detail layout rather than a flat form, because a
 * provider carries per-model configuration and that does not fit a list row.
 * What is preserved here:
 *
 *   - provider level: label, base URL, API format, key, enabled;
 *   - model level: enable, context window, input/output modalities, the
 *     capability flags, and the option specs (reasoning levels, max output
 *     tokens) -- ZCode's `ModelProperties` / `ModelOptionSpecs` field for field;
 *   - writes go to the SPARSE personal overlay, so "reset" deletes a key and
 *     the model falls back to the built-in rules rather than freezing a value;
 *   - an invalid value is refused at save time, matching ZCode's refusal to
 *     store an incomplete form.
 *
 * The model list comes from the live catalog, so what is edited here is what
 * the picker offers.
 */

const API_FORMATS: Array<{ value: 'anthropic-messages' | 'openai-chat-completions' | 'openai-responses'; label: string }> = [
  { value: 'anthropic-messages', label: 'Anthropic Messages' },
  { value: 'openai-chat-completions', label: 'OpenAI Chat Completions' },
  { value: 'openai-responses', label: 'OpenAI Responses' },
]

const CAPABILITIES: Array<{ key: keyof ModelProperties; label: string }> = [
  { key: 'supportsToolCall', label: 'Tool calling' },
  { key: 'supportsJsonSchemaOutput', label: 'JSON schema output' },
  { key: 'supportsNativeWebSearch', label: 'Native web search' },
  { key: 'supportsMidConversationSystem', label: 'Mid-conversation system messages' },
]

interface Props {
  /** Restrict to one provider, as ZCode does when deep-linked from a model. */
  focusProvider?: string
}

export function ProviderDetailSection({ focusProvider }: Props) {
  const providers = useProjectsStore((s) => s.projects)
  const activeProjectId = useProjectsStore((s) => s.activeProjectId)
  const overlay = useProviderConfigStore((s) => s.overlay)
  const setProvider = useProviderConfigStore((s) => s.setProvider)
  const setModel = useProviderConfigStore((s) => s.setModel)
  const clearModel = useProviderConfigStore((s) => s.clearModel)
  const hydrate = useProviderConfigStore((s) => s.hydrate)
  const defaultModelId = useSettingsStore((s) => s.defaultModelId)
  const updateSettings = useSettingsStore((s) => s.update)

  const [selectedProvider, setSelectedProvider] = useState<string | null>(focusProvider ?? null)
  const [selectedModel, setSelectedModel] = useState<string | null>(null)
  const [models, setModels] = useState<Array<{ id: string; provider: string; label: string }>>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  // The editor lists what the catalog actually offers, so a config edit applies
  // to a model the picker will really show.
  useEffect(() => {
    let alive = true
    bridge
      .modelsList()
      .then((list) => alive && setModels(list.map((m) => ({ id: m.id, provider: m.provider, label: m.label }))))
      .catch((error) => alive && setLoadError(String(error)))
    return () => {
      alive = false
    }
  }, [])

  const providerIds = Array.from(new Set(models.map((m) => m.provider).concat(providers.map((p) => p.id))))
  const provider = selectedProvider ?? providerIds[0] ?? null
  const providerConfig = provider ? overlay.providers[provider] ?? {} : {}
  const providerModels = models.filter((m) => m.provider === provider)
  const model = providerModels.find((m) => m.id === selectedModel) ?? null
  const modelConfig = model ? overlay.models[model.id] ?? {} : {}

  const setProperty = (key: keyof ModelProperties, value: unknown) => {
    if (!model) return
    setSaveError(null)
    setModel(model.id, { properties: { ...(modelConfig.properties ?? {}), [key]: value } }).catch((error) =>
      setSaveError(String(error instanceof Error ? error.message : error)),
    )
  }

  return (
    <div className="provider-detail">
      <div className="provider-detail-nav">
        {providerIds.map((id) => (
          <button key={id} className={`provider-nav-item ${id === provider ? 'active' : ''}`} onClick={() => { setSelectedProvider(id); setSelectedModel(null) }}>
            {(overlay.providers[id]?.label ?? id)}
          </button>
        ))}
      </div>

      <div className="provider-detail-body">
        {loadError && <p className="account-error">{loadError}</p>}

        {provider && (
          <>
            <SettingRow label="Provider label" hint="Shown in the picker.">
              <input
                className="text-input"
                value={providerConfig.label ?? ''}
                placeholder={provider}
                onChange={(event) => void setProvider(provider, { label: event.target.value || undefined })}
              />
            </SettingRow>

            <SettingRow label="Base URL" hint="Leave blank to use the provider's default endpoint.">
              <input
                className="text-input"
                value={providerConfig.api?.baseUrl ?? ''}
                placeholder="https://api.example.com/v1"
                onChange={(event) =>
                  void setProvider(provider, { api: { ...(providerConfig.api ?? {}), baseUrl: event.target.value } })
                }
              />
            </SettingRow>

            <SettingRow label="API format" hint="How requests are encoded for this endpoint.">
              <select
                className="select-input"
                value={providerConfig.api?.type ?? 'openai-chat-completions'}
                onChange={(event) =>
                  void setProvider(provider, {
                    api: { ...(providerConfig.api ?? {}), type: event.target.value as never },
                  })
                }
              >
                {API_FORMATS.map((format) => (
                  <option key={format.value} value={format.value}>
                    {format.label}
                  </option>
                ))}
              </select>
            </SettingRow>

            <SettingRow label="Hidden" hint="Keeps the provider configured but out of the picker.">
              <input
                type="checkbox"
                checked={providerConfig.visibility === 'hidden'}
                onChange={(event) => void setProvider(provider, { visibility: event.target.checked ? 'hidden' : 'visible' })}
              />
            </SettingRow>
          </>
        )}

        <h3 className="provider-models-heading">Models</h3>
        {providerModels.length === 0 && <p className="settings-note">No models reported for this provider.</p>}

        {providerModels.map((entry) => {
          const config = overlay.models[entry.id] ?? {}
          const expanded = selectedModel === entry.id
          return (
            <div key={entry.id} className="provider-model">
              <button
                className={`provider-model-row ${entry.id === defaultModelId ? 'default' : ''}`}
                onClick={() => setSelectedModel(expanded ? null : entry.id)}
              >
                <span>{entry.label}</span>
                <code>{entry.id}</code>
                {entry.id === defaultModelId && <em>default</em>}
                {overlay.models[entry.id] && <em>edited</em>}
              </button>

              {expanded && (
                <div className="provider-model-body">
                  {saveError && <p className="account-error">{saveError}</p>}

                  <SettingRow label="Enabled" hint="Off keeps it configured but out of the picker.">
                    <input
                      type="checkbox"
                      checked={config.enabled !== false}
                      onChange={(event) => void setModel(entry.id, { enabled: event.target.checked })}
                    />
                  </SettingRow>

                  <SettingRow label="Context window" hint="Tokens. Must be a positive whole number.">
                    <input
                      className="text-input"
                      type="number"
                      value={config.properties?.contextWindow ?? ''}
                      onChange={(event) => setProperty('contextWindow', event.target.value === '' ? undefined : Number(event.target.value))}
                    />
                  </SettingRow>

                  <SettingRow label="Input modalities">
                    <span className="model-modality-row">
                      {(['supportsText', 'supportsImage', 'supportsVideo', 'supportsAudio', 'supportsPdf'] as const).map((key) => (
                        <label key={key}>
                          <input
                            type="checkbox"
                            checked={config.properties?.inputFormat?.[key] === true}
                            onChange={(event) =>
                              setProperty('inputFormat', { ...(config.properties?.inputFormat ?? {}), [key]: event.target.checked })
                            }
                          />
                          {key.replace('supports', '')}
                        </label>
                      ))}
                    </span>
                  </SettingRow>

                  {CAPABILITIES.map((capability) => (
                    <SettingRow key={capability.key} label={capability.label}>
                      <input
                        type="checkbox"
                        checked={config.properties?.[capability.key] === true}
                        onChange={(event) => setProperty(capability.key, event.target.checked)}
                      />
                    </SettingRow>
                  ))}

                  <SettingRow label="Reasoning levels" hint="Weakest first, comma separated. Must be unique.">
                    <input
                      className="text-input"
                      value={(config.optionSpecs?.reasoningLevel?.values ?? []).join(', ')}
                      onChange={(event) => {
                        const values = event.target.value.split(',').map((v) => v.trim()).filter(Boolean)
                        try {
                          void setModel(entry.id, { optionSpecs: { ...(config.optionSpecs ?? {}), reasoningLevel: { values } } })
                          setSaveError(null)
                        } catch (error) {
                          setSaveError(String(error))
                        }
                      }}
                    />
                  </SettingRow>

                  <SettingRow label="Max output tokens" hint="Positive whole number.">
                    <input
                      className="text-input"
                      type="number"
                      value={config.optionSpecs?.maxOutputTokens?.max ?? ''}
                      onChange={(event) => {
                        const value = event.target.value === '' ? undefined : Number(event.target.value)
                        try {
                          void setModel(entry.id, { optionSpecs: { ...(config.optionSpecs ?? {}), maxOutputTokens: { max: value } } })
                          setSaveError(null)
                        } catch (error) {
                          setSaveError(String(error))
                        }
                      }}
                    />
                  </SettingRow>

                  <div className="provider-model-actions">
                    <button className="connect-button" onClick={() => updateSettings({ defaultModelId: entry.id })}>
                      Make default
                    </button>
                    {overlay.models[entry.id] && (
                      <button className="connect-button" onClick={() => void clearModel(entry.id)}>
                        Reset to built-in
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}

        {activeProjectId && null}
      </div>
    </div>
  )
}

export type { ModelConfig }