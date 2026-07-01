import { forceCollide, forceX, forceY, forceZ } from 'd3-force-3d'
import { useEffect, useRef } from 'react'
import ForceGraph3D from 'react-force-graph-3d'
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
  // form distinct spatial regions ("galaxies"). Reheated whenever the visible
  // set changes. Anchors are recomputed from the current nodes' cluster keys.
  //
  // Deferred to the next animation frame on purpose: react-force-graph-3d builds
  // its internal layout (state.layout) in a digest that is scheduled, not
  // synchronous. Calling d3ReheatSimulation() before that digest runs flips
  // engineRunning=true while state.layout is still undefined, and the next
  // requestAnimationFrame tick then throws "Cannot read properties of undefined
  // (reading 'tick')" from inside the library's animation loop — uncatchable by
  // a React error boundary, so the canvas goes black until a full refresh. The
  // race only bites larger graphs (slower digest) and StrictMode double-mounts.
  // By the next rAF the digest's microtask has flushed and state.layout exists.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reheat on data change only
  useEffect(() => {
    const fg = fgRef.current
    if (!fg) return
    const raf = requestAnimationFrame(() => {
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
      fg.d3ReheatSimulation?.()
    })
    return () => cancelAnimationFrame(raf)
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
      backgroundColor="#05060a"
      nodeId="id"
      nodeRelSize={NODE_REL_SIZE}
      nodeVal={nodeVal}
      nodeColor={nodeColor}
      nodeLabel={nodeLabel}
      nodeOpacity={0.95}
      linkColor={linkColor ?? (() => 'rgba(120,120,120,0.25)')}
      linkOpacity={0.4}
      enableNodeDrag={false}
      warmupTicks={20}
      cooldownTicks={120}
      onEngineStop={frameGraph}
      onNodeClick={handleClick}
      onNodeHover={(n: GalaxyNode | null) => onNodeHover?.(n ?? null)}
    />
  )
}
