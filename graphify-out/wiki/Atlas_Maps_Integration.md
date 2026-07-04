# Atlas Maps Integration

> 19 nodes · cohesion 0.15

## Key Concepts

- **~/atlas-knowledge/_engine (shared per-project knowledge pipeline)** (7 connections) — `docs/superpowers/plans/2026-05-30-global-session-knowledge-store.md`
- **Knowledge UI implementation plan** (6 connections) — `docs/superpowers/plans/2026-05-30-knowledge-ui.md`
- **knowledge/store.ts (FS reads, traversal guard)** (4 connections) — `docs/superpowers/plans/2026-05-30-knowledge-ui.md`
- **SessionStart hook (lifecycle + config snapshot)** (3 connections) — `docs/agent-productivity-tracker.md`
- **project.py project-name resolution + registry (projects.json)** (3 connections) — `docs/superpowers/plans/2026-05-30-global-session-knowledge-store.md`
- **Knowledge.tsx page (Browse/Daily/Search tabs)** (3 connections) — `docs/superpowers/plans/2026-05-30-knowledge-ui.md`
- **knowledge tRPC router (projects/index/list/article/daily/query)** (3 connections) — `docs/superpowers/plans/2026-05-30-knowledge-ui.md`
- **~/atlas-maps/ map store** (2 connections) — `docs/atlas-maps-hook-install.md`
- **atlas-maps SessionStart hook injection** (2 connections) — `docs/atlas-maps-hook-install.md`
- **trackedProjects allowlist setting** (2 connections) — `docs/agent-productivity-tracker.md`
- **config.py env-based root resolution (ATLAS_KB_ROOT)** (2 connections) — `docs/superpowers/plans/2026-05-30-global-session-knowledge-store.md`
- **flush.py session flush (spawns compile from engine)** (2 connections) — `docs/superpowers/plans/2026-05-30-global-session-knowledge-store.md`
- **install.py idempotent hook installer (merges into ~/.claude/settings.json)** (2 connections) — `docs/superpowers/plans/2026-05-30-global-session-knowledge-store.md`
- **Global Session-Knowledge Store implementation plan** (2 connections) — `docs/superpowers/plans/2026-05-30-global-session-knowledge-store.md`
- **atlas-knowledge session-start.py hook (project-scoped KB injection)** (2 connections) — `docs/superpowers/plans/2026-05-30-global-session-knowledge-store.md`
- **MarkdownView.tsx (frontmatter header + wikilink rendering)** (2 connections) — `docs/superpowers/plans/2026-05-30-knowledge-ui.md`
- **runQuery() gated query.py runner (spends tokens, fires on submit only)** (2 connections) — `docs/superpowers/plans/2026-05-30-knowledge-ui.md`
- **src/shared/knowledge.ts (resolveWikilink, countInbound)** (2 connections) — `docs/superpowers/plans/2026-05-30-knowledge-ui.md`
- **atlas-maps query.py on-demand query** (1 connections) — `docs/atlas-maps-hook-install.md`

## Relationships

- No strong cross-community connections detected

## Source Files

- `docs/agent-productivity-tracker.md`
- `docs/atlas-maps-hook-install.md`
- `docs/superpowers/plans/2026-05-30-global-session-knowledge-store.md`
- `docs/superpowers/plans/2026-05-30-knowledge-ui.md`

## Audit Trail

- EXTRACTED: 50 (96%)
- INFERRED: 2 (4%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [[index]] to navigate.*