/**
 * Search scope, matching and history, ported from ZCode's
 * `packages/ui/src/command-center/CommandCenterDialog.tsx` and
 * `commandCenterSearchHistory.ts`.
 *
 * The behaviours worth naming, because they are easy to "fix" into something
 * that is no longer ZCode:
 *
 *   - matching is token SUBSTRING with AND semantics. There is deliberately no
 *     fuzzy or subsequence matching, so "opn" does not find "open".
 *   - an empty query matches every command, but returns an empty FILE and
 *     TASK list -- a bare palette shows commands, not a directory dump.
 *   - history is per workspace key, capped at 20, de-duplicated
 *     case-insensitively, and a bare `>`, `#` or `@` is never recorded,
 *     because recording the prefix alone would fill the history with entries
 *     that search nothing.
 *   - result limits are per section (3) and per context list (3), while file
 *     and task lists allow 80.
 */

import type { QuickPickCommand, QuickPickCommandSectionId } from './quickPickCommands'
import { QUICK_PICK_SECTION_ORDER } from './quickPickCommands'

export type CommandCenterSearchScope = 'all' | 'commands' | 'conversations' | 'files'

export const COMMAND_CENTER_SECTION_LIMIT = 3
export const COMMAND_CENTER_CONTEXT_SECTION_LIMIT = 3
export const COMMAND_CENTER_FILE_RESULT_LIMIT = 80
export const COMMAND_CENTER_TASK_RESULT_LIMIT = 80

/**
 * `>` commands, `#` conversations, `@` files, nothing = all.
 * The prefix is stripped before matching, so `>term` searches the term.
 */
export function resolveQueryScope(rawQuery: string): { query: string; scope: CommandCenterSearchScope; explicitScope: boolean } {
  const trimmed = rawQuery.trimStart()
  const prefix = trimmed[0]
  if (prefix === '>') return { query: trimmed.slice(1).trimStart(), scope: 'commands', explicitScope: true }
  if (prefix === '#') return { query: trimmed.slice(1).trimStart(), scope: 'conversations', explicitScope: true }
  if (prefix === '@') return { query: trimmed.slice(1).trimStart(), scope: 'files', explicitScope: true }
  return { query: rawQuery.trim(), scope: 'all', explicitScope: false }
}

/**
 * Token-substring, AND. Deliberately not fuzzy: matching a subsequence would
 * make the palette find things the user did not type, which is a different
 * command surface than the one ZCode ships.
 */
export function matchesCommand(command: QuickPickCommand, query: string): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return true
  const searchText = `${command.title} ${command.keywords.join(' ')}`.toLocaleLowerCase()
  return normalizedQuery
    .split(/\s+/)
    .filter(Boolean)
    .every((part) => searchText.includes(part))
}

export interface FileEntry {
  name: string
  /** Workspace-relative path, POSIX separators. */
  relativePath: string
  type: 'file' | 'folder'
}

/**
 * File matching searches the name AND the relative path, because typing part of
 * a directory is how people look for a file. An empty query returns nothing.
 */
export function filterWorkspaceFileEntries(entries: readonly FileEntry[], query: string): FileEntry[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return []
  const parts = normalizedQuery.split(/\s+/).filter(Boolean)
  return entries
    .filter((entry) => entry.type === 'file')
    .filter((entry) => {
      const searchText = `${entry.name} ${entry.relativePath}`.toLocaleLowerCase()
      return parts.every((part) => searchText.includes(part))
    })
    .slice(0, COMMAND_CENTER_FILE_RESULT_LIMIT)
}

/** Group commands into ZCode's section order, dropping empty sections. */
export function groupCommandsBySection(
  commands: readonly QuickPickCommand[],
): Array<{ sectionId: QuickPickCommandSectionId; commands: QuickPickCommand[] }> {
  const grouped = new Map<QuickPickCommandSectionId, QuickPickCommand[]>()
  for (const command of commands) {
    const list = grouped.get(command.sectionId) ?? []
    list.push(command)
    grouped.set(command.sectionId, list)
  }
  return QUICK_PICK_SECTION_ORDER.filter((sectionId) => (grouped.get(sectionId)?.length ?? 0) > 0).map(
    (sectionId) => ({ sectionId, commands: grouped.get(sectionId) ?? [] }),
  )
}

// ------------------------------------------------------------------ history

export interface CommandCenterSearchHistoryEntry {
  query: string
  scope: CommandCenterSearchScope
  updatedAt: number
}

const COMMAND_CENTER_HISTORY_LIMIT = 20
const COMMAND_CENTER_HISTORY_KEY_PREFIX = 'orin-command-center-search-history:'

function storage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

const historyKey = (workspaceKey: string) => `${COMMAND_CENTER_HISTORY_KEY_PREFIX}${workspaceKey}`

function isHistoryEntry(value: unknown): value is CommandCenterSearchHistoryEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<CommandCenterSearchHistoryEntry>
  return (
    typeof entry.query === 'string' &&
    typeof entry.updatedAt === 'number' &&
    (entry.scope === 'all' || entry.scope === 'commands' || entry.scope === 'conversations' || entry.scope === 'files')
  )
}

export function readCommandCenterSearchHistory(workspaceKey: string): CommandCenterSearchHistoryEntry[] {
  const store = storage()
  if (!store) return []
  try {
    const parsed = JSON.parse(store.getItem(historyKey(workspaceKey)) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter(isHistoryEntry).slice(0, COMMAND_CENTER_HISTORY_LIMIT) : []
  } catch {
    return []
  }
}

function writeHistory(workspaceKey: string, entries: CommandCenterSearchHistoryEntry[]): void {
  const store = storage()
  if (!store) return
  try {
    store.setItem(historyKey(workspaceKey), JSON.stringify(entries.slice(0, COMMAND_CENTER_HISTORY_LIMIT)))
  } catch {
    // History is a shortcut. An unavailable localStorage must not break the
    // palette, so this is swallowed exactly as ZCode swallows it.
  }
}

/**
 * Records a query. A bare prefix is rejected: `>` alone would otherwise fill the
 * history with entries that match every command and nothing else.
 */
export function pushCommandCenterSearchHistory(params: {
  workspaceKey: string
  query: string
  scope: CommandCenterSearchScope
}): CommandCenterSearchHistoryEntry[] {
  const query = params.query.trim()
  if (!query || query === '>' || query === '#' || query === '@') {
    return readCommandCenterSearchHistory(params.workspaceKey)
  }
  const nextEntry: CommandCenterSearchHistoryEntry = { query, scope: params.scope, updatedAt: Date.now() }
  const dedupeKey = query.toLocaleLowerCase()
  const entries = [
    nextEntry,
    ...readCommandCenterSearchHistory(params.workspaceKey).filter((entry) => entry.query.toLocaleLowerCase() !== dedupeKey),
  ].slice(0, COMMAND_CENTER_HISTORY_LIMIT)
  writeHistory(params.workspaceKey, entries)
  return entries
}

export function clearCommandCenterSearchHistory(workspaceKey: string): void {
  writeHistory(workspaceKey, [])
}