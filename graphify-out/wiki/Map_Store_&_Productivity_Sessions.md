# Map Store & Productivity Sessions

> 52 nodes · cohesion 0.05

## Key Concepts

- **Thin hooks JSONL buffer (~/agent-analytics)** (7 connections) — `docs/agent-productivity-tracker.md`
- **Productivity ingest service (transcript parser + jsonl reader)** (7 connections) — `docs/agent-productivity-tracker.md`
- **~/atlas-knowledge/_engine (shared per-project knowledge pipeline)** (7 connections) — `docs/superpowers/plans/2026-05-30-global-session-knowledge-store.md`
- **ClaudePaths interface (AppPaths.claude namespace)** (6 connections) — `docs/superpowers/plans/2026-05-28-claude-paths-namespace.md`
- **Knowledge UI implementation plan** (6 connections) — `docs/superpowers/plans/2026-05-30-knowledge-ui.md`
- **Percentile-composite complexity (files/dirs/tools/skills/subagents), read-time** (5 connections) — `docs/superpowers/plans/2026-05-23-complexity-quality-metrics.md`
- **Productivity.tsx page** (4 connections) — `docs/agent-productivity-tracker.md`
- **productivity tRPC router** (4 connections) — `docs/agent-productivity-tracker.md`
- **ClaudePaths Namespace Extraction plan (v2, 2026-05-28, adds computePaths())** (4 connections) — `docs/superpowers/plans/2026-05-28-claude-paths-namespace.md`
- **Complexity & Quality Metrics implementation plan** (4 connections) — `docs/superpowers/plans/2026-05-23-complexity-quality-metrics.md`
- **KPI = (score ?? 5.5) x complexity / (tokens/1M)** (4 connections) — `docs/superpowers/plans/2026-05-23-kpi-efficiency-metric.md`
- **KPI (Efficiency) Metric v1 plan — token-weighted percentile KPI** (4 connections) — `docs/superpowers/plans/2026-05-23-kpi-efficiency-metric.md`
- **knowledge/store.ts (FS reads, traversal guard)** (4 connections) — `docs/superpowers/plans/2026-05-30-knowledge-ui.md`
- **SessionStart hook (lifecycle + config snapshot)** (3 connections) — `docs/agent-productivity-tracker.md`
- **Claude Code transcript (~/.claude/projects) as source of truth** (3 connections) — `docs/agent-productivity-tracker.md`
- **ClaudePaths Namespace Extraction plan (v3, 2026-05-30, final)** (3 connections) — `docs/superpowers/plans/2026-05-30-claude-paths-namespace.md`
- **Quality = user_rating ?? 7 (manual rating UI)** (3 connections) — `docs/superpowers/plans/2026-05-23-complexity-quality-metrics.md`
- **project.py project-name resolution + registry (projects.json)** (3 connections) — `docs/superpowers/plans/2026-05-30-global-session-knowledge-store.md`
- **Infra watcher (planned, unimplemented producer for ecosystem_changes)** (3 connections) — `docs/infra-change-timeline.md`
- **Knowledge.tsx page (Browse/Daily/Search tabs)** (3 connections) — `docs/superpowers/plans/2026-05-30-knowledge-ui.md`
- **knowledge tRPC router (projects/index/list/article/daily/query)** (3 connections) — `docs/superpowers/plans/2026-05-30-knowledge-ui.md`
- **~/atlas-maps/ map store** (2 connections) — `docs/atlas-maps-hook-install.md`
- **atlas-maps SessionStart hook injection** (2 connections) — `docs/atlas-maps-hook-install.md`
- **agent_sessions table** (2 connections) — `docs/agent-productivity-tracker.md`
- **agent_turns table** (2 connections) — `docs/agent-productivity-tracker.md`
- *... and 27 more nodes in this community*

## Relationships

- No strong cross-community connections detected

## Source Files

- `docs/agent-productivity-tracker.md`
- `docs/atlas-maps-hook-install.md`
- `docs/infra-change-timeline.md`
- `docs/superpowers/plans/2026-05-23-complexity-quality-metrics.md`
- `docs/superpowers/plans/2026-05-23-kpi-efficiency-metric.md`
- `docs/superpowers/plans/2026-05-24-kpd-efficiency-metric.md`
- `docs/superpowers/plans/2026-05-26-claude-paths-namespace.md`
- `docs/superpowers/plans/2026-05-28-claude-paths-namespace.md`
- `docs/superpowers/plans/2026-05-30-claude-paths-namespace.md`
- `docs/superpowers/plans/2026-05-30-global-session-knowledge-store.md`
- `docs/superpowers/plans/2026-05-30-knowledge-ui.md`

## Audit Trail

- EXTRACTED: 132 (94%)
- INFERRED: 7 (5%)
- AMBIGUOUS: 2 (1%)

---

*Part of the graphify knowledge wiki. See [[index]] to navigate.*