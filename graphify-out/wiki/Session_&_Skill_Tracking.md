# Session & Skill Tracking

> 68 nodes · cohesion 0.04

## Key Concepts

- **Benchmark Suite implementation plan** (10 connections) — `docs/superpowers/plans/2026-05-25-benchmark-suite.md`
- **Thin hooks JSONL buffer (~/agent-analytics)** (7 connections) — `docs/agent-productivity-tracker.md`
- **Productivity ingest service (transcript parser + jsonl reader)** (7 connections) — `docs/agent-productivity-tracker.md`
- **components/charts/ reusable toolkit (ChartFrame etc.)** (7 connections) — `docs/superpowers/plans/2026-05-24-charts-upgrade-phase1.md`
- **Charts Upgrade Phase 2 plan (brush + compare)** (7 connections) — `docs/superpowers/plans/2026-05-25-charts-upgrade-phase2.md`
- **Charts Upgrade Phase 3 plan (DayDrawer drilldown)** (6 connections) — `docs/superpowers/plans/2026-05-25-charts-upgrade-phase3.md`
- **ClaudePaths interface (AppPaths.claude namespace)** (6 connections) — `docs/superpowers/plans/2026-05-28-claude-paths-namespace.md`
- **Percentile-composite complexity (files/dirs/tools/skills/subagents), read-time** (5 connections) — `docs/superpowers/plans/2026-05-23-complexity-quality-metrics.md`
- **КПД Efficiency Metric plan (frozen-baseline replacement of percentile KPI)** (5 connections) — `docs/superpowers/plans/2026-05-24-kpd-efficiency-metric.md`
- **Productivity.tsx page** (4 connections) — `docs/agent-productivity-tracker.md`
- **productivity tRPC router** (4 connections) — `docs/agent-productivity-tracker.md`
- **batch.ts background orchestrator (benchmark_runs table)** (4 connections) — `docs/superpowers/plans/2026-05-25-benchmark-suite.md`
- **runner.ts claude headless SDK wrapper** (4 connections) — `docs/superpowers/plans/2026-05-25-benchmark-suite.md`
- **ClaudePaths Namespace Extraction plan (v2, 2026-05-28, adds computePaths())** (4 connections) — `docs/superpowers/plans/2026-05-28-claude-paths-namespace.md`
- **Complexity & Quality Metrics implementation plan** (4 connections) — `docs/superpowers/plans/2026-05-23-complexity-quality-metrics.md`
- **KPI = (score ?? 5.5) x complexity / (tokens/1M)** (4 connections) — `docs/superpowers/plans/2026-05-23-kpi-efficiency-metric.md`
- **KPI (Efficiency) Metric v1 plan — token-weighted percentile KPI** (4 connections) — `docs/superpowers/plans/2026-05-23-kpi-efficiency-metric.md`
- **Claude Code transcript (~/.claude/projects) as source of truth** (3 connections) — `docs/agent-productivity-tracker.md`
- **infra fingerprint (order-independent SHA-256 hash)** (3 connections) — `docs/superpowers/plans/2026-05-25-benchmark-suite.md`
- **benchmark tRPC router (run/progress/results/tasks)** (3 connections) — `docs/superpowers/plans/2026-05-25-benchmark-suite.md`
- **chartMeta.ts (series/caption/formula source of truth)** (3 connections) — `docs/superpowers/plans/2026-05-24-charts-upgrade-phase1.md`
- **Compare-previous-period ghost overlay** (3 connections) — `docs/superpowers/plans/2026-05-25-charts-upgrade-phase2.md`
- **ClaudePaths Namespace Extraction plan (v3, 2026-05-30, final)** (3 connections) — `docs/superpowers/plans/2026-05-30-claude-paths-namespace.md`
- **Quality = user_rating ?? 7 (manual rating UI)** (3 connections) — `docs/superpowers/plans/2026-05-23-complexity-quality-metrics.md`
- **Infra watcher (planned, unimplemented producer for ecosystem_changes)** (3 connections) — `docs/infra-change-timeline.md`
- *... and 43 more nodes in this community*

## Relationships

- No strong cross-community connections detected

## Source Files

- `README.md`
- `docs/agent-productivity-tracker.md`
- `docs/infra-change-timeline.md`
- `docs/superpowers/plans/2026-05-23-complexity-quality-metrics.md`
- `docs/superpowers/plans/2026-05-23-kpi-efficiency-metric.md`
- `docs/superpowers/plans/2026-05-24-charts-upgrade-phase1.md`
- `docs/superpowers/plans/2026-05-24-kpd-efficiency-metric.md`
- `docs/superpowers/plans/2026-05-25-benchmark-suite.md`
- `docs/superpowers/plans/2026-05-25-charts-upgrade-phase2.md`
- `docs/superpowers/plans/2026-05-25-charts-upgrade-phase3.md`
- `docs/superpowers/plans/2026-05-26-claude-paths-namespace.md`
- `docs/superpowers/plans/2026-05-28-claude-paths-namespace.md`
- `docs/superpowers/plans/2026-05-30-claude-paths-namespace.md`

## Audit Trail

- EXTRACTED: 165 (89%)
- INFERRED: 6 (3%)
- AMBIGUOUS: 14 (8%)

---

*Part of the graphify knowledge wiki. See [[index]] to navigate.*