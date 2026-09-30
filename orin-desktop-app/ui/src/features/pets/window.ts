/**
 * Which window are we in?
 *
 * The pet window is rendered by the same bundle as the main window, so
 * something has to tell them apart. The window label is the only difference
 * that does not need a second entry point to stay in sync with the first.
 */
export function isPetWindow(): boolean {
  if (typeof window === 'undefined') return false
  if (!('__TAURI_INTERNALS__' in window)) return false
  try {
    const search = new URLSearchParams(window.location.search)
    if (search.get('label')) return search.get('label') === 'pet'
  } catch {
    // fall through to the label below
  }
  const label = (window as { __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } } })
    .__TAURI_INTERNALS__?.metadata?.currentWindow?.label
  return label === 'pet'
}
