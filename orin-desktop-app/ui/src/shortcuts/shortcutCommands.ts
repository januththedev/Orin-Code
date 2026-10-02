/**
 * The shortcut command table — the single source of truth for keyboard
 * bindings, ported from ZCode's `packages/shared/src/shortcutCommands.ts`.
 *
 * Pure data and pure functions only: no DOM, no Tauri, so the settings screen,
 * the dispatcher and the tests all read the same thing. Keeping key knowledge
 * here is deliberate — ZCode's design note is that consumers "must not parse
 * keys themselves", and that rule survives the port.
 *
 * The binding strings are an Electron-accelerator-compatible subset, which is
 * what lets the same string persist to storage, match a KeyboardEvent, and
 * display. `CmdOrCtrl` means Cmd on Apple and Ctrl elsewhere.
 */

export type ShortcutChannel = 'window' | 'menu'

/**
 * `global` commands are dispatched by the window keydown handler.
 * `composer` commands are consumed by the chat input only when it has focus,
 * which is what makes it safe for `Enter` to be in this table at all.
 */
export type ShortcutScope = 'global' | 'composer'

export type ShortcutCommandId =
  | 'toggleInterfaceMode'
  | 'openOnboarding'
  | 'openCommandCenter'
  | 'openSettings'
  | 'findInTask'
  | 'toggleSidebar'
  | 'switchTheme'
  | 'toggleTerminal'
  | 'toggleSidePane'
  | 'previousConversation'
  | 'nextConversation'
  | 'navigateBack'
  | 'navigateForward'
  | 'openModelMenu'
  | 'cycleSessionMode'
  | 'cycleThoughtLevel'
  | 'newTask'
  | 'openWorkspace'
  | 'closeActiveContext'
  | 'zoomIn'
  | 'zoomOut'
  | 'resetZoom'
  | 'composerSend'
  | 'composerInsertNewline'

export interface ShortcutCommandEntry {
  readonly id: ShortcutCommandId
  readonly channel: ShortcutChannel
  readonly scope?: ShortcutScope
  /** Sparse overrides replace a whole group, so a command can have two defaults. */
  readonly defaultBindings: readonly string[]
  /** Human label, resolved at render time. Ported from ZCode's i18n ids. */
  readonly label: string
  /**
   * True once Orin Code has somewhere to send this command. ZCode lists 24
   * commands; showing one Orin cannot yet perform would be a dead row, so
   * unimplemented ones are marked and their rows disabled.
   */
  readonly implemented: boolean
}

/**
 * Note that `navigateBack`/`navigateForward` are history navigation, while
 * `previousConversation`/`nextConversation` are previous/next task. ZCode's own
 * table calls this out because an early prototype conflated them; the
 * distinction is preserved here.
 */
export const SHORTCUT_COMMANDS: readonly ShortcutCommandEntry[] = [
  { id: 'openCommandCenter', channel: 'window', defaultBindings: ['CmdOrCtrl+k', 'CmdOrCtrl+Shift+p'], label: 'Open Command Center', implemented: true },
  // Settings, matching the platform convention (macOS and VS Code both use ⌘,).
  { id: 'openSettings', channel: 'window', defaultBindings: ['CmdOrCtrl+,'], label: 'Open Settings', implemented: true },
  { id: 'findInTask', channel: 'window', defaultBindings: ['CmdOrCtrl+f'], label: 'Find in Task', implemented: false },
  { id: 'toggleSidebar', channel: 'window', defaultBindings: ['CmdOrCtrl+b'], label: 'Toggle Sidebar', implemented: true },
  { id: 'switchTheme', channel: 'window', defaultBindings: ['CmdOrCtrl+Shift+l'], label: 'Toggle Light/Dark Theme', implemented: true },
  { id: 'toggleTerminal', channel: 'window', defaultBindings: ['CmdOrCtrl+j'], label: 'Toggle Terminal', implemented: false },
  { id: 'toggleSidePane', channel: 'window', defaultBindings: ['CmdOrCtrl+Alt+b'], label: 'Toggle Side Pane', implemented: false },
  { id: 'previousConversation', channel: 'window', defaultBindings: ['CmdOrCtrl+Shift+['], label: 'Previous Task', implemented: false },
  { id: 'nextConversation', channel: 'window', defaultBindings: ['CmdOrCtrl+Shift+]'], label: 'Next Task', implemented: false },
  { id: 'navigateBack', channel: 'window', defaultBindings: ['CmdOrCtrl+['], label: 'Navigate Back', implemented: false },
  { id: 'navigateForward', channel: 'window', defaultBindings: ['CmdOrCtrl+]'], label: 'Navigate Forward', implemented: false },
  // Explicit Ctrl, on macOS too — these were fixed keys in ZCode's composer
  // toolbar before they were promoted into this table, and keeping them
  // explicit preserves the old matching semantics exactly.
  { id: 'openModelMenu', channel: 'window', defaultBindings: ['Ctrl+m'], label: 'Open Model Menu', implemented: true },
  { id: 'cycleSessionMode', channel: 'window', defaultBindings: ['Ctrl+Shift+m'], label: 'Cycle Session Mode', implemented: true },
  { id: 'cycleThoughtLevel', channel: 'window', defaultBindings: ['Ctrl+t'], label: 'Cycle Thought Level', implemented: false },
  { id: 'newTask', channel: 'menu', defaultBindings: ['CmdOrCtrl+n'], label: 'New Task', implemented: true },
  { id: 'openWorkspace', channel: 'menu', defaultBindings: ['CmdOrCtrl+o'], label: 'Open Workspace', implemented: false },
  { id: 'closeActiveContext', channel: 'menu', defaultBindings: ['CmdOrCtrl+w'], label: 'Close Current Context', implemented: false },
  { id: 'zoomIn', channel: 'menu', defaultBindings: ['CmdOrCtrl+='], label: 'Zoom In', implemented: false },
  { id: 'zoomOut', channel: 'menu', defaultBindings: ['CmdOrCtrl+-'], label: 'Zoom Out', implemented: false },
  { id: 'resetZoom', channel: 'menu', defaultBindings: ['CmdOrCtrl+0'], label: 'Reset Zoom', implemented: false },
  // composer scope: consumed by the chat input alone, never by the global
  // dispatcher. `channel` is a placeholder here; dispatch keys off `scope`.
  { id: 'composerSend', channel: 'window', scope: 'composer', defaultBindings: ['Enter'], label: 'Send Message', implemented: true },
  { id: 'composerInsertNewline', channel: 'window', scope: 'composer', defaultBindings: ['Shift+Enter'], label: 'Insert Newline in Composer', implemented: true },
  { id: 'toggleInterfaceMode', channel: 'window', defaultBindings: ['CmdOrCtrl+Shift+u'], label: 'Toggle Coding/Office Mode', implemented: false },
  { id: 'openOnboarding', channel: 'window', defaultBindings: ['CmdOrCtrl+Shift+o'], label: 'Toggle Onboarding', implemented: false },
]

export function getShortcutEntry(id: string): ShortcutCommandEntry | undefined {
  return SHORTCUT_COMMANDS.find((entry) => entry.id === id)
}

export function getDefaultShortcutBindings(id: string): readonly string[] {
  return getShortcutEntry(id)?.defaultBindings ?? []
}

/**
 * Commands the settings screen lists. ZCode hides `openOnboarding` and
 * `toggleInterfaceMode` (`ShortcutSettingsSection.tsx:60`) because they are
 * onboarding affordances rather than user configuration.
 */
export const HIDDEN_SHORTCUT_COMMANDS: readonly ShortcutCommandId[] = ['openOnboarding', 'toggleInterfaceMode']

export interface ParsedShortcutBinding {
  cmdOrCtrl: boolean
  ctrl: boolean
  alt: boolean
  altGr: boolean
  shift: boolean
  key: string
}

const MODIFIER_ALIASES: Record<string, keyof Omit<ParsedShortcutBinding, 'key'>> = {
  cmdorctrl: 'cmdOrCtrl',
  commandorcontrol: 'cmdOrCtrl',
  cmd: 'cmdOrCtrl',
  command: 'cmdOrCtrl',
  meta: 'cmdOrCtrl',
  super: 'cmdOrCtrl',
  ctrl: 'ctrl',
  control: 'ctrl',
  alt: 'alt',
  option: 'alt',
  altgr: 'altGr',
  shift: 'shift',
}

/**
 * Parse a binding string. Returns null for anything unrecognised rather than
 * guessing, because a mis-parsed binding silently fires on the wrong chord.
 */
export function parseShortcutBinding(binding: string): ParsedShortcutBinding | null {
  const raw = binding.trim()
  if (!raw) return null
  const parsed: ParsedShortcutBinding = {
    cmdOrCtrl: false,
    ctrl: false,
    alt: false,
    altGr: false,
    shift: false,
    key: '',
  }
  const parts = raw.split('+').map((part) => part.trim()).filter(Boolean)
  for (const part of parts.slice(0, -1)) {
    const modifier = MODIFIER_ALIASES[part.toLowerCase()]
    if (!modifier) return null
    parsed[modifier] = true
  }
  const key = parts.at(-1)
  if (!key) return null
  parsed.key = key === '+' ? '+' : key.length === 1 ? key.toLowerCase() : key.toLowerCase()
  // A bare key with no modifier is only meaningful for scope-bound commands.
  return parsed
}

export interface ShortcutBindingEvent {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
  /**
   * `KeyboardEvent.code`, used as a fallback when `key` has been rewritten --
   * macOS Option composes characters, and a non-US layout makes `key`
   * unreliable for physical positions.
   */
  code?: string
}

/**
 * Modifier policy, ported from ZCode's `bindings.ts:132-167`.
 *
 * The subtlety worth keeping: on Apple, `CmdOrCtrl` and an explicit `Ctrl` are
 * *different* keys (⌘ versus the Emacs editing keys), whereas off Apple they
 * collapse to the same physical bit. Modifiers must match exactly — an extra
 * held modifier is a different chord, not a looser match.
 */
export function modifiersMatch(event: ShortcutBindingEvent, parsed: ParsedShortcutBinding, isApple: boolean): boolean {
  const { metaKey: meta, ctrlKey: ctrl, altKey: alt, shiftKey: shift } = event
  // AltGr is physically indistinguishable from Ctrl+Alt, so an AltGr binding
  // matches the same physical combination rather than claiming exclusivity.
  const wantPrimaryOrCtrl = parsed.altGr || parsed.cmdOrCtrl || (!isApple && parsed.ctrl)
  const wantCtrl = !parsed.altGr && !parsed.cmdOrCtrl && parsed.ctrl && isApple
  const wantAlt = parsed.altGr || parsed.alt

  // A bare binding (Enter, arrows) must require the primary modifier to be up,
  // or Cmd+Enter would also fire the bare `Enter` binding. That gap is latent
  // until a bare key enters the table — which `composerSend` does.
  if (!wantPrimaryOrCtrl && !wantCtrl && (meta || ctrl)) return false

  if (wantPrimaryOrCtrl) {
    const ok = isApple ? meta && !ctrl : ctrl && !meta
    if (!ok) return false
  }
  if (wantCtrl && (!ctrl || meta)) return false
  if (wantAlt !== alt) return false
  return parsed.shift === shift
}

/** `event.key` is compared lowercase first, with `event.code` as the fallback. */
export function eventMatchesKey(event: ShortcutBindingEvent, parsed: ParsedShortcutBinding): boolean {
  if (event.key.toLowerCase() === parsed.key) return true
  const code = event.code
  if (!code) return false
  return code.toLowerCase() === parsed.key || code.toLowerCase() === `key${parsed.key}`
}

/**
 * True for a bare `Shift+<printable>` binding. Such a binding is the same
 * physical event as typing a capital letter, so it must not fire while an
 * editable element has focus — otherwise the user cannot type an uppercase
 * letter at all, because the key gets preventDefault'd and the command runs.
 */
export function isShiftOnlyPrintableBinding(binding: string): boolean {
  const parsed = parseShortcutBinding(binding)
  if (!parsed) return false
  return !parsed.cmdOrCtrl && !parsed.ctrl && !parsed.alt && !parsed.altGr && parsed.shift && parsed.key.length === 1
}

/** Pairs with `isShiftOnlyPrintableBinding`. False in a non-DOM environment. */
export function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

export function isAppleKeyboardPlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || '')
}

/** Does this event match `binding`? */
export function matchesShortcutBinding(event: ShortcutBindingEvent, binding: string): boolean {
  const parsed = parseShortcutBinding(binding)
  if (!parsed) return false
  if (!modifiersMatch(event, parsed, isAppleKeyboardPlatform())) return false
  return eventMatchesKey(event, parsed)
}

/**
 * Chords that must never be taken. Ported from ZCode's `conflicts.ts:22-44`:
 * the platform clipboard/undo/select-all set, function keys, bare arrows and
 * bare Enter. Without this, rebinding to something like Cmd+C would break
 * copying everywhere in the app.
 */
export const RESERVED_BINDINGS: readonly string[] = [
  'CmdOrCtrl+c', 'CmdOrCtrl+v', 'CmdOrCtrl+x', 'CmdOrCtrl+z', 'CmdOrCtrl+a', 'CmdOrCtrl+y',
  'CmdOrCtrl+s', 'CmdOrCtrl+p', 'CmdOrCtrl+l',
  'CmdOrCtrl+Shift+z', 'CmdOrCtrl+Shift+r', 'CmdOrCtrl+Shift+i', 'CmdOrCtrl+Shift+j', 'CmdOrCtrl+Shift+c',
  ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`),
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter',
]

/** `⌘M` belongs to the macOS minimise role and cannot be taken from the renderer. */
export const PLATFORM_RESERVED_BINDINGS: readonly string[] = ['CmdOrCtrl+m']

/**
 * Do two binding strings denote the same physical chord?
 *
 * Off Apple, `CmdOrCtrl` and an explicit `Ctrl` are the same key, so
 * `Ctrl+c` and `CmdOrCtrl+c` collide. On Apple they are different keys -- Cmd
 * versus the reserved Emacs editing chord -- and must not be treated as equal.
 * Ported from ZCode's `conflicts.ts:63-78`, which canonicalises for the same
 * reason.
 */
export function isSamePhysicalBinding(a: string, b: string): boolean {
  const norm = (value: string) => value.toLowerCase().replace(/\s+/g, '')
  if (norm(a) === norm(b)) return true
  if (isAppleKeyboardPlatform()) return false
  const primary = (value: string) => {
    const v = norm(value)
    return v.includes('cmdorctrl') || v.includes('ctrl')
  }
  const rest = (value: string) => norm(value).replace('cmdorctrl', '').replace('ctrl', '')
  return primary(a) && primary(b) && rest(a) === rest(b)
}

export type ConflictKind = 'reserved' | 'platform-reserved' | 'duplicate' | 'scope'

export interface BindingConflict {
  kind: ConflictKind
  binding: string
  /** The other command holding the chord, when `kind` is `duplicate`. */
  against?: ShortcutCommandId
}

/**
 * Would taking `binding` for `commandId` break something?
 *
 * `existing` is the effective map (defaults plus overrides), so this is the
 * only place that knows the whole picture.
 */
export function findBindingConflict(
  binding: string,
  commandId: ShortcutCommandId,
  existing: Readonly<Record<string, readonly string[]>>,
): BindingConflict | null {
  // Physical equivalence, not string equality: without it `Ctrl+c` slips past
  // the reserved `CmdOrCtrl+c` on Windows, and the app would lose copy.
  if (RESERVED_BINDINGS.some((r) => isSamePhysicalBinding(binding, r))) {
    return { kind: 'reserved', binding }
  }
  if (PLATFORM_RESERVED_BINDINGS.some((r) => isSamePhysicalBinding(binding, r))) {
    return { kind: 'platform-reserved', binding }
  }
  for (const entry of SHORTCUT_COMMANDS) {
    if (entry.id === commandId) continue
    const others = existing[entry.id] ?? getDefaultShortcutBindings(entry.id)
    // A composer binding and a global one never collide: the composer only sees
    // the event while it has focus, and the global dispatcher skips composer
    // scope entirely.
    const entryScope = entry.scope ?? 'global'
    const ownScope = getShortcutEntry(commandId)?.scope ?? 'global'
    if (entryScope !== ownScope) continue
    if (others.some((b) => isSamePhysicalBinding(b, binding))) {
      return { kind: 'duplicate', binding, against: entry.id }
    }
  }
  return null
}

/** Render a binding for display: `CmdOrCtrl+k` reads as `⌘K` on Apple, `Ctrl+K` elsewhere. */
export function formatShortcut(binding: string, apple = isAppleKeyboardPlatform()): string {
  const isMac = apple
  return binding
    .split('+')
    .map((part) => {
      const key = part.trim().toLowerCase()
      if (key === 'cmdorctrl' || key === 'cmd' || key === 'command' || key === 'meta' || key === 'super') {
        return isMac ? '⌘' : 'Ctrl'
      }
      if (key === 'ctrl' || key === 'control') return isMac ? '⌃' : 'Ctrl'
      if (key === 'alt' || key === 'option') return isMac ? '⌥' : 'Alt'
      if (key === 'shift') return isMac ? '⇧' : 'Shift'
      if (key === 'arrowup') return '↑'
      if (key === 'arrowdown') return '↓'
      if (key === 'arrowleft') return '←'
      if (key === 'arrowright') return '→'
      if (key === 'enter') return isMac ? '↩' : 'Enter'
      if (key === 'escape') return 'Esc'
      if (key === ' ') return 'Space'
      return part.length === 1 ? part.toUpperCase() : part
    })
    .join(isMac ? '' : '+')
}

/** Serialise a KeyboardEvent as a binding string, for the recorder. */
export function eventToBinding(event: ShortcutBindingEvent): string | null {
  const key = event.key
  if (!key || ['Control', 'Meta', 'Alt', 'Shift'].includes(key)) return null
  const parts: string[] = []
  if (event.metaKey) parts.push('Cmd')
  if (event.ctrlKey) parts.push('Ctrl')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  const isSingle = key.length === 1
  // A bare letter would read as "Ctrl+A" style by accident, so letter keys
  // always go through CmdOrCtrl unless another modifier is already present.
  if (isSingle && !event.metaKey && !event.ctrlKey && !event.altKey) parts.push('CmdOrCtrl')
  parts.push(isSingle ? key.toLowerCase() : key)
  return parts.join('+')
}