import { AdaptiveDpr, CameraControls } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Suspense, useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useUiStore } from '../../stores/uiStore'
import { runtime } from '../../stores/visualStore'
import { tickWander } from '../../stores/wander'
import { AGENT_IDS } from '../../types'
import { AgentActor } from '../agents/AgentActor'
import { Confetti, FlyingCards, ReportDocument } from './Effects'
import { PerfProbe } from './PerfProbe'
import { Bookshelf, CoffeeStation, Desks, Lounge, MeetingArea, Plants, WallDecor } from './Furniture'
import { Room } from './Room'
import { TaskBoard } from './TaskBoard'

/** Drives idle wandering between missions on the scene clock (pauses with the tab, like the agents). */
function IdleWander() {
  useFrame((_, dt) => tickWander(Math.min(dt, 0.05)))
  return null
}

const PERF = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('perf')

const HOME_POS: [number, number, number] = [13.5, 12.5, 14.5]
const HOME_TARGET: [number, number, number] = [0, 0.4, -0.2]

/** Pull the camera back on narrow/portrait screens so the whole office stays in view. */
const fitScale = (aspect: number) => (aspect >= 1.45 ? 1 : Math.min(3, 1.45 / aspect))

function CameraRig() {
  const ref = useRef<CameraControls>(null)
  const nonce = useUiStore((s) => s.focusNonce)
  const selected = useUiStore((s) => s.selectedAgent)
  const aspect = useThree((s) => s.size.width / Math.max(1, s.size.height))
  const followed = useRef(new THREE.Vector3())
  useEffect(() => {
    const c = ref.current
    if (!c) return
    if (!selected) {
      const k = fitScale(aspect)
      const p = new THREE.Vector3(...HOME_POS).sub(new THREE.Vector3(...HOME_TARGET)).multiplyScalar(k).add(new THREE.Vector3(...HOME_TARGET))
      void c.setLookAt(p.x, p.y, p.z, ...HOME_TARGET, true)
      return
    }
    const rt = runtime[selected]
    const target = new THREE.Vector3(rt.x, 1.0, rt.z)
    followed.current.copy(target)
    const dir = new THREE.Vector3(0.62, 0.62, 0.68).normalize().multiplyScalar(12.5 * Math.min(1.6, fitScale(aspect)))
    void c.setLookAt(target.x + dir.x, target.y + dir.y, target.z + dir.z, target.x, target.y, target.z, true)
  }, [nonce, selected, aspect])
  // keep a selected agent in frame while they walk around the office
  useFrame(() => {
    const c = ref.current
    if (!c || !selected) return
    const rt = runtime[selected]
    if (Math.hypot(rt.x - followed.current.x, rt.z - followed.current.z) > 0.6) {
      followed.current.set(rt.x, 1.0, rt.z)
      void c.moveTo(rt.x, 1.0, rt.z, true)
    }
  })
  return (
    <CameraControls
      ref={ref}
      makeDefault
      minDistance={5}
      maxDistance={45}
      minPolarAngle={0.35}
      maxPolarAngle={1.2}
      minAzimuthAngle={-0.15}
      maxAzimuthAngle={Math.PI / 2 + 0.15}
      smoothTime={0.6}
      draggingSmoothTime={0.15}
    />
  )
}

export function OfficeScene() {
  const select = useUiStore((s) => s.select)
  return (
    <Canvas
      className="office-canvas"
      camera={{ position: HOME_POS, fov: 30, near: 0.1, far: 120 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      onPointerMissed={() => select(null)}
    >
      <AdaptiveDpr pixelated={false} />
      <hemisphereLight args={['#fff1dc', '#8a6446', 1.25]} />
      <ambientLight intensity={0.25} color="#ffe7c7" />
      <directionalLight position={[7, 12, 6]} intensity={1.7} color="#ffe2b8" />
      <directionalLight position={[-6, 6, 9]} intensity={0.35} color="#cfe0ff" />
      <pointLight position={[2.5, 2.4, -4.6]} intensity={3} distance={6} color="#ffe4b5" decay={2} />
      <pointLight position={[-7, 2.4, 4.1]} intensity={2.5} distance={6} color="#ffe4b5" decay={2} />
      <CameraRig />
      <IdleWander />
      {PERF && <PerfProbe />}
      <Suspense fallback={null}>
        <Room />
        <Desks />
        <Bookshelf />
        <MeetingArea />
        <Lounge />
        <CoffeeStation />
        <WallDecor />
        <Plants />
        <TaskBoard />
        <ReportDocument />
        {AGENT_IDS.map((id) => <AgentActor key={id} id={id} />)}
        <FlyingCards />
        <Confetti />
      </Suspense>
    </Canvas>
  )
}
