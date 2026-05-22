import * as schema from '@main/db/schema'
import { appPaths } from '@main/paths'
import Database from 'better-sqlite3'
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3'

export type AppDatabase = BetterSQLite3Database<typeof schema>

let _db: AppDatabase | null = null

export function initDb(): AppDatabase {
  const { db: file } = appPaths()
  const sqlite = new Database(file)
  sqlite.pragma('journal_mode = WAL')
  _db = drizzle(sqlite, { schema })
  return _db
}

export function db(): AppDatabase {
  if (!_db) throw new Error('Database not initialized')
  return _db
}
