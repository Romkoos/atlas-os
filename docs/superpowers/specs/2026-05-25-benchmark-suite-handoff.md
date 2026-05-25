# Benchmark Suite — handoff for the next agent

**Status:** not started. This is a build brief, not a spec. Run
`superpowers:brainstorming` with the user to resolve the OPEN DECISIONS below
before writing code, then `superpowers:writing-plans`.

## Why this exists (read first)

The Productivity tracker's goal: show how Claude Code **infra changes** (plugins,
MCP servers, skills) affect agent **efficiency**. Over this project we:

1. Found the KPI was degenerate (`expected` was a constant ⇒ daily KPI = pure
   inverse token spend, CV 0.79, ×20 swings).
2. Redesigned it (commit `d410723`): `expected` is now a frozen **scope
   regression** `log(expected)=a+bFiles·log1p(files)+bDirs·log1p(dirs)`, primary
   chart line is a 7-day rolling median. Daily CV 0.79→0.18. See
   [[kpi-degenerate-infra-watcher]] memory + `src/shared/kpi.ts`.
3. Built an infra-change **watcher** (commit `70c2e53`,
   `src/main/services/productivity/infra.ts`) that auto-logs plugin/mcp/skill
   add/remove/enable/disable/edit into `ecosystem_changes`.

**Remaining gap the benchmark suite fills:** even perfectly scope-normalized,
organic KPI has an irreducible ~×2 per-session floor (same task scope costs
different tokens run to run — dead-ends, context, exploration). So the organic
line is a *readable trend*, never a *flat line*. The user wants the flat line:
"stable infra ⇒ flat KPI; change infra ⇒ step shift." The ONLY way to get it is
to **hold the task constant** — re-run a fixed task set after each infra change
and compare tokens. That is this suite.

## Goal

Given a fixed set of representative tasks, run them on the **real `claude`
runtime** under the current infra, record token cost (+ turns, cost, duration),
stamp the run with an **infra fingerprint**, and compare cost across infra
versions. Output: "task T cost N tokens before change X, M after (k reps, median,
spread)."

## Decisions already LOCKED (from discussion with user)

- **Execution layer = real `claude` headless**, NOT a raw Anthropic API harness.
  The infra being measured (MCP servers, skills, CLAUDE.md, hooks, subagents)
  only exists inside the Claude Code runtime, so the benchmark must run it.
- **Infra in scope** = plugins/MCP connect-disconnect, skill create/edit (CC
  runtime). Same surface the watcher tracks.
- **Historical data CANNOT be a benchmark** — tasks were all different and ran on
  uncontrolled, unlogged infra. History is only useful as a source of realistic
  task prompts to curate from. (See `docs/infra-change-timeline.md`.)
- Token/cost capture comes from the SDK `result` message (see refs below).

## OPEN DECISIONS — resolve with user via brainstorming BEFORE coding

1. **Task type.** read-only (analysis/search: "find X", "explain module Y" — no
   mutation, trivial sandbox, easy success check, low noise) vs mutating (real
   coding — needs fixture repo + reset per run + automated success check + more
   noise) vs **hybrid** (recommend: read-only core first, add 2-3 mutating
   later). This was asked but never answered — the user redirected to the watcher.
2. **Task set sourcing & size.** Curate N real first-prompts from transcripts
   (`~/.claude/projects`) vs hand-write synthetic. How many (start ~5-10).
3. **Sandbox.** Read-only → run against a pinned repo checkout. Mutating → a
   fixture repo, `git reset --hard && git clean -fd` before each run for an
   identical start; automated success gate (tests / expected diff).
4. **Reps per task (k).** LLM runs are stochastic. Need k≥3, report **median +
   spread**, not a single run.
5. **Success/validity gate.** A task that errors early uses few tokens and looks
   "efficient" — false signal. Must verify each run actually completed (SDK
   `result.subtype==='success'`, plus task-specific check). Invalid runs excluded.
6. **Trigger.** Manual "Run benchmark" button vs auto-run when the watcher
   detects an infra change (we now have that signal). Recommend manual first
   (real runs cost tokens + time — confirm billing with user before mass runs).
7. **Model pinning.** Pin the model per run so model drift doesn't confound infra
   effect. Store the model with each result.

## Architecture sketch

- `src/main/services/benchmark/`
  - `runner.ts` — invoke `claude` headless per task (see refs), capture usage.
  - `tasks.ts` (or JSON fixtures) — the frozen task set: `{id, prompt, cwd,
    successCheck}`.
  - `fingerprint.ts` — **reuse `readInfraState()` from
    `src/main/services/productivity/infra.ts`**, hash it → infra fingerprint per
    run. Pure, unit-test it.
  - `stats.ts` — aggregate reps (median, spread), before/after compare. Pure,
    unit-test it.
- DB (`src/main/db/schema.ts` + `npm run db:generate`): new table e.g.
  `benchmark_runs { id, ts, taskId, infraHash, infraSnapshot(json), model,
  tokensIn, tokensOut, cacheReadTokens, totalCostUsd, numTurns, durationMs,
  success(bool), transcriptPath }`. Migrations live in `drizzle/`, applied on app
  start by `runMigrations` (`src/main/db/migrate.ts`).
- tRPC (`src/main/trpc/routers/productivity.ts` or a new `benchmark` router):
  `runBenchmark` mutation, `benchmarkResults` query (group by task × infraHash,
  before/after deltas).
- UI: a Benchmark tab in `src/renderer/src/pages/Productivity.tsx` — token cost
  per task across infra versions; align with `ecosystem_changes` timeline.

## Key repo references (how the app already runs `claude` headless)

- `src/main/services/claude.ts` and `src/main/services/productivity/difficulty.ts`
  show the pattern: ESM `query()` from `@anthropic-ai/claude-agent-sdk` via
  dynamic `import()` (CJS main bundle), `subscriptionEnv()` strips
  `ANTHROPIC_API_KEY`/`AUTH_TOKEN` so it uses the user's Pro/Max OAuth (~/.claude),
  `AbortController` timeout.
- **CRITICAL DIFFERENCE:** both existing callers set `settingSources: []` and
  `allowedTools: []` — they deliberately *exclude* MCP/skills/CLAUDE.md. The
  benchmark must do the OPPOSITE: `settingSources: ['user','project']` (and
  whatever loads plugins) so the infra under test is actually active, plus enable
  the real tools and set a non-interactive `permissionMode` (e.g. bypass /
  acceptEdits) so headless runs don't hang on permission prompts.
- **Token/cost capture:** iterate SDK messages; on `message.type==='result'` read
  `message.usage` (`NonNullableUsage`: input/output/`cache_read_input_tokens`…),
  `message.total_cost_usd`, `message.num_turns`, `message.duration_ms`. Success =
  `message.subtype==='success'`. (Types: `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`,
  `SDKResultMessage` ~line 3399.)

## Conventions / constraints (project rules)

- **TDD** (`superpowers:test-driven-development`): unit-test the pure pieces
  (fingerprint hash, rep aggregation/median, success-gating, before/after stats).
  The `query()` invocation is integration-thin; keep logic out of it. Note:
  better-sqlite3 is an Electron-ABI native module and can't load under vitest —
  keep DB-touching code out of unit tests (see `collectIngestRows` comment).
- **brainstorming first**, then **writing-plans**, then implement.
- **Atomic commits**; commit + merge `--no-ff` into `main` **locally only** —
  **DO NOT `git push`**, the user pushes himself ([[no-push-user-pushes]]).
- **Ignore the Mako `git-commit-message` skill** — wrong repo, it misfires here
  ([[git-commit-message-skill-wrong-repo]]). Write commit messages directly,
  harness format with the Co-Authored-By trailer.
- `npm run typecheck` (node+web) and `npx biome check` must pass before commit
  (there is a pre-commit typecheck hook).
- **Cost/safety:** real `claude` runs burn tokens + minutes. Keep the task set
  small, cap reps, add per-run timeouts (see `TIMEOUT_MS` in difficulty.ts),
  and confirm with the user before any large batch run.

## Pitfalls

- Stochasticity → always k reps + median, never a single run.
- Cheap-failure trap → enforce the success gate or "efficient" is a lie.
- Forgetting to load infra (`settingSources`) → you'd measure nothing.
- Permission prompts hang headless → set permissionMode.
- Mutating tasks → reset sandbox to identical start each run.
- Prompt caching skews token counts run-to-run → control it (consistently warm
  or disabled), and prefer comparing within the same cache regime.
- Model drift confounds infra effect → pin + record the model.
- Attribution: align runs to `ecosystem_changes` (the watcher's log) so each
  before/after maps to a specific infra change.
