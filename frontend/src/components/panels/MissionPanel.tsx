import { FileSearch, Search, TextQuote, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../../services/api'
import { AGENT_META } from '../../stores/describe'
import { useRunStore } from '../../stores/runStore'
import { useUiStore } from '../../stores/uiStore'
import type { EvidenceItem, TaskStatus } from '../../types'
import { Section } from './AgentInspector'

const TASK_STATUS: Record<TaskStatus, { label: string; dot: string }> = {
  assigned: { label: 'Assigned', dot: 'status-waiting' },
  in_progress: { label: 'In progress', dot: 'status-working' },
  done: { label: 'Completed', dot: 'status-done' },
  failed: { label: 'Failed', dot: 'status-error' },
}

function Evidence({ runId, stage }: { runId: string; stage: string }) {
  const [items, setItems] = useState<EvidenceItem[] | null>(null)
  const openEvidence = useUiStore((s) => s.openEvidence)
  useEffect(() => {
    let alive = true
    api.getEvidence(runId).then((r) => alive && setItems(r.evidence)).catch(() => alive && setItems([]))
    return () => { alive = false }
  }, [runId, stage])
  if (!items) return null
  const docs = items.filter((e) => e.kind === 'document')
  const web = items.filter((e) => e.kind === 'web')
  if (!docs.length && !web.length) return null
  return (
    <Section title="Evidence" count={items.length}>
      {docs.length > 0 && (
        <ul className="space-y-0.5">
          {docs.map((e) => (
            <li key={e.id}>
              <button className="flex w-full min-w-0 items-baseline gap-1.5 rounded px-1 py-0.5 text-left text-meta hover:bg-hover"
                onClick={() => openEvidence({ runId, evidenceId: e.id, documentId: e.document_id, chunkId: e.chunk_id })}>
                <TextQuote size={11} className="shrink-0 translate-y-[1px] text-faint" />
                <span className="shrink-0 font-mono text-ink-2">{e.id}</span>
                <span className="min-w-0 truncate text-ink">{e.title}</span>
                <span className="shrink-0 text-faint">{e.page ? `p. ${e.page}` : ''}</span>
                <span className={`ml-auto shrink-0 ${e.cited ? 'text-ink-2' : 'text-faint'}`}>{e.cited ? `cited [${e.citation_number}]` : 'not cited'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {web.length > 0 && (
        <p className="mt-1 flex items-center gap-1 px-1 text-meta text-muted">
          <FileSearch size={11} /> {web.length} web sources, {web.filter((w) => w.cited).length} cited in the report
        </p>
      )}
    </Section>
  )
}

export function MissionPanel() {
  const open = useUiStore((s) => s.missionOpen)
  const setOpen = useUiStore((s) => s.setMissionOpen)
  const mission = useRunStore((s) => s.mission)
  const tasks = useRunStore((s) => s.tasks)
  const order = useRunStore((s) => s.taskOrder)
  if (!open) return null
  return (
    <aside className="panel flex max-h-full w-full flex-col overflow-hidden" aria-label="Mission board">
      <header className="panel-header h-10">
        <h2 className="flex-1 text-body font-semibold">Mission board</h2>
        <button className="btn-icon -mr-1" onClick={() => setOpen(false)} aria-label="Close mission board"><X size={15} /></button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 scroll-thin">
        {!mission ? (
          <p className="mt-3 text-sm2 text-muted">No mission yet. Enter a research question in the dock below to start.</p>
        ) : (
          <>
            <Section title="Request">
              <p className="text-sm2 break-words">{mission.question}</p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                <span className="tag tag-neutral">{mission.mode === 'demo' ? 'Demo (scripted)' : mission.model}</span>
                <span className="tag tag-neutral">Search: {mission.searchProvider}</span>
                <span className="tag tag-neutral">Max {mission.maxRevisions} follow-up rounds</span>
                <span className="tag tag-neutral font-mono" title="Run ID">{mission.runId}</span>
              </div>
              {mission.knowledge && (
                <p className="mt-1.5 text-meta text-muted">
                  Documents {mission.knowledge.explicit ? 'selected' : 'available'}:{' '}
                  {mission.knowledge.documents.map((d) => d.filename).join(', ')}
                </p>
              )}
            </Section>
            {mission.plan && (
              <>
                <Section title="Objective"><p className="text-sm2 break-words text-ink-2">{mission.plan.objective}</p></Section>
                <Section title="Success criteria">
                  <ul className="list-disc space-y-0.5 pl-4 text-sm2 text-ink-2 marker:text-faint">{mission.plan.success_criteria.map((c) => <li key={c} className="break-words">{c}</li>)}</ul>
                </Section>
              </>
            )}
            <Section title="Tasks" count={order.length}>
              {order.length === 0 && <p className="text-sm2 text-muted">Alex is writing the plan.</p>}
              <ul className="space-y-1">
                {order.map((tid) => {
                  const t = tasks[tid]
                  const st = TASK_STATUS[t.status]
                  return (
                    <li key={tid} className="card">
                      <div className="flex items-start gap-2">
                        <span className="min-w-0 flex-1 text-sm2 font-medium break-words">{t.title}</span>
                        <span className="flex shrink-0 items-center gap-1 text-meta text-muted"><span className={`status-dot ${st.dot}`} />{st.label}</span>
                      </div>
                      <div className="text-meta text-faint">{AGENT_META[t.from].name} to {AGENT_META[t.assignee].name}</div>
                      {t.description && <div className="mt-0.5 text-meta break-words text-ink-2">{t.description}</div>}
                      {t.queries.length > 0 && (
                        <ul className="mt-1 space-y-0.5">
                          {t.queries.map((q) => (
                            <li key={q} className="flex items-start gap-1 text-meta text-muted"><Search size={10} className="mt-[3px] shrink-0" /><span className="min-w-0 break-words">{q}</span></li>
                          ))}
                        </ul>
                      )}
                    </li>
                  )
                })}
              </ul>
            </Section>
            <Evidence runId={mission.runId} stage={mission.stage} />
          </>
        )}
      </div>
    </aside>
  )
}
