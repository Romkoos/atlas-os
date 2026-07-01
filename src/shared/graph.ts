import { z } from 'zod'

export const codeNodeKindSchema = z.enum(['code', 'doc', 'skill', 'knowledge', 'session'])
export type CodeNodeKind = z.infer<typeof codeNodeKindSchema>

export const codeEdgeKindSchema = z.enum([
  'imports',
  'doc_link',
  'session_touched',
  'mentions_knowledge',
  'semantic',
])
export type CodeEdgeKind = z.infer<typeof codeEdgeKindSchema>

export const graphOriginSchema = z.enum(['indexer', 'graphify'])
export type GraphOrigin = z.infer<typeof graphOriginSchema>

export const codeGraphNodeSchema = z.object({
  id: z.string(),
  projectPath: z.string(),
  kind: codeNodeKindSchema,
  label: z.string(),
  relPath: z.string().nullable(),
  meta: z.record(z.string(), z.unknown()).nullable(),
  community: z.number().nullable(),
  origin: graphOriginSchema,
})
export type CodeGraphNode = z.infer<typeof codeGraphNodeSchema>

export const codeGraphEdgeSchema = z.object({
  id: z.string(),
  projectPath: z.string(),
  source: z.string(),
  target: z.string(),
  kind: codeEdgeKindSchema,
  inferred: z.boolean(),
  origin: graphOriginSchema,
  meta: z.record(z.string(), z.unknown()).nullable(),
})
export type CodeGraphEdge = z.infer<typeof codeGraphEdgeSchema>

export const codeGraphSchema = z.object({
  nodes: z.array(codeGraphNodeSchema),
  edges: z.array(codeGraphEdgeSchema),
})
export type CodeGraph = z.infer<typeof codeGraphSchema>

export const graphClusterSchema = z.object({
  community: z.number(),
  size: z.number(),
  dominantKind: codeNodeKindSchema,
  topNodes: z.array(z.object({ id: z.string(), label: z.string() })),
})
export type GraphCluster = z.infer<typeof graphClusterSchema>

// Deterministic ids so re-indexing is idempotent (onConflict / delete+insert).
export function codeNodeId(projectPath: string, kind: CodeNodeKind, key: string): string {
  return `${projectPath}::${kind}::${key}`
}
export function codeEdgeId(source: string, target: string, kind: CodeEdgeKind): string {
  return `${source}|${target}|${kind}`
}
