import { useEffect, useMemo, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  RefreshCw,
  File as FileIcon,
  FileCode2,
  FileJson,
  FileText,
  FilePen,
  FileCog,
  FileTerminal,
  Image as ImageIcon,
  Folder,
  FolderOpen,
} from 'lucide-react'
import { bridge } from '../../bridge/client'
import { useProjectsStore } from '../../stores/projectsStore'
import { useUiStore } from '../../stores/uiStore'
import type { FileNode } from '../../bridge/types'

const ICONS: Array<[RegExp, typeof FileIcon]> = [
  [/\.(ts|tsx|js|jsx|mjs|cjs)$/i, FileCode2],
  [/\.json$/i, FileJson],
  [/\.(md|txt)$/i, FileText],
  [/\.(css|scss)$/i, FilePen],
  [/\.(html|htm|svg)$/i, FileCode2],
  [/\.(rs|go|c|h|cpp|hpp|java|kt|swift)$/i, FileCog],
  [/\.(sh|ps1|bat|cmd)$/i, FileTerminal],
  [/\.(png|jpe?g|gif|webp|ico|bmp)$/i, ImageIcon],
]

function iconFor(name: string) {
  return ICONS.find(([pattern]) => pattern.test(name))?.[1] ?? FileIcon
}

const GIT_COLORS: Record<string, string> = {
  M: 'var(--accent)',
  A: 'var(--success)',
  D: 'var(--danger)',
  U: '#b48ce8',
  '?': 'var(--muted-2)',
}

function matches(node: FileNode, filter: string): boolean {
  if (!filter) return true
  if (node.name.toLowerCase().includes(filter)) return true
  return (node.children ?? []).some((child) => matches(child, filter))
}

export function FileExplorer({
  root,
  onOpenFile,
}: {
  root: string | null
  onOpenFile: (path: string, name: string) => void
}) {
  const [tree, setTree] = useState<FileNode[]>([])
  const [filter, setFilter] = useState('')
  const [gitStatus, setGitStatus] = useState<Record<string, string>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const setView = useUiStore((state) => state.setView)

  const load = async () => {
    if (!root) return
    try {
      await bridge.workspaceActivate(root)
      const nodes = await bridge.readDir(root, 3)
      setTree(nodes)
      bridge
        .gitStatus(root)
        .then((status) => setGitStatus(normalizeStatus(status)))
        .catch(() => setGitStatus({}))
    } catch {
      setTree([])
    }
  }

  useEffect(() => {
    setFilter('')
    setExpanded(new Set())
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root])

  const filtered = useMemo(
    () => (filter ? tree.map((node) => prune(node, filter.toLowerCase())).filter(Boolean) as FileNode[] : tree),
    [tree, filter],
  )

  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })

  if (!root) {
    return (
      <div className="ide-explorer-empty">
        <p>No project open.</p>
        <button className="ide-open-project" onClick={() => setView('projects')}>
          Open a project first
        </button>
      </div>
    )
  }

  return (
    <div className="ide-explorer">
      <div className="ide-explorer-head">
        <input
          className="ide-filter"
          placeholder="Filter files…"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
        <button className="icon-ghost" title="Refresh" onClick={load}>
          <RefreshCw size={13} />
        </button>
      </div>
      <div className="ide-tree">
        {filtered.length === 0 && <p className="ide-tree-empty">No matching files</p>}
        {filtered.map((node) => (
          <TreeRow
            key={node.path}
            node={node}
            depth={0}
            expanded={expanded}
            gitStatus={gitStatus}
            root={root}
            onToggle={toggle}
            onOpenFile={onOpenFile}
          />
        ))}
      </div>
    </div>
  )
}

// git_status keys may be repo-relative paths; match by suffix at render time.
function normalizeStatus(raw: Record<string, string>): Record<string, string> {
  return raw
}

function prune(node: FileNode, filter: string): FileNode | null {
  const selfMatch = node.name.toLowerCase().includes(filter)
  const children = (node.children ?? [])
    .map((child) => prune(child, filter))
    .filter((child): child is FileNode => child !== null)
  if (!selfMatch && children.length === 0) return null
  return { ...node, children: node.type === 'folder' ? children : undefined }
}

function TreeRow({
  node,
  depth,
  expanded,
  gitStatus,
  root,
  onToggle,
  onOpenFile,
}: {
  node: FileNode
  depth: number
  expanded: Set<string>
  gitStatus: Record<string, string>
  root: string
  onToggle: (path: string) => void
  onOpenFile: (path: string, name: string) => void
}) {
  const isOpen = expanded.has(node.path)

  const statusFor = (): string | undefined => {
    if (node.type !== 'file') return undefined
    if (gitStatus[node.path]) return gitStatus[node.path]
    const normalizedRoot = root.replace(/\\/g, '/')
    const hit = Object.keys(gitStatus).find((key) => {
      const full = key.startsWith(normalizedRoot) ? key : `${normalizedRoot}/${key}`
      return full.replace(/\\/g, '/') === node.path.replace(/\\/g, '/')
    })
    return hit ? gitStatus[hit] : undefined
  }

  const gitDot = statusFor()

  if (node.type === 'folder') {
    return (
      <div>
        <button className="ide-row" style={{ paddingLeft: 8 + depth * 14 }} onClick={() => onToggle(node.path)}>
          {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {isOpen ? <FolderOpen size={13} /> : <Folder size={13} />}
          <span className="ide-row-name">{node.name}</span>
        </button>
        {isOpen &&
          (node.children ?? []).map((child) => (
            <TreeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              gitStatus={gitStatus}
              root={root}
              onToggle={onToggle}
              onOpenFile={onOpenFile}
            />
          ))}
      </div>
    )
  }

  const Icon = iconFor(node.name)
  return (
    <button className="ide-row ide-file" style={{ paddingLeft: 22 + depth * 14 }} onClick={() => onOpenFile(node.path, node.name)}>
      <Icon size={13} />
      <span className="ide-row-name">{node.name}</span>
      {gitDot && <span className="ide-git-dot" style={{ background: GIT_COLORS[gitDot] ?? 'var(--muted)' }} />}
    </button>
  )
}
