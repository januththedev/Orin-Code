import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { bridge } from '../bridge/client'
import { usePanelsStore } from '../stores/panelsStore'

/**
 * The bottom terminal panel, ported from ZCode's `AnimatedTerminalPanel`.
 *
 * ZCode's terminal is a resizable panel under the conversation column, closed
 * by default, toggled with ⌘J, and backed by a PTY session that is created on
 * first open and released on close. Session lifetime matters: holding a PTY
 * for a panel the user closed leaks the process.
 */
export function TerminalPanel() {
  const open = usePanelsStore((s) => s.terminalOpen)
  const sessionId = usePanelsStore((s) => s.terminalSessionId)
  const collapsed = usePanelsStore((s) => s.terminalCollapsed)
  const setOpen = usePanelsStore((s) => s.setTerminalOpen)
  const setCollapsed = usePanelsStore((s) => s.setTerminalCollapsed)
  const ensure = usePanelsStore((s) => s.ensureTerminalSession)
  const release = usePanelsStore((s) => s.releaseTerminalSession)

  const [lines, setLines] = useState<string[]>([])
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) void ensure()
  }, [open, ensure])

  // Release the PTY when the panel closes, so a hidden panel is not holding a
  // shell process open.
  useEffect(() => {
    if (!open) release()
  }, [open, release])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [lines.length])

  if (!open) return null

  const send = async () => {
    if (!input.trim() || !sessionId) return
    try {
      await bridge.termWrite(sessionId, `${input}\n`)
      setInput('')
      setLines((prev) => [...prev, `$ ${input}`])
    } catch (err) {
      setError(String(err))
    }
  }

  return (
    <section className={`terminal-panel ${collapsed ? 'collapsed' : ''}`} aria-label="Terminal">
      <header className="terminal-panel-head">
        <button
          type="button"
          className="terminal-panel-toggle"
          onClick={() => setCollapsed(!collapsed)}
          aria-expanded={!collapsed}
        >
          Terminal
        </button>
        <span className="terminal-panel-status">{sessionId ? 'session' : 'starting…'}</span>
        <button type="button" className="terminal-panel-close" aria-label="Close terminal" onClick={() => setOpen(false)}>
          <X size={13} />
        </button>
      </header>
      {!collapsed && (
        <>
          <div className="terminal-panel-log" ref={logRef}>
            {lines.length === 0 && !error && <p className="terminal-panel-hint">Terminal ready.</p>}
            {lines.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
            {error && <div className="tab-error">{error}</div>}
          </div>
          <div className="terminal-panel-input">
            <input
              value={input}
              placeholder="Run a command…"
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void send()
              }}
            />
          </div>
        </>
      )}
    </section>
  )
}