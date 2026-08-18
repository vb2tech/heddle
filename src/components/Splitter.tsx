import { useCallback, useRef } from 'react'

interface Props {
  axis: 'vertical' | 'horizontal'
  /** Drag delta, expressed as a percentage of the parent's size. */
  onDelta: (pct: number) => void
}

/**
 * Drag handle between panes. Reports movement as a percentage of the parent so
 * the layout stays proportional across window sizes.
 */
export default function Splitter({ axis, onDelta }: Props) {
  const last = useRef(0)

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const el = e.currentTarget
      const parent = el.parentElement
      if (!parent) return
      const total = axis === 'vertical' ? parent.clientWidth : parent.clientHeight
      if (!total) return

      el.setPointerCapture(e.pointerId)
      last.current = axis === 'vertical' ? e.clientX : e.clientY

      const move = (ev: PointerEvent) => {
        const pos = axis === 'vertical' ? ev.clientX : ev.clientY
        const delta = pos - last.current
        if (!delta) return
        last.current = pos
        onDelta((delta / total) * 100)
      }
      const up = () => {
        el.releasePointerCapture(e.pointerId)
        el.removeEventListener('pointermove', move)
        el.removeEventListener('pointerup', up)
      }
      el.addEventListener('pointermove', move)
      el.addEventListener('pointerup', up)
    },
    [axis, onDelta],
  )

  return <div className={`splitter ${axis}`} onPointerDown={onPointerDown} role="separator" />
}
