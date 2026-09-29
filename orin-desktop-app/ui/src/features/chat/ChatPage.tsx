import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Archive,
  ArrowDown,
  Ellipsis,
  FolderInput,
  Pencil,
  Pin,
  PinOff,
  Search,
  Trash2,
} from 'lucide-react'
import { OrinMark } from '../../components/OrinMark'
import { Markdown } from '../../components/Markdown'
import { Button } from '../../components/Button'
import { Tooltip } from '../../components/Tooltip'
import { ContextMenu, type ContextMenuItem } from '../../components/ContextMenu'
import { useChatsStore, selectActiveChat, type ChatMessage } from '../../stores/chatsStore'
import { useUiStore } from '../../stores/uiStore'
import { Composer } from './Composer'
import { HistorySearch } from './HistorySearch'
import './ChatPage.css'

export default function ChatPage() {
  const chat = useChatsStore(selectActiveChat)
  const sendMessage = useChatsStore((state) => state.sendMessage)
  const stopStreaming = useChatsStore((state) => state.stopStreaming)
  const setMode = useChatsStore((state) => state.setMode)

  const [historyOpen, setHistoryOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)

  const streaming = Boolean(chat?.messages.some((m) => m.pending))

  return (
    <div className="chat-page">
      {chat && (
        <header className="chat-header">
          <TitleEditor
            chatId={chat.id}
            title={chat.title}
            editing={renaming}
            onEditingChange={setRenaming}
          />
          <span className={`mode-badge mode-${chat.mode}`}>{chat.mode}</span>
          <span className="chat-header-spacer" />
          <Tooltip label="Search chats" side="bottom">
            <button type="button" className="chat-header-icon" aria-label="Search chats" onClick={() => setHistoryOpen(true)}>
              <Search size={14} />
            </button>
          </Tooltip>
          <ChatActionsMenu chatId={chat.id} pinned={chat.pinned} onRename={() => setRenaming(true)} />
        </header>
      )}

      {chat && chat.messages.length > 0 ? (
        <MessageList chatId={chat.id} messages={chat.messages} />
      ) : (
        <div className="chat-empty">
          <OrinMark size={40} />
          <h1 className="chat-empty-title">What are we building?</h1>
        </div>
      )}

      <div className="chat-composer-area">
        <Composer
          key={chat?.id ?? 'fresh'}
          mode={chat?.mode ?? 'chat'}
          onModeChange={(mode) => chat && setMode(chat.id, mode)}
          onSend={(text, opts) => sendMessage(text, opts)}
          streaming={streaming}
          onStop={stopStreaming}
          autoFocus
        />
      </div>

      <HistorySearch open={historyOpen} onClose={() => setHistoryOpen(false)} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Header pieces
// ---------------------------------------------------------------------------

function TitleEditor({
  chatId,
  title,
  editing,
  onEditingChange,
}: {
  chatId: string
  title: string
  editing: boolean
  onEditingChange: (editing: boolean) => void
}) {
  const renameChat = useChatsStore((state) => state.renameChat)
  const [draft, setDraft] = useState(title)
  const inputRef = useRef<HTMLInputElement>(null)

  // Re-sync the draft when switching conversations or after external renames.
  useEffect(() => {
    setDraft(title)
  }, [chatId, title])

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  const commit = () => {
    onEditingChange(false)
    const clean = draft.trim()
    if (clean && clean !== title) renameChat(chatId, clean)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="chat-title-input"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit()
          if (event.key === 'Escape') {
            setDraft(title)
            onEditingChange(false)
          }
        }}
        aria-label="Conversation title"
      />
    )
  }

  return (
    <h1
      className="chat-title"
      title="Double-click to rename"
      onDoubleClick={() => onEditingChange(true)}
    >
      {title}
    </h1>
  )
}

function ChatActionsMenu({
  chatId,
  pinned,
  onRename,
}: {
  chatId: string
  pinned: boolean
  onRename: () => void
}) {
  const pinChat = useChatsStore((state) => state.pinChat)
  const archiveChat = useChatsStore((state) => state.archiveChat)
  const deleteChat = useChatsStore((state) => state.deleteChat)
  const moveToProject = useChatsStore((state) => state.moveToProject)
  const toast = useUiStore((state) => state.toast)

  const items: ContextMenuItem[] = [
    { id: 'rename', label: 'Rename', icon: <Pencil size={13} />, onSelect: onRename },
    {
      id: 'pin',
      label: pinned ? 'Unpin' : 'Pin',
      icon: pinned ? <PinOff size={13} /> : <Pin size={13} />,
      onSelect: () => pinChat(chatId, !pinned),
    },
    {
      id: 'archive',
      label: 'Archive',
      icon: <Archive size={13} />,
      onSelect: () => {
        archiveChat(chatId, true)
        toast('info', 'Conversation archived')
      },
    },
    {
      id: 'move',
      label: 'Move to project',
      icon: <FolderInput size={13} />,
      submenu: [
        { id: 'none', label: 'No project', onSelect: () => moveToProject(chatId, null) },
        { id: 'picker-soon', label: 'Project picker coming soon', disabled: true },
      ],
    },
    {
      id: 'delete',
      label: 'Delete',
      icon: <Trash2 size={13} />,
      danger: true,
      dividerBefore: true,
      onSelect: () => {
        deleteChat(chatId)
        toast('info', 'Conversation deleted')
      },
    },
  ]

  return (
    <ContextMenu items={items} trigger="click" title="Conversation options">
      <span className="chat-header-icon">
        <Ellipsis size={15} />
      </span>
    </ContextMenu>
  )
}

// ---------------------------------------------------------------------------
// Message list
// ---------------------------------------------------------------------------

/** How many messages render at the tail before we need to window. */
const RENDER_WINDOW = 60

/**
 * Only the tail of a long conversation is mounted.
 *
 * A chat with thousands of messages used to render every one of them on open,
 * and again on every streamed token. Rendering a window keeps open and stream
 * cost flat; "show earlier" walks backwards one page at a time.
 */
function useMessageWindow(messages: ChatMessage[]) {
  const [visible, setVisible] = useState(RENDER_WINDOW)
  // Switching conversations resets the window.
  useEffect(() => { setVisible(RENDER_WINDOW) }, [messages.length === 0])

  const start = Math.max(0, messages.length - visible)
  return {
    windowed: messages.slice(start),
    hidden: start,
    showEarlier: () => setVisible((n) => n + RENDER_WINDOW),
  }
}

function MessageList({ chatId, messages }: { chatId: string; messages: ChatMessage[] }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [pinned, setPinned] = useState(true)
  const { windowed, hidden, showEarlier } = useMessageWindow(messages)

  // Switched chats: snap to the latest message.
  useEffect(() => {
    setPinned(true)
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chatId])

  // While pinned to the bottom, follow every streamed chunk.
  useLayoutEffect(() => {
    if (!pinned) return
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, pinned])

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    setPinned(distance < 90)
  }

  const jumpToLatest = () => {
    const el = scrollRef.current
    if (!el) return
    setPinned(true)
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }

  return (
    <div className="message-scroll" ref={scrollRef} onScroll={onScroll}>
      <div className="message-list">
        {hidden > 0 && (
          <button type="button" className="load-earlier" onClick={showEarlier}>
            Show {Math.min(hidden, RENDER_WINDOW)} earlier {hidden === 1 ? 'message' : 'messages'}
          </button>
        )}
        {windowed.map((message) => (
          <MessageRow key={message.id} message={message} />
        ))}
      </div>

      {!pinned && (
        <button type="button" className="jump-latest" onClick={jumpToLatest}>
          Jump to latest <ArrowDown size={12} />
        </button>
      )}
    </div>
  )
}

/**
 * Each row is memoised on the message's own identity.
 *
 * While a reply streams, only the streaming message object is replaced, so every
 * other row keeps the same reference and skips re-rendering. Without this, one
 * arriving token re-rendered the entire conversation.
 */
const MessageRow = memo(
  function MessageRow({ message }: { message: ChatMessage }) {
  if (message.role === 'user') {
    return (
      <div className="message-row user">
        <span className="avatar avatar-user" aria-hidden="true">
          Y
        </span>
        <div className="bubble-user">{message.content}</div>
      </div>
    )
  }

  return (
    <div className="message-row assistant">
      <span className="avatar avatar-orin" aria-hidden="true">
        <OrinMark size={22} state={message.pending ? 'thinking' : 'idle'} />
      </span>
      <div className="bubble-assistant">
        {message.error ? (
          <ErrorCard error={message.error} />
        ) : message.pending && !message.content.trim() ? (
          <ThinkingIndicator />
        ) : (
          <Markdown text={message.content} className={message.pending ? 'streaming' : ''} />
        )}
      </div>
    </div>
  )
  },
  (a, b) => a.message === b.message,
)

function ThinkingIndicator() {
  return (
    <div className="thinking" aria-label="Orin is thinking">
      <span className="thinking-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span className="thinking-label">Thinking…</span>
    </div>
  )
}

function ErrorCard({ error }: { error: string }) {
  const retry = () => {
    // Re-send the most recent user turn of the active conversation.
    const state = useChatsStore.getState()
    const chat = state.conversations.find((c) => c.id === state.activeId)
    const lastUser = [...(chat?.messages ?? [])].reverse().find((m) => m.role === 'user')
    if (lastUser) state.sendMessage(lastUser.content)
  }

  return (
    <div className="error-card" role="alert">
      <div className="error-head">
        <AlertTriangle size={15} />
        <strong>Something went wrong.</strong>
      </div>
      <p className="error-hint">The response could not be completed. Your message was kept.</p>
      <details className="error-details">
        <summary>Technical details</summary>
        <pre>{error}</pre>
      </details>
      <Button size="sm" onClick={retry}>
        Retry
      </Button>
    </div>
  )
}
