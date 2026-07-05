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
  claudeDir: string // ~/.claude — infra watcher root (settings.json, skills/)
  claudeJson: string // ~/.claude.json — MCP server config
  infraSnapshot: string // userData/infra-snapshot.json — last seen infra state
}

// Working directory for spawned agent runs (worker/general/roadmap/benchmark
// chats, benchmark suite). In dev, `app.getAppPath()` is the project root — a real
// directory. In a packaged build it points at `…/Resources/app.asar`, which is a
// FILE, so spawning a child with it as `cwd` fails with ENOTDIR. There is no repo
// inside the bundle, so fall back to the source checkout on this machine.
const PACKAGED_REPO_ROOT = '/Users/Roman.Neganov/Projects/PersonalProjects/atlas-os'

export function repoRoot(): string {
  return app.isPackaged ? PACKAGED_REPO_ROOT : app.getAppPath()
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
    claudeDir: join(home, '.claude'),
    claudeJson: join(home, '.claude.json'),
    infraSnapshot: join(userData, 'infra-snapshot.json'),
  }
}
