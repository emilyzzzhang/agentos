import type { AgentId } from '../../types'

/**
 * Office floor plan (meters). Floor spans x∈[-8,8], z∈[-6,6]; back walls at z=-6 and x=-8.
 * Characters move only along the waypoint graph below.
 */
export const ROOM = { minX: -8, maxX: 8, minZ: -6, maxZ: 6, wallH: 3.3 }

export const FURNITURE = {
  alexDesk: { x: -6.85, z: -2.4, rot: Math.PI / 2 },
  miloDesk: { x: 0.4, z: -5.25, rot: 0 },
  lunaDesk: { x: 4.6, z: -5.25, rot: 0 },
  meetingTable: { x: 2.6, z: 1.6 },
  taskBoard: { x: -7.88, z: 1.4 },
  bookshelf: { x: -3.6, z: -5.72 },
  coffee: { x: 7.1, z: -5.5 },
  lounge: { x: -5.4, z: 4.2 },
}

type Pt = { x: number; z: number }

export const NODES: Record<string, Pt> = {
  alex_seat: { x: -6.12, z: -2.4 },
  milo_seat: { x: 0.4, z: -4.48 },
  luna_seat: { x: 4.6, z: -4.48 },
  alex_visit: { x: -5.2, z: -1.2 },
  milo_visit: { x: 1.55, z: -3.65 },
  // Milo is the only agent two colleagues visit (Alex with tasks, Luna with reviews); a second spot
  // on the other side of his chair keeps overlapping hand-offs from standing in the same place.
  milo_visit_b: { x: -0.75, z: -3.7 },
  luna_visit: { x: 5.75, z: -3.65 },
  board: { x: -6.7, z: 1.4 },
  shelf: { x: -3.6, z: -4.7 },
  meet_alex: { x: 1.15, z: 1.75 },
  meet_milo: { x: 2.5, z: 0.15 },
  meet_luna: { x: 4.05, z: 1.75 },
  hA: { x: -4.6, z: -2.3 },
  hB: { x: -1.2, z: -3.2 },
  hC: { x: 3.0, z: -3.0 },
  hD: { x: -4.4, z: 1.0 },
  hE: { x: 0.1, z: -0.4 },
  hF: { x: 4.6, z: -0.6 },
  // Lounge: three places on the sofa (against the left wall, facing +x), an aisle between the sofa
  // and the coffee table, and a hub that joins the office walkways.
  // far enough forward that the knees clear the cushion edge, so the lower legs hang in front of the sofa
  sofa_alex: { x: -7.2, z: 3.58 },
  sofa_milo: { x: -7.2, z: 4.2 },
  sofa_luna: { x: -7.2, z: 4.82 },
  aisle_alex: { x: -6.65, z: 3.58 },
  aisle_milo: { x: -6.65, z: 4.2 },
  aisle_luna: { x: -6.65, z: 4.82 },
  lounge_hub: { x: -6.6, z: 2.9 },
  // Idle spots (between missions): by the lounge coffee table, at the back-wall window, at the coffee counter
  lounge_table: { x: -4.75, z: 4.2 },
  window_back: { x: -1.25, z: -5.2 },
  coffee_spot: { x: 6.85, z: -4.7 },
}

const EDGES: [string, string][] = [
  ['alex_seat', 'hA'], ['alex_visit', 'hA'], ['alex_visit', 'hD'], ['hA', 'hB'], ['hA', 'hD'], ['board', 'hD'],
  ['shelf', 'hB'], ['hB', 'milo_seat'], ['hB', 'milo_visit'], ['milo_visit', 'hC'], ['milo_seat', 'milo_visit'],
  ['hC', 'luna_seat'], ['hC', 'luna_visit'], ['luna_seat', 'luna_visit'], ['hB', 'hE'], ['hD', 'hE'],
  ['hE', 'meet_alex'], ['hE', 'meet_milo'], ['hC', 'hF'], ['hC', 'hE'], ['hF', 'meet_luna'], ['hF', 'meet_milo'],
  ['luna_visit', 'hF'], ['milo_visit_b', 'hB'],
  // walkway in front of the desks, so routes to milo_visit_b do not cross Alex's spot at milo_visit
  ['hC', 'hB'],
  // lounge
  ['lounge_hub', 'hD'], ['lounge_hub', 'aisle_alex'], ['aisle_alex', 'aisle_milo'], ['aisle_milo', 'aisle_luna'],
  ['aisle_alex', 'sofa_alex'], ['aisle_milo', 'sofa_milo'], ['aisle_luna', 'sofa_luna'],
  // idle spots
  ['lounge_table', 'hD'], ['lounge_table', 'lounge_hub'], ['window_back', 'hB'], ['coffee_spot', 'luna_visit'],
]

const ADJ: Record<string, string[]> = {}
for (const [a, b] of EDGES) {
  ;(ADJ[a] ??= []).push(b)
  ;(ADJ[b] ??= []).push(a)
}
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.z - b.z)

/** Dijkstra over the waypoint graph. Returns node ids from `from` to `to` inclusive. */
export function findPath(from: string, to: string): string[] {
  if (from === to) return [to]
  const d: Record<string, number> = { [from]: 0 }
  const prev: Record<string, string> = {}
  const open = new Set([from])
  while (open.size) {
    let cur = ''
    for (const k of open) if (!cur || d[k] < d[cur]) cur = k
    open.delete(cur)
    if (cur === to) break
    for (const nb of ADJ[cur] ?? []) {
      const nd = d[cur] + dist(NODES[cur], NODES[nb])
      if (d[nb] === undefined || nd < d[nb]) {
        d[nb] = nd
        prev[nb] = cur
        open.add(nb)
      }
    }
  }
  if (d[to] === undefined) return [to]
  const path = [to]
  while (path[0] !== from) path.unshift(prev[path[0]])
  return path
}

const faceTo = (from: Pt, to: Pt) => Math.atan2(to.x - from.x, to.z - from.z)

export interface Location {
  node: string
  face: number
  seated?: boolean
  /** Seat height above an office chair (m), so the thighs rest on top of a higher seat. */
  lift?: number
  /** Sofa sitting: lean back and let the lower legs hang forward over the front edge. */
  sofa?: boolean
}

export type LocationId = keyof typeof LOCATIONS

export const LOCATIONS = {
  alex_seat: { node: 'alex_seat', face: -Math.PI / 2, seated: true },
  milo_seat: { node: 'milo_seat', face: Math.PI, seated: true },
  luna_seat: { node: 'luna_seat', face: Math.PI, seated: true },
  alex_visit: { node: 'alex_visit', face: faceTo(NODES.alex_visit, NODES.alex_seat) },
  milo_visit: { node: 'milo_visit', face: faceTo(NODES.milo_visit, NODES.milo_seat) },
  milo_visit_b: { node: 'milo_visit_b', face: faceTo(NODES.milo_visit_b, NODES.milo_seat) },
  luna_visit: { node: 'luna_visit', face: faceTo(NODES.luna_visit, NODES.luna_seat) },
  board: { node: 'board', face: -Math.PI / 2 },
  shelf: { node: 'shelf', face: Math.PI },
  meet_alex: { node: 'meet_alex', face: faceTo(NODES.meet_alex, FURNITURE.meetingTable) },
  meet_milo: { node: 'meet_milo', face: faceTo(NODES.meet_milo, FURNITURE.meetingTable) },
  meet_luna: { node: 'meet_luna', face: faceTo(NODES.meet_luna, FURNITURE.meetingTable) },
  // lift raises the seat so the thighs (hip height 0.45 when seated) sit on the cushion top (0.56)
  sofa_alex: { node: 'sofa_alex', face: Math.PI / 2, seated: true, lift: 0.2, sofa: true },
  sofa_milo: { node: 'sofa_milo', face: Math.PI / 2, seated: true, lift: 0.2, sofa: true },
  sofa_luna: { node: 'sofa_luna', face: Math.PI / 2, seated: true, lift: 0.2, sofa: true },
  lounge_table: { node: 'lounge_table', face: -Math.PI / 2 },
  window_back: { node: 'window_back', face: Math.PI },
  coffee_spot: { node: 'coffee_spot', face: faceTo(NODES.coffee_spot, FURNITURE.coffee) },
} satisfies Record<string, Location>

export const HOME: Record<AgentId, LocationId> = { alex: 'alex_seat', milo: 'milo_seat', luna: 'luna_seat' }
export const VISIT: Record<AgentId, LocationId> = { alex: 'alex_visit', milo: 'milo_visit', luna: 'luna_visit' }
/** Where each agent is on first load, before any mission (see stores/wander.ts for idle movement). */
export const START_SPOT: Record<AgentId, LocationId> = { alex: 'board', milo: 'shelf', luna: 'sofa_luna' }
export const MEET: Record<AgentId, LocationId> = { alex: 'meet_alex', milo: 'meet_milo', luna: 'meet_luna' }

/** Where `from` stands when visiting `to`. Luna uses Milo's second spot so she never shares Alex's. */
export const visitSpot = (from: AgentId, to: AgentId): LocationId => (from === 'luna' && to === 'milo' ? 'milo_visit_b' : VISIT[to])
