import type { AtlasBridge, AtlasTrpcBridge } from '@shared/bridge'
import { contextBridge, ipcRenderer } from 'electron'

const TRPC_CHANNEL = 'atlas-trpc'

// Minimal tRPC transport bridge (sandbox-safe: only uses the 'electron' module).
const atlasTrpc: AtlasTrpcBridge = {
  send: (message) => ipcRenderer.send(TRPC_CHANNEL, message),
  subscribe: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, message: unknown) => callback(message)
    ipcRenderer.on(TRPC_CHANNEL, listener)
    return () => {
      ipcRenderer.removeListener(TRPC_CHANNEL, listener)
    }
  },
}

contextBridge.exposeInMainWorld('atlasTrpc', atlasTrpc)

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
