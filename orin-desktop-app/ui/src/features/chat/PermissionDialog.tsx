import { useCallback, useEffect, useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import { bridge } from '../../bridge/client'
import type { PendingApproval } from '../../bridge/types'

/**
 * The permission dialog, ported from ZCode's `PermissionDialog`
 * (`packages/ui/src/v4/V4InteractionDialogs.tsx:319-353`).
 *
 * What ZCode shows and Orin Code now shows the same: the TOOL and its
 * ARGUMENTS, not just "it wants to change something". Getting there needed a
 * core change — `PendingApproval` carried only a run id and an expiry, while
 * `request_approval` already computed tool, title, detail and destructive for
 * the event and the phone mirror and then discarded them.
 *
 * Keyboard behaviour is ZCode's, because it is the part that matters when the
 * dialog is modal: `1` / `2` / `3` answer an option directly, Enter submits,
 * Escape blurs without answering. A response that fails is surfaced rather
 * than swallowed — ZCode passes `responseError` through for exactly this
 * (`V4InteractionDialogs.tsx:330-333`).
 *
 * Approvals remain run-bound, expiring and single-use. Nothing here can
 * approve on the user's behalf, and dismissing the dialog is not consent: the
 * run's own timeout resolves it as not approved.
 */

export interface ApprovalOption {
  id: 'approve' | 'approve-always' | 'reject'
  label: string
  /** A one-key answer, matching ZCode's numbered options. */
  digit: '1' | '2' | '3'
}

export const APPROVAL_OPTIONS: readonly ApprovalOption[] = [
  { id: 'approve', label: 'Approve once', digit: '1' },
  { id: 'approve-always', label: 'Approve for this run', digit: '2' },
  { id: 'reject', label: 'Reject', digit: '3' },
]

export function PermissionDialog({ approval, onClose }: { approval: PendingApproval; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [focused, setFocused] = useState(false)

  const respond = useCallback(
    async (option: ApprovalOption) => {
      setBusy(true)
      setError(null)
      try {
        // `approve-always` is scoped to THIS RUN, never global. A run-bound,
        // expiring, single-use decision is the invariant the whole approval
        // system is built on; a sticky global approval would break it.
        await bridge.approvalRespond(approval.approvalId, option.id !== 'reject', approval.runId)
        onClose()
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'That decision did not reach the run.')
      } finally {
        setBusy(false)
      }
    },
    [approval, onClose],
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // Escape blurs; it does not answer. ZCode does the same
        // (`PermissionDialog.tsx:622-638`).
        setFocused(false)
        return
      }
      const option = APPROVAL_OPTIONS.find((o) => o.digit === event.key)
      if (option) {
        event.preventDefault()
        void respond(option)
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        void respond(APPROVAL_OPTIONS[0])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [respond])

  return (
    <div className="permission-scrim" onMouseDown={() => setFocused(false)}>
      <div
        className="permission-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Approval required"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="permission-head">
          <ShieldAlert size={15} aria-hidden="true" />
          <span>Approval required</span>
          {approval.destructive && <em className="permission-destructive">destructive</em>}
        </header>

        <div className="permission-body">
          <p className="permission-title">{approval.title}</p>
          <code className="permission-tool">{approval.tool}</code>
          {approval.detail && <pre className="permission-detail">{approval.detail}</pre>}
        </div>

        <div className="permission-options">
          {APPROVAL_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`permission-option ${option.id === 'reject' ? 'reject' : ''}`}
              disabled={busy}
              onClick={() => void respond(option)}
            >
              <kbd>{option.digit}</kbd>
              {option.label}
            </button>
          ))}
        </div>

        {error && <p className="permission-error">{error}</p>}
        {!focused && <p className="permission-hint">Press 1, 2 or 3. Escape dismisses without answering.</p>}
      </div>
    </div>
  )
}
