import * as THREE from 'three'

/** Shared materials: one instance per look keeps the material/shader count small. */
const std = (color: string, roughness = 0.8, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, ...extra })

export const M = {
  wallCream: std('#f4e6d2', 0.95),
  wallWarm: std('#efd9bf', 0.95),
  wainscot: std('#b98257', 0.7),
  trim: std('#8c5a3a', 0.6),
  woodLight: std('#d9a873', 0.6),
  woodMid: std('#b97d4b', 0.6),
  woodDark: std('#7a4b2e', 0.55),
  walnut: std('#5e3a26', 0.5),
  slab: std('#6b4329', 0.7),
  metalDark: std('#3c3a3f', 0.4, { metalness: 0.4 }),
  metalLight: std('#c9c4bc', 0.35, { metalness: 0.5 }),
  plasticDark: std('#2e2c33', 0.5),
  plasticCream: std('#f3ece0', 0.6),
  screenOff: std('#232a36', 0.3, { emissive: new THREE.Color('#1a2433'), emissiveIntensity: 0.4 }),
  paper: std('#fffdf6', 0.9),
  paperWarm: std('#fbf3e1', 0.9),
  cork: std('#c9925b', 1),
  potTerracotta: std('#c46a45', 0.85),
  potCream: std('#efe6d8', 0.8),
  leaf1: std('#5e9a5a', 0.8, { flatShading: true }),
  leaf2: std('#4a8250', 0.8, { flatShading: true }),
  leaf3: std('#79b06a', 0.8, { flatShading: true }),
  soil: std('#4a3326', 1),
  sofa: std('#d98c63', 0.9),
  sofaCushion: std('#e8a47c', 0.95),
  rugA: std('#e9c99a', 1),
  rugB: std('#c8754f', 1),
  rugC: std('#f6e5c8', 1),
  rugBlue: std('#6f8fae', 1),
  glass: new THREE.MeshStandardMaterial({ color: '#cfe8f5', emissive: new THREE.Color('#fff1d6'), emissiveIntensity: 0.9, roughness: 0.2 }),
  curtain: std('#e8c49a', 1),
  lampShade: new THREE.MeshStandardMaterial({ color: '#fff0d0', emissive: new THREE.Color('#ffd99a'), emissiveIntensity: 0.9, roughness: 0.9 }),
  gold: std('#d4a64a', 0.35, { metalness: 0.6 }),
  white: std('#ffffff', 0.7),
  red: std('#d65a4a', 0.7),
  coffee: std('#3b2418', 0.4),
}

let floorTex: THREE.CanvasTexture | null = null
export function woodFloorTexture() {
  if (floorTex) return floorTex
  const c = document.createElement('canvas')
  c.width = c.height = 1024
  const g = c.getContext('2d')!
  const plankH = 64
  let seed = 7
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (let row = 0; row < 1024 / plankH; row++) {
    let x = -rnd() * 300
    while (x < 1024) {
      const len = 220 + rnd() * 260
      const l = 58 + rnd() * 10
      const hue = 26 + rnd() * 6
      g.fillStyle = `hsl(${hue} ${48 + rnd() * 10}% ${l}%)`
      g.fillRect(x, row * plankH, len, plankH)
      g.strokeStyle = `hsla(${hue} 40% 35% / 0.18)`
      g.lineWidth = 1.5
      for (let k = 0; k < 5; k++) {
        const y = row * plankH + 8 + rnd() * (plankH - 16)
        g.beginPath()
        g.moveTo(x, y)
        g.bezierCurveTo(x + len * 0.3, y + rnd() * 6 - 3, x + len * 0.7, y + rnd() * 6 - 3, x + len, y)
        g.stroke()
      }
      g.fillStyle = 'rgba(80,45,25,0.55)'
      g.fillRect(x, row * plankH, 2, plankH)
      x += len
    }
    g.fillStyle = 'rgba(80,45,25,0.5)'
    g.fillRect(0, row * plankH, 1024, 2)
  }
  floorTex = new THREE.CanvasTexture(c)
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping
  floorTex.repeat.set(4, 3)
  floorTex.colorSpace = THREE.SRGBColorSpace
  floorTex.anisotropy = 8
  return floorTex
}

let blobTex: THREE.CanvasTexture | null = null
export function blobTexture() {
  if (blobTex) return blobTex
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  const grd = g.createRadialGradient(64, 64, 4, 64, 64, 64)
  grd.addColorStop(0, 'rgba(60,35,20,0.55)')
  grd.addColorStop(0.6, 'rgba(60,35,20,0.22)')
  grd.addColorStop(1, 'rgba(60,35,20,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, 128, 128)
  blobTex = new THREE.CanvasTexture(c)
  return blobTex
}

let blobMat: THREE.MeshBasicMaterial | null = null
export function blobMaterial() {
  return (blobMat ??= new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false }))
}
