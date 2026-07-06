import type { AppDatabase } from '@main/db/client'
import * as schema from '@main/db/schema'
import { signals } from '@main/db/schema'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { describe, expect, it, vi } from 'vitest'
import {
  getSignalById,
  getSnapshot,
  historySignals,
  markAllSignalsRead,
  markSignalRead,
  pruneSignals,
  recordSignal,
  signalRegistry,
  toSignalView,
} from './registry'

function testDb(): AppDatabase {
  const sqlite = new Database(':memory:')
  const database = drizzle(sqlite, { schema })
  migrate(database, { migrationsFolder: 'drizzle' })
  return database
}

// Insert directly with an explicit createdAt (bypasses recordSignal's pruning),
// used to seed retention/cap tests.
function seed(
  db: AppDatabase,
  createdAt: Date,
  overrides: Partial<typeof signals.$inferInsert> = {},
) {
  return db
    .insert(signals)
    .values({
      source: 'jobs',
      type: 'job.completed',
      severity: 'info',
      title: 'seed',
      createdAt,
      ...overrides,
    })
    .returning()
    .get()
}

describe('recordSignal', () => {
  it('inserts a row and returns it', () => {
    const db = testDb()
    const row = recordSignal(
      { source: 'jobs', type: 'job.completed', severity: 'success', title: 'News digest' },
      db,
    )
    expect(row?.id).toBeGreaterThan(0)
    expect(row?.severity).toBe('success')
    expect(db.select().from(signals).all()).toHaveLength(1)
  })

  it('emits a change event', () => {
    const db = testDb()
    const spy = vi.fn()
    const off = signalRegistry.onChange(spy)
    recordSignal({ source: 'chat', type: 'chat.error', severity: 'error', title: 'x' }, db)
    off()
    expect(spy).toHaveBeenCalledOnce()
  })

  it('never throws when the database is unavailable (defensive)', () => {
    // No db arg → falls back to the uninitialized global db(), which throws
    // internally. recordSignal must swallow it and return null.
    expect(() =>
      recordSignal({ source: 'jobs', type: 'job.failed', severity: 'error', title: 'x' }),
    ).not.toThrow()
  })
})

describe('getSnapshot', () => {
  it('returns newest-first signals plus the unread count', () => {
    const db = testDb()
    seed(db, new Date(1000), { title: 'old' })
    seed(db, new Date(2000), { title: 'new' })
    seed(db, new Date(3000), { title: 'read', readAt: new Date(3500) })
    const snap = getSnapshot(db, 50)
    expect(snap.signals.map((s) => s.title)).toEqual(['read', 'new', 'old'])
    expect(snap.unreadCount).toBe(2)
  })

  it('caps to the requested limit', () => {
    const db = testDb()
    for (let i = 0; i < 5; i++) seed(db, new Date(i * 1000))
    expect(getSnapshot(db, 3).signals).toHaveLength(3)
  })
})

describe('markSignalRead / markAllSignalsRead', () => {
  it('marks a single signal read', () => {
    const db = testDb()
    const row = seed(db, new Date(1000))
    markSignalRead(db, row.id)
    expect(getSnapshot(db, 50).unreadCount).toBe(0)
    expect(getSignalById(db, row.id)?.readAt).not.toBeNull()
  })

  it('marks all unread signals read and returns the count', () => {
    const db = testDb()
    seed(db, new Date(1000))
    seed(db, new Date(2000))
    seed(db, new Date(3000), { readAt: new Date(3500) })
    const changed = markAllSignalsRead(db)
    expect(changed).toBe(2)
    expect(getSnapshot(db, 50).unreadCount).toBe(0)
  })
})

describe('pruneSignals', () => {
  it('deletes rows older than the retention window', () => {
    const db = testDb()
    const now = 100 * 24 * 60 * 60 * 1000
    seed(db, new Date(now)) // fresh
    seed(db, new Date(now - 40 * 24 * 60 * 60 * 1000)) // 40d old → pruned
    pruneSignals(db, { nowMs: now, retentionMs: 30 * 24 * 60 * 60 * 1000, maxRows: 2000 })
    expect(db.select().from(signals).all()).toHaveLength(1)
  })

  it('trims to the newest maxRows', () => {
    const db = testDb()
    for (let i = 0; i < 10; i++) seed(db, new Date(1000 + i * 1000))
    pruneSignals(db, { nowMs: 100_000, retentionMs: Number.MAX_SAFE_INTEGER, maxRows: 4 })
    const rows = db.select().from(signals).all()
    expect(rows).toHaveLength(4)
    // The 4 survivors are the newest (largest createdAt).
    expect(Math.min(...rows.map((r) => r.createdAt.getTime()))).toBe(1000 + 6 * 1000)
  })
})

describe('historySignals', () => {
  it('filters by source, severity, and free-text search', () => {
    const db = testDb()
    seed(db, new Date(1000), { source: 'jobs', severity: 'success', title: 'News digest ready' })
    seed(db, new Date(2000), { source: 'chat', severity: 'error', title: 'Chat run failed' })
    seed(db, new Date(3000), {
      source: 'infra',
      severity: 'info',
      title: 'Skill edited',
      detail: 'graphify',
    })

    expect(historySignals(db, { source: 'chat' }).rows.map((r) => r.title)).toEqual([
      'Chat run failed',
    ])
    expect(historySignals(db, { severity: 'error' }).rows).toHaveLength(1)
    expect(historySignals(db, { search: 'graphify' }).rows.map((r) => r.title)).toEqual([
      'Skill edited',
    ])
    expect(historySignals(db, {}).rows).toHaveLength(3)
  })

  it('paginates with limit and offset, newest first', () => {
    const db = testDb()
    for (let i = 0; i < 5; i++) seed(db, new Date(1000 + i * 1000), { title: `s${i}` })
    const page = historySignals(db, { limit: 2, offset: 1 })
    expect(page.rows.map((r) => r.title)).toEqual(['s3', 's2'])
    expect(page.total).toBe(5)
  })
})

describe('toSignalView', () => {
  it('converts timestamps to epoch ms and coerces enums', () => {
    const db = testDb()
    const row = seed(db, new Date(1234), {
      readAt: new Date(5678),
      linkKind: 'section',
      link: 'roadmap',
    })
    const view = toSignalView(row)
    expect(view.createdAt).toBe(1234)
    expect(view.readAt).toBe(5678)
    expect(view.linkKind).toBe('section')
    expect(view.link).toBe('roadmap')
  })
})
