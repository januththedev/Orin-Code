/**
 * Side-pane tab model, ported from ZCode's
 * `packages/ui/src/lib/workspaceSidePane.ts`.
 *
 * The single source of truth for every tab type: how a tab is identified, what
 * it carries, whether opening the same thing twice reuses the existing tab or
 * adds another, and whether it survives a reopen. That last rule is not a
 * detail — ZCode marks four tab kinds non-restorable precisely because their
 * content is owned by something transient (a PTY session, an agent-driven
 * page), and restoring a stale tab would point at a dead session.
 *
 * All nineteen ZCode tab types are declared here, not just the ones Orin Code
 * can render yet. A tab type that exists in the model but has no content is
 * `available: false` and the shell shows an explicit unavailable state for it.
 * Dropping the types instead would make the model lie about what ZCode has,
 * and would mean re-deriving this file when each one lands.
 */

export type SidePaneTabType =
  | 'browser'
  | 'git'
  | 'code-viewer'
  | 'treemapping'
  | 'whiteboard'
  | 'model-trajectory'
  | 'developer-tools'
  | 'terminal'
  | 'browser-use'
  | 'bash-output'
  | 'subagent-session'
  | 'subagent-directory'
  | 'selection-side-chat'
  | 'plan-detail'
  | 'workflow-run'
  | 'workflow-directory'
  | 'workflow-actor-session'
  | 'workflow-workspace'
  | 'workflow-artifact'

/** Fields every tab carries, matching ZCode's common tail. */
interface SidePaneTabBase {
  id: string
  /** Frozen owner of the conversation this tab was opened from; null = draft. */
  ownerTaskId?: string | null
  /** Workspace isolation key: `workspaceIdentity || workspacePath`. */
  workspaceKey?: string | null
  openedAt?: number
}

export interface BrowserSidePaneTab extends SidePaneTabBase {
  type: 'browser'
  faviconUrl?: string | null
  initialUrl?: string | null
  /** Opened by an agent-driven page rather than by the user. */
  agentOpened?: boolean
  title?: string | null
}

export interface GitSidePaneTab extends SidePaneTabBase {
  type: 'git'
}

export interface CodeViewerSidePaneTab extends SidePaneTabBase {
  type: 'code-viewer'
  source: { path: string; language?: string | null; content?: string | null }
  sourceKey: string | null
}

export interface TreemappingSidePaneTab extends SidePaneTabBase {
  type: 'treemapping'
  source?: { kind: 'current' } | { kind: 'message'; messageId: string; turnIndex?: number }
}

export interface WhiteboardSidePaneTab extends SidePaneTabBase {
  type: 'whiteboard'
}

export interface ModelTrajectorySidePaneTab extends SidePaneTabBase {
  type: 'model-trajectory'
  messageId?: string | null
}

export interface DeveloperToolsSidePaneTab extends SidePaneTabBase {
  type: 'developer-tools'
}

export interface TerminalSidePaneTab extends SidePaneTabBase {
  type: 'terminal'
  sessionId: string
}

export interface BrowserUseSidePaneTab extends SidePaneTabBase {
  type: 'browser-use'
  taskId: string
  url: string | null
}

export interface BashOutputSidePaneTab extends SidePaneTabBase {
  type: 'bash-output'
  runId: string
}

export interface SubagentSessionSidePaneTab extends SidePaneTabBase {
  type: 'subagent-session'
  taskId: string
}

export interface SubagentDirectorySidePaneTab extends SidePaneTabBase {
  type: 'subagent-directory'
  taskId: string
}

export interface SelectionSideChatTab extends SidePaneTabBase {
  type: 'selection-side-chat'
  conversationId?: string | null
  selection?: { text: string; filePath?: string | null } | null
}

export interface PlanDetailSidePaneTab extends SidePaneTabBase {
  type: 'plan-detail'
  planId: string
}

export interface WorkflowRunSidePaneTab extends SidePaneTabBase {
  type: 'workflow-run'
  workflowRunId: string
}

export interface WorkflowDirectorySidePaneTab extends SidePaneTabBase {
  type: 'workflow-directory'
  workflowRunId: string
}

export interface WorkflowActorSessionSidePaneTab extends SidePaneTabBase {
  type: 'workflow-actor-session'
  workflowRunId: string
  actorId: string
}

export interface WorkflowWorkspaceSidePaneTab extends SidePaneTabBase {
  type: 'workflow-workspace'
  workflowRunId: string
}

export interface WorkflowArtifactSidePaneTab extends SidePaneTabBase {
  type: 'workflow-artifact'
  workflowRunId: string
  artifactId: string
}

export type SidePaneTab =
  | BrowserSidePaneTab
  | GitSidePaneTab
  | CodeViewerSidePaneTab
  | TreemappingSidePaneTab
  | WhiteboardSidePaneTab
  | ModelTrajectorySidePaneTab
  | DeveloperToolsSidePaneTab
  | TerminalSidePaneTab
  | BrowserUseSidePaneTab
  | BashOutputSidePaneTab
  | SubagentSessionSidePaneTab
  | SubagentDirectorySidePaneTab
  | SelectionSideChatTab
  | PlanDetailSidePaneTab
  | WorkflowRunSidePaneTab
  | WorkflowDirectorySidePaneTab
  | WorkflowActorSessionSidePaneTab
  | WorkflowWorkspaceSidePaneTab
  | WorkflowArtifactSidePaneTab

export interface SidePaneState {
  tabs: SidePaneTab[]
  activeTabId: string | null
}

/**
 * ZCode caps recently-closed at 8 (`useAppPanels.ts:105,1332-1348`).
 */
export const RECENT_CLOSED_SIDE_PANE_TAB_LIMIT = 8

/**
 * ZCode's minimum tab width and gap, which drive the overflow scroll and the
 * edge fade masks on the tab strip (`app-shell/sidePaneLayout.ts:8-29`).
 */
export const SIDE_PANE_TAB_MIN_WIDTH_PX = 60
export const SIDE_PANE_TAB_GAP = 4

/**
 * Tabs whose content is owned by something transient. ZCode excludes these
 * from restore (`useAppPanels.ts:1334`): a PTY session, an agent-driven page
 * or a selection cannot be meaningfully reopened against a dead handle.
 */
export const NON_RESTORABLE_TAB_TYPES: readonly SidePaneTabType[] = [
  'bash-output',
  'browser-use',
  'selection-side-chat',
]

/**
 * Whether Orin Code can render this tab type yet.
 *
 * `false` means the type is modelled but its surface has not been ported. The
 * shell shows an explicit unavailable state rather than silently dropping the
 * tab, so the gap is visible instead of looking like a broken app.
 */
const AVAILABLE: Readonly<Record<SidePaneTabType, boolean>> = {
  browser: true,
  git: true,
  'code-viewer': true,
  terminal: true,
  'bash-output': true,
  'subagent-session': true,
  treemapping: false,
  whiteboard: false,
  'model-trajectory': false,
  'developer-tools': false,
  'browser-use': false,
  'subagent-directory': false,
  'selection-side-chat': false,
  'plan-detail': false,
  'workflow-run': false,
  'workflow-directory': false,
  'workflow-actor-session': false,
  'workflow-workspace': false,
  'workflow-artifact': false,
}

export function isTabTypeAvailable(type: SidePaneTabType): boolean {
  return AVAILABLE[type]
}

/** Tab types that can currently be opened, in the order ZCode's add menu lists. */
export const AVAILABLE_TAB_TYPES: readonly SidePaneTabType[] = (
  Object.keys(AVAILABLE) as SidePaneTabType[]
).filter((type) => AVAILABLE[type])

export function isRestorableTab(tab: SidePaneTab): boolean {
  return !NON_RESTORABLE_TAB_TYPES.includes(tab.type)
}

/** Human label for a tab. ZCode resolves these through i18n; these are the ids. */
export function sidePaneTabLabel(tab: SidePaneTab): string {
  switch (tab.type) {
    case 'browser':
      return tab.title || tab.initialUrl || 'Browser'
    case 'git':
      return 'Git'
    case 'code-viewer':
      return tab.source.path.split('/').pop() || 'Code'
    case 'terminal':
      return 'Terminal'
    case 'bash-output':
      return 'Output'
    case 'subagent-session':
      return 'Sub-agent'
    default:
      return tab.type
  }
}

/**
 * A stable identity for "the same tab again", per type.
 *
 * ZCode's rule: singleton tabs (`git`) reuse the one tab; keyed tabs (`browser`
 * by URL, `code-viewer` by source) reuse when the key matches; unkeyed tabs
 * always append. Getting this wrong is how a pane ends up with nine identical
 * Git tabs.
 */
export function tabDedupeKey(tab: SidePaneTab): string | null {
  switch (tab.type) {
    case 'git':
      return 'git'
    case 'browser':
      return `browser:${tab.initialUrl ?? ''}`
    case 'code-viewer':
      return `code-viewer:${tab.sourceKey ?? tab.source.path}`
    case 'terminal':
      return `terminal:${tab.sessionId}`
    case 'bash-output':
      return `bash-output:${tab.runId}`
    case 'subagent-session':
      return `subagent-session:${tab.taskId}`
    default:
      return null
  }
}

/**
 * Opening behaviour, mirroring ZCode's open functions: activate the existing
 * tab when the key matches, otherwise append and activate the new one.
 */
export function openTab(state: SidePaneState, tab: SidePaneTab): SidePaneState {
  const key = tabDedupeKey(tab)
  if (key !== null) {
    const existing = state.tabs.find((candidate) => tabDedupeKey(candidate) === key)
    if (existing) return { tabs: state.tabs, activeTabId: existing.id }
  }
  return { tabs: [...state.tabs, tab], activeTabId: tab.id }
}

/** Toggle semantics, for tabs whose command is a toggle (`toggleGitSidePane`). */
export function toggleTab(state: SidePaneState, tab: SidePaneTab): SidePaneState {
  const key = tabDedupeKey(tab)
  if (key !== null) {
    const index = state.tabs.findIndex((candidate) => tabDedupeKey(candidate) === key)
    if (index >= 0) {
      // Closing the active tab activates its neighbour, as ZCode does
      // (`tabStore.ts:356-366`).
      const tabs = state.tabs.filter((candidate) => candidate.id !== tab.id)
      const activeTabId =
        state.activeTabId === tab.id ? (tabs[Math.min(index, tabs.length - 1)]?.id ?? null) : state.activeTabId
      return { tabs, activeTabId }
    }
  }
  return openTab(state, tab)
}

export function closeTab(state: SidePaneState, id: string): SidePaneState {
  const index = state.tabs.findIndex((tab) => tab.id === id)
  if (index < 0) return state
  const tabs = state.tabs.filter((tab) => tab.id !== id)
  const activeTabId = state.activeTabId === id ? (tabs[Math.min(index, tabs.length - 1)]?.id ?? null) : state.activeTabId
  return { tabs, activeTabId }
}

export function closeOthers(state: SidePaneState, id: string): SidePaneState {
  const target = state.tabs.find((tab) => tab.id === id)
  return target ? { tabs: [target], activeTabId: target.id } : state
}

export function closeAll(): SidePaneState {
  return { tabs: [], activeTabId: null }
}

/** dnd-kit reordering, ported from the tab strip's SortableContext. */
export function reorderTabs(state: SidePaneState, from: number, to: number): SidePaneState {
  if (from === to || from < 0 || to < 0 || from >= state.tabs.length || to >= state.tabs.length) return state
  const tabs = [...state.tabs]
  const [moved] = tabs.splice(from, 1)
  tabs.splice(to, 0, moved)
  return { tabs, activeTabId: state.activeTabId }
}

/**
 * The shell persists a tab's owner and workspace so a reopened pane does not
 * leak a tab from one conversation into another.
 */
export function tabOwnerKey(ownerTaskId: string | null | undefined, workspaceKey: string | null | undefined): string {
  return `${workspaceKey ?? ''}::${ownerTaskId ?? ''}`
}