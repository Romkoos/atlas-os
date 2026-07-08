import { randomUUID } from 'node:crypto'
import type { AppDatabase } from '@main/db/client'
import { db } from '@main/db/client'
import { roadmapItems } from '@main/db/schema'
import { logger } from '@main/logger'
import { ROADMAP_SEED } from '@main/services/roadmap/seed'
import type { DevBinding, RoadmapCreate, RoadmapItem, RoadmapUpdate } from '@shared/roadmap'
import { and, asc, eq, inArray } from 'drizzle-orm'
import Store from 'electron-store'

const CATEGORY_ORDER = ['intelligence', 'observability', 'macos', 'connectivity', 'wow']

// Isolated store just for the one-time seed flag, so deleting every item never
// re-triggers the seed.
interface RoadmapMeta {
  seeded: boolean
  claudePromptBackfilled: boolean
  statusIdeaToTodoMigrated: boolean
  benchmarkSeedsRetired: boolean
}
let metaStore: Store<RoadmapMeta> | null = null
function meta(): Store<RoadmapMeta> {
  if (!metaStore) {
    metaStore = new Store<RoadmapMeta>({
      name: 'roadmap-meta',
      defaults: {
        seeded: false,
        claudePromptBackfilled: false,
        statusIdeaToTodoMigrated: false,
        benchmarkSeedsRetired: false,
      },
    })
  }
  return metaStore
}

// The worker's current development binding (which roadmap item it is building,
// and whether we are still planning or actively building). Its own store so it
// survives restart independently of the seed/meta flags.
interface DevBindingStore {
  binding: DevBinding | null
}
let devStore: Store<DevBindingStore> | null = null
function devBindingStoreInstance(): Store<DevBindingStore> {
  if (!devStore) {
    devStore = new Store<DevBindingStore>({
      name: 'roadmap-dev-binding',
      defaults: { binding: null },
    })
  }
  return devStore
}

export function getDevBinding(): DevBinding | null {
  return devBindingStoreInstance().get('binding')
}
export function setDevBinding(binding: DevBinding): void {
  devBindingStoreInstance().set('binding', binding)
}
export function clearDevBinding(): void {
  devBindingStoreInstance().set('binding', null)
}

// Serialize a DB row (Date timestamps) into the wire shape (epoch ms).
function toItem(row: typeof roadmapItems.$inferSelect): RoadmapItem {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category as RoadmapItem['category'],
    status: row.status as RoadmapItem['status'],
    priority: row.priority as RoadmapItem['priority'],
    claudePrompt: row.claudePrompt,
    position: row.position,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  }
}

// Seed the brainstorm list once, into an empty table. Guarded by the meta flag
// AND an emptiness check so it is safe to call on every startup.
export function seedRoadmapIfNeeded(): void {
  if (meta().get('seeded')) return
  const existing = db().select({ id: roadmapItems.id }).from(roadmapItems).all()
  if (existing.length === 0) {
    const now = new Date()
    const rows = ROADMAP_SEED.map((s, i) => ({
      id: randomUUID(),
      title: s.title,
      description: s.description,
      category: s.category,
      status: 'todo' as const,
      priority: s.priority,
      claudePrompt: s.claudePrompt,
      position: i,
      createdAt: now,
      updatedAt: now,
    }))
    db().insert(roadmapItems).values(rows).run()
    logger.info('Roadmap seeded', { count: rows.length })
  }
  meta().set('seeded', true)
}

// One-time backfill: rows seeded before `claudePrompt` existed have an empty
// value. Fill them from the seed by matching title (only where still empty, so
// user edits are never clobbered). Guarded by a flag so it runs at most once.
export function backfillRoadmapClaudePrompts(): void {
  if (meta().get('claudePromptBackfilled')) return
  let filled = 0
  for (const s of ROADMAP_SEED) {
    if (!s.claudePrompt) continue
    const res = db()
      .update(roadmapItems)
      .set({ claudePrompt: s.claudePrompt })
      .where(and(eq(roadmapItems.title, s.title), eq(roadmapItems.claudePrompt, '')))
      .run()
    filled += res.changes
  }
  if (filled > 0) logger.info('Roadmap claudePrompt backfilled', { count: filled })
  meta().set('claudePromptBackfilled', true)
}

// One-time cleanup: the benchmark subsystem was removed, so these seeded ideas
// (which depended on the benchmark suite / benchmark_runs) are no longer
// relevant. Delete them by title. Matched against the original seed titles only,
// so a user-renamed row is left untouched. Guarded by a flag so it runs once.
const RETIRED_SEED_TITLES = [
  'Self-improving skills loop',
  'Cost / token forecaster',
  'Focus/DND-aware scheduling',
]
export function retireBenchmarkRoadmapSeeds(): void {
  if (meta().get('benchmarkSeedsRetired')) return
  const res = db()
    .delete(roadmapItems)
    .where(inArray(roadmapItems.title, RETIRED_SEED_TITLES))
    .run()
  if (res.changes > 0) logger.info('Retired benchmark roadmap seeds', { count: res.changes })
  meta().set('benchmarkSeedsRetired', true)
}

// Pure DB step: rewrite legacy status='idea' rows to 'todo'. Returns rows changed.
export function runIdeaToTodoUpdate(database: AppDatabase): number {
  const res = database
    .update(roadmapItems)
    .set({ status: 'todo' })
    .where(eq(roadmapItems.status, 'idea'))
    .run()
  return res.changes
}

// One-time migration for the idea→todo rename. Guarded by a meta flag AND scoped
// to idea rows, so it is safe to call on every startup.
export function migrateStatusIdeaToTodoIfNeeded(): void {
  if (meta().get('statusIdeaToTodoMigrated')) return
  const changed = runIdeaToTodoUpdate(db())
  if (changed > 0) logger.info('Roadmap status idea→todo migrated', { count: changed })
  meta().set('statusIdeaToTodoMigrated', true)
}

export function listRoadmap(): RoadmapItem[] {
  const rows = db()
    .select()
    .from(roadmapItems)
    .orderBy(asc(roadmapItems.position), asc(roadmapItems.createdAt))
    .all()
  // Stable category grouping for the UI; position orders within a category.
  return rows
    .map(toItem)
    .sort(
      (a, b) =>
        CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) ||
        a.position - b.position,
    )
}

export function createRoadmapItem(input: RoadmapCreate): RoadmapItem {
  // Append to the end of its category.
  const siblings = db()
    .select({ position: roadmapItems.position })
    .from(roadmapItems)
    .where(eq(roadmapItems.category, input.category))
    .all()
  const nextPos = siblings.reduce((max, s) => Math.max(max, s.position), -1) + 1
  const now = new Date()
  const row = {
    id: randomUUID(),
    title: input.title,
    description: input.description ?? '',
    category: input.category,
    status: input.status ?? 'todo',
    priority: input.priority ?? 'medium',
    claudePrompt: input.claudePrompt ?? '',
    position: nextPos,
    createdAt: now,
    updatedAt: now,
  }
  db().insert(roadmapItems).values(row).run()
  return toItem(row)
}

export function updateRoadmapItem(input: RoadmapUpdate): RoadmapItem {
  const { id, ...patch } = input
  const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))
  db()
    .update(roadmapItems)
    .set({ ...clean, updatedAt: new Date() })
    .where(eq(roadmapItems.id, id))
    .run()
  const row = db().select().from(roadmapItems).where(eq(roadmapItems.id, id)).get()
  if (!row) throw new Error(`Roadmap item not found: ${id}`)
  return toItem(row)
}

export function removeRoadmapItem(id: string): void {
  db().delete(roadmapItems).where(eq(roadmapItems.id, id)).run()
}
