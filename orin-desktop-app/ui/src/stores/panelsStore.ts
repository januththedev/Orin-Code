import { create } from 'zustand'
import { bridge } from '../bridge/client'
import { useWorkspaceStore } from './workspaceStore'
import {
  closeAll,
  closeOthers,
  closeTab,
  isRestorableTab,
  openTab,
  reorderTabs,
  toggleTab,
  RECENT_CLOSED_SIDE_PANE_TAB_LIMIT,
  tabOwnerKey,
  type SidePaneState,
  type SidePaneTab,
} from '../shell/sidePaneTabs'

/**
 * Side-pane and terminal panel state.
 *
 * Ported from ZCode's `hooks/useAppPanels.ts`, keeping the behaviours that are
 * easy to lose in a port:
 *
 *   - Collapse state is persisted PER OWNER, not globally, so collapsing the
 *     pane in one conversation does not collapse it in every other one.
 *   - Recently-closed is capped at 8 and excludes non-restorable tabs, so
 *     reopening never points at a dead PTY or a dead agent page.
 *   - The terminal panel defaults CLOSED, and its toggle is suppressed in
 *     office mode.
 */
/** Persisted shape. Terminal session ids are deliberately excluded: a PTY id
 * from a previous run is dead, and restoring one would point the terminal at a
 * process that no longer exists. The panel reopens and creates a fresh one. */
type PersistedPanels = Pick<PanelsState, 'sidePane' | 'sidePaneCollapsed' | 'recentlyClosed' | 'terminalCollapsed'>

function persist(state: PanelsState): void {
  const payload: PersistedPanels = {
    sidePane: state.sidePane,
    sidePaneCollapsed: state.sidePaneCollapsed,
    recentlyClosed: state.recentlyClosed,
    terminalCollapsed: state.terminalCollapsed,
  }
  void bridge.storeSet(KEY, payload).catch(() => {})
}

interface PanelsState {
  sidePane: SidePaneState
  /** Collapsed is the inverse of open: ZCode persists "collapsed". */
  sidePaneCollapsed: Record<string, boolean>
  recentlyClosed: SidePaneTab[]

  terminalOpen: boolean
  terminalCollapsed: boolean
  terminalSessionId: string | null

  hydrated: boolean
  hydrate: () => Promise<void>

  open: (tab: SidePaneTab) => void
  toggle: (tab: SidePaneTab) => void
  close: (id: string) => void
  closeOthers: (id: string) => void
  closeAll: () => void
  reorder: (from: number, to: number) => void
  reopenClosed: (id: string) => void
  setSidePaneCollapsed: (ownerKey: string, collapsed: boolean) => void

  setTerminalOpen: (open: boolean) => void
  setTerminalCollapsed: (collapsed: boolean) => void
  ensureTerminalSession: () => Promise<string | null>
  releaseTerminalSession: () => void
}

const KEY = 'panels'

let counter = 0
export function newTabId(prefix: string): string {
  counter += 1
  return `${prefix}-${counter}-${Math.random().toString(36).slice(2, 8)}`
}

export const usePanelsStore = create<PanelsState>((set, get) => ({
  sidePane: { tabs: [], activeTabId: null },
  sidePaneCollapsed: {},
  recentlyClosed: [],
  terminalOpen: false,
  terminalCollapsed: false,
  terminalSessionId: null,
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return
    try {
      const saved = await bridge.storeGet<Partial<PanelsState>>(KEY)
      if (saved && typeof saved === 'object') {
        // Restoring a tab whose content no longer exists would show a dead
        // handle, so non-restorable tabs are dropped on read -- the same reason
        // ZCode excludes them from restore.
        const tabs = (saved.sidePane?.tabs ?? []).filter(isRestorableTab)
        const activeStillPresent = tabs.some((tab) => tab.id === saved.sidePane?.activeTabId)
        set({
          ...saved,
          sidePane: { tabs, activeTabId: activeStillPresent ? saved.sidePane!.activeTabId : (tabs[0]?.id ?? null) },
          recentlyClosed: (saved.recentlyClosed ?? []).filter(isRestorableTab).slice(0, RECENT_CLOSED_SIDE_PANE_TAB_LIMIT),
          hydrated: true,
        })
        return
      }
    } catch {
      // fall through to defaults
    }
    set({ hydrated: true })
  },

  open: (tab) =>
    set((s) => {
      const next = { sidePane: openTab(s.sidePane, tab) }
      persist({ ...s, ...next })
      return next
    }),

  toggle: (tab) =>
    set((s) => {
      const next = toggleTab(s.sidePane, tab)
      const closed = s.sidePane.tabs.find((candidate) => !next.tabs.some((t) => t.id === candidate.id))
      if (!closed) return { sidePane: next }
      const recentlyClosed = [closed, ...s.recentlyClosed.filter((t) => t.id !== closed.id)].slice(0, RECENT_CLOSED_SIDE_PANE_TAB_LIMIT)
      persist({ ...s, sidePane: next, recentlyClosed })
      return { sidePane: next, recentlyClosed }
    }),

  close: (id) =>
    set((s) => {
      const closing = s.sidePane.tabs.find((tab) => tab.id === id)
      const next = closeTab(s.sidePane, id)
      const recentlyClosed = closing
        ? [closing, ...s.recentlyClosed.filter((t) => t.id !== id)].slice(0, RECENT_CLOSED_SIDE_PANE_TAB_LIMIT)
        : s.recentlyClosed
      persist({ ...s, sidePane: next, recentlyClosed })
      return { sidePane: next, recentlyClosed }
    }),

  closeOthers: (id) =>
    set((s) => {
      const next = { sidePane: closeOthers(s.sidePane, id) }
      persist({ ...s, ...next })
      return next
    }),

  closeAll: () =>
    set((s) => {
      const next = { sidePane: closeAll() }
      persist({ ...s, ...next })
      return next
    }),

  reorder: (from, to) =>
    set((s) => {
      const next = { sidePane: reorderTabs(s.sidePane, from, to) }
      persist({ ...s, ...next })
      return next
    }),

  reopenClosed: (id) =>
    set((s) => {
      const tab = s.recentlyClosed.find((candidate) => candidate.id === id)
      if (!tab) return {}
      const next = {
        sidePane: openTab(s.sidePane, { ...tab, id: newTabId(tab.type) }),
        recentlyClosed: s.recentlyClosed.filter((candidate) => candidate.id !== id),
      }
      persist({ ...s, ...next })
      return next
    }),
  // eslint-disable-next-line

  setSidePaneCollapsed: (ownerKey, collapsed) =>
    set((s) => {
      const next = { sidePaneCollapsed: { ...s.sidePaneCollapsed, [ownerKey]: collapsed } }
      persist({ ...s, ...next })
      return next
    }),

  setTerminalOpen: (open) => set({ terminalOpen: open }),

  setTerminalCollapsed: (collapsed) =>
    set((s) => {
      persist({ ...s, terminalCollapsed: collapsed })
      return { terminalCollapsed: collapsed }
    }),

  ensureTerminalSession: async () => {
    const existing = get().terminalSessionId
    if (existing) return existing
    try {
      // The PTY starts in the workspace, so the terminal is inside the project
      // the user opened rather than wherever the app happened to launch.
      const cwd = useWorkspaceStore.getState().localWorkspacePath
      const id = await bridge.termCreate(cwd || undefined)
      set({ terminalSessionId: id })
      return id
    } catch {
      return null
    }
  },

  releaseTerminalSession: () => {
    const id = get().terminalSessionId
    set({ terminalSessionId: null })
    if (id) void bridge.termKill(id).catch(() => {})
  },
}))

/** Convenience: the key a collapse preference is stored under for this owner. */
export { tabOwnerKey }