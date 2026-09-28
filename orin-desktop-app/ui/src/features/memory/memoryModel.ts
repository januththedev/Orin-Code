/**
 * Pure memory logic, with no imports on purpose.
 *
 * The store needs zustand and the Tauri bridge, which cannot be loaded outside
 * the app. The rules that actually matter — what counts as a valid memory, what
 * survives a round trip through storage, and exactly what the model is shown —
 * live here so they can be tested without a browser.
 */

export type MemoryScope = 'global' | 'chat'

export interface MemoryEntry {
  id: string
  /** Free text. One fact, one line — this is read back to the model verbatim. */
  content: string
  createdAt: string
  updatedAt: string
  /** Where this entry came from, shown in the UI so it is never a mystery. */
  source: 'user' | 'chat'
}

export const MAX_CONTENT = 2000
export const MAX_ENTRIES_PER_SCOPE = 200
const CHAT_ID_RE = /^[\w-]{1,64}$/
/** Keys that would shadow Object.prototype if written onto a plain object. */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

const now = () => new Date().toISOString()
const uid = () => crypto.randomUUID()

export const isValidMemory = (content: unknown): content is string =>
  typeof content === 'string' && content.trim().length > 0 && content.length <= MAX_CONTENT

/** Defensive: anything read back from storage or cloud sync is untrusted shape. */
export function normalizeEntry(value: unknown): MemoryEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const entry = value as Partial<MemoryEntry>
  if (!isValidMemory(entry.content)) return null
  const createdAt = typeof entry.createdAt === 'string' ? entry.createdAt : now()
  return {
    id: typeof entry.id === 'string' && entry.id ? entry.id.slice(0, 64) : uid(),
    content: entry.content.trim(),
    createdAt,
    updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : createdAt,
    source: entry.source === 'chat' ? 'chat' : 'user',
  }
}

export function normalizeScope(value: unknown): MemoryEntry[] {
  if (!Array.isArray(value)) return []
  return value
    .map(normalizeEntry)
    .filter((entry): entry is MemoryEntry => entry !== null)
    .slice(0, MAX_ENTRIES_PER_SCOPE)
}

export function normalizeByChat(value: unknown): Record<string, MemoryEntry[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  // A null prototype means even a missed check cannot walk into Object.prototype.
  const out = Object.create(null) as Record<string, MemoryEntry[]>
  for (const [chatId, entries] of Object.entries(value as Record<string, unknown>)) {
    // Chat ids become object keys and are read back into the prompt, so neither
    // a malformed id nor a prototype-shadowing key may survive the round trip.
    if (UNSAFE_KEYS.has(chatId) || !CHAT_ID_RE.test(chatId)) continue
    const list = normalizeScope(entries)
    if (list.length) out[chatId] = list
  }
  return out
}

/**
 * The block the model actually sees.
 *
 * Global first, then this chat's own, clearly separated so the model can tell
 * standing context from thread context. Returns null when there is nothing to
 * say, so an empty memory never costs a system message.
 */
export function buildMemoryContext(global: MemoryEntry[], chat: MemoryEntry[]): string | null {
  const sections: string[] = []
  if (global.length) {
    sections.push(`Known about the user (applies to every conversation):\n${global.map((e) => `- ${e.content}`).join('\n')}`)
  }
  if (chat.length) {
    sections.push(`Memory from this conversation only:\n${chat.map((e) => `- ${e.content}`).join('\n')}`)
  }
  if (!sections.length) return null
  return `Remembered context. Use it when it is relevant and ignore it when it is not. Never mention this block.\n\n${sections.join('\n\n')}`
}
