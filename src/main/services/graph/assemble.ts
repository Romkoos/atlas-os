import { basename } from 'node:path'
import {
  type CodeEdgeKind,
  type CodeGraph,
  type CodeGraphEdge,
  type CodeGraphNode,
  type CodeNodeKind,
  codeEdgeId,
  codeNodeId,
} from '@shared/graph'

export interface AssembleInput {
  projectPath: string
  codeFiles: string[] // repo-relative paths
  imports: Array<{ from: string; to: string }> // resolved relPath -> relPath
  docs: string[] // markdown doc relPaths
  docLinks: Array<{ from: string; to: string }> // doc relPath -> repo relPath
  skills: string[] // SKILL.md relPaths
  articles: Array<{ relPath: string; title: string; body: string }> // knowledge
  sessions: Array<{ sessionId: string; label: string; filesTouched: string[] }>
}

// Pure graph assembly: no fs, no DB, no clustering (community stays null until
// clusterGraph runs). Mirrors knowledge/graph.ts's buildGraph structure.
export function assembleGraph(input: AssembleInput): CodeGraph {
  const P = input.projectPath
  const nodes = new Map<string, CodeGraphNode>()
  const edges: CodeGraphEdge[] = []
  const edgeKeys = new Set<string>()

  const addNode = (
    kind: CodeNodeKind,
    key: string,
    label: string,
    relPath: string | null,
    meta: Record<string, unknown> | null = null,
  ): string => {
    const id = codeNodeId(P, kind, key)
    if (!nodes.has(id)) {
      nodes.set(id, {
        id,
        projectPath: P,
        kind,
        label,
        relPath,
        meta,
        community: null,
        origin: 'indexer',
      })
    }
    return id
  }

  const addEdge = (
    source: string,
    target: string,
    kind: CodeEdgeKind,
    inferred: boolean,
    meta: Record<string, unknown> | null = null,
  ): void => {
    if (source === target) return
    if (!nodes.has(source) || !nodes.has(target)) return
    const id = codeEdgeId(source, target, kind)
    if (edgeKeys.has(id)) return
    edgeKeys.add(id)
    edges.push({ id, projectPath: P, source, target, kind, inferred, origin: 'indexer', meta })
  }

  for (const f of input.codeFiles) addNode('code', f, basename(f), f)
  for (const d of input.docs) addNode('doc', d, basename(d), d)
  for (const s of input.skills) addNode('skill', s, basename(s.replace(/\/SKILL\.md$/, '')) || s, s)
  for (const a of input.articles) addNode('knowledge', a.relPath, a.title, a.relPath)
  for (const s of input.sessions) addNode('session', s.sessionId, s.label, null)

  for (const { from, to } of input.imports) {
    addEdge(codeNodeId(P, 'code', from), codeNodeId(P, 'code', to), 'imports', false)
  }
  for (const { from, to } of input.docLinks) {
    const target = input.codeFiles.includes(to)
      ? codeNodeId(P, 'code', to)
      : codeNodeId(P, 'doc', to)
    addEdge(codeNodeId(P, 'doc', from), target, 'doc_link', false)
  }
  for (const s of input.sessions) {
    const src = codeNodeId(P, 'session', s.sessionId)
    for (const f of s.filesTouched) {
      if (input.codeFiles.includes(f))
        addEdge(src, codeNodeId(P, 'code', f), 'session_touched', false)
    }
  }
  // mentions_knowledge: an article whose body names a code/doc file's basename.
  for (const a of input.articles) {
    const target = codeNodeId(P, 'knowledge', a.relPath)
    const body = a.body.toLowerCase()
    for (const f of [...input.codeFiles, ...input.docs]) {
      const name = basename(f).toLowerCase()
      if (name.length >= 4 && body.includes(name)) {
        const kind: CodeNodeKind = input.codeFiles.includes(f) ? 'code' : 'doc'
        addEdge(codeNodeId(P, kind, f), target, 'mentions_knowledge', true, { via: name })
      }
    }
  }

  // knowledge cross-links: an article's `[[wikilink]]` targets another article.
  // Targets are the relPath without `.md` (e.g. `[[concepts/foo]]` → concepts/foo.md)
  // or a bare slug (the article's basename). Resolve to the target knowledge node
  // and emit an EXTRACTED doc_link between the two articles. This is what connects
  // the knowledge layer to itself — without it, articles only link to code/docs.
  const knowledgeBySlug = new Map<string, string>()
  for (const a of input.articles) {
    const id = codeNodeId(P, 'knowledge', a.relPath)
    const noExt = a.relPath.replace(/\.md$/, '')
    knowledgeBySlug.set(noExt, id)
    knowledgeBySlug.set(basename(noExt), id)
  }
  for (const a of input.articles) {
    const from = codeNodeId(P, 'knowledge', a.relPath)
    for (const m of a.body.matchAll(/\[\[([^\]]+)\]\]/g)) {
      const key = m[1].split('|')[0].split('#')[0].trim()
      const target = knowledgeBySlug.get(key) ?? knowledgeBySlug.get(basename(key))
      if (target) addEdge(from, target, 'doc_link', false)
    }
  }

  return { nodes: [...nodes.values()], edges }
}
