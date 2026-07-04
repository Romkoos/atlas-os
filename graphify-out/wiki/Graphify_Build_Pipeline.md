# Graphify Build Pipeline

> 39 nodes · cohesion 0.06

## Key Concepts

- **graphifyRunner four-stage full-cycle build (index/graphify/merge/export)** (5 connections) — `docs/superpowers/plans/2026-07-03-atlas-maps-build-and-global-access.md`
- **ChatSessionRegistry (session records + event buffer + reattach)** (5 connections) — `docs/superpowers/plans/2026-07-02-chat-resume.md`
- **graph tRPC router (buildGraph/queryNeighbors/deepMap)** (5 connections) — `docs/superpowers/plans/2026-07-01-project-intelligence-layer.md`
- **graph store (saveStructuralGraph/saveGraphifyGraph/loadGraph)** (5 connections) — `docs/superpowers/plans/2026-07-01-project-intelligence-layer.md`
- **Galaxy3D reusable 3D renderer (react-force-graph-3d)** (4 connections) — `docs/superpowers/plans/2026-07-01-knowledge-graph-3d-galaxy.md`
- **generalChat tRPC router** (4 connections) — `docs/superpowers/plans/2026-07-02-general-chat.md`
- **walkProject()/indexProject() repo indexer orchestration** (4 connections) — `docs/superpowers/plans/2026-07-01-project-intelligence-layer.md`
- **CodeGraphTab single Build button UI** (3 connections) — `docs/superpowers/plans/2026-07-03-atlas-maps-build-and-global-access.md`
- **graph.build subscription (renamed from deepMap)** (3 connections) — `docs/superpowers/plans/2026-07-03-atlas-maps-build-and-global-access.md`
- **mapStore.ts guarded ~/atlas-maps store paths** (3 connections) — `docs/superpowers/plans/2026-07-03-atlas-maps-build-and-global-access.md`
- **roadmapChat router migrated onto ChatSessionRegistry** (3 connections) — `docs/superpowers/plans/2026-07-02-chat-resume.md`
- **CodeGraphTab 2D/3D toggle integration** (3 connections) — `docs/superpowers/plans/2026-07-01-knowledge-graph-3d-galaxy.md`
- **computeGraph() (buildGraph + assignCommunities)** (3 connections) — `docs/superpowers/plans/2026-06-23-knowledge-graph-view.md`
- **GraphTab.tsx (./graph tab, react-force-graph-2d)** (3 connections) — `docs/superpowers/plans/2026-06-23-knowledge-graph-view.md`
- **knowledge.graph tRPC query** (3 connections) — `docs/superpowers/plans/2026-06-23-knowledge-graph-view.md`
- **CodeGraphTab.tsx code/project graph renderer** (3 connections) — `docs/superpowers/plans/2026-07-01-project-intelligence-layer.md`
- **mapExport.ts (mapIndexMarkdown + exportMap)** (2 connections) — `docs/superpowers/plans/2026-07-03-atlas-maps-build-and-global-access.md`
- **generalChat router migrated onto ChatSessionRegistry** (2 connections) — `docs/superpowers/plans/2026-07-02-chat-resume.md`
- **skillImprover router migrated onto ChatSessionRegistry (reattach-only)** (2 connections) — `docs/superpowers/plans/2026-07-02-chat-resume.md`
- **GraphTab 2D/3D toggle integration** (2 connections) — `docs/superpowers/plans/2026-07-01-knowledge-graph-3d-galaxy.md`
- **startGeneralChat() run service** (2 connections) — `docs/superpowers/plans/2026-07-02-general-chat.md`
- **clusterGraph() + summarizeClusters() Louvain clustering** (2 connections) — `docs/superpowers/plans/2026-07-01-project-intelligence-layer.md`
- **getSubgraphContext() token-bounded agent-prompt excerpts** (2 connections) — `docs/superpowers/plans/2026-07-01-project-intelligence-layer.md`
- **runGraphifyDeepMap() headless graphify session runner** (2 connections) — `docs/superpowers/plans/2026-07-01-project-intelligence-layer.md`
- **query.py on-demand subgraph query wrapper** (1 connections) — `docs/superpowers/plans/2026-07-03-atlas-maps-build-and-global-access.md`
- *... and 14 more nodes in this community*

## Relationships

- No strong cross-community connections detected

## Source Files

- `docs/superpowers/plans/2026-06-23-knowledge-graph-view.md`
- `docs/superpowers/plans/2026-07-01-knowledge-graph-3d-galaxy.md`
- `docs/superpowers/plans/2026-07-01-project-intelligence-layer.md`
- `docs/superpowers/plans/2026-07-02-chat-resume.md`
- `docs/superpowers/plans/2026-07-02-general-chat.md`
- `docs/superpowers/plans/2026-07-03-atlas-maps-build-and-global-access.md`

## Audit Trail

- EXTRACTED: 88 (98%)
- INFERRED: 2 (2%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [[index]] to navigate.*