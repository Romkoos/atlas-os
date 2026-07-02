import { trpc } from '@renderer/lib/trpc'
import type { CodeEdgeKind, CodeGraph, CodeGraphNode, CodeNodeKind } from '@shared/graph'
import { type ReactNode, useMemo, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { colorForCommunity, colorForKind } from './graph-colors'
import { displayLabel } from './node-label'

type Node = CodeGraphNode & { x?: number; y?: number }
type Link = { source: string; target: string }

interface NodeDetailsProps {
  node: Node
  nodes: Node[]
  links: Link[]
  neighbors: CodeGraph | undefined
  ambiguous: Set<string>
  unified: boolean
  onSelect: (n: Node) => void
  onClose: () => void
}

// Human labels for each edge type, from the selected node's point of view. The
// same edge reads differently depending on whether the selected node is the
// source or the target (e.g. "Imports" vs "Imported by").
function relationLabel(kind: CodeEdgeKind, selectedIsSource: boolean): string {
  switch (kind) {
    case 'imports':
      return selectedIsSource ? 'Imports' : 'Imported by'
    case 'doc_link':
      return selectedIsSource ? 'Links to' : 'Linked from'
    case 'session_touched':
      return selectedIsSource ? 'Touches files' : 'Touched in sessions'
    case 'mentions_knowledge':
      return selectedIsSource ? 'Mentions knowledge' : 'Mentioned by'
    case 'semantic':
      return 'Related (semantic)'
  }
}

// Stable display order so the groups don't reshuffle between selections.
const REL_ORDER = [
  'Imports',
  'Imported by',
  'Links to',
  'Linked from',
  'Touched in sessions',
  'Touches files',
  'Mentions knowledge',
  'Mentioned by',
  'Related (semantic)',
]

function edgeEndpoint(e: string | { id: string }): string {
  return typeof e === 'string' ? e : e.id
}

function Section({
  title,
  count,
  defaultOpen = true,
  children,
}: {
  title: string
  count?: number
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="kb-nd-section">
      <button type="button" className="kb-nd-head" onClick={() => setOpen((v) => !v)}>
        <span className="kb-nd-caret">{open ? '▾' : '▸'}</span>
        <span>{title}</span>
        {count != null && <span className="kb-nd-count">{count}</span>}
      </button>
      {open && <div className="kb-nd-body">{children}</div>}
    </section>
  )
}

function KindDot({ kind }: { kind: CodeNodeKind }) {
  return <span className="kb-nd-dot" style={{ background: colorForKind(kind) }} />
}

export function NodeDetails({
  node,
  nodes,
  links,
  neighbors,
  ambiguous,
  unified,
  onSelect,
  onClose,
}: NodeDetailsProps) {
  // Node degree across the whole visible graph — used to rank cluster members.
  const degree = useMemo(() => {
    const d = new Map<string, number>()
    for (const l of links) {
      const s = edgeEndpoint(l.source as string | { id: string })
      const t = edgeEndpoint(l.target as string | { id: string })
      d.set(s, (d.get(s) ?? 0) + 1)
      d.set(t, (d.get(t) ?? 0) + 1)
    }
    return d
  }, [links])

  // Neighbors grouped by typed relation + direction.
  const relationGroups = useMemo(() => {
    if (!neighbors)
      return [] as Array<{ label: string; items: Array<{ n: Node; inferred: boolean }> }>
    const byId = new Map(neighbors.nodes.map((n) => [n.id, n as Node]))
    const groups = new Map<string, Array<{ n: Node; inferred: boolean }>>()
    for (const e of neighbors.edges) {
      const isSource = e.source === node.id
      const isTarget = e.target === node.id
      if (!isSource && !isTarget) continue
      const other = byId.get(isSource ? e.target : e.source)
      if (!other || other.id === node.id) continue
      const label = relationLabel(e.kind, isSource)
      const arr = groups.get(label) ?? []
      arr.push({ n: other, inferred: e.inferred })
      groups.set(label, arr)
    }
    return REL_ORDER.filter((l) => groups.has(l)).map((label) => ({
      label,
      items: (groups.get(label) ?? []).sort((a, b) => a.n.label.localeCompare(b.n.label)),
    }))
  }, [neighbors, node.id])

  const relationCount = relationGroups.reduce((sum, g) => sum + g.items.length, 0)

  // Cluster context, computed from the already-loaded graph.
  const cluster = useMemo(() => {
    if (node.community == null) return null
    const members = nodes.filter((n) => n.community === node.community)
    const byKind = new Map<CodeNodeKind, number>()
    for (const m of members) byKind.set(m.kind, (byKind.get(m.kind) ?? 0) + 1)
    const dominantKind = [...byKind.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? node.kind
    const top = members
      .filter((m) => m.id !== node.id)
      .sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0))
      .slice(0, 6)
    return { community: node.community, size: members.length, dominantKind, top }
  }, [nodes, node.community, node.id, node.kind, degree])

  const metaEntries = node.meta
    ? Object.entries(node.meta).filter(([, v]) => v != null && v !== '')
    : []

  return (
    <aside className="kb-graph-panel kb-nd">
      <button type="button" className="kb-graph-close" onClick={onClose}>
        ✕
      </button>

      <div className="kb-nd-title">
        <KindDot kind={node.kind} />
        <strong>{displayLabel(node, ambiguous)}</strong>
      </div>
      <div className="kb-nd-badges">
        <span className="kb-nd-badge">{node.kind}</span>
        <span className={`kb-nd-badge origin-${node.origin}`}>{node.origin}</span>
        {unified && <span className="kb-nd-badge dim">{node.projectPath.split('/').pop()}</span>}
      </div>

      <Section title="Overview">
        {node.relPath ? (
          <button
            type="button"
            className="kb-nd-path"
            title="Copy path"
            onClick={() => navigator.clipboard?.writeText(node.relPath ?? '')}
          >
            <code>{node.relPath}</code>
          </button>
        ) : (
          <div className="dim">no file (session node)</div>
        )}
        {metaEntries.length > 0 && (
          <dl className="kb-nd-meta">
            {metaEntries.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{String(v)}</dd>
              </div>
            ))}
          </dl>
        )}
      </Section>

      <Section title="Relations" count={relationCount}>
        {relationCount === 0 ? (
          <div className="dim">no connections</div>
        ) : (
          relationGroups.map((g) => (
            <div key={g.label} className="kb-nd-relgroup">
              <div className="kb-nd-rellabel">
                {g.label} <span className="kb-nd-count">{g.items.length}</span>
              </div>
              <ul>
                {g.items.map(({ n, inferred }) => (
                  <li key={n.id}>
                    <button type="button" className="link" onClick={() => onSelect(n)}>
                      <KindDot kind={n.kind} />
                      {displayLabel(n, ambiguous)}
                    </button>
                    {inferred && <span className="kb-nd-tag">inferred</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </Section>

      {cluster && (
        <Section title="Cluster">
          <div className="kb-nd-clusterhead">
            <span
              className="kb-nd-dot"
              style={{ background: colorForCommunity(cluster.community) }}
            />
            <span>cluster #{cluster.community}</span>
            <span className="dim">
              · {cluster.size} nodes · mostly {cluster.dominantKind}
            </span>
          </div>
          {cluster.top.length > 0 && (
            <ul>
              {cluster.top.map((m) => (
                <li key={m.id}>
                  <button type="button" className="link" onClick={() => onSelect(m)}>
                    <KindDot kind={m.kind} />
                    {displayLabel(m, ambiguous)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      <Preview node={node} relationGroups={relationGroups} />
    </aside>
  )
}

// Lazily fetches the file preview only when its section is opened.
function Preview({
  node,
  relationGroups,
}: {
  node: Node
  relationGroups: Array<{ label: string; items: Array<{ n: Node; inferred: boolean }> }>
}) {
  const [open, setOpen] = useState(false)
  const preview = trpc.graph.nodePreview.useQuery({ nodeId: node.id }, { enabled: open })

  const touches = relationGroups.find((g) => g.label === 'Touches files')?.items.length ?? 0

  return (
    <section className="kb-nd-section">
      <button type="button" className="kb-nd-head" onClick={() => setOpen((v) => !v)}>
        <span className="kb-nd-caret">{open ? '▾' : '▸'}</span>
        <span>Preview</span>
      </button>
      {open && (
        <div className="kb-nd-body">
          {node.kind === 'session' ? (
            <div className="dim">session node · touches {touches} files (see Relations)</div>
          ) : preview.isLoading ? (
            <div className="dim">loading…</div>
          ) : !preview.data ? (
            <div className="dim">no preview available</div>
          ) : (
            <>
              {preview.data.truncated && (
                <div className="kb-nd-trunc">
                  showing first {preview.data.content.split('\n').length} of{' '}
                  {preview.data.totalLines} lines
                </div>
              )}
              {preview.data.language === 'markdown' ? (
                <div className="kb-nd-md kb-md">
                  <Markdown remarkPlugins={[remarkGfm]}>{preview.data.content}</Markdown>
                </div>
              ) : (
                <pre className="kb-nd-code">
                  {preview.data.language && (
                    <span className="kb-nd-lang">{preview.data.language}</span>
                  )}
                  <code>{preview.data.content}</code>
                </pre>
              )}
            </>
          )}
        </div>
      )}
    </section>
  )
}
