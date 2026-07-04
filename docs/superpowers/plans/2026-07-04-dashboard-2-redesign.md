# Dashboard 2.0 Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the Dashboard: remove the prompt-runner, Recent Activity, and the System half of Signals; compact Processes into a chip strip; add a decorative 3D galaxy hero, a kanban NEXT UP panel, a 4-up widget row, and page-level reveal FX.

**Architecture:** All new UI lives in `src/renderer/src/components/dashboard/`. Reusable 3D scene builders are extracted from `Galaxy3D.tsx` into `galaxy-fx.ts` (behavior-preserving) and reused by a slim non-interactive `DecorGalaxy3D`. A new `graphBuildRun` zustand store + always-mounted host lets BUILD MAP survive navigation (the `graph.build` subscription cancels the run on unsubscribe — verified in `graph.ts:133-140`). Pure logic (kanban grouping, heatmap bucketing) is TDD'd; components are typecheck-verified.

**Tech Stack:** React 19, zustand, tRPC v11 + electron-trpc, react-force-graph-3d + three, vitest, biome, plain CSS in `src/renderer/src/index.css`.

**Spec:** `docs/superpowers/specs/2026-07-04-dashboard-2-redesign-design.md`

## Global Constraints

- All UI strings English.
- No behavior change to the Knowledge page `Galaxy3D` (refactor must be extraction-only).
- e2e tests assert `getByText('processes', { exact: true })` on the Dashboard (`e2e/app.spec.ts:209-217`, `e2e/graph-crash.spec.ts:25`) — the new Processes strip must keep the exact panel title text `processes`.
- Keep these CSS classes (used outside removed widgets): `.kv`, `.line-clamp-2`, `.caret`, `.label-block`, `.grid-2`, `.fx-radar`, `.fx-marquee`, `.fx-gauge`, `.kpis.bento`.
- All animations must respect `prefers-reduced-motion: reduce`.
- Verification commands: `pnpm typecheck`, `pnpm lint`, `pnpm test` (vitest), `pnpm e2e`.
- Commit after every task: `git add <files> && git commit -m "<msg>" --no-verify` with trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- The Mako `git-commit-message` skill does NOT apply in this repo — use plain conventional-commit messages.

---

### Task 1: Extract shared dashboard formatters (`dash-utils`)

**Files:**
- Create: `src/renderer/src/components/dashboard/dash-utils.tsx`
- Modify: `src/renderer/src/pages/Dashboard.tsx` (delete the local copies at lines 15-99, import instead)

**Interfaces:**
- Produces: `num(n: number): string`, `pct(v: number | null | undefined, digits?: number): string`, `compact(n: number): string`, `timeAgo(value: Date | string | null | undefined): string`, `Note({ children }: { children: ReactNode })`, `DrillLink({ to, label }: { to: Section; label: string })` — all named exports.

- [ ] **Step 1: Create `dash-utils.tsx`**

Move the following verbatim from `Dashboard.tsx` (they are currently at lines 15-99) into the new file, with exports:

```tsx
import { type Section, useUiStore } from '@renderer/store/ui'
import type { ReactNode } from 'react'

const fmtInt = new Intl.NumberFormat('en-US')
export const num = (n: number): string => fmtInt.format(n)
export const pct = (v: number | null | undefined, digits = 0): string =>
  v == null ? '—' : `${v.toFixed(digits)}%`

// Compact token count: 12_345 → "12.3k", 1_200_000 → "1.2M".
export function compact(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

// Date/ISO timestamp → "2h ago". Renderer-side relative time (Date.now is fine
// here — the ban only applies to workflow scripts). Dates cross IPC as either
// real Date objects or strings, so accept both.
export function timeAgo(value: Date | string | number | null | undefined): string {
  if (!value) return 'never'
  const then = new Date(value).getTime()
  if (Number.isNaN(then)) return '—'
  const min = Math.round((Date.now() - then) / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  return `${Math.round(hr / 24)}d ago`
}

// Mono "// message" line for per-widget empty/loading states.
export function Note({ children }: { children: ReactNode }) {
  return (
    <div
      style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--fg-4)', padding: '8px 0' }}
    >
      <span style={{ color: 'var(--amber-dim)' }}>{'// '}</span>
      {children}
    </div>
  )
}

// "→ section" affordance in a panel head; switches the active page.
export function DrillLink({ to, label }: { to: Section; label: string }) {
  const go = useUiStore((s) => s.setSection)
  return (
    <button
      type="button"
      className="meta"
      onClick={() => go(to)}
      style={{
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        fontFamily: 'var(--mono)',
        padding: 0,
      }}
    >
      {label} →
    </button>
  )
}
```

Note the one deliberate change: `timeAgo` also accepts `number` (epoch ms) — the roadmap and benchmark widgets pass `updatedAt`/`createdAt` numbers.

- [ ] **Step 2: Update `Dashboard.tsx`**

Delete the local `fmtInt`, `num`, `pct`, `compact`, `timeAgo`, `Note`, `DrillLink` definitions (keep `fmtDuration` and `digestSnippet` — they stay local). Add:

```tsx
import { compact, DrillLink, Note, num, pct, timeAgo } from '@renderer/components/dashboard/dash-utils'
```

Remove the now-unused `ReactNode` import and the `Section` import if only `DrillLink` used it (the `useUiStore`/`Section` imports are still needed by `RecentActivity`/`SignalCard` until Task 9 — check with typecheck).

- [ ] **Step 3: Verify**

Run: `pnpm typecheck && pnpm test`
Expected: PASS (pure move, no behavior change).

- [ ] **Step 4: Commit** — `refactor(dashboard): extract shared formatters into dash-utils`

---

### Task 2: Extract galaxy scene builders into `galaxy-fx.ts`

**Files:**
- Create: `src/renderer/src/pages/knowledge/galaxy-fx.ts`
- Modify: `src/renderer/src/pages/knowledge/Galaxy3D.tsx`

**Interfaces:**
- Produces (named exports of `galaxy-fx.ts`):
  - `makeGlowTexture(): THREE.Texture`
  - `makeStarLayer(count: number, rMin: number, rMax: number, size: number, opacity: number, color: number): THREE.Points`
  - `makeNebula(tex: THREE.Texture): THREE.Group`
  - `EDGE_GLOW: string`
  - `interface CometSystem { points: THREE.Points; tick: (nowSec: number) => void; dispose: () => void }`
  - `createCometSystem(nodes, links): CometSystem | null` where `nodes: Array<{ id: string; x?: number; y?: number; z?: number }>`, `links: Array<{ source: string | { id: string }; target: string | { id: string } }>`

- [ ] **Step 1: Create `galaxy-fx.ts`**

Move `makeGlowTexture` (Galaxy3D.tsx:71-86), `makeStarLayer` (:91-121), `makeNebula` (:126-153), the comet constants (`COMET_CYCLE_SEC`, `COMET_ACTIVE_FRAC`, `COMET_TAIL_SAMPLES`, `COMET_TAIL_GAP_WORLD`, `COMET_SIZE`, `COMET_BRIGHTNESS`, :60-67) and `EDGE_GLOW` (:53) into the new file verbatim, exported. Then add `createCometSystem`, which is the body of Galaxy3D's pulse effect (:449-539) factored out of React:

```ts
import * as THREE from 'three'

// … moved constants + makeGlowTexture + makeStarLayer + makeNebula here …

export interface CometSystem {
  points: THREE.Points
  tick: (nowSec: number) => void
  dispose: () => void
}

interface CometNode {
  id: string
  x?: number
  y?: number
  z?: number
}

// The 'pulse' edge style: a comet/discharge fired along each edge on a loop.
// All comets live in a single THREE.Points system (one draw call) so it scales
// to thousand-edge graphs. Node objects are the LIVE layout objects (mutated in
// place by the force engine), so tick() always reads current positions.
export function createCometSystem(
  nodes: CometNode[],
  links: Array<{ source: string | CometNode; target: string | CometNode }>,
): CometSystem | null {
  const nodeById = new Map<string, CometNode>()
  for (const n of nodes) nodeById.set(n.id, n)
  const endpointOf = (ref: string | CometNode): CometNode | undefined =>
    typeof ref === 'object' ? ref : nodeById.get(ref)
  const edges: Array<{ s: CometNode; t: CometNode; phase: number }> = []
  let idx = 0
  for (const link of links) {
    const s = endpointOf(link.source)
    const t = endpointOf(link.target)
    if (!s || !t) continue
    edges.push({ s, t, phase: (idx++ * 0.618033988749895) % 1 })
  }
  const N = edges.length
  if (N === 0) return null
  const K = COMET_TAIL_SAMPLES
  const positions = new Float32Array(N * K * 3)
  const colors = new Float32Array(N * K * 3)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  const tex = makeGlowTexture()
  const material = new THREE.PointsMaterial({
    map: tex,
    size: COMET_SIZE,
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  })
  const points = new THREE.Points(geometry, material)
  points.name = 'galaxy-comets'
  points.frustumCulled = false // heads move every frame; skip stale-bbox culling
  const base = new THREE.Color(EDGE_GLOW)
  const posAttr = geometry.getAttribute('position')
  const colAttr = geometry.getAttribute('color')
  const tick = (now: number): void => {
    for (let e = 0; e < N; e++) {
      const { s, t, phase } = edges[e]
      const sx = s.x ?? 0
      const sy = s.y ?? 0
      const sz = s.z ?? 0
      const dx = (t.x ?? 0) - sx
      const dy = (t.y ?? 0) - sy
      const dz = (t.z ?? 0) - sz
      const len = Math.hypot(dx, dy, dz) || 1
      const gapFrac = COMET_TAIL_GAP_WORLD / len
      const cyc = (now / COMET_CYCLE_SEC + phase) % 1
      const active = cyc < COMET_ACTIVE_FRAC
      const head = active ? cyc / COMET_ACTIVE_FRAC : -1
      const env = active ? Math.sin(Math.PI * head) * COMET_BRIGHTNESS : 0
      for (let k = 0; k < K; k++) {
        const o = (e * K + k) * 3
        const hp = head - k * gapFrac
        if (!active || hp < 0 || hp > 1) {
          positions[o] = sx
          positions[o + 1] = sy
          positions[o + 2] = sz
          colors[o] = 0
          colors[o + 1] = 0
          colors[o + 2] = 0
          continue
        }
        positions[o] = sx + dx * hp
        positions[o + 1] = sy + dy * hp
        positions[o + 2] = sz + dz * hp
        const inten = env * (1 - k / K)
        colors[o] = base.r * inten
        colors[o + 1] = base.g * inten
        colors[o + 2] = base.b * inten
      }
    }
    posAttr.needsUpdate = true
    colAttr.needsUpdate = true
  }
  const dispose = (): void => {
    geometry.dispose()
    material.dispose()
    tex.dispose()
  }
  return { points, tick, dispose }
}
```

Keep the inline comments from the original (comet-cycle explanation etc.) on the moved constants.

- [ ] **Step 2: Rewire `Galaxy3D.tsx`**

- Delete the moved functions/constants from `Galaxy3D.tsx`; import them:
  `import { createCometSystem, type CometSystem, EDGE_GLOW, makeGlowTexture, makeNebula, makeStarLayer } from './galaxy-fx'`
- `makeHalo` STAYS in Galaxy3D (selection-specific) and keeps using `makeGlowTexture` via the import.
- Replace the pulse-edge effect body (:441-547) with:

```tsx
  useEffect(() => {
    if (edgeStyle !== 'pulse') return
    const fg = fgRef.current
    if (!fg) return
    let system: CometSystem | null = null
    const start = requestAnimationFrame(() => {
      const scene = fg.scene?.()
      if (!scene) return
      system = createCometSystem(graphData.nodes, graphData.links)
      if (!system) return
      scene.add(system.points)
      const loop = (): void => {
        system?.tick(performance.now() / 1000)
        pulseEdgeRaf.current = requestAnimationFrame(loop)
      }
      pulseEdgeRaf.current = requestAnimationFrame(loop)
    })
    return () => {
      cancelAnimationFrame(start)
      if (pulseEdgeRaf.current) cancelAnimationFrame(pulseEdgeRaf.current)
      pulseEdgeRaf.current = null
      if (system) {
        fg.scene?.()?.remove(system.points)
        system.dispose()
        system = null
      }
    }
  }, [edgeStyle, graphData])
```

Keep the original explanatory comment block above the effect (why our own rAF loop, not linkPositionUpdate).

- [ ] **Step 3: Verify**

Run: `pnpm typecheck && pnpm test`
Expected: PASS. Also `pnpm lint` for import ordering.

- [ ] **Step 4: Commit** — `refactor(graph): extract galaxy scene builders into galaxy-fx`

---

### Task 3: `DecorGalaxy3D` — non-interactive 3D component

**Files:**
- Create: `src/renderer/src/components/dashboard/DecorGalaxy3D.tsx`

**Interfaces:**
- Produces (default export, for `lazy()`):
  `DecorGalaxy3D({ graphData, size, nodeColor, clusterKey }: { graphData: { nodes: Array<{ id: string; x?: number; y?: number; z?: number }>; links: Array<{ source: string; target: string }> }; size: number; nodeColor: (n: any) => string; clusterKey: (n: any) => string | number })`

- [ ] **Step 1: Write the component**

```tsx
import {
  makeGlowTexture,
  makeNebula,
  makeStarLayer,
  createCometSystem,
  type CometSystem,
} from '@renderer/pages/knowledge/galaxy-fx'
import { clusterAnchors } from '@renderer/pages/knowledge/cluster-anchors'
import { forceCollide, forceX, forceY, forceZ } from 'd3-force-3d'
import { useEffect, useRef } from 'react'
import ForceGraph3D from 'react-force-graph-3d'
import * as THREE from 'three'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'

interface DecorNode {
  id: string
  x?: number
  y?: number
  z?: number
}

interface DecorGalaxy3DProps {
  graphData: {
    nodes: DecorNode[]
    links: Array<{ source: string | DecorNode; target: string | DecorNode }>
  }
  size: number
  // biome-ignore lint/suspicious/noExplicitAny: force-graph node type is untyped
  nodeColor: (n: any) => string
  // biome-ignore lint/suspicious/noExplicitAny: force-graph node type is untyped
  clusterKey: (n: any) => string | number
}

const NODE_REL_SIZE = 4
const BACKGROUND = '#000000'

// Purely decorative galaxy for the Dashboard hero: same cluster-anchored layout,
// bloom, starfield and pulse comets as the Knowledge Galaxy3D, but with every
// interaction stripped — no hover, no click, no drag, permanent auto-rotate.
export default function DecorGalaxy3D({
  graphData,
  size,
  nodeColor,
  clusterKey,
}: DecorGalaxy3DProps) {
  // biome-ignore lint/suspicious/noExplicitAny: ForceGraph ref has no exported type
  const fgRef = useRef<any>(null)
  const cometRaf = useRef<number | null>(null)

  // Cluster-anchor forces (same rationale as Galaxy3D: no manual reheat — the
  // library re-heats on every graphData assignment; setting forces is enough).
  // biome-ignore lint/correctness/useExhaustiveDependencies: set forces on data change only
  useEffect(() => {
    const fg = fgRef.current
    if (!fg) return
    const anchors = clusterAnchors(graphData.nodes.map((n) => clusterKey(n)))
    const anchorOf = (n: DecorNode) => anchors.get(String(clusterKey(n)))
    fg.d3Force('x', forceX((n: DecorNode) => anchorOf(n)?.x ?? 0).strength(0.12))
    fg.d3Force('y', forceY((n: DecorNode) => anchorOf(n)?.y ?? 0).strength(0.12))
    fg.d3Force('z', forceZ((n: DecorNode) => anchorOf(n)?.z ?? 0).strength(0.12))
    fg.d3Force('charge')?.strength(-120)
    fg.d3Force('collide', forceCollide(NODE_REL_SIZE + 2))
  }, [graphData])

  // One-time scene: bloom, starfield, nebula, permanent auto-rotate.
  // biome-ignore lint/correctness/useExhaustiveDependencies: one-time scene setup
  useEffect(() => {
    const fg = fgRef.current
    if (!fg) return
    let bloom: UnrealBloomPass | null = null
    const stars: THREE.Points[] = []
    let nebula: THREE.Group | null = null
    let glowTex: THREE.Texture | null = null
    const raf = requestAnimationFrame(() => {
      const composer = fg.postProcessingComposer?.()
      if (composer) {
        bloom = new UnrealBloomPass(
          new THREE.Vector2(Math.max(size, 1), Math.max(size, 1)),
          0.6,
          0.55,
          0.18,
        )
        composer.addPass(bloom)
      }
      const scene = fg.scene?.()
      if (scene) {
        glowTex = makeGlowTexture()
        stars.push(makeStarLayer(500, 1500, 2600, 3.2, 0.55, 0xbfd0ff))
        stars.push(makeStarLayer(700, 2800, 4200, 2.4, 0.7, 0xffffff))
        for (const layer of stars) scene.add(layer)
        nebula = makeNebula(glowTex)
        scene.add(nebula)
      }
      const controls = fg.controls?.()
      if (controls) {
        controls.autoRotate = true
        controls.autoRotateSpeed = 0.55
        controls.enableZoom = false
        controls.enablePan = false
      }
    })
    return () => {
      cancelAnimationFrame(raf)
      if (bloom) {
        fg.postProcessingComposer?.()?.removePass?.(bloom)
        bloom.dispose?.()
      }
      const scene = fg.scene?.()
      for (const layer of stars) {
        scene?.remove(layer)
        layer.geometry.dispose()
        ;(layer.material as THREE.Material).dispose()
      }
      if (nebula) {
        scene?.remove(nebula)
        for (const child of nebula.children) {
          ;((child as THREE.Sprite).material as THREE.Material).dispose()
        }
      }
      glowTex?.dispose()
      const controls = fg.controls?.()
      if (controls) controls.autoRotate = false
    }
  }, [])

  // Pulse comets — always on (this is the whole point of the decoration).
  useEffect(() => {
    const fg = fgRef.current
    if (!fg) return
    let system: CometSystem | null = null
    const start = requestAnimationFrame(() => {
      const scene = fg.scene?.()
      if (!scene) return
      system = createCometSystem(graphData.nodes, graphData.links)
      if (!system) return
      scene.add(system.points)
      const loop = (): void => {
        system?.tick(performance.now() / 1000)
        cometRaf.current = requestAnimationFrame(loop)
      }
      cometRaf.current = requestAnimationFrame(loop)
    })
    return () => {
      cancelAnimationFrame(start)
      if (cometRaf.current) cancelAnimationFrame(cometRaf.current)
      cometRaf.current = null
      if (system) {
        fg.scene?.()?.remove(system.points)
        system.dispose()
        system = null
      }
    }
  }, [graphData])

  // Frame the settled graph (bbox center + fit distance; aspect is 1 — square).
  const frameGraph = (): void => {
    const fg = fgRef.current
    if (!fg) return
    const nodes = graphData.nodes
    if (nodes.length === 0) return
    let minX = Infinity
    let minY = Infinity
    let minZ = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    let maxZ = -Infinity
    for (const n of nodes) {
      const x = n.x ?? 0
      const y = n.y ?? 0
      const z = n.z ?? 0
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      if (z < minZ) minZ = z
      if (z > maxZ) maxZ = z
    }
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    const cz = (minZ + maxZ) / 2
    let maxR = 0
    for (const n of nodes) {
      const r = Math.hypot((n.x ?? 0) - cx, (n.y ?? 0) - cy, (n.z ?? 0) - cz)
      if (r > maxR) maxR = r
    }
    const cam = fg.camera?.()
    const fov = ((cam?.fov ?? 50) * Math.PI) / 180
    const radius = Math.max(maxR + NODE_REL_SIZE * 3, 15)
    const distance = Math.max(radius / Math.tan(fov / 2), 30)
    fg.cameraPosition({ x: cx, y: cy, z: cz + distance }, { x: cx, y: cy, z: cz }, 600)
  }

  return (
    <ForceGraph3D
      ref={fgRef}
      width={size}
      height={size}
      graphData={graphData}
      backgroundColor={BACKGROUND}
      controlType="orbit"
      nodeId="id"
      nodeRelSize={NODE_REL_SIZE}
      nodeVal={() => 1}
      nodeColor={nodeColor}
      nodeOpacity={0.95}
      linkColor={() => '#6a76a6'}
      linkOpacity={0.03}
      enableNodeDrag={false}
      enablePointerInteraction={false}
      warmupTicks={20}
      cooldownTicks={120}
      onEngineStop={frameGraph}
    />
  )
}
```

- [ ] **Step 2: Verify** — `pnpm typecheck && pnpm lint`
Expected: PASS (component not yet mounted anywhere — that's fine).

- [ ] **Step 3: Commit** — `feat(dashboard): DecorGalaxy3D decorative 3D graph component`

---

### Task 4: `GalaxyHero` panel + HUD CSS

**Files:**
- Create: `src/renderer/src/components/dashboard/GalaxyHero.tsx`
- Modify: `src/renderer/src/index.css` (append a `── DASHBOARD 2.0 ──` section)

**Interfaces:**
- Consumes: `DecorGalaxy3D` (Task 3), `num` from `dash-utils` (Task 1), `filterBySources`/`communityKey` from `pages/knowledge/source-filter`, `colorForNode` from `pages/knowledge/graph-colors`, `Graph3DBoundary`, `BorderBeam`, `ScrambleText`.
- Produces: `export function GalaxyHero()` — self-contained panel.

- [ ] **Step 1: Write `GalaxyHero.tsx`**

```tsx
import { num } from '@renderer/components/dashboard/dash-utils'
import { BorderBeam } from '@renderer/components/fx/BorderBeam'
import { ScrambleText } from '@renderer/components/fx/ScrambleText'
import { trpc } from '@renderer/lib/trpc'
import { colorForNode } from '@renderer/pages/knowledge/graph-colors'
import { Graph3DBoundary } from '@renderer/pages/knowledge/Graph3DBoundary'
import { communityKey, filterBySources } from '@renderer/pages/knowledge/source-filter'
import { useUiStore } from '@renderer/store/ui'
import type { CodeGraphNode } from '@shared/graph'
import { lazy, Suspense, useCallback, useMemo, useRef, useState } from 'react'

const DecorGalaxy3D = lazy(() => import('./DecorGalaxy3D'))

// Decorative hero: the unified multi-project graph (scope __all__), filtered by
// the user's persisted source toggles, rendered as a square auto-rotating galaxy
// with pulse-comet edges. Zero interaction — pointer events are disabled on the
// whole canvas; the HUD overlay shows the real node/edge counts.
export function GalaxyHero() {
  const graphSources = useUiStore((s) => s.graphSources)
  const graph = trpc.graph.getGraph.useQuery({ scope: '__all__' })
  const [failed, setFailed] = useState(false)

  const enabled = useMemo(() => new Set(graphSources), [graphSources])
  const data = useMemo(() => {
    const raw = graph.data
    if (!raw)
      return {
        nodes: [] as Array<CodeGraphNode & { x?: number }>,
        links: [] as Array<{ source: string; target: string }>,
      }
    const scoped = filterBySources(raw, enabled)
    const nodes = scoped.nodes.map((n) => ({ ...n }))
    const ids = new Set(nodes.map((n) => n.id))
    const links = scoped.edges
      .filter((e) => ids.has(e.source) && ids.has(e.target))
      .map((e) => ({ source: e.source, target: e.target }))
    return { nodes, links }
  }, [graph.data, enabled])

  // Square canvas: track the container's width; height === width.
  const roRef = useRef<ResizeObserver | null>(null)
  const [size, setSize] = useState(0)
  const setContainer = useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect()
    if (!el) {
      roRef.current = null
      return
    }
    const measure = () => setSize(el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    roRef.current = ro
  }, [])

  const empty = !graph.isLoading && data.nodes.length === 0

  return (
    <div className="panel galaxy-hero">
      <BorderBeam />
      <div className="panel-head">
        <span className="ttl">
          <ScrambleText text="atlas graph" />
        </span>
        <span className="meta">all projects · live</span>
      </div>
      <div className="galaxy-canvas" ref={setContainer}>
        {!failed && !empty && size > 0 && (
          <Graph3DBoundary onError={() => setFailed(true)}>
            <Suspense fallback={null}>
              <DecorGalaxy3D
                graphData={data}
                size={size}
                nodeColor={(n) => colorForNode(n as CodeGraphNode)}
                clusterKey={(n) => communityKey(n as CodeGraphNode)}
              />
            </Suspense>
          </Graph3DBoundary>
        )}
        {(empty || failed) && (
          <div className="galaxy-hero-empty">
            {failed ? '// 3D unavailable on this GPU' : '// no graph yet — run Build on Knowledge'}
          </div>
        )}
        <div className="galaxy-hud" aria-hidden>
          <span className="corner tl" />
          <span className="corner tr" />
          <span className="corner bl" />
          <span className="corner br" />
          <div className="galaxy-reticle" />
          <div className="galaxy-scanline" />
          <div className="galaxy-readout">
            NODES {num(data.nodes.length)} · EDGES {num(data.links.length)}
          </div>
        </div>
      </div>
    </div>
  )
}
```

Note: `Graph3DBoundary` swallows WebGL/lazy-chunk failures; `onError` flips to the static empty state instead of retry-looping.

- [ ] **Step 2: Append hero CSS to `index.css`**

```css
/* ── DASHBOARD 2.0 ─────────────────────────────────────────────────────── */

/* 3D galaxy hero: square decorative canvas + HUD overlay. pointer-events off
   on the whole canvas — the graph is a poster, not a control. */
.galaxy-hero {
  position: relative;
  overflow: hidden;
}
.galaxy-canvas {
  position: relative;
  width: 100%;
  aspect-ratio: 1;
  pointer-events: none;
  overflow: hidden;
  background: #000;
}
.galaxy-hero-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--mono);
  font-size: 12px;
  color: var(--fg-4);
}
.galaxy-hud {
  position: absolute;
  inset: 10px;
  z-index: 2;
  font-family: var(--mono);
}
.galaxy-hud .corner {
  position: absolute;
  width: 18px;
  height: 18px;
  border: 0 solid var(--amber-dim);
  opacity: 0.9;
}
.galaxy-hud .tl { top: 0; left: 0; border-top-width: 1px; border-left-width: 1px; }
.galaxy-hud .tr { top: 0; right: 0; border-top-width: 1px; border-right-width: 1px; }
.galaxy-hud .bl { bottom: 0; left: 0; border-bottom-width: 1px; border-left-width: 1px; }
.galaxy-hud .br { bottom: 0; right: 0; border-bottom-width: 1px; border-right-width: 1px; }
.galaxy-reticle {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 64%;
  aspect-ratio: 1;
  transform: translate(-50%, -50%);
  border: 1px dashed rgba(245, 177, 61, 0.14);
  border-radius: 50%;
  animation: galaxy-reticle-spin 90s linear infinite;
}
@keyframes galaxy-reticle-spin {
  to { transform: translate(-50%, -50%) rotate(360deg); }
}
.galaxy-scanline {
  position: absolute;
  left: 0;
  right: 0;
  top: -18%;
  height: 18%;
  background: linear-gradient(180deg, transparent, rgba(79, 214, 232, 0.06), transparent);
  animation: galaxy-scanline 7s linear infinite;
}
@keyframes galaxy-scanline {
  to { top: 110%; }
}
.galaxy-readout {
  position: absolute;
  left: 2px;
  bottom: 2px;
  font-size: 11px;
  letter-spacing: 0.08em;
  color: var(--amber);
  text-shadow: 0 0 8px rgba(245, 177, 61, 0.5);
}
@media (prefers-reduced-motion: reduce) {
  .galaxy-reticle,
  .galaxy-scanline {
    animation: none;
  }
}
```

- [ ] **Step 3: Verify** — `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 4: Commit** — `feat(dashboard): GalaxyHero panel with HUD overlay`

---

### Task 5: NEXT UP — grouping helper (TDD) + panel

**Files:**
- Create: `src/renderer/src/components/dashboard/next-up.ts`
- Create: `src/renderer/src/components/dashboard/next-up.test.ts`
- Create: `src/renderer/src/components/dashboard/RoadmapNextUp.tsx`
- Modify: `src/renderer/src/index.css` (append to the DASHBOARD 2.0 section)

**Interfaces:**
- Consumes: `RoadmapItem` from `@shared/roadmap`.
- Produces: `groupNextUp(items: RoadmapItem[]): { inProgress: RoadmapItem[]; nextUp: RoadmapItem[]; done: RoadmapItem[] }`, `export function RoadmapNextUp()`.

- [ ] **Step 1: Write the failing test (`next-up.test.ts`)**

```ts
import type { RoadmapItem } from '@shared/roadmap'
import { describe, expect, it } from 'vitest'
import { groupNextUp } from './next-up'

let seq = 0
function item(over: Partial<RoadmapItem>): RoadmapItem {
  seq += 1
  return {
    id: `id-${seq}`,
    title: `Item ${seq}`,
    description: '',
    category: 'wow',
    status: 'todo',
    priority: 'medium',
    claudePrompt: '',
    position: seq,
    createdAt: 1000 + seq,
    updatedAt: 1000 + seq,
    ...over,
  }
}

describe('groupNextUp', () => {
  it('splits items into inProgress / nextUp / done', () => {
    const items = [
      item({ status: 'in-progress', title: 'wip' }),
      item({ status: 'planned', title: 'plan' }),
      item({ status: 'todo', title: 'todo' }),
      item({ status: 'done', title: 'shipped' }),
    ]
    const g = groupNextUp(items)
    expect(g.inProgress.map((i) => i.title)).toEqual(['wip'])
    expect(g.nextUp.map((i) => i.title)).toEqual(['plan', 'todo'])
    expect(g.done.map((i) => i.title)).toEqual(['shipped'])
  })

  it('nextUp puts planned before todo, then sorts by priority (high first)', () => {
    const g = groupNextUp([
      item({ status: 'todo', priority: 'high', title: 'todo-high' }),
      item({ status: 'planned', priority: 'low', title: 'plan-low' }),
      item({ status: 'planned', priority: 'high', title: 'plan-high' }),
    ])
    expect(g.nextUp.map((i) => i.title)).toEqual(['plan-high', 'plan-low', 'todo-high'])
  })

  it('caps groups (3 in progress, 4 next up, 3 done) and sorts wip/done by recency', () => {
    const wip = [1, 2, 3, 4].map((n) =>
      item({ status: 'in-progress', updatedAt: n, title: `w${n}` }),
    )
    const next = [1, 2, 3, 4, 5].map((n) => item({ status: 'todo', title: `n${n}` }))
    const done = [1, 2, 3, 4].map((n) => item({ status: 'done', updatedAt: n, title: `d${n}` }))
    const g = groupNextUp([...wip, ...next, ...done])
    expect(g.inProgress.map((i) => i.title)).toEqual(['w4', 'w3', 'w2'])
    expect(g.nextUp).toHaveLength(4)
    expect(g.done.map((i) => i.title)).toEqual(['d4', 'd3', 'd2'])
  })

  it('ties inside one status+priority fall back to board position', () => {
    const g = groupNextUp([
      item({ status: 'planned', priority: 'high', position: 2, title: 'second' }),
      item({ status: 'planned', priority: 'high', position: 1, title: 'first' }),
    ])
    expect(g.nextUp.map((i) => i.title)).toEqual(['first', 'second'])
  })
})
```

- [ ] **Step 2: Run it, watch it fail**

Run: `pnpm vitest run src/renderer/src/components/dashboard/next-up.test.ts`
Expected: FAIL — cannot resolve `./next-up`.

- [ ] **Step 3: Implement `next-up.ts`**

```ts
import type { RoadmapItem, RoadmapPriority } from '@shared/roadmap'

// Dashboard "NEXT UP" digest of the kanban board: what's being worked on right
// now, what's queued next (planned before todo, high priority first), and what
// shipped most recently. Caps keep the panel a digest, not a second board.
const PRIORITY_ORDER: Record<RoadmapPriority, number> = { high: 0, medium: 1, low: 2 }

export interface NextUpGroups {
  inProgress: RoadmapItem[]
  nextUp: RoadmapItem[]
  done: RoadmapItem[]
}

const byRecency = (a: RoadmapItem, b: RoadmapItem): number => b.updatedAt - a.updatedAt
const byPriority = (a: RoadmapItem, b: RoadmapItem): number =>
  PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || a.position - b.position

export function groupNextUp(items: RoadmapItem[]): NextUpGroups {
  const inProgress = items
    .filter((i) => i.status === 'in-progress')
    .sort(byRecency)
    .slice(0, 3)
  const planned = items.filter((i) => i.status === 'planned').sort(byPriority)
  const todo = items.filter((i) => i.status === 'todo').sort(byPriority)
  const nextUp = [...planned, ...todo].slice(0, 4)
  const done = items
    .filter((i) => i.status === 'done')
    .sort(byRecency)
    .slice(0, 3)
  return { inProgress, nextUp, done }
}
```

- [ ] **Step 4: Run the test again**

Run: `pnpm vitest run src/renderer/src/components/dashboard/next-up.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Write `RoadmapNextUp.tsx`**

```tsx
import { Note } from '@renderer/components/dashboard/dash-utils'
import { ScrambleText } from '@renderer/components/fx/ScrambleText'
import { trpc } from '@renderer/lib/trpc'
import { useUiStore } from '@renderer/store/ui'
import type { RoadmapItem } from '@shared/roadmap'
import { useMemo } from 'react'
import { groupNextUp } from './next-up'

// Kanban digest: click anywhere lands on the Roadmap board view.
export function RoadmapNextUp() {
  const go = useUiStore((s) => s.setSection)
  const setTab = useUiStore((s) => s.setTab)
  const items = trpc.roadmap.list.useQuery()
  const groups = useMemo(() => groupNextUp(items.data ?? []), [items.data])

  const openBoard = () => {
    setTab('roadmap', 'board')
    go('roadmap')
  }

  const total =
    groups.inProgress.length + groups.nextUp.length + groups.done.length

  const Row = ({ item, glyph, cls }: { item: RoadmapItem; glyph: string; cls?: string }) => (
    <button
      type="button"
      className={`nextup-row${cls ? ` ${cls}` : ''}`}
      onClick={openBoard}
      title={item.title}
    >
      <span className="nextup-glyph">{glyph}</span>
      <span className="nextup-title">{item.title}</span>
      {item.priority === 'high' && <span className="nextup-pri">!!</span>}
    </button>
  )

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="ttl">
          <ScrambleText text="next up" />
        </span>
        <button
          type="button"
          className="meta"
          onClick={openBoard}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'var(--mono)' }}
        >
          board →
        </button>
      </div>
      <div className="panel-body">
        {items.isLoading ? (
          <Note>loading…</Note>
        ) : total === 0 ? (
          <Note>roadmap is empty — capture an idea.</Note>
        ) : (
          <>
            {groups.inProgress.length > 0 && (
              <>
                <div className="nextup-group">in progress</div>
                {groups.inProgress.map((i) => (
                  <Row key={i.id} item={i} glyph="▸" />
                ))}
              </>
            )}
            {groups.nextUp.length > 0 && (
              <>
                <div className="nextup-group">next up</div>
                {groups.nextUp.map((i) => (
                  <Row key={i.id} item={i} glyph="▹" />
                ))}
              </>
            )}
            {groups.done.length > 0 && (
              <>
                <div className="nextup-group">recently done</div>
                {groups.done.map((i) => (
                  <Row key={i.id} item={i} glyph="✓" cls="done" />
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Append NEXT UP CSS to the DASHBOARD 2.0 section**

```css
/* NEXT UP kanban digest */
.nextup-group {
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--fg-4);
  margin: 10px 0 2px;
}
.nextup-group:first-child { margin-top: 0; }
.nextup-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  background: none;
  border: none;
  border-bottom: 1px dashed var(--line-dim);
  padding: 6px 0;
  cursor: pointer;
  text-align: left;
  font-family: var(--mono);
  font-size: 12px;
  color: var(--fg-2);
}
.nextup-row:hover .nextup-title { color: var(--amber); }
.nextup-glyph { color: var(--amber); flex-shrink: 0; }
.nextup-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nextup-pri { color: #ff6b74; font-size: 11px; }
.nextup-row.done .nextup-glyph,
.nextup-row.done .nextup-title { color: var(--fg-4); }
.nextup-row.done .nextup-title { text-decoration: line-through; }
```

- [ ] **Step 7: Verify** — `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS.

- [ ] **Step 8: Commit** — `feat(dashboard): NEXT UP kanban digest panel`

---

### Task 6: `graphBuildRun` store + always-mounted host

**Files:**
- Create: `src/renderer/src/store/graphBuildRun.ts`
- Create: `src/renderer/src/components/GraphBuildRunHost.tsx`
- Modify: `src/renderer/src/App.tsx` (mount host next to `<NewsRunHost />`, line 97)

**Interfaces:**
- Produces: `useGraphBuildRun` zustand hook — `{ running: boolean; requestId: string | null; projectPath: string | null; start(projectPath: string): void; cancel(): void; finish(): void }`.
- Consumes: `trpc.graph.build` subscription events (`tool`/`progress`/`done`/`error`/`aborted`), `trpc.graph.cancelDeepMap`.

The `graph.build` observable teardown cancels the run (`graph.ts:133-140`), which is exactly why the subscription must be hosted above the page switch — same pattern as `NewsRunHost`.

- [ ] **Step 1: Write `graphBuildRun.ts`**

```ts
import { create } from 'zustand'

// Deep-map build state lives OUTSIDE the Dashboard so a run survives navigation.
// The graph.build subscription is hosted at the App level (GraphBuildRunHost);
// unsubscribing CANCELS the main-side run, so the host must stay mounted.
interface GraphBuildRunState {
  running: boolean
  requestId: string | null
  projectPath: string | null
  start: (projectPath: string) => void
  // Flipping `running` off switches the subscription input to skipToken, which
  // unsubscribes → the main-side run is cancelled in the observable teardown.
  cancel: () => void
  finish: () => void
}

export const useGraphBuildRun = create<GraphBuildRunState>((set) => ({
  running: false,
  requestId: null,
  projectPath: null,
  start: (projectPath) =>
    set({ running: true, projectPath, requestId: `build-${projectPath}-${Date.now()}` }),
  cancel: () => set({ running: false }),
  finish: () => set({ running: false }),
}))
```

- [ ] **Step 2: Write `GraphBuildRunHost.tsx`**

```tsx
import { trpc } from '@renderer/lib/trpc'
import { useGraphBuildRun } from '@renderer/store/graphBuildRun'
import { skipToken } from '@tanstack/react-query'
import { useMemo } from 'react'
import { toast } from 'sonner'

// Always-mounted host for the dashboard's BUILD MAP run. Living above the page
// switch means leaving the Dashboard no longer unsubscribes → no accidental
// cancel of the main-side graphify run. Renders nothing.
export function GraphBuildRunHost() {
  const utils = trpc.useUtils()
  const running = useGraphBuildRun((s) => s.running)
  const requestId = useGraphBuildRun((s) => s.requestId)
  const projectPath = useGraphBuildRun((s) => s.projectPath)
  const finish = useGraphBuildRun((s) => s.finish)

  const subInput = useMemo(
    () => (running && requestId && projectPath ? { requestId, projectPath } : skipToken),
    [running, requestId, projectPath],
  )

  trpc.graph.build.useSubscription(subInput, {
    onData: (event) => {
      switch (event.type) {
        case 'done':
          finish()
          toast.success(`Map built: +${event.nodesAdded} nodes, +${event.edgesAdded} edges`)
          void utils.graph.getGraph.invalidate()
          void utils.graph.listProjects.invalidate()
          break
        case 'error':
          finish()
          toast.error(event.message)
          break
        case 'aborted':
          finish()
          toast('Map build cancelled')
          break
        default:
          break
      }
    },
    onError: (error) => {
      finish()
      toast.error(error.message)
    },
  })

  return null
}
```

(`tool`/`progress` events are intentionally ignored — the Processes strip already shows the live job; the dashboard button only needs start/end.)

- [ ] **Step 3: Mount in `App.tsx`**

After `<TrendingRunHost />` (line 98) add `<GraphBuildRunHost />` with the import `import { GraphBuildRunHost } from '@renderer/components/GraphBuildRunHost'`.

- [ ] **Step 4: Verify** — `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit** — `feat(dashboard): graphBuildRun store + app-level host`

---

### Task 7: Widget row — heatmap helper (TDD) + four widgets

**Files:**
- Create: `src/renderer/src/components/dashboard/heatmap.ts`
- Create: `src/renderer/src/components/dashboard/heatmap.test.ts`
- Create: `src/renderer/src/components/dashboard/TokenHeatmap.tsx`
- Create: `src/renderer/src/components/dashboard/KnowledgePulse.tsx`
- Create: `src/renderer/src/components/dashboard/BenchmarkWidget.tsx`
- Create: `src/renderer/src/components/dashboard/MissionClock.tsx`
- Modify: `src/renderer/src/index.css` (append)

**Interfaces:**
- Produces: `heatmapCells(byDay: Array<{ date: string; tokens: number }>, days: number, end: Date): HeatCell[]` where `HeatCell = { date: string; tokens: number; level: 0 | 1 | 2 | 3 | 4 }` (dense calendar, oldest first); four `export function <Widget>()` components.
- Consumes: `trpc.productivity.kpi` (`byDay: { date: 'YYYY-MM-DD'; tokens: number; … }[]` — sparse, active days only), `trpc.knowledge.projects` (`{ name, path, articleCount, dailyCount, lastUpdated }[]`), `trpc.benchmark.latest` (`{ batchId, total, done, failed, running, phase, error } | null`), `trpc.benchmark.latestAnalysis` (`{ batchId, createdAt, model, summary, dataJson: Array<{ taskId, tokens: { before, after, absDelta, pctDelta }, output: {...}, cost: {...} }> } | null`), `trpc.health.ping` (`{ ok, version, pong, uptimeMs, memMB }`), `formatDuration` from `hooks/useJobs`, `compact`/`num`/`timeAgo`/`Note`/`DrillLink` from `dash-utils`.

- [ ] **Step 1: Write the failing test (`heatmap.test.ts`)**

```ts
import { describe, expect, it } from 'vitest'
import { heatmapCells, levelOf } from './heatmap'

describe('levelOf', () => {
  it('is 0 for zero tokens or zero max', () => {
    expect(levelOf(0, 100)).toBe(0)
    expect(levelOf(50, 0)).toBe(0)
  })
  it('buckets by quarter of max', () => {
    expect(levelOf(10, 100)).toBe(1)
    expect(levelOf(25, 100)).toBe(1)
    expect(levelOf(26, 100)).toBe(2)
    expect(levelOf(50, 100)).toBe(2)
    expect(levelOf(75, 100)).toBe(3)
    expect(levelOf(100, 100)).toBe(4)
  })
})

describe('heatmapCells', () => {
  it('densifies a sparse byDay into a full calendar window ending at `end`', () => {
    const end = new Date(2026, 6, 4) // July 4 2026, local
    const cells = heatmapCells([{ date: '2026-07-03', tokens: 40 }], 3, end)
    expect(cells.map((c) => c.date)).toEqual(['2026-07-02', '2026-07-03', '2026-07-04'])
    expect(cells.map((c) => c.tokens)).toEqual([0, 40, 0])
    expect(cells.map((c) => c.level)).toEqual([0, 4, 0])
  })
  it('handles an empty byDay (all zero levels)', () => {
    const cells = heatmapCells([], 2, new Date(2026, 0, 10))
    expect(cells).toHaveLength(2)
    expect(cells.every((c) => c.level === 0)).toBe(true)
  })
})
```

- [ ] **Step 2: Run it, watch it fail**

Run: `pnpm vitest run src/renderer/src/components/dashboard/heatmap.test.ts`
Expected: FAIL — cannot resolve `./heatmap`.

- [ ] **Step 3: Implement `heatmap.ts`**

```ts
// Contribution-grid bucketing for the dashboard token heatmap. kpi.byDay is
// sparse (active days only, local 'YYYY-MM-DD' keys), so the grid densifies it
// into a full trailing window; intensity is relative to the window max.
export interface HeatCell {
  date: string
  tokens: number
  level: 0 | 1 | 2 | 3 | 4
}

export function levelOf(tokens: number, max: number): HeatCell['level'] {
  if (tokens <= 0 || max <= 0) return 0
  const f = tokens / max
  if (f <= 0.25) return 1
  if (f <= 0.5) return 2
  if (f <= 0.75) return 3
  return 4
}

// Local-time date key, matching the backend's per-day bucketing.
const keyOf = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export function heatmapCells(
  byDay: Array<{ date: string; tokens: number }>,
  days: number,
  end: Date,
): HeatCell[] {
  const tokensByDate = new Map(byDay.map((d) => [d.date, d.tokens]))
  const max = byDay.reduce((m, d) => Math.max(m, d.tokens), 0)
  const cells: HeatCell[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end)
    d.setDate(d.getDate() - i)
    const date = keyOf(d)
    const tokens = tokensByDate.get(date) ?? 0
    cells.push({ date, tokens, level: levelOf(tokens, max) })
  }
  return cells
}
```

- [ ] **Step 4: Run the test again**

Run: `pnpm vitest run src/renderer/src/components/dashboard/heatmap.test.ts`
Expected: PASS.

- [ ] **Step 5: Write `TokenHeatmap.tsx`**

```tsx
import { compact, DrillLink, Note } from '@renderer/components/dashboard/dash-utils'
import { ScrambleText } from '@renderer/components/fx/ScrambleText'
import { trpc } from '@renderer/lib/trpc'
import { useMemo } from 'react'
import { heatmapCells } from './heatmap'

const DAYS = 91 // 13 weeks

// GitHub-style contribution grid of tokens/day. Columns are weeks (top = Sunday);
// leading blanks align the first date to its weekday row.
export function TokenHeatmap() {
  const kpi = trpc.productivity.kpi.useQuery({ days: DAYS })
  const cells = useMemo(
    () => heatmapCells(kpi.data?.byDay ?? [], DAYS, new Date()),
    [kpi.data],
  )
  const lead = cells.length > 0 ? new Date(`${cells[0].date}T00:00:00`).getDay() : 0

  return (
    <div className="panel dash-widget">
      <div className="panel-head">
        <span className="ttl">
          <ScrambleText text="heatmap · 13w" />
        </span>
        <DrillLink to="productivity" label="detail" />
      </div>
      <div className="panel-body">
        {kpi.isLoading ? (
          <Note>loading…</Note>
        ) : (
          <div className="heatmap-grid" aria-hidden>
            {Array.from({ length: lead }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static leading pad
              <span key={`pad-${i}`} className="heatmap-cell pad" />
            ))}
            {cells.map((c) => (
              <span
                key={c.date}
                className="heatmap-cell"
                data-level={c.level}
                title={`${c.date} · ${compact(c.tokens)} tokens`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Write `KnowledgePulse.tsx`**

```tsx
import { DrillLink, Note, num, timeAgo } from '@renderer/components/dashboard/dash-utils'
import { ScrambleText } from '@renderer/components/fx/ScrambleText'
import { trpc } from '@renderer/lib/trpc'

// Knowledge-base vitals: article volume across all project KBs + freshness.
export function KnowledgePulse() {
  const projects = trpc.knowledge.projects.useQuery()
  const rows = projects.data ?? []
  const articles = rows.reduce((s, p) => s + p.articleCount, 0)
  const daily = rows.reduce((s, p) => s + p.dailyCount, 0)
  const freshest = rows.reduce<string | null>(
    (m, p) => (p.lastUpdated && (!m || p.lastUpdated > m) ? p.lastUpdated : m),
    null,
  )

  return (
    <div className="panel dash-widget">
      <div className="panel-head">
        <span className="ttl">
          <ScrambleText text="knowledge" />
        </span>
        <DrillLink to="knowledge" label="browse" />
      </div>
      <div className="panel-body">
        {projects.isLoading ? (
          <Note>loading…</Note>
        ) : rows.length === 0 ? (
          <Note>no knowledge bases yet.</Note>
        ) : (
          <>
            <div className="dash-widget-big">{num(articles)}</div>
            <div className="dash-widget-sub">
              articles · {num(rows.length)} projects · {num(daily)} daily logs
            </div>
            <div className="dash-widget-foot">updated {timeAgo(freshest)}</div>
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 7: Write `BenchmarkWidget.tsx`**

```tsx
import { DrillLink, Note, timeAgo } from '@renderer/components/dashboard/dash-utils'
import { ScrambleText } from '@renderer/components/fx/ScrambleText'
import { trpc } from '@renderer/lib/trpc'

// Latest benchmark batch: live phase while running, else the headline token
// delta from the most recent A/B analysis.
export function BenchmarkWidget() {
  const latest = trpc.benchmark.latest.useQuery()
  const analysis = trpc.benchmark.latestAnalysis.useQuery()

  const live = latest.data && latest.data.phase !== 'done' ? latest.data : null
  const rows = analysis.data?.dataJson ?? []
  const avgTokensDelta =
    rows.length > 0 ? rows.reduce((s, r) => s + r.tokens.pctDelta, 0) / rows.length : null

  return (
    <div className="panel dash-widget">
      <div className="panel-head">
        <span className="ttl">
          <ScrambleText text="benchmark" />
        </span>
        <DrillLink to="productivity" label="runs" />
      </div>
      <div className="panel-body">
        {live ? (
          <>
            <div className="dash-widget-big amber">
              {live.done}/{live.total}
            </div>
            <div className="dash-widget-sub">{live.phase.toUpperCase()}</div>
            <div className="dash-widget-foot">{live.failed > 0 ? `${live.failed} failed` : 'in flight'}</div>
          </>
        ) : avgTokensDelta != null && analysis.data ? (
          <>
            <div className={`dash-widget-big ${avgTokensDelta <= 0 ? 'good' : 'bad'}`}>
              {avgTokensDelta > 0 ? '+' : ''}
              {avgTokensDelta.toFixed(1)}%
            </div>
            <div className="dash-widget-sub">tokens vs previous infra</div>
            <div className="dash-widget-foot">analyzed {timeAgo(analysis.data.createdAt)}</div>
          </>
        ) : (
          <Note>no benchmark runs yet.</Note>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 8: Write `MissionClock.tsx`**

```tsx
import { ScrambleText } from '@renderer/components/fx/ScrambleText'
import { formatDuration } from '@renderer/hooks/useJobs'
import { trpc } from '@renderer/lib/trpc'
import { useEffect, useState } from 'react'

const pad = (n: number): string => String(n).padStart(2, '0')

function dayOfYear(d: Date): number {
  const start = new Date(d.getFullYear(), 0, 0)
  return Math.floor((d.getTime() - start.getTime()) / 86_400_000)
}

// Pure ambient: local mission time, UTC, day-of-year, app uptime + vitals.
export function MissionClock() {
  const health = trpc.health.ping.useQuery(undefined, { refetchInterval: 60_000 })
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="panel dash-widget">
      <div className="panel-head">
        <span className="ttl">
          <ScrambleText text="mission time" />
        </span>
        <span className="meta">DOY {dayOfYear(now)}</span>
      </div>
      <div className="panel-body">
        <div className="dash-widget-big clock">
          {pad(now.getHours())}:{pad(now.getMinutes())}
          <span className="clock-sec">:{pad(now.getSeconds())}</span>
        </div>
        <div className="dash-widget-sub">
          UTC {pad(now.getUTCHours())}:{pad(now.getUTCMinutes())}
        </div>
        <div className="dash-widget-foot">
          up {health.data ? formatDuration(health.data.uptimeMs) : '—'} · v
          {health.data?.version ?? '—'} · {health.data?.memMB ?? '—'}M
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 9: Append widget CSS**

```css
/* 4-up widget row */
.dash-widgets {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}
.dash-widget .panel-body { display: flex; flex-direction: column; gap: 4px; }
.dash-widget-big {
  font-family: var(--mono);
  font-size: 28px;
  color: var(--fg);
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}
.dash-widget-big.amber { color: var(--amber); }
.dash-widget-big.good { color: #86e07c; }
.dash-widget-big.bad { color: #ff6b74; }
.dash-widget-big .clock-sec { font-size: 18px; color: var(--fg-3); }
.dash-widget-sub {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--fg-3);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.dash-widget-foot { font-family: var(--mono); font-size: 11px; color: var(--fg-4); }

/* token heatmap */
.heatmap-grid {
  display: grid;
  grid-auto-flow: column;
  grid-template-rows: repeat(7, 10px);
  grid-auto-columns: 10px;
  gap: 3px;
  overflow: hidden;
}
.heatmap-cell {
  width: 10px;
  height: 10px;
  border-radius: 2px;
  background: var(--line-dim);
}
.heatmap-cell.pad { background: transparent; }
.heatmap-cell[data-level='1'] { background: rgba(245, 177, 61, 0.22); }
.heatmap-cell[data-level='2'] { background: rgba(245, 177, 61, 0.45); }
.heatmap-cell[data-level='3'] { background: rgba(245, 177, 61, 0.7); }
.heatmap-cell[data-level='4'] { background: var(--amber); box-shadow: 0 0 6px rgba(245, 177, 61, 0.5); }
```

- [ ] **Step 10: Verify** — `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS.

- [ ] **Step 11: Commit** — `feat(dashboard): widget row — heatmap, knowledge pulse, benchmark, mission clock`

---

### Task 8: Processes chip strip

**Files:**
- Create: `src/renderer/src/components/dashboard/ProcessesStrip.tsx`
- Delete: `src/renderer/src/components/dashboard/ProcessesPanel.tsx`
- Modify: `src/renderer/src/pages/Dashboard.tsx` (swap import + JSX)
- Modify: `src/renderer/src/index.css` (add `.procstrip-*`, delete old `.proc-*` block at ~:3468-3545)

**Interfaces:**
- Consumes: `useJobs()`/`formatDuration` from `hooks/useJobs`, `trpc.jobs.cancel`, `trpc.jobs.reveal`, `JobView` from `@shared/jobs`.
- Produces: `export function ProcessesStrip()`. Panel title text must remain exactly `processes` (e2e).

- [ ] **Step 1: Write `ProcessesStrip.tsx`**

```tsx
import { ScrambleText } from '@renderer/components/fx/ScrambleText'
import { formatDuration, useJobs } from '@renderer/hooks/useJobs'
import { trpc } from '@renderer/lib/trpc'
import { compact } from '@renderer/components/dashboard/dash-utils'
import type { JobView } from '@shared/jobs'
import { useState } from 'react'

// Compact processes strip: active jobs as live chips; completed history is
// hidden behind the `history` toggle. Replaces the old two-table panel.
export function ProcessesStrip() {
  const { running, recent, now } = useJobs()
  const [historyOpen, setHistoryOpen] = useState(false)
  const cancel = trpc.jobs.cancel.useMutation()
  const reveal = trpc.jobs.reveal.useMutation()

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="ttl">
          <ScrambleText text="processes" />
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {running.length > 0 && <span className="fx-radar" aria-hidden />}
          <button
            type="button"
            className="procstrip-toggle"
            onClick={() => setHistoryOpen((v) => !v)}
          >
            history {historyOpen ? '▴' : '▾'}
          </button>
        </div>
      </div>
      <div className="panel-body">
        {running.length === 0 ? (
          <div className="procstrip-idle">{'// all systems idle'}</div>
        ) : (
          <div className="procstrip-chips">
            {running.map((j) => (
              <span key={j.id} className="procstrip-chip">
                <span className="procstrip-spin" aria-hidden />
                {j.label}
                <span className="procstrip-elapsed">{formatDuration(now - j.startedAt)}</span>
                {j.cancellable && (
                  <button
                    type="button"
                    className="procstrip-x"
                    aria-label="Abort process"
                    onClick={() => cancel.mutate({ jobId: j.id })}
                  >
                    ✕
                  </button>
                )}
              </span>
            ))}
          </div>
        )}

        {historyOpen && (
          <div className="procstrip-history">
            {recent.length === 0 ? (
              <div className="procstrip-idle">{'// no recent processes'}</div>
            ) : (
              recent.map((j: JobView) => (
                <div key={j.id} className="procstrip-row" title={j.error ?? j.detail ?? ''}>
                  <span className={j.status === 'done' ? 'ok' : 'err'}>
                    {j.status === 'done' ? '✓' : '✗'}
                  </span>
                  <span className="procstrip-label">{j.label}</span>
                  <span className="procstrip-meta">
                    {j.tokens != null ? `${compact(j.tokens)} tok` : '—'}
                  </span>
                  <span className="procstrip-meta">
                    {formatDuration((j.endedAt ?? now) - j.startedAt)}
                  </span>
                  {j.resultPath ? (
                    <button
                      type="button"
                      className="procstrip-open"
                      aria-label="Open output"
                      onClick={() => reveal.mutate({ jobId: j.id })}
                    >
                      ↗
                    </button>
                  ) : (
                    <span />
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Swap into `Dashboard.tsx`**

Replace `import { ProcessesPanel } from '@renderer/components/dashboard/ProcessesPanel'` with `import { ProcessesStrip } from '@renderer/components/dashboard/ProcessesStrip'`; replace `<ProcessesPanel />` with `<div className="mt-16"><ProcessesStrip /></div>` (the old component carried its own `mt-16`). Delete `ProcessesPanel.tsx`.

- [ ] **Step 3: CSS — add `.procstrip-*`, remove old `.proc-*`**

Append:

```css
/* processes chip strip */
.procstrip-toggle {
  background: none;
  border: none;
  cursor: pointer;
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  color: var(--fg-3);
  padding: 0;
}
.procstrip-toggle:hover { color: var(--amber); }
.procstrip-idle { font-family: var(--mono); font-size: 12px; color: var(--fg-4); padding: 2px 0; }
.procstrip-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.procstrip-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--line);
  background: rgba(245, 177, 61, 0.05);
  padding: 6px 10px;
  font-family: var(--mono);
  font-size: 12px;
  color: var(--fg-2);
}
.procstrip-spin {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  border: 1px solid var(--amber);
  border-top-color: transparent;
  animation: procstrip-spin 0.8s linear infinite;
}
@keyframes procstrip-spin { to { transform: rotate(360deg); } }
.procstrip-elapsed { color: var(--fg-4); font-variant-numeric: tabular-nums; }
.procstrip-x { background: none; border: none; color: var(--fg-4); cursor: pointer; padding: 0; }
.procstrip-x:hover { color: #ff6b74; }
.procstrip-history { margin-top: 10px; border-top: 1px solid var(--line-dim); padding-top: 6px; }
.procstrip-row {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr) auto auto 24px;
  gap: 10px;
  align-items: center;
  padding: 5px 0;
  border-bottom: 1px dashed var(--line-dim);
  font-family: var(--mono);
  font-size: 12px;
  color: var(--fg-3);
}
.procstrip-row:last-child { border-bottom: none; }
.procstrip-row .ok { color: #86e07c; }
.procstrip-row .err { color: #ff6b74; }
.procstrip-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.procstrip-meta { color: var(--fg-4); font-variant-numeric: tabular-nums; }
.procstrip-open { background: none; border: none; color: var(--fg-3); cursor: pointer; padding: 0; }
.procstrip-open:hover { color: var(--amber); }
@media (prefers-reduced-motion: reduce) { .procstrip-spin { animation: none; } }
```

Delete the old block (verify each class is referenced nowhere before deleting — `grep -rn "proc-" src/ e2e/`): `.proc-group`, `.proc-group-recent`, `.proc-empty`, `.proc-row` (+ `.running/.done/.error` variants), `.proc-icon`, `.proc-label`, `.proc-kind`, `.proc-model`, `.proc-detail`, `.proc-tokens`, `.proc-time`, `.proc-actions`, `.proc-x`, `.proc-open`. Keep `.fx-radar`.

- [ ] **Step 4: Verify** — `pnpm typecheck && pnpm lint && pnpm test` and `grep -rn "ProcessesPanel\|proc-row\|proc-icon" src/`
Expected: PASS; greps return nothing.

- [ ] **Step 5: Commit** — `feat(dashboard): processes chip strip replaces two-table panel`

---

### Task 9: Dashboard assembly — removals, QuickActions rework, layout, reveal FX

**Files:**
- Modify: `src/renderer/src/pages/Dashboard.tsx` (major rewrite)
- Modify: `src/renderer/src/index.css` (layout grids + reveal/scan FX)

**Interfaces:**
- Consumes: everything produced in Tasks 1-8 plus `useChatDrawer` (`openSession({ type: 'roadmap' })`), `trpc.benchmark.run` mutation, `trpc.graph.listProjects`, `useGraphBuildRun`.

- [ ] **Step 1: Rewrite `Dashboard.tsx`**

Keep: `TelemetryMarquee`, `StatusRow`, `StatRow`, `ActivityPanel`, `digestSnippet`, `fmtDuration`, `SignalCard`. Delete: `QuickActions`'s prompt-runner internals, `RecentActivity`, `SignalsSystem`, `DEFAULT_PROMPT`. The final file:

```tsx
import { compact, DrillLink, Note, num, pct, timeAgo } from '@renderer/components/dashboard/dash-utils'
import { BenchmarkWidget } from '@renderer/components/dashboard/BenchmarkWidget'
import { GalaxyHero } from '@renderer/components/dashboard/GalaxyHero'
import { KnowledgePulse } from '@renderer/components/dashboard/KnowledgePulse'
import { MissionClock } from '@renderer/components/dashboard/MissionClock'
import { ProcessesStrip } from '@renderer/components/dashboard/ProcessesStrip'
import { RoadmapNextUp } from '@renderer/components/dashboard/RoadmapNextUp'
import { Sparkline } from '@renderer/components/dashboard/Sparkline'
import { TokenHeatmap } from '@renderer/components/dashboard/TokenHeatmap'
import { ScrambleText } from '@renderer/components/fx/ScrambleText'
import { Ticker } from '@renderer/components/fx/Ticker'
import { PageHeader } from '@renderer/components/layout/PageHeader'
import { trpc } from '@renderer/lib/trpc'
import { useChatDrawer } from '@renderer/store/chatDrawer'
import { useGraphBuildRun } from '@renderer/store/graphBuildRun'
import { useNewsRun } from '@renderer/store/newsRun'
import { useTrendingRun } from '@renderer/store/trendingRun'
import { type Section, useUiStore } from '@renderer/store/ui'
import { type CSSProperties, useMemo } from 'react'
import { toast } from 'sonner'
```

(then, unchanged from today: `fmtDuration`, `digestSnippet`, `TelemetryMarquee`, `StatusRow`, `StatRow`, `ActivityPanel`, `SignalCard` — with `ActivityPanel`'s and `SignalCard`'s `ttl` spans wrapped in `<ScrambleText text="…" />`)

New `QuickActions`:

```tsx
// ── QUICK ACTIONS ──────────────────────────────────────────────────────────
// One-tap launchers only (the old inline prompt-runner is gone). Long runs use
// App-level run stores / the job registry, so they survive leaving the page.
function QuickActions() {
  const newsRun = useNewsRun()
  const trendingRun = useTrendingRun()
  const buildRun = useGraphBuildRun()
  const compile = trpc.knowledge.compileAll.useMutation({
    onSuccess: (rows) => {
      const ok = rows.filter((r) => r.status === 'compiled').length
      toast.success(
        `Compiled ${ok}/${rows.length} knowledge ${rows.length === 1 ? 'base' : 'bases'}`,
      )
    },
    onError: (e) => toast.error(e.message),
  })
  const benchmark = trpc.benchmark.run.useMutation({
    onSuccess: (r) => toast.success(`Benchmark started — ${r.total} runs queued`),
    onError: (e) => toast.error(e.message),
  })

  // Deep-map target: the project matching the sidebar selection, else the first.
  const projects = trpc.graph.listProjects.useQuery()
  const selectedProject = useUiStore((s) => s.selectedProject)
  const buildPath = useMemo(() => {
    const list = projects.data ?? []
    return (
      list.find((p) => p.project === selectedProject)?.projectPath ??
      list[0]?.projectPath ??
      null
    )
  }, [projects.data, selectedProject])

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="ttl">
          <ScrambleText text="quick actions" />
        </span>
        <span className="meta">$ atlas run</span>
      </div>
      <div className="panel-body dash-actions">
        <button type="button" className="btn" onClick={newsRun.start} disabled={newsRun.running}>
          ↻ {newsRun.running ? 'NEWS…' : 'AI NEWS'}
        </button>
        <button
          type="button"
          className="btn"
          onClick={trendingRun.start}
          disabled={trendingRun.running}
        >
          ↻ {trendingRun.running ? 'TRENDING…' : 'TRENDING'}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => compile.mutate()}
          disabled={compile.isPending}
        >
          ↻ {compile.isPending ? 'COMPILING…' : 'KNOWLEDGE'}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => buildPath && buildRun.start(buildPath)}
          disabled={!buildPath || buildRun.running}
        >
          ▶ {buildRun.running ? 'BUILDING…' : 'BUILD MAP'}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => benchmark.mutate({})}
          disabled={benchmark.isPending}
        >
          ▶ BENCHMARK
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => useChatDrawer.getState().openSession({ type: 'roadmap' })}
        >
          ◈ ROADMAP IDEA
        </button>
      </div>
    </div>
  )
}
```

New `SignalsPanel` (replaces `SignalsSystem`; `SignalCard` unchanged):

```tsx
// ── SIGNALS ────────────────────────────────────────────────────────────────
// External digest freshness only — the skills/plugins/system counters are gone.
function SignalsPanel() {
  const news = trpc.news.read.useQuery()
  const trending = trpc.trending.read.useQuery()
  return (
    <div className="panel">
      <div className="panel-head">
        <span className="ttl">
          <ScrambleText text="signals" />
        </span>
        <DrillLink to="news" label="news" />
      </div>
      <div className="panel-body">
        <SignalCard label="AI NEWS" to="news" updatedAt={news.data?.updatedAt} raw={news.data?.raw} />
        <SignalCard
          label="GITHUB TRENDING"
          to="news"
          updatedAt={trending.data?.updatedAt}
          raw={trending.data?.raw}
        />
      </div>
    </div>
  )
}
```

New page assembly:

```tsx
export function Dashboard() {
  return (
    <>
      <PageHeader
        num="01"
        title="DASHBOARD"
        description="Mission overview — the whole system at a glance."
      />
      <TelemetryMarquee />
      <div className="scroll">
        <div className="dash-reveal" style={{ '--i': 0 } as CSSProperties}>
          <StatusRow />
        </div>

        <div className="dash-hero-row mt-16">
          <div className="dash-reveal" style={{ '--i': 1 } as CSSProperties}>
            <GalaxyHero />
          </div>
          <div className="dash-side">
            <div className="dash-reveal" style={{ '--i': 2 } as CSSProperties}>
              <RoadmapNextUp />
            </div>
            <div className="dash-reveal" style={{ '--i': 3 } as CSSProperties}>
              <QuickActions />
            </div>
          </div>
        </div>

        <div className="dash-mid mt-16">
          <div className="dash-reveal" style={{ '--i': 4 } as CSSProperties}>
            <ActivityPanel />
          </div>
          <div className="dash-reveal" style={{ '--i': 5 } as CSSProperties}>
            <SignalsPanel />
          </div>
        </div>

        <div className="dash-widgets mt-16">
          <div className="dash-reveal" style={{ '--i': 6 } as CSSProperties}>
            <TokenHeatmap />
          </div>
          <div className="dash-reveal" style={{ '--i': 7 } as CSSProperties}>
            <KnowledgePulse />
          </div>
          <div className="dash-reveal" style={{ '--i': 8 } as CSSProperties}>
            <BenchmarkWidget />
          </div>
          <div className="dash-reveal" style={{ '--i': 9 } as CSSProperties}>
            <MissionClock />
          </div>
        </div>

        <div className="dash-reveal mt-16" style={{ '--i': 10 } as CSSProperties}>
          <ProcessesStrip />
        </div>

        <div className="dash-scan" aria-hidden />
      </div>
    </>
  )
}
```

Imports to drop with the removed code: `CLAUDE_MODELS`, `skipToken`, `formatDateTime`, `useState`, `ReactNode`. `trpc.agent.*` usage disappears entirely.

- [ ] **Step 2: Layout + FX CSS (append)**

```css
/* dashboard layout */
.dash-hero-row {
  display: grid;
  grid-template-columns: minmax(400px, 480px) minmax(0, 1fr);
  gap: 16px;
  align-items: stretch;
}
.dash-side { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.dash-side .dash-reveal:first-child { flex: 1; min-height: 0; }
.dash-side .dash-reveal:first-child .panel { height: 100%; }
.dash-mid { display: grid; grid-template-columns: 2fr minmax(0, 1fr); gap: 16px; }
.dash-actions { display: flex; flex-wrap: wrap; gap: 8px; }
@media (max-width: 1240px) {
  .dash-hero-row { grid-template-columns: 1fr; }
  .dash-mid { grid-template-columns: 1fr; }
  .dash-widgets { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

/* mount-time cascade: panels rise in with a stagger, one scanline sweeps down */
.dash-reveal {
  opacity: 0;
  transform: translateY(14px);
  animation: dash-reveal 0.55s cubic-bezier(0.22, 1, 0.36, 1) forwards;
  animation-delay: calc(var(--i, 0) * 60ms);
  min-width: 0;
}
@keyframes dash-reveal {
  to { opacity: 1; transform: none; }
}
.dash-scan {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  height: 2px;
  background: linear-gradient(90deg, transparent, var(--amber), transparent);
  box-shadow: 0 0 24px var(--amber);
  opacity: 0;
  animation: dash-scan 1.1s ease-out 0.1s 1;
  pointer-events: none;
  -webkit-app-region: no-drag;
  z-index: 40;
}
@keyframes dash-scan {
  0% { opacity: 0.8; transform: translateY(0); }
  100% { opacity: 0; transform: translateY(100vh); }
}
@media (prefers-reduced-motion: reduce) {
  .dash-reveal { animation: none; opacity: 1; transform: none; }
  .dash-scan { display: none; }
}
```

(`-webkit-app-region: no-drag` guards the Electron title-bar drag-region gotcha for a fixed element at `top: 0`.)

- [ ] **Step 3: Verify** — `pnpm typecheck && pnpm lint && pnpm test`; then `grep -n "agent\.\|RecentActivity\|SignalsSystem\|DEFAULT_PROMPT" src/renderer/src/pages/Dashboard.tsx`
Expected: all PASS; grep returns nothing.

- [ ] **Step 4: Commit** — `feat(dashboard): Dashboard 2.0 — galaxy hero layout, reveal FX, signals slim-down`

---

### Task 10: Prune the orphaned `agent` backend

The prompt-runner was the only renderer consumer of the `agent` router (verified: `grep -rn "agent\.run\|agent\.cancel\|agent\.openFile" src/renderer/src` matches only the old Dashboard code). After Task 9 the whole router is dead.

**Files:**
- Delete: `src/main/trpc/routers/agent.ts`
- Modify: `src/main/trpc/router.ts` (remove import at line 1 + `agent: agentRouter,` at line 26)
- Possibly modify: `src/shared/ipc-events.ts` (remove `AgentEvent` if unused elsewhere)

- [ ] **Step 1: Confirm dead**

Run: `grep -rn "trpc.agent\.\|agent\.run\|agentRouter" src/ e2e/ --include="*.ts" --include="*.tsx" | grep -v "src/main/trpc/routers/agent.ts" | grep -v router.ts`
Expected: no output. If ANYTHING matches, STOP and keep the router (report in the task summary instead of deleting).

- [ ] **Step 2: Delete router + registration**

Remove `src/main/trpc/routers/agent.ts`; in `src/main/trpc/router.ts` drop the import and the `agent: agentRouter,` entry.

- [ ] **Step 3: Sweep newly-orphaned symbols**

For each of `AgentEvent` (`src/shared/ipc-events.ts`), `saveMarkdown` (`src/main/services/files.ts`), `runClaude` (`src/main/services/claude.ts`): grep for remaining usage; delete ONLY if zero references remain. `revealInFinder` is used by the jobs router — keep. Do NOT touch the `events` DB table or the stats router (historical agent runs still render on Stats and in KPI tile [04]).

Run: `grep -rn "AgentEvent" src/ | grep -v ipc-events.ts` and same for `saveMarkdown`, `runClaude`.

- [ ] **Step 4: Verify** — `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit** — `chore(agent): remove orphaned agent.run backend (dashboard prompt-runner is gone)`

---

### Task 11: Full verification + smoke

- [ ] **Step 1: Full gates**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all PASS.

- [ ] **Step 2: e2e**

Run: `pnpm e2e`
Expected: PASS — specifically `Dashboard shows the processes panel` (app.spec.ts:209) and graph-crash.spec.ts (both assert the `processes` title text).

- [ ] **Step 3: Manual smoke (pnpm dev)**

Checklist:
- Dashboard mounts with the cascade reveal + one scan sweep; reduced-motion off.
- Galaxy hero: square, auto-rotating, pulse comets, HUD counts match `NODES/EDGES`, no reaction to hover/click/drag.
- NEXT UP rows click through to the Roadmap **board** view.
- Quick actions: BUILD MAP starts (job chip appears in Processes strip; leaving/returning to Dashboard doesn't kill it), BENCHMARK toasts, ROADMAP IDEA opens the drawer.
- Processes strip: idle line when quiet; chips + radar while running; history toggle shows last 10 with ↗.
- Widgets: heatmap renders 13 columns; knowledge/benchmark/clock show real data; clicks land on the right pages.
- Knowledge page → code graph tab → 3D view still works (Galaxy3D untouched behavior, all edge styles).

- [ ] **Step 4: Final commit if the smoke pass produced fixes** — `fix(dashboard): smoke-test follow-ups`
