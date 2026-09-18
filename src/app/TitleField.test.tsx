import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TitleField } from './TitleField'

describe('TitleField', () => {
  it('state 1 (Derived/Default): empty value, muted placeholder, hint line', () => {
    render(
      <TitleField
        titleIsCustom={false}
        title=""
        resolvedPlaceholder="Grocery list"
        untitledPreviewN={3}
        onChange={() => {}}
        disabled={false}
      />,
    )
    const input = screen.getByRole('textbox', { name: 'Title' }) as HTMLInputElement
    expect(input.value).toBe('')
    expect(input.placeholder).toBe('Grocery list')
    expect(
      screen.getByText('Following the first line of the note. Type here to name it yourself.'),
    ).toBeInTheDocument()
  })

  it('state 2 (Custom, non-empty): real value, no hint line', () => {
    render(
      <TitleField
        titleIsCustom
        title="My Title"
        resolvedPlaceholder=""
        untitledPreviewN={1}
        onChange={() => {}}
        disabled={false}
      />,
    )
    const input = screen.getByRole('textbox', { name: 'Title' }) as HTMLInputElement
    expect(input.value).toBe('My Title')
    expect(screen.queryByText(/Following the first line/)).not.toBeInTheDocument()
  })

  it('state 3 (Custom, emptied): empty value, the number-substituted hint', () => {
    render(
      <TitleField
        titleIsCustom
        title=""
        resolvedPlaceholder=""
        untitledPreviewN={7}
        onChange={() => {}}
        disabled={false}
      />,
    )
    expect(screen.getByText(/Untitled Note 7/)).toBeInTheDocument()
    expect(screen.getByText(/doesn.t go back to following the first line/)).toBeInTheDocument()
  })

  it('is a single accessible field named "Title" in every state', () => {
    const { rerender } = render(
      <TitleField
        titleIsCustom={false}
        title=""
        resolvedPlaceholder="x"
        untitledPreviewN={1}
        onChange={() => {}}
        disabled={false}
      />,
    )
    expect(screen.getAllByRole('textbox', { name: 'Title' })).toHaveLength(1)
    rerender(
      <TitleField
        titleIsCustom
        title="Custom"
        resolvedPlaceholder="x"
        untitledPreviewN={1}
        onChange={() => {}}
        disabled={false}
      />,
    )
    expect(screen.getAllByRole('textbox', { name: 'Title' })).toHaveLength(1)
  })

  it('fires onChange with the raw typed value; latch logic is the caller’s job', async () => {
    const onChange = vi.fn()
    render(
      <TitleField
        titleIsCustom={false}
        title=""
        resolvedPlaceholder="x"
        untitledPreviewN={1}
        onChange={onChange}
        disabled={false}
      />,
    )
    const input = screen.getByRole('textbox', { name: 'Title' })
    await userEvent.type(input, 'M')
    expect(onChange).toHaveBeenCalledWith('M')
  })

  it('disables the input when disabled=true (Trash read-only state)', () => {
    render(
      <TitleField
        titleIsCustom={false}
        title=""
        resolvedPlaceholder="x"
        untitledPreviewN={1}
        onChange={() => {}}
        disabled
      />,
    )
    expect(screen.getByRole('textbox', { name: 'Title' })).toBeDisabled()
  })
})
