import { useEffect } from 'react'
import { HOME, MEET, START_SPOT, type LocationId, visitSpot } from '../components/office/layout'
import { onExecutionEvent, useRunStore } from '../stores/runStore'
import { enqueue, interrupt, settleAll, useVisualStore, type Anim } from '../stores/visualStore'
import { releaseToWander, resetWandering, stopWandering } from '../stores/wander'
import type { AgentId, ExecutionEvent } from '../types'
import { AGENT_IDS } from '../types'

const vs = () => useVisualStore.getState()
const short = (s: unknown, n = 42) => {
  const t = String(s ?? '')
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

/** Batches rapid hand-offs between the same pair into one walk + several flying cards. */
const handoffBursts = new Map<string, { count: number; until: number }>()

function handoff(from: AgentId, to: AgentId, kind: 'task' | 'review' | 'findings', line: string) {
  const key = `${from}->${to}`
  const now = performance.now()
  const burst = handoffBursts.get(key)
  if (burst && burst.until > now) {
    burst.count += 1
    return
  }
  const b = { count: 1, until: now + 4000 }
  handoffBursts.set(key, b)
  enqueue(
    from,
    { kind: 'move', to: visitSpot(from, to) },
    {
      kind: 'pose', anim: 'talking', duration: 2.2,
      onStart: () => {
        vs().setBubble(from, { icon: kind === 'review' ? 'return' : kind === 'findings' ? 'handoff' : 'assign', text: line, tone: 'talk' }, 3200)
        for (let i = 0; i < b.count; i++) setTimeout(() => vs().card(from, to, kind), i * 280)
        b.until = 0 // later hand-offs start a new walk
      },
    },
    { kind: 'move', to: HOME[from] },
    { kind: 'pose', anim: from === 'alex' ? 'typing' : 'idle', duration: 1, hold: true },
  )
}

function handle(e: ExecutionEvent) {
  const p = e.payload
  const a = e.agent_id
  switch (e.type) {
    case 'run.started':
      vs().reset()
      stopWandering()
      for (const id of AGENT_IDS) {
        interrupt(id) // stop strolling at once; the walk to the table starts from where they are
        // kick off at the meeting table, then everyone goes to their desk
        enqueue(
          id,
          { kind: 'move', to: MEET[id] },
          { kind: 'pose', anim: id === 'alex' ? 'talking' : 'idle', duration: 2.4 },
          { kind: 'move', to: HOME[id] },
          { kind: 'pose', anim: 'idle', duration: 1, hold: true },
        )
      }
      vs().setBubble('alex', { icon: 'start', text: 'New mission received', tone: 'talk' }, 4000)
      break
    case 'agent.started': {
      if (!a) break
      vs().set({ errors: { ...vs().errors, [a]: undefined } })
      if (p.action === 'planning') {
        enqueue(a, { kind: 'move', to: HOME[a] }, { kind: 'pose', anim: 'thinking', duration: 2.5 }, { kind: 'pose', anim: 'typing', duration: 1, hold: true })
        vs().setBubble(a, { icon: 'plan', text: 'Writing the research plan', tone: 'think' }, 60000)
      } else if (p.action === 'research') {
        enqueue(a, { kind: 'move', to: HOME[a] }, { kind: 'pose', anim: 'typing', duration: 1, hold: true })
        vs().setBubble(a, { icon: 'research', text: p.iteration ? 'Starting follow-up research' : 'Starting research', tone: 'work' }, 5000)
      } else if (p.action === 'review') {
        enqueue(a, { kind: 'move', to: HOME[a] }, { kind: 'pose', anim: 'reading', duration: 1, hold: true })
        vs().setBubble(a, { icon: 'review', text: 'Reviewing the evidence', tone: 'work' }, 60000)
      } else if (p.action === 'write_report') {
        enqueue(a, { kind: 'move', to: HOME[a] }, { kind: 'pose', anim: 'typing', duration: 1, hold: true })
        vs().setBubble(a, { icon: 'write', text: 'Writing the report', tone: 'work' }, 120000)
      }
      break
    }
    case 'tool.started':
      if (!a) break
      vs().set({ activeTools: { ...vs().activeTools, [a]: vs().activeTools[a] + 1 } })
      vs().setBubble(a, { icon: 'search', text: short(p.query), tone: 'tool' }, 60000)
      break
    case 'tool.completed':
    case 'tool.failed': {
      if (!a) break
      const left = Math.max(0, vs().activeTools[a] - 1)
      vs().set({ activeTools: { ...vs().activeTools, [a]: left } })
      if (e.type === 'tool.completed') vs().popup(a, `${p.source_count} source${p.source_count === 1 ? '' : 's'}`, 'success')
      else vs().popup(a, 'Search failed', 'error')
      if (left === 0) vs().setBubble(a, { icon: 'research', text: 'Extracting findings', tone: 'think' }, 60000)
      break
    }
    case 'rag.retrieval_started':
      if (!a) break
      vs().set({ activeTools: { ...vs().activeTools, [a]: vs().activeTools[a] + 1 } })
      vs().setBubble(a, { icon: 'docSearch', text: short(`Documents: ${p.query}`), tone: 'tool' }, 60000)
      break
    case 'rag.retrieval_completed':
    case 'rag.retrieval_failed': {
      if (!a) break
      const left = Math.max(0, vs().activeTools[a] - 1)
      vs().set({ activeTools: { ...vs().activeTools, [a]: left } })
      if (e.type === 'rag.retrieval_completed') {
        const n = p.result_count ?? 0
        vs().popup(a, n ? `${n} passage${n === 1 ? '' : 's'}` : 'No passages', n ? 'info' : 'error')
      } else vs().popup(a, 'Document search failed', 'error')
      if (left === 0) vs().setBubble(a, { icon: 'research', text: 'Extracting findings', tone: 'think' }, 60000)
      break
    }
    case 'task.assigned': {
      const from = p.from_agent as AgentId
      const to = p.to_agent as AgentId
      if (!from || !to || from === to) break
      if (from === 'luna') break // the visit is already queued by review.requested
      handoff(from, to, from === 'milo' ? 'findings' : 'task', from === 'milo' ? 'Findings ready for review' : `Task: ${short(p.title, 30)}`)
      break
    }
    case 'review.requested':
      handoff('luna', 'milo', 'review', short(`Needs evidence: ${(p.missing_evidence ?? [])[0] ?? 'more sources'}`, 48))
      break
    case 'agent.completed': {
      if (!a) break
      if (p.action === 'review') {
        const ok = p.verdict === 'approve'
        enqueue(a, { kind: 'pose', anim: ok ? 'done' : 'thinking', duration: 1.6 })
        vs().setBubble(a, ok ? { icon: 'approve', text: 'Research approved', tone: 'success' } : { icon: 'gap', text: 'Evidence gaps found', tone: 'think' }, 3500)
      } else if (p.action === 'planning') {
        enqueue(a, { kind: 'move', to: 'board' }, { kind: 'pose', anim: 'talking', duration: 2.2, onStart: () => vs().setBubble(a, { icon: 'plan', text: 'Plan posted to the board', tone: 'success' }, 3000) })
        vs().clearBubble(a)
      } else if (p.action === 'write_report') {
        vs().clearBubble(a)
      } else {
        enqueue(a, { kind: 'pose', anim: 'done', duration: 1.4 })
        vs().setBubble(a, { icon: 'done', text: short(p.summary, 46), tone: 'success' }, 3500)
      }
      break
    }
    case 'agent.failed':
      if (!a) break
      vs().set({ errors: { ...vs().errors, [a]: String(p.error ?? 'error') } })
      enqueue(a, { kind: 'pose', anim: 'error', duration: 2, hold: true })
      vs().setBubble(a, { icon: 'fail', text: short(p.error, 48), tone: 'error' }, 12000)
      break
    case 'report.generated':
      enqueue('luna', { kind: 'move', to: MEET.luna }, {
        kind: 'pose', anim: 'talking', duration: 2.4,
        onStart: () => {
          vs().set({ reportVisible: true })
          vs().setBubble('luna', { icon: 'report', text: 'Report is on the table', tone: 'success' }, 4000)
        },
      })
      break
    case 'run.completed':
      for (const id of AGENT_IDS) {
        enqueue(id, { kind: 'move', to: MEET[id] }, {
          kind: 'pose', anim: 'celebrate', duration: 3.2,
          onStart: () => { vs().set({ celebrating: true, reportVisible: true }) },
        }, { kind: 'pose', anim: 'idle', duration: 1, hold: true, onStart: () => releaseToWander(id) })
      }
      vs().setBubble('alex', { icon: 'complete', text: 'Mission complete', tone: 'success' }, 5000)
      break
    case 'run.failed':
      for (const id of AGENT_IDS) {
        if (vs().errors[id]) continue
        enqueue(id, { kind: 'pose', anim: 'idle', duration: 0.5, hold: true, onStart: () => releaseToWander(id) })
      }
      vs().setBubble('alex', { icon: 'stop', text: p.error === 'Run was cancelled' ? 'Mission cancelled' : 'Mission stopped', tone: p.error === 'Run was cancelled' ? 'talk' : 'error' }, 6000)
      break
  }
}

/** After replaying history (page reload / late join) place everyone sensibly without animating the past. */
function settleFromBackend() {
  const { agents, mission } = useRunStore.getState()
  const anims: Partial<Record<AgentId, Anim>> = {}
  for (const id of AGENT_IDS) {
    const st = agents[id]
    anims[id] = st.status === 'error' ? 'error' : st.status === 'working' ? (id === 'luna' && st.currentTask?.id.startsWith('review') ? 'reading' : 'typing') : 'idle'
  }
  // mid-mission: at their desks; between missions: at their start spots, then wandering
  // (an agent that errored stays at their desk until the next mission)
  const active = !!mission && !mission.finishedAt
  const atDesk = (id: AgentId) => active || anims[id] === 'error'
  const places = Object.fromEntries(AGENT_IDS.map((id) => [id, atDesk(id) ? HOME[id] : START_SPOT[id]])) as Record<AgentId, LocationId>
  settleAll(anims, places)
  resetWandering(Object.fromEntries(AGENT_IDS.filter((id) => !atDesk(id)).map((id) => [id, START_SPOT[id]])))
  vs().reset()
  const milo = agents.milo
  const running = milo.toolCalls.filter((t) => t.status === 'running').length
  vs().set({
    activeTools: { alex: 0, milo: running, luna: 0 },
    reportVisible: !!mission?.reportTitle,
    errors: Object.fromEntries(AGENT_IDS.filter((id) => agents[id].error).map((id) => [id, agents[id].error!])),
  })
}

export function useVisualDirector() {
  useEffect(() => {
    let settleTimer: ReturnType<typeof setTimeout> | undefined
    const off = onExecutionEvent((e, replay) => {
      if (replay) {
        clearTimeout(settleTimer)
        settleTimer = setTimeout(settleFromBackend, 150)
        return
      }
      handle(e)
    })
    const prune = setInterval(() => vs().prune(), 400)
    return () => {
      off()
      clearInterval(prune)
      clearTimeout(settleTimer)
    }
  }, [])
}
