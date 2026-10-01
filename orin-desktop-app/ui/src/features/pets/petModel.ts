/**
 * Orin pets — small always-on-top companions that glance at live status.
 *
 * The rule is that a pet is a *glance*, not a dashboard. It answers one
 * question at a glance ("is something running?") and nothing more. Clicking one
 * brings the real app forward; there is nothing to interact with on the pet
 * itself, so a pet can never become a second, worse control surface.
 */

export type PetId = 'bolt' | 'ember' | 'slate'

export type PetMood = 'idle' | 'working' | 'waiting' | 'error' | 'happy'

export interface PetState {
  /** What the user is being told at a glance. Keep it under ~40 characters. */
  label: string
  mood: PetMood
  /** 0–1, drives the thinking animation and the eye line. */
  activity: number
}

export interface PetSpec {
  name: string
  hue: number
  /**
   * Silhouette on a 24-unit grid. Kept here rather than in the bar component so
   * `scripts/generate-brand-marks.mjs` can import this module and emit the same
   * geometry into `brand/pets/*.svg`. One definition, two consumers -- an
   * earlier version duplicated the paths and they were free to drift.
   */
  body: string
  /** Eyes, drawn in brand ink so they read at 18px on any mood colour. */
  eyes: string
}

export const PETS: Readonly<Record<PetId, PetSpec>> = {
  // Sharp and angular: recognisably the app's own bolt.
  bolt: {
    name: 'Bolt',
    hue: 32,
    body: 'M12 1.6 3.2 13.1h5.2l-1 9.3 8.8-11.5h-5.2z',
    eyes: '<ellipse cx="9.6" cy="9.4" rx="1.15" ry="1.5"/><ellipse cx="14.4" cy="9.4" rx="1.15" ry="1.5"/>',
  },
  // Round and warm, with a flame crest, to read as heat rather than speed.
  ember: {
    name: 'Ember',
    hue: 8,
    body: 'M12 1.4c4.6 3.4 7 7 7 10.4A7 7 0 0 1 5 11.8C5 8.4 7.4 4.8 12 1.4zm0 4.1c-2.3 2-3.4 4.2-3.4 6a3.4 3.4 0 0 0 6.8 0c0-1.8-1.1-4-3.4-6z',
    eyes: '<ellipse cx="9.9" cy="10.4" rx="1.05" ry="1.35"/><ellipse cx="14.1" cy="10.4" rx="1.05" ry="1.35"/>',
  },
  // Calm and geometric: a rounded hexagon, no crest.
  slate: {
    name: 'Slate',
    hue: 210,
    body: 'M12 1.8 20.6 7v10L12 22.2 3.4 17V7zm0 2.9L5.6 8.6v6.8L12 19.3l6.4-3.9V8.6z',
    eyes: '<rect x="8.7" y="9.3" width="2" height="2.5" rx="0.6"/><rect x="13.3" y="9.3" width="2" height="2.5" rx="0.6"/>',
  },
}

/** Eyes are brand ink, not the mood colour, or they vanish into the body. */
export const PET_EYE_INK = '#1c1c1a'

export const PET_IDS: readonly PetId[] = ['bolt', 'ember', 'slate']

export const MOOD_TONE: Readonly<Record<PetMood, string>> = {
  idle: 'var(--muted)',
  working: 'var(--accent)',
  waiting: 'var(--warn)',
  error: '#f87171',
  happy: 'var(--success)',
}

/**
 * Fold raw app state into one glanceable line.
 *
 * Deliberately conservative: it only reports what the stores already know, and
 * when two things are true it prefers the one a person would want to act on.
 */
export function describeStatus(input: {
  streaming: boolean
  agentRuns: number
  pendingApprovals: number
  projectRoot: string | null
  error: string | null
}): PetState {
  if (input.error) return { label: 'Needs attention', mood: 'error', activity: 0.2 }
  if (input.pendingApprovals > 0) {
    const n = input.pendingApprovals
    return { label: `${n} approval${n === 1 ? '' : 's'} waiting`, mood: 'waiting', activity: 0.35 }
  }
  if (input.agentRuns > 0) {
    return { label: `Agent running (${input.agentRuns})`, mood: 'working', activity: 0.9 }
  }
  if (input.streaming) return { label: 'Replying…', mood: 'working', activity: 0.7 }
  if (input.projectRoot) return { label: 'Ready', mood: 'idle', activity: 0.1 }
  return { label: 'No folder open', mood: 'idle', activity: 0.05 }
}

/** Keep the glance short enough to read without focusing on it. */
export function clampLabel(value: string, max = 40): string {
  const clean = String(value).replace(/\s+/g, ' ').trim()
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`
}
