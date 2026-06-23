import { z } from 'zod'

export const articleKindSchema = z.enum(['concept', 'connection', 'qa'])
export type ArticleKind = z.infer<typeof articleKindSchema>

export const articleMetaSchema = z.object({
  relPath: z.string(),
  kind: articleKindSchema,
  title: z.string(),
  tags: z.array(z.string()),
  aliases: z.array(z.string()),
  updated: z.string().nullable(),
  inboundLinks: z.number(),
})
export type ArticleMeta = z.infer<typeof articleMetaSchema>

export const knowledgeProjectSchema = z.object({
  name: z.string(),
  path: z.string(),
  articleCount: z.number(),
  dailyCount: z.number(),
  lastUpdated: z.string().nullable(),
})
export type KnowledgeProject = z.infer<typeof knowledgeProjectSchema>

export const articleDocSchema = z.object({
  frontmatter: z.record(z.string(), z.unknown()),
  body: z.string(),
})
export type ArticleDoc = z.infer<typeof articleDocSchema>

export const dailyEntrySchema = z.object({ date: z.string(), relPath: z.string() })
export type DailyEntry = z.infer<typeof dailyEntrySchema>

export const compileResultSchema = z.object({
  project: z.string(),
  status: z.enum(['compiled', 'nothing', 'error']),
  summary: z.string(),
})
export type CompileResult = z.infer<typeof compileResultSchema>

// Strip the .md suffix: 'concepts/x.md' -> 'concepts/x'.
const stripExt = (relPath: string): string => relPath.replace(/\.md$/, '')

// Resolve a wikilink target ('concepts/x' or bare 'x') to an article relPath,
// or null if dangling. Match order: exact path, filename slug, alias.
export function resolveWikilink(link: string, articles: ArticleMeta[]): string | null {
  const target = link.trim()
  const byPath = articles.find((a) => stripExt(a.relPath) === target)
  if (byPath) return byPath.relPath
  const bySlug = articles.find((a) => stripExt(a.relPath).split('/').pop() === target)
  if (bySlug) return bySlug.relPath
  const byAlias = articles.find((a) => a.aliases.includes(target))
  return byAlias ? byAlias.relPath : null
}

// Count articles (excluding the target itself) whose body wikilinks the target,
// either by full path ([[concepts/x]]) or bare slug ([[x]]).
export function countInbound(
  relPath: string,
  bodies: ReadonlyArray<{ relPath: string; body: string }>,
): number {
  const path = stripExt(relPath)
  const slug = path.split('/').pop() ?? path
  let n = 0
  for (const b of bodies) {
    if (b.relPath === relPath) continue
    if (b.body.includes(`[[${path}]]`) || b.body.includes(`[[${slug}]]`)) n++
  }
  return n
}

export const graphNodeTypeSchema = z.enum(['concept', 'connection', 'daily', 'ghost'])
export type GraphNodeType = z.infer<typeof graphNodeTypeSchema>

export const graphNodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: graphNodeTypeSchema,
  project: z.string(),
  relPath: z.string(),
  inDegree: z.number(),
  tags: z.array(z.string()),
  updated: z.string().nullable(),
  community: z.number(),
})
export type GraphNode = z.infer<typeof graphNodeSchema>

export const graphEdgeSchema = z.object({
  source: z.string(),
  target: z.string(),
  type: z.enum(['link', 'source']),
})
export type GraphEdge = z.infer<typeof graphEdgeSchema>

export const knowledgeGraphSchema = z.object({
  nodes: z.array(graphNodeSchema),
  edges: z.array(graphEdgeSchema),
})
export type KnowledgeGraph = z.infer<typeof knowledgeGraphSchema>
