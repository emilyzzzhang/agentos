import type { AgentId, AgentState, ExecutionEvent, Mission, Task } from '../types'
import { AGENT_IDS } from '../types'
import { AGENT_META, describeEvent, type FeedItem } from './describe'

export interface ExecState {
  mission: Mission | null
  agents: Record<AgentId, AgentState>
  tasks: Record<string, Task>
  taskOrder: string[]
  events: ExecutionEvent[]
  feed: FeedItem[]
  lastSeq: number
}

export const freshAgents = (): Record<AgentId, AgentState> =>
  Object.fromEntries(
    AGENT_IDS.map((id) => [
      id,
      {
        id, name: AGENT_META[id].name, role: AGENT_META[id].role, status: 'idle',
        currentTask: null, activities: [], toolCalls: [], findings: [], sources: [], notes: [], error: null,
      } satisfies AgentState as AgentState,
    ]),
  ) as unknown as Record<AgentId, AgentState>

export const initialExec = (): ExecState => ({
  mission: null, agents: freshAgents(), tasks: {}, taskOrder: [], events: [], feed: [], lastSeq: 0,
})

const MAX_ACTIVITIES = 60

function patchAgent(s: ExecState, id: AgentId, patch: Partial<AgentState> | ((a: AgentState) => Partial<AgentState>)) {
  const a = s.agents[id]
  const p = typeof patch === 'function' ? patch(a) : patch
  s.agents = { ...s.agents, [id]: { ...a, ...p } }
}

function upsertTask(s: ExecState, t: Task) {
  if (!s.tasks[t.id]) s.taskOrder = [...s.taskOrder, t.id]
  s.tasks = { ...s.tasks, [t.id]: { ...s.tasks[t.id], ...t } }
}

function setTaskStatus(s: ExecState, id: string | null, status: Task['status']) {
  if (id && s.tasks[id]) s.tasks = { ...s.tasks, [id]: { ...s.tasks[id], status } }
}

const taskTitle = (e: ExecutionEvent): string => {
  const p = e.payload
  switch (p.action) {
    case 'planning': return 'Create research plan'
    case 'research': return p.iteration ? `Follow-up research (round ${p.iteration + 1})` : 'Research the plan'
    case 'review': return 'Review research findings'
    case 'write_report': return 'Write final report'
    default: return e.task_id ?? 'Task'
  }
}

/** Pure reducer: backend event -> execution state. Ignores duplicates / out-of-order replays. */
export function applyEvent(prev: ExecState, e: ExecutionEvent): ExecState {
  if (e.seq <= prev.lastSeq) return prev
  if (!e.run_id) return prev // workspace-level document events belong to the library store
  if (prev.mission && e.run_id !== prev.mission.runId && e.type !== 'run.started') return prev
  let s: ExecState = { ...prev, events: [...prev.events, e], lastSeq: e.seq }
  if (e.type === 'run.started') {
    s = { ...initialExec(), events: [e], lastSeq: e.seq }
  }
  const item = describeEvent(e)
  s.feed = [...s.feed, item]
  const p = e.payload
  const agent = e.agent_id
  if (agent) {
    patchAgent(s, agent, (a) => ({
      activities: [...a.activities, { seq: e.seq, timestamp: e.timestamp, type: e.type, text: item.text }].slice(-MAX_ACTIVITIES),
    }))
  }
  const m = s.mission

  switch (e.type) {
    case 'run.started':
      s.mission = {
        runId: e.run_id, question: p.question, mode: p.mode ?? 'live', model: p.model, searchProvider: p.search_provider,
        maxRevisions: p.max_revisions ?? 2, plan: null, stage: 'planning', researchRound: 0, reviews: [],
        startedAt: e.timestamp, finishedAt: null, error: null, failedStage: null, cancelled: false, reportTitle: null, summary: null,
        knowledge: p.knowledge ?? null,
      }
      break
    case 'task.assigned':
      upsertTask(s, {
        id: e.task_id ?? `task-${e.seq}`, title: p.title, description: p.description ?? '', from: p.from_agent,
        assignee: p.to_agent, status: 'assigned', queries: p.search_queries ?? [],
      })
      if (p.to_agent && s.agents[p.to_agent as AgentId].status !== 'working')
        patchAgent(s, p.to_agent, { status: 'waiting' })
      break
    case 'agent.started': {
      if (!agent) break
      patchAgent(s, agent, { status: 'working', error: null, currentTask: { id: e.task_id ?? '', title: taskTitle(e) } })
      setTaskStatus(s, e.task_id, 'in_progress')
      if (m) {
        const stage = p.action === 'planning' ? 'planning' : p.action === 'research' ? 'research' : p.action === 'review' ? 'review' : 'report'
        s.mission = { ...m, stage, researchRound: p.action === 'research' ? (p.iteration ?? 0) + 1 : m.researchRound }
      }
      if (agent === 'milo' && p.action === 'research' && !p.iteration && m?.plan) {
        // initial research covers every plan subtask
        for (const st of m.plan.subtasks) setTaskStatus(s, st.id, 'in_progress')
      }
      break
    }
    case 'agent.completed': {
      if (!agent) break
      patchAgent(s, agent, { status: 'done', currentTask: null })
      setTaskStatus(s, e.task_id, 'done')
      if (agent === 'alex' && p.plan && m) s.mission = { ...s.mission!, plan: p.plan }
      if (agent === 'milo') {
        patchAgent(s, 'milo', (a) => ({
          findings: [...a.findings, ...(p.findings ?? [])],
          sources: [...a.sources, ...(p.new_sources ?? [])],
          notes: p.research_summary ? [...a.notes, p.research_summary] : a.notes,
        }))
        if (!p.iteration && m?.plan) for (const st of m.plan.subtasks) setTaskStatus(s, st.id, 'done')
      }
      if (agent === 'luna' && p.action === 'review' && s.mission) {
        s.mission = {
          ...s.mission,
          reviews: [...s.mission.reviews, {
            round: s.mission.reviews.length + 1, verdict: p.verdict, assessment: p.assessment,
            missing: p.missing_evidence ?? [], unsupported: p.unsupported_claims ?? [], limitReached: !!p.revision_limit_reached,
          }],
        }
        patchAgent(s, 'luna', (a) => ({ notes: [...a.notes, p.assessment] }))
      }
      break
    }
    case 'agent.failed':
      if (!agent) break
      patchAgent(s, agent, { status: 'error', error: p.error ?? 'Unknown error' })
      setTaskStatus(s, e.task_id, 'failed')
      break
    case 'tool.started':
      if (!agent) break
      patchAgent(s, agent, (a) => ({
        toolCalls: [...a.toolCalls, { id: p.tool_call_id, kind: 'web', taskId: e.task_id, query: p.query, status: 'running', startedAt: e.timestamp }],
      }))
      break
    case 'rag.retrieval_started':
      if (!agent) break
      patchAgent(s, agent, (a) => ({
        toolCalls: [...a.toolCalls, { id: p.tool_call_id, kind: 'documents', taskId: e.task_id, query: p.query, status: 'running', startedAt: e.timestamp }],
      }))
      break
    case 'rag.retrieval_completed':
    case 'rag.retrieval_failed':
      if (!agent) break
      patchAgent(s, agent, (a) => ({
        toolCalls: a.toolCalls.map((t) =>
          t.id === p.tool_call_id
            ? {
                ...t, status: e.type === 'rag.retrieval_completed' ? 'done' : 'failed', endedAt: e.timestamp,
                sourceCount: p.result_count, passages: p.results, error: p.error,
              }
            : t,
        ),
      }))
      break
    case 'tool.completed':
    case 'tool.failed':
      if (!agent) break
      patchAgent(s, agent, (a) => ({
        toolCalls: a.toolCalls.map((t) =>
          t.id === p.tool_call_id
            ? {
                ...t, status: e.type === 'tool.completed' ? 'done' : 'failed', endedAt: e.timestamp,
                sourceCount: p.source_count, sources: p.sources, error: p.error,
              }
            : t,
        ),
      }))
      break
    case 'review.requested':
      if (s.mission) s.mission = { ...s.mission, stage: 'research' }
      break
    case 'report.generated':
      if (s.mission) s.mission = { ...s.mission, reportTitle: p.title }
      break
    case 'run.completed':
      if (s.mission) s.mission = { ...s.mission, stage: 'done', finishedAt: e.timestamp, summary: p }
      for (const id of AGENT_IDS) patchAgent(s, id, (a) => ({ status: a.status === 'error' ? 'error' : 'idle', currentTask: null }))
      break
    case 'run.failed':
      if (s.mission) s.mission = {
          ...s.mission, stage: 'failed', failedStage: s.mission.stage, finishedAt: e.timestamp,
          error: p.error, cancelled: p.error === 'Run was cancelled',
        }
      for (const id of AGENT_IDS)
        patchAgent(s, id, (a) => ({ status: a.status === 'error' ? 'error' : 'idle', currentTask: null }))
      break
  }
  return s
}
