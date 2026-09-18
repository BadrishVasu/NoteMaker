// src/app/TitleField.tsx
// 05-screens.md §5. Three visual states driven purely by `titleIsCustom` and the live value —
// never re-derived from `body`. The one-way latch itself is NOT decided in this component: any
// `onChange` call is the caller's cue to set `titleIsCustom: true` from then on (see AppShell) —
// there is no escape hatch here or anywhere else. Do not add one.

export interface TitleFieldProps {
  titleIsCustom: boolean
  title: string
  resolvedPlaceholder: string
  untitledPreviewN: number
  onChange: (value: string) => void
  disabled: boolean
}

export function TitleField({
  titleIsCustom,
  title,
  resolvedPlaceholder,
  untitledPreviewN,
  onChange,
  disabled,
}: TitleFieldProps) {
  if (!titleIsCustom) {
    return (
      <div className="title-field">
        <input
          className="title title--placeholder"
          aria-label="Title"
          value=""
          placeholder={resolvedPlaceholder}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        />
        <p className="title-hint">Following the first line of the note. Type here to name it yourself.</p>
      </div>
    )
  }

  if (title === '') {
    return (
      <div className="title-field">
        <input
          className="title"
          aria-label="Title"
          value=""
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        />
        <p className="title-hint">
          This note keeps its own title now — clearing it doesn&rsquo;t go back to following the
          first line. It&rsquo;s listed as <em>Untitled Note {untitledPreviewN}</em>.
        </p>
      </div>
    )
  }

  return (
    <div className="title-field">
      <input
        className="title"
        aria-label="Title"
        value={title}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
    </div>
  )
}
