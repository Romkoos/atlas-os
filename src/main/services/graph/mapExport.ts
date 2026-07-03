import { cpSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { CodeGraph, CodeNodeKind } from '@shared/graph'
import { summarizeClusters } from './cluster'
import { mapsProjectDir } from './mapStore'

// Node kinds that belong in an agent-facing architecture map. `session` nodes
// are agent run-history telemetry: opaque hash labels, typically no structural
// edges, and by far the most numerous kind — they dominate the graph by count
// and their high-degree hashes pollute the "key nodes" column. Excluding them
// keeps the injected index about the code/docs/skills/knowledge that actually
// describe the project.
const INDEX_KINDS: ReadonlySet<CodeNodeKind> = new Set(['code', 'doc', 'skill', 'knowledge'])

// Artifacts worth keeping in the global store. graphify's `.graphify_*`
// intermediates and its `cache/` dir are intentionally excluded.
const KEEP: ReadonlySet<string> = new Set(['graph.json', 'graph.html', 'GRAPH_REPORT.md', 'wiki'])

export function shouldKeepArtifact(name: string): boolean {
  return KEEP.has(name)
}

// Escape markdown table-cell delimiters so labels containing `|` don't break
// the row into a spurious extra column.
function escapeTableCell(s: string): string {
  return s.replace(/\|/g, '\\|')
}

// Undirected degree per node id, from the edge list.
function degrees(graph: CodeGraph): Map<string, number> {
  const d = new Map<string, number>()
  for (const e of graph.edges) {
    d.set(e.source, (d.get(e.source) ?? 0) + 1)
    d.set(e.target, (d.get(e.target) ?? 0) + 1)
  }
  return d
}

// Pure: render the compact, injectable Map Index for a project. Kept small to
// protect the session context budget — top 12 communities, 3 key nodes each.
export function mapIndexMarkdown(project: string, graph: CodeGraph, builtAt: Date): string {
  // Restrict to architectural node kinds and drop edges that touch an excluded
  // node, so counts, communities, and key-node degrees all reflect the same
  // session-free subgraph.
  const nodes = graph.nodes.filter((n) => INDEX_KINDS.has(n.kind))
  const ids = new Set(nodes.map((n) => n.id))
  const edges = graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target))
  const sub: CodeGraph = { nodes, edges }

  const clusters = summarizeClusters(sub)
  const deg = degrees(sub)
  const date = builtAt.toISOString().slice(0, 10)
  const lines: string[] = [`# Map Index — ${project}`, '']
  lines.push(`${nodes.length} nodes · ${edges.length} edges · built ${date}`, '')
  lines.push('| Community | Size | Dominant | Key nodes |', '|---|---|---|---|')
  for (const c of clusters.slice(0, 12)) {
    const key = nodes
      .filter((n) => (n.community ?? 0) === c.community)
      .sort((a, b) => (deg.get(b.id) ?? 0) - (deg.get(a.id) ?? 0))
      .slice(0, 3)
      .map((n) => escapeTableCell(n.label))
      .join(', ')
    lines.push(`| ${c.community} | ${c.size} | ${c.dominantKind} | ${key} |`)
  }
  lines.push('')
  return lines.join('\n')
}

// Copy graphify's kept artifacts into the global store and write index.md.
// Returns the project's map dir. I/O only — markdown is built by the pure helper.
export function exportMap(projectPath: string, graphifyOutDir: string, graph: CodeGraph): string {
  const dir = mapsProjectDir(projectPath)
  const outDir = join(dir, 'graphify-out')
  // Clear stale artifacts from a prior build before recreating: if this build
  // fails to produce a real graph.json/wiki, we must not leave last build's
  // semantic files sitting next to a fresh structural-only index.md.
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  let entries: string[] = []
  try {
    entries = readdirSync(graphifyOutDir)
  } catch {
    entries = [] // no graphify-out (e.g. graphify failed) → still write index.md
  }
  for (const name of entries) {
    if (!shouldKeepArtifact(name)) continue
    cpSync(join(graphifyOutDir, name), join(outDir, name), { recursive: true })
  }
  writeFileSync(
    join(dir, 'index.md'),
    mapIndexMarkdown(basename(projectPath), graph, new Date()),
    'utf8',
  )
  return dir
}
