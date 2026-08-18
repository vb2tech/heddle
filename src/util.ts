export function relTime(ts: number | string | null | undefined): string {
  if (!ts) return '—'
  const ms = typeof ts === 'string' ? Date.parse(ts) : ts
  if (!ms || Number.isNaN(ms)) return '—'
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (s < 10) return 'now'
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

export function duration(fromMs: number): string {
  const s = Math.max(0, Math.round((Date.now() - fromMs) / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h ? `${h}h ${m}m` : `${m}m`
}

export function compactNum(n: number): string {
  if (!n) return '0'
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

export function shortModel(model: string | null | undefined): string {
  if (!model) return ''
  return model.replace(/^claude-/, '').replace(/-\d{8}$/, '').replace(/\[1m\]/, ' 1M')
}

const SMALL_WINDOW = 200_000
const LARGE_WINDOW = 1_000_000

/**
 * Which context window a session is running in.
 *
 * The transcript records `claude-opus-5` whether or not the 1M-context variant
 * is in use, so the model string alone cannot tell us. The one reliable signal
 * is exceeding the smaller window — you cannot hold 275k tokens in a 200k
 * window, so that session is demonstrably on the large one.
 *
 * A 1M session still under 200k is therefore reported against the small window,
 * which overstates pressure. That errs toward warning early, which is the safe
 * direction for a "compact soon" hint.
 */
export function contextWindowFor(tokens: number, model?: string | null): number {
  if (model && /\[1m\]/.test(model)) return LARGE_WINDOW
  return tokens > SMALL_WINDOW ? LARGE_WINDOW : SMALL_WINDOW
}

/** Share of the session's context window, clamped for display. */
export function contextPct(tokens: number, model?: string | null): number {
  return Math.min(100, Math.round((tokens / contextWindowFor(tokens, model)) * 100))
}
