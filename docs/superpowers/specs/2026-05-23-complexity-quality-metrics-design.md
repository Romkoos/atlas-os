# Complexity & Quality Metrics — Design Spec

**Date:** 2026-05-23
**Status:** Approved (design). Implementation plan not yet written.
**Component:** Productivity tracker (Atlas OS Electron app).

---

## 0. Read this first (context for a fresh agent)

Atlas OS has a **Agent Productivity Tracker** feature (already built and committed —
commit `fabf42f`). It ingests Claude Code transcripts + a hook JSONL buffer into a
local Drizzle/SQLite DB and renders a **Productivity** page (Overview / Sessions /
Ecosystem tabs) with Recharts.

Background you must skim before implementing:
- `docs/agent-productivity-tracker.md` — original system design.
- `.../memory/productivity-tracker-atlas-design.md` — resolved decisions (transcript =
  source of truth; no self-declared complexity; complexity computed objectively).
- `.../memory/recharts-v3-overlay-markers.md` — recharts v3 gotchas for the UI.

**Purpose of the whole system:** measure how *ecosystem changes* (MCP / skills /
CLAUDE.md / config edits) affect agent **quality** and **token use** across several
projects. Complexity and quality are the two axes that make token numbers
interpretable: complexity normalizes "more tokens = harder task vs. weaker agent",
quality says whether the output was actually good.

**What exists today (the gap this spec closes):**
- `src/main/services/productivity/complexity.ts` is a **STUB returning a constant `3`**.
  `agent_turns.complexityProxy` and `agent_sessions.avgComplexity` are therefore
  meaningless. The Overview "Avg complexity" card and the by-project column show 3.0.
- Quality: `agent_sessions.score` (1–10, nullable) was meant to come from a `/done`
  agent self-rating. In practice it is **null everywhere** (the `/done` skill isn't
  installed/used), so the Overview "Avg score" shows "—".

This spec replaces the stub with a real **complexity** metric and defines a real
**quality** metric. It deliberately keeps scope tight.

---

## 1. Decisions (the contract)

These were settled during brainstorming. Do not relitigate without asking the user.

### Complexity
- **Unit = session** (one task), not per-turn.
- **Signal set (Tier B, "scope" signals only):**
  1. distinct files touched
  2. distinct directories touched
  3. distinct tool *types* used
  4. distinct skills used
  5. subagent (`Task` tool) usage count
- **Explicitly excluded** from complexity: `turn_count`, tool-call count, and token
  counts. Reason: they measure *volume/effort*, correlate with tokens, and would make
  "tokens normalized by complexity" circular. Complexity must stay independent of how
  much the agent did, so it can serve as a control variable.
- **Normalization:** per signal, compute a **percentile rank across the whole session
  corpus** (global, cross-project — comparability across projects is the point). Then
  take the **mean of the five percentiles** and map to a **1–10** scale.
- **Components are exposed** in the UI (show the raw counts), so a user can see *why* a
  session scored as complex.

### Quality
- **`quality = user_rating ?? 7`**. No agent self-score. (The `/done` self-rating idea
  is dropped.)
- `7/10` is the **default/imputed** value when there is no user rating — a realistic
  neutral-positive baseline.
- **imputed ≠ measured (critical):** the default `7` is for fallback/sorting only.
  - "Avg score" / any quality aggregate must be computed over **rated sessions only**
    and must display **`n rated / m total`**, so an imputed `7` never masquerades as a
    measured value.
  - `agent_sessions.score == null` *is* the "not rated" flag. Do not write `7` to the
    DB; impute it on read where a single number is required.

### Out of scope (deliberately deferred — do NOT build)
- Any **trained/statistical model** linking quality↔complexity↔tokens.
- The **efficiency residual** ("expected tokens given complexity") view. Recorded as a
  future idea in §6, not to be implemented now.
- Auto quality signals (git change-survival, test pass/fail parsing, sentiment).
- Automatic session-end rating prompt. (Manual rating UI *is* in scope; see §4.3.)

---

## 2. Data model changes

File: `src/main/db/schema.ts`. Generate a migration with `pnpm db:generate`.

### 2.1 `agent_turns` — add `filesTouched`
Everything needed for complexity is derivable from existing columns **except** file
paths:
- distinct tools → from existing `toolsUsed` (json `string[]`).
- distinct skills → from existing `skillsUsed`.
- subagent count → count of `"Task"` occurrences in `toolsUsed`.
- distinct files / dirs → **new**.

Add:
```ts
filesTouched: text('files_touched', { mode: 'json' }).$type<string[]>().notNull(), // default []
```
Populated by the transcript parser (see §3). Mirrors the `toolsUsed` / `skillsUsed`
pattern.

### 2.2 `agent_sessions` — repurpose `score`, deprecate `avgComplexity`
- `score` (int, nullable) — now means **user rating (1–10)**, set only via the UI
  (§4.3). It is no longer fed from any agent self-rating during ingest.
- `avgComplexity` (real) — **deprecated**. It averaged the per-turn stub. Complexity is
  now session-level and computed at read time (§3.3). Leave the column for now (a
  follow-up migration can drop it); stop reading it.

### 2.3 `agent_turns.complexityProxy` — deprecated
No longer written or read. The `complexity.ts` stub is replaced by the read-time
computation in §3.3. Leave the column; a later migration may drop it.

### 2.4 Backfill concern (important)
Ingest currently inserts turns with `onConflictDoNothing` (idempotent re-parse). Adding
`filesTouched` means **existing rows won't get backfilled** by a normal re-ingest.
Choose one in the plan:
- (a) one-time `DELETE FROM agent_turns;` then re-run ingest (simplest; transcripts are
  the source of truth so nothing is lost), **or**
- (b) change the turn upsert to `onConflictDoUpdate` for `filesTouched` only.

Recommend (a) for simplicity.

---

## 3. Ingest & computation

Directory: `src/main/services/productivity/`.

### 3.1 Transcript parsing — extract file paths
File: `transcript.ts`. For each assistant turn, the parser already walks `tool_use`
blocks (it builds `toolsUsed`). Additionally collect file paths from tool inputs:
- `Read`, `Edit`, `Write`, `MultiEdit`, `NotebookEdit` → `input.file_path` (or
  `notebook_path`).
- Ignore other tools for file extraction (Bash file effects are not parsed — out of
  scope).
Store the per-turn unique list as `filesTouched`.

`"Task"` (subagent) is already captured in `toolsUsed`; no extra extraction needed.

### 3.2 `complexity.ts` — replace the stub
Delete the constant-`3` stub. This file now exposes **pure helpers** (no DB) that the
tRPC layer uses, so they stay unit-testable (the existing test split keeps DB out of
vitest — see the design memo):

1. `sessionScopeCounts(turns)` → for a session's turns, return:
   ```ts
   { distinctFiles, distinctDirs, distinctTools, distinctSkills, subagentCount }
   ```
   - `distinctFiles` = size of the union of `filesTouched`.
   - `distinctDirs` = size of the union of `dirname(path)` over those files.
   - `distinctTools` = size of the union of `toolsUsed`.
   - `distinctSkills` = size of the union of `skillsUsed`.
   - `subagentCount` = number of turns whose `toolsUsed` includes `"Task"`.
2. `complexityFromPercentiles(percentiles: number[])` → `1 + 9 * mean(percentiles)`,
   clamped to `[1, 10]`.
3. `percentileRanks(values: number[])` → for each value, the mid-rank percentile in
   `[0,1]`: `(countLess + 0.5 * countEqual) / n`. (Mid-rank handles ties; a single
   session yields `0.5`.)

These are pure → cover them with vitest like the existing `complexity.test.ts`.

### 3.3 Where complexity is computed: read time, not stored
Percentile ranks depend on the **whole corpus**, so a stored per-session value would go
stale as sessions accumulate. Compute on read inside the tRPC layer:
- Gather scope counts for **all sessions** in the corpus (respect the tracked-projects
  allowlist used elsewhere — see `trackedCondition()` in the router).
- For each of the 5 signals, compute `percentileRanks` across that corpus.
- Per session: `complexity = complexityFromPercentiles([p_files, p_dirs, p_tools,
  p_skills, p_subagent])`.
- Return both the `complexity` (1–10) and the raw component counts.

Equal weights across the five signals. (Weighting is a future tuning knob; not now.)

---

## 4. tRPC & UI changes

Router: `src/main/trpc/routers/productivity.ts`. Page: `src/renderer/src/pages/Productivity.tsx`.

### 4.1 Complexity in existing read procedures
- `overview`: replace `avgComplexity` (currently `avg(complexityProxy)`) with the mean
  of session-level `complexity` over the windowed sessions. Same for the `byProject`
  aggregate's complexity column.
- `sessions`: include per-session `complexity` (1–10) and the component counts so the
  Sessions table / a session row can show the breakdown.

Implementation note: these procedures need corpus-wide scope counts to compute
percentiles. Factor a shared helper that loads scope counts for all (tracked) sessions
once, then derive percentiles. Keep it efficient (hundreds–thousands of sessions is
fine in JS, like the existing `ecosystemImpact` one-pass approach).

### 4.2 Quality in existing read procedures
- Wherever an aggregate quality number is shown (Overview "Avg score"):
  - compute the mean over **non-null `score`** only;
  - also return `ratedCount` and `totalCount`;
  - UI shows e.g. **"7.8 · 12/401 rated"**. Never blend in the imputed 7.
- Where a per-session single number is needed for sorting/fallback, use
  `effectiveQuality = score ?? 7`. Mark it visually as imputed (e.g., muted, or a
  "default" tag) so it reads differently from a real rating.

### 4.3 Manual rating UI (in scope — the only quality source for now)
Without an input, quality is always 7. Add a minimal manual rating:
- A rating control (1–10 select, or 5 stars mapped to 2-pt steps — implementer's
  choice; keep it tiny) on each row of the **Sessions** tab.
- New mutation `productivity.setRating({ sessionId, score: 1..10 | null })` →
  writes `agent_sessions.score`; `null` clears the rating. Invalidate productivity
  queries after.
- The Sessions table shows the real rating where set, and an "unrated → 7 (default)"
  affordance otherwise.

(A session-end auto-prompt is future, §6.)

### 4.4 Stop importing agent self-score
If the ingest path ever populates `score` from a `/done` self-rating (via the JSONL
buffer), **remove that** — `score` is user-only now. Verify in `ingest.ts` / `jsonl.ts`.

---

## 5. Edge cases & decisions baked in

- **Small corpus:** percentiles are unstable with few sessions; a single session →
  0.5 → complexity ≈ 5.5. Acceptable; stabilizes as data grows. Document in the UI
  copy if it looks odd.
- **Read-only / planning sessions:** few/zero files but tools+skills still counted →
  low-ish complexity. Correct.
- **Ties:** handled by mid-rank percentile (§3.2.3).
- **Sessions present only via JSONL (no transcript):** `filesTouched` may be empty →
  lower file/dir components. Acceptable; transcript is the primary source.
- **Percentile corpus = tracked sessions, global across projects** (not per-project).
  Cross-project comparability is the goal.
- **Complexity scale = 1–10** to sit on the same axis as quality.

---

## 6. Future (recorded, NOT in this scope)

- **Session-end user-rating prompt** (auto-ask quality at end) → richer coverage than
  manual rating.
- **Adaptive default:** once ≥ ~20 real ratings exist, default the imputed quality to
  the median of real ratings instead of a fixed 7. Self-calibrating.
- **Efficiency residual:** expected tokens given complexity (from the corpus) vs actual
  → over/under. Would replace raw `tokens/turn` in the existing `ecosystemImpact`
  before/after view, giving a complexity-controlled ecosystem-effect signal.
- **Trained model** linking quality / complexity / tokens. Needs rating coverage first.
- **Cheap objective quality side-signals** (error rate, test pass/fail) shown as
  descriptive context (not as the quality label).

---

## 7. Definition of done (for the implementation plan)

1. `complexity.ts` stub replaced with the pure helpers (§3.2) + vitest coverage.
2. `filesTouched` added to schema + extracted by the parser + migration generated;
   existing data backfilled (§2.4).
3. `overview` / `byProject` / `sessions` procedures return real session-level
   complexity + components; "Avg complexity" reflects it.
4. Quality: `effectiveQuality = score ?? 7`; aggregates over rated-only with
   `n rated / total`; imputed value visually distinct.
5. `setRating` mutation + minimal rating control in the Sessions tab.
6. Agent self-score no longer imported into `score`.
7. `pnpm typecheck && pnpm lint && pnpm test` green; verify in the running app
   (Electron e2e harness exists under `e2e/`).
