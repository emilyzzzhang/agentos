import { useCursor } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useRunStore } from '../../stores/runStore'
import { useUiStore } from '../../stores/uiStore'
import { runtime, useVisualStore } from '../../stores/visualStore'
import { FURNITURE } from './layout'
import { M } from './materials'

/** The final report appears on the meeting table once report.generated arrives. */
export function ReportDocument() {
  const visible = useVisualStore((s) => s.reportVisible)
  const hasReport = useRunStore((s) => !!s.report)
  const openReport = useUiStore((s) => s.setReportOpen)
  const group = useRef<THREE.Group>(null)
  const glow = useRef<THREE.Mesh>(null)
  const [hover, setHover] = useState(false)
  useCursor(hover && visible)
  const appear = useRef(0)
  useFrame(({ clock }, dt) => {
    appear.current = THREE.MathUtils.damp(appear.current, visible ? 1 : 0, 4, dt)
    const g = group.current
    if (!g) return
    g.visible = appear.current > 0.01
    g.scale.setScalar(appear.current * (hover ? 1.12 : 1))
    g.position.y = 0.84 + Math.sin(clock.elapsedTime * 2) * 0.03 + (1 - appear.current) * 0.6
    g.rotation.y = clock.elapsedTime * 0.4
    if (glow.current) (glow.current.material as THREE.MeshBasicMaterial).opacity = 0.25 + Math.sin(clock.elapsedTime * 3) * 0.1
  })
  const { x, z } = FURNITURE.meetingTable
  return (
    <group
      ref={group}
      position={[x, 0.84, z]}
      onClick={(e) => { e.stopPropagation(); if (hasReport) openReport(true) }}
      onPointerOver={(e) => { e.stopPropagation(); setHover(true) }}
      onPointerOut={() => setHover(false)}
    >
      <mesh ref={glow} rotation-x={-Math.PI / 2} position={[0, 0.005, 0]}>
        <circleGeometry args={[0.55, 32]} />
        <meshBasicMaterial color="#ffd27a" transparent opacity={0.3} toneMapped={false} depthWrite={false} />
      </mesh>
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[0, 0.02 + i * 0.018, 0]} rotation-y={i * 0.08} material={i === 2 ? M.paper : M.paperWarm}>
          <boxGeometry args={[0.48, 0.012, 0.64]} />
        </mesh>
      ))}
      <mesh position={[0, 0.072, -0.22]}><boxGeometry args={[0.36, 0.004, 0.06]} /><meshStandardMaterial color="#e07a4f" /></mesh>
      {[0, 1, 2, 3, 4].map((i) => (
        <mesh key={i} position={[-0.02 * (i % 2), 0.072, -0.1 + i * 0.07]}><boxGeometry args={[0.34 - (i % 3) * 0.06, 0.004, 0.025]} /><meshStandardMaterial color="#b9a990" /></mesh>
      ))}
      <mesh position={[0.17, 0.08, 0.24]}><cylinderGeometry args={[0.06, 0.06, 0.01, 20]} /><meshStandardMaterial color="#d6453a" /></mesh>
    </group>
  )
}

/** Confetti burst over the meeting table when the mission completes. */
export function Confetti() {
  const celebrating = useVisualStore((s) => s.celebrating)
  const ref = useRef<THREE.InstancedMesh>(null)
  const N = 90
  const parts = useMemo(() => Array.from({ length: N }, () => ({
    p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), w: new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6),
  })), [])
  const start = useRef(-1)
  useLayoutEffect(() => {
    const m = ref.current
    if (!m) return
    const c = new THREE.Color()
    const pal = ['#e07a4f', '#f2c14e', '#5fa36b', '#5b8fd1', '#c06aa8', '#fff3dc']
    for (let i = 0; i < N; i++) m.setColorAt(i, c.set(pal[i % pal.length]))
    if (m.instanceColor) m.instanceColor.needsUpdate = true
  }, [])
  const dummy = useMemo(() => new THREE.Object3D(), [])
  useFrame(({ clock }, dt) => {
    const m = ref.current
    if (!m) return
    if (celebrating && start.current < 0) {
      start.current = clock.elapsedTime
      const { x, z } = FURNITURE.meetingTable
      parts.forEach((pt) => {
        pt.p.set(x + (Math.random() - 0.5) * 0.6, 1.2, z + (Math.random() - 0.5) * 0.6)
        pt.v.set((Math.random() - 0.5) * 3.5, 3 + Math.random() * 2.5, (Math.random() - 0.5) * 3.5)
      })
    }
    if (!celebrating) start.current = -1
    const age = start.current < 0 ? 99 : clock.elapsedTime - start.current
    m.visible = age < 4.5
    if (!m.visible) return
    parts.forEach((pt, i) => {
      pt.v.y -= 6 * dt
      pt.v.multiplyScalar(0.985)
      pt.p.addScaledVector(pt.v, dt)
      if (pt.p.y < 0.03) { pt.p.y = 0.03; pt.v.set(0, 0, 0) }
      pt.r.set(pt.r.x + pt.w.x * dt, pt.r.y + pt.w.y * dt, pt.r.z + pt.w.z * dt)
      dummy.position.copy(pt.p)
      dummy.rotation.copy(pt.r)
      dummy.updateMatrix()
      m.setMatrixAt(i, dummy.matrix)
    })
    m.instanceMatrix.needsUpdate = true
  })
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, N]} frustumCulled={false}>
      <planeGeometry args={[0.07, 0.11]} />
      <meshBasicMaterial side={THREE.DoubleSide} toneMapped={false} />
    </instancedMesh>
  )
}

const CARD_COLORS = { task: '#ffe28a', findings: '#a9d6ff', review: '#f5aaa2' }

/** Paper cards flying between agents during real hand-offs (task.assigned / review.requested). */
export function FlyingCards() {
  const cards = useVisualStore((s) => s.cards)
  return <>{cards.map((c) => <Card key={c.id} {...c} />)}</>
}

function Card({ from, to, kind, born }: { from: keyof typeof runtime; to: keyof typeof runtime; kind: keyof typeof CARD_COLORS; born: number }) {
  const ref = useRef<THREE.Group>(null)
  const a = useMemo(() => new THREE.Vector3(), [])
  const b = useMemo(() => new THREE.Vector3(), [])
  useFrame(() => {
    const g = ref.current
    if (!g) return
    const t = Math.min(1, (performance.now() - born) / 1100)
    const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
    a.set(runtime[from].x, 1.15, runtime[from].z)
    b.set(runtime[to].x, 1.0, runtime[to].z)
    g.position.lerpVectors(a, b, e)
    g.position.y += Math.sin(Math.PI * e) * 0.9
    g.rotation.set(-0.4 + e * 0.4, e * Math.PI * 2, 0.2)
    g.scale.setScalar(t > 0.92 ? Math.max(0.01, (1 - t) / 0.08) : 1)
  })
  return (
    <group ref={ref}>
      <mesh><boxGeometry args={[0.26, 0.01, 0.34]} /><meshStandardMaterial color={CARD_COLORS[kind]} emissive={CARD_COLORS[kind]} emissiveIntensity={0.35} /></mesh>
      <mesh position={[0, 0.007, -0.08]}><boxGeometry args={[0.18, 0.003, 0.03]} /><meshStandardMaterial color="#8a6a50" /></mesh>
      <mesh position={[0, 0.007, 0]}><boxGeometry args={[0.15, 0.003, 0.025]} /><meshStandardMaterial color="#8a6a50" /></mesh>
    </group>
  )
}
