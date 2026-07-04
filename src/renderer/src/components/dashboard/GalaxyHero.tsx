import { num } from '@renderer/components/dashboard/dash-utils'
import { BorderBeam } from '@renderer/components/fx/BorderBeam'
import { ScrambleText } from '@renderer/components/fx/ScrambleText'
import { trpc } from '@renderer/lib/trpc'
import { Graph3DBoundary } from '@renderer/pages/knowledge/Graph3DBoundary'
import { colorForNode } from '@renderer/pages/knowledge/graph-colors'
import { communityKey, filterBySources } from '@renderer/pages/knowledge/source-filter'
import { useUiStore } from '@renderer/store/ui'
import type { CodeGraphNode } from '@shared/graph'
import { lazy, Suspense, useCallback, useMemo, useRef, useState } from 'react'
import { sampleGraph } from './sample-graph'

const DecorGalaxy3D = lazy(() => import('./DecorGalaxy3D'))

// A full multi-project graph is thousands of nodes; a 3D force sim + per-edge
// comets at that size janks and can crash the GPU process. So we RENDER a
// bounded, highest-degree sample while the HUD reports the true totals.
const RENDER_NODE_CAP = 1400

// Decorative hero: the unified multi-project graph (scope __all__), filtered by
// the user's persisted source toggles, rendered as a square auto-rotating galaxy
// with pulse-comet edges. Zero interaction — pointer events are disabled on the
// whole canvas; the HUD overlay shows the real node/edge counts.
export function GalaxyHero() {
  const graphSources = useUiStore((s) => s.graphSources)
  const graph = trpc.graph.getGraph.useQuery({ scope: '__all__' })
  const [failed, setFailed] = useState(false)

  const enabled = useMemo(() => new Set(graphSources), [graphSources])
  const data = useMemo(() => {
    const raw = graph.data
    if (!raw)
      return {
        nodes: [] as Array<CodeGraphNode & { x?: number }>,
        links: [] as Array<{ source: string; target: string }>,
        totalNodes: 0,
        totalEdges: 0,
      }
    const scoped = filterBySources(raw, enabled)
    const nodes = scoped.nodes.map((n) => ({ ...n }))
    const ids = new Set(nodes.map((n) => n.id))
    const links = scoped.edges
      .filter((e) => ids.has(e.source) && ids.has(e.target))
      .map((e) => ({ source: e.source, target: e.target }))
    const s = sampleGraph(nodes, links, RENDER_NODE_CAP)
    return { nodes: s.nodes, links: s.links, totalNodes: s.totalNodes, totalEdges: s.totalEdges }
  }, [graph.data, enabled])

  // The canvas fills its panel column exactly (width × height), so the hero
  // aligns flush with the NEXT UP / rail columns — no leftover gap.
  const roRef = useRef<ResizeObserver | null>(null)
  const [dims, setDims] = useState({ w: 0, h: 0 })
  const setContainer = useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect()
    if (!el) {
      roRef.current = null
      return
    }
    const measure = () => setDims({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    roRef.current = ro
  }, [])

  const empty = !graph.isLoading && data.nodes.length === 0

  return (
    <div className="panel galaxy-hero">
      <BorderBeam />
      <div className="panel-head">
        <span className="ttl">
          <ScrambleText text="atlas graph" />
        </span>
        <span className="meta">all projects · live</span>
      </div>
      <div className="galaxy-canvas" ref={setContainer}>
        {!failed && !empty && dims.w > 0 && dims.h > 0 && (
          <Graph3DBoundary onError={() => setFailed(true)}>
            <Suspense fallback={null}>
              <DecorGalaxy3D
                graphData={data}
                width={dims.w}
                height={dims.h}
                nodeColor={(n) => colorForNode(n as CodeGraphNode)}
                clusterKey={(n) => communityKey(n as CodeGraphNode)}
              />
            </Suspense>
          </Graph3DBoundary>
        )}
        {(empty || failed) && (
          <div className="galaxy-hero-empty">
            {failed ? '// 3D unavailable on this GPU' : '// no graph yet — run Build on Knowledge'}
          </div>
        )}
        <div className="galaxy-hud" aria-hidden>
          <span className="corner tl" />
          <span className="corner tr" />
          <span className="corner bl" />
          <span className="corner br" />
          <div className="galaxy-reticle" />
          <div className="galaxy-scanline" />
          <div className="galaxy-readout">
            NODES {num(data.totalNodes)} · EDGES {num(data.totalEdges)}
          </div>
        </div>
      </div>
    </div>
  )
}
