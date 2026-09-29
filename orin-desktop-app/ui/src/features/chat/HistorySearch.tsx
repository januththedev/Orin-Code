import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { MessageSquare, Search, Trash2 } from 'lucide-react'
import { useChatsStore } from '../../stores/chatsStore'
import type { ChatSummary } from '../../stores/chatStoreModel'
import { useUiStore } from '../../stores/uiStore'
import { ContextMenu, type ContextMenuItem } from '../../components/ContextMenu'
import { Modal } from '../../components/Modal'
import './HistorySearch.css'

interface HistorySearchProps {
  open: boolean
  onClose: () => void
}

type GroupName = 'Pinned' | 'Today' | 'Yesterday' | 'Earlier'

const GROUP_ORDER: GroupName[] = ['Pinned', 'Today', 'Yesterday', 'Earlier']

// ---------------------------------------------------------------------------
// Fuzzy matching (subsequence scorer, no dependencies)
// ---------------------------------------------------------------------------

/** Subsequence match score; -1 means no match. Higher is better. */
function fuzzyScore(query: string, text: string): number {
  const q = query.replace(/\s+/g, '').toLowerCase()
  const t = text.toLowerCase()
  if (!q) return 0
  let ti = 0
  let prev = -2
  let score = 0
  for (const ch of q) {
    const found = t.indexOf(ch, ti)
    if (found < 0) return -1
    score += found === prev + 1 ? 8 : 2 // consecutive characters flow better
    if (found === 0 || /[\s\-_/.]/.test(t[found - 1] ?? '')) score += 5 // word starts matter
    prev = found
    ti = found + 1
  }
  return score
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeTime(iso: string): string {
  const time = new Date(iso).getTime()
  if (!Number.isFinite(time)) return ''
  const minutes = Math.floor((Date.now() - time) / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function snippetOf(chat: ChatSummary): string {
  const clean = chat.preview.replace(/\s+/g, ' ').trim()
  if (!clean) return chat.messageCount === 0 ? 'Empty conversation' : 'No preview'
  return clean.length > 92 ? `${clean.slice(0, 92)}…` : clean
}

function groupOf(chat: ChatSummary): GroupName {
  if (chat.pinned) return 'Pinned'
  const updated = new Date(chat.updatedAt)
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  if (updated >= startOfToday) return 'Today'
  const startOfYesterday = new Date(startOfToday.getTime() - 86_400_000)
  if (updated >= startOfYesterday) return 'Yesterday'
  return 'Earlier'
}

interface Row {
  chat: ChatSummary
  group: GroupName
  score: number
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** Searchable history modal. The app shell decides when to open it (no global hotkey here). */
export function HistorySearch({ open, onClose }: HistorySearchProps) {
  // Search runs over the index, not the loaded conversations. That covers
  // *every* chat rather than only the ones opened this session, and it never
  // touches a message body to do it.
  const index = useChatsStore((state) => state.index)
  const selectChat = useChatsStore((state) => state.selectChat)
  const deleteChat = useChatsStore((state) => state.deleteChat)
  const setView = useUiStore((state) => state.setView)
  const toast = useUiStore((state) => state.toast)

  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveIndex(0)
    }
  }, [open])

  const rows = useMemo<Row[]>(() => {
    const scored = index.map((chat) => {
      const titleScore = fuzzyScore(query, chat.title)
      const snippetScore = query ? fuzzyScore(query, snippetOf(chat)) : 0
      const score = Math.max(titleScore, snippetScore * 0.6)
      return { chat, group: groupOf(chat), score } as Row
    })
    const matched = scored.filter((row) => row.score >= 0)
    matched.sort(
      (a, b) =>
        b.score - a.score || new Date(b.chat.updatedAt).getTime() - new Date(a.chat.updatedAt).getTime(),
    )
    return matched
  }, [index, query])

  const grouped = useMemo(() => {
    const map = new Map<GroupName, Row[]>()
    for (const name of GROUP_ORDER) map.set(name, [])
    // Rows arrive ranked (score desc, then recency); grouping preserves that
    // order inside each bucket, which degrades to pure recency when q is empty.
    for (const row of rows) map.get(row.group)!.push(row)
    return map
  }, [rows])

  const flatRows = useMemo(() => Array.from(grouped.values()).flat(), [grouped])

  // Keep the active row visible while navigating with arrows.
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-row="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const pick = (row: Row) => {
    selectChat(row.chat.id)
    setView('chat')
    onClose()
  }

  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, flatRows.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const row = flatRows[activeIndex]
      if (row) pick(row)
    }
  }

  const deleteAll = () => {
    const all = useChatsStore.getState().index.map((c) => c.id)
    for (const id of all) deleteChat(id)
    toast('info', 'History cleared', `${all.length} conversation${all.length === 1 ? '' : 's'} deleted`)
  }

  const rowMenu = (row: Row): ContextMenuItem[] => [
    {
      id: 'delete',
      label: 'Delete',
      icon: <Trash2 size={13} />,
      danger: true,
      onSelect: () => {
        deleteChat(row.chat.id)
        toast('info', 'Conversation deleted')
      },
    },
    {
      id: 'delete-all',
      label: 'Delete all conversations',
      icon: <Trash2 size={13} />,
      danger: true,
      dividerBefore: true,
      onSelect: deleteAll,
    },
  ]

  let renderedIndex = -1

  return (
    <Modal open={open} onClose={onClose} title="Search chats" width={620}>
      <div className="history-search" onKeyDown={onKeyDown}>
        <div className="history-search-field">
          <Search size={15} />
          <input
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setActiveIndex(0)
            }}
            placeholder="Search conversations…"
            aria-label="Search conversations"
            spellCheck={false}
          />
          {flatRows.length > 0 && (
            <span className="history-search-count">
              {flatRows.length} result{flatRows.length === 1 ? '' : 's'}
            </span>
          )}
        </div>

        <div className="history-results" ref={listRef}>
          {flatRows.length === 0 && (
            <p className="history-no-match">No conversations match “{query}”.</p>
          )}

          {GROUP_ORDER.map((name) => {
            const groupRows = grouped.get(name)!
            if (groupRows.length === 0) return null
            return (
              <section key={name} className="history-group">
                <h3 className="history-group-title">{name}</h3>
                {groupRows.map((row) => {
                  renderedIndex += 1
                  const index = renderedIndex
                  return (
                    <ContextMenu key={row.chat.id} items={rowMenu(row)} trigger="contextmenu">
                      <button
                        type="button"
                        data-row={index}
                        className={`history-row ${index === activeIndex ? 'active' : ''}`}
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => pick(row)}
                      >
                        <MessageSquare size={13} className="history-row-icon" />
                        <span className="history-row-main">
                          <span className="history-row-title">{row.chat.title}</span>
                          <span className="history-row-snippet">{snippetOf(row.chat)}</span>
                        </span>
                        <span className="history-row-time">{relativeTime(row.chat.updatedAt)}</span>
                      </button>
                    </ContextMenu>
                  )
                })}
              </section>
            )
          })}
        </div>

        <footer className="history-hints">
          <span>↑↓ navigate</span>
          <span>⏎ open</span>
          <span>right-click for actions</span>
        </footer>
      </div>
    </Modal>
  )
}
