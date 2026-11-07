import { useMemo } from 'react'
import { M, woodFloorTexture } from './materials'
import { Box, RBox } from './primitives'
import { ROOM } from './layout'

const W = ROOM.maxX - ROOM.minX
const D = ROOM.maxZ - ROOM.minZ
const H = ROOM.wallH
const T = 0.22 // wall thickness

function Window({ along, at, width, height = 1.5, sill = 1.05 }: { along: 'x' | 'z'; at: number; width: number; height?: number; sill?: number }) {
  // Window set into the back wall (along x) or the left wall (along z)
  const pos: [number, number, number] = along === 'x' ? [at, sill + height / 2, ROOM.minZ + 0.012] : [ROOM.minX + 0.012, sill + height / 2, at]
  const rot: [number, number, number] = along === 'x' ? [0, 0, 0] : [0, Math.PI / 2, 0]
  return (
    <group position={pos} rotation={rot}>
      <Box size={[width, height, 0.02]} position={[0, 0, 0.005]} material={M.glass} />
      <RBox size={[width + 0.16, 0.1, 0.16]} position={[0, height / 2 + 0.05, 0.04]} material={M.plasticCream} radius={0.03} />
      <RBox size={[width + 0.26, 0.08, 0.26]} position={[0, -height / 2 - 0.04, 0.1]} material={M.plasticCream} radius={0.03} />
      <Box size={[0.08, height, 0.1]} position={[-width / 2 - 0.04, 0, 0.03]} material={M.plasticCream} />
      <Box size={[0.08, height, 0.1]} position={[width / 2 + 0.04, 0, 0.03]} material={M.plasticCream} />
      <Box size={[0.05, height, 0.06]} position={[0, 0, 0.03]} material={M.plasticCream} />
      <Box size={[width, 0.05, 0.06]} position={[0, 0.1, 0.03]} material={M.plasticCream} />
      {/* curtains */}
      <RBox size={[0.32, height + 0.45, 0.08]} position={[-width / 2 - 0.3, 0.12, 0.12]} material={M.curtain} radius={0.035} />
      <RBox size={[0.32, height + 0.45, 0.08]} position={[width / 2 + 0.3, 0.12, 0.12]} material={M.curtain} radius={0.035} />
      <Box size={[width + 1.1, 0.04, 0.04]} position={[0, height / 2 + 0.34, 0.14]} material={M.trim} />
    </group>
  )
}

export function Room() {
  const floor = useMemo(() => woodFloorTexture(), [])
  return (
    <group>
      {/* diorama base */}
      <RBox size={[W + 0.5, 0.42, D + 0.5]} position={[0, -0.22, 0]} material={M.slab} radius={0.12} />
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.002, 0]}>
        <planeGeometry args={[W, D]} />
        <meshStandardMaterial map={floor} roughness={0.75} />
      </mesh>

      {/* back wall (z = minZ) */}
      <group>
        <Box size={[W + T, H, T]} position={[0, H / 2, ROOM.minZ - T / 2]} material={M.wallCream} />
        <Box size={[W, 0.95, 0.05]} position={[0, 0.475, ROOM.minZ + 0.025]} material={M.wainscot} />
        <Box size={[W, 0.06, 0.08]} position={[0, 0.97, ROOM.minZ + 0.04]} material={M.trim} />
        <Box size={[W, 0.12, 0.07]} position={[0, 0.06, ROOM.minZ + 0.035]} material={M.trim} />
        <Box size={[W + T, 0.14, T + 0.06]} position={[0, H + 0.07, ROOM.minZ - T / 2]} material={M.trim} />
      </group>
      {/* left wall (x = minX) */}
      <group>
        <Box size={[T, H, D + T]} position={[ROOM.minX - T / 2, H / 2, 0]} material={M.wallWarm} />
        <Box size={[0.05, 0.95, D]} position={[ROOM.minX + 0.025, 0.475, 0]} material={M.wainscot} />
        <Box size={[0.08, 0.06, D]} position={[ROOM.minX + 0.04, 0.97, 0]} material={M.trim} />
        <Box size={[0.07, 0.12, D]} position={[ROOM.minX + 0.035, 0.06, 0]} material={M.trim} />
        <Box size={[T + 0.06, 0.14, D + T]} position={[ROOM.minX - T / 2, H + 0.07, 0]} material={M.trim} />
      </group>

      <Window along="x" at={-1.55} width={1.2} />
      <Window along="x" at={2.5} width={1.6} />
      <Window along="z" at={-4.75} width={1.3} />
      <Window along="z" at={4.1} width={2.0} />
    </group>
  )
}
