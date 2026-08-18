import { useState } from 'react'
import type { Job } from '../types'
import { compactNum, relTime } from '../util'

export default function JobRow({ j }: { j: Job }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={`job ${j.state}`}>
      <button className="job-head" onClick={() => setOpen((v) => !v)}>
        <span className={`task-dot ${j.state}`} />
        <code className="mono">{j.id}</code>
        <span className="pill dim">{j.state}</span>
        {j.tempo && <span className="pill dim">{j.tempo}</span>}
        <span className="grow" />
        <span className="muted">{compactNum(j.tokens)} tok</span>
        <span className="muted">{relTime(j.updatedAt)}</span>
      </button>
      <div className="job-detail">{j.detail || '—'}</div>
      {open && j.timeline.length > 0 && (
        <div className="timeline">
          {j.timeline.map((e, i) => (
            <div className="timeline-row" key={i}>
              <span className="muted">{relTime(e.at)}</span>
              <span className="pill dim">{e.state}</span>
              <span className="timeline-detail">{e.detail}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
