# Graph Data Layer & DnD

> 33 nodes · cohesion 0.07

## Key Concepts

- **graph_nodes table** (12 connections) — `drizzle/0009_happy_krista_starr.sql`
- **graph_edges table** (11 connections) — `drizzle/0009_happy_krista_starr.sql`
- **Graph Indexer (indexer.ts)** (5 connections) — `docs/superpowers/specs/2026-07-01-project-intelligence-layer-design.md`
- **graph_nodes.id column** (3 connections) — `drizzle/0009_happy_krista_starr.sql`
- **RoadmapBoard Component** (3 connections) — `docs/superpowers/specs/2026-07-03-roadmap-kanban-board-design.md`
- **RoadmapItem type (shared/roadmap.ts)** (3 connections) — `docs/superpowers/specs/2026-07-03-roadmap-kanban-board-design.md`
- **Roadmap.tsx page** (3 connections) — `docs/superpowers/specs/2026-07-03-roadmap-kanban-board-design.md`
- **roadmap/store.ts (main service)** (3 connections) — `docs/superpowers/specs/2026-07-03-roadmap-kanban-board-design.md`
- **agent_sessions table (SQLite)** (3 connections) — `drizzle/0001_overrated_sir_ram.sql`
- **getSubgraphContext (context.ts)** (2 connections) — `docs/superpowers/specs/2026-07-01-project-intelligence-layer-design.md`
- **graph_edges.source column** (2 connections) — `drizzle/0009_happy_krista_starr.sql`
- **graph_edges.target column** (2 connections) — `drizzle/0009_happy_krista_starr.sql`
- **roadmapChat/seed.ts** (2 connections) — `docs/superpowers/specs/2026-07-01-project-intelligence-layer-design.md`
- **agent_turns table (SQLite)** (2 connections) — `drizzle/0001_overrated_sir_ram.sql`
- **roadmap_items table (SQLite)** (2 connections) — `drizzle/0007_calm_scrambler.sql`
- **@dnd-kit/core dependency** (1 connections) — `docs/superpowers/specs/2026-07-03-roadmap-kanban-board-design.md`
- **graph_edges.id column** (1 connections) — `drizzle/0009_happy_krista_starr.sql`
- **graph_edges.inferred column** (1 connections) — `drizzle/0009_happy_krista_starr.sql`
- **graph_edges.kind column** (1 connections) — `drizzle/0009_happy_krista_starr.sql`
- **graph_edges.meta column** (1 connections) — `drizzle/0009_happy_krista_starr.sql`
- **graph_edges.origin column** (1 connections) — `drizzle/0009_happy_krista_starr.sql`
- **graph_edges.project_path column** (1 connections) — `drizzle/0009_happy_krista_starr.sql`
- **graph_nodes.community column** (1 connections) — `drizzle/0009_happy_krista_starr.sql`
- **graph_nodes.kind column** (1 connections) — `drizzle/0009_happy_krista_starr.sql`
- **graph_nodes.label column** (1 connections) — `drizzle/0009_happy_krista_starr.sql`
- *... and 8 more nodes in this community*

## Relationships

- No strong cross-community connections detected

## Source Files

- `docs/superpowers/specs/2026-07-01-project-intelligence-layer-design.md`
- `docs/superpowers/specs/2026-07-03-roadmap-kanban-board-design.md`
- `drizzle/0001_overrated_sir_ram.sql`
- `drizzle/0004_slim_reaper.sql`
- `drizzle/0007_calm_scrambler.sql`
- `drizzle/0009_happy_krista_starr.sql`

## Audit Trail

- EXTRACTED: 66 (87%)
- INFERRED: 10 (13%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [[index]] to navigate.*