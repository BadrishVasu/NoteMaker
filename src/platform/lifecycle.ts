// src/platform/lifecycle.ts
// Android backgrounds this app far more often than it closes it: a debounce timer that never
// fires because the tab was hidden mid-countdown is lost writing. This file wires the three
// browser signals that reliably precede that loss to one flush callback, and gives back a
// teardown so `AppShell` can wire it exactly once.

export function attachLifecycleFlush(flush: () => void): () => void {
  const onVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') flush()
  }

  window.addEventListener('blur', flush)
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('pagehide', flush)

  return () => {
    window.removeEventListener('blur', flush)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('pagehide', flush)
  }
}

/** `visibilitychange → visible`: one of the engine's wake sources (architecture, push triggers). */
export function onBecameVisible(wake: () => void): () => void {
  const onVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') wake()
  }
  document.addEventListener('visibilitychange', onVisibilityChange)
  return () => document.removeEventListener('visibilitychange', onVisibilityChange)
}
