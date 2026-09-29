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

export const PETS: Readonly<Record<PetId, { name: string; hue: number }>> = {
  bolt: { name: 'Bolt', hue: 32 },
  ember: { name: 'Ember', hue: 8 },
  slate: { name: 'Slate', hue: 210 },
}

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
