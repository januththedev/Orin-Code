import { useCallback, useEffect, useMemo, useState } from 'react'
import { useMemoryStore } from '../../stores/memoryStore'
import { useUiStore } from '../../stores/uiStore'
import { EmptyState } from '../../components/EmptyState'
import { Button } from '../../components/Button'
import {
  MEMORY_TYPES,
  REQUIRES_RATIONALE,
  toSlug,
  type Memory,
  type MemoryType,
} from './memoryModel'
import './memory.css'

/**
 * Memory, kept where ZCode keeps it: one file per fact, in
 * `<storage>/memories/projects/<slug>-<hash>/memory/`.
 *
 * The form mirrors ZCode's memory format — a kebab-case name, a one-line
 * description, a type, and `**Why:**` / `**How to apply:**` for the types that
 * need a rationale — because a memory you cannot read the same way in both
 * products is not a shared memory.
 */
export default function MemoryPage() {
  const memories = useMemoryStore((s) => s.memories)
  const problems = useMemoryStore((s) => s.problems)
  const directory = useMemoryStore((s) => s.directory)
  const loading = useMemoryStore((s) => s.loading)
  const loaded = useMemoryStore((s) => s.loaded)
  const reload = useMemoryStore((s) => s.reload)
  const save = useMemoryStore((s) => s.save)
  const remove = useMemoryStore((s) => s.remove)
  const setView = useUiStore((s) => s.setView)
  const toast = useUiStore((s) => s.toast)

  const [editing, setEditing] = useState<Memory | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { void reload() }, [reload])

  const blank = useMemo<Memory>(
    () => ({ name: '', description: '', type: 'user', body: '', why: '', howToApply: '', links: [], updatedAt: null }),
    [],
  )

  const onSave = useCallback(async () => {
    if (!editing) return
    if (!editing.name.trim()) { setError('A memory needs a name.'); return }
    try {
      await save(editing)
      setEditing(null)
      setCreating(false)
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That memory could not be saved.')
    }
  }, [editing, save])

  const onDelete = useCallback(async (name: string) => {
    try {
      await remove(name)
      toast('info', 'Memory removed', name)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That memory could not be removed.')
    }
  }, [remove, toast])

  if (loading && !loaded) {
    return <section className="view memory-view"><p className="memory-empty">Reading your memory…</p></section>
  }

  return (
    <section className="view memory-view">
      <header className="memory-head">
        <div>
          <h1>Memory</h1>
          <p className="memory-sub">
            One file per fact, kept in your workspace&apos;s memory folder. These are
            sent to the model with every message as reference — never as instructions.
          </p>
          {directory && <p className="memory-dir"><code>{directory}</code></p>}
        </div>
        <Button size="sm" onClick={() => { setEditing({ ...blank }); setCreating(true); setError('') }}>
          New memory
        </Button>
      </header>

      {error && <p className="memory-error" role="alert">{error}</p>}

      {problems.length > 0 && (
        <div className="memory-problems">
          <strong>{problems.length} problem{problems.length === 1 ? '' : 's'} in your memory files</strong>
          <ul>
            {problems.map((p) => <li key={`${p.file}:${p.field}`}><code>{p.file}</code> — {p.message}</li>)}
          </ul>
        </div>
      )}

      {editing && (
        <form className="memory-editor" onSubmit={(e) => { e.preventDefault(); void onSave() }}>
          <div className="memory-editor-grid">
            <label>
              Name (kebab-case)
              <input
                value={editing.name}
                placeholder="prefers-pnpm"
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                onBlur={() => setEditing((m) => (m && !m.name ? { ...m, name: toSlug(m.description) } : m))}
              />
            </label>
            <label>
              Type
              <select value={editing.type} onChange={(e) => setEditing({ ...editing, type: e.target.value as MemoryType })}>
                {MEMORY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
          </div>
          <label>
            Description — one line, used to decide relevance
            <input
              value={editing.description}
              placeholder="This repo installs with pnpm, never npm."
              onChange={(e) => setEditing({ ...editing, description: e.target.value })}
            />
          </label>
          <label>
            The fact
            <textarea
              value={editing.body}
              placeholder="Orin Code builds with pnpm. Running npm install breaks the lockfile."
              onChange={(e) => setEditing({ ...editing, body: e.target.value })}
            />
          </label>
          {REQUIRES_RATIONALE.includes(editing.type) && (
            <>
              <label>
                Why
                <textarea
                  className="memory-rationale"
                  value={editing.why}
                  placeholder="The workspace is a pnpm monorepo and npm rewrites it."
                  onChange={(e) => setEditing({ ...editing, why: e.target.value })}
                />
              </label>
              <label>
                How to apply
                <textarea
                  className="memory-rationale"
                  value={editing.howToApply}
                  placeholder="Use pnpm for any install or add in this repo."
                  onChange={(e) => setEditing({ ...editing, howToApply: e.target.value })}
                />
              </label>
            </>
          )}
          <label>
            Related memories (wiki-links)
            <input
              value={editing.links.join(', ')}
              placeholder="other-memory, third"
              onChange={(e) => setEditing({
                ...editing,
                links: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
              })}
            />
          </label>
          <div className="memory-editor-actions">
            <Button size="sm" type="submit">Save memory</Button>
            <Button size="sm" variant="ghost" onClick={() => { setEditing(null); setCreating(false) }}>Cancel</Button>
            <span className="memory-preview-name">Saves to <code>{toSlug(editing.name || editing.description || 'memory')}.md</code></span>
          </div>
        </form>
      )}

      {memories.length === 0 && !creating ? (
        <EmptyState
          title="No memory yet"
          hint="Memories are files in your workspace's memory folder — one fact each, readable by you and by the model."
          action={<Button size="sm" onClick={() => { setEditing({ ...blank }); setCreating(true) }}>Write your first memory</Button>}
        />
      ) : (
        <ul className="memory-list">
          {memories.map((memory) => (
            <li key={memory.name} className="memory-item">
              <div className="memory-item-head">
                <code className="memory-name">{memory.name}</code>
                <span className={`memory-type memory-type--${memory.type}`}>{memory.type}</span>
                {memory.links.map((link) => <code key={link} className="memory-link">[[{link}]]</code>)}
                {memory.updatedAt && <time className="memory-when" dateTime={memory.updatedAt}>
                  {new Date(memory.updatedAt).toLocaleDateString()}
                </time>}
              </div>
              <p className="memory-description">{memory.description}</p>
              {memory.body && <p className="memory-body">{memory.body}</p>}
              {memory.why && <p className="memory-rationale-line"><strong>Why:</strong> {memory.why}</p>}
              {memory.howToApply && <p className="memory-rationale-line"><strong>How to apply:</strong> {memory.howToApply}</p>}
              <div className="memory-actions">
                <Button size="sm" variant="ghost" onClick={() => { setEditing({ ...memory }); setCreating(false); setError('') }}>Edit</Button>
                <Button size="sm" variant="ghost" onClick={() => void onDelete(memory.name)}>Delete</Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {!memories.length && !loading && (
        <p className="memory-note">
          Memory is per workspace. <button type="button" className="link-button" onClick={() => setView('home')}>Open a project</button> to give it somewhere to live.
        </p>
      )}
    </section>
  )
}
