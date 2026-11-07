import { RoundedBox } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useRef, type ReactNode } from 'react'
import * as THREE from 'three'
import type { Anim } from '../../stores/visualStore'
import { runtime, useVisualStore } from '../../stores/visualStore'
import type { AgentId } from '../../types'
import { LOCATIONS, type Location } from '../office/layout'
import { bodyGeometry, bodyMaterial } from './body'
import { LOOKS, type Look } from './looks'

const damp = THREE.MathUtils.damp

/** Two-joint limb (shoulder→elbow or hip→knee). The joints are bones that drive the skinned body. */
function Limb({ refs, children }: { refs: { a: React.RefObject<THREE.Bone | null>; b: React.RefObject<THREE.Bone | null> }; children?: ReactNode }) {
  return (
    <bone ref={refs.a}>
      <bone ref={refs.b} position={[0, -0.24, 0]}>{children}</bone>
    </bone>
  )
}

const colorOf = (m: THREE.Material) => (m as THREE.MeshStandardMaterial).color

/**
 * Attaches one smooth skinned body (torso, arms, hands, legs, shoes; see body.ts) to the rig's bones.
 * Bound once in the rest pose, before the first animation frame.
 */
function useSkinnedBody(id: AgentId, look: Look, parent: React.RefObject<THREE.Group | null>, bones: React.RefObject<THREE.Bone | null>[]) {
  useLayoutEffect(() => {
    const host = parent.current
    if (!host || bones.some((b) => !b.current)) return
    const material = bodyMaterial({ top: colorOf(look.top), bottom: colorOf(look.bottom), skin: colorOf(look.skin), shoes: colorOf(look.shoes) })
    const mesh = new THREE.SkinnedMesh(bodyGeometry(), material)
    mesh.name = `body-${id}`
    mesh.frustumCulled = false
    host.add(mesh)
    host.updateWorldMatrix(true, true)
    mesh.bind(new THREE.Skeleton(bones.map((b) => b.current!)))
    return () => {
      host.remove(mesh)
      mesh.skeleton.dispose()
      material.dispose() // the geometry is shared and kept
    }
    // bones and look are stable for a character
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])
}

function Hair({ id, look }: { id: AgentId; look: Look }) {
  const h = look.hair
  if (id === 'alex')
    return (
      <group>
        <mesh position={[0, 0.33, -0.02]} scale={[1.04, 0.78, 1.04]} material={h}><sphereGeometry args={[0.28, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2]} /></mesh>
        <mesh position={[0, 0.3, -0.03]} material={h} scale={[1.05, 1, 1.05]}><sphereGeometry args={[0.275, 18, 12]} /></mesh>
        <RoundedBox args={[0.3, 0.1, 0.16]} radius={0.04} position={[0.05, 0.5, 0.14]} rotation={[0.3, 0, -0.15]} material={h} />
      </group>
    )
  if (id === 'milo')
    return (
      <group>
        <mesh position={[0, 0.3, -0.03]} material={h} scale={[1.04, 1, 1.04]}><sphereGeometry args={[0.275, 16, 12]} /></mesh>
        {Array.from({ length: 11 }).map((_, i) => {
          const a = (i / 11) * Math.PI * 2
          const r = i % 2 ? 0.2 : 0.14
          return (
            <mesh key={i} position={[Math.cos(a) * r, 0.5 + (i % 3) * 0.025, Math.sin(a) * r - 0.02]} material={h}>
              <icosahedronGeometry args={[0.1, 1]} />
            </mesh>
          )
        })}
      </group>
    )
  return (
    <group>
      <mesh position={[0, 0.31, -0.03]} material={h} scale={[1.07, 1.02, 1.07]}><sphereGeometry args={[0.275, 18, 12]} /></mesh>
      <mesh position={[0, 0.62, -0.1]} material={h}><sphereGeometry args={[0.13, 14, 10]} /></mesh>
      <RoundedBox args={[0.5, 0.42, 0.18]} radius={0.08} position={[0, 0.16, -0.17]} material={h} />
      <RoundedBox args={[0.16, 0.12, 0.08]} radius={0.04} position={[-0.13, 0.5, 0.2]} rotation={[0.4, 0, 0.5]} material={h} />
    </group>
  )
}

function Face({ id, look, eyes, mouth }: { id: AgentId; look: Look; eyes: React.RefObject<THREE.Group | null>; mouth: React.RefObject<THREE.Mesh | null> }) {
  return (
    <group position={[0, 0.27, 0]}>
      <group ref={eyes}>
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * 0.095, 0.0, 0.245]} material={look.eye} scale={[1, 1.25, 0.6]}>
            <sphereGeometry args={[0.032, 10, 8]} />
          </mesh>
        ))}
      </group>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.16, -0.07, 0.205]} rotation-y={s * 0.6} material={look.cheek}>
          <circleGeometry args={[0.045, 12]} />
        </mesh>
      ))}
      <mesh ref={mouth} position={[0, -0.1, 0.25]} material={look.eye} scale={[1, 0.35, 0.5]}>
        <sphereGeometry args={[0.035, 10, 8]} />
      </mesh>
      {id === 'milo' && (
        <group position={[0, 0, 0.255]}>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * 0.095, 0, 0]} material={look.shoes}><torusGeometry args={[0.058, 0.011, 6, 18]} /></mesh>
          ))}
          <mesh material={look.shoes}><boxGeometry args={[0.06, 0.012, 0.012]} /></mesh>
        </group>
      )}
      {id === 'luna' && (
        <group position={[0, 0.005, 0.255]}>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * 0.095, 0, 0]} scale={[1.15, 0.85, 1]} material={look.extra}><torusGeometry args={[0.055, 0.009, 6, 18]} /></mesh>
          ))}
          <mesh material={look.extra}><boxGeometry args={[0.06, 0.01, 0.01]} /></mesh>
          {[-1, 1].map((s) => (
            <mesh key={`e${s}`} position={[s * 0.27, -0.16, -0.25]} material={look.extra}><sphereGeometry args={[0.022, 8, 6]} /></mesh>
          ))}
        </group>
      )}
    </group>
  )
}

type Pose = {
  armLx: number; armLz: number; foreL: number; armRx: number; armRz: number; foreR: number
  legL: number; shinL: number; legR: number; shinR: number
  headX: number; headY: number; headZ: number; torsoX: number; bob: number; sit: number
}

const ZERO: Pose = { armLx: 0, armLz: 0.08, foreL: -0.15, armRx: 0, armRz: -0.08, foreR: -0.15, legL: 0, shinL: 0, legR: 0, shinR: 0, headX: 0, headY: 0, headZ: 0, torsoX: 0, bob: 0, sit: 0 }

function targetPose(anim: Anim, t: number, seated: boolean, busy: boolean, sofa = false): Pose {
  const p: Pose = { ...ZERO }
  const breathe = Math.sin(t * 2) * 0.01
  switch (anim) {
    case 'idle':
      p.headY = Math.sin(t * 0.5) * 0.15
      p.headX = Math.sin(t * 0.7) * 0.03
      p.armLx = Math.sin(t * 1.1) * 0.04
      p.armRx = -Math.sin(t * 1.1) * 0.04
      p.bob = breathe
      if (seated) { p.armLx = p.armRx = -0.5; p.foreL = p.foreR = -0.9 }
      break
    case 'walk': {
      const ph = t * 9
      p.legL = Math.sin(ph) * 0.65
      p.legR = -Math.sin(ph) * 0.65
      p.shinL = Math.max(0, -Math.sin(ph)) * 0.9
      p.shinR = Math.max(0, Math.sin(ph)) * 0.9
      p.armLx = -Math.sin(ph) * 0.55
      p.armRx = Math.sin(ph) * 0.55
      p.foreL = p.foreR = -0.35
      p.bob = Math.abs(Math.sin(ph)) * 0.05
      p.torsoX = 0.06
      break
    }
    case 'typing': {
      const sp = busy ? 26 : 14
      p.armLx = p.armRx = -1.05
      p.armLz = 0.18
      p.armRz = -0.18
      p.foreL = -0.55 + Math.sin(t * sp) * 0.09
      p.foreR = -0.55 + Math.sin(t * sp + 1.7) * 0.09
      p.headX = 0.12 + Math.sin(t * 1.3) * 0.03
      p.headY = busy ? Math.sin(t * 0.9) * 0.18 : 0
      p.bob = breathe
      break
    }
    case 'reading':
      p.armLx = p.armRx = -0.85
      p.armLz = 0.22
      p.armRz = -0.22
      p.foreL = p.foreR = -1.15
      p.headX = 0.28
      p.headY = Math.sin(t * 1.1) * 0.12
      p.bob = breathe
      break
    case 'thinking':
      p.armRx = -0.35
      p.armRz = 0.25
      p.foreR = -2.35
      p.armLx = -0.45
      p.armLz = -0.35
      p.foreL = -1.3
      p.headZ = 0.14 + Math.sin(t * 0.8) * 0.05
      p.headY = Math.sin(t * 0.6) * 0.2
      p.headX = -0.1
      p.bob = breathe
      break
    case 'talking':
      p.armRx = -0.65 + Math.sin(t * 3.1) * 0.35
      p.armRz = -0.25
      p.foreR = -0.9 + Math.sin(t * 4.2) * 0.25
      p.armLx = -0.3 + Math.sin(t * 2.3 + 1) * 0.25
      p.armLz = 0.2
      p.foreL = -0.6
      p.headX = Math.sin(t * 4.5) * 0.07
      p.headY = Math.sin(t * 1.3) * 0.12
      p.bob = breathe
      break
    case 'celebrate': {
      const j = Math.abs(Math.sin(t * 6))
      p.armLz = 2.5 + Math.sin(t * 12) * 0.2
      p.armRz = -2.5 - Math.sin(t * 12) * 0.2
      p.foreL = p.foreR = -0.2
      p.bob = j * 0.22
      p.legL = p.legR = -j * 0.2
      p.shinL = p.shinR = j * 0.4
      p.headX = -0.15
      break
    }
    case 'done':
      p.armRz = -2.5
      p.foreR = -0.4 + Math.sin(t * 10) * 0.35
      p.headZ = -0.08
      p.bob = Math.abs(Math.sin(t * 4)) * 0.05
      break
    case 'error':
      p.armRx = -2.5
      p.armRz = 0.2
      p.foreR = -1.4
      p.headX = 0.42
      p.headZ = Math.sin(t * 0.8) * 0.05
      p.torsoX = 0.12
      break
  }
  if (seated && (anim === 'typing' || anim === 'reading' || anim === 'idle' || anim === 'thinking' || anim === 'error')) {
    p.sit = 1
    p.legL = p.legR = -1.45
    p.shinL = p.shinR = 1.45
    if (sofa) {
      // lower legs hang forward over the cushion edge; lean back toward the backrest
      p.shinL = p.shinR = 0.95
      p.torsoX -= 0.12
    }
  }
  return p
}

export function Character({ id }: { id: AgentId }) {
  const look = LOOKS[id]
  const body = useRef<THREE.Group>(null)
  const torso = useRef<THREE.Bone>(null)
  const root = useRef<THREE.Bone>(null)
  const head = useRef<THREE.Group>(null)
  const eyes = useRef<THREE.Group>(null)
  const mouth = useRef<THREE.Mesh>(null)
  const paper = useRef<THREE.Group>(null)
  const r = {
    armL: useRef<THREE.Bone>(null), foreL: useRef<THREE.Bone>(null),
    armR: useRef<THREE.Bone>(null), foreR: useRef<THREE.Bone>(null),
    legL: useRef<THREE.Bone>(null), shinL: useRef<THREE.Bone>(null),
    legR: useRef<THREE.Bone>(null), shinR: useRef<THREE.Bone>(null),
  }
  // same order as BONES in body.ts
  useSkinnedBody(id, look, body, [root, torso, r.armL, r.foreL, r.armR, r.foreR, r.legL, r.shinL, r.legR, r.shinR])
  const cur = useRef<Pose>({ ...ZERO })
  const seed = useRef(Math.random() * 100)

  useFrame(({ clock }, dt) => {
    const rt = runtime[id]
    const t = clock.elapsedTime + seed.current
    const busy = useVisualStore.getState().activeTools[id] > 0
    const sofa = rt.seated && !!(LOCATIONS[rt.location] as Location).sofa
    const target = targetPose(rt.anim, t, rt.seated, busy, sofa)
    const c = cur.current
    const k = rt.anim === 'walk' ? 18 : 9
    for (const key of Object.keys(c) as (keyof Pose)[]) c[key] = damp(c[key], target[key], key === 'sit' ? 6 : k, dt)
    const set = (g: React.RefObject<THREE.Object3D | null>, x: number, z = 0) => { if (g.current) { g.current.rotation.x = x; g.current.rotation.z = z } }
    set(r.armL, c.armLx, c.armLz); set(r.foreL, c.foreL)
    set(r.armR, c.armRx, c.armRz); set(r.foreR, c.foreR)
    set(r.legL, c.legL); set(r.shinL, c.shinL)
    set(r.legR, c.legR); set(r.shinR, c.shinR)
    if (head.current) head.current.rotation.set(c.headX, c.headY, c.headZ)
    if (torso.current) torso.current.rotation.x = c.torsoX
    if (body.current) {
      body.current.position.y = c.bob - c.sit * 0.05
    }
    // blink
    if (eyes.current) eyes.current.scale.y = (t % 3.7) < 0.12 ? 0.15 : 1
    if (mouth.current) mouth.current.scale.y = rt.anim === 'talking' ? 0.35 + Math.abs(Math.sin(t * 11)) * 0.6 : rt.anim === 'celebrate' || rt.anim === 'done' ? 0.8 : 0.35
    if (paper.current) paper.current.visible = rt.anim === 'reading'
  })

  const L = look
  const s = look.height
  return (
    <group scale={[s, s, s]}>
      <group ref={body}>
        {/* legs */}
        {([1, -1] as const).map((side) => (
          <group key={side} position={[side * 0.1, 0.5, 0]}>
            <Limb refs={side === 1 ? { a: r.legL, b: r.shinL } : { a: r.legR, b: r.shinR }} />
          </group>
        ))}
        <bone ref={root} />
        <bone ref={torso} position={[0, 0.52, 0]}>
          {/* hips + torso */}
          {id === 'alex' && (
            <group>
              <mesh position={[0, 0.42, 0.13]} rotation-x={-0.25} material={L.topAccent}><coneGeometry args={[0.1, 0.16, 3]} /></mesh>
              <RoundedBox args={[0.055, 0.22, 0.02]} radius={0.01} position={[0, 0.3, 0.19]} rotation={[-0.15, 0, 0]} material={L.extra} />
              <mesh position={[0.11, 0.24, 0.165]} material={L.topAccent}><boxGeometry args={[0.06, 0.012, 0.012]} /></mesh>
            </group>
          )}
          {id === 'milo' && (
            <group>
              <mesh position={[0, 0.5, -0.06]} rotation-x={Math.PI / 2 + 0.3} material={L.top}><torusGeometry args={[0.15, 0.06, 8, 16]} /></mesh>
              <mesh position={[0, 0.48, 0.02]} rotation-x={Math.PI / 2} material={L.extra}><torusGeometry args={[0.17, 0.03, 8, 20]} /></mesh>
              {[-1, 1].map((sd) => <RoundedBox key={sd} args={[0.06, 0.1, 0.1]} radius={0.025} position={[sd * 0.17, 0.48, 0.03]} material={L.extra} />)}
              <RoundedBox args={[0.2, 0.08, 0.02]} radius={0.02} position={[0, 0.2, 0.19]} material={L.topAccent} />
            </group>
          )}
          {id === 'luna' && (
            <group>
              <RoundedBox args={[0.12, 0.34, 0.03]} radius={0.012} position={[0, 0.3, 0.18]} material={L.topAccent} />
              {[0.36, 0.28, 0.2].map((y) => <mesh key={y} position={[0.075, y, 0.195]} material={L.extra}><sphereGeometry args={[0.012, 6, 6]} /></mesh>)}
            </group>
          )}
          {/* neck + head */}
          <group ref={head} position={[0, 0.6, 0]}>
            <mesh position={[0, 0.0, 0]} material={L.skin}><cylinderGeometry args={[0.07, 0.08, 0.1, 10]} /></mesh>
            <mesh position={[0, 0.27, 0]} material={L.skin}><sphereGeometry args={[0.27, 22, 16]} /></mesh>
            {[-1, 1].map((sd) => <mesh key={sd} position={[sd * 0.265, 0.25, 0]} material={L.skin}><sphereGeometry args={[0.05, 8, 6]} /></mesh>)}
            <Face id={id} look={L} eyes={eyes} mouth={mouth} />
            <Hair id={id} look={L} />
          </group>
          {/* arms */}
          {([1, -1] as const).map((side) => (
            <group key={side} position={[side * 0.25, 0.47, 0]}>
              <Limb refs={side === 1 ? { a: r.armL, b: r.foreL } : { a: r.armR, b: r.foreR }} />
            </group>
          ))}
          {/* clipboard for reading (Luna) */}
          <group ref={paper} position={[0, 0.2, 0.36]} rotation={[-0.9, 0, 0]} visible={false}>
            <RoundedBox args={[0.3, 0.38, 0.02]} radius={0.008} material={L.shoes} />
            <mesh position={[0, 0, 0.012]}><planeGeometry args={[0.26, 0.33]} /><meshStandardMaterial color="#fffdf6" /></mesh>
          </group>
        </bone>
      </group>
    </group>
  )
}