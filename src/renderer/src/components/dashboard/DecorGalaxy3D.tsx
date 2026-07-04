import { clusterAnchors } from '@renderer/pages/knowledge/cluster-anchors'
import {
  type CometSystem,
  createCometSystem,
  makeGlowTexture,
  makeNebula,
  makeStarLayer,
} from '@renderer/pages/knowledge/galaxy-fx'
import { forceCollide, forceX, forceY, forceZ } from 'd3-force-3d'
import { useEffect, useRef } from 'react'
import ForceGraph3D from 'react-force-graph-3d'
import * as THREE from 'three'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'

interface DecorNode {
  id: string
  x?: number
  y?: number
  z?: number
}

interface DecorGalaxy3DProps {
  graphData: {
    nodes: DecorNode[]
    links: Array<{ source: string | DecorNode; target: string | DecorNode }>
  }
  size: number
  // biome-ignore lint/suspicious/noExplicitAny: force-graph node type is untyped
  nodeColor: (n: any) => string
  // biome-ignore lint/suspicious/noExplicitAny: force-graph node type is untyped
  clusterKey: (n: any) => string | number
}

const NODE_REL_SIZE = 4
const BACKGROUND = '#000000'

// Purely decorative galaxy for the Dashboard hero: same cluster-anchored layout,
// bloom, starfield and pulse comets as the Knowledge Galaxy3D, but with every
// interaction stripped — no hover, no click, no drag, permanent auto-rotate.
export default function DecorGalaxy3D({
  graphData,
  size,
  nodeColor,
  clusterKey,
}: DecorGalaxy3DProps) {
  // biome-ignore lint/suspicious/noExplicitAny: ForceGraph ref has no exported type
  const fgRef = useRef<any>(null)
  const cometRaf = useRef<number | null>(null)

  // Cluster-anchor forces. Same rationale as Galaxy3D: no manual reheat — the
  // library re-heats on every graphData assignment; setting forces is enough.
  // biome-ignore lint/correctness/useExhaustiveDependencies: set forces on data change only
  useEffect(() => {
    const fg = fgRef.current
    if (!fg) return
    const anchors = clusterAnchors(graphData.nodes.map((n) => clusterKey(n)))
    const anchorOf = (n: DecorNode) => anchors.get(String(clusterKey(n)))
    fg.d3Force('x', forceX((n: DecorNode) => anchorOf(n)?.x ?? 0).strength(0.12))
    fg.d3Force('y', forceY((n: DecorNode) => anchorOf(n)?.y ?? 0).strength(0.12))
    fg.d3Force('z', forceZ((n: DecorNode) => anchorOf(n)?.z ?? 0).strength(0.12))
    fg.d3Force('charge')?.strength(-120)
    fg.d3Force('collide', forceCollide(NODE_REL_SIZE + 2))
  }, [graphData])

  // One-time scene: bloom, starfield, nebula, permanent slow auto-rotate.
  // biome-ignore lint/correctness/useExhaustiveDependencies: one-time scene setup
  useEffect(() => {
    const fg = fgRef.current
    if (!fg) return
    let bloom: UnrealBloomPass | null = null
    const stars: THREE.Points[] = []
    let nebula: THREE.Group | null = null
    let glowTex: THREE.Texture | null = null
    const raf = requestAnimationFrame(() => {
      const composer = fg.postProcessingComposer?.()
      if (composer) {
        bloom = new UnrealBloomPass(
          new THREE.Vector2(Math.max(size, 1), Math.max(size, 1)),
          0.6, // strength
          0.55, // radius
          0.18, // threshold
        )
        composer.addPass(bloom)
      }
      const scene = fg.scene?.()
      if (scene) {
        glowTex = makeGlowTexture()
        stars.push(makeStarLayer(500, 1500, 2600, 3.2, 0.55, 0xbfd0ff))
        stars.push(makeStarLayer(700, 2800, 4200, 2.4, 0.7, 0xffffff))
        for (const layer of stars) scene.add(layer)
        nebula = makeNebula(glowTex)
        scene.add(nebula)
      }
      const controls = fg.controls?.()
      if (controls) {
        controls.autoRotate = true
        controls.autoRotateSpeed = 0.55
        controls.enableZoom = false
        controls.enablePan = false
      }
    })
    return () => {
      cancelAnimationFrame(raf)
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
      glowTex?.dispose()
      const controls = fg.controls?.()
      if (controls) controls.autoRotate = false
    }
  }, [])

  // Pulse comets — always on (this is the whole point of the decoration).
  useEffect(() => {
    const fg = fgRef.current
    if (!fg) return
    let system: CometSystem | null = null
    const start = requestAnimationFrame(() => {
      const scene = fg.scene?.()
      if (!scene) return
      system = createCometSystem(graphData.nodes, graphData.links)
      if (!system) return
      scene.add(system.points)
      const loop = (): void => {
        system?.tick(performance.now() / 1000)
        cometRaf.current = requestAnimationFrame(loop)
      }
      cometRaf.current = requestAnimationFrame(loop)
    })
    return () => {
      cancelAnimationFrame(start)
      if (cometRaf.current) cancelAnimationFrame(cometRaf.current)
      cometRaf.current = null
      if (system) {
        fg.scene?.()?.remove(system.points)
        system.dispose()
        system = null
      }
    }
  }, [graphData])

  // Frame the settled graph: aim at the bbox center and fit the extent (the
  // canvas is square, so the vertical fit is the binding one).
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
    const radius = Math.max(maxR + NODE_REL_SIZE * 3, 15)
    const distance = Math.max(radius / Math.tan(fov / 2), 30)
    fg.cameraPosition({ x: cx, y: cy, z: cz + distance }, { x: cx, y: cy, z: cz }, 600)
  }

  return (
    <ForceGraph3D
      ref={fgRef}
      width={size}
      height={size}
      graphData={graphData}
      backgroundColor={BACKGROUND}
      controlType="orbit"
      nodeId="id"
      nodeRelSize={NODE_REL_SIZE}
      nodeVal={() => 1}
      nodeColor={nodeColor}
      nodeOpacity={0.95}
      linkColor={() => '#6a76a6'}
      linkOpacity={0.03}
      enableNodeDrag={false}
      enablePointerInteraction={false}
      warmupTicks={20}
      cooldownTicks={120}
      onEngineStop={frameGraph}
    />
  )
}
