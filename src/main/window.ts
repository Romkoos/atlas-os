import { join } from 'node:path'
import { buildMenu } from '@main/menu'
import { BrowserWindow, ipcMain, shell } from 'electron'

// The single primary window. Tracked so the tray/dock can reopen it after close.
let mainWindow: BrowserWindow | null = null

// The renderer draws its own terminal title bar (frame: false), so window
// controls come back over IPC. Registered once for all windows.
let controlsRegistered = false
function registerWindowControls(): void {
  if (controlsRegistered) return
  controlsRegistered = true
  const fromEvent = (event: Electron.IpcMainEvent) => BrowserWindow.fromWebContents(event.sender)
  ipcMain.on('window:minimize', (event) => fromEvent(event)?.minimize())
  ipcMain.on('window:toggle-maximize', (event) => {
    const win = fromEvent(event)
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.on('window:close', (event) => fromEvent(event)?.close())
}

export function createMainWindow(): BrowserWindow {
  registerWindowControls()

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 940,
    minHeight: 600,
    show: false,
    frame: false,
    backgroundColor: '#28251f',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow = win
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  // Launch filling the screen. Maximize (not fullscreen) so the custom title
  // bar and window controls stay visible; the width/height above are the
  // restore-down size.
  win.on('ready-to-show', () => {
    win.maximize()
    win.show()
  })

  // External links open in the user's browser, never in-app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

// The live primary window, or null if it has been closed/destroyed.
export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

// The primary window, recreated (with its menu) if it was closed. Used by the
// tray and the dock 'activate' handler so the window always comes back.
export function ensureMainWindow(): BrowserWindow {
  const existing = getMainWindow()
  if (existing) return existing
  const win = createMainWindow()
  buildMenu(win)
  return win
}
