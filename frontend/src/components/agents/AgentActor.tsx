import { Html, useCursor } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useRef, useState } from 'react'
import * as THREE from 'three'
import { AGENT_META, STATUS_LABEL } from '../../stores/describe'
import { useRunStore } from '../../stores/runStore'
import { useUiStore } from '../../stores/uiStore'
import { runtime, useVisualStore } from '../../stores/visualStore'
import { AGENT_IDS, type AgentId } from '../../types'
import { findPath, LOCATIONS, NODES, type Location } from '../office/layout'
import { labelLayer } from '../office/labelLayer'
import { Blob } from '../office/primitives'
import { EventIcon, StatusDot } from '../ui/Icon'
import { Character } from './Character'

const WALK_SPEED = 1.7 // m/s
const PERSONAL_SPACE = 0.6 // m: a walker closer than this to another agent steps aside
const MAX_SIDESTEP = 0.45 // m
const LOOKAHEAD = 0.5 // m

/**
 * Walkers share one waypoint graph, so without this they pass through each other. A walking agent
 * that gets close to another eases sideways (away from the other agent, right-hand traffic when both
 * walk) and back. Only the rendered position moves; the path, timing and queue are untouched.
 * Seated or standing agents never move.
 */
function avoid(id: AgentId, dt: number) {
  const rt = runtime[id]
  let tx = 0
  let tz = 0
  if (rt.anim === 'walk') {
    const rx = Math.cos(rt.rotY)
    const rz = -Math.sin(rt.rotY) // right-hand side of the heading
    for (const other of AGENT_IDS) {
      if (other === id) continue
      const o = runtime[other]
      const dx = rt.x - (o.x + o.ox)
      const dz = rt.z - (o.z + o.oz)
      // look ~half a metre ahead so the sidestep starts before contact, not during it
      const fx = Math.sin(rt.rotY) * LOOKAHEAD
      const fz = Math.cos(rt.rotY) * LOOKAHEAD
      const d = Math.min(Math.hypot(dx, dz), Math.hypot(dx + fx, dz + fz))
      if (d >= PERSONAL_SPACE) continue
      const push = (PERSONAL_SPACE - d) / PERSONAL_SPACE
      const side = d < 1e-3 || o.anim === 'walk' ? 1 : Math.sign(dx * rx + dz * rz) || 1
      tx += rx * side * push * MAX_SIDESTEP
      tz += rz * side * push * MAX_SIDESTEP
    }
    const len = Math.hypot(tx, tz)
    if (len > MAX_SIDESTEP) { tx *= MAX_SIDESTEP / len; tz *= MAX_SIDESTEP / len }
  }
  rt.ox = THREE.MathUtils.damp(rt.ox, tx, 10, dt)
  rt.oz = THREE.MathUtils.damp(rt.oz, tz, 10, dt)
}
const LABEL_STYLE = { pointerEvents: 'none' } as const

function angleDamp(cur: number, target: number, lambda: number, dt: number) {
  let d = target - cur
  d = Math.atan2(Math.sin(d), Math.cos(d))
  return cur + d * (1 - Math.exp(-lambda * dt))
}

/** Advances an agent's visual queue: walks waypoint paths and holds poses. */
function step(id: AgentId, dt: number) {
  const rt = runtime[id]
  if (!rt.current) {
    const next = rt.queue.shift()
    if (next) {
      rt.current = { ...next, elapsed: 0 }
      if (next.kind === 'move') {
        // After an interrupted walk, start from whichever end of the current edge gives the shorter route.
        const target = LOCATIONS[next.to].node
        const routes = [rt.node, rt.via].filter((n): n is string => !!n).map((from) => {
          const ids = findPath(from, target)
          let len = Math.hypot(NODES[ids[0]].x - rt.x, NODES[ids[0]].z - rt.z)
          for (let i = 1; i < ids.length; i++) len += Math.hypot(NODES[ids[i]].x - NODES[ids[i - 1]].x, NODES[ids[i]].z - NODES[ids[i - 1]].z)
          return { ids, len }
        })
        const best = routes.reduce((a, b) => (b.len < a.len ? b : a))
        rt.via = null
        rt.current.path = best.ids.map((n) => ({ id: n, ...NODES[n] }))
        rt.seated = false
      } else next.onStart?.()
    }
  }
  const c = rt.current
  if (!c) return
  c.elapsed += dt
  if (c.kind === 'move') {
    rt.anim = 'walk'
    const speedup = 1 + Math.min(1.5, Math.max(0, rt.queue.length - 2) * 0.35)
    let budget = (c.speed ?? WALK_SPEED) * speedup * dt
    const path = c.path!
    while (budget > 0 && path.length) {
      const p = path[0]
      const dx = p.x - rt.x
      const dz = p.z - rt.z
      const d = Math.hypot(dx, dz)
      if (d > 0.001) rt.rotY = angleDamp(rt.rotY, Math.atan2(dx, dz), 10, dt)
      if (d <= budget) {
        rt.x = p.x
        rt.z = p.z
        rt.node = p.id
        budget -= d
        path.shift()
      } else {
        rt.x += (dx / d) * budget
        rt.z += (dz / d) * budget
        budget = 0
      }
    }
    if (!path.length) {
      const loc = LOCATIONS[c.to]
      rt.node = loc.node
      rt.location = c.to
      rt.current = null
    }
    return
  }
  // pose
  const loc: Location = LOCATIONS[rt.location]
  rt.anim = c.anim
  rt.seated = !!loc.seated
  rt.rotY = angleDamp(rt.rotY, loc.face, 6, dt)
  if (c.elapsed >= c.duration && (rt.queue.length > 0 || !c.hold)) {
    if (rt.queue.length > 0) rt.current = null
    else rt.current = { kind: 'pose', anim: 'idle', duration: 0, hold: true, elapsed: 0 }
  }
}

export function AgentActor({ id }: { id: AgentId }) {
  const group = useRef<THREE.Group>(null)
  const ring = useRef<THREE.Mesh>(null)
  const [hover, setHover] = useState(false)
  useCursor(hover)
  const selected = useUiStore((s) => s.selectedAgent === id)
  const select = useUiStore((s) => s.select)
  const status = useRunStore((s) => s.agents[id].status)
  const bubble = useVisualStore((s) => s.bubbles[id])
  const popups = useVisualStore((s) => s.popups)
  const meta = AGENT_META[id]

  useFrame(({ clock }, dt) => {
    const d = Math.min(dt, 0.05)
    step(id, d)
    avoid(id, d)
    const rt = runtime[id]
    const g = group.current
    if (g) {
      // raise onto higher seats (the sofa) only while seated there; eases up and down
      const lift = rt.seated ? (LOCATIONS[rt.location] as Location).lift ?? 0 : 0
      g.position.set(rt.x + rt.ox, THREE.MathUtils.damp(g.position.y, lift, 6, d), rt.z + rt.oz)
      g.rotation.y = rt.rotY
    }
    if (ring.current) {
      ring.current.visible = selected || hover
      ring.current.rotation.z = clock.elapsedTime * 0.8
      const s = 1 + Math.sin(clock.elapsedTime * 3) * 0.04
      ring.current.scale.set(s, s, s)
    }
  })

  const mine = popups.filter((p) => p.agent === id)
  return (
    <group ref={group}>
      <Blob w={0.85} d={0.85} />
      <mesh ref={ring} rotation-x={-Math.PI / 2} position={[0, 0.02, 0]}>
        <ringGeometry args={[0.42, 0.5, 40, 1, 0, Math.PI * 1.8]} />
        <meshBasicMaterial color={meta.accent} toneMapped={false} transparent opacity={0.9} />
      </mesh>
      <group
        onClick={(e) => { e.stopPropagation(); select(id) }}
        onPointerOver={(e) => { e.stopPropagation(); setHover(true) }}
        onPointerOut={() => setHover(false)}
      >
        <Character id={id} />
        {/* generous invisible hit area */}
        <mesh position={[0, 0.85, 0]} visible={false}>
          <cylinderGeometry args={[0.4, 0.4, 1.8, 8]} />
        </mesh>
      </group>
      <Html position={[0, 2.0, 0]} center zIndexRange={[20, 0]} portal={labelLayer as React.RefObject<HTMLElement>} style={LABEL_STYLE}>
        <div className="flex flex-col items-center gap-1 select-none" style={{ transform: 'translateY(-50%)' }}>
          {bubble && (
            <div className={`bubble bubble-${bubble.tone}`}>
              <EventIcon name={bubble.icon} size={12} />
              <span>{bubble.text}</span>
            </div>
          )}
          <div className={`nametag ${selected ? 'nametag-selected' : ''}`} style={{ ['--accent' as string]: meta.color }}>
            <StatusDot status={status} className="h-1.5 w-1.5" />
            {meta.name}
            {(hover || selected) && <span className="nametag-detail">{status === 'idle' ? meta.role : STATUS_LABEL[status]}</span>}
          </div>
        </div>
        <div className="popups">
          {mine.map((p) => <div key={p.id} className={`popup popup-${p.tone}`}>{p.text}</div>)}
        </div>
      </Html>
    </group>
  )
}
