# Knowledge Graph View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an interactive force-directed graph view of the `~/atlas-knowledge` wiki-link structure to the Knowledge page, for navigating between articles and seeing the overall topic map.

**Architecture:** The main process parses every project's `.md` files, builds a `{nodes, edges}` graph from wiki-links + `sources:` frontmatter, and assigns Louvain communities — all as pure, unit-tested functions. A new `knowledge.graph` tRPC query returns the whole graph. The renderer adds a 4th tab `./graph` to the Knowledge page that draws it with `react-force-graph-2d` (canvas), with filters, community/project coloring, hover highlighting, click-to-read side panel, and search-to-zoom.

**Tech Stack:** TypeScript, Electron, tRPC v11, Zod, React 19, `graphology` + `graphology-communities-louvain` (main), `react-force-graph-2d` (renderer), Vitest, Playwright.

## Global Constraints

- **No renderer Node access** — all fs/parsing/clustering runs in the main process; the renderer only consumes the tRPC `knowledge.graph` output. (verbatim project rule: "Renderer has zero Node.js access. All domain operations run in main over a typed tRPC bridge.")
- **All tRPC procedures are Zod-validated** — `knowledge.graph` must have an `.output(knowledgeGraphSchema)`.
- **UI strings always English** — every label/tooltip/placeholder in English.
- **Path-traversal safety** — reuse `projectRoot()` / `assertInside()` from `store.ts`; never read paths outside the store root.
- **Pure functions are unit-tested; fs-walking glue is not** — matches the existing `store.test.ts` convention (only pure helpers like `parseFrontmatter` are tested, not `listArticles`'s fs walk).
- **electron pinned ~38.8.6** — do not bump Electron.
- **Spec:** `docs/superpowers/specs/2026-06-23-knowledge-graph-view-design.md`.

---

## File Structure

- **Create** `src/main/services/knowledge/graph.ts` — pure graph builder: input types, `buildGraph`, `assignCommunities`, `computeGraph`.
- **Create** `src/main/services/knowledge/graph.test.ts` — unit tests for the builder + community assignment.
- **Modify** `src/shared/knowledge.ts` — add `graphNodeSchema`, `graphEdgeSchema`, `knowledgeGraphSchema` + inferred types.
- **Modify** `src/main/services/knowledge/store.ts` — export `readAllArticles`; add `readGraphSources` (thin fs glue) returning the builder's input types.
- **Modify** `src/main/trpc/routers/knowledge.ts` — add the `graph` query.
- **Create** `src/renderer/src/pages/knowledge/GraphTab.tsx` — the graph view component.
- **Create** `src/renderer/src/pages/knowledge/graph-colors.ts` — palette + color-by helpers (pure, reusable).
- **Modify** `src/renderer/src/pages/Knowledge.tsx` — add the `./graph` tab.
- **Modify** `e2e/app.spec.ts` — extend the smoke test to open the graph tab.

---

## Task 1: Graph schemas + pure `buildGraph`

**Files:**
- Modify: `src/shared/knowledge.ts`
- Create: `src/main/services/knowledge/graph.ts`
- Test: `src/main/services/knowledge/graph.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks. Reuses `resolveWikilink(link, articles)` from `@shared/knowledge` (match order: exact path → filename slug → alias) and the `stripExt` behavior (`'concepts/x.md'` → `'concepts/x'`).
- Produces:
  - Schemas/types in `@shared/knowledge`:
    - `GraphNode = { id: string; label: string; type: 'concept'|'connection'|'daily'|'ghost'; project: string; relPath: string; inDegree: number; tags: string[]; updated: string|null; community: number }`
    - `GraphEdge = { source: string; target: string; type: 'link'|'source' }`
    - `KnowledgeGraph = { nodes: GraphNode[]; edges: GraphEdge[] }`
  - In `graph.ts`:
    - `GraphArticleInput = { project: string; relPath: string; kind: 'concept'|'connection'|'qa'; title: string; tags: string[]; aliases: string[]; updated: string|null; sources: string[]; body: string }`
    - `GraphDailyInput = { project: string; date: string; relPath: string }` (`relPath` is the daily filename, e.g. `'2026-06-09.md'`)
    - `buildGraph(articles: GraphArticleInput[], daily: GraphDailyInput[]): KnowledgeGraph` — `community` is `0` on every node at this stage (filled by Task 2).

Node id scheme (used by later tasks): concept/connection `` `${project}::${stripExt(relPath)}` `` (e.g. `atlas-os::concepts/foo`); daily `` `${project}::daily/${date}` ``; ghost `` `${project}::ghost::${target}` ``.

- [ ] **Step 1: Add graph schemas to `src/shared/knowledge.ts`**

Append at the end of the file:

```ts
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
```

- [ ] **Step 2: Write the failing test `src/main/services/knowledge/graph.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { type GraphArticleInput, type GraphDailyInput, buildGraph } from './graph'

const article = (over: Partial<GraphArticleInput>): GraphArticleInput => ({
  project: 'p',
  relPath: 'concepts/a.md',
  kind: 'concept',
  title: 'A',
  tags: [],
  aliases: [],
  updated: null,
  sources: [],
  body: '',
  ...over,
})

describe('buildGraph', () => {
  it('creates one node per article with id namespaced by project', () => {
    const g = buildGraph([article({ relPath: 'concepts/a.md', title: 'Alpha' })], [])
    expect(g.nodes).toHaveLength(1)
    expect(g.nodes[0]).toMatchObject({ id: 'p::concepts/a', label: 'Alpha', type: 'concept', project: 'p' })
  })

  it('resolves a body wikilink to a link edge between articles', () => {
    const g = buildGraph(
      [
        article({ relPath: 'concepts/a.md', body: 'see [[concepts/b]]' }),
        article({ relPath: 'concepts/b.md', title: 'B' }),
      ],
      [],
    )
    expect(g.edges).toContainEqual({ source: 'p::concepts/a', target: 'p::concepts/b', type: 'link' })
  })

  it('resolves a bare-slug wikilink via filename', () => {
    const g = buildGraph(
      [article({ relPath: 'concepts/a.md', body: '[[b]]' }), article({ relPath: 'concepts/b.md' })],
      [],
    )
    expect(g.edges).toContainEqual({ source: 'p::concepts/a', target: 'p::concepts/b', type: 'link' })
  })

  it('creates a ghost node for an unresolved wikilink', () => {
    const g = buildGraph([article({ relPath: 'concepts/a.md', body: '[[concepts/missing]]' })], [])
    const ghost = g.nodes.find((n) => n.type === 'ghost')
    expect(ghost).toMatchObject({ id: 'p::ghost::concepts/missing', label: 'concepts/missing', relPath: '' })
    expect(g.edges).toContainEqual({ source: 'p::concepts/a', target: 'p::ghost::concepts/missing', type: 'link' })
  })

  it('links an article to a daily node via sources frontmatter as a source edge', () => {
    const daily: GraphDailyInput = { project: 'p', date: '2026-06-09', relPath: '2026-06-09.md' }
    const g = buildGraph([article({ relPath: 'concepts/a.md', sources: ['daily/2026-06-09.md'] })], [daily])
    expect(g.nodes).toContainEqual(
      expect.objectContaining({ id: 'p::daily/2026-06-09', type: 'daily', relPath: '2026-06-09.md' }),
    )
    expect(g.edges).toContainEqual({ source: 'p::concepts/a', target: 'p::daily/2026-06-09', type: 'source' })
  })

  it('treats a body wikilink to a daily log as a source edge', () => {
    const daily: GraphDailyInput = { project: 'p', date: '2026-06-09', relPath: '2026-06-09.md' }
    const g = buildGraph([article({ relPath: 'concepts/a.md', body: 'from [[daily/2026-06-09.md]]' })], [daily])
    expect(g.edges).toContainEqual({ source: 'p::concepts/a', target: 'p::daily/2026-06-09', type: 'source' })
  })

  it('dedups duplicate edges and skips self-links', () => {
    const g = buildGraph(
      [
        article({ relPath: 'concepts/a.md', body: '[[concepts/b]] and again [[concepts/b]] and [[concepts/a]]' }),
        article({ relPath: 'concepts/b.md' }),
      ],
      [],
    )
    const ab = g.edges.filter((e) => e.source === 'p::concepts/a' && e.target === 'p::concepts/b')
    expect(ab).toHaveLength(1)
    expect(g.edges.some((e) => e.source === e.target)).toBe(false)
  })

  it('computes inDegree as the count of incoming edges', () => {
    const g = buildGraph(
      [
        article({ relPath: 'concepts/a.md', body: '[[concepts/c]]' }),
        article({ relPath: 'concepts/b.md', body: '[[concepts/c]]' }),
        article({ relPath: 'concepts/c.md' }),
      ],
      [],
    )
    expect(g.nodes.find((n) => n.id === 'p::concepts/c')?.inDegree).toBe(2)
  })

  it('keeps same-named concepts in different projects as distinct nodes', () => {
    const g = buildGraph(
      [article({ project: 'p1', relPath: 'concepts/x.md' }), article({ project: 'p2', relPath: 'concepts/x.md' })],
      [],
    )
    expect(g.nodes.map((n) => n.id).sort()).toEqual(['p1::concepts/x', 'p2::concepts/x'])
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm test -- src/main/services/knowledge/graph.test.ts`
Expected: FAIL — `Cannot find module './graph'`.

- [ ] **Step 4: Implement `src/main/services/knowledge/graph.ts`**

```ts
import { resolveWikilink } from '@shared/knowledge'
import type {
  ArticleKind,
  ArticleMeta,
  GraphEdge,
  GraphNode,
  KnowledgeGraph,
} from '@shared/knowledge'

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

const WIKILINK = /\[\[([^\]]+)\]\]/g

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
  const resolveTarget = (
    project: string,
    rawTarget: string,
  ): [string, GraphEdge['type']] => {
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
    WIKILINK.lastIndex = 0
    let m: RegExpExecArray | null
    // biome-ignore lint/suspicious/noAssignInExpressions: standard regex exec loop
    while ((m = WIKILINK.exec(a.body)) !== null) {
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
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test -- src/main/services/knowledge/graph.test.ts`
Expected: PASS (all `buildGraph` tests green).

- [ ] **Step 6: Lint + typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/shared/knowledge.ts src/main/services/knowledge/graph.ts src/main/services/knowledge/graph.test.ts
git commit -m "feat(knowledge-graph): pure graph builder + schemas"
```

---

## Task 2: Louvain community assignment + `computeGraph`

**Files:**
- Modify: `src/main/services/knowledge/graph.ts`
- Modify: `src/main/services/knowledge/graph.test.ts`
- Modify: `package.json` (add `graphology`, `graphology-communities-louvain`)

**Interfaces:**
- Consumes: `buildGraph`, `KnowledgeGraph` from Task 1.
- Produces:
  - `assignCommunities(graph: KnowledgeGraph): KnowledgeGraph` — returns a new graph whose nodes have a `community` integer. Nodes in the same connected, densely-linked group share a community id. Isolated nodes each get a unique community id.
  - `computeGraph(articles: GraphArticleInput[], daily: GraphDailyInput[]): KnowledgeGraph` — `assignCommunities(buildGraph(articles, daily))`.

- [ ] **Step 1: Add dependencies**

```bash
pnpm add graphology graphology-communities-louvain
```

- [ ] **Step 2: Write the failing test (append to `graph.test.ts`)**

```ts
import { assignCommunities, computeGraph } from './graph'

describe('assignCommunities', () => {
  it('assigns the same community to two linked nodes', () => {
    const g = computeGraph(
      [article({ relPath: 'concepts/a.md', body: '[[concepts/b]]' }), article({ relPath: 'concepts/b.md' })],
      [],
    )
    const a = g.nodes.find((n) => n.id === 'p::concepts/a')
    const b = g.nodes.find((n) => n.id === 'p::concepts/b')
    expect(a?.community).toBe(b?.community)
  })

  it('assigns different communities to two unconnected nodes', () => {
    const g = computeGraph(
      [article({ relPath: 'concepts/a.md' }), article({ relPath: 'concepts/b.md' })],
      [],
    )
    const a = g.nodes.find((n) => n.id === 'p::concepts/a')
    const b = g.nodes.find((n) => n.id === 'p::concepts/b')
    expect(a?.community).not.toBe(b?.community)
  })

  it('returns a community number for every node, including ghosts', () => {
    const g = computeGraph([article({ relPath: 'concepts/a.md', body: '[[concepts/missing]]' })], [])
    expect(g.nodes.every((n) => Number.isInteger(n.community))).toBe(true)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm test -- src/main/services/knowledge/graph.test.ts`
Expected: FAIL — `assignCommunities`/`computeGraph` are not exported.

- [ ] **Step 4: Implement (append to `graph.ts`)**

```ts
import Graph from 'graphology'
import louvain from 'graphology-communities-louvain'

// Assign a community id to every node via Louvain modularity. Isolated nodes
// (no edges) each get their own community. Self-loops are skipped; the graph is
// treated as undirected for clustering.
export function assignCommunities(graph: KnowledgeGraph): KnowledgeGraph {
  const g = new Graph({ type: 'undirected', multi: false })
  for (const n of graph.nodes) g.addNode(n.id)
  for (const e of graph.edges) {
    if (e.source === e.target || g.hasEdge(e.source, e.target)) continue
    if (!g.hasNode(e.source) || !g.hasNode(e.target)) continue
    g.addEdge(e.source, e.target)
  }

  let communities: Record<string, number>
  if (g.size === 0) {
    // No edges: louvain has nothing to optimize — give each node its own id.
    communities = {}
    graph.nodes.forEach((n, i) => {
      communities[n.id] = i
    })
  } else {
    communities = louvain(g)
  }

  return {
    nodes: graph.nodes.map((n) => ({ ...n, community: communities[n.id] ?? 0 })),
    edges: graph.edges,
  }
}

export function computeGraph(
  articles: GraphArticleInput[],
  daily: GraphDailyInput[],
): KnowledgeGraph {
  return assignCommunities(buildGraph(articles, daily))
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test -- src/main/services/knowledge/graph.test.ts`
Expected: PASS.

- [ ] **Step 6: Lint + typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: no errors. (If TypeScript reports missing types for `graphology-communities-louvain`, add `// @ts-expect-error — package ships runtime-only` above its import; the package's default export is `louvain(graph) => Record<string, number>`.)

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml src/main/services/knowledge/graph.ts src/main/services/knowledge/graph.test.ts
git commit -m "feat(knowledge-graph): Louvain community assignment"
```

---

## Task 3: `readGraphSources` glue + `knowledge.graph` procedure

**Files:**
- Modify: `src/main/services/knowledge/store.ts`
- Modify: `src/main/trpc/routers/knowledge.ts`

**Interfaces:**
- Consumes: `computeGraph`, `GraphArticleInput`, `GraphDailyInput` from Tasks 1–2; existing `listProjects`, `listDaily`, `projectRoot`, `assertInside`, `parseFrontmatter`, `KINDS` from `store.ts`.
- Produces:
  - `readGraphSources(root: string, tracked: ReadonlySet<string>): { articles: GraphArticleInput[]; daily: GraphDailyInput[] }` — fs glue (not unit-tested, per the store convention).
  - tRPC query `knowledge.graph` → `KnowledgeGraph`.

This task is fs glue + tRPC wiring. Its gate is lint + typecheck; runtime behavior is covered by the Task 6 e2e smoke. There is no new unit test (the logic lives in the already-tested `computeGraph`).

- [ ] **Step 1: Export the article reader and add `readGraphSources` in `store.ts`**

Change the `readAllArticles` declaration from `function` to `export function`:

```ts
// All article files for a project, paired with parsed frontmatter + raw body.
export function readAllArticles(
```

Add these imports at the top of `store.ts` (extend the existing `@shared/knowledge` import and add the graph types):

```ts
import type { GraphArticleInput, GraphDailyInput } from './graph'
```

Append at the end of `store.ts`:

```ts
function asStr2(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

// Gather articles (with body) + daily entries across every visible project —
// the raw input computeGraph needs. fs glue; logic lives in the graph builder.
export function readGraphSources(
  root: string,
  tracked: ReadonlySet<string>,
): { articles: GraphArticleInput[]; daily: GraphDailyInput[] } {
  const articles: GraphArticleInput[] = []
  const daily: GraphDailyInput[] = []
  for (const { name: project } of listProjects(root, tracked)) {
    for (const { relPath, kind, doc } of readAllArticles(root, project)) {
      articles.push({
        project,
        relPath,
        kind,
        title: asStr(doc.frontmatter.title) ?? basename(relPath, '.md'),
        tags: asStrArray(doc.frontmatter.tags),
        aliases: asStrArray(doc.frontmatter.aliases),
        updated: asStr(doc.frontmatter.updated),
        sources: asStrArray(doc.frontmatter.sources),
        body: doc.body,
      })
    }
    for (const d of listDaily(root, project)) {
      daily.push({ project, date: d.date, relPath: d.relPath })
    }
  }
  return { articles, daily }
}
```

(Note: `asStr`, `asStrArray`, `basename` are already in scope in `store.ts`. The `asStr2` helper above is unused — delete it; it is only listed here as a reminder that no new string helper is needed. Do not add it.)

- [ ] **Step 2: Add the `graph` query in `src/main/trpc/routers/knowledge.ts`**

Extend the import from the store:

```ts
import {
  compileAll,
  listArticles,
  listDaily,
  listProjects,
  readArticle,
  readDaily,
  readGraphSources,
  readIndex,
  runQuery,
  storeRoot,
} from '@main/services/knowledge/store'
```

Add to the imports:

```ts
import { computeGraph } from '@main/services/knowledge/graph'
import { knowledgeGraphSchema } from '@shared/knowledge'
```

Add a new procedure inside the `router({ … })` block (e.g. right after `projects`):

```ts
  graph: publicProcedure.output(knowledgeGraphSchema).query(() => {
    const { articles, daily } = readGraphSources(storeRoot(), tracked())
    return computeGraph(articles, daily)
  }),
```

- [ ] **Step 3: Lint + typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Smoke the procedure against the real store**

Run: `pnpm test` (full unit suite still green — confirms Tasks 1–2 untouched).
Expected: PASS.

Then verify the wiring compiles end-to-end by building once:

Run: `pnpm build`
Expected: build succeeds (typecheck + electron-vite build).

- [ ] **Step 5: Commit**

```bash
git add src/main/services/knowledge/store.ts src/main/trpc/routers/knowledge.ts
git commit -m "feat(knowledge-graph): readGraphSources glue + knowledge.graph query"
```

---

## Task 4: Graph tab scaffold (render nodes)

**Files:**
- Modify: `package.json` (add `react-force-graph-2d`)
- Create: `src/renderer/src/pages/knowledge/graph-colors.ts`
- Create: `src/renderer/src/pages/knowledge/GraphTab.tsx`
- Modify: `src/renderer/src/pages/Knowledge.tsx`

**Interfaces:**
- Consumes: `knowledge.graph` query (Task 3); `GraphNode`, `GraphEdge`, `KnowledgeGraph` from `@shared/knowledge`.
- Produces:
  - `graph-colors.ts`: `PALETTE: string[]`, `colorForCommunity(community: number): string`, `colorForProject(project: string, projects: string[]): string`.
  - `GraphTab({ project }: { project: string })` — renders the force graph. (`project` is the page's active project, used only as the default focus filter in Task 5; in this task it is accepted but the graph renders global.)
  - A `./graph` tab in `Knowledge.tsx`.

- [ ] **Step 1: Add the dependency**

```bash
pnpm add react-force-graph-2d
```

- [ ] **Step 2: Create `src/renderer/src/pages/knowledge/graph-colors.ts`**

```ts
// Categorical palette for graph node coloring (community or project). Chosen to
// read on the dark terminal background.
export const PALETTE: readonly string[] = [
  '#e6b450', // amber
  '#59c2ff', // blue
  '#7fd962', // green
  '#d2a6ff', // violet
  '#ff8f40', // orange
  '#f07178', // red
  '#5ccfe6', // cyan
  '#ffd173', // gold
  '#bae67e', // lime
  '#cfbafa', // lavender
]

export function colorForCommunity(community: number): string {
  const i = ((community % PALETTE.length) + PALETTE.length) % PALETTE.length
  return PALETTE[i]
}

export function colorForProject(project: string, projects: string[]): string {
  const i = Math.max(0, projects.indexOf(project))
  return PALETTE[i % PALETTE.length]
}
```

- [ ] **Step 3: Create `src/renderer/src/pages/knowledge/GraphTab.tsx`**

```tsx
import { trpc } from '@renderer/lib/trpc'
import type { GraphNode } from '@shared/knowledge'
import { useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import { colorForCommunity } from './graph-colors'

// react-force-graph mutates node objects (x/y), so we feed it fresh copies.
type FgNode = GraphNode & { x?: number; y?: number }
type FgLink = { source: string; target: string; type: 'link' | 'source' }

export function GraphTab({ project: _project }: { project: string }) {
  const graph = trpc.knowledge.graph.useQuery()
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })

  // Measure the container so the canvas fills the pane.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const data = useMemo(() => {
    const nodes: FgNode[] = (graph.data?.nodes ?? []).map((n) => ({ ...n }))
    const links: FgLink[] = (graph.data?.edges ?? []).map((e) => ({
      source: e.source,
      target: e.target,
      type: e.type,
    }))
    return { nodes, links }
  }, [graph.data])

  if (graph.isPending) {
    return <div className="kb-graph-empty">// loading graph…</div>
  }
  if (!graph.data || graph.data.nodes.length === 0) {
    return <div className="kb-graph-empty">// no linked knowledge yet.</div>
  }

  return (
    <div className="kb-graph" ref={containerRef}>
      <ForceGraph2D
        width={size.w}
        height={size.h}
        graphData={data}
        backgroundColor="transparent"
        nodeId="id"
        nodeLabel={(n) => (n as FgNode).label}
        nodeVal={(n) => Math.max(1, (n as FgNode).inDegree)}
        nodeColor={(n) =>
          (n as FgNode).type === 'ghost' ? 'rgba(150,150,150,0.4)' : colorForCommunity((n as FgNode).community)
        }
        linkColor={() => 'rgba(120,120,120,0.25)'}
        linkWidth={(l) => ((l as FgLink).type === 'source' ? 0.5 : 1)}
      />
    </div>
  )
}
```

- [ ] **Step 4: Add the `./graph` tab to `src/renderer/src/pages/Knowledge.tsx`**

Add the import:

```tsx
import { GraphTab } from '@renderer/pages/knowledge/GraphTab'
```

Change the `Tab` type and `TABS`:

```tsx
type Tab = 'browse' | 'daily' | 'search' | 'graph'

const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: 'browse', label: './browse' },
  { id: 'daily', label: './daily' },
  { id: 'search', label: './search' },
  { id: 'graph', label: './graph' },
]
```

Add the tab body alongside the others (after the `search` line):

```tsx
              {tab === 'graph' && <GraphTab key={active} project={active} />}
```

- [ ] **Step 5: Add minimal styling**

Find the Knowledge styles (search for `.kb-layout` to locate the stylesheet, likely `src/renderer/src/assets/*.css` or a co-located `.css`):

Run: `grep -rl "kb-layout" src/renderer/src`

Append to that file:

```css
.kb-graph {
  width: 100%;
  height: 70vh;
  margin-top: 16px;
  border: 1px solid var(--border, #333);
  border-radius: 4px;
  overflow: hidden;
}
.kb-graph-empty {
  margin-top: 16px;
  font-family: var(--mono);
  font-size: 12px;
  color: var(--fg-3);
}
```

- [ ] **Step 6: Verify it builds and renders**

Run: `pnpm lint && pnpm typecheck`
Expected: no errors.

Run: `pnpm dev`
Manually: open Knowledge (Cmd+4) → click `./graph`. Expected: a force-directed graph of colored nodes renders and settles; hovering a node shows its title tooltip. Stop dev when confirmed.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml src/renderer/src/pages/knowledge/graph-colors.ts src/renderer/src/pages/knowledge/GraphTab.tsx src/renderer/src/pages/Knowledge.tsx
git add -A src/renderer/src   # picks up the edited stylesheet
git commit -m "feat(knowledge-graph): graph tab scaffold with force-directed render"
```

---

## Task 5: Filters, coloring toggle, hover highlight, click side-panel, search-zoom

**Files:**
- Modify: `src/renderer/src/pages/knowledge/GraphTab.tsx`
- Modify: the Knowledge stylesheet from Task 4 Step 5.

**Interfaces:**
- Consumes: everything from Task 4; `knowledge.article` and `knowledge.dailyArticle` queries; `MarkdownView` from `@renderer/pages/knowledge/MarkdownView` (props: `{ body: string; frontmatter?: Record<string, unknown>; articles: ArticleMeta[]; onNavigate: (relPath: string) => void }`); `colorForProject` from `graph-colors`.
- Produces: the finished interactive `GraphTab` (no new exported symbols).

- [ ] **Step 1: Replace `GraphTab.tsx` with the full interactive version**

```tsx
import { trpc } from '@renderer/lib/trpc'
import { MarkdownView } from '@renderer/pages/knowledge/MarkdownView'
import type { ArticleMeta, GraphNode, GraphNodeType } from '@shared/knowledge'
import { useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import { colorForCommunity, colorForProject } from './graph-colors'

type FgNode = GraphNode & { x?: number; y?: number }
type FgLink = { source: string | FgNode; target: string | FgNode; type: 'link' | 'source' }
type ColorBy = 'community' | 'project'

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
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })

  const [colorBy, setColorBy] = useState<ColorBy>('community')
  const [hidden, setHidden] = useState<Set<GraphNodeType>>(new Set())
  const [focusProject, setFocusProject] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<FgNode | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
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
      next.has(t) ? next.delete(t) : next.add(t)
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
  const isArticle = selected != null && (selected.type === 'concept' || selected.type === 'connection')
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
  // [[links]] and recenter the graph on click.
  const panelArticles: ArticleMeta[] = useMemo(() => {
    if (!selected) return []
    return (graph.data?.nodes ?? [])
      .filter((n) => n.project === selected.project && (n.type === 'concept' || n.type === 'connection'))
      .map((n) => ({
        relPath: n.relPath,
        kind: n.type === 'connection' ? 'connection' : 'concept',
        title: n.label,
        tags: n.tags,
        aliases: [],
        updated: n.updated,
        inboundLinks: n.inDegree,
      }))
  }, [graph.data, selected])

  const navigateTo = (relPath: string): void => {
    if (!selected) return
    const node = (graph.data?.nodes ?? []).find((n) => n.project === selected.project && n.relPath === relPath)
    if (node) setSelected({ ...node })
  }

  if (graph.isPending) return <div className="kb-graph-empty">// loading graph…</div>
  if (!graph.data || graph.data.nodes.length === 0) {
    return <div className="kb-graph-empty">// no linked knowledge yet.</div>
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
        <select value={focusProject} onChange={(e) => setFocusProject(e.target.value)} className="input">
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
        <div className="kb-graph" ref={containerRef}>
          <ForceGraph2D
            ref={fgRef}
            width={size.w}
            height={size.h}
            graphData={data}
            backgroundColor="transparent"
            nodeId="id"
            nodeLabel={(n) => (n as FgNode).label}
            nodeVal={(n) => Math.max(1, (n as FgNode).inDegree)}
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
              <div className="kb-graph-empty">// "{selected.label}" — referenced but not written yet.</div>
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
              <div className="kb-graph-empty">// loading…</div>
            )}
          </aside>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add styles for controls + side panel**

Append to the Knowledge stylesheet (same file as Task 4 Step 5):

```css
.kb-graph-wrap {
  margin-top: 16px;
}
.kb-graph-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
  font-family: var(--mono);
  font-size: 12px;
  color: var(--fg-2);
}
.kb-graph-check {
  display: inline-flex;
  gap: 4px;
  align-items: center;
}
.kb-graph-body {
  display: flex;
  gap: 12px;
}
.kb-graph {
  flex: 1;
  height: 70vh;
  border: 1px solid var(--border, #333);
  border-radius: 4px;
  overflow: hidden;
}
.kb-graph-panel {
  position: relative;
  width: 380px;
  max-height: 70vh;
  overflow-y: auto;
  border: 1px solid var(--border, #333);
  border-radius: 4px;
  padding: 16px;
}
.kb-graph-close {
  position: absolute;
  top: 6px;
  right: 8px;
  background: none;
  border: none;
  color: var(--fg-3);
  cursor: pointer;
}
```

- [ ] **Step 3: Lint + typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: no errors. (If Biome flags the ternary `next.has(t) ? next.delete(t) : next.add(t)` as an unused expression, rewrite as an `if/else`.)

- [ ] **Step 4: Manual verification**

Run: `pnpm dev` → Knowledge (Cmd+4) → `./graph`. Confirm each:
- Unchecking `daily` removes daily nodes; re-checking restores them.
- The project `<select>` defaults to the active project; choosing `all projects` shows every project's nodes.
- "color: community" ↔ "color: project" toggles node colors.
- Hovering a node dims everything except it and its neighbors.
- Clicking a concept opens the side panel with the rendered article; clicking a `[[link]]` inside it recenters on that node. Clicking a ghost node shows the "not written yet" message. Clicking the ✕ closes the panel.
- Typing a title fragment in "find node…" and pressing Enter zooms to and selects the match.

Stop dev when confirmed.

- [ ] **Step 5: Commit**

```bash
git add -A src/renderer/src
git commit -m "feat(knowledge-graph): filters, coloring, hover, side panel, search-zoom"
```

---

## Task 6: E2E smoke for the graph tab

**Files:**
- Modify: `e2e/app.spec.ts`

**Interfaces:**
- Consumes: the built app and the running renderer. Reuses the existing `_electron` launch pattern.

This test requires the local store (`~/atlas-knowledge`) to have at least one tracked project with a knowledge base (true on the dev machine). The assertion is intentionally shallow (tab switches, canvas mounts) to stay robust.

- [ ] **Step 1: Add the test to `e2e/app.spec.ts`**

```ts
test('Knowledge graph tab renders a canvas', async () => {
  const app = await electron.launch({ args: ['.'] })
  const window = await app.firstWindow()

  await expect(window.getByText('Atlas OS')).toBeVisible()
  await window.getByRole('button', { name: 'Knowledge' }).click()

  // The graph tab is only present when projects exist; skip cleanly otherwise.
  const graphTab = window.getByRole('button', { name: './graph' })
  if (await graphTab.isVisible().catch(() => false)) {
    await graphTab.click()
    await expect(window.locator('.kb-graph canvas')).toBeVisible({ timeout: 15000 })
  }

  await app.close()
})
```

- [ ] **Step 2: Build and run e2e**

Run: `pnpm build && pnpm e2e`
Expected: both tests pass (`boots…` and `Knowledge graph tab renders a canvas`).

- [ ] **Step 3: Commit**

```bash
git add e2e/app.spec.ts
git commit -m "test(knowledge-graph): e2e smoke for graph tab"
```

---

## Self-Review Notes

- **Spec coverage:** navigation (Task 5 click→side panel, link recenter) ✓; overview/communities (Task 2 Louvain, Task 4 coloring) ✓; nodes concept/connection/daily/ghost (Task 1) ✓; edges link/source (Task 1) ✓; project-relative resolution + namespaced ids (Task 1) ✓; backend `knowledge.graph` + pure builder (Tasks 1–3) ✓; `react-force-graph-2d`, size=inDegree, color=community/project toggle, hover highlight, filters, search-zoom (Tasks 4–5) ✓; ghost dimmed (Task 5 — note: rendered as dimmed gray, not a dashed outline; dashed outline deferred as v2 polish, consistent with the spec's "dimmed" intent) ✓; error/edge cases — broken link→ghost, empty graph placeholder, no-frontmatter label fallback, dedup/self-link skip, Louvain on disconnected graph (Tasks 1–2) ✓; tests (Tasks 1, 2, 6) ✓.
- **Out of scope kept out:** cross-project shared-concept edges, freshness decay, export, `graphify`, temporal animation — none implemented.
- **Type consistency:** node id helpers (`conceptId`/`dailyId`/`ghostId`), `computeGraph` signature, and `knowledgeGraphSchema` names are used identically across Tasks 1–5.
- **Known deviation from spec wording:** the spec said "List/Graph toggle"; the Knowledge page is tab-based, so this is implemented as a 4th `./graph` tab — same intent, idiomatic to the existing UI.
