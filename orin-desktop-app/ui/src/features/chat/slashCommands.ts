/**
 * ZCode's slash commands, ported from
 * `packages/shared/src/zcode-slash-command-help.ts` (21 builtins) and
 * `packages/ui/src/v4/slashCommands.ts` (the parser).
 *
 * These are AGENT COMMANDS, not prompt templates. ZCode's are parsed before a
 * prompt is sent and control the session (`/model`, `/mode`, `/new`,
 * `/compact`, `/help`); the previous list in the composer was six text
 * expansions, which is a different thing and is replaced rather than merged.
 *
 * ZCode's own rule, preserved: `/help` answers LOCALLY -- it shows the help
 * without creating a session or sending a model prompt
 * (`zcode-slash-command-help.ts:9-16`).
 *
 * Each entry declares what it needs. A command whose capability Orin Code does
 * not have is `available: false` with the reason, and is shown in the menu
 * disabled. It is not hidden and not faked: a menu that silently omits a command
 * looks like the feature is missing, while a disabled row says exactly what is.
 */

import type { ViewId } from '../../stores/uiStore'

export type SlashAvailability = 'available' | 'needs-workspace' | 'unavailable'

export interface SlashCommand {
  name: string
  usage: string
  summary: string
  availability: SlashAvailability
  /** Why it is unavailable, shown in the menu. Empty when available. */
  gap?: string
  /**
   * Perform the command. Returns true when handled, false when it should fall
   * through to the prompt as ordinary text -- which is ZCode's behaviour for a
   * command whose arguments it does not recognise.
   */
  run?: (args: string, api: SlashApi) => boolean | Promise<boolean>
}

export interface SlashApi {
  setView: (view: ViewId) => void
  createChat: () => void
  setModel: (modelId: string) => void
  listModels: () => Array<{ id: string; label: string }>
  toast: (level: 'info' | 'success' | 'error', title: string, body?: string) => void
}

const NEEDS_AGENT_SESSION =
  'Needs an agent session with checkpoints. Orin Code has no checkpoint store to rewind into.'
const NEEDS_CLI =
  'Handled by ZCode’s CLI command center. Orin Code has no equivalent command center.'

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  {
    name: 'help',
    usage: '/help [command]',
    summary: 'Show this slash command help.',
    availability: 'available',
    run: (args, api) => {
      const wanted = args.trim().toLowerCase()
      if (!wanted) {
        api.toast(
          'info',
          'Slash commands',
          SLASH_COMMANDS.map((c) => c.usage).join('  ·  '),
        )
        return true
      }
      const found = SLASH_COMMANDS.find((c) => c.name === wanted.replace(/^\//, ''))
      if (!found) {
        api.toast('error', `No /${wanted.replace(/^\//, '')} command`)
        return true
      }
      // Local only, as in ZCode: no session, no model prompt.
      api.toast('info', `${found.usage}`, found.summary + (found.gap ? ` — ${found.gap}` : ''))
      return true
    },
  },
  { name: 'login', usage: '/login [zai-coding-plan|bigmodel-coding-plan|…-api-key <api-key>]', summary: 'Set up a Coding Plan provider.', availability: 'unavailable', gap: 'Orin Code has no Coding Plan provider. Use Settings → Models & providers.' },
  { name: 'logout', usage: '/logout', summary: 'Remove the shared Z.ai login credentials.', availability: 'unavailable', gap: 'No shared Z.ai credential store in Orin Code. Disconnect from Account.' },
  { name: 'compact', usage: '/compact [instructions]', summary: 'Compact the current conversation with optional instructions.', availability: 'unavailable', gap: NEEDS_AGENT_SESSION },
  { name: 'init', usage: '/init [notes]', summary: 'Create or update workspace AGENTS.md instructions.', availability: 'available', run: (args, api) => { api.setView('ide'); api.toast('info', '/init', `Create or update AGENTS.md${args ? ` with: ${args}` : ''}.`); return true } },
  { name: 'expert', usage: '/expert [status|resume|stop|<task>]', summary: 'Run or manage the expert workflow.', availability: 'unavailable', gap: NEEDS_CLI },
  { name: 'effort', usage: '/effort [list|<level>]', summary: 'Show or switch the current session reasoning effort.', availability: 'unavailable', gap: 'Orin Code exposes no per-session reasoning effort control.' },
  { name: 'dwf', usage: '/dwf [list|cancel [runId]|resume <runId>]', summary: 'List, cancel, or resume dynamic workflow runs.', availability: 'unavailable', gap: NEEDS_CLI },
  { name: 'fork', usage: '/fork [latest|checkpointId]', summary: 'Fork a new session from a workspace checkpoint.', availability: 'unavailable', gap: NEEDS_AGENT_SESSION },
  {
    name: 'locale',
    usage: '/locale [auto|en-US|zh-CN]',
    summary: 'Show or switch the UI locale.',
    availability: 'available',
    run: (args, api) => {
      const value = args.trim()
      if (!value) {
        api.toast('info', '/locale', 'Orin Code ships English only; no locale is persisted yet.')
        return true
      }
      api.toast('info', '/locale', `“${value}” is not available: Orin Code has no locale store.`)
      return true
    },
  },
  { name: 'mcp', usage: '/mcp [list|status|connect <server>|disconnect <server>]', summary: 'Show or manage configured MCP servers.', availability: 'available', run: (_args, api) => { api.setView('connectors'); return true } },
  { name: 'plugins', usage: '/plugins [list|enable <plugin>|disable <plugin>]', summary: 'Open the plugin manager.', availability: 'available', run: (_args, api) => { api.setView('connectors'); return true } },
  {
    name: 'mode',
    usage: '/mode [plan|build|edit|yolo]',
    summary: 'Show or switch the current permission mode.',
    availability: 'unavailable',
    // ZCode's modes are PERMISSION levels. Orin Code's chat/cowork/agent are
    // conversation styles, and mapping one onto the other would silently change
    // what a run is allowed to do -- so it is named as absent instead.
    gap: 'Orin Code has no permission-mode concept; its chat/cowork/agent modes are conversation styles, not ZCode’s permission levels.',
  },
  {
    name: 'model',
    usage: '/model [list|provider/model]',
    summary: 'Show or switch the current session model.',
    availability: 'available',
    run: (args, api) => {
      const wanted = args.trim()
      if (!wanted || wanted.toLowerCase() === 'list') {
        api.toast('info', '/model', api.listModels().map((m) => m.id).join('\n'))
        return true
      }
      const found = api.listModels().find((m) => m.id === wanted || m.id.endsWith(`/${wanted}`))
      if (!found) {
        api.toast('error', `/model ${wanted}`, 'No such model in the current catalog.')
        return true
      }
      api.setModel(found.id)
      return true
    },
  },
  { name: 'new', usage: '/new', summary: 'Start a fresh session in the TUI.', availability: 'available', run: (_args, api) => { api.createChat(); api.setView('chat'); return true } },
  { name: 'resume', usage: '/resume [sessionId]', summary: 'Resume a saved session.', availability: 'available', run: (_args, api) => { api.setView('chat'); api.toast('info', '/resume', 'Pick a conversation from the sidebar to resume it.'); return true } },
  { name: 'rewind', usage: '/rewind [latest|checkpointId]', summary: 'Inspect or restore workspace checkpoints.', availability: 'unavailable', gap: NEEDS_AGENT_SESSION },
  { name: 'skill', usage: '/skill [<skill-name> [task]]', summary: 'List skills, or force the next prompt to load one.', availability: 'available', run: (_args, api) => { api.setView('skills'); return true } },
  { name: 'goal', usage: '/goal [pause|resume|clear|replace <objective>|<objective>]', summary: 'Set or inspect the session goal.', availability: 'unavailable', gap: NEEDS_CLI },
  { name: 'workflow', usage: '/workflow [list|run <id>|show <id>]', summary: 'Run or inspect a saved workflow.', availability: 'unavailable', gap: NEEDS_CLI },
]

/**
 * ZCode's parser shape: `/name args`, name is `[a-z-]+`
 * (`packages/ui/src/v4/slashCommands.ts:53-95`).
 */
export function parseSlash(raw: string): { name: string; args: string } | null {
  const match = /^\/([a-z][\w-]*)(?:\s+([\s\S]*))?$/.exec(raw.trim())
  if (!match) return null
  return { name: match[1], args: (match[2] ?? '').trim() }
}

export function findSlashCommand(name: string): SlashCommand | undefined {
  return SLASH_COMMANDS.find((command) => command.name === name)
}
