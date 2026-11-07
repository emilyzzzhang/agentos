/**
 * Skinned body mesh shared by all characters: torso, arms, hands, legs and shoes.
 *
 * The shape is an SDF of rounded cones and ellipsoids joined with smooth unions, meshed once with
 * surface nets. Blending is limited by height so the arms don't web into the torso and the legs
 * don't merge. Clothing colours are split in the shader from per-vertex boundary values, so the
 * edges don't follow the triangles.
 *
 * Rest-pose joints must match the rig in Character.tsx: torso pivot y 0.52; shoulders (±0.25, 0.99);
 * elbows and knees 0.24 below their parent joint; wrists 0.2 below the elbow; hips (±0.1, 0.5).
 */
import * as THREE from 'three'

// Bone order used for skinIndex; Character.tsx passes its bones in exactly this order.
export const BONES = ['root', 'torso', 'armL', 'foreL', 'armR', 'foreR', 'legL', 'shinL', 'legR', 'shinR'] as const
const B = Object.fromEntries(BONES.map((b, i) => [b, i])) as Record<(typeof BONES)[number], number>

type V = [number, number, number]
const SH_Y = 0.99
const ELBOW_Y = SH_Y - 0.24
const WRIST_Y = ELBOW_Y - 0.2
const HIP_Y = 0.5
const KNEE_Y = HIP_Y - 0.24
const ANKLE_Y = KNEE_Y - 0.2

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const smoothstep = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t) }
const smin = (a: number, b: number, k: number) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25 }

/** Rounded cone between a (radius r1) and b (radius r2), Inigo Quilez's exact SDF. */
function roundCone(px: number, py: number, pz: number, a: V, b: V, r1: number, r2: number) {
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2]
  const l2 = bax * bax + bay * bay + baz * baz
  const rr = r1 - r2
  const a2 = l2 - rr * rr
  const il2 = 1 / l2
  const pax = px - a[0], pay = py - a[1], paz = pz - a[2]
  const y = pax * bax + pay * bay + paz * baz
  const z = y - l2
  const qx = pax * l2 - bax * y, qy = pay * l2 - bay * y, qz = paz * l2 - baz * y
  const x2 = qx * qx + qy * qy + qz * qz
  const y2 = y * y * l2
  const z2 = z * z * l2
  const k = Math.sign(rr) * rr * rr * x2
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1
}

/** Ellipsoid (approximate SDF, accurate near the surface). */
function ellipsoid(px: number, py: number, pz: number, c: V, r: V) {
  const x = px - c[0], y = py - c[1], z = pz - c[2]
  const k0 = Math.hypot(x / r[0], y / r[1], z / r[2])
  const k1 = Math.hypot(x / (r[0] * r[0]), y / (r[1] * r[1]), z / (r[2] * r[2]))
  return k1 === 0 ? -Math.min(...r) : (k0 * (k0 - 1)) / k1
}

type Part = 'torso' | 'pelvis' | 'upperArm' | 'forearm' | 'hand' | 'thigh' | 'shin' | 'shoe'

/** Distance to each body part at p (limbs on the same side as p). */
function parts(x: number, y: number, z: number) {
  const s = x >= 0 ? 1 : -1
  // torso slightly narrower than deep so the arms hang free beside it; shoulders as a soft bar; neck
  const torso = smin(
    smin(roundCone(x / 0.9, y, z, [0, 0.62, 0], [0, 0.88, 0], 0.158, 0.185) * 0.9,
      roundCone(x, y, z / 0.85, [-0.19, 0.965, 0], [0.19, 0.965, 0], 0.085, 0.085) * 0.85, 0.07),
    roundCone(x, y, z, [0, 1.0, -0.005], [0, 1.13, -0.005], 0.1, 0.068), 0.04)
  const pelvis = ellipsoid(x, y, z, [0, 0.5, -0.005], [0.17, 0.12, 0.128])
  const ax = s * 0.25
  const upperArm = roundCone(x, y, z, [ax, SH_Y, 0], [ax, ELBOW_Y, 0], 0.064, 0.049)
  const forearm = roundCone(x, y, z, [ax, ELBOW_Y, 0], [ax, WRIST_Y + 0.005, 0], 0.049, 0.037)
  const hand = smin(ellipsoid(x, y, z, [ax, WRIST_Y - 0.03, 0], [0.04, 0.058, 0.035]),
    ellipsoid(x, y, z, [ax, WRIST_Y - 0.008, 0.036], [0.021, 0.03, 0.021]), 0.012)
  const lx = s * 0.1
  const thigh = roundCone(x, y, z, [lx, HIP_Y, 0], [lx, KNEE_Y, 0], 0.083, 0.061)
  const shin = roundCone(x, y, z, [lx, KNEE_Y, 0], [lx, ANKLE_Y + 0.01, 0], 0.061, 0.043)
  const shoe = smin(ellipsoid(x, y, z, [lx, 0.034, 0.04], [0.068, 0.045, 0.118]),
    ellipsoid(x, y, z, [lx, 0.046, -0.02], [0.05, 0.044, 0.05]), 0.02)
  return { s, torso, pelvis, upperArm, forearm, hand, thigh, shin, shoe }
}

function sdf(x: number, y: number, z: number) {
  const p = parts(x, y, z)
  let body = smin(p.torso, p.pelvis, 0.07)
  // arms blend into the shoulder only, legs into the pelvis only (no armpit or crotch webbing)
  const arm = smin(Math.min(p.upperArm, p.forearm), p.hand, 0.014)
  body = smin(body, arm, 0.002 + 0.05 * smoothstep(0.86, 0.97, y))
  const leg = smin(Math.min(p.thigh, p.shin), p.shoe, 0.02)
  body = smin(body, leg, 0.002 + 0.05 * smoothstep(0.4, 0.5, y))
  return body
}

function nearestPart(x: number, y: number, z: number): { part: Part; s: number } {
  const p = parts(x, y, z)
  let best: Part = 'torso'
  for (const k of ['pelvis', 'upperArm', 'forearm', 'hand', 'thigh', 'shin', 'shoe'] as Part[]) if (p[k] < p[best]) best = k
  return { part: best, s: p.s }
}

/** Skin weights (4 bones) for a rest-pose vertex. */
function weights(x: number, y: number, z: number): [number[], number[]] {
  const { part, s } = nearestPart(x, y, z)
  const L = s > 0
  const out: [number, number][] = []
  if (part === 'torso' || part === 'pelvis') {
    const wt = smoothstep(0.5, 0.66, y) // the waist bends with the torso; the hips stay with the body
    out.push([B.torso, wt], [B.root, 1 - wt])
  } else if (part === 'upperArm' || part === 'forearm' || part === 'hand') {
    const t = SH_Y - y
    const wa = smoothstep(-0.02, 0.07, t) // shoulder: torso → arm
    const wf = part === 'hand' ? 1 : smoothstep(0.205, 0.275, t) // elbow: arm → forearm
    out.push([B.torso, 1 - wa], [L ? B.armL : B.armR, wa * (1 - wf)], [L ? B.foreL : B.foreR, wa * wf])
  } else {
    const t = HIP_Y - y
    const wl = part === 'shoe' ? 1 : smoothstep(-0.04, 0.05, t) // hip: body → thigh
    const ws = part === 'shoe' ? 1 : smoothstep(0.205, 0.275, t) // knee: thigh → shin
    out.push([B.root, 1 - wl], [L ? B.legL : B.legR, wl * (1 - ws)], [L ? B.shinL : B.shinR, wl * ws])
  }
  while (out.length < 4) out.push([0, 0])
  const sum = out.reduce((a, [, w]) => a + w, 0) || 1
  return [out.map(([i]) => i), out.map(([, w]) => w / sum)]
}

/**
 * Smooth values whose zero crossing is a clothing edge (interpolated per pixel by the GPU):
 * x: waistband, below 0 is trousers; y: skin (hands past the cuff, neck above the collar);
 * z: shoe line, above 0 is the shoe.
 */
function boundaries(x: number, y: number, z: number): V {
  const p = parts(x, y, z)
  const { part } = nearestPart(x, y, z)
  const arm = part === 'upperArm' || part === 'forearm' || part === 'hand'
  const leg = part === 'thigh' || part === 'shin' || part === 'shoe'
  // height lines (not part boundaries, which follow the triangles) for the waistband and the collar
  const waist = arm ? 1 : leg ? Math.min(y - 0.565, -0.001) : y - 0.565
  const skin = arm ? p.forearm - p.hand : leg ? -1 : y - 1.06
  const shoe = leg ? p.shin - p.shoe : -1
  return [waist, skin, shoe]
}

/** Surface nets over the SDF, then projection onto the surface and gradient normals. */
function buildBase() {
  const h = 0.0135
  const min: V = [-0.36, -0.03, -0.2]
  const max: V = [0.36, 1.2, 0.2]
  const nx = Math.ceil((max[0] - min[0]) / h) + 1
  const ny = Math.ceil((max[1] - min[1]) / h) + 1
  const nz = Math.ceil((max[2] - min[2]) / h) + 1
  const idx = (i: number, j: number, k: number) => i + nx * (j + ny * k)
  const val = new Float32Array(nx * ny * nz)
  // Coarse pass every C cells. A distance field changes by at most ~1 per unit moved, so a fine point
  // whose nearest coarse sample is far from the surface keeps that sample's (sign-correct) value;
  // only points near the surface are evaluated exactly.
  const C = 4
  const cx = Math.ceil(nx / C) + 1, cy = Math.ceil(ny / C) + 1, cz = Math.ceil(nz / C) + 1
  const coarse = new Float32Array(cx * cy * cz)
  for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++)
    coarse[i + cx * (j + cy * k)] = sdf(min[0] + i * C * h, min[1] + j * C * h, min[2] + k * C * h)
  const far = C * h * 1.2 // > half the coarse cell diagonal, with margin for the approximate shapes
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const dc = coarse[Math.round(i / C) + cx * (Math.round(j / C) + cy * Math.round(k / C))]
    val[idx(i, j, k)] = Math.abs(dc) > far ? dc : sdf(min[0] + i * h, min[1] + j * h, min[2] + k * h)
  }

  const cellVert = new Int32Array(nx * ny * nz).fill(-1)
  const pos: number[] = []
  const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]]
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]]
  const cv = new Float32Array(8)
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let inside = 0
    for (let q = 0; q < 8; q++) { cv[q] = val[idx(i + corners[q][0], j + corners[q][1], k + corners[q][2])]; if (cv[q] < 0) inside++ }
    const v = cv
    if (inside === 0 || inside === 8) continue
    let sx = 0, sy = 0, sz = 0, n = 0
    for (const [e0, e1] of edges) {
      const a = v[e0], b = v[e1]
      if ((a < 0) === (b < 0)) continue
      const t = a / (a - b)
      const c0 = corners[e0], c1 = corners[e1]
      sx += c0[0] + (c1[0] - c0[0]) * t
      sy += c0[1] + (c1[1] - c0[1]) * t
      sz += c0[2] + (c1[2] - c0[2]) * t
      n++
    }
    cellVert[idx(i, j, k)] = pos.length / 3
    pos.push(min[0] + (i + sx / n) * h, min[1] + (j + sy / n) * h, min[2] + (k + sz / n) * h)
  }

  // one quad per sign-changing grid edge, joining the four cells around it
  const tri: number[] = []
  const quad = (a: number, b: number, c: number, d: number) => { if (a < 0 || b < 0 || c < 0 || d < 0) return; tri.push(a, b, c, a, c, d) }
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const v0 = val[idx(i, j, k)] < 0
    if (v0 !== val[idx(i + 1, j, k)] < 0)
      quad(cellVert[idx(i, j - 1, k - 1)], cellVert[idx(i, j, k - 1)], cellVert[idx(i, j, k)], cellVert[idx(i, j - 1, k)])
    if (v0 !== val[idx(i, j + 1, k)] < 0)
      quad(cellVert[idx(i - 1, j, k - 1)], cellVert[idx(i, j, k - 1)], cellVert[idx(i, j, k)], cellVert[idx(i - 1, j, k)])
    if (v0 !== val[idx(i, j, k + 1)] < 0)
      quad(cellVert[idx(i - 1, j - 1, k)], cellVert[idx(i, j - 1, k)], cellVert[idx(i, j, k)], cellVert[idx(i - 1, j, k)])
  }

  // project vertices onto the surface; normals from the gradient
  // one-sided differences: d and the gradient from 4 evaluations
  const e = 0.001
  const probe = (x: number, y: number, z: number) => {
    const d = sdf(x, y, z)
    return [d, (sdf(x + e, y, z) - d) / e, (sdf(x, y + e, z) - d) / e, (sdf(x, y, z + e) - d) / e]
  }
  const nrm: number[] = []
  for (let v = 0; v < pos.length; v += 3) {
    let x = pos[v], y = pos[v + 1], z = pos[v + 2]
    let [d, gx, gy, gz] = probe(x, y, z)
    for (let it = 0; it < 2; it++) {
      const l2 = gx * gx + gy * gy + gz * gz
      if (l2 < 1e-12) break
      x -= (gx * d) / l2; y -= (gy * d) / l2; z -= (gz * d) / l2
      ;[d, gx, gy, gz] = probe(x, y, z)
    }
    pos[v] = x; pos[v + 1] = y; pos[v + 2] = z
    const l = Math.hypot(gx, gy, gz) || 1
    nrm.push(gx / l, gy / l, gz / l)
  }
  // outward winding: flip any triangle whose face normal opposes the field gradient
  for (let t = 0; t < tri.length; t += 3) {
    const a = tri[t] * 3, b = tri[t + 1] * 3, c = tri[t + 2] * 3
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2]
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2]
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx
    const dot = fx * (nrm[a] + nrm[b] + nrm[c]) + fy * (nrm[a + 1] + nrm[b + 1] + nrm[c + 1]) + fz * (nrm[a + 2] + nrm[b + 2] + nrm[c + 2])
    if (dot < 0) { const tmp = tri[t + 1]; tri[t + 1] = tri[t + 2]; tri[t + 2] = tmp }
  }

  const count = pos.length / 3
  const skinIndex = new Uint16Array(count * 4)
  const skinWeight = new Float32Array(count * 4)
  const edge = new Float32Array(count * 3)
  for (let v = 0; v < count; v++) {
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2]
    const [bi, bw] = weights(x, y, z)
    skinIndex.set(bi, v * 4)
    skinWeight.set(bw, v * 4)
    edge.set(boundaries(x, y, z), v * 3)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3))
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4))
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4))
  g.setAttribute('clothEdge', new THREE.Float32BufferAttribute(edge, 3))
  g.setIndex(tri)
  g.computeBoundingSphere()
  return g
}

let base: THREE.BufferGeometry | null = null

/** The shared body geometry (same shape for every character; built on first use, kept for the session). */
export function bodyGeometry() {
  base ??= buildBase()
  return base
}

export interface BodyColors { top: THREE.Color; bottom: THREE.Color; skin: THREE.Color; shoes: THREE.Color }

/** Standard lit material that paints one character's clothing colours along the stored edges. */
export function bodyMaterial(c: BodyColors) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.8 })
  m.onBeforeCompile = (sh) => {
    sh.uniforms.cTop = { value: c.top }
    sh.uniforms.cBottom = { value: c.bottom }
    sh.uniforms.cSkin = { value: c.skin }
    sh.uniforms.cShoes = { value: c.shoes }
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 clothEdge;\nvarying vec3 vClothEdge;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvClothEdge = clothEdge;')
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 cTop, cBottom, cSkin, cShoes;\nvarying vec3 vClothEdge;\nfloat edgeMask(float v) { float w = fwidth(v) * 0.75 + 1e-5; return smoothstep(-w, w, v); }')
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 cloth = mix(cBottom, cTop, edgeMask(vClothEdge.x));
        cloth = mix(cloth, cSkin, edgeMask(vClothEdge.y));
        cloth = mix(cloth, cShoes, edgeMask(vClothEdge.z));
        diffuseColor.rgb *= cloth;`)
  }
  return m
}
