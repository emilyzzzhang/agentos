import { ChevronRight, ExternalLink, FileText, FileType2, Hash, RefreshCw, Trash2, Upload, X } from 'lucide-react'
import { useEffect, useRef, useState, type DragEvent } from 'react'
import { api, type RunSummary } from '../../services/api'
import { missionScope, scopeLabel, useLibraryStore, type ScopeMode } from '../../stores/libraryStore'
import { useRunStore } from '../../stores/runStore'
import { useUiStore } from '../../stores/uiStore'
import type { DocumentStatus, LibraryDocument } from '../../types'

const ACCEPT = '.pdf,.md,.markdown,.txt,application/pdf,text/markdown,text/plain'

const DOC_STATUS: Record<DocumentStatus, { label: string; dot: string }> = {
  pending: { label: 'Queued', dot: 'status-waiting' },
  processing: { label: 'Indexing', dot: 'status-working' },
  ready: { label: 'Ready', dot: 'status-done' },
  failed: { label: 'Failed', dot: 'status-error' },
}

const RUN_STATUS: Record<RunSummary['status'], { label: string; dot: string }> = {
  running: { label: 'Running', dot: 'status-working' },
  completed: { label: 'Completed', dot: 'status-done' },
  failed: { label: 'Failed', dot: 'status-error' },
  cancelled: { label: 'Cancelled', dot: 'status-idle' },
  interrupted: { label: 'Interrupted', dot: 'status-waiting' },
}

const fileSize = (n: number) =>
  n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB` : `${(n / 1048576).toFixed(1)} MB`
const typeLabel = { pdf: 'PDF', markdown: 'Markdown', text: 'Text' } as const
const when = (iso: string) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })

function DocRow({ doc }: { doc: LibraryDocument }) {
  const selected = useLibraryStore((s) => s.selected.includes(doc.id))
  const toggle = useLibraryStore((s) => s.toggle)
  const remove = useLibraryStore((s) => s.remove)
  const reindex = useLibraryStore((s) => s.reindex)
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const st = doc.needs_reindex ? { label: 'Needs reindex', dot: 'status-waiting' } : DOC_STATUS[doc.status]
  const usable = doc.status === 'ready' && !doc.needs_reindex
  const Icon = doc.file_type === 'pdf' ? FileType2 : FileText
  const meta = [typeLabel[doc.file_type], doc.page_count ? `${doc.page_count} pages` : null,
    doc.status === 'ready' ? `${doc.chunk_count} passages` : null, fileSize(doc.size_bytes)].filter(Boolean).join(' · ')
  return (
    <li className="border-b border-line last:border-b-0">
      <div className="flex items-start gap-2 px-3 py-2">
        <input type="checkbox" className="mt-[3px] h-3.5 w-3.5 shrink-0 accent-[var(--color-accent)] disabled:opacity-30"
          checked={selected && usable} disabled={!usable} onChange={() => toggle(doc.id)}
          aria-label={`Use ${doc.filename} in the next mission`} title={usable ? 'Use in the next mission' : 'Available once indexed'} />
        <button className="flex min-w-0 flex-1 items-start gap-1.5 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
          <Icon size={14} className="mt-[2px] shrink-0 text-muted" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm2 font-medium" title={doc.filename}>{doc.filename}</span>
            <span className="block truncate text-meta text-muted">{meta}</span>
          </span>
        </button>
        <span className="flex shrink-0 items-center gap-1 pt-px text-meta text-muted"><span className={`status-dot ${st.dot}`} />{st.label}</span>
      </div>
      {doc.status === 'failed' && doc.error && (
        <p className="-mt-1 mb-2 ml-[46px] mr-3 line-clamp-3 text-meta text-st-error" title={doc.error}>{doc.error}</p>
      )}
      {open && (
        <div className="mb-2 ml-[46px] mr-3 space-y-1.5">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-meta">
            <dt className="text-faint">Title</dt><dd className="min-w-0 truncate text-ink-2" title={doc.title}>{doc.title}</dd>
            <dt className="text-faint">Added</dt><dd className="text-ink-2">{when(doc.created_at)}</dd>
            {doc.indexed_at && <><dt className="text-faint">Indexed</dt><dd className="text-ink-2">{when(doc.indexed_at)}</dd></>}
            {doc.embedding_model && <><dt className="text-faint">Embedding</dt><dd className="min-w-0 truncate text-ink-2" title={doc.embedding_model}>{doc.embedding_model.split('/').pop()} · {doc.embedding_dim}d</dd></>}
            {doc.chunk_size && <><dt className="text-faint">Chunks</dt><dd className="text-ink-2">{doc.chunk_size} chars, {doc.chunk_overlap} overlap</dd></>}
            <dt className="text-faint">SHA-256</dt><dd className="flex min-w-0 items-center gap-1 font-mono text-[10px] text-ink-2"><Hash size={10} className="shrink-0" /><span className="truncate" title={doc.sha256}>{doc.sha256.slice(0, 16)}</span></dd>
            {doc.status === 'ready' && doc.error && <><dt className="text-faint">Notes</dt><dd className="text-ink-2">{doc.error}</dd></>}
          </dl>
          <div className="flex flex-wrap items-center gap-1">
            <a className="btn btn-quiet h-6 px-1.5 text-meta" href={api.documentFileUrl(doc.id)} target="_blank" rel="noreferrer"><ExternalLink size={11} /> Open file</a>
            {(doc.status === 'failed' || doc.needs_reindex || doc.status === 'ready') && (
              <button className="btn btn-quiet h-6 px-1.5 text-meta" onClick={() => void reindex(doc.id)}><RefreshCw size={11} /> Reindex</button>
            )}
            {confirm ? (
              <span className="ml-auto flex items-center gap-1 text-meta">
                <span className="text-ink-2">Delete file and vectors?</span>
                <button className="btn h-6 bg-st-error px-1.5 text-meta text-white hover:opacity-90" onClick={() => void remove(doc.id)}>Delete</button>
                <button className="btn btn-quiet h-6 px-1.5 text-meta" onClick={() => setConfirm(false)}>Keep</button>
              </span>
            ) : (
              <button className="btn btn-quiet ml-auto h-6 px-1.5 text-meta hover:text-st-error" onClick={() => setConfirm(true)}><Trash2 size={11} /> Delete</button>
            )}
          </div>
        </div>
      )}
    </li>
  )
}

function Documents() {
  const docs = useLibraryStore((s) => s.documents)
  const knowledge = useLibraryStore((s) => s.knowledge)
  const uploads = useLibraryStore((s) => s.uploads)
  const error = useLibraryStore((s) => s.error)
  const upload = useLibraryStore((s) => s.upload)
  const dismiss = useLibraryStore((s) => s.dismissUpload)
  const scope = useLibraryStore((s) => s.scope)
  const setScope = useLibraryStore((s) => s.setScope)
  const state = useLibraryStore()
  const input = useRef<HTMLInputElement>(null)
  const [drag, setDrag] = useState(false)
  const unavailable = knowledge?.status === 'unavailable'
  const selectedCount = missionScope({ ...state, scope: 'selected' })?.length ?? 0

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDrag(false)
    if (!unavailable && e.dataTransfer.files.length) void upload([...e.dataTransfer.files])
  }
  return (
    <div className={`flex min-h-0 flex-1 flex-col ${drag ? 'bg-accent-soft/40' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)} onDrop={onDrop}>
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <button className="btn btn-secondary h-7 px-2.5" disabled={unavailable} onClick={() => input.current?.click()}>
          <Upload size={13} /> Upload
        </button>
        <span className="min-w-0 flex-1 text-meta text-muted">PDF, Markdown or text · up to {knowledge?.max_upload_mb ?? 20} MB · or drop files here</span>
        <input ref={input} type="file" accept={ACCEPT} multiple hidden onChange={(e) => {
          if (e.target.files?.length) void upload([...e.target.files])
          e.target.value = ''
        }} />
      </div>
      {knowledge && knowledge.status !== 'ready' && (
        <p className={`border-b border-line px-3 py-1.5 text-meta ${unavailable ? 'text-st-error' : 'text-muted'}`}>
          {unavailable ? `Knowledge Library unavailable: ${knowledge.error}` : 'Loading the embedding model. Uploads are queued until it is ready.'}
        </p>
      )}
      {error && <p className="border-b border-line px-3 py-1.5 text-meta text-st-error">{error}</p>}
      <ul className="min-h-0 flex-1 overflow-y-auto scroll-thin">
        {uploads.map((u) => (
          <li key={u.key} className="flex items-center gap-2 border-b border-line px-3 py-2 text-sm2">
            <Upload size={13} className="shrink-0 text-muted" />
            <span className="min-w-0 flex-1 truncate">{u.name}</span>
            {u.status === 'uploading' ? <span className="text-meta text-muted">Uploading</span> : (
              <>
                <span className="max-w-[55%] truncate text-meta text-st-error" title={u.error}>{u.error}</span>
                <button className="btn-icon h-5 w-5" onClick={() => dismiss(u.key)} aria-label="Dismiss"><X size={12} /></button>
              </>
            )}
          </li>
        ))}
        {docs.length === 0 && uploads.length === 0 && (
          <li className="px-3 py-6 text-center text-sm2 text-muted">
            No documents yet. Upload files so Milo can search them during missions.
          </li>
        )}
        {docs.map((d) => <DocRow key={d.id} doc={d} />)}
      </ul>
      <div className="border-t border-line px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="label shrink-0">Next mission</span>
          <div className="segmented ml-auto h-7" role="group" aria-label="Documents for the next mission">
            {(['all', 'selected', 'none'] as ScopeMode[]).map((m) => (
              <button key={m} aria-pressed={scope === m} onClick={() => setScope(m)}>
                {m === 'all' ? 'All' : m === 'selected' ? `Selected${selectedCount ? ` (${selectedCount})` : ''}` : 'Web only'}
              </button>
            ))}
          </div>
        </div>
        <p className="mt-1 text-meta text-muted">
          {scopeLabel(state)}.{' '}
          {scope === 'none' ? 'Milo uses web search only.' : 'Alex decides per subtask whether to use documents, the web, or both.'}
        </p>
      </div>
    </div>
  )
}

function History() {
  const [runs, setRuns] = useState<RunSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const current = useRunStore((s) => s.runId)
  const attach = useRunStore((s) => s.attach)
  useEffect(() => {
    let alive = true
    api.listRuns(50).then((r) => alive && setRuns(r.runs)).catch((e) => alive && setError((e as Error).message))
    return () => { alive = false }
  }, [current])
  if (error) return <p className="px-3 py-4 text-sm2 text-st-error">{error}</p>
  if (!runs) return <p className="px-3 py-4 text-sm2 text-muted">Loading</p>
  if (!runs.length) return <p className="px-3 py-6 text-center text-sm2 text-muted">No missions yet.</p>
  return (
    <ul className="min-h-0 flex-1 overflow-y-auto scroll-thin">
      {runs.map((r) => {
        const st = RUN_STATUS[r.status]
        return (
          <li key={r.run_id} className="border-b border-line last:border-b-0">
            <button className={`flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-hover ${r.run_id === current ? 'bg-hover/70' : ''}`}
              onClick={() => attach(r.run_id)} title="Open this mission in the office">
              <span className={`status-dot mt-[5px] ${st.dot}`} />
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 text-sm2 break-words">{r.question}</span>
                <span className="block text-meta text-muted">
                  {st.label} · {when(r.created_at)}{r.has_report ? ' · report' : ''}
                  {r.document_scope?.length ? ` · ${r.document_scope.length} document${r.document_scope.length === 1 ? '' : 's'}` : ''}
                  {r.document_scope && !r.document_scope.length ? ' · web only' : ''}
                </span>
              </span>
              <ChevronRight size={13} className="mt-1 shrink-0 text-faint" />
            </button>
          </li>
        )
      })}
    </ul>
  )
}

export function LibraryPanel() {
  const open = useUiStore((s) => s.libraryOpen)
  const setOpen = useUiStore((s) => s.setLibraryOpen)
  const count = useLibraryStore((s) => s.documents.length)
  const [tab, setTab] = useState<'documents' | 'history'>('documents')
  if (!open) return null
  return (
    <aside className="panel flex max-h-full min-h-[320px] w-full flex-col overflow-hidden" aria-label="Knowledge library">
      <header className="panel-header h-10">
        <h2 className="flex-1 text-body font-semibold">Knowledge library</h2>
        <div className="segmented h-7" role="tablist">
          <button role="tab" aria-pressed={tab === 'documents'} aria-selected={tab === 'documents'} onClick={() => setTab('documents')}>
            Documents{count ? ` ${count}` : ''}
          </button>
          <button role="tab" aria-pressed={tab === 'history'} aria-selected={tab === 'history'} onClick={() => setTab('history')}>History</button>
        </div>
        <button className="btn-icon -mr-1" onClick={() => setOpen(false)} aria-label="Close knowledge library"><X size={15} /></button>
      </header>
      {tab === 'documents' ? <Documents /> : <History />}
    </aside>
  )
}
