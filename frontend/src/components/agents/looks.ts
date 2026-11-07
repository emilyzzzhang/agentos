import * as THREE from 'three'
import type { AgentId } from '../../types'

const mat = (color: string, roughness = 0.75) => new THREE.MeshStandardMaterial({ color, roughness })

export interface Look {
  skin: THREE.Material
  hair: THREE.Material
  top: THREE.Material
  topAccent: THREE.Material
  bottom: THREE.Material
  shoes: THREE.Material
  extra: THREE.Material
  eye: THREE.Material
  cheek: THREE.Material
  height: number
}

const eye = mat('#2a1d18', 0.3)
const cheek = new THREE.MeshStandardMaterial({ color: '#f29b8f', roughness: 0.9, transparent: true, opacity: 0.55 })

export const LOOKS: Record<AgentId, Look> = {
  // Alex: navy blazer, white shirt, red tie, neat brown hair
  alex: { skin: mat('#f1c7a4'), hair: mat('#4a3426', 0.6), top: mat('#33416d'), topAccent: mat('#fbf7f0'), bottom: mat('#5a5e6b'), shoes: mat('#3a2a22', 0.5), extra: mat('#d44a3f'), eye, cheek, height: 1.06 },
  // Milo: green hoodie, curly dark hair, round glasses, orange headphones
  milo: { skin: mat('#c98e68'), hair: mat('#2b211c', 0.7), top: mat('#5a9a62'), topAccent: mat('#e9e2cf'), bottom: mat('#46618a'), shoes: mat('#f4f1ea', 0.6), extra: mat('#f0a04b', 0.5), eye, cheek, height: 1.0 },
  // Luna: terracotta cardigan, auburn hair in a bun, plum trousers, gold glasses
  luna: { skin: mat('#f6d2b8'), hair: mat('#8a3f2c', 0.6), top: mat('#c96a4a'), topAccent: mat('#f6e8cf'), bottom: mat('#6e4a7e'), shoes: mat('#2f2626', 0.5), extra: mat('#d9aa4a', 0.35), eye, cheek, height: 0.98 },
}
