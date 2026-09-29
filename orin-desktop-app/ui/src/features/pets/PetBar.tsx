import { useEffect, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useChatsStore } from '../../stores/chatsStore'
import { useProjectsStore } from '../../stores/projectsStore'
import { PETS, PET_IDS, clampLabel, describeStatus, MOOD_TONE, type PetId, type PetMood } from './petModel'
import './pets.css'

/**
 * The always-on-top status strip.
 *
 * It reads stores directly rather than taking props, so it keeps working while
 * another view is open. Status is polled on a slow tick and on store change
 * rather than every render — a glance does not need 60 Hz.
 */
export function PetBar() {
  const streaming = useChatsStore((s) =>
    s.conversations.some((c) => c.id === s.activeId && c.messages.some((m) => m.pending)),
  )
  const projectRoot = useProjectsStore((s) => s.projects.find((p) => p.id === s.activeProjectId)?.rootPath ?? null)
  const [pet, setPet] = useState<PetId>('bolt')
  const [error, setError] = useState<string | null>(null)

  // Pick a pet, rotating when the window is focused so the others get seen.
  useEffect(() => {
    const win = getCurrentWindow()
    let index = PET_IDS.indexOf('bolt')
    const rotate = () => { index = (index + 1) % PET_IDS.length; setPet(PET_IDS[index]) }
    const unlisten = win.onFocusChanged(({ payload }) => { if (payload) rotate() }).catch(() => () => {})
    return () => { void unlisten.then((fn) => fn?.()) }
  }, [])

  const status = describeStatus({ streaming, agentRuns: 0, pendingApprovals: 0, projectRoot, error })

  const bringForward = () => {
    getCurrentWindow()
      .show()
      .then(() => getCurrentWindow().setFocus())
      .then(() => getCurrentWindow().unminimize())
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not focus the window'))
  }

  const spec = PETS[pet]

  return (
    <div
      className="pet-bar"
      data-mood={status.mood}
      style={{ ['--pet-hue' as string]: `${spec.hue}`, ['--pet-activity' as string]: String(status.activity) }}
      onClick={bringForward}
      role="status"
      aria-live="polite"
      aria-label={`Orin status: ${status.label}`}
      title={error ?? 'Click to bring Orin Code forward'}
    >
      <PetFace mood={status.mood} activity={status.activity} />
      <span className="pet-name">{spec.name}</span>
      <span className="pet-label">{clampLabel(status.label)}</span>
      {status.activity > 0.05 && <span className="pet-pulse" aria-hidden="true" />}
    </div>
  )
}

/** A small face. Mood drives colour, activity drives the motion. */
function PetFace({ mood, activity }: { mood: PetMood; activity: number }) {
  return (
    <svg className="pet-face" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <circle cx="12" cy="12" r="11" fill={MOOD_TONE[mood]} opacity="0.16" />
      {/* The bolt, Orin's own mark. */}
      <path
        d="M13.4 4.5 7.2 13.1h3.6l-.7 6.4 6.2-8.6h-3.6z"
        fill={MOOD_TONE[mood]}
        style={{ transformOrigin: '12px 12px', transform: `scale(${1 + activity * 0.08})` }}
      />
      {mood === 'error' && <circle cx="18" cy="6" r="2.4" fill={MOOD_TONE.error} />}
      {mood === 'waiting' && <text x="17" y="8" className="pet-mark">!</text>}
    </svg>
  )
}
