# 3D "Galaxy" Graph View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a shared 2D/3D view-mode toggle to the Knowledge page force graphs, with a reusable `Galaxy3D` renderer that shows Louvain communities as colored spatial regions and flies the camera to a clicked node.

**Architecture:** A pure, generic `Galaxy3D` component wraps `react-force-graph-3d`. Communities become regions via a Fibonacci-sphere anchor helper feeding `forceX/forceY/forceZ` from `d3-force-3d`. The 3D renderer is code-split (`React.lazy`) so `three` only loads when 3D is opened. Both `GraphTab` (knowledge) and `CodeGraphTab` (code) gain a `viewMode` state, a shared `ViewToggle`, and pass their existing color/size/label accessors plus `community` as the cluster key.

**Tech Stack:** React 18, TypeScript, `react-force-graph-3d`, `three`, `d3-force-3d`, existing tRPC data (`trpc.knowledge.graph`, `trpc.graph.*`), Vitest (node env).

## Global Constraints

- No changes to the main process / data layer — reuse `trpc.knowledge.graph` and `trpc.graph.*` and the server-side Louvain `community` field verbatim.
- UI strings must be English (only generated digest content may be Russian).
- Package manager is **pnpm**. Lint is **biome** (`pnpm lint`), typecheck is `pnpm typecheck` (runs both `tsconfig.node.json` and `tsconfig.web.json`).
- Vitest tests live at `src/**/*.{test,spec}.ts`, environment `node`, `globals: true` — pure-logic tests only; there is **no** React component test harness, so React files are verified via `pnpm typecheck` + `pnpm lint` + a manual `pnpm dev` smoke check.
- Node sizing convention: `NODE_REL_SIZE = 5`, `nodeVal = 1 + log2(1 + max(0, inDegree))`.
- Color palette + helpers already exist in `src/renderer/src/pages/knowledge/graph-colors.ts` (`colorForCommunity`, `colorForProject`, `colorForKind`) — reuse, do not duplicate.
- Follow the existing `any`-cast idiom used for the ForceGraph ref and node accessors in `GraphTab.tsx` / `CodeGraphTab.tsx` (the library exports no node types).
- Commit after every task.

---

## File Structure

- `src/renderer/src/pages/knowledge/cluster-anchors.ts` — **new.** Pure helper distributing N cluster anchors over a sphere (Fibonacci). Unit-tested.
- `src/renderer/src/pages/knowledge/cluster-anchors.test.ts` — **new.** Unit tests for the helper.
- `src/renderer/src/types/d3-force-3d.d.ts` — **new.** Minimal ambient module typings for `d3-force-3d`.
- `src/renderer/src/pages/knowledge/Galaxy3D.tsx` — **new.** Reusable 3D renderer (default export) + a small error boundary. No data fetching.
- `src/renderer/src/pages/knowledge/ViewToggle.tsx` — **new.** `ViewMode` type + 2D/3D toggle button pair.
- `src/renderer/src/pages/knowledge/GraphTab.tsx` — **modify.** Add `viewMode` state, `ViewToggle`, lazy `Galaxy3D` branch.
- `src/renderer/src/pages/knowledge/CodeGraphTab.tsx` — **modify.** Same integration for the code graph.
- `src/renderer/src/pages/knowledge/knowledge.css` (or the existing knowledge stylesheet) — **modify.** Styles for `.kb-graph-toggle` active state.
- `package.json` — **modify.** Add `react-force-graph-3d`, `three`, `d3-force-3d`.

---

## Task 1: Cluster anchor helper (pure, TDD)

**Files:**
- Create: `src/renderer/src/pages/knowledge/cluster-anchors.ts`
- Test: `src/renderer/src/pages/knowledge/cluster-anchors.test.ts`

**Interfaces:**
- Produces: `clusterAnchors(keys: Array<string | number>, radius?: number): Map<string, { x: number; y: number; z: number }>` — deterministic; deduplicates keys (stringified); N=0 → empty map; N=1 → single anchor at origin `{0,0,0}`; N≥2 → keys spread evenly on a sphere of the given `radius` (default 300).

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/pages/knowledge/cluster-anchors.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { clusterAnchors } from './cluster-anchors'

describe('clusterAnchors', () => {
  it('returns an empty map for no keys', () => {
    expect(clusterAnchors([]).size).toBe(0)
  })

  it('places a single cluster at the origin', () => {
    const m = clusterAnchors([7])
    expect(m.size).toBe(1)
    expect(m.get('7')).toEqual({ x: 0, y: 0, z: 0 })
  })

  it('deduplicates keys and covers every distinct key', () => {
    const m = clusterAnchors([1, 1, 2, '2', 3])
    expect([...m.keys()].sort()).toEqual(['1', '2', '3'])
  })

  it('spreads multiple clusters onto the sphere of the given radius', () => {
    const radius = 300
    const m = clusterAnchors([0, 1, 2, 3, 4], radius)
    for (const p of m.values()) {
      const mag = Math.hypot(p.x, p.y, p.z)
      expect(mag).toBeGreaterThan(radius * 0.5)
      expect(mag).toBeLessThanOrEqual(radius + 1e-6)
    }
  })

  it('is deterministic for the same input', () => {
    expect(clusterAnchors([1, 2, 3, 4])).toEqual(clusterAnchors([1, 2, 3, 4]))
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/renderer/src/pages/knowledge/cluster-anchors.test.ts`
Expected: FAIL — "Failed to resolve import './cluster-anchors'" / `clusterAnchors is not a function`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/renderer/src/pages/knowledge/cluster-anchors.ts`:

```ts
export interface Anchor {
  x: number
  y: number
  z: number
}

// Distribute one anchor per distinct cluster key evenly over a sphere using the
// Fibonacci-sphere method. Deterministic (no randomness), so layouts are stable
// across renders. Colored nodes pulled toward a shared anchor read as a "star
// cluster" region. 0 keys → empty; 1 key → centered at the origin.
export function clusterAnchors(
  keys: Array<string | number>,
  radius = 300,
): Map<string, Anchor> {
  const uniq = [...new Set(keys.map(String))]
  const out = new Map<string, Anchor>()
  const n = uniq.length
  if (n === 0) return out
  if (n === 1) {
    out.set(uniq[0], { x: 0, y: 0, z: 0 })
    return out
  }
  const golden = Math.PI * (3 - Math.sqrt(5)) // golden-angle increment
  uniq.forEach((key, i) => {
    const y = 1 - (i / (n - 1)) * 2 // 1 → -1
    const r = Math.sqrt(Math.max(0, 1 - y * y))
    const theta = golden * i
    out.set(key, {
      x: Math.cos(theta) * r * radius,
      y: y * radius,
      z: Math.sin(theta) * r * radius,
    })
  })
  return out
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/renderer/src/pages/knowledge/cluster-anchors.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Lint + commit**

```bash
pnpm lint
git add src/renderer/src/pages/knowledge/cluster-anchors.ts src/renderer/src/pages/knowledge/cluster-anchors.test.ts
git commit -m "feat(graph): cluster-anchors fibonacci-sphere helper for 3D galaxy layout"
```

---

## Task 2: Add 3D dependencies + ambient types

**Files:**
- Modify: `package.json`
- Create: `src/renderer/src/types/d3-force-3d.d.ts`

**Interfaces:**
- Produces: importable modules `react-force-graph-3d` (default export `ForceGraph3D`), `three`, and `d3-force-3d` exporting `forceX`, `forceY`, `forceZ`, `forceCollide`.

- [ ] **Step 1: Install the dependencies**

Run:
```bash
pnpm add react-force-graph-3d three d3-force-3d
```
Expected: pnpm adds all three to `dependencies` in `package.json`. (`three` ships its own type declarations; `react-force-graph-3d` bundles its own. `d3-force-3d` has no bundled types — added below.)

- [ ] **Step 2: Add ambient typings for d3-force-3d**

Create `src/renderer/src/types/d3-force-3d.d.ts`:

```ts
// Minimal typings for the subset of d3-force-3d we use. The library mirrors
// d3-force with a third (z) dimension. Accessors are a constant or a per-node
// function. No official @types package exists.
declare module 'd3-force-3d' {
  type Accessor = number | ((node: any, i: number, nodes: any[]) => number)

  interface PositionForce {
    (alpha: number): void
    strength(s: Accessor): this
    x(x: Accessor): this
    y(y: Accessor): this
    z(z: Accessor): this
  }

  interface CollideForce {
    (alpha: number): void
    radius(r: Accessor): this
    strength(s: number): this
    iterations(n: number): this
  }

  export function forceX(x?: Accessor): PositionForce
  export function forceY(y?: Accessor): PositionForce
  export function forceZ(z?: Accessor): PositionForce
  export function forceCollide(radius?: Accessor): CollideForce
}
```

- [ ] **Step 3: Verify the type declaration is picked up**

Confirm `tsconfig.web.json` includes `src/renderer` (it compiles the renderer). If it uses an explicit `include`/`typeRoots` that excludes ad-hoc `.d.ts` files, ensure `src/renderer/src/types` is covered (it is, since `src/renderer/src/**/*` is the renderer source root). No code change expected — just verify.

Run: `pnpm typecheck`
Expected: PASS (no errors; the new deps are not yet imported anywhere).

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml src/renderer/src/types/d3-force-3d.d.ts
git commit -m "chore(graph): add react-force-graph-3d + three + d3-force-3d deps and types"
```

---

## Task 3: ViewToggle component + ViewMode type

**Files:**
- Create: `src/renderer/src/pages/knowledge/ViewToggle.tsx`
- Modify: knowledge stylesheet (the CSS file that defines `.kb-graph-controls` / `.btn`)

**Interfaces:**
- Produces:
  - `export type ViewMode = '2d' | '3d'`
  - `export function ViewToggle(props: { value: ViewMode; onChange: (v: ViewMode) => void }): JSX.Element`

- [ ] **Step 1: Create the component**

Create `src/renderer/src/pages/knowledge/ViewToggle.tsx`:

```tsx
export type ViewMode = '2d' | '3d'

// Reusable 2D/3D switch for any force graph on the Knowledge page. Styled like
// the existing control buttons; the active mode gets the `on` class.
export function ViewToggle({
  value,
  onChange,
}: {
  value: ViewMode
  onChange: (v: ViewMode) => void
}) {
  return (
    <div className="kb-graph-toggle">
      <button
        type="button"
        className={`btn ${value === '2d' ? 'on' : ''}`}
        onClick={() => onChange('2d')}
      >
        2D
      </button>
      <button
        type="button"
        className={`btn ${value === '3d' ? 'on' : ''}`}
        onClick={() => onChange('3d')}
      >
        3D
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Add the active-state style**

Find the stylesheet that defines `.kb-graph-controls` (search `rg "kb-graph-controls" src/renderer`). Append a rule for the toggle. Use the existing accent variable if one exists in that file; otherwise use the amber palette color `#e6b450`. Example:

```css
.kb-graph-toggle {
  display: inline-flex;
  gap: 4px;
}
.kb-graph-toggle .btn.on {
  border-color: #e6b450;
  color: #e6b450;
}
```

(If the file already defines a `.btn.on` or a `.tabs .on` style, mirror its color instead of hardcoding, to stay consistent.)

- [ ] **Step 3: Verify typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS. (Component is not yet used; unused-export is fine.)

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/pages/knowledge/ViewToggle.tsx
git add src/renderer/src/pages/knowledge/*.css
git commit -m "feat(graph): reusable 2D/3D ViewToggle control"
```

---

## Task 4: Galaxy3D renderer

**Files:**
- Create: `src/renderer/src/pages/knowledge/Galaxy3D.tsx`

**Interfaces:**
- Consumes: `clusterAnchors` (Task 1); `forceX/forceY/forceZ/forceCollide` from `d3-force-3d` (Task 2).
- Produces (default export):
  ```ts
  interface GalaxyNode { id: string; x?: number; y?: number; z?: number }
  interface Galaxy3DProps {
    graphData: {
      nodes: GalaxyNode[]
      links: Array<{ source: string | GalaxyNode; target: string | GalaxyNode }>
    }
    width: number
    height: number
    nodeColor: (n: any) => string
    nodeVal: (n: any) => number
    nodeLabel: (n: any) => string
    clusterKey: (n: any) => string | number
    linkColor?: (l: any) => string
    onNodeClick?: (n: any) => void
    onNodeHover?: (n: any | null) => void
  }
  export default function Galaxy3D(props: Galaxy3DProps): JSX.Element
  ```

- [ ] **Step 1: Create the component**

Create `src/renderer/src/pages/knowledge/Galaxy3D.tsx`:

```tsx
import { forceCollide, forceX, forceY, forceZ } from 'd3-force-3d'
import { useEffect, useRef } from 'react'
import ForceGraph3D from 'react-force-graph-3d'
import { clusterAnchors } from './cluster-anchors'

interface GalaxyNode {
  id: string
  x?: number
  y?: number
  z?: number
}

interface Galaxy3DProps {
  graphData: {
    nodes: GalaxyNode[]
    links: Array<{ source: string | GalaxyNode; target: string | GalaxyNode }>
  }
  width: number
  height: number
  nodeColor: (n: any) => string
  nodeVal: (n: any) => number
  nodeLabel: (n: any) => string
  clusterKey: (n: any) => string | number
  linkColor?: (l: any) => string
  onNodeClick?: (n: any) => void
  onNodeHover?: (n: any | null) => void
}

const NODE_REL_SIZE = 5
const radiusOf = (nodeVal: number): number => Math.sqrt(Math.max(1, nodeVal)) * NODE_REL_SIZE

export default function Galaxy3D({
  graphData,
  width,
  height,
  nodeColor,
  nodeVal,
  nodeLabel,
  clusterKey,
  linkColor,
  onNodeClick,
  onNodeHover,
}: Galaxy3DProps) {
  // react-force-graph-3d exposes no ref type.
  // biome-ignore lint/suspicious/noExplicitAny: ForceGraph ref has no exported type
  const fgRef = useRef<any>(null)

  // Pull each node toward its community's anchor point on a sphere so clusters
  // form distinct spatial regions ("galaxies"). Reheated whenever the visible
  // set changes. Anchors are recomputed from the current nodes' cluster keys.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reheat on data change only
  useEffect(() => {
    const fg = fgRef.current
    if (!fg) return
    const anchors = clusterAnchors(graphData.nodes.map((n) => clusterKey(n)))
    const anchorOf = (n: any) => anchors.get(String(clusterKey(n)))
    fg.d3Force('x', forceX((n: any) => anchorOf(n)?.x ?? 0).strength(0.12))
    fg.d3Force('y', forceY((n: any) => anchorOf(n)?.y ?? 0).strength(0.12))
    fg.d3Force('z', forceZ((n: any) => anchorOf(n)?.z ?? 0).strength(0.12))
    fg.d3Force('charge')?.strength(-120)
    fg.d3Force('collide', forceCollide((n: any) => radiusOf(nodeVal(n)) + 2))
    fg.d3ReheatSimulation?.()
  }, [graphData])

  const handleClick = (node: any): void => {
    const fg = fgRef.current
    if (fg && node.x != null && node.y != null) {
      const dist = 120
      const hyp = Math.hypot(node.x, node.y, node.z ?? 0) || 1
      const ratio = 1 + dist / hyp
      fg.cameraPosition(
        { x: node.x * ratio, y: node.y * ratio, z: (node.z ?? 0) * ratio },
        node,
        800,
      )
    }
    onNodeClick?.(node)
  }

  return (
    <ForceGraph3D
      ref={fgRef}
      width={width}
      height={height}
      graphData={graphData}
      backgroundColor="#05060a"
      nodeId="id"
      nodeRelSize={NODE_REL_SIZE}
      nodeVal={(n: any) => nodeVal(n)}
      nodeColor={(n: any) => nodeColor(n)}
      nodeLabel={(n: any) => nodeLabel(n)}
      nodeOpacity={0.95}
      linkColor={linkColor ?? (() => 'rgba(120,120,120,0.25)')}
      linkOpacity={0.4}
      enableNodeDrag={false}
      warmupTicks={20}
      cooldownTicks={120}
      onNodeClick={handleClick}
      onNodeHover={(n: any) => onNodeHover?.(n ?? null)}
    />
  )
}
```

- [ ] **Step 2: Verify typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS. If `three`'s bundled types are missing (typecheck complains about `react-force-graph-3d`'s transitive `three` import), install `@types/three` (`pnpm add -D @types/three`) and re-run; commit the lockfile change with this task.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/pages/knowledge/Galaxy3D.tsx package.json pnpm-lock.yaml
git commit -m "feat(graph): Galaxy3D renderer — community-anchored 3D layout + camera fly-to"
```

---

## Task 5: Integrate the toggle into the knowledge GraphTab

**Files:**
- Modify: `src/renderer/src/pages/knowledge/GraphTab.tsx`

**Interfaces:**
- Consumes: `ViewToggle`, `ViewMode` (Task 3); default `Galaxy3D` (Task 4).

- [ ] **Step 1: Add imports and lazy-load Galaxy3D**

At the top of `GraphTab.tsx`, add to the imports (keep import order biome-clean):

```tsx
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ViewToggle, type ViewMode } from './ViewToggle'
```

(Replace the existing `import { useCallback, useEffect, useMemo, useRef, useState } from 'react'` line with the one above.)

Then, below the existing top-level `const idOf = ...` line (module scope, outside the component), add:

```tsx
const Galaxy3D = lazy(() => import('./Galaxy3D'))
```

- [ ] **Step 2: Add viewMode state**

Inside `GraphTab`, next to the other `useState` hooks (after `const [hovered, setHovered] = useState<string | null>(null)`), add:

```tsx
const [viewMode, setViewMode] = useState<ViewMode>('2d')
```

- [ ] **Step 3: Make search selection work in both modes**

Replace the `runSearch` function body so selection still happens when the 2D ref is absent (3D mode):

```tsx
const runSearch = (): void => {
  const q = search.trim().toLowerCase()
  if (!q) return
  const hit = data.nodes.find((n) => n.label.toLowerCase().includes(q))
  if (!hit) return
  if (fgRef.current && hit.x != null && hit.y != null) {
    fgRef.current.centerAt(hit.x, hit.y, 800)
    fgRef.current.zoom(4, 800)
  }
  setSelected(hit)
}
```

- [ ] **Step 4: Render the toggle in the controls**

In the `.kb-graph-controls` block, immediately after the `color: {colorBy}` `<button>...</button>`, add:

```tsx
<ViewToggle value={viewMode} onChange={setViewMode} />
```

- [ ] **Step 5: Branch the renderer**

Replace the `<ForceGraph2D ... />` element inside `<div className="kb-graph" ref={setContainer}>` with a conditional. The 2D branch keeps the exact existing props:

```tsx
{viewMode === '2d' ? (
  <ForceGraph2D
    ref={fgRef}
    width={size.w}
    height={size.h}
    graphData={data}
    backgroundColor="transparent"
    nodeId="id"
    nodeRelSize={NODE_REL_SIZE}
    nodeLabel={(n) => (n as FgNode).label}
    nodeVal={(n) => nodeValOf(n as FgNode)}
    nodeColor={(n) => nodeColor(n as FgNode)}
    onNodeClick={(n) => setSelected(n as FgNode)}
    onNodeHover={(n) => setHovered((n as FgNode | null)?.id ?? null)}
    linkColor={() => 'rgba(120,120,120,0.25)'}
    linkWidth={(l) => ((l as FgLink).type === 'source' ? 0.5 : 1)}
    onEngineStop={() => fgRef.current?.zoomToFit(400, 40)}
  />
) : (
  <Suspense fallback={<div className="kb-graph-empty">{'// loading 3D…'}</div>}>
    <Galaxy3D
      graphData={data}
      width={size.w}
      height={size.h}
      nodeColor={(n) => nodeColor(n as FgNode)}
      nodeVal={(n) => nodeValOf(n as FgNode)}
      nodeLabel={(n) => (n as FgNode).label}
      clusterKey={(n) => (n as FgNode).community}
      onNodeClick={(n) => setSelected(n as FgNode)}
      onNodeHover={(n) => setHovered((n as FgNode | null)?.id ?? null)}
    />
  </Suspense>
)}
```

- [ ] **Step 6: Verify typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 7: Manual smoke check**

Run: `pnpm dev`
In the app: open **Knowledge → ./graph**. Verify:
1. The `2D / 3D` toggle appears in the controls; 2D still renders as before.
2. Click **3D** → nodes render in a 3D scene; communities appear as separated colored clusters; you can orbit/zoom.
3. Click a node → the article side panel opens **and** the camera flies toward the node.
4. Switch back to **2D** → the 2D disc layout returns, panel still works.
5. `colorBy` and the type-hide checkboxes still affect the 3D view.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/pages/knowledge/GraphTab.tsx
git commit -m "feat(graph): 2D/3D toggle + galaxy view in knowledge GraphTab"
```

---

## Task 6: Integrate the toggle into CodeGraphTab

**Files:**
- Modify: `src/renderer/src/pages/knowledge/CodeGraphTab.tsx`

**Interfaces:**
- Consumes: `ViewToggle`, `ViewMode` (Task 3); default `Galaxy3D` (Task 4). Uses `CodeGraphNode.community` (`number | null`) as the cluster key.

- [ ] **Step 1: Add imports and lazy-load Galaxy3D**

Replace the React import line with one that adds `Suspense` and `lazy`, and add the `ViewToggle` import:

```tsx
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ViewToggle, type ViewMode } from './ViewToggle'
```

Add at module scope (after the `KIND_LABELS` const):

```tsx
const Galaxy3D = lazy(() => import('./Galaxy3D'))
```

- [ ] **Step 2: Add viewMode state**

Inside `CodeGraphTab`, next to the other `useState` hooks (after `const [status, setStatus] = useState<string>('')`), add:

```tsx
const [viewMode, setViewMode] = useState<ViewMode>('2d')
```

- [ ] **Step 3: Render the toggle in the controls**

In the `.kb-graph-controls` block, after the `show inferred` `<label>...</label>`, add:

```tsx
<ViewToggle value={viewMode} onChange={setViewMode} />
```

- [ ] **Step 4: Branch the renderer**

Replace the `<ForceGraph2D ... />` element (the one inside the `data.nodes.length === 0 ? ... : (...)` ternary) with a nested conditional. Keep the 2D branch's existing props exactly; add the 3D branch:

```tsx
) : viewMode === '2d' ? (
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
    linkColor={(l) =>
      (l as FgLink).inferred ? 'rgba(210,166,255,0.4)' : 'rgba(120,120,120,0.3)'
    }
    linkLineDash={(l) => ((l as FgLink).inferred ? [3, 3] : null)}
    onEngineStop={() => fgRef.current?.zoomToFit(400, 40)}
  />
) : (
  <Suspense fallback={<div className="kb-graph-empty">{'// loading 3D…'}</div>}>
    <Galaxy3D
      graphData={data}
      width={size.w}
      height={size.h}
      nodeColor={(n) => colorForKind((n as FgNode).kind)}
      nodeVal={() => 1}
      nodeLabel={(n) => `${(n as FgNode).label} [${(n as FgNode).kind}]`}
      clusterKey={(n) => (n as FgNode).community ?? -1}
      linkColor={(l) =>
        (l as FgLink).inferred ? 'rgba(210,166,255,0.4)' : 'rgba(120,120,120,0.3)'
      }
      onNodeClick={(n) => setSelected(n as FgNode)}
    />
  </Suspense>
)}
```

Note: the existing outer ternary is `{data.nodes.length === 0 ? (<empty/>) : (<ForceGraph2D/>)}`. After this edit it becomes `{data.nodes.length === 0 ? (<empty/>) : viewMode === '2d' ? (<ForceGraph2D/>) : (<Suspense>…</Suspense>)}`.

- [ ] **Step 5: Verify typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 6: Manual smoke check**

Run: `pnpm dev`
Open **Knowledge → ./code-graph**, pick a built project. Verify: the `2D / 3D` toggle appears; 3D renders code nodes colored by kind, grouped by community region; clicking a node opens the neighbors detail panel and flies the camera; `show inferred` still toggles inferred links in 3D; switching projects/unified still works.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/pages/knowledge/CodeGraphTab.tsx
git commit -m "feat(graph): 2D/3D toggle + galaxy view in CodeGraphTab"
```

---

## Task 7: Final verification

**Files:** none (verification only).

- [ ] **Step 1: Full test + lint + typecheck**

Run: `pnpm test && pnpm lint && pnpm typecheck`
Expected: all PASS.

- [ ] **Step 2: Production build (confirms code-split + three bundles cleanly)**

Run: `pnpm build`
Expected: build succeeds; `three` / `react-force-graph-3d` land in a **separate lazy chunk** (dynamic `import('./Galaxy3D')`), not the main renderer entry.

- [ ] **Step 3: Commit any incidental fixes**

If Steps 1–2 required fixes, commit them:

```bash
git add -A
git commit -m "fix(graph): resolve build/lint issues for 3D galaxy view"
```

---

## Self-Review Notes

- **Spec coverage:** reuse existing data/Louvain/colors (Tasks 5–6 pass `community` + existing color fns, no data-layer change) ✓; 3D via react-force-graph-3d/three (Tasks 2, 4) ✓; clusters as colored regions (Task 1 anchors + Task 4 forces) ✓; click = panel + camera fly (Task 4 `handleClick`, Tasks 5–6 `onNodeClick`) ✓; shared toggle on both graphs (Task 3 + Tasks 5–6) ✓; performance — default spheres, particles off, drag off, capped cooldown, code-split (Task 4, Task 7 build check) ✓.
- **Deferred (non-goals):** translucent nebula volumes — intentionally omitted; regions are color + spatial only.
- **Type consistency:** `ViewMode`/`ViewToggle` (Task 3) used verbatim in Tasks 5–6; `Galaxy3D` default export + prop names (`clusterKey`, `nodeVal`, `nodeColor`, `nodeLabel`, `linkColor`, `onNodeClick`, `onNodeHover`) defined in Task 4 and matched in Tasks 5–6; `clusterAnchors` signature (Task 1) matched in Task 4; `d3-force-3d` exports (Task 2 ambient types) matched in Task 4.
- **Known limitation:** node search fly-to remains 2D-only (Task 5 Step 3 keeps selection working in 3D but does not move the 3D camera) — acceptable for v1, not a spec requirement.
