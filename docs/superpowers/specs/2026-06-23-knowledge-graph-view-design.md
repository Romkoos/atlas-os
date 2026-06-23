# Knowledge Graph View — Design

**Date:** 2026-06-23
**Status:** Approved (brainstorming) → ready for implementation plan

## Goal

Add an interactive graph view to the Knowledge page that renders the wiki-link
structure already present in `~/atlas-knowledge`. Two primary uses, in priority order:

1. **Navigation** — see a map, click a node to read its article, jump along links.
2. **Overview** — understand the whole picture: which concepts are hubs, how
   topics cluster, how dense each project's knowledge is.

Gap-finding (dangling links to unwritten articles) is a secondary benefit,
surfaced via ghost nodes but not the headline feature.

## Context

The knowledge store holds ~150 `.md` files across projects (`atlas-os`,
`mako3.0`, `shorts`, `player-mako`, `plugins`, `FE-claude-infra`,
`Roman.Neganov`, …). Each project has `knowledge/concepts/`,
`knowledge/connections/`, and `daily/`. A real link graph already exists but is
only browsable as a flat file list today:

- **concept → concept** via `## Related Concepts` (`[[concepts/foo]]`)
- **concept → daily** via `sources:` frontmatter / `## Sources`
- **connections/** nodes that bridge two concepts
- frontmatter: `title`, `aliases`, `tags`, `sources`, `created`, `updated`

Existing code to reuse:
- `src/main/services/knowledge/store.ts` — article parsing, `inboundLinks`,
  `articleKind`, and crucially `resolveWikilink(link, articles)` (match order:
  exact path → filename slug → alias).
- `src/main/trpc/routers/knowledge.ts` — the `knowledge` router (add one
  procedure here).
- `src/shared/knowledge.ts` — Zod schemas (`articleMetaSchema`,
  `knowledgeProjectSchema`, etc.); add graph schemas here.
- `src/renderer/src/pages/Knowledge.tsx` — the page that gets a List/Graph toggle.
- `react-markdown` (already used on Knowledge) for the side-panel article render.

## Chosen approach (Variant A)

Backend computes the full graph **and** communities; frontend renders with
`react-force-graph-2d`. Heavy work (parsing 150 files, Louvain clustering) runs
once in the main process, matching the project's "all domain logic in main"
architecture. The renderer stays thin: it receives `{nodes, edges}` and draws.

Rejected alternatives:
- **B (d3-force + svg on frontend):** more hand-written code (drag/zoom/collision),
  SVG slower than canvas, still needs a clustering lib. Parsing must be in main
  regardless (renderer has no fs access).
- **C (offline via `graphify` skill):** static HTML/JSON, not interactive, extra
  agent run for what should be live navigation. Kept as a possible future enrich.

New dependencies (main process): `graphology`, `graphology-communities-louvain`
(lightweight, pure JS). Renderer: `react-force-graph-2d`.

## Data model

### Nodes (`type`)
- `concept` — `knowledge/concepts/*.md`
- `connection` — `knowledge/connections/*.md`
- `daily` — `daily/*.md`
- `ghost` — a `[[link]]` target with no matching file (unwritten article)

Node fields: `id`, `label` (frontmatter `title`, else filename), `type`,
`project`, `inDegree`, `tags`, `updated`, `relPath`, `community` (cluster id).

### Edges (`type`)
- `link` — a `[[wiki-link]]` from article body (solid line)
- `source` — concept → daily, from `sources:` frontmatter / `## Sources`
  (dashed line)

### Link resolution
Wiki-links in the store are project-relative (`[[concepts/foo]]`,
`[[daily/2026-06-09.md]]`), so resolution happens **within a project** using the
existing `resolveWikilink`. Node `id` is namespaced by project to keep
same-named concepts in different projects distinct, e.g.
`atlas-os::concepts/claude-paths-namespace-refactoring`.

**Known limitation (accepted for v1):** because links are project-relative,
cross-project edges will be rare — projects appear as separate islands colored
by community. This is itself informative (shows isolation). Cross-project
"shared concept" edges are a v2 candidate.

## Backend

New procedure `knowledge.graph` in `src/main/trpc/routers/knowledge.ts`:

- Walks all tracked projects (reuse the store's existing project/article
  traversal).
- Parses frontmatter + body wiki-links (regex `\[\[…\]\]`), reusing
  `resolveWikilink`. Builds nodes/edges; creates `ghost` nodes for unresolved
  link targets.
- Computes `inDegree` per node and `community` per node via Louvain
  (`graphology` graph → `communities-louvain`). Runs per-component on a
  disconnected graph (fine).
- Returns the **entire** graph in one query (`{nodes, edges}`); project/type
  filtering happens client-side (the graph is small).
- The graph builder is a **pure function** (`buildGraph(articles, daily)` →
  `{nodes, edges}`) decoupled from the tRPC wrapper and from Louvain, so it is
  unit-testable on fixtures. Community assignment is a separate pure step.

New Zod schemas in `src/shared/knowledge.ts`: `graphNodeSchema`,
`graphEdgeSchema`, `knowledgeGraphSchema` (`{nodes, edges}`), with the procedure
`.output(knowledgeGraphSchema)`.

## Frontend

List/Graph toggle on the Knowledge page; List stays unchanged. Graph mode
reuses the page's existing project selection and search.

- `react-force-graph-2d` (canvas) — force layout, zoom/pan, click/hover built in.
- Node **size** = `inDegree`; node **color** = `community`, with a toggle
  **color by: community / project**.
- `ghost` nodes — dashed outline, dimmed.
- **Side-panel:** click a node → render its article via `react-markdown`
  (reusing Knowledge's existing article fetch, `knowledge.article`); links
  inside the article are clickable and recenter the graph on the target node.
- **Hover:** highlight node + neighbors, dim the rest; tooltip (title, tags,
  updated).
- **Filters panel:** type checkboxes (hide `daily`), "this project only" select,
  search box that zooms to the matched node.

## Error handling / edge cases

- Broken/unresolved link → `ghost` node, never throw.
- Empty store / no links → empty graph with a placeholder message.
- Node with no frontmatter → `label` falls back to filename.
- Self-links and duplicate edges → deduped.
- Louvain on a disconnected graph → resolves per component (expected).

## Testing

- **Unit (graph builder):** fixture of a few `.md` files — verify link
  resolution, ghost-node creation, `source` edges, dedup, `inDegree`.
- **Unit (communities):** Louvain yields stable community ids on a fixture.
- **e2e (Playwright):** toggling List→Graph renders the canvas; clicking a node
  opens the side-panel with the article body.

## Out of scope (v1 — YAGNI)

- Cross-project "shared concept" edges
- "Freshness" decay (dimming stale nodes)
- Graph export
- `graphify` skill integration
- Temporal animation / timeline scrubbing
