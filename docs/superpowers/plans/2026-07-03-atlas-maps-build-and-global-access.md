# Atlas Maps — Full-cycle Build + Global Map Access — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One UI **Build** button runs the full graphify map cycle into the in-app 3D viz, and a new `~/atlas-maps/` store lets Claude reach each project's map (SessionStart injection + on-demand query) exactly like `~/atlas-knowledge`.

**Architecture:** A single streamed job (`graph.build`) runs four stages — structural index → `/graphify --wiki` (headless SDK) → merge semantic edges into SQLite → export artifacts to `~/atlas-maps/<project>/`. Two standalone Python scripts under `~/atlas-maps/_engine/` then surface that store to Claude: `session-start.py` injects a compact Map Index, `query.py` wraps `graphify query`.

**Tech Stack:** TypeScript (Electron main + tRPC + React renderer), `@anthropic-ai/claude-agent-sdk`, vitest, Playwright, the `graphify` CLI (`~/.local/bin/graphify`), Python 3 stdlib.

## Global Constraints

- All UI strings and agent-facing prompts are **English only** (only generated digest content may be non-English).
- Path guards must validate **every** path segment (the project/dir name too), never just a relPath — reject `.`, `..`, and separators.
- Store-root paths are never hardcoded: default under `homedir()`, overridable via env (`ATLAS_MAPS_STORE`), mirroring `ATLAS_KB_STORE`.
- Hooks in `~/.claude/settings.json` are **installed manually** — the plan ships the script + snippet; it must NOT auto-wire the hook.
- Commit after every task. Branch is `feat/atlas-maps` (already created).
- Knowledge-transparency: store-sourced context (the injected Map Index) must be labelled as coming from `~/atlas-maps/<project>/`.
- If a subagent sees a `git-commit-message` skill fire, ignore it — that skill targets Mako/KESHET, not atlas-os.

## File Structure

- `src/main/services/graph/mapStore.ts` **(new)** — store-root resolution + guarded per-project dir. One responsibility: where map files live, safely.
- `src/main/services/graph/mapExport.ts` **(new)** — pure Map-Index markdown generator + artifact export I/O.
- `src/main/services/graph/graphifyRunner.ts` **(modify)** — orchestrate the full four-stage build (was: graphify-only deep map).
- `src/main/trpc/routers/graph.ts` **(modify)** — rename the `deepMap` subscription to `build`, wired to the full-cycle runner.
- `src/renderer/src/pages/knowledge/CodeGraphTab.tsx` **(modify)** — collapse the two buttons into one **Build**.
- `~/atlas-maps/_engine/session-start.py` **(new, outside repo)** — inject the current project's Map Index.
- `~/atlas-maps/_engine/query.py` **(new, outside repo)** — on-demand subgraph query.
- `docs/atlas-maps-hook-install.md` **(new)** — the manual `settings.json` snippet + CLAUDE.md pointer.

---

### Task 1: `mapStore.ts` — guarded map store paths

**Files:**
- Create: `src/main/services/graph/mapStore.ts`
- Test: `src/main/services/graph/mapStore.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces:
  - `mapsRoot(): string`
  - `mapsProjectDir(projectPath: string): string` — returns `<mapsRoot>/<basename(projectPath)>`, throwing on a hostile basename.
  - `MAPS_RESERVED = '_engine'`

- [ ] **Step 1: Write the failing test**

```ts
// src/main/services/graph/mapStore.test.ts
import { homedir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { mapsProjectDir, mapsRoot } from './mapStore'

afterEach(() => {
  process.env.ATLAS_MAPS_STORE = undefined
})

describe('mapsRoot', () => {
  it('defaults to ~/atlas-maps', () => {
    process.env.ATLAS_MAPS_STORE = undefined
    expect(mapsRoot()).toBe(join(homedir(), 'atlas-maps'))
  })
  it('honors the ATLAS_MAPS_STORE override', () => {
    process.env.ATLAS_MAPS_STORE = '/tmp/maps-x'
    expect(mapsRoot()).toBe('/tmp/maps-x')
  })
})

describe('mapsProjectDir', () => {
  it('joins basename under the store root', () => {
    process.env.ATLAS_MAPS_STORE = '/tmp/maps-x'
    expect(mapsProjectDir('/Users/me/Projects/atlas-os')).toBe('/tmp/maps-x/atlas-os')
  })
  it('rejects a path whose basename escapes or hits the engine dir', () => {
    process.env.ATLAS_MAPS_STORE = '/tmp/maps-x'
    expect(() => mapsProjectDir('/Users/me/..')).toThrow()
    expect(() => mapsProjectDir('/Users/me/_engine')).toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/main/services/graph/mapStore.test.ts`
Expected: FAIL — "Cannot find module './mapStore'".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/main/services/graph/mapStore.ts
import { homedir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'

// The engine dir under the store — never a project.
export const MAPS_RESERVED = '_engine'

// Store root: env override, else ~/atlas-maps. Mirrors knowledge storeRoot();
// never hardcode the abspath.
export function mapsRoot(): string {
  return process.env.ATLAS_MAPS_STORE || join(homedir(), 'atlas-maps')
}

// Resolve `relPath` under `root` and assert it cannot escape (path traversal).
function assertInside(root: string, relPath: string): string {
  const base = resolve(root)
  const target = resolve(base, relPath)
  if (target !== base && !target.startsWith(base + sep)) {
    throw new Error(`path escapes root: ${relPath}`)
  }
  return target
}

// The per-project map dir: <mapsRoot>/<basename(projectPath)>. The basename is
// validated as a single safe segment so a hostile path can't escape the store
// root or collide with the engine dir.
export function mapsProjectDir(projectPath: string): string {
  const name = basename(projectPath)
  if (
    !name ||
    name === '.' ||
    name === '..' ||
    name === MAPS_RESERVED ||
    name.includes('/') ||
    name.includes('\\')
  ) {
    throw new Error(`invalid project for map store: ${name}`)
  }
  return assertInside(mapsRoot(), name)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/main/services/graph/mapStore.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/services/graph/mapStore.ts src/main/services/graph/mapStore.test.ts
git commit -m "feat(maps): guarded ~/atlas-maps store paths"
```

---

### Task 2: `mapExport.ts` — Map-Index generator + artifact export

**Files:**
- Create: `src/main/services/graph/mapExport.ts`
- Test: `src/main/services/graph/mapExport.test.ts`

**Interfaces:**
- Consumes: `mapsProjectDir` (Task 1); `summarizeClusters` from `./cluster`; `CodeGraph` from `@shared/graph`.
- Produces:
  - `shouldKeepArtifact(name: string): boolean`
  - `mapIndexMarkdown(project: string, graph: CodeGraph, builtAt: Date): string` — pure.
  - `exportMap(projectPath: string, graphifyOutDir: string, graph: CodeGraph): string` — copies kept artifacts into `<mapsProjectDir>/graphify-out/` and writes `index.md`; returns the project map dir.

- [ ] **Step 1: Write the failing test**

```ts
// src/main/services/graph/mapExport.test.ts
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CodeGraph } from '@shared/graph'
import { afterEach, describe, expect, it } from 'vitest'
import { exportMap, mapIndexMarkdown, shouldKeepArtifact } from './mapExport'

const graph: CodeGraph = {
  nodes: [
    { id: 'p::code::a', projectPath: 'p', kind: 'code', label: 'a.ts', relPath: 'a.ts', meta: null, community: 0, origin: 'indexer' },
    { id: 'p::code::b', projectPath: 'p', kind: 'code', label: 'b.ts', relPath: 'b.ts', meta: null, community: 0, origin: 'indexer' },
    { id: 'p::doc::x', projectPath: 'p', kind: 'doc', label: 'x.md', relPath: 'x.md', meta: null, community: 1, origin: 'graphify' },
  ],
  edges: [
    { id: 'e1', projectPath: 'p', source: 'p::code::a', target: 'p::code::b', kind: 'imports', inferred: false, origin: 'indexer', meta: null },
    { id: 'e2', projectPath: 'p', source: 'p::code::a', target: 'p::doc::x', kind: 'semantic', inferred: true, origin: 'graphify', meta: null },
  ],
}

afterEach(() => {
  process.env.ATLAS_MAPS_STORE = undefined
})

describe('shouldKeepArtifact', () => {
  it('keeps real artifacts, drops intermediates and cache', () => {
    expect(shouldKeepArtifact('graph.json')).toBe(true)
    expect(shouldKeepArtifact('wiki')).toBe(true)
    expect(shouldKeepArtifact('.graphify_ast.json')).toBe(false)
    expect(shouldKeepArtifact('cache')).toBe(false)
  })
})

describe('mapIndexMarkdown', () => {
  it('reports counts, date, and the highest-degree key node first', () => {
    const md = mapIndexMarkdown('atlas-os', graph, new Date('2026-07-03T00:00:00Z'))
    expect(md).toContain('# Map Index — atlas-os')
    expect(md).toContain('3 nodes · 2 edges · built 2026-07-03')
    // a.ts has degree 2 (highest) → it leads community 0's key nodes.
    const row = md.split('\n').find((l) => l.startsWith('| 0 |'))
    expect(row).toContain('a.ts')
  })
})

describe('exportMap', () => {
  it('copies kept artifacts and writes index.md under the store', () => {
    process.env.ATLAS_MAPS_STORE = join('/tmp', `maps-test-${process.pid}`)
    rmSync(process.env.ATLAS_MAPS_STORE, { recursive: true, force: true })
    const src = join('/tmp', `gout-${process.pid}`)
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'graph.json'), '{}')
    writeFileSync(join(src, '.graphify_ast.json'), '{}')
    const dir = exportMap('/x/atlas-os', src, graph)
    expect(existsSync(join(dir, 'graphify-out', 'graph.json'))).toBe(true)
    expect(existsSync(join(dir, 'graphify-out', '.graphify_ast.json'))).toBe(false)
    expect(readFileSync(join(dir, 'index.md'), 'utf8')).toContain('# Map Index — atlas-os')
    rmSync(process.env.ATLAS_MAPS_STORE, { recursive: true, force: true })
    rmSync(src, { recursive: true, force: true })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/main/services/graph/mapExport.test.ts`
Expected: FAIL — "Cannot find module './mapExport'".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/main/services/graph/mapExport.ts
import { cpSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { CodeGraph } from '@shared/graph'
import { summarizeClusters } from './cluster'
import { mapsProjectDir } from './mapStore'

// Artifacts worth keeping in the global store. graphify's `.graphify_*`
// intermediates and its `cache/` dir are intentionally excluded.
const KEEP: ReadonlySet<string> = new Set([
  'graph.json',
  'graph.html',
  'GRAPH_REPORT.md',
  'wiki',
])

export function shouldKeepArtifact(name: string): boolean {
  return KEEP.has(name)
}

// Undirected degree per node id, from the edge list.
function degrees(graph: CodeGraph): Map<string, number> {
  const d = new Map<string, number>()
  for (const e of graph.edges) {
    d.set(e.source, (d.get(e.source) ?? 0) + 1)
    d.set(e.target, (d.get(e.target) ?? 0) + 1)
  }
  return d
}

// Pure: render the compact, injectable Map Index for a project. Kept small to
// protect the session context budget — top 12 communities, 3 key nodes each.
export function mapIndexMarkdown(project: string, graph: CodeGraph, builtAt: Date): string {
  const clusters = summarizeClusters(graph)
  const deg = degrees(graph)
  const date = builtAt.toISOString().slice(0, 10)
  const lines: string[] = [`# Map Index — ${project}`, '']
  lines.push(`${graph.nodes.length} nodes · ${graph.edges.length} edges · built ${date}`, '')
  lines.push('| Community | Size | Dominant | Key nodes |', '|---|---|---|---|')
  for (const c of clusters.slice(0, 12)) {
    const key = graph.nodes
      .filter((n) => (n.community ?? 0) === c.community)
      .sort((a, b) => (deg.get(b.id) ?? 0) - (deg.get(a.id) ?? 0))
      .slice(0, 3)
      .map((n) => n.label)
      .join(', ')
    lines.push(`| ${c.community} | ${c.size} | ${c.dominantKind} | ${key} |`)
  }
  lines.push('')
  return lines.join('\n')
}

// Copy graphify's kept artifacts into the global store and write index.md.
// Returns the project's map dir. I/O only — markdown is built by the pure helper.
export function exportMap(projectPath: string, graphifyOutDir: string, graph: CodeGraph): string {
  const dir = mapsProjectDir(projectPath)
  const outDir = join(dir, 'graphify-out')
  mkdirSync(outDir, { recursive: true })
  let entries: string[] = []
  try {
    entries = readdirSync(graphifyOutDir)
  } catch {
    entries = [] // no graphify-out (e.g. graphify failed) → still write index.md
  }
  for (const name of entries) {
    if (!shouldKeepArtifact(name)) continue
    cpSync(join(graphifyOutDir, name), join(outDir, name), { recursive: true })
  }
  writeFileSync(
    join(dir, 'index.md'),
    mapIndexMarkdown(basename(projectPath), graph, new Date()),
    'utf8',
  )
  return dir
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/main/services/graph/mapExport.test.ts`
Expected: PASS (3 suites).

- [ ] **Step 5: Commit**

```bash
git add src/main/services/graph/mapExport.ts src/main/services/graph/mapExport.test.ts
git commit -m "feat(maps): Map Index generator + artifact export to the store"
```

---

### Task 3: `graphifyRunner.ts` — full four-stage build

**Files:**
- Modify: `src/main/services/graph/graphifyRunner.ts` (the `runGraphifyDeepMap` function, lines ~139-211; and the imports block, lines ~1-17)
- Test: `src/main/services/graph/graphifyRunner.test.ts` (existing merge tests must still pass — do not change them)

**Interfaces:**
- Consumes: `indexProject` from `./indexer`; `saveStructuralGraph`, `loadGraph`, `saveGraphifyGraph` from `./store`; `exportMap` from `./mapExport` (Task 2); existing `mergeGraphifyGraph`, `parseGraphifyJson` (same file).
- Produces: unchanged public shape — `runGraphifyDeepMap(opts: RunGraphifyOptions): GraphifyDeepMapRun`. Behavior now: index → `/graphify --wiki` → merge → export. Progress messages name each stage.

- [ ] **Step 1: Add the new imports**

At the top import block, add `indexProject` and `saveStructuralGraph`/`exportMap`. Change the existing store import line:

```ts
import { indexProject } from './indexer'
import { exportMap } from './mapExport'
import { loadGraph, saveGraphifyGraph, saveStructuralGraph } from './store'
```

(Replace the current `import { loadGraph, saveGraphifyGraph } from './store'` line with the three-symbol version above, and add the other two imports alongside it.)

- [ ] **Step 2: Change the graphify prompt to run the full pipeline**

Find:

```ts
    const prompt = `/graphify ${opts.projectPath} --no-viz`
```

Replace with:

```ts
    const prompt = `/graphify ${opts.projectPath} --wiki`
```

- [ ] **Step 3: Prepend the structural-index stage inside the `done` async body**

Immediately after `const done = (async (): Promise<void> => {` and before `const { query } = await import(...)`, insert:

```ts
    opts.emit({ type: 'progress', message: '1/4 indexing structure…' })
    const structural = indexProject(db(), opts.projectPath)
    saveStructuralGraph(db(), opts.projectPath, structural)
    if (stopped) return
    opts.emit({ type: 'progress', message: '2/4 running graphify (semantic + wiki)…' })
```

- [ ] **Step 4: Replace the merge/export tail (the block after the `for await` loop)**

Find the existing tail that starts at `if (stopped || failed) return` and ends at the `opts.emit({ type: 'done', … })` call, and replace the whole block with:

```ts
    if (stopped) return

    const graphifyOutDir = join(opts.projectPath, 'graphify-out')

    // graphify failed or produced nothing → still export a structural-only map so
    // the store + SessionStart hook aren't empty, then surface the error.
    if (failed) {
      exportMap(opts.projectPath, graphifyOutDir, loadGraph(db(), opts.projectPath))
      return
    }

    let raw: string
    try {
      raw = readFileSync(join(graphifyOutDir, 'graph.json'), 'utf8')
    } catch {
      opts.emit({ type: 'error', message: 'graphify produced no graph.json' })
      exportMap(opts.projectPath, graphifyOutDir, loadGraph(db(), opts.projectPath))
      return
    }

    opts.emit({ type: 'progress', message: '3/4 merging semantic edges…' })
    const additions = mergeGraphifyGraph(
      opts.projectPath,
      loadGraph(db(), opts.projectPath),
      parseGraphifyJson(raw),
    )
    saveGraphifyGraph(db(), opts.projectPath, additions)

    opts.emit({ type: 'progress', message: '4/4 exporting map to store…' })
    exportMap(opts.projectPath, graphifyOutDir, loadGraph(db(), opts.projectPath))

    opts.emit({
      type: 'done',
      nodesAdded: additions.nodes.length,
      edgesAdded: additions.edges.length,
    })
```

(The `db` symbol is already imported at the top of the file; `readFileSync` and `join` are already imported.)

- [ ] **Step 5: Run the existing runner tests + typecheck to verify nothing broke**

Run: `pnpm vitest run src/main/services/graph/graphifyRunner.test.ts && pnpm typecheck:node`
Expected: PASS — the pure merge tests are unchanged; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/main/services/graph/graphifyRunner.ts
git commit -m "feat(maps): Build runs full cycle — index, graphify --wiki, merge, export"
```

---

### Task 4: `graph.ts` router — `deepMap` → `build`

**Files:**
- Modify: `src/main/trpc/routers/graph.ts` (the `deepMap` subscription, lines ~101-142; the `deepRuns` comment; leave `buildGraph`, `cancelDeepMap`, and all queries as-is)

**Interfaces:**
- Consumes: `runGraphifyDeepMap` (Task 3, unchanged signature), `jobRegistry`, `getSettings`, `GraphDeepMapEvent`.
- Produces: a `build` subscription with the SAME input `{ requestId, projectPath }` and the SAME `GraphDeepMapEvent` stream the renderer already knows. Only the procedure NAME changes (`deepMap` → `build`). `cancelDeepMap` stays (the renderer's cancel path is unchanged).

- [ ] **Step 1: Rename the subscription procedure**

Find `deepMap: publicProcedure` and rename it to `build: publicProcedure`. Update the job label string from `` `Graphify deep map: ${input.projectPath}` `` to `` `Build map: ${input.projectPath}` ``. Everything else inside the subscription body (the `deepRuns` map, `runGraphifyDeepMap` call, event forwarding, cleanup) stays identical.

- [ ] **Step 2: Verify the router typechecks**

Run: `pnpm typecheck:node`
Expected: PASS. (The renderer still references `trpc.graph.deepMap` at this point — that's fixed in Task 5. `typecheck:node` covers only the main/tRPC side and must be clean now.)

- [ ] **Step 3: Commit**

```bash
git add src/main/trpc/routers/graph.ts
git commit -m "feat(maps): rename graph.deepMap subscription to graph.build"
```

---

### Task 5: `CodeGraphTab.tsx` — one Build button

**Files:**
- Modify: `src/renderer/src/pages/knowledge/CodeGraphTab.tsx`
- Test: `e2e/` — the existing Knowledge-graph e2e (find it with the grep in Step 1); assert the single Build button label.

**Interfaces:**
- Consumes: `trpc.graph.build.useSubscription` (Task 4), `trpc.graph.cancelDeepMap`, `trpc.graph.getGraph`, `trpc.graph.listProjects`.
- Produces: renderer UI only.

- [ ] **Step 1: Locate the e2e that covers this tab**

Run: `grep -rln "Deep map\|Build\|kb-graph\|CodeGraph\|not built" e2e/`
Expected: one or more `.spec.ts` files. Open the one asserting the graph tab controls (the brand strings `ATLAS.OS`, `● ok`, `04 KNOWLEDGE` and the graph tab are the anchors per project convention).

- [ ] **Step 2: Write/adjust the failing e2e assertion**

In that spec, where the graph tab is open, assert exactly one Build control and no separate deep-map button:

```ts
await expect(page.getByRole('button', { name: 'Build', exact: true })).toBeVisible()
await expect(page.getByRole('button', { name: 'Deep map via graphify' })).toHaveCount(0)
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm e2e -g "Build"` (or the spec's title)
Expected: FAIL — the current UI still shows "Deep map via graphify".

- [ ] **Step 4: Collapse the two buttons into one Build in the component**

Replace the structural `build` mutation, the `startDeepMap`/`stopDeepMap` deep-map wiring, and the two-button JSX. Concretely:

Delete the `const build = trpc.graph.buildGraph.useMutation({...})` block and the separate `status` usages tied to it. Rename the deep-map state to build state and point the subscription at `trpc.graph.build`:

```tsx
const [buildStatus, setBuildStatus] = useState('')
const [buildReqId, setBuildReqId] = useState<string | null>(null)
const cancelBuild = trpc.graph.cancelDeepMap.useMutation()

trpc.graph.build.useSubscription(
  { requestId: buildReqId ?? '', projectPath: activePath ?? '' },
  {
    enabled: Boolean(buildReqId && activePath),
    onData: (e) => {
      if (e.type === 'tool') setBuildStatus(`graphify: ${e.summary}`)
      else if (e.type === 'progress') setBuildStatus(e.message)
      else if (e.type === 'done') {
        setBuildStatus(`built: +${e.nodesAdded} nodes, +${e.edgesAdded} edges`)
        setBuildReqId(null)
        utils.graph.getGraph.invalidate()
        utils.graph.listProjects.invalidate()
      } else if (e.type === 'error') {
        setBuildStatus(`error: ${e.message}`)
        setBuildReqId(null)
      } else if (e.type === 'aborted') {
        setBuildStatus('build aborted')
        setBuildReqId(null)
      }
    },
    onError: (err) => {
      setBuildStatus(`error: ${err.message}`)
      setBuildReqId(null)
    },
  },
)

const startBuild = () => {
  if (!activePath) return
  setBuildStatus('starting build…')
  setBuildReqId(`build-${activePath}-${Date.now()}`)
}
const stopBuild = () => {
  if (buildReqId) cancelBuild.mutate({ requestId: buildReqId })
  setBuildReqId(null)
}
```

Then replace the controls JSX (the old `Build` button + the deep-map button + both status spans) with a single Build/Cancel pair and one status line:

```tsx
{buildReqId ? (
  <button type="button" className="btn" onClick={stopBuild}>
    Cancel
  </button>
) : (
  <button type="button" className="btn" disabled={!activePath} onClick={startBuild}>
    Build
  </button>
)}
<span className="kb-graph-status">{buildStatus}</span>
```

Remove the now-unused `status`/`setStatus` state and the empty-graph hint can stay as-is.

- [ ] **Step 5: Run e2e + web typecheck to verify pass**

Run: `pnpm typecheck:web && pnpm e2e -g "Build"`
Expected: PASS — one Build button, deep-map button gone, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/pages/knowledge/CodeGraphTab.tsx e2e/
git commit -m "feat(maps): collapse graph tab to a single full-cycle Build button"
```

---

### Task 6: `session-start.py` — inject the Map Index

**Files:**
- Create: `~/atlas-maps/_engine/session-start.py` (outside the repo)

**Interfaces:**
- Consumes: stdin JSON `{ "cwd": "<path>", ... }` from Claude Code's SessionStart hook; `ATLAS_MAPS_STORE` env (optional).
- Produces: stdout JSON `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"<index.md or empty>"}}`.

- [ ] **Step 1: Write the script**

```python
#!/usr/bin/env python3
"""SessionStart hook — inject the current project's graphify Map Index.

Resolves project = basename(cwd), reads <store>/<project>/index.md, and emits it
as additionalContext. Never raises into the session: any error → empty context.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

MAX_CHARS = 8000


def maps_root() -> Path:
    return Path(os.environ.get("ATLAS_MAPS_STORE") or (Path.home() / "atlas-maps"))


def build_context() -> str:
    try:
        data = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        data = {}
    cwd = data.get("cwd") or os.getcwd()
    project = os.path.basename(os.path.normpath(cwd))
    if not project or project in (".", "..", "_engine"):
        return ""
    index = maps_root() / project / "index.md"
    if not index.is_file():
        return ""
    body = index.read_text(encoding="utf-8")[:MAX_CHARS]
    return (
        f"## Project Map (from the map store ~/atlas-maps/{project}/)\n\n{body}"
    )


def main() -> None:
    try:
        context = build_context()
    except Exception:
        context = ""  # never break the session
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "additionalContext": context,
        }
    }))


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Verify injection with a fixture map (manual)**

```bash
mkdir -p /tmp/maps-x/demo-proj
printf '# Map Index — demo-proj\n\n5 nodes · 4 edges · built 2026-07-03\n' > /tmp/maps-x/demo-proj/index.md
echo '{"cwd":"/anywhere/demo-proj"}' | ATLAS_MAPS_STORE=/tmp/maps-x python3 ~/atlas-maps/_engine/session-start.py
```
Expected: JSON whose `additionalContext` contains `# Map Index — demo-proj` and the "from the map store" label.

- [ ] **Step 3: Verify empty-on-missing (manual)**

```bash
echo '{"cwd":"/anywhere/no-such-proj"}' | ATLAS_MAPS_STORE=/tmp/maps-x python3 ~/atlas-maps/_engine/session-start.py
```
Expected: `{"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": ""}}`.

- [ ] **Step 4: Commit (script lives outside the repo — copy a reference into the repo docs so it's version-controlled)**

```bash
mkdir -p docs/atlas-maps-engine
cp ~/atlas-maps/_engine/session-start.py docs/atlas-maps-engine/session-start.py
git add docs/atlas-maps-engine/session-start.py
git commit -m "feat(maps): SessionStart hook injects the project Map Index"
```

---

### Task 7: `query.py` — on-demand subgraph query

**Files:**
- Create: `~/atlas-maps/_engine/query.py` (outside the repo)

**Interfaces:**
- Consumes: argv `["<question>"]`; `cwd` (to resolve project) or `--project <name>`; `ATLAS_MAPS_STORE` env; the `graphify` binary on PATH.
- Produces: stdout — the answer text from `graphify query`, or a clear one-line error.

- [ ] **Step 1: Write the script**

```python
#!/usr/bin/env python3
"""On-demand map query — wraps `graphify query` against the stored map.

Usage: query.py "<question>" [--project <name>]
Resolves project = --project or basename(cwd); runs `graphify query` inside
<store>/<project>/ (which holds graphify-out/graph.json). Read-only.
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path


def maps_root() -> Path:
    return Path(os.environ.get("ATLAS_MAPS_STORE") or (Path.home() / "atlas-maps"))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("question")
    ap.add_argument("--project", default=None)
    ap.add_argument("--budget", type=int, default=1200)
    args = ap.parse_args()

    project = args.project or os.path.basename(os.path.normpath(os.getcwd()))
    if not project or project in (".", "..", "_engine"):
        print(f"query: invalid project '{project}'", file=sys.stderr)
        return 2
    proj_dir = maps_root() / project
    if not (proj_dir / "graphify-out" / "graph.json").is_file():
        print(f"query: no map for '{project}' (run Build in Atlas first)", file=sys.stderr)
        return 1
    try:
        proc = subprocess.run(
            ["graphify", "query", args.question, "--budget", str(args.budget)],
            cwd=str(proj_dir),
            capture_output=True,
            text=True,
            timeout=120,
        )
    except FileNotFoundError:
        print("query: graphify binary not found on PATH", file=sys.stderr)
        return 1
    sys.stdout.write(proc.stdout)
    if proc.returncode != 0:
        sys.stderr.write(proc.stderr)
    return proc.returncode


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Verify error path on a missing map (manual)**

```bash
ATLAS_MAPS_STORE=/tmp/maps-x python3 ~/atlas-maps/_engine/query.py "what connects auth and db" --project no-such-proj
echo "exit=$?"
```
Expected: stderr `query: no map for 'no-such-proj' …`, `exit=1`.

- [ ] **Step 3: Verify the happy path against a real built map (manual)**

After a real Build has run for a project (e.g. `nexus-os`, which already has `graphify-out/graph.json` — copy it into the store or run Build):

```bash
ATLAS_MAPS_STORE=/tmp/maps-x python3 ~/atlas-maps/_engine/query.py "overview" --project demo-proj
```
Expected: `graphify query` output, or the `no map` message if `demo-proj` has no `graphify-out/graph.json` yet (the fixture from Task 6 has only index.md). Use a project with a real `graph.json` to see a non-error answer.

- [ ] **Step 4: Commit the reference copy**

```bash
cp ~/atlas-maps/_engine/query.py docs/atlas-maps-engine/query.py
git add docs/atlas-maps-engine/query.py
git commit -m "feat(maps): on-demand query.py wrapping graphify query over the store"
```

---

### Task 8: Manual hook-install doc + CLAUDE.md pointer

**Files:**
- Create: `docs/atlas-maps-hook-install.md`

**Interfaces:**
- Consumes: nothing.
- Produces: the exact `~/.claude/settings.json` SessionStart snippet + the per-project CLAUDE.md block. Manual — nothing auto-wires.

- [ ] **Step 1: Write the doc**

````markdown
# Atlas Maps — manual hook install

The map store `~/atlas-maps/` is populated by the Atlas **Build** button. To let
Claude use it, wire the SessionStart hook manually (hooks are never auto-installed).

## 1. SessionStart injection

Add this entry to the `hooks.SessionStart` array in `~/.claude/settings.json`
(alongside the existing atlas-knowledge entry):

```json
{
  "hooks": [
    {
      "type": "command",
      "command": "python3 \"/Users/Roman.Neganov/atlas-maps/_engine/session-start.py\""
    }
  ]
}
```

## 2. On-demand query pointer (per project CLAUDE.md)

Add to each tracked project's `CLAUDE.md`:

```md
## Architecture map (atlas-maps)
- A compact Map Index for this project is injected at session start (from
  `~/atlas-maps/<project>/`).
- For deeper questions, run:
  `python3 ~/atlas-maps/_engine/query.py "<question>"`
  (from the repo root; resolves the project from cwd).
```
````

- [ ] **Step 2: Verify the snippet is valid JSON in isolation**

Run: `python3 -c "import json;json.loads(open('/dev/stdin').read())" <<'EOF'
{"hooks":[{"type":"command","command":"python3 \"/Users/Roman.Neganov/atlas-maps/_engine/session-start.py\""}]}
EOF`
Expected: no output, exit 0 (valid JSON).

- [ ] **Step 3: Commit**

```bash
git add docs/atlas-maps-hook-install.md
git commit -m "docs(maps): manual SessionStart hook install + CLAUDE.md pointer"
```

---

## Final verification

- [ ] Run the full unit suite: `pnpm test`
- [ ] Typecheck both projects: `pnpm typecheck`
- [ ] Lint: `pnpm lint`
- [ ] In `pnpm dev`, open Knowledge → graph, pick a project, click **Build**; watch the 4-stage status progress, confirm the 3D viz repopulates, and confirm `~/atlas-maps/<project>/{index.md, graphify-out/graph.json}` exist.
- [ ] Manually install the hook (Task 8), start a new Claude session in that repo, and confirm the Map Index appears in the injected context.

## Self-review notes (coverage against the spec)

- Spec Feature 1 (full-cycle Build → DB + artifacts): Tasks 3 (runner orchestration), 4 (router), 5 (single button). ✔
- Spec Feature 2 both mechanisms: Task 6 (inject) + Task 7 (query). ✔
- Global store `~/atlas-maps/<project>/`, env override, path guards: Tasks 1–2. ✔
- Current-project scope (basename): Tasks 1, 6, 7. ✔
- Manual hook install, CLAUDE.md pointer, knowledge-transparency label: Tasks 6 (label) + 8. ✔
- Store layout = verbatim graphify-out + generated index.md: Task 2 (`exportMap`). ✔
- Out-of-scope items (cross-project, MCP, auto-install, Neo4j) — not present in any task. ✔
- Deviation from spec: the spec mentioned "god-node helpers" — none exist on the TS side, so Task 2 derives key nodes by edge **degree** instead. Equivalent intent, real code.
