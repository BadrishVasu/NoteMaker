// src/app/Editor.tsx — 05-screens.md §4.
//
// Redirect preservation (§9's hard requirement): the body `<textarea>` is UNCONTROLLED
// (`defaultValue`, never `value`). React only applies `defaultValue` at mount, so when the
// document identity redirects (`note.id` changes but the content is byte-identical — the
// invariant a redirect guarantees) and the *caller* does not remount this component (no `key`
// change), the DOM node is untouched: its `value`, `selectionStart`/`selectionEnd` and
// `scrollTop` survive automatically, with no special-case code here. A genuine switch to a
// different Note DOES need a fresh `defaultValue`, so the caller (`AppShell`) mounts `Editor`
// keyed by a `switchToken` that advances on navigation but not on a redirect — see AppShell.

import { useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import type { LocalNote, NoteId } from '../domain/note'
import { exceedsSyncLimit } from '../domain/size'
import { TitleField } from './TitleField'
import { Preview } from './markdown'

/** 05-screens.md §9. At step 6, `Compare` is rendered but inert (ticket 11 wires it). Keyed to
 *  the redirect's destination id so AppShell can tell "already dismissed for this note" apart
 *  from "a fresh redirect happened again". */
export interface ConflictBanner {
  noteId: NoteId
  text: string
}

export interface EditorProps {
  note: LocalNote
  /** The number this Note would be assigned if its Custom title were emptied right now —
   *  computed by the caller over the live corpus (`nextUntitledN`), never guessed here. */
  untitledPreviewN: number
  onTitleInput: (value: string) => void
  onBodyInput: (value: string) => void
  onDelete: () => void
  onRestore: () => void
  onBack?: () => void
  banner: ConflictBanner | null
  onDismissBanner: () => void
  /** True only on the render right after this Note was created (AppShell's `pendingFocusId`).
   *  Distinguishes "brand new Note" from "existing Note that happens to have an empty body". */
  autoFocusBody: boolean
  /** Set on a re-seed remount (a remote edit to this idle, open Note): keep focus in the field
   *  that had it, caret at the start (05-screens, Editor, UI/UX step 7). Never moves focus in. */
  refocus?: 'body' | 'title' | null
}

export function Editor({
  note,
  untitledPreviewN,
  onTitleInput,
  onBodyInput,
  onDelete,
  onRestore,
  onBack,
  banner,
  onDismissBanner,
  autoFocusBody,
  refocus = null,
}: EditorProps) {
  const [title, setTitle] = useState(note.title)
  const [titleIsCustom, setTitleIsCustom] = useState(note.titleIsCustom)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewText, setPreviewText] = useState('')
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const readOnly = note.deletedAt !== null

  // New Note focus: body, never title (05-screens.md §4) — `autoFocusBody` is true only on the
  // mount right after AppShell created this Note, so reopening an existing (possibly also
  // empty) Note never steals focus.
  // A LAYOUT effect, not a passive one: it runs inside the commit that inserts the textarea, so
  // there is no frame where the body is on screen but focus is still on "New note" and a fast
  // first keystroke is lost. The passive version made AppShell's focus test flaky (~1 in 6).
  useLayoutEffect(() => {
    if (autoFocusBody && !readOnly) bodyRef.current?.focus()
    else if (refocus === 'body') bodyRef.current?.focus()
    else if (refocus === 'title') rootRef.current?.querySelector<HTMLInputElement>('input[aria-label="Title"]')?.focus()
    // Mount-only: this must not refire on a redirect or a content update for this same Note.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleTitleChange(value: string): void {
    // The one-way latch: ANY call here is the cue to latch, on keystroke one, forever. There is
    // no path back to false anywhere in this file or any other.
    setTitleIsCustom(true)
    setTitle(value)
    onTitleInput(value)
  }

  function handleBodyInput(e: FormEvent<HTMLTextAreaElement>): void {
    onBodyInput(e.currentTarget.value)
  }

  function togglePreview(): void {
    if (!previewOpen) setPreviewText(bodyRef.current?.value ?? note.body)
    setPreviewOpen((v) => !v)
  }

  const status = note.pendingRev === null ? 'Saved' : 'Saved on this device'
  const tooLarge = exceedsSyncLimit(note)

  return (
    <div className="editor" ref={rootRef}>
      <div className="editor-toolbar">
        {onBack && (
          <button type="button" aria-label="Back to notes" onClick={onBack}>
            ←
          </button>
        )}
        <button type="button" aria-pressed={previewOpen} onClick={togglePreview}>
          Preview
        </button>
        <span className="spacer" />
        <span className="status">{status}</span>
        {!readOnly && (
          <button type="button" aria-label="Move to Trash" onClick={onDelete}>
            🗑
          </button>
        )}
      </div>

      {readOnly && (
        <div className="trash-banner">
          <p>
            This note is in the Trash and can&apos;t be edited. It&apos;s purged 30 days after
            deletion.
          </p>
          <button type="button" onClick={onRestore}>
            Restore
          </button>
        </div>
      )}

      {banner && (
        <div className="conflict-banner">
          <p>{banner.text}</p>
          {/* Step 6: inert per 05-screens.md §9 — ticket 11 wires the real Compare surface. */}
          <button type="button" onClick={() => console.info('Compare: ticket 11')}>
            Compare
          </button>
          <button type="button" aria-label="Dismiss" onClick={onDismissBanner}>
            ✕
          </button>
        </div>
      )}

      <TitleField
        titleIsCustom={titleIsCustom}
        title={title}
        resolvedPlaceholder={note.title}
        untitledPreviewN={untitledPreviewN}
        onChange={handleTitleChange}
        disabled={readOnly}
      />

      {previewOpen ? (
        <Preview source={previewText} />
      ) : (
        <textarea
          ref={bodyRef}
          className="body"
          aria-label="Note body"
          placeholder={note.body === '' ? 'Start writing…' : undefined}
          defaultValue={note.body}
          disabled={readOnly}
          onInput={handleBodyInput}
        />
      )}

      {tooLarge && <p className="size-strip">This note is too large to sync. Shorten it to sync.</p>}
    </div>
  )
}
