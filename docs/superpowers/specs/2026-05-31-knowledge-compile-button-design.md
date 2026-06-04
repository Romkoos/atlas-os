# Knowledge compile button — design

**Date:** 2026-05-31
**Status:** Approved

## Problem

The knowledge engine compiles daily logs → wiki articles only via the end-of-day
auto-trigger (`flush.py`, after 18:00 local) on `SessionEnd`. There is no way to
compile on demand from the Atlas UI. The user wants a single button that compiles
the daily logs of **all visible projects** in one press.

## Scope

- One-press compilation across every project visible in the Knowledge UI (same
  `trackedProjects` allowlist `listProjects` already applies).
- Incremental only — reuse `compile.py`'s default hash-based change detection. No
  `--all`. Already-compiled, unchanged logs are skipped (cheap, no churn).
- Mirrors the existing `runQuery`/`query` pattern (shell out to the engine via
  `uv run`, gated behind an explicit user action because it spends Claude usage).

Out of scope: per-project compile button, delta-within-a-log compilation,
streaming progress, scheduling changes. The 18:00 auto-trigger is untouched.

## Architecture

Three layers, matching the existing knowledge feature.

### 1. `src/main/services/knowledge/store.ts`

```
compileProject(root, project): Promise<CompileResult>
```
- Shells out: `execFile('uv', ['run','--directory',<engine>,'python','scripts/compile.py'])`
  with `env: { ...process.env, ATLAS_KB_ROOT: projectRoot(root, project) }`.
- `config.py` resolves the project root from `ATLAS_KB_ROOT` — identical mechanism
  to `query.py`, confirmed.
- Timeout `15 * 60_000` (compilation spawns a nested Claude per changed log).
- Parse `stdout` into a status:
  - contains `"Nothing to compile"` → `'nothing'`
  - contains `"Compilation complete"` → `'compiled'` (capture the trailing summary line)
  - otherwise / nonzero exit (execFile rejects) → `'error'` with `stderr`/message.
- `ENOENT` on `uv` → friendly "install uv" message (same as `runQuery`).

```
compileAll(root, tracked): Promise<CompileResult[]>
```
- Project list = `listProjects(root, tracked).map(p => p.name)` (same visibility as UI).
- Run `compileProject` for each concurrently via `Promise.allSettled`; a rejected
  project maps to a `'error'` result so one failure never sinks the batch.
- Returns one `CompileResult` per project.

`CompileResult = { project: string; status: 'compiled'|'nothing'|'error'; summary: string }`.

### 2. `src/shared/knowledge.ts`

Add `compileResultSchema` (zod) + `CompileResult` type for the tRPC output contract.

### 3. `src/main/trpc/routers/knowledge.ts`

```
compileAll: publicProcedure
  .output(z.array(compileResultSchema))
  .mutation(() => compileAll(storeRoot(), tracked()))
```
No input (acts on the whole tracked set).

### 4. `src/renderer/src/pages/Knowledge.tsx`

- `compileAll` mutation via `trpc.knowledge.compileAll.useMutation()`.
- Button rendered in the `PageHeader` `action` slot, beside the project `<select>`
  (the action is global, not per-project). Label `compile` → `compiling…` while
  `isPending`; `disabled` while pending.
- A short, dismissible note (styled like the search warning):
  "runs the LLM engine via Claude Code (uses your Claude usage)."
- On success: render a compact per-project summary panel
  (`compiled` / `up to date` / `error: …`) and invalidate `knowledge.projects`,
  `knowledge.list`, `knowledge.index` via `trpc.useUtils()` so new articles appear.

## Data flow

Click → `compileAll` mutation → `store.compileAll` → N parallel `compile.py`
processes (one per tracked project, each scoped by `ATLAS_KB_ROOT`) →
per-project `CompileResult[]` → UI summary + cache invalidation.

## Error handling

- Per-project isolation via `allSettled`: one project's failure yields an `'error'`
  result, others still complete.
- `uv` missing → actionable message.
- Button disabled while in-flight prevents overlapping batches (avoids two processes
  racing on the same `state.json`).

## Testing

- `store.test.ts`: unit-test the stdout→status parsing (`compiled` / `nothing` /
  `error`) with fixture strings; verify `compileAll` aggregates and that a thrown
  `compileProject` becomes an `'error'` result (mock `execFile`).
- Typecheck + biome + existing vitest suite must stay green.

## Verification

`pnpm typecheck && pnpm lint && pnpm test`, then manual: click compile, confirm
today's uncompiled logs ingest and the browse tab refreshes.
