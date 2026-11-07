import { KeyRound, Library, LocateFixed, Unplug } from 'lucide-react'
import { useLibraryStore } from '../../stores/libraryStore'
import { useRunStore } from '../../stores/runStore'
import { useUiStore } from '../../stores/uiStore'
import type { ConnectionState, Mission } from '../../types'

type Tone = 'idle' | 'live' | 'pending' | 'ended' | 'failed'
const DOT: Record<Tone, string> = {
  idle: 'bg-st-idle', live: 'bg-st-done pulse', pending: 'bg-st-waiting pulse', ended: 'bg-st-idle', failed: 'bg-st-error',
}

/**
 * The stream closes normally when a run ends (server sends `end`). That is not an error,
 * so a finished run shows a neutral label. Only `error` (run gone / unreachable) is red.
 */
export function connectionStatus(connection: ConnectionState, mission: Mission | null, detail: string | null): { tone: Tone; label: string; title: string } {
  switch (connection) {
    case 'idle': return { tone: 'idle', label: 'Ready', title: 'No mission is running.' }
    case 'connecting': return { tone: 'pending', label: 'Connecting', title: 'Opening the event stream.' }
    case 'open': return { tone: 'live', label: 'Live', title: 'Receiving events from the backend.' }
    case 'reconnecting': return { tone: 'pending', label: 'Reconnecting', title: detail ?? 'The event stream dropped. Resuming from the last received event.' }
    case 'closed':
      if (mission?.stage === 'failed') return { tone: 'ended', label: 'Run ended', title: 'The run stopped. The event stream closed normally.' }
      return { tone: 'ended', label: 'Run finished', title: 'All events received. The event stream closed normally.' }
    case 'error': return { tone: 'failed', label: 'Connection lost', title: detail ?? 'The event stream failed.' }
  }
}

export function TopBar() {
  const connection = useRunStore((s) => s.connection)
  const detail = useRunStore((s) => s.connectionDetail)
  const health = useRunStore((s) => s.health)
  const healthError = useRunStore((s) => s.healthError)
  const mission = useRunStore((s) => s.mission)
  const reset = useUiStore((s) => s.resetCamera)
  const libraryOpen = useUiStore((s) => s.libraryOpen)
  const setLibraryOpen = useUiStore((s) => s.setLibraryOpen)
  const docCount = useLibraryStore((s) => s.documents.length)
  const indexing = useLibraryStore((s) => s.documents.some((d) => d.status === 'pending' || d.status === 'processing'))
  const c = connectionStatus(connection, mission, detail)
  return (
    <div className="panel pointer-events-auto flex h-9 min-w-0 items-center gap-3 pr-1 pl-2.5">
      <div className="flex items-center gap-2">
        <svg viewBox="0 0 64 64" className="h-[18px] w-[18px] shrink-0" aria-hidden>
          <rect x="2" y="2" width="60" height="60" rx="12" fill="#c0603d" />
          <path d="M32 14l16 9v18l-16 9-16-9V23z" fill="#fff6ea" />
          <path d="M32 32l16-9M32 32v18M32 32L16 23" stroke="#c0603d" strokeWidth="3.5" fill="none" />
        </svg>
        <span className="text-body font-semibold tracking-tight">AgentOS</span>
      </div>
      <span className="h-4 w-px bg-line-strong" />
      <span className="flex items-center gap-1.5 text-sm2 text-ink-2" title={c.title} role="status">
        <span className={`h-1.5 w-1.5 rounded-full ${DOT[c.tone]}`} />
        {c.label}
      </span>
      {mission && (
        <span className="tag tag-neutral hidden sm:inline-flex" title={mission.mode === 'demo' ? 'Scripted agents and synthetic content. No API calls.' : `Model: ${mission.model}`}>
          {mission.mode === 'demo' ? 'Demo' : mission.model}
        </span>
      )}
      {healthError ? (
        <span className="flex items-center gap-1 text-meta text-st-error" title={healthError}>
          <Unplug size={12} /> <span className="hidden md:inline">Backend unreachable</span>
        </span>
      ) : health && !health.api_key_configured ? (
        <span className="flex items-center gap-1 text-meta text-muted" title="The backend has no ANTHROPIC_API_KEY. Live missions are disabled. Demo mode still works.">
          <KeyRound size={12} /> <span className="hidden md:inline">No API key</span>
        </span>
      ) : null}
      <button className={`btn btn-quiet h-7 gap-1 px-2 ${libraryOpen ? 'bg-hover text-ink' : ''}`} onClick={() => setLibraryOpen(!libraryOpen)}
        aria-pressed={libraryOpen} aria-label="Knowledge library" title={indexing ? 'Knowledge library: indexing documents' : 'Knowledge library'}>
        <Library size={14} />
        <span className="hidden sm:inline">Library</span>
        {docCount > 0 && <span className="tabular text-meta text-faint">{docCount}</span>}
        {indexing && <span className="status-dot status-working h-1.5 w-1.5" />}
      </button>
      <button className="btn-icon" onClick={reset} title="Reset camera" aria-label="Reset camera">
        <LocateFixed size={14} />
      </button>
    </div>
  )
}
