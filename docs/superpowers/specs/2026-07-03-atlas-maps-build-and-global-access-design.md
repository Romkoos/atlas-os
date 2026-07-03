# Atlas Maps — Full-cycle Build + Global Map Access for Claude — Design

**Date:** 2026-07-03
**Status:** Approved (design), pending implementation plan

## Purpose

Two capabilities on top of the existing project-graph feature
(`src/main/services/graph/`, the Knowledge → graph tab):

1. **One-button full-cycle Build.** From the UI, a single **Build** button runs the
   complete map pipeline — structural index + graphify semantic pass (with viz +
   wiki) + artifact export + DB merge — so a *complete* map ends up in the in-app
   3D visualization, no separate "Deep map" step.
2. **Global map access for Claude.** Claude working in any tracked project can reach
   that project's map the same way it reaches the knowledge base: a **SessionStart
   hook** injects a compact "Map Index", and an on-demand **query** tool pulls
   relevant subgraphs. Exact parity with the `~/atlas-knowledge` pipeline.

These two features share one seam: a new global map store `~/atlas-maps/` that
**Feature 1 writes** and **Feature 2 reads**.

## Context (current state)

- The Knowledge → graph tab (`CodeGraphTab.tsx`) has **two** buttons today:
  - `Build` → `graph.buildGraph` → `indexProject()` structural index (fast, no LLM),
    saved as the **`indexer`** DB layer.
  - `Deep map via graphify` → `graph.deepMap` subscription → `runGraphifyDeepMap()`
    runs `/graphify <path> --no-viz` headless via the Agent SDK, parses
    `graphify-out/graph.json`, merges semantic edges as the **`graphify`** DB layer.
- The visualization reads the **merged SQLite graph** (`graph.getGraph`, scoped by
  `projectPath` or `__all__`), *not* `graph.json` directly.
- Because the current runner passes `--no-viz`, graphify's own artifacts
  (`GRAPH_REPORT.md`, `wiki/`, `graph.html`) are never produced; `graph.json` is a
  throwaway intermediate. In `atlas-os` the run never even completed (only
  intermediate `graphify-out/.graphify_*.json` files exist, no `graph.json`).
- Knowledge global access (the pattern Feature 2 mirrors): store at
  `~/atlas-knowledge/<project>/knowledge/index.md`; a Python engine at
  `~/atlas-knowledge/_engine/` with `hooks/session-start.py` (injects the current
  project's Knowledge Index into context) and `scripts/query.py` (on-demand
  read-only semantic query). Hooks are registered in `~/.claude/settings.json` and,
  per standing policy, are **reinstalled manually only**.

## Decisions (locked)

- **Feature 1 Build scope:** one button = full cycle → **DB + filesystem artifacts**.
  Runs structural index, then `/graphify <path> --wiki` (drop `--no-viz`, keep viz +
  add wiki), then exports artifacts to the global store, then merges semantic edges
  into the DB the in-app viz reads.
- **Feature 2 access:** **both** mechanisms — passive SessionStart injection **and**
  on-demand query — for full knowledge parity.
- **Feature 2 scope:** **current project only** (knowledge parity). In project A,
  Claude gets project A's map. Global in *storage location*, not cross-project search.
- **Map store location:** a new global store **`~/atlas-maps/<project>/`**, sibling of
  `~/atlas-knowledge`. `<project>` = `basename(projectPath)`, matching
  `listGraphProjects`.
- **Store layout:** graphify's `graphify-out/` is copied **verbatim** under
  `~/atlas-maps/<project>/graphify-out/` so `graphify query` works out-of-the-box;
  a generated compact **`index.md`** sits at `~/atlas-maps/<project>/index.md` for
  injection.
- **Store-root override:** `~/atlas-maps` is the default, overridable via an env var
  (`ATLAS_MAPS_STORE`), mirroring `ATLAS_KB_STORE` / `storeRoot()`.
- **Hook install is manual:** the spec ships `session-start.py` + a
  `~/.claude/settings.json` snippet; wiring is left to the user (no auto-install).
- **Knowledge-transparency:** the injected Map Index is store-sourced, so hook output
  is labelled as coming from the map store.

## Architecture

```
                         Feature 1 (writes)                         Feature 2 (reads)
 ┌───────────────────────────────────────────────────┐   ┌──────────────────────────────────┐
 CodeGraphTab  ─►  graph.build (streamed job)          │   │  ~/atlas-maps/_engine/
   [Build]           1. indexProject()  ─► indexer layer│   │    session-start.py ─► inject    │
                     2. /graphify <path> --wiki  (SDK)  │   │      ~/atlas-maps/<proj>/index.md │
                        └► <repo>/graphify-out/          │   │    query.py  ─► graphify query    │
                     3. exportMap() ──────────────────► ~/atlas-maps/<project>/                 │
                        (copy graphify-out/ + gen index.md) graphify-out/{graph.json,           │
                     4. mergeGraphifyGraph() ─► graphify layer          GRAPH_REPORT.md, wiki/} │
                        └► SQLite ─► getGraph ─► 3D viz  │   │             index.md              │
 └───────────────────────────────────────────────────┘   └──────────────────────────────────┘
                                                             registered in ~/.claude/settings.json
                                                             (SessionStart) — manual install
```

The pure/IO split of the existing graph service is preserved: `mergeGraphifyGraph`,
`summarizeClusters`, and the god-node helpers stay pure and unit-tested; new I/O
(artifact copy, index generation) is isolated in one module.

## Feature 1 — Full-cycle Build

### Pipeline stages (single streamed job)

```
Build ─┬─ 1. indexProject(db, path) + saveStructuralGraph()   → indexer layer
       ├─ 2. /graphify <path> --wiki   (Agent SDK, headless)  → <repo>/graphify-out/
       │        (drop --no-viz; add --wiki)                      graph.json, GRAPH_REPORT.md, wiki/
       ├─ 3. exportMap(path, graphifyOutDir)                   → ~/atlas-maps/<project>/
       └─ 4. mergeGraphifyGraph() + saveGraphifyGraph()        → graphify layer → 3D viz
```

### Units

- **`graphifyRunner.ts` (extend).** Change the prompt from `/graphify <path> --no-viz`
  to `/graphify <path> --wiki`. Keep the existing SDK streaming, `jobRegistry`, and
  cancel/abort machinery. After the merge step, call `exportMap()`. Extend the
  `GraphDeepMapEvent` progress messages to name the four stages.
- **`mapStore.ts` (new).** `mapsRoot()` (env override `ATLAS_MAPS_STORE` → default
  `~/atlas-maps`), `projectDir(path)` = `join(mapsRoot(), basename(path))`, with the
  same path-segment validation used by the knowledge store (`assertInside`, project
  name regex) so a hostile `basename` can't escape the store root.
- **`mapExport.ts` (new).** `exportMap(projectPath, graphifyOutDir)`:
  1. Copy `graphifyOutDir` → `~/atlas-maps/<project>/graphify-out/` (skip the
     `.graphify_*` intermediates and `cache/`; keep `graph.json`, `GRAPH_REPORT.md`,
     `graph.html`, `wiki/`).
  2. Generate `~/atlas-maps/<project>/index.md` from the merged graph via
     `summarizeClusters()` + god-node helpers (see index format below).
  The index-generation core is pure over a `CodeGraph` (unit-testable); only the
  copy/write is I/O.
- **`graph.ts` router (change).** The `deepMap` subscription becomes **`build`**: one
  streamed job running stages 1–4. `buildGraph` (structural-only mutation) may remain
  for internal/test use but is no longer surfaced as a separate button.
- **`CodeGraphTab.tsx` (change).** Collapse the two buttons into a single **Build**
  (+ a **Cancel** while running) driven by the `build` subscription; one status line
  reports the current stage. `onData: 'done'` invalidates `getGraph` + `listProjects`.

### Failure handling

Each stage emits progress. If graphify produces no `graph.json` (the atlas-os failure
mode), stages 1 (structural) and any partial artifacts from stage 2 still persist, and
the error surfaces in the status line — never a silently-empty `graphify-out/`. Merge
and export are guarded so a missing/parse-failed `graph.json` degrades to
"structural-only, semantic pass failed: <reason>" rather than throwing.

### `index.md` (injectable Map Index) format

Compact, mirroring the Knowledge Base Index table. Kept small to protect the session
context budget:

```markdown
# Map Index — <project>

<N> nodes · <M> edges · built <YYYY-MM-DD>

| Community | Size | Cohesion | Key nodes (god nodes) |
|-----------|------|----------|-----------------------|
| <label>   | <n>  | <0.xx>   | <top nodes>           |
...
```

## Feature 2 — Global map access for Claude

Mirror the `~/atlas-knowledge/_engine` pipeline under `~/atlas-maps/_engine/`.

### Units

- **`~/atlas-maps/_engine/session-start.py` (new).** On SessionStart: resolve
  `cwd → basename → ~/atlas-maps/<project>/index.md`; if it exists, print it as
  `additionalContext`, prefixed so its origin (the map store) is explicit. If no map
  exists, inject nothing (parity with knowledge when there's no index). Read-only,
  no network, fast.
- **`~/atlas-maps/_engine/query.py` (new).** `query.py "<question>"`: read-only,
  token-budgeted, wraps `graphify query` against
  `~/atlas-maps/<project>/graphify-out/graph.json` (resolve project from `cwd`).
  Returns a relevant subgraph / traversal answer. No `--file-back`.
- **`~/.claude/settings.json` SessionStart hook entry (manual).** Spec provides the
  exact snippet (same shape as the existing knowledge `session-start.py` entry). The
  user pastes it; no auto-wiring.
- **CLAUDE.md pointer.** A short "Architecture map" block per tracked project telling
  Claude the Map Index is injected and `atlas-maps query "<question>"` is available —
  so Claude knows the on-demand tool exists.

### Knowledge-transparency

The injected Map Index and any `query.py` output are store-sourced. Per the global
knowledge-transparency rule, when Claude uses this data it states it came from the map
store and names `~/atlas-maps/<project>/`.

## Out of scope (YAGNI)

- Cross-project / relevance-ranked map search (explicitly deferred — current-project
  parity only).
- MCP server exposure of the map (`graphify --mcp`) — the query.py wrapper covers the
  on-demand need without a long-running server.
- Auto-installing the SessionStart hook from Atlas (standing policy: manual only).
- Neo4j / GraphML / SVG exports.
- Rebuilding or replacing graphify itself — we drive the existing skill unchanged
  aside from flags (`--no-viz` → `--wiki`).

## Testing

- **`mapExport.ts`:** unit-test the pure `index.md` generator over a fixture
  `CodeGraph` (communities, god nodes, counts, date). Test the copy filter (intermediates
  excluded, artifacts included) against a temp dir.
- **`mapStore.ts`:** unit-test `projectDir` path validation (traversal / hostile
  basename rejected), env override.
- **`graphifyRunner.ts`:** existing tests updated for the `--wiki` prompt and the
  added export stage (mock the SDK + fs as today).
- **`graph.ts` router:** the `build` subscription streams stage progress and terminal
  `done`/`error`/`aborted`; missing-`graph.json` path yields structural-only + error.
- **`session-start.py` / `query.py`:** small script tests — index injected when present,
  nothing injected when absent; query resolves cwd→project and rejects a missing map.
- **e2e (`CodeGraphTab`):** single Build button present; brand strings unchanged.

## Affected files

- `src/main/services/graph/graphifyRunner.ts` (extend)
- `src/main/services/graph/mapStore.ts` (new)
- `src/main/services/graph/mapExport.ts` (new)
- `src/main/trpc/routers/graph.ts` (deepMap → build)
- `src/renderer/src/pages/knowledge/CodeGraphTab.tsx` (two buttons → one)
- `src/shared/ipc-events.ts` (`GraphDeepMapEvent` stage messages, if extended)
- `~/atlas-maps/_engine/session-start.py` (new, outside repo)
- `~/atlas-maps/_engine/query.py` (new, outside repo)
- `~/.claude/settings.json` snippet (manual, documented)
- per-project `CLAUDE.md` "Architecture map" block (documented)
