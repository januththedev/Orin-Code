import { create } from 'zustand'
import { bridge } from '../bridge/client'

/**
 * The workspace context, ported from ZCode's `store/tabStore.ts` workspace
 * half plus `root/rootWorkspaceShellTarget.ts`.
 *
 * A workspace is not a list of folders. It is the context every other surface
 * depends on: the explorer's root, the terminal's working directory, git's
 * root, the agent's sandbox boundary, and the key that scopes side-pane state.
 * Opening a folder therefore has to establish all of them, or the app looks
 * like it has a project while the agent is still running somewhere else.
 *
 * `identity` exists for remote workspaces: `10.0.0.1:/home/dev` and
 * `10.0.0.2:/home/dev` are the same path and different workspaces
 * (`tabStore.ts:26,257-263`). Orin Code has no remote transport yet, so
 * identity is always derived from the local path and the field exists so the
 * remote case does not have to reshape the model when it arrives.
 */

/** Why a workspace exists. ZCode distinguishes these in `workspacePurpose`. */
export type WorkspacePurpose = 'workspace' | 'conversation' | 'scratch'

/** `available` vs a directory that has gone missing since it was opened. */
export type WorkspaceAvailability = 'available' | 'unavailable-local-directory'

export interface WorkspaceState {
  localWorkspacePath: string
  workspaceIdentity: string
  workspacePurpose: WorkspacePurpose
  availability: WorkspaceAvailability

  /**
   * Remote fields, modelled but unused. ZCode carries `remoteSessionId` and
   * `remoteTarget` on the workspace tab and refuses to cross-bind a remote
   * session to the wrong workspace (`useWorkspaceTaskNavigation.ts:96-118`).
   */
  remoteSessionId: string | null
  remoteTarget: string | null

  /** Expanded folders in the tree, keyed by path relative to the root. */
  expanded: string[]
  /** The file the editor is showing, so a tree selection survives a reload. */
  activeFile: string | null

  hydrated: boolean
  hydrate: () => Promise<void>
  open: (path: string, purpose?: WorkspacePurpose, identity?: string) => Promise<void>
  close: () => void
  setAvailability: (availability: WorkspaceAvailability) => void
  toggleExpanded: (relativePath: string) => void
  expandAll: () => void
  collapseAll: () => void
  setActiveFile: (relativePath: string | null) => void
}

/**
 * The key ZCode uses to decide whether two workspaces are the same one.
 * Identity wins over path, because a remote workspace is identified by more
 * than its path.
 */
export function workspaceKey(state: { workspaceIdentity?: string | null; localWorkspacePath?: string }): string {
  return (state.workspaceIdentity ?? '').trim() || state.localWorkspacePath || ''
}

/**
 * ZCode scopes side-pane state per workspace AND per conversation
 * (`buildTaskSidePaneMemoryKey`). Without the workspace in that key, opening a
 * project would surface the previous project's panes.
 */
export function buildSidePaneOwnerKey(workspace: string, taskId: string | null | undefined): string {
  return `${workspace}::${taskId ?? ''}`
}

const KEY = 'workspace'

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  localWorkspacePath: '',
  workspaceIdentity: '',
  workspacePurpose: 'workspace',
  availability: 'available',
  remoteSessionId: null,
  remoteTarget: null,
  expanded: [],
  activeFile: null,
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return
    try {
      const saved = await bridge.storeGet<Partial<WorkspaceState>>(KEY)
      if (saved && typeof saved === 'object' && saved.localWorkspacePath) {
        // A folder can be deleted or renamed between runs, so a restored
        // workspace is re-checked rather than assumed. ZCode carries the same
        // `unavailable-local-directory` availability for exactly this.
        const exists = await bridge.fileExists(saved.localWorkspacePath).catch(() => false)
        set({
          ...saved,
          availability: exists ? 'available' : 'unavailable-local-directory',
          hydrated: true,
        })
        return
      }
    } catch {
      // fall through
    }
    set({ hydrated: true })
  },

  open: async (path, purpose = 'workspace', identity) => {
    const trimmed = path.trim()
    if (!trimmed) return
    const nextIdentity = identity ?? trimmed
    set({
      localWorkspacePath: trimmed,
      workspaceIdentity: nextIdentity,
      workspacePurpose: purpose,
      availability: 'available',
      expanded: [],
      activeFile: null,
    })
    // Tell the core. This is what actually moves the agent's sandbox boundary
    // and the terminal's working directory -- without it, opening a folder
    // would change the explorer and nothing else.
    await bridge.workspaceActivate(trimmed).catch(() => {})
    await persist(get())
  },

  close: () => {
    set({ localWorkspacePath: '', workspaceIdentity: '', expanded: [], activeFile: null, remoteSessionId: null, remoteTarget: null })
    void persist(get())
  },

  setAvailability: (availability) => {
    set({ availability })
    void persist(get())
  },

  toggleExpanded: (relativePath) => {
    const expanded = get().expanded.includes(relativePath)
      ? get().expanded.filter((p) => p !== relativePath)
      : [...get().expanded, relativePath]
    set({ expanded })
    void persist(get())
  },

  expandAll: () => {
    set({ expanded: ['*'] })
    void persist(get())
  },

  collapseAll: () => {
    set({ expanded: [] })
    void persist(get())
  },

  setActiveFile: (relativePath) => {
    set({ activeFile: relativePath })
    void persist(get())
  },
}))

async function persist(state: WorkspaceState): Promise<void> {
  await bridge
    .storeSet(KEY, {
      localWorkspacePath: state.localWorkspacePath,
      workspaceIdentity: state.workspaceIdentity,
      workspacePurpose: state.workspacePurpose,
      remoteSessionId: state.remoteSessionId,
      remoteTarget: state.remoteTarget,
      expanded: state.expanded,
      activeFile: state.activeFile,
    })
    .catch(() => {})
}

/** The active workspace's root, or '' when none is open. */
export function useWorkspacePath(): string {
  return useWorkspaceStore((s) => s.localWorkspacePath)
}