import { db } from '@main/db/client'
import { appPaths } from '@main/paths'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

export function runMigrations(): void {
  migrate(db(), { migrationsFolder: appPaths().migrations })
}
