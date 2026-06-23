import { trpc } from '@renderer/lib/trpc'
import type { GraphNode } from '@shared/knowledge'
import { useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import { colorForCommunity } from './graph-colors'

// react-force-graph mutates node objects (x/y), so we feed it fresh copies.
type FgNode = GraphNode & { x?: number; y?: number }
type FgLink = { source: string; target: string; type: 'link' | 'source' }

export function GraphTab({ project: _project }: { project: string }) {
  const graph = trpc.knowledge.graph.useQuery()
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })

  // Measure the container so the canvas fills the pane.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const data = useMemo(() => {
    const nodes: FgNode[] = (graph.data?.nodes ?? []).map((n) => ({ ...n }))
    const links: FgLink[] = (graph.data?.edges ?? []).map((e) => ({
      source: e.source,
      target: e.target,
      type: e.type,
    }))
    return { nodes, links }
  }, [graph.data])

  if (graph.isPending) {
    return <div className="kb-graph-empty">{'// loading graph…'}</div>
  }
  if (!graph.data || graph.data.nodes.length === 0) {
    return <div className="kb-graph-empty">{'// no linked knowledge yet.'}</div>
  }

  return (
    <div className="kb-graph" ref={containerRef}>
      <ForceGraph2D
        width={size.w}
        height={size.h}
        graphData={data}
        backgroundColor="transparent"
        nodeId="id"
        nodeLabel={(n) => (n as FgNode).label}
        nodeVal={(n) => Math.max(1, (n as FgNode).inDegree)}
        nodeColor={(n) =>
          (n as FgNode).type === 'ghost'
            ? 'rgba(150,150,150,0.4)'
            : colorForCommunity((n as FgNode).community)
        }
        linkColor={() => 'rgba(120,120,120,0.25)'}
        linkWidth={(l) => ((l as FgLink).type === 'source' ? 0.5 : 1)}
      />
    </div>
  )
}
