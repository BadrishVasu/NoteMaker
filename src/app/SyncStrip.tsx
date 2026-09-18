// src/app/SyncStrip.tsx
// 05-screens.md §7, as amended by Builder's 2026-09-18 ruling: the reassurance clause and the
// action clause are INDEPENDENT, giving four states, not three. See the brief's correction #2.

export interface SyncStripProps {
  pendingCount: number
  autoSync: boolean
  persistDenied: boolean
  onSyncNow: () => void
}

export function SyncStrip({ pendingCount, autoSync, persistDenied, onSyncNow }: SyncStripProps) {
  if (pendingCount === 0) return null

  const noun = pendingCount === 1 ? 'note' : 'notes'
  const base = `${pendingCount} ${noun} waiting to sync`
  const showAction = !autoSync

  if (showAction) {
    const text = `${base} · Sync now`
    return (
      <button type="button" className="sync-strip sync-strip--action" aria-label={text} onClick={onSyncNow}>
        {text}
      </button>
    )
  }

  const text = persistDenied ? `${base}.` : `${base} · they're safe on this device`
  return <p className="sync-strip">{text}</p>
}
