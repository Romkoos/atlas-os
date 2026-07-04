# Baseline Compare

> 32 nodes · cohesion 0.10

## Key Concepts

- **db()** (18 connections) — `src/main/db/client.ts`
- **store.ts** (10 connections) — `src/main/services/roadmap/store.ts`
- **appPaths()** (8 connections) — `src/main/paths.ts`
- **baselineMarkerPath()** (5 connections) — `src/main/services/benchmark/compare.ts`
- **getInfraCompareData()** (5 connections) — `src/main/services/benchmark/compare.ts`
- **compare.ts** (5 connections) — `src/main/services/benchmark/compare.ts`
- **ingestProductivity()** (4 connections) — `src/main/index.ts`
- **meta()** (4 connections) — `src/main/services/roadmap/store.ts`
- **migrateStatusIdeaToTodoIfNeeded()** (4 connections) — `src/main/services/roadmap/store.ts`
- **readBaselineMarker()** (3 connections) — `src/main/services/benchmark/compare.ts`
- **wipeBenchmarkRuns()** (3 connections) — `src/main/services/benchmark/compare.ts`
- **runMigrations()** (3 connections) — `src/main/db/migrate.ts`
- **backfillRoadmapClaudePrompts()** (3 connections) — `src/main/services/roadmap/store.ts`
- **createRoadmapItem()** (3 connections) — `src/main/services/roadmap/store.ts`
- **seedRoadmapIfNeeded()** (3 connections) — `src/main/services/roadmap/store.ts`
- **toItem()** (3 connections) — `src/main/services/roadmap/store.ts`
- **updateRoadmapItem()** (3 connections) — `src/main/services/roadmap/store.ts`
- **seedForBatch()** (3 connections) — `src/main/trpc/routers/benchmarkChat.ts`
- **clearCompareBaseline()** (2 connections) — `src/main/services/benchmark/compare.ts`
- **buildChatSeed()** (2 connections) — `src/main/services/benchmarkChat/seed.ts`
- **initDb()** (2 connections) — `src/main/db/client.ts`
- **initStore()** (2 connections) — `src/main/store.ts`
- **listRoadmap()** (2 connections) — `src/main/services/roadmap/store.ts`
- **removeRoadmapItem()** (2 connections) — `src/main/services/roadmap/store.ts`
- **runIdeaToTodoUpdate()** (2 connections) — `src/main/services/roadmap/store.ts`
- *... and 7 more nodes in this community*

## Relationships

- No strong cross-community connections detected

## Source Files

- `src/main/db/client.ts`
- `src/main/db/migrate.ts`
- `src/main/index.ts`
- `src/main/paths.ts`
- `src/main/services/benchmark/compare.ts`
- `src/main/services/benchmarkChat/seed.ts`
- `src/main/services/roadmap/store.ts`
- `src/main/store.ts`
- `src/main/trpc/routers/benchmarkChat.ts`

## Audit Trail

- EXTRACTED: 67 (59%)
- INFERRED: 46 (41%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [[index]] to navigate.*