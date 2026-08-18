import { useMemo, useState } from 'react'
import type { LabelMap, ParkedItem, Session, Snapshot, Task } from '../types'
import { displayName } from '../components/SessionLabel'
import ParkingBody from '../components/ParkingBody'
import JobRow from '../components/JobRow'
import TaskGraph from '../components/TaskGraph'


type Tab = 'parking' | 'ready' | 'jobs'

interface QueueItem {
  task: Task
  sessionId: string
  origin: string
  live: boolean
}

interface Props {
  snap: Snapshot
  labels: LabelMap
  focus: Session | null
  onSelect: (id: string) => void
  onParked: (parked: ParkedItem[]) => void
  parked: ParkedItem[]
}

/**
 * The cross-session half: what just happened anywhere, what is startable
 * anywhere, and what the daemon is doing. Nothing here is scoped to one thread.
 */
export default function CrossPane({ snap, labels, focus, onSelect, onParked, parked }: Props) {
  const [tab, setTab] = useState<Tab>('parking')

  const lists = useMemo(() => {
    const live = snap.sessions
      .filter((s) => s.tasks.length)
      .map((s) => ({
        sessionId: s.sessionId,
        label: displayName(s, labels[s.sessionId]),
        project: s.project,
        tasks: s.tasks,
        live: true,
      }))
    const orphans = snap.orphanTaskLists.map((l) => ({
      sessionId: l.sessionId,
      label: l.sessionId.slice(0, 8),
      project: 'ended session',
      tasks: l.tasks,
      live: false,
    }))
    return [...live, ...orphans]
  }, [snap, labels])

  const { running, ready, blocked } = useMemo(() => {
    const running: QueueItem[] = []
    const ready: QueueItem[] = []
    const blocked: QueueItem[] = []
    for (const l of lists) {
      const byId = new Map(l.tasks.map((t) => [t.id, t]))
      for (const task of l.tasks) {
        if (task.status === 'completed') continue
        const item: QueueItem = { task, sessionId: l.sessionId, origin: l.label, live: l.live }
        if (task.status === 'in_progress') running.push(item)
        // A dependency that no longer exists cannot block anything.
        else if (task.blockedBy.every((b) => !byId.has(b) || byId.get(b)!.status === 'completed')) ready.push(item)
        else blocked.push(item)
      }
    }
    return { running, ready, blocked }
  }, [lists])

  const openParked = parked.filter((t) => t.status !== 'done').length
  const inFlight = parked.filter((t) => t.status === 'doing').length
  const activeJobs = snap.jobs.filter((j) => j.state !== 'done' && j.state !== 'failed').length

  return (
    <section className="pane cross">
      <header className="pane-head">
        <div className="pane-title">
          <span className="pane-kicker">{tab === 'parking' ? 'parking lot' : 'across sessions'}</span>
          <strong>
            {tab === 'parking'
              ? `${openParked} parked${inFlight ? ` · ${inFlight} in flight` : ''}`
              : tab === 'ready'
                ? `${ready.length} ready · ${running.length} running`
                : `${snap.jobs.length} jobs`}
          </strong>
        </div>
        <div className="pane-actions">
          <button className="toggle" data-on={tab === 'parking'} onClick={() => setTab('parking')}>
            parking
          </button>
          <button className="toggle" data-on={tab === 'ready'} onClick={() => setTab('ready')}>
            ready
          </button>
          <button className="toggle" data-on={tab === 'jobs'} onClick={() => setTab('jobs')}>
            jobs{activeJobs ? ` (${activeJobs})` : ''}
          </button>
        </div>
      </header>

      {tab === 'parking' ? (
        <ParkingBody
          parked={parked}
          sessions={snap.sessions}
          labels={labels}
          focus={focus}
          onSelect={onSelect}
          onParked={onParked}
        />
      ) : (
      <div className="pane-scroll">
        {tab === 'ready' && (
          <>
            <QueueGroup title="in progress" items={running} empty="Nothing claimed right now." onSelect={onSelect} />
            <QueueGroup
              title="ready to start"
              items={ready}
              empty="Nothing unblocked. Finish something in progress first."
              onSelect={onSelect}
            />
            {blocked.length > 0 && (
              <details className="queue-blocked">
                <summary>{blocked.length} still blocked by dependencies</summary>
                {lists
                  .filter((l) => blocked.some((b) => b.sessionId === l.sessionId))
                  .map((l) => (
                    <div className="tasklist" key={l.sessionId}>
                      <div className="queue-title">{l.label}</div>
                      <TaskGraph tasks={l.tasks} />
                    </div>
                  ))}
              </details>
            )}
          </>
        )}

        {tab === 'jobs' &&
          (snap.jobs.length ? (
            snap.jobs.map((j) => <JobRow key={j.id} j={j} />)
          ) : (
            <div className="empty">No background jobs.</div>
          ))}
      </div>
      )}
    </section>
  )
}

/** One band of the cross-session queue: what is running, what is startable. */
function QueueGroup({
  title,
  items,
  empty,
  onSelect,
}: {
  title: string
  items: QueueItem[]
  empty: string
  onSelect: (id: string) => void
}) {
  return (
    <div className="queue-group">
      <div className="queue-title">
        {title}
        <span className="muted">{items.length}</span>
      </div>
      {items.length ? (
        items.map((i) => (
          <button
            className={`queue-item ${i.task.status} ${i.live ? '' : 'dim'}`}
            key={`${i.sessionId}-${i.task.id}`}
            onClick={() => i.live && onSelect(i.sessionId)}
            title={i.task.description || i.task.subject}
          >
            <span className={`task-dot ${i.task.status}`} />
            <span className="queue-origin">{i.origin}</span>
            <span className="task-subject">{i.task.activeForm || i.task.subject}</span>
            {i.task.blocks.length > 0 && (
              <span className="pill dim" title={`unblocks ${i.task.blocks.join(', ')}`}>
                → {i.task.blocks.length}
              </span>
            )}
          </button>
        ))
      ) : (
        <div className="queue-empty">{empty}</div>
      )}
    </div>
  )
}
