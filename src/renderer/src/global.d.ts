import type { AtlasBridge, AtlasTrpcBridge } from '@shared/bridge'

declare global {
  interface Window {
    atlas: AtlasBridge
    atlasTrpc: AtlasTrpcBridge
  }
}
