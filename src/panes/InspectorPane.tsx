import { useEffect, useState } from 'react'
import { fetchFiles } from '../api'
import type { FileActivity, LabelMap, Session } from '../types'
import { attentionOf } from '../attention'
import SessionTranscript from '../components/SessionTranscript'
import SessionLabelEditor, { colorOf } from '../components/SessionLabel'
import TaskGraph from '../components/TaskGraph'
import { compactNum, contextPct, relTime, shortModel } from '../util'

type Tab = 'chat' | 'files' | 'tasks' | 'agents'

interface Props {
  session: Session | null
  labels: LabelMap
  onLabel: (sessionId: string, patch: { label?: string; color?: string }) => void
}

/**
 * Everything about the one thread you selected. The right column answers "what
 * is going on everywhere"; this answers "what is going on *here*", in more
 * depth than a terminal scrollback conveniently shows.
 */
export default function InspectorPane({ session, labels, onLabel }: Props) {
  const [tab, setTab] = useState<Tab>('chat')
  const [showThinking, setShowThinking] = useState(false)
  const [showTools, setShowTools] = useState(true)

  if (!session) {
    return (
      <section className="pane inspector">
        <header className="pane-head">
          <span className="pane-kicker">thread</span>
        </header>
        <div className="empty">Select a thread on the right, or start one in any terminal.</div>
      </section>
    )
  }

  const att = attentionOf(session)
  const openTasks = session.tasks.filter((t) => t.status !== 'completed').length

  return (
    <section className={`pane inspector t-${colorOf(session, labels[session.sessionId])}`}>
      <header className="pane-head">
        <div className="pane-title">
          <span className={`dot ${session.status}`} />
          <SessionLabelEditor
            session={session}
            entry={labels[session.sessionId]}
            onSave={(p) => onLabel(session.sessionId, p)}
            withColor
          />
          <span className={`att att-${att}`}>
            {att === 'working' ? 'working' : `${att} ${relTime(session.statusUpdatedAt)}`}
          </span>
        </div>
        <div className="pane-actions">
          <Tabs
            tab={tab}
            setTab={setTab}
            counts={{ files: null, tasks: openTasks || null, agents: session.subagents.length || null }}
          />
        </div>
      </header>

      <div className="chat-meta">
        <span className="subject" title={session.aiTitle || ''}>
          {session.aiTitle || session.lastPrompt || 'no prompt yet'}
        </span>
        <span className="grow" />
        <code className="path">{session.cwd}</code>
        <span className="sep" />
        <span className="muted">{shortModel(session.model)}</span>
        <span className="ctxbar" title={`${session.contextTokens.toLocaleString()} context tokens`}>
          <span className="ctxbar-fill" style={{ width: `${contextPct(session.contextTokens, session.model)}%` }} />
        </span>
        <span className="muted">{contextPct(session.contextTokens, session.model)}%</span>
        {tab === 'chat' && (
          <>
            <button className="toggle" data-on={showThinking} onClick={() => setShowThinking((v) => !v)}>
              thinking
            </button>
            <button className="toggle" data-on={showTools} onClick={() => setShowTools((v) => !v)}>
              tools
            </button>
          </>
        )}
      </div>

      {tab === 'chat' && (
        <SessionTranscript
          key={session.sessionId}
          slug={session.slug}
          sessionId={session.sessionId}
          showThinking={showThinking}
          showTools={showTools}
          intervalMs={600}
        />
      )}

      {tab === 'files' && <FilesTab session={session} />}

      {tab === 'tasks' && (
        <div className="pane-scroll">
          {session.tasks.length ? (
            <TaskGraph tasks={session.tasks} />
          ) : (
            <div className="empty">This session has no task list.</div>
          )}
        </div>
      )}

      {tab === 'agents' && (
        <div className="pane-scroll">
          {session.subagents.length ? (
            session.subagents.map((a) => (
              <div className="agent-row" key={a.id}>
                <div className="agent-head">
                  <code className="mono">{a.label || a.id.slice(0, 12)}</code>
                  <span className="grow" />
                  <span className="muted">{compactNum(Math.round(a.sizeBytes / 1024))}kb</span>
                  <span className="muted">{relTime(a.updatedAt)}</span>
                </div>
                <div className="agent-text">{a.lastText || '—'}</div>
              </div>
            ))
          ) : (
            <div className="empty">No subagents spawned by this session.</div>
          )}
        </div>
      )}
    </section>
  )
}

function Tabs({
  tab,
  setTab,
  counts,
}: {
  tab: Tab
  setTab: (t: Tab) => void
  counts: Record<string, number | null>
}) {
  const items: Tab[] = ['chat', 'files', 'tasks', 'agents']
  return (
    <>
      {items.map((t) => (
        <button key={t} className="toggle" data-on={tab === t} onClick={() => setTab(t)}>
          {t}
          {counts[t] ? ` ${counts[t]}` : ''}
        </button>
      ))}
    </>
  )
}

/** Files this session touched, derived from the tool calls in its transcript. */
function FilesTab({ session }: { session: Session }) {
  const [files, setFiles] = useState<FileActivity[] | null>(null)

  useEffect(() => {
    let cancelled = false
    setFiles(null)
    const pull = () =>
      fetchFiles(session.slug, session.sessionId)
        .then((r) => !cancelled && setFiles(r.files))
        .catch(() => !cancelled && setFiles([]))
    pull()
    const t = setInterval(pull, 4000)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [session.slug, session.sessionId])

  if (files === null) return <div className="empty">Reading transcript…</div>
  if (!files.length) return <div className="empty">No file activity in this session yet.</div>

  const written = files.filter((f) => f.writes > 0)
  const read = files.filter((f) => f.writes === 0)

  return (
    <div className="pane-scroll">
      <FileGroup title="edited" files={written} cwd={session.cwd} />
      <FileGroup title="read only" files={read} cwd={session.cwd} />
    </div>
  )
}

function FileGroup({ title, files, cwd }: { title: string; files: FileActivity[]; cwd: string }) {
  if (!files.length) return null
  return (
    <div className="queue-group">
      <div className="queue-title">
        {title}
        <span className="muted">{files.length}</span>
      </div>
      {files.map((f) => (
        <div className="file-row" key={f.path} title={f.path}>
          <span className={`task-dot ${f.writes ? 'in_progress' : ''}`} />
          <span className="file-path">{f.path.startsWith(cwd) ? f.path.slice(cwd.length + 1) : f.path}</span>
          {f.writes > 0 && <span className="pill dim">{f.writes}×w</span>}
          {f.reads > 0 && <span className="pill dim">{f.reads}×r</span>}
          <span className="muted">{relTime(f.lastAt)}</span>
        </div>
      ))}
    </div>
  )
}
