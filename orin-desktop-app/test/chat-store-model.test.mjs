import test from 'node:test'
import assert from 'node:assert/strict'
import {
  INDEX_KEY,
  LEGACY_KEY,
  buildIndex,
  conversationKey,
  hydrate,
  planMigration,
  toSummary,
  upsertSummary,
} from '../ui/src/stores/chatStoreModel.ts'

const now = '2026-01-01T00:00:00.000Z'
const msg = (id, content, role = 'user') => ({ id, role, content, createdAt: now })
const convo = (id, messages, over = {}) => ({
  id,
  title: `Conversation ${id}`,
  messages,
  mode: 'chat',
  projectId: null,
  pinned: false,
  archived: false,
  createdAt: now,
  updatedAt: now,
  ...over,
})

test('the index carries what the sidebar needs and not the messages', () => {
  const summary = toSummary(convo('a', [msg('m1', 'hello world')]))
  assert.equal(summary.id, 'a')
  assert.equal(summary.messageCount, 1)
  assert.equal(summary.preview, 'hello world')
  assert.equal('messages' in summary, false, 'the index must not carry message bodies')
})

test('the index is orders of magnitude smaller than the blob it replaces', () => {
  // The claim the redesign rests on, measured rather than asserted.
  const conversations = Array.from({ length: 500 }, (_, c) =>
    convo(`c${c}`, Array.from({ length: 400 }, (_, m) => msg(`c${c}m${m}`, 'x'.repeat(600)))),
  )
  const blob = Buffer.byteLength(JSON.stringify(conversations))
  const index = Buffer.byteLength(JSON.stringify(buildIndex(conversations)))
  assert.ok(blob > 100 * 1024 * 1024, `expected a large blob, got ${blob}`)
  assert.ok(index < 512 * 1024, `expected a small index, got ${index}`)
  assert.ok(index < blob / 500, `index should be far smaller; blob=${blob} index=${index}`)
})

test('the index is ordered by recency so the sidebar needs no extra sort', () => {
  const index = buildIndex([
    convo('old', [msg('m', 'a')], { updatedAt: '2026-01-01T00:00:00.000Z' }),
    convo('new', [msg('m', 'a')], { updatedAt: '2026-06-01T00:00:00.000Z' }),
    convo('mid', [msg('m', 'a')], { updatedAt: '2026-03-01T00:00:00.000Z' }),
  ])
  assert.deepEqual(index.map((s) => s.id), ['new', 'mid', 'old'])
})

test('a conversation is reassembled from its summary and its messages', () => {
  const messages = [msg('m1', 'first'), msg('m2', 'second')]
  const back = hydrate(toSummary(convo('a', messages)), messages)
  assert.equal(back.id, 'a')
  assert.equal(back.messages.length, 2)
  assert.equal(back.title, 'Conversation a')
})

test('keys are namespaced so a chat cannot collide with another store key', () => {
  assert.equal(conversationKey('abc'), 'chat:abc')
  assert.notEqual(conversationKey('abc'), INDEX_KEY)
  assert.notEqual(INDEX_KEY, LEGACY_KEY)
})

test('migration splits the legacy blob and drops untouched conversations', () => {
  const legacy = [
    convo('keep', [msg('m1', 'hello')]),
    convo('empty', []),                       // an untouched "new chat"
    { garbage: true },                         // not a conversation
    null,
    convo('also', [msg('m2', 'second')]),
  ]
  const plan = planMigration(legacy)
  assert.deepEqual(plan.index.map((s) => s.id).sort(), ['also', 'keep'])
  assert.deepEqual(Object.keys(plan.messages).sort(), ['also', 'keep'])
  assert.deepEqual(plan.dropped, ['empty'])
})

test('migration survives a corrupt or missing legacy blob', () => {
  for (const value of [null, undefined, 'nope', 42, {}]) {
    const plan = planMigration(value)
    assert.deepEqual(plan.index, [])
    assert.deepEqual(plan.dropped, [])
  }
})

test('a summary update replaces in place and keeps recency order', () => {
  let index = buildIndex([
    convo('a', [msg('m', 'x')], { updatedAt: '2026-01-01T00:00:00.000Z' }),
    convo('b', [msg('m', 'x')], { updatedAt: '2026-05-01T00:00:00.000Z' }),
  ])
  index = upsertSummary(index, toSummary(convo('a', [msg('m1', 'x'), msg('m2', 'y')], { updatedAt: '2026-07-01T00:00:00.000Z' })))
  assert.equal(index.length, 2, 'updating must not duplicate a row')
  assert.equal(index[0].id, 'a', 'the updated conversation is now the most recent')
  assert.equal(index[0].messageCount, 2)
  assert.equal(index[0].preview, 'y')
})

test('a preview is whitespace-collapsed and bounded', () => {
  const summary = toSummary(convo('a', [msg('m', 'a\n\n  b   c\t d '.repeat(40))]))
  assert.ok(summary.preview.length <= 120)
  assert.ok(!summary.preview.includes('\n'))
  assert.ok(!/\s{2,}/.test(summary.preview))
})
