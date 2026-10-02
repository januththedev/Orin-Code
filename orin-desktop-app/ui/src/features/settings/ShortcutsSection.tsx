import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  SHORTCUT_COMMANDS,
  HIDDEN_SHORTCUT_COMMANDS,
  findBindingConflict,
  formatShortcut,
  isSamePhysicalBinding,
  eventToBinding,
  type ShortcutCommandId,
} from '../../shortcuts/shortcutCommands'
import { useShortcutsStore } from '../../stores/shortcutsStore'

/**
 * The shortcuts settings section, ported from ZCode's
 * `ShortcutSettingsSection.tsx` and `useShortcutRecording.ts`.
 *
 * The rules that are behaviour rather than styling, and are preserved:
 *
 *   - Escape cancels a recording; Backspace resets the command to its default.
 *     Two different gestures, not two ways to cancel.
 *   - `openOnboarding` and `toggleInterfaceMode` keep their registrations and
 *     conflict checks but are not LISTED, so the table is the configurable set
 *     rather than every chord the app knows.
 *   - filtering by typed key uses the same physical-equivalence table as
 *     conflict detection, so on Windows Ctrl+m matches a command bound to
 *     CmdOrCtrl+m -- searching for a chord finds the commands that actually
 *     hold it.
 *   - a recording stuck on a lone modifier clears any stale conflict or error,
 *     so pressing a second chord immediately after a conflict feels live.
 *
 * It reads and writes the SAME store the global dispatcher and the Command
 * Centre read, so a rebind here is the rebind everywhere.
 */


type Recording = { commandId: ShortcutCommandId } | null

export function ShortcutsSection() {
  const overrides = useShortcutsStore((s) => s.overrides)
  const setBinding = useShortcutsStore((s) => s.setBinding)
  const resetBinding = useShortcutsStore((s) => s.resetBinding)
  // Select the override map -- a stable reference -- and resolve the effective
  // bindings here. Calling `effective()` inside a selector builds a new object
  // on every store read, so the view re-renders forever and never paints.
  // Same trap as the Command Centre and the composer; the rule is that a
  // zustand selector must return a stable reference.
  const effective = useMemo(
    () => useShortcutsStore.getState().effective(),
    [overrides],
  )

  const [query, setQuery] = useState('')
  const [keyQuery, setKeyQuery] = useState<string | null>(null)
  const [recording, setRecording] = useState<Recording>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<string | null>(null)
  const liveRef = useRef({ setBinding, resetBinding })

  useEffect(() => {
    liveRef.current = { setBinding, resetBinding }
  }, [setBinding, resetBinding])

  // While recording, every key belongs to the recorder: the global dispatcher
  // must not also fire, or saving a chord would trigger the command.
  useEffect(() => {
    if (!recording) return
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') {
        setRecording(null)
        setPreview(null)
        setError(null)
        setConflict(null)
        return
      }
      if (event.key === 'Backspace') {
        void liveRef.current.resetBinding(recording.commandId)
        setRecording(null)
        setPreview(null)
        setError(null)
        setConflict(null)
        return
      }
      const binding = eventToBinding({
        key: event.key,
        code: event.code,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
      })
      // A lone modifier is not a chord. Clear stale feedback so the next press
      // reads as a fresh attempt rather than a stuck recorder.
      if (!binding || ['Meta', 'Control', 'Alt', 'Shift'].includes(event.key)) {
        setPreview(null)
        setError(null)
        setConflict(null)
        return
      }
      setPreview(binding)
      const found = findBindingConflict(binding, recording.commandId, effective)
      if (found?.kind === 'duplicate') {
        setConflict(String(found.against))
        setError(null)
        return
      }
      if (found) {
        setError(
          found.kind === 'platform-reserved'
            ? 'That chord belongs to the system.'
            : 'That chord is reserved by the app or the platform.',
        )
        setConflict(null)
        return
      }
      void liveRef.current.setBinding(recording.commandId, binding)
      setRecording(null)
      setPreview(null)
      setError(null)
      setConflict(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording, effective])

  const startRecording = useCallback((commandId: ShortcutCommandId) => {
    setRecording({ commandId })
    setPreview(null)
    setError(null)
    setConflict(null)
  }, [])

  const visible = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return SHORTCUT_COMMANDS.filter((entry) => {
      if (HIDDEN_SHORTCUT_COMMANDS.includes(entry.id)) return false
      const matchesText = !keyword || entry.id.toLowerCase().includes(keyword) || entry.label.toLowerCase().includes(keyword)
      const bindings = effective[entry.id] ?? []
      const matchesKey = keyQuery === null || bindings.some((binding) => isSamePhysicalBinding(binding, keyQuery))
      return matchesText && matchesKey
    })
  }, [query, keyQuery, effective])

  return (
    <div className="shortcuts-section">
      <p className="settings-note">
        Click a shortcut to record a new one. <kbd>Esc</kbd> cancels, <kbd>Backspace</kbd> resets that command to its
        default. Chords reserved by the platform or the app cannot be taken.
      </p>

      <div className="settings-row shortcuts-toolbar">
        <input
          className="text-input"
          value={query}
          placeholder="Filter shortcuts…"
          onChange={(event) => setQuery(event.target.value)}
        />
        <input
          className="text-input"
          value={keyQuery ?? ''}
          placeholder="Filter by key…"
          onChange={(event) => setKeyQuery(event.target.value || null)}
        />
      </div>

      {keyQuery && (
        <button className="connect-button" onClick={() => setKeyQuery(null)}>
          Clear key filter
        </button>
      )}

      <table className="shortcut-table">
        <tbody>
          {visible.map((entry) => {
            const bindings = effective[entry.id] ?? []
            const overridden = overrides[entry.id] != null
            return (
              <tr key={entry.id}>
                <td>{entry.label}</td>
                <td>
                  {recording?.commandId === entry.id ? (
                    <span className="shortcut-recording">{preview ? formatShortcut(preview) : 'Press a chord…'}</span>
                  ) : (
                    <span className="shortcut-bindings">
                      {bindings.map((binding) => formatShortcut(binding)).join('  /  ')}
                    </span>
                  )}
                </td>
                <td>
                  <button
                    className="connect-button"
                    onClick={() => (recording?.commandId === entry.id ? setRecording(null) : startRecording(entry.id))}
                  >
                    {recording?.commandId === entry.id ? 'Cancel' : 'Change'}
                  </button>
                  {overridden && (
                    <button className="connect-button" onClick={() => void resetBinding(entry.id)}>
                      Reset
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
          {visible.length === 0 && (
            <tr>
              <td colSpan={3} className="settings-note">
                Nothing matches that filter.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {error && <p className="account-error">{error}</p>}
      {conflict && (
        <p className="settings-note">
          Already used by <strong>{conflictLabel(conflict)}</strong>. Recording a second chord overwrites it.
        </p>
      )}
    </div>
  )
}

function conflictLabel(commandId: string): string {
  return SHORTCUT_COMMANDS.find((entry) => entry.id === commandId)?.label ?? commandId
}