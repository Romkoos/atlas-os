import { trpc } from '@renderer/lib/trpc'
import type { CodeGraphNode, CodeNodeKind } from '@shared/graph'
import { forceCollide, forceX, forceY } from 'd3-force'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import { colorForKind } from './graph-colors'

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

export function CodeGraphTab({ project }: { project: string }) {
  const projects = trpc.graph.listProjects.useQuery()
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [view, setView] = useState<View>('isolated')
  const [showInferred, setShowInferred] = useState(true)
  const [selected, setSelected] = useState<FgNode | null>(null)
  const [status, setStatus] = useState<string>('')

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
  }, [data])

  const neighbors = trpc.graph.queryNeighbors.useQuery(
    { nodeId: selected?.id ?? '', depth: 1 },
    { enabled: Boolean(selected) },
  )

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
          ) : (
            <ForceGraph2D
              ref={fgRef}
              width={size.w}
              height={size.h}
              graphData={data}
              backgroundColor="transparent"
              nodeId="id"
              nodeLabel={(n) => `${(n as FgNode).label} [${(n as FgNode).kind}]`}
              nodeColor={(n) => colorForKind((n as FgNode).kind)}
              onNodeClick={(n) => setSelected(n as FgNode)}
              linkColor={(l) =>
                (l as FgLink).inferred ? 'rgba(210,166,255,0.4)' : 'rgba(120,120,120,0.3)'
              }
              linkLineDash={(l) => ((l as FgLink).inferred ? [3, 3] : null)}
              onEngineStop={() => fgRef.current?.zoomToFit(400, 40)}
            />
          )}
        </div>

        {selected && (
          <aside className="kb-graph-panel">
            <button type="button" className="kb-graph-close" onClick={() => setSelected(null)}>
              ✕
            </button>
            <div className="kb-graph-detail">
              <strong>{selected.label}</strong>
              <div>{selected.kind}</div>
              {selected.relPath && <code>{selected.relPath}</code>}
              <hr />
              <div>neighbors:</div>
              <ul>
                {(neighbors.data?.nodes ?? [])
                  .filter((n) => n.id !== selected.id)
                  .map((n) => (
                    <li key={n.id}>
                      <button
                        type="button"
                        className="link"
                        onClick={() => setSelected({ ...(n as FgNode) })}
                      >
                        {n.label} <span className="dim">[{n.kind}]</span>
                      </button>
                    </li>
                  ))}
              </ul>
            </div>
          </aside>
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
