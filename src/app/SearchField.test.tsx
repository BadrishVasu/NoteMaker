import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SearchField } from './SearchField'

describe('SearchField', () => {
  it('has an accessible name matching the caller-supplied subject', () => {
    render(<SearchField value="" onChange={() => {}} placeholder="Search trash" />)
    expect(screen.getByRole('searchbox', { name: 'Search trash' })).toBeInTheDocument()
  })

  it('fires onChange on every keystroke, with no submit step', async () => {
    const onChange = vi.fn()
    render(<SearchField value="" onChange={onChange} placeholder="Search notes" />)
    await userEvent.type(screen.getByRole('searchbox'), 'ab')
    expect(onChange).toHaveBeenNthCalledWith(1, 'a')
    expect(onChange).toHaveBeenNthCalledWith(2, 'b')
  })
})
