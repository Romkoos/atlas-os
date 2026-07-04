import * as THREE from 'three'

// Reusable scene builders for the 3D galaxy views (Knowledge Galaxy3D and the
// Dashboard's decorative DecorGalaxy3D). Pure THREE code — no React.

// Glow color for the animated edges (particle stream + comet impulse). Bright
// enough to blow out into the bloom pass.
export const EDGE_GLOW = '#8fb8ff'

// 'pulse' style = a comet/discharge fired along each edge on a loop: it streaks
// from source to target, then the edge rests before the next pulse. Rendered as a
// single THREE.Points system (one draw call) so it scales to thousand-edge graphs.
const COMET_CYCLE_SEC = 3.2 // full period per edge (flight + idle rest)
const COMET_ACTIVE_FRAC = 0.24 // fraction of the period the comet is in flight (lower = faster streak)
const COMET_TAIL_SAMPLES = 8 // points per comet (head + tail)
// Spacing between tail points in WORLD units (not a fraction of the edge), so the
// comet keeps the same tight length and never gaps out on long edges.
const COMET_TAIL_GAP_WORLD = 1.6
const COMET_SIZE = 4.5 // point-sprite size (world units, size-attenuated)
const COMET_BRIGHTNESS = 0.95 // near 1 keeps heads visible but out of the bloom blowout

// A single soft radial-gradient texture, reused by the nebula sprites and the
// selection halo. White so sprite.material.color can tint it per instance.
export function makeGlowTexture(): THREE.Texture {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.25, 'rgba(255,255,255,0.55)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, size, size)
  }
  return new THREE.CanvasTexture(canvas)
}

// One spherical shell of stars. Multiple shells at different radii give real
// parallax: near stars sweep across the view faster than far ones as the camera
// orbits. Cheap — one draw call per shell.
export function makeStarLayer(
  count: number,
  rMin: number,
  rMax: number,
  size: number,
  opacity: number,
  color: number,
): THREE.Points {
  const positions = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const r = rMin + Math.random() * (rMax - rMin)
    const theta = Math.random() * Math.PI * 2
    const phi = Math.acos(2 * Math.random() - 1)
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta)
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta)
    positions[i * 3 + 2] = r * Math.cos(phi)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const material = new THREE.PointsMaterial({
    color,
    size,
    sizeAttenuation: true,
    transparent: true,
    opacity,
    depthWrite: false,
  })
  const points = new THREE.Points(geometry, material)
  points.name = 'galaxy-starfield'
  return points
}

// Faint tinted nebula clouds far out, for depth and atmosphere. Additive so they
// only ever brighten the black backdrop; very low opacity so they never compete
// with the graph itself.
export function makeNebula(tex: THREE.Texture): THREE.Group {
  const group = new THREE.Group()
  group.name = 'galaxy-nebula'
  const tints = [0x2b1a55, 0x123a5e, 0x0e3d3a, 0x3a1440, 0x1a2a5e]
  for (let i = 0; i < 5; i++) {
    const material = new THREE.SpriteMaterial({
      map: tex,
      color: tints[i % tints.length],
      transparent: true,
      opacity: 0.1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    const sprite = new THREE.Sprite(material)
    const r = 1600 + Math.random() * 1400
    const theta = Math.random() * Math.PI * 2
    const phi = Math.acos(2 * Math.random() - 1)
    sprite.position.set(
      r * Math.sin(phi) * Math.cos(theta),
      r * Math.sin(phi) * Math.sin(theta),
      r * Math.cos(phi),
    )
    const s = 1400 + Math.random() * 1200
    sprite.scale.set(s, s, 1)
    group.add(sprite)
  }
  return group
}

export interface CometSystem {
  points: THREE.Points
  tick: (nowSec: number) => void
  dispose: () => void
}

interface CometNode {
  id: string
  x?: number
  y?: number
  z?: number
}

// The 'pulse' edge style: a comet/discharge fired along each edge on a loop.
// All comets live in a single THREE.Points system (one draw call, N·K vertices)
// so it stays cheap on thousand-edge graphs. Node objects are the LIVE layout
// objects (mutated in place by the force engine), so tick() always reads current
// positions — during and after the sim settles. Off-window points go black
// (invisible under additive blending).
export function createCometSystem(
  nodes: CometNode[],
  links: Array<{ source: string | CometNode; target: string | CometNode }>,
): CometSystem | null {
  const nodeById = new Map<string, CometNode>()
  for (const n of nodes) nodeById.set(n.id, n)
  const endpointOf = (ref: string | CometNode): CometNode | undefined =>
    typeof ref === 'object' ? ref : nodeById.get(ref)
  // Resolve the drawable edges once; give each a golden-ratio phase so the
  // discharges are scattered in time rather than firing in unison.
  const edges: Array<{ s: CometNode; t: CometNode; phase: number }> = []
  let idx = 0
  for (const link of links) {
    const s = endpointOf(link.source)
    const t = endpointOf(link.target)
    if (!s || !t) continue
    edges.push({ s, t, phase: (idx++ * 0.618033988749895) % 1 })
  }
  const N = edges.length
  if (N === 0) return null
  const K = COMET_TAIL_SAMPLES
  const positions = new Float32Array(N * K * 3)
  const colors = new Float32Array(N * K * 3)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  const tex = makeGlowTexture()
  const material = new THREE.PointsMaterial({
    map: tex,
    size: COMET_SIZE,
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  })
  const points = new THREE.Points(geometry, material)
  points.name = 'galaxy-comets'
  points.frustumCulled = false // heads move every frame; skip stale-bbox culling
  const base = new THREE.Color(EDGE_GLOW)
  const posAttr = geometry.getAttribute('position')
  const colAttr = geometry.getAttribute('color')
  const tick = (now: number): void => {
    for (let e = 0; e < N; e++) {
      const { s, t, phase } = edges[e]
      const sx = s.x ?? 0
      const sy = s.y ?? 0
      const sz = s.z ?? 0
      const dx = (t.x ?? 0) - sx
      const dy = (t.y ?? 0) - sy
      const dz = (t.z ?? 0) - sz
      const len = Math.hypot(dx, dy, dz) || 1
      // Convert the fixed world-space tail spacing into a fraction of THIS edge
      // so the comet stays a constant, gap-free length on short and long edges.
      const gapFrac = COMET_TAIL_GAP_WORLD / len
      const cyc = (now / COMET_CYCLE_SEC + phase) % 1
      const active = cyc < COMET_ACTIVE_FRAC
      const head = active ? cyc / COMET_ACTIVE_FRAC : -1 // 0→1 along the edge
      // Envelope: emerge from the source, brighten mid-flight, fade into target.
      const env = active ? Math.sin(Math.PI * head) * COMET_BRIGHTNESS : 0
      for (let k = 0; k < K; k++) {
        const o = (e * K + k) * 3
        const hp = head - k * gapFrac // this tail point's position
        if (!active || hp < 0 || hp > 1) {
          // Off-window: park at source and go black (invisible when additive).
          positions[o] = sx
          positions[o + 1] = sy
          positions[o + 2] = sz
          colors[o] = 0
          colors[o + 1] = 0
          colors[o + 2] = 0
          continue
        }
        positions[o] = sx + dx * hp
        positions[o + 1] = sy + dy * hp
        positions[o + 2] = sz + dz * hp
        const inten = env * (1 - k / K) // tail dims behind the head
        colors[o] = base.r * inten
        colors[o + 1] = base.g * inten
        colors[o + 2] = base.b * inten
      }
    }
    posAttr.needsUpdate = true
    colAttr.needsUpdate = true
  }
  const dispose = (): void => {
    geometry.dispose()
    material.dispose()
    tex.dispose()
  }
  return { points, tick, dispose }
}
