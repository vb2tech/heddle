import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchLabels, setLabel, subscribeSnapshots } from './api'
import type { LabelMap, ParkedItem, Session, Snapshot } from './types'
import InspectorPane from './panes/InspectorPane'
import ThreadsPane from './panes/ThreadsPane'
import CrossPane from './panes/CrossPane'

import Splitter from './components/Splitter'
import { useTheme } from './theme'
import { attentionOf } from './attention'
import { compactNum } from './util'

const EMPTY: Snapshot = { at: 0, sessions: [], jobs: [], ides: [], orphanTaskLists: [], recent: [], parked: [] }

const LAYOUT_KEY = 'orchestration.layout.v1'

interface Layout {
  col: number // left column width, %
  rightRow: number // threads height within the right column, %
}

const DEFAULT_LAYOUT: Layout = { col: 55, rightRow: 50 }

function loadLayout(): Layout {
  try {
    return { ...DEFAULT_LAYOUT, ...JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}') }
  } catch {
    return DEFAULT_LAYOUT
  }
}

export default function App() {
  const [snap, setSnap] = useState<Snapshot>(EMPTY)
  const [connected, setConnected] = useState(false)
  const [focusId, setFocusId] = useState<string | null>(null)
  const [layout, setLayout] = useState<Layout>(loadLayout)
  const [theme, toggleTheme] = useTheme()
  const [labels, setLabels] = useState<LabelMap>({})
  // Local echo so edits feel instant; the next snapshot is authoritative.
  const [localParked, setLocalParked] = useState<ParkedItem[] | null>(null)
  const pinned = useRef(false)

  useEffect(() => {
    fetchLabels().then((r) => setLabels(r.labels)).catch(() => {})
  }, [])

  const onLabel = useCallback((sessionId: string, patch: { label?: string; color?: string }) => {
    // Optimistic: the rename should feel instant even though it round-trips.
    setLabels((prev) => ({ ...prev, [sessionId]: { ...prev[sessionId], ...patch } }))
    setLabel(sessionId, patch)
      .then((r) => setLabels(r.labels))
      .catch(() => {})
  }, [])

  useEffect(() => subscribeSnapshots(setSnap, setConnected), [])

  useEffect(() => {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout))
  }, [layout])

  // Follow the most recently active session until the user picks one explicitly.
  useEffect(() => {
    if (!snap.sessions.length) return
    if (pinned.current && snap.sessions.some((s) => s.sessionId === focusId)) return
    const busy = snap.sessions.find((s) => s.status === 'busy')
    setFocusId((busy || snap.sessions[0]).sessionId)
  }, [snap.sessions, focusId])

  // Snapshots carry the parking lot, so a local echo lasts until the next push.
  useEffect(() => setLocalParked(null), [snap.parked])
  const parked = localParked ?? snap.parked

  const focus = useMemo<Session | null>(
    () => snap.sessions.find((s) => s.sessionId === focusId) || null,
    [snap.sessions, focusId],
  )

  const selectSession = useCallback((id: string) => {
    pinned.current = true
    setFocusId(id)
  }, [])

  const unpin = useCallback(() => {
    pinned.current = false
    const busy = snap.sessions.find((s) => s.status === 'busy')
    if (busy) setFocusId(busy.sessionId)
  }, [snap.sessions])

  const stats = useMemo(() => {
    const busy = snap.sessions.filter((s) => s.status === 'busy').length
    const waiting = snap.sessions.filter((s) => attentionOf(s) === 'waiting').length
    const subagents = snap.sessions.reduce((n, s) => n + s.subagents.length, 0)
    const openTasks = snap.sessions.reduce(
      (n, s) => n + s.tasks.filter((t) => t.status !== 'completed').length,
      0,
    )
    const ctx = snap.sessions.reduce((n, s) => n + s.contextTokens, 0)
    return { busy, waiting, subagents, openTasks, ctx }
  }, [snap])

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-dot" data-on={connected} />
          <strong>orchestration</strong>
          <span className="muted">local claude control plane</span>
        </div>
        <div className="topstats">
          <Stat label="live" value={String(snap.sessions.length)} tone={snap.sessions.length ? 'on' : undefined} />
          <Stat label="working" value={String(stats.busy)} tone={stats.busy ? 'busy' : undefined} />
          <Stat label="waiting on you" value={String(stats.waiting)} tone={stats.waiting ? 'waiting' : undefined} />
          <Stat label="threads" value={String(stats.subagents)} />
          <Stat label="open tasks" value={String(stats.openTasks)} />
          <Stat label="parked" value={String(snap.parked.filter((t) => t.status !== 'done').length)} />
          <Stat label="ctx" value={compactNum(stats.ctx)} />
          <Stat label="jobs" value={String(snap.jobs.length)} />
          {!pinned.current ? (
            <span className="pill follow">following</span>
          ) : (
            <button className="pill follow ghost" onClick={unpin} title="Resume following the busy session">
              pinned · unfollow
            </button>
          )}
          <button
            className="theme-btn"
            onClick={toggleTheme}
            title={`Switch to ${theme === 'dark' ? 'coffee' : 'dark'} theme`}
            aria-label="Toggle colour theme"
          >
            {theme === 'dark' ? '☾' : '☀'}
          </button>
        </div>
      </header>

      <div className="grid" style={{ gridTemplateColumns: `${layout.col}% 6px 1fr` }}>
        <InspectorPane session={focus} labels={labels} onLabel={onLabel} />

        <Splitter axis="vertical" onDelta={(pct) => setLayout((l) => ({ ...l, col: clamp(l.col + pct) }))} />

        <div className="col" style={{ gridTemplateRows: `${layout.rightRow}% 6px 1fr` }}>
          <ThreadsPane
            snap={snap}
            focusId={focusId}
            labels={labels}
            onSelect={selectSession}
            onLabel={onLabel}
          />
          <Splitter axis="horizontal" onDelta={(pct) => setLayout((l) => ({ ...l, rightRow: clamp(l.rightRow + pct) }))} />
          <CrossPane
            snap={snap}
            labels={labels}
            focus={focus}
            onSelect={selectSession}
            parked={parked}
            onParked={setLocalParked}
          />
        </div>
      </div>
    </div>
  )
}

function clamp(n: number) {
  return Math.min(85, Math.max(15, n))
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <span className="stat" data-tone={tone}>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </span>
  )
}
