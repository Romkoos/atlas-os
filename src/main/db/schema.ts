import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

// One row per AI action. Single source of truth for the Event type (re-used in
// the renderer via tRPC type inference — never imported at runtime there).
export const events = sqliteTable('events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  type: text('type').notNull(),
  model: text('model').notNull(),
  tokens: integer('tokens').notNull().default(0),
  filePath: text('file_path'),
  durationMs: integer('duration_ms').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
})

export type EventRow = typeof events.$inferSelect
export type NewEventRow = typeof events.$inferInsert
