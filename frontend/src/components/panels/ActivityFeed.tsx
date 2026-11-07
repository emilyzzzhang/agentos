import { ChevronDown, ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AGENT_META, groupFeed, type FeedGroup, type FeedItem } from '../../stores/describe'
import { useRunStore } from '../../stores/runStore'
import { useUiStore } from '../../stores/uiStore'
import type { ExecutionEvent } from '../../types'
import { EventIcon } from '../ui/Icon'

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })

function Sentence({ item }: { item: FeedItem }) {
  if (!item.agent) return <>{item.action}</>
  return (
    <>
      <span className="font-medium text-ink">{AGENT_META[item.agent].name}</span> {item.action}
    </>
  )
}

function TechDetails({ event }: { event: ExecutionEvent }) {
  return (
    <details className="group/raw mt-1">
      <summary className="flex cursor-pointer list-none items-center gap-1 font-mono text-[10.5px] text-muted hover:text-ink">
        <ChevronRight size={11} className="transition-transform group-open/raw:rotate-90" />
        {event.type} · #{event.seq}{event.task_id ? ` · ${event.task_id}` : ''}
      </summary>
      <pre className="mt-1 max-h-48 overflow-auto rounded bg-[#2b2420] p-2 font-mono text-[10px] leading-relaxed text-[#efe6dc] scroll-thin">
        {JSON.stringify(event, null, 2)}
      </pre>
    </details>
  )
}

function Row({ group, events, open, onToggle }: { group: FeedGroup; events: Map<number, ExecutionEvent>; open: boolean; onToggle: () => void }) {
  const h = group.head
  const n = group.items.length
  return (
    <li className={`tl-${h.tone}`}>
      <button onClick={onToggle} aria-expanded={open} className="flex w-full items-start gap-2 rounded px-2.5 py-[5px] text-left hover:bg-hover">
        <span className="tl-node mt-px"><EventIcon name={h.icon} size={11} /></span>
        <span className="tl-text min-w-0 flex-1 text-sm2 text-ink-2">
          <Sentence item={h} />
          {n > 1 && <span className="ml-1 text-meta text-faint">({n})</span>}
        </span>
        <time className="tabular mt-px shrink-0 text-meta text-faint" dateTime={h.timestamp}>{time(group.items[0].timestamp)}</time>
      </button>
      {open && (
        <div className="mb-1 ml-[34px] mr-2.5 border-l border-line pl-2.5">
          {n > 1
            ? group.items.map((it) => (
                <div key={it.seq} className="py-0.5">
                  <div className="flex gap-2 text-meta text-ink-2">
                    <span className="min-w-0 flex-1">{it.action}</span>
                    <time className="tabular shrink-0 text-faint">{time(it.timestamp)}</time>
                  </div>
                  {events.get(it.seq) && <TechDetails event={events.get(it.seq)!} />}
                </div>
              ))
            : events.get(h.seq) && <TechDetails event={events.get(h.seq)!} />}
        </div>
      )}
    </li>
  )
}

export function ActivityFeed() {
  const feed = useRunStore((s) => s.feed)
  const events = useRunStore((s) => s.events)
  const open = useUiStore((s) => s.feedOpen)
  const setOpen = useUiStore((s) => s.setFeedOpen)
  const [expanded, setExpanded] = useState<string | null>(null)
  const list = useRef<HTMLOListElement>(null)
  const groups = useMemo(() => groupFeed(feed, events), [feed, events])
  const bySeq = useMemo(() => new Map(events.map((e) => [e.seq, e])), [events])
  const latest = groups[groups.length - 1]?.head

  useEffect(() => {
    const el = list.current
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 80) el.scrollTop = el.scrollHeight
  }, [groups.length, open])

  return (
    <section className="panel pointer-events-auto flex max-h-full min-h-0 w-full flex-col overflow-hidden" aria-label="Activity">
      <button className={`panel-header w-full text-left hover:bg-hover/60 ${open ? '' : 'border-b-0'}`} onClick={() => setOpen(!open)} aria-expanded={open}>
        <ChevronDown size={14} className={`shrink-0 text-muted transition-transform ${open ? '' : '-rotate-90'}`} />
        <span className="text-sm2 font-medium">Activity</span>
        <span className="tabular text-meta text-faint">{events.length}</span>
        {!open && latest && <span className="min-w-0 flex-1 truncate text-right text-meta text-muted">{latest.text}</span>}
      </button>
      {open && (
        <ol ref={list} className="timeline min-h-0 flex-1 overflow-y-auto py-1.5 scroll-thin">
          {groups.map((g) => (
            <Row key={g.key} group={g} events={bySeq} open={expanded === g.key} onToggle={() => setExpanded(expanded === g.key ? null : g.key)} />
          ))}
        </ol>
      )}
      {open && groups.length === 0 && <p className="px-3 py-4 text-center text-sm2 text-muted">Backend events appear here when a mission starts.</p>}
    </section>
  )
}
