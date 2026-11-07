import type { AgentId, AgentStatus, ExecutionEvent } from '../types'

export const AGENT_META: Record<AgentId, { name: string; role: string; color: string; accent: string }> = {
  alex: { name: 'Alex', role: 'Manager', color: '#3b4a7a', accent: '#e0574f' },
  milo: { name: 'Milo', role: 'Researcher', color: '#4f8a5b', accent: '#f0a04b' },
  luna: { name: 'Luna', role: 'Reviewer', color: '#c46a4a', accent: '#8a5ca8' },
}

/** One vocabulary for agent status everywhere in the UI. */
export const STATUS_LABEL: Record<AgentStatus, string> = {
  idle: 'Idle', waiting: 'Waiting', working: 'Working', done: 'Completed', error: 'Failed',
}

/** Icon keys are resolved to Lucide components in components/ui/Icon.tsx (keeps this module React-free). */
export type IconKey =
  | 'start' | 'plan' | 'assign' | 'handoff' | 'return' | 'research' | 'review' | 'approve' | 'gap'
  | 'write' | 'report' | 'search' | 'sources' | 'searchFailed' | 'fail' | 'complete' | 'stop' | 'done'
  | 'docSearch' | 'passages' | 'docFailed' | 'library'

/** neutral: routine progress · attention: the workflow changed course · done: mission finished · error: failure */
export type Tone = 'neutral' | 'attention' | 'done' | 'error'

export interface FeedItem {
  seq: number
  timestamp: string
  type: ExecutionEvent['type']
  agent: AgentId | null
  icon: IconKey
  tone: Tone
  /** Sentence without the actor, e.g. "retrieved 4 sources for “x”." */
  action: string
  /** Full sentence, e.g. "Milo retrieved 4 sources for “x”." */
  text: string
}

const nameOf = (id: unknown) => (typeof id === 'string' && id in AGENT_META ? AGENT_META[id as AgentId].name : 'the team')
const quote = (s: unknown, max = 80) => {
  const t = String(s ?? '').trim().replace(/[.\s]+$/, '')
  return `“${t.length > max ? `${t.slice(0, max - 1)}…` : t}”`
}
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s.replace(/\.$/, ''))
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const sentence = (s: string) => (/[.!?…]”?$/.test(s) ? s : `${s}.`)
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export function formatDuration(seconds: number): string {
  const s = Math.round(seconds)
  if (s < 60) return plural(s, 'second')
  const m = Math.floor(s / 60)
  const r = s % 60
  return r ? `${m} min ${r} s` : plural(m, 'minute')
}

function parts(e: ExecutionEvent): { icon: IconKey; tone: Tone; action: string } {
  const p = e.payload ?? {}
  switch (e.type) {
    case 'run.started': {
      const k = p.knowledge
      const docs = k ? ` with ${plural(k.document_count, 'document')} ${k.explicit ? 'selected' : 'available'}` : ''
      return { icon: 'start', tone: 'neutral', action: `Mission started${p.mode === 'demo' ? ' in demo mode' : ''}${docs}: ${quote(p.question, 120)}` }
    }
    case 'task.assigned': {
      const to = nameOf(p.to_agent)
      if (p.from_agent === 'milo') return { icon: 'handoff', tone: 'neutral', action: `sent the findings to ${to} for review` }
      if (p.from_agent === 'luna') return { icon: 'return', tone: 'attention', action: `assigned follow-up research to ${to}` }
      return { icon: 'assign', tone: 'neutral', action: `assigned ${quote(p.title, 60)} to ${to}` }
    }
    case 'agent.started':
      switch (p.action) {
        case 'planning': return { icon: 'plan', tone: 'neutral', action: 'started the research plan' }
        case 'research': {
          const web = p.queries?.length ?? 0
          const docs = p.document_queries?.length ?? 0
          const what = docs && web ? `${plural(web, 'web query', 'web queries')} and ${plural(docs, 'document query', 'document queries')}`
            : docs ? plural(docs, 'document query', 'document queries') : plural(web, 'query', 'queries')
          return { icon: 'research', tone: 'neutral', action: `started ${p.iteration ? 'follow-up research' : 'research'} with ${what}` }
        }
        case 'review': return { icon: 'review', tone: 'neutral', action: 'started reviewing the findings' }
        case 'write_report': return { icon: 'write', tone: 'neutral', action: 'started writing the report' }
        default: return { icon: 'start', tone: 'neutral', action: `started ${p.summary ?? 'work'}` }
      }
    case 'agent.completed':
      switch (p.action) {
        case 'planning':
          return { icon: 'plan', tone: 'neutral', action: `created a research plan with ${plural(p.plan?.subtasks?.length ?? 0, 'subtask')}` }
        case 'research': {
          const f = p.findings?.length ?? 0
          const s = p.new_sources?.length ?? 0
          return { icon: 'done', tone: 'neutral', action: `extracted ${plural(f, 'finding')} from ${plural(s, 'new source')}` }
        }
        case 'review':
          if (p.verdict === 'approve') return { icon: 'approve', tone: 'neutral', action: 'approved the research' }
          return {
            icon: 'gap', tone: 'attention',
            action: p.revision_limit_reached ? 'found evidence gaps. The revision limit is reached, so the report notes them as limitations' : 'found evidence gaps',
          }
        case 'write_report': return { icon: 'done', tone: 'neutral', action: 'completed the report' }
        default: return { icon: 'done', tone: 'neutral', action: p.summary ? `completed: ${p.summary}` : 'completed the task' }
      }
    case 'agent.failed':
      return { icon: 'fail', tone: 'error', action: `failed: ${p.error ?? 'unknown error'}` }
    case 'tool.started':
      return { icon: 'search', tone: 'neutral', action: `started searching ${quote(p.query)}` }
    case 'tool.completed':
      return { icon: 'sources', tone: 'neutral', action: `retrieved ${plural(p.source_count ?? 0, 'source')} for ${quote(p.query)}` }
    case 'tool.failed':
      return { icon: 'searchFailed', tone: 'error', action: `could not search ${quote(p.query)}: ${p.error ?? 'unknown error'}` }
    case 'review.requested': {
      const missing: string[] = p.missing_evidence ?? []
      if (!missing.length) return { icon: 'gap', tone: 'attention', action: 'requested additional evidence' }
      const first = clip(missing[0], 110)
      return { icon: 'gap', tone: 'attention', action: `requested additional evidence: ${first}${missing.length > 1 ? ` (+${missing.length - 1} more)` : ''}` }
    }
    case 'report.generated':
      return { icon: 'report', tone: 'neutral', action: `saved the report ${quote(p.title, 70)} with ${plural(p.cited_source_count ?? 0, 'cited source')}` }
    case 'run.completed':
      return {
        icon: 'complete', tone: 'done',
        action: `Mission completed in ${formatDuration(p.duration_s ?? 0)}. ${plural(p.research_rounds ?? 1, 'research round')}, ${plural(p.source_count ?? 0, 'source')}`,
      }
    case 'rag.retrieval_started':
      return { icon: 'docSearch', tone: 'neutral', action: `started searching the documents for ${quote(p.query)}` }
    case 'rag.retrieval_completed': {
      const n = p.result_count ?? 0
      if (!n) return { icon: 'passages', tone: 'neutral', action: `found no relevant passages for ${quote(p.query)}` }
      return {
        icon: 'passages', tone: 'neutral',
        action: `retrieved ${plural(n, 'passage')} from ${plural(p.document_count ?? 1, 'document')} for ${quote(p.query)}`,
      }
    }
    case 'rag.retrieval_failed':
      return { icon: 'docFailed', tone: 'error', action: `could not search the documents for ${quote(p.query)}: ${p.error ?? 'unknown error'}` }
    case 'run.failed':
      return p.error === 'Run was cancelled'
        ? { icon: 'stop', tone: 'neutral', action: 'Mission cancelled' }
        : { icon: 'fail', tone: 'error', action: `Mission failed: ${p.error ?? 'unknown error'}` }
  }
}

/** Plain description of one backend event. Describes only what the event payload states. */
export function describeEvent(e: ExecutionEvent): FeedItem {
  const { icon, tone, action } = parts(e)
  const actor = e.agent_id && e.agent_id in AGENT_META ? AGENT_META[e.agent_id].name : null
  const isRunEvent = e.type.startsWith('run.')
  const act = sentence(action)
  return {
    seq: e.seq, timestamp: e.timestamp, type: e.type, agent: isRunEvent ? null : e.agent_id, icon, tone,
    action: isRunEvent || !actor ? capital(act) : act,
    text: isRunEvent || !actor ? capital(act) : `${actor} ${act}`,
  }
}

// ---------- grouping ----------

export interface FeedGroup {
  key: string
  items: FeedItem[]
  /** Representative row: the single item, or a summary of the group. */
  head: FeedItem
}

const groupKey = (f: FeedItem): string | null => {
  if (f.type === 'tool.started') return `${f.agent}:search-start`
  if (f.type === 'tool.completed' || f.type === 'tool.failed') return `${f.agent}:search-done`
  if (f.type === 'task.assigned' && f.icon === 'assign') return `${f.agent}:assign`
  if (f.type === 'rag.retrieval_started') return `${f.agent}:doc-start`
  if (f.type === 'rag.retrieval_completed' || f.type === 'rag.retrieval_failed') return `${f.agent}:doc-done`
  return null
}

function summarize(items: FeedItem[], events: Map<number, ExecutionEvent>): FeedItem {
  const first = items[0]
  const last = items[items.length - 1]
  const n = items.length
  const base = { ...last, seq: first.seq }
  let action = first.action
  let tone: Tone = 'neutral'
  if (first.type === 'tool.started') action = `started ${plural(n, 'web search', 'web searches')}.`
  else if (first.type === 'rag.retrieval_started') action = `started ${plural(n, 'document search', 'document searches')}.`
  else if (first.type === 'rag.retrieval_completed' || first.type === 'rag.retrieval_failed') {
    const failed = items.filter((i) => i.type === 'rag.retrieval_failed').length
    const payloads = items.map((i) => events.get(i.seq)?.payload ?? {})
    // Parallel queries often return the same chunk; count distinct passages.
    const results: { document_id: string; chunk_id: string }[] = payloads.flatMap((pl) => pl.results ?? [])
    const passages = new Set(results.map((r) => r.chunk_id)).size
    const docs = new Set(results.map((r) => r.document_id)).size
    action = passages
      ? `retrieved ${plural(passages, 'passage')} from ${plural(docs, 'document')} in ${plural(n - failed, 'search', 'searches')}${failed ? `. ${failed} failed` : ''}.`
      : `found no relevant passages in ${plural(n - failed, 'document search', 'document searches')}${failed ? `. ${failed} failed` : ''}.`
    tone = failed === n ? 'error' : 'neutral'
    const actor = first.agent ? AGENT_META[first.agent].name : 'The team'
    return { ...base, icon: tone === 'error' ? 'docFailed' : 'passages', tone, action, text: `${actor} ${action}` }
  } else if (first.type === 'task.assigned') {
    const to = nameOf(events.get(first.seq)?.payload?.to_agent)
    action = `assigned ${plural(n, 'task')} to ${to}.`
  } else {
    const failed = items.filter((i) => i.type === 'tool.failed').length
    const sources = items.reduce((sum, i) => sum + (events.get(i.seq)?.payload?.source_count ?? 0), 0)
    action = `retrieved ${plural(sources, 'source')} from ${plural(n - failed, 'search', 'searches')}${failed ? `. ${failed} failed` : ''}.`
    tone = failed === n ? 'error' : 'neutral'
  }
  const actor = first.agent ? AGENT_META[first.agent].name : 'The team'
  return { ...base, icon: first.icon === 'searchFailed' && tone !== 'error' ? 'sources' : first.icon, tone, action, text: `${actor} ${action}` }
}

/** Collapse runs of consecutive related events (parallel searches, batch assignments) into one row. */
export function groupFeed(feed: FeedItem[], events: ExecutionEvent[]): FeedGroup[] {
  const bySeq = new Map(events.map((e) => [e.seq, e]))
  const groups: FeedGroup[] = []
  let run: FeedItem[] = []
  let runKey: string | null = null
  const flush = () => {
    if (!run.length) return
    groups.push({ key: `g${run[0].seq}`, items: run, head: run.length === 1 ? run[0] : summarize(run, bySeq) })
    run = []
  }
  for (const f of feed) {
    const k = groupKey(f)
    if (k && k === runKey) {
      run.push(f)
      continue
    }
    flush()
    run = [f]
    runKey = k
  }
  flush()
  return groups
}
