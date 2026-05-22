import { join } from 'node:path'
import { app } from 'electron'

export interface AppPaths {
  userData: string
  db: string
  defaultOutputDir: string
  migrations: string
}

// Must be called after app is ready (depends on app.getPath).
export function appPaths(): AppPaths {
  const userData = app.getPath('userData')
  return {
    userData,
    db: join(userData, 'atlas.db'),
    defaultOutputDir: join(userData, 'outputs'),
    // Dev: ./drizzle in the project root. Packaged: bundled via extraResources.
    migrations: app.isPackaged
      ? join(process.resourcesPath, 'drizzle')
      : join(app.getAppPath(), 'drizzle'),
  }
}
