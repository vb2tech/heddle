import { useState } from 'react'
import type { LabelMap, Session, Snapshot } from '../types'
import { attentionOf, stableOrder } from '../attention'
import SessionLabelEditor, { colorOf } from '../components/SessionLabel'
import { compactNum, contextPct, duration, relTime, shortModel } from '../util'

interface Props {
  snap: Snapshot
  focusId: string | null
  labels: LabelMap
  onSelect: (id: string) => void
  onLabel: (sessionId: string, patch: { label?: string; color?: string }) => void
}

type Tab = 'live' | 'recent'

/** Every stream of work on the machine: live sessions, their subagents, and resumables. */
export default function ThreadsPane({ snap, focusId, labels, onSelect, onLabel }: Props) {
  const [tab, setTab] = useState<Tab>('live')
  const ordered = stableOrder(snap.sessions)
  const waiting = ordered.filter((s) => attentionOf(s) === 'waiting').length

  return (
    <section className="pane threads">
      <header className="pane-head">
        <div className="pane-title">
          <span className="pane-kicker">threads</span>
          <strong>{snap.sessions.length} live</strong>
          {waiting > 0 && <span className="pill waiting">{waiting} waiting on you</span>}
        </div>
        <div className="pane-actions">
          <button className="toggle" data-on={tab === 'live'} onClick={() => setTab('live')}>
            live
          </button>
          <button className="toggle" data-on={tab === 'recent'} onClick={() => setTab('recent')}>
            resumable
          </button>
        </div>
      </header>

      <div className="pane-scroll">
        {tab === 'live' &&
          (ordered.length ? (
            ordered.map((s) => (
              <SessionCard
                key={s.sessionId}
                s={s}
                labels={labels}
                active={s.sessionId === focusId}
                onSelect={() => onSelect(s.sessionId)}
                onLabel={(p) => onLabel(s.sessionId, p)}
              />
            ))
          ) : (
            <div className="empty">No Claude processes running.</div>
          ))}

        {tab === 'recent' &&
          (snap.recent.length ? (
            snap.recent.map((r) => (
              <div className="row recent" key={r.sessionId}>
                <span className="row-main">
                  <strong>{r.project}</strong>
                  <code className="muted">{r.sessionId.slice(0, 8)}</code>
                </span>
                <span className="muted">{compactNum(Math.round(r.sizeBytes / 1024))}kb</span>
                <span className="muted">{relTime(r.updatedAt)}</span>
              </div>
            ))
          ) : (
            <div className="empty">No past sessions on disk.</div>
          ))}
      </div>
    </section>
  )
}

function SessionCard({
  s,
  labels,
  active,
  onSelect,
  onLabel,
}: {
  s: Session
  labels: LabelMap
  active: boolean
  onSelect: () => void
  onLabel: (patch: { label?: string; color?: string }) => void
}) {
  const [open, setOpen] = useState(false)
  const openTasks = s.tasks.filter((t) => t.status !== 'completed').length
  const running = s.tasks.filter((t) => t.status === 'in_progress')
  const att = attentionOf(s)

  return (
    <article
      className={`card t-${colorOf(s, labels[s.sessionId])} att-${att} ${active ? 'active' : ''}`}
      onClick={onSelect}
    >
      <div className="card-head">
        <span className={`dot ${s.status}`} title={s.status} />
        <SessionLabelEditor session={s} entry={labels[s.sessionId]} onSave={onLabel} withColor />
        <span className="grow" />
        <span className={`att att-${att}`}>
          {att === 'working' ? 'working' : att === 'waiting' ? `waiting ${relTime(s.statusUpdatedAt)}` : 'parked'}
        </span>
      </div>

      <div className="card-title">{s.aiTitle || s.lastPrompt || 'no prompt yet'}</div>
      <span className="pill dim card-project">{s.project}</span>

      <div className="card-metrics">
        <Metric label="up" value={duration(s.startedAt)} />
        <Metric label="turns" value={String(s.turns)} />
        <Metric label="ctx" value={`${contextPct(s.contextTokens, s.model)}%`} />
        <Metric label="model" value={shortModel(s.model) || '—'} />
        {openTasks > 0 && <Metric label="tasks" value={String(openTasks)} tone="warn" />}
        {s.subagents.length > 0 && <Metric label="agents" value={String(s.subagents.length)} tone="on" />}
        <span className="grow" />
        <span className="muted mono">pid {s.pid}</span>
      </div>

      {running.length > 0 && (
        <div className="card-running">
          {running.map((t) => (
            <span className="running-chip" key={t.id}>
              ▶ {t.activeForm || t.subject}
            </span>
          ))}
        </div>
      )}

      {s.subagents.length > 0 && (
        <>
          <button
            className="linkish"
            onClick={(e) => {
              e.stopPropagation()
              setOpen((v) => !v)
            }}
          >
            {open ? '▾' : '▸'} {s.subagents.length} subagent thread{s.subagents.length === 1 ? '' : 's'}
          </button>
          {open && (
            <div className="subagents">
              {s.subagents.map((a) => (
                <div className="subagent" key={a.id}>
                  <code className="mono">{a.label || a.id.slice(0, 10)}</code>
                  <span className="subagent-text">{a.lastText || '—'}</span>
                  <span className="muted">{relTime(a.updatedAt)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <code className="path">{s.cwd}</code>
    </article>
  )
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <span className="metric" data-tone={tone}>
      <span className="metric-label">{label}</span>
      <span className="metric-value">{value}</span>
    </span>
  )
}
