import { useEffect, useMemo, useRef, useState } from 'react'
import { Modal } from './Modal'
import './CommandPalette.css'

export interface Command {
  id: string
  label: string
  hint?: string
  keywords?: string
  run: () => void
}

export function useAppCommands(handlers: {
  newChat: () => void
  navigate: (view: 'home' | 'chat' | 'projects' | 'artifacts' | 'studio' | 'notes' | 'ide' | 'computer' | 'customize' | 'settings' | 'skills' | 'connectors') => void
  toggleTheme: () => void
  openSearch: () => void
}): Command[] {
  return useMemo(
    () => [
      { id: 'new-chat', label: 'New conversation', hint: 'Ctrl+N', run: handlers.newChat },
      { id: 'go-home', label: 'Go to Home', run: () => handlers.navigate('home') },
      { id: 'go-chat', label: 'Go to Chats', run: () => handlers.navigate('chat') },
      { id: 'go-projects', label: 'Open Projects', run: () => handlers.navigate('projects') },
      { id: 'go-artifacts', label: 'Open Artifacts', run: () => handlers.navigate('artifacts') },
      { id: 'go-code', label: 'Open coding workspace', hint: 'IDE', run: () => handlers.navigate('ide') },
      { id: 'go-computer', label: 'Open Computer Use', run: () => handlers.navigate('computer') },
      { id: 'go-notes', label: 'Open project notes', run: () => handlers.navigate('notes') },
      { id: 'go-customize', label: 'Open Customize', run: () => handlers.navigate('customize') },
      { id: 'go-settings', label: 'Open Settings', run: () => handlers.navigate('settings') },
      { id: 'go-skills', label: 'Open Skills', run: () => handlers.navigate('skills') },
      { id: 'go-connectors', label: 'Open Integrations', run: () => handlers.navigate('connectors') },
      { id: 'search', label: 'Search chats', hint: 'Ctrl+K', run: handlers.openSearch },
      { id: 'theme', label: 'Toggle dark / light theme', run: handlers.toggleTheme },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
}

export function Palette({
  open,
  onClose,
  commands,
}: {
  open: boolean
  onClose: () => void
  commands: Command[]
}) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setIndex(0)
    }
  }, [open])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return commands
    // Subsequence fuzzy match on label + keywords.
    return commands.filter((command) => {
      const haystack = `${command.label} ${command.keywords ?? ''}`.toLowerCase()
      let cursor = 0
      for (const char of needle) {
        cursor = haystack.indexOf(char, cursor)
        if (cursor === -1) return false
        cursor += 1
      }
      return true
    })
  }, [commands, query])

  useEffect(() => setIndex(0), [query])

  const execute = (position: number) => {
    const command = filtered[position]
    if (!command) return
    onClose()
    command.run()
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setIndex((prev) => Math.min(prev + 1, filtered.length - 1))
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setIndex((prev) => Math.max(prev - 1, 0))
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      execute(index)
    }
  }

  useEffect(() => {
    const active = listRef.current?.children[index] as HTMLElement | undefined
    active?.scrollIntoView({ block: 'nearest' })
  }, [index])

  return (
    <Modal open={open} onClose={onClose} title="" width={560}>
      <div className="palette" onKeyDown={onKeyDown}>
        <input
          className="palette-input"
          autoFocus
          placeholder="Type a command…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="palette-list" ref={listRef}>
          {filtered.length === 0 && <p className="palette-empty">No matching commands</p>}
          {filtered.map((command, position) => (
            <button
              key={command.id}
              className={`palette-item ${position === index ? 'active' : ''}`}
              onMouseEnter={() => setIndex(position)}
              onClick={() => execute(position)}
            >
              <span>{command.label}</span>
              {command.hint && <kbd>{command.hint}</kbd>}
            </button>
          ))}
        </div>
      </div>
    </Modal>
  )
}
