import { useState } from 'react'
import { deleteSummary, generateSummary, spawnSession, summaryMarkdown } from '../api'
import type { SessionSummary } from '../types'
import { relTime } from '../util'

/**
 * Recently finished threads, as reusable material rather than an archive.
 *
 * The point is not to read these here — it is to get them into a prompt. Copy
 * puts the checkpoint on the clipboard for pasting anywhere; seed opens a fresh
 * session in the same directory already carrying the checkpoint as context.
 */
export default function WrappedList({
  summaries,
  onChanged,
}: {
  summaries: SessionSummary[]
  onChanged: (s: SessionSummary[]) => void
}) {
  if (!summaries.length) {
    return (
      <div className="empty">
        No wrapped threads yet. Run <code>/wrap</code> in a session before closing it, or heddle will
        capture the facts automatically when a session ends.
      </div>
    )
  }
  return (
    <>
      {summaries.map((s) => (
        <WrappedRow key={s.sessionId} s={s} onChanged={onChanged} />
      ))}
    </>
  )
}

function seedPrompt(s: SessionSummary): string {
  const lines = [`Picking up from a previous session: "${s.title}".`, '']
  if (s.done.length) {
    lines.push('Already done:')
    for (const d of s.done) lines.push(`- ${d}`)
    lines.push('')
  }
  if (s.current) lines.push(`Was in flight: ${s.current}`, '')
  if (s.next.length) {
    lines.push('Remaining:')
    for (const n of s.next) lines.push(`- ${n}`)
    lines.push('')
  }
  if (!s.done.length && !s.next.length && s.filesEdited.length) {
    lines.push(`Files touched last time: ${s.filesEdited.slice(0, 12).join(', ')}`, '')
  }
  lines.push('Read the relevant files before changing anything, then continue.')
  return lines.join('\n')
}

function WrappedRow({ s, onChanged }: { s: SessionSummary; onChanged: (x: SessionSummary[]) => void }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState('')

  const flash = (msg: string) => {
    setCopied(msg)
    setTimeout(() => setCopied(''), 1600)
  }

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      flash(label)
    } catch {
      flash('copy blocked')
    }
  }

  const wrapped = s.source === 'wrapped'

  return (
    <div className={`wrapped ${wrapped ? 'is-wrapped' : ''}`}>
      <button className="wrapped-head" onClick={() => setOpen((v) => !v)}>
        <span className="wrapped-caret">{open ? '▾' : '▸'}</span>
        <span className="wrapped-title">{s.title}</span>
        <span className="pill dim">{s.project || '—'}</span>
        {wrapped ? (
          <span className="pill ready" title="Written by the model via /wrap">
            wrapped
          </span>
        ) : (
          <span className="pill dim" title="Extracted mechanically — facts only">
            facts
          </span>
        )}
        <span className="grow" />
        <span className="muted">{relTime(s.endedAt)}</span>
      </button>

      {open && (
        <div className="wrapped-body">
          {s.done.length > 0 && (
            <>
              <div className="queue-title">done</div>
              <ul className="md-list">
                {s.done.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </>
          )}
          {s.current && (
            <>
              <div className="queue-title">in flight</div>
              <p className="md-p">{s.current}</p>
            </>
          )}
          {s.next.length > 0 && (
            <>
              <div className="queue-title">next</div>
              <ul className="md-list">
                {s.next.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </>
          )}
          {!wrapped && (
            <>
              <div className="queue-title">asked</div>
              <ul className="md-list">
                {s.asks.slice(-5).map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
              {s.filesEdited.length > 0 && (
                <div className="wrapped-files">
                  {s.filesEdited.length} file{s.filesEdited.length === 1 ? '' : 's'} changed ·{' '}
                  {s.filesEdited
                    .slice(0, 4)
                    .map((f) => f.split('/').pop())
                    .join(', ')}
                  {s.filesEdited.length > 4 ? ` +${s.filesEdited.length - 4}` : ''}
                </div>
              )}
            </>
          )}
        </div>
      )}

      <div className="wrapped-actions">
        <button
          className="ghost-btn"
          title="Copy the checkpoint as markdown"
          onClick={() => summaryMarkdown(s.sessionId).then((r) => copy(r.markdown, 'copied')).catch(() => flash('failed'))}
        >
          copy
        </button>
        <button
          className="ghost-btn"
          title="Copy a ready-made prompt that hands this context to another session"
          onClick={() => copy(seedPrompt(s), 'prompt copied')}
        >
          copy as prompt
        </button>
        <button
          className="ghost-btn"
          disabled={!s.cwd}
          title={s.cwd ? 'Open a new terminal already carrying this context' : 'No directory recorded'}
          onClick={() => spawnSession(s.cwd, { prompt: seedPrompt(s) })}
        >
          seed new session
        </button>
        <span className="grow" />
        {copied && <span className="muted flash">{copied}</span>}
        <button
          className="ghost-btn"
          title="Rebuild from the transcript"
          onClick={() => generateSummary(s.sessionId, s.slug).then((r) => onChanged(r.summaries)).catch(() => {})}
        >
          ↻
        </button>
        <button
          className="ghost-btn danger"
          onClick={() => deleteSummary(s.sessionId).then((r) => onChanged(r.summaries)).catch(() => {})}
        >
          ×
        </button>
      </div>
    </div>
  )
}
