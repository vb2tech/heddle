import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { fetchTranscript } from '../api'
import type { TranscriptEvent } from '../types'
import { relTime } from '../util'

const MAX_EVENTS = 400

const KIND_LABEL: Record<string, string> = {
  user: 'you',
  assistant: 'claude',
  thinking: 'thinking',
  tool_use: 'tool',
  tool_result: 'result',
  system: 'system',
}

interface Props {
  slug: string
  sessionId: string
  showThinking: boolean
  showTools: boolean
  /** Poll interval; the deck slows this down since several tiles tail at once. */
  intervalMs?: number
  dense?: boolean
}

/**
 * Tails one session's transcript by byte offset and renders it. Owns its own
 * polling so several of these can run side by side in the deck.
 */
export default function SessionTranscript({
  slug,
  sessionId,
  showThinking,
  showTools,
  intervalMs = 700,
  dense = false,
}: Props) {
  const [events, setEvents] = useState<TranscriptEvent[]>([])
  const offset = useRef(0)
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  // Keyed on identifiers only — depending on the session object would restart
  // the tail on every snapshot push, since each arrives as a fresh object.
  useEffect(() => {
    if (!slug || !sessionId) {
      setEvents([])
      return
    }
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
    const t = setInterval(pull, intervalMs)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [slug, sessionId, intervalMs])

  useLayoutEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [events])

  const onScroll = () => {
    const el = scroller.current
    if (!el) return
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  const visible = events.filter((e) => {
    if (e.kind === 'thinking') return showThinking
    if (e.kind === 'tool_use' || e.kind === 'tool_result') return showTools
    return true
  })

  return (
    <div className={`chat-scroll ${dense ? 'dense' : ''}`} ref={scroller} onScroll={onScroll}>
      {!visible.length && <div className="empty">No transcript output yet.</div>}
      {visible.map((e, i) => (
        <div
          key={`${e.uuid || i}-${i}`}
          className={`ev ev-${e.kind} ${
            e.kind === 'tool_use' || e.kind === 'tool_result' || e.kind === 'system' ? 'compact' : ''
          } ${e.isError ? 'err' : ''}`}
        >
          <div className="ev-gutter">
            <span className="ev-kind">{e.tool || KIND_LABEL[e.kind] || e.kind}</span>
            {e.sidechain && <span className="ev-side" title="subagent sidechain">↳</span>}
          </div>
          <div className="ev-body">
            {e.text}
            {e.truncated && <span className="muted"> …</span>}
          </div>
          <div className="ev-time">{relTime(e.timestamp)}</div>
        </div>
      ))}
    </div>
  )
}
