# Knowledge UI — Handoff for the Next Agent

**Date:** 2026-05-30
**Status:** Handoff brief. Backend is DONE; this is the UI follow-up. NOT yet brainstormed/approved.
**Read first:**
- `docs/superpowers/specs/2026-05-30-global-session-knowledge-store-design.md` (the backend design + "Next: UI" section)
- `docs/superpowers/plans/2026-05-30-global-session-knowledge-store.md` (what was built)

> **Start with the brainstorming skill, not implementation.** This is a brief, not an approved spec. Confirm scope with Roman (especially the open questions at the bottom) before writing a plan.

## One-paragraph context

A global, per-project knowledge base now exists at `~/atlas-knowledge/<project>/knowledge/` — produced by a Python pipeline (hooks → flush → compile) that runs on every Claude Code session. It is **markdown files**, not a database. This task: surface that knowledge **inside the atlas-os Electron app** so Roman can browse what each project has learned. This is a *separate* concern from atlas-os's existing **productivity metrics** (tokens/efficiency) — don't conflate them; they share the "per-project" idea and nothing else.

## What the data looks like (the source of truth)

```
~/atlas-knowledge/<project>/knowledge/
├── index.md          # markdown table: | [[link]] | summary | sources | updated |
├── log.md            # append-only build log
├── concepts/*.md     # atomic concept articles (YAML frontmatter + body + [[wikilinks]])
└── connections/*.md  # cross-concept insight articles (same shape)
└── qa/*.md           # filed query answers (optional)
```

Article frontmatter (example):
```yaml
---
title: "Player-Mako Integration API Surface"
aliases: [player-mako]
tags: [player, video, api]
sources: ["daily/2026-04-13.md"]
created: 2026-04-13
updated: 2026-04-14
---
# <title>
<2-4 sentence core> ## Key Points … ## Details … ## Related Concepts (- [[concepts/x]]) … ## Sources
```

Projects are discoverable from the folder names under `~/atlas-knowledge/` (skip the reserved `_engine/`). The mapping basename→abspath is in `~/atlas-knowledge/_engine/projects.json`.

The store root is `~/atlas-knowledge` by default (overridable via `ATLAS_KB_STORE` env). Use `os.homedir()` + `atlas-knowledge`; do not hardcode the absolute path.

## How atlas-os is structured (reuse these patterns)

From the codebase exploration (verify before relying):
- **tRPC routers (main process):** `src/main/trpc/routers/*.ts`. Closest analog: `src/main/trpc/routers/productivity.ts` — query + mutation patterns, `discoverProjects`/project-filter logic, `appPaths()` from `src/main/paths.ts` for userData. Register new routers in the root router (find where `productivity` is composed).
- **Renderer pages:** `src/renderer/src/pages/*.tsx`. Closest analog: `src/renderer/src/pages/Productivity.tsx` (tabbed page, project-aware). `Info.tsx` renders markdown-ish content and may have a markdown renderer to reuse. `groupByPrefix` from `@shared/skills` groups by prefix (used in the benchmark compare panel) — handy if you group concepts.
- **Shared types:** `src/shared/*.ts` (Zod schemas, no runtime). Add a `knowledge.ts` schema here if needed.
- **Markdown rendering:** check what `Info.tsx` / the renderer already uses before adding a markdown lib. Match it.
- **Tech:** Electron + React 19 + TS + Tailwind 4 + tRPC 11 + Drizzle/SQLite. Biome for lint (no semicolons, single quotes, 2-space — match existing files).

## Suggested shape (for the brainstorm to refine)

**Backend — new tRPC router `knowledge` (`src/main/trpc/routers/knowledge.ts`):**
- `knowledge.projects()` → list of `{ name, path, articleCount, lastUpdated }` by scanning `~/atlas-knowledge/*/knowledge/` (skip `_engine`). Respect the existing `trackedProjects` allowlist if it makes sense.
- `knowledge.index(project)` → parsed index rows (or raw `index.md`).
- `knowledge.article(project, relPath)` → `{ frontmatter, body }` for a `concepts/x.md` / `connections/x.md`.
- `knowledge.list(project)` → article metadata (title, tags, kind, updated, inbound-link count) for browsing.
- *(optional, later)* `knowledge.query(project, q)` → shell out to `~/atlas-knowledge/_engine/scripts/query.py` (`uv run --directory <engine> python scripts/query.py <q>` with `ATLAS_KB_ROOT=<root>` env). This spends API tokens — gate behind an explicit user action, never auto-run.

**Frontend — new page/tab `Knowledge` (`src/renderer/src/pages/Knowledge.tsx`):**
- Project selector (reuse Productivity's project picker).
- Left: list/tree of concepts + connections (group by tag or prefix). Right: rendered article with working `[[wikilink]]` navigation (resolve a wikilink `concepts/x` to the article route).
- Show frontmatter (tags, sources, updated). Render `index.md` as the landing view.
- v1 is **read-only**. No editing of KB files from the UI (the pipeline owns them).

## Constraints / gotchas

- **Read-only first.** The Python pipeline is the writer; the UI must not write into `knowledge/` (avoid races with `flush`/`compile`).
- **Files, not DB, for v1.** Reading markdown on demand is fine at this scale (dozens of articles). Only consider indexing into `atlas.db` if search/perf demands it — and confirm with Roman first (YAGNI).
- **No hardcoded user path.** Resolve `~/atlas-knowledge` via `homedir()` (+ honor `ATLAS_KB_STORE`).
- **`query.py` costs money** and needs `uv` + Anthropic auth. Treat it as an explicit, gated feature, not core browsing.
- **Wikilinks** look like `[[concepts/shorts-scroll]]` — resolve relative to `<project>/knowledge/`. Some links may be dangling (article not yet compiled) — render as disabled.
- Match Biome formatting so the pre-commit `pnpm lint && pnpm typecheck` gate passes first try.

## Open questions for Roman (resolve in brainstorm before planning)

1. **New top-level page or a tab inside the existing Productivity page?** (separate "Knowledge" nav item vs. a tab)
2. **v1 scope:** browse-only, or include the `query.py` search box from the start?
3. **Project list:** all projects under `~/atlas-knowledge/`, or only `trackedProjects`?
4. **Daily logs:** surface raw `daily/*.md` too, or only the compiled `knowledge/`?
5. Any want for a "compile now" / "lint" button (would shell out to the engine, spends tokens)?

## Definition of done (proposed)

Roman can open atlas-os, pick a project, browse its concepts/connections with rendered markdown and working wikilinks, all read-only, with lint+typecheck green. No writes to the KB. Search optional per Q2.
