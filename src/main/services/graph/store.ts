import { basename } from 'node:path'
import type { AppDatabase } from '@main/db/client'
import { agentSessions, graphEdges, graphNodes } from '@main/db/schema'
import type { CodeGraph, CodeGraphEdge, CodeGraphNode } from '@shared/graph'
import { and, eq, sql } from 'drizzle-orm'

function toNodeRow(n: CodeGraphNode) {
  return {
    id: n.id,
    projectPath: n.projectPath,
    kind: n.kind,
    label: n.label,
    relPath: n.relPath,
    meta: n.meta ?? null,
    community: n.community,
    origin: n.origin,
    updatedAt: new Date(),
  }
}
function toEdgeRow(e: CodeGraphEdge) {
  return {
    id: e.id,
    projectPath: e.projectPath,
    source: e.source,
    target: e.target,
    kind: e.kind,
    inferred: e.inferred,
    origin: e.origin,
    meta: e.meta ?? null,
  }
}

function replaceLayer(
  database: AppDatabase,
  projectPath: string,
  origin: 'indexer' | 'graphify',
  graph: CodeGraph,
): void {
  database.transaction((tx) => {
    tx.delete(graphNodes)
      .where(and(eq(graphNodes.projectPath, projectPath), eq(graphNodes.origin, origin)))
      .run()
    tx.delete(graphEdges)
      .where(and(eq(graphEdges.projectPath, projectPath), eq(graphEdges.origin, origin)))
      .run()
    for (const n of graph.nodes) tx.insert(graphNodes).values(toNodeRow(n)).run()
    for (const e of graph.edges) tx.insert(graphEdges).values(toEdgeRow(e)).run()
  })
}

export function saveStructuralGraph(
  database: AppDatabase,
  projectPath: string,
  graph: CodeGraph,
): void {
  replaceLayer(database, projectPath, 'indexer', graph)
}
export function saveGraphifyGraph(
  database: AppDatabase,
  projectPath: string,
  additions: CodeGraph,
): void {
  replaceLayer(database, projectPath, 'graphify', additions)
}

export function loadGraph(database: AppDatabase, scope: string): CodeGraph {
  const nodeRows =
    scope === '__all__'
      ? database.select().from(graphNodes).all()
      : database.select().from(graphNodes).where(eq(graphNodes.projectPath, scope)).all()
  const edgeRows =
    scope === '__all__'
      ? database.select().from(graphEdges).all()
      : database.select().from(graphEdges).where(eq(graphEdges.projectPath, scope)).all()
  const nodes: CodeGraphNode[] = nodeRows.map((r) => ({
    id: r.id,
    projectPath: r.projectPath,
    kind: r.kind as CodeGraphNode['kind'],
    label: r.label,
    relPath: r.relPath,
    meta: r.meta ?? null,
    community: r.community,
    origin: r.origin as CodeGraphNode['origin'],
  }))
  const edges: CodeGraphEdge[] = edgeRows.map((r) => ({
    id: r.id,
    projectPath: r.projectPath,
    source: r.source,
    target: r.target,
    kind: r.kind as CodeGraphEdge['kind'],
    inferred: r.inferred,
    origin: r.origin as CodeGraphEdge['origin'],
    meta: r.meta ?? null,
  }))
  return { nodes, edges }
}

// Atlas-tracked projects (distinct from agent_sessions) + graph presence.
export function listGraphProjects(
  database: AppDatabase,
): Array<{ projectPath: string; project: string; hasGraph: boolean; builtAt: number | null }> {
  const projects = database
    .selectDistinct({ projectPath: agentSessions.projectPath })
    .from(agentSessions)
    .all()
  const built = database
    .select({
      projectPath: graphNodes.projectPath,
      builtAt: sql<number>`max(${graphNodes.updatedAt})`,
    })
    .from(graphNodes)
    .groupBy(graphNodes.projectPath)
    .all()
  const builtMap = new Map(built.map((b) => [b.projectPath, b.builtAt]))
  return projects
    .map((p) => ({
      projectPath: p.projectPath,
      project: basename(p.projectPath) || p.projectPath,
      hasGraph: builtMap.has(p.projectPath),
      builtAt: builtMap.get(p.projectPath) ?? null,
    }))
    .sort((a, b) => a.project.localeCompare(b.project))
}
