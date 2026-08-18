import { useEffect, useMemo, useRef, useState } from 'react'
import { createTodo, deleteTodo, fetchHistory, reorderTodos, spawnSession, updateTodo } from '../api'
import type { HistoryEntry, LabelMap, Session, Todo } from '../types'
import { attentionOf } from '../attention'
import { displayName } from '../components/SessionLabel'
import { relTime } from '../util'

type Tab = 'todo' | 'history'

const NEXT_STATUS: Record<string, Todo['status']> = { open: 'doing', doing: 'done', done: 'open' }

interface Props {
  todos: Todo[]
  sessions: Session[]
  labels: LabelMap
  focus: Session | null
  onSelect: (id: string) => void
  /** Optimistic local echo, corrected by the next snapshot. */
  onTodos: (todos: Todo[]) => void
}

/**
 * Your durable backlog, grouped by project. Distinct from the task lists Claude
 * builds for itself: those are per-session and die with the plan, these outlive
 * every session. Launching one binds it to the session that picks it up, so an
 * item in flight shows that session's live state.
 */
export default function TodoPane({ todos, sessions, labels, focus, onSelect, onTodos }: Props) {
  const [tab, setTab] = useState<Tab>('todo')
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [draft, setDraft] = useState('')
  const [filter, setFilter] = useState('')
  const [target, setTarget] = useState('')
  const [showDone, setShowDone] = useState(false)
  const dragId = useRef<string | null>(null)

  useEffect(() => {
    if (tab === 'history' && !history.length) fetchHistory().then((r) => setHistory(r.history)).catch(() => {})
  }, [tab, history.length])

  useEffect(() => {
    if (focus && !target) setTarget(focus.cwd)
  }, [focus, target])

  const cwds = useMemo(() => {
    const set = new Set<string>()
    for (const s of sessions) if (s.cwd) set.add(s.cwd)
    for (const t of todos) if (t.cwd) set.add(t.cwd)
    for (const h of history) if (h.cwd) set.add(h.cwd)
    return [...set].sort()
  }, [sessions, todos, history])

  const visible = todos.filter(
    (t) =>
      (showDone || t.status !== 'done') &&
      (!filter || t.text.toLowerCase().includes(filter.toLowerCase()) || t.project.includes(filter)),
  )

  // Grouped by project, but preserving the manual order within each group.
  const groups = useMemo(() => {
    const map = new Map<string, Todo[]>()
    for (const t of visible) {
      const key = t.project || 'unfiled'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(t)
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [visible])

  const add = async (text: string, cwd = target) => {
    if (!text.trim()) return
    const r = await createTodo(text.trim(), cwd)
    onTodos(r.todos)
  }

  const patch = (id: string, p: Partial<Todo>) => {
    onTodos(todos.map((t) => (t.id === id ? { ...t, ...p } : t)))
    updateTodo(id, p).then((r) => onTodos(r.todos)).catch(() => {})
  }

  const remove = (id: string) => {
    onTodos(todos.filter((t) => t.id !== id))
    deleteTodo(id).then((r) => onTodos(r.todos)).catch(() => {})
  }

  const launch = async (t: Todo) => {
    const cwd = t.cwd || target
    if (!cwd) return
    onTodos(todos.map((x) => (x.id === t.id ? { ...x, status: 'doing', launchedAt: Date.now() } : x)))
    await spawnSession(cwd, { prompt: t.text, todoId: t.id })
  }

  /** Drop `dragId` immediately before `overId` in the global order. */
  const dropOn = (overId: string) => {
    const from = dragId.current
    dragId.current = null
    if (!from || from === overId) return
    const ids = todos.map((t) => t.id).filter((id) => id !== from)
    const at = ids.indexOf(overId)
    if (at === -1) return
    ids.splice(at, 0, from)
    const byId = new Map(todos.map((t) => [t.id, t]))
    onTodos(ids.map((id) => byId.get(id)!).filter(Boolean))
    reorderTodos(ids).then((r) => onTodos(r.todos)).catch(() => {})
  }

  const openCount = todos.filter((t) => t.status !== 'done').length
  const doingCount = todos.filter((t) => t.status === 'doing').length

  return (
    <section className="pane todo">
      <header className="pane-head">
        <div className="pane-title">
          <span className="pane-kicker">todo</span>
          <strong>
            {openCount} open{doingCount ? ` · ${doingCount} in flight` : ''}
          </strong>
        </div>
        <div className="pane-actions">
          <input className="filter" placeholder="filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <button className="toggle" data-on={showDone} onClick={() => setShowDone((v) => !v)}>
            done
          </button>
          <button className="toggle" data-on={tab === 'todo'} onClick={() => setTab('todo')}>
            list
          </button>
          <button className="toggle" data-on={tab === 'history'} onClick={() => setTab('history')}>
            past prompts
          </button>
        </div>
      </header>

      <div className="idea-compose">
        <textarea
          placeholder="Add a todo…  (⌘⏎)"
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
            <option value="">unfiled</option>
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
        {tab === 'todo' &&
          (groups.length ? (
            groups.map(([project, items]) => (
              <div className="todo-group" key={project}>
                <div className="queue-title">
                  {project}
                  <span className="muted">{items.length}</span>
                </div>
                {items.map((t) => (
                  <TodoRow
                    key={t.id}
                    t={t}
                    sessions={sessions}
                    labels={labels}
                    canLaunch={!!(t.cwd || target)}
                    onCycle={() => patch(t.id, { status: NEXT_STATUS[t.status] || 'open' })}
                    onLaunch={() => launch(t)}
                    onRemove={() => remove(t.id)}
                    onSelect={onSelect}
                    onUnbind={() => patch(t.id, { sessionId: null, launchedAt: null })}
                    onDragStart={() => (dragId.current = t.id)}
                    onDropOn={() => dropOn(t.id)}
                  />
                ))}
              </div>
            ))
          ) : (
            <div className="empty">
              {todos.length ? 'Nothing matches.' : 'Nothing queued. Add one above, or promote a past prompt.'}
            </div>
          ))}

        {tab === 'history' &&
          (history.length ? (
            history
              .filter((h) => !filter || h.text.toLowerCase().includes(filter.toLowerCase()))
              .slice(0, 150)
              .map((h) => (
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

function TodoRow({
  t,
  sessions,
  labels,
  canLaunch,
  onCycle,
  onLaunch,
  onRemove,
  onSelect,
  onUnbind,
  onDragStart,
  onDropOn,
}: {
  t: Todo
  sessions: Session[]
  labels: LabelMap
  canLaunch: boolean
  onCycle: () => void
  onLaunch: () => void
  onRemove: () => void
  onSelect: (id: string) => void
  onUnbind: () => void
  onDragStart: () => void
  onDropOn: () => void
}) {
  const [over, setOver] = useState(false)
  const bound = t.sessionId ? sessions.find((s) => s.sessionId === t.sessionId) : null
  const waitingToAdopt = t.status === 'doing' && !bound && !!t.launchedAt

  return (
    <div
      className={`idea todo-row ${t.status} ${over ? 'over' : ''}`}
      draggable
      onDragStart={onDragStart}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        onDropOn()
      }}
    >
      <div className="todo-main">
        <button className={`task-dot ${t.status}`} onClick={onCycle} title={`status: ${t.status} — click to cycle`} />
        <span className="idea-text">{t.text}</span>
        <span className="grow" />
        <span className="muted">{relTime(t.createdAt)}</span>
        <button className="ghost-btn" disabled={!canLaunch} title="Open a new terminal running this" onClick={onLaunch}>
          launch
        </button>
        <button className="ghost-btn danger" onClick={onRemove}>
          ×
        </button>
      </div>

      {bound && (
        <button className="todo-link" onClick={() => onSelect(bound.sessionId)} title="Inspect this session">
          <span className={`dot ${bound.status}`} />
          <span className="todo-link-name">{displayName(bound, labels[bound.sessionId])}</span>
          <span className={`att att-${attentionOf(bound)}`}>
            {attentionOf(bound) === 'working' ? 'working' : `waiting ${relTime(bound.statusUpdatedAt)}`}
          </span>
          <span className="grow" />
          <span className="muted" onClick={(e) => (e.stopPropagation(), onUnbind())}>
            unlink
          </span>
        </button>
      )}

      {waitingToAdopt && (
        <div className="todo-link pending">
          <span className="dot" />
          <span className="muted">launched — waiting for the session to register…</span>
        </div>
      )}
    </div>
  )
}
