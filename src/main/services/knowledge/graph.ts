import type {
  ArticleKind,
  ArticleMeta,
  GraphEdge,
  GraphNode,
  KnowledgeGraph,
} from '@shared/knowledge'
import { resolveWikilink } from '@shared/knowledge'

export interface GraphArticleInput {
  project: string
  relPath: string // 'concepts/foo.md'
  kind: ArticleKind
  title: string
  tags: string[]
  aliases: string[]
  updated: string | null
  sources: string[] // raw frontmatter source strings, e.g. 'daily/2026-06-09.md'
  body: string
}

export interface GraphDailyInput {
  project: string
  date: string // '2026-06-09'
  relPath: string // '2026-06-09.md' (relative to the project's daily/ dir)
}

const stripExt = (s: string): string => s.replace(/\.md$/, '')
const conceptId = (project: string, relPath: string): string => `${project}::${stripExt(relPath)}`
const dailyId = (project: string, date: string): string => `${project}::daily/${date}`
const ghostId = (project: string, target: string): string => `${project}::ghost::${target}`

// Build the knowledge graph from per-project articles + daily entries. Pure: no
// fs, no clustering (community is 0 on every node here — assignCommunities fills
// it). Wikilinks are project-relative, so resolution is scoped per project.
export function buildGraph(
  articles: GraphArticleInput[],
  daily: GraphDailyInput[],
): KnowledgeGraph {
  const nodes = new Map<string, GraphNode>()
  const edgeKeys = new Set<string>()
  const edges: GraphEdge[] = []

  const addEdge = (source: string, target: string, type: GraphEdge['type']): void => {
    if (source === target) return
    const key = `${source}|${target}|${type}`
    if (edgeKeys.has(key)) return
    edgeKeys.add(key)
    edges.push({ source, target, type })
  }

  // Pre-register concept/connection + daily nodes so links can resolve to them.
  for (const a of articles) {
    const id = conceptId(a.project, a.relPath)
    nodes.set(id, {
      id,
      label: a.title,
      type: a.kind === 'connection' ? 'connection' : 'concept',
      project: a.project,
      relPath: a.relPath,
      inDegree: 0,
      tags: a.tags,
      updated: a.updated,
      community: 0,
    })
  }
  const dailyByKey = new Map<string, GraphDailyInput>()
  for (const d of daily) {
    dailyByKey.set(`${d.project}|${d.date}`, d)
    const id = dailyId(d.project, d.date)
    nodes.set(id, {
      id,
      label: d.date,
      type: 'daily',
      project: d.project,
      relPath: d.relPath,
      inDegree: 0,
      tags: [],
      updated: d.date,
      community: 0,
    })
  }

  // ArticleMeta[] per project for resolveWikilink (it matches path/slug/alias).
  const metaByProject = new Map<string, ArticleMeta[]>()
  for (const a of articles) {
    const list = metaByProject.get(a.project) ?? []
    list.push({
      relPath: a.relPath,
      kind: a.kind,
      title: a.title,
      tags: a.tags,
      aliases: a.aliases,
      updated: a.updated,
      inboundLinks: 0,
    })
    metaByProject.set(a.project, list)
  }

  // Resolve a single wikilink/source target to a node id, creating a ghost node
  // for unresolved concept-style targets. Returns [targetId, edgeType].
  const resolveTarget = (project: string, rawTarget: string): [string, GraphEdge['type']] => {
    const target = stripExt(rawTarget.trim())
    if (target.startsWith('daily/')) {
      const date = target.slice('daily/'.length)
      const d = dailyByKey.get(`${project}|${date}`)
      // Unknown daily target: still create the daily node so the edge resolves.
      if (!d) {
        const id = dailyId(project, date)
        if (!nodes.has(id)) {
          nodes.set(id, {
            id,
            label: date,
            type: 'daily',
            project,
            relPath: `${date}.md`,
            inDegree: 0,
            tags: [],
            updated: date,
            community: 0,
          })
        }
        return [id, 'source']
      }
      return [dailyId(project, d.date), 'source']
    }
    const resolved = resolveWikilink(target, metaByProject.get(project) ?? [])
    if (resolved) return [conceptId(project, resolved), 'link']
    const id = ghostId(project, target)
    if (!nodes.has(id)) {
      nodes.set(id, {
        id,
        label: target,
        type: 'ghost',
        project,
        relPath: '',
        inDegree: 0,
        tags: [],
        updated: null,
        community: 0,
      })
    }
    return [id, 'link']
  }

  for (const a of articles) {
    const sourceId = conceptId(a.project, a.relPath)
    for (const raw of a.sources) {
      const [targetId, type] = resolveTarget(a.project, raw)
      addEdge(sourceId, targetId, type)
    }
    for (const m of a.body.matchAll(/\[\[([^\]]+)\]\]/g)) {
      const [targetId, type] = resolveTarget(a.project, m[1])
      addEdge(sourceId, targetId, type)
    }
  }

  for (const e of edges) {
    const target = nodes.get(e.target)
    if (target) target.inDegree += 1
  }

  return { nodes: [...nodes.values()], edges }
}
