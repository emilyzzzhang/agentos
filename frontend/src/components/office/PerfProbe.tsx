import { useFrame, useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import * as THREE from 'three'
import { runtime } from '../../stores/visualStore'
import { wanderState } from '../../stores/wander'

export interface PerfSnapshot {
  calls: number
  triangles: number
  geometries: number
  textures: number
  programs: number
  characters: Record<string, { meshes: number; triangles: number }>
  /** Agent floor positions and whether each is walking (for overlap checks). */
  agents: Record<string, { x: number; z: number; walking: boolean }>
  wander: ReturnType<typeof wanderState>
}

const tris = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.attributes.position.count) / 3

/**
 * Dev-only renderer statistics (enable with `?perf=1`). Reads three.js's own counters, so it adds
 * no draw calls. Exposed as `window.__agentosPerf` for measurement scripts.
 */
export function PerfProbe() {
  const { gl, scene } = useThree()
  useEffect(() => () => { delete (window as unknown as Record<string, unknown>).__agentosPerf }, [])
  useFrame(() => {
    const info = gl.info
    const characters: PerfSnapshot['characters'] = {}
    scene.traverse((o) => {
      if (!o.name.startsWith('character-')) return
      let meshes = 0
      let t = 0
      o.traverse((m) => {
        if ((m as THREE.Mesh).isMesh && m.visible) {
          meshes += 1
          t += tris((m as THREE.Mesh).geometry)
        }
      })
      characters[o.name.slice(10)] = { meshes, triangles: Math.round(t) }
    })
    ;(window as unknown as { __agentosPerf: PerfSnapshot }).__agentosPerf = {
      calls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries,
      textures: info.memory.textures, programs: info.programs?.length ?? 0, characters,
      agents: Object.fromEntries(Object.entries(runtime).map(([id, rt]) => [id, { x: rt.x + rt.ox, z: rt.z + rt.oz, walking: rt.anim === 'walk' }])),
      wander: wanderState(),
    }
  })
  return null
}
