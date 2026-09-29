import { create } from 'zustand'
import { bridge } from '../bridge/client'
import type { AiMessage, MessagePart } from '../bridge/types'
import { useSettingsStore } from './settingsStore'
import { buildMemoryContext, useMemoryStore } from './memoryStore'
import {
  INDEX_KEY,
  LEGACY_KEY,
  buildIndex,
  conversationKey,
  hydrate,
  planMigration,
  toSummary,
  upsertSummary,
  type ChatSummary,
} from './chatStoreModel'
import { playSound, type SoundName } from '../design/sound'

/** Play a cue only if the user has sound on, at the volume they chose. */
const cue = (name: SoundName) => {
  const { sound, volume } = useSettingsStore.getState()
  playSound(name, sound, volume)
}

export type ChatMode = 'chat' | 'cowork' | 'agent' | 'computer'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  pending?: boolean
  error?: string
  mode?: ChatMode
}

export interface Conversation {
  id: string
  title: string
  messages: ChatMessage[]
  mode: ChatMode
  projectId: string | null
  pinned: boolean
  archived: boolean
  createdAt: string
  updatedAt: string
}

interface ChatsState {
  /** Loaded conversations. Only opened ones are held here. */
  conversations: Conversation[]
  /** The small per-conversation index read at launch. */
  index: ChatSummary[]
  activeId: string | null
  hydrate: () => Promise<void>
  /** Load a conversation on demand; safe to call repeatedly. */
  openChat: (id: string) => Promise<void>
  createChat: (mode?: ChatMode, projectId?: string | null) => string
  selectChat: (id: string) => void
  renameChat: (id: string, title: string) => void
  deleteChat: (id: string) => void
  pinChat: (id: string, pinned: boolean) => void
  archiveChat: (id: string, archived: boolean) => void
  moveToProject: (id: string, projectId: string | null) => void
  setMode: (id: string, mode: ChatMode) => void
  sendMessage: (text: string, opts?: { imageParts?: import('../bridge/types').MessagePart[] }) => void
  stopStreaming: () => void
}

let saveTimer: ReturnType<typeof setTimeout> | undefined
/** Only conversations with at least one message are worth keeping — an
 * untouched "new chat" must never be saved, locally or to the cloud. */
export const withMessages = (conversations: Conversation[]) =>
  conversations.filter((c) => c.messages.length > 0)
/** Restarting with a stuck `pending` response would freeze the UI on a
 * ghost "thinking" state — settle them on load. */
export const settlePending = (conversations: Conversation[]) =>
  conversations.map((c) => ({
    ...c,
    messages: c.messages.map((m) => (m.pending ? { ...m, pending: false } : m)),
  }))
/**
 * Persist the index plus only the conversations that changed.
 *
 * Writing every message on every keystroke is what made chats slow: the old
 * single blob meant each save rewrote the whole history. `dirty` holds the ids
 * touched since the last flush; everything else is already on disk.
 */
const dirty = new Set<string>()

/**
 * Write the index and only the conversations that changed.
 *
 * `conversations` holds only the *opened* chats, so the index has to be merged
 * with the rows already on disk. Building it from `conversations` alone would
 * silently drop every chat the user has but has not opened this session.
 */
const flush = (conversations: Conversation[]) => {
  const kept = withMessages(conversations)
  const writes: Promise<unknown>[] = []

  let index = useChatsStore.getState().index
  for (const chat of kept) {
    index = upsertSummary(index, toSummary(chat))
  }
  useChatsStore.setState({ index })
  writes.push(bridge.storeSet(INDEX_KEY, index).catch(() => {}))

  for (const chat of kept) {
    if (dirty.has(chat.id)) {
      writes.push(bridge.storeSet(conversationKey(chat.id), chat.messages).catch(() => {}))
    }
  }
  // A deleted conversation's blob must go too, or it is orphaned forever.
  for (const id of dirty) {
    if (!kept.some((c) => c.id === id)) {
      writes.push(bridge.storeDelete(conversationKey(id)).catch(() => {}))
    }
  }
  dirty.clear()
  void Promise.all(writes)
  // Every mutation funnels through here — one hook covers cloud sync.
  void import('./cloudSync').then(({ scheduleCloudSync }) => scheduleCloudSync())
}

const persist = (conversations: Conversation[]) => {
  clearTimeout(saveTimer)
  for (const chat of conversations) dirty.add(chat.id)
  saveTimer = setTimeout(() => flush(conversations), 350)
}

// Disposer of the in-flight stream, kept where stopStreaming can reach it.
// Purely additive — existing actions keep their signatures and behavior.
let activeStreamDisposer: (() => void) | null = null

const now = () => new Date().toISOString()
const uid = () => crypto.randomUUID()

const titleFrom = (text: string) => {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > 44 ? `${clean.slice(0, 44)}…` : clean || 'New conversation'
}

export const useChatsStore = create<ChatsState>((set, get) => ({
  conversations: [],
  index: [],
  activeId: null,

  hydrate: async () => {
    try {
      // One-time migration from the old single blob. The legacy key is deleted
      // afterwards, so its cost is paid exactly once and not on every launch.
      const legacy = await bridge.storeGet<unknown>(LEGACY_KEY)
      if (Array.isArray(legacy) && legacy.length) {
        const plan = planMigration(legacy)
        const rebuilt = plan.index.map((summary) => hydrate(summary, plan.messages[summary.id] ?? []))
        for (const chat of rebuilt) dirty.add(chat.id)
        flush(rebuilt)
        for (const id of plan.dropped) dirty.delete(id)
        await bridge.storeDelete(LEGACY_KEY).catch(() => {})
      }

      const index = await bridge.storeGet<ChatSummary[]>(INDEX_KEY)
      if (!Array.isArray(index) || !index.length) return

      // Only the conversation about to be seen is loaded. The rest stay on disk
      // until they are opened, so launch costs the index, not the history.
      const first = index[0]
      const messages = (await bridge.storeGet<ChatMessage[]>(conversationKey(first.id)).catch(() => null)) ?? []
      set({ index, conversations: [settlePending([hydrate(first, messages)])[0]], activeId: first.id })
    } catch {
      // fresh install, or an unreadable store — start empty rather than trap
    }
  },

  /** Load a conversation's messages the first time it is opened. */
  openChat: async (id) => {
    set({ activeId: id })
    if (get().conversations.some((c) => c.id === id)) return
    const summary = get().index.find((row) => row.id === id)
    if (!summary) return
    const messages = (await bridge.storeGet<ChatMessage[]>(conversationKey(id)).catch(() => null)) ?? []
    set((state) => ({
      conversations: [settlePending([hydrate(summary, messages)])[0], ...state.conversations],
    }))
  },

  createChat: (mode = 'chat', projectId = null) => {
    const chat: Conversation = {
      id: uid(),
      title: 'New conversation',
      messages: [],
      mode,
      projectId,
      pinned: false,
      archived: false,
      createdAt: now(),
      updatedAt: now(),
    }
    set((state) => ({ conversations: [chat, ...state.conversations], activeId: chat.id }))
    persist(get().conversations)
    return chat.id
  },

  selectChat: (id) => { void get().openChat(id) },

  renameChat: (id, title) =>
    set((state) => ({
      conversations: state.conversations.map((chat) => (chat.id === id ? { ...chat, title } : chat)),
    })),

  deleteChat: (id) =>
    set((state) => {
      const conversations = state.conversations.filter((chat) => chat.id !== id)
      return { conversations, activeId: state.activeId === id ? (conversations[0]?.id ?? null) : state.activeId }
    }),

  pinChat: (id, pinned) =>
    set((state) => ({ conversations: state.conversations.map((chat) => (chat.id === id ? { ...chat, pinned } : chat)) })),

  archiveChat: (id, archived) =>
    set((state) => ({ conversations: state.conversations.map((chat) => (chat.id === id ? { ...chat, archived } : chat)) })),

  moveToProject: (id, projectId) =>
    set((state) => ({ conversations: state.conversations.map((chat) => (chat.id === id ? { ...chat, projectId } : chat)) })),

  setMode: (id, mode) =>
    set((state) => ({ conversations: state.conversations.map((chat) => (chat.id === id ? { ...chat, mode } : chat)) })),

  sendMessage: (text, opts) => {
    const trimmed = text.trim()
    if (!trimmed) return
    cue('send')
    const state = get()
    let chat = state.conversations.find((c) => c.id === state.activeId)
    if (!chat) {
      get().createChat()
      chat = get().conversations.find((c) => c.id === get().activeId)
      if (!chat) return
    }
    const chatId = chat.id
    const responseId = uid()
    const isFirstMessage = chat.messages.length === 0
    const userMessage: ChatMessage = { id: uid(), role: 'user', content: trimmed, createdAt: now(), mode: chat.mode }
    const assistantMessage: ChatMessage = { id: responseId, role: 'assistant', content: '', createdAt: now(), pending: true, mode: chat.mode }

    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === chatId
          ? {
              ...c,
              title: isFirstMessage ? titleFrom(trimmed) : c.title,
              messages: [...c.messages, userMessage, assistantMessage],
              updatedAt: now(),
            }
          : c,
      ),
    }))
    // The prompt itself is memory from here — don't wait for the first chunk.
    persist(get().conversations)

    const modelId = useSettingsStore.getState().defaultModelId
    const history: AiMessage[] = chat.messages
      .slice(-16)
      .map((m) => ({ role: m.role, parts: [{ type: 'text', text: m.content }] }))
    // Memory rides along as a system message: global first, then this chat's
    // own. Read straight off the store rather than through a hook so the send
    // path stays a plain function and does not re-render on every keystroke.
    const memory = useMemoryStore.getState()
    const memoryContext = buildMemoryContext(memory.global, memory.byChat[chatId] ?? [])
    const messages: AiMessage[] = [
      ...(memoryContext
        ? [{ role: 'system' as const, parts: [{ type: 'text' as const, text: memoryContext }] }]
        : []),
      ...history,
      {
        role: 'user',
        parts: [...(opts?.imageParts ?? []), { type: 'text', text: trimmed }],
      },
    ]

    const patchResponse = (patch: Partial<ChatMessage>) =>
      set((s) => ({
        conversations: s.conversations.map((c) =>
          c.id === chatId
            ? { ...c, messages: c.messages.map((m) => (m.id === responseId ? { ...m, ...patch } : m)) }
            : c,
        ),
      }))

    const cancel = bridge.sendAi(messages, { modelId }, {
      onChunk: (delta) => {
        const current = get().conversations.find((c) => c.id === chatId)?.messages.find((m) => m.id === responseId)
        patchResponse({ content: (current?.content ?? '') + delta, pending: true })
      },
      onDone: (full, aborted) => {
        activeStreamDisposer = null
        patchResponse({ content: full || ' ', pending: false })
        persist(get().conversations)
        if (aborted) cancel()
        else cue('reply')
      },
      onError: (error) => {
        activeStreamDisposer = null
        patchResponse({ pending: false, error, content: '' })
        persist(get().conversations)
        cue('error')
      },
    })
    activeStreamDisposer = cancel
  },

  stopStreaming: () => {
    // Abort the in-flight request through bridge.sendAi's disposer, then mark
    // any pending response of the active chat as finished so the UI unblocks.
    activeStreamDisposer?.()
    activeStreamDisposer = null
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === s.activeId
          ? { ...c, messages: c.messages.map((m) => (m.pending ? { ...m, pending: false } : m)) }
          : c,
      ),
    }))
    persist(get().conversations)
  },
}))

export const selectActiveChat = (state: ChatsState) => state.conversations.find((c) => c.id === state.activeId) ?? null
