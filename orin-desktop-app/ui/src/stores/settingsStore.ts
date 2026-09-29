import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { bridge } from '../bridge/client'
import { clampUiFontSize } from '../design/typeScale'

export type Density = 'comfortable' | 'compact'

interface SettingsState {
  theme: 'dark' | 'light'
  accent: string
  density: Density
  fontSize: number
  codeFont: string
  defaultModelId: string
  defaultMode: 'chat' | 'cowork' | 'agent' | 'computer'
  cloudSync: boolean
  /** Run phone-confirmed Telegram tasks on this PC (explicit opt-in). */
  phoneTasks: boolean
  /** Interface sound cues. Off by default — an app that talks unasked gets muted. */
  sound: boolean
  /** Master volume for those cues, 0–1. */
  volume: number
  hydrate: () => Promise<void>
  update: (patch: Partial<Omit<SettingsState, 'hydrate' | 'update'>>) => void
}

const SETTINGS_KEY = 'settings'

export const useSettingsStore = create<SettingsState>((set, get) => ({
  theme: 'dark',
  accent: '#e08a3c',
  density: 'comfortable',
  fontSize: 13,
  codeFont: 'JetBrains Mono',
  defaultModelId: 'mock/orin-offline',
  defaultMode: 'chat',
  cloudSync: true,
  phoneTasks: false,
  sound: false,
  volume: 0.5,

  hydrate: async () => {
    try {
      const saved = await bridge.storeGet<Partial<SettingsState>>(SETTINGS_KEY)
      if (saved && typeof saved === 'object') set(saved)
    } catch {
      // defaults
    }
    // Signed in? Converge with the user's cloud snapshot (remote wins v1).
    try {
      const { pullAndMerge } = await import('./cloudSync')
      await pullAndMerge()
    } catch {
      // offline / signed out — local values stand
    }
    document.documentElement.dataset.theme = get().theme
    document.documentElement.style.setProperty('--accent', get().accent)
  },

  update: (patch) => {
    set(patch)
    const { theme, accent, density, fontSize, codeFont, defaultModelId, defaultMode } = get()
    document.documentElement.dataset.theme = theme
    document.documentElement.style.setProperty('--accent', accent)
    // The interface type scale is driven by this one custom property. Setting
    // the root font-size instead would rescale everything the tokens do not
    // own, which is the failure the scale exists to prevent. The slider used to
    // be wired to nothing at all.
    document.documentElement.style.setProperty('--ui-font-size', `${clampUiFontSize(fontSize)}px`)
    bridge
      .storeSet(SETTINGS_KEY, { theme, accent, density, fontSize, codeFont, defaultModelId, defaultMode })
      .catch(() => {})
    void import('./cloudSync').then(({ scheduleCloudSync }) => scheduleCloudSync())
  },
}))

/**
 * Read every setting without re-rendering on unrelated changes.
 *
 * `useSettingsStore()` with no argument subscribes to the whole store, so the
 * component re-renders whenever anything changes. `useShallow` makes the
 * returned object reference-stable when no field actually changed, which is
 * what a settings screen wants: it re-renders when a setting is edited, not
 * when some other key is touched.
 */
export function useAllSettings(): SettingsState {
  return useSettingsStore(useShallow((state) => state))
}
