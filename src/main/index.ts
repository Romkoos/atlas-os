import { initDb } from '@main/db/client'
import { runMigrations } from '@main/db/migrate'
import { initLogger, logger } from '@main/logger'
import { buildMenu } from '@main/menu'
import { applySecurity } from '@main/security'
import { getSettings, initStore } from '@main/store'
import { appRouter } from '@main/trpc/router'
import { createMainWindow } from '@main/window'
import { app, BrowserWindow } from 'electron'
import { createIPCHandler } from 'electron-trpc/main'

app
  .whenReady()
  .then(() => {
    initStore()
    const settings = getSettings()
    initLogger(settings.logLevel)
    logger.info('Atlas OS starting', { version: app.getVersion() })

    initDb()
    runMigrations()
    logger.info('Database ready and migrations applied')

    applySecurity()

    const win = createMainWindow()
    buildMenu(win)

    const handler = createIPCHandler({
      router: appRouter,
      windows: [win],
      createContext: async () => ({}),
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        const next = createMainWindow()
        buildMenu(next)
        handler.attachWindow(next)
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
