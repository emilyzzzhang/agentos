import { describe, expect, it } from 'vitest'
import type { ExecutionEvent } from '../types'
import { findPath, LOCATIONS, NODES } from '../components/office/layout'
import { applyEvent, initialExec } from './reduce'

let seq = 0
const ev = (type: ExecutionEvent['type'], extra: Partial<ExecutionEvent> = {}): ExecutionEvent => ({
  id: `e${++seq}`, run_id: 'run_1', seq, timestamp: new Date().toISOString(), type,
  agent_id: null, task_id: null, payload: {}, ...extra,
})

describe('applyEvent', () => {
  it('builds mission, tasks, statuses and ignores duplicates', () => {
    seq = 0
    let s = initialExec()
    const start = ev('run.started', { payload: { question: 'Q?', mode: 'live', model: 'm', search_provider: 'x', max_revisions: 2 } })
    s = applyEvent(s, start)
    expect(s.mission?.stage).toBe('planning')
    s = applyEvent(s, ev('agent.started', { agent_id: 'alex', task_id: 'plan', payload: { action: 'planning' } }))
    expect(s.agents.alex.status).toBe('working')
    const plan = { objective: 'o', approach: 'a', success_criteria: [], subtasks: [{ id: 'st1', title: 'T1', description: '', search_queries: ['q'] }] }
    s = applyEvent(s, ev('agent.completed', { agent_id: 'alex', task_id: 'plan', payload: { action: 'planning', plan } }))
    s = applyEvent(s, ev('task.assigned', { agent_id: 'alex', task_id: 'st1', payload: { from_agent: 'alex', to_agent: 'milo', title: 'T1' } }))
    expect(s.mission?.plan?.subtasks).toHaveLength(1)
    expect(s.tasks.st1.status).toBe('assigned')
    expect(s.agents.milo.status).toBe('waiting')

    const before = s
    s = applyEvent(s, start) // duplicate replay (seq 1) is ignored
    expect(s).toBe(before)

    s = applyEvent(s, ev('agent.started', { agent_id: 'milo', task_id: 'research-1', payload: { action: 'research', iteration: 0, queries: ['q'] } }))
    expect(s.tasks.st1.status).toBe('in_progress')
    s = applyEvent(s, ev('tool.started', { agent_id: 'milo', task_id: 'research-1', payload: { tool_call_id: 'c1', query: 'q' } }))
    expect(s.agents.milo.toolCalls[0].status).toBe('running')
    s = applyEvent(s, ev('tool.completed', { agent_id: 'milo', task_id: 'research-1', payload: { tool_call_id: 'c1', query: 'q', source_count: 2, sources: [] } }))
    expect(s.agents.milo.toolCalls[0]).toMatchObject({ status: 'done', sourceCount: 2 })
    s = applyEvent(s, ev('agent.completed', { agent_id: 'milo', task_id: 'research-1', payload: { action: 'research', iteration: 0, findings: [{ claim: 'c', evidence: 'e', source_ids: ['S1'], subtask_id: 'st1', confidence: 'high' }], new_sources: [{ id: 'S1', url: 'https://a', title: 'A' }] } }))
    expect(s.tasks.st1.status).toBe('done')
    expect(s.agents.milo.findings).toHaveLength(1)

    s = applyEvent(s, ev('agent.completed', { agent_id: 'luna', task_id: 'review-1', payload: { action: 'review', verdict: 'revise', assessment: 'gaps', missing_evidence: ['m'] } }))
    s = applyEvent(s, ev('review.requested', { agent_id: 'luna', task_id: 'research-2', payload: { missing_evidence: ['m'] } }))
    expect(s.mission?.reviews[0].verdict).toBe('revise')
    expect(s.mission?.stage).toBe('research')

    s = applyEvent(s, ev('agent.failed', { agent_id: 'luna', task_id: 'report', payload: { error: 'boom' } }))
    expect(s.agents.luna).toMatchObject({ status: 'error', error: 'boom' })
    s = applyEvent(s, ev('run.failed', { payload: { error: 'boom' } }))
    expect(s.mission).toMatchObject({ stage: 'failed', error: 'boom' })
    expect(s.feed.map((f) => f.seq)).toEqual(s.events.map((e) => e.seq))
  })

  it('ignores events from another run', () => {
    seq = 0
    let s = applyEvent(initialExec(), ev('run.started', { payload: { question: 'Q' } }))
    const other = applyEvent(s, ev('agent.started', { run_id: 'run_2', agent_id: 'alex', payload: { action: 'planning' } }))
    expect(other).toBe(s)
    s = other
  })
})

describe('waypoint graph', () => {
  it('connects every location without teleport-length hops', () => {
    const ids = Object.keys(LOCATIONS) as (keyof typeof LOCATIONS)[]
    for (const a of ids)
      for (const b of ids) {
        const path = findPath(LOCATIONS[a].node, LOCATIONS[b].node)
        expect(path[0]).toBe(LOCATIONS[a].node)
        expect(path[path.length - 1]).toBe(LOCATIONS[b].node)
        for (let i = 1; i < path.length; i++) {
          const p = NODES[path[i - 1]], q = NODES[path[i]]
          expect(Math.hypot(p.x - q.x, p.z - q.z)).toBeLessThan(6.5)
        }
      }
  })
})
