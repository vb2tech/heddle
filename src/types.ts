export type SessionStatus = 'busy' | 'idle' | 'unknown' | string

export interface Subagent {
  id: string
  file: string
  label: string | null
  sizeBytes: number
  updatedAt: number
  lastText: string
}

export interface Task {
  id: string
  subject: string
  description: string
  activeForm: string
  owner: string | null
  status: 'pending' | 'in_progress' | 'completed' | string
  blocks: string[]
  blockedBy: string[]
}

export interface Session {
  pid: number
  sessionId: string
  cwd: string
  project: string
  slug: string
  name: string
  kind: string
  entrypoint: string
  version: string
  status: SessionStatus
  startedAt: number
  updatedAt: number
  statusUpdatedAt: number
  bridgeSessionId: string | null
  aiTitle: string | null
  lastPrompt: string | null
  mode: string | null
  agentName: string | null
  contextTokens: number
  model: string | null
  turns: number
  subagents: Subagent[]
  tasks: Task[]
}

export interface Job {
  id: string
  state: string
  detail: string
  tempo: string | null
  tokens: number
  template: string | null
  updatedAt: number
  timeline: { at: string; state: string; detail: string }[]
}

export interface RecentSession {
  sessionId: string
  slug: string
  project: string
  updatedAt: number
  sizeBytes: number
}

export type FeedKind =
  | 'turn_done'
  | 'turn_start'
  | 'tool_error'
  | 'ctx_high'
  | 'compacted'
  | 'task_done'
  | 'task_started'
  | 'task_new'
  | 'agent_spawn'
  | 'session_start'
  | 'session_end'

export interface FeedEvent {
  id: string
  at: number
  kind: FeedKind
  severity: 'info' | 'attn' | 'warn'
  sessionId: string | null
  sessionName: string
  project: string
  cwd: string
  text: string
}

export interface FileActivity {
  path: string
  reads: number
  writes: number
  lastAt: number
  lastTool: string
}

export interface Snapshot {
  at: number
  sessions: Session[]
  jobs: Job[]
  ides: { pid: number; ideName: string; workspaceFolders: string[] }[]
  orphanTaskLists: { sessionId: string; tasks: Task[]; updatedAt: number }[]
  recent: RecentSession[]
  parked: ParkedItem[]
  summaries: SessionSummary[]
}

export type EventKind =
  | 'user'
  | 'assistant'
  | 'thinking'
  | 'tool_use'
  | 'tool_result'
  | 'system'

export interface TranscriptEvent {
  uuid?: string
  timestamp: string | null
  sidechain: boolean
  kind: EventKind
  text: string
  tool?: string
  model?: string
  isError?: boolean
  truncated?: boolean
}

export type ParkedStatus = 'open' | 'doing' | 'done'

/** An idea parked in the parking lot until you get to it. */
export interface ParkedItem {
  id: string
  text: string
  project: string
  cwd: string
  status: ParkedStatus | string
  /** Session this idea was handed to, once one has been adopted. */
  sessionId: string | null
  /** When `launch` fired; used to adopt the session that appears next. */
  launchedAt: number | null
  createdAt: number
}

export interface HistoryEntry {
  id: string
  text: string
  timestamp: number
  project: string
  cwd: string
  sessionId: string | null
}

export interface SessionLabel {
  label?: string
  color?: string
}

export type LabelMap = Record<string, SessionLabel>

export interface SessionSummary {
  sessionId: string
  slug: string
  /** `wrapped` was written by the model via /wrap; `extracted` is mechanical. */
  source: 'wrapped' | 'extracted' | string
  title: string
  project: string
  cwd: string
  model: string | null
  turns: number
  startedAt: number
  endedAt: number
  wrappedAt?: number
  asks: string[]
  done: string[]
  current: string
  next: string[]
  filesEdited: string[]
  filesRead: string[]
  commands: string[]
  errors: string[]
}
