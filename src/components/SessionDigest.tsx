import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchTranscript } from '../api'
import type { TranscriptEvent } from '../types'
import { relTime } from '../util'
import Markdown from './Markdown'

const MAX_EVENTS = 600

/**
 * A plain-English reading of a session.
 *
 * Deliberately not model-generated. The transcript already contains plain
 * English — Claude's own prose — so no summarisation is needed to produce it.
 * What makes the raw view unskimmable is that the prose sits between tool calls
 * and large result blobs. This keeps the prose verbatim, folds each run of tool
 * activity into a single line, and surfaces failures. Free, instant, offline.
 */

interface Action {
  verb: string
  targets: string[]
}

interface Beat {
  id: string
  at: string | null
  ask: string | null
  says: string[]
  actions: Action[]
  errors: string[]
}

const VERBS: Record<string, string> = {
  Read: 'read',
  NotebookRead: 'read',
  Grep: 'searched',
  Glob: 'searched',
  Edit: 'edited',
  MultiEdit: 'edited',
  Write: 'wrote',
  NotebookEdit: 'edited',
  Bash: 'ran',
  Task: 'delegated',
  Agent: 'delegated',
  WebFetch: 'looked up',
  WebSearch: 'looked up',
  TaskCreate: 'planned',
  TaskUpdate: 'planned',
}

function verbFor(tool: string | undefined): string {
  if (!tool) return 'used a tool'
  if (VERBS[tool]) return VERBS[tool]
  // MCP tools arrive as mcp__server__method; the method is the readable part.
  if (tool.startsWith('mcp__')) return `used ${tool.split('__').pop()}`
  return `used ${tool}`
}

/**
 * Shorten a shell command to the part that carries meaning. A leading
 * `cd <long path> &&` is scaffolding, and absolute home paths bury the verb.
 */
function readableCommand(raw: string): string {
  let cmd = raw.split('\n')[0].trim()
  // The server collapses newlines to spaces, so `cd X` may be followed by a
  // separator or simply by the next command.
  cmd = cmd.replace(/^cd\s+(?:'[^']*'|"[^"]*"|\S+)\s*(?:&&|;)?\s*/, '')
  cmd = cmd.replace(/\/Users\/[^/\s]+/g, '~')
  return cmd
}

function targetFor(e: TranscriptEvent): string {
  const raw = (e.text || '').trim()
  if (!raw) return ''
  if (e.tool === 'Bash') return readableCommand(raw)
  // File-ish targets read better as just the filename.
  return raw.includes('/') ? raw.split('/').pop()! : raw.slice(0, 60)
}

function foldBeats(events: TranscriptEvent[]): Beat[] {
  const beats: Beat[] = []
  let cur: Beat | null = null
  // Returns the beat rather than assigning it, so narrowing stays sound.
  const open = (at: string | null, ask: string | null): Beat => {
    const beat: Beat = { id: `${beats.length}-${at ?? ''}`, at, ask, says: [], actions: [], errors: [] }
    beats.push(beat)
    return beat
  }

  for (const e of events) {
    if (e.sidechain) continue
    switch (e.kind) {
      case 'user':
        cur = open(e.timestamp, e.text.trim())
        break
      case 'assistant': {
        const b = cur ?? (cur = open(e.timestamp, null))
        if (e.text.trim()) b.says.push(e.text)
        break
      }
      case 'tool_use': {
        const b = cur ?? (cur = open(e.timestamp, null))
        const verb = verbFor(e.tool)
        const target = targetFor(e)
        const last = b.actions[b.actions.length - 1]
        // Collapse consecutive same-verb calls into one line.
        if (last && last.verb === verb) {
          if (target) last.targets.push(target)
        } else {
          b.actions.push({ verb, targets: target ? [target] : [] })
        }
        break
      }
      case 'tool_result':
        if (e.isError && cur) cur.errors.push(e.text.replace(/\s+/g, ' ').slice(0, 160))
        break
      default:
        break // thinking and system noise belong in the raw view
    }
  }
  return beats
}

interface Props {
  slug: string
  sessionId: string
  /** Shown as the closing line so the digest ends with what to do next. */
  standing: string
  working: boolean
}

export default function SessionDigest({ slug, sessionId, standing, working }: Props) {
  const [events, setEvents] = useState<TranscriptEvent[]>([])
  const [showSteps, setShowSteps] = useState(true)
  const offset = useRef(0)
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  useEffect(() => {
    if (!slug || !sessionId) return
    let cancelled = false
    offset.current = 0
    setEvents([])
    stick.current = true

    const pull = async () => {
      try {
        const r = await fetchTranscript(slug, sessionId, offset.current)
        if (cancelled) return
        offset.current = r.offset
        if (r.events.length) setEvents((prev) => [...prev, ...r.events].slice(-MAX_EVENTS))
      } catch {
        /* transcript may not exist yet */
      }
    }
    pull()
    const t = setInterval(pull, 900)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [slug, sessionId])

  const beats = useMemo(() => foldBeats(events), [events])

  useEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [beats])

  const onScroll = () => {
    const el = scroller.current
    if (!el) return
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  // One wrapper, so the hosting pane's grid always sees a single child.
  return (
    <div className="digest-wrap">
      <div className="digest-bar">
        <span className="muted">plain english · prose verbatim, steps collapsed</span>
        <span className="grow" />
        <button className="toggle" data-on={showSteps} onClick={() => setShowSteps((v) => !v)}>
          steps
        </button>
      </div>
      <div className="digest" ref={scroller} onScroll={onScroll}>
        {!beats.length && <div className="empty">Nothing said yet.</div>}
        {beats.map((b) => (
          <div className="beat" key={b.id}>
            {b.ask && (
              <div className="beat-ask">
                <span className="beat-who">you</span>
                <span className="beat-asktext">{b.ask}</span>
                <span className="beat-time">{relTime(b.at)}</span>
              </div>
            )}
            {b.says.map((t, i) => (
              <div className="beat-says" key={i}>
                <Markdown source={t} />
              </div>
            ))}
            {showSteps &&
              b.actions.map((a, i) => (
                <div className="beat-step" key={i}>
                  <span className="beat-verb">
                    {a.verb}
                    {a.targets.length > 1 && <span className="beat-count"> ×{a.targets.length}</span>}
                  </span>
                  {a.targets.length > 0 && (
                    <span className="beat-targets">
                      {a.targets.length > 4
                        ? `${a.targets.slice(0, 4).join(' · ')} +${a.targets.length - 4} more`
                        : a.targets.join(' · ')}
                    </span>
                  )}
                </div>
              ))}
            {b.errors.map((t, i) => (
              <div className="beat-error" key={i}>
                ⚠ {t}
              </div>
            ))}
          </div>
        ))}
        {beats.length > 0 && (
          <div className={`beat-standing ${working ? 'live' : ''}`}>
            {working && <span className="beat-pulse" />}
            {standing}
          </div>
        )}
      </div>
    </div>
  )
}
