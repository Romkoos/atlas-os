# 3D "Galaxy" View for Knowledge & Code Graphs — Design

**Date:** 2026-07-01
**Status:** Approved (brainstorming complete, pending implementation plan)

## Summary

Add an alternate 3D "galaxy" rendering mode to the force-directed graphs on the
Knowledge page. Clusters (Louvain communities) become colored spatial regions,
articles become nodes you can fly through, and clicking a node opens the article
and flies the camera to it. Delivered as a **shared 2D/3D toggle** wired into
**both** the knowledge `./graph` tab and the `./code-graph` tab, reusing the
existing graph data, Louvain `community` field, and color palette unchanged.

## Goals

- Reuse existing graph data (`trpc.knowledge.graph`), Louvain communities, and
  `graph-colors.ts` with **no changes to the main process / data layer**.
- Render nodes in 3D via `react-force-graph-3d` / three.js.
- Cluster communities into visible colored regions ("star clusters").
- Click-to-open: open the existing article side panel **and** fly the camera to
  the node.
- Provide a shared 2D/3D view-mode toggle usable by any force graph on the page;
  wire it into both `GraphTab` (knowledge) and `CodeGraphTab` (code) now.
- Stay performant for hundreds of nodes.

## Non-Goals (YAGNI)

- No translucent nebula/sphere volumes around clusters — regions are conveyed by
  node color + spatial grouping only. (Explicitly deferred.)
- No changes to how communities are computed (stays server-side, synchronous).
- No new route/page navigation — click behavior mirrors the existing in-tab side
  panel.
- No VR/AR, no post-processing effects, no custom shaders.

## Existing Context (as-is)

- **Knowledge graph tab:** `src/renderer/src/pages/knowledge/GraphTab.tsx` —
  renders `ForceGraph2D` from `react-force-graph-2d`; data from
  `trpc.knowledge.graph.useQuery()`. Local state: `colorBy`
  (`'community' | 'project'`), `hidden` (Set of node types), `focusProject`,
  `search`, `selected`, `hovered`. Custom d3 forces (`forceCollide`, charge -140,
  `forceX(0)/forceY(0)`) produce a round disc layout. Click sets `selected` and
  opens an `<aside className="kb-graph-panel">` with `MarkdownView`; wikilinks
  re-select within the graph.
- **Code graph tab:** `src/renderer/src/pages/knowledge/CodeGraphTab.tsx` —
  separate data source `trpc.graph.*`, `view` state (`'isolated' | 'unified'`),
  `showInferred`, own detail panel.
- **Data shape** (`src/shared/knowledge.ts`): `GraphNode = { id, label, type,
  project, relPath, inDegree, tags, updated, community }`; `GraphEdge = { source,
  target, type }`; graph = `{ nodes, edges }`. Client renames `edges → links` for
  `graphData`. No `color`/`size` on the wire — derived client-side.
- **Colors:** `src/renderer/src/pages/knowledge/graph-colors.ts` — `PALETTE`,
  `colorForCommunity()`, `colorForProject()`; ghost nodes fixed grey; hover-dim
  appends `33` alpha.
- **Tab wiring:** `src/renderer/src/pages/Knowledge.tsx` — `TABS` array, active
  tab persisted in Zustand `useUiStore` (`tabsBySection.knowledge`).
- **Node sizing:** `NODE_REL_SIZE = 5`, `nodeVal = 1 + log2(1 + inDegree)`.
- **Deps present:** `react-force-graph-2d`, `d3-force`, `graphology`,
  `graphology-communities-louvain`. **Absent:** `react-force-graph-3d`, `three`.

## Architecture

### New dependencies

- `react-force-graph-3d` (renderer) and `three` (peer). `three` is heavy, so the
  3D renderer is **code-split**: `Galaxy3D` is loaded via `React.lazy` /
  dynamic `import()` and only pulled in when the user switches to 3D. The 2D
  bundle and initial page load are unaffected.

### Components

1. **`Galaxy3D.tsx`** (`src/renderer/src/pages/knowledge/`) — pure, reusable 3D
   renderer. **No data fetching.** Generic props so it fits both graphs:
   - `graphData: { nodes, links }`
   - `nodeId?: string` (default `"id"`)
   - `nodeColor(node) => string`
   - `nodeVal(node) => number`
   - `nodeLabel(node) => string`
   - `clusterKey(node) => string | number` — the grouping used to form regions.
     Knowledge passes `community`; code-graph passes its grouping (module/project
     or `view`-derived group). If `clusterKey` is omitted, all nodes share one
     cluster (plain centered layout, no region separation).
   - `onNodeClick(node)`, `onNodeHover(node | null)`
   - optional `enableDrag?: boolean` (default false)

   Internals:
   - Renders `ForceGraph3D` with default sphere nodes (no `nodeThreeObject`),
     `nodeRelSize` matching the 2D `NODE_REL_SIZE`, directional particles off.
   - **Clustering force** via `d3-force-3d` (bundled with `react-force-graph-3d`):
     assign each distinct `clusterKey` an anchor point spread over a sphere
     (see helper below); apply `forceX/forceY/forceZ` pulling each node toward
     its cluster anchor, plus `charge` and `forceCollide`. Colored nodes in
     shared anchors form visible "star cluster" regions.
   - **Camera fly-to:** exposes/handles node click by calling
     `fgRef.cameraPosition(offsetPos, node, ~800ms)` to smoothly approach the
     clicked node, then invokes `onNodeClick` so the parent opens its panel.
   - Performance knobs: limited `cooldownTicks`, `warmupTicks` for fast settle,
     drag off by default.

2. **`ViewToggle.tsx`** (`src/renderer/src/pages/knowledge/`) — small reusable
   2D/3D switch (two buttons, styled like the existing `color: {colorBy}`
   button). Props: `value: '2d' | '3d'`, `onChange`.

3. **`cluster-anchors.ts`** (helper, `src/renderer/src/pages/knowledge/`) — pure
   function `clusterAnchors(keys: (string|number)[], radius): Map<key, {x,y,z}>`
   that distributes N cluster anchors roughly evenly over a sphere
   (deterministic, e.g. Fibonacci sphere). Unit-tested.

### Changes to existing tabs

- **`GraphTab.tsx`**: add `viewMode: '2d' | '3d'` state; render `<ViewToggle>` in
  the control row. When `'3d'`, render `<Suspense><Galaxy3D>` passing the
  already-computed color/val/label accessors and `clusterKey={n => n.community}`,
  `onNodeClick` = existing `setSelected` handler. When `'2d'`, keep current
  `ForceGraph2D`. Side panel, filters (colorBy, hidden types, search) stay shared.
- **`CodeGraphTab.tsx`**: same pattern — add `viewMode`, `<ViewToggle>`, render
  `<Galaxy3D>` with its own color/val/label accessors and its grouping as
  `clusterKey`; `onNodeClick` = its existing detail-open handler.

## Data Flow

```
trpc.knowledge.graph  ──(unchanged)──►  GraphTab
                                          │  computes nodeColor/val/label (existing)
                                          ├─ viewMode '2d' ─► ForceGraph2D (existing)
                                          └─ viewMode '3d' ─► Galaxy3D
                                                                │ clusterAnchors(communities)
                                                                │ d3-force-3d forceX/Y/Z + charge + collide
                                                                │ onNodeClick → cameraPosition() + setSelected
                                                                ▼
                                                            side panel (existing kb-graph-panel)
```

Code graph mirrors this with `trpc.graph.*` and its own accessors.

## Error / Edge Handling

- **Empty / single-community graph:** `clusterAnchors` with 0 or 1 key → single
  centered anchor; layout degrades to a plain sphere, no crash.
- **3D bundle fails to load** (lazy import rejects): `Suspense` + error boundary
  falls back to the 2D view with a small notice; toggle stays usable.
- **Ghost / missing nodes:** colored via existing grey rule; unaffected.
- **Resize:** reuse the existing container ResizeObserver pattern to feed
  `width/height` to `ForceGraph3D`.

## Testing

- **Unit** (`cluster-anchors.ts`): determinism (same input → same anchors),
  even-ish distribution, correct count, N=0/1 edge cases, key→anchor map is
  stable and covers all distinct keys.
- **Component/smoke:** `ViewToggle` fires `onChange`; `Galaxy3D` mounts with a
  small fixture without throwing (mock/guard WebGL if needed in the test env).
- **e2e (existing harness):** toggling to 3D on `./graph` renders the 3D canvas;
  clicking a node opens the side panel. Brand/marker strings consistent with the
  existing Knowledge e2e conventions.

## Performance Notes

- Default three.js sphere nodes (no per-node custom objects) — cheap for
  hundreds of nodes.
- Directional particles off; drag off by default; capped `cooldownTicks`.
- 3D renderer code-split so `three` never loads unless 3D is opened.
- Clustering force uses simple per-node anchor targets — O(nodes) per tick, no
  pairwise cluster computation beyond the built-in charge/collide.

## Open Implementation Details (resolved during planning)

- Exact `d3-force-3d` accessor wiring (`fgRef.d3Force('x', forceX().x(...))` vs
  passing configured forces) — pick during implementation against the installed
  `react-force-graph-3d` version.
- CodeGraphTab's precise `clusterKey` source (module vs project vs `view`) —
  choose the grouping that yields meaningful regions for that graph.
