import test from 'node:test'
import assert from 'node:assert/strict'

/**
 * Orin's cues are synthesised from oscillators rather than shipped as audio
 * files, so there is no file to assert on and nothing to decode. The observable
 * contract is what reaches the AudioContext: which oscillators start, at what
 * frequency, with what envelope, and -- just as important -- what does NOT
 * happen when sound is off, muted, or the page has no Web Audio at all.
 *
 * A silent regression here is invisible in a screenshot and never throws, so
 * these are the assertions that keep the design honest.
 *
 * sound.ts memoises its AudioContext in a module-level variable, so each test
 * re-imports it with a unique query. Without that the second test would keep
 * talking to the first test's stub and quietly assert against stale events.
 */
let instance = 0
async function loadSound() {
  const mod = await import(`../ui/src/design/sound.ts?instance=${instance++}`)
  return mod
}

/** Minimal AudioContext stand-in that records everything played. */
function stubAudio({ state = 'running' } = {}) {
  const events = []
  const ctx = {
    state,
    currentTime: 10,
    destination: { id: 'destination' },
    resume: () => { ctx.state = 'running'; return Promise.resolve() },
    createOscillator() {
      return {
        type: 'sine',
        frequency: { setValueAtTime: (v, t) => events.push({ kind: 'freq', value: v, at: t }) },
        // connect must be chainable: the module does osc.connect(gain).connect(dest).
        connect: () => ({ connect: () => events.push({ kind: 'connect' }) }),
        start: (t) => events.push({ kind: 'start', at: t }),
        stop: (t) => events.push({ kind: 'stop', at: t }),
      }
    },
    createGain() {
      return {
        gain: {
          setValueAtTime: (v, t) => events.push({ kind: 'gain-set', value: v, at: t }),
          exponentialRampToValueAtTime: (v, t) => events.push({ kind: 'gain-ramp', value: v, at: t }),
        },
        connect: () => ({ connect: () => events.push({ kind: 'connect' }) }),
      }
    },
  }
  globalThis.window = { AudioContext: function () { return ctx } }
  return { ctx, events }
}

test.afterEach(() => { delete globalThis.window })

const starts = (events) => events.filter((e) => e.kind === 'start')
const freqs = (events) => events.filter((e) => e.kind === 'freq').map((e) => e.value)
const ramps = (events) => events.filter((e) => e.kind === 'gain-ramp').map((e) => e.value)
const CUES = ['send', 'thinking', 'reply', 'success', 'error']

test('each cue starts at least one oscillator at an audible frequency', async () => {
  for (const name of CUES) {
    const { playSound } = await loadSound()
    const { events } = stubAudio()
    playSound(name)
    assert.ok(starts(events).length >= 1, `${name} should start an oscillator`)
    assert.ok(freqs(events).every((f) => f > 20 && f < 20000), `${name} frequencies should be audible, saw ${freqs(events)}`)
  }
})

test('a two-note cue starts two oscillators and the second is delayed', async () => {
  const { playSound } = await loadSound()
  const { events } = stubAudio()
  playSound('reply')
  const [first, second] = starts(events)
  assert.equal(starts(events).length, 2)
  assert.ok(second.at > first.at, 'the second note must start after the first, not with it')
  assert.ok(freqs(events)[1] > freqs(events)[0] * 1.4, 'reply should rise by about a fifth')
})

test('every cue fades in and out rather than gating, which would click', async () => {
  for (const name of CUES) {
    const { playSound } = await loadSound()
    const { events } = stubAudio()
    playSound(name)
    const values = ramps(events)
    assert.ok(values.length >= 2, `${name} needs a fade in and a fade out`)
    assert.ok(values.every((v) => v > 0), `${name} exponential ramps must never target 0, saw ${values}`)
    assert.ok(values.some((v) => v <= 0.0001), `${name} should fade back to the floor`)
  }
})

test('a disabled cue plays nothing at all', async () => {
  const { playSound } = await loadSound()
  const { events } = stubAudio()
  playSound('success', false)
  assert.deepEqual(events, [])
})

test('volume is clamped, and zero or negative is true silence', async () => {
  for (const volume of [0, -5]) {
    const { playSound } = await loadSound()
    const { events } = stubAudio()
    playSound('success', true, volume)
    assert.deepEqual(events, [], `volume ${volume} must not schedule anything`)
  }

  const { playSound, MASTER_GAIN } = await loadSound()
  const { events } = stubAudio()
  playSound('success', true, 99)
  const peaks = ramps(events).filter((v) => v > 0.0001)
  assert.ok(peaks.length >= 1, 'a clamped loud cue still plays')
  assert.ok(peaks.every((v) => v <= MASTER_GAIN), `clamped peaks must stay within MASTER_GAIN, saw ${peaks}`)
})

test('a suspended context is resumed, because a cue before the first gesture is dropped', async () => {
  const { playSound } = await loadSound()
  const { ctx, events } = stubAudio({ state: 'suspended' })
  playSound('send')
  assert.equal(ctx.state, 'running')
  assert.ok(starts(events).length >= 1)
})

test('unlockAudio resumes a suspended context and is safe to call repeatedly', async () => {
  const { unlockAudio } = await loadSound()
  const { ctx } = stubAudio({ state: 'suspended' })
  unlockAudio()
  assert.equal(ctx.state, 'running')
  unlockAudio()
  assert.equal(ctx.state, 'running', 'resuming an already-running context must not throw')
})

test('no Web Audio available is a silent no-op, never a crash', async () => {
  const { playSound, unlockAudio } = await loadSound()
  globalThis.window = {}
  assert.doesNotThrow(() => playSound('success'))
  globalThis.window = { AudioContext: undefined, webkitAudioContext: undefined }
  assert.doesNotThrow(() => playSound('success'))
  assert.doesNotThrow(() => unlockAudio())
})

test('cues are scheduled in the future, never in the past', async () => {
  const { playSound } = await loadSound()
  const { events } = stubAudio()
  playSound('thinking')
  const now = 10
  assert.ok(events.filter((e) => e.kind === 'stop').every((e) => e.at >= now), 'a cue must not be scheduled in the past')
  assert.ok(events.filter((e) => e.kind === 'start').every((e) => e.at >= now), 'a cue must not start before the context clock')
})
