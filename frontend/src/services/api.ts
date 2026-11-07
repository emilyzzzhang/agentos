import type {
  DocumentScope, EvidenceItem, ExecutionEvent, Health, KnowledgeInfo, LibraryDocument, Passage, ReportResponse,
} from '../types'

export const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api'

export class ApiError extends Error {
  status: number
  detail: unknown
  constructor(status: number, message: string, detail?: unknown) {
    super(message)
    this.status = status
    this.detail = detail
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  const json = !(init?.body instanceof FormData) // let the browser set the multipart boundary
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { ...(json ? { 'Content-Type': 'application/json' } : {}), ...(init?.headers ?? {}) },
    })
  } catch {
    throw new ApiError(0, 'Cannot reach the AgentOS backend. Is it running on port 8000?')
  }
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    const detail = body?.detail
    const message =
      typeof detail === 'string' ? detail : detail?.message ?? `Request failed (${res.status})`
    throw new ApiError(res.status, message, detail)
  }
  return body as T
}

export interface RunSummary {
  run_id: string
  question: string
  mode: 'live' | 'demo'
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
  error: string | null
  created_at: string
  finished_at: string | null
  last_seq: number
  event_count: number
  report_title: string | null
  source_count: number | null
  has_report: boolean
  document_scope: DocumentScope
}

export const api = {
  health: () => request<Health>('/health'),
  startRun: (question: string, mode: 'live' | 'demo', documentIds: DocumentScope = null) =>
    request<RunSummary>('/runs', {
      method: 'POST',
      body: JSON.stringify(documentIds === null ? { question, mode } : { question, mode, document_ids: documentIds }),
    }),
  listRuns: (limit = 30) => request<{ runs: RunSummary[] }>(`/runs?limit=${limit}`),
  getEvidence: (runId: string) => request<{ run_id: string; evidence: EvidenceItem[] }>(`/runs/${runId}/evidence`),
  listDocuments: () =>
    request<{ documents: LibraryDocument[]; knowledge: KnowledgeInfo; events_seq: number }>('/documents'),
  uploadDocument: (file: File) => {
    const body = new FormData()
    body.append('file', file, file.name)
    return request<LibraryDocument>('/documents', { method: 'POST', body })
  },
  deleteDocument: (id: string) => request<{ deleted: boolean }>(`/documents/${id}`, { method: 'DELETE' }),
  reindexDocument: (id: string) => request<LibraryDocument>(`/documents/${id}/reindex`, { method: 'POST' }),
  getPassage: (documentId: string, chunkId: string) => request<Passage>(`/documents/${documentId}/chunks/${chunkId}`),
  documentFileUrl: (documentId: string, page?: number | null) =>
    `${API_BASE}/documents/${documentId}/file${page ? `#page=${page}` : ''}`,
  documentEventsUrl: (after: number) => `${API_BASE}/documents/events?after=${after}`,
  getRun: (runId: string) => request<RunSummary>(`/runs/${runId}`),
  cancelRun: (runId: string) => request<{ cancelled: boolean }>(`/runs/${runId}/cancel`, { method: 'POST' }),
  getReport: (runId: string) => request<ReportResponse>(`/runs/${runId}/report`),
  listEvents: (runId: string, after = 0) => request<ExecutionEvent[]>(`/runs/${runId}/events.json?after=${after}`),
  reportMarkdownUrl: (runId: string) => `${API_BASE}/runs/${runId}/report?format=markdown`,
}
