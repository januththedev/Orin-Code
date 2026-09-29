import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_CONTENT,
  MAX_ENTRIES_PER_SCOPE,
  buildMemoryContext,
  isValidMemory,
  normalizeByChat,
  normalizeEntry,
  normalizeScope,
} from '../ui/src/features/memory/memoryModel.ts'

const entry = (content, over = {}) => ({
  id: 'm1',
  content,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  source: 'user',
  ...over,
})

test('a memory must be non-empty and bounded', () => {
  assert.equal(isValidMemory('prefers TypeScript'), true)
  assert.equal(isValidMemory('  '), false)
  assert.equal(isValidMemory(''), false)
  assert.equal(isValidMemory(null), false)
  assert.equal(isValidMemory(42), false)
  assert.equal(isValidMemory('x'.repeat(MAX_CONTENT + 1)), false)
  assert.equal(isValidMemory('x'.repeat(MAX_CONTENT)), true)
})

test('the model sees global memory and chat memory as separate scopes', () => {
  const context = buildMemoryContext(
    [entry('prefers short answers'), entry('works in Sri Lanka')],
    [entry('this repo uses pnpm', { source: 'chat' })],
  )
  assert.match(context, /applies to every conversation/)
  assert.match(context, /Memory from this conversation only/)
  assert.match(context, /prefers short answers/)
  assert.match(context, /this repo uses pnpm/)
  // Global comes first so standing context is never mistaken for thread detail.
  assert.ok(context.indexOf('prefers short answers') < context.indexOf('this repo uses pnpm'))
  assert.match(context, /Never mention this block/)
})

test('chat memory never leaks into another conversation', () => {
  const a = buildMemoryContext([], [entry('a-only secret', { source: 'chat' })])
  const b = buildMemoryContext([], [])
  assert.match(a, /a-only secret/)
  assert.equal(b, null, 'a different chat with no memory must send nothing')
})

test('an empty memory sends no system message at all', () => {
  assert.equal(buildMemoryContext([], []), null)
})

test('storage round-trips clean and drops junk', () => {
  const restored = normalizeScope([
    entry('valid'),
    { content: '   ' },
    null,
    'a string',
    { content: 'x'.repeat(MAX_CONTENT + 1) },
    entry('also valid', { id: 'm2' }),
  ])
  assert.deepEqual(restored.map((e) => e.content), ['valid', 'also valid'])
  assert.deepEqual(restored.map((e) => e.id), ['m1', 'm2'])
})

test('a malformed entry is repaired rather than crashing the page', () => {
  const repaired = normalizeEntry({ content: '  trimmed  ' })
  assert.equal(repaired.content, 'trimmed')
  assert.ok(repaired.id, 'a missing id is generated')
  assert.ok(repaired.createdAt, 'a missing timestamp is filled')
  assert.equal(repaired.source, 'user', 'an unknown source falls back to user')
  assert.equal(normalizeEntry({ content: '' }), null)
  assert.equal(normalizeEntry(undefined), null)
})

test('a scope is capped so a runaway list cannot grow without bound', () => {
  const many = Array.from({ length: MAX_ENTRIES_PER_SCOPE + 50 }, (_, i) => entry(`m${i}`))
  assert.equal(normalizeScope(many).length, MAX_ENTRIES_PER_SCOPE)
})

test('chat ids that could pollute the object are rejected', () => {
  const hostile = normalizeByChat({
    ['__proto__']: { polluted: true },
    constructor: [entry('bad')],
    prototype: [entry('bad')],
    'good-chat-id': [entry('fine')],
    'has space': [entry('nope')],
  })
  assert.deepEqual(Object.keys(hostile), ['good-chat-id'])
  assert.equal({}.polluted, undefined, 'prototype must not be touched')
  assert.equal(Object.prototype.constructor, Object, 'constructor must not be shadowed')
  assert.equal(Object.getPrototypeOf(hostile), null, 'the map must have a null prototype')
  assert.equal(hostile['good-chat-id'][0].content, 'fine')
})

test('a non-object byChat blob is discarded instead of throwing', () => {
  for (const value of [null, 'nope', 42, [1, 2, 3]]) {
    assert.deepEqual(normalizeByChat(value), {})
  }
  assert.deepEqual(normalizeScope('nope'), [])
})

test('memory survives the split chat storage', async () => {
  // Chat loading was split into an index plus per-conversation blobs, and a
  // per-chat memory is keyed by chat id. These two must stay compatible: if a
  // chat id is not stable across open/close, a user's per-chat memory silently
  // stops being found.
  const { readFile } = await import('node:fs/promises')
  const model = await readFile(new URL('../ui/src/stores/chatStoreModel.ts', import.meta.url), 'utf8')
  const store = await readFile(new URL('../ui/src/stores/chatsStore.ts', import.meta.url), 'utf8')

  // The index stores ids, not derived ones.
  assert.match(model, /id: string/, 'the summary must carry the conversation id')
  assert.match(model, /conversationKey\(id: string\)/, 'a conversation key must be derived from that id')

  // Memory is still looked up by the same chatId the store uses.
  assert.match(store, /buildMemoryContext\(memory\.global, memory\.byChat\[chatId\]/)

  // Lazy loading must not be reintroduced as "load everything on launch".
  assert.doesNotMatch(store, /storeGet<Conversation\[\]>\(CHATS_KEY\)/,
    'launch must not read every message again')
  assert.match(store, /openChat/, 'conversations must be loadable on demand')
})
