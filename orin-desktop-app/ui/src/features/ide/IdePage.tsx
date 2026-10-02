import { useEffect, useMemo, useState } from 'react'
import Editor from '@monaco-editor/react'
import { X } from 'lucide-react'
import { bridge } from '../../bridge/client'
import { useProjectsStore } from '../../stores/projectsStore'
import { useEditorStore } from '../../stores/editorStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { useUiStore } from '../../stores/uiStore'
import { FileExplorer } from './FileExplorer'
import { TerminalPane } from './TerminalPane'
import { AiPanel } from './AiPanel'
import { languageFor } from './languages'
import './ide.css'

export default function IdePage() {
  const projects = useProjectsStore((state) => state.projects)
  const activeProjectId = useProjectsStore((state) => state.activeProjectId)
  const toast = useUiStore((state) => state.toast)

  // The workspace IS the project context. Reading a separate projects list here
  // meant the editor, the tree, the terminal and the agent could each disagree
  // about which folder is open -- so the root comes from the one store, and
  // workspace_activate is the store's job, not a component's.
  const workspacePath = useWorkspaceStore((state) => state.localWorkspacePath)
  const project = useMemo(
    () => projects.find((candidate) => candidate.id === activeProjectId) ?? null,
    [projects, activeProjectId],
  )
  const root = workspacePath || project?.rootPath || null

  // Tabs live in the store so the sidebar file tree can open a file here, not
  // just display one. See ui/src/stores/editorStore.ts.
  const tabs = useEditorStore((s) => s.tabs)
  const activePath = useEditorStore((s) => s.activePath)
  const openFile = useEditorStore((s) => s.openFile)
  const closeTab = useEditorStore((s) => s.closeTab)
  const setActivePath = useEditorStore((s) => s.setActive)
  const setContent = useEditorStore((s) => s.setContent)
  const markDirty = useEditorStore((s) => s.markDirty)

  const activeTab = tabs.find((tab) => tab.path === activePath) ?? null

  const saveActive = async () => {
    if (!activeTab || activeTab.error) return
    try {
      await bridge.writeFile(activeTab.path, activeTab.content)
      markDirty(activeTab.path, false)
      toast('success', 'Saved', activeTab.name)
    } catch (error) {
      toast('error', 'Could not save', String(error))
    }
  }

  // Ctrl+S saves the active editor tab.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        if (!activeTab) return
        event.preventDefault()
        saveActive()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab])

  return (
    <div className="ide-page">
      <aside className="ide-left">
        <div className="ide-pane-title">Explorer{project ? ` · ${project.name}` : ''}</div>
        <FileExplorer root={root} onOpenFile={openFile} />
      </aside>

      <section className="ide-center">
        <div className="ide-tabbar">
          {tabs.length === 0 && <span className="ide-tabbar-empty">No files open</span>}
          {tabs.map((tab) => (
            <span
              key={tab.path}
              className={`ide-tab ${tab.path === activePath ? 'active' : ''}`}
              onClick={() => setActivePath(tab.path)}
              onMouseDown={(event) => {
                if (event.button === 1) closeTab(tab.path)
              }}
            >
              {tab.dirty && <i className="ide-dirty-dot" />}
              <span className="ide-tab-name">{tab.name}</span>
              <button
                className="ide-tab-close"
                aria-label={`Close ${tab.name}`}
                onClick={(event) => {
                  event.stopPropagation()
                  closeTab(tab.path)
                }}
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>

        <div className="ide-editor">
          {!activeTab && (
            <div className="ide-editor-empty">
              <p>Select a file from the explorer</p>
              <span>Orin's proposed changes will also appear here.</span>
            </div>
          )}
          {activeTab?.error && (
            <div className="ide-editor-notice">
              <strong>{activeTab.name}</strong>
              <p>{activeTab.error}</p>
            </div>
          )}
          {activeTab && !activeTab.error && (
            <Editor
              height="100%"
              language={languageFor(activeTab.name)}
              theme="vs-dark"
              value={activeTab.content}
              onChange={(value) => {
                setContent(activeTab.path, value ?? '')
                markDirty(activeTab.path, true)
              }}
              options={{
                fontSize: 13,
                fontFamily: 'var(--font-mono)',
                minimap: { enabled: true },
                smoothScrolling: true,
                scrollBeyondLastLine: false,
                padding: { top: 14, bottom: 14 },
                automaticLayout: true,
                renderLineHighlight: 'all',
                cursorBlinking: 'smooth',
              }}
            />
          )}
        </div>

        <TerminalPane root={root} />
      </section>

      <aside className="ide-right">
        <AiPanel root={root} project={project} />
      </aside>
    </div>
  )
}
