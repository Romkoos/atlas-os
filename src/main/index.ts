import { join } from 'node:path'
import { db, initDb } from '@main/db/client'
import { runMigrations } from '@main/db/migrate'
import { initLogger, logger } from '@main/logger'
import { appPaths, repoRoot } from '@main/paths'
import { applySecurity } from '@main/security'
import { chatRegistry } from '@main/services/chat/registry'
import { subscriptionUsage } from '@main/services/chat/subscriptionUsage'
import { startUsagePolling } from '@main/services/chat/usagePoll'
import { initShellPath } from '@main/services/llm/shellPath'
import { ingestAll } from '@main/services/productivity/ingest'
import {
  backfillRoadmapClaudePrompts,
  migrateStatusIdeaToTodoIfNeeded,
  seedRoadmapIfNeeded,
} from '@main/services/roadmap/store'
import { getSettings, initStore } from '@main/store'
import { createTray } from '@main/tray'
import { registerTrpcIpc } from '@main/trpc/ipc'
import { ensureMainWindow } from '@main/window'
import { app, nativeImage, powerMonitor } from 'electron'

// Productivity tracker: pull the latest transcripts + hook buffer into the DB.
// Fire-and-forget so a slow/large scan never blocks the window.
function ingestProductivity(): void {
  const { claudeProjectsDir, analyticsBufferDir, claudeDir, claudeJson, infraSnapshot } = appPaths()
  ingestAll(db(), {
    projectsDir: claudeProjectsDir,
    bufferDir: analyticsBufferDir,
    claudeDir,
    claudeJson,
    infraSnapshotPath: infraSnapshot,
  })
    .then((res) => logger.info('Productivity ingest complete', res))
    .catch((error) => logger.error('Productivity ingest failed', error))
}

app
  .whenReady()
  .then(() => {
    initStore()
    const settings = getSettings()
    initLogger(settings.logLevel)
    logger.info('Atlas OS starting', { version: app.getVersion() })

    // Dock icon. A packaged build gets its icon from the bundle (build/icon.icns),
    // but in dev macOS shows the prebuilt Electron binary's icon — set it explicitly
    // so the real app icon appears in the dock while developing too.
    if (process.platform === 'darwin' && app.dock) {
      const dockIcon = nativeImage.createFromPath(join(repoRoot(), 'build', 'icon.png'))
      if (!dockIcon.isEmpty()) app.dock.setIcon(dockIcon)
    }

    // Resolve the user's real login-shell PATH so spawned agents (and their Bash
    // tool → graphify/uv) escape launchd's minimal PATH in a packaged build.
    // Fire-and-forget: fallback bin dirs (incl. ~/.local/bin) already cover the
    // common tools, so early spawns work even before this resolves. No-op in dev.
    initShellPath({ isPackaged: app.isPackaged })
      .then(() => logger.info('Shell PATH resolved for spawned agents'))
      .catch((error) => logger.warn('Shell PATH resolution failed; using fallback dirs', error))

    // After the machine wakes, re-establish any chat run whose stream died during
    // sleep instead of waiting for the per-run stall watchdog.
    powerMonitor.on('resume', () => chatRegistry.nudgeStalled())

    initDb()
    runMigrations()
    seedRoadmapIfNeeded()
    backfillRoadmapClaudePrompts()
    migrateStatusIdeaToTodoIfNeeded()
    logger.info('Database ready and migrations applied')

    applySecurity()
    registerTrpcIpc()

    ensureMainWindow()
    createTray(ensureMainWindow)

    ingestProductivity()

    // Show the last known usage immediately (survives restarts and a throttled
    // `/usage` endpoint), then keep the gauge populated at rest: poll the
    // subscription usage endpoint (same data as the CLI's `/usage`) so the widget
    // shows real limits without waiting for a chat run's intermittent
    // rate_limit_event.
    subscriptionUsage.restore(appPaths().usageSnapshot)
    startUsagePolling((windows) => subscriptionUsage.updateFromPoll(windows, Date.now()))

    app.on('activate', () => {
      const win = ensureMainWindow()
      win.show()
      win.focus()
    })
  })
  .catch((error) => {
    logger.error('Fatal startup error', error)
    app.quit()
  })

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
