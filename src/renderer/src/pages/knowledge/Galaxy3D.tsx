import { trpc } from '@renderer/lib/trpc'
import { forceCollide, forceX, forceY, forceZ } from 'd3-force-3d'
import { useEffect, useRef } from 'react'
import ForceGraph3D from 'react-force-graph-3d'
import * as THREE from 'three'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { clusterAnchors } from './cluster-anchors'

interface GalaxyNode {
  id: string
  x?: number
  y?: number
  z?: number
}

interface Galaxy3DProps {
  graphData: {
    nodes: GalaxyNode[]
    links: Array<{ source: string | GalaxyNode; target: string | GalaxyNode }>
  }
  width: number
  height: number
  nodeColor: (n: any) => string
  nodeVal: (n: any) => number
  nodeLabel: (n: any) => string
  clusterKey: (n: any) => string | number
  linkColor?: (l: any) => string
  onNodeClick?: (n: any) => void
  onNodeHover?: (n: any | null) => void
  // Selection-aware focus: when a node is selected, focusIds holds the ids that
  // stay lit (the node + its cluster + direct neighbors). Everything else is
  // dimmed toward the background so the focused sub-graph stands out.
  selectedId?: string | null
  focusIds?: Set<string> | null
}

const NODE_REL_SIZE = 5
const radiusOf = (nodeVal: number): number => Math.sqrt(Math.max(1, nodeVal)) * NODE_REL_SIZE
const BACKGROUND = '#000000'

// Directional link particles cost a sprite per particle per link, so they're
// gated to mid-size graphs. Bigger graphs should use the 'pulse' comet style,
// which is a single draw call and has no such cap.
const PARTICLE_LINK_BUDGET = 800

// In the animated ('particles' / 'pulse') styles the raw edge lines are kept
// barely visible — faint scaffolding while the animation carries the edge.
const FAINT_LINK = '#6a76a6'
const FAINT_LINK_OPACITY = 0.025

// Glow color for the animated edges (particle stream + comet impulse). Bright
// enough to blow out into the bloom pass.
const EDGE_GLOW = '#8fb8ff'
// Dimmed glow for edges outside the current focus set (matches the focus fog).
const EDGE_GLOW_DIM = '#1a2036'

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
function makeGlowTexture(): THREE.Texture {
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
function makeStarLayer(
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
function makeNebula(tex: THREE.Texture): THREE.Group {
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

// The pulsing halo drawn on the selected node. depthTest off + high renderOrder
// so it always reads on top of its node regardless of camera distance.
function makeHalo(tex: THREE.Texture): THREE.Sprite {
  const material = new THREE.SpriteMaterial({
    map: tex,
    color: 0xffffff,
    transparent: true,
    opacity: 0.6,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  })
  const sprite = new THREE.Sprite(material)
  sprite.name = 'galaxy-halo'
  sprite.visible = false
  sprite.renderOrder = 999
  return sprite
}

// Dim a node color toward the background (near-black) so it recedes into the
// "focus fog". Also drops it below the bloom threshold, so dimmed nodes stop
// glowing — reinforcing the focus.
function dimNodeColor(css: string): string {
  const c = new THREE.Color(css)
  c.multiplyScalar(0.14)
  return `#${c.getHexString()}`
}

export default function Galaxy3D({
  graphData,
  width,
  height,
  nodeColor,
  nodeVal,
  nodeLabel,
  clusterKey,
  linkColor,
  onNodeClick,
  onNodeHover,
  selectedId,
  focusIds,
}: Galaxy3DProps) {
  // react-force-graph-3d exposes no ref type.
  // biome-ignore lint/suspicious/noExplicitAny: ForceGraph ref has no exported type
  const fgRef = useRef<any>(null)
  // Shared with the selection effect so it can toggle auto-rotate and drive the
  // halo without re-running the one-time scene setup.
  // biome-ignore lint/suspicious/noExplicitAny: three controls has no exported type
  const controlsRef = useRef<any>(null)
  const haloRef = useRef<THREE.Sprite | null>(null)
  const pulseRaf = useRef<number | null>(null)
  // The idle auto-rotate timer must not resume rotation while a node is focused.
  const selectedRef = useRef<string | null>(selectedId ?? null)
  selectedRef.current = selectedId ?? null

  // Which edge style to render. Read from the shared app settings; falls back to
  // 'lines' until the query resolves (and on error).
  const settingsQuery = trpc.settings.get.useQuery()
  const edgeStyle = settingsQuery.data?.galaxyEdgeStyle ?? 'lines'

  // rAF handle for the 'pulse' edge animation (kept separate from the halo's
  // pulseRaf so the two loops never clobber each other).
  const pulseEdgeRaf = useRef<number | null>(null)

  // Pull each node toward its community's anchor point on a sphere so clusters
  // form distinct spatial regions ("galaxies"). Anchors are recomputed from the
  // current nodes' cluster keys whenever the visible set changes.
  //
  // We deliberately DO NOT call d3ReheatSimulation() here. react-force-graph-3d
  // builds its internal layout (state.layout) in a digest that is scheduled, not
  // synchronous, and it flips engineRunning=true only *after* state.layout is
  // assigned. Reheating ourselves flips engineRunning=true early, and if the
  // digest hasn't run yet the next requestAnimationFrame tick throws "Cannot read
  // properties of undefined (reading 'tick')" from inside the library's animation
  // loop — an async throw a React error boundary can't catch, so the canvas goes
  // black until a full refresh. A single-rAF defer only narrows that race; it
  // doesn't close it (a fresh mount from another page still loses reliably).
  //
  // The reheat is also unnecessary: the library already re-heats (alpha(1)) on
  // every graphData assignment, including the first digest of a fresh mount — and
  // this effect only fires on a graphData change — so setting the forces alone
  // (always safe: state.d3ForceLayout exists from init) is enough. The still-warm
  // engine picks them up on its next tick. This structurally removes the crash.
  // biome-ignore lint/correctness/useExhaustiveDependencies: set forces on data change only
  useEffect(() => {
    const fg = fgRef.current
    if (!fg) return
    const anchors = clusterAnchors(graphData.nodes.map((n) => clusterKey(n)))
    const anchorOf = (n: GalaxyNode) => anchors.get(String(clusterKey(n)))
    fg.d3Force('x', forceX((n: GalaxyNode) => anchorOf(n)?.x ?? 0).strength(0.12))
    fg.d3Force('y', forceY((n: GalaxyNode) => anchorOf(n)?.y ?? 0).strength(0.12))
    fg.d3Force('z', forceZ((n: GalaxyNode) => anchorOf(n)?.z ?? 0).strength(0.12))
    fg.d3Force('charge')?.strength(-120)
    fg.d3Force(
      'collide',
      forceCollide((n: GalaxyNode) => radiusOf(nodeVal(n)) + 2),
    )
  }, [graphData])

  // Frame the camera on the settled graph ourselves. The library's zoomToFit
  // aims at a hardcoded origin and no-ops when its bbox is unavailable, so on
  // small/degenerate per-project graphs (single node, link-less clouds) the
  // camera stayed at its big-graph default and the canvas rendered black.
  //
  // We aim at the bounding-box CENTER, not the mean of positions: an uneven
  // cluster distribution pulls the mean off the visual center, leaving the
  // cloud sitting high or low — and because auto-rotate orbits the aim point,
  // it stays off-center. The bbox midpoint is the true geometric center, so the
  // sphere lands dead-center. Distance fits the extent in BOTH axes (horizontal
  // FOV is narrower when the canvas is tall/narrow, e.g. with the panel open).
  const frameGraph = (): void => {
    const fg = fgRef.current
    if (!fg) return
    const nodes = graphData.nodes
    if (nodes.length === 0) return
    let minX = Infinity
    let minY = Infinity
    let minZ = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    let maxZ = -Infinity
    for (const n of nodes) {
      const x = n.x ?? 0
      const y = n.y ?? 0
      const z = n.z ?? 0
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      if (z < minZ) minZ = z
      if (z > maxZ) maxZ = z
    }
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    const cz = (minZ + maxZ) / 2
    let maxR = 0
    for (const n of nodes) {
      const r = Math.hypot((n.x ?? 0) - cx, (n.y ?? 0) - cy, (n.z ?? 0) - cz)
      if (r > maxR) maxR = r
    }
    const cam = fg.camera?.()
    const fov = ((cam?.fov ?? 50) * Math.PI) / 180
    const aspect = cam?.aspect ?? Math.max(width, 1) / Math.max(height, 1)
    const radius = Math.max(maxR + NODE_REL_SIZE * 3, 15)
    const vDist = radius / Math.tan(fov / 2)
    const hDist = radius / (Math.tan(fov / 2) * aspect)
    const distance = Math.max(vDist, hDist, 30)
    fg.cameraPosition({ x: cx, y: cy, z: cz + distance }, { x: cx, y: cy, z: cz }, 600)
  }

  // Visual effects: bloom glow, a layered parallax starfield, nebula clouds, a
  // reusable selection halo, and idle auto-rotation. Deferred a frame (like the
  // force setup) so the renderer/scene/controls exist, and fully torn down on
  // cleanup so a StrictMode double-mount doesn't stack duplicates. Mount-only.
  // biome-ignore lint/correctness/useExhaustiveDependencies: one-time scene setup
  useEffect(() => {
    const fg = fgRef.current
    if (!fg) return
    let bloom: UnrealBloomPass | null = null
    const stars: THREE.Points[] = []
    let nebula: THREE.Group | null = null
    let glowTex: THREE.Texture | null = null
    let halo: THREE.Sprite | null = null
    let idleTimer: ReturnType<typeof setTimeout> | null = null
    const onInteractionStart = (): void => {
      if (idleTimer) clearTimeout(idleTimer)
      if (controlsRef.current) controlsRef.current.autoRotate = false
    }
    const onInteractionEnd = (): void => {
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(() => {
        // Never resume rotation while a node is focused.
        if (controlsRef.current && !selectedRef.current) controlsRef.current.autoRotate = true
      }, 2500)
    }
    const raf = requestAnimationFrame(() => {
      const composer = fg.postProcessingComposer?.()
      if (composer) {
        bloom = new UnrealBloomPass(
          new THREE.Vector2(Math.max(width, 1), Math.max(height, 1)),
          0.5, // strength — gentle glow, not noisy
          0.55, // radius
          0.2, // threshold — bright cores glow, dim clutter stays flat
        )
        composer.addPass(bloom)
      }
      const scene = fg.scene?.()
      if (scene) {
        glowTex = makeGlowTexture()
        // Three parallax shells: dim near, brighter far, faint cool tint.
        stars.push(makeStarLayer(700, 1500, 2600, 3.2, 0.55, 0xbfd0ff))
        stars.push(makeStarLayer(900, 2800, 4200, 2.4, 0.7, 0xffffff))
        stars.push(makeStarLayer(1200, 4500, 7000, 1.8, 0.85, 0xdfe6ff))
        for (const layer of stars) scene.add(layer)
        nebula = makeNebula(glowTex)
        scene.add(nebula)
        halo = makeHalo(glowTex)
        haloRef.current = halo
        scene.add(halo)
      }
      const controls = fg.controls?.()
      controlsRef.current = controls
      if (controls) {
        controls.autoRotate = !selectedRef.current
        controls.autoRotateSpeed = 0.4
        controls.addEventListener?.('start', onInteractionStart)
        controls.addEventListener?.('end', onInteractionEnd)
      }
    })
    return () => {
      cancelAnimationFrame(raf)
      if (pulseRaf.current) cancelAnimationFrame(pulseRaf.current)
      pulseRaf.current = null
      if (idleTimer) clearTimeout(idleTimer)
      if (bloom) {
        fg.postProcessingComposer?.()?.removePass?.(bloom)
        bloom.dispose?.()
      }
      const scene = fg.scene?.()
      for (const layer of stars) {
        scene?.remove(layer)
        layer.geometry.dispose()
        ;(layer.material as THREE.Material).dispose()
      }
      if (nebula) {
        scene?.remove(nebula)
        for (const child of nebula.children) {
          ;((child as THREE.Sprite).material as THREE.Material).dispose()
        }
      }
      if (halo) {
        scene?.remove(halo)
        ;(halo.material as THREE.Material).dispose()
      }
      haloRef.current = null
      glowTex?.dispose()
      const controls = controlsRef.current
      if (controls) {
        controls.autoRotate = false
        controls.removeEventListener?.('start', onInteractionStart)
        controls.removeEventListener?.('end', onInteractionEnd)
      }
      controlsRef.current = null
    }
  }, [])

  // Drive the selection halo: park it on the selected node, tint it to the node's
  // color, and pulse its scale/opacity. Also pause auto-rotate while focused.
  useEffect(() => {
    if (controlsRef.current) controlsRef.current.autoRotate = !selectedId
    const halo = haloRef.current
    const stop = () => {
      if (pulseRaf.current) cancelAnimationFrame(pulseRaf.current)
      pulseRaf.current = null
      if (halo) halo.visible = false
    }
    if (!halo) return stop
    const node = selectedId ? graphData.nodes.find((n) => n.id === selectedId) : null
    if (!node || node.x == null) return stop
    halo.position.set(node.x, node.y ?? 0, node.z ?? 0)
    halo.material.color.set(new THREE.Color(nodeColor(node)))
    halo.visible = true
    const start = performance.now()
    const tick = (): void => {
      const t = (performance.now() - start) / 1000
      const s = 24 + Math.sin(t * 2.5) * 6
      halo.scale.set(s, s, 1)
      halo.material.opacity = 0.55 + Math.sin(t * 2.5) * 0.2
      pulseRaf.current = requestAnimationFrame(tick)
    }
    if (pulseRaf.current) cancelAnimationFrame(pulseRaf.current)
    pulseRaf.current = requestAnimationFrame(tick)
    return stop
  }, [selectedId, graphData, nodeColor])

  // 'pulse' edge style: a comet/discharge that streaks along each edge on a loop —
  // fly source→target, then the edge rests before the next pulse. All comets live
  // in a SINGLE THREE.Points system (one draw call, N·K vertices) so it stays cheap
  // on thousand-edge graphs — the old per-edge-mesh version only read well on tiny
  // graphs. Idle/off-window points go black (invisible under additive blending).
  //
  // We drive it from our own rAF loop rather than react-force-graph's
  // linkPositionUpdate, because that callback only fires while the layout engine is
  // running (it stops after cooldown, which would freeze the animation). Reading
  // the live node positions (mutated in place by the layout) keeps comets on their
  // edges both during and after the sim settles. Rebuilds on style/data change.
  useEffect(() => {
    if (edgeStyle !== 'pulse') return
    const fg = fgRef.current
    if (!fg) return
    let cleanup: (() => void) | null = null
    const start = requestAnimationFrame(() => {
      const scene = fg.scene?.()
      if (!scene) return
      const nodeById = new Map<string, GalaxyNode>()
      for (const n of graphData.nodes) nodeById.set(n.id, n)
      const endpointOf = (ref: string | GalaxyNode): GalaxyNode | undefined =>
        typeof ref === 'object' ? ref : nodeById.get(ref)
      // Resolve the drawable edges once; give each a golden-ratio phase so the
      // discharges are scattered in time rather than firing in unison.
      const edges: Array<{ s: GalaxyNode; t: GalaxyNode; phase: number }> = []
      let idx = 0
      for (const link of graphData.links) {
        const s = endpointOf(link.source)
        const t = endpointOf(link.target)
        if (!s || !t) continue
        edges.push({ s, t, phase: (idx++ * 0.618033988749895) % 1 })
      }
      const N = edges.length
      if (N === 0) return
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
      scene.add(points)
      const base = new THREE.Color(EDGE_GLOW)
      const posAttr = geometry.getAttribute('position')
      const colAttr = geometry.getAttribute('color')
      const tick = (): void => {
        const now = performance.now() / 1000
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
        pulseEdgeRaf.current = requestAnimationFrame(tick)
      }
      pulseEdgeRaf.current = requestAnimationFrame(tick)
      cleanup = () => {
        scene.remove(points)
        geometry.dispose()
        material.dispose()
        tex.dispose()
      }
    })
    return () => {
      cancelAnimationFrame(start)
      if (pulseEdgeRaf.current) cancelAnimationFrame(pulseEdgeRaf.current)
      pulseEdgeRaf.current = null
      cleanup?.()
    }
  }, [edgeStyle, graphData])

  // Dolly toward the clicked node WITHOUT changing the viewing angle: keep the
  // current camera→node direction and just move closer, framing the node. (The
  // old version teleported onto a fixed origin→node ray, which read as a reset.)
  const handleClick = (node: GalaxyNode): void => {
    const fg = fgRef.current
    const cam = fg?.camera?.()?.position
    if (fg && cam && node.x != null && node.y != null) {
      const nz = node.z ?? 0
      let dx = cam.x - node.x
      let dy = cam.y - node.y
      let dz = cam.z - nz
      const len = Math.hypot(dx, dy, dz) || 1
      dx /= len
      dy /= len
      dz /= len
      const distance = 90 // target distance from the node; angle is preserved
      fg.cameraPosition(
        { x: node.x + dx * distance, y: node.y + dy * distance, z: nz + dz * distance },
        { x: node.x, y: node.y, z: nz },
        800,
      )
    }
    onNodeClick?.(node)
  }

  const focusActive = Boolean(selectedId && focusIds)
  const effNodeColor = (n: GalaxyNode): string => {
    const base = nodeColor(n)
    if (!focusActive) return base
    return focusIds?.has(n.id) ? base : dimNodeColor(base)
  }
  const baseLink = linkColor ?? (() => 'rgba(160,170,205,0.5)')
  const effLinkColor = (l: {
    source: string | GalaxyNode
    target: string | GalaxyNode
  }): string => {
    if (!focusActive) return baseLink(l)
    const s = typeof l.source === 'object' ? l.source.id : l.source
    const t = typeof l.target === 'object' ? l.target.id : l.target
    if (focusIds?.has(s) && focusIds?.has(t)) return baseLink(l)
    return 'rgba(120,130,160,0.05)'
  }

  // In 'particles' / 'pulse' modes the raw edge lines drop to a faint scaffold and
  // the animated effect carries the edge instead.
  const linesFaint = edgeStyle !== 'lines'
  const withinParticleBudget = graphData.links.length <= PARTICLE_LINK_BUDGET
  const particleCount = !withinParticleBudget
    ? 0
    : edgeStyle === 'particles'
      ? 5
      : edgeStyle === 'pulse'
        ? 0
        : 2

  // Directional particles inherit linkColor by default — but that's transparent in
  // 'particles' mode, so we must supply an explicit glowing color (focus-aware).
  const particleGlow = (l: {
    source: string | GalaxyNode
    target: string | GalaxyNode
  }): string => {
    if (!focusActive) return EDGE_GLOW
    const s = typeof l.source === 'object' ? l.source.id : l.source
    const t = typeof l.target === 'object' ? l.target.id : l.target
    return focusIds?.has(s) && focusIds?.has(t) ? EDGE_GLOW : EDGE_GLOW_DIM
  }

  return (
    <ForceGraph3D
      ref={fgRef}
      width={width}
      height={height}
      graphData={graphData}
      backgroundColor={BACKGROUND}
      controlType="orbit"
      nodeId="id"
      nodeRelSize={NODE_REL_SIZE}
      nodeVal={nodeVal}
      nodeColor={effNodeColor}
      nodeLabel={nodeLabel}
      nodeOpacity={0.95}
      linkColor={linesFaint ? () => FAINT_LINK : effLinkColor}
      linkOpacity={linesFaint ? FAINT_LINK_OPACITY : 0.6}
      linkDirectionalParticles={particleCount}
      linkDirectionalParticleSpeed={edgeStyle === 'particles' ? 0.012 : 0.006}
      linkDirectionalParticleWidth={edgeStyle === 'particles' ? 2.8 : 1.4}
      linkDirectionalParticleColor={edgeStyle === 'particles' ? particleGlow : undefined}
      enableNodeDrag={false}
      warmupTicks={20}
      cooldownTicks={120}
      onEngineStop={frameGraph}
      onNodeClick={handleClick}
      onNodeHover={(n: GalaxyNode | null) => onNodeHover?.(n ?? null)}
    />
  )
}
