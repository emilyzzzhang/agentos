import { create } from 'zustand'
import { api, ApiError } from '../services/api'
import { connectRunStream } from '../services/eventStream'
import type { ConnectionState, ExecutionEvent, Health, ReportResponse } from '../types'
import { missionScope, useLibraryStore } from './libraryStore'
import { applyEvent, initialExec, type ExecState } from './reduce'

/** Listeners get every *new* event (after de-duplication). `replay` = historical catch-up. */
type Listener = (e: ExecutionEvent, replay: boolean) => void
const listeners = new Set<Listener>()
export const onExecutionEvent = (l: Listener) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

const RUN_KEY = 'agentos.activeRun'
const storage = {
  get: () => { try { return localStorage.getItem(RUN_KEY) } catch { return null } },
  set: (v: string | null) => { try { if (v) localStorage.setItem(RUN_KEY, v); else localStorage.removeItem(RUN_KEY) } catch { /* ignore */ } },
}

interface RunStore extends ExecState {
  runId: string | null
  connection: ConnectionState
  connectionDetail: string | null
  health: Health | null
  healthError: string | null
  startError: string | null
  starting: boolean
  report: ReportResponse | null
  reportError: string | null
  ingest: (e: ExecutionEvent) => void
  refreshHealth: () => Promise<void>
  start: (question: string, mode: 'live' | 'demo') => Promise<void>
  attach: (runId: string) => void
  resume: () => Promise<void>
  cancel: () => Promise<void>
  loadReport: () => Promise<void>
  clear: () => void
}

let disconnect: (() => void) | null = null
// Events older than this when received are treated as replayed history (no animation).
const REPLAY_THRESHOLD_MS = 8000

export const useRunStore = create<RunStore>((set, get) => ({
  ...initialExec(),
  runId: null,
  connection: 'idle',
  connectionDetail: null,
  health: null,
  healthError: null,
  startError: null,
  starting: false,
  report: null,
  reportError: null,

  ingest: (e) => {
    const prev = get()
    if (e.seq <= prev.lastSeq) return
    const next = applyEvent(prev, e)
    if (next === prev) return
    set({ mission: next.mission, agents: next.agents, tasks: next.tasks, taskOrder: next.taskOrder, events: next.events, feed: next.feed, lastSeq: next.lastSeq })
    const replay = Date.now() - new Date(e.timestamp).getTime() > REPLAY_THRESHOLD_MS
    listeners.forEach((l) => l(e, replay))
    // The report endpoint answers 425 until the run has finished, so fetch it on completion only.
    if (e.type === 'run.completed') void get().loadReport()
  },

  refreshHealth: async () => {
    try {
      set({ health: await api.health(), healthError: null })
    } catch (err) {
      set({ healthError: (err as Error).message })
    }
  },

  start: async (question, mode) => {
    set({ starting: true, startError: null })
    try {
      const run = await api.startRun(question, mode, missionScope(useLibraryStore.getState()))
      get().attach(run.run_id)
    } catch (err) {
      const e = err as ApiError
      if (e.status === 409) {
        const active = (e.detail as { active_run_id?: string })?.active_run_id
        set({ startError: 'A mission is already running in this office. Showing it now.' })
        if (active && active !== get().runId) get().attach(active)
      } else {
        set({ startError: e.message })
      }
    } finally {
      set({ starting: false })
      void get().refreshHealth()
    }
  },

  attach: (runId) => {
    disconnect?.()
    storage.set(runId)
    set({ ...initialExec(), runId, report: null, reportError: null, connectionDetail: null })
    disconnect = connectRunStream(runId, {
      getLastSeq: () => get().lastSeq,
      onEvent: (e) => get().ingest(e),
      onState: (connection, detail) => set({ connection, connectionDetail: detail ?? null }),
      onEnd: () => void get().refreshHealth(),
    })
  },

  resume: async () => {
    const saved = storage.get()
    const health = get().health
    const target = health?.active_run_id ?? saved
    if (!target) return
    try {
      await api.getRun(target)
      get().attach(target)
    } catch {
      storage.set(null)
    }
  },

  cancel: async () => {
    const id = get().runId
    if (id) await api.cancelRun(id).catch(() => undefined)
  },

  loadReport: async () => {
    const id = get().runId
    if (!id) return
    try {
      set({ report: await api.getReport(id), reportError: null })
    } catch (err) {
      const e = err as ApiError
      if (e.status !== 425) set({ reportError: e.message })
    }
  },

  clear: () => {
    disconnect?.()
    disconnect = null
    storage.set(null)
    set({ ...initialExec(), runId: null, connection: 'idle', report: null, reportError: null, startError: null })
  },
}))
