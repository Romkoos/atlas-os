import type { AtlasBridge } from '@shared/bridge'
import { contextBridge, ipcRenderer } from 'electron'

// Narrow, typed bridge. The only other thing exposed is electron-trpc's
// `electronTRPC` channel (added in the infrastructure phase).
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
