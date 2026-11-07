import { create } from 'zustand'
import type { AgentId } from '../types'
import type { IconKey } from './describe'
import { AGENT_IDS } from '../types'
import { LOCATIONS, NODES, START_SPOT, type LocationId } from '../components/office/layout'

export type Anim = 'idle' | 'walk' | 'typing' | 'reading' | 'thinking' | 'talking' | 'celebrate' | 'done' | 'error'

export type VisualAction =
  | { kind: 'move'; to: LocationId; /** m/s; defaults to the working pace */ speed?: number }
  | {
      kind: 'pose'
      anim: Anim
      /** minimum seconds on screen before the next queued action may start */
      duration: number
      /** keep holding after duration if nothing else is queued (otherwise relax to idle) */
      hold?: boolean
      onStart?: () => void
    }

/** Per-agent animation state, read and written every frame (kept out of React state). */
export interface AgentRuntime {
  x: number
  z: number
  rotY: number
  node: string
  location: LocationId
  plannedLocation: LocationId
  queue: VisualAction[]
  current: (VisualAction & { elapsed: number; path?: { id: string; x: number; z: number }[] }) | null
  /** Next waypoint of a walk that was interrupted; the next walk may start from it instead of turning back. */
  via: string | null
  anim: Anim
  seated: boolean
  /** Visual sidestep while passing another agent (added to x/z when rendering; never changes the path). */
  ox: number
  oz: number
}

const makeRuntime = (id: AgentId, loc: LocationId = START_SPOT[id]): AgentRuntime => {
  const n = NODES[LOCATIONS[loc].node]
  return {
    x: n.x, z: n.z, rotY: LOCATIONS[loc].face, node: LOCATIONS[loc].node, location: loc, plannedLocation: loc,
    queue: [], current: null, via: null, anim: 'idle', seated: !!(LOCATIONS[loc] as { seated?: boolean }).seated, ox: 0, oz: 0,
  }
}

export const runtime: Record<AgentId, AgentRuntime> = {
  alex: makeRuntime('alex'),
  milo: makeRuntime('milo'),
  luna: makeRuntime('luna'),
}

const BACKLOG = 3

/**
 * Drop visual filler when an agent falls behind the backend: poses without side effects
 * that are followed by other actions, and consecutive moves (only the last destination is
 * walked, starting from wherever the agent is).
 * Poses with onStart (hand-off cards, the report reveal) are always kept.
 */
function compact(rt: AgentRuntime) {
  if (rt.queue.length < BACKLOG) return
  const q = rt.queue.filter((a, i) => !(a.kind === 'pose' && !a.onStart && i < rt.queue.length - 1))
  const out: VisualAction[] = []
  for (const a of q) {
    const prev = out[out.length - 1]
    if (a.kind === 'move' && prev?.kind === 'move') out[out.length - 1] = a
    else out.push(a)
  }
  rt.queue = out
}

/** Clears an agent's queue and current action, including a walk in progress. The next walk starts where the agent is. */
export function interrupt(id: AgentId) {
  const rt = runtime[id]
  if (rt.current?.kind === 'move') rt.via = rt.current.path?.[0]?.id ?? null
  rt.current = null
  rt.queue = []
  rt.plannedLocation = rt.location
}

/** Queue visual actions for an agent. Lagging queues are compacted. */
export function enqueue(id: AgentId, ...actions: VisualAction[]) {
  const rt = runtime[id]
  for (const a of actions) {
    if (a.kind === 'move') {
      if (a.to === rt.plannedLocation) continue
      rt.plannedLocation = a.to
    }
    rt.queue.push(a)
  }
  compact(rt)
}

/** Snap everyone into place (used only after replaying history on page load, never for live movement). */
export function settleAll(anims: Partial<Record<AgentId, Anim>>, places: Record<AgentId, LocationId>) {
  for (const id of AGENT_IDS) {
    const fresh = makeRuntime(id, places[id])
    Object.assign(runtime[id], fresh)
    const anim = anims[id] ?? 'idle'
    runtime[id].current = { kind: 'pose', anim, duration: 0, hold: true, elapsed: 0 }
  }
}

export interface Bubble {
  text: string
  icon: IconKey
  tone: 'work' | 'tool' | 'talk' | 'success' | 'error' | 'think'
  until: number
}

export interface Popup {
  id: number
  agent: AgentId
  text: string
  tone: 'success' | 'error' | 'info'
  born: number
}

export interface FlyingCard {
  id: number
  from: AgentId
  to: AgentId
  kind: 'task' | 'review' | 'findings'
  born: number
}

interface VisualStore {
  bubbles: Partial<Record<AgentId, Bubble>>
  popups: Popup[]
  cards: FlyingCard[]
  activeTools: Record<AgentId, number>
  errors: Partial<Record<AgentId, string>>
  reportVisible: boolean
  celebrating: boolean
  setBubble: (id: AgentId, b: Omit<Bubble, 'until'>, ttl?: number) => void
  clearBubble: (id: AgentId) => void
  popup: (agent: AgentId, text: string, tone: Popup['tone']) => void
  card: (from: AgentId, to: AgentId, kind: FlyingCard['kind']) => void
  prune: () => void
  set: (p: Partial<Pick<VisualStore, 'activeTools' | 'errors' | 'reportVisible' | 'celebrating'>>) => void
  reset: () => void
}

let uid = 1
export const useVisualStore = create<VisualStore>((set, get) => ({
  bubbles: {},
  popups: [],
  cards: [],
  activeTools: { alex: 0, milo: 0, luna: 0 },
  errors: {},
  reportVisible: false,
  celebrating: false,
  setBubble: (id, b, ttl = 6000) => set((s) => ({ bubbles: { ...s.bubbles, [id]: { ...b, until: performance.now() + ttl } } })),
  clearBubble: (id) => set((s) => ({ bubbles: { ...s.bubbles, [id]: undefined } })),
  popup: (agent, text, tone) => set((s) => ({ popups: [...s.popups.slice(-8), { id: uid++, agent, text, tone, born: performance.now() }] })),
  card: (from, to, kind) => set((s) => ({ cards: [...s.cards, { id: uid++, from, to, kind, born: performance.now() }] })),
  prune: () => {
    const now = performance.now()
    const s = get()
    const bubbles = Object.fromEntries(Object.entries(s.bubbles).filter(([, b]) => b && b.until > now))
    const popups = s.popups.filter((p) => now - p.born < 2600)
    const cards = s.cards.filter((c) => now - c.born < 1600)
    if (Object.keys(bubbles).length !== Object.keys(s.bubbles).filter((k) => s.bubbles[k as AgentId]).length || popups.length !== s.popups.length || cards.length !== s.cards.length)
      set({ bubbles, popups, cards })
  },
  set: (p) => set(p),
  reset: () => set({ bubbles: {}, popups: [], cards: [], activeTools: { alex: 0, milo: 0, luna: 0 }, errors: {}, reportVisible: false, celebrating: false }),
}))
