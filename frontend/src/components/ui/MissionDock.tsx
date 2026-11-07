import { ArrowUp, Check, CircleSlash, CircleX, FileText, Library, PanelRightOpen, RotateCcw, Square } from 'lucide-react'
import { scopeLabel, useLibraryStore } from '../../stores/libraryStore'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useRunStore } from '../../stores/runStore'
import { useUiStore } from '../../stores/uiStore'
import type { Mission, Stage } from '../../types'

const EXAMPLES = [
  'Compare PostgreSQL and MongoDB for a social media application and recommend one.',
  'Should a 5-person startup choose Next.js or Remix for a new SaaS dashboard?',
  'What are the trade-offs between Kafka and RabbitMQ for event-driven microservices?',
]

const STEPS: { key: Stage; label: string }[] = [
  { key: 'planning', label: 'Plan' },
  { key: 'research', label: 'Research' },
  { key: 'review', label: 'Review' },
  { key: 'report', label: 'Report' },
]
const ORDER: Stage[] = ['planning', 'research', 'review', 'report', 'done']

function stageLabel(m: Mission): string {
  switch (m.stage) {
    case 'planning': return 'Planning'
    case 'research': return m.researchRound > 1 ? `Researching · round ${m.researchRound}` : 'Researching'
    case 'review': return 'Reviewing'
    case 'report': return 'Writing report'
    case 'done': return 'Completed'
    case 'failed': return m.cancelled ? 'Cancelled' : 'Failed'
    default: return 'Starting'
  }
}

function Elapsed({ from, to }: { from: string; to: string | null }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (to) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [to])
  const s = Math.max(0, Math.round(((to ? new Date(to).getTime() : now) - new Date(from).getTime()) / 1000))
  return <span className="tabular">{Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}</span>
}

function Stepper({ mission }: { mission: Mission }) {
  const failed = mission.stage === 'failed'
  const idx = ORDER.indexOf(failed ? (mission.failedStage ?? 'planning') : mission.stage)
  return (
    <ol className="flex items-center gap-1.5" aria-label="Mission progress">
      {STEPS.map((st, i) => {
        const state = idx > i ? 'done' : idx === i ? (failed ? 'fail' : 'active') : 'todo'
        return (
          <li key={st.key} className="flex min-w-0 flex-1 items-center gap-1.5" aria-current={state === 'active' ? 'step' : undefined}>
            <span
              className={`grid h-4 w-4 shrink-0 place-items-center rounded-full ${
                state === 'done' ? 'bg-st-done text-white'
                  : state === 'active' ? 'border-[1.5px] border-st-working'
                    : state === 'fail' ? 'bg-st-error text-white'
                      : 'border border-line-strong'
              }`}
            >
              {state === 'done' && <Check size={10} strokeWidth={3} />}
              {state === 'active' && <span className="status-dot status-working h-1.5 w-1.5" />}
              {state === 'fail' && <CircleX size={10} strokeWidth={2.5} />}
            </span>
            <span className={`truncate text-meta ${state === 'active' ? 'font-medium text-ink' : state === 'todo' ? 'text-faint' : 'text-ink-2'}`}>
              {st.label}
            </span>
            {i < STEPS.length - 1 && <span className={`h-px min-w-2 flex-1 ${idx > i ? 'bg-st-done/60' : 'bg-line-strong'}`} />}
          </li>
        )
      })}
    </ol>
  )
}

function ActiveMission({ mission }: { mission: Mission }) {
  const cancel = useRunStore((s) => s.cancel)
  const clear = useRunStore((s) => s.clear)
  const report = useRunStore((s) => s.report)
  const openReport = useUiStore((s) => s.setReportOpen)
  const openMission = useUiStore((s) => s.setMissionOpen)
  const [cancelling, setCancelling] = useState(false)
  const finished = mission.stage === 'done' || mission.stage === 'failed'
  const tone = mission.stage === 'done' ? 'text-st-done' : mission.stage === 'failed' ? (mission.cancelled ? 'text-muted' : 'text-st-error') : 'text-st-working'
  return (
    <div className="panel pointer-events-auto w-full">
      <div className="flex min-w-0 items-center gap-2 px-3 pt-2">
        <span className={`flex shrink-0 items-center gap-1.5 text-sm2 font-medium ${tone}`}>
          {mission.stage === 'done' ? <Check size={13} strokeWidth={2.5} /> : mission.stage === 'failed' ? (mission.cancelled ? <CircleSlash size={13} /> : <CircleX size={13} />) : <span className="status-dot status-working" />}
          {stageLabel(mission)}
        </span>
        <span className="tabular shrink-0 text-meta text-muted"><Elapsed from={mission.startedAt} to={mission.finishedAt} /></span>
        <button className="group flex min-w-0 flex-1 items-center gap-1 text-left" onClick={() => openMission(true)} title={`${mission.question}\n\nOpen mission details`}>
          <span className="truncate text-sm2 text-ink-2 group-hover:text-ink">{mission.question}</span>
          <PanelRightOpen size={12} className="shrink-0 text-faint group-hover:text-ink" />
        </button>
        <div className="flex shrink-0 items-center gap-1">
          {!finished && (
            <button className="btn btn-quiet h-7 px-2" disabled={cancelling} onClick={() => { setCancelling(true); void cancel() }}>
              <Square size={11} /> <span className="hidden sm:inline">{cancelling ? 'Cancelling' : 'Cancel'}</span>
            </button>
          )}
          {report && (
            <button className="btn btn-primary h-7 px-2.5" onClick={() => openReport(true)}>
              <FileText size={13} /> Report
            </button>
          )}
          {finished && (
            <button className="btn btn-secondary h-7 px-2.5" onClick={clear}>
              <RotateCcw size={12} /> <span className="hidden sm:inline">New mission</span>
            </button>
          )}
        </div>
      </div>
      <div className="px-3 pt-2 pb-2.5">
        <Stepper mission={mission} />
        {mission.error && !mission.cancelled && (
          <p className="mt-2 line-clamp-2 text-meta text-st-error" title={mission.error}>{mission.error}</p>
        )}
      </div>
    </div>
  )
}

function NewMission() {
  const health = useRunStore((s) => s.health)
  const start = useRunStore((s) => s.start)
  const starting = useRunStore((s) => s.starting)
  const startError = useRunStore((s) => s.startError)
  const [question, setQuestion] = useState('')
  const library = useLibraryStore()
  const openLibrary = useUiStore((s) => s.setLibraryOpen)
  const hasDocs = library.documents.some((d) => d.status === 'ready')
  const live = health?.api_key_configured ?? false
  const demoAllowed = health?.demo_enabled !== false
  const [mode, setMode] = useState<'live' | 'demo'>('live')
  const area = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { if (health && !health.api_key_configured) setMode('demo') }, [health])
  useLayoutEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`
  }, [question])

  const valid = question.trim().length >= 8
  const blocked = mode === 'live' && !live
  const submit = () => {
    if (!valid || starting || blocked) return
    void start(question.trim(), mode)
  }
  return (
    <div className="panel pointer-events-auto w-full p-2">
      <div className="flex flex-wrap items-end gap-2 sm:flex-nowrap">
        <textarea
          ref={area}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }}
          rows={1}
          aria-label="Research mission"
          placeholder="Describe a research question for the team"
          className="field min-h-8 w-full flex-[1_1_100%] resize-none sm:flex-[1_1_0%]"
        />
        <div className="ml-auto flex items-center gap-2">
          {hasDocs && (
            <button className="btn btn-secondary max-w-40 px-2" onClick={() => openLibrary(true)} title={`Documents for this mission: ${scopeLabel(library)}. Click to change.`}>
              <Library size={13} className="shrink-0" /> <span className="truncate text-meta">{scopeLabel(library)}</span>
            </button>
          )}
          <div className="segmented" role="group" aria-label="Run mode">
            <button aria-pressed={mode === 'live'} disabled={!live} onClick={() => setMode('live')} title={live ? 'Real Claude calls and web search' : 'The backend has no ANTHROPIC_API_KEY'}>Live</button>
            {demoAllowed && <button aria-pressed={mode === 'demo'} onClick={() => setMode('demo')} title="Scripted agents and synthetic content. No API calls.">Demo</button>}
          </div>
          <button className="btn btn-primary" disabled={!valid || starting || blocked} onClick={submit}>
            <ArrowUp size={14} /> {starting ? 'Starting' : 'Start'}
          </button>
        </div>
      </div>
      <div className="mt-1.5 flex min-w-0 items-center gap-2 px-0.5 text-meta">
        <span className="shrink-0 text-faint">Examples</span>
        <div className="flex min-w-0 flex-1 gap-2 overflow-hidden">
          {EXAMPLES.map((ex) => (
            <button key={ex} className="min-w-0 max-w-[33%] truncate text-muted hover:text-ink hover:underline" title={ex} onClick={() => setQuestion(ex)}>
              {ex}
            </button>
          ))}
        </div>
      </div>
      {mode === 'demo' && (
        <p className="mt-1.5 px-0.5 text-meta text-muted">
          Demo mode runs the real workflow with scripted agents. It makes no Claude calls and no web searches. All content is synthetic.
          {!live && ' Live missions need ANTHROPIC_API_KEY in backend/.env.'}
        </p>
      )}
      {startError && <p className="mt-1.5 px-0.5 text-meta text-st-error">{startError}</p>}
    </div>
  )
}

export function MissionDock() {
  const mission = useRunStore((s) => s.mission)
  const runId = useRunStore((s) => s.runId)
  const startError = useRunStore((s) => s.startError)
  if (runId && !mission) {
    return <div className="panel pointer-events-auto flex h-10 w-full items-center px-3 text-sm2 text-muted">Connecting to the run…</div>
  }
  if (mission) {
    return (
      <div className="w-full">
        <ActiveMission key={mission.runId} mission={mission} />
        {startError && <p className="panel pointer-events-auto mt-1.5 px-3 py-1.5 text-meta text-ink-2">{startError}</p>}
      </div>
    )
  }
  return <NewMission />
}
