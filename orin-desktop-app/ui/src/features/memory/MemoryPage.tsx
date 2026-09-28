import { useEffect, useMemo, useState } from 'react'
import { useMemoryStore, type MemoryEntry, type MemoryScope } from '../../stores/memoryStore'
import { useChatsStore } from '../../stores/chatsStore'
import { useUiStore } from '../../stores/uiStore'
import { EmptyState } from '../../components/EmptyState'
import './memory.css'

/**
 * Memory, in two scopes.
 *
 * The left column is memory that follows you everywhere. The right is memory
 * belonging to one conversation, with a picker so you can switch threads. The
 * point of the split is that standing context and thread context are different
 * things, and mixing them is how an assistant ends up quoting one project's
 * decisions into an unrelated conversation.
 */
export default function MemoryPage() {
  const global = useMemoryStore((s) => s.global)
  const byChat = useMemoryStore((s) => s.byChat)
  const add = useMemoryStore((s) => s.add)
  const update = useMemoryStore((s) => s.update)
  const remove = useMemoryStore((s) => s.remove)
  const promote = useMemoryStore((s) => s.promote)
  const demote = useMemoryStore((s) => s.demote)
  const clearScope = useMemoryStore((s) => s.clearScope)
  const hydrate = useMemoryStore((s) => s.hydrate)

  const conversations = useChatsStore((s) => s.conversations)
  const setView = useUiStore((s) => s.setView)

  const [chatId, setChatId] = useState<string | null>(null)
  const [draftGlobal, setDraftGlobal] = useState('')
  const [draftChat, setDraftChat] = useState('')
  const [editing, setEditing] = useState<{ id: string; scope: MemoryScope; chatId: string | null; text: string } | null>(null)

  useEffect(() => { void hydrate() }, [hydrate])

  // Default to the conversation currently in front of the user, falling back to
  // the most recent one, so the page opens somewhere useful.
  useEffect(() => {
    if (chatId || conversations.length === 0) return
    const active = useChatsStore.getState().activeId
    setChatId(active ?? conversations[0]?.id ?? null)
  }, [chatId, conversations])

  const chatEntries = chatId ? byChat[chatId] ?? [] : []
  const chatCount = useMemo(() => Object.values(byChat).reduce((total, list) => total + list.length, 0), [byChat])

  const submitGlobal = () => {
    if (!draftGlobal.trim()) return
    add(draftGlobal, 'global')
    setDraftGlobal('')
  }
  const submitChat = () => {
    if (!draftChat.trim() || !chatId) return
    add(draftChat, 'chat', chatId)
    setDraftChat('')
  }

  const rows = (entries: MemoryEntry[], scope: MemoryScope, ownerChatId: string | null) =>
    entries.length === 0 ? (
      <p className="memory-empty">
        {scope === 'global'
          ? 'Nothing remembered yet. Anything you add here is used in every chat.'
          : 'No memory for this conversation yet.'}
      </p>
    ) : (
      <ul className="memory-list">
        {entries.map((entry) => (
          <li key={entry.id} className="memory-item">
            {editing?.id === entry.id ? (
              <div className="memory-edit">
                <textarea
                  value={editing.text}
                  autoFocus
                  onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      update(entry.id, editing.text, scope, ownerChatId)
                      setEditing(null)
                    }
                    if (e.key === 'Escape') setEditing(null)
                  }}
                />
                <div className="memory-edit-actions">
                  <button onClick={() => { update(entry.id, editing.text, scope, ownerChatId); setEditing(null) }}>Save</button>
                  <button className="ghost" onClick={() => setEditing(null)}>Cancel</button>
                </div>
              </div>
            ) : (
              <>
                <p className="memory-content">{entry.content}</p>
                <div className="memory-meta">
                  <span>{entry.source === 'chat' ? 'From this chat' : 'You'}</span>
                  <span className="memory-dot" aria-hidden="true">·</span>
                  <time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleDateString()}</time>
                </div>
                <div className="memory-actions">
                  <button className="ghost" onClick={() => setEditing({ id: entry.id, scope, chatId: ownerChatId, text: entry.content })}>Edit</button>
                  {scope === 'global' && chatId && (
                    <button className="ghost" onClick={() => demote(entry.id, chatId)} title="Use only in this conversation">
                      Use in this chat only
                    </button>
                  )}
                  {scope === 'chat' && ownerChatId && (
                    <button className="ghost" onClick={() => promote(entry.id, ownerChatId)} title="Apply to every conversation">
                      Apply to all chats
                    </button>
                  )}
                  <button className="ghost danger" onClick={() => remove(entry.id, scope, ownerChatId)}>Delete</button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
    )

  return (
    <section className="view memory-view">
      <header className="memory-head">
        <div>
          <h1>Memory</h1>
          <p className="memory-sub">
            What Orin remembers. Global memory follows you into every chat; chat memory stays with one conversation.
          </p>
        </div>
      </header>

      <div className="memory-columns">
        <section className="memory-col" aria-label="Global memory">
          <div className="memory-col-head">
            <h2>Across all chats</h2>
            <span className="memory-count">{global.length}</span>
            {global.length > 0 && (
              <button className="ghost" onClick={() => clearScope('global')}>Clear all</button>
            )}
          </div>
          <p className="memory-hint">
            Preferences and facts about you. Sent with every request, so keep it short and only keep what is true everywhere.
          </p>
          <div className="memory-composer">
            <textarea
              value={draftGlobal}
              placeholder="e.g. I prefer short answers with code first"
              onChange={(e) => setDraftGlobal(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitGlobal() }}
            />
            <button onClick={submitGlobal} disabled={!draftGlobal.trim()}>Remember</button>
          </div>
          {rows(global, 'global', null)}
        </section>

        <section className="memory-col" aria-label="Conversation memory">
          <div className="memory-col-head">
            <h2>This chat only</h2>
            <span className="memory-count">{chatEntries.length}</span>
            {chatEntries.length > 0 && (
              <button className="ghost" onClick={() => clearScope('chat', chatId)}>Clear</button>
            )}
          </div>

          <label className="memory-chat-picker">
            Conversation
            <select value={chatId ?? ''} onChange={(e) => setChatId(e.target.value || null)}>
              <option value="">Select a conversation…</option>
              {conversations.map((c) => (
                <option key={c.id} value={c.id}>{c.title}</option>
              ))}
            </select>
          </label>

          <p className="memory-hint">
            {chatCount === 0
              ? 'Scoped detail for one conversation — decisions, names, constraints. Not sent to other chats.'
              : `${chatCount} memor${chatCount === 1 ? 'y' : 'ies'} saved across all conversations.`}
          </p>

          {chatId ? (
            <>
              <div className="memory-composer">
                <textarea
                  value={draftChat}
                  placeholder="e.g. this repo deploys with pnpm, not npm"
                  onChange={(e) => setDraftChat(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitChat() }}
                />
                <button onClick={submitChat} disabled={!draftChat.trim()}>Remember</button>
              </div>
              {rows(chatEntries, 'chat', chatId)}
            </>
          ) : (
            <EmptyState
              title="No conversation selected"
              hint="Start a chat, or pick one above, to keep memory scoped to it."
              action={<button className="button-primary" onClick={() => setView('chat')}>Go to chat</button>}
            />
          )}
        </section>
      </div>
    </section>
  )
}
