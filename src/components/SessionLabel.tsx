import { useEffect, useState } from 'react'
import { TILE_COLORS, autoColor } from '../attention'
import type { Session, SessionLabel as LabelEntry } from '../types'

interface Props {
  session: Session
  entry: LabelEntry | undefined
  onSave: (patch: { label?: string; color?: string }) => void
  /** Renders the colour swatch picker alongside the name. */
  withColor?: boolean
}

/**
 * Short, stable identifier: your label if you set one, otherwise Claude's
 * derived process name (`the-hunt-3`). Deliberately NOT the AI title — that
 * runs to a full sentence and truncates to mush in a tile head or a queue chip.
 * The AI title is shown separately as the session's current subject.
 */
export function displayName(s: Session, entry: LabelEntry | undefined): string {
  return entry?.label?.trim() || s.name
}

export function colorOf(s: Session, entry: LabelEntry | undefined): string {
  return entry?.color || autoColor(s.sessionId)
}

/** Click-to-rename label. Enter commits, Escape reverts. */
export default function SessionLabelEditor({ session, entry, onSave, withColor }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    if (!editing) setDraft(entry?.label || '')
  }, [entry?.label, editing])

  const commit = () => {
    setEditing(false)
    if (draft.trim() !== (entry?.label || '')) onSave({ label: draft.trim() })
  }

  return (
    <span className="labeler">
      {editing ? (
        <input
          className="label-input"
          autoFocus
          value={draft}
          placeholder={session.aiTitle || session.name}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') {
              setDraft(entry?.label || '')
              setEditing(false)
            }
          }}
        />
      ) : (
        <button
          className="label-name"
          title="Click to rename this session"
          onClick={(e) => {
            e.stopPropagation()
            setEditing(true)
          }}
        >
          {displayName(session, entry)}
        </button>
      )}

      {withColor && !editing && (
        <span className="swatches" onClick={(e) => e.stopPropagation()}>
          {TILE_COLORS.map((c) => (
            <button
              key={c}
              className={`swatch t-${c} ${colorOf(session, entry) === c ? 'on' : ''}`}
              title={c}
              onClick={() => onSave({ color: c })}
            />
          ))}
        </span>
      )}
    </span>
  )
}
