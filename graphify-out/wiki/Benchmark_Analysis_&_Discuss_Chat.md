# Benchmark Analysis & Discuss Chat

> 54 nodes · cohesion 0.04

## Key Concepts

- **useUiStore persisted zustand store (section/project/tabs)** (6 connections) — `docs/superpowers/plans/2026-06-23-global-project-and-persisted-nav.md`
- **ChatSessionRegistry (session records + event buffer + reattach)** (5 connections) — `docs/superpowers/plans/2026-07-02-chat-resume.md`
- **Roadmap.tsx orchestrator (List⇄Board toggle)** (5 connections) — `docs/superpowers/plans/2026-07-03-roadmap-kanban-board.md`
- **startImproverRun() SDK session service** (5 connections) — `docs/superpowers/plans/2026-06-08-skill-editor-improver.md`
- **benchmark batch run loop (phase, retry sweep, notification)** (4 connections) — `docs/superpowers/plans/2026-06-17-benchmark-post-run-experience.md`
- **benchmarkChat tRPC router (start/reply/cancel)** (4 connections) — `docs/superpowers/plans/2026-06-17-benchmark-post-run-experience.md`
- **generalChat tRPC router** (4 connections) — `docs/superpowers/plans/2026-07-02-general-chat.md`
- **skillImprover tRPC router** (4 connections) — `docs/superpowers/plans/2026-06-08-skill-editor-improver.md`
- **UnifiedChatDrawer teaches the skillImprover type (adaptive width)** (4 connections) — `docs/superpowers/plans/2026-07-02-skill-improver-into-drawer.md`
- **UnifiedChatDrawer component (tab strip + FAB)** (4 connections) — `docs/superpowers/plans/2026-07-02-unified-chat-drawer.md`
- **startBenchmarkChat() streaming discussion driver** (3 connections) — `docs/superpowers/plans/2026-06-17-benchmark-post-run-experience.md`
- **RoadmapBoard Kanban component (@dnd-kit)** (3 connections) — `docs/superpowers/plans/2026-07-03-roadmap-kanban-board.md`
- **SkillEditorPane component (editor/preview split)** (3 connections) — `docs/superpowers/plans/2026-06-08-skill-editor-improver.md`
- **skills tRPC router (list/get)** (3 connections) — `docs/superpowers/specs/2026-05-22-skills-section-design.md`
- **chatDrawer zustand store (sessions/tabs, id===type)** (3 connections) — `docs/superpowers/plans/2026-07-02-unified-chat-drawer.md`
- **buildAnalysisPrompt / runAnalysis one-shot A/B analyzer** (2 connections) — `docs/superpowers/plans/2026-06-17-benchmark-post-run-experience.md`
- **benchmark_analysis DB table** (2 connections) — `docs/superpowers/plans/2026-06-17-benchmark-post-run-experience.md`
- **subscriptionEnv() shared OAuth env helper** (2 connections) — `docs/superpowers/plans/2026-06-17-benchmark-post-run-experience.md`
- **benchmarkChat router migrated onto ChatSessionRegistry** (2 connections) — `docs/superpowers/plans/2026-07-02-chat-resume.md`
- **generalChat router migrated onto ChatSessionRegistry** (2 connections) — `docs/superpowers/plans/2026-07-02-chat-resume.md`
- **skillImprover router migrated onto ChatSessionRegistry (reattach-only)** (2 connections) — `docs/superpowers/plans/2026-07-02-chat-resume.md`
- **chatDrawer gains generalChat session type + FAB/'+' entry points** (2 connections) — `docs/superpowers/plans/2026-07-02-general-chat.md`
- **GeneralChatOverlay headless drawer body** (2 connections) — `docs/superpowers/plans/2026-07-02-general-chat.md`
- **startGeneralChat() run service** (2 connections) — `docs/superpowers/plans/2026-07-02-general-chat.md`
- **RoadmapDetail unified two-column detail panel** (2 connections) — `docs/superpowers/plans/2026-07-03-roadmap-kanban-board.md`
- *... and 29 more nodes in this community*

## Relationships

- No strong cross-community connections detected

## Source Files

- `docs/superpowers/plans/2026-06-08-skill-editor-improver.md`
- `docs/superpowers/plans/2026-06-17-benchmark-post-run-experience.md`
- `docs/superpowers/plans/2026-06-23-global-project-and-persisted-nav.md`
- `docs/superpowers/plans/2026-07-02-chat-resume.md`
- `docs/superpowers/plans/2026-07-02-general-chat.md`
- `docs/superpowers/plans/2026-07-02-skill-improver-into-drawer.md`
- `docs/superpowers/plans/2026-07-02-unified-chat-drawer.md`
- `docs/superpowers/plans/2026-07-03-roadmap-kanban-board.md`
- `docs/superpowers/specs/2026-05-22-skills-section-design.md`

## Audit Trail

- EXTRACTED: 113 (98%)
- INFERRED: 2 (2%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [[index]] to navigate.*