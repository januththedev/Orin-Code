// Mirror of docs/BRIDGE.md shared types.

export type Role = 'user' | 'assistant' | 'system'

export type MessagePart =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: 'image/png' | 'image/jpeg'; base64: string }

export interface AiMessage {
  role: Role
  parts: MessagePart[]
}

export interface AssistantResult {
  text: string
  stopReason: 'end' | 'tool' | 'aborted' | 'error'
}

export interface ModelInfo {
  id: string
  provider: string
  label: string
  tier: 'fast' | 'balanced' | 'reasoning' | 'max'
  speed: number
  intelligence: number
  contextTokens: number
}

export interface AiSendRequest {
  requestId: string
  modelId: string
  system?: string
  messages: AiMessage[]
  maxTokens?: number
}

export interface FileNode {
  name: string
  path: string
  type: 'file' | 'folder'
  size?: number
  children?: FileNode[]
}

export interface SearchHit {
  path: string
  line: number
  text: string
}

export interface FolderPick {
  name: string
  path: string
}

export interface ToolDef {
  name: string
  description: string
  inputSchema: object
}

export interface AgentTask {
  modelId: string
  mode: 'chat' | 'cowork' | 'agent' | 'plan'
  instructions: string
  history: AiMessage[]
  workspaceRoot?: string
  projectInstructions?: string
  phoneTaskId?: string
  phoneGrant?: string
}

export type AgentEvent =
  | { kind: 'plan'; steps: string[] }
  | { kind: 'step'; index: number; status: 'running' | 'done'; label: string }
  | { kind: 'status'; label: string }
  | { kind: 'tool-start'; toolCallId: string; tool: string; input: unknown }
  | { kind: 'tool-end'; toolCallId: string; ok: boolean; summary: string }
  | { kind: 'assistant-message'; text: string }
  | {
      kind: 'diff'
      path: string
      change: 'added' | 'modified'
      diffUnified: string
      changeSummary: string
      approvalId?: string
    }
  | {
      kind: 'approval-request'
      approvalId: string
      tool: string
      title: string
      detail: string
      destructive: boolean
      /** Pre-approved (phone-confirmed task) — shown as resolved, no buttons. */
      auto?: boolean
    }
  | { kind: 'done'; summary: string }
  | { kind: 'error'; error: string }

export interface CuTask {
  modelId: string
  instruction: string
  provider: 'virtual' | 'windows'
  maxActions: number
}

export type CuAction =
  | { type: 'click'; x: number; y: number; button: 'left' | 'right' | 'double' }
  | { type: 'move'; x: number; y: number }
  | { type: 'type'; text: string }
  | { type: 'key'; key: string }
  | { type: 'scroll'; x: number; y: number; amount: number }
  | { type: 'drag'; fromX: number; fromY: number; toX: number; toY: number }
  | { type: 'wait'; ms: number }
  | { type: 'open_app'; name: string }
  | { type: 'focus_window'; title: string }

export type NotifyLevel = 'info' | 'success' | 'warn' | 'error'

// Event payload shapes (core → renderer)
export type EventPayloads = {
  'ai-chunk': { requestId: string; delta: string }
  'ai-done': { requestId: string; message: AssistantResult }
  'ai-error': { requestId: string; error: string }
  'term-data': { terminalId: string; data: string }
  'term-exit': { terminalId: string; exitCode: number }
  'agent-event': { runId: string; event: AgentEvent }
  'cu-status': { sessionId: string; phase: string; detail: string }
  'cu-frame': { sessionId: string; jpegBase64: string; width: number; height: number }
  'cu-action': { sessionId: string; action: CuAction; result: string }
  'cu-permission': { sessionId: string; promptId: string; title: string; detail: string; destructive: boolean }
  'cu-done': { sessionId: string; summary: string }
  'cu-error': { sessionId: string; error: string }
  'update-progress': UpdateState
  'models-refreshed': RefreshReport
  notify: { level: NotifyLevel; title: string; body?: string }
}

// ---------------------------------------------------------------------------
// Account (orinai.org sign-in)
// ---------------------------------------------------------------------------

export interface AuthSession {
  uid: string
  name: string
  email: string
  phone: string
  authKind: 'core' | 'device' | 'password'
}

export interface AuthStatus {
  signedIn: boolean
  session: AuthSession | null
}

// Device-flow sign-in handoff (browser approves on orinai.org)
export interface AuthDeviceStart {
  deviceCode: string
  userCode: string
  verifyUrl: string
  expiresInSecs: number
}


// Provider preset from providers_list (Settings models page, welcome BYOK gate)
export interface ProviderInfo {
  id: string
  label: string
  baseUrl: string
  keyRequired: boolean
  docsUrl: string
  hasKey: boolean
}

// MCP server from mcp_servers (Settings → Connections)
export interface McpServer {
  id: string
  name: string
  url: string
  hasKey: boolean
}

/** Session lifecycle hooks (ported from ZCode's hook model, Apache-2.0).
 *  A hook may deny a tool or add context. It may never approve one — that would
 *  defeat the run-bound approvals the agent depends on. */
export type HookEvent =
  | 'sessionStart'
  | 'userPromptSubmit'
  | 'preToolUse'
  | 'permissionRequest'
  | 'postToolUse'
  | 'postToolUseFailure'
  | 'stop'

export interface Hook {
  event: HookEvent
  name: string
  matcher?: string
  deny?: string
  context?: string
}

export interface HookProblem {
  level: string
  message: string
}

export interface HookStatus {
  present: boolean
  trusted: boolean
  digest: string | null
  hooks: Hook[]
  problems: HookProblem[]
}

/** In-app update state. Mirrors bridge::update::UpdateState. */
export type UpdatePhase = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error'

export interface UpdateState {
  phase: UpdatePhase
  version: string | null
  notes: string | null
  progress: number
  error: string | null
}

export interface ProviderCatalog {
  models: string[]
  fetchedAtMs: number
  lastError: string | null
  ready: boolean
}

export interface NewModel {
  provider: string
  modelId: string
}

export interface RefreshReport {
  catalogs: Record<string, ProviderCatalog>
  appeared: NewModel[]
  disappeared: string[]
  allFailed: boolean
}

/** One memory file on disk. The UI owns parsing the frontmatter. */
export interface MemoryFile {
  name: string
  content: string
  updatedAtMs: number
}

/** A background task or delegated sub-agent. See bridge::queue. */
export type TaskState =
  | 'queued'
  | 'running'
  | 'awaitingApproval'
  | 'done'
  | 'failed'
  | 'cancelled'

export interface BackgroundTask {
  id: string
  title: string
  instructions: string
  state: TaskState
  delegated: boolean
  parentId: string | null
  createdAtMs: number
  startedAtMs: number | null
  finishedAtMs: number | null
  error: string | null
}

/** A public page fetched for the agent, reduced to text. */
export interface PageText {
  url: string
  finalUrl: string
  status: number
  contentType: string
  text: string
  truncated: boolean
}

/** ZCode's sub-agent configuration
 * (`packages/shared/src/subagents-types.ts:93-108`), field for field. */
export interface ReasoningOption {
  reasoningLevel?: string
}

export interface ModelSelection {
  providerId?: string
  modelId?: string
  options?: ReasoningOption
}

export interface SubAgentConfig {
  name: string
  description: string
  systemPrompt: string
  color?: string
  modelSelection?: ModelSelection
  tools: string[]
  disallowedTools: string[]
  injectAgentsMd: boolean
  skills: string[]
  permissionMode?: string
  maxTurns?: number
  background: boolean
  mcpServers: string[]
}

/** Fields the runtime acts on today, and those it stores but does not yet use.
 * Reported rather than hidden, so a setting cannot imply a capability that is
 * not there. */
export const SUBAGENT_WIRED_FIELDS = ['name', 'systemPrompt', 'modelSelection.modelId', 'background', 'color'] as const
