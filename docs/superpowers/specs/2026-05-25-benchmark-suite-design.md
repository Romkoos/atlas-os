# Benchmark Suite — design

**Status:** approved design, ready for `superpowers:writing-plans`.
**Supersedes the build brief:** `docs/superpowers/specs/2026-05-25-benchmark-suite-handoff.md`
(all 7 OPEN DECISIONS in that brief are now resolved — see "Resolved decisions").

## Why this exists

The Productivity tracker shows how Claude Code **infra changes** (plugins, MCP
servers, skills) affect agent **efficiency**. The organic KPI (frozen scope
regression + 7-day rolling median, commit `d410723`) is a readable *trend* but
has an irreducible ~×2 per-session floor — same task scope costs different tokens
run to run (dead-ends, context, exploration). It can never be a flat line.

The user wants the flat line: "stable infra ⇒ flat KPI; change infra ⇒ step
shift." The only way to get it is to **hold the task constant** — re-run a fixed
task set after each infra change and compare tokens. That is this suite.

## Goal

Given a frozen set of read-only tasks, run them on the **real `claude` headless
runtime** under the current infra, capture token cost (+ turns, cost, duration),
stamp each run with an **infra fingerprint** and the **repo commit**, and compare
cost across infra versions. Output: "task T cost N tokens at infra A, M at infra
B (k reps, median, spread)."

## Resolved decisions

| # | Decision | Choice |
|---|----------|--------|
| 0 | Execution layer (LOCKED in brief) | Real `claude` headless via `@anthropic-ai/claude-agent-sdk` `query()`, subscription OAuth. Not raw API. |
| 1 | Task type | **Hybrid, read-only first.** Mutating tasks deferred to a later iteration. |
| 2 | Task sourcing & size | **Curate 5-8 read-only first-prompts** from `~/.claude/projects`, freeze as a JSON fixture the user can hand-tune. |
| 3 | Sandbox | **atlas-os at a pinned commit.** Read-only tools only (no mutation possible), so the live repo is safe. Record git HEAD per run. |
| 4 | Reps per task (k) | **k=5**, configurable. Report median + spread. |
| 5 | Success/validity gate | **`result.subtype==='success'` AND a per-task assertion** (`includes`/`regex`) shipped in the fixture. |
| 6 | Trigger | **Manual now**, clean hook left for auto-on-infra-change later. |
| 7 | Model pinning | **Configurable, default `claude-sonnet-4-6`.** Pinned + recorded per run. |
| 8 | Prompt caching | **Don't disable** (CC runtime sets `cache_control` internally; no reliable switch). Fresh `query()` session per run; record `cache_read`/`cache_creation` tokens separately; compare within the same regime; k=5 median absorbs the one cold rep. Infra IS the cached prefix, so cache misses on infra change are a *real cost* we want visible. |

## Architecture

```
src/main/services/benchmark/
  fingerprint.ts   # pure  — infra state → stable hash
  stats.ts         # pure  — reps → median/spread; before/after delta
  gate.ts          # pure  — (result, assertion) → {valid, failReason}
  runner.ts        # integration-thin — query() per task×rep, capture usage
  tasks.json       # fixture — frozen task set (curated, user-editable)
```

### Pure modules (TDD unit-tested — no DB, no SDK)

**`fingerprint.ts`**
- `infraFingerprint(state: InfraState): string` — canonical-JSON serialize
  (sorted keys, sorted arrays) then sha256, return short hex (e.g. first 12).
- Reuses `InfraState` + `readInfraState()` from
  `src/main/services/productivity/infra.ts` (shape: `{plugins, mcpActive,
  mcpDisabled, skills}`). Same surface the watcher tracks.
- Order-independence is the key property to test: two states differing only in
  key/array order hash equal; any real add/remove/enable/disable/edit changes
  the hash.

**`stats.ts`**
- `median(xs: number[]): number`
- `spread(xs: number[]): number` — IQR (p75−p25); for k=5 this is well-defined.
- `summarize(runs): TaskInfraSummary` — group valid reps by `taskId × infraHash`
  → `{taskId, infraHash, n, medianTokens, spread, medianCostUsd, ...}`.
- `compare(a, b): Delta` — before/after token delta (absolute + %), per task.
- Invalid runs (gate failed) are excluded before aggregation.

**`gate.ts`**
- `Assertion = {type: 'includes' | 'regex', value: string}`
- `checkRun(result: SDKResultMessage, assert: Assertion): {valid: boolean;
  failReason?: 'sdk_error' | 'assertion_failed' | 'timeout'}`
- Valid iff `subtype==='success'` AND the assertion matches `result.result`.
  This is the defense against the cheap-failure trap (a run that errors early
  spends few tokens and would otherwise look "efficient").

### Integration-thin module

**`runner.ts`** — keep logic out of here; it wraps `query()`.

Per task × rep:
```ts
const { query } = await import('@anthropic-ai/claude-agent-sdk')
const controller = new AbortController()
const timer = setTimeout(() => controller.abort(), TIMEOUT_MS) // ~5 min/run
const q = query({
  prompt: task.prompt,
  options: {
    model,                              // pinned, default claude-sonnet-4-6
    settingSources: ['user', 'project'],// LOAD infra — OPPOSITE of difficulty.ts
    allowedTools: ['Read', 'Grep', 'Glob'], // read-only → live repo can't mutate
    permissionMode: 'bypassPermissions',// headless: never hang on a prompt
    cwd: repoRoot,                      // atlas-os checkout
    env: subscriptionEnv(),             // strip API keys → OAuth ~/.claude
    abortController: controller,
  },
})
```
Iterate messages; on `message.type === 'result'` capture: `usage`
(`input_tokens`, `output_tokens`, `cache_read_input_tokens`,
`cache_creation_input_tokens`), `total_cost_usd`, `num_turns`, `duration_ms`,
`subtype`, `session_id`. Read git HEAD of `cwd`. Snapshot+hash infra via
`readInfraState()`+`infraFingerprint()`. Run `checkRun()`. Persist one row.

> **CRITICAL vs existing callers:** `difficulty.ts` and `claude.ts` set
> `settingSources: []` and `allowedTools: []` to *exclude* infra. The benchmark
> does the OPPOSITE so the infra under test is actually active. Forgetting this =
> measuring nothing.

Read-only safety note: `allowedTools` excludes `Write`/`Edit`/`Bash`, so even
with `bypassPermissions` the live atlas-os repo cannot be mutated. Skills/MCP
read tools still load via `settingSources`, so infra is exercised. When mutating
tasks are added later, switch those to a fixture repo with
`git reset --hard && git clean -fd` before each run.

### Data — new drizzle table `benchmark_runs`

In `src/main/db/schema.ts` (sqlite, follows the `agentTurns` pattern):
```
id                   text PK            (uuid)
batchId              text               (groups one "Run benchmark" invocation)
ts                   integer ts_ms
taskId               text
rep                  integer
infraHash            text
infraSnapshot        text json (InfraState)
repoCommit           text               (git HEAD of cwd at run time)
model                text
tokensIn             integer
tokensOut            integer
cacheReadTokens      integer
cacheCreationTokens  integer
totalCostUsd         real
numTurns             integer
durationMs           integer
success              integer (bool)
failReason           text nullable      ('sdk_error'|'assertion_failed'|'timeout')
transcriptPath       text nullable      (session_id / transcript ref)
```
Indexes: `(taskId)`, `(infraHash)`, `(batchId)`, `(ts)`.
Migration flow: edit `schema.ts` → `npm run db:generate` (writes to `drizzle/`)
→ `runMigrations()` applies on app start (`src/main/db/migrate.ts`).

### tRPC — new `benchmark` router

New file `src/main/trpc/routers/benchmark.ts`, registered in the root router
alongside `productivity`. Runs are long (25 runs × minutes), so the mutation must
not block.

- `runBenchmark({ taskIds?: string[]; k?: number = 5; model?: string =
  'claude-sonnet-4-6' })` → starts a **background** loop in the main process,
  inserts each `benchmark_runs` row as it completes, returns `{ batchId, total }`
  immediately. Active batches tracked in an in-memory `Map<batchId, Progress>`.
- `benchmarkProgress(batchId)` → `{ done, total, running, failed }` for the UI to
  poll while a batch runs.
- `benchmarkResults()` → summaries grouped by `taskId × infraHash` (median,
  spread, cost) with before/after deltas, joinable to `ecosystem_changes` so each
  step maps to a specific infra change.
- `benchmarkTasks()` → the frozen task fixture (id + prompt preview) for the UI.

### UI — Benchmark tab in `src/renderer/src/pages/Productivity.tsx`

Add a 4th tab to the existing `TABS` array (`{ id: 'benchmark', label:
'./benchmark' }`) + a `<BenchmarkTab />` conditional render (matches the
overview/sessions/ecosystem pattern).

- **Run control:** model select + k input + "Run benchmark" button. Before
  firing, show estimated total runs (`tasks × k`) and **require confirmation**
  (cost gate). Disable while a batch runs; show live `benchmarkProgress`.
- **Results:** table of task × infra version → median tokens + spread (+ cost).
- **Timeline:** bars/markers aligned to the `ecosystem_changes` timeline showing
  the before/after step per infra change. Reuse the existing chart toolkit
  (recharts v3; see `[[recharts-v3-overlay-markers]]` for overlay markers).
  Keep v1 modest — a clear table + simple bars beats an elaborate chart.

## Testing (TDD)

Unit-test the pure modules only (`superpowers:test-driven-development`):
- `fingerprint`: order-independence; real changes flip the hash.
- `stats`: median, spread (IQR), grouping, before/after delta; invalid runs
  excluded.
- `gate`: success+assertion pass; early-error fails; assertion-miss fails.

Keep DB-touching and `query()` code out of unit tests: better-sqlite3 is an
Electron-ABI native module and can't load under vitest (see the
`collectIngestRows` comment in the repo). `runner.ts` is integration-thin by
design.

## Cost / safety

- Per-run `AbortController` timeout (~5 min, follow `TIMEOUT_MS` in
  `difficulty.ts`).
- Cap k; default model Sonnet (~5× cheaper than Opus for 25-run batches).
- Confirm-before-batch in the UI (estimated runs shown).
- Manual trigger only for v1 — no auto-runs that spend tokens without the user in
  the loop.

## Pitfalls (carried from the brief)

- Stochasticity → always k reps + median, never a single run.
- Cheap-failure trap → the success gate (subtype + assertion) is mandatory.
- Forgetting `settingSources` → you'd measure nothing.
- Permission prompts hang headless → `permissionMode: 'bypassPermissions'`.
- Cache skew → fresh session per run, record cache tokens, compare same regime.
- Model drift → pin + record the model.
- Attribution → align runs to `ecosystem_changes` via `infraHash`.

## Conventions / constraints (project rules)

- **brainstorming → writing-plans → implement** (this doc = end of brainstorming).
- Atomic commits; commit + merge `--no-ff` into `main` **locally only** — **DO
  NOT `git push`** ([[no-push-user-pushes]]).
- **Ignore the Mako `git-commit-message` skill** — wrong repo, misfires here
  ([[git-commit-message-skill-wrong-repo]]). Write commit messages directly,
  harness format with the Co-Authored-By trailer.
- `npm run typecheck` (node+web) and `npx biome check` must pass before commit
  (pre-commit typecheck hook).

## Out of scope (v1)

- Mutating tasks + fixture-repo reset + automated diff/test success checks.
- Auto-trigger on infra change (hook left clean for later).
- Automated transcript miner (task curation is a manual one-time pass).

## Key repo references

- `src/main/services/productivity/difficulty.ts` — `query()` pattern,
  `subscriptionEnv()`, `AbortController` timeout (note: `settingSources:[]`,
  `allowedTools:[]` — benchmark inverts both).
- `src/main/services/claude.ts` — `subscriptionEnv()` env-stripping helper.
- `src/main/services/productivity/infra.ts` — `readInfraState()` +
  `ecosystem_changes` writes (reuse for the fingerprint).
- `src/main/db/schema.ts` (`agentTurns`/`ecosystemChanges` patterns),
  `src/main/db/migrate.ts` (`runMigrations`).
- `src/main/trpc/routers/productivity.ts` (router style), root router file
  (registration).
- `src/renderer/src/pages/Productivity.tsx` (tab pattern).
- `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` — `SDKResultSuccess`
  ~line 3418 (`usage`, `total_cost_usd`, `num_turns`, `duration_ms`, `subtype`).
