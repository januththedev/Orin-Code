import { useCallback, useEffect, useMemo, useState } from 'react'
import { Github, MessageSquare, FileText, Plug, Plus, Trash2, ShieldCheck } from 'lucide-react'
import { bridge } from '../../bridge/client'
import type { McpServer } from '../../bridge/types'
import { Button } from '../../components/Button'
import { SettingRow } from './SettingsLayout'
import {
  splitByKind,
  unify,
  validateMcpInput,
  type ConnectorView,
  type Integration,
} from './integrationsModel'
import './settings.css'

/**
 * Integrations — one place for everything Orin can reach with your account.
 *
 * Connectors (GitHub, Slack, Notion) and MCP servers used to be two screens
 * with two lifecycles. They are the same decision to a person, so they are one
 * list now: a name, a place it lives, whether you have given it a secret, a
 * test, and — for servers you added yourself — a remove.
 */

const CONNECTOR_META: Record<string, { description: string; tokenHint: string; tokenUrl: string; icon: typeof Github }> = {
  github: {
    description: 'Let the agent open, comment, and manage issues and PRs.',
    tokenHint: 'Personal access token (classic) with repo scope',
    tokenUrl: 'https://github.com/settings/tokens',
    icon: Github,
  },
  slack: {
    description: 'Let the agent post updates and read channels you approve.',
    tokenHint: 'Bot token (xoxb-…) with chat:write',
    tokenUrl: 'https://api.slack.com/apps',
    icon: MessageSquare,
  },
  notion: {
    description: 'Let the agent search pages and append notes.',
    tokenHint: 'Internal integration secret',
    tokenUrl: 'https://www.notion.so/my-account/integrations',
    icon: FileText,
  },
}

const MCP_ICON = Plug

export function IntegrationsPage() {
  const [connectors, setConnectors] = useState<ConnectorView[]>([])
  const [servers, setServers] = useState<McpServer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [known, mcp] = await Promise.all([
        Promise.all(
          Object.keys(CONNECTOR_META).map(async (id) => ({
            id,
            label: CONNECTOR_META[id].description ? id : id,
            baseUrl: `https://${id}.com`,
            hasCred: await bridge.connectorHasCred(id).catch(() => false),
          })),
        ),
        bridge.mcpServers().catch(() => [] as McpServer[]),
      ])
      setConnectors(known)
      setServers(mcp)
      setError('')
    } catch {
      setError('Could not read your integrations.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const all = useMemo(() => unify(connectors, servers), [connectors, servers])
  const grouped = useMemo(() => splitByKind(all), [all])

  const test = async (item: Integration) => {
    setBusy(item.id)
    try {
      if (item.kind === 'connector') {
        const result = await bridge.connectorTest(item.id.split(':')[1])
        setError(result)
      } else {
        const result = await bridge.mcpTest(item.id.split(':')[1])
        setError(result)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That check did not finish.')
    } finally {
      setBusy(null)
    }
  }

  const remove = async (item: Integration) => {
    setBusy(item.id)
    try {
      await bridge.mcpRemoveServer(item.id.split(':')[1])
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That server could not be removed.')
    } finally {
      setBusy(null)
    }
  }

  const add = async () => {
    const check = validateMcpInput(name, url)
    if (!check.ok) {
      setError(check.message)
      return
    }
    setBusy('new')
    try {
      await bridge.mcpAddServer(name.trim(), url.trim())
      setName('')
      setUrl('')
      setAdding(false)
      setError('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That server could not be added.')
    } finally {
      setBusy(null)
    }
  }

  const row = (item: Integration) => {
    const Icon = item.kind === 'connector' ? CONNECTOR_META[item.id.split(':')[1]]?.icon ?? Plug : MCP_ICON
    const meta = item.kind === 'connector' ? CONNECTOR_META[item.id.split(':')[1]] : undefined
    return (
      <li key={item.id} className="integration-row">
        <span className="integration-icon" aria-hidden="true"><Icon size={17} /></span>
        <div className="integration-main">
          <div className="integration-title">
            <strong>{item.name}</strong>
            <span className={`integration-badge ${item.hasCredential ? 'on' : 'off'}`}>
              {item.hasCredential ? 'Connected' : 'No credential'}
            </span>
            <span className="integration-kind">{item.kind === 'connector' ? 'Built-in' : 'MCP server'}</span>
          </div>
          <p className="integration-detail">{meta?.description ?? item.detail}</p>
          {!item.hasCredential && <p className="integration-hint">{item.credentialHint}</p>}
        </div>
        <div className="integration-actions">
          <Button size="sm" variant="ghost" disabled={busy === item.id} onClick={() => void test(item)}>
            {busy === item.id ? 'Checking…' : 'Test'}
          </Button>
          {item.removable && (
            <Button size="sm" variant="ghost" disabled={busy === item.id} onClick={() => void remove(item)}>
              <Trash2 size={13} />
            </Button>
          )}
        </div>
      </li>
    )
  }

  if (loading) return <p className="settings-note">Reading your integrations…</p>

  return (
    <div className="integrations-page">
      <SettingRow
        label="What Orin can reach"
        hint="Every entry here can be called on your behalf. Each one holds a secret you gave it."
      >
        <span className="settings-note">{all.length} connected</span>
      </SettingRow>

      {error && <p className="settings-note settings-note--warn" role="alert">{error}</p>}

      <ul className="integration-list">{grouped.connectors.map(row)}</ul>

      <div className="integration-section-head">
        <h3>MCP servers</h3>
        <Button size="sm" variant="ghost" onClick={() => { setAdding((v) => !v); setError('') }}>
          <Plus size={13} /> Add server
        </Button>
      </div>

      {adding && (
        <div className="integration-add">
          <input
            value={name}
            placeholder="Name, e.g. Filesystem"
            onChange={(e) => setName(e.target.value)}
            aria-label="Server name"
          />
          <input
            value={url}
            placeholder="https://mcp.example.com/sse"
            onChange={(e) => setUrl(e.target.value)}
            aria-label="Server URL"
          />
          <Button size="sm" disabled={busy === 'new'} onClick={() => void add()}>
            {busy === 'new' ? 'Adding…' : 'Add'}
          </Button>
        </div>
      )}

      {grouped.mcp.length === 0 && !adding ? (
        <p className="settings-note">
          No MCP servers yet. Add one to give Orin tools beyond the built-in services.
        </p>
      ) : (
        <ul className="integration-list">{grouped.mcp.map(row)}</ul>
      )}

      <p className="integration-footnote">
        <ShieldCheck size={13} /> Secrets live in the OS keyring or, for MCP servers, are injected
        at call time. Orin never puts a stored key into the model's context.
      </p>
    </div>
  )
}

export default IntegrationsPage
