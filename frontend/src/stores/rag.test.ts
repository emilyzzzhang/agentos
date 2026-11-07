import { describe, expect, it } from 'vitest'
import type { ExecutionEvent, LibraryDocument } from '../types'
import { describeEvent, groupFeed } from './describe'
import { missionScope, scopeLabel } from './libraryStore'
import { applyEvent, initialExec } from './reduce'

let seq = 0
const ev = (type: ExecutionEvent['type'], payload: Record<string, unknown>, agent_id: ExecutionEvent['agent_id'] = 'milo', run_id: string | null = 'run_1'): ExecutionEvent => ({
  id: `e${++seq}`, run_id, seq, timestamp: new Date().toISOString(), type, agent_id, task_id: 'research-1', payload,
})
const result = (doc: string, chunk: string) => ({ document_id: doc, chunk_id: chunk, title: 'Aurora', filename: 'aurora.md', page: 3, section: null, score: 0.61 })

describe('RAG events', () => {
  it('describes retrieval plainly and groups parallel document searches', () => {
    seq = 0
    const events = [
      ev('rag.retrieval_started', { query: 'Aurora batch size', tool_call_id: 'c1' }),
      ev('rag.retrieval_started', { query: 'Aurora limits', tool_call_id: 'c2' }),
      ev('rag.retrieval_completed', { query: 'Aurora batch size', tool_call_id: 'c1', result_count: 2, document_count: 1, results: [result('d1', 'd1-c0'), result('d1', 'd1-c1')] }),
      ev('rag.retrieval_completed', { query: 'Aurora limits', tool_call_id: 'c2', result_count: 0, document_count: 0, results: [] }),
      ev('rag.retrieval_failed', { query: 'x', tool_call_id: 'c3', error: 'qdrant down' }),
    ]
    expect(describeEvent(events[2]).text).toBe('Milo retrieved 2 passages from 1 document for “Aurora batch size”.')
    expect(describeEvent(events[3]).text).toBe('Milo found no relevant passages for “Aurora limits”.')
    expect(describeEvent(events[4]).tone).toBe('error')
    const groups = groupFeed(events.map(describeEvent), events)
    expect(groups.map((g) => g.head.text)).toEqual([
      'Milo started 2 document searches.',
      'Milo retrieved 2 passages from 1 document in 2 searches. 1 failed.',
    ])
    const dup = [events[2], { ...events[2], seq: 99, payload: { ...events[2].payload, tool_call_id: 'c9' } }]
    expect(groupFeed(dup.map(describeEvent), dup)[0].head.text).toBe('Milo retrieved 2 passages from 1 document in 2 searches.')
    expect(describeEvent(ev('agent.started', { action: 'research', queries: [], document_queries: ['a', 'b'] })).text)
      .toBe('Milo started research with 2 document queries.')
    expect([
      describeEvent(ev('agent.started', { action: 'research', queries: ['w'], document_queries: ['a'] })).text,
    ]).toEqual(['Milo started research with 1 web query and 1 document query.'])
  })

  it('tracks document searches as tool calls and ignores workspace-level events', () => {
    seq = 0
    let s = applyEvent(initialExec(), ev('run.started', { question: 'Q?', knowledge: { document_count: 1, explicit: true, documents: [{ id: 'd1', title: 'A', filename: 'a.md' }] } }, null))
    expect(s.mission?.knowledge?.document_count).toBe(1)
    s = applyEvent(s, ev('rag.retrieval_started', { query: 'q', tool_call_id: 'c1' }))
    expect(s.agents.milo.toolCalls[0]).toMatchObject({ kind: 'documents', status: 'running' })
    s = applyEvent(s, ev('rag.retrieval_completed', { query: 'q', tool_call_id: 'c1', result_count: 1, results: [result('d1', 'd1-c0')] }))
    expect(s.agents.milo.toolCalls[0]).toMatchObject({ status: 'done', sourceCount: 1, passages: [{ chunk_id: 'd1-c0', page: 3 }] })
    const before = s
    s = applyEvent(s, ev('document.indexing_completed' as ExecutionEvent['type'], {}, null, null))
    expect(s).toBe(before)
  })
})

describe('mission document scope', () => {
  const doc = (id: string, status: LibraryDocument['status'] = 'ready', needs_reindex = false) => ({ id, status, needs_reindex }) as LibraryDocument
  const documents = [doc('a'), doc('b'), doc('c', 'processing'), doc('d', 'ready', true)]
  it('maps the UI choice to document_ids for POST /runs', () => {
    expect(missionScope({ scope: 'all', selected: [], documents })).toBeNull()
    expect(missionScope({ scope: 'none', selected: ['a'], documents })).toEqual([])
    expect(missionScope({ scope: 'selected', selected: ['b', 'c', 'd', 'gone'], documents })).toEqual(['b'])
    expect(scopeLabel({ scope: 'all', selected: [], documents })).toBe('All documents (2)')
    expect(scopeLabel({ scope: 'selected', selected: [], documents })).toBe('Web only (none selected)')
    expect(scopeLabel({ scope: 'all', selected: [], documents: [] })).toBe('Web only')
  })
})
