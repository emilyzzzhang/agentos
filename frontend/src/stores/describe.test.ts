import { describe, expect, it } from 'vitest'
import { connectionStatus } from '../components/ui/TopBar'
import type { EventType, ExecutionEvent, Mission } from '../types'
import { describeEvent, groupFeed } from './describe'
import { applyEvent, initialExec } from './reduce'

let seq = 0
const ev = (type: EventType, agent_id: ExecutionEvent['agent_id'], payload: Record<string, unknown> = {}): ExecutionEvent => ({
  id: `e${++seq}`, run_id: 'run_1', seq, timestamp: new Date().toISOString(), type, agent_id, task_id: null, payload,
})

const ALL: ExecutionEvent[] = [
  ev('run.started', null, { question: 'Compare A and B', mode: 'live' }),
  ev('agent.started', 'alex', { action: 'planning' }),
  ev('agent.completed', 'alex', { action: 'planning', plan: { subtasks: [{}, {}, {}] } }),
  ev('task.assigned', 'alex', { from_agent: 'alex', to_agent: 'milo', title: 'T1' }),
  ev('task.assigned', 'alex', { from_agent: 'alex', to_agent: 'milo', title: 'T2' }),
  ev('agent.started', 'milo', { action: 'research', queries: ['a', 'b'] }),
  ev('tool.started', 'milo', { query: 'a', tool_call_id: 't1' }),
  ev('tool.started', 'milo', { query: 'b', tool_call_id: 't2' }),
  ev('tool.completed', 'milo', { query: 'a', source_count: 4, tool_call_id: 't1' }),
  ev('tool.failed', 'milo', { query: 'b', error: 'timeout', tool_call_id: 't2' }),
  ev('agent.completed', 'milo', { action: 'research', findings: [{}, {}], new_sources: [{}, {}, {}, {}] }),
  ev('task.assigned', 'milo', { from_agent: 'milo', to_agent: 'luna', title: 'Review' }),
  ev('agent.started', 'luna', { action: 'review' }),
  ev('agent.completed', 'luna', { action: 'review', verdict: 'revise' }),
  ev('review.requested', 'luna', { missing_evidence: ['Benchmarks'] }),
  ev('agent.failed', 'milo', { error: 'boom' }),
  ev('report.generated', 'luna', { title: 'R', cited_source_count: 3 }),
  ev('run.completed', null, { duration_s: 93.2, research_rounds: 2, source_count: 7 }),
  ev('run.failed', null, { error: 'Run was cancelled' }),
]

describe('describeEvent', () => {
  it('writes plain sentences with no emoji or exclamation marks for every event type', () => {
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u
    for (const e of ALL) {
      const d = describeEvent(e)
      expect(d.text, e.type).not.toMatch(emoji)
      expect(d.text, e.type).not.toContain('!')
      expect(d.text, e.type).toMatch(/\.$/)
    }
  })

  it('uses the expected wording', () => {
    const t = (i: number) => describeEvent(ALL[i]).text
    expect(t(2)).toBe('Alex created a research plan with 3 subtasks.')
    expect(t(8)).toBe('Milo retrieved 4 sources for “a”.')
    expect(t(14)).toBe('Luna requested additional evidence: Benchmarks.')
    expect(t(17)).toBe('Mission completed in 1 min 33 s. 2 research rounds, 7 sources.')
    expect(t(18)).toBe('Mission cancelled.')
    expect(describeEvent(ev('run.started', null, { question: 'Kafka or RabbitMQ?' })).text).toBe('Mission started: “Kafka or RabbitMQ?”')
    const long = describeEvent(ev('review.requested', 'luna', { missing_evidence: ['x'.repeat(300), 'second'] })).text
    expect(long.length).toBeLessThan(170)
    expect(long).toMatch(/… \(\+1 more\)\.$/)
    expect(describeEvent(ALL[15]).tone).toBe('error')
    expect(describeEvent(ALL[0]).agent).toBeNull()
  })
})

describe('groupFeed', () => {
  it('groups consecutive searches and batch assignments but keeps every event', () => {
    const feed = ALL.map(describeEvent)
    const groups = groupFeed(feed, ALL)
    expect(groups.flatMap((g) => g.items).map((i) => i.seq)).toEqual(ALL.map((e) => e.seq))
    const assign = groups.find((g) => g.items[0].seq === ALL[3].seq)!
    expect(assign.items).toHaveLength(2)
    expect(assign.head.text).toBe('Alex assigned 2 tasks to Milo.')
    const starts = groups.find((g) => g.items[0].seq === ALL[6].seq)!
    expect(starts.head.text).toBe('Milo started 2 web searches.')
    const done = groups.find((g) => g.items[0].seq === ALL[8].seq)!
    expect(done.head.text).toBe('Milo retrieved 4 sources from 1 search. 1 failed.')
    expect(done.head.tone).toBe('neutral')
  })
})

describe('connectionStatus', () => {
  it('treats a normal stream close as neutral and only real failures as errors', () => {
    let s = initialExec()
    for (const e of ALL.slice(0, 18)) s = applyEvent(s, e)
    const done = s.mission as Mission
    expect(connectionStatus('closed', done, null)).toMatchObject({ tone: 'ended', label: 'Run finished' })
    expect(connectionStatus('error', done, 'gone')).toMatchObject({ tone: 'failed', title: 'gone' })
    expect(connectionStatus('open', done, null).label).toBe('Live')
  })

  it('records the stage at which a run stopped', () => {
    let s = initialExec()
    for (const e of [...ALL.slice(0, 6), ALL[18]]) s = applyEvent(s, e)
    expect(s.mission).toMatchObject({ stage: 'failed', failedStage: 'research', cancelled: true })
  })
})
