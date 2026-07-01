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
  // biome-ignore lint/correctness/useExhaustiveDependencies: reheat on data change only
  useEffect(() => {
    const fg = fgRef.current
    if (!fg) return
    const anchors = clusterAnchors(graphData.nodes.map((n) => clusterKey(n)))
    const anchorOf = (n: any) => anchors.get(String(clusterKey(n)))
    fg.d3Force('x', forceX((n: any) => anchorOf(n)?.x ?? 0).strength(0.12))
    fg.d3Force('y', forceY((n: any) => anchorOf(n)?.y ?? 0).strength(0.12))
    fg.d3Force('z', forceZ((n: any) => anchorOf(n)?.z ?? 0).strength(0.12))
    fg.d3Force('charge')?.strength(-120)
    fg.d3Force(
      'collide',
      forceCollide((n: any) => radiusOf(nodeVal(n)) + 2),
    )
    fg.d3ReheatSimulation?.()
  }, [graphData])

  const handleClick = (node: any): void => {
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
      nodeVal={(n: any) => nodeVal(n)}
      nodeColor={(n: any) => nodeColor(n)}
      nodeLabel={(n: any) => nodeLabel(n)}
      nodeOpacity={0.95}
      linkColor={linkColor ?? (() => 'rgba(120,120,120,0.25)')}
      linkOpacity={0.4}
      enableNodeDrag={false}
      warmupTicks={20}
      cooldownTicks={120}
      onNodeClick={handleClick}
      onNodeHover={(n: any) => onNodeHover?.(n ?? null)}
    />
  )
}
