import { trpc } from '@renderer/lib/trpc'
import { MarkdownView } from '@renderer/pages/knowledge/MarkdownView'
import type { ArticleMeta, GraphNode, GraphNodeType } from '@shared/knowledge'
import { forceCollide } from 'd3-force'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import { colorForCommunity, colorForProject } from './graph-colors'

type FgNode = GraphNode & { x?: number; y?: number }
type FgLink = { source: string | FgNode; target: string | FgNode; type: 'link' | 'source' }
type ColorBy = 'community' | 'project'

// Node sizing: react-force-graph paints a circle of radius √(val) × nodeRelSize.
// Log-compress inDegree so hubs stay prominent without dwarfing everything
// (inDegree 0→r≈5px, 39→r≈13px instead of 4→25px with a raw-inDegree scale).
const NODE_REL_SIZE = 5
const nodeValOf = (n: FgNode): number => 1 + Math.log2(1 + Math.max(0, n.inDegree))
const nodeRadius = (n: FgNode): number => Math.sqrt(nodeValOf(n)) * NODE_REL_SIZE

const TYPE_OPTIONS: ReadonlyArray<{ id: GraphNodeType; label: string }> = [
  { id: 'concept', label: 'concepts' },
  { id: 'connection', label: 'connections' },
  { id: 'daily', label: 'daily' },
  { id: 'ghost', label: 'unwritten' },
]

const idOf = (end: string | FgNode): string => (typeof end === 'string' ? end : end.id)

export function GraphTab({ project }: { project: string }) {
  const graph = trpc.knowledge.graph.useQuery()
  // biome-ignore lint/suspicious/noExplicitAny: ForceGraph ref has no exported type
  const fgRef = useRef<any>(null)
  const roRef = useRef<ResizeObserver | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  const [colorBy, setColorBy] = useState<ColorBy>('community')
  const [hidden, setHidden] = useState<Set<GraphNodeType>>(new Set())
  const [focusProject, setFocusProject] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<FgNode | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)

  // Attach the ResizeObserver via a callback ref so it fires when the container
  // actually mounts. The early-return guards (loading/error/empty) mean .kb-graph
  // isn't in the DOM on the first render, so a useEffect([]) would observe a null
  // ref and never re-run — leaving the canvas stuck at its initial size.
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

  const allProjects = useMemo(
    () => [...new Set((graph.data?.nodes ?? []).map((n) => n.project))].sort(),
    [graph.data],
  )

  // Default the focus filter to the page's active project once data loads.
  useEffect(() => {
    if (allProjects.includes(project)) setFocusProject(project)
  }, [allProjects, project])

  const data = useMemo(() => {
    const raw = graph.data
    if (!raw) return { nodes: [] as FgNode[], links: [] as FgLink[] }
    const visible = raw.nodes.filter(
      (n) => !hidden.has(n.type) && (focusProject === 'all' || n.project === focusProject),
    )
    const ids = new Set(visible.map((n) => n.id))
    const nodes: FgNode[] = visible.map((n) => ({ ...n }))
    const links: FgLink[] = raw.edges
      .filter((e) => ids.has(e.source) && ids.has(e.target))
      .map((e) => ({ source: e.source, target: e.target, type: e.type }))
    return { nodes, links }
  }, [graph.data, hidden, focusProject])

  // Adjacency for hover highlighting.
  const neighbors = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const l of data.links) {
      const s = idOf(l.source)
      const t = idOf(l.target)
      if (!map.has(s)) map.set(s, new Set())
      if (!map.has(t)) map.set(t, new Set())
      map.get(s)?.add(t)
      map.get(t)?.add(s)
    }
    return map
  }, [data.links])

  // Inject a collision force sized to each node's painted radius so large hubs
  // don't overlap each other or smaller nodes, and strengthen charge repulsion
  // for breathing room between clusters. Re-applied (and reheated) whenever the
  // visible set changes. Default d3-force has no radius-aware collision, which
  // is why big nodes pile up without this.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reheat on visible-set change
  useEffect(() => {
    const fg = fgRef.current
    if (!fg) return
    fg.d3Force('collide', forceCollide((n: FgNode) => nodeRadius(n) + 3).iterations(2))
    fg.d3Force('charge')?.strength(-160)
    fg.d3ReheatSimulation?.()
  }, [data])

  const nodeColor = (n: FgNode): string => {
    const dim = hovered && hovered !== n.id && !neighbors.get(hovered)?.has(n.id)
    const base =
      n.type === 'ghost'
        ? 'rgba(150,150,150,0.5)'
        : colorBy === 'project'
          ? colorForProject(n.project, allProjects)
          : colorForCommunity(n.community)
    if (!dim) return base
    return n.type === 'ghost' ? 'rgba(150,150,150,0.15)' : `${base}33`
  }

  const toggleType = (t: GraphNodeType): void => {
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t)
      else next.add(t)
      return next
    })
  }

  const runSearch = (): void => {
    const q = search.trim().toLowerCase()
    if (!q) return
    const hit = data.nodes.find((n) => n.label.toLowerCase().includes(q))
    if (hit && fgRef.current && hit.x != null && hit.y != null) {
      fgRef.current.centerAt(hit.x, hit.y, 800)
      fgRef.current.zoom(4, 800)
      setSelected(hit)
    }
  }

  // Side-panel article fetch (article vs daily vs ghost).
  const isArticle =
    selected != null && (selected.type === 'concept' || selected.type === 'connection')
  const isDaily = selected?.type === 'daily'
  const article = trpc.knowledge.article.useQuery(
    { project: selected?.project ?? '', relPath: selected?.relPath ?? '' },
    { enabled: isArticle },
  )
  const dailyDoc = trpc.knowledge.dailyArticle.useQuery(
    { project: selected?.project ?? '', relPath: selected?.relPath ?? '' },
    { enabled: !!isDaily },
  )

  // ArticleMeta list for the selected node's project, so MarkdownView can resolve
  // [[links]] and recenter the graph on click. Keyed on the project only, so it does
  // not recompute when switching between two nodes in the same project.
  const selectedProject = selected?.project
  const panelArticles: ArticleMeta[] = useMemo(() => {
    if (!selectedProject) return []
    return (graph.data?.nodes ?? [])
      .filter(
        (n) => n.project === selectedProject && (n.type === 'concept' || n.type === 'connection'),
      )
      .map((n) => ({
        relPath: n.relPath,
        kind: n.type === 'connection' ? 'connection' : 'concept',
        title: n.label,
        tags: n.tags,
        aliases: [],
        updated: n.updated,
        inboundLinks: n.inDegree,
      }))
  }, [graph.data, selectedProject])

  const navigateTo = (relPath: string): void => {
    if (!selected) return
    const node = (graph.data?.nodes ?? []).find(
      (n) => n.project === selected.project && n.relPath === relPath,
    )
    if (node) setSelected({ ...node })
  }

  if (graph.isPending) return <div className="kb-graph-empty">{'// loading graph…'}</div>
  if (graph.isError) return <div className="kb-graph-empty">{'// graph unavailable.'}</div>
  if (!graph.data || graph.data.nodes.length === 0) {
    return <div className="kb-graph-empty">{'// no linked knowledge yet.'}</div>
  }

  return (
    <div className="kb-graph-wrap">
      <div className="kb-graph-controls">
        {TYPE_OPTIONS.map((t) => (
          <label key={t.id} className="kb-graph-check">
            <input type="checkbox" checked={!hidden.has(t.id)} onChange={() => toggleType(t.id)} />
            {t.label}
          </label>
        ))}
        <select
          value={focusProject}
          onChange={(e) => setFocusProject(e.target.value)}
          className="input"
        >
          <option value="all">all projects</option>
          {allProjects.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn"
          onClick={() => setColorBy((c) => (c === 'community' ? 'project' : 'community'))}
        >
          color: {colorBy}
        </button>
        <form
          className="kb-graph-search"
          onSubmit={(e) => {
            e.preventDefault()
            runSearch()
          }}
        >
          <input
            className="input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="find node…"
          />
        </form>
      </div>

      <div className="kb-graph-body">
        <div className="kb-graph" ref={setContainer}>
          <ForceGraph2D
            ref={fgRef}
            width={size.w}
            height={size.h}
            graphData={data}
            backgroundColor="transparent"
            nodeId="id"
            nodeRelSize={NODE_REL_SIZE}
            nodeLabel={(n) => (n as FgNode).label}
            nodeVal={(n) => nodeValOf(n as FgNode)}
            nodeColor={(n) => nodeColor(n as FgNode)}
            onNodeClick={(n) => setSelected(n as FgNode)}
            onNodeHover={(n) => setHovered((n as FgNode | null)?.id ?? null)}
            linkColor={() => 'rgba(120,120,120,0.25)'}
            linkWidth={(l) => ((l as FgLink).type === 'source' ? 0.5 : 1)}
          />
        </div>

        {selected && (
          <aside className="kb-graph-panel">
            <button type="button" className="kb-graph-close" onClick={() => setSelected(null)}>
              ✕
            </button>
            {selected.type === 'ghost' ? (
              <div className="kb-graph-empty">
                {'// "'}
                {selected.label}
                {'" — referenced but not written yet.'}
              </div>
            ) : isDaily ? (
              <MarkdownView body={dailyDoc.data?.raw ?? ''} articles={[]} onNavigate={() => {}} />
            ) : article.data ? (
              <MarkdownView
                body={article.data.body}
                frontmatter={article.data.frontmatter}
                articles={panelArticles}
                onNavigate={navigateTo}
              />
            ) : (
              <div className="kb-graph-empty">{'// loading…'}</div>
            )}
          </aside>
        )}
      </div>
    </div>
  )
}
