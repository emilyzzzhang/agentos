export type AgentId = 'alex' | 'milo' | 'luna'
export const AGENT_IDS: AgentId[] = ['alex', 'milo', 'luna']

export type EventType =
  | 'run.started'
  | 'task.assigned'
  | 'agent.started'
  | 'agent.completed'
  | 'agent.failed'
  | 'tool.started'
  | 'tool.completed'
  | 'tool.failed'
  | 'review.requested'
  | 'report.generated'
  | 'run.completed'
  | 'run.failed'
  | 'rag.retrieval_started'
  | 'rag.retrieval_completed'
  | 'rag.retrieval_failed'

/** Workspace-level Knowledge Library events (GET /documents/events). Never part of a run stream. */
export type LibraryEventType =
  | 'document.uploaded'
  | 'document.indexing_started'
  | 'document.indexing_completed'
  | 'document.indexing_failed'
  | 'document.deleted'

export interface ExecutionEvent {
  id: string
  /** null only for workspace-level document events */
  run_id: string | null
  seq: number
  timestamp: string
  type: EventType
  agent_id: AgentId | null
  task_id: string | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: Record<string, any>
}

export interface Subtask {
  id: string
  title: string
  description: string
  search_queries: string[]
  evidence_source?: EvidenceSource
}

export type EvidenceSource = 'web' | 'documents' | 'both'

export interface Plan {
  objective: string
  approach: string
  subtasks: Subtask[]
  success_criteria: string[]
}

export interface Finding {
  claim: string
  evidence: string
  source_ids: string[]
  subtask_id: string
  confidence: 'high' | 'medium' | 'low'
}

export interface SourceRef {
  id?: string
  kind?: 'web' | 'document'
  url: string
  title: string
  filename?: string
  document_id?: string | null
  chunk_id?: string | null
  page?: number | null
  section?: string | null
  score?: number | null
  /** official | standard | paper | reference | news | community | other (web sources only) */
  source_type?: string | null
}

/** A retrieved document passage reference (metadata only; text is fetched on demand). */
export interface PassageRef {
  document_id: string
  chunk_id: string
  title: string
  filename: string
  page: number | null
  section: string | null
  /** Cosine similarity for this query. Ranks results; not a probability. */
  score: number | null
}

export type AgentStatus = 'idle' | 'working' | 'waiting' | 'done' | 'error'

export interface ToolCall {
  id: string
  kind: 'web' | 'documents'
  taskId: string | null
  query: string
  passages?: PassageRef[]
  status: 'running' | 'done' | 'failed'
  sourceCount?: number
  sources?: SourceRef[]
  error?: string
  startedAt: string
  endedAt?: string
}

export interface Activity {
  seq: number
  timestamp: string
  type: EventType
  text: string
}

export interface AgentState {
  id: AgentId
  name: string
  role: string
  status: AgentStatus
  currentTask: { id: string; title: string } | null
  activities: Activity[]
  toolCalls: ToolCall[]
  findings: Finding[]
  sources: SourceRef[]
  notes: string[]
  error: string | null
}

export type TaskStatus = 'assigned' | 'in_progress' | 'done' | 'failed'

export interface Task {
  id: string
  title: string
  description: string
  from: AgentId
  assignee: AgentId
  status: TaskStatus
  queries: string[]
}

export type Stage = 'idle' | 'planning' | 'research' | 'review' | 'report' | 'done' | 'failed'

export interface ReviewRecord {
  round: number
  verdict: 'approve' | 'revise'
  assessment: string
  missing: string[]
  unsupported: string[]
  limitReached: boolean
}

export interface Mission {
  runId: string
  question: string
  mode: 'live' | 'demo'
  model: string
  searchProvider: string
  maxRevisions: number
  plan: Plan | null
  stage: Stage
  researchRound: number
  reviews: ReviewRecord[]
  startedAt: string
  finishedAt: string | null
  error: string | null
  /** Stage that was active when the run failed or was cancelled. */
  failedStage: Stage | null
  cancelled: boolean
  reportTitle: string | null
  summary: Record<string, unknown> | null
  knowledge: { document_count: number; explicit: boolean; documents: { id: string; title: string; filename: string }[] } | null
}

export interface ReportResponse {
  run_id: string
  title: string
  markdown: string
  path: string
  mode: 'live' | 'demo'
  sources: (SourceRef & { citation_number: number })[]
  report_type?: 'comparison' | 'study_plan' | 'research' | 'how_to' | 'explanation' | 'summary' | null
}

export interface KnowledgeInfo {
  status: 'starting' | 'ready' | 'unavailable'
  error: string | null
  embedding_model: string
  embedding_dim: number | null
  collection: string | null
  chunk_size: number
  chunk_overlap: number
  max_upload_mb: number
  top_k: number
  min_score: number
}

export type DocumentStatus = 'pending' | 'processing' | 'ready' | 'failed'

export interface LibraryDocument {
  id: string
  filename: string
  title: string
  file_type: 'pdf' | 'markdown' | 'text'
  content_type: string
  size_bytes: number
  sha256: string
  status: DocumentStatus
  error: string | null
  page_count: number | null
  chunk_count: number
  embedding_model: string | null
  embedding_dim: number | null
  chunk_size: number | null
  chunk_overlap: number | null
  created_at: string
  updated_at: string
  indexed_at: string | null
  needs_reindex: boolean
}

export interface Passage {
  chunk_id: string
  document_id: string
  filename: string
  title: string
  file_type: LibraryDocument['file_type']
  chunk_index: number
  page: number | null
  section: string | null
  text: string
}

export interface EvidenceItem {
  id: string
  kind: 'web' | 'document'
  title: string
  url: string | null
  document_id: string | null
  chunk_id: string | null
  page: number | null
  section: string | null
  query: string | null
  score: number | null
  text: string | null
  cited: boolean
  citation_number: number | null
  document_deleted: boolean
  source_type?: string | null
}

/** null = all ready documents, [] = web only, [ids] = selection */
export type DocumentScope = string[] | null

export interface Health {
  ok: boolean
  model: string
  search_provider: string
  api_key_configured: boolean
  demo_enabled: boolean
  active_run_id: string | null
  max_revisions: number
  knowledge?: KnowledgeInfo | null
}

export type ConnectionState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed' | 'error'
