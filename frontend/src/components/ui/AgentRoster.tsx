import { AGENT_META, STATUS_LABEL } from '../../stores/describe'
import { useRunStore } from '../../stores/runStore'
import { useUiStore } from '../../stores/uiStore'
import { AGENT_IDS } from '../../types'
import { StatusDot } from './Icon'

export function AgentRoster() {
  const agents = useRunStore((s) => s.agents)
  const selected = useUiStore((s) => s.selectedAgent)
  const select = useUiStore((s) => s.select)
  return (
    <nav className="panel pointer-events-auto flex h-9 items-center gap-0.5 px-1" aria-label="Agents">
      {AGENT_IDS.map((id) => {
        const a = agents[id]
        const m = AGENT_META[id]
        const on = selected === id
        return (
          <button
            key={id}
            onClick={() => select(on ? null : id)}
            aria-pressed={on}
            aria-label={m.name}
            title={`${m.name} · ${m.role} · ${STATUS_LABEL[a.status]}${a.currentTask ? ` · ${a.currentTask.title}` : ''}`}
            className={`flex h-7 items-center gap-1.5 rounded-md px-2 text-sm2 transition-colors ${on ? 'bg-ink text-white' : 'text-ink hover:bg-hover'}`}
          >
            <span className="grid h-[18px] w-[18px] place-items-center rounded text-[10px] font-semibold text-white" style={{ background: m.color }}>
              {m.name[0]}
            </span>
            <span className="hidden font-medium sm:inline">{m.name}</span>
            <StatusDot status={a.status} />
          </button>
        )
      })}
    </nav>
  )
}
