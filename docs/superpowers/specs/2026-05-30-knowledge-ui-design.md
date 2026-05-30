# Knowledge UI — Design Spec

**Date:** 2026-05-30
**Status:** Approved design. Supersedes the open questions in `2026-05-30-knowledge-ui-handoff.md`.
**Backend:** DONE (Python pipeline at `~/atlas-knowledge/_engine/`). This spec covers the atlas-os UI follow-up.

## Goal

Surface the global per-project knowledge base (`~/atlas-knowledge/<project>/knowledge/`) inside the atlas-os Electron app, read-only, so Roman can browse what each project has learned. This is a **separate concern** from the existing productivity metrics — own nav item, own router, no shared data.

## Resolved decisions (from brainstorm)

1. **Placement:** new top-level `Knowledge` nav item (not a Productivity tab).
2. **v1 scope:** browse **and** a gated `query.py` search box.
3. **Project list:** only `trackedProjects` (empty allowlist = show all, mirroring productivity).
4. **Daily logs:** surface raw `daily/*.md` as a separate sub-view, alongside compiled `knowledge/`.
5. **No write buttons:** no "compile now" / "lint" / file-back. The Python pipeline owns all writes.

## Source-of-truth layout (verified on disk)

```
~/atlas-knowledge/<project>/
├── daily/*.md            # per-project raw conversation logs (immutable source)
├── knowledge/
│   ├── index.md          # markdown table: | [[link]] | summary | sources | updated |
│   ├── log.md            # append-only build log
│   ├── concepts/*.md     # atomic concept articles (YAML frontmatter + body + [[wikilinks]])
│   ├── connections/*.md  # cross-concept insight articles (same shape)
│   └── qa/*.md           # filed query answers (optional)
└── state/
```

- Store root: `process.env.ATLAS_KB_STORE || join(homedir(), 'atlas-knowledge')`. **Never** hardcode the abspath.
- Projects = folder names under the store, **skip `_engine/`**.
- `_engine/projects.json` maps `basename → abspath` (e.g. `"atlas-os": "/Users/.../atlas-os"`).
- **Current state: all `knowledge/` dirs are empty** (freshly bootstrapped). Only daily logs exist. Empty states are a first-class requirement, not an afterthought.
- Article frontmatter: `title, aliases[], tags[], sources[], created, updated`. Body: `# <title>` + core + `## Key Points / Details / Related Concepts / Sources`.

## Project identity & the `trackedProjects` filter

`trackedProjects` (in settings) stores **absolute project paths** (matching `agentTurns.projectPath`); productivity derives `project = basename(path)`. Knowledge store dirs are named by basename. To honor "only tracked":

1. List store dirs (skip `_engine`).
2. For each basename, resolve its abspath via `_engine/projects.json`.
3. Keep it if that abspath ∈ `trackedProjects`. **Empty `trackedProjects` ⇒ keep all** (consistent with `trackedCondition()`).

This automatically filters the self-referential `atlas-os-aa778f` dir (its abspath is `~/atlas-knowledge/atlas-os`, not a real tracked project path). If `projects.json` lacks a basename, fall back to including it only when the allowlist is empty (can't prove it's tracked).

## Architecture

Thin file-reading tRPC router (no DB). Parse frontmatter in the main process with `js-yaml`; render markdown in the renderer with the already-present `react-markdown` + `remark-gfm`. No new dependencies.

### Backend — `src/main/trpc/routers/knowledge.ts`

Register as `knowledge` in `src/main/trpc/router.ts`.

Helpers (module-local):
- `storeRoot(): string` — `process.env.ATLAS_KB_STORE || join(homedir(), 'atlas-knowledge')`.
- `loadProjectsJson(): Record<string,string>` — basename→abspath; `{}` if missing/unparseable.
- `trackedAbspaths(): Set<string>` — from `getSettings().trackedProjects ?? []`.
- `projectRoot(project): string` and `knowledgeDir(project): string` — joined, then **assert the resolved real path stays within the store** (path-traversal guard). Reject `project` containing `/`, `..`, or `_engine`.
- `safeRelPath(project, relPath): string` — resolve under `knowledgeDir`/`projectRoot`, assert containment; reject traversal.
- `parseArticle(absPath): { frontmatter, body }` — split leading `---\n…\n---`, `js-yaml.load` the frontmatter, remainder = body. Missing frontmatter ⇒ `frontmatter: {}`.

Procedures (all `publicProcedure`, Zod-validated I/O, types from `@shared/knowledge`):

| Procedure | Input | Output |
|---|---|---|
| `projects` | — | `{ name, path, articleCount, dailyCount, lastUpdated }[]` |
| `index` | `{ project }` | `{ raw: string }` (raw `index.md`, `''` if absent) |
| `list` | `{ project }` | `ArticleMeta[]` for concepts+connections+qa |
| `article` | `{ project, relPath }` | `{ frontmatter, body }` |
| `daily` | `{ project }` | `{ date, relPath }[]` (sorted desc) |
| `dailyArticle` | `{ project, relPath }` | `{ raw: string }` |
| `query` | `{ project, q }` | `{ answer: string }` |

- `ArticleMeta = { relPath, kind: 'concept'|'connection'|'qa', title, tags: string[], updated: string|null, inboundLinks: number }`.
  - `kind` from the subdir. `title` from frontmatter (fallback: filename). `inboundLinks` = count of other articles whose body contains `[[<thisRelPathWithoutExt>]]` or `[[concepts/<slug>]]`. Compute by scanning all bodies once per `list` call (dozens of files — fine).
- `query` shells `query.py` **without `--file-back`** (read-only):
  - `spawn`/`execFile` `uv run --directory <store>/_engine python scripts/query.py <q>`, env `{ ...process.env, ATLAS_KB_ROOT: projectRoot(project) }`.
  - Capture stdout = answer. Surface non-zero exit / missing `uv` as a tRPC error with a readable message (renderer shows it). Reasonable timeout (e.g. 120s).
  - This is the only procedure that costs API tokens; it runs **only** on explicit user submit.

### Shared types — `src/shared/knowledge.ts`

Zod schemas + inferred types: `ArticleMeta`, `ArticleKind`, `KnowledgeProject`, `ArticleDoc` (`{ frontmatter: Record<string, unknown>, body: string }`), `DailyEntry`. No runtime side effects (matches the `src/shared/*` convention).

### Frontend — `src/renderer/src/pages/Knowledge.tsx`

New top-level nav entry (follow the existing nav registration — mirror how `Productivity` is wired into the router/nav). `PageHeader` with the next `num`.

Layout:
- **Project picker** at top — reuse the Productivity project-picker pattern (driven by `knowledge.projects`). If no projects: empty state ("No tracked projects with a knowledge base yet").
- **Sub-tabs:** `Browse` (default), `Daily`, `Search`.

**Browse tab:**
- Left pane: list of concepts + connections from `knowledge.list`, grouped by `kind` then by first tag (or `groupByPrefix` on relPath if tags absent). Each row: title + tag chips + inbound-link count.
- Right pane: selected article via `knowledge.article`, rendered with `react-markdown` + `remark-gfm`. Header band shows frontmatter (tags, sources, created/updated).
- **Default right-pane view:** rendered `index.md` (`knowledge.index`) when nothing is selected.
- **Wikilinks:** post-process the markdown so `[[concepts/x]]` / `[[connections/y]]` become in-app links that select that article. Resolve target against the `list` result; **dangling links → rendered disabled** (muted, non-clickable). Bare `[[x]]` resolves by matching any article whose relPath ends in `/x` or whose alias matches.
- Empty state when `list` is empty: explain the KB compiles from sessions and is currently empty; point at the Daily tab.

**Daily tab:**
- List of dates from `knowledge.daily` (desc). Selecting one renders its raw markdown (`knowledge.dailyArticle`). Empty state if none.

**Search tab:**
- Text input + Submit button. **Gated:** a visible note that this spends API tokens and runs the engine; the query fires only on Submit (never on type/mount).
- On submit: loading indicator, then render the `knowledge.query` answer as markdown. Errors (missing `uv`, engine failure) shown inline, not swallowed.

## Constraints / guarantees

- **Read-only.** No procedure writes into `knowledge/` or `daily/`. `query` runs without `--file-back`.
- **Path-traversal safe.** Every `project`/`relPath` is resolved and asserted to stay within the store; reject `..`, absolute paths, `_engine`.
- **No hardcoded user path.** Store root via `homedir()` + `ATLAS_KB_STORE`.
- **No new deps.** `js-yaml`, `react-markdown`, `remark-gfm` already in `package.json`.
- **Biome clean.** No semicolons, single quotes, 2-space; `pnpm lint && pnpm typecheck` green first try.
- **Resilient parsing.** Malformed frontmatter / missing files degrade gracefully (empty frontmatter, empty lists), never throw to the UI.

## Out of scope (v1)

- Editing KB files from the UI.
- Indexing into `atlas.db` (revisit only if search/perf demands; confirm with Roman — YAGNI).
- "Compile now" / "lint" buttons (any engine write action).
- `query.py --file-back` (writing Q&A articles back).

## Definition of done

Roman opens atlas-os → `Knowledge` nav → picks a tracked project → browses concepts/connections with rendered markdown and working (non-dangling) wikilinks, views raw daily logs, and can run a gated `query.py` search. All read-only. `pnpm lint && pnpm typecheck` green. No writes to the KB. Empty states render cleanly given the currently-empty store.
