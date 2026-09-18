import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { EmptyStates } from './EmptyStates'

describe('EmptyStates', () => {
  it('downloading: shows the copy and a skeleton', () => {
    render(<EmptyStates kind="downloading" />)
    expect(screen.getByText('Getting your notes…')).toBeInTheDocument()
    expect(screen.getByTestId('empty-downloading')).toBeInTheDocument()
  })

  it('downloading-offline: shows the waiting copy, no skeleton, no retry', () => {
    render(<EmptyStates kind="downloading-offline" />)
    expect(screen.getByText('Waiting for a connection.')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('empty: shows the primary action and calls onWriteFirstNote', () => {
    const onWriteFirstNote = vi.fn()
    render(<EmptyStates kind="empty" onWriteFirstNote={onWriteFirstNote} />)
    fireEvent.click(screen.getByRole('button', { name: 'Write your first note' }))
    expect(onWriteFirstNote).toHaveBeenCalled()
  })

  it('no-results: interpolates the query, quoted, with no action button', () => {
    render(<EmptyStates kind="no-results" query="grocery" />)
    expect(screen.getByText('No notes match "grocery"')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('signin-offline: renders the failure copy as an alert', () => {
    render(<EmptyStates kind="signin-offline" />)
    expect(screen.getByRole('alert')).toHaveTextContent(/Can't reach Google to sign in/)
  })
})
