import { randomUUID } from 'node:crypto'
import { db } from '@main/db/client'
import { kpiBaseline } from '@main/db/schema'
import { type BaselineModel, fitBaseline } from '@shared/kpi'
import { desc, eq } from 'drizzle-orm'

const BASELINE_MIN_SESSIONS = 15
const BASELINE_FRACTION = 0.25

export interface ScopedSession {
  id: string
  difficulty: number | null
  tokens: number
  score: number | null
  lastTs: number // ms epoch of the session's last turn
}

export const scopeKey = (projectPath?: string): string => projectPath ?? '__global__'

// The starting reference: earliest max(15, 25%) sessions by time. `sorted` MUST
// be ascending by lastTs. Pure — unit tested.
export function selectBaselineSamples(sorted: ScopedSession[]): ScopedSession[] {
  if (sorted.length === 0) return []
  const n = Math.min(
    sorted.length,
    Math.max(BASELINE_MIN_SESSIONS, Math.ceil(sorted.length * BASELINE_FRACTION)),
  )
  return sorted.slice(0, n)
}

export function getActiveBaseline(scope: string): BaselineModel | null {
  const row = db()
    .select()
    .from(kpiBaseline)
    .where(eq(kpiBaseline.scope, scope))
    .orderBy(desc(kpiBaseline.createdAt))
    .limit(1)
    .get()
  if (!row) return null
  return { method: row.method as BaselineModel['method'], params: row.params }
}

function saveBaseline(scope: string, model: BaselineModel, used: ScopedSession[]): void {
  db()
    .insert(kpiBaseline)
    .values({
      id: randomUUID(),
      scope,
      createdAt: new Date(),
      periodStart: used.length ? new Date(used[0].lastTs) : null,
      periodEnd: used.length ? new Date(used[used.length - 1].lastTs) : null,
      method: model.method,
      params: model.params,
      sessionCount: used.length,
    })
    .run()
}

// Return the active baseline, fitting + freezing one from the starting period if
// none exists. `scopedSorted` MUST be ascending by lastTs.
export function ensureBaseline(
  scopedSorted: ScopedSession[],
  projectPath?: string,
): BaselineModel | null {
  const scope = scopeKey(projectPath)
  const existing = getActiveBaseline(scope)
  if (existing) return existing
  const used = selectBaselineSamples(scopedSorted)
  const model = fitBaseline(used.map((sx) => ({ difficulty: sx.difficulty, tokens: sx.tokens })))
  if (!model) return null
  saveBaseline(scope, model, used)
  return model
}

// Explicit user re-baseline over a chosen set of sessions. Refits + freezes.
export function rebaseline(used: ScopedSession[], projectPath?: string): BaselineModel | null {
  const model = fitBaseline(used.map((sx) => ({ difficulty: sx.difficulty, tokens: sx.tokens })))
  if (!model) return null
  saveBaseline(scopeKey(projectPath), model, used)
  return model
}
