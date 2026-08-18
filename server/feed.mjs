// Derives a cross-session activity feed.
//
// Nothing on disk records "what happened" — only current state. So the feed is
// built by diffing consecutive snapshots and tailing each live transcript for
// failures. This is the one view no single terminal can give you, because it
// spans processes.

import { readTranscript, transcriptSize, lastAssistantText } from './store.mjs'

const MAX_EVENTS = 400
const CTX_WARN_PCT = 80

// Mirrors contextWindowFor() on the client: the transcript does not record the
// 1M variant, so exceeding 200k is the only proof of a larger window.
const pct = (tokens, model) => {
  const window = (model && /\[1m\]/.test(model)) || tokens > 200_000 ? 1_000_000 : 200_000
  return Math.min(100, Math.round((tokens / window) * 100))
}

export function createFeed() {
  /** @type {Map<string, any>} previous per-session state, keyed by sessionId */
  let prevSessions = new Map()
  /** @type {Map<string, number>} transcript read offset per session */
  const offsets = new Map()
  let started = false
  const events = []
  let seq = 0

  function emit(at, kind, session, text, severity = 'info', extra = {}) {
    events.push({
      id: `${++seq}`,
      at,
      kind,
      severity,
      sessionId: session?.sessionId || null,
      sessionName: session?.name || '',
      project: session?.project || '',
      cwd: session?.cwd || '',
      text,
      ...extra,
    })
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS)
  }

  /** Scan new transcript bytes for failures worth surfacing. */
  function scanTranscript(s, now) {
    const known = offsets.has(s.sessionId)
    if (!known) {
      // Seek to the current end so a restart doesn't replay old failures.
      offsets.set(s.sessionId, transcriptSize(s.slug, s.sessionId))
      return
    }
    let r
    try {
      r = readTranscript(s.slug, s.sessionId, { fromOffset: offsets.get(s.sessionId) })
    } catch {
      return
    }
    offsets.set(s.sessionId, r.offset)

    for (const e of r.events) {
      if (e.kind !== 'tool_result' || !e.isError) continue
      const at = e.timestamp ? Date.parse(e.timestamp) : now
      emit(at, 'tool_error', s, e.text.replace(/\s+/g, ' ').slice(0, 200), 'warn')
    }
  }

  function update(snap) {
    const now = snap.at || Date.now()
    const next = new Map(snap.sessions.map((s) => [s.sessionId, s]))

    for (const s of snap.sessions) {
      const prev = prevSessions.get(s.sessionId)

      // On the very first snapshot, register sessions without narrating history.
      if (!prev) {
        if (started) emit(now, 'session_start', s, `session started in ${s.project}`, 'info')
        scanTranscript(s, now)
        continue
      }

      scanTranscript(s, now)

      // A turn finishing is the event that actually wants your attention.
      if (prev.status === 'busy' && s.status !== 'busy') {
        const summary = lastAssistantText(s.slug, s.sessionId)
        emit(s.statusUpdatedAt || now, 'turn_done', s, summary || 'finished a turn', 'attn')
      } else if (prev.status !== 'busy' && s.status === 'busy') {
        emit(s.statusUpdatedAt || now, 'turn_start', s, s.lastPrompt || 'started working', 'info')
      }

      // Context: a large drop means a compaction, a rise past the line is a
      // warning. A reading of 0 means "no assistant turn in the tail we read",
      // i.e. unknown — never treat that as a real drop to empty.
      if (prev.contextTokens > 0 && s.contextTokens > 0) {
        const prevPct = pct(prev.contextTokens, prev.model)
        const nowPct = pct(s.contextTokens, s.model)
        if (s.contextTokens < prev.contextTokens * 0.6) {
          emit(now, 'compacted', s, `compacted — context ${prevPct}% → ${nowPct}%`, 'info')
        } else if (prevPct < CTX_WARN_PCT && nowPct >= CTX_WARN_PCT) {
          emit(now, 'ctx_high', s, `context at ${nowPct}% — compact soon`, 'warn')
        }
      }

      // Task transitions.
      const prevTasks = new Map((prev.tasks || []).map((t) => [t.id, t]))
      for (const t of s.tasks || []) {
        const before = prevTasks.get(t.id)
        if (!before) {
          emit(now, 'task_new', s, `task added: ${t.subject}`, 'info')
        } else if (before.status !== t.status) {
          if (t.status === 'completed') emit(now, 'task_done', s, `done: ${t.subject}`, 'info')
          else if (t.status === 'in_progress') emit(now, 'task_started', s, `started: ${t.subject}`, 'info')
        }
      }

      // Subagents spawning is real fan-out worth seeing.
      const prevAgents = new Set((prev.subagents || []).map((a) => a.id))
      for (const a of s.subagents || []) {
        if (!prevAgents.has(a.id)) {
          emit(now, 'agent_spawn', s, `subagent started${a.label ? `: ${a.label}` : ''}`, 'info')
        }
      }
    }

    // Sessions that went away.
    for (const [id, prev] of prevSessions) {
      if (!next.has(id)) {
        if (started) emit(now, 'session_end', prev, `session ended (${prev.project})`, 'info')
        offsets.delete(id)
      }
    }

    prevSessions = next
    started = true
  }

  return {
    update,
    /** Newest first, since that is how the pane reads. */
    list: (limit = 150) => events.slice(-limit).reverse(),
  }
}
