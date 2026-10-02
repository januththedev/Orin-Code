import { create } from 'zustand'
import { bridge } from '../bridge/client'
import {
  SHORTCUT_COMMANDS,
  getDefaultShortcutBindings,
  type ShortcutCommandId,
} from '../shortcuts/shortcutCommands'

/**
 * Effective keyboard bindings.
 *
 * ZCode persists a *sparse* override map — only the chords the user changed —
 * so a new command added in a later release arrives with its default rather
 * than being shadowed by a stale full snapshot. That behaviour is preserved.
 */
interface ShortcutsState {
  /** commandId -> bindings. Sparse: absent means "use the default". */
  overrides: Record<string, readonly string[]>
  hydrated: boolean
  hydrate: () => Promise<void>
  setBinding: (commandId: ShortcutCommandId, binding: string) => Promise<void>
  resetBinding: (commandId: ShortcutCommandId) => Promise<void>
  /** commandId -> the bindings actually in force, defaults resolved. */
  effective: () => Record<string, readonly string[]>
}

const KEY = 'shortcuts'

export const useShortcutsStore = create<ShortcutsState>((set, get) => ({
  overrides: {},
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return
    try {
      const saved = await bridge.storeGet<Record<string, readonly string[]>>(KEY)
      if (saved && typeof saved === 'object') set({ overrides: saved, hydrated: true })
      else set({ hydrated: true })
    } catch {
      set({ hydrated: true })
    }
  },

  setBinding: async (commandId, binding) => {
    const overrides = { ...get().overrides, [commandId]: [binding] }
    set({ overrides })
    await bridge.storeSet(KEY, overrides).catch(() => {})
  },

  resetBinding: async (commandId) => {
    // Delete the key rather than writing the default back, so "reset" actually
    // returns to inheriting from the table.
    const overrides = { ...get().overrides }
    delete overrides[commandId]
    set({ overrides })
    await bridge.storeSet(KEY, overrides).catch(() => {})
  },

  effective: () => {
    const overrides = get().overrides
    const out: Record<string, readonly string[]> = {}
    for (const entry of SHORTCUT_COMMANDS) {
      out[entry.id] = overrides[entry.id] ?? getDefaultShortcutBindings(entry.id)
    }
    return out
  },
}))

/** All commands that can currently be dispatched, with their live bindings. */
export function useEffectiveShortcuts(): Record<string, readonly string[]> {
  return useShortcutsStore((s) => s.effective())
}