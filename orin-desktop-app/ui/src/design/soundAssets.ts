/**
 * The brand sound pack, as shipped files.
 *
 * `sound.ts` synthesises the same five cues at runtime from oscillators. That
 * stays the default: it costs no download, no decode, and carries no licence,
 * and it works with no filesystem access at all. The WAVs exist so the brand
 * has an audible identity that does not depend on whichever surface is playing
 * it -- a website, a video, a support clip -- rendered from the *same* cue
 * table by `scripts/generate-brand-sounds.py`.
 *
 * Because there are two renderings of one design, the risk is drift rather than
 * absence: a cue added to `TONES` and never rendered to a file would leave a
 * gap that nothing notices. `test/brand-assets.test.mjs` asserts the two sets
 * are the same set, so a new cue cannot quietly ship runtime-only.
 *
 * Files live in `ui/public/brand/` (served at `/brand/...`) and are generated
 * into `brand/sounds/`. Both are produced by the same script; this module is
 * only the manifest.
 */

import type { SoundName } from './sound'

/** Base path under `ui/public`, so the files are served and packaged. */
export const SOUND_ASSET_BASE = '/brand'

/**
 * Cue -> WAV filename. One entry per `SoundName`; the test asserts the two
 * key sets match exactly, so this cannot fall behind `TONES`.
 */
export const SOUND_ASSETS: Readonly<Record<SoundName, string>> = Object.freeze({
  send: 'orin-send.wav',
  thinking: 'orin-thinking.wav',
  reply: 'orin-reply.wav',
  success: 'orin-success.wav',
  error: 'orin-error.wav',
})

export function soundAssetUrl(name: SoundName): string {
  return `${SOUND_ASSET_BASE}/${SOUND_ASSETS[name]}`
}

export type SoundAssetState = 'idle' | 'loading' | 'ready' | 'unavailable'

interface CacheEntry {
  state: SoundAssetState
  element?: HTMLAudioElement
}

const cache = new Map<SoundName, CacheEntry>()

/**
 * Preloads the pack. Optional: calling it means the first cue is not delayed by
 * a fetch, and failing is harmless because synthesis covers every case.
 */
export function preloadSoundAssets(): void {
  for (const name of Object.keys(SOUND_ASSETS) as SoundName[]) {
    void loadSoundAsset(name)
  }
}

function loadSoundAsset(name: SoundName): Promise<CacheEntry | null> {
  const existing = cache.get(name)
  if (existing) {
    if (existing.state === 'loading' && existing.element) return Promise.resolve(existing)
    if (existing.state === 'ready' && existing.element) return Promise.resolve(existing)
    if (existing.state === 'unavailable') return Promise.resolve(null)
  }
  if (typeof window === 'undefined' || typeof Audio === 'undefined') {
    cache.set(name, { state: 'unavailable' })
    return Promise.resolve(null)
  }
  const element = new Audio(soundAssetUrl(name))
  element.preload = 'auto'
  cache.set(name, { state: 'loading', element })
  return new Promise((resolve) => {
    const settle = (state: SoundAssetState) => {
      // A cue is short; if it has not decoded by the time it is asked for,
      // treat the pack as unavailable rather than cutting the click off.
      const entry: CacheEntry = state === 'ready' ? { state, element } : { state }
      cache.set(name, entry)
      resolve(state === 'ready' ? entry : null)
    }
    element.addEventListener('canplaythrough', () => settle('ready'), { once: true })
    element.addEventListener('error', () => settle('unavailable'), { once: true })
    element.load()
  })
}

/**
 * Plays a cue from the shipped file, if it is loaded. Returns false when the
 * caller should fall back to `playSound`'s synthesis, which is the normal case
 * until the pack has preloaded and the only case on a cold start.
 *
 * Volume is applied to the element rather than baked in, so the settings
 * slider keeps working the same way it does for the synthesised path.
 */
export async function playSoundFile(name: SoundName, volume = 1): Promise<boolean> {
  const master = Math.max(0, Math.min(1, volume))
  if (master === 0) return false
  const entry = await loadSoundAsset(name)
  if (!entry?.element) return false
  const element = entry.element
  element.volume = master
  // Replaying an in-flight cue restarts it rather than queueing, which matches
  // the synthesised path: a second "thinking" retriggers, it does not stack.
  element.currentTime = 0
  try {
    await element.play()
    return true
  } catch {
    // Autoplay policy or a decode failure. Synthesis is right behind this.
    return false
  }
}
