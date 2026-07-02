import { trpc } from '@renderer/lib/trpc'
import type { CodeGraphNode, CodeNodeKind } from '@shared/graph'
import { forceCollide, forceX, forceY } from 'd3-force'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import { Graph3DBoundary } from './Graph3DBoundary'
import { colorForKind } from './graph-colors'
import { NodeDetails } from './NodeDetails'
import { ambiguousLabels, displayLabel } from './node-label'
import { type ViewMode, ViewToggle } from './ViewToggle'

type FgNode = CodeGraphNode & { x?: number; y?: number }
type FgLink = { source: string; target: string; inferred: boolean }
type View = 'isolated' | 'unified'

const KIND_LABELS: ReadonlyArray<{ id: CodeNodeKind; label: string }> = [
  { id: 'code', label: 'code' },
  { id: 'doc', label: 'docs' },
  { id: 'skill', label: 'skills' },
  { id: 'knowledge', label: 'knowledge' },
  { id: 'session', label: 'sessions' },
]

const Galaxy3D = lazy(() => import('./Galaxy3D'))

export function CodeGraphTab({ project }: { project: string }) {
  const projects = trpc.graph.listProjects.useQuery()
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [view, setView] = useState<View>('isolated')
  const [showInferred, setShowInferred] = useState(true)
  const [selected, setSelected] = useState<FgNode | null>(null)
  const [status, setStatus] = useState<string>('')
  const [viewMode, setViewMode] = useState<ViewMode>('3d')

  // Default to the project matching the page's active project name, else the first.
  const activePath = useMemo(() => {
    if (selectedPath) return selectedPath
    const list = projects.data ?? []
    return list.find((p) => p.project === project)?.projectPath ?? list[0]?.projectPath ?? null
  }, [selectedPath, projects.data, project])

  const scope = view === 'unified' ? '__all__' : (activePath ?? '__all__')
  const graph = trpc.graph.getGraph.useQuery({ scope }, { enabled: Boolean(activePath) })
  const utils = trpc.useUtils()

  const build = trpc.graph.buildGraph.useMutation({
    onMutate: () => setStatus('building…'),
    onSuccess: (r) => {
      setStatus(`built: ${r.nodes} nodes, ${r.edges} edges, ${r.clusters} clusters`)
      utils.graph.getGraph.invalidate()
      utils.graph.listProjects.invalidate()
    },
    onError: (e) => setStatus(`error: ${e.message}`),
  })

  const [deepStatus, setDeepStatus] = useState('')
  const [deepReqId, setDeepReqId] = useState<string | null>(null)
  const cancelDeep = trpc.graph.cancelDeepMap.useMutation()

  trpc.graph.deepMap.useSubscription(
    { requestId: deepReqId ?? '', projectPath: activePath ?? '' },
    {
      enabled: Boolean(deepReqId && activePath),
      onData: (e) => {
        if (e.type === 'tool') setDeepStatus(`graphify: ${e.summary}`)
        else if (e.type === 'progress') setDeepStatus(e.message)
        else if (e.type === 'done') {
          setDeepStatus(`deep map: +${e.nodesAdded} nodes, +${e.edgesAdded} edges`)
          setDeepReqId(null)
          utils.graph.getGraph.invalidate()
        } else if (e.type === 'error') {
          setDeepStatus(`error: ${e.message}`)
          setDeepReqId(null)
        } else if (e.type === 'aborted') {
          setDeepStatus('deep map aborted')
          setDeepReqId(null)
        }
      },
      onError: (err) => {
        setDeepStatus(`error: ${err.message}`)
        setDeepReqId(null)
      },
    },
  )

  const startDeepMap = () => {
    if (!activePath) return
    setDeepStatus('starting graphify…')
    setDeepReqId(`deep-${activePath}-${Date.now()}`)
  }
  const stopDeepMap = () => {
    if (deepReqId) cancelDeep.mutate({ requestId: deepReqId })
    setDeepReqId(null)
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
    const nodes: FgNode[] = raw.nodes.map((n) => ({ ...n }))
    const ids = new Set(nodes.map((n) => n.id))
    const links: FgLink[] = raw.edges
      .filter((e) => (showInferred || !e.inferred) && ids.has(e.source) && ids.has(e.target))
      .map((e) => ({ source: e.source, target: e.target, inferred: e.inferred }))
    return { nodes, links }
  }, [graph.data, showInferred])

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
      for (const n of data.nodes) if (n.community === selected.community) ids.add(n.id)
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
        <button
          type="button"
          className="btn"
          disabled={!activePath || build.isPending}
          onClick={() => activePath && build.mutate({ projectPath: activePath })}
        >
          Build
        </button>
        <span className="kb-graph-status">{status}</span>
        {deepReqId ? (
          <button type="button" className="btn" onClick={stopDeepMap}>
            Cancel deep map
          </button>
        ) : (
          <button type="button" className="btn" disabled={!activePath} onClick={startDeepMap}>
            Deep map via graphify
          </button>
        )}
        <span className="kb-graph-status">{deepStatus}</span>
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
              nodeColor={(n) => colorForKind((n as FgNode).kind)}
              onNodeClick={(n) => setSelected(n as FgNode)}
              linkColor={(l) =>
                (l as FgLink).inferred ? 'rgba(210,166,255,0.4)' : 'rgba(120,120,120,0.3)'
              }
              linkLineDash={(l) => ((l as FgLink).inferred ? [3, 3] : null)}
              onEngineStop={() => fgRef.current?.zoomToFit(400, 40)}
            />
          ) : (
            <Graph3DBoundary onError={() => setViewMode('2d')}>
              <Suspense fallback={<div className="kb-graph-empty">{'// loading 3D…'}</div>}>
                <Galaxy3D
                  graphData={data}
                  width={size.w}
                  height={size.h}
                  nodeColor={(n) => colorForKind((n as FgNode).kind)}
                  nodeVal={() => 1}
                  nodeLabel={(n) =>
                    `${displayLabel(n as FgNode, ambiguous)} [${(n as FgNode).kind}]`
                  }
                  clusterKey={(n) => (n as FgNode).community ?? -1}
                  linkColor={(l) =>
                    (l as FgLink).inferred ? 'rgba(210,166,255,0.4)' : 'rgba(120,120,120,0.3)'
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

      <div className="kb-graph-legend">
        {KIND_LABELS.map((k) => (
          <span key={k.id} className="kb-graph-legend-item">
            <span className="dot" style={{ background: colorForKind(k.id) }} /> {k.label}
          </span>
        ))}
      </div>
    </div>
  )
}
