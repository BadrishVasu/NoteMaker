import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Editor } from './Editor'
import { makeRow, resetRows } from '../test/rows'
import { asNoteId, asRev } from '../domain/note'

function baseProps(overrides: Partial<React.ComponentProps<typeof Editor>> = {}) {
  return {
    note: makeRow({ title: 'A note', body: 'Some body text' }),
    untitledPreviewN: 1,
    onTitleInput: vi.fn(),
    onBodyInput: vi.fn(),
    onDelete: vi.fn(),
    onRestore: vi.fn(),
    banner: null,
    onDismissBanner: vi.fn(),
    autoFocusBody: false,
    ...overrides,
  }
}

describe('Editor', () => {
  beforeEach(() => resetRows())

  it('shows "Saved" for a clean note and "Saved on this device" for a dirty one', () => {
    const clean = makeRow({ pendingRev: null })
    const { rerender } = render(<Editor {...baseProps({ note: clean })} />)
    expect(screen.getByText('Saved')).toBeInTheDocument()

    const dirty = makeRow({ pendingRev: asRev('p1') })
    rerender(<Editor {...baseProps({ note: dirty })} />)
    expect(screen.getByText('Saved on this device')).toBeInTheDocument()
  })

  it('calls onBodyInput on every keystroke in the body', () => {
    const onBodyInput = vi.fn()
    render(<Editor {...baseProps({ onBodyInput })} />)
    fireEvent.input(screen.getByLabelText('Note body'), { target: { value: 'new text' } })
    expect(onBodyInput).toHaveBeenCalledWith('new text')
  })

  it('Preview toggles the body view without persisting state across a Note switch', () => {
    render(<Editor {...baseProps({ note: makeRow({ body: '# Heading' }) })} />)
    const previewButton = screen.getByRole('button', { name: 'Preview' })
    expect(previewButton).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(previewButton)
    expect(previewButton).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('heading', { level: 1, name: 'Heading' })).toBeInTheDocument()
    fireEvent.click(previewButton)
    expect(screen.getByLabelText('Note body')).toBeInTheDocument()
  })

  it('delete button is present for a live note and absent for a trashed one', () => {
    const { rerender } = render(<Editor {...baseProps()} />)
    expect(screen.getByRole('button', { name: 'Move to Trash' })).toBeInTheDocument()

    const trashed = makeRow({ deletedAt: Date.now() })
    rerender(<Editor {...baseProps({ note: trashed })} />)
    expect(screen.queryByRole('button', { name: 'Move to Trash' })).not.toBeInTheDocument()
  })

  it('Trash state disables title and body and shows the Restore banner', () => {
    const onRestore = vi.fn()
    const trashed = makeRow({ deletedAt: Date.now() })
    render(<Editor {...baseProps({ note: trashed, onRestore })} />)
    expect(screen.getByLabelText('Title')).toBeDisabled()
    expect(screen.getByLabelText('Note body')).toBeDisabled()
    expect(screen.getByText(/purged 30 days after deletion/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))
    expect(onRestore).toHaveBeenCalled()
  })

  it('shows the too-large-to-sync strip only when the note exceeds the byte limit', () => {
    const huge = makeRow({ title: 'x', body: 'a'.repeat(500 * 1024) })
    render(<Editor {...baseProps({ note: huge })} />)
    expect(screen.getByText('This note is too large to sync. Shorten it to sync.')).toBeInTheDocument()
  })

  it('does not show the too-large strip for an ordinary note', () => {
    render(<Editor {...baseProps()} />)
    expect(screen.queryByText(/too large to sync/)).not.toBeInTheDocument()
  })

  it('renders the conflict banner with an inert Compare button and a working Dismiss', () => {
    const onDismissBanner = vi.fn()
    render(
      <Editor
        {...baseProps({
          banner: { noteId: asNoteId('n-conflict'), text: 'This note was edited on another device too.' },
          onDismissBanner,
        })}
      />,
    )
    expect(screen.getByRole('button', { name: 'Compare' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(onDismissBanner).toHaveBeenCalled()
  })

  it('focuses the body on mount when the caller flags this as a brand-new Note', () => {
    render(<Editor {...baseProps({ note: makeRow({ body: '' }), autoFocusBody: true })} />)
    expect(screen.getByLabelText('Note body')).toHaveFocus()
  })

  it('does not steal focus for an existing note, even one with an empty body', () => {
    render(<Editor {...baseProps({ note: makeRow({ body: '' }), autoFocusBody: false })} />)
    expect(screen.getByLabelText('Note body')).not.toHaveFocus()
  })

  it(
    'the hard requirement: a redirect (id change, identical content, same component instance) ' +
      'preserves the textarea value, selection and scroll pixel-for-pixel',
    () => {
      const from = makeRow({ id: asNoteId('from-id'), body: 'line one\nline two\nline three'.repeat(50) })
      const { rerender } = render(<Editor {...baseProps({ note: from })} />)
      const textarea = screen.getByLabelText('Note body') as HTMLTextAreaElement

      textarea.focus()
      textarea.setSelectionRange(5, 9)
      textarea.scrollTop = 12

      const valueBefore = textarea.value
      const selStartBefore = textarea.selectionStart
      const selEndBefore = textarea.selectionEnd
      const scrollBefore = textarea.scrollTop

      // Simulate the redirect: same content, different id, caller does NOT change `key`.
      const to = { ...from, id: asNoteId('to-id') }
      rerender(<Editor {...baseProps({ note: to })} />)

      const textareaAfter = screen.getByLabelText('Note body') as HTMLTextAreaElement
      expect(textareaAfter).toBe(textarea) // same DOM node — no remount
      expect(textareaAfter.value).toBe(valueBefore)
      expect(textareaAfter.selectionStart).toBe(selStartBefore)
      expect(textareaAfter.selectionEnd).toBe(selEndBefore)
      expect(textareaAfter.scrollTop).toBe(scrollBefore)
    },
  )
})
