import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { UnlistenFn } from '@tauri-apps/api/event'
import { OrinMark } from '../../components/OrinMark'
import './pet-window.css'

type Mood = 'idle' | 'working' | 'waiting' | 'error' | 'happy'

interface PetStatus {
  label: string
  mood: Mood
  activity: number
}

/**
 * The always-on-top pet.
 *
 * It renders in its own transparent, undecorated, skip-taskbar window that
 * sits above other apps. There is nothing to click here on purpose: a glance
 * that can be mis-clicked while you are working in something else is worse than
 * a glance that is only a glance. Clicking brings the real app forward.
 */
export function PetWindow() {
  const [status, setStatus] = useState<PetStatus>({ label: 'Ready', mood: 'idle', activity: 0.05 })

  useEffect(() => {
    let stop: UnlistenFn | undefined
    void listen<PetStatus>('pet://status', (event) => setStatus(event.payload)).then((fn) => {
      stop = fn
    })
    return () => stop?.()
  }, [])

  const focusMain = () => {
    void invoke('pet_focus')
  }

  return (
    <div
      className="pet-window"
      data-mood={status.mood}
      style={{ ['--pet-activity' as string]: String(status.activity) }}
      onClick={focusMain}
      role="status"
      aria-live="polite"
      aria-label={`Orin: ${status.label}`}
      title="Orin — click to bring the app forward"
    >
      <span className="pet-window-face" aria-hidden="true">
        <OrinMark size={26} state={status.mood === 'working' ? 'thinking' : 'idle'} />
      </span>
      <span className="pet-window-label">{status.label}</span>
      {status.activity > 0.05 && <span className="pet-window-pulse" aria-hidden="true" />}
    </div>
  )
}
