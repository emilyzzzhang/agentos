import { ChevronRight, FileSearch, FileX, Globe, LoaderCircle, SearchX, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { AGENT_META, STATUS_LABEL } from '../../stores/describe'
import { useRunStore } from '../../stores/runStore'
import { useUiStore } from '../../stores/uiStore'
import type { AgentId } from '../../types'
import { StatusDot } from '../ui/Icon'

const BLURB: Record<AgentId, string> = {
  alex: 'Receives the mission, writes the research plan, and assigns subtasks to Milo.',
  milo: 'Searches the web and the Knowledge Library, extracts cited findings, and records every source.',
  luna: 'Checks the evidence, can request up to 2 follow-up rounds, and writes the cited report.',
}

const CONFIDENCE = { high: 'text-st-done', medium: 'text-st-waiting', low: 'text-muted' } as const

export function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="mt-4 first:mt-3">
      <h3 className="label mb-1.5">
        {title}
        {count !== undefined && <span className="tabular ml-1.5 text-faint">{count}</span>}
      </h3>
      {children}
    </section>
  )
}

export const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, '') } catch { return u } }

export function AgentInspector() {
  const id = useUiStore((s) => s.selectedAgent)
  const close = useUiStore((s) => s.select)
  const agent = useRunStore((s) => (id ? s.agents[id] : null))
  const mission = useRunStore((s) => s.mission)
  const openEvidence = useUiStore((s) => s.openEvidence)
  if (!id || !agent) return null
  const m = AGENT_META[id]
  const reviews = mission?.reviews ?? []
  return (
    <aside className="panel flex max-h-full w-full flex-col overflow-hidden" aria-label={`${m.name} inspector`}>
      <header className="flex items-start gap-2.5 border-b border-line px-3 py-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-sm2 font-semibold text-white" style={{ background: m.color }}>{m.name[0]}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h2 className="text-title font-semibold">{m.name}</h2>
            <span className="text-sm2 text-muted">{m.role}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-meta text-ink-2">
            <StatusDot status={agent.status} /> {STATUS_LABEL[agent.status]}
          </div>
        </div>
        <button className="btn-icon -mr-1" onClick={() => close(null)} aria-label="Close inspector"><X size={15} /></button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 scroll-thin">
        <p className="mt-2.5 text-sm2 text-ink-2">{BLURB[id]}</p>
        <Section title="Current task">
          <div className="text-sm2 break-words text-ink">{agent.currentTask?.title ?? <span className="text-muted">No active task</span>}</div>
        </Section>
        {agent.error && (
          <Section title="Error">
            <div className="rounded-md border border-st-error/25 bg-st-error/5 px-2.5 py-2 text-sm2 break-words text-[#8e3328]">{agent.error}</div>
          </Section>
        )}
        {id === 'alex' && mission?.plan && (
          <Section title="Research plan" count={mission.plan.subtasks.length}>
            <p className="mb-2 text-sm2 text-ink-2">{mission.plan.approach}</p>
            <ol className="space-y-1">
              {mission.plan.subtasks.map((st, i) => (
                <li key={st.id} className="card">
                  <div className="text-sm2 font-medium break-words"><span className="tabular mr-1.5 text-faint">{i + 1}</span>{st.title}</div>
                  <div className="mt-0.5 text-meta break-words text-muted">{st.description}</div>
                </li>
              ))}
            </ol>
          </Section>
        )}
        {agent.toolCalls.length > 0 && (
          <Section title="Searches" count={agent.toolCalls.length}>
            <ul className="space-y-1">
              {agent.toolCalls.map((t) => (
                <li key={t.id}>
                  <details className="group card py-1.5">
                    <summary className="flex cursor-pointer list-none items-start gap-1.5 text-sm2">
                      {t.status === 'running' ? <LoaderCircle size={13} className="mt-0.5 shrink-0 animate-spin text-st-working" />
                        : t.status === 'failed' ? (t.kind === 'documents' ? <FileX size={13} className="mt-0.5 shrink-0 text-st-error" /> : <SearchX size={13} className="mt-0.5 shrink-0 text-st-error" />)
                          : t.kind === 'documents' ? <FileSearch size={13} className="mt-0.5 shrink-0 text-muted" />
                            : <Globe size={13} className="mt-0.5 shrink-0 text-muted" />}
                      <span className="min-w-0 flex-1 break-words">
                        {t.kind === 'documents' && <span className="mr-1 text-meta text-faint">Documents</span>}
                        {t.query}
                      </span>
                      <span className="tabular shrink-0 text-meta text-muted">
                        {t.status === 'done' ? `${t.sourceCount ?? 0} ${t.kind === 'documents' ? 'passages' : 'sources'}` : t.status === 'running' ? 'Running' : 'Failed'}
                      </span>
                      <ChevronRight size={12} className="mt-0.5 shrink-0 text-faint transition-transform group-open:rotate-90" />
                    </summary>
                    {t.error && <div className="mt-1 text-meta text-st-error">{t.error}</div>}
                    {t.kind === 'documents' && t.status === 'done' && !t.passages?.length && (
                      <div className="mt-1 text-meta text-muted">No passage cleared the relevance threshold.</div>
                    )}
                    {t.passages && t.passages.length > 0 && (
                      <ul className="mt-1.5 space-y-0.5 border-t border-line pt-1.5">
                        {t.passages.map((ps) => (
                          <li key={ps.chunk_id}>
                            <button className="flex w-full min-w-0 items-baseline gap-1.5 text-left text-meta hover:text-accent"
                              onClick={() => openEvidence({ documentId: ps.document_id, chunkId: ps.chunk_id })} title="Show passage">
                              <span className="min-w-0 truncate text-ink underline decoration-line-strong underline-offset-2">{ps.filename}</span>
                              <span className="shrink-0 text-faint">{ps.page ? `p. ${ps.page}` : ps.section ? `§ ${ps.section.split(' > ').pop()}` : ''}</span>
                              {ps.score != null && <span className="tabular ml-auto shrink-0 text-faint" title="Cosine similarity (ranking only, not confidence)">{ps.score.toFixed(2)}</span>}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {t.sources && t.sources.length > 0 && (
                      <ul className="mt-1.5 space-y-0.5 border-t border-line pt-1.5">
                        {t.sources.map((s) => (
                          <li key={s.url} className="flex min-w-0 gap-1.5 text-meta">
                            <a className="min-w-0 truncate text-ink hover:text-accent hover:underline" href={s.url} target="_blank" rel="noreferrer" title={s.url}>{s.title || s.url}</a>
                            <span className="shrink-0 text-faint">{host(s.url)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </details>
                </li>
              ))}
            </ul>
          </Section>
        )}
        {id === 'milo' && agent.findings.length > 0 && (
          <Section title="Findings" count={agent.findings.length}>
            <ul className="space-y-1">
              {agent.findings.map((f, i) => (
                <li key={i} className="card">
                  <div className="text-sm2 break-words">{f.claim}</div>
                  <div className="mt-0.5 text-meta break-words text-muted">{f.evidence}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    <span className={`text-meta ${CONFIDENCE[f.confidence]}`}>{f.confidence} confidence</span>
                    {f.source_ids.map((sid) => {
                      const src = agent.sources.find((s) => s.id === sid)
                      if (src?.kind === 'document') {
                        return (
                          <button key={sid} className="tag tag-neutral max-w-44 hover:text-accent" title={`${src.filename}${src.page ? `, p. ${src.page}` : ''}`}
                            onClick={() => openEvidence({ documentId: src.document_id ?? null, chunkId: src.chunk_id ?? null, evidenceId: sid })}>
                            <span className="font-mono">{sid}</span><span className="truncate">{src.filename}{src.page ? ` p. ${src.page}` : ''}</span>
                          </button>
                        )
                      }
                      return src
                        ? <a key={sid} href={src.url} target="_blank" rel="noreferrer" className="tag tag-neutral max-w-40 hover:text-accent" title={src.title}><span className="font-mono">{sid}</span><span className="truncate">{host(src.url)}</span></a>
                        : <span key={sid} className="tag tag-neutral font-mono">{sid}</span>
                    })}
                  </div>
                </li>
              ))}
            </ul>
          </Section>
        )}
        {id === 'luna' && reviews.length > 0 && (
          <Section title="Reviews" count={reviews.length}>
            <ul className="space-y-1">
              {reviews.map((r) => (
                <li key={r.round} className="card">
                  <div className="flex items-center gap-2 text-sm2">
                    <span className="font-medium">Round {r.round}</span>
                    <span className={`text-meta ${r.verdict === 'approve' ? 'text-st-done' : 'text-accent'}`}>{r.verdict === 'approve' ? 'Approved' : 'Revision requested'}</span>
                    {r.limitReached && <span className="text-meta text-muted">· limit reached</span>}
                  </div>
                  <p className="mt-0.5 text-meta break-words text-ink-2">{r.assessment}</p>
                  {r.missing.length > 0 && <ul className="mt-1 list-disc pl-4 text-meta text-muted">{r.missing.map((x) => <li key={x}>{x}</li>)}</ul>}
                </li>
              ))}
            </ul>
          </Section>
        )}
        <Section title="Recent activity" count={agent.activities.length}>
          {agent.activities.length === 0 ? (
            <div className="text-sm2 text-muted">No activity yet. Start a mission to see {m.name} work.</div>
          ) : (
            <ul className="space-y-1">
              {[...agent.activities].reverse().slice(0, 25).map((a) => (
                <li key={a.seq} className="flex gap-2 text-meta">
                  <span className="tabular shrink-0 text-faint">{new Date(a.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</span>
                  <span className="min-w-0 break-words text-ink-2">{a.text}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </aside>
  )
}
