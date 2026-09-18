// src/app/relativeTime.ts
// The list row's meta line (05-screens.md §2, point 3): "4m ago", "3h ago", "2d ago". Exact
// granularity is Frontend's call — the spec doesn't fix it beyond the prototype's.

export function relativeTime(ms: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - ms)
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
