import { ArrowRight, ChevronDown, ChevronRight, Download, ExternalLink, FileText, TextQuote, X } from 'lucide-react'
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api } from '../../services/api'
import { KIND_LABEL, mergeAdjacentCitations, parseFlow, parseReport, type ReportSection } from '../../services/reportParse'
import { useRunStore } from '../../stores/runStore'
import { useUiStore } from '../../stores/uiStore'
import type { EvidenceItem, ReportResponse } from '../../types'

type Source = ReportResponse['sources'][number]

const TYPE_LABEL: Record<string, string> = {
  official: 'Official docs', standard: 'Standard', paper: 'Paper', reference: 'Reference', news: 'News',
  community: 'Blog / forum', other: 'Web page',
}
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, '') } catch { return u } }
const textOf = (n: ReactNode): string => (typeof n === 'string' ? n : Array.isArray(n) ? n.map(textOf).join('') : '')

interface Ctx {
  byNumber: Map<number, Source>
  focus: (ns: number[]) => void
  openPassage: (s: Source) => void
}
const ReportCtx = createContext<Ctx | null>(null)

/**
 * Inline citation chip ("3", or "1, 2" when several sources back one statement). A single document
 * citation opens its passage; otherwise the chip opens the Sources list with those sources expanded.
 */
function Citation({ ns, href }: { ns: number[]; href?: string }) {
  const ctx = useContext(ReportCtx)!
  const label = (n: number) => {
    const src = ctx.byNumber.get(n)
    return src ? `${n}. ${src.kind === 'document' ? src.filename ?? src.title : `${src.title} · ${host(src.url)}`}` : `Source ${n}`
  }
  const only = ns.length === 1 ? ctx.byNumber.get(ns[0]) : undefined
  return (
    <a href={href} className="cite" title={ns.map(label).join('\n')}
      onClick={(e) => {
        e.preventDefault()
        if (only?.kind === 'document') ctx.openPassage(only)
        else ctx.focus(ns)
      }}>
      {ns.join(', ')}
    </a>
  )
}

/** A simple left-to-right process diagram (from the report's ```mermaid flowchart block). */
function Flow({ steps }: { steps: string[] }) {
  return (
    <ol className="flow" aria-label="Diagram">
      {steps.map((s, i) => (
        <li key={i}>
          <span className="flow-step"><span className="flow-n">{i + 1}</span>{s}</span>
          {i < steps.length - 1 && <ArrowRight size={14} className="flow-arrow" aria-hidden />}
        </li>
      ))}
    </ol>
  )
}

/** Supporting detail, collapsed by default. */
function Collapsible({ section, children }: { section: ReportSection; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <section className="report-more">
      <button className="flex w-full items-center gap-2 py-2 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? <ChevronDown size={14} className="text-muted" /> : <ChevronRight size={14} className="text-muted" />}
        <span className="text-sm2 font-medium text-ink">{section.title}</span>
        {section.items > 0 && <span className="tabular text-meta text-faint">{section.items}</span>}
      </button>
      {open && <div className="pb-2 pl-5">{children}</div>}
    </section>
  )
}

const components: Components = {
  a: ({ node: _n, href, children, ...props }) => {
    const m = textOf(children).match(/^\[(\d+(?:, \d+)*)\]$/)
    if (m) return <Citation ns={m[1].split(', ').map(Number)} href={href} />
    return <a {...props} href={href} target="_blank" rel="noreferrer">{children}</a>
  },
  table: ({ node: _n, ...props }) => <div className="table-wrap"><table {...props} /></div>,
  pre: ({ node, children, ...props }) => {
    const code = node?.children[0]
    if (code?.type === 'element' && String(code.properties?.className ?? '').includes('language-mermaid')) {
      const steps = parseFlow(code.children.map((c) => (c.type === 'text' ? c.value : '')).join(''))
      if (steps) return <Flow steps={steps} />
    }
    return <pre {...props}>{children}</pre>
  },
}

const md = (text: string) => <Markdown remarkPlugins={[remarkGfm]} components={components}>{mergeAdjacentCitations(text)}</Markdown>

/** evidence: undefined while loading, null if the mission stored nothing for this source. */
function SourceRow({ s, open, onToggle, evidence, highlighted }: {
  s: Source; open: boolean; onToggle: () => void; evidence: EvidenceItem | null | undefined; highlighted: boolean
}) {
  const ctx = useContext(ReportCtx)!
  const isDoc = s.kind === 'document'
  const detail = evidence?.text
  return (
    <li id={`source-${s.citation_number}`} className={`source-row ${highlighted ? 'source-row-hl' : ''}`}>
      <button className="flex w-full items-start gap-2 px-2 py-1.5 text-left" onClick={onToggle} aria-expanded={open}>
        <span className="tabular mt-px w-5 shrink-0 text-right text-meta text-faint">{s.citation_number}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm2 text-ink">{isDoc ? s.filename ?? s.title : s.title || s.url}</span>
          <span className="block text-meta text-muted">
            {isDoc
              ? [s.page ? `p. ${s.page}` : null, s.section, 'Uploaded document'].filter(Boolean).join(' · ')
              : `${host(s.url)} · ${TYPE_LABEL[s.source_type ?? 'other'] ?? 'Web page'}`}
          </span>
        </span>
        {open ? <ChevronDown size={13} className="mt-1 shrink-0 text-faint" /> : <ChevronRight size={13} className="mt-1 shrink-0 text-faint" />}
      </button>
      {open && (
        <div className="mb-2 ml-9 mr-2 space-y-1.5">
          {detail ? (
            <blockquote className="border-l-2 border-line-strong pl-2.5 text-meta whitespace-pre-wrap text-ink-2">
              {detail.length > 700 ? `${detail.slice(0, 700)}…` : detail}
            </blockquote>
          ) : evidence === undefined ? (
            <p className="text-meta text-faint">Loading details</p>
          ) : isDoc ? (
            <p className="text-meta text-faint">{evidence?.document_deleted ? 'The document was deleted; its text is no longer stored.' : 'No passage text is stored.'}</p>
          ) : null /* web search results usually carry no excerpt; the link is the detail */}
          {evidence?.query && <p className="text-meta text-muted">Found with: {evidence.query}</p>}
          <div className="flex gap-1">
            {isDoc ? (
              <button className="btn btn-quiet h-6 px-1.5 text-meta" onClick={() => ctx.openPassage(s)}><TextQuote size={11} /> Show passage</button>
            ) : (
              <a className="btn btn-quiet h-6 px-1.5 text-meta" href={s.url} target="_blank" rel="noreferrer"><ExternalLink size={11} /> Open source</a>
            )}
          </div>
        </div>
      )}
    </li>
  )
}

function Sources({ report, focusNonce, focused }: { report: ReportResponse; focusNonce: number; focused: number[] }) {
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [evidence, setEvidence] = useState<Map<string, EvidenceItem> | null>(null)
  const list = [...report.sources].sort((a, b) => a.citation_number - b.citation_number)
  const docs = list.filter((s) => s.kind === 'document')
  const web = list.filter((s) => s.kind !== 'document')
  const counts = web.reduce<Record<string, number>>((acc, s) => {
    const k = TYPE_LABEL[s.source_type ?? 'other'] ?? 'Web page'
    acc[k] = (acc[k] ?? 0) + 1
    return acc
  }, {})
  const breakdown = [docs.length ? `${docs.length} uploaded` : null, ...Object.entries(counts).map(([k, v]) => `${v} ${k.toLowerCase()}`)].filter(Boolean).join(' · ')

  const needEvidence = open && expanded.size > 0 && evidence === null
  useEffect(() => {
    if (!needEvidence) return
    let alive = true
    api.getEvidence(report.run_id)
      .then((r) => alive && setEvidence(new Map(r.evidence.map((e) => [e.id, e]))))
      .catch(() => alive && setEvidence(new Map()))
    return () => { alive = false }
  }, [needEvidence, report.run_id])

  // A citation click opens the list, expands those sources, and scrolls to the first once it is rendered.
  const pendingScroll = useRef<number | null>(null)
  useEffect(() => {
    if (!focused.length) return
    pendingScroll.current = focused[0]
    setOpen(true)
    setExpanded((s) => { const x = new Set(s); focused.forEach((n) => x.add(n)); return x })
  }, [focusNonce, focused])
  useEffect(() => {
    const n = pendingScroll.current
    const row = n == null ? null : document.getElementById(`source-${n}`)
    if (!row) return
    pendingScroll.current = null
    row.scrollIntoView({ behavior: 'smooth', block: 'center' })
  })

  if (!list.length) return null
  const toggle = (n: number) => setExpanded((s) => { const x = new Set(s); if (x.has(n)) x.delete(n); else x.add(n); return x })
  const row = (s: Source) => (
    <SourceRow key={s.citation_number} s={s} open={expanded.has(s.citation_number)} onToggle={() => toggle(s.citation_number)}
      evidence={evidence ? evidence.get(s.id ?? '') ?? null : undefined}
      highlighted={focused.includes(s.citation_number)} />
  )
  return (
    <section className="report-sources" aria-label="Sources">
      <button className="flex w-full items-center gap-2 py-2 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? <ChevronDown size={14} className="text-muted" /> : <ChevronRight size={14} className="text-muted" />}
        <span className="text-sm2 font-medium text-ink">Sources</span>
        <span className="tabular text-meta text-faint">{list.length} cited</span>
        <span className="min-w-0 flex-1 truncate text-right text-meta text-muted">{breakdown}</span>
      </button>
      {open && (
        <div className="pb-2">
          {docs.length > 0 && (
            <>
              <h3 className="label mt-1 mb-0.5 px-2">Uploaded documents</h3>
              <ul>{docs.map(row)}</ul>
            </>
          )}
          {web.length > 0 && (
            <>
              {docs.length > 0 && <h3 className="label mt-2 mb-0.5 px-2">Web</h3>}
              <ul>{web.map(row)}</ul>
            </>
          )}
        </div>
      )}
    </section>
  )
}

export function ReportModal() {
  const open = useUiStore((s) => s.reportOpen)
  const setOpen = useUiStore((s) => s.setReportOpen)
  const report = useRunStore((s) => s.report)
  const error = useRunStore((s) => s.reportError)
  const openEvidence = useUiStore((s) => s.openEvidence)
  const [focus, setFocus] = useState<{ ns: number[]; nonce: number }>({ ns: [], nonce: 0 })
  const scroller = useRef<HTMLDivElement>(null)
  const parsed = useMemo(() => (report ? parseReport(report.markdown) : null), [report])
  const ctx = useMemo<Ctx | null>(() => report && {
    byNumber: new Map(report.sources.map((s) => [s.citation_number, s])),
    focus: (ns) => setFocus((f) => ({ ns, nonce: f.nonce + 1 })),
    openPassage: (s) => openEvidence({ runId: report.run_id, evidenceId: s.id, documentId: s.document_id ?? null, chunkId: s.chunk_id ?? null }),
  }, [report, openEvidence])
  useEffect(() => { setFocus({ ns: [], nonce: 0 }); scroller.current?.scrollTo(0, 0) }, [report?.run_id])
  if (!open) return null
  const kind = report?.report_type ?? parsed?.kind ?? null
  return (
    <div className="pointer-events-auto fixed inset-0 z-50 grid place-items-center bg-[#2b2420]/30 p-3 sm:p-6" onClick={() => setOpen(false)}>
      <div role="dialog" aria-modal="true" aria-label="Final report" className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-[0_20px_50px_-20px_rgb(43_36_32/0.5)]" onClick={(e) => e.stopPropagation()}>
        <header className="flex h-11 shrink-0 items-center gap-2.5 border-b border-line pr-2 pl-4">
          <FileText size={14} className="shrink-0 text-muted" />
          <span className="label shrink-0">{kind ? KIND_LABEL[kind] : 'Report'}</span>
          {report?.mode === 'demo' && <span className="tag tag-neutral">Demo · synthetic</span>}
          <span className="min-w-0 flex-1 truncate text-sm2 text-ink-2">{report?.title ?? 'Loading'}</span>
          {report && (
            <a className="btn btn-quiet h-7 px-2" href={api.reportMarkdownUrl(report.run_id)} download={`${report.run_id}.md`} title="Download the full report, including all sources, as Markdown">
              <Download size={13} /> <span className="hidden sm:inline">Markdown</span>
            </a>
          )}
          <button className="btn-icon" onClick={() => setOpen(false)} aria-label="Close report"><X size={15} /></button>
        </header>
        <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-10 scroll-thin">
          {error && <div className="rounded-md border border-st-error/25 bg-st-error/5 px-3 py-2 text-sm2 text-[#8e3328]">{error}</div>}
          {report && parsed && ctx && (
            <ReportCtx.Provider value={ctx}>
              <article className="report mx-auto max-w-[68ch]">
                {parsed.structured ? (
                  <>
                    <h1>{parsed.title}</h1>
                    {parsed.request && <p className="report-request">{parsed.request}</p>}
                    {(parsed.summary || parsed.preface) && (
                      <section className="report-summary" aria-label="Answer">
                        <div className="label mb-1">{/^## (Answer)\s*$/m.test(report.markdown) ? 'Answer' : 'Summary'}</div>
                        {parsed.summary && <div className="report-answer">{md(parsed.summary)}</div>}
                        {parsed.preface && <div className="report-preface">{md(parsed.preface)}</div>}
                      </section>
                    )}
                    {parsed.sections.filter((x) => !x.collapsible).map((x, i) => (
                      <section key={`v${i}`} className="report-section">
                        {x.title && <h2>{x.title}</h2>}
                        {md(x.markdown)}
                      </section>
                    ))}
                    {parsed.sections.some((x) => x.collapsible) && (
                      <div className="report-details">
                        {parsed.sections.filter((x) => x.collapsible).map((x, i) => (
                          <Collapsible key={`c${i}`} section={x}>{md(x.markdown)}</Collapsible>
                        ))}
                      </div>
                    )}
                    <Sources report={report} focusNonce={focus.nonce} focused={focus.ns} />
                    {parsed.footer && <p className="report-footer">{parsed.footer.replace(/^_|_$/g, '')}</p>}
                  </>
                ) : (
                  <Markdown remarkPlugins={[remarkGfm]} components={components}>{report.markdown}</Markdown>
                )}
              </article>
            </ReportCtx.Provider>
          )}
        </div>
      </div>
    </div>
  )
}
