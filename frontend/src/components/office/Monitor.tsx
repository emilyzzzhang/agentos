import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useRunStore } from '../../stores/runStore'
import { useVisualStore } from '../../stores/visualStore'
import type { AgentId } from '../../types'
import { M } from './materials'
import { Box, RBox } from './primitives'

type V3 = [number, number, number]
const COLORS = {
  idle: new THREE.Color('#25344a'),
  work: new THREE.Color('#fdf6e8'),
  search: new THREE.Color('#e8f3ff'),
  error: new THREE.Color('#ffe1dc'),
}

/** Monitor whose screen shows the owning agent's status. */
export function Monitor({ agent, position, rotation, w = 0.62, h = 0.4, accent = '#e07a4f' }: { agent: AgentId; position: V3; rotation?: V3; w?: number; h?: number; accent?: string }) {
  const screenMat = useMemo(() => new THREE.MeshBasicMaterial({ color: COLORS.idle, toneMapped: false }), [])
  const lineMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#8a7f73', toneMapped: false }), [])
  const accentMat = useMemo(() => new THREE.MeshBasicMaterial({ color: accent, toneMapped: false }), [accent])
  const lines = useRef<THREE.Mesh[]>([])
  const bar = useRef<THREE.Mesh>(null)
  const header = useRef<THREE.Mesh>(null)
  const seed = useMemo(() => Math.random() * 10, [])

  useFrame(({ clock }) => {
    const t = clock.elapsedTime + seed
    const status = useRunStore.getState().agents[agent].status
    const tools = useVisualStore.getState().activeTools[agent]
    const mode = tools > 0 ? 'search' : status === 'working' ? 'work' : status === 'error' ? 'error' : 'idle'
    screenMat.color.lerp(COLORS[mode], 0.12)
    const active = mode !== 'idle'
    lines.current.forEach((m, i) => {
      if (!m) return
      m.visible = active
      if (!active) return
      let width: number
      if (mode === 'search') width = 0.35 + 0.55 * (0.5 + 0.5 * Math.sin(t * 2.2 + i * 1.7))
      else {
        // text being typed line by line
        const cycle = (t * 0.9) % (lines.current.length + 2)
        width = i < Math.floor(cycle) ? 0.6 + 0.35 * Math.abs(Math.sin(i * 3.1)) : i === Math.floor(cycle) ? (cycle % 1) * 0.9 : 0
      }
      m.scale.x = Math.max(0.001, width)
      m.position.x = -w * 0.42 + (w * 0.84 * m.scale.x) / 2
    })
    if (bar.current) {
      bar.current.visible = mode === 'search'
      bar.current.position.x = -w * 0.4 + ((t * 0.5) % 1) * w * 0.8
    }
    if (header.current) header.current.visible = active
  })

  return (
    <group position={position} rotation={rotation}>
      <RBox size={[w + 0.06, h + 0.06, 0.04]} material={M.plasticDark} radius={0.015} />
      <mesh position={[0, 0, 0.021]} material={screenMat}>
        <planeGeometry args={[w, h]} />
      </mesh>
      <mesh ref={header} position={[0, h * 0.38, 0.022]} material={accentMat}>
        <planeGeometry args={[w, h * 0.1]} />
      </mesh>
      {Array.from({ length: 5 }).map((_, i) => (
        <mesh key={i} ref={(m) => { if (m) lines.current[i] = m }} position={[0, h * 0.2 - i * h * 0.13, 0.023]} material={lineMat}>
          <planeGeometry args={[w * 0.84, h * 0.045]} />
        </mesh>
      ))}
      <mesh ref={bar} position={[0, -h * 0.4, 0.024]} material={accentMat}>
        <planeGeometry args={[w * 0.18, h * 0.05]} />
      </mesh>
      <Box size={[0.05, 0.22, 0.04]} position={[0, -h / 2 - 0.1, -0.04]} material={M.metalDark} />
      <RBox size={[0.24, 0.025, 0.16]} position={[0, -h / 2 - 0.21, -0.03]} material={M.metalDark} radius={0.01} />
    </group>
  )
}
