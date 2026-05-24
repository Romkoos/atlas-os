# КПД (agent efficiency metric) — redesign

**Date:** 2026-05-24
**Status:** Design approved, pending spec review
**Supersedes:** the percentile-rank KPI introduced in commits `0c81d39`, `e5f5055`, `ec73b2e`, `1550514`

## Problem

The current KPI is a corpus-relative percentile coefficient:

```
rawEfficiency = (score ?? 5.5) × complexity / tokens
kpi           = mean(percentileRank(rawEfficiency across corpus)) × 100
```

It does not deliver what the metric is *for*: showing how agent efficiency changes
over time as the ecosystem (skills, MCPs, config) changes. Two structural defects:

1. **Percentile rank centres on ~50%.** Every session is ranked against the whole
   corpus, so the mean of any large window trends to 50%. When the agent genuinely
   improves, old sessions sink and new ones rise — the *average* barely moves. Real
   step-changes get washed out.
2. **History mutates.** Complexity *and* efficiency are percentile-ranked across the
   entire corpus at read time. Doing more work today silently re-ranks sessions from
   weeks ago. A "dynamics over time" chart that rewrites its own past is useless.

A third, subtler defect surfaced during design: **`complexity` (realized scope) sits
in the numerator.** Scope measures *agent behaviour*, not task difficulty. A better
ecosystem makes the agent touch fewer files → scope drops → numerator drops → it
*cancels* the very token savings we want to detect. The metric fights itself.

## Goal

A КПД ("коэффициент полезного действия" — efficiency coefficient) that:

- Shows **dynamics**: how much more/less efficient the agent is after ecosystem changes.
- Is **stable within an unchanged setup**: working two days on the same setup with
  different work volume must NOT move the value significantly. Volume-independent.
- **Steps** at real efficiency changes (which tend to coincide with ecosystem changes),
  forming plateaus between them.
- **Never mutates history**: a value from three weeks ago stays put when new data arrives.
- Does **not** feed ecosystem-change facts into the calculation — changes are context
  overlaid on the chart, not inputs to the number.

## Definition

КПД measures **token-efficiency relative to a frozen baseline, normalized for task
difficulty.** Quality is tracked as a *separate* guardrail line, not folded into КПД.

### Core formula

```
КПД(session) = expectedTokens(difficulty) / actualTokens × 100%
```

- `actualTokens` = `totalTokensIn + totalTokensOut` for the session.
- `difficulty` = intrinsic task difficulty 1–10 (see below). Independent of how the
  agent executed.
- `expectedTokens(difficulty)` = how many tokens a task of that difficulty cost during
  the **baseline period** (frozen — see Baseline model).
- **Semantics:** `100%` = as token-efficient as baseline · `>100%` = leaner than
  baseline · `<100%` = heavier than baseline.

Because the baseline is frozen, КПД for any session is a function only of that session's
own difficulty and tokens plus the immutable baseline model. **History cannot mutate.**
Because `expectedTokens` scales with difficulty, hard tasks are not penalized and easy
tasks are not flattered — making different days comparable (volume-independence).

### Why this gives the desired shape

Within an unchanged setup, `actualTokens ≈ expectedTokens` for each difficulty, so КПД
sits on a plateau (noise per session, flat in the daily mean). When the ecosystem
improves, `actualTokens` drops below `expectedTokens` → КПД steps up to a new plateau.
The plateaus and steps emerge from the data; we never force-segment by ecosystem markers.

## Inputs

### Difficulty (1–10) — intrinsic, hybrid source

- **Primary:** an LLM estimates difficulty from the **first user prompt** of the session
  transcript (what was *asked*, not what the agent *did*). A cheap model
  (`claude-haiku-4-5`) with a fixed rubric returns an integer 1–10.
- **Override:** the user can set difficulty manually in the session UI (mirrors the
  existing `setRating` flow). Manual value wins and is sticky.
- **Stored on the session**, not recomputed at read time, so it never drifts.
- **External-call note:** difficulty estimation sends the first prompt to the Claude API.
  It is the only new external dependency. It must be (a) cached — estimate once per
  session, never re-estimate an existing value; (b) gated behind a setting so it can be
  disabled (manual-only fallback); (c) failure-tolerant — on API error, leave difficulty
  null and move on.
- **Missing difficulty** → the session is excluded from the КПД line (rendered as a gap),
  and surfaced in the UI so the user can set it manually. We do not impute difficulty;
  a fabricated difficulty would corrupt the normalization.

### Tokens

`totalTokensIn + totalTokensOut`, already tracked per session. `actualTokens ≤ 0` →
КПД null (skip).

### Quality (1–10) — guardrail only, NOT in КПД

- Quality is the user's existing `/done` rating. It stays a **separate line** on the
  chart with its own scale.
- Purpose: catch "cheap but bad" — when КПД rises because the agent did less, the quality
  line exposes whether the result also got worse (see the worked example: an aggressive
  skill pushed КПД to 161% while quality fell to 4).
- **Unrated sessions are excluded** from the quality line (gaps). They are **not** imputed.
  The `5.5` imputation constant is removed entirely, since quality no longer enters КПД.

## Baseline model

A frozen reference computed once and reused until the user explicitly re-baselines.

### Period

- **Default:** earliest session up to the first ecosystem-change marker, with a minimum
  floor (≈14 days or ≈20 sessions, whichever is reached) so the baseline has enough data.
  If the first ecosystem change occurs before the floor, extend the baseline to the floor.
- **Manual re-baseline:** the user can pick a date range as the reference and refit. This
  is the *only* operation that changes historical КПД, and only on explicit action.

### Fit: `expectedTokens(difficulty)`

- **Method (default):** log-linear regression of `log(actualTokens)` on `difficulty` over
  baseline sessions → `expectedTokens(d) = exp(a + b·d)`. Smooth, monotone when `b > 0`,
  extrapolates to unseen difficulties. Use a robust/median-based fit to resist outliers.
- **Fallback (sparse data):** if the baseline has fewer than ~8 sessions or the fit is
  degenerate (`b ≤ 0`), use `expectedTokens(d) = median(actualTokens over baseline)` for
  all `d` — i.e., no difficulty normalization until enough data exists. КПД is still
  computable; it just temporarily ignores difficulty.
- **Stored** as a frozen record: period bounds, method, fitted params (JSON), session
  count, createdAt. The latest active record is used for all КПД reads.

## Aggregation & view

- **КПД line (primary):** per-day mean of session КПД, ordered chronologically. Optional
  7-day rolling mean to emphasize plateaus. Reference line at 100% (baseline).
- **Quality line (guardrail, secondary axis):** per-day mean of *rated* sessions' score.
- **Ecosystem markers:** existing `ecosystemDays` overlay (vertical markers) — context
  only, not inputs.
- **Before/after table:** the existing `ecosystemImpact` procedure, refit to the new КПД.
  Columns: change · КПД before · КПД after · Δ КПД · Δ quality. Window param retained.
- **Filtering:** global by default; filterable by tracked project. Baseline is computed
  for the active scope.

## Data model changes

- `agentSessions`: add `difficulty integer` (1–10, nullable) and `difficultySource text`
  (`'llm' | 'manual'`, nullable).
- New table `kpiBaseline`: `id`, `createdAt`, `scope` (global / projectPath),
  `periodStart`, `periodEnd`, `method` (`'loglinear' | 'global-median'`), `params` (JSON),
  `sessionCount`. History kept; latest per scope is active.
- `avgComplexity` already deprecated — unchanged.

## What is removed / changed

- **Removed:** corpus-percentile efficiency ranking for KPI (`sessionEfficiencyMap`,
  `kpiCoefficient` over percentiles) — the source of history mutation and 50%-centering.
- **Removed:** `UNRATED_SCORE = 5.5` imputation (quality left КПД).
- **Removed from КПД:** `complexity` (realized scope) in the numerator — replaced by
  LLM-estimated intrinsic difficulty in the denominator's expectation.
- **Retained:** scope-`complexity` as an optional descriptive statistic in the session
  list (not part of КПД).

## Components (isolation)

- `src/shared/kpi.ts` — **pure** functions, no DB/IO: `fitBaseline(sessions) → BaselineModel`,
  `expectedTokens(model, difficulty)`, `sessionKpd(expected, actualTokens)`,
  `kpiByDay(sessions)`. Fully unit-testable.
- `src/main/services/productivity/difficulty.ts` — LLM difficulty estimator
  (`estimateDifficulty(firstPrompt) → number`). Isolated side-effectful boundary; mockable.
- `src/main/services/productivity/baseline.ts` — load/save/fit baseline; composes `kpi.ts`
  pure fns with DB access.
- `src/main/trpc/routers/productivity.ts` — `kpi` rewritten to use baseline + `sessionKpd`;
  new `setDifficulty` mutation; `ecosystemImpact` refit; add quality-delta column.
- UI — dual-line chart (КПД + quality guardrail, eco markers, 100% reference) and a
  difficulty override control in the session row.

## Testing

- Unit (`kpi.test.ts`): `fitBaseline` (loglinear + sparse fallback), `expectedTokens`
  (interpolation/extrapolation), `sessionKpd` (incl. zero/negative tokens → null),
  `kpiByDay` (grouping, empty days, missing-difficulty gaps).
- `difficulty.ts`: estimator with a mocked LLM client (rubric → integer, error → null).
- `baseline.ts`: freeze/load/re-baseline round-trip; history non-mutation invariant
  (adding a new session leaves prior-day КПД unchanged).

## Edge cases

- `actualTokens ≤ 0` → КПД null (skip).
- `difficulty` null → excluded from КПД line (gap); flagged in UI.
- Baseline too small / degenerate fit → `global-median` method (no difficulty normalization).
- Difficulty outside fitted range → loglinear extrapolates; clamp to a sane max КПД for
  display (e.g., 300%) while storing the raw value.
- LLM estimator disabled or failing → difficulty stays null; manual override still works.
- Re-baseline → historical КПД recomputed against the new model. This is intentional and
  user-initiated; it is the only path that alters history.

## Open questions (decide during planning)

1. Difficulty rubric wording — define the 1–10 anchors so estimates are consistent.
2. Baseline floor exact thresholds (days vs sessions) — tune to actual data volume.
3. Whether the КПД line defaults to raw daily mean or 7-day rolling.
4. Cap value for display clamp (300%?) and whether to annotate clamped points.
