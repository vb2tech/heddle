// Builds a reusable checkpoint for a session.
//
// Two producers write the same format:
//   - `/wrap` inside a session, where the model has full context and writes a
//     genuinely synthesised checkpoint for ~one cache-warm turn.
//   - this module, which extracts one mechanically when a session ends without
//     being wrapped. Free, but literal.
//
// The shape follows the Done / Currently working on / Next steps checkpoint
// convention already used in this user's CLAUDE.md, so the output drops
// straight into an existing habit rather than inventing a new one.

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

import { readTranscript, readFileActivity, readTasks, sessionMeta, transcriptPath } from './store.mjs'

export const SUMMARY_DIR = process.env.HEDDLE_SUMMARY_DIR || path.join(os.homedir(), '.heddle', 'summaries')
// `/wrap` cannot know its own session id, so it drops a file tagged with cwd
// here and the server adopts it — the same pattern used for launched ideas.
export const PENDING_DIR = path.join(SUMMARY_DIR, 'pending')

const MAX_SCAN = Number.MAX_SAFE_INTEGER

function ensureDir() {
  fs.mkdirSync(SUMMARY_DIR, { recursive: true })
}

/** Last sentence-ish chunk of a block of prose, used as a closing statement. */
function firstLine(text, max = 200) {
  const line = String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#*`>]/g, '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0)
  return (line || '').slice(0, max)
}

/**
 * Extract the *facts* of a session from its transcript.
 *
 * Deliberately no Done/Current/Next here. An earlier version tried to synthesise
 * those from turn-closing prose and produced garbage — the opening line of a
 * reply is a lead-in, not a conclusion, so "Done" filled up with things like
 * "Honest breakdown, and the data changes my answer." Extraction can tell you
 * reliably what was asked, what changed on disk, and what failed; it cannot tell
 * you what any of it meant. That is what `/wrap` is for.
 */
export function buildSummary(slug, sessionId, session = {}) {
  const file = transcriptPath(slug, sessionId)
  if (!file || !fs.existsSync(file)) return null

  const { events } = readTranscript(slug, sessionId, { fromOffset: 0, maxBytes: MAX_SCAN })
  const meta = sessionMeta(slug, sessionId)

  const asks = []
  const errors = []
  const commands = []
  let firstAt = null
  let lastAt = null

  for (const e of events) {
    if (e.sidechain) continue
    if (e.timestamp) {
      if (!firstAt) firstAt = e.timestamp
      lastAt = e.timestamp
    }
    if (e.kind === 'user') {
      const t = e.text.replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, '').trim()
      // Interrupt markers are noise, and a resent prompt should appear once.
      if (t && !/^\[Request interrupted/.test(t)) {
        const line = firstLine(t, 220)
        if (line && line !== asks[asks.length - 1]) asks.push(line)
      }
    } else if (e.kind === 'tool_use' && e.tool === 'Bash') {
      const cmd = (e.text || '').replace(/^cd\s+(?:'[^']*'|"[^"]*"|\S+)\s*(?:&&|;)?\s*/, '').slice(0, 120)
      if (cmd) commands.push(cmd)
    } else if (e.kind === 'tool_result' && e.isError) {
      errors.push(firstLine(e.text, 160))
    }
  }
  const files = readFileActivity(slug, sessionId)
  const tasks = readTasks(sessionId)

  return {
    sessionId,
    slug,
    source: 'extracted',
    title: meta.aiTitle || session.name || sessionId.slice(0, 8),
    project: session.project || path.basename(session.cwd || meta.cwd || '') || '',
    cwd: session.cwd || meta.cwd || '',
    model: meta.model || null,
    turns: meta.turns || 0,
    contextTokens: meta.contextTokens || 0,
    startedAt: session.startedAt || (firstAt ? Date.parse(firstAt) : 0),
    endedAt: Date.now(),
    lastActivityAt: lastAt ? Date.parse(lastAt) : 0,
    asks: asks.slice(-15),
    // Synthesis fields stay empty unless `/wrap` filled them in.
    done: [],
    current: '',
    next: tasks.filter((t) => t.status !== 'completed').map((t) => t.subject),
    filesEdited: files.filter((f) => f.writes > 0).map((f) => f.path),
    filesRead: files.filter((f) => f.writes === 0).map((f) => f.path),
    commands: [...new Set(commands)].slice(-12),
    errors: errors.slice(-6),
  }
}

/** Render a checkpoint as the markdown that gets copied or pasted into a prompt. */
export function toMarkdown(s) {
  const rel = (p) => (s.cwd && p.startsWith(s.cwd) ? p.slice(s.cwd.length + 1) : p)
  const lines = []
  lines.push(`# ${s.title}`)
  lines.push('')
  lines.push(`**Project:** ${s.project || '—'} · \`${s.cwd}\``)
  if (s.model) lines.push(`**Model:** ${s.model} · ${s.turns} turns`)
  lines.push('')

  if (s.source === 'extracted') {
    lines.push('> Extracted automatically from the transcript — facts only, no synthesis.')
    lines.push('')
  }
  if (s.asks.length) {
    lines.push('## What was asked')
    for (const a of s.asks) lines.push(`- ${a}`)
    lines.push('')
  }
  if (s.done.length) {
    lines.push('## Done so far')
    for (const d of s.done) lines.push(`- ${d}`)
    lines.push('')
  }
  if (s.current) {
    lines.push('## Currently working on')
    lines.push(s.current)
    lines.push('')
  }
  if (s.next.length) {
    lines.push('## Next steps')
    for (const n of s.next) lines.push(`- ${n}`)
    lines.push('')
  }
  if (s.commands.length) {
    lines.push('## Commands run')
    for (const c of s.commands.slice(0, 12)) lines.push(`- \`${c}\``)
    lines.push('')
  }
  if (s.filesEdited.length) {
    lines.push('## Files changed')
    for (const f of s.filesEdited.slice(0, 30)) lines.push(`- \`${rel(f)}\``)
    lines.push('')
  }
  if (s.errors.length) {
    lines.push('## Problems hit')
    for (const e of s.errors) lines.push(`- ${e}`)
    lines.push('')
  }
  return lines.join('\n')
}

// ------------------------------------------------------------------ storage

const summaryPath = (sessionId) => path.join(SUMMARY_DIR, `${sessionId}.json`)

export function saveSummary(summary) {
  ensureDir()
  fs.writeFileSync(summaryPath(summary.sessionId), JSON.stringify(summary, null, 2))
  return summary
}

export function hasSummary(sessionId) {
  return fs.existsSync(summaryPath(sessionId))
}

export function listSummaries(limit = 40) {
  ensureDir()
  const out = []
  for (const name of fs.readdirSync(SUMMARY_DIR)) {
    if (!name.endsWith('.json')) continue
    try {
      out.push(JSON.parse(fs.readFileSync(path.join(SUMMARY_DIR, name), 'utf8')))
    } catch {
      /* skip unreadable */
    }
  }
  return out.sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0)).slice(0, limit)
}

export function deleteSummary(sessionId) {
  try {
    fs.unlinkSync(summaryPath(sessionId))
    return true
  } catch {
    return false
  }
}

// ------------------------------------------------------------------ pending

/**
 * Adopt checkpoints written by `/wrap`, matching them to a session by cwd and
 * merging the model's synthesis over the mechanically extracted facts.
 */
export function adoptPendingSummaries(sessions) {
  let adopted = 0
  let files = []
  try {
    files = fs.readdirSync(PENDING_DIR).filter((f) => f.endsWith('.json'))
  } catch {
    return 0
  }

  for (const name of files) {
    const full = path.join(PENDING_DIR, name)
    let pending
    try {
      pending = JSON.parse(fs.readFileSync(full, 'utf8'))
    } catch {
      continue // half-written; try again next poll
    }
    if (!pending?.cwd) {
      fs.unlinkSync(full)
      continue
    }

    // Most recently active session in that directory wins.
    const match = sessions
      .filter((s) => s.cwd === pending.cwd)
      .sort((a, b) => (b.statusUpdatedAt || 0) - (a.statusUpdatedAt || 0))[0]
    if (!match) continue // session may not have registered yet

    const base = buildSummary(match.slug, match.sessionId, match) || {}
    saveSummary({
      ...base,
      sessionId: match.sessionId,
      slug: match.slug,
      source: 'wrapped',
      title: pending.title || base.title,
      done: Array.isArray(pending.done) ? pending.done : [],
      current: typeof pending.current === 'string' ? pending.current : '',
      next: Array.isArray(pending.next) && pending.next.length ? pending.next : base.next || [],
      wrappedAt: Date.now(),
    })
    fs.unlinkSync(full)
    adopted++
  }
  return adopted
}
