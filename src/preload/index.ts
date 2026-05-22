import type { AtlasBridge } from '@shared/bridge'
import { contextBridge, ipcRenderer } from 'electron'

// electron-trpc's `electronTRPC` bridge, inlined. A sandboxed preload can only use
// the 'electron' module at runtime (it cannot require() node_modules), so we expose
// the exact contract ipcLink expects instead of importing electron-trpc/main here.
// Channel + shape mirror electron-trpc's exposeElectronTRPC().
const ELECTRON_TRPC_CHANNEL = 'electron-trpc'

contextBridge.exposeInMainWorld('electronTRPC', {
  sendMessage: (message: unknown) => ipcRenderer.send(ELECTRON_TRPC_CHANNEL, message),
  onMessage: (callback: (message: unknown) => void) =>
    ipcRenderer.on(ELECTRON_TRPC_CHANNEL, (_event, message) => callback(message)),
})

// Narrow, hand-written bridge for non-tRPC main→renderer signals.
const atlas: AtlasBridge = {
  onNavigate(callback) {
    const listener = (_event: Electron.IpcRendererEvent, section: string) => callback(section)
    ipcRenderer.on('navigate', listener)
    return () => {
      ipcRenderer.removeListener('navigate', listener)
    }
  },
}

contextBridge.exposeInMainWorld('atlas', atlas)
