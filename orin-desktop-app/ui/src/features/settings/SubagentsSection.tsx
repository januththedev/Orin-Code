import { useCallback, useEffect, useState } from 'react'
import { bridge } from '../../bridge/client'
import type { SubAgentConfig } from '../../bridge/types'
import { SettingRow } from './SettingsLayout'
import { Button } from '../../components/Button'

/**
 * The sub-agents section, ported from ZCode's `SubagentsSection.tsx` over
 * `SubAgentConfig` (`shared/src/subagents-types.ts:93-108`).
 *
 * The configuration is ZCode's, field for field. Only some of it is wired, and
 * this section says which rather than implying the rest works:
 *
 *   WIRED    name -> the queue task's title
 *            systemPrompt -> the agent request's system message
 *            modelSelection.modelId -> the agent request's model
 *            background -> the queue's delegated accounting
 *            color -> the task's presentation
 *
 *   STORED   tools, disallowedTools, skills, mcpServers, injectAgentsMd,
 *            permissionMode, maxTurns — round-tripped intact so a later stage
 *            can consume them, and listed here as not yet wired. Silently
 *            dropping them would make the config look smaller than ZCode's and
 *            lose data on the first save.
 */

const COLORS = ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'cyan'] as const

const UNWIRED: Array<[string, string]> = [
  ['tools', 'Orin Code exposes no tool layer to a sub-agent yet.'],
  ['disallowedTools', 'Nothing to restrict until there is a tool layer.'],
  ['skills', 'Skill injection for sub-agents is not wired into the agent request.'],
  ['mcpServers', 'Sub-agents are not given their own MCP server set.'],
  ['injectAgentsMd', 'AGENTS.md is not injected into a delegated run.'],
  ['permissionMode', 'Orin Code runs every delegated task under the same approval gate.'],
  ['maxTurns', 'A delegated run has no turn budget in the queue.'],
]

function blank(): SubAgentConfig {
  return {
    name: '',
    description: '',
    systemPrompt: '',
    color: undefined,
    modelSelection: undefined,
    tools: [],
    disallowedTools: [],
    injectAgentsMd: false,
    skills: [],
    permissionMode: undefined,
    maxTurns: undefined,
    background: false,
    mcpServers: [],
  }
}

export function SubagentsSection() {
  const [agents, setAgents] = useState<SubAgentConfig[] | null>(null)
  const [editing, setEditing] = useState<SubAgentConfig | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(() => {
    bridge
      .subagentsList()
      .then((next) => {
        setAgents(next)
        setError('')
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not read sub-agents.'))
  }, [])

  useEffect(refresh, [refresh])

  const save = async (next: SubAgentConfig[]) => {
    setBusy(true)
    try {
      setAgents(await bridge.subagentsWrite(next))
      setError('')
    } catch (e: unknown) {
      // The core refuses the WHOLE write when any entry is invalid, so a
      // half-applied agent set cannot be left behind.
      setError(e instanceof Error ? e.message : 'Could not save sub-agents.')
    } finally {
      setBusy(false)
    }
  }

  // The section keeps its shape even before the list arrives, and when there is
  // no workspace. Sub-agents are workspace-scoped in ZCode, so "no folder" is a
  // real state to show -- not a reason to collapse the whole section to one
  // line and make the settings navigation look broken.
  const list = agents ?? []
  const scopeError = agents ? null : error || null

  return (
    <div className="subagents-section">
      <p className="settings-note">
        A sub-agent is a named configuration the agent can delegate to. It supplies the system prompt and model for
        that run. Configuration lives in <code>.orin/subagents.json</code>.
      </p>

      {scopeError && <p className="settings-note">{scopeError}</p>}
      {!agents && !error && <p className="settings-note">Reading sub-agents…</p>}

      <ul className="subagent-list">
        {list.map((agent, index) => (
          <li key={`${agent.name}-${index}`} className="subagent-item">
            <div className="subagent-item-head">
              <span className="subagent-dot" data-color={agent.color ?? 'blue'} aria-hidden="true" />
              <span className="subagent-name">{agent.name}</span>
              {agent.modelSelection?.modelId && (
                <code className="subagent-model">{agent.modelSelection.modelId}</code>
              )}
              {agent.background && <em>background</em>}
              <span className="subagent-actions">
                <Button size="sm" onClick={() => setEditing({ ...agent })}>
                  Edit
                </Button>
                <Button
                  size="sm"
                  onClick={() => void save(list.filter((_, i) => i !== index))}
                  disabled={busy}
                >
                  Remove
                </Button>
              </span>
            </div>
            {agent.description && <p className="subagent-detail">{agent.description}</p>}
            {agent.systemPrompt && <p className="subagent-detail">System: {agent.systemPrompt}</p>}
          </li>
        ))}
        {agents && agents.length === 0 && <li className="subagent-item">No sub-agents configured.</li>}
      </ul>

      {editing ? (
        <div className="subagent-editor">
          <SettingRow label="Name" hint="Used as the task title when work is delegated.">
            <input
              className="text-input"
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            />
          </SettingRow>
          <SettingRow label="Description" hint="What this agent is for.">
            <input
              className="text-input"
              value={editing.description}
              onChange={(e) => setEditing({ ...editing, description: e.target.value })}
            />
          </SettingRow>
          <SettingRow label="System prompt" hint="Sent as the system message for this agent's runs.">
            <textarea
              className="text-input"
              rows={4}
              value={editing.systemPrompt}
              onChange={(e) => setEditing({ ...editing, systemPrompt: e.target.value })}
            />
          </SettingRow>
          <SettingRow label="Model" hint="Leave blank to use the app default.">
            <input
              className="text-input"
              value={editing.modelSelection?.modelId ?? ''}
              placeholder="claude-sonnet-5"
              onChange={(e) =>
                setEditing({
                  ...editing,
                  modelSelection: e.target.value ? { modelId: e.target.value } : undefined,
                })
              }
            />
          </SettingRow>
          <SettingRow label="Colour">
            <select
              className="select-input"
              value={editing.color ?? ''}
              onChange={(e) => setEditing({ ...editing, color: e.target.value || undefined })}
            >
              <option value="">Default</option>
              {COLORS.map((color) => (
                <option key={color} value={color}>
                  {color}
                </option>
              ))}
            </select>
          </SettingRow>
          <SettingRow label="Background" hint="Counts against the delegated concurrency budget.">
            <input
              type="checkbox"
              checked={editing.background}
              onChange={(e) => setEditing({ ...editing, background: e.target.checked })}
            />
          </SettingRow>

          <div className="subagent-stored">
            <p className="settings-note">
              Stored with ZCode's shape, not yet acted on by the runtime:
            </p>
            {UNWIRED.map(([field, why]) => (
              <p key={field} className="settings-note settings-note--warn">
                <code>{field}</code> — {why}
              </p>
            ))}
          </div>

          <div className="subagent-editor-actions">
            <Button
              size="sm"
              disabled={busy || editing.name.trim().length === 0}
              onClick={() => {
                const existing = list.findIndex((a) => a.name === editing.name)
                const next =
                  existing >= 0
                    ? list.map((a, i) => (i === existing ? editing : a))
                    : [...list, editing]
                void save(next)
                setEditing(null)
              }}
            >
              Save sub-agent
            </Button>
            <Button size="sm" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button size="sm" onClick={() => setEditing(blank())}>
          Add a sub-agent
        </Button>
      )}

      {error && <p className="account-error">{error}</p>}
    </div>
  )
}

