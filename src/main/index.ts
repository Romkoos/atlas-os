import { buildMenu } from '@main/menu'
import { applySecurity } from '@main/security'
import { createMainWindow } from '@main/window'
import { app, BrowserWindow } from 'electron'

app.whenReady().then(() => {
  applySecurity()
  const win = createMainWindow()
  buildMenu(win)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const next = createMainWindow()
      buildMenu(next)
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
