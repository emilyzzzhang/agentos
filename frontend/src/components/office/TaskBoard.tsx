import { useCursor } from '@react-three/drei'
import { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { useRunStore } from '../../stores/runStore'
import { useUiStore } from '../../stores/uiStore'
import type { Task } from '../../types'
import { FURNITURE } from './layout'
import { M } from './materials'
import { RBox } from './primitives'

const NOTE: Record<Task['status'], string> = { assigned: '#ffe28a', in_progress: '#a9d6ff', done: '#bfe8a8', failed: '#f5aaa2' }
const LABEL: Record<Task['status'], string> = { assigned: 'TO DO', in_progress: 'DOING', done: 'DONE', failed: 'FAILED' }

function wrap(g: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number) {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    const test = line ? `${line} ${w}` : w
    if (g.measureText(test).width > maxW && line) {
      lines.push(line)
      line = w
      if (lines.length === maxLines) break
    } else line = test
  }
  if (lines.length < maxLines && line) lines.push(line)
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, '…')
  return lines
}

/** Cork board whose notes are drawn from the real mission plan and task statuses. */
export function TaskBoard() {
  const mission = useRunStore((s) => s.mission)
  const tasks = useRunStore((s) => s.tasks)
  const order = useRunStore((s) => s.taskOrder)
  const open = useUiStore((s) => s.setMissionOpen)
  const [hover, setHover] = useState(false)
  useCursor(hover)
  const canvas = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = 1024
    c.height = 680
    return c
  }, [])
  const texture = useMemo(() => {
    const t = new THREE.CanvasTexture(canvas)
    t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = 8
    return t
  }, [canvas])

  useEffect(() => {
    const g = canvas.getContext('2d')!
    g.fillStyle = '#c99260'
    g.fillRect(0, 0, 1024, 680)
    let seed = 11
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let i = 0; i < 1600; i++) {
      g.fillStyle = `rgba(${rnd() > 0.5 ? '120,75,40' : '235,190,140'},${0.15 + rnd() * 0.2})`
      g.fillRect(rnd() * 1024, rnd() * 680, 3, 3)
    }
    g.fillStyle = '#fffaf0'
    g.fillRect(28, 24, 968, 112)
    g.fillStyle = '#e07a4f'
    g.font = '900 30px Nunito, system-ui, sans-serif'
    g.fillText('MISSION BOARD', 48, 64)
    g.fillStyle = '#3b2a20'
    g.font = '700 28px Nunito, system-ui, sans-serif'
    const q = mission?.question ?? 'Waiting for a mission… type a research question below.'
    wrap(g, q, 920, 1).forEach((l, i) => g.fillText(l, 48, 108 + i * 30))
    const shown = order.map((id) => tasks[id]).filter((t) => t && t.from !== 'milo').slice(0, 6)
    const noteW = 300
    const noteH = 230
    shown.forEach((t, i) => {
      const col = i % 3
      const row = Math.floor(i / 3)
      const x = 40 + col * 322
      const y = 160 + row * 252
      g.save()
      g.translate(x + noteW / 2, y + noteH / 2)
      g.rotate(((i * 37) % 7 - 3) * 0.008)
      g.fillStyle = 'rgba(60,30,10,0.25)'
      g.fillRect(-noteW / 2 + 6, -noteH / 2 + 8, noteW, noteH)
      g.fillStyle = NOTE[t.status]
      g.fillRect(-noteW / 2, -noteH / 2, noteW, noteH)
      g.fillStyle = '#d6453a'
      g.beginPath()
      g.arc(0, -noteH / 2 + 14, 9, 0, Math.PI * 2)
      g.fill()
      g.fillStyle = 'rgba(40,25,15,0.65)'
      g.font = '900 20px Nunito, system-ui, sans-serif'
      g.fillText(`${LABEL[t.status]} · ${t.assignee.toUpperCase()}`, -noteW / 2 + 18, -noteH / 2 + 50)
      g.fillStyle = '#2b1d14'
      g.font = '800 27px Nunito, system-ui, sans-serif'
      wrap(g, t.title, noteW - 36, 4).forEach((l, k) => g.fillText(l, -noteW / 2 + 18, -noteH / 2 + 88 + k * 32))
      g.restore()
    })
    if (mission && !shown.length) {
      g.fillStyle = '#fffaf0'
      g.font = '800 30px Nunito, system-ui, sans-serif'
      g.fillText('Alex is drafting the plan…', 48, 220)
    }
    texture.needsUpdate = true
  }, [canvas, texture, mission, tasks, order])

  // re-draw once fonts are ready so canvas text uses Nunito
  useEffect(() => {
    document.fonts?.ready.then(() => { texture.needsUpdate = true })
  }, [texture])

  const { x, z } = FURNITURE.taskBoard
  return (
    <group
      position={[x + 0.04, 1.85, z]}
      rotation-y={Math.PI / 2}
      onClick={(e) => { e.stopPropagation(); open(true) }}
      onPointerOver={(e) => { e.stopPropagation(); setHover(true) }}
      onPointerOut={() => setHover(false)}
    >
      <RBox size={[2.6, 1.78, 0.06]} material={M.woodDark} radius={0.03} />
      <mesh position={[0, 0, 0.035]}>
        <planeGeometry args={[2.44, 1.62]} />
        <meshStandardMaterial map={texture} roughness={0.95} emissive="#ffffff" emissiveMap={texture} emissiveIntensity={hover ? 0.35 : 0.12} />
      </mesh>
    </group>
  )
}
