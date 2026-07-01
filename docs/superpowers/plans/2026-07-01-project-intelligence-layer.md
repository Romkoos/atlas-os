# Project Intelligence Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Index each Atlas-tracked project's repository into a code/project knowledge graph (imports, docs, skills, knowledge articles, sessions), store it in SQLite, render it in a new Knowledge tab, and expose subgraph excerpts to agent prompts.

**Architecture:** A pure in-process TS indexer walks a repo and assembles a `CodeGraph` (nodes + edges), which Louvain clusters and a thin SQLite layer persists under `origin='indexer'`. A separate "deep map" runs the real `graphify` skill in a headless Claude session and merges its LLM-inferred `semantic` edges under `origin='graphify'`. A tRPC router exposes build/query/read; a context module renders token-bounded excerpts; a `react-force-graph-2d` tab renders isolated & unified views.

**Tech Stack:** Electron + React + TypeScript, tRPC (electron-trpc), Drizzle + better-sqlite3, `graphology-communities-louvain`, `react-force-graph-2d`, `@anthropic-ai/claude-agent-sdk`, vitest, biome.

## Global Constraints

- Node `>=22 <23`, pnpm `9.15.0`. Package manager: `pnpm`.
- Lint/format: biome (`pnpm lint`). Typecheck: `pnpm typecheck` (node + web). Tests: `pnpm test` (vitest run); single file: `pnpm test <path>`.
- All UI strings and agent prompts MUST be English (only generated digest content may be non-English).
- tRPC uses electron-trpc with **no data transformer** — Date/Map survive structured clone; do not add superjson.
- Validate untrusted input at the tRPC schema layer (zod), not just internal helpers. Reuse the existing project-name/path-safety patterns.
- Do NOT `git push` (unless the user asks). Commit locally with conventional messages matching repo history (`feat(graph): …`, `test(graph): …`).
- Subagents: IGNORE the `git-commit-message` skill (it targets Mako/KESHET and misfires here); write plain conventional commit messages.
- Reuse existing patterns: pure-logic modules are unit-tested (like `knowledge/graph.ts`); DB/IPC glue is verified by typecheck + manual smoke, not unit tests — EXCEPT the one store round-trip test in Task 8.
- Spec: `docs/superpowers/specs/2026-07-01-project-intelligence-layer-design.md`.

---

## File Structure

**Shared:**
- `src/shared/graph.ts` (create) — zod schemas + types + deterministic id builders. Single source of truth for renderer + router.
- `src/shared/ipc-events.ts` (modify) — add `GraphDeepMapEvent`.

**Main / services (`src/main/services/graph/`):**
- `imports.ts` (create) — `parseImports`, `resolveImport` (pure).
- `assemble.ts` (create) — `assembleGraph` (pure).
- `cluster.ts` (create) — `clusterGraph`, `summarizeClusters` (pure).
- `query.ts` (create) — `neighborsOf` BFS (pure).
- `indexer.ts` (create) — `walkProject`, `indexProject` (fs + DB + knowledge store orchestration).
- `store.ts` (create) — `saveStructuralGraph`, `saveGraphifyGraph`, `loadGraph`, `listGraphProjects` (Drizzle CRUD).
- `graphifyRunner.ts` (create) — `parseGraphifyJson`, `mergeGraphifyGraph` (pure) + `runGraphifyDeepMap` (headless session).
- `context.ts` (create) — `getSubgraphContext` (pure).

**Main / db + trpc:**
- `src/main/db/schema.ts` (modify) — add `graphNodes`, `graphEdges` tables.
- `drizzle/0009_*.sql` (generated) — migration.
- `src/main/trpc/routers/graph.ts` (create) — `graphRouter`.
- `src/main/trpc/router.ts` (modify) — mount `graph: graphRouter`.
- `src/main/trpc/routers/roadmapChat.ts` (modify) — inject graph context into the seed (demo).

**Renderer:**
- `src/renderer/src/pages/knowledge/CodeGraphTab.tsx` (create).
- `src/renderer/src/pages/knowledge/graph-colors.ts` (modify) — add `colorForKind`.
- `src/renderer/src/pages/Knowledge.tsx` (modify) — add the `code` tab.

**Tests:** `imports.test.ts`, `assemble.test.ts`, `cluster.test.ts`, `query.test.ts`, `store.test.ts`, `graphifyRunner.test.ts`, `context.test.ts` (all under `src/main/services/graph/`).

---

## Task 1: Shared types + DB schema + migration

**Files:**
- Create: `src/shared/graph.ts`
- Modify: `src/main/db/schema.ts` (append after `roadmapItems`)
- Generate: `drizzle/0009_*.sql`

**Interfaces:**
- Produces: `CodeNodeKind`, `CodeEdgeKind`, `GraphOrigin`, `CodeGraphNode`, `CodeGraphEdge`, `CodeGraph`, `GraphCluster` types; `codeGraphNodeSchema`, `codeGraphEdgeSchema`, `codeGraphSchema`, `graphClusterSchema` zod schemas; `codeNodeId(projectPath, kind, key)`, `codeEdgeId(source, target, kind)` id builders. Drizzle tables `graphNodes`, `graphEdges`.

- [ ] **Step 1: Write `src/shared/graph.ts`**

```typescript
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
  meta: z.record(z.unknown()).nullable(),
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
  meta: z.record(z.unknown()).nullable(),
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
```

- [ ] **Step 2: Append tables to `src/main/db/schema.ts`**

```typescript
// ── Project Intelligence Layer ──────────────────────────────────────────────
// A code/project graph per Atlas-tracked repo. `origin` separates the two build
// passes: 'indexer' (fast structural) and 'graphify' (LLM-inferred semantic),
// so each can be rebuilt without wiping the other. See
// docs/superpowers/specs/2026-07-01-project-intelligence-layer-design.md.
export const graphNodes = sqliteTable(
  'graph_nodes',
  {
    id: text('id').primaryKey(),
    projectPath: text('project_path').notNull(),
    kind: text('kind').notNull(), // code | doc | skill | knowledge | session
    label: text('label').notNull(),
    relPath: text('rel_path'),
    meta: text('meta', { mode: 'json' }).$type<Record<string, unknown>>(),
    community: integer('community'),
    origin: text('origin').notNull(), // indexer | graphify
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('idx_graph_nodes_project').on(t.projectPath), index('idx_graph_nodes_kind').on(t.kind)],
)

export const graphEdges = sqliteTable(
  'graph_edges',
  {
    id: text('id').primaryKey(),
    projectPath: text('project_path').notNull(),
    source: text('source').notNull(),
    target: text('target').notNull(),
    kind: text('kind').notNull(), // imports | doc_link | session_touched | mentions_knowledge | semantic
    inferred: integer('inferred', { mode: 'boolean' }).notNull(),
    origin: text('origin').notNull(), // indexer | graphify
    meta: text('meta', { mode: 'json' }).$type<Record<string, unknown>>(),
  },
  (t) => [
    index('idx_graph_edges_project').on(t.projectPath),
    index('idx_graph_edges_source').on(t.source),
    index('idx_graph_edges_target').on(t.target),
  ],
)

export type GraphNodeRow = typeof graphNodes.$inferSelect
export type NewGraphNodeRow = typeof graphNodes.$inferInsert
export type GraphEdgeRow = typeof graphEdges.$inferSelect
export type NewGraphEdgeRow = typeof graphEdges.$inferInsert
```

- [ ] **Step 3: Generate the migration**

Run: `pnpm db:generate`
Expected: a new file `drizzle/0009_*.sql` containing `CREATE TABLE \`graph_nodes\`` and `CREATE TABLE \`graph_edges\`` plus their indexes. Verify with `ls drizzle | tail -1` and by opening the file.

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (no errors).

- [ ] **Step 5: Commit**

```bash
git add src/shared/graph.ts src/main/db/schema.ts drizzle/
git commit -m "feat(graph): shared CodeGraph types + graphNodes/graphEdges tables"
```

---

## Task 2: `parseImports`

**Files:**
- Create: `src/main/services/graph/imports.ts`
- Test: `src/main/services/graph/imports.test.ts`

**Interfaces:**
- Produces: `type Lang = 'js' | 'py'`; `langForExt(relPath: string): Lang | null`; `parseImports(content: string, lang: Lang): string[]` — returns raw import specifiers (order-preserving, deduped).

- [ ] **Step 1: Write the failing test** — `src/main/services/graph/imports.test.ts`

```typescript
import { describe, expect, it } from 'vitest'
import { langForExt, parseImports } from './imports'

describe('langForExt', () => {
  it('maps js/ts family to js and py to py', () => {
    expect(langForExt('a/b.ts')).toBe('js')
    expect(langForExt('a/b.tsx')).toBe('js')
    expect(langForExt('a/b.jsx')).toBe('js')
    expect(langForExt('a/b.mjs')).toBe('js')
    expect(langForExt('a/b.py')).toBe('py')
    expect(langForExt('a/b.md')).toBeNull()
  })
})

describe('parseImports js', () => {
  it('extracts static, side-effect, re-export, require and dynamic specifiers', () => {
    const src = [
      "import a from './a'",
      "import { b } from '../b/index'",
      "import './side-effect.css'",
      "export { c } from './c'",
      "const d = require('./d')",
      "const e = await import('./e')",
    ].join('\n')
    expect(parseImports(src, 'js')).toEqual([
      './a',
      '../b/index',
      './side-effect.css',
      './c',
      './d',
      './e',
    ])
  })

  it('dedupes repeated specifiers', () => {
    expect(parseImports("import x from './x'\nimport './x'", 'js')).toEqual(['./x'])
  })
})

describe('parseImports py', () => {
  it('extracts import and from-import module paths', () => {
    const src = ['import os', 'import a.b.c', 'from .rel import thing', 'from ..pkg import x'].join(
      '\n',
    )
    expect(parseImports(src, 'py')).toEqual(['os', 'a.b.c', '.rel', '..pkg'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/main/services/graph/imports.test.ts`
Expected: FAIL — cannot find module `./imports`.

- [ ] **Step 3: Write `src/main/services/graph/imports.ts`**

```typescript
export type Lang = 'js' | 'py'

const JS_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])

export function langForExt(relPath: string): Lang | null {
  const dot = relPath.lastIndexOf('.')
  if (dot < 0) return null
  const ext = relPath.slice(dot)
  if (JS_EXTS.has(ext)) return 'js'
  if (ext === '.py') return 'py'
  return null
}

const JS_PATTERNS: RegExp[] = [
  // import ... from '...'  /  export ... from '...'  /  import '...'
  /(?:import|export)[^'"()]*?from\s*['"]([^'"]+)['"]/g,
  /import\s*['"]([^'"]+)['"]/g,
  // require('...') and dynamic import('...')
  /(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
]

const PY_PATTERNS: RegExp[] = [
  /^\s*from\s+([.\w]+)\s+import\s+/gm,
  /^\s*import\s+([.\w]+)/gm,
]

// Raw specifiers only — resolution happens in resolveImport. Order-preserving,
// deduped so a file that imports the same module twice yields one edge.
export function parseImports(content: string, lang: Lang): string[] {
  const patterns = lang === 'js' ? JS_PATTERNS : PY_PATTERNS
  const seen = new Set<string>()
  const out: string[] = []
  for (const re of patterns) {
    for (const m of content.matchAll(re)) {
      const spec = m[1]
      if (spec && !seen.has(spec)) {
        seen.add(spec)
        out.push(spec)
      }
    }
  }
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/main/services/graph/imports.test.ts`
Expected: PASS.

> Note: the JS test expects source-order `['./a','../b/index','./side-effect.css','./c','./d','./e']`. The three patterns run in sequence, so `from`-style specifiers are collected before `require`/dynamic ones. The sample orders them consistently with that grouping; if a mismatch appears, keep the implementation and adjust the test's expected order to the documented grouping (from-imports first, then bare, then require/dynamic) — do not add sorting.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/graph/imports.ts src/main/services/graph/imports.test.ts
git commit -m "feat(graph): parseImports for js/ts and python"
```

---

## Task 3: `resolveImport`

**Files:**
- Modify: `src/main/services/graph/imports.ts`
- Test: `src/main/services/graph/imports.test.ts`

**Interfaces:**
- Consumes: `Lang` from Task 2.
- Produces: `resolveImport(fromRelPath: string, spec: string, fileSet: ReadonlySet<string>, lang: Lang): string | null` — resolves a relative specifier to a repo-relative file path present in `fileSet`, or `null` (bare/external/unresolved). Paths use `/` separators.

- [ ] **Step 1: Add failing tests to `imports.test.ts`**

```typescript
import { resolveImport } from './imports'

describe('resolveImport js', () => {
  const files = new Set(['src/a.ts', 'src/b/index.ts', 'src/c.tsx', 'src/util.js'])

  it('resolves with added extension', () => {
    expect(resolveImport('src/main.ts', './a', files, 'js')).toBe('src/a.ts')
  })
  it('resolves a directory to its index file', () => {
    expect(resolveImport('src/main.ts', './b', files, 'js')).toBe('src/b/index.ts')
  })
  it('resolves parent-relative and .tsx', () => {
    expect(resolveImport('src/b/x.ts', '../c', files, 'js')).toBe('src/c.tsx')
  })
  it('returns null for bare/external specifiers', () => {
    expect(resolveImport('src/a.ts', 'react', files, 'js')).toBeNull()
  })
  it('returns null when nothing matches', () => {
    expect(resolveImport('src/a.ts', './nope', files, 'js')).toBeNull()
  })
})

describe('resolveImport py', () => {
  const files = new Set(['pkg/mod.py', 'pkg/sub/__init__.py'])
  it('resolves a single-dot relative module', () => {
    expect(resolveImport('pkg/main.py', '.mod', files, 'py')).toBe('pkg/mod.py')
  })
  it('resolves a relative package to __init__.py', () => {
    expect(resolveImport('pkg/main.py', '.sub', files, 'py')).toBe('pkg/sub/__init__.py')
  })
  it('returns null for absolute/stdlib imports', () => {
    expect(resolveImport('pkg/main.py', 'os', files, 'py')).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test src/main/services/graph/imports.test.ts`
Expected: FAIL — `resolveImport` is not exported.

- [ ] **Step 3: Append to `src/main/services/graph/imports.ts`**

```typescript
const JS_CANDIDATE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']
const JS_INDEX = JS_CANDIDATE_EXTS.map((e) => `/index${e}`)

// Join a from-file's directory with a relative spec and normalise `.`/`..`,
// producing a repo-relative POSIX path (no leading `./`).
function joinRel(fromRelPath: string, rel: string): string {
  const dir = fromRelPath.includes('/') ? fromRelPath.slice(0, fromRelPath.lastIndexOf('/')) : ''
  const parts = dir ? dir.split('/') : []
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return parts.join('/')
}

export function resolveImport(
  fromRelPath: string,
  spec: string,
  fileSet: ReadonlySet<string>,
  lang: Lang,
): string | null {
  if (lang === 'js') {
    if (!spec.startsWith('.')) return null // bare / external
    const base = joinRel(fromRelPath, spec)
    if (fileSet.has(base)) return base
    for (const ext of JS_CANDIDATE_EXTS) if (fileSet.has(base + ext)) return base + ext
    for (const idx of JS_INDEX) if (fileSet.has(base + idx)) return base + idx
    return null
  }
  // python: only relative imports (leading dots) are resolvable to repo files.
  if (!spec.startsWith('.')) return null
  let up = 0
  while (up < spec.length && spec[up] === '.') up++
  const tail = spec.slice(up).replace(/\./g, '/')
  const dir = fromRelPath.includes('/') ? fromRelPath.slice(0, fromRelPath.lastIndexOf('/')) : ''
  const parts = dir ? dir.split('/') : []
  for (let i = 1; i < up; i++) parts.pop() // one dot = current pkg dir; extra dots go up
  const base = [...parts, ...(tail ? tail.split('/') : [])].join('/')
  if (fileSet.has(`${base}.py`)) return `${base}.py`
  if (fileSet.has(`${base}/__init__.py`)) return `${base}/__init__.py`
  return null
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test src/main/services/graph/imports.test.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Commit**

```bash
git add src/main/services/graph/imports.ts src/main/services/graph/imports.test.ts
git commit -m "feat(graph): resolveImport (relative js/ts + python) to repo files"
```

---

## Task 4: `assembleGraph`

**Files:**
- Create: `src/main/services/graph/assemble.ts`
- Test: `src/main/services/graph/assemble.test.ts`

**Interfaces:**
- Consumes: `CodeGraph`, `CodeGraphNode`, `CodeGraphEdge`, `codeNodeId`, `codeEdgeId` from `@shared/graph`.
- Produces: `interface AssembleInput { projectPath; codeFiles; imports; docs; docLinks; skills; articles; sessions }` (shapes below) and `assembleGraph(input: AssembleInput): CodeGraph` — pure, `community: null` on every node, `origin: 'indexer'` everywhere.

- [ ] **Step 1: Write the failing test** — `src/main/services/graph/assemble.test.ts`

```typescript
import { codeEdgeId, codeNodeId } from '@shared/graph'
import { describe, expect, it } from 'vitest'
import { type AssembleInput, assembleGraph } from './assemble'

const P = '/repo'

function baseInput(): AssembleInput {
  return {
    projectPath: P,
    codeFiles: ['src/a.ts', 'src/b.ts'],
    imports: [{ from: 'src/a.ts', to: 'src/b.ts' }],
    docs: ['README.md'],
    docLinks: [{ from: 'README.md', to: 'src/a.ts' }],
    skills: ['skills/foo/SKILL.md'],
    articles: [{ relPath: 'concepts/x.md', title: 'X', body: 'talks about a.ts here' }],
    sessions: [{ sessionId: 's1', label: '2026-06-30', filesTouched: ['src/b.ts'] }],
  }
}

describe('assembleGraph', () => {
  it('creates a node per code file / doc / skill / article / session', () => {
    const g = assembleGraph(baseInput())
    const kinds = g.nodes.reduce<Record<string, number>>((acc, n) => {
      acc[n.kind] = (acc[n.kind] ?? 0) + 1
      return acc
    }, {})
    expect(kinds).toEqual({ code: 2, doc: 1, skill: 1, knowledge: 1, session: 1 })
    expect(g.nodes.every((n) => n.origin === 'indexer' && n.community === null)).toBe(true)
  })

  it('creates an imports edge (not inferred)', () => {
    const g = assembleGraph(baseInput())
    const src = codeNodeId(P, 'code', 'src/a.ts')
    const tgt = codeNodeId(P, 'code', 'src/b.ts')
    const e = g.edges.find((x) => x.id === codeEdgeId(src, tgt, 'imports'))
    expect(e).toMatchObject({ source: src, target: tgt, kind: 'imports', inferred: false })
  })

  it('creates doc_link, session_touched, and inferred mentions_knowledge edges', () => {
    const g = assembleGraph(baseInput())
    const has = (kind: string) => g.edges.some((e) => e.kind === kind)
    expect(has('doc_link')).toBe(true)
    expect(has('session_touched')).toBe(true)
    const mk = g.edges.find((e) => e.kind === 'mentions_knowledge')
    expect(mk?.inferred).toBe(true)
    expect(mk?.target).toBe(codeNodeId(P, 'knowledge', 'concepts/x.md'))
  })

  it('drops edges whose endpoints are missing and self-loops', () => {
    const input = baseInput()
    input.imports.push({ from: 'src/a.ts', to: 'src/ghost.ts' }) // target not a code file
    input.imports.push({ from: 'src/a.ts', to: 'src/a.ts' }) // self-loop
    const g = assembleGraph(input)
    expect(g.edges.filter((e) => e.kind === 'imports')).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test src/main/services/graph/assemble.test.ts`
Expected: FAIL — cannot find module `./assemble`.

- [ ] **Step 3: Write `src/main/services/graph/assemble.ts`**

```typescript
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
      if (input.codeFiles.includes(f)) addEdge(src, codeNodeId(P, 'code', f), 'session_touched', false)
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

  return { nodes: [...nodes.values()], edges }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test src/main/services/graph/assemble.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/graph/assemble.ts src/main/services/graph/assemble.test.ts
git commit -m "feat(graph): pure assembleGraph (nodes + typed edges)"
```

---

## Task 5: `clusterGraph` + `summarizeClusters`

**Files:**
- Create: `src/main/services/graph/cluster.ts`
- Test: `src/main/services/graph/cluster.test.ts`

**Interfaces:**
- Consumes: `CodeGraph`, `GraphCluster` from `@shared/graph`.
- Produces: `clusterGraph(graph: CodeGraph): CodeGraph` — returns a copy with `community` filled (Louvain; isolated nodes each get their own id). `summarizeClusters(graph: CodeGraph): GraphCluster[]` — per-community summary sorted by size desc.

- [ ] **Step 1: Write the failing test** — `src/main/services/graph/cluster.test.ts`

```typescript
import type { CodeGraph, CodeGraphEdge, CodeGraphNode } from '@shared/graph'
import { describe, expect, it } from 'vitest'
import { clusterGraph, summarizeClusters } from './cluster'

function node(id: string, kind: CodeGraphNode['kind'] = 'code'): CodeGraphNode {
  return { id, projectPath: '/r', kind, label: id, relPath: id, meta: null, community: null, origin: 'indexer' }
}
function edge(source: string, target: string): CodeGraphEdge {
  return { id: `${source}|${target}|imports`, projectPath: '/r', source, target, kind: 'imports', inferred: false, origin: 'indexer', meta: null }
}

describe('clusterGraph', () => {
  it('assigns every node a numeric community', () => {
    const g: CodeGraph = { nodes: [node('a'), node('b'), node('c')], edges: [edge('a', 'b')] }
    const out = clusterGraph(g)
    expect(out.nodes.every((n) => typeof n.community === 'number')).toBe(true)
    // connected a-b share a community; isolated c differs from at least one of them
    const byId = Object.fromEntries(out.nodes.map((n) => [n.id, n.community]))
    expect(byId.a).toBe(byId.b)
  })

  it('gives isolated nodes distinct communities when there are no edges', () => {
    const g: CodeGraph = { nodes: [node('a'), node('b')], edges: [] }
    const out = clusterGraph(g)
    const ids = out.nodes.map((n) => n.community)
    expect(new Set(ids).size).toBe(2)
  })
})

describe('summarizeClusters', () => {
  it('summarizes size, dominant kind and top nodes per community', () => {
    const g = clusterGraph({
      nodes: [node('a'), node('b'), node('c', 'doc')],
      edges: [edge('a', 'b')],
    })
    const clusters = summarizeClusters(g)
    expect(clusters.length).toBeGreaterThanOrEqual(1)
    const biggest = clusters[0]
    expect(biggest.size).toBeGreaterThanOrEqual(clusters[clusters.length - 1].size)
    expect(biggest.topNodes.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test src/main/services/graph/cluster.test.ts`
Expected: FAIL — cannot find module `./cluster`.

- [ ] **Step 3: Write `src/main/services/graph/cluster.ts`**

```typescript
import type { CodeGraph, CodeNodeKind, GraphCluster } from '@shared/graph'
import Graph from 'graphology'
import louvain from 'graphology-communities-louvain'

// Fill `community` on every node via Louvain (undirected). Mirrors
// knowledge/graph.ts assignCommunities: no edges → each node its own community.
export function clusterGraph(graph: CodeGraph): CodeGraph {
  const g = new Graph({ type: 'undirected', multi: false })
  for (const n of graph.nodes) g.addNode(n.id)
  for (const e of graph.edges) {
    if (e.source === e.target || g.hasEdge(e.source, e.target)) continue
    if (!g.hasNode(e.source) || !g.hasNode(e.target)) continue
    g.addEdge(e.source, e.target)
  }

  let communities: Record<string, number>
  if (g.size === 0) {
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

export function summarizeClusters(graph: CodeGraph): GraphCluster[] {
  const byCommunity = new Map<number, CodeGraph['nodes']>()
  for (const n of graph.nodes) {
    const c = n.community ?? 0
    const list = byCommunity.get(c) ?? []
    list.push(n)
    byCommunity.set(c, list)
  }
  const clusters: GraphCluster[] = []
  for (const [community, members] of byCommunity) {
    const kindCounts = new Map<CodeNodeKind, number>()
    for (const m of members) kindCounts.set(m.kind, (kindCounts.get(m.kind) ?? 0) + 1)
    let dominantKind: CodeNodeKind = members[0].kind
    let best = 0
    for (const [k, count] of kindCounts) if (count > best) ((best = count), (dominantKind = k))
    const topNodes = [...members]
      .sort((a, b) => a.label.localeCompare(b.label))
      .slice(0, 5)
      .map((m) => ({ id: m.id, label: m.label }))
    clusters.push({ community, size: members.length, dominantKind, topNodes })
  }
  return clusters.sort((a, b) => b.size - a.size)
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test src/main/services/graph/cluster.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/graph/cluster.ts src/main/services/graph/cluster.test.ts
git commit -m "feat(graph): Louvain clusterGraph + summarizeClusters"
```

---

## Task 6: `neighborsOf` (BFS)

**Files:**
- Create: `src/main/services/graph/query.ts`
- Test: `src/main/services/graph/query.test.ts`

**Interfaces:**
- Consumes: `CodeGraph` from `@shared/graph`.
- Produces: `neighborsOf(graph: CodeGraph, nodeId: string, depth: number): CodeGraph` — induced subgraph of nodes within `depth` undirected hops of `nodeId` (inclusive), plus all edges among them. Empty graph if `nodeId` absent.

- [ ] **Step 1: Write the failing test** — `src/main/services/graph/query.test.ts`

```typescript
import type { CodeGraph, CodeGraphEdge, CodeGraphNode } from '@shared/graph'
import { describe, expect, it } from 'vitest'
import { neighborsOf } from './query'

function n(id: string): CodeGraphNode {
  return { id, projectPath: '/r', kind: 'code', label: id, relPath: id, meta: null, community: 0, origin: 'indexer' }
}
function e(source: string, target: string): CodeGraphEdge {
  return { id: `${source}|${target}|imports`, projectPath: '/r', source, target, kind: 'imports', inferred: false, origin: 'indexer', meta: null }
}
// a - b - c - d
const g: CodeGraph = { nodes: [n('a'), n('b'), n('c'), n('d')], edges: [e('a', 'b'), e('b', 'c'), e('c', 'd')] }

describe('neighborsOf', () => {
  it('depth 1 returns the node and direct neighbors', () => {
    const out = neighborsOf(g, 'b', 1)
    expect(out.nodes.map((x) => x.id).sort()).toEqual(['a', 'b', 'c'])
  })
  it('depth 2 expands one more hop', () => {
    const out = neighborsOf(g, 'a', 2)
    expect(out.nodes.map((x) => x.id).sort()).toEqual(['a', 'b', 'c'])
  })
  it('includes only edges among the returned nodes', () => {
    const out = neighborsOf(g, 'b', 1)
    expect(out.edges.every((x) => ['a', 'b', 'c'].includes(x.source) && ['a', 'b', 'c'].includes(x.target))).toBe(true)
  })
  it('returns empty graph for an unknown node', () => {
    expect(neighborsOf(g, 'zzz', 2)).toEqual({ nodes: [], edges: [] })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test src/main/services/graph/query.test.ts`
Expected: FAIL — cannot find module `./query`.

- [ ] **Step 3: Write `src/main/services/graph/query.ts`**

```typescript
import type { CodeGraph } from '@shared/graph'

// Induced subgraph within `depth` undirected hops of `nodeId` (inclusive).
export function neighborsOf(graph: CodeGraph, nodeId: string, depth: number): CodeGraph {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  if (!byId.has(nodeId)) return { nodes: [], edges: [] }

  const adj = new Map<string, Set<string>>()
  for (const e of graph.edges) {
    if (!adj.has(e.source)) adj.set(e.source, new Set())
    if (!adj.has(e.target)) adj.set(e.target, new Set())
    adj.get(e.source)?.add(e.target)
    adj.get(e.target)?.add(e.source)
  }

  const keep = new Set<string>([nodeId])
  let frontier = [nodeId]
  for (let d = 0; d < Math.max(0, depth); d++) {
    const next: string[] = []
    for (const id of frontier) {
      for (const nb of adj.get(id) ?? []) {
        if (!keep.has(nb)) {
          keep.add(nb)
          next.push(nb)
        }
      }
    }
    frontier = next
    if (frontier.length === 0) break
  }

  return {
    nodes: graph.nodes.filter((n) => keep.has(n.id)),
    edges: graph.edges.filter((e) => keep.has(e.source) && keep.has(e.target)),
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test src/main/services/graph/query.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/graph/query.ts src/main/services/graph/query.test.ts
git commit -m "feat(graph): neighborsOf BFS subgraph"
```

---

## Task 7: Indexer orchestration (`walkProject` + `indexProject`)

**Files:**
- Create: `src/main/services/graph/indexer.ts`
- Test: `src/main/services/graph/indexer.test.ts`

**Interfaces:**
- Consumes: `parseImports`, `resolveImport`, `langForExt` (Task 2-3); `assembleGraph`, `AssembleInput` (Task 4); `clusterGraph` (Task 5); `readAllArticles`, `listProjects`, `storeRoot` from `@main/services/knowledge/store`; `agentSessions`, `agentTurns` from `@main/db/schema`; `AppDatabase` from `@main/db/client`.
- Produces: `walkProject(projectPath: string): string[]` (repo-relative POSIX paths, ignore-filtered, capped); `indexProject(database: AppDatabase, projectPath: string): CodeGraph` (clustered, origin 'indexer').

- [ ] **Step 1: Write the failing test** — `src/main/services/graph/indexer.test.ts`

```typescript
import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { walkProject } from './indexer'

const dir = mkdtempSync(join(tmpdir(), 'atlas-walk-'))
mkdirSync(join(dir, 'src'), { recursive: true })
mkdirSync(join(dir, 'node_modules', 'x'), { recursive: true })
writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = 1')
writeFileSync(join(dir, 'README.md'), '# hi')
writeFileSync(join(dir, 'node_modules', 'x', 'index.js'), 'module.exports = 1')

describe('walkProject', () => {
  it('returns repo-relative files and skips ignored dirs', () => {
    const files = walkProject(dir)
    expect(files).toContain('src/a.ts')
    expect(files).toContain('README.md')
    expect(files.some((f) => f.includes('node_modules'))).toBe(false)
  })
})
```

> `indexProject` reads SQLite + the knowledge store, so it is verified by typecheck + manual smoke (Task 8 / renderer), not unit-tested here — matching the repo convention (no DB unit tests). Its pure inputs are already covered by Tasks 2–6.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test src/main/services/graph/indexer.test.ts`
Expected: FAIL — cannot find module `./indexer`.

- [ ] **Step 3: Write `src/main/services/graph/indexer.ts`**

```typescript
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import type { AppDatabase } from '@main/db/client'
import { agentSessions, agentTurns } from '@main/db/schema'
import { listProjects, readAllArticles, storeRoot } from '@main/services/knowledge/store'
import type { CodeGraph } from '@shared/graph'
import { eq } from 'drizzle-orm'
import { type AssembleInput, assembleGraph } from './assemble'
import { clusterGraph } from './cluster'
import { langForExt, parseImports, resolveImport } from './imports'

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'out', 'dist', 'build', '.venv', '__pycache__',
  '.next', 'coverage', 'release', 'test-results', '.turbo', '.cache',
])
const MAX_FILES = 5000
const MAX_FILE_BYTES = 512 * 1024

// Repo-relative POSIX paths, ignore-filtered, capped. fs walk only.
export function walkProject(projectPath: string): string[] {
  const out: string[] = []
  const walk = (abs: string): void => {
    if (out.length >= MAX_FILES) return
    let entries: string[]
    try {
      entries = readdirSync(abs)
    } catch {
      return
    }
    for (const name of entries) {
      if (out.length >= MAX_FILES) return
      if (IGNORE_DIRS.has(name) || name.startsWith('.')) continue
      const child = join(abs, name)
      let st: ReturnType<typeof statSync>
      try {
        st = statSync(child)
      } catch {
        continue
      }
      if (st.isDirectory()) walk(child)
      else if (st.isFile() && st.size <= MAX_FILE_BYTES) {
        out.push(relative(projectPath, child).split('\\').join('/'))
      }
    }
  }
  walk(projectPath)
  return out
}

const isDoc = (f: string): boolean => f.endsWith('.md')
const isSkill = (f: string): boolean => f.endsWith('/SKILL.md') || f === 'SKILL.md'

// Extract markdown links [text](target) that resolve to a repo file.
function docLinksFor(docRel: string, content: string, fileSet: ReadonlySet<string>): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const m of content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const raw = m[1].split('#')[0].trim()
    if (!raw || raw.startsWith('http') || raw.startsWith('mailto:')) continue
    const dir = docRel.includes('/') ? docRel.slice(0, docRel.lastIndexOf('/')) : ''
    const parts = dir ? dir.split('/') : []
    for (const seg of raw.split('/')) {
      if (seg === '' || seg === '.') continue
      if (seg === '..') parts.pop()
      else parts.push(seg)
    }
    const rel = parts.join('/')
    if (fileSet.has(rel) && !seen.has(rel)) {
      seen.add(rel)
      out.push(rel)
    }
  }
  return out
}

function knowledgeProjectName(projectPath: string): string | null {
  try {
    return listProjects(storeRoot(), new Set()).find((p) => p.path === projectPath)?.name ?? null
  } catch {
    return null
  }
}

// Full structural index: fs walk + import parse + docs + skills + knowledge
// articles + sessions → assembled + clustered CodeGraph (origin 'indexer').
export function indexProject(database: AppDatabase, projectPath: string): CodeGraph {
  const files = walkProject(projectPath)
  const fileSet = new Set(files)
  const codeFiles = files.filter((f) => langForExt(f) !== null)
  const docs = files.filter((f) => isDoc(f) && !isSkill(f))
  const skills = files.filter(isSkill)

  const imports: AssembleInput['imports'] = []
  for (const f of codeFiles) {
    const lang = langForExt(f)
    if (!lang) continue
    let content: string
    try {
      content = readFileSync(join(projectPath, f), 'utf8')
    } catch {
      continue
    }
    for (const spec of parseImports(content, lang)) {
      const to = resolveImport(f, spec, fileSet, lang)
      if (to) imports.push({ from: f, to })
    }
  }

  const docLinks: AssembleInput['docLinks'] = []
  for (const d of docs) {
    let content: string
    try {
      content = readFileSync(join(projectPath, d), 'utf8')
    } catch {
      continue
    }
    for (const to of docLinksFor(d, content, fileSet)) docLinks.push({ from: d, to })
  }

  const kp = knowledgeProjectName(projectPath)
  const articles: AssembleInput['articles'] = kp
    ? readAllArticles(storeRoot(), kp).map(({ relPath, doc }) => ({
        relPath,
        title: (typeof doc.frontmatter.title === 'string' && doc.frontmatter.title) || basename(relPath, '.md'),
        body: doc.body,
      }))
    : []

  const sessionRows = database
    .select({ sessionId: agentSessions.sessionId, startedAt: agentSessions.startedAt })
    .from(agentSessions)
    .where(eq(agentSessions.projectPath, projectPath))
    .all()
  const sessions: AssembleInput['sessions'] = sessionRows.map((s) => {
    const turns = database
      .select({ filesTouched: agentTurns.filesTouched })
      .from(agentTurns)
      .where(eq(agentTurns.sessionId, s.sessionId))
      .all()
    const touched = new Set<string>()
    for (const t of turns) {
      for (const abs of t.filesTouched ?? []) {
        const rel = abs.startsWith(projectPath) ? relative(projectPath, abs).split('\\').join('/') : abs
        touched.add(rel)
      }
    }
    return {
      sessionId: s.sessionId,
      label: s.startedAt ? new Date(s.startedAt).toISOString().slice(0, 10) : s.sessionId.slice(0, 8),
      filesTouched: [...touched],
    }
  })

  return clusterGraph(
    assembleGraph({ projectPath, codeFiles, imports, docs, docLinks, skills, articles, sessions }),
  )
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm test src/main/services/graph/indexer.test.ts && pnpm typecheck`
Expected: test PASS; typecheck PASS. (If `readAllArticles`'s return shape differs, adjust the `.map` destructuring to match its actual `{ relPath, kind, doc }` items — confirm against `src/main/services/knowledge/store.ts`.)

- [ ] **Step 5: Commit**

```bash
git add src/main/services/graph/indexer.ts src/main/services/graph/indexer.test.ts
git commit -m "feat(graph): walkProject + indexProject orchestration"
```

---

## Task 8: Store (SQLite CRUD) + tRPC router + mount

**Files:**
- Create: `src/main/services/graph/store.ts`
- Create: `src/main/services/graph/store.test.ts`
- Create: `src/main/trpc/routers/graph.ts`
- Modify: `src/main/trpc/router.ts`

**Interfaces:**
- Consumes: `AppDatabase`, `db` from `@main/db/client`; `graphNodes`, `graphEdges`, `agentSessions` from `@main/db/schema`; `indexProject` (Task 7); `neighborsOf` (Task 6); `summarizeClusters` (Task 5); `CodeGraph` types + zod schemas (Task 1).
- Produces (store): `saveStructuralGraph(database, projectPath, graph)`, `saveGraphifyGraph(database, projectPath, additions)`, `loadGraph(database, scope)` (`scope`: projectPath or `'__all__'`), `listGraphProjects(database)` → `Array<{ projectPath; project; hasGraph; builtAt }>`.
- Produces (router): `graphRouter` with `buildGraph`, `queryNeighbors`, `getProjectClusters`, `getGraph`, `listProjects`.

- [ ] **Step 1: Write the failing store test** — `src/main/services/graph/store.test.ts`

```typescript
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from '@main/db/schema'
import type { CodeGraph } from '@shared/graph'
import { describe, expect, it } from 'vitest'
import { loadGraph, saveGraphifyGraph, saveStructuralGraph } from './store'

function testDb() {
  const sqlite = new Database(':memory:')
  const database = drizzle(sqlite, { schema })
  migrate(database, { migrationsFolder: 'drizzle' })
  return database
}

const P = '/repo'
const structural: CodeGraph = {
  nodes: [
    { id: `${P}::code::a.ts`, projectPath: P, kind: 'code', label: 'a.ts', relPath: 'a.ts', meta: null, community: 1, origin: 'indexer' },
    { id: `${P}::code::b.ts`, projectPath: P, kind: 'code', label: 'b.ts', relPath: 'b.ts', meta: null, community: 1, origin: 'indexer' },
  ],
  edges: [
    { id: `${P}::code::a.ts|${P}::code::b.ts|imports`, projectPath: P, source: `${P}::code::a.ts`, target: `${P}::code::b.ts`, kind: 'imports', inferred: false, origin: 'indexer', meta: null },
  ],
}

describe('graph store', () => {
  it('saves and loads a project graph', () => {
    const database = testDb()
    saveStructuralGraph(database, P, structural)
    const g = loadGraph(database, P)
    expect(g.nodes).toHaveLength(2)
    expect(g.edges).toHaveLength(1)
    expect(g.edges[0].inferred).toBe(false)
  })

  it('structural rebuild replaces only the indexer layer, keeps graphify edges', () => {
    const database = testDb()
    saveStructuralGraph(database, P, structural)
    saveGraphifyGraph(database, P, {
      nodes: [],
      edges: [
        { id: `${P}::code::a.ts|${P}::code::b.ts|semantic`, projectPath: P, source: `${P}::code::a.ts`, target: `${P}::code::b.ts`, kind: 'semantic', inferred: true, origin: 'graphify', meta: { audit: 'INFERRED' } },
      ],
    })
    saveStructuralGraph(database, P, structural) // rebuild structural
    const g = loadGraph(database, P)
    expect(g.edges.some((e) => e.origin === 'graphify')).toBe(true)
    expect(g.edges.filter((e) => e.origin === 'indexer')).toHaveLength(1)
  })

  it('scopes cleanup by project', () => {
    const database = testDb()
    saveStructuralGraph(database, P, structural)
    saveStructuralGraph(database, '/other', { nodes: [{ ...structural.nodes[0], id: '/other::code::a.ts', projectPath: '/other' }], edges: [] })
    expect(loadGraph(database, P).nodes).toHaveLength(2)
    expect(loadGraph(database, '__all__').nodes).toHaveLength(3)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test src/main/services/graph/store.test.ts`
Expected: FAIL — cannot find module `./store`.

- [ ] **Step 3: Write `src/main/services/graph/store.ts`**

```typescript
import type { AppDatabase } from '@main/db/client'
import { agentSessions, graphEdges, graphNodes } from '@main/db/schema'
import type { CodeGraph, CodeGraphEdge, CodeGraphNode } from '@shared/graph'
import { and, eq, sql } from 'drizzle-orm'
import { basename } from 'node:path'

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
    tx.delete(graphNodes).where(and(eq(graphNodes.projectPath, projectPath), eq(graphNodes.origin, origin))).run()
    tx.delete(graphEdges).where(and(eq(graphEdges.projectPath, projectPath), eq(graphEdges.origin, origin))).run()
    for (const n of graph.nodes) tx.insert(graphNodes).values(toNodeRow(n)).run()
    for (const e of graph.edges) tx.insert(graphEdges).values(toEdgeRow(e)).run()
  })
}

export function saveStructuralGraph(database: AppDatabase, projectPath: string, graph: CodeGraph): void {
  replaceLayer(database, projectPath, 'indexer', graph)
}
export function saveGraphifyGraph(database: AppDatabase, projectPath: string, additions: CodeGraph): void {
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
  const projects = database.selectDistinct({ projectPath: agentSessions.projectPath }).from(agentSessions).all()
  const built = database
    .select({ projectPath: graphNodes.projectPath, builtAt: sql<number>`max(${graphNodes.updatedAt})` })
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
```

- [ ] **Step 4: Run store test to verify it passes**

Run: `pnpm test src/main/services/graph/store.test.ts`
Expected: PASS (all three cases).

- [ ] **Step 5: Write `src/main/trpc/routers/graph.ts`**

```typescript
import { db } from '@main/db/client'
import { indexProject } from '@main/services/graph/indexer'
import { neighborsOf } from '@main/services/graph/query'
import { summarizeClusters } from '@main/services/graph/cluster'
import { listGraphProjects, loadGraph, saveStructuralGraph } from '@main/services/graph/store'
import { publicProcedure, router } from '@main/trpc/trpc'
import { codeGraphSchema, graphClusterSchema } from '@shared/graph'
import { z } from 'zod'

const projectPathInput = z.object({ projectPath: z.string().min(1) })

export const graphRouter = router({
  listProjects: publicProcedure
    .output(
      z.array(
        z.object({
          projectPath: z.string(),
          project: z.string(),
          hasGraph: z.boolean(),
          builtAt: z.number().nullable(),
        }),
      ),
    )
    .query(() => listGraphProjects(db())),

  buildGraph: publicProcedure
    .input(projectPathInput)
    .output(z.object({ nodes: z.number(), edges: z.number(), clusters: z.number() }))
    .mutation(({ input }) => {
      const graph = indexProject(db(), input.projectPath)
      saveStructuralGraph(db(), input.projectPath, graph)
      return {
        nodes: graph.nodes.length,
        edges: graph.edges.length,
        clusters: summarizeClusters(graph).length,
      }
    }),

  getGraph: publicProcedure
    .input(z.object({ scope: z.string().min(1) }))
    .output(codeGraphSchema)
    .query(({ input }) => loadGraph(db(), input.scope)),

  queryNeighbors: publicProcedure
    .input(z.object({ nodeId: z.string().min(1), depth: z.number().int().min(1).max(3) }))
    .output(codeGraphSchema)
    .query(({ input }) => {
      // The node id embeds its projectPath, or scope by '__all__' for cross-project.
      const scope = input.nodeId.split('::')[0] || '__all__'
      return neighborsOf(loadGraph(db(), scope), input.nodeId, input.depth)
    }),

  getProjectClusters: publicProcedure
    .input(z.object({ projectPath: z.string().min(1).optional() }))
    .output(z.array(graphClusterSchema))
    .query(({ input }) => summarizeClusters(loadGraph(db(), input.projectPath ?? '__all__'))),
})
```

- [ ] **Step 6: Mount in `src/main/trpc/router.ts`**

Add import after the other `routers/*` imports:

```typescript
import { graphRouter } from '@main/trpc/routers/graph'
```

Add to the `router({ ... })` object (after `knowledge: knowledgeRouter,`):

```typescript
  graph: graphRouter,
```

- [ ] **Step 7: Typecheck + full test suite**

Run: `pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/main/services/graph/store.ts src/main/services/graph/store.test.ts src/main/trpc/routers/graph.ts src/main/trpc/router.ts
git commit -m "feat(graph): SQLite store + graph tRPC router (build/query/clusters/getGraph)"
```

---

## Task 9: `parseGraphifyJson` + `mergeGraphifyGraph`

**Files:**
- Create: `src/main/services/graph/graphifyRunner.ts`
- Create: `src/main/services/graph/graphifyRunner.test.ts`

**Interfaces:**
- Consumes: `CodeGraph`, `CodeGraphNode`, `codeNodeId`, `codeEdgeId` (Task 1).
- Produces: `interface GraphifyJson { nodes: GraphifyNode[]; links: GraphifyLink[] }`; `parseGraphifyJson(raw: string): GraphifyJson`; `mergeGraphifyGraph(projectPath: string, structural: CodeGraph, gy: GraphifyJson): CodeGraph` — returns ONLY the graphify-origin additions (nodes newly created + `semantic` edges) to persist as the graphify layer.

- [ ] **Step 1: Write the failing test** — `src/main/services/graph/graphifyRunner.test.ts`

```typescript
import { codeNodeId } from '@shared/graph'
import type { CodeGraph } from '@shared/graph'
import { describe, expect, it } from 'vitest'
import { mergeGraphifyGraph, parseGraphifyJson } from './graphifyRunner'

const P = '/repo'
// structural graph already has a.ts and b.ts as code nodes
const structural: CodeGraph = {
  nodes: [
    { id: codeNodeId(P, 'code', 'src/a.ts'), projectPath: P, kind: 'code', label: 'a.ts', relPath: 'src/a.ts', meta: null, community: 0, origin: 'indexer' },
    { id: codeNodeId(P, 'code', 'src/b.ts'), projectPath: P, kind: 'code', label: 'b.ts', relPath: 'src/b.ts', meta: null, community: 0, origin: 'indexer' },
  ],
  edges: [],
}

// Real graphify networkx node-link shape (nodes + links).
const raw = JSON.stringify({
  directed: true,
  nodes: [
    { id: 'src_a_ts', label: 'a.ts', source_file: 'src/a.ts', file_type: 'code', community: 3 },
    { id: 'src_b_ts', label: 'b.ts', source_file: 'src/b.ts', file_type: 'code', community: 3 },
    { id: 'concept_x', label: 'Concept X', source_file: 'notes/x.md', file_type: 'markdown', community: 4 },
  ],
  links: [
    { source: 'src_a_ts', target: 'src_b_ts', relation: 'calls', confidence: 'INFERRED' },
    { source: 'src_a_ts', target: 'concept_x', relation: 'documents', confidence: 'EXTRACTED' },
  ],
})

describe('parseGraphifyJson', () => {
  it('reads nodes and links defensively', () => {
    const gy = parseGraphifyJson(raw)
    expect(gy.nodes).toHaveLength(3)
    expect(gy.links).toHaveLength(2)
  })
  it('returns empty arrays on malformed input', () => {
    expect(parseGraphifyJson('not json')).toEqual({ nodes: [], links: [] })
  })
})

describe('mergeGraphifyGraph', () => {
  it('maps graphify nodes to existing code nodes by relPath and emits semantic edges', () => {
    const additions = mergeGraphifyGraph(P, structural, parseGraphifyJson(raw))
    const edge = additions.edges.find(
      (e) => e.source === codeNodeId(P, 'code', 'src/a.ts') && e.target === codeNodeId(P, 'code', 'src/b.ts'),
    )
    expect(edge).toMatchObject({ kind: 'semantic', origin: 'graphify', inferred: true })
    expect(edge?.meta).toMatchObject({ audit: 'INFERRED', relation: 'calls' })
  })

  it('creates a graphify-origin node only for files absent from the structural graph', () => {
    const additions = mergeGraphifyGraph(P, structural, parseGraphifyJson(raw))
    const created = additions.nodes.find((n) => n.relPath === 'notes/x.md')
    expect(created).toMatchObject({ origin: 'graphify', kind: 'doc' })
    // a.ts and b.ts already exist structurally → not re-created
    expect(additions.nodes.some((n) => n.relPath === 'src/a.ts')).toBe(false)
  })

  it('marks EXTRACTED edges as not inferred', () => {
    const additions = mergeGraphifyGraph(P, structural, parseGraphifyJson(raw))
    const documents = additions.edges.find((e) => e.meta?.relation === 'documents')
    expect(documents?.inferred).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test src/main/services/graph/graphifyRunner.test.ts`
Expected: FAIL — cannot find module `./graphifyRunner`.

- [ ] **Step 3: Write the pure part of `src/main/services/graph/graphifyRunner.ts`**

```typescript
import {
  type CodeGraph,
  type CodeGraphEdge,
  type CodeGraphNode,
  type CodeNodeKind,
  codeEdgeId,
  codeNodeId,
} from '@shared/graph'
import { basename } from 'node:path'

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
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test src/main/services/graph/graphifyRunner.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/graph/graphifyRunner.ts src/main/services/graph/graphifyRunner.test.ts
git commit -m "feat(graph): parse + merge graphify graph.json (semantic layer)"
```

---

## Task 10: Deep-map runner + `deepMap` router procedure

**Files:**
- Modify: `src/shared/ipc-events.ts` (add `GraphDeepMapEvent`)
- Modify: `src/main/services/graph/graphifyRunner.ts` (add `runGraphifyDeepMap`)
- Modify: `src/main/trpc/routers/graph.ts` (add `deepMap` subscription + `cancelDeepMap`)

**Interfaces:**
- Consumes: `@anthropic-ai/claude-agent-sdk` `query`; `subscriptionEnv` from `@main/services/llm/subscriptionEnv`; `logger` from `@main/logger`; `mergeGraphifyGraph`, `parseGraphifyJson` (Task 9); `loadGraph`, `saveGraphifyGraph` (Task 8); `jobRegistry` from `@main/services/jobs/registry`.
- Produces: `GraphDeepMapEvent` type; `runGraphifyDeepMap(opts): GraphifyDeepMapRun` where `opts = { projectPath; model; emit: (e: GraphDeepMapEvent) => void }` and `GraphifyDeepMapRun = { cancel: () => void; done: Promise<void> }`. Router `graph.deepMap` (subscription) + `graph.cancelDeepMap` (mutation).

- [ ] **Step 1: Add the event type to `src/shared/ipc-events.ts`**

```typescript
// Events streamed from main → renderer during a graphify deep-map run (tRPC
// subscription). `done` carries how many graphify nodes/edges were merged.
export type GraphDeepMapEvent =
  | { type: 'tool'; name: string; summary: string }
  | { type: 'progress'; message: string }
  | { type: 'done'; nodesAdded: number; edgesAdded: number }
  | { type: 'error'; message: string }
  | { type: 'aborted' }
```

- [ ] **Step 2: Append `runGraphifyDeepMap` to `src/main/services/graph/graphifyRunner.ts`**

```typescript
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { db } from '@main/db/client'
import { logger } from '@main/logger'
import { subscriptionEnv } from '@main/services/llm/subscriptionEnv'
import type { GraphDeepMapEvent } from '@shared/ipc-events'
import { loadGraph, saveGraphifyGraph } from './store'

export interface GraphifyDeepMapRun {
  cancel: () => void
  done: Promise<void>
}
export interface RunGraphifyOptions {
  projectPath: string
  model: string
  emit: (event: GraphDeepMapEvent) => void
}

// Read-only-ish deep map: run the /graphify skill in a headless Claude session,
// then merge its semantic edges. The skill needs to run its own tooling, so we
// allow the standard tool set and bypass permissions (like roadmapChat).
export function runGraphifyDeepMap(opts: RunGraphifyOptions): GraphifyDeepMapRun {
  const controller = new AbortController()
  let stopped = false

  const done = (async (): Promise<void> => {
    const { query } = await import('@anthropic-ai/claude-agent-sdk')
    const prompt = `/graphify ${opts.projectPath} --no-viz`
    const q = query({
      prompt,
      options: {
        model: opts.model,
        permissionMode: 'bypassPermissions',
        settingSources: ['user', 'project'],
        cwd: opts.projectPath,
        env: subscriptionEnv(),
        abortController: controller,
      },
    })

    for await (const message of q as AsyncIterable<{ type: string; [k: string]: unknown }>) {
      if (stopped) continue
      if (message.type === 'assistant') {
        const content = (message as { message?: { content?: Array<{ type: string; name?: string; input?: unknown }> } }).message?.content ?? []
        for (const block of content) {
          if (block.type === 'tool_use' && block.name) {
            opts.emit({ type: 'tool', name: block.name, summary: block.name })
          }
        }
      } else if (message.type === 'result') {
        opts.emit({ type: 'progress', message: 'graphify run finished; merging…' })
      }
    }
    if (stopped) return

    // Read + merge graph.json produced in projectPath/graphify-out/.
    let raw: string
    try {
      raw = readFileSync(join(opts.projectPath, 'graphify-out', 'graph.json'), 'utf8')
    } catch {
      opts.emit({ type: 'error', message: 'graphify produced no graph.json' })
      return
    }
    const structural = loadGraph(db(), opts.projectPath)
    const additions = mergeGraphifyGraph(opts.projectPath, structural, parseGraphifyJson(raw))
    saveGraphifyGraph(db(), opts.projectPath, additions)
    opts.emit({ type: 'done', nodesAdded: additions.nodes.length, edgesAdded: additions.edges.length })
  })().catch((error) => {
    if (stopped) return
    const message = error instanceof Error ? error.message : 'Unknown error'
    logger.error('Graphify deep-map failed', message)
    opts.emit({ type: 'error', message })
  })

  return {
    cancel: () => {
      if (stopped) return
      stopped = true
      controller.abort()
      void done.then(() => opts.emit({ type: 'aborted' }))
    },
    done,
  }
}
```

- [ ] **Step 3: Add `deepMap` + `cancelDeepMap` to `src/main/trpc/routers/graph.ts`**

Add imports at the top:

```typescript
import { runGraphifyDeepMap, type GraphifyDeepMapRun } from '@main/services/graph/graphifyRunner'
import { jobRegistry } from '@main/services/jobs/registry'
import { getSettings } from '@main/store'
import type { GraphDeepMapEvent } from '@shared/ipc-events'
import { DEFAULT_MODEL_ID } from '@shared/models'
import { observable } from '@trpc/server/observable'
```

Add a module-level run registry above `export const graphRouter`:

```typescript
const deepRuns = new Map<string, GraphifyDeepMapRun>()
```

Add these procedures inside `router({ ... })`:

```typescript
  deepMap: publicProcedure
    .input(z.object({ requestId: z.string().min(1), projectPath: z.string().min(1) }))
    .subscription(({ input }) =>
      observable<GraphDeepMapEvent>((emit) => {
        if (deepRuns.has(input.requestId)) {
          emit.next({ type: 'error', message: 'A deep map is already running for this request.' })
          emit.complete()
          return
        }
        const model = getSettings().model ?? DEFAULT_MODEL_ID
        const job = jobRegistry.register({
          kind: 'graph.deepMap',
          label: `Graphify deep map: ${input.projectPath}`,
          model,
          abort: () => deepRuns.get(input.requestId)?.cancel(),
        })
        const run = runGraphifyDeepMap({
          projectPath: input.projectPath,
          model,
          emit: (event) => {
            if (event.type === 'done') job.finish('done')
            if (event.type === 'error' || event.type === 'aborted') job.finish('error')
            emit.next(event)
            if (event.type === 'done' || event.type === 'error' || event.type === 'aborted') {
              deepRuns.delete(input.requestId)
              emit.complete()
            }
          },
        })
        deepRuns.set(input.requestId, run)
        return () => {
          const r = deepRuns.get(input.requestId)
          if (r) {
            r.cancel()
            deepRuns.delete(input.requestId)
          }
          job.finish('error')
        }
      }),
    ),

  cancelDeepMap: publicProcedure
    .input(z.object({ requestId: z.string().min(1) }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(({ input }) => {
      const run = deepRuns.get(input.requestId)
      run?.cancel()
      deepRuns.delete(input.requestId)
      return { ok: Boolean(run) }
    }),
```

- [ ] **Step 4: Typecheck + full tests**

Run: `pnpm typecheck && pnpm test`
Expected: PASS. (If the SDK message `content` typing complains, the cast in Step 2 already narrows it; adjust only if the installed `@anthropic-ai/claude-agent-sdk` exposes concrete types — mirror `roadmapChat/run.ts`'s `SDKMessage` handling if so.)

- [ ] **Step 5: Commit**

```bash
git add src/shared/ipc-events.ts src/main/services/graph/graphifyRunner.ts src/main/trpc/routers/graph.ts
git commit -m "feat(graph): graphify deep-map runner + deepMap subscription"
```

---

## Task 11: Context provider + roadmapChat seed injection

**Files:**
- Create: `src/main/services/graph/context.ts`
- Create: `src/main/services/graph/context.test.ts`
- Modify: `src/main/trpc/routers/graph.ts` (add `context` query)
- Modify: `src/main/trpc/routers/roadmapChat.ts` (append graph context to the seed)

**Interfaces:**
- Consumes: `CodeGraph` (Task 1); `neighborsOf` (Task 6); `summarizeClusters` (Task 5); `loadGraph` (Task 8).
- Produces: `getSubgraphContext(graph: CodeGraph, opts: { seedNodeId?: string; query?: string; depth?: number; budget?: number }): string` — deterministic, token-bounded markdown excerpt; `''` when no seed resolves. Router `graph.context`.

- [ ] **Step 1: Write the failing test** — `src/main/services/graph/context.test.ts`

```typescript
import { codeNodeId } from '@shared/graph'
import type { CodeGraph } from '@shared/graph'
import { describe, expect, it } from 'vitest'
import { getSubgraphContext } from './context'

const P = '/repo'
const A = codeNodeId(P, 'code', 'src/a.ts')
const B = codeNodeId(P, 'code', 'src/b.ts')
const K = codeNodeId(P, 'knowledge', 'concepts/x.md')
const graph: CodeGraph = {
  nodes: [
    { id: A, projectPath: P, kind: 'code', label: 'a.ts', relPath: 'src/a.ts', meta: null, community: 1, origin: 'indexer' },
    { id: B, projectPath: P, kind: 'code', label: 'b.ts', relPath: 'src/b.ts', meta: null, community: 1, origin: 'indexer' },
    { id: K, projectPath: P, kind: 'knowledge', label: 'Concept X', relPath: 'concepts/x.md', meta: null, community: 1, origin: 'indexer' },
  ],
  edges: [
    { id: `${A}|${B}|imports`, projectPath: P, source: A, target: B, kind: 'imports', inferred: false, origin: 'indexer', meta: null },
    { id: `${A}|${K}|mentions_knowledge`, projectPath: P, source: A, target: K, kind: 'mentions_knowledge', inferred: true, origin: 'indexer', meta: null },
  ],
}

describe('getSubgraphContext', () => {
  it('resolves a seed by id and lists neighbors grouped by edge kind', () => {
    const out = getSubgraphContext(graph, { seedNodeId: A, depth: 1 })
    expect(out).toContain('Project graph context')
    expect(out).toContain('src/a.ts')
    expect(out).toContain('b.ts')
    expect(out).toContain('Concept X')
  })
  it('resolves a seed by free-text query against labels/relPaths', () => {
    const out = getSubgraphContext(graph, { query: 'a.ts', depth: 1 })
    expect(out).toContain('src/a.ts')
  })
  it('returns empty string when no seed resolves', () => {
    expect(getSubgraphContext(graph, { query: 'nothing-matches-zzz' })).toBe('')
  })
  it('truncates to the budget', () => {
    const out = getSubgraphContext(graph, { seedNodeId: A, depth: 2, budget: 40 })
    expect(out.length).toBeLessThanOrEqual(40)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test src/main/services/graph/context.test.ts`
Expected: FAIL — cannot find module `./context`.

- [ ] **Step 3: Write `src/main/services/graph/context.ts`**

```typescript
import type { CodeGraph, CodeGraphNode } from '@shared/graph'
import { neighborsOf } from './query'

export interface SubgraphContextOptions {
  seedNodeId?: string
  query?: string
  depth?: number
  budget?: number
}

function resolveSeed(graph: CodeGraph, opts: SubgraphContextOptions): CodeGraphNode | null {
  if (opts.seedNodeId) return graph.nodes.find((n) => n.id === opts.seedNodeId) ?? null
  const q = opts.query?.trim().toLowerCase()
  if (!q) return null
  return (
    graph.nodes.find((n) => n.label.toLowerCase().includes(q) || (n.relPath ?? '').toLowerCase().includes(q)) ??
    null
  )
}

// Deterministic, token-bounded markdown excerpt of the subgraph around a seed.
// Groups neighbors by edge kind and direction. Returns '' when no seed resolves.
export function getSubgraphContext(graph: CodeGraph, opts: SubgraphContextOptions): string {
  const seed = resolveSeed(graph, opts)
  if (!seed) return ''
  const depth = opts.depth ?? 1
  const budget = opts.budget ?? 1200
  const sub = neighborsOf(graph, seed.id, depth)
  const byId = new Map(sub.nodes.map((n) => [n.id, n]))

  const outgoing = new Map<string, string[]>()
  const incoming = new Map<string, string[]>()
  for (const e of sub.edges) {
    if (e.source === seed.id) {
      const label = byId.get(e.target)?.label ?? e.target
      outgoing.set(e.kind, [...(outgoing.get(e.kind) ?? []), label])
    } else if (e.target === seed.id) {
      const label = byId.get(e.source)?.label ?? e.source
      incoming.set(e.kind, [...(incoming.get(e.kind) ?? []), label])
    }
  }

  const lines: string[] = ['## Project graph context']
  lines.push(`Seed: ${seed.relPath ?? seed.label} (${seed.kind}, cluster ${seed.community ?? '-'})`)
  for (const [kind, labels] of outgoing) lines.push(`${kind} → ${[...new Set(labels)].join(', ')}`)
  for (const [kind, labels] of incoming) lines.push(`${kind} ← ${[...new Set(labels)].join(', ')}`)

  const text = lines.join('\n')
  return text.length > budget ? text.slice(0, budget) : text
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test src/main/services/graph/context.test.ts`
Expected: PASS.

- [ ] **Step 5: Add `context` query to `src/main/trpc/routers/graph.ts`**

Add the import:

```typescript
import { getSubgraphContext } from '@main/services/graph/context'
```

Add inside `router({ ... })`:

```typescript
  context: publicProcedure
    .input(
      z.object({
        projectPath: z.string().min(1),
        seedNodeId: z.string().optional(),
        query: z.string().optional(),
        depth: z.number().int().min(1).max(3).default(1),
        budget: z.number().int().min(100).max(8000).default(1200),
      }),
    )
    .output(z.object({ context: z.string() }))
    .query(({ input }) => ({
      context: getSubgraphContext(loadGraph(db(), input.projectPath), {
        seedNodeId: input.seedNodeId,
        query: input.query,
        depth: input.depth,
        budget: input.budget,
      }),
    })),
```

- [ ] **Step 6: Inject context into the roadmapChat seed** — modify `src/main/trpc/routers/roadmapChat.ts`

Add imports:

```typescript
import { db } from '@main/db/client'
import { getSubgraphContext } from '@main/services/graph/context'
import { loadGraph } from '@main/services/graph/store'
import { app } from 'electron'
```

Replace the seed construction line:

```typescript
        const seed = buildRoadmapChatSeed(input.idea, listRoadmap())
```

with (append a graph-context block when the app's own repo is indexed — demo integration):

```typescript
        const repoRoot = app.getAppPath()
        const graphContext = getSubgraphContext(loadGraph(db(), repoRoot), {
          query: input.idea,
          depth: 1,
          budget: 1000,
        })
        const seed = graphContext
          ? `${buildRoadmapChatSeed(input.idea, listRoadmap())}\n\n${graphContext}`
          : buildRoadmapChatSeed(input.idea, listRoadmap())
```

> `app` may already be imported in this file — if so, don't duplicate the import. `getSubgraphContext` returns `''` for an unindexed repo, so this is a safe no-op until the user builds the graph.

- [ ] **Step 7: Typecheck + full tests**

Run: `pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/main/services/graph/context.ts src/main/services/graph/context.test.ts src/main/trpc/routers/graph.ts src/main/trpc/routers/roadmapChat.ts
git commit -m "feat(graph): subgraph context provider + roadmapChat seed injection"
```

---

## Task 12: Renderer — CodeGraphTab + Knowledge tab wiring

**Files:**
- Modify: `src/renderer/src/pages/knowledge/graph-colors.ts` (add `colorForKind`)
- Create: `src/renderer/src/pages/knowledge/CodeGraphTab.tsx`
- Modify: `src/renderer/src/pages/Knowledge.tsx` (add the `code` tab)

**Interfaces:**
- Consumes: `trpc.graph.*` (Task 8/10/11); `CodeGraphNode`, `CodeNodeKind` from `@shared/graph`; `PALETTE` from `./graph-colors`; `ForceGraph2D`.
- Produces: `colorForKind(kind: CodeNodeKind): string`; `CodeGraphTab` React component.

- [ ] **Step 1: Add `colorForKind` to `src/renderer/src/pages/knowledge/graph-colors.ts`**

```typescript
import type { CodeNodeKind } from '@shared/graph'

const KIND_COLORS: Record<CodeNodeKind, string> = {
  code: '#59c2ff', // blue
  doc: '#7fd962', // green
  skill: '#d2a6ff', // violet
  knowledge: '#e6b450', // amber
  session: '#ff8f40', // orange
}

export function colorForKind(kind: CodeNodeKind): string {
  return KIND_COLORS[kind] ?? '#888'
}
```

- [ ] **Step 2: Create `src/renderer/src/pages/knowledge/CodeGraphTab.tsx`**

```tsx
import { trpc } from '@renderer/lib/trpc'
import type { CodeGraphNode, CodeNodeKind } from '@shared/graph'
import { forceCollide, forceX, forceY } from 'd3-force'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import { colorForKind } from './graph-colors'

type FgNode = CodeGraphNode & { x?: number; y?: number }
type FgLink = { source: string; target: string; inferred: boolean }
type View = 'isolated' | 'unified'

const KIND_LABELS: ReadonlyArray<{ id: CodeNodeKind; label: string }> = [
  { id: 'code', label: 'code' },
  { id: 'doc', label: 'docs' },
  { id: 'skill', label: 'skills' },
  { id: 'knowledge', label: 'knowledge' },
  { id: 'session', label: 'sessions' },
]

export function CodeGraphTab({ project }: { project: string }) {
  const projects = trpc.graph.listProjects.useQuery()
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [view, setView] = useState<View>('isolated')
  const [showInferred, setShowInferred] = useState(true)
  const [selected, setSelected] = useState<FgNode | null>(null)
  const [status, setStatus] = useState<string>('')

  // Default to the project matching the page's active project name, else the first.
  const activePath = useMemo(() => {
    if (selectedPath) return selectedPath
    const list = projects.data ?? []
    return list.find((p) => p.project === project)?.projectPath ?? list[0]?.projectPath ?? null
  }, [selectedPath, projects.data, project])

  const scope = view === 'unified' ? '__all__' : (activePath ?? '__all__')
  const graph = trpc.graph.getGraph.useQuery({ scope }, { enabled: Boolean(activePath) })
  const utils = trpc.useUtils()

  const build = trpc.graph.buildGraph.useMutation({
    onMutate: () => setStatus('building…'),
    onSuccess: (r) => {
      setStatus(`built: ${r.nodes} nodes, ${r.edges} edges, ${r.clusters} clusters`)
      utils.graph.getGraph.invalidate()
      utils.graph.listProjects.invalidate()
    },
    onError: (e) => setStatus(`error: ${e.message}`),
  })

  const fgRef = useRef<any>(null) // biome-ignore lint/suspicious/noExplicitAny: ForceGraph ref has no exported type
  const roRef = useRef<ResizeObserver | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
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

  const data = useMemo(() => {
    const raw = graph.data
    if (!raw) return { nodes: [] as FgNode[], links: [] as FgLink[] }
    const nodes: FgNode[] = raw.nodes.map((n) => ({ ...n }))
    const ids = new Set(nodes.map((n) => n.id))
    const links: FgLink[] = raw.edges
      .filter((e) => (showInferred || !e.inferred) && ids.has(e.source) && ids.has(e.target))
      .map((e) => ({ source: e.source, target: e.target, inferred: e.inferred }))
    return { nodes, links }
  }, [graph.data, showInferred])

  // biome-ignore lint/correctness/useExhaustiveDependencies: reheat on visible-set change
  useEffect(() => {
    const fg = fgRef.current
    if (!fg) return
    fg.d3Force('collide', forceCollide(10).iterations(2))
    fg.d3Force('charge')?.strength(-120)
    fg.d3Force('x', forceX(0).strength(0.06))
    fg.d3Force('y', forceY(0).strength(0.06))
    fg.d3Force('center', null)
    fg.d3ReheatSimulation?.()
  }, [data])

  const neighbors = trpc.graph.queryNeighbors.useQuery(
    { nodeId: selected?.id ?? '', depth: 1 },
    { enabled: Boolean(selected) },
  )

  const list = projects.data ?? []

  return (
    <div className="kb-graph-wrap">
      <div className="kb-graph-controls">
        <select
          className="input"
          value={view === 'unified' ? '__all__' : (activePath ?? '')}
          onChange={(e) => {
            if (e.target.value === '__all__') setView('unified')
            else {
              setView('isolated')
              setSelectedPath(e.target.value)
            }
          }}
        >
          <option value="__all__">all projects (unified)</option>
          {list.map((p) => (
            <option key={p.projectPath} value={p.projectPath}>
              {p.project}
              {p.hasGraph ? '' : ' (not built)'}
            </option>
          ))}
        </select>
        <label className="kb-graph-check">
          <input type="checkbox" checked={showInferred} onChange={() => setShowInferred((v) => !v)} />
          show inferred
        </label>
        <button
          type="button"
          className="btn"
          disabled={!activePath || build.isPending}
          onClick={() => activePath && build.mutate({ projectPath: activePath })}
        >
          Build
        </button>
        <span className="kb-graph-status">{status}</span>
      </div>

      <div className="kb-graph-body">
        <div className="kb-graph" ref={setContainer}>
          {data.nodes.length === 0 ? (
            <div className="kb-graph-empty">{'// no graph yet — pick a project and Build.'}</div>
          ) : (
            <ForceGraph2D
              ref={fgRef}
              width={size.w}
              height={size.h}
              graphData={data}
              backgroundColor="transparent"
              nodeId="id"
              nodeLabel={(n) => `${(n as FgNode).label} [${(n as FgNode).kind}]`}
              nodeColor={(n) => colorForKind((n as FgNode).kind)}
              onNodeClick={(n) => setSelected(n as FgNode)}
              linkColor={(l) => ((l as FgLink).inferred ? 'rgba(210,166,255,0.4)' : 'rgba(120,120,120,0.3)')}
              linkLineDash={(l) => ((l as FgLink).inferred ? [3, 3] : null)}
              onEngineStop={() => fgRef.current?.zoomToFit(400, 40)}
            />
          )}
        </div>

        {selected && (
          <aside className="kb-graph-panel">
            <button type="button" className="kb-graph-close" onClick={() => setSelected(null)}>
              ✕
            </button>
            <div className="kb-graph-detail">
              <strong>{selected.label}</strong>
              <div>{selected.kind}</div>
              {selected.relPath && <code>{selected.relPath}</code>}
              <hr />
              <div>neighbors:</div>
              <ul>
                {(neighbors.data?.nodes ?? [])
                  .filter((n) => n.id !== selected.id)
                  .map((n) => (
                    <li key={n.id}>
                      <button type="button" className="link" onClick={() => setSelected({ ...(n as FgNode) })}>
                        {n.label} <span className="dim">[{n.kind}]</span>
                      </button>
                    </li>
                  ))}
              </ul>
            </div>
          </aside>
        )}
      </div>

      <div className="kb-graph-legend">
        {KIND_LABELS.map((k) => (
          <span key={k.id} className="kb-graph-legend-item">
            <span className="dot" style={{ background: colorForKind(k.id) }} /> {k.label}
          </span>
        ))}
      </div>
    </div>
  )
}
```

> `linkLineDash` is a valid `react-force-graph-2d` prop. If the installed version's types reject it, drop that one prop — inferred edges are still distinguished by `linkColor`. The deep-map button is intentionally deferred to Step 4 to keep this step focused; add it there.

- [ ] **Step 3: Wire the tab into `src/renderer/src/pages/Knowledge.tsx`**

Add the import near the other tab imports:

```typescript
import { CodeGraphTab } from '@renderer/pages/knowledge/CodeGraphTab'
```

Extend the `Tab` type:

```typescript
type Tab = 'browse' | 'daily' | 'search' | 'graph' | 'code'
```

Add to the `TABS` array (after the `graph` entry):

```typescript
  { id: 'code', label: './code-graph' },
```

Add the render branch next to the others (after the `graph` branch):

```typescript
              {tab === 'code' && <CodeGraphTab key={active} project={active} />}
```

- [ ] **Step 4: Add the Deep-map button (subscription) to `CodeGraphTab.tsx`**

Add this state + subscription wiring inside the component (after the `build` mutation):

```typescript
  const [deepStatus, setDeepStatus] = useState('')
  const [deepReqId, setDeepReqId] = useState<string | null>(null)
  const cancelDeep = trpc.graph.cancelDeepMap.useMutation()

  trpc.graph.deepMap.useSubscription(
    { requestId: deepReqId ?? '', projectPath: activePath ?? '' },
    {
      enabled: Boolean(deepReqId && activePath),
      onData: (e) => {
        if (e.type === 'tool') setDeepStatus(`graphify: ${e.summary}`)
        else if (e.type === 'progress') setDeepStatus(e.message)
        else if (e.type === 'done') {
          setDeepStatus(`deep map: +${e.nodesAdded} nodes, +${e.edgesAdded} edges`)
          setDeepReqId(null)
          utils.graph.getGraph.invalidate()
        } else if (e.type === 'error') {
          setDeepStatus(`error: ${e.message}`)
          setDeepReqId(null)
        } else if (e.type === 'aborted') {
          setDeepStatus('deep map aborted')
          setDeepReqId(null)
        }
      },
      onError: (err) => {
        setDeepStatus(`error: ${err.message}`)
        setDeepReqId(null)
      },
    },
  )

  const startDeepMap = () => {
    if (!activePath) return
    setDeepStatus('starting graphify…')
    setDeepReqId(`deep-${activePath}-${Date.now()}`)
  }
  const stopDeepMap = () => {
    if (deepReqId) cancelDeep.mutate({ requestId: deepReqId })
    setDeepReqId(null)
  }
```

Add the button + status next to the Build button in the controls bar:

```tsx
        {deepReqId ? (
          <button type="button" className="btn" onClick={stopDeepMap}>
            Cancel deep map
          </button>
        ) : (
          <button type="button" className="btn" disabled={!activePath} onClick={startDeepMap}>
            Deep map via graphify
          </button>
        )}
        <span className="kb-graph-status">{deepStatus}</span>
```

> `Date.now()` here is normal renderer code (only Workflow scripts forbid it). It produces a unique request id per run.

- [ ] **Step 5: Typecheck (web) + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS. Fix any biome complaints (import order, `type` imports).

- [ ] **Step 6: Manual smoke test**

Run: `pnpm dev`
Then in the app:
1. Open the Knowledge page → `./code-graph` tab.
2. Pick a project → click **Build** → confirm the status shows node/edge/cluster counts and a graph renders (nodes colored by kind, legend at the bottom).
3. Click a node → the side panel lists neighbors; clicking a neighbor re-centers selection.
4. Switch the selector to **all projects (unified)** → confirm multiple project islands render.
5. (Optional, token-costly) Click **Deep map via graphify** on a small project → confirm progress updates and, on done, dashed inferred edges appear (toggle "show inferred").

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/pages/knowledge/graph-colors.ts src/renderer/src/pages/knowledge/CodeGraphTab.tsx src/renderer/src/pages/Knowledge.tsx
git commit -m "feat(graph): Knowledge code-graph tab (build, deep-map, isolated/unified)"
```

---

## Task 13: Styles + final verification

**Files:**
- Modify: the SCSS/CSS file backing the Knowledge graph classes (find the file defining `.kb-graph-wrap`, `.kb-graph-controls`, `.kb-graph-panel`).

**Interfaces:** none (styling only).

- [ ] **Step 1: Locate the graph styles**

Run: `grep -rn "kb-graph-wrap\|kb-graph-legend\|kb-graph-status" src/renderer`
Expected: find the stylesheet with the existing `.kb-graph-*` rules. Confirm whether `.kb-graph-legend`, `.kb-graph-legend-item .dot`, `.kb-graph-status`, `.kb-graph-detail` exist.

- [ ] **Step 2: Add any missing rules**

In that stylesheet, add rules for the new classes used by `CodeGraphTab` that don't already exist. Example (adapt selectors/values to the file's conventions; px for sizes, English only):

```scss
.kb-graph-status {
  margin-left: 8px;
  opacity: 0.7;
  font-size: 12px;
}
.kb-graph-legend {
  display: flex;
  gap: 12px;
  padding: 8px 0;
  flex-wrap: wrap;
  .kb-graph-legend-item {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    display: inline-block;
  }
}
.kb-graph-detail {
  padding: 8px;
  code {
    display: block;
    word-break: break-all;
    opacity: 0.8;
  }
  .dim {
    opacity: 0.6;
  }
}
```

- [ ] **Step 3: Full verification**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: all PASS.

- [ ] **Step 4: Manual visual check**

Run: `pnpm dev` → Knowledge → `./code-graph`. Confirm the legend, status text, and side panel are styled acceptably on the dark theme.

- [ ] **Step 5: Commit**

```bash
git add src/renderer
git commit -m "style(graph): code-graph tab legend/status/detail styles"
```

---

## Self-Review

**Spec coverage:**
- Indexer (`indexer.ts`): walk + parse imports (JS/TS/Py) + docs + skills → Tasks 2,3,4,7. ✓
- Link to knowledge articles → `mentions_knowledge` (Task 4) + `indexProject` reads `~/atlas-knowledge` (Task 7). ✓
- Link to sessions from SQLite `agentSessions` → `session_touched` (Task 4) + `indexProject` session query (Task 7). ✓
- SQLite tables `graphNodes`/`graphEdges` → Task 1. ✓
- tRPC `buildGraph`/`queryNeighbors`/`getProjectClusters` (+ added `getGraph`/`listProjects`/`context`/`deepMap`) → Tasks 8,10,11. ✓
- Renderer Graph tab, isolated + unified, cluster color, graphify → Task 12. ✓ (unified = `__all__` scope; kinds colored; inferred edges dashed.)
- Graph context provider for prompt builder/skills → Task 11 (`context.ts` + tRPC + roadmapChat demo). ✓
- Hybrid graphify deep-map via headless Claude session → Tasks 9,10. ✓
- Origin-scoped idempotent rebuild → Task 8 store. ✓
- Tests for parse/resolve/assemble/cluster/query/merge/context + store round-trip → Tasks 2-11. ✓

**Placeholder scan:** No TBD/TODO; every code step has full code; test steps show assertions. ✓

**Type consistency:** `codeNodeId`/`codeEdgeId`, `CodeGraph`/`CodeGraphNode`/`CodeGraphEdge`, `saveStructuralGraph`/`saveGraphifyGraph`/`loadGraph`/`listGraphProjects`, `assembleGraph`/`AssembleInput`, `clusterGraph`/`summarizeClusters`, `neighborsOf`, `parseGraphifyJson`/`mergeGraphifyGraph`/`runGraphifyDeepMap`, `getSubgraphContext`, `colorForKind` — names used consistently across tasks. Router keys (`graph.listProjects`, `graph.buildGraph`, `graph.getGraph`, `graph.queryNeighbors`, `graph.getProjectClusters`, `graph.context`, `graph.deepMap`, `graph.cancelDeepMap`) match renderer calls. ✓

**Known integration risks flagged inline for the implementer:**
- `readAllArticles` return shape (Task 7 Step 4) — verify `{ relPath, kind, doc }`.
- SDK message typing in `runGraphifyDeepMap` (Task 10 Step 4) — mirror `roadmapChat/run.ts` `SDKMessage` if concrete types exist.
- `react-force-graph-2d` `linkLineDash`/`d3Force` prop availability (Task 12) — degrade gracefully.
- Existing `.kb-graph-*` styles reused; only missing classes added (Task 13).
