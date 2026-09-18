// src/app/SearchField.tsx
// 05-screens.md §3. Always visible, fires on every keystroke, no submit/debounce/scope here —
// matching/ranking/scope is ticket 06; this component only fixes that the field exists.

export interface SearchFieldProps {
  value: string
  onChange: (value: string) => void
  placeholder: string
}

export function SearchField({ value, onChange, placeholder }: SearchFieldProps) {
  return (
    <input
      type="search"
      className="search-field"
      aria-label={placeholder}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}
