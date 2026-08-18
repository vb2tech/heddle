import type { Session } from './types'

/**
 * What a session wants from you right now.
 *
 * A Claude CLI process goes `idle` the moment it finishes a turn, and it stays
 * idle until you type something. So idle is not "done" — it is "waiting on you",
 * which is exactly the state worth routing attention to when several terminals
 * are open. Past a threshold it stops being urgent and is just parked.
 */
export type Attention = 'working' | 'waiting' | 'parked'

export const PARKED_AFTER_MS = 20 * 60 * 1000

export function attentionOf(s: Session, now = Date.now()): Attention {
  if (s.status === 'busy') return 'working'
  return now - idleSince(s) > PARKED_AFTER_MS ? 'parked' : 'waiting'
}

export function idleSince(s: Session): number {
  return s.statusUpdatedAt || s.updatedAt || s.startedAt || Date.now()
}

/** Stable ordering. Sorting by activity would reshuffle tiles constantly as
 *  sessions flip busy/idle, which defeats the muscle memory of a fixed layout. */
export function stableOrder(sessions: Session[]): Session[] {
  return [...sessions].sort((a, b) => a.startedAt - b.startedAt || a.sessionId.localeCompare(b.sessionId))
}

/** Six hues that stay legible on both themes; assigned per session by default. */
export const TILE_COLORS = ['blue', 'green', 'amber', 'red', 'purple', 'cyan'] as const
export type TileColor = (typeof TILE_COLORS)[number]

export function autoColor(sessionId: string): TileColor {
  let h = 0
  for (let i = 0; i < sessionId.length; i++) h = (h * 31 + sessionId.charCodeAt(i)) >>> 0
  return TILE_COLORS[h % TILE_COLORS.length]
}
