import { useEffect, useState } from 'react'
import { bridge } from '../bridge/client'
import { selectActiveProject, useProjectsStore } from '../stores/projectsStore'
import { isTabTypeAvailable, sidePaneTabLabel, type SidePaneTab } from './sidePaneTabs'

/**
 * Content dispatch for the side pane.
 *
 * ZCode switches on tab type and mounts the matching pane. This does the same
 * for the six types Orin Code can serve today, and shows an explicit
 * unavailable state for the rest rather than an empty box -- a blank pane reads
 * as a broken tab, while a labelled one reads as a known gap.
 */

function Unavailable({ tab }: { tab: SidePaneTab }) {
  return (
    <div className="tab-unavailable" role="status">
      <strong>{sidePaneTabLabel(tab)}</strong>
      <p>
        This pane type is part of ZCode's shell and is modelled, but its content has not been ported yet. It is
        reported as unavailable rather than silently omitted, so the gap stays visible.
      </p>
      <code>{tab.type}</code>
    </div>
  )
}

function GitPane() {
  const root = useProjectsStore(selectActiveProject)?.rootPath ?? ''
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // git_status needs a repository root. With no folder open there is nothing
    // to report, and the pane says so rather than guessing at a path.
    if (!root) return
    let alive = true
    bridge
      .gitStatus(root)
      .then((result) => {
        if (!alive) return
        const branch = result?.['branch'] ?? result?.['on'] ?? 'unknown'
        const changed = Object.keys(result ?? {}).filter((k) => k !== 'branch' && k !== 'on').length
        setStatus(`${branch} · ${changed} changed`)
      })
      .catch((err: unknown) => {
        if (alive) setError(String(err))
      })
    return () => {
      alive = false
    }
  }, [root])

  if (!root) return <div className="tab-unavailable">Open a folder to see its repository.</div>
  if (error) return <div className="tab-error">Git status unavailable: {error}</div>
  if (!status) return <div className="tab-loading">Reading repository…</div>
  return (
    <div className="tab-git">
      <p className="tab-git-branch">{status}</p>
      <p className="tab-git-note">Branch, changes and history land with the Git pane.</p>
    </div>
  )
}

function BrowserPane({ tab }: { tab: Extract<SidePaneTab, { type: 'browser' }> }) {
  const [url, setUrl] = useState(tab.initialUrl ?? '')
  const [result, setResult] = useState<{ finalUrl: string; text: string; truncated: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const read = async () => {
    if (!url.trim()) return
    setBusy(true)
    setError(null)
    try {
      setResult(await bridge.browserRead(url.trim()))
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="tab-browser">
      <div className="tab-browser-bar">
        <input
          value={url}
          placeholder="https://"
          onChange={(event) => setUrl(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void read()
          }}
        />
        <button type="button" onClick={() => void read()} disabled={busy}>
          {busy ? 'Reading…' : 'Read'}
        </button>
      </div>
      {error && <div className="tab-error">{error}</div>}
      {result && (
        <div className="tab-browser-body">
          <h3>{result.finalUrl}</h3>
          {result.truncated && <p className="tab-git-note">Truncated to the character budget.</p>}
          <pre>{result.text}</pre>
        </div>
      )}
      {!result && !error && !busy && <p className="tab-browser-empty">Enter a public page address to read it.</p>}
    </div>
  )
}

function CodeViewerPane({ tab }: { tab: Extract<SidePaneTab, { type: 'code-viewer' }> }) {
  const [content, setContent] = useState(tab.source.content ?? '')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (tab.source.content != null || !tab.source.path) return
    let alive = true
    bridge
      .readFile(tab.source.path)
      .then((text: string) => {
        if (alive) setContent(String(text))
      })
      .catch((err: unknown) => {
        if (alive) setError(String(err))
      })
    return () => {
      alive = false
    }
  }, [tab.source.path, tab.source.content])

  if (error) return <div className="tab-error">{error}</div>
  if (!tab.source.path) return <div className="tab-unavailable">No file selected for this preview.</div>
  return (
    <div className="tab-code">
      <p className="tab-code-path">{tab.source.path}</p>
      <pre>
        <code>{content}</code>
      </pre>
    </div>
  )
}

function TerminalPane({ tab }: { tab: Extract<SidePaneTab, { type: 'terminal' }> }) {
  const [lines, setLines] = useState<string[]>([])
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const sessionId = tab.sessionId

  const send = async () => {
    if (!input.trim()) return
    try {
      await bridge.termWrite(sessionId, `${input}\n`)
      setInput('')
      setLines((prev) => [...prev, `$ ${input}`])
    } catch (err) {
      setError(String(err))
    }
  }

  return (
    <div className="tab-terminal">
      <div className="tab-terminal-log">
        {lines.length === 0 && !error && <p className="tab-terminal-hint">Terminal ready. Type a command and press Enter.</p>}
        {lines.map((line, i) => (
          <div key={i}>{line}</div>
        ))}
        {error && <div className="tab-error">{error}</div>}
      </div>
      <div className="tab-terminal-input">
        <input
          value={input}
          placeholder="Command…"
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void send()
          }}
        />
      </div>
    </div>
  )
}

function BashOutputPane({ tab }: { tab: Extract<SidePaneTab, { type: 'bash-output' }> }) {
  return (
    <div className="tab-bash">
      <p>Background run {tab.runId}</p>
      <p className="tab-git-note">Output capture lands with the background task stream.</p>
    </div>
  )
}

function SubagentSessionPane({ tab }: { tab: Extract<SidePaneTab, { type: 'subagent-session' }> }) {
  return (
    <div className="tab-subagent">
      <p>Sub-agent {tab.taskId}</p>
      <p className="tab-git-note">Session detail lands with the sub-agent surface.</p>
    </div>
  )
}

export function TabContent({ tab }: { tab: SidePaneTab }) {
  if (!isTabTypeAvailable(tab.type)) return <Unavailable tab={tab} />
  switch (tab.type) {
    case 'git':
      return <GitPane />
    case 'browser':
      return <BrowserPane tab={tab} />
    case 'code-viewer':
      return <CodeViewerPane tab={tab} />
    case 'terminal':
      return <TerminalPane tab={tab} />
    case 'bash-output':
      return <BashOutputPane tab={tab} />
    case 'subagent-session':
      return <SubagentSessionPane tab={tab} />
    default:
      return <Unavailable tab={tab} />
  }
}