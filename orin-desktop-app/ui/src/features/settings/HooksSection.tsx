import { useCallback, useEffect, useState } from 'react'
import { bridge } from '../../bridge/client'
import type { HookStatus } from '../../bridge/types'
import { SettingRow } from './SettingsLayout'
import { Button } from '../../components/Button'

/**
 * Workspace hooks.
 *
 * A hook is a policy the runtime interprets, never a script it runs. It can
 * deny a tool or add context to the model's view of the run — and that is
 * deliberately all it can do. A hook that could approve an action would let a
 * file the model may have written quietly green-light writes that the
 * run-bound approval system exists to gate.
 *
 * Trust is bound to the file's content digest, so editing the file after
 * approving it revokes trust silently.
 */
export function HooksSection() {
  const [status, setStatus] = useState<HookStatus | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(() => {
    bridge.hooksStatus()
      .then((next) => { setStatus(next); setError('') })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not read hook status.'))
  }, [])

  useEffect(refresh, [refresh])

  const act = (fn: () => Promise<unknown>) => {
    setBusy(true)
    fn()
      .then(refresh)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'That did not work.'))
      .finally(() => setBusy(false))
  }

  if (!status) {
    return <p className="settings-note">{error || 'Reading workspace hooks…'}</p>
  }

  if (!status.present) {
    return (
      <SettingRow label="Workspace hooks" hint={`This project has no ${'.orin/hooks.json'}.`}>
        <span className="settings-note">None</span>
      </SettingRow>
    )
  }

  if (status.problems.length > 0) {
    return (
      <div>
        <SettingRow label="Workspace hooks" hint="The hook file has problems, so nothing in it is active.">
          <span className="settings-note settings-note--warn">Invalid</span>
        </SettingRow>
        <ul className="hook-problems">
          {status.problems.map((problem) => <li key={problem.message}>{problem.message}</li>)}
        </ul>
      </div>
    )
  }

  return (
    <div className="hooks-section">
      <SettingRow
        label="Workspace hooks"
        hint="Hooks can deny a tool or add context. They cannot approve an action — that is always yours."
      >
        {status.trusted ? (
          <Button size="sm" onClick={() => act(() => bridge.hooksRevoke())} disabled={busy}>
            Revoke trust
          </Button>
        ) : (
          <Button size="sm" onClick={() => act(() => bridge.hooksTrust())} disabled={busy}>
            Trust this file
          </Button>
        )}
      </SettingRow>

      <ul className="hook-list">
        {status.hooks.map((hook, index) => (
          <li key={`${hook.name}-${index}`} className="hook-item">
            <div className="hook-item-head">
              <code className="hook-event">{hook.event}</code>
              <span className="hook-name">{hook.name}</span>
              {hook.matcher && <code className="hook-matcher">tool: {hook.matcher}</code>}
            </div>
            {hook.deny && <p className="hook-detail hook-detail--deny">Denies: {hook.deny}</p>}
            {hook.context && <p className="hook-detail">Adds context: {hook.context}</p>}
          </li>
        ))}
      </ul>

      {status.digest && (
        <p className="settings-note">
          Content digest <code>{status.digest.slice(0, 16)}…</code> — editing the file revokes this.
        </p>
      )}
      {error && <p className="settings-note settings-note--warn">{error}</p>}
    </div>
  )
}
