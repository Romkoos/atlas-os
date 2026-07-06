import { join } from 'node:path'
import { popoverPosition, trayIconBitmap } from '@main/tray.helpers'
import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, Tray } from 'electron'

const POPOVER_WIDTH = 340
const POPOVER_HEIGHT = 480

export interface TrayHandle {
  destroy(): void
}

// Creates the menu-bar tray + its frameless popover HUD window, and wires the
// tray:* IPC channels the popover renderer uses to drive navigation/lifecycle.
export function createTray(ensureMainWindow: () => BrowserWindow): TrayHandle {
  const bmp = trayIconBitmap()
  const icon = nativeImage.createFromBitmap(bmp.data, {
    width: bmp.width,
    height: bmp.height,
    scaleFactor: bmp.scaleFactor,
  })
  icon.setTemplateImage(true)

  const tray = new Tray(icon)
  tray.setToolTip('Atlas OS')

  let popover: BrowserWindow | null = null

  const getPopover = (): BrowserWindow => {
    if (popover && !popover.isDestroyed()) return popover
    const win = new BrowserWindow({
      width: POPOVER_WIDTH,
      height: POPOVER_HEIGHT,
      show: false,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      backgroundColor: '#28251f',
      webPreferences: {
        preload: join(__dirname, '../preload/index.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })
    // Auto-hide when focus leaves, unless its DevTools are open (so it can be
    // inspected without the window vanishing).
    win.on('blur', () => {
      if (!win.isDestroyed() && !win.webContents.isDevToolsOpened()) win.hide()
    })
    if (process.env.ELECTRON_RENDERER_URL) {
      void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/tray.html`)
    } else {
      void win.loadFile(join(__dirname, '../renderer/tray.html'))
    }
    popover = win
    return win
  }

  const showPopover = (): void => {
    const win = getPopover()
    const b = tray.getBounds()
    const display = screen.getDisplayNearestPoint({ x: b.x, y: b.y })
    const { x, y } = popoverPosition(
      b,
      { width: POPOVER_WIDTH, height: POPOVER_HEIGHT },
      display.workArea,
    )
    win.setPosition(x, y, false)
    win.show()
    win.focus()
  }

  const hidePopover = (): void => {
    if (popover && !popover.isDestroyed()) popover.hide()
  }

  const togglePopover = (): void => {
    if (popover && !popover.isDestroyed() && popover.isVisible()) hidePopover()
    else showPopover()
  }

  const focusMain = (): BrowserWindow => {
    const win = ensureMainWindow()
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    return win
  }

  // Send 'navigate' once the renderer is ready — a freshly recreated window is
  // still loading, and an early send would be dropped before App mounts.
  const sendNavigate = (win: BrowserWindow, section: string): void => {
    const wc = win.webContents
    if (wc.isLoading()) wc.once('did-finish-load', () => wc.send('navigate', section))
    else wc.send('navigate', section)
  }

  tray.on('click', () => togglePopover())
  tray.on('right-click', () => {
    tray.popUpContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open Atlas OS', click: () => focusMain() },
        { type: 'separator' },
        { role: 'quit' },
      ]),
    )
  })

  const onNavigate = (_e: Electron.IpcMainEvent, section: string): void => {
    sendNavigate(focusMain(), section)
    hidePopover()
  }
  const onOpen = (): void => {
    focusMain()
    hidePopover()
  }
  const onQuit = (): void => app.quit()
  const onHide = (): void => hidePopover()

  ipcMain.on('tray:navigate', onNavigate)
  ipcMain.on('tray:open', onOpen)
  ipcMain.on('tray:quit', onQuit)
  ipcMain.on('tray:hide', onHide)

  return {
    destroy() {
      ipcMain.removeListener('tray:navigate', onNavigate)
      ipcMain.removeListener('tray:open', onOpen)
      ipcMain.removeListener('tray:quit', onQuit)
      ipcMain.removeListener('tray:hide', onHide)
      if (popover && !popover.isDestroyed()) popover.destroy()
      tray.destroy()
    },
  }
}
