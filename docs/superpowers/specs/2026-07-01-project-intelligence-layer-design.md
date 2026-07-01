# Project Intelligence Layer — Design

**Date:** 2026-07-01
**Status:** Approved (design), pending implementation plan

## Purpose

Give Atlas a structural, queryable map of each Atlas-tracked project's repository:
its source files and their import relationships, its docs and skills, and how those
connect to the knowledge base (`~/atlas-knowledge`) and the work sessions
(`agentSessions`). The graph is stored in SQLite, rendered in the Knowledge page as
a new tab (isolated per-project and unified all-projects views), and exposed to
agent prompts/skills as a token-bounded structured context excerpt.

This is a *code/project* graph — distinct from the existing knowledge-article graph
(`src/main/services/knowledge/graph.ts`, `./graph` tab), which stays as-is.

## Decisions (locked)

- **Renderer:** reuse the existing stack — `react-force-graph-2d` + `graphology-communities-louvain`. We do **not** invoke the `graphify` CLI/skill; the `safishamsi/graphify` reference is treated as "graphify-style" (clustered communities + honest EXTRACTED/INFERRED edge audit trail).
- **Placement:** a new tab inside the existing **Knowledge** page (alongside `browse/daily/search/graph`).
- **Project set:** `SELECT DISTINCT project_path FROM agent_sessions` (same source Productivity uses). No separate config.
- **Context provider:** a clean module + a tRPC procedure + one real demo integration into `roadmapChat/seed.ts`.
- **Scope:** everything below in one plan (indexer + schema/migration + tRPC + context provider + demo seed wiring + renderer with isolated & unified views + tests).

## Architecture

```
agentSessions/agentTurns (SQLite) ─┐
project repo (fs walk) ────────────┼─► indexer ─► assembleGraph (pure) ─► Louvain ─► graphNodes/graphEdges (SQLite)
~/atlas-knowledge/<project> ───────┘                                                        │
                                                        ┌───────────────────────────────────┼──────────────────────┐
                                              trpc/routers/graph.ts             services/graph/context.ts     CodeGraphTab (renderer)
                                              build / queryNeighbors /          getSubgraphContext →          react-force-graph-2d
                                              getProjectClusters /              seed.ts + graph.context       isolated + unified
                                              getGraph / listProjects           (tRPC)
```

Mirrors the `knowledge/graph.ts` split: a **pure graph assembler** (`assembleGraph`,
no fs, fully unit-testable) is separated from **fs/DB I/O** (`scanRepo` /
`indexProject`). Community detection reuses `graphology-communities-louvain`
exactly as `assignCommunities` does today.

## Data model

### Node kinds (`kind`)
- `code` — a JS/TS/JSX/TSX/PY source file
- `doc` — a markdown document (README, `docs/**/*.md`, etc.)
- `skill` — a `SKILL.md` file
- `knowledge` — an article from `~/atlas-knowledge/<project>` (concept/connection/qa)
- `session` — an `agentSessions` row for the project

### Edge kinds (`kind`) with honest audit flag `inferred`
- `imports` (code→code), `inferred=false` — parsed **and resolved relative** imports. Unresolved / external-package imports are dropped (kept out to avoid noise).
- `doc_link` (doc→code|doc), `false` — markdown `[text](relpath)` links that resolve to a repo file.
- `session_touched` (session→code), `false` — from `agent_turns.files_touched` for the session, filtered to files present in the graph.
- `mentions_knowledge` (code|doc→knowledge), `true` — a knowledge article's body mentions a file's basename (`indexer.ts`) or a `[[wikilink]]` that resolves to a repo path. Heuristic → flagged inferred.

### SQLite tables (Drizzle, new migration)

```
graphNodes
  id          text  PK   -- deterministic: `${projectPath}::${kind}::${key}`
  projectPath text  NOT NULL
  kind        text  NOT NULL           -- code | doc | skill | knowledge | session
  label       text  NOT NULL           -- display name (basename / article title / session label)
  relPath     text                     -- repo-relative path, article relPath, or session id
  meta        text  (json)             -- { lang?, ext?, size?, ... }
  community   integer                  -- filled by Louvain at build time (nullable)
  updatedAt   integer (timestamp_ms)   NOT NULL
  indexes: (projectPath), (kind)

graphEdges
  id          text  PK   -- `${source}|${target}|${kind}`
  projectPath text  NOT NULL           -- owning project (source's project) — for scoped cleanup
  source      text  NOT NULL
  target      text  NOT NULL
  kind        text  NOT NULL           -- imports | doc_link | session_touched | mentions_knowledge
  inferred    integer (bool) NOT NULL
  indexes: (projectPath), (source), (target)
```

**Idempotent rebuild:** on `buildGraph(projectPath)`, `DELETE FROM graphNodes/graphEdges WHERE project_path = ?`, then bulk insert. Edges are scoped by the *source* node's project so per-project cleanup is complete. Deterministic ids make re-runs stable.

**Safety caps:** ignore `node_modules`, `.git`, `out`, `dist`, `build`, `.venv`, `__pycache__`, `.next`, `coverage`, `release`, `test-results`; cap max files scanned and max file size (constants), logging what was skipped (graphify-style honesty).

## Indexer — `src/main/services/graph/indexer.ts`

Pure/fs split:
- `walkProject(projectPath)` → file list, honoring ignore set + caps.
- `parseImports(content, lang)` → raw specifiers. JS/TS: `import … from '…'`, `import '…'`, `export … from '…'`, `require('…')`, dynamic `import('…')`. Python: `import a.b`, `from a.b import c`.
- `resolveImport(fromFile, spec, fileSet)` → target repo file or `null`. Tries extensions `.ts/.tsx/.js/.jsx/.mjs/.cjs/.py`, directory `index.*`, and Python `__init__.py`; resolves TS path aliases best-effort from `tsconfig` `paths` if trivially present (else skip). Relative-only; bare specifiers → null (dropped).
- `collectDocs(files)` / `collectSkills(files)`.
- `assembleGraph(inputs)` — **pure**: takes `{ codeFiles, imports, docs, docLinks, skills, articles, sessions, sessionFiles }` and returns `{ nodes, edges }`. No fs, no DB. This is the primary unit-test target.
- `indexProject(projectPath)` — orchestrator: gathers fs inputs + `agentSessions/agentTurns` (SQLite) + knowledge articles (`~/atlas-knowledge` store), calls `assembleGraph`, runs Louvain to fill `community`, returns the graph for the router to persist.

## tRPC — `src/main/trpc/routers/graph.ts`

> Note: placed in `routers/` to match every other router (`router.ts` mounts them). This differs from the literal `src/main/trpc/graph.ts` path in the request.

- `buildGraph(projectPath: string)` — **mutation**: `indexProject` → persist (delete+insert) → return `{ nodes, edges, clusters, builtAt }` counts.
- `queryNeighbors(nodeId: string, depth: number)` — **query**: BFS up to `depth` (clamped, e.g. 1–3) → returns the induced subgraph `{ nodes, edges }`.
- `getProjectClusters(projectPath?: string)` — **query**: per-community summaries `{ community, size, dominantKind, topNodes[] }`.
- `getGraph({ scope: string })` — **query** (added; renderer needs a read): `scope` = a projectPath (isolated) or `'__all__'` (unified). Returns full `{ nodes, edges }` for that scope.
- `listProjects()` — **query**: distinct `project_path` from `agent_sessions` (+ whether a graph exists / `builtAt`), for the tab's project selector.

Shared zod schemas live in `src/shared/graph.ts` (`codeGraphNodeSchema`, `codeGraphEdgeSchema`, `codeGraphSchema`, cluster schema) — the single source of truth reused by router outputs and the renderer via type inference.

## Context provider — `src/main/services/graph/context.ts`

`getSubgraphContext({ projectPath, seedNodeId?, query?, depth = 1, budget })`:
- Resolves a seed node (by id, or by matching `query` against labels/relPaths).
- Walks neighbors up to `depth`, groups them by edge kind, adds the seed's cluster summary.
- Renders a **deterministic, token-bounded** markdown excerpt (truncates to `budget`), e.g.:
  ```
  ## Project graph context
  Seed: src/main/services/graph/indexer.ts (code, cluster 3)
  Imports → foo.ts, bar.ts
  Imported by ← router/graph.ts
  Touched by sessions → 2026-06-30 (sess abc…)
  Related knowledge → [[concepts/…]]
  ```
- Exposed via tRPC `graph.context` **and** wired as a demo into `roadmapChat/seed.ts`: when a `repoRoot` maps to an indexed project, append the excerpt (best-effort; silent no-op if no graph). This proves the integration path without touching every chat service.

## Renderer — new Knowledge tab

- New tab: id `code`, label `./code-graph`, added to `Knowledge.tsx` `TABS` + `Tab` union + `useUiStore` persistence (same pattern as `graph`).
- `src/renderer/src/pages/knowledge/CodeGraphTab.tsx`:
  - **Project selector** (from `listProjects`) + **view toggle**: *isolated* (selected project) / *unified* (`__all__`, all projects).
  - `react-force-graph-2d`: node **color by `kind`** (5-color legend); **cluster boundaries by `community`** (color grouping / hull, following the existing GraphTab approach). In unified view, projects naturally separate into island clusters (as noted in the knowledge-graph-view work).
  - **Build/Rebuild** button → `buildGraph` mutation, showing node/edge counts and last-built time (staleness hint).
  - Node click → side panel: kind, path, and neighbors from `queryNeighbors`; actions to open the file / knowledge article where applicable.
  - Empty state when a project has no graph yet ("Build the graph to index this project").

## Testing (vitest, style of `graph.test.ts`)

- `parseImports` / `resolveImport`: TS + Python fixtures (relative, index, `__init__.py`, extension resolution, bare-specifier drop).
- `assembleGraph`: node/edge construction for each edge kind; deterministic ids; `inferred` flags correct; `mentions_knowledge` basename/wikilink matching.
- Clustering: deterministic community assignment on a fixed small graph.
- `getSubgraphContext`: excerpt content + budget truncation + no-op when node absent.

## Out of scope (future iterations)

- Invoking the real `graphify` CLI / exporting `graph.json`.
- Incremental / watch-mode re-indexing (full rebuild per project for now).
- Auto-rebuild on session end; wiring context into *every* chat service (only `roadmapChat` demo here).
- External-package dependency nodes.
