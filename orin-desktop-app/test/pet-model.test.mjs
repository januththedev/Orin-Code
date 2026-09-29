import test from 'node:test'
import assert from 'node:assert/strict'
import { PET_IDS, PETS, clampLabel, describeStatus, MOOD_TONE } from '../ui/src/features/pets/petModel.ts'

const base = { streaming: false, agentRuns: 0, pendingApprovals: 0, projectRoot: null, error: null }

test('an error outranks everything else', () => {
  const s = describeStatus({ ...base, error: 'boom', streaming: true, agentRuns: 2, pendingApprovals: 1 })
  assert.equal(s.mood, 'error')
  assert.equal(s.label, 'Needs attention')
})

test('a waiting approval is the next most actionable thing', () => {
  const s = describeStatus({ ...base, pendingApprovals: 1, streaming: true, agentRuns: 3 })
  assert.equal(s.mood, 'waiting')
  assert.equal(s.label, '1 approval waiting')

  const many = describeStatus({ ...base, pendingApprovals: 3 })
  assert.equal(many.label, '3 approvals waiting')
})

test('a running agent reads as working, not as a chat reply', () => {
  const s = describeStatus({ ...base, agentRuns: 2 })
  assert.equal(s.mood, 'working')
  assert.match(s.label, /Agent running/)
  assert.ok(s.activity > 0.5, 'a working pet should animate')
})

test('a streaming reply is working, and an idle app is not', () => {
  assert.equal(describeStatus({ ...base, streaming: true }).mood, 'working')
  const idle = describeStatus({ ...base, projectRoot: '/repo' })
  assert.equal(idle.mood, 'idle')
  assert.equal(idle.label, 'Ready')
  assert.ok(idle.activity < 0.2, 'an idle pet should be nearly still')
})

test('no folder is called out rather than silently looking ready', () => {
  const s = describeStatus(base)
  assert.equal(s.label, 'No folder open')
  assert.equal(s.activity, 0.05)
})

test('a glance stays short enough to read without focusing on it', () => {
  assert.equal(clampLabel('a'.repeat(80)).length, 40)
  assert.equal(clampLabel('  lots   of\n space '), 'lots of space')
  assert.equal(clampLabel('short'), 'short')
})

test('every pet and every mood is defined', () => {
  for (const id of PET_IDS) {
    assert.ok(PETS[id], `${id} needs a spec`)
    assert.equal(typeof PETS[id].hue, 'number')
  }
  for (const mood of ['idle', 'working', 'waiting', 'error', 'happy']) {
    assert.ok(MOOD_TONE[mood], `${mood} needs a tone`)
  }
})
