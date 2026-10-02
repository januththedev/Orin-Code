import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronRight, Folder, FileText, RefreshCw, Search } from 'lucide-react'
import { bridge } from '../bridge/client'
import type { FileNode } from '../bridge/types'
import { useWorkspaceStore } from '../stores/workspaceStore'

/**
 * The workspace file tree, ported from ZCode's `WorkspaceFileTree.tsx`.
 *
 * Deliberately READ-ONLY, because ZCode's is. Its file service exposes 18
 * methods and none of them create, rename, delete or move a file; the tree's
 * context menu is copy-path only, and the agent performs writes through its own
 * tool calls. Adding a file manager here would be inventing a surface ZCode
 * does not have, which is the opposite of parity.
 *
 * Keyboard behaviour is ZCode's (`WorkspaceFileTree.tsx:560-576`):
 *   Enter  open the entry
 *   Right  expand a folder
 *   Left   collapse it, or step out to the parent
 */

function basename(p: string): string {
  const parts = p.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts[parts.length - 1] ?? p
}

function dirname(p: string): string {
  const normalised = p.replace(/[\\/]+$/, '')
  const cut = Math.max(normalised.lastIndexOf('/'), normalised.lastIndexOf('\\'))
  return cut > 0 ? normalised.slice(0, cut) : ''
}

/** Join a workspace-relative path onto the root. Exported so the shell can
 * open a tree selection in the editor without duplicating the rule. */
export function resolveWorkspacePath(root: string, relative: string): string {
  if (!relative) return root
  return `${root.replace(/[\\/]+$/, '')}/${relative}`
}

export function WorkspaceFileTree({ onOpenFile }: { onOpenFile?: (absolute: string, relative: string) => void }) {
  const root = useWorkspaceStore((s) => s.localWorkspacePath)
  const expanded = useWorkspaceStore((s) => s.expanded)
  const activeFile = useWorkspaceStore((s) => s.activeFile)
  const toggleExpanded = useWorkspaceStore((s) => s.toggleExpanded)
  const collapseAll = useWorkspaceStore((s) => s.collapseAll)
  const setActiveFile = useWorkspaceStore((s) => s.setActiveFile)

  const [nodes, setNodes] = useState<FileNode[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [focused, setFocused] = useState<string>('')

  const everything = expanded.includes('*')

  const load = useCallback(async () => {
    if (!root) return
    setLoading(true)
    setError(null)
    try {
      setNodes(await bridge.readDir(root, 6))
    } catch (err) {
      setError(String(err))
      setNodes([])
    } finally {
      setLoading(false)
    }
  }, [root])

  useEffect(() => {
    void load()
  }, [load])

  // Changing workspace invalidates the previous filter, which was scoped to the
  // old tree.
  useEffect(() => {
    setFilter('')
    setNodes([])
  }, [root])

  const visible = useMemo(() => {
    if (!filter.trim()) return nodes
    const needle = filter.trim().toLowerCase()
    const keep = (node: FileNode): FileNode =>
      node.type === 'folder' && node.children
        ? { ...node, children: node.children.map(keep).filter((c) => matches(c) || (c.children?.length ?? 0) > 0) }
        : node
    const matches = (node: FileNode) => node.name.toLowerCase().includes(needle)
    return nodes.map(keep).filter(matches)
  }, [nodes, filter])

  const isExpanded = (relative: string) => everything || expanded.includes(relative)

  const onKeyDown = (event: React.KeyboardEvent, node: FileNode, relative: string) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      setFocused(relative)
      if (node.type === 'folder') {
        if (!isExpanded(relative)) toggleExpanded(relative)
      } else {
        setActiveFile(relative)
        onOpenFile?.(resolveWorkspacePath(root, relative), relative)
      }
      return
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      setFocused(relative)
      if (node.type === 'folder' && !isExpanded(relative)) toggleExpanded(relative)
      return
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      setFocused(relative)
      const parent = dirname(relative)
      if (node.type === 'folder' && isExpanded(relative)) {
        toggleExpanded(relative)
        return
      }
      // Stepping out of a collapsed folder lands on the parent, as in ZCode.
      if (parent) setFocused(parent)
    }
  }

  if (!root) {
    return <div className="tree-empty">Open a folder to browse its files.</div>
  }

  const renderNode = (node: FileNode, relative: string, depth: number) => {
    const isDir = node.type === 'folder'
    const open = isDir && isExpanded(relative)
    const children = node.children ?? []
    return (
      <div key={relative}>
        <button
          type="button"
          role="treeitem"
          aria-expanded={isDir ? open : undefined}
          className={`tree-row ${activeFile === relative ? 'active' : ''} ${focused === relative ? 'focused' : ''}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => {
            setFocused(relative)
            if (isDir) toggleExpanded(relative)
            else {
              setActiveFile(relative)
              onOpenFile?.(resolveWorkspacePath(root, relative), relative)
            }
          }}
          onKeyDown={(event) => onKeyDown(event, node, relative)}
        >
          {isDir ? (
            <ChevronRight size={12} className={open ? 'tree-chevron open' : 'tree-chevron'} aria-hidden="true" />
          ) : (
            <span className="tree-chevron-spacer" aria-hidden="true" />
          )}
          {isDir ? <Folder size={13} aria-hidden="true" /> : <FileText size={13} aria-hidden="true" />}
          <span className="tree-name">{node.name}</span>
          {node.size != null && <span className="tree-size">{formatSize(node.size)}</span>}
        </button>
        {open && isDir && children.length > 0 && (
          <div role="group">
            {children.map((child) => renderNode(child, relative ? `${relative}/${child.name}` : child.name, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="tree" role="tree" aria-label="Workspace files">
      <div className="tree-toolbar">
        <span className="tree-root" title={root}>
          {basename(root) || root}
        </span>
        <button type="button" className="tree-action" aria-label="Refresh file tree" onClick={() => void load()}>
          <RefreshCw size={12} className={loading ? 'spinning' : undefined} />
        </button>
        <button type="button" className="tree-action" aria-label="Collapse all folders" onClick={collapseAll}>
          <Search size={12} />
        </button>
      </div>
      <div className="tree-filter">
        <input value={filter} placeholder="Filter files" onChange={(event) => setFilter(event.target.value)} />
      </div>
      {error && <div className="tree-error">{error}</div>}
      {loading && nodes.length === 0 && <div className="tree-empty">Reading {basename(root)}…</div>}
      {!loading && !error && nodes.length === 0 && <div className="tree-empty">This folder is empty.</div>}
      {nodes.map((node) => renderNode(node, node.name, 0))}
    </div>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}