import { useCallback, useEffect, useState } from 'react'
import { bridge } from '../../bridge/client'
import type { PendingApproval } from '../../bridge/types'
import { PermissionDialog } from './PermissionDialog'

/**
 * Mounts the permission dialog whenever the agent is waiting on a decision.
 *
 * Hosted at the app root rather than inside a view, because an approval can be
 * raised by a queued task on the Background view, by the agent in a
 * conversation, or by a phone approval mirrored to this PC -- and the person
 * answering it may be looking at any of them. ZCode hosts it the same way
 * (`V4InteractionDialogs.tsx`), outside the conversation so it cannot be
 * scrolled away from.
 *
 * It polls rather than subscribing: the approval registry lives in Rust and
 * there is no event for "a decision is still outstanding", only for the request
 * itself. The poll is cheap and only runs while something is pending.
 */
export function ApprovalHost() {
  const [pending, setPending] = useState<PendingApproval | null>(null)

  const refresh = useCallback(async () => {
    try {
      const all = await bridge.approvalsPending()
      // Oldest first, so a queue of approvals resolves in the order they were
      // asked rather than in the order the poll happened to see them.
      setPending(all.sort((a, b) => a.expiresAtMs - b.expiresAtMs)[0] ?? null)
    } catch {
      // The command is unavailable in a browser-only boot; nothing to show.
    }
  }, [])

  useEffect(() => {
    void refresh()
    const id = setInterval(() => void refresh(), 1000)
    return () => clearInterval(id)
  }, [refresh])

  if (!pending) return null
  return <PermissionDialog approval={pending} onClose={() => void refresh()} />
}
