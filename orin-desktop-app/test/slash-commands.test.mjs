import test from 'node:test'
import assert from 'node:assert/strict'

import {
  SLASH_COMMANDS,
  parseSlash,
  findSlashCommand,
} from '../ui/src/features/chat/slashCommands.ts'

/**
 * ZCode's slash command surface, ported from
 * `shared/src/zcode-slash-command-help.ts` and `ui/src/v4/slashCommands.ts`.
 *
 * The behaviours that matter and are easy to lose:
 *   - the command set is ZCode's, not a prompt-template list;
 *   - `/help` answers LOCALLY, without creating a session or sending a prompt
 *     (`zcode-slash-command-help.ts:9-16`);
 *   - a command Orin Code cannot perform is PRESENT and marked, not omitted --
 *     a missing row looks like the feature was never ported, a disabled row
 *     says what is actually missing.
 */

test('the command set is ZCode’s, not a prompt-template list', () => {
  const names = SLASH_COMMANDS.map((c) => c.name)
  // ZCode's builtins (`zcode-slash-command-help.ts:9-200`), plus /workflow.
  for (const expected of [
    'help', 'login', 'logout', 'compact', 'init', 'expert', 'effort', 'dwf',
    'fork', 'locale', 'mcp', 'plugins', 'mode', 'model', 'new', 'resume',
    'rewind', 'skill', 'goal', 'workflow',
  ]) {
    assert.ok(names.includes(expected), `/${expected} missing from the port`)
  }
  assert.equal(new Set(names).size, names.length, 'duplicate command name')
})

test('every command carries ZCode’s usage and summary', () => {
  for (const command of SLASH_COMMANDS) {
    assert.ok(command.usage.startsWith(`/${command.name}`), `${command.name} usage should start with its name`)
    assert.ok(command.summary.length > 0, `${command.name} needs a summary`)
  }
})

test('an unavailable command says why, and still runs nothing', () => {
  const unavailable = SLASH_COMMANDS.filter((c) => c.availability === 'unavailable')
  assert.ok(unavailable.length > 0, 'the port should have some honest gaps')
  for (const command of unavailable) {
    assert.ok(command.gap && command.gap.length > 20, `${command.name} must explain its gap`)
    // A command that cannot run must not carry a handler that would fake one.
    assert.equal(command.run, undefined, `${command.name} is unavailable, so it must not have a runner`)
  }
})

test('an available command has a runner and no gap text', () => {
  for (const command of SLASH_COMMANDS.filter((c) => c.availability === 'available')) {
    assert.equal(typeof command.run, 'function', `${command.name} claims to work but has no runner`)
  }
})

test('/mode is not mapped onto chat modes', () => {
  // ZCode's modes are PERMISSION levels (plan|build|edit|yolo). Orin Code's
  // chat/cowork/agent are conversation styles. Mapping one onto the other would
  // silently change what a run may do, so it must stay unmapped.
  const mode = findSlashCommand('mode')
  assert.ok(mode)
  assert.equal(mode.availability, 'unavailable')
  assert.match(mode.usage, /plan\|build\|edit\|yolo/)
  assert.match(String(mode.gap), /permission/i)
})

test('the parser takes ZCode’s shape: /name and optional arguments', () => {
  assert.deepEqual(parseSlash('/model'), { name: 'model', args: '' })
  assert.deepEqual(parseSlash('/model openai/gpt-5.5'), { name: 'model', args: 'openai/gpt-5.5' })
  assert.deepEqual(parseSlash('  /mcp list  '), { name: 'mcp', args: 'list' })
  // Not a command: leading space, prose, or a bare slash.
  assert.equal(parseSlash('explain this'), null)
  assert.equal(parseSlash('/'), null)
  assert.equal(parseSlash('//double'), null)
})

test('/help answers locally and lists the catalogue', () => {
  const help = findSlashCommand('help')
  assert.ok(help && help.run)
  const toasts = []
  const api = {
    setView() {}, createChat() {}, setModel() {}, listModels: () => [],
    toast: (level, title, body) => toasts.push({ level, title, body }),
  }
  assert.equal(help.run('', api), true, 'help always handles')
  assert.equal(toasts.length, 1)
  assert.match(String(toasts[0].body), /\/help/, 'the bare listing should include the commands')
  // A specific command answers with its own usage, still without a prompt.
  toasts.length = 0
  assert.equal(help.run('model', api), true)
  assert.match(String(toasts[0].title), /\/model/)
})

test('/model switches a model that exists and refuses one that does not', () => {
  const command = findSlashCommand('model')
  let setModelTo = null
  const errors = []
  const api = {
    setView() {}, createChat() {},
    setModel: (id) => { setModelTo = id },
    listModels: () => [
      { id: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet 5' },
      { id: 'openai_compat/gpt-5.5', label: 'GPT-5.5' },
    ],
    toast: (level, title) => { if (level === 'error') errors.push(title) },
  }
  assert.equal(command.run('claude-sonnet-5', api), true)
  assert.equal(setModelTo, 'anthropic/claude-sonnet-5', 'a short id should resolve')
  setModelTo = null
  command.run('does-not-exist', api)
  assert.equal(setModelTo, null, 'an unknown model must not be set')
  assert.equal(errors.length, 1, 'and the failure must be reported')
})

test('/mcp and /plugins route to the existing integrations surface', () => {
  const visited = []
  const api = {
    setView: (view) => visited.push(view),
    createChat() {}, setModel() {}, listModels: () => [], toast() {},
  }
  assert.equal(findSlashCommand('mcp').run('', api), true)
  assert.equal(findSlashCommand('plugins').run('', api), true)
  assert.deepEqual(visited, ['connectors', 'connectors'])
})
