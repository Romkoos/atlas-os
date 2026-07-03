# Multi-Source Graph Visualization — Design

**Date:** 2026-07-03
**Status:** Approved (design), pending implementation plan

## Purpose

Make the Knowledge → code-graph visualization show **every data source** in the
project graph, each independently toggleable, so that with all sources enabled the
user sees the complete union. The immediate driver: graphify's full semantic map
(~1208 symbol/concept nodes + its communities + god nodes) is currently **discarded**
at merge time — only ~19 nodes and ~161 semantic edges survive into the DB the viz
renders. The viz today is dominated by structural `session_touched` telemetry (74% of
edges) and cannot show graphify's rich map at all.

After this change: the viz renders one graph with six toggleable sources —
**Code, Docs, Sessions, Knowledge, Skills** (structural, file-level) and **Graphify**
(the full symbol/concept map, bridged to files) — union when all are on.

## Context (current state)

- The viz (`src/renderer/src/pages/knowledge/CodeGraphTab.tsx`) reads the merged graph
  from SQLite via `trpc.graph.getGraph` → `loadGraph(db, scope)`. It has a static
  legend (`KIND_LABELS`: code/doc/skill/knowledge/session) and one `showInferred`
  checkbox — **no per-source toggles**.
- DB layers (`graph_nodes.origin`): `indexer` (structural, file-level: code imports,
  doc links, session-touches, knowledge mentions) and `graphify`.
- `mergeGraphifyGraph` (`src/main/services/graph/graphifyRunner.ts`) **collapses**
  graphify's symbol-level nodes onto structural file nodes by `source_file` → `relPath`,
  creating a new node only for a graphify `source_file` absent from the structural
  graph. That is why a full graphify graph (1208 nodes) contributes only ~19 nodes.
- Verified live-Build DB state for atlas-os: 1138 nodes (1119 indexer + 19 graphify),
  1494 edges (1333 indexer + 161 graphify); indexer edges are 1101 `session_touched`,
  157 `mentions_knowledge`, 75 `imports`. graphify's own `graph.json`: 1208 nodes /
  1295 links / 518 wiki articles — none of its node set, communities, or god nodes
  reach the viz.
- Schemas (`src/shared/graph.ts`): `codeNodeKindSchema` =
  `['code','doc','skill','knowledge','session']`; `codeEdgeKindSchema` =
  `['imports','doc_link','session_touched','mentions_knowledge','semantic']`;
  `graphOriginSchema` = `['indexer','graphify']`.
- Node coloring: `colorForKind(kind)` in `graph-colors.ts`; inferred edges render
  purple (`rgba(210,166,255,…)`).

## Decisions (locked)

- **Approach:** extend the existing DB graph along `origin` layers (not a renderer-side
  `graph.json` overlay, not a full `sources[]` schema redesign). One queryable SQLite
  graph; the context provider / `query.py` gain the full graphify map for free.
- **Source model = node kind + graphify layer.** Six toggles: `Code`, `Docs`,
  `Sessions`, `Knowledge`, `Skills` (all `origin='indexer'`, filtered by `kind`) and
  `Graphify` (all `origin='graphify'`). A node is visible iff its source is enabled;
  an edge iff both endpoints are visible. All six on ⇒ full union.
- **Graphify granularity = full symbol graph + bridges.** Persist every graphify node
  (symbols + concepts) as `origin='graphify'`, plus a `defined_in` bridge edge from
  each graphify node to its structural file node (by `source_file` → `relPath`).
- **No node-kind migration.** graphify nodes reuse existing kinds (`file_type` → kind:
  code→`code`, document/concept→`doc`). They are distinguished from structural nodes by
  `origin`, which the `Graphify` toggle and coloring key on. The only schema change is
  adding `'defined_in'` to `codeEdgeKindSchema` (zod only; `graph_edges.kind` is a text
  column, so **no DB migration**).
- **Coloring by source in the union.** Structural nodes colored by `kind`
  (`colorForKind`, unchanged); graphify-origin nodes colored distinctly (purple family,
  matching existing inferred styling); `defined_in` bridge edges muted.
- **Communities stay per-source.** graphify nodes cluster/color by graphify communities;
  structural nodes by structural communities. No cross-source community renumbering.
- **Default toggle state:** Sessions **OFF** by default (74% of edges are
  `session_touched` noise); Code/Docs/Knowledge/Skills/Graphify **ON**. Toggle state
  persists via the existing persisted `useUiStore` (same store that already persists
  nav/project; note `showInferred` is currently local `useState` and stays local).
- **Requires one re-Build** to populate the full graphify layer (the merge change only
  takes effect on the next Build).
- **Branch strategy:** merge the completed `feat/atlas-maps` branch first (Build + store
  + scripts + fixes — done, green, self-contained), then implement this feature on a new
  branch. This feature modifies the same `mergeGraphifyGraph`, so it builds directly on
  that merge.

## Architecture

```
Build stage 3 (merge) ── mergeGraphifyGraph (CHANGED) ──► graph_nodes / graph_edges (SQLite)
  indexer layer (unchanged)  ────────────────────────────►   origin='indexer'  (file-level)
  graphify graph.json ──► ALL nodes as origin='graphify'  ►   origin='graphify' (symbol/concept)
                     └──► defined_in bridges (symbol→file) ►   kind='defined_in' edges
                                                               │
   getGraph (unchanged) ──► loadGraph ──► CodeGraphTab ──► sourceFilter(enabled) ──► ForceGraph 2D/3D
                                          6 source toggles ── union when all on
```

The pure/IO split is preserved: `mergeGraphifyGraph` stays a pure function
(graph in → graph additions out) and gains full-node + bridge logic; the new
source-filter is a pure renderer helper.

## Component A — Data model & merge change

**File:** `src/main/services/graph/graphifyRunner.ts` (`mergeGraphifyGraph`), plus
`src/shared/graph.ts` (add `'defined_in'` edge kind).

- `mergeGraphifyGraph(projectPath, structural, gy)` now returns, as the `graphify`
  layer:
  - **One node per graphify node** (not just unmatched ones). Node id derived
    deterministically from the graphify node id namespaced to the project
    (`codeNodeId(projectPath, kind, graphifyId)`), `origin='graphify'`, `kind` from
    `file_type` (code→`code`, document/concept/paper→`doc`, image→`doc`), `community`
    from the graphify node's community, `relPath` = `source_file` when present,
    `meta` carrying `{ audit?, graphifyId, degree? }`.
  - **Semantic edges** among graphify nodes (as today, `kind='semantic'`).
  - **`defined_in` bridge edges**: for each graphify node whose `source_file` matches a
    structural node's `relPath`, one edge `graphifyNode → structuralNode`,
    `kind='defined_in'`, `origin='graphify'`, `inferred=false`.
- Dangling graphify edges (endpoint id absent from the graphify node set) are still
  skipped — never fabricate nodes.
- `saveGraphifyGraph` (unchanged) replaces the whole `graphify` layer each Build, so
  re-Builds are idempotent.

Add `'defined_in'` to `codeEdgeKindSchema` and to `graph-colors`/edge-style handling.

## Component B — Source toggles (renderer)

**Files:** `src/renderer/src/pages/knowledge/CodeGraphTab.tsx`, a new pure helper
`src/renderer/src/pages/knowledge/source-filter.ts`, and the persisted UI store used for
`showInferred`/nav.

- **Sources:** `['code','doc','session','knowledge','skill','graphify']`. A `Set` of
  enabled sources persisted in `useUiStore` (default = all except `session`).
- **`sourceOf(node)`** = `node.origin === 'graphify' ? 'graphify' : node.kind`.
- **`filterBySources(graph, enabled)`** (pure, unit-tested): keep nodes whose
  `sourceOf` ∈ enabled; keep edges whose both endpoints survive. Compose with the
  existing `showInferred` filter.
- **UI:** replace the static legend row with six toggle chips (checkbox + color swatch +
  label). Union when all enabled. Default set = all except `session`.
- Keep the existing project selector, isolated/unified view, `showInferred`, 2D/3D
  toggle, NodeDetails, and clustering untouched.

## Component C — Rendering, color, performance

**Files:** `graph-colors.ts`, `CodeGraphTab.tsx`, `Galaxy3D`/2D node & link styling.

- **Node color:** `nodeColor(n) = n.origin === 'graphify' ? GRAPHIFY_COLOR :
  colorForKind(n.kind)`. `GRAPHIFY_COLOR` in the purple family used for inferred edges.
- **Bridge edges (`defined_in`):** muted/dashed, visually subordinate to semantic and
  structural edges.
- **Communities:** unchanged clustering; graphify nodes carry graphify community numbers,
  structural nodes structural ones — used only for 3D clustering/focus, never merged.
- **Performance:** all-on ≈ 1888 nodes / ~2500 edges — within react-force-graph limits
  but dense; the sessions-off default keeps the typical view ~700–1100 nodes. Reuses the
  existing lazy 3D boundary; no new perf machinery. If node count is a concern later, a
  cap is out of scope here.
- **Legend:** the six toggle chips double as the legend (swatch shows each source color,
  including the graphify purple).

## Testing

- **`mergeGraphifyGraph` (unit):** given a graphify graph with symbol nodes whose
  `source_file` matches structural files, assert it persists **all** graphify nodes (not
  collapsed), emits `defined_in` bridges to the right structural nodes, keeps semantic
  edges, and still skips dangling-id edges. Extend the existing
  `graphifyRunner.test.ts`.
- **`filterBySources` (unit, new `source-filter.test.ts`):** enabling a subset returns
  only those sources' nodes + edges with both endpoints surviving; all-on returns the
  full graph; graphify nodes gated by the `graphify` source, structural by kind.
- **schema:** `'defined_in'` accepted by `codeEdgeKindSchema`; round-trips through
  `loadGraph`.
- **e2e (`app.spec.ts`, code-graph tab):** six source toggles present; toggling
  `Sessions` on/off changes the rendered node count; default has Sessions off.

## Out of scope (YAGNI)

- A generic `sources[]` per-node/edge model (Approach 3) — origin-based layering covers
  the six sources.
- Renderer-side `graph.json` overlay (Approach 2).
- Node-count caps / level-of-detail / graph windowing.
- Rendering graphify's god-node/wiki report inside the app (still via `graph.html` /
  wiki / `query.py`).
- Unifying structural and graphify communities into one clustering.
- New node kinds or a DB migration.

## Affected files

- `src/main/services/graph/graphifyRunner.ts` — `mergeGraphifyGraph` full-node + bridges
- `src/shared/graph.ts` — add `'defined_in'` to `codeEdgeKindSchema`
- `src/renderer/src/pages/knowledge/graph-colors.ts` — `GRAPHIFY_COLOR`, bridge style
- `src/renderer/src/pages/knowledge/source-filter.ts` — new pure filter (+ test)
- `src/renderer/src/pages/knowledge/CodeGraphTab.tsx` — six toggles, filter wiring
- `src/renderer/src/pages/knowledge/Galaxy3D.tsx` / 2D styling — origin-based color, bridge links
- persisted UI store — enabled-sources set
- `src/main/services/graph/graphifyRunner.test.ts`, `source-filter.test.ts`, `e2e/app.spec.ts` — tests
