# Settings & Baseline Store

> 41 nodes · cohesion 0.08

## Key Concepts

- **productivity.ts** (10 connections) — `src/main/trpc/routers/productivity.ts`
- **kpi.ts** (10 connections) — `src/shared/kpi.ts`
- **getSettings()** (8 connections) — `src/main/store.ts`
- **baseline.ts** (8 connections) — `src/main/services/productivity/baseline.ts`
- **ensureBaseline()** (7 connections) — `src/main/services/productivity/baseline.ts`
- **fitBaseline()** (5 connections) — `src/shared/kpi.ts`
- **store.ts** (5 connections) — `src/main/store.ts`
- **requireStore()** (4 connections) — `src/main/store.ts`
- **getScopedSessions()** (4 connections) — `src/main/services/productivity/baseline.ts`
- **rebaseline()** (4 connections) — `src/main/services/productivity/baseline.ts`
- **saveBaseline()** (4 connections) — `src/main/services/productivity/baseline.ts`
- **sessionComplexityMap()** (4 connections) — `src/main/trpc/routers/productivity.ts`
- **trackedProjects()** (4 connections) — `src/main/trpc/routers/productivity.ts`
- **resetSettings()** (3 connections) — `src/main/store.ts`
- **setSettings()** (3 connections) — `src/main/store.ts`
- **getActiveBaseline()** (3 connections) — `src/main/services/productivity/baseline.ts`
- **scopeKey()** (3 connections) — `src/main/services/productivity/baseline.ts`
- **trackedProjects()** (3 connections) — `src/main/services/productivity/baseline.ts`
- **projectCondition()** (3 connections) — `src/main/trpc/routers/productivity.ts`
- **scopedKpdRows()** (3 connections) — `src/main/trpc/routers/productivity.ts`
- **trackedCondition()** (3 connections) — `src/main/trpc/routers/productivity.ts`
- **expectedTokens()** (3 connections) — `src/shared/kpi.ts`
- **log1p()** (3 connections) — `src/shared/kpi.ts`
- **medianAbsResidualPct()** (3 connections) — `src/shared/kpi.ts`
- **medianOf()** (3 connections) — `src/shared/kpi.ts`
- *... and 16 more nodes in this community*

## Relationships

- No strong cross-community connections detected

## Source Files

- `src/main/services/productivity/baseline.ts`
- `src/main/services/productivity/complexity.ts`
- `src/main/store.ts`
- `src/main/trpc/routers/knowledge.ts`
- `src/main/trpc/routers/productivity.ts`
- `src/shared/kpi.ts`

## Audit Trail

- EXTRACTED: 117 (85%)
- INFERRED: 21 (15%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [[index]] to navigate.*