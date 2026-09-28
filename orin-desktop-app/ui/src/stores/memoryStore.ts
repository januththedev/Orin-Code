import { create } from 'zustand'
import { bridge } from '../bridge/client'
import {
  MAX_ENTRIES_PER_SCOPE,
  buildMemoryContext,
  isValidMemory,
  normalizeByChat,
  normalizeScope,
  type MemoryEntry,
  type MemoryScope,
} from '../features/memory/memoryModel'

/**
 * Memory has two scopes, and the difference is the whole point of the page.
 *
 *   Global   — follows you into every chat. Preferences, who you are, how you
 *              like answers written. This is what makes a new chat feel like it
 *              already knows you.
 *   Per chat — belongs to one conversation. Its topic, its decisions, the
 *              detail you would not want dragged into an unrelated thread.
 *
 * Memory is stored through the same bridge store as chats, so it lands in the
 * same encrypted local store and follows the existing cloud sync. The rules
 * live in features/memory/memoryModel.ts so they can be tested without the app.
 */

export type { MemoryEntry, MemoryScope }
export { buildMemoryContext }

const STORAGE_KEY = 'memory'

const now = () => new Date().toISOString()
const uid = () => crypto.randomUUID()

export interface MemoryState {
  /** Applies to every chat. */
  global: MemoryEntry[]
  /** chatId → entries that only apply to that chat. */
  byChat: Record<string, MemoryEntry[]>
  hydrate: () => Promise<void>
  add: (content: string, scope: MemoryScope, chatId?: string | null) => void
  update: (id: string, content: string, scope: MemoryScope, chatId?: string | null) => void
  remove: (id: string, scope: MemoryScope, chatId?: string | null) => void
  /** Move a chat memory up to global. */
  promote: (id: string, chatId: string | null) => void
  /** Move a global memory down into one chat. */
  demote: (id: string, chatId: string) => void
  clearScope: (scope: MemoryScope, chatId?: string | null) => void
  forChat: (chatId: string | null) => MemoryEntry[]
}

let saveTimer: ReturnType<typeof setTimeout> | undefined
const persist = (global: MemoryEntry[], byChat: Record<string, MemoryEntry[]>) => {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    void bridge.storeSet(STORAGE_KEY, { global, byChat }).catch(() => {})
    void import('./cloudSync').then(({ scheduleCloudSync }) => scheduleCloudSync()).catch(() => {})
  }, 350)
}

export const useMemoryStore = create<MemoryState>((set, get) => ({
  global: [],
  byChat: {},

  hydrate: async () => {
    const raw = await bridge.storeGet<{ global?: unknown; byChat?: unknown }>(STORAGE_KEY).catch(() => null)
    if (!raw || typeof raw !== 'object') return
    set({ global: normalizeScope(raw.global), byChat: normalizeByChat(raw.byChat) })
  },

  add: (content, scope, chatId) => {
    if (!isValidMemory(content)) return
    const entry: MemoryEntry = { id: uid(), content: content.trim(), createdAt: now(), updatedAt: now(), source: scope === 'chat' ? 'chat' : 'user' }
    if (scope === 'global') {
      const global = [entry, ...get().global].slice(0, MAX_ENTRIES_PER_SCOPE)
      set({ global })
      persist(global, get().byChat)
      return
    }
    if (!chatId) return
    const byChat = { ...get().byChat, [chatId]: [entry, ...(get().byChat[chatId] ?? [])].slice(0, MAX_ENTRIES_PER_SCOPE) }
    set({ byChat })
    persist(get().global, byChat)
  },

  update: (id, content, scope, chatId) => {
    if (!isValidMemory(content)) return
    const trim = content.trim()
    if (scope === 'global') {
      const global = get().global.map((e) => (e.id === id ? { ...e, content: trim, updatedAt: now() } : e))
      set({ global })
      persist(global, get().byChat)
      return
    }
    if (!chatId) return
    const list = get().byChat[chatId] ?? []
    const byChat = { ...get().byChat, [chatId]: list.map((e) => (e.id === id ? { ...e, content: trim, updatedAt: now() } : e)) }
    set({ byChat })
    persist(get().global, byChat)
  },

  remove: (id, scope, chatId) => {
    if (scope === 'global') {
      const global = get().global.filter((e) => e.id !== id)
      set({ global })
      persist(global, get().byChat)
      return
    }
    if (!chatId) return
    const byChat = { ...get().byChat, [chatId]: (get().byChat[chatId] ?? []).filter((e) => e.id !== id) }
    if (!byChat[chatId].length) delete byChat[chatId]
    set({ byChat })
    persist(get().global, byChat)
  },

  promote: (id, chatId) => {
    if (!chatId) return
    const entry = (get().byChat[chatId] ?? []).find((e) => e.id === id)
    if (!entry) return
    get().remove(id, 'chat', chatId)
    get().add(entry.content, 'global')
  },

  demote: (id, chatId) => {
    const entry = get().global.find((e) => e.id === id)
    if (!entry) return
    get().remove(id, 'global')
    get().add(entry.content, 'chat', chatId)
  },

  clearScope: (scope, chatId) => {
    if (scope === 'global') {
      set({ global: [] })
      persist([], get().byChat)
      return
    }
    if (!chatId) return
    const byChat = { ...get().byChat }
    delete byChat[chatId]
    set({ byChat })
    persist(get().global, byChat)
  },

  forChat: (chatId) => {
    const chat = chatId ? get().byChat[chatId] ?? [] : []
    return [...get().global, ...chat]
  },
}))
