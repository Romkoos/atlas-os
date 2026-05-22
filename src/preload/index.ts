import type { AtlasBridge } from '@shared/bridge'
import { contextBridge, ipcRenderer } from 'electron'
import { exposeElectronTRPC } from 'electron-trpc/main'

// electron-trpc's typed IPC bridge → window.electronTRPC (consumed by ipcLink).
exposeElectronTRPC()

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
