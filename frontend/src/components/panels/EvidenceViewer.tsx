import { ExternalLink, TextQuote, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../../services/api'
import { useUiStore } from '../../stores/uiStore'

interface View {
  label: string
  filename: string
  page: number | null
  section: string | null
  text: string | null
  documentId: string | null
  score?: number | null
  query?: string | null
  deleted?: boolean
}

/** Shows one retrieved document passage. Text is fetched on demand from the API, never from the event stream. */
export function EvidenceViewer() {
  const target = useUiStore((s) => s.evidence)
  const close = useUiStore((s) => s.openEvidence)
  const [view, setView] = useState<View | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!target) return
    let alive = true
    setView(null)
    setError(null)
    const load = async (): Promise<View> => {
      if (target.runId && target.evidenceId) {
        const { evidence } = await api.getEvidence(target.runId)
        const e = evidence.find((x) => x.id === target.evidenceId)
        if (!e) throw new Error(`Evidence ${target.evidenceId} was not found for this mission.`)
        return { label: e.id, filename: e.title, page: e.page, section: e.section, text: e.text, documentId: e.document_id,
          score: e.score, query: e.query, deleted: e.document_deleted }
      }
      if (!target.documentId || !target.chunkId) throw new Error('No passage selected.')
      const p = await api.getPassage(target.documentId, target.chunkId)
      return { label: target.evidenceId ?? `Passage ${p.chunk_index + 1}`, filename: p.filename, page: p.page,
        section: p.section, text: p.text, documentId: p.document_id }
    }
    load().then((v) => alive && setView(v)).catch((e) => alive && setError((e as Error).message))
    return () => { alive = false }
  }, [target])

  if (!target) return null
  const loc = view?.page ? `p. ${view.page}` : view?.section ? view.section : null
  return (
    <div className="pointer-events-auto fixed inset-0 z-[60] grid place-items-center bg-[#2b2420]/20 p-3" onClick={() => close(null)}>
      <div role="dialog" aria-modal="true" aria-label="Retrieved passage"
        className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-[0_20px_50px_-20px_rgb(43_36_32/0.5)]"
        onClick={(e) => e.stopPropagation()}>
        <header className="flex h-10 shrink-0 items-center gap-2 border-b border-line pr-1.5 pl-3">
          <TextQuote size={14} className="shrink-0 text-muted" />
          {view && <span className="tag tag-neutral font-mono">{view.label}</span>}
          <span className="min-w-0 flex-1 truncate text-sm2 text-ink-2" title={view?.filename}>
            {view ? `${view.filename}${loc ? ` · ${loc}` : ''}` : 'Loading passage'}
          </span>
          <button className="btn-icon" onClick={() => close(null)} aria-label="Close passage"><X size={15} /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 scroll-thin">
          {error && <p className="text-sm2 text-st-error">{error}</p>}
          {view && (view.text ? (
            <blockquote className="border-l-2 border-line-strong pl-3 text-body whitespace-pre-wrap text-ink">{view.text}</blockquote>
          ) : (
            <p className="text-sm2 text-muted">{view.deleted ? 'The document was deleted. Its content is no longer stored; the citation metadata remains.' : 'No passage text is available.'}</p>
          ))}
          {view && (
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-meta">
              {view.section && <><dt className="text-faint">Section</dt><dd className="text-ink-2">{view.section}</dd></>}
              {view.query && <><dt className="text-faint">Query</dt><dd className="text-ink-2">{view.query}</dd></>}
              {view.score != null && (
                <><dt className="text-faint">Similarity</dt><dd className="text-ink-2" title="Cosine similarity between the query and this passage. It ranks results; it is not a confidence value.">{view.score.toFixed(2)} (ranking only)</dd></>
              )}
            </dl>
          )}
        </div>
        {view?.documentId && !view.deleted && (
          <footer className="flex shrink-0 justify-end border-t border-line px-2 py-1.5">
            <a className="btn btn-quiet h-7 px-2" href={api.documentFileUrl(view.documentId, view.page)} target="_blank" rel="noreferrer">
              <ExternalLink size={12} /> Open original{view.page ? ` at p. ${view.page}` : ''}
            </a>
          </footer>
        )}
      </div>
    </div>
  )
}
