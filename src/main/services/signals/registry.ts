import { EventEmitter } from 'node:events'
import { type AppDatabase, db as getDb } from '@main/db/client'
import { type SignalRow, signals } from '@main/db/schema'
import type { SignalLinkKind, SignalSeverity, SignalsSnapshot, SignalView } from '@shared/signals'
import { and, desc, eq, isNull, like, lt, lte, or, sql } from 'drizzle-orm'

// Retention: keep signals bounded so the table never grows without limit. Pruned
// on every insert (cheap: one delete + one count-gated delete).
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
const MAX_ROWS = 2000

// Single source of truth for "a new signal landed". recordSignal() emits
// 'change'; the signals tRPC router re-queries the DB and pushes a fresh
// snapshot. Mirrors JobRegistry's emitter shape.
class SignalRegistry extends EventEmitter {
  onChange(listener: () => void): () => void {
    this.on('change', listener)
    return () => this.off('change', listener)
  }
}

export const signalRegistry = new SignalRegistry()

export interface RecordSignalInput {
  source: string
  type: string
  severity: SignalSeverity
  title: string
  detail?: string | null
  link?: string | null
  linkKind?: SignalLinkKind | null
}

// Map a DB row to the wire shape (Date → epoch ms; no transformer on the IPC).
export function toSignalView(row: SignalRow): SignalView {
  return {
    id: row.id,
    source: row.source,
    type: row.type,
    severity: row.severity as SignalSeverity,
    title: row.title,
    detail: row.detail,
    link: row.link,
    linkKind: (row.linkKind ?? null) as SignalLinkKind | null,
    createdAt: row.createdAt.getTime(),
    readAt: row.readAt ? row.readAt.getTime() : null,
  }
}

export interface PruneOptions {
  nowMs: number
  retentionMs?: number
  maxRows?: number
}

// Delete rows older than the retention window, then trim to the newest maxRows
// (by id, which is monotonic with insertion order). Exported for unit tests.
export function pruneSignals(database: AppDatabase, opts: PruneOptions): void {
  const retentionMs = opts.retentionMs ?? RETENTION_MS
  const maxRows = opts.maxRows ?? MAX_ROWS
  database
    .delete(signals)
    .where(lt(signals.createdAt, new Date(opts.nowMs - retentionMs)))
    .run()
  // The row just past the newest `maxRows` (ordered by id desc); everything at or
  // below its id is surplus and gets deleted.
  const cutoff = database
    .select({ id: signals.id })
    .from(signals)
    .orderBy(desc(signals.id))
    .limit(1)
    .offset(maxRows)
    .get()
  if (cutoff) database.delete(signals).where(lte(signals.id, cutoff.id)).run()
}

// Insert a signal, prune, and notify subscribers. Defensive: never throws — a
// logging failure must not break the calling subsystem (jobs, chat, etc.).
// Returns the inserted row, or null on failure. `database` defaults to the app
// db; tests and db-scoped services (infra) pass an explicit instance.
export function recordSignal(input: RecordSignalInput, database?: AppDatabase): SignalRow | null {
  try {
    const dbi = database ?? getDb()
    const now = new Date()
    const row = dbi
      .insert(signals)
      .values({
        source: input.source,
        type: input.type,
        severity: input.severity,
        title: input.title,
        detail: input.detail ?? null,
        link: input.link ?? null,
        linkKind: input.linkKind ?? null,
        createdAt: now,
      })
      .returning()
      .get()
    pruneSignals(dbi, { nowMs: now.getTime() })
    signalRegistry.emit('change')
    return row
  } catch (err) {
    console.warn('[signals] recordSignal failed:', err instanceof Error ? err.message : err)
    return null
  }
}

// Newest-first signals (up to `limit`) plus the total unread count.
export function getSnapshot(database: AppDatabase, limit = 50): SignalsSnapshot {
  const rows = database
    .select()
    .from(signals)
    .orderBy(desc(signals.createdAt), desc(signals.id))
    .limit(limit)
    .all()
  const unread =
    database.select({ c: sql<number>`count(*)` }).from(signals).where(isNull(signals.readAt)).get()
      ?.c ?? 0
  return { signals: rows.map(toSignalView), unreadCount: unread }
}

export interface HistoryFilter {
  source?: string
  type?: string
  severity?: SignalSeverity
  search?: string
  limit?: number
  offset?: number
}

// Filtered + paginated history for the Signals page. Returns the page rows and
// the total match count (for pagination). Search matches title OR detail.
export function historySignals(
  database: AppDatabase,
  filter: HistoryFilter,
): { rows: SignalView[]; total: number } {
  const clauses = []
  if (filter.source) clauses.push(eq(signals.source, filter.source))
  if (filter.type) clauses.push(eq(signals.type, filter.type))
  if (filter.severity) clauses.push(eq(signals.severity, filter.severity))
  if (filter.search) {
    const q = `%${filter.search}%`
    clauses.push(or(like(signals.title, q), like(signals.detail, q)))
  }
  const where = clauses.length ? and(...clauses) : undefined

  const total =
    database.select({ c: sql<number>`count(*)` }).from(signals).where(where).get()?.c ?? 0

  const rows = database
    .select()
    .from(signals)
    .where(where)
    .orderBy(desc(signals.createdAt), desc(signals.id))
    .limit(filter.limit ?? 100)
    .offset(filter.offset ?? 0)
    .all()

  return { rows: rows.map(toSignalView), total }
}

export function getSignalById(database: AppDatabase, id: number): SignalRow | undefined {
  return database.select().from(signals).where(eq(signals.id, id)).get()
}

// Stamp one signal read (idempotent — a no-op if already read or missing).
export function markSignalRead(database: AppDatabase, id: number): void {
  database
    .update(signals)
    .set({ readAt: new Date() })
    .where(and(eq(signals.id, id), isNull(signals.readAt)))
    .run()
}

// Stamp every unread signal read; returns how many were changed.
export function markAllSignalsRead(database: AppDatabase): number {
  const now = new Date()
  const unread = database
    .select({ id: signals.id })
    .from(signals)
    .where(isNull(signals.readAt))
    .all()
  if (unread.length === 0) return 0
  database.update(signals).set({ readAt: now }).where(isNull(signals.readAt)).run()
  return unread.length
}
