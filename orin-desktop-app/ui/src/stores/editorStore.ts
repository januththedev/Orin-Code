import { create } from 'zustand'
import { bridge } from '../bridge/client'

/**
 * Open editor tabs, lifted out of IdePage.
 *
 * ZCode keeps tabs in the tab store rather than in the editor component, and
 * that is not incidental: the sidebar file tree, the agent and the side pane
 * all open files, and a tab list scoped to one component makes that impossible
 * -- the sidebar could show a tree but could not open anything in it, and the
 * agent had no way to surface a file it had just written.
 *
 * Contents are held in memory, like the component did before. ZCode persists
 * its tabs across restarts; that needs the same reopen-and-refetch treatment
 * used here rather than storing file bodies, which would go stale.
 */

export interface OpenTab {
  /** Workspace-relative when the path is inside the workspace, else absolute. */
  path: string
  name: string
  content: string
  dirty: boolean
  error?: string
}

interface EditorState {
  tabs: OpenTab[]
  activePath: string | null
  hydrated: boolean
  hydrate: () => Promise<void>

  openFile: (path: string, name: string) => Promise<void>
  closeTab: (path: string) => void
  setActive: (path: string) => void
  setContent: (path: string, content: string) => void
  markDirty: (path: string, dirty: boolean) => void
  reloadFile: (path: string) => Promise<void>
}

function basename(p: string): string {
  const parts = p.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts[parts.length - 1] ?? p
}

const KEY = 'editor-tabs'

/**
 * Only paths and names are persisted. ZCode persists its tabs across restarts
 * (`useTabPersistence`); storing file *contents* would go stale the moment
 * anything else wrote the file, so contents are refetched on reopen.
 */
async function persist(tabs: OpenTab[], activePath: string | null): Promise<void> {
  await bridge
    .storeSet(KEY, { tabs: tabs.map(({ path, name }) => ({ path, name })), activePath })
    .catch(() => {})
}

export const useEditorStore = create<EditorState>((set, get) => ({
  tabs: [],
  activePath: null,
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return
    try {
      const saved = await bridge.storeGet<{ tabs?: Array<{ path: string; name: string }>; activePath?: string | null }>(KEY)
      if (saved && Array.isArray(saved.tabs) && saved.tabs.length) {
        // Refetch contents, and drop any tab whose file has gone.
        const reopened: OpenTab[] = []
        for (const entry of saved.tabs) {
          const exists = await bridge.fileExists(entry.path).catch(() => false)
          if (!exists) continue
          try {
            reopened.push({ path: entry.path, name: entry.name, content: await bridge.readFile(entry.path), dirty: false })
          } catch (error) {
            reopened.push({ path: entry.path, name: entry.name, content: '', dirty: false, error: String(error) })
          }
        }
        set({
          tabs: reopened,
          activePath: reopened.some((tab) => tab.path === saved.activePath) ? saved.activePath! : (reopened[0]?.path ?? null),
          hydrated: true,
        })
        return
      }
    } catch {
      // fall through
    }
    set({ hydrated: true })
  },

  openFile: async (path, name) => {
    const { tabs, activePath } = get()
    // Already open: activate it rather than reading the file again.
    if (tabs.some((tab) => tab.path === path)) {
      set({ activePath: path })
      void persist(tabs, path)
      return
    }
    const label = name || basename(path)
    try {
      const content = await bridge.readFile(path)
      set((s) => {
        const next = { tabs: [...s.tabs, { path, name: label, content, dirty: false }], activePath: path }
        void persist(next.tabs, path)
        return next
      })
    } catch (error) {
      // A tab that failed to read still opens, showing the error. Hiding the
      // failure would leave the user with a file tree entry that does nothing.
      set((s) => {
        const nextTabs = [...s.tabs, { path, name: label, content: '', dirty: false, error: String(error).replace(/^Error:\s*/, '') }]
        void persist(nextTabs, path)
        return { tabs: nextTabs, activePath: path }
      })
    }
    void activePath
  },

  closeTab: (path) =>
    set((s) => {
      const index = s.tabs.findIndex((tab) => tab.path === path)
      const tabs = s.tabs.filter((tab) => tab.path !== path)
      // Closing the active tab activates its neighbour, as the side pane does.
      const activePath =
        s.activePath === path ? (tabs[Math.min(index, tabs.length - 1)]?.path ?? null) : s.activePath
      void persist(tabs, activePath)
      return { tabs, activePath }
    }),

  setActive: (path) => {
    set({ activePath: path })
    void persist(get().tabs, path)
  },

  setContent: (path, content) =>
    set((s) => ({ tabs: s.tabs.map((tab) => (tab.path === path ? { ...tab, content } : tab)) })),

  markDirty: (path, dirty) =>
    set((s) => ({ tabs: s.tabs.map((tab) => (tab.path === path ? { ...tab, dirty } : tab)) })),

  reloadFile: async (path) => {
    try {
      const content = await bridge.readFile(path)
      set((s) => ({ tabs: s.tabs.map((tab) => (tab.path === path ? { ...tab, content, error: undefined } : tab)) }))
    } catch (error) {
      set((s) => ({ tabs: s.tabs.map((tab) => (tab.path === path ? { ...tab, error: String(error) } : tab)) }))
    }
  },
}))

/** Convenience for non-React callers, e.g. the agent reporting a written file. */
export function openInEditor(path: string, name?: string): Promise<void> {
  return useEditorStore.getState().openFile(path, name ?? basename(path))
}