# GitHub Trending feed — Design

**Date:** 2026-06-08
**Status:** Approved

## Goal

Add a second feed — **GitHub Trending** — to the NEWS tab, mirroring the News
module shipped earlier today. Pressing a button runs the adapted
`github-trending` skill, which saves a top-10 weekly digest to a single
overwritten file in the Atlas store. The NEWS tab presents AI News and GitHub
Trending as **segmented sub-tabs**; the run button acts on the currently active
feed. The backend is **duplicated** from the News stack (no shared
generalization) so today's working News code is left untouched.

## Decisions (from brainstorming)

- **Layout: segmented sub-tabs.** One NEWS page, a `[ AI NEWS | GITHUB TRENDING ]`
  switch under the header. Only the active feed renders; switching is instant.
  Both runs survive tab switches via their own always-mounted host stores.
- **Run button acts on the active feed.** One button; on AI News it runs
  `daily-ai-news`, on GitHub Trending it runs `github-trending`. Each feed tracks
  its own running state and last-updated time.
- **Duplicate the backend stack.** Copy `news.ts` → `trending.ts`,
  `newsRouter` → `trendingRouter`, `newsRun` store → `trendingRun`,
  `NewsRunHost` → `TrendingRunHost`. News code is not refactored.
- **Single overwritten file:** `~/atlas-knowledge/news/github-trending.md`.
- **Event DTO reused.** The existing generic `NewsEvent`
  (`token`/`done{filePath}`/`error`/`aborted`) is reused by the trending router
  — it carries no news-specific fields, so cloning it adds nothing.

## Architecture

### 1. Skill adaptation — `~/.claude/skills/github-trending/SKILL.md`

Same treatment `daily-ai-news` received:

- Change step 4's save target from `~/nexus-os/news/github-trending/YYYY-MM-DD.md`
  (dated history) to the single file `~/atlas-knowledge/news/github-trending.md`,
  **overwriting** it each run.
- Remove all `nexus-os` references; update the description's save line and the
  step-4 path. Step-5 confirmation preview line updated to the new path.
- Fetch/extract/format logic (top-10 weekly, per-repo fields, the markdown
  structure with `date:`/`source:`/`period:` frontmatter) is unchanged.
- Create the `news/` dir if missing before writing (the service also ensures it).

### 2. Main — service `src/main/services/trending.ts`

Near-verbatim copy of `news.ts`:

- `runTrending(opts)` returns `{ done, cancel }` shaped like `NewsRun`; streams
  tokens via `onToken`.
- Spawns Claude via `@anthropic-ai/claude-agent-sdk` with `settingSources:['user']`,
  `allowedTools` (Skill/WebSearch/WebFetch/Read/Write/Bash/Glob/TodoWrite),
  `permissionMode:'bypassPermissions'`, `includePartialMessages:true`,
  `cwd: homedir()`, `env: subscriptionEnv()`, the shared abort controller.
- `TRENDING_PROMPT`: instruct the model to run the `github-trending` skill and
  save the weekly digest to its single overwritten file.
- Path helpers reuse `storeRoot()` and the shared `news/` dir:
  `trendingFilePath()` = `join(storeRoot(),'news','github-trending.md')`;
  `readTrending()` returns `{ raw, updatedAt }` (null `updatedAt` when absent).
- `subscriptionEnv()` is copied to match `news.ts` (kept identical, as the News
  spec already accepts this local duplication across claude.ts/runner.ts/news.ts).

No `knowledge/store.ts` change: both feeds live under the same `news/` dir, which
is already in `EXCLUDED` and hidden from the Knowledge page.

### 3. Main — router `src/main/trpc/routers/trending.ts`

Copy of `newsRouter`, with its own `runs` map keyed by `requestId`:

- `read` — query returning `{ raw, updatedAt }`.
- `run` — subscription streaming `NewsEvent`; cancels on unsubscribe.
- `cancel` — mutation keyed by `requestId`.

Register `trendingRouter` in `src/main/trpc/router.ts` alongside `newsRouter`.
`NewsEvent` in `src/shared/ipc-events.ts` is reused as-is (no new type).

### 4. Renderer — store + host

- `src/renderer/src/store/trendingRun.ts`: copy of `newsRun.ts` exposing
  `useTrendingRun` with the same `running/output/requestId/start/cancel/appendToken/finish`
  shape.
- `src/renderer/src/components/TrendingRunHost.tsx`: copy of `NewsRunHost`,
  subscribing to `trpc.trending.run` and writing into `useTrendingRun`; on `done`
  invalidates `trpc.trending.read`. Renders nothing.
- `src/renderer/src/App.tsx`: mount `<TrendingRunHost />` next to `<NewsRunHost />`.

### 5. Renderer — `News.tsx` hosts two feeds

- Local `useState` `active: 'ai-news' | 'trending'`, default `'ai-news'`.
- A **segmented control** under `PageHeader`: `[ AI NEWS | GITHUB TRENDING ]`,
  mission-control styling (active segment = amber fill/underline). Small CSS added
  to `index.css`.
- Both stores are read unconditionally (`useNewsRun()` + `useTrendingRun()`) and
  both `read` queries are called; the page selects the active feed's values.
- The header run/cancel button and the "обновлено …" timestamp bind to the active
  feed. The body — live stream → rendered digest (`MarkdownView` +
  `stripFrontmatter`) → empty state — renders the active feed.
- The page-level warn line and `PageHeader` `num`/`title` stay `05` / `NEWS`.

## Affected files

**New:** `src/main/services/trending.ts`,
`src/main/trpc/routers/trending.ts`,
`src/renderer/src/store/trendingRun.ts`,
`src/renderer/src/components/TrendingRunHost.tsx`

**Edited:** `~/.claude/skills/github-trending/SKILL.md`,
`src/main/trpc/router.ts`, `src/renderer/src/App.tsx`,
`src/renderer/src/pages/News.tsx`, `src/renderer/src/index.css`

**Untouched:** today's News service/router/store/host code; `knowledge/store.ts`
(news/ already hidden); `ipc-events.ts` (NewsEvent reused);
`nav.ts` / `ui.ts` (no new tab — feed lives inside NEWS).

## Testing

- Unit (`trending.test.ts`, mirroring any news service test): `trendingFilePath()`
  resolves under `storeRoot()` at `news/github-trending.md`; `readTrending()`
  returns null `updatedAt` when the file is absent and the mtime when present.
- Manual: switch sub-tabs; run each feed; confirm the live stream renders; confirm
  the file is written/overwritten at `~/atlas-knowledge/news/github-trending.md`;
  confirm a trending run survives leaving and returning to the NEWS tab; confirm
  neither feed appears on the Knowledge page.

## Out of scope

- Dated digest history (overwrite-only, like News).
- "Refresh all" / concurrent dual-run button (explicitly active-feed only).
- Backend generalization into a parameterized "feed" abstraction (explicitly
  duplicated; revisit only if a 3rd feed is added).
