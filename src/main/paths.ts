import { join } from 'node:path'
import { app } from 'electron'

export interface AppPaths {
  userData: string
  db: string
  defaultOutputDir: string
  migrations: string
  // Productivity tracker raw sources (see docs/agent-productivity-tracker.md).
  claudeProjectsDir: string // ~/.claude/projects — Claude Code transcripts
  analyticsBufferDir: string // ~/agent-analytics — hook JSONL buffer
}

// Must be called after app is ready (depends on app.getPath).
export function appPaths(): AppPaths {
  const userData = app.getPath('userData')
  const home = app.getPath('home')
  return {
    userData,
    db: join(userData, 'atlas.db'),
    defaultOutputDir: join(userData, 'outputs'),
    // Dev: ./drizzle in the project root. Packaged: bundled via extraResources.
    migrations: app.isPackaged
      ? join(process.resourcesPath, 'drizzle')
      : join(app.getAppPath(), 'drizzle'),
    claudeProjectsDir: join(home, '.claude', 'projects'),
    analyticsBufferDir: join(home, 'agent-analytics'),
  }
}
