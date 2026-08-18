// Reads the on-disk state that every local Claude Code process maintains under
// ~/.claude. Everything here is read-only and best-effort: files are written by
// live processes, so partial reads and races are normal and must never throw.

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export const CLAUDE_DIR = process.env.CLAUDE_DIR || path.join(os.homedir(), '.claude')

const SESSIONS_DIR = path.join(CLAUDE_DIR, 'sessions')
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects')
const TASKS_DIR = path.join(CLAUDE_DIR, 'tasks')
const JOBS_DIR = path.join(CLAUDE_DIR, 'jobs')
const IDE_DIR = path.join(CLAUDE_DIR, 'ide')
const HISTORY_FILE = path.join(CLAUDE_DIR, 'history.jsonl')

// ---------------------------------------------------------------- primitives

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function readDir(dir) {
  try {
    return fs.readdirSync(dir)
  } catch {
    return []
  }
}

function statOr(file) {
  try {
    return fs.statSync(file)
  } catch {
    return null
  }
}

function pidAlive(pid) {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // EPERM means the process exists but belongs to someone else.
    return err.code === 'EPERM'
  }
}

/** Claude encodes a cwd as its path with every non-alphanumeric run as a dash. */
export function slugForCwd(cwd) {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-')
}

/** Read the trailing `maxBytes` of a file and return only its complete lines. */
function tailLines(file, maxBytes, fromOffset = 0) {
  const st = statOr(file)
  if (!st || !st.size) return { lines: [], offset: fromOffset, size: 0 }

  let start = fromOffset > 0 ? Math.min(fromOffset, st.size) : Math.max(0, st.size - maxBytes)
  // A shrinking file means it was rewritten; restart from the tail.
  if (fromOffset > st.size) start = Math.max(0, st.size - maxBytes)

  const len = st.size - start
  if (len <= 0) return { lines: [], offset: st.size, size: st.size }

  const buf = Buffer.alloc(len)
  let read = 0
  try {
    const fd = fs.openSync(file, 'r')
    try {
      read = fs.readSync(fd, buf, 0, len, start)
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return { lines: [], offset: fromOffset, size: st.size }
  }

  let text = buf.subarray(0, read).toString('utf8')
  // Drop a leading partial line unless we started at a known record boundary.
  if (start > 0 && fromOffset === 0) {
    const nl = text.indexOf('\n')
    text = nl === -1 ? '' : text.slice(nl + 1)
  }
  // A trailing partial line means the writer is mid-append; leave it for next time.
  const lastNl = text.lastIndexOf('\n')
  const complete = lastNl === -1 ? '' : text.slice(0, lastNl)
  const consumed = Buffer.byteLength(text.slice(0, lastNl + 1), 'utf8')
  const offset = start + (start > 0 && fromOffset === 0 ? read - Buffer.byteLength(text, 'utf8') : 0) + consumed

  const lines = []
  for (const line of complete.split('\n')) {
    if (!line.trim()) continue
    try {
      lines.push(JSON.parse(line))
    } catch {
      /* half-written record */
    }
  }
  return { lines, offset, size: st.size }
}

// ----------------------------------------------------------------- sessions

/**
 * Every running `claude` CLI process registers itself as sessions/<pid>.json and
 * keeps `status` fresh. Files whose pid is gone are stale leftovers.
 */
export function listLiveSessions() {
  const out = []
  for (const name of readDir(SESSIONS_DIR)) {
    if (!name.endsWith('.json')) continue
    const rec = readJson(path.join(SESSIONS_DIR, name))
    if (!rec || !rec.sessionId) continue
    const alive = pidAlive(rec.pid)
    if (!alive) continue
    out.push({
      pid: rec.pid,
      sessionId: rec.sessionId,
      cwd: rec.cwd || '',
      project: rec.cwd ? path.basename(rec.cwd) : 'unknown',
      slug: rec.cwd ? slugForCwd(rec.cwd) : '',
      name: rec.name || rec.sessionId.slice(0, 8),
      kind: rec.kind || 'interactive',
      entrypoint: rec.entrypoint || '',
      version: rec.version || '',
      status: rec.status || 'unknown',
      startedAt: rec.startedAt || 0,
      updatedAt: rec.updatedAt || 0,
      statusUpdatedAt: rec.statusUpdatedAt || rec.updatedAt || 0,
      bridgeSessionId: rec.bridgeSessionId || null,
    })
  }
  return out.sort((a, b) => (b.statusUpdatedAt || 0) - (a.statusUpdatedAt || 0))
}

/** Transcript path for a session, resolved through its project slug. */
export function transcriptPath(slug, sessionId) {
  if (!slug || !sessionId) return null
  return path.join(PROJECTS_DIR, slug, `${sessionId}.jsonl`)
}

/**
 * Sidecar records the CLI appends to the transcript: the AI-generated title, the
 * last prompt, and the permission mode. Cheap to grab from the tail.
 */
export function sessionMeta(slug, sessionId) {
  const file = transcriptPath(slug, sessionId)
  if (!file) return {}
  const { lines } = tailLines(file, 512 * 1024)
  const meta = { aiTitle: null, lastPrompt: null, mode: null, agentName: null, contextTokens: 0, model: null, turns: 0 }
  for (const rec of lines) {
    switch (rec.type) {
      case 'ai-title':
        meta.aiTitle = rec.aiTitle
        break
      case 'last-prompt':
        meta.lastPrompt = rec.lastPrompt
        break
      case 'mode':
        meta.mode = rec.mode
        break
      case 'agent-name':
        meta.agentName = rec.agentName
        break
      case 'assistant': {
        meta.turns++
        const u = rec.message?.usage
        if (u) {
          meta.contextTokens =
            (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0)
        }
        if (rec.message?.model) meta.model = rec.message.model
        break
      }
    }
  }
  return meta
}

/**
 * Subagents each get their own transcript under <sessionId>/subagents/. These are
 * the fan-out "threads" spawned by the Agent tool and by workflows.
 */
export function listSubagents(slug, sessionId) {
  if (!slug || !sessionId) return []
  const dir = path.join(PROJECTS_DIR, slug, sessionId, 'subagents')
  const out = []
  for (const name of readDir(dir)) {
    if (!name.endsWith('.jsonl')) continue
    const file = path.join(dir, name)
    const st = statOr(file)
    if (!st) continue
    const { lines } = tailLines(file, 64 * 1024)
    let lastText = ''
    let label = null
    for (const rec of lines) {
      if (rec.type === 'agent-name') label = rec.agentName
      if (rec.type === 'assistant') {
        const blocks = rec.message?.content
        if (Array.isArray(blocks)) {
          for (const b of blocks) {
            if (b.type === 'text' && b.text?.trim()) lastText = b.text.trim()
            if (b.type === 'tool_use') lastText = `→ ${b.name}`
          }
        }
      }
    }
    out.push({
      id: name.replace(/^agent-|\.jsonl$/g, ''),
      file,
      label,
      sizeBytes: st.size,
      updatedAt: st.mtimeMs,
      lastText: lastText.slice(0, 220),
    })
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt)
}

// -------------------------------------------------------------------- tasks

/**
 * The TaskCreate/TaskUpdate tools persist one JSON file per task, keyed by
 * session. `blocks`/`blockedBy` make this a real dependency graph.
 */
export function readTasks(sessionId) {
  const dir = path.join(TASKS_DIR, sessionId)
  const out = []
  for (const name of readDir(dir)) {
    if (!name.endsWith('.json')) continue
    const t = readJson(path.join(dir, name))
    if (!t || !t.id) continue
    out.push({
      id: String(t.id),
      subject: t.subject || '',
      description: t.description || '',
      activeForm: t.activeForm || '',
      owner: t.owner || null,
      status: t.status || 'pending',
      blocks: (t.blocks || []).map(String),
      blockedBy: (t.blockedBy || []).map(String),
    })
  }
  return out.sort((a, b) => Number(a.id) - Number(b.id))
}

/** Task lists survive their session, so surface every list on disk. */
export function allTaskLists() {
  return readDir(TASKS_DIR)
    .map((sessionId) => {
      const tasks = readTasks(sessionId)
      if (!tasks.length) return null
      const st = statOr(path.join(TASKS_DIR, sessionId))
      return { sessionId, tasks, updatedAt: st ? st.mtimeMs : 0 }
    })
    .filter(Boolean)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

// --------------------------------------------------------------------- jobs

/** Background jobs run by the daemon, each with a state file and a timeline. */
export function listJobs() {
  const out = []
  for (const id of readDir(JOBS_DIR)) {
    const dir = path.join(JOBS_DIR, id)
    const st = statOr(dir)
    if (!st || !st.isDirectory()) continue
    const state = readJson(path.join(dir, 'state.json'))
    if (!state) continue
    const { lines } = tailLines(path.join(dir, 'timeline.jsonl'), 32 * 1024)
    const timeline = lines.slice(-8).map((e) => ({ at: e.at, state: e.state, detail: e.detail }))
    out.push({
      id,
      state: state.state || 'unknown',
      detail: state.detail || '',
      tempo: state.tempo || null,
      tokens: state.tokens || 0,
      template: state.template || null,
      updatedAt: statOr(path.join(dir, 'state.json'))?.mtimeMs || st.mtimeMs,
      timeline,
    })
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt)
}

// ---------------------------------------------------------------- ide + history

export function listIdeConnections() {
  const out = []
  for (const name of readDir(IDE_DIR)) {
    if (!name.endsWith('.lock')) continue
    const rec = readJson(path.join(IDE_DIR, name))
    if (!rec) continue
    const pid = Number(name.replace('.lock', ''))
    if (!pidAlive(pid)) continue
    out.push({ pid, ideName: rec.ideName || 'unknown', workspaceFolders: rec.workspaceFolders || [] })
  }
  return out
}

/** Every prompt ever typed, newest first — the raw material for the ideas pane. */
export function readHistory(limit = 400) {
  const { lines } = tailLines(HISTORY_FILE, 1024 * 1024)
  return lines
    .filter((h) => h.display && h.display.trim())
    .slice(-limit)
    .reverse()
    .map((h, i) => ({
      id: `${h.timestamp || 0}-${i}`,
      text: h.display.trim(),
      timestamp: h.timestamp || 0,
      project: h.project ? path.basename(h.project) : '',
      cwd: h.project || '',
      sessionId: h.sessionId || null,
    }))
}

/** Sessions that exist on disk but are not currently running — resumable. */
export function listRecentSessions(limit = 40) {
  const out = []
  for (const slug of readDir(PROJECTS_DIR)) {
    const dir = path.join(PROJECTS_DIR, slug)
    for (const name of readDir(dir)) {
      if (!name.endsWith('.jsonl')) continue
      const st = statOr(path.join(dir, name))
      if (!st) continue
      out.push({
        sessionId: name.replace('.jsonl', ''),
        slug,
        project: slug.split('-').filter(Boolean).pop() || slug,
        updatedAt: st.mtimeMs,
        sizeBytes: st.size,
      })
    }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit)
}

// -------------------------------------------------------------- transcripts

const TOOL_SUMMARY_KEYS = ['file_path', 'command', 'pattern', 'path', 'prompt', 'url', 'description', 'query']

function summarizeToolInput(input) {
  if (!input || typeof input !== 'object') return ''
  for (const key of TOOL_SUMMARY_KEYS) {
    const v = input[key]
    if (typeof v === 'string' && v.trim()) return v.trim().replace(/\s+/g, ' ').slice(0, 160)
  }
  return ''
}

/**
 * Normalize raw transcript records into renderable events. Returns the byte
 * offset consumed so callers can poll for just the new tail.
 */
export function readTranscript(slug, sessionId, { fromOffset = 0, maxBytes = 256 * 1024 } = {}) {
  const file = transcriptPath(slug, sessionId)
  if (!file || !statOr(file)) return { events: [], offset: 0, size: 0 }

  const { lines, offset, size } = tailLines(file, maxBytes, fromOffset)
  const events = []

  for (const rec of lines) {
    const base = { uuid: rec.uuid, timestamp: rec.timestamp || null, sidechain: !!rec.isSidechain }

    if (rec.type === 'user' && !rec.isMeta) {
      const content = rec.message?.content
      if (typeof content === 'string') {
        if (content.startsWith('<local-command-caveat>')) continue
        events.push({ ...base, kind: 'user', text: content })
      } else if (Array.isArray(content)) {
        const texts = content.filter((b) => b.type === 'text').map((b) => b.text)
        const results = content.filter((b) => b.type === 'tool_result')
        if (texts.length) events.push({ ...base, kind: 'user', text: texts.join('\n') })
        for (const r of results) {
          const body = typeof r.content === 'string' ? r.content : JSON.stringify(r.content ?? '')
          events.push({
            ...base,
            kind: 'tool_result',
            isError: !!r.is_error,
            text: body.slice(0, 600),
            truncated: body.length > 600,
          })
        }
      }
      continue
    }

    if (rec.type === 'assistant') {
      const blocks = rec.message?.content
      if (!Array.isArray(blocks)) continue
      for (const b of blocks) {
        if (b.type === 'text' && b.text?.trim()) {
          events.push({ ...base, kind: 'assistant', text: b.text, model: rec.message?.model })
        } else if (b.type === 'thinking' && b.thinking?.trim()) {
          events.push({ ...base, kind: 'thinking', text: b.thinking })
        } else if (b.type === 'tool_use') {
          events.push({ ...base, kind: 'tool_use', tool: b.name, text: summarizeToolInput(b.input) })
        }
      }
      continue
    }

    if (rec.type === 'system' && rec.subtype !== 'local_command') {
      const text = typeof rec.content === 'string' ? rec.content : ''
      if (text.trim()) events.push({ ...base, kind: 'system', text: text.slice(0, 400) })
    }
  }

  return { events, offset, size }
}

/** Byte length of a transcript, for seeking to "now" without reading it. */
export function transcriptSize(slug, sessionId) {
  const file = transcriptPath(slug, sessionId)
  const st = file ? statOr(file) : null
  return st ? st.size : 0
}

/** Last thing Claude actually said, used to caption a completed turn. */
export function lastAssistantText(slug, sessionId) {
  const file = transcriptPath(slug, sessionId)
  if (!file) return ''
  const { lines } = tailLines(file, 96 * 1024)
  let text = ''
  for (const rec of lines) {
    if (rec.type !== 'assistant') continue
    const blocks = rec.message?.content
    if (!Array.isArray(blocks)) continue
    for (const b of blocks) {
      if (b.type === 'text' && b.text?.trim()) text = b.text.trim()
    }
  }
  return text.replace(/\s+/g, ' ').slice(0, 240)
}

const WRITE_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit'])
const READ_TOOLS = new Set(['Read', 'NotebookRead'])

/**
 * Which files a session has touched, from the tool calls in its transcript.
 * Reads and writes are counted separately — "edited" and "looked at" are very
 * different signals when you are trying to see what a session actually did.
 *
 * Transcripts routinely pass 10MB, so this scans each file once in full and
 * then only the appended bytes. A fixed tail window would silently miss every
 * edit made earlier in a long session.
 */
const fileActivityCache = new Map() // sessionId -> { offset, byPath }

export function readFileActivity(slug, sessionId) {
  const file = transcriptPath(slug, sessionId)
  if (!file || !statOr(file)) return []

  let state = fileActivityCache.get(sessionId)
  if (!state) {
    state = { offset: 0, byPath: new Map() }
    fileActivityCache.set(sessionId, state)
  }

  // maxBytes only applies to the first pass; after that we resume from offset.
  const { lines, offset } = tailLines(file, Number.MAX_SAFE_INTEGER, state.offset)
  state.offset = offset

  for (const rec of lines) {
    if (rec.type !== 'assistant') continue
    const blocks = rec.message?.content
    if (!Array.isArray(blocks)) continue
    const at = rec.timestamp ? Date.parse(rec.timestamp) : 0
    for (const b of blocks) {
      if (b.type !== 'tool_use') continue
      const isWrite = WRITE_TOOLS.has(b.name)
      if (!isWrite && !READ_TOOLS.has(b.name)) continue
      const fp = b.input?.file_path || b.input?.notebook_path
      if (typeof fp !== 'string' || !fp) continue
      const cur = state.byPath.get(fp) || { path: fp, reads: 0, writes: 0, lastAt: 0, lastTool: '' }
      if (isWrite) cur.writes++
      else cur.reads++
      if (at > cur.lastAt) {
        cur.lastAt = at
        cur.lastTool = b.name
      }
      state.byPath.set(fp, cur)
    }
  }

  // Writes first — those are the changes you actually need to know about.
  return [...state.byPath.values()].sort(
    (a, b) => b.writes - a.writes || b.lastAt - a.lastAt || a.path.localeCompare(b.path),
  )
}

// ------------------------------------------------------------------ snapshot

/** One poll of everything the dashboard renders, minus per-session transcripts. */
export function snapshot() {
  const sessions = listLiveSessions().map((s) => ({
    ...s,
    ...sessionMeta(s.slug, s.sessionId),
    subagents: listSubagents(s.slug, s.sessionId),
    tasks: readTasks(s.sessionId),
  }))

  const liveIds = new Set(sessions.map((s) => s.sessionId))
  const orphanTaskLists = allTaskLists().filter((l) => !liveIds.has(l.sessionId))

  return {
    at: Date.now(),
    sessions,
    jobs: listJobs(),
    ides: listIdeConnections(),
    orphanTaskLists,
    recent: listRecentSessions().filter((r) => !liveIds.has(r.sessionId)),
  }
}
