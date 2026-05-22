import type { AtlasBridge } from '@shared/bridge'

declare global {
  interface Window {
    atlas: AtlasBridge
    // Injected by electron-trpc's exposeElectronTRPC() (infrastructure phase).
    electronTRPC: unknown
  }
}
