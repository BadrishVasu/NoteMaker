import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SyncStrip } from './SyncStrip'

describe('SyncStrip', () => {
  it('renders nothing when the Outbox is empty, regardless of the flags', () => {
    const { container } = render(
      <SyncStrip pendingCount={0} autoSync={false} persistDenied={true} onSyncNow={() => {}} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('state 1: autoSync on, persist not denied — reassurance, not interactive', () => {
    render(<SyncStrip pendingCount={3} autoSync persistDenied={false} onSyncNow={() => {}} />)
    expect(screen.getByText("3 notes waiting to sync · they're safe on this device")).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('state 2: autoSync on, persist denied — bare sentence, reassurance drops', () => {
    render(<SyncStrip pendingCount={1} autoSync persistDenied={true} onSyncNow={() => {}} />)
    expect(screen.getByText('1 note waiting to sync.')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('state 3: autoSync off, persist not denied — the whole strip is the Sync now button', async () => {
    const onSyncNow = vi.fn()
    render(<SyncStrip pendingCount={2} autoSync={false} persistDenied={false} onSyncNow={onSyncNow} />)
    const button = screen.getByRole('button', { name: '2 notes waiting to sync · Sync now' })
    await userEvent.click(button)
    expect(onSyncNow).toHaveBeenCalled()
  })

  it('state 4: autoSync off, persist denied — same interactive strip as state 3', () => {
    render(<SyncStrip pendingCount={5} autoSync={false} persistDenied={true} onSyncNow={() => {}} />)
    expect(screen.getByRole('button', { name: '5 notes waiting to sync · Sync now' })).toBeInTheDocument()
  })

  it('singularizes exactly at 1', () => {
    render(<SyncStrip pendingCount={1} autoSync persistDenied={false} onSyncNow={() => {}} />)
    expect(screen.getByText(/^1 note waiting to sync/)).toBeInTheDocument()
  })
})
