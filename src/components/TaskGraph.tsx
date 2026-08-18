import { useMemo } from 'react'
import type { Task } from '../types'

/**
 * Tasks in dependency order, annotated with what each one is waiting on. A full
 * node-link graph is overkill here — the blocking relation is what matters.
 */
export default function TaskGraph({ tasks }: { tasks: Task[] }) {
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks])

  const ordered = useMemo(() => {
    // Topological sort, falling back to id order for anything in a cycle.
    const done = new Set<string>()
    const out: Task[] = []
    let guard = tasks.length + 1
    while (out.length < tasks.length && guard-- > 0) {
      for (const t of tasks) {
        if (done.has(t.id)) continue
        if (t.blockedBy.every((b) => done.has(b) || !byId.has(b))) {
          out.push(t)
          done.add(t.id)
        }
      }
    }
    for (const t of tasks) if (!done.has(t.id)) out.push(t)
    return out
  }, [tasks, byId])

  return (
    <div className="tasks">
      {ordered.map((t) => {
        const waiting = t.blockedBy.filter((b) => byId.get(b)?.status !== 'completed')
        const ready = t.status === 'pending' && waiting.length === 0
        return (
          <div className={`task ${t.status}`} key={t.id} title={t.description}>
            <span className={`task-dot ${t.status}`} />
            <span className="task-id">{t.id}</span>
            <span className="task-subject">{t.subject}</span>
            {t.owner && <span className="pill dim">{t.owner}</span>}
            {ready && <span className="pill ready">ready</span>}
            {waiting.length > 0 && (
              <span className="pill blocked" title={`blocked by ${waiting.join(', ')}`}>
                ⛒ {waiting.join(',')}
              </span>
            )}
            {t.blocks.length > 0 && (
              <span className="pill dim" title={`unblocks ${t.blocks.join(', ')}`}>
                → {t.blocks.join(',')}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
