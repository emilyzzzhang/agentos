import { RoundedBox } from '@react-three/drei'
import type * as THREE from 'three'
import { blobMaterial } from './materials'

type V3 = [number, number, number]

/** Soft fake contact shadow (no real-time shadow maps). */
export function Blob({ x = 0, z = 0, w = 1, d = 1 }: { x?: number; z?: number; w?: number; d?: number }) {
  return (
    <mesh position={[x, 0.012, z]} rotation-x={-Math.PI / 2} material={blobMaterial()} renderOrder={1} scale={[w, d, 1]}>
      <planeGeometry args={[1, 1]} />
    </mesh>
  )
}

export function RBox({ size, position, material, radius = 0.04, rotation }: { size: V3; position?: V3; material: THREE.Material; radius?: number; rotation?: V3 }) {
  return (
    <RoundedBox args={size} radius={Math.min(radius, Math.min(...size) / 2 - 0.001)} smoothness={2} position={position} rotation={rotation} material={material} />
  )
}

export function Box({ size, position, material, rotation }: { size: V3; position?: V3; material: THREE.Material; rotation?: V3 }) {
  return (
    <mesh position={position} rotation={rotation} material={material}>
      <boxGeometry args={size} />
    </mesh>
  )
}

export function Cyl({ r, rb, h, position, material, seg = 16, rotation }: { r: number; rb?: number; h: number; position?: V3; material: THREE.Material; seg?: number; rotation?: V3 }) {
  return (
    <mesh position={position} rotation={rotation} material={material}>
      <cylinderGeometry args={[r, rb ?? r, h, seg]} />
    </mesh>
  )
}
