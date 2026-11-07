import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { AGENT_META } from '../../stores/describe'
import type { AgentId } from '../../types'
import { FURNITURE, LOCATIONS, NODES } from './layout'
import { M } from './materials'
import { Monitor } from './Monitor'
import { Blob, Box, Cyl, RBox } from './primitives'

type V3 = [number, number, number]

const chairMats: Record<AgentId, THREE.Material> = {
  alex: new THREE.MeshStandardMaterial({ color: '#3d4b78', roughness: 0.8 }),
  milo: new THREE.MeshStandardMaterial({ color: '#4f8a5b', roughness: 0.8 }),
  luna: new THREE.MeshStandardMaterial({ color: '#b5654a', roughness: 0.8 }),
}

export function OfficeChair({ agent }: { agent: AgentId }) {
  const loc = LOCATIONS[`${agent}_seat` as const]
  const n = NODES[loc.node]
  const mat = chairMats[agent]
  return (
    <group position={[n.x, 0, n.z]} rotation-y={loc.face}>
      <Blob w={0.8} d={0.8} />
      <RBox size={[0.52, 0.09, 0.5]} position={[0, 0.4, -0.04]} material={mat} radius={0.04} />
      <RBox size={[0.5, 0.5, 0.08]} position={[0, 0.72, -0.3]} material={mat} radius={0.04} rotation={[-0.12, 0, 0]} />
      <Cyl r={0.03} h={0.32} position={[0, 0.2, -0.04]} material={M.metalDark} seg={8} />
      {[0, 1, 2, 3, 4].map((i) => (
        <Box key={i} size={[0.04, 0.03, 0.3]} position={[Math.sin((i * 2 * Math.PI) / 5) * 0.14, 0.04, -0.04 + Math.cos((i * 2 * Math.PI) / 5) * 0.14]} rotation={[0, (i * 2 * Math.PI) / 5, 0]} material={M.metalDark} />
      ))}
    </group>
  )
}

function DeskBase({ w, d, mat = M.woodLight }: { w: number; d: number; mat?: THREE.Material }) {
  return (
    <>
      <Blob w={w + 0.4} d={d + 0.4} />
      <RBox size={[w, 0.07, d]} position={[0, 0.74, 0]} material={mat} radius={0.03} />
      <RBox size={[0.06, 0.7, d - 0.1]} position={[-w / 2 + 0.08, 0.36, 0]} material={M.woodMid} radius={0.02} />
      <RBox size={[0.5, 0.62, d - 0.12]} position={[w / 2 - 0.32, 0.36, 0]} material={M.woodMid} radius={0.03} />
      <Box size={[0.4, 0.015, 0.02]} position={[w / 2 - 0.32, 0.5, d / 2 - 0.055]} material={M.trim} />
      <Box size={[0.4, 0.015, 0.02]} position={[w / 2 - 0.32, 0.25, d / 2 - 0.055]} material={M.trim} />
      <Box size={[w - 0.6, 0.35, 0.03]} position={[-0.25, 0.52, -d / 2 + 0.06]} material={M.woodMid} />
    </>
  )
}

function Keyboard({ position }: { position: V3 }) {
  return (
    <group position={position}>
      <RBox size={[0.46, 0.025, 0.15]} material={M.plasticCream} radius={0.01} />
      <RBox size={[0.07, 0.025, 0.1]} position={[0.33, 0, 0.02]} material={M.plasticCream} radius={0.012} />
    </group>
  )
}

function Mug({ position, mat = M.white }: { position: V3; mat?: THREE.Material }) {
  return (
    <group position={position}>
      <Cyl r={0.045} h={0.1} material={mat} seg={12} />
      <Cyl r={0.038} h={0.01} position={[0, 0.046, 0]} material={M.coffee} seg={12} />
      <mesh position={[0.05, 0, 0]} rotation-y={Math.PI / 2} material={mat}>
        <torusGeometry args={[0.028, 0.009, 6, 12]} />
      </mesh>
    </group>
  )
}

function PaperStack({ position, n = 4, rot = 0 }: { position: V3; n?: number; rot?: number }) {
  return (
    <group position={position} rotation-y={rot}>
      {Array.from({ length: n }).map((_, i) => (
        <Box key={i} size={[0.3, 0.008, 0.4]} position={[Math.sin(i * 2.1) * 0.015, i * 0.01, Math.cos(i * 1.3) * 0.015]} rotation={[0, Math.sin(i) * 0.08, 0]} material={i % 2 ? M.paper : M.paperWarm} />
      ))}
    </group>
  )
}

function DeskLamp({ position }: { position: V3 }) {
  return (
    <group position={position}>
      <Cyl r={0.08} h={0.03} material={M.metalDark} />
      <Box size={[0.025, 0.36, 0.025]} position={[0, 0.18, -0.02]} rotation={[0.25, 0, 0]} material={M.metalDark} />
      <mesh position={[0, 0.36, 0.06]} rotation-x={0.6} material={M.lampShade}>
        <coneGeometry args={[0.1, 0.13, 14, 1, true]} />
      </mesh>
      <pointLight position={[0, 0.3, 0.12]} intensity={0.9} distance={2.2} color="#ffd59a" decay={2} />
    </group>
  )
}

export function SmallPlant({ position, scale = 1 }: { position: V3; scale?: number }) {
  return (
    <group position={position} scale={scale}>
      <Cyl r={0.07} rb={0.055} h={0.11} material={M.potTerracotta} seg={10} />
      <mesh position={[0, 0.11, 0]} material={M.leaf1}><icosahedronGeometry args={[0.09, 0]} /></mesh>
      <mesh position={[0.05, 0.16, 0.02]} material={M.leaf3}><icosahedronGeometry args={[0.06, 0]} /></mesh>
    </group>
  )
}

export function Plant({ position, kind = 0, scale = 1 }: { position: V3; kind?: number; scale?: number }) {
  return (
    <group position={position} scale={scale}>
      <Blob w={1} d={1} />
      <Cyl r={0.26} rb={0.2} h={0.42} position={[0, 0.21, 0]} material={kind % 2 ? M.potCream : M.potTerracotta} seg={14} />
      <Cyl r={0.23} h={0.02} position={[0, 0.42, 0]} material={M.soil} seg={14} />
      {kind === 2 ? (
        <>
          <Cyl r={0.035} h={1.1} position={[0, 0.95, 0]} material={M.woodDark} seg={6} />
          {[[0, 1.6, 0, 0.42], [0.22, 1.35, 0.1, 0.3], [-0.2, 1.4, -0.08, 0.32], [0.05, 1.2, -0.2, 0.26]].map(([x, y, z, r], i) => (
            <mesh key={i} position={[x, y, z]} material={i % 2 ? M.leaf2 : M.leaf1}><icosahedronGeometry args={[r, 1]} /></mesh>
          ))}
        </>
      ) : (
        Array.from({ length: 7 }).map((_, i) => {
          const a = (i / 7) * Math.PI * 2
          const tall = 0.55 + (i % 3) * 0.18
          return (
            <mesh key={i} position={[Math.cos(a) * 0.12, 0.42 + tall / 2, Math.sin(a) * 0.12]} rotation={[Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5]} material={[M.leaf1, M.leaf2, M.leaf3][i % 3]}>
              <coneGeometry args={[0.11, tall, 4]} />
            </mesh>
          )
        })
      )}
    </group>
  )
}

export function Desks() {
  const { alexDesk: A, miloDesk: Mi, lunaDesk: L } = FURNITURE
  return (
    <group>
      {/* Alex - manager desk (walnut, faces +x) */}
      <group position={[A.x, 0, A.z]} rotation-y={A.rot}>
        <DeskBase w={2.3} d={1.0} mat={M.walnut} />
        <Monitor agent="alex" position={[-0.25, 1.14, -0.28]} accent={AGENT_META.alex.accent} />
        <Keyboard position={[-0.25, 0.79, 0.3]} />
        <group position={[0.6, 0.78, 0.02]} rotation={[0, -0.4, 0]}>
          <RBox size={[0.38, 0.02, 0.26]} material={M.metalLight} radius={0.01} />
          <RBox size={[0.38, 0.24, 0.015]} position={[0, 0.12, -0.13]} rotation={[-0.25, 0, 0]} material={M.metalLight} radius={0.008} />
        </group>
        <Mug position={[-0.85, 0.82, 0.18]} mat={M.red} />
        <group position={[0.15, 0.8, 0.38]}>
          <Box size={[0.32, 0.07, 0.04]} rotation={[-0.4, 0, 0]} material={M.gold} />
        </group>
        <SmallPlant position={[-0.95, 0.78, -0.3]} />
        <DeskLamp position={[0.92, 0.78, -0.3]} />
      </group>
      {/* Milo - research station with dual monitors */}
      <group position={[Mi.x, 0, Mi.z]} rotation-y={Mi.rot}>
        <DeskBase w={2.2} d={1.0} />
        <Monitor agent="milo" position={[-0.38, 1.14, -0.25]} rotation={[0, 0.18, 0]} accent={AGENT_META.milo.accent} />
        <Monitor agent="milo" position={[0.33, 1.14, -0.25]} rotation={[0, -0.18, 0]} accent="#4a90c8" />
        <Keyboard position={[0, 0.79, 0.3]} />
        <group position={[-0.88, 0.78, 0.0]}>
          {[0, 1, 2, 3].map((i) => (
            <Box key={i} size={[0.26, 0.05, 0.34]} position={[0, 0.03 + i * 0.052, 0]} rotation={[0, Math.sin(i * 2) * 0.15, 0]} material={[M.red, M.rugBlue, M.leaf2, M.gold][i]} />
          ))}
        </group>
        <Mug position={[0.62, 0.82, 0.22]} />
        <SmallPlant position={[0.9, 0.78, -0.25]} />
      </group>
      {/* Luna - review desk with paper trays */}
      <group position={[L.x, 0, L.z]} rotation-y={L.rot}>
        <DeskBase w={2.2} d={1.0} mat={M.woodLight} />
        <Monitor agent="luna" position={[0.25, 1.14, -0.27]} accent={AGENT_META.luna.accent} />
        <Keyboard position={[0.25, 0.79, 0.3]} />
        <PaperStack position={[-0.6, 0.78, 0.05]} n={5} rot={0.15} />
        <group position={[-0.62, 0.78, -0.3]}>
          <RBox size={[0.36, 0.08, 0.28]} material={M.woodDark} radius={0.01} />
          <RBox size={[0.36, 0.08, 0.28]} position={[0, 0.12, 0]} material={M.woodDark} radius={0.01} />
          <Box size={[0.3, 0.02, 0.24]} position={[0, 0.17, 0]} material={M.paper} />
        </group>
        <Cyl r={0.008} h={0.16} position={[-0.32, 0.8, 0.2]} rotation={[Math.PI / 2, 0, 0.7]} material={M.red} seg={6} />
        <DeskLamp position={[0.92, 0.78, -0.3]} />
        <Mug position={[-0.95, 0.82, 0.25]} mat={M.potCream} />
      </group>
      <OfficeChair agent="alex" />
      <OfficeChair agent="milo" />
      <OfficeChair agent="luna" />
    </group>
  )
}

export function Bookshelf() {
  const { x, z } = FURNITURE.bookshelf
  const ref = useRef<THREE.InstancedMesh>(null)
  const books = useMemo(() => {
    const palette = ['#c8553d', '#2e5e7e', '#e2a33a', '#4f8a5b', '#7a4b8c', '#d9cbb0', '#8c3b2f', '#3d4b78', '#e07a4f']
    const out: { p: V3; s: V3; c: string; r: number }[] = []
    let seed = 3
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let shelf = 0; shelf < 4; shelf++) {
      let bx = -0.95
      while (bx < 0.9) {
        const w = 0.06 + rnd() * 0.06
        const h = 0.3 + rnd() * 0.16
        if (rnd() < 0.08) { bx += 0.15; continue }
        const lean = rnd() < 0.1 ? 0.2 : 0
        out.push({ p: [bx + w / 2, 0.12 + shelf * 0.55 + h / 2, 0.02], s: [w, h, 0.26], c: palette[Math.floor(rnd() * palette.length)], r: lean })
        bx += w + 0.008
      }
    }
    return out
  }, [])
  useLayoutEffect(() => {
    const m = ref.current
    if (!m) return
    const o = new THREE.Object3D()
    const c = new THREE.Color()
    books.forEach((b, i) => {
      o.position.set(...b.p)
      o.scale.set(...b.s)
      o.rotation.set(0, 0, b.r)
      o.updateMatrix()
      m.setMatrixAt(i, o.matrix)
      m.setColorAt(i, c.set(b.c))
    })
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
  }, [books])
  return (
    <group position={[x, 0, z]}>
      <Blob w={2.6} d={0.9} />
      <RBox size={[2.2, 2.35, 0.08]} position={[0, 1.18, -0.16]} material={M.woodDark} radius={0.02} />
      {[-1.06, 1.06].map((sx) => <RBox key={sx} size={[0.08, 2.35, 0.42]} position={[sx, 1.18, 0]} material={M.woodMid} radius={0.02} />)}
      {[0, 1, 2, 3, 4].map((i) => <RBox key={i} size={[2.2, 0.05, 0.42]} position={[0, 0.08 + i * 0.55, 0]} material={M.woodMid} radius={0.015} />)}
      <instancedMesh ref={ref} args={[undefined, undefined, books.length]}>
        <boxGeometry />
        <meshStandardMaterial roughness={0.8} />
      </instancedMesh>
      <SmallPlant position={[0.75, 2.27, 0]} scale={1.4} />
      <mesh position={[-0.7, 2.36, 0]} material={M.gold}><sphereGeometry args={[0.1, 14, 10]} /></mesh>
    </group>
  )
}

export function MeetingArea() {
  const { x, z } = FURNITURE.meetingTable
  return (
    <group position={[x, 0, z]}>
      <Cyl r={1.95} h={0.02} position={[0, 0.011, 0]} material={M.rugB} seg={40} />
      <Cyl r={1.75} h={0.022} position={[0, 0.012, 0]} material={M.rugA} seg={40} />
      <Cyl r={1.3} h={0.024} position={[0, 0.013, 0]} material={M.rugC} seg={40} />
      <Blob w={2.6} d={2.6} />
      <Cyl r={1.0} h={0.07} position={[0, 0.76, 0]} material={M.woodLight} seg={32} />
      <Cyl r={0.98} h={0.02} position={[0, 0.8, 0]} material={M.woodMid} seg={32} />
      <Cyl r={0.08} h={0.72} position={[0, 0.38, 0]} material={M.woodDark} seg={10} />
      <Cyl r={0.45} rb={0.5} h={0.05} position={[0, 0.03, 0]} material={M.woodDark} seg={20} />
      <group position={[0.35, 0.82, 0.4]}>
        <Cyl r={0.09} rb={0.07} h={0.14} position={[0, 0.07, 0]} material={M.potCream} seg={10} />
        {[0, 1, 2].map((i) => (
          <mesh key={i} position={[Math.cos(i * 2.1) * 0.05, 0.2 + i * 0.03, Math.sin(i * 2.1) * 0.05]} material={[M.leaf1, M.leaf3, M.leaf2][i]}><icosahedronGeometry args={[0.07, 0]} /></mesh>
        ))}
      </group>
      <Mug position={[-0.45, 0.85, 0.3]} />
    </group>
  )
}

export function Lounge() {
  const { x, z } = FURNITURE.lounge
  return (
    <group position={[x, 0, z]}>
      <RBox size={[3.4, 0.02, 2.4]} position={[0, 0.012, 0]} material={M.rugBlue} radius={0.01} />
      <RBox size={[3.0, 0.024, 2.0]} position={[0, 0.014, 0]} material={M.rugC} radius={0.01} />
      {/* sofa against the left wall, facing +x */}
      <group position={[-1.95, 0, 0]} rotation-y={Math.PI / 2}>
        <Blob w={2.6} d={1.2} />
        <RBox size={[2.2, 0.35, 0.85]} position={[0, 0.25, 0]} material={M.sofa} radius={0.1} />
        <RBox size={[2.2, 0.6, 0.25]} position={[0, 0.6, -0.33]} material={M.sofa} radius={0.1} />
        <RBox size={[0.25, 0.5, 0.85]} position={[-1.1, 0.42, 0]} material={M.sofa} radius={0.1} />
        <RBox size={[0.25, 0.5, 0.85]} position={[1.1, 0.42, 0]} material={M.sofa} radius={0.1} />
        <RBox size={[0.95, 0.14, 0.6]} position={[-0.47, 0.49, 0.06]} material={M.sofaCushion} radius={0.06} />
        <RBox size={[0.95, 0.14, 0.6]} position={[0.47, 0.49, 0.06]} material={M.sofaCushion} radius={0.06} />
        <RBox size={[0.4, 0.36, 0.14]} position={[0.65, 0.72, -0.12]} rotation={[-0.2, 0.2, 0.1]} material={M.rugA} radius={0.06} />
      </group>
      <group position={[-0.4, 0, 0]}>
        <Blob w={1.4} d={1} />
        <RBox size={[1.1, 0.06, 0.65]} position={[0, 0.4, 0]} material={M.woodLight} radius={0.03} />
        {[[-0.48, -0.26], [0.48, -0.26], [-0.48, 0.26], [0.48, 0.26]].map(([lx, lz]) => <Cyl key={`${lx}${lz}`} r={0.025} h={0.38} position={[lx, 0.19, lz]} material={M.woodDark} seg={6} />)}
        <PaperStack position={[0.2, 0.44, 0]} n={2} rot={0.6} />
        <Mug position={[-0.25, 0.48, 0.1]} mat={M.potTerracotta} />
      </group>
      {/* floor lamp */}
      <group position={[-2.1, 0, -1.55]}>
        <Blob w={0.7} d={0.7} />
        <Cyl r={0.17} h={0.04} position={[0, 0.02, 0]} material={M.metalDark} />
        <Cyl r={0.02} h={1.6} position={[0, 0.82, 0]} material={M.metalDark} seg={6} />
        <mesh position={[0, 1.7, 0]} material={M.lampShade}><cylinderGeometry args={[0.18, 0.28, 0.32, 18, 1, true]} /></mesh>
        <pointLight position={[0, 1.55, 0]} intensity={2.2} distance={4.5} color="#ffcf8a" decay={2} />
      </group>
    </group>
  )
}

export function CoffeeStation() {
  const { x, z } = FURNITURE.coffee
  return (
    <group position={[x, 0, z]}>
      <Blob w={1.8} d={1} />
      <RBox size={[1.4, 0.9, 0.6]} position={[0, 0.45, 0]} material={M.plasticCream} radius={0.04} />
      <RBox size={[1.46, 0.05, 0.64]} position={[0, 0.92, 0]} material={M.woodMid} radius={0.02} />
      <Box size={[0.01, 0.7, 0.01]} position={[0, 0.45, 0.301]} material={M.trim} />
      <group position={[-0.3, 0.95, -0.05]}>
        <RBox size={[0.32, 0.42, 0.32]} position={[0, 0.21, 0]} material={M.metalDark} radius={0.04} />
        <Box size={[0.2, 0.05, 0.05]} position={[0, 0.3, 0.16]} material={M.metalLight} />
        <mesh position={[0.08, 0.38, 0.165]}><circleGeometry args={[0.02, 10]} /><meshBasicMaterial color="#7dff9a" toneMapped={false} /></mesh>
      </group>
      <Mug position={[0.2, 1.0, 0.05]} />
      <Mug position={[0.38, 1.0, -0.1]} mat={M.red} />
      <RBox size={[1.2, 0.04, 0.3]} position={[0, 1.85, -0.12]} material={M.woodMid} radius={0.01} />
      {[0, 1, 2].map((i) => <Mug key={i} position={[-0.35 + i * 0.32, 1.92, -0.12]} mat={[M.potTerracotta, M.potCream, M.rugBlue][i]} />)}
    </group>
  )
}

export function WallDecor() {
  const hour = useRef<THREE.Mesh>(null)
  const minute = useRef<THREE.Mesh>(null)
  useFrame(() => {
    const d = new Date()
    const m = d.getMinutes() + d.getSeconds() / 60
    const h = (d.getHours() % 12) + m / 60
    if (minute.current) minute.current.rotation.z = -(m / 60) * Math.PI * 2
    if (hour.current) hour.current.rotation.z = -(h / 12) * Math.PI * 2
  })
  return (
    <group>
      {/* wall clock showing local time */}
      <group position={[6.2, 2.45, -5.97]}>
        <Cyl r={0.34} h={0.06} rotation={[Math.PI / 2, 0, 0]} material={M.woodDark} seg={28} />
        <Cyl r={0.29} h={0.065} rotation={[Math.PI / 2, 0, 0]} material={M.paperWarm} seg={28} />
        <group position={[0, 0, 0.04]}>
          <mesh ref={hour}><boxGeometry args={[0.025, 0.32, 0.01]} /><meshStandardMaterial color="#3a2a20" /></mesh>
          <mesh ref={minute}><boxGeometry args={[0.018, 0.48, 0.01]} /><meshStandardMaterial color="#3a2a20" /></mesh>
        </group>
      </group>
      {/* framed art on left wall */}
      {[{ z: -0.4, c: '#e9b872', s: [0.9, 0.65] }, { z: 3.0, c: '#7fa7a1', s: [0.6, 0.8] }].map((f, i) => (
        <group key={i} position={[-7.97, 2.15, f.z]} rotation-y={Math.PI / 2}>
          <RBox size={[f.s[0] + 0.1, f.s[1] + 0.1, 0.04]} material={M.woodDark} radius={0.015} />
          <mesh position={[0, 0, 0.022]}><planeGeometry args={f.s as [number, number]} /><meshStandardMaterial color={f.c} /></mesh>
          <mesh position={[0.1, -0.05, 0.024]}><circleGeometry args={[0.16, 20]} /><meshStandardMaterial color="#f6e7cf" /></mesh>
          <mesh position={[-0.12, 0.08, 0.025]}><circleGeometry args={[0.09, 20]} /><meshStandardMaterial color="#d46b4a" /></mesh>
        </group>
      ))}
      {/* "AgentOS" sign on back wall */}
      <group position={[-5.8, 2.35, -5.97]}>
        <RBox size={[1.7, 0.5, 0.05]} material={M.woodDark} radius={0.04} />
        <mesh position={[-0.55, 0, 0.03]}><circleGeometry args={[0.15, 6]} /><meshBasicMaterial color="#f2a46a" toneMapped={false} /></mesh>
        {[0, 1, 2, 3, 4].map((i) => <Box key={i} size={[0.13, 0.16 - (i % 2) * 0.04, 0.01]} position={[-0.25 + i * 0.19, 0, 0.03]} material={M.paperWarm} />)}
      </group>
    </group>
  )
}

export function Plants() {
  return (
    <>
      <Plant position={[-7.4, 0, -5.4]} kind={2} />
      <Plant position={[3.0, 0, -5.5]} kind={0} scale={0.85} />
      <Plant position={[7.4, 0, -3.9]} kind={1} />
      <Plant position={[7.35, 0, 5.3]} kind={2} scale={0.9} />
      <Plant position={[-7.4, 0, 0.0]} kind={1} scale={0.8} />
      <Plant position={[-2.0, 0, -5.45]} kind={0} scale={0.7} />
      <Plant position={[6.3, 0, 2.6]} kind={0} scale={0.9} />
    </>
  )
}
