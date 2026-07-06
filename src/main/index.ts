import { db, initDb } from '@main/db/client'
import { runMigrations } from '@main/db/migrate'
import { initLogger, logger } from '@main/logger'
import { buildMenu } from '@main/menu'
import { appPaths } from '@main/paths'
import { applySecurity } from '@main/security'
import { chatRegistry } from '@main/services/chat/registry'
import { subscriptionUsage } from '@main/services/chat/subscriptionUsage'
import { startUsagePolling } from '@main/services/chat/usagePoll'
import { ingestAll } from '@main/services/productivity/ingest'
import {
  backfillRoadmapClaudePrompts,
  migrateStatusIdeaToTodoIfNeeded,
  seedRoadmapIfNeeded,
} from '@main/services/roadmap/store'
import { getSettings, initStore } from '@main/store'
import { registerTrpcIpc } from '@main/trpc/ipc'
import { createMainWindow } from '@main/window'
import { app, BrowserWindow, powerMonitor } from 'electron'

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

    const win = createMainWindow()
    buildMenu(win)

    ingestProductivity()

    // Show the last known usage immediately (survives restarts and a throttled
    // `/usage` endpoint), then keep the gauge populated at rest: poll the
    // subscription usage endpoint (same data as the CLI's `/usage`) so the widget
    // shows real limits without waiting for a chat run's intermittent
    // rate_limit_event.
    subscriptionUsage.restore(appPaths().usageSnapshot)
    startUsagePolling((windows) => subscriptionUsage.updateFromPoll(windows, Date.now()))

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        buildMenu(createMainWindow())
      }
    })
  })
  .catch((error) => {
    logger.error('Fatal startup error', error)
    app.quit()
  })

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
