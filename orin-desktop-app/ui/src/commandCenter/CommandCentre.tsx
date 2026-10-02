import { useEffect, useMemo, useRef, useState } from 'react'
import { useUiStore } from '../stores/uiStore'
import { useShortcutsStore } from '../stores/shortcutsStore'
import { formatShortcut } from '../shortcuts/shortcutCommands'
import { useChatsStore } from '../stores/chatsStore'
import { useProjectsStore } from '../stores/projectsStore'
import { usePanelsStore, newTabId } from '../stores/panelsStore'
import { useWorkspaceStore } from '../stores/workspaceStore'
import { useAuthStore } from '../stores/authStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useEditorStore } from '../stores/editorStore'
import { bridge } from '../bridge/client'
import { createQuickPickCommands, type QuickPickCommand } from './quickPickCommands'
import {
  COMMAND_CENTER_CONTEXT_SECTION_LIMIT,
  COMMAND_CENTER_SECTION_LIMIT,
  clearCommandCenterSearchHistory,
  filterWorkspaceFileEntries,
  groupCommandsBySection,
  matchesCommand,
  pushCommandCenterSearchHistory,
  readCommandCenterSearchHistory,
  resolveQueryScope,
  type CommandCenterSearchScope,
  type FileEntry,
} from './search'

/**
 * The Command Centre, ported from ZCode's `CommandCenterDialog.tsx`.
 *
 * It replaces the previous two-entry palette. The behaviours kept from ZCode:
 *
 *   - four scope tabs (all / commands / conversations / files) and the `>`,
 *     `#`, `@` prefixes that jump to one;
 *   - commands grouped into ZCode's sections, in ZCode's section order, with
 *     empty sections dropped;
 *   - token-substring matching, no fuzzy;
 *   - per-workspace search history, capped and de-duplicated;
 *   - Up/Down to move, Enter to run, Escape to close;
 *   - invocation CLOSES the dialog first, then awaits `run()`, logging and
 *     surfacing a toast if it throws.
 */

export interface CommandCentreProps {
  open: boolean
  onClose: () => void
  onError: (title: string, body?: string) => void
}

type Tab = 'commands' | 'conversations' | 'files' | 'recent'

/** The user's binding for a command, or its default when they have not set one. */
function bindingOf(
  overrides: Record<string, readonly string[]>,
  id: string,
  fallback: string,
): string {
  return overrides[id]?.[0] ?? fallback
}

interface Row {
  key: string
  group: string
  label: string
  hint?: string
  disabled?: boolean
  /**
   * A row that changes the palette rather than running a command -- currently
   * only "more results". It must not close the dialog or record a search, so it
   * bypasses `execute` entirely.
   */
  local?: boolean
  run: () => void | Promise<void>
}

export function CommandCentre({ open, onClose, onError }: CommandCentreProps) {
  const [rawQuery, setRawQuery] = useState('')
  const [tab, setTab] = useState<Tab>('commands')
  const [index, setIndex] = useState(0)
  const [history, setHistory] = useState<ReturnType<typeof readCommandCenterSearchHistory>>([])
  // Sections longer than the threshold collapse behind a "more results" row,
  // as in ZCode. They are never truncated: the commands are still reachable.
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set())
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const view = useUiStore((state) => state.view)
  const setView = useUiStore((state) => state.setView)
  const sidebarCollapsed = useUiStore((state) => state.sidebarCollapsed)
  const toggleSidebar = useUiStore((state) => state.toggleSidebar)
  const chatIndex = useChatsStore((state) => state.index)
  const selectChat = useChatsStore((state) => state.selectChat)
  const createChat = useChatsStore((state) => state.createChat)
  const projects = useProjectsStore((state) => state.projects)
  const openFromFolder = useProjectsStore((state) => state.openFromFolder)
  const authStatus = useAuthStore((state) => state.status)
  const theme = useSettingsStore((state) => state.theme)
  const updateSettings = useSettingsStore((state) => state.update)
  const terminalOpen = usePanelsStore((state) => state.terminalOpen)
  const setTerminalOpen = usePanelsStore((state) => state.setTerminalOpen)
  const openSidePaneTab = usePanelsStore((state) => state.open)
  const sidePane = usePanelsStore((state) => state.sidePane)
  const workspacePath = useWorkspaceStore((state) => state.localWorkspacePath)
  const shortcutOverrides = useShortcutsStore((state) => state.overrides)

  // ZCode keys history by workspace, so switching projects does not surface the
  // previous project's searches.
  const workspaceKey = workspacePath || '(no-workspace)'

  useEffect(() => {
    if (!open) return
    setRawQuery('')
    setIndex(0)
    setTab('commands')
    setHistory(readCommandCenterSearchHistory(workspaceKey))
    // Focus on the next frame so the dialog is mounted before focusing.
    const id = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [open, workspaceKey])

  const { query, scope, explicitScope } = resolveQueryScope(rawQuery)

  // A typed prefix wins over the tab strip, exactly as in ZCode.
  useEffect(() => {
    if (!explicitScope) return
    setTab(scope === 'commands' ? 'commands' : scope === 'files' ? 'files' : 'conversations')
  }, [explicitScope, scope])

  const commands = useMemo(
    () =>
      createQuickPickCommands({
        allowOpenWorkspace: true,
        canOpenCommunity: false,
        isSidebarVisible: !sidebarCollapsed,
        isLoggedIn: Boolean(authStatus?.signedIn),
        // ZCode's own capability flags. Orin Code has a terminal and an embedded
        // browser side pane, but no review surface, so add-review-tab is
        // filtered out exactly as ZCode filters it when unsupported.
        supportsTerminal: true,
        supportsReview: false,
        supportsEmbeddedBrowser: true,
        themeTarget: theme === 'dark' ? 'light' : 'dark',
        // Effective bindings, resolved outside the selector: effective()
        // builds a new object per call, so using it as a zustand selector would
        // re-render forever. Reading overrides and resolving here keeps the
        // snapshot stable, and the palette still shows the user's rebindings.
        shortcuts: {
          newTask: formatShortcut(bindingOf(shortcutOverrides, 'newTask', 'CmdOrCtrl+n')),
          openWorkspace: formatShortcut(bindingOf(shortcutOverrides, 'openWorkspace', 'CmdOrCtrl+o')),
          toggleSidebar: formatShortcut(bindingOf(shortcutOverrides, 'toggleSidebar', 'CmdOrCtrl+b')),
          toggleTerminal: formatShortcut(bindingOf(shortcutOverrides, 'toggleTerminal', 'CmdOrCtrl+j')),
        },
        handlers: {
          createTask: () => {
            createChat()
            setView('chat')
          },
          openWorkspace: () => void openFromFolder(),
          openSettings: () => setView('settings'),
          openSkillsSettings: () => setView('skills'),
          openMcpSettings: () => setView('connectors'),
          switchTheme: () => updateSettings({ theme: theme === 'dark' ? 'light' : 'dark' }),
          openFeedback: () => {},
          openCommunity: () => {},
          openProductDocs: () => {},
          login: () => setView('settings'),
          logout: () => void useAuthStore.getState().logout(),
          toggleSidebar,
          toggleTerminal: () => setTerminalOpen(!terminalOpen),
          togglePreview: () => openBrowserTab(),
          openTerminalTab: () => openTerminalTab(),
          openBrowserTab: () => openBrowserTab(),
          openReviewTab: () => {},
        },
      }),
    // `view` is read so the factory re-runs when it changes; the value is not used.
    [view, sidebarCollapsed, authStatus?.signedIn, theme, shortcutOverrides, createChat, setView, openFromFolder, toggleSidebar, terminalOpen, openSidePaneTab],
  )

  function openTerminalTab(): void {
    setTerminalOpen(true)
    openSidePaneTab({ id: newTabId('terminal'), type: 'terminal', openedAt: Date.now(), sessionId: newTabId('term') })
  }
  function openBrowserTab(): void {
    openSidePaneTab({ id: newTabId('browser'), type: 'browser', openedAt: Date.now(), initialUrl: null })
  }

  const files = useMemo<FileEntry[]>(() => {
    if (!workspacePath) return []
    return projects.flatMap((project) =>
      (project.knowledge ?? []).map((entry) => ({
        name: entry.name,
        relativePath: entry.name,
        type: 'file' as const,
      })),
    )
  }, [projects])

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    const showCommands = tab === 'commands' || tab === 'recent'
    const showFiles = tab === 'files'
    const showChats = tab === 'conversations'

    if (showCommands) {
      const matched = commands.filter((command) => matchesCommand(command, query))
      const groups = groupCommandsBySection(matched)
      for (const group of groups) {
        const expanded = expandedSections.has(group.sectionId)
        const shown =
          expanded || group.commands.length <= COMMAND_CENTER_SECTION_LIMIT
            ? group.commands
            : group.commands.slice(0, COMMAND_CENTER_SECTION_LIMIT)
        for (const command of shown) {
          out.push({
            key: command.id,
            group: group.sectionId,
            label: command.title,
            hint: command.shortcut,
            disabled: command.disabled,
            run: command.run,
          })
        }
        if (!expanded && group.commands.length > COMMAND_CENTER_SECTION_LIMIT) {
          out.push({
            key: `more:${group.sectionId}`,
            group: group.sectionId,
            label: 'More results',
            local: true,
            run: () => setExpandedSections((current) => new Set(current).add(group.sectionId)),
          })
        }
      }
    }

    if (showFiles) {
      for (const entry of filterWorkspaceFileEntries(files, query)) {
        out.push({
          key: `file:${entry.relativePath}`,
          group: 'files',
          label: entry.name,
          hint: entry.relativePath,
          run: () => {
            void useEditorStore.getState().openFile(entry.relativePath, entry.name)
            setView('ide')
          },
        })
      }
    }

    if (showChats) {
      const needle = query.trim().toLocaleLowerCase()
      const matched = chatIndex
        .filter((chat) => (needle ? chat.title.toLocaleLowerCase().includes(needle) : true))
        .slice(0, 80)
      for (const chat of matched) {
        out.push({
          key: `chat:${chat.id}`,
          group: 'conversations',
          label: chat.title,
          run: () => {
            selectChat(chat.id)
            setView('chat')
          },
        })
      }
    }

    return out
  }, [tab, query, commands, files, chatIndex, selectChat, setView, expandedSections])

  useEffect(() => setIndex(0), [rawQuery, tab])

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const execute = async (row: Row) => {
    if (row.disabled) return
    // ZCode records the query, closes, then runs -- so a slow command never
    // freezes the dialog.
    const trimmed = rawQuery.trim()
    if (trimmed) {
      setHistory(
        pushCommandCenterSearchHistory({
          workspaceKey,
          query: trimmed,
          scope: scope === 'commands' ? 'commands' : scope === 'files' ? 'files' : scope === 'conversations' ? 'conversations' : 'all',
        }),
      )
    }
    onClose()
    try {
      await row.run()
    } catch (error) {
      console.error('[CommandCentre] command failed', { key: row.key, error })
      onError('That command did not finish', String(error))
    }
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setIndex((prev) => Math.min(prev + 1, Math.max(0, rows.length - 1)))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setIndex((prev) => Math.max(prev - 1, 0))
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const row = rows[index]
      if (row) void (row.local ? row.run() : execute(row))
    }
  }

  if (!open) return null

  const activeId = rows[index]?.key
  const showHistory = !rawQuery.trim() && history.length > 0

  return (
    <div className="cc-scrim" onMouseDown={onClose}>
      <div className="cc" role="dialog" aria-modal="true" aria-label="Command Center" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="cc-input"
          value={rawQuery}
          placeholder="Search commands, conversations and files"
          onChange={(event) => setRawQuery(event.target.value)}
          onKeyDown={onKeyDown}
          aria-label="Command Center query"
        />

        <div className="cc-tabs" role="tablist">
          {(['recent', 'commands', 'conversations', 'files'] as Tab[]).map((id) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              className={`cc-tab ${tab === id ? 'active' : ''}`}
              onClick={() => setTab(id)}
            >
              {id === 'recent' ? 'Recent' : id === 'conversations' ? 'Conversations' : id[0].toUpperCase() + id.slice(1)}
            </button>
          ))}
        </div>

        <div className="cc-list" ref={listRef} role="listbox">
          {rows.length === 0 && <p className="cc-empty">Nothing matches that.</p>}
          {rows.map((row, i) => (
            <button
              key={row.key}
              role="option"
              aria-selected={row.key === activeId}
              data-active={row.key === activeId}
              className={`cc-row ${row.key === activeId ? 'active' : ''} ${row.disabled ? 'disabled' : ''}`}
              onMouseEnter={() => setIndex(i)}
              onClick={() => void (row.local ? row.run() : execute(row))}
              disabled={row.disabled}
            >
              <span className="cc-group">{row.group}</span>
              <span className="cc-label">{row.label}</span>
              {row.hint && <kbd className="cc-hint">{row.hint}</kbd>}
            </button>
          ))}
        </div>

        {showHistory && (
          <div className="cc-history-block">
            {history.slice(0, COMMAND_CENTER_CONTEXT_SECTION_LIMIT).map((entry) => (
              <button
                key={`h:${entry.query}`}
                className="cc-row cc-history"
                onClick={() => {
                  // Picking a history entry restores its SCOPE PREFIX, as ZCode
                  // does, rather than dropping the entry into an all-scope
                  // search that would return different results.
                  const prefix = entry.scope === 'commands' ? '>' : entry.scope === 'files' ? '@' : entry.scope === 'conversations' ? '#' : ''
                  setRawQuery(`${prefix}${entry.query}`)
                  setTab(entry.scope === 'commands' ? 'commands' : entry.scope === 'files' ? 'files' : entry.scope === 'conversations' ? 'conversations' : 'recent')
                  inputRef.current?.focus()
                }}
              >
                <span className="cc-label">{entry.query}</span>
              </button>
            ))}
            <button className="cc-clear" onClick={() => { clearCommandCenterSearchHistory(workspaceKey); setHistory([]) }}>
              Clear search history
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
