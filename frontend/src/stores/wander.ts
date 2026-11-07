/**
 * Idle wandering between missions. A free agent stays at a spot for STAY seconds, then walks to
 * another free spot. Only one agent walks at a time, departures are spaced by GAP, and no walk
 * starts while the report or a passage is open. useVisualDirector stops this on run.started.
 */
import { findPath, LOCATIONS, NODES, START_SPOT, type LocationId } from '../components/office/layout'
import { AGENT_IDS, type AgentId } from '../types'
import { useUiStore } from './uiStore'
import { enqueue, runtime, type Anim } from './visualStore'

interface Spot { loc: LocationId; anims: Anim[] }

/** Where idle agents go and what they do there. Sofa seats count as separate spots. */
export const WANDER_SPOTS: Spot[] = [
  { loc: 'sofa_alex', anims: ['idle', 'reading'] },
  { loc: 'sofa_milo', anims: ['idle', 'reading'] },
  { loc: 'sofa_luna', anims: ['idle', 'reading'] },
  { loc: 'shelf', anims: ['reading'] },
  { loc: 'coffee_spot', anims: ['idle'] },
  { loc: 'window_back', anims: ['idle'] },
  { loc: 'board', anims: ['thinking'] },
  { loc: 'lounge_table', anims: ['idle'] },
]

const FAST = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('wander') === 'fast'
const STAY: [number, number] = FAST ? [3, 5] : [30, 60] // seconds at a spot
const FIRST: [number, number] = FAST ? [1, 3] : [12, 30] // first stroll after load
const GAP = FAST ? 1 : 8 // seconds between any two departures
const RETURN_GAP = 2.5 // seconds between agents leaving the table after a mission
export const STROLL_SPEED = 1.1 // m/s (the working pace is 1.7)

const rand = ([a, b]: [number, number]) => a + Math.random() * (b - a)

interface State {
  clock: number
  enabled: Record<AgentId, boolean>
  /** Spot the agent is at or walking to; null when not at a wander spot (desk, meeting table). */
  spot: Record<AgentId, LocationId | null>
  lastLeft: Record<AgentId, LocationId | null>
  nextAt: Record<AgentId, number>
  lastDeparture: number
}

const per = <T,>(f: (id: AgentId) => T) => Object.fromEntries(AGENT_IDS.map((id) => [id, f(id)])) as Record<AgentId, T>

const s: State = {
  clock: 0,
  enabled: per(() => true),
  spot: per((id) => START_SPOT[id]),
  lastLeft: per(() => null),
  nextAt: per(() => rand(FIRST)),
  lastDeparture: -Infinity,
}

const pathLength = (from: string, to: string) => {
  const ids = findPath(from, to)
  let len = 0
  for (let i = 1; i < ids.length; i++) len += Math.hypot(NODES[ids[i]].x - NODES[ids[i - 1]].x, NODES[ids[i]].z - NODES[ids[i - 1]].z)
  return len
}

const walking = (id: AgentId) => runtime[id].current?.kind === 'move' || runtime[id].queue.some((a) => a.kind === 'move')
const busy = (id: AgentId) => runtime[id].queue.length > 0 || (!!runtime[id].current && !(runtime[id].current?.kind === 'pose' && runtime[id].current?.hold))

/** Mission started: nobody wanders until the mission is over. */
export function stopWandering() {
  for (const id of AGENT_IDS) {
    s.enabled[id] = false
    s.spot[id] = null
    s.lastLeft[id] = null
  }
}

/** Hand an agent back to the wanderer, e.g. after the celebration. It leaves for a free spot soon. */
export function releaseToWander(id: AgentId) {
  s.enabled[id] = true
  s.spot[id] = null
  s.nextAt[id] = s.clock
}

/** After a page reload: agents placed at `places` (wander spots) wander from there; others stay put. */
export function resetWandering(places: Partial<Record<AgentId, LocationId>>) {
  for (const id of AGENT_IDS) {
    const loc = places[id] ?? null
    s.enabled[id] = loc !== null
    s.spot[id] = loc
    s.lastLeft[id] = null
    s.nextAt[id] = s.clock + rand(FIRST)
  }
}

function go(id: AgentId) {
  const taken = new Set(AGENT_IDS.filter((o) => o !== id).map((o) => s.spot[o]))
  const options = WANDER_SPOTS.filter((sp) => !taken.has(sp.loc) && sp.loc !== s.spot[id] && sp.loc !== s.lastLeft[id])
  if (!options.length) return false
  const pick = options[Math.floor(Math.random() * options.length)]
  const anim = pick.anims[Math.floor(Math.random() * pick.anims.length)]
  enqueue(id,
    { kind: 'move', to: pick.loc, speed: STROLL_SPEED },
    { kind: 'pose', anim, duration: 1, hold: true })
  const walk = pathLength(runtime[id].node, LOCATIONS[pick.loc].node) / STROLL_SPEED
  s.lastLeft[id] = s.spot[id]
  s.spot[id] = pick.loc
  s.lastDeparture = s.clock
  s.nextAt[id] = s.clock + walk + rand(STAY)
  return true
}

/** Advance the wanderer; called every frame from the scene with the frame's (clamped) delta. */
export function tickWander(dt: number) {
  s.clock += dt
  const ui = useUiStore.getState()
  const reading = ui.reportOpen || ui.evidence !== null
  // whoever has been due longest goes first, so no agent is starved by the one-walker rule
  const due = AGENT_IDS.filter((id) => s.enabled[id] && !busy(id) && s.clock >= s.nextAt[id]).sort((a, b) => s.nextAt[a] - s.nextAt[b])
  for (const id of due) {
    const returning = s.spot[id] === null // still at the meeting table after a mission
    if (returning) {
      // leave the table one by one, a few seconds apart; this happens even while reading
      if (s.clock - s.lastDeparture < RETURN_GAP) continue
    } else {
      if (reading) continue
      if (s.clock - s.lastDeparture < GAP) continue
      if (AGENT_IDS.some((o) => o !== id && walking(o))) continue
    }
    go(id)
  }
}

/** Test/debug view of the wanderer (exposed with ?perf=1). */
export const wanderState = () => ({ clock: s.clock, spot: { ...s.spot }, enabled: { ...s.enabled } })
