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
}

const NODE_REL_SIZE = 5
const radiusOf = (nodeVal: number): number => Math.sqrt(Math.max(1, nodeVal)) * NODE_REL_SIZE

// Directional link particles are pretty but cost a sprite per particle per link;
// only enable them on smaller graphs so thousand-edge views stay smooth.
const PARTICLE_LINK_BUDGET = 400

// A faint field of distant stars placed on a large spherical shell well beyond
// the graph, to sell the "deep space" backdrop. Cheap: one draw call.
function makeStarfield(): THREE.Points {
  const count = 1600
  const positions = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const r = 3500 + Math.random() * 3500
    const theta = Math.random() * Math.PI * 2
    const phi = Math.acos(2 * Math.random() - 1)
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta)
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta)
    positions[i * 3 + 2] = r * Math.cos(phi)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const material = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 2.4,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.75,
    depthWrite: false,
  })
  const points = new THREE.Points(geometry, material)
  points.name = 'galaxy-starfield'
  return points
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
}: Galaxy3DProps) {
  // react-force-graph-3d exposes no ref type.
  // biome-ignore lint/suspicious/noExplicitAny: ForceGraph ref has no exported type
  const fgRef = useRef<any>(null)

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
  // camera stayed at its big-graph default and the canvas rendered black. We
  // compute the centroid + extent from node positions and place the camera at a
  // safe distance with a floor, which frames one node or hundreds alike.
  const frameGraph = (): void => {
    const fg = fgRef.current
    if (!fg) return
    const nodes = graphData.nodes
    if (nodes.length === 0) return
    let cx = 0
    let cy = 0
    let cz = 0
    for (const n of nodes) {
      cx += n.x ?? 0
      cy += n.y ?? 0
      cz += n.z ?? 0
    }
    cx /= nodes.length
    cy /= nodes.length
    cz /= nodes.length
    let maxR = 0
    for (const n of nodes) {
      const r = Math.hypot((n.x ?? 0) - cx, (n.y ?? 0) - cy, (n.z ?? 0) - cz)
      if (r > maxR) maxR = r
    }
    const fov = ((fg.camera?.()?.fov ?? 50) * Math.PI) / 180
    const radius = Math.max(maxR + NODE_REL_SIZE * 3, 15)
    const distance = Math.max(radius / Math.tan(fov / 2), 30)
    fg.cameraPosition({ x: cx, y: cy, z: cz + distance }, { x: cx, y: cy, z: cz }, 600)
  }

  // Visual effects: bloom glow, a starfield backdrop, and idle auto-rotation.
  // Deferred a frame (like the force setup) so the renderer/scene/controls exist,
  // and fully torn down on cleanup so a StrictMode double-mount doesn't stack
  // duplicate bloom passes or star fields. Mount-only.
  // biome-ignore lint/correctness/useExhaustiveDependencies: one-time scene setup
  useEffect(() => {
    const fg = fgRef.current
    if (!fg) return
    let bloom: UnrealBloomPass | null = null
    let stars: THREE.Points | null = null
    // biome-ignore lint/suspicious/noExplicitAny: three controls has no exported type here
    let controls: any = null
    let idleTimer: ReturnType<typeof setTimeout> | null = null
    const onInteractionStart = (): void => {
      if (idleTimer) clearTimeout(idleTimer)
      if (controls) controls.autoRotate = false
    }
    const onInteractionEnd = (): void => {
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(() => {
        if (controls) controls.autoRotate = true
      }, 2500)
    }
    const raf = requestAnimationFrame(() => {
      const composer = fg.postProcessingComposer?.()
      if (composer) {
        bloom = new UnrealBloomPass(
          new THREE.Vector2(Math.max(width, 1), Math.max(height, 1)),
          0.8, // strength — moderate glow
          0.6, // radius
          0.15, // threshold — brighter nodes bloom
        )
        composer.addPass(bloom)
      }
      const scene = fg.scene?.()
      if (scene) {
        stars = makeStarfield()
        scene.add(stars)
      }
      controls = fg.controls?.()
      if (controls) {
        controls.autoRotate = true
        controls.autoRotateSpeed = 0.4
        controls.addEventListener?.('start', onInteractionStart)
        controls.addEventListener?.('end', onInteractionEnd)
      }
    })
    return () => {
      cancelAnimationFrame(raf)
      if (idleTimer) clearTimeout(idleTimer)
      if (bloom) {
        fg.postProcessingComposer?.()?.removePass?.(bloom)
        bloom.dispose?.()
      }
      if (stars) {
        fg.scene?.()?.remove(stars)
        stars.geometry.dispose()
        ;(stars.material as THREE.Material).dispose()
      }
      if (controls) {
        controls.autoRotate = false
        controls.removeEventListener?.('start', onInteractionStart)
        controls.removeEventListener?.('end', onInteractionEnd)
      }
    }
  }, [])

  const handleClick = (node: GalaxyNode): void => {
    const fg = fgRef.current
    if (fg && node.x != null && node.y != null) {
      const dist = 120
      const hyp = Math.hypot(node.x, node.y, node.z ?? 0) || 1
      const ratio = 1 + dist / hyp
      fg.cameraPosition(
        { x: node.x * ratio, y: node.y * ratio, z: (node.z ?? 0) * ratio },
        node,
        800,
      )
    }
    onNodeClick?.(node)
  }

  return (
    <ForceGraph3D
      ref={fgRef}
      width={width}
      height={height}
      graphData={graphData}
      backgroundColor="#010103"
      controlType="orbit"
      nodeId="id"
      nodeRelSize={NODE_REL_SIZE}
      nodeVal={nodeVal}
      nodeColor={nodeColor}
      nodeLabel={nodeLabel}
      nodeOpacity={0.95}
      linkColor={linkColor ?? (() => 'rgba(160,170,205,0.5)')}
      linkOpacity={0.6}
      linkDirectionalParticles={graphData.links.length <= PARTICLE_LINK_BUDGET ? 2 : 0}
      linkDirectionalParticleSpeed={0.006}
      linkDirectionalParticleWidth={1.4}
      enableNodeDrag={false}
      warmupTicks={20}
      cooldownTicks={120}
      onEngineStop={frameGraph}
      onNodeClick={handleClick}
      onNodeHover={(n: GalaxyNode | null) => onNodeHover?.(n ?? null)}
    />
  )
}
