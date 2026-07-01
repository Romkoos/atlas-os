import { basename } from 'node:path'

import {
  type CodeGraph,
  type CodeGraphEdge,
  type CodeGraphNode,
  type CodeNodeKind,
  codeEdgeId,
  codeNodeId,
} from '@shared/graph'

export interface GraphifyNode {
  id: string
  label?: string
  source_file?: string
  file_type?: string
  community?: number
}
export interface GraphifyLink {
  source?: string
  target?: string
  _src?: string
  _tgt?: string
  relation?: string
  confidence?: string
}
export interface GraphifyJson {
  nodes: GraphifyNode[]
  links: GraphifyLink[]
}

// Defensive parse of graphify's networkx node-link graph.json. Never throws.
export function parseGraphifyJson(raw: string): GraphifyJson {
  try {
    const d = JSON.parse(raw) as Record<string, unknown>
    const nodes = Array.isArray(d.nodes) ? (d.nodes as GraphifyNode[]) : []
    const links = Array.isArray(d.links)
      ? (d.links as GraphifyLink[])
      : Array.isArray(d.edges)
        ? (d.edges as GraphifyLink[])
        : []
    return { nodes, links }
  } catch {
    return { nodes: [], links: [] }
  }
}

function kindForFileType(fileType: string | undefined): CodeNodeKind {
  if (fileType === 'markdown' || fileType === 'doc') return 'doc'
  return 'code'
}

// Merge graphify's LLM graph onto the structural graph. Returns ONLY the
// graphify-origin additions (new nodes + semantic edges) — the caller persists
// these as the 'graphify' layer, leaving the 'indexer' layer untouched.
export function mergeGraphifyGraph(
  projectPath: string,
  structural: CodeGraph,
  gy: GraphifyJson,
): CodeGraph {
  const relToExistingId = new Map<string, string>()
  for (const n of structural.nodes) if (n.relPath) relToExistingId.set(n.relPath, n.id)

  const gidToRel = new Map<string, string>()
  for (const gn of gy.nodes) if (gn.id && gn.source_file) gidToRel.set(gn.id, gn.source_file)

  const newNodes = new Map<string, CodeGraphNode>()

  const resolveNodeId = (gid: string | undefined): string | null => {
    if (!gid) return null
    const rel = gidToRel.get(gid)
    if (rel && relToExistingId.has(rel)) return relToExistingId.get(rel) as string
    // graphify knows a file the structural pass didn't index → create it.
    const gn = gy.nodes.find((n) => n.id === gid)
    const kind = kindForFileType(gn?.file_type)
    const key = rel ?? gid
    const id = codeNodeId(projectPath, kind, key)
    if (!newNodes.has(id)) {
      newNodes.set(id, {
        id,
        projectPath,
        kind,
        label: gn?.label ?? (rel ? basename(rel) : gid),
        relPath: rel ?? null,
        meta: { origin: 'graphify' },
        community: typeof gn?.community === 'number' ? gn.community : null,
        origin: 'graphify',
      })
    }
    return id
  }

  const edges: CodeGraphEdge[] = []
  const seen = new Set<string>()
  for (const l of gy.links) {
    const s = resolveNodeId(l.source ?? l._src)
    const t = resolveNodeId(l.target ?? l._tgt)
    if (!s || !t || s === t) continue
    const id = codeEdgeId(s, t, 'semantic')
    if (seen.has(id)) continue
    seen.add(id)
    const audit = l.confidence ?? 'INFERRED'
    edges.push({
      id,
      projectPath,
      source: s,
      target: t,
      kind: 'semantic',
      inferred: audit !== 'EXTRACTED',
      origin: 'graphify',
      meta: { audit, relation: l.relation ?? null },
    })
  }

  return { nodes: [...newNodes.values()], edges }
}
