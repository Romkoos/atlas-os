# News Module — Design

**Date:** 2026-06-08
**Status:** Approved

## Goal

A new "News" tab in Atlas. Pressing a button runs the `daily-ai-news` skill,
which compiles an AI-news digest and saves it into the knowledge store under a
new `news/` folder. The digest file is overwritten on every run (no dated
history). The tab renders the saved digest. The `news/` folder must NOT appear
on the Knowledge page.

## Decisions (from brainstorming)

- **Adapt the skill** `daily-ai-news` to be Atlas-only. It will save to a single
  overwritten file in the Atlas store. Its previous `~/nexus-os/...` behavior is
  removed.
- **Cron stays.** It simply invokes the skill, so it now writes the same single
  file. Button and cron do the same thing.
- **Live streaming UI.** The multi-minute run streams model output to the tab
  (tRPC subscription, mirroring `agent.run`), with a Cancel action.
- **Tab placement:** NEWS right after KNOWLEDGE (Cmd+5; later items shift down).
- **File:** `~/atlas-knowledge/news/ai-news.md` (fixed name, overwritten).

## Architecture

### 1. Skill adaptation — `~/.claude/skills/daily-ai-news/SKILL.md`

- Change the save target from `~/nexus-os/news/ai/YYYY-MM-DD.md` to the single
  file `~/atlas-knowledge/news/ai-news.md`, **overwriting** it each run.
- Remove all `nexus-os` references; update the `Saves to …` line in the
  description and the save step in the body.
- Create the `news/` directory if missing before writing.
- Content logic (Russian language, priority order, summary limits) unchanged.

### 2. Main — run service `src/main/services/news.ts`

Spawns Claude via `@anthropic-ai/claude-agent-sdk` (the benchmark-runner
pattern, NOT the tool-less `runClaude`):

- `settingSources: ['user']` — load the user's `~/.claude/skills` so
  `daily-ai-news` is available.
- `allowedTools: ['Skill','WebSearch','WebFetch','Read','Write','Bash','Glob','TodoWrite']`
- `permissionMode: 'bypassPermissions'` — headless, never hang on a prompt.
- `env: subscriptionEnv()` — strip API keys → user's Pro/Max OAuth.
- `cwd: homedir()`, `includePartialMessages: true`.
- `prompt`: instruct the model to run the `daily-ai-news` skill and compile the
  last-24h digest.
- Returns `{ done, cancel }` with token streaming via an `onToken` callback,
  shaped like `ClaudeRun`. **The skill writes the file itself** (Write tool); the
  service does not duplicate the write.

`subscriptionEnv()` is duplicated in `claude.ts` and `benchmark/runner.ts`
already; reuse/keep consistent (do not add a third divergent copy — import or
mirror exactly).

### 3. Main — tRPC router `src/main/trpc/routers/news.ts`

- `run` — **subscription**, streams `NewsEvent`
  (`token` / `done{filePath}` / `error` / `aborted`); cancels on unsubscribe.
  Mirror of `agent.run` minus the DB insert and `saveMarkdown` (the skill owns
  the file).
- `cancel` — mutation keyed by `requestId`.
- `read` — query: reads `newsFilePath()` and returns
  `{ raw: string, updatedAt: string | null }` (null when the file is absent).

Path helper: `newsFilePath()` = `join(storeRoot(), 'news', 'ai-news.md')`,
reusing `storeRoot()` from `services/knowledge/store`. Fixed filename, so no
path-traversal surface.

`NewsEvent` added to `src/shared/ipc-events.ts`:

```ts
export type NewsEvent =
  | { type: 'token'; text: string }
  | { type: 'done'; filePath: string }
  | { type: 'error'; message: string }
  | { type: 'aborted' }
```

Register `newsRouter` in `src/main/trpc/router.ts`.

### 4. Hide `news/` from Knowledge — `src/main/services/knowledge/store.ts`

`listProjects` already skips dirs without a `knowledge/` subfolder, so `news/`
would not appear. For explicitness and safety, add `news` to an `EXCLUDED` set
alongside `RESERVED` (`_engine`) and skip both in `listProjects`.

### 5. Renderer — NEWS tab

- `src/renderer/src/store/ui.ts`: add `'news'` to the `Section` union.
- `src/renderer/src/components/layout/nav.ts`: insert
  `{ id: 'news', key: '05', label: 'NEWS' }` after KNOWLEDGE; renumber the
  trailing keys (INFO→06, SKILLS→07, PLUGINS→08, SETTINGS→09). Cmd+N is the
  1-based `NAV` index, so it tracks automatically.
- `src/renderer/src/App.tsx`: add `news: News` to `PAGES`.
- New page `src/renderer/src/pages/News.tsx`:
  - "Обновить новости" button → starts `news.run` (tRPC subscription).
  - During the run: Cancel button + a scrolling live log of the raw token
    stream (so searches/reasoning are visible).
  - On `done`: refetch `news.read` and render the saved markdown via the
    reused `MarkdownView` (`articles={[]}`, `onNavigate` = no-op — news has no
    wikilinks). The live log is replaced by the rendered digest.
  - Empty state when no file exists yet: prompt to press the button.

## Affected files

**New:** `src/main/services/news.ts`, `src/main/trpc/routers/news.ts`,
`src/renderer/src/pages/News.tsx`

**Edited:** `~/.claude/skills/daily-ai-news/SKILL.md`,
`src/shared/ipc-events.ts`, `src/main/trpc/router.ts`,
`src/main/services/knowledge/store.ts`, `src/renderer/src/store/ui.ts`,
`src/renderer/src/components/layout/nav.ts`, `src/renderer/src/App.tsx`

## Testing

- Unit: `newsFilePath()` resolves under `storeRoot()`; `read` returns null
  `updatedAt` when the file is absent and the mtime when present.
- Unit: `listProjects` excludes a `news/` dir even if it contains a `knowledge/`
  subfolder (regression guard for the explicit exclusion).
- Manual: press the button, confirm the live stream renders, the file is written
  to `~/atlas-knowledge/news/ai-news.md` (overwritten on a second run), the tab
  renders it, and `news/` does not show on the Knowledge page.

## Out of scope

- Dated digest history (explicitly overwrite-only).
- Cron reconfiguration (cron is left as-is; it benefits from the new save path).
