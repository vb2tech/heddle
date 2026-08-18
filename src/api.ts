import type { FeedEvent, FileActivity, Idea, HistoryEntry, LabelMap, Snapshot, TranscriptEvent } from './types'

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

export const fetchIdeas = () => req<{ ideas: Idea[] }>('/ideas')

export const createIdea = (text: string, project = '', cwd = '') =>
  req<{ idea: Idea }>('/ideas', { method: 'POST', body: JSON.stringify({ text, project, cwd }) })

export const updateIdea = (id: string, patch: Partial<Idea>) =>
  req<{ idea: Idea }>('/ideas', { method: 'PATCH', body: JSON.stringify({ id, ...patch }) })

export const deleteIdea = (id: string) =>
  req<{ ok: boolean }>('/ideas', { method: 'DELETE', body: JSON.stringify({ id }) })

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
export const spawnSession = (cwd: string, opts: { sessionId?: string; prompt?: string } = {}) =>
  req<{ ok: boolean }>('/spawn', { method: 'POST', body: JSON.stringify({ cwd, ...opts }) })
