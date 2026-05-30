// src/main/services/benchmark/compare.ts
//
// Infra compare model for the benchmark tab. Three things matter to the UI:
//   prev — second-most-recent run's frozen infraSnapshot (Set 1 of the diff)
//   last — most-recent run's frozen infraSnapshot (the "current" benchmark)
//   live — live-from-disk infra state (what a NEXT run would capture)
//
// A "compare baseline cleared" marker (a JSON file under userData) lets the
// user reset the rolling pair: any benchmark_runs row with ts <= clearedAt is
// ignored when picking prev/last. This makes "Clear" set the next run to be
// the new baseline without destroying historical rows in the table view.

import { readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { db } from '@main/db/client'
import { benchmarkRuns } from '@main/db/schema'
import { appPaths } from '@main/paths'
import { type InfraState, readInfraState } from '@main/services/productivity/infra'

interface BaselineMarker {
  clearedAt: number
}

function baselineMarkerPath(): string {
  return join(appPaths().userData, 'benchmark-compare-baseline.json')
}

async function readBaselineMarker(): Promise<BaselineMarker | null> {
  try {
    return JSON.parse(await readFile(baselineMarkerPath(), 'utf8')) as BaselineMarker
  } catch {
    return null
  }
}

// Idempotent: rewrites the marker to "now". Subsequent runs after this become
// the new baseline. Existing benchmark_runs rows are NOT deleted — they remain
// in the results table; they're just filtered out of the compare view.
export async function clearCompareBaseline(): Promise<{ clearedAt: number }> {
  const clearedAt = Date.now()
  await writeFile(baselineMarkerPath(), JSON.stringify({ clearedAt }), 'utf8')
  return { clearedAt }
}

// Hard wipe — removes all benchmark_runs rows AND the baseline marker. UI must
// confirm before calling this (irreversible: token-cost data is destroyed).
export async function wipeBenchmarkRuns(): Promise<{ deleted: number }> {
  const result = db().delete(benchmarkRuns).run()
  try {
    await unlink(baselineMarkerPath())
  } catch {
    // marker may not exist — fine
  }
  return { deleted: result.changes ?? 0 }
}

export interface InfraSnapshot {
  ts: number
  batchId: string
  state: InfraState
}

export interface InfraCompareData {
  prev: InfraSnapshot | null
  last: InfraSnapshot | null
  live: InfraState
  baselineClearedAt: number | null
}

export async function getInfraCompareData(): Promise<InfraCompareData> {
  const marker = await readBaselineMarker()
  const clearedAt = marker?.clearedAt ?? null

  const rows = db()
    .select({
      ts: benchmarkRuns.ts,
      batchId: benchmarkRuns.batchId,
      snapshot: benchmarkRuns.infraSnapshot,
    })
    .from(benchmarkRuns)
    .all()

  // Collapse to one entry per batch (max ts in batch wins — runs within a batch
  // share the same snapshot, but maxing is defensive).
  const byBatch = new Map<string, InfraSnapshot>()
  for (const r of rows) {
    const tsMs = r.ts.getTime()
    if (clearedAt !== null && tsMs <= clearedAt) continue
    const cur = byBatch.get(r.batchId)
    if (!cur || cur.ts < tsMs) {
      byBatch.set(r.batchId, { ts: tsMs, batchId: r.batchId, state: r.snapshot })
    }
  }
  const batches = [...byBatch.values()].sort((a, b) => b.ts - a.ts)
  const last = batches[0] ?? null
  const prev = batches[1] ?? null

  const p = appPaths()
  const live = await readInfraState({
    settingsPath: join(p.claudeDir, 'settings.json'),
    claudeJsonPath: p.claudeJson,
    skillsDir: join(p.claudeDir, 'skills'),
  })

  return { prev, last, live, baselineClearedAt: clearedAt }
}
