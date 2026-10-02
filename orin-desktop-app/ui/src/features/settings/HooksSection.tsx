import { useCallback, useEffect, useState } from 'react'
import { bridge } from '../../bridge/client'
import type { Hook, HookEvent, HookStatus } from '../../bridge/types'
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
 * approving it revokes trust silently. That is why saving here REVOKES rather
 * than re-trusting: the file is exactly what the user is being asked to
 * approve, and an edit that approved itself would defeat the check.
 *
 * ZCode authors hooks by editing its config file, so a section that could only
 * LIST them was a dead surface. This adds authoring against the same manifest
 * the reader already parses.
 *
 * One ZCode capability is deliberately NOT reproduced, and is named here rather
 * than hidden: ZCode's hooks are `process` or `custom` handlers that execute a
 * command (`hooksService.ts:34-66`). Orin Code does not run hook processes, and
 * adding that would reintroduce exactly the hole deny-only exists to close, so
 * the constraint is stated on screen instead of papered over.
 */
/** ZCode's seven events, in the order its own list uses
 * (`hooksService.ts:34-42`). Orin Code keeps the same set. */
const HOOK_EVENTS: readonly HookEvent[] = [
  'sessionStart',
  'userPromptSubmit',
  'preToolUse',
  'permissionRequest',
  'postToolUse',
  'postToolUseFailure',
  'stop',
]

const TOOL_EVENTS: readonly HookEvent[] = ['preToolUse', 'postToolUse', 'postToolUseFailure', 'permissionRequest']

export function HooksSection() {
  const [status, setStatus] = useState<HookStatus | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(() => {
    bridge.hooksStatus()
      .then((next) => { setStatus(next); setError('') })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not read hook status.'))
  }, [])

  const [editing, setEditing] = useState<Hook | null>(null)

  useEffect(refresh, [refresh])

  const save = async (hooks: Hook[]) => {
    setBusy(true)
    try {
      const next = await bridge.hooksWrite(hooks)
      setStatus(next)
      setError('')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not write the hook file.')
    } finally {
      setBusy(false)
    }
  }

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
      <div>
        <SettingRow label="Workspace hooks" hint={`This project has no ${'.orin/hooks.json'}.`}>
          <span className="settings-note">None</span>
        </SettingRow>
        <Button size="sm" onClick={() => setEditing({ event: 'preToolUse', name: '' })}>
          Add a hook
        </Button>
      </div>
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
              <span className="hook-item-actions">
                <Button size="sm" onClick={() => setEditing({ ...hook })}>Edit</Button>
                <Button
                  size="sm"
                  onClick={() => void save(status.hooks.filter((_, i) => i !== index))}
                  disabled={busy}
                >
                  Remove
                </Button>
              </span>
            </div>
            {hook.deny && <p className="hook-detail hook-detail--deny">Denies: {hook.deny}</p>}
            {hook.context && <p className="hook-detail">Adds context: {hook.context}</p>}
          </li>
        ))}
      </ul>

      {editing ? (
        <div className="hook-editor">
          <SettingRow label="Event" hint="When this hook runs.">
            <select
              className="select-input"
              value={editing.event}
              onChange={(event) => setEditing({ ...editing, event: event.target.value as HookEvent })}
            >
              {HOOK_EVENTS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </SettingRow>
          <SettingRow label="Name" hint="Shown in the trust prompt.">
            <input
              className="text-input"
              value={editing.name}
              onChange={(event) => setEditing({ ...editing, name: event.target.value })}
            />
          </SettingRow>
          <SettingRow label="Tool matcher" hint="Tool name this applies to. Empty means every tool.">
            <input
              className="text-input"
              value={editing.matcher ?? ''}
              placeholder="fs_write_file"
              onChange={(event) => setEditing({ ...editing, matcher: event.target.value || undefined })}
            />
          </SettingRow>
          <SettingRow label="Deny" hint="Refuses the tool and shows this reason. The only way a hook can block.">
            <input
              className="text-input"
              value={editing.deny ?? ''}
              onChange={(event) => setEditing({ ...editing, deny: event.target.value || undefined })}
            />
          </SettingRow>
          <SettingRow label="Add context" hint="Appended to the model's view, labelled untrusted.">
            <input
              className="text-input"
              value={editing.context ?? ''}
              onChange={(event) => setEditing({ ...editing, context: event.target.value || undefined })}
            />
          </SettingRow>
          <div className="hook-editor-actions">
            <Button
              size="sm"
              onClick={() => {
                const existing = status.hooks.findIndex((h) => h.name === editing.name && h.event === editing.event)
                const next =
                  existing >= 0
                    ? status.hooks.map((h, i) => (i === existing ? editing : h))
                    : [...status.hooks, editing]
                void save(next)
                setEditing(null)
              }}
              disabled={busy || editing.name.trim().length === 0}
            >
              Save hook
            </Button>
            <Button size="sm" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>
          <p className="settings-note">
            Saving writes <code>.orin/hooks.json</code> and withdraws trust, so you approve exactly what you just
            changed. A hook cannot approve an action -- there is no such field, deliberately.
          </p>
        </div>
      ) : (
        <Button size="sm" onClick={() => setEditing({ event: 'preToolUse', name: '' })}>
          Add a hook
        </Button>
      )}

      <p className="settings-note settings-note--warn">
        ZCode's hooks can also be <code>process</code> handlers that run a shell command. Orin Code does not
        execute hook processes, and this is the one capability here that is deliberately not reproduced: letting a
        model-authored file run a command would reopen the hole deny-only exists to close.
      </p>

      {status.digest && (
        <p className="settings-note">
          Content digest <code>{status.digest.slice(0, 16)}…</code> — editing the file revokes this.
        </p>
      )}
      {error && <p className="settings-note settings-note--warn">{error}</p>}
    </div>
  )
}
