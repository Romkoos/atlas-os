# Infrastructure Change Detection

> 33 nodes · cohesion 0.11

## Key Concepts

- **collectIngestRows()** (11 connections) — `src/main/services/productivity/ingest.ts`
- **ingest.ts** (11 connections) — `src/main/services/productivity/ingest.ts`
- **infra.ts** (8 connections) — `src/main/services/productivity/infra.ts`
- **ingestAll()** (7 connections) — `src/main/services/productivity/ingest.ts`
- **detectInfraChanges()** (6 connections) — `src/main/services/productivity/infra.ts`
- **readInfraState()** (5 connections) — `src/main/services/productivity/infra.ts`
- **ecosystemId()** (4 connections) — `src/main/services/productivity/ids.ts`
- **diffInfraState()** (4 connections) — `src/main/services/productivity/infra.ts`
- **estimateMissingDifficulties()** (4 connections) — `src/main/services/productivity/ingest.ts`
- **hash()** (3 connections) — `src/main/services/productivity/ids.ts`
- **change()** (3 connections) — `src/main/services/productivity/infra.ts`
- **readJson()** (3 connections) — `src/main/services/productivity/infra.ts`
- **readSnapshot()** (3 connections) — `src/main/services/productivity/infra.ts`
- **aggregateBySession()** (3 connections) — `src/main/services/productivity/ingest.ts`
- **findTranscripts()** (3 connections) — `src/main/services/productivity/ingest.ts`
- **parseEcosystemChanges()** (3 connections) — `src/main/services/productivity/jsonl.ts`
- **firstUserPrompt()** (3 connections) — `src/main/services/productivity/transcript.ts`
- **isRealUserPrompt()** (3 connections) — `src/main/services/productivity/transcript.ts`
- **parseTranscriptTurns()** (3 connections) — `src/main/services/productivity/transcript.ts`
- **ids.ts** (3 connections) — `src/main/services/productivity/ids.ts`
- **jsonl.ts** (3 connections) — `src/main/services/productivity/jsonl.ts`
- **transcript.ts** (3 connections) — `src/main/services/productivity/transcript.ts`
- **turnId()** (2 connections) — `src/main/services/productivity/ids.ts`
- **mcpStateOf()** (2 connections) — `src/main/services/productivity/infra.ts`
- **writeSnapshot()** (2 connections) — `src/main/services/productivity/infra.ts`
- *... and 8 more nodes in this community*

## Relationships

- No strong cross-community connections detected

## Source Files

- `src/main/services/productivity/ids.ts`
- `src/main/services/productivity/infra.ts`
- `src/main/services/productivity/ingest.ts`
- `src/main/services/productivity/jsonl.ts`
- `src/main/services/productivity/transcript.ts`

## Audit Trail

- EXTRACTED: 100 (83%)
- INFERRED: 21 (17%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [[index]] to navigate.*