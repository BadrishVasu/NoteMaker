// src/platform/prefs.ts
// `Auto sync` is a per-DEVICE preference, not per-uid data: it deliberately does not live in
// the store's `meta` (03's MetaShape is a settled three-key schema covered by the store
// contract suite, and a UI toggle for this browser does not belong in it). It lives in
// `localStorage`, read/written only through this file.
//
// A preference read must never take the app down: Safari private mode (and some locked-down
// embeds) throw on `localStorage` access entirely. Both directions fall back to an in-memory
// value scoped to this module when that happens.

const KEY = 'notemaker:autoSync'

let memoryFallback = true

export function getAutoSync(): boolean {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw === null) return memoryFallback
    return raw === 'true'
  } catch {
    return memoryFallback
  }
}

export function setAutoSync(value: boolean): void {
  memoryFallback = value
  try {
    localStorage.setItem(KEY, String(value))
  } catch {
    // localStorage unavailable — the in-memory fallback above is now the source of truth
    // for the rest of this session.
  }
}
