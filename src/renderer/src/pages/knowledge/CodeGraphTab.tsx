import { trpc } from '@renderer/lib/trpc'
import { useUiStore } from '@renderer/store/ui'
import type { CodeGraphNode } from '@shared/graph'
import { forceCollide, forceX, forceY } from 'd3-force'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import { Graph3DBoundary } from './Graph3DBoundary'
import { colorForKind, colorForNode, DEFINED_IN_EDGE_COLOR } from './graph-colors'
import { NodeDetails } from './NodeDetails'
import { ambiguousLabels, displayLabel } from './node-label'
import { communityKey, filterBySources, SOURCE_KEYS } from './source-filter'
import { type ViewMode, ViewToggle } from './ViewToggle'

type FgNode = CodeGraphNode & { x?: number; y?: number }
type FgLink = { source: string; target: string; inferred: boolean; kind: string }
type View = 'isolated' | 'unified'

const Galaxy3D = lazy(() => import('./Galaxy3D'))

export function CodeGraphTab({ project }: { project: string }) {
  const projects = trpc.graph.listProjects.useQuery()
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [view, setView] = useState<View>('isolated')
  const [showInferred, setShowInferred] = useState(true)
  const [selected, setSelected] = useState<FgNode | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('3d')
  const graphSources = useUiStore((s) => s.graphSources)
  const setGraphSources = useUiStore((s) => s.setGraphSources)
  const enabled = useMemo(() => new Set(graphSources), [graphSources])
  const toggleSource = (key: string) =>
    setGraphSources(
      graphSources.includes(key) ? graphSources.filter((k) => k !== key) : [...graphSources, key],
    )

  // Default to the project matching the page's active project name, else the first.
  const activePath = useMemo(() => {
    if (selectedPath) return selectedPath
    const list = projects.data ?? []
    return list.find((p) => p.project === project)?.projectPath ?? list[0]?.projectPath ?? null
  }, [selectedPath, projects.data, project])

  const scope = view === 'unified' ? '__all__' : (activePath ?? '__all__')
  const graph = trpc.graph.getGraph.useQuery({ scope }, { enabled: Boolean(activePath) })
  const utils = trpc.useUtils()

  const [buildStatus, setBuildStatus] = useState('')
  const [buildReqId, setBuildReqId] = useState<string | null>(null)
  const cancelBuild = trpc.graph.cancelDeepMap.useMutation()

  trpc.graph.build.useSubscription(
    { requestId: buildReqId ?? '', projectPath: activePath ?? '' },
    {
      enabled: Boolean(buildReqId && activePath),
      onData: (e) => {
        if (e.type === 'tool') setBuildStatus(`graphify: ${e.summary}`)
        else if (e.type === 'progress') setBuildStatus(e.message)
        else if (e.type === 'done') {
          setBuildStatus(`built: +${e.nodesAdded} nodes, +${e.edgesAdded} edges`)
          setBuildReqId(null)
          utils.graph.getGraph.invalidate()
          utils.graph.listProjects.invalidate()
        } else if (e.type === 'error') {
          setBuildStatus(`error: ${e.message}`)
          setBuildReqId(null)
        } else if (e.type === 'aborted') {
          setBuildStatus('build aborted')
          setBuildReqId(null)
        }
      },
      onError: (err) => {
        setBuildStatus(`error: ${err.message}`)
        setBuildReqId(null)
      },
    },
  )

  const startBuild = () => {
    if (!activePath) return
    setBuildStatus('starting build…')
    setBuildReqId(`build-${activePath}-${Date.now()}`)
  }
  const stopBuild = () => {
    if (buildReqId) cancelBuild.mutate({ requestId: buildReqId })
    setBuildReqId(null)
  }

  // biome-ignore lint/suspicious/noExplicitAny: ForceGraph ref has no exported type
  const fgRef = useRef<any>(null)
  const roRef = useRef<ResizeObserver | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const setContainer = useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect()
    if (!el) {
      roRef.current = null
      return
    }
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    roRef.current = ro
  }, [])

  const data = useMemo(() => {
    const raw = graph.data
    if (!raw) return { nodes: [] as FgNode[], links: [] as FgLink[] }
    const scoped = filterBySources(raw, enabled)
    const nodes: FgNode[] = scoped.nodes.map((n) => ({ ...n }))
    const ids = new Set(nodes.map((n) => n.id))
    const links: FgLink[] = scoped.edges
      .filter((e) => (showInferred || !e.inferred) && ids.has(e.source) && ids.has(e.target))
      .map((e) => ({ source: e.source, target: e.target, inferred: e.inferred, kind: e.kind }))
    return { nodes, links }
  }, [graph.data, showInferred, enabled])

  // biome-ignore lint/correctness/useExhaustiveDependencies: reheat on visible-set change
  useEffect(() => {
    const fg = fgRef.current
    if (!fg) return
    fg.d3Force('collide', forceCollide(10).iterations(2))
    fg.d3Force('charge')?.strength(-120)
    fg.d3Force('x', forceX(0).strength(0.06))
    fg.d3Force('y', forceY(0).strength(0.06))
    fg.d3Force('center', null)
    fg.d3ReheatSimulation?.()
  }, [data, viewMode])

  const neighbors = trpc.graph.queryNeighbors.useQuery(
    { nodeId: selected?.id ?? '', depth: 1 },
    { enabled: Boolean(selected) },
  )

  // Ids that stay lit in the 3D view when a node is selected: the node itself,
  // its direct neighbors (from queryNeighbors), and every node in the same
  // community. Everything else dims into the focus fog.
  const focusIds = useMemo(() => {
    if (!selected) return null
    const ids = new Set<string>([selected.id])
    for (const n of neighbors.data?.nodes ?? []) ids.add(n.id)
    if (selected.community != null) {
      for (const n of data.nodes) if (communityKey(n) === communityKey(selected)) ids.add(n.id)
    }
    return ids
  }, [selected, neighbors.data, data.nodes])

  // Bare filenames shared by 2+ nodes (index.ts, types.ts, …) get their parent
  // folder prefixed so they're distinguishable in tooltips and the panel.
  const ambiguous = useMemo(() => ambiguousLabels(data.nodes), [data.nodes])

  const list = projects.data ?? []

  return (
    <div className="kb-graph-wrap">
      <div className="kb-graph-controls">
        <select
          className="input"
          value={view === 'unified' ? '__all__' : (activePath ?? '')}
          onChange={(e) => {
            if (e.target.value === '__all__') setView('unified')
            else {
              setView('isolated')
              setSelectedPath(e.target.value)
            }
          }}
        >
          <option value="__all__">all projects (unified)</option>
          {list.map((p) => (
            <option key={p.projectPath} value={p.projectPath}>
              {p.project}
              {p.hasGraph ? '' : ' (not built)'}
            </option>
          ))}
        </select>
        <label className="kb-graph-check">
          <input
            type="checkbox"
            checked={showInferred}
            onChange={() => setShowInferred((v) => !v)}
          />
          show inferred
        </label>
        <ViewToggle value={viewMode} onChange={setViewMode} />
        {buildReqId ? (
          <button type="button" className="btn" onClick={stopBuild}>
            Cancel
          </button>
        ) : (
          <button type="button" className="btn" disabled={!activePath} onClick={startBuild}>
            Build
          </button>
        )}
        <span className="kb-graph-status">{buildStatus}</span>
      </div>

      <div className="kb-graph-legend kb-graph-sources">
        {SOURCE_KEYS.map((key) => {
          const on = enabled.has(key)
          const swatch =
            key === 'graphify'
              ? colorForNode({ origin: 'graphify', kind: 'code' })
              : colorForKind(key as FgNode['kind'])
          return (
            <label key={key} className="kb-graph-legend-item" style={{ opacity: on ? 1 : 0.4 }}>
              <input type="checkbox" checked={on} onChange={() => toggleSource(key)} />
              <span className="dot" style={{ background: swatch }} /> {key}
            </label>
          )
        })}
      </div>

      <div className="kb-graph-body">
        <div className="kb-graph" ref={setContainer}>
          {data.nodes.length === 0 ? (
            <div className="kb-graph-empty">{'// no graph yet — pick a project and Build.'}</div>
          ) : viewMode === '2d' ? (
            <ForceGraph2D
              ref={fgRef}
              width={size.w}
              height={size.h}
              graphData={data}
              backgroundColor="transparent"
              nodeId="id"
              nodeLabel={(n) => `${displayLabel(n as FgNode, ambiguous)} [${(n as FgNode).kind}]`}
              nodeColor={(n) => colorForNode(n as FgNode)}
              onNodeClick={(n) => setSelected(n as FgNode)}
              linkColor={(l) =>
                (l as FgLink).kind === 'defined_in'
                  ? DEFINED_IN_EDGE_COLOR
                  : (l as FgLink).inferred
                    ? 'rgba(210,166,255,0.4)'
                    : 'rgba(120,120,120,0.3)'
              }
              linkLineDash={(l) =>
                (l as FgLink).kind === 'defined_in' || (l as FgLink).inferred ? [3, 3] : null
              }
              onEngineStop={() => fgRef.current?.zoomToFit(400, 40)}
            />
          ) : (
            <Graph3DBoundary onError={() => setViewMode('2d')}>
              <Suspense fallback={<div className="kb-graph-empty">{'// loading 3D…'}</div>}>
                <Galaxy3D
                  graphData={data}
                  width={size.w}
                  height={size.h}
                  nodeColor={(n) => colorForNode(n as FgNode)}
                  nodeVal={() => 1}
                  nodeLabel={(n) =>
                    `${displayLabel(n as FgNode, ambiguous)} [${(n as FgNode).kind}]`
                  }
                  clusterKey={(n) => communityKey(n as FgNode)}
                  linkColor={(l) =>
                    (l as FgLink).kind === 'defined_in'
                      ? DEFINED_IN_EDGE_COLOR
                      : (l as FgLink).inferred
                        ? 'rgba(210,166,255,0.4)'
                        : 'rgba(120,120,120,0.3)'
                  }
                  onNodeClick={(n) => setSelected(n as FgNode)}
                  selectedId={selected?.id ?? null}
                  focusIds={focusIds}
                />
              </Suspense>
            </Graph3DBoundary>
          )}
        </div>

        {selected && (
          <NodeDetails
            node={selected}
            nodes={data.nodes}
            links={data.links}
            neighbors={neighbors.data}
            ambiguous={ambiguous}
            unified={view === 'unified'}
            onSelect={(n) => setSelected({ ...(n as FgNode) })}
            onClose={() => setSelected(null)}
          />
        )}
      </div>
    </div>
  )
}
