import { create } from 'zustand'
import { api, ApiError } from '../services/api'
import type { DocumentScope, KnowledgeInfo, LibraryDocument } from '../types'

/** all: every ready document (Alex decides per subtask) · selected: only the checked ones · none: web only */
export type ScopeMode = 'all' | 'selected' | 'none'

export interface UploadItem {
  key: string
  name: string
  status: 'uploading' | 'error'
  error?: string
}

interface LibraryStore {
  documents: LibraryDocument[]
  knowledge: KnowledgeInfo | null
  loaded: boolean
  error: string | null
  uploads: UploadItem[]
  scope: ScopeMode
  selected: string[]
  refresh: () => Promise<void>
  connect: () => () => void
  upload: (files: File[]) => Promise<void>
  dismissUpload: (key: string) => void
  remove: (id: string) => Promise<void>
  reindex: (id: string) => Promise<void>
  toggle: (id: string) => void
  setScope: (scope: ScopeMode) => void
}

const PREFS_KEY = 'agentos.libraryScope'
const prefs = {
  load: (): { scope: ScopeMode; selected: string[] } => {
    try {
      const v = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null')
      if (v && ['all', 'selected', 'none'].includes(v.scope) && Array.isArray(v.selected)) return v
    } catch { /* ignore */ }
    return { scope: 'all', selected: [] }
  },
  save: (scope: ScopeMode, selected: string[]) => {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify({ scope, selected })) } catch { /* ignore */ }
  },
}

const ready = (d: LibraryDocument) => d.status === 'ready' && !d.needs_reindex

/** document_ids for POST /runs. null = all ready documents (server decides), [] = web only. */
export function missionScope(s: Pick<LibraryStore, 'scope' | 'selected' | 'documents'>): DocumentScope {
  if (s.scope === 'none') return []
  if (s.scope === 'all') return null
  const ids = new Set(s.documents.filter(ready).map((d) => d.id))
  return s.selected.filter((id) => ids.has(id))
}

export function scopeLabel(s: Pick<LibraryStore, 'scope' | 'selected' | 'documents'>): string {
  const readyCount = s.documents.filter(ready).length
  if (s.scope === 'none' || readyCount === 0) return 'Web only'
  if (s.scope === 'all') return `All documents (${readyCount})`
  const n = missionScope(s)?.length ?? 0
  return n ? `${n} selected` : 'Web only (none selected)'
}

let uploadSeq = 0

export const useLibraryStore = create<LibraryStore>((set, get) => ({
  documents: [],
  knowledge: null,
  loaded: false,
  error: null,
  uploads: [],
  ...prefs.load(),

  refresh: async () => {
    try {
      const r = await api.listDocuments()
      const ids = new Set(r.documents.map((d) => d.id))
      set({ documents: r.documents, knowledge: r.knowledge, loaded: true, error: null, selected: get().selected.filter((id) => ids.has(id)) })
    } catch (err) {
      set({ error: (err as Error).message, loaded: true })
    }
  },

  /** Live document.* events. Each event triggers a re-fetch: the documents table is the source of truth. */
  connect: () => {
    let es: EventSource | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let stopped = false
    const refreshSoon = () => {
      clearTimeout(timer)
      timer = setTimeout(() => void get().refresh(), 120)
    }
    const open = () => {
      if (stopped) return
      es = new EventSource(api.documentEventsUrl(0))
      es.addEventListener('library', refreshSoon)
      es.onopen = refreshSoon // also covers reconnects after a server restart
    }
    void get().refresh()
    open()
    // While anything is being indexed, also poll: a safety net if the event stream is buffered by a proxy.
    const poll = setInterval(() => {
      if (get().documents.some((d) => d.status === 'pending' || d.status === 'processing')) void get().refresh()
    }, 4000)
    return () => {
      stopped = true
      clearTimeout(timer)
      clearInterval(poll)
      es?.close()
    }
  },

  upload: async (files) => {
    const max = (get().knowledge?.max_upload_mb ?? 20) * 1024 * 1024
    await Promise.all(files.map(async (file) => {
      const key = `u${++uploadSeq}`
      if (file.size > max) {
        set((s) => ({ uploads: [...s.uploads, { key, name: file.name, status: 'error', error: `Larger than ${max / 1048576} MB.` }] }))
        return
      }
      set((s) => ({ uploads: [...s.uploads, { key, name: file.name, status: 'uploading' }] }))
      try {
        const doc = await api.uploadDocument(file)
        set((s) => ({
          uploads: s.uploads.filter((u) => u.key !== key),
          documents: [doc, ...s.documents.filter((d) => d.id !== doc.id)],
        }))
      } catch (err) {
        const e = err as ApiError
        const msg = e.status === 409 ? 'Already in the library.' : e.message
        set((s) => ({ uploads: s.uploads.map((u) => (u.key === key ? { ...u, status: 'error', error: msg } : u)) }))
      }
    }))
    void get().refresh()
  },

  dismissUpload: (key) => set((s) => ({ uploads: s.uploads.filter((u) => u.key !== key) })),

  remove: async (id) => {
    try {
      await api.deleteDocument(id)
      set((s) => ({ documents: s.documents.filter((d) => d.id !== id), selected: s.selected.filter((x) => x !== id) }))
      prefs.save(get().scope, get().selected)
    } catch (err) {
      set({ error: (err as Error).message })
    }
  },

  reindex: async (id) => {
    try {
      const doc = await api.reindexDocument(id)
      set((s) => ({ documents: s.documents.map((d) => (d.id === id ? doc : d)) }))
    } catch (err) {
      set({ error: (err as Error).message })
    }
  },

  toggle: (id) => {
    const sel = get().selected.includes(id) ? get().selected.filter((x) => x !== id) : [...get().selected, id]
    set({ selected: sel, scope: sel.length ? 'selected' : get().scope === 'selected' ? 'all' : get().scope })
    prefs.save(get().scope, sel)
  },

  setScope: (scope) => {
    set({ scope })
    prefs.save(scope, get().selected)
  },
}))
