# Multi-Source Graph Visualization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the code-graph viz with six independently-toggleable sources (Code/Docs/Sessions/Knowledge/Skills/Graphify) that union when all are on, and stop discarding graphify's full symbol map at merge.

**Architecture:** Extend the existing DB graph along `origin` layers. `mergeGraphifyGraph` persists graphify's full node set (`origin='graphify'`) plus `defined_in` bridge edges to structural file nodes, instead of collapsing. The renderer gets a pure `filterBySources` helper, six persisted toggles, and origin-based node coloring.

**Tech Stack:** TypeScript (Electron main + tRPC + React renderer), zustand (persisted `useUiStore`), react-force-graph 2D/3D, vitest, Playwright.

## Global Constraints

- English-only UI strings.
- Only schema change allowed is adding `'defined_in'` to `codeEdgeKindSchema` (zod); `graph_edges.kind` is a text column, so **no DB migration**. No new node kinds.
- graphify nodes are distinguished from structural nodes by `origin='graphify'`, never by a new kind.
- Default enabled sources = all except `session` (sessions are 74% `session_touched` noise).
- Commit after every task. Do not push. If a `git-commit-message` skill fires, IGNORE it (targets Mako/KESHET) — use a plain commit.
- Full effect requires one re-Build (the merge change only populates the full graphify layer on the next Build) — this is a runtime step, not a code task.

## File Structure

- `src/shared/graph.ts` **(modify)** — add `'defined_in'` to `codeEdgeKindSchema`.
- `src/main/services/graph/graphifyRunner.ts` **(modify)** — `mergeGraphifyGraph`: full graphify nodes + `defined_in` bridges.
- `src/renderer/src/pages/knowledge/source-filter.ts` **(new)** — pure `sourceOf` + `filterBySources` + `SOURCE_KEYS`.
- `src/renderer/src/store/ui.ts` **(modify)** — persisted `graphSources` + setter.
- `src/renderer/src/pages/knowledge/graph-colors.ts` **(modify)** — `GRAPHIFY_COLOR`, `colorForNode`, `DEFINED_IN_EDGE_COLOR`.
- `src/renderer/src/pages/knowledge/CodeGraphTab.tsx` **(modify)** — six toggles, source filter, origin coloring, bridge-link styling.

---

### Task 1: `mergeGraphifyGraph` — full graphify nodes + `defined_in` bridges

**Files:**
- Modify: `src/shared/graph.ts` (the `codeEdgeKindSchema` enum)
- Modify: `src/main/services/graph/graphifyRunner.ts` (the `mergeGraphifyGraph` function, ~lines 63-124)
- Test: `src/main/services/graph/graphifyRunner.test.ts` (replace the `mergeGraphifyGraph` describe block)

**Interfaces:**
- Consumes: `codeNodeId(projectPath, kind, key)`, `codeEdgeId(source, target, kind)`, `kindForFileType(fileType)` (same file), `parseGraphifyJson`, types `CodeGraph`, `CodeGraphNode`, `CodeGraphEdge`, `GraphifyJson`.
- Produces: `mergeGraphifyGraph(projectPath: string, structural: CodeGraph, gy: GraphifyJson): CodeGraph` — now returns the graphify layer as: one node per graphify node (`origin='graphify'`, id `codeNodeId(projectPath, kind, graphifyId)`), `semantic` edges among graphify nodes, and `defined_in` edges from each graphify node to the structural node sharing its `source_file`/`relPath`.

- [ ] **Step 1: Add `'defined_in'` to the edge-kind schema**

In `src/shared/graph.ts`, change:

```ts
export const codeEdgeKindSchema = z.enum([
  'imports',
  'doc_link',
  'session_touched',
  'mentions_knowledge',
  'semantic',
])
```

to:

```ts
export const codeEdgeKindSchema = z.enum([
  'imports',
  'doc_link',
  'session_touched',
  'mentions_knowledge',
  'semantic',
  'defined_in',
])
```

- [ ] **Step 2: Replace the `mergeGraphifyGraph` test block with the new behavior (failing)**

In `src/main/services/graph/graphifyRunner.test.ts`, replace the entire `describe('mergeGraphifyGraph', …)` block (keep the `describe('parseGraphifyJson', …)` block and the `structural`/`raw` fixtures above it unchanged) with:

```ts
describe('mergeGraphifyGraph', () => {
  it('persists every graphify node as a graphify-origin node (does not collapse onto files)', () => {
    const add = mergeGraphifyGraph(P, structural, parseGraphifyJson(raw))
    // all three graphify nodes become graphify-origin nodes, ided by their graphify id
    expect(add.nodes).toHaveLength(3)
    expect(add.nodes.every((n) => n.origin === 'graphify')).toBe(true)
    const aGid = codeNodeId(P, 'code', 'src_a_ts')
    expect(add.nodes.find((n) => n.id === aGid)).toMatchObject({
      kind: 'code',
      label: 'a.ts',
      relPath: 'src/a.ts',
    })
    // the doc concept is kept too
    expect(add.nodes.find((n) => n.relPath === 'notes/x.md')).toMatchObject({
      origin: 'graphify',
      kind: 'doc',
    })
  })

  it('emits semantic edges between graphify nodes (not structural ids)', () => {
    const add = mergeGraphifyGraph(P, structural, parseGraphifyJson(raw))
    const edge = add.edges.find(
      (e) =>
        e.kind === 'semantic' &&
        e.source === codeNodeId(P, 'code', 'src_a_ts') &&
        e.target === codeNodeId(P, 'code', 'src_b_ts'),
    )
    expect(edge).toMatchObject({ origin: 'graphify', inferred: true })
    expect(edge?.meta).toMatchObject({ audit: 'INFERRED', relation: 'calls' })
  })

  it('marks EXTRACTED semantic edges as not inferred', () => {
    const add = mergeGraphifyGraph(P, structural, parseGraphifyJson(raw))
    const documents = add.edges.find((e) => e.meta?.relation === 'documents')
    expect(documents?.inferred).toBe(false)
  })

  it('bridges each graphify node to its structural file node via defined_in', () => {
    const add = mergeGraphifyGraph(P, structural, parseGraphifyJson(raw))
    const bridge = add.edges.find(
      (e) =>
        e.kind === 'defined_in' &&
        e.source === codeNodeId(P, 'code', 'src_a_ts') &&
        e.target === codeNodeId(P, 'code', 'src/a.ts'),
    )
    expect(bridge).toMatchObject({ origin: 'graphify', inferred: false })
    // concept_x's source_file notes/x.md has no structural node → no bridge
    expect(
      add.edges.some((e) => e.kind === 'defined_in' && e.target.includes('notes/x.md')),
    ).toBe(false)
  })

  it('skips links referencing a graphify id absent from nodes (no fabricated node/edge)', () => {
    const dangling = JSON.stringify({
      nodes: [{ id: 'src_a_ts', label: 'a.ts', source_file: 'src/a.ts', file_type: 'code' }],
      links: [
        { source: 'src_a_ts', target: 'ghost_missing', relation: 'calls', confidence: 'INFERRED' },
      ],
    })
    const add = mergeGraphifyGraph(P, structural, parseGraphifyJson(dangling))
    expect(add.edges.some((e) => e.kind === 'semantic')).toBe(false)
    expect(add.nodes.some((n) => n.id.includes('ghost_missing'))).toBe(false)
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm vitest run src/main/services/graph/graphifyRunner.test.ts`
Expected: FAIL — the current collapse-based `mergeGraphifyGraph` returns 1 node and structural-id semantic edges.

- [ ] **Step 4: Rewrite `mergeGraphifyGraph`**

Replace the whole `mergeGraphifyGraph` function body (from `export function mergeGraphifyGraph(` through its closing `}`) with:

```ts
// Merge graphify's LLM graph onto the structural graph as the 'graphify' layer.
// Unlike a collapse, this keeps graphify's full node set (symbols + concepts) as
// distinct graphify-origin nodes, connects them with their semantic edges, and
// bridges each to the structural file node that defines it (defined_in). The
// caller persists these as the 'graphify' layer; the 'indexer' layer is untouched.
export function mergeGraphifyGraph(
  projectPath: string,
  structural: CodeGraph,
  gy: GraphifyJson,
): CodeGraph {
  const relToStructId = new Map<string, string>()
  for (const n of structural.nodes) if (n.relPath) relToStructId.set(n.relPath, n.id)

  const newNodes = new Map<string, CodeGraphNode>()
  const gidToNodeId = new Map<string, string>()
  for (const gn of gy.nodes) {
    if (!gn.id) continue
    const kind = kindForFileType(gn.file_type)
    const id = codeNodeId(projectPath, kind, gn.id)
    gidToNodeId.set(gn.id, id)
    if (!newNodes.has(id)) {
      newNodes.set(id, {
        id,
        projectPath,
        kind,
        label: gn.label ?? (gn.source_file ? basename(gn.source_file) : gn.id),
        relPath: gn.source_file ?? null,
        meta: { origin: 'graphify', graphifyId: gn.id },
        community: typeof gn.community === 'number' ? gn.community : null,
        origin: 'graphify',
      })
    }
  }

  const edges: CodeGraphEdge[] = []
  const seen = new Set<string>()

  // Semantic edges among graphify nodes (skip endpoints not in the node set).
  for (const l of gy.links) {
    const s = gidToNodeId.get(l.source ?? l._src ?? '')
    const t = gidToNodeId.get(l.target ?? l._tgt ?? '')
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

  // defined_in bridges: graphify node → the structural file node it belongs to.
  for (const gn of gy.nodes) {
    if (!gn.id || !gn.source_file) continue
    const structId = relToStructId.get(gn.source_file)
    const gNodeId = gidToNodeId.get(gn.id)
    if (!structId || !gNodeId || structId === gNodeId) continue
    const id = codeEdgeId(gNodeId, structId, 'defined_in')
    if (seen.has(id)) continue
    seen.add(id)
    edges.push({
      id,
      projectPath,
      source: gNodeId,
      target: structId,
      kind: 'defined_in',
      inferred: false,
      origin: 'graphify',
      meta: { relation: 'defined_in' },
    })
  }

  return { nodes: [...newNodes.values()], edges }
}
```

(`basename` is already imported from `node:path` at the top of the file; `codeNodeId`/`codeEdgeId`/`kindForFileType`/types are already in scope.)

- [ ] **Step 5: Run the tests + typecheck to verify pass**

Run: `pnpm vitest run src/main/services/graph/graphifyRunner.test.ts && pnpm typecheck:node`
Expected: PASS (5 mergeGraphifyGraph tests + the unchanged parseGraphifyJson tests); typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/shared/graph.ts src/main/services/graph/graphifyRunner.ts src/main/services/graph/graphifyRunner.test.ts
git commit -m "feat(graph): merge stores full graphify node set + defined_in bridges"
```

---

### Task 2: `filterBySources` pure helper

**Files:**
- Create: `src/renderer/src/pages/knowledge/source-filter.ts`
- Test: `src/renderer/src/pages/knowledge/source-filter.test.ts`

**Interfaces:**
- Consumes: `CodeGraph`, `CodeGraphNode` from `@shared/graph`.
- Produces:
  - `SOURCE_KEYS: readonly ['code','doc','session','knowledge','skill','graphify']`
  - `type SourceKey`
  - `sourceOf(node: CodeGraphNode): SourceKey`
  - `filterBySources(graph: CodeGraph, enabled: ReadonlySet<string>): CodeGraph`

- [ ] **Step 1: Write the failing test**

```ts
// src/renderer/src/pages/knowledge/source-filter.test.ts
import type { CodeGraph } from '@shared/graph'
import { describe, expect, it } from 'vitest'
import { filterBySources, sourceOf } from './source-filter'

const n = (id: string, kind: CodeGraph['nodes'][number]['kind'], origin: 'indexer' | 'graphify') => ({
  id,
  projectPath: 'p',
  kind,
  label: id,
  relPath: null,
  meta: null,
  community: 0,
  origin,
})

const graph: CodeGraph = {
  nodes: [
    n('code1', 'code', 'indexer'),
    n('sess1', 'session', 'indexer'),
    n('gfy1', 'code', 'graphify'),
  ],
  edges: [
    { id: 'e1', projectPath: 'p', source: 'code1', target: 'sess1', kind: 'session_touched', inferred: false, origin: 'indexer', meta: null },
    { id: 'e2', projectPath: 'p', source: 'gfy1', target: 'code1', kind: 'defined_in', inferred: false, origin: 'graphify', meta: null },
  ],
}

describe('sourceOf', () => {
  it('maps graphify-origin nodes to graphify, structural nodes to their kind', () => {
    expect(sourceOf(graph.nodes[0])).toBe('code')
    expect(sourceOf(graph.nodes[1])).toBe('session')
    expect(sourceOf(graph.nodes[2])).toBe('graphify')
  })
})

describe('filterBySources', () => {
  it('keeps only enabled sources and edges whose both endpoints survive', () => {
    const out = filterBySources(graph, new Set(['code', 'graphify']))
    expect(out.nodes.map((x) => x.id).sort()).toEqual(['code1', 'gfy1'])
    // session node dropped → its edge dropped; the defined_in edge survives
    expect(out.edges.map((e) => e.id)).toEqual(['e2'])
  })

  it('returns the whole graph when all sources are enabled', () => {
    const out = filterBySources(graph, new Set(['code', 'session', 'graphify']))
    expect(out.nodes).toHaveLength(3)
    expect(out.edges).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/renderer/src/pages/knowledge/source-filter.test.ts`
Expected: FAIL — "Cannot find module './source-filter'".

- [ ] **Step 3: Implement**

```ts
// src/renderer/src/pages/knowledge/source-filter.ts
import type { CodeGraph, CodeGraphNode } from '@shared/graph'

// The six toggleable sources. Structural node kinds plus the graphify layer.
export const SOURCE_KEYS = ['code', 'doc', 'session', 'knowledge', 'skill', 'graphify'] as const
export type SourceKey = (typeof SOURCE_KEYS)[number]

// A node's source is its layer: graphify-origin nodes are the 'graphify' source;
// every structural node's source is its kind (which is always one of the first
// five SOURCE_KEYS).
export function sourceOf(node: CodeGraphNode): SourceKey {
  return node.origin === 'graphify' ? 'graphify' : (node.kind as SourceKey)
}

// Keep nodes whose source is enabled, then keep edges whose both endpoints survive.
export function filterBySources(graph: CodeGraph, enabled: ReadonlySet<string>): CodeGraph {
  const nodes = graph.nodes.filter((node) => enabled.has(sourceOf(node)))
  const ids = new Set(nodes.map((node) => node.id))
  const edges = graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target))
  return { nodes, edges }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run src/renderer/src/pages/knowledge/source-filter.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/pages/knowledge/source-filter.ts src/renderer/src/pages/knowledge/source-filter.test.ts
git commit -m "feat(graph): pure filterBySources helper for source toggles"
```

---

### Task 3: Persisted `graphSources` in `useUiStore`

**Files:**
- Modify: `src/renderer/src/store/ui.ts`
- Test: `src/renderer/src/store/ui.test.ts` (extend)

**Interfaces:**
- Consumes: nothing from other tasks (uses literal source keys).
- Produces: `useUiStore` state gains `graphSources: string[]` and `setGraphSources: (v: string[]) => void`; default `['code','doc','knowledge','skill','graphify']` (session off).

- [ ] **Step 1: Write the failing test (extend ui.test.ts)**

Append to `src/renderer/src/store/ui.test.ts`:

```ts
describe('graphSources', () => {
  it('defaults to all sources except session', () => {
    expect(useUiStore.getState().graphSources).toEqual([
      'code',
      'doc',
      'knowledge',
      'skill',
      'graphify',
    ])
  })

  it('setGraphSources replaces the enabled set', () => {
    useUiStore.getState().setGraphSources(['code', 'graphify'])
    expect(useUiStore.getState().graphSources).toEqual(['code', 'graphify'])
  })

  it('mergePersistedUi keeps a valid persisted array and defaults a bad one', () => {
    const cur = useUiStore.getState()
    expect(mergePersistedUi({ graphSources: ['doc'] }, cur).graphSources).toEqual(['doc'])
    expect(mergePersistedUi({ graphSources: 'nope' }, cur).graphSources).toEqual([
      'code',
      'doc',
      'knowledge',
      'skill',
      'graphify',
    ])
  })
})
```

(Ensure `mergePersistedUi` is imported in the test — it already is per the existing `import { mergePersistedUi, SECTIONS, useUiStore } from './ui'`.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/renderer/src/store/ui.test.ts`
Expected: FAIL — `graphSources` undefined / `setGraphSources` not a function.

- [ ] **Step 3: Implement in `ui.ts`**

Add a default constant near the top (after `SECTIONS`):

```ts
// Default graph sources: everything except sessions (session_touched edges are
// ~74% of the structural graph and read as noise).
export const DEFAULT_GRAPH_SOURCES: string[] = ['code', 'doc', 'knowledge', 'skill', 'graphify']
```

In `interface UiState`, add:

```ts
  graphSources: string[]
  setGraphSources: (sources: string[]) => void
```

In `mergePersistedUi`, before the `return`, add:

```ts
  const graphSources = Array.isArray(p.graphSources) && p.graphSources.every((s) => typeof s === 'string')
    ? (p.graphSources as string[])
    : DEFAULT_GRAPH_SOURCES
```

and include it in the returned object:

```ts
  return { ...current, section, selectedProject, tabsBySection, roadmapHideDone, graphSources }
```

In the `create(...)` initializer object, add the initial value and setter:

```ts
      graphSources: DEFAULT_GRAPH_SOURCES,
      setGraphSources: (graphSources) => set({ graphSources }),
```

In `partialize`, add `graphSources: s.graphSources,`. In the `guardedStorage` `Pick<...>` type, add `'graphSources'` to the union:

```ts
const guardedStorage = createJSONStorage<
  Pick<UiState, 'section' | 'selectedProject' | 'tabsBySection' | 'roadmapHideDone' | 'graphSources'>
>(() => (typeof localStorage !== 'undefined' ? localStorage : noopStorage))
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run src/renderer/src/store/ui.test.ts && pnpm typecheck:web`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/store/ui.ts src/renderer/src/store/ui.test.ts
git commit -m "feat(graph): persist enabled graph sources in useUiStore"
```

---

### Task 4: Origin-based node color + bridge edge style

**Files:**
- Modify: `src/renderer/src/pages/knowledge/graph-colors.ts`
- Test: `src/renderer/src/pages/knowledge/graph-colors.test.ts` (new)

**Interfaces:**
- Consumes: `colorForKind` (same file), `CodeNodeKind`.
- Produces:
  - `GRAPHIFY_COLOR = '#e06fd6'`
  - `DEFINED_IN_EDGE_COLOR = 'rgba(210,166,255,0.25)'`
  - `colorForNode(node: { origin: string; kind: CodeNodeKind }): string`

- [ ] **Step 1: Write the failing test**

```ts
// src/renderer/src/pages/knowledge/graph-colors.test.ts
import { describe, expect, it } from 'vitest'
import { colorForKind, colorForNode, GRAPHIFY_COLOR } from './graph-colors'

describe('colorForNode', () => {
  it('colors graphify-origin nodes with the graphify color', () => {
    expect(colorForNode({ origin: 'graphify', kind: 'code' })).toBe(GRAPHIFY_COLOR)
  })
  it('colors structural nodes by kind', () => {
    expect(colorForNode({ origin: 'indexer', kind: 'code' })).toBe(colorForKind('code'))
  })
  it('uses a graphify color distinct from every structural kind color', () => {
    for (const k of ['code', 'doc', 'skill', 'knowledge', 'session'] as const) {
      expect(GRAPHIFY_COLOR).not.toBe(colorForKind(k))
    }
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/renderer/src/pages/knowledge/graph-colors.test.ts`
Expected: FAIL — `colorForNode`/`GRAPHIFY_COLOR` not exported.

- [ ] **Step 3: Implement — append to `graph-colors.ts`**

```ts
// graphify-origin nodes get one distinct color so the semantic layer is legible
// against the kind-colored structural layer. Magenta-purple — deliberately not
// any KIND_COLORS value (skill's violet #d2a6ff is the closest, kept separate).
export const GRAPHIFY_COLOR = '#e06fd6'

// defined_in bridge edges (graphify symbol → structural file) render muted so
// they don't compete with structural and semantic edges.
export const DEFINED_IN_EDGE_COLOR = 'rgba(210,166,255,0.25)'

export function colorForNode(node: { origin: string; kind: CodeNodeKind }): string {
  return node.origin === 'graphify' ? GRAPHIFY_COLOR : colorForKind(node.kind)
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run src/renderer/src/pages/knowledge/graph-colors.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/pages/knowledge/graph-colors.ts src/renderer/src/pages/knowledge/graph-colors.test.ts
git commit -m "feat(graph): origin-based node color + muted defined_in edge style"
```

---

### Task 5: Wire six source toggles into `CodeGraphTab`

**Files:**
- Modify: `src/renderer/src/pages/knowledge/CodeGraphTab.tsx`
- Test: `e2e/app.spec.ts` (add a code-graph source-toggle assertion)

**Interfaces:**
- Consumes: `filterBySources`, `SOURCE_KEYS` (Task 2); `useUiStore` `graphSources`/`setGraphSources` (Task 3); `colorForNode`, `GRAPHIFY_COLOR`, `DEFINED_IN_EDGE_COLOR` (Task 4).
- Produces: renderer UI only.

- [ ] **Step 1: Add imports**

At the top of `CodeGraphTab.tsx`, add:

```tsx
import { useUiStore } from '@renderer/store/ui'
import { colorForKind, colorForNode, DEFINED_IN_EDGE_COLOR } from './graph-colors'
import { filterBySources, SOURCE_KEYS } from './source-filter'
```

(There is an existing `import { colorForKind } from './graph-colors'` — merge it into the line above so `colorForKind` is not imported twice.)

- [ ] **Step 2: Read enabled sources from the store**

Inside the component, near the other `useState` hooks, add:

```tsx
const graphSources = useUiStore((s) => s.graphSources)
const setGraphSources = useUiStore((s) => s.setGraphSources)
const enabled = useMemo(() => new Set(graphSources), [graphSources])
const toggleSource = (key: string) =>
  setGraphSources(
    graphSources.includes(key) ? graphSources.filter((k) => k !== key) : [...graphSources, key],
  )
```

- [ ] **Step 3: Apply the source filter and thread edge kind into links**

Replace the existing `data` `useMemo` (the one that builds `nodes`/`links` from `graph.data` and `showInferred`) with:

```tsx
const data = useMemo(() => {
  const raw = graph.data
  if (!raw) return { nodes: [] as FgNode[], links: [] as FgLink[] }
  const scoped = filterBySources(raw, enabled)
  const nodes: FgNode[] = scoped.nodes.map((n) => ({ ...n }))
  const ids = new Set(nodes.map((n) => n.id))
  const links: FgLink[] = scoped.edges
    .filter((e) => (showInferred || !e.inferred) && ids.has(e.source) && ids.has(e.target))
    .map((e) => ({ source: e.source, target: e.target, inferred: e.inferred, kind: e.kind }))
  return { nodes, links }
}, [graph.data, showInferred, enabled])
```

Update the `FgLink` type (near the top of the file) to carry the edge kind:

```tsx
type FgLink = { source: string; target: string; inferred: boolean; kind: string }
```

- [ ] **Step 4: Color nodes by origin and style bridge links (both 2D and 3D)**

In the `ForceGraph2D` element, change `nodeColor` and `linkColor`/`linkLineDash`:

```tsx
nodeColor={(n) => colorForNode(n as FgNode)}
linkColor={(l) =>
  (l as FgLink).kind === 'defined_in'
    ? DEFINED_IN_EDGE_COLOR
    : (l as FgLink).inferred
      ? 'rgba(210,166,255,0.4)'
      : 'rgba(120,120,120,0.3)'
}
linkLineDash={(l) =>
  (l as FgLink).kind === 'defined_in' || (l as FgLink).inferred ? [3, 3] : null
}
```

In the `Galaxy3D` element, change `nodeColor` and `linkColor`:

```tsx
nodeColor={(n) => colorForNode(n as FgNode)}
linkColor={(l) =>
  (l as FgLink).kind === 'defined_in'
    ? DEFINED_IN_EDGE_COLOR
    : (l as FgLink).inferred
      ? 'rgba(210,166,255,0.4)'
      : 'rgba(120,120,120,0.3)'
}
```

- [ ] **Step 5: Replace the static legend with six toggle chips**

Replace the `<div className="kb-graph-legend">…</div>` block at the bottom with interactive toggles (label each source; the graphify swatch uses `GRAPHIFY_COLOR`, the rest use `colorForKind`):

```tsx
<div className="kb-graph-legend">
  {SOURCE_KEYS.map((key) => {
    const on = enabled.has(key)
    const swatch = key === 'graphify' ? colorForNode({ origin: 'graphify', kind: 'code' }) : colorForKind(key as FgNode['kind'])
    return (
      <label key={key} className="kb-graph-legend-item" style={{ opacity: on ? 1 : 0.4 }}>
        <input type="checkbox" checked={on} onChange={() => toggleSource(key)} />
        <span className="dot" style={{ background: swatch }} /> {key}
      </label>
    )
  })}
</div>
```

Remove the now-unused `KIND_LABELS` constant and its import usage.

- [ ] **Step 6: Add the e2e assertion**

In `e2e/app.spec.ts`, in the code-graph test that opens the `./code-graph` tab (the one added for the single Build button), add after the tab is open:

```ts
// six source toggles, sessions off by default
for (const label of ['code', 'doc', 'session', 'knowledge', 'skill', 'graphify']) {
  await expect(page.getByRole('checkbox', { name: label })).toBeVisible()
}
await expect(page.getByRole('checkbox', { name: 'session' })).not.toBeChecked()
```

(If the existing test guards on "a project has a graph", place these assertions where the controls render regardless of graph presence — the toggles are always shown.)

- [ ] **Step 7: Verify typecheck, lint, unit, e2e**

Run: `pnpm typecheck && pnpm lint && pnpm e2e -g "code graph"`
Expected: typecheck clean; lint only the pre-existing `Galaxy3D`/`d3-force-3d` warnings; e2e passes with the six toggles and session unchecked.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/pages/knowledge/CodeGraphTab.tsx e2e/app.spec.ts
git commit -m "feat(graph): six toggleable sources in the code-graph viz"
```

---

## Final verification

- [ ] `pnpm test` — map + graph unit suites green (pre-existing better-sqlite3 ABI DB-test failures are environmental, not from this branch).
- [ ] `pnpm typecheck && pnpm lint`.
- [ ] In `pnpm dev`: open Knowledge → code-graph, click **Build** once (re-Build populates the full graphify layer), then confirm: toggling `Graphify` shows/hides ~1200 symbol nodes bridged to files; toggling `Sessions` adds/removes the session cloud; all six on = full union; graphify nodes render in the distinct magenta color; `defined_in` bridges are muted.

## Self-review notes (coverage against the spec)

- Component A (merge stores full graphify nodes + defined_in bridges; add `defined_in` kind, no migration): Task 1. ✔
- Component B (six source toggles, `sourceOf`/`filterBySources`, persisted set, sessions-off default): Tasks 2 (filter) + 3 (store) + 5 (UI). ✔
- Component C (origin color `GRAPHIFY_COLOR`, muted `defined_in`, per-source communities untouched, perf via sessions-off default): Tasks 4 + 5. ✔
- Union when all on: Task 2 test ("returns the whole graph when all sources are enabled") + Task 5 wiring. ✔
- Requires one re-Build: final verification step. ✔
- Out-of-scope items (sources[] model, graph.json overlay, caps, new kinds, community unification) — no task touches them. ✔
