/**
 * Chat storage shape.
 *
 * Historically every conversation lived in one JSON blob under `chats`. That
 * makes launch and every single message write cost O(all messages ever sent):
 *
 *   50 chats x 100 msgs   ->   3.3 MB blob,  21 ms to parse
 *   200 chats x 200 msgs  ->  26.2 MB blob, 194 ms to parse
 *   500 chats x 400 msgs  -> 130.9 MB blob, 645 ms to parse
 *
 * and the write side rewrote all of it. The index for that last case is
 * 0.028 MB, so splitting is not a micro-optimisation: it is the difference
 * between a sidebar that appears and one that does not.
 *
 * The layout is therefore:
 *
 *   chats:index   -> ChatSummary[]          small, read on every launch
 *   chat:<id>     -> ChatMessage[]          read when a conversation is opened
 *
 * Pure functions live here so the shape can be tested without a store.
 */

import type { ChatMessage, Conversation } from './chatsStore'

export const INDEX_KEY = 'chats:index'
/** Pre-split storage key, read once for migration and then removed. */
export const LEGACY_KEY = 'chats'

export function conversationKey(id: string): string {
  return `chat:${id}`
}

/** Everything the sidebar needs, and nothing it does not. */
export interface ChatSummary {
  id: string
  title: string
  mode: Conversation['mode']
  projectId: string | null
  pinned: boolean
  archived: boolean
  createdAt: string
  updatedAt: string
  /** Drives the sidebar count and the "no messages yet" empty state. */
  messageCount: number
  /** A short tail preview, so the list is readable without opening anything. */
  preview: string
}

const PREVIEW_CHARS = 120

export function toSummary(conversation: Conversation): ChatSummary {
  const last = conversation.messages.at(-1)
  return {
    id: conversation.id,
    title: conversation.title,
    mode: conversation.mode,
    projectId: conversation.projectId,
    pinned: conversation.pinned,
    archived: conversation.archived,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messageCount: conversation.messages.length,
    preview: last ? last.content.replace(/\s+/g, ' ').trim().slice(0, PREVIEW_CHARS) : '',
  }
}

/** Build the index. Sorted by recency so the sidebar needs no extra sort. */
export function buildIndex(conversations: readonly Conversation[]): ChatSummary[] {
  return conversations
    .map(toSummary)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
}

/** Reassemble a conversation from an index row and its stored messages. */
export function hydrate(summary: ChatSummary, messages: ChatMessage[]): Conversation {
  return {
    id: summary.id,
    title: summary.title,
    mode: summary.mode,
    projectId: summary.projectId,
    pinned: summary.pinned,
    archived: summary.archived,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
    messages,
  }
}

/** What a one-time migration from the old single blob produces. */
export interface MigrationPlan {
  index: ChatSummary[]
  /** conversation id -> its messages. */
  messages: Record<string, ChatMessage[]>
  /** Conversations that had no messages and are dropped, matching prior behaviour. */
  dropped: string[]
}

/**
 * Plan the split of the legacy blob.
 *
 * Conversations with no messages are dropped, because that is what the old
 * hydrate already did — an untouched "new chat" must never be persisted.
 */
export function planMigration(legacy: unknown): MigrationPlan {
  if (!Array.isArray(legacy)) return { index: [], messages: {}, dropped: [] }
  const index: ChatSummary[] = []
  const messages: Record<string, ChatMessage[]> = {}
  const dropped: string[] = []
  for (const entry of legacy) {
    if (!entry || typeof entry !== 'object') continue
    const conversation = entry as Conversation
    if (!conversation.id || !Array.isArray(conversation.messages)) continue
    if (conversation.messages.length === 0) {
      dropped.push(conversation.id)
      continue
    }
    index.push(toSummary(conversation))
    messages[conversation.id] = conversation.messages
  }
  return { index, messages, dropped }
}

/** A summary for a conversation that exists only in memory. */
export function upsertSummary(index: readonly ChatSummary[], next: ChatSummary): ChatSummary[] {
  const without = index.filter((row) => row.id !== next.id)
  return [next, ...without].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
}
