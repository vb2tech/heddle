import { useEffect, useMemo, useState } from 'react'
import { createIdea, deleteIdea, fetchHistory, fetchIdeas, spawnSession, updateIdea } from '../api'
import type { HistoryEntry, Idea, Session } from '../types'
import { relTime } from '../util'

interface Props {
  sessions: Session[]
  focus: Session | null
}

type Tab = 'ideas' | 'history'

const NEXT_STATUS: Record<string, Idea['status']> = { open: 'doing', doing: 'done', done: 'open' }

/**
 * A staging area for work that isn't running yet. An idea can be launched
 * straight into a fresh session, which is the one write path this tool has into
 * Claude: `claude "<prompt>"` in a new terminal.
 */
export default function IdeasPane({ sessions, focus }: Props) {
  const [tab, setTab] = useState<Tab>('ideas')
  const [ideas, setIdeas] = useState<Idea[]>([])
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [draft, setDraft] = useState('')
  const [filter, setFilter] = useState('')
  const [target, setTarget] = useState('')

  useEffect(() => {
    fetchIdeas().then((r) => setIdeas(r.ideas)).catch(() => {})
  }, [])

  useEffect(() => {
    if (tab === 'history' && !history.length) fetchHistory().then((r) => setHistory(r.history)).catch(() => {})
  }, [tab, history.length])

  // Default the launch target to whatever session is in focus.
  useEffect(() => {
    if (focus && !target) setTarget(focus.cwd)
  }, [focus, target])

  const cwds = useMemo(() => {
    const set = new Set<string>()
    for (const s of sessions) if (s.cwd) set.add(s.cwd)
    for (const h of history) if (h.cwd) set.add(h.cwd)
    for (const i of ideas) if (i.cwd) set.add(i.cwd)
    return [...set].sort()
  }, [sessions, history, ideas])

  const add = async (text: string, cwd = target) => {
    const t = text.trim()
    if (!t) return
    const r = await createIdea(t, cwd ? cwd.split('/').pop() || '' : '', cwd)
    setIdeas((prev) => [r.idea, ...prev])
  }

  const cycle = async (idea: Idea) => {
    const status = NEXT_STATUS[idea.status] || 'open'
    setIdeas((prev) => prev.map((i) => (i.id === idea.id ? { ...i, status } : i)))
    updateIdea(idea.id, { status }).catch(() => {})
  }

  const remove = async (id: string) => {
    setIdeas((prev) => prev.filter((i) => i.id !== id))
    deleteIdea(id).catch(() => {})
  }

  const launch = async (idea: Idea) => {
    const cwd = idea.cwd || target
    if (!cwd) return
    await spawnSession(cwd, { prompt: idea.text })
    cycle(idea)
  }

  const shown = ideas.filter((i) => !filter || i.text.toLowerCase().includes(filter.toLowerCase()))
  const shownHistory = history.filter(
    (h) => !filter || h.text.toLowerCase().includes(filter.toLowerCase()) || h.project.includes(filter),
  )

  return (
    <section className="pane ideas">
      <header className="pane-head">
        <div className="pane-title">
          <span className="pane-kicker">queue</span>
          <strong>{ideas.filter((i) => i.status !== 'done').length} open</strong>
        </div>
        <div className="pane-actions">
          <input
            className="filter"
            placeholder="filter…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <button className="toggle" data-on={tab === 'ideas'} onClick={() => setTab('ideas')}>
            ideas
          </button>
          <button className="toggle" data-on={tab === 'history'} onClick={() => setTab('history')}>
            past prompts
          </button>
        </div>
      </header>

      <div className="idea-compose">
        <textarea
          placeholder="Park an idea…  (⌘⏎ to add)"
          value={draft}
          rows={2}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              add(draft)
              setDraft('')
            }
          }}
        />
        <div className="idea-compose-row">
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">no directory</option>
            {cwds.map((c) => (
              <option key={c} value={c}>
                {c.split('/').slice(-2).join('/')}
              </option>
            ))}
          </select>
          <button
            className="ghost-btn"
            onClick={() => {
              add(draft)
              setDraft('')
            }}
          >
            add
          </button>
        </div>
      </div>

      <div className="pane-scroll">
        {tab === 'ideas' &&
          (shown.length ? (
            shown.map((i) => (
              <div className={`idea ${i.status}`} key={i.id}>
                <button className={`task-dot ${i.status}`} onClick={() => cycle(i)} title={`status: ${i.status}`} />
                <span className="idea-text">{i.text}</span>
                {i.cwd && <span className="pill dim">{i.cwd.split('/').pop()}</span>}
                <span className="grow" />
                <span className="muted">{relTime(i.createdAt)}</span>
                <button
                  className="ghost-btn"
                  disabled={!i.cwd && !target}
                  title={i.cwd || target ? 'Open a new terminal running this prompt' : 'Pick a directory first'}
                  onClick={() => launch(i)}
                >
                  launch
                </button>
                <button className="ghost-btn danger" onClick={() => remove(i.id)}>
                  ×
                </button>
              </div>
            ))
          ) : (
            <div className="empty">Nothing queued. Park an idea above, or promote one from past prompts.</div>
          ))}

        {tab === 'history' &&
          (shownHistory.length ? (
            shownHistory.slice(0, 150).map((h) => (
              <div className="idea history" key={h.id}>
                <span className="idea-text">{h.text}</span>
                <span className="pill dim">{h.project}</span>
                <span className="grow" />
                <span className="muted">{relTime(h.timestamp)}</span>
                <button className="ghost-btn" onClick={() => add(h.text, h.cwd)}>
                  queue
                </button>
              </div>
            ))
          ) : (
            <div className="empty">No prompt history.</div>
          ))}
      </div>
    </section>
  )
}
