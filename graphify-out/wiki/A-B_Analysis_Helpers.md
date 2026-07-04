# A/B Analysis Helpers

> 38 nodes · cohesion 0.07

## Key Concepts

- **runLoop()** (12 connections) — `src/main/services/benchmark/batch.ts`
- **stats.ts** (5 connections) — `src/main/services/benchmark/stats.ts`
- **runAnalysis()** (4 connections) — `src/main/services/benchmark/analysis.ts`
- **runBenchmarkTask()** (4 connections) — `src/main/services/benchmark/runner.ts`
- **summarize()** (4 connections) — `src/main/services/benchmark/stats.ts`
- **estimateDifficulty()** (4 connections) — `src/main/services/productivity/difficulty.ts`
- **aggregate.ts** (4 connections) — `src/main/services/benchmark/aggregate.ts`
- **batch.ts** (4 connections) — `src/main/services/benchmark/batch.ts`
- **buildAbSlice()** (3 connections) — `src/main/services/benchmark/aggregate.ts`
- **summarizeRuns()** (3 connections) — `src/main/services/benchmark/aggregate.ts`
- **infraFingerprint()** (3 connections) — `src/main/services/benchmark/fingerprint.ts`
- **checkRun()** (3 connections) — `src/main/services/benchmark/gate.ts`
- **median()** (3 connections) — `src/main/services/benchmark/stats.ts`
- **spread()** (3 connections) — `src/main/services/benchmark/stats.ts`
- **subscriptionEnv()** (3 connections) — `src/main/services/productivity/difficulty.ts`
- **analysis.ts** (3 connections) — `src/main/services/benchmark/analysis.ts`
- **runner.ts** (3 connections) — `src/main/services/benchmark/runner.ts`
- **difficulty.ts** (3 connections) — `src/main/services/productivity/difficulty.ts`
- **buildAnalysisPrompt()** (2 connections) — `src/main/services/benchmark/analysis.ts`
- **startBatch()** (2 connections) — `src/main/services/benchmark/batch.ts`
- **canonicalInfra()** (2 connections) — `src/main/services/benchmark/fingerprint.ts`
- **matchesAssertion()** (2 connections) — `src/main/services/benchmark/gate.ts`
- **repoCommit()** (2 connections) — `src/main/services/benchmark/runner.ts`
- **subscriptionEnv()** (2 connections) — `src/main/services/benchmark/runner.ts`
- **compare()** (2 connections) — `src/main/services/benchmark/stats.ts`
- *... and 13 more nodes in this community*

## Relationships

- No strong cross-community connections detected

## Source Files

- `src/main/services/benchmark/aggregate.ts`
- `src/main/services/benchmark/analysis.ts`
- `src/main/services/benchmark/batch.ts`
- `src/main/services/benchmark/fingerprint.ts`
- `src/main/services/benchmark/gate.ts`
- `src/main/services/benchmark/runner.ts`
- `src/main/services/benchmark/stats.ts`
- `src/main/services/benchmark/sweep.ts`
- `src/main/services/productivity/difficulty.ts`
- `src/renderer/src/pages/info/sections/per-session.tsx`

## Audit Trail

- EXTRACTED: 76 (73%)
- INFERRED: 28 (27%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [[index]] to navigate.*