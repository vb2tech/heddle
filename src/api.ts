import type { FeedEvent, FileActivity, HistoryEntry, LabelMap, ParkedItem, SessionSummary, Snapshot, TranscriptEvent } from './types'

const BASE = '/api'

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers || {}) },
  })
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
  return res.json() as Promise<T>
}

/** Subscribe to snapshot pushes. Returns an unsubscribe function. */
export function subscribeSnapshots(
  onSnapshot: (s: Snapshot) => void,
  onStatus: (connected: boolean) => void,
): () => void {
  const es = new EventSource(`${BASE}/events`)
  es.addEventListener('snapshot', (e) => {
    onStatus(true)
    try {
      onSnapshot(JSON.parse((e as MessageEvent).data))
    } catch {
      /* ignore malformed frame */
    }
  })
  es.onopen = () => onStatus(true)
  es.onerror = () => onStatus(false)
  return () => es.close()
}

export function fetchTranscript(slug: string, sessionId: string, offset = 0) {
  const q = new URLSearchParams({ slug, sessionId, offset: String(offset) })
  return req<{ events: TranscriptEvent[]; offset: number; size: number }>(`/transcript?${q}`)
}

export const fetchSummaries = () => req<{ summaries: SessionSummary[] }>('/summaries')

export const generateSummary = (sessionId: string, slug: string) =>
  req<{ summaries: SessionSummary[] }>('/summaries', {
    method: 'POST',
    body: JSON.stringify({ sessionId, slug }),
  })

export const deleteSummary = (sessionId: string) =>
  req<{ summaries: SessionSummary[] }>('/summaries', {
    method: 'DELETE',
    body: JSON.stringify({ sessionId }),
  })

export const summaryMarkdown = (sessionId: string) =>
  req<{ markdown: string }>(`/summaries/markdown?sessionId=${encodeURIComponent(sessionId)}`)

export const fetchParked = () => req<{ parked: ParkedItem[] }>('/parking')

export const createParked = (text: string, cwd = '') =>
  req<{ parked: ParkedItem[] }>('/parking', { method: 'POST', body: JSON.stringify({ text, cwd }) })

export const updateParked = (id: string, patch: Partial<ParkedItem>) =>
  req<{ parked: ParkedItem[] }>('/parking', { method: 'PATCH', body: JSON.stringify({ id, ...patch }) })

export const deleteParked = (id: string) =>
  req<{ parked: ParkedItem[] }>('/parking', { method: 'DELETE', body: JSON.stringify({ id }) })

export const reorderParked = (ids: string[]) =>
  req<{ parked: ParkedItem[] }>('/parking/reorder', { method: 'POST', body: JSON.stringify({ ids }) })

export const fetchHistory = (limit = 300) =>
  req<{ history: HistoryEntry[] }>(`/history?limit=${limit}`)

export function fetchFiles(slug: string, sessionId: string) {
  const q = new URLSearchParams({ slug, sessionId })
  return req<{ files: FileActivity[] }>(`/files?${q}`)
}

export const fetchFeed = (limit = 150) => req<{ feed: FeedEvent[] }>(`/feed?limit=${limit}`)

export const fetchLabels = () => req<{ labels: LabelMap }>('/labels')

export const setLabel = (sessionId: string, patch: { label?: string; color?: string }) =>
  req<{ labels: LabelMap }>('/labels', { method: 'PATCH', body: JSON.stringify({ sessionId, ...patch }) })

/**
 * Opens a new terminal running `claude`, optionally seeded with a prompt.
 * Currently only reachable from the queue's "launch" action — the per-session
 * spawn button was removed as noise, but the capability is kept.
 */
export const spawnSession = (
  cwd: string,
  opts: { sessionId?: string; prompt?: string; parkedId?: string } = {},
) =>
  req<{ ok: boolean }>('/spawn', { method: 'POST', body: JSON.stringify({ cwd, ...opts }) })
