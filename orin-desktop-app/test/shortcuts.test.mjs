import test from 'node:test'
import assert from 'node:assert/strict'

import {
  SHORTCUT_COMMANDS,
  getDefaultShortcutBindings,
  parseShortcutBinding,
  modifiersMatch,
  matchesShortcutBinding,
  isShiftOnlyPrintableBinding,
  findBindingConflict,
  formatShortcut,
  eventToBinding,
  RESERVED_BINDINGS,
  HIDDEN_SHORTCUT_COMMANDS,
} from '../ui/src/shortcuts/shortcutCommands.ts'

/**
 * The shortcut table is ported from ZCode's
 * packages/shared/src/shortcutCommands.ts and shortcuts/bindings.ts. The
 * modifier policy is the part worth testing: it is the difference between a
 * rebind working across platforms and silently firing on the wrong chord, and
 * none of it is visible in a screenshot.
 */

const ev = (over = {}) => ({
  key: 'k',
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...over,
})

test('the table ports ZCode\'s 24 commands with the same defaults', () => {
  assert.equal(SHORTCUT_COMMANDS.length, 24)
  const expected = {
    openCommandCenter: ['CmdOrCtrl+k', 'CmdOrCtrl+Shift+p'],
    openSettings: ['CmdOrCtrl+,'],
    findInTask: ['CmdOrCtrl+f'],
    toggleSidebar: ['CmdOrCtrl+b'],
    switchTheme: ['CmdOrCtrl+Shift+l'],
    toggleTerminal: ['CmdOrCtrl+j'],
    toggleSidePane: ['CmdOrCtrl+Alt+b'],
    previousConversation: ['CmdOrCtrl+Shift+['],
    nextConversation: ['CmdOrCtrl+Shift+]'],
    navigateBack: ['CmdOrCtrl+['],
    navigateForward: ['CmdOrCtrl+]'],
    openModelMenu: ['Ctrl+m'],
    cycleSessionMode: ['Ctrl+Shift+m'],
    cycleThoughtLevel: ['Ctrl+t'],
    newTask: ['CmdOrCtrl+n'],
    openWorkspace: ['CmdOrCtrl+o'],
    closeActiveContext: ['CmdOrCtrl+w'],
    zoomIn: ['CmdOrCtrl+='],
    zoomOut: ['CmdOrCtrl+-'],
    resetZoom: ['CmdOrCtrl+0'],
    composerSend: ['Enter'],
    composerInsertNewline: ['Shift+Enter'],
    toggleInterfaceMode: ['CmdOrCtrl+Shift+u'],
    openOnboarding: ['CmdOrCtrl+Shift+o'],
  }
  for (const [id, bindings] of Object.entries(expected)) {
    assert.deepEqual([...getDefaultShortcutBindings(id)], bindings, `${id} defaults`)
  }
})

test('every command has a label and ids are unique', () => {
  const ids = SHORTCUT_COMMANDS.map((c) => c.id)
  assert.equal(new Set(ids).size, ids.length, 'duplicate command id')
  for (const entry of SHORTCUT_COMMANDS) {
    assert.ok(entry.label && entry.label.length > 2, `${entry.id} needs a label`)
  }
  // ZCode hides these two from the settings screen.
  for (const hidden of HIDDEN_SHORTCUT_COMMANDS) {
    assert.ok(ids.includes(hidden), `${hidden} should still be in the table`)
  }
})

test('a binding string parses into modifiers and a key', () => {
  assert.deepEqual(parseShortcutBinding('CmdOrCtrl+Shift+p'), {
    cmdOrCtrl: true, ctrl: false, alt: false, altGr: false, shift: true, key: 'p',
  })
  assert.deepEqual(parseShortcutBinding('Shift+Enter'), {
    cmdOrCtrl: false, ctrl: false, alt: false, altGr: false, shift: true, key: 'enter',
  })
  assert.equal(parseShortcutBinding('CmdOrCtrl+,').key, ',')
  // Permissive about the final token on purpose, as ZCode is: a bad MODIFIER
  // is a typo worth rejecting, while an unrecognised key simply never matches.
  assert.equal(parseShortcutBinding('nonsense-key').key, 'nonsense-key')
  assert.equal(parseShortcutBinding('Nonsense+Also'), null, 'a bad modifier is rejected')
  assert.equal(parseShortcutBinding(''), null)
})

test('CmdOrCtrl is Cmd on Apple and Ctrl elsewhere, and explicit Ctrl differs on Apple', () => {
  const parsed = parseShortcutBinding('CmdOrCtrl+k')
  // Apple: meta only.
  assert.equal(modifiersMatch(ev({ metaKey: true }), parsed, true), true)
  assert.equal(modifiersMatch(ev({ ctrlKey: true }), parsed, true), false)
  // Elsewhere: ctrl only.
  assert.equal(modifiersMatch(ev({ ctrlKey: true }), parsed, false), true)
  assert.equal(modifiersMatch(ev({ metaKey: true }), parsed, false), false)

  // An explicit Ctrl is a DIFFERENT key on Apple -- the Emacs editing keys are
  // reserved there -- which is why openModelMenu can be Ctrl+m everywhere.
  const explicitCtrl = parseShortcutBinding('Ctrl+m')
  assert.equal(modifiersMatch(ev({ ctrlKey: true }), explicitCtrl, true), true)
  assert.equal(modifiersMatch(ev({ metaKey: true }), explicitCtrl, true), false)
  assert.equal(modifiersMatch(ev({ ctrlKey: true }), explicitCtrl, false), true)
})

test('modifiers must match exactly -- an extra held modifier is a different chord', () => {
  const parsed = parseShortcutBinding('CmdOrCtrl+k')
  // Ctrl+Shift+K is not Ctrl+K.
  assert.equal(modifiersMatch(ev({ ctrlKey: true, shiftKey: true }), parsed, false), false)
  assert.equal(modifiersMatch(ev({ ctrlKey: true, altKey: true }), parsed, false), false)
})

test('a bare binding requires the primary modifier to be up', () => {
  // Otherwise Cmd+Enter would also fire the bare Enter binding. This gap is
  // latent until a bare key enters the table -- and composerSend does.
  const bare = parseShortcutBinding('Enter')
  assert.equal(modifiersMatch(ev({ key: 'Enter' }), bare, false), true)
  assert.equal(modifiersMatch(ev({ key: 'Enter', ctrlKey: true }), bare, false), false)
  assert.equal(modifiersMatch(ev({ key: 'Enter', metaKey: true }), bare, true), false)
})

test('AltGr matches the same physical combination as Ctrl+Alt', () => {
  const altgr = parseShortcutBinding('AltGr+q')
  assert.equal(modifiersMatch(ev({ key: 'q', ctrlKey: true, altKey: true }), altgr, false), true)
  assert.equal(modifiersMatch(ev({ key: 'q', altKey: true }), altgr, false), false)
})

test('matchesShortcutBinding resolves CmdOrCtrl against the ambient platform', () => {
  // Node has no navigator, so this resolves as non-Apple: Ctrl is the primary
  // modifier and Meta is not. On a Mac the same helper would pick Meta.
  assert.equal(matchesShortcutBinding(ev({ key: 'k', ctrlKey: true }), 'CmdOrCtrl+k'), true)
  assert.equal(matchesShortcutBinding(ev({ key: 'k', metaKey: true }), 'CmdOrCtrl+k'), false)
  // event.code is the fallback when key has been rewritten or the layout is odd.
  assert.equal(matchesShortcutBinding(ev({ key: 'dead', code: 'KeyK', ctrlKey: true }), 'CmdOrCtrl+k'), true)
})

test('a bare Shift+letter binding is recognised, and is why editable targets are skipped', () => {
  assert.equal(isShiftOnlyPrintableBinding('Shift+f'), true)
  assert.equal(isShiftOnlyPrintableBinding('CmdOrCtrl+Shift+f'), false)
  assert.equal(isShiftOnlyPrintableBinding('Shift+Enter'), false)
})

test('rebinding refuses chords that would break the platform', () => {
  const existing = {}
  // Clipboard, undo, select-all and friends.
  for (const reserved of ['CmdOrCtrl+c', 'CmdOrCtrl+v', 'CmdOrCtrl+a', 'CmdOrCtrl+z', 'CmdOrCtrl+s', 'F5', 'ArrowUp', 'Enter']) {
    const conflict = findBindingConflict(reserved, 'toggleSidebar', existing)
    assert.ok(conflict, `${reserved} should be refused`)
    assert.equal(conflict.kind, 'reserved', `${reserved} should be reserved, got ${conflict.kind}`)
  }
  assert.ok(RESERVED_BINDINGS.includes('CmdOrCtrl+c'))

  // ⌘M belongs to the macOS minimise role.
  assert.equal(findBindingConflict('CmdOrCtrl+m', 'toggleSidebar', existing)?.kind, 'platform-reserved')
})

test('rebinding refuses a chord another command already holds', () => {
  // openSettings owns CmdOrCtrl+, by default.
  const conflict = findBindingConflict('CmdOrCtrl+,', 'toggleSidebar', {})
  assert.equal(conflict.kind, 'duplicate')
  assert.equal(conflict.against, 'openSettings')
  // A composer chord never collides with a global one -- but `Enter` is
  // reserved outright, so it is refused before the scope rule is reached.
  assert.equal(findBindingConflict('Enter', 'toggleSidebar', {}).kind, 'reserved')
  assert.equal(findBindingConflict('Shift+Enter', 'toggleSidebar', {}), null)
})

test('a rebind replaces the whole default group', () => {
  // openCommandCenter has two defaults; overriding replaces both, so the old
  // chord must stop working.
  // CmdOrCtrl+, is openSettings' default and is not reserved, so this is a
  // clean duplicate signal.
  const effective = { openCommandCenter: ['CmdOrCtrl+,'] }
  assert.equal(findBindingConflict('CmdOrCtrl+k', 'openCommandCenter', effective), null)
  assert.equal(findBindingConflict('CmdOrCtrl+,', 'openCommandCenter', effective)?.kind, 'duplicate')
  // And the replaced default is genuinely free again.
  assert.equal(findBindingConflict('CmdOrCtrl+k', 'toggleSidebar', effective), null)
})

test('formatting renders platform glyphs', () => {
  assert.equal(formatShortcut('CmdOrCtrl+k', true), '⌘K')
  assert.equal(formatShortcut('CmdOrCtrl+k', false), 'Ctrl+K')
  assert.equal(formatShortcut('CmdOrCtrl+Shift+p', true), '⌘⇧P')
  // No modifier token, so no prefix regardless of platform.
  assert.equal(formatShortcut('ArrowUp', false), '↑')
  assert.equal(formatShortcut('CmdOrCtrl+Alt+b', false), 'Ctrl+Alt+B')
})

test('the recorder produces a binding string from a real key event', () => {
  // The recorder reports what was physically pressed: Ctrl becomes Ctrl, which
  // is a deliberately different chord from CmdOrCtrl on macOS.
  assert.equal(eventToBinding(ev({ key: 'k', ctrlKey: true })), 'Ctrl+k')
  assert.equal(eventToBinding(ev({ key: 'P', metaKey: true, shiftKey: true })), 'Cmd+Shift+p')
  // A bare letter would otherwise read as a modifier-free binding.
  assert.equal(eventToBinding(ev({ key: 'q' })), 'CmdOrCtrl+q')
  // Modifier presses on their own are not bindings.
  assert.equal(eventToBinding(ev({ key: 'Control', ctrlKey: true })), null)
})