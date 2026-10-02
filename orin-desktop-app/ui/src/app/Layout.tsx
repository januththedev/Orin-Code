import { lazy, Suspense, useEffect, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import {
  PanelLeftClose,
  PanelLeftOpen,
  Minus,
  Square,
  X,
  Home,
  Plus,
  FolderClosed,
  Shapes,
  SlidersHorizontal,
  Monitor,
  Sparkles,
  FileText,
  Brain,
  ListTree,
  Globe,
} from 'lucide-react'
import { bridge } from '../bridge/client'
import { OrinMark } from '../components/OrinMark'
import { Palette, useAppCommands } from '../components/CommandPalette'
import { useUiStore, type ViewId } from '../stores/uiStore'
import { useChatsStore } from '../stores/chatsStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useShortcutsStore } from '../stores/shortcutsStore'
import { usePanelsStore } from '../stores/panelsStore'
import { WorkspaceFileTree, resolveWorkspacePath } from '../shell/WorkspaceFileTree'
import { useEditorStore } from '../stores/editorStore'
import { FolderTree } from 'lucide-react'
import { buildSidePaneOwnerKey, useWorkspaceStore } from '../stores/workspaceStore'
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels'
import { SidePane } from '../shell/SidePane'
import { TerminalPanel } from '../shell/TerminalPanel'
import {
  SHORTCUT_COMMANDS,
  matchesShortcutBinding,
  isEditableShortcutTarget,
  isShiftOnlyPrintableBinding,
} from '../shortcuts/shortcutCommands'
import { useAuthStore } from '../stores/authStore'
import { SETTINGS_SECTION_KEY } from '../features/settings/SettingsPage'
import { HistorySearch } from '../features/chat/HistorySearch'
import { CurrentView, ViewFallback } from './routes'

function TitleBar() {
  const toggleSidebar = useUiStore((state) => state.toggleSidebar)
  const collapsed = useUiStore((state) => state.sidebarCollapsed)

  const windowControls = bridge.isTauri ? (
    <div className="titlebar-controls">
      <button
        className="titlebar-button"
        aria-label="Minimize"
        onClick={() => getCurrentWindow().minimize()}
      >
        <Minus size={14} />
      </button>
      <button
        className="titlebar-button"
        aria-label="Maximize"
        onClick={() => getCurrentWindow().toggleMaximize()}
      >
        <Square size={11} />
      </button>
      <button
        className="titlebar-button titlebar-close"
        aria-label="Close"
        onClick={() => getCurrentWindow().close()}
      >
        <X size={15} />
      </button>
    </div>
  ) : null

  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="titlebar-left">
        <button
          className="icon-ghost"
          aria-label="Toggle sidebar"
          onClick={toggleSidebar}
          title="Toggle sidebar (Ctrl+B)"
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>
      <div className="titlebar-center" data-tauri-drag-region>
        <OrinMark size={18} />
        <span className="titlebar-name">Orin Code</span>
      </div>
      <div className="titlebar-right">{windowControls}</div>
    </header>
  )
}

const NAV_ITEMS: Array<{ id: ViewId; label: string; icon: typeof Home }> = [
  { id: 'projects', label: 'Projects', icon: FolderClosed },
  { id: 'artifacts', label: 'Artifacts', icon: Shapes },
  { id: 'studio', label: 'Studio', icon: Sparkles },
  { id: 'computer', label: 'Computer Use', icon: Monitor },
  { id: 'notes', label: 'Notes', icon: FileText },
  { id: 'queue', label: 'Background', icon: ListTree },
  { id: 'browser', label: 'Read a page', icon: Globe },
  { id: 'memory', label: 'Memory', icon: Brain },
  { id: 'customize', label: 'Customize', icon: SlidersHorizontal },
]

function NavRail() {
  // The file tree opens as an overlay over the rail, so it is reachable from any
  // view rather than only from the Code view (ZCode: WorkspaceSidebar.tsx:1664-1696).
  const workspacePath = useWorkspaceStore((state) => state.localWorkspacePath)
  const [treeOpen, setTreeOpen] = useState(false)
  const view = useUiStore((state) => state.view)
  const setView = useUiStore((state) => state.setView)
  const collapsed = useUiStore((state) => state.sidebarCollapsed)
  // The sidebar reads the index, not the loaded conversations: it is the
  // small per-chat summary list, so the rail renders without loading any
  // message bodies.
  const index = useChatsStore((state) => state.index)
  const activeId = useChatsStore((state) => state.activeId)
  const selectChat = useChatsStore((state) => state.selectChat)
  const createChat = useChatsStore((state) => state.createChat)
  const authStatus = useAuthStore((state) => state.status)

  useEffect(() => {
    void useAuthStore.getState().hydrate()
  }, [])

  const session = authStatus?.signedIn ? authStatus.session : null
  const accountLabel = session ? `${session.name} · Cloud plan` : 'You · Local mode'
  const openAccount = () => {
    localStorage.setItem(SETTINGS_SECTION_KEY, 'account')
    setView('settings')
  }

  const recents = index.filter((chat) => !chat.archived).slice(0, 24)

  const goHome = () => setView('home')

  if (collapsed) {
    return (
      <nav className="navrail navrail-collapsed">
        <button className="rail-icon active-home" title="Home" onClick={goHome}>
          <OrinMark size={22} />
        </button>
        <button
          className="rail-icon"
          title="New conversation (Ctrl+N)"
          onClick={() => {
            createChat()
            setView('chat')
          }}
        >
          <Plus size={17} />
        </button>
        {NAV_ITEMS.map((item) => (
          <button key={item.id} className={`rail-icon ${view === item.id ? 'active' : ''}`} title={item.label} onClick={() => setView(item.id)}>
            <item.icon size={17} />
          </button>
        ))}
      </nav>
    )
  }

  return (
    <nav className="navrail">
      <div className="rail-tabs">
        <button className={`rail-tab ${view === 'home' || view === 'chat' ? 'active' : ''}`} onClick={goHome}>
          <Home size={14} /> Home
        </button>
        <button className={`rail-tab ${view === 'ide' ? 'active' : ''}`} onClick={() => setView('ide')}>
          {'</>'} Code
        </button>
      </div>

      <button
        className="new-chat-button"
        onClick={() => {
          createChat()
          setView('chat')
        }}
      >
        <Plus size={15} /> New
      </button>

      <div className="rail-items">
        {NAV_ITEMS.map((item) => (
          <button key={item.id} className={`rail-item ${view === item.id ? 'active' : ''}`} onClick={() => setView(item.id)}>
            <item.icon size={15} /> {item.label}
          </button>
        ))}
      </div>

      <div className="rail-section">
        <span className="rail-heading">Chats and tasks</span>
        <div className="rail-recents">
          {recents.length === 0 && <p className="rail-empty">No conversations yet</p>}
          {recents.map((chat) => (
            <button
              key={chat.id}
              className={`recent-chat ${chat.id === activeId ? 'active' : ''}`}
              onClick={() => {
                selectChat(chat.id)
                setView('chat')
              }}
              title={chat.title}
            >
              <span className="recent-dot" />
              {chat.pinned ? '★ ' : ''}
              {chat.title}
            </button>
          ))}
        </div>
      </div>

      {treeOpen && (
        <div className="tree-overlay" role="dialog" aria-label="Workspace files">
          <div className="tree-overlay-head">
            <span>{workspacePath || 'No folder open'}</span>
            <button type="button" onClick={() => setTreeOpen(false)} aria-label="Close file tree">
              ×
            </button>
          </div>
          <WorkspaceFileTree
            onOpenFile={(_, relative) => {
              setTreeOpen(false)
              setView('ide')
              // Absolute path, so the editor reads from the workspace root the
              // tree was showing rather than from the process cwd.
              void useEditorStore.getState().openFile(resolveWorkspacePath(workspacePath, relative), relative)
            }}
          />
        </div>
      )}

      <footer className="rail-footer">
        <button
          className="rail-footer-icon"
          title="Workspace files"
          onClick={() => setTreeOpen(!treeOpen)}
          disabled={!workspacePath}
        >
          <FolderTree size={14} />
        </button>
        <button className="account-chip" onClick={openAccount} title={session ? 'Account settings' : 'Sign in'}>
          <span className="account-avatar">{(session?.name?.[0] ?? 'Y').toUpperCase()}</span>
          {accountLabel}
        </button>
        <button className="rail-footer-icon" title="Settings" onClick={() => setView('settings')}>
          <SlidersHorizontal size={14} />
        </button>
      </footer>
    </nav>
  )
}

function ToastHost() {
  const toasts = useUiStore((state) => state.toasts)
  const dismiss = useUiStore((state) => state.dismissToast)
  if (toasts.length === 0) return null
  return (
    <div className="toast-host">
      {toasts.map((toast) => (
        <button key={toast.id} className={`toast toast-${toast.level}`} onClick={() => dismiss(toast.id)}>
          <strong>{toast.title}</strong>
          {toast.body && <span>{toast.body}</span>}
        </button>
      ))}
    </div>
  )
}

export default function Layout() {
  const view = useUiStore((state) => state.view)
  const collapsed = useUiStore((state) => state.sidebarCollapsed)
  const setView = useUiStore((state) => state.setView)
  const toggleSidebar = useUiStore((state) => state.toggleSidebar)
  const createChat = useChatsStore((state) => state.createChat)
  const searchOpen = useUiStore((state) => state.searchOpen)
  const setSearchOpen = useUiStore((state) => state.setSearchOpen)
  const settings = useSettingsStore((state) => state)
  const activeId = useChatsStore((state) => state.activeId)
  const updateSettings = useSettingsStore((state) => state.update)
  const paletteOpen = useUiStore((state) => state.paletteOpen)
  const setPaletteOpen = useUiStore((state) => state.setPaletteOpen)

  // Global keyboard dispatch, driven by the shortcut table rather than four
  // hardcoded chords, so a rebind takes effect everywhere and adding a command
  // does not mean touching this handler.
  useEffect(() => {
    void useShortcutsStore.getState().hydrate()
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Auto-repeat is a held key, not a second command; typing in a field that
      // composes IME must not be intercepted either.
      if (event.repeat || event.isComposing) return
      const target = event.target as EventTarget | null
      const bindings = useShortcutsStore.getState().effective()

      for (const entry of SHORTCUT_COMMANDS) {
        // composer-scope commands belong to the chat input; the global
        // dispatcher must stay out of their way entirely.
        if ((entry.scope ?? 'global') !== 'global') continue
        if (!entry.implemented) continue
        const chords = bindings[entry.id] ?? []
        const hit = chords.find((chord) => {
          // A bare Shift+letter binding is the same physical event as typing a
          // capital letter, so it must not fire while an editable element has
          // focus — otherwise uppercase letters become untypable.
          if (isEditableShortcutTarget(target) && isShiftOnlyPrintableBinding(chord)) return false
          return matchesShortcutBinding(
            {
              key: event.key,
              ctrlKey: event.ctrlKey,
              metaKey: event.metaKey,
              altKey: event.altKey,
              shiftKey: event.shiftKey,
              code: event.code,
            },
            chord,
          )
        })
        if (!hit) continue

        event.preventDefault()
        switch (entry.id) {
          case 'toggleSidebar':
            toggleSidebar()
            break
          case 'newTask':
            createChat()
            setView('chat')
            break
          case 'openCommandCenter':
            setPaletteOpen(!useUiStore.getState().paletteOpen)
            break
          case 'openSettings':
            setView('settings')
            break
          case 'switchTheme':
            updateSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' })
            break
          default:
            break
        }
        return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleSidebar, createChat, setView, setPaletteOpen, settings.theme, updateSettings])

  const commands = useAppCommands({
    newChat: () => {
      createChat()
      setView('chat')
    },
    navigate: (next) => setView(next),
    toggleTheme: () => {
      const settings = useSettingsStore.getState()
      settings.update({ theme: settings.theme === 'dark' ? 'light' : 'dark' })
    },
    openSearch: () => setSearchOpen(true),
  })

  // The IDE and Computer Use views own the whole main region (no padding).
  const fullBleed = view === 'ide' || view === 'computer'

  // The shell, ported from ZCode's WorkspaceShellLayout: a sidebar, a
  // conversation column that splits vertically into conversation and terminal,
  // and a resizable right-hand side pane. The panel ids are ZCode's own
  // (`conversation-column`, `conversation`, `terminal`, `browser`) so a persisted
  // layout means the same thing here as there.
  const sidePaneCollapsed = usePanelsStore((s) => s.sidePaneCollapsed)
  const setSidePaneCollapsed = usePanelsStore((s) => s.setSidePaneCollapsed)
  const sidePaneTabs = usePanelsStore((s) => s.sidePane.tabs.length)
  const setTerminalOpen = usePanelsStore((s) => s.setTerminalOpen)

  useEffect(() => {
    void usePanelsStore.getState().hydrate()
    void useWorkspaceStore.getState().hydrate()
    void useEditorStore.getState().hydrate()
  }, [])

  // ⌘J toggles the bottom terminal panel, as in ZCode. The side pane is opened
  // and closed through its own tab strip, so a toggle only applies once there is
  // something to show.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.isComposing) return
      const target = event.target as EventTarget | null
      if (isEditableShortcutTarget(target)) return
      const bindings = useShortcutsStore.getState().effective()
      const chords = bindings.toggleTerminal ?? []
      if (!chords.some((chord) => matchesShortcutBinding(
        { key: event.key, ctrlKey: event.ctrlKey, metaKey: event.metaKey, altKey: event.altKey, shiftKey: event.shiftKey, code: event.code },
        chord,
      ))) return
      event.preventDefault()
      setTerminalOpen(!usePanelsStore.getState().terminalOpen)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setTerminalOpen])

  // ZCode's rule, not a guess: the side pane's visibility is the inverse of
  // `collapsed` and is independent of whether any tab is open
  // (`App.tsx:504`). Gating it on having tabs makes the pane unreachable when
  // empty, which is how the first tab could never be opened.
  const workspacePath = useWorkspaceStore((s) => s.localWorkspacePath)
  const sidePaneOpen = !sidePaneCollapsed[buildSidePaneOwnerKey(workspacePath, activeId)]
  void sidePaneTabs

  // Panel sizes persist per layout id, via the library's debounced hook. ZCode
  // does the same rather than writing on every change: a window drag produces
  // hundreds of layout updates a second.
  const { defaultLayout: bodyLayout, onLayoutChange: setBodyLayout } = useDefaultLayout({ id: 'orin-body-layout' })
  const { defaultLayout: columnLayout, onLayoutChange: setColumnLayout } = useDefaultLayout({ id: 'orin-conversation-layout' })

  return (
    <div className="shell">
      <TitleBar />
      <Group orientation="horizontal" defaultLayout={bodyLayout} onLayoutChange={setBodyLayout} className="shell-body">
        <Panel defaultSize={sidePaneOpen ? 52 : 68} minSize="35%" id="conversation-column">
          <Group orientation="vertical" defaultLayout={columnLayout} onLayoutChange={setColumnLayout} className="conversation-column">
            <Panel minSize="35%" className="conversation-panel">
              <div className="conversation-inner">
                <NavRail />
                <main className={`main-view ${fullBleed ? 'full-bleed' : ''}`}>
                  <Suspense fallback={<ViewFallback />}>
                    <CurrentView view={view} />
                  </Suspense>
                </main>
              </div>
            </Panel>
            <TerminalPanel />
          </Group>
        </Panel>
        {sidePaneOpen && (
          <Separator className="pane-handle" aria-label="Resize side pane" />
        )}
        {sidePaneOpen && (
          <Panel defaultSize={32} minSize="15%" maxSize="60%" id="browser" className="side-pane-panel">
            <SidePane />
          </Panel>
        )}
      </Group>
      <ToastHost />
      <HistorySearch open={searchOpen} onClose={() => setSearchOpen(false)} />
      <Palette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commands} />
    </div>
  )
}
