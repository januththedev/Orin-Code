/**
 * Orin sound.
 *
 * Every cue is synthesised at runtime from oscillators rather than shipped as
 * an audio file. That keeps the bundle small, makes the app work offline, and
 * means there is no third-party audio in the installer to license.
 *
 * The palette is deliberately quiet: a soft amber sine for arrival, a low
 * filtered pulse for thinking, a short two-note fall for error. Nothing loops
 * on its own, and nothing plays without a user action having happened first —
 * an app that makes noise you did not ask for is an app you mute forever.
 */

export type SoundName = 'send' | 'thinking' | 'reply' | 'success' | 'error'

interface ToneStep {
  freq: number
  /** Seconds. */
  duration: number
  /** Seconds to wait before this step starts. */
  delay?: number
  type?: OscillatorType
  gain?: number
}

const TONES: Record<SoundName, ToneStep[]> = {
  // A soft rising fifth: "your message went out".
  send: [
    { freq: 392, duration: 0.09, type: 'sine', gain: 0.05 },
    { freq: 587.33, duration: 0.11, delay: 0.06, type: 'sine', gain: 0.04 },
  ],
  // One low note that the thinking animation can retrigger, never a loop.
  thinking: [{ freq: 196, duration: 0.5, type: 'sine', gain: 0.022 }],
  // Arrival: the send gesture, resolved.
  reply: [
    { freq: 523.25, duration: 0.1, type: 'sine', gain: 0.045 },
    { freq: 783.99, duration: 0.16, delay: 0.07, type: 'sine', gain: 0.035 },
  ],
  success: [{ freq: 659.25, duration: 0.13, type: 'triangle', gain: 0.05 }],
  // Falling minor second. Short, so it never becomes grating.
  error: [
    { freq: 311.13, duration: 0.1, type: 'triangle', gain: 0.05 },
    { freq: 261.63, duration: 0.17, delay: 0.09, type: 'triangle', gain: 0.045 },
  ],
}

export const MASTER_GAIN = 0.9

let context: AudioContext | null = null

function audioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  context ??= new Ctor()
  return context
}

/** Browsers suspend audio until a gesture; call this from the first click. */
export function unlockAudio(): void {
  const ctx = audioContext()
  if (ctx && ctx.state === 'suspended') void ctx.resume()
}

export function playSound(name: SoundName, enabled = true, volume = 1): void {
  if (!enabled) return
  const master = Math.max(0, Math.min(1, volume))
  if (master === 0) return
  const ctx = audioContext()
  if (!ctx) return
  // A cue triggered before the first gesture would be silently dropped anyway.
  if (ctx.state === 'suspended') void ctx.resume()

  const start = ctx.currentTime
  for (const step of TONES[name]) {
    const at = start + (step.delay ?? 0)
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = step.type ?? 'sine'
    osc.frequency.setValueAtTime(step.freq, at)
    const peak = (step.gain ?? 0.04) * MASTER_GAIN * master
    // A short ramp in and out; a hard gate on an oscillator clicks.
    gain.gain.setValueAtTime(0.0001, at)
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), at + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + step.duration)
    osc.connect(gain).connect(ctx.destination)
    osc.start(at)
    osc.stop(at + step.duration + 0.02)
  }
}
