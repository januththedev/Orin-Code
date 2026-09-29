import { useCallback, useEffect, useState } from 'react'
import { bridge } from '../../bridge/client'
import type { UpdateState } from '../../bridge/types'
import { useSettingsStore } from '../../stores/settingsStore'
import { SettingRow } from './SettingsLayout'
import { Button } from '../../components/Button'

/**
 * In-app updates.
 *
 * No repository URL ever appears here — the user checks, downloads, installs and
 * restarts without ever visiting a browser. That is the whole point of doing it
 * in the app rather than shipping a download link.
 */
export function UpdatesSection() {
  const [state, setState] = useState<UpdateState>({ phase: 'idle', version: null, notes: null, progress: 0, error: null })
  const autoCheck = useSettingsStore((s) => s.autoCheckUpdates)
  const update = useSettingsStore((s) => s.update)

  useEffect(() => {
    // The download emits progress; the dialog subscribes rather than polling.
    let off: (() => void) | null = null
    void bridge.onUpdateProgress((next) => setState(next)).then((fn) => { off = fn }).catch(() => {})
    return () => { off?.() }
  }, [])

  const check = useCallback(async () => {
    setState((s) => ({ ...s, phase: 'checking', error: null }))
    try {
      setState(await bridge.updateCheck())
    } catch (e) {
      setState((s) => ({ ...s, phase: 'error', error: e instanceof Error ? e.message : 'The check failed.' }))
    }
  }, [])

  const install = useCallback(async () => {
    setState((s) => ({ ...s, phase: 'downloading', error: null, progress: 0 }))
    try {
      const done = await bridge.updateInstall()
      setState(done)
    } catch (e) {
      setState((s) => ({ ...s, phase: 'error', error: e instanceof Error ? e.message : 'The update failed.' }))
    }
  }, [])

  const busy = state.phase === 'checking' || state.phase === 'downloading' || state.phase === 'ready'

  return (
    <div className="updates-section">
      <SettingRow
        label="Check automatically"
        hint="Look for a new version in the background when the app starts. Nothing is downloaded or installed without you."
      >
        <div className="seg-group">
          {([false, true] as const).map((on) => (
            <button
              key={String(on)}
              className={`seg-option ${autoCheck === on ? 'active' : ''}`}
              onClick={() => update({ autoCheckUpdates: on })}
            >
              {on ? 'On' : 'Off'}
            </button>
          ))}
        </div>
      </SettingRow>

      <SettingRow label="Updates" hint={describe(state)}>
        <div className="update-actions">
          {state.phase === 'available' && (
            <Button size="sm" onClick={() => void install()}>Download and install</Button>
          )}
          {state.phase === 'ready' && (
            <Button size="sm" onClick={() => void bridge.updateRestart()}>Restart now</Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => void check()} disabled={busy}>
            {state.phase === 'checking' ? 'Checking…' : 'Check for updates'}
          </Button>
        </div>
      </SettingRow>

      {state.phase === 'downloading' && (
        <div className="update-progress" role="progressbar" aria-valuenow={Math.round(state.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
          <div className="update-progress-bar" style={{ width: `${Math.round(state.progress * 100)}%` }} />
          <span>Downloading… {Math.round(state.progress * 100)}%</span>
        </div>
      )}

      {state.notes && state.phase === 'available' && (
        <pre className="update-notes">{state.notes}</pre>
      )}

      {state.phase === 'error' && state.error && (
        <p className="settings-note settings-note--warn">{state.error}</p>
      )}
    </div>
  )
}

function describe(state: UpdateState): string {
  switch (state.phase) {
    case 'checking':
      return 'Looking for a new version…'
    case 'available':
      return `Orin Code ${state.version ?? ''} is available.`.trim()
    case 'downloading':
      return 'Downloading and verifying…'
    case 'ready':
      return 'Installed. Restart to finish.'
    case 'error':
      return 'The last check did not finish.'
    default:
      return 'Up to date.'
  }
}
