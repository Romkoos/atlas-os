// Shape of the preload bridges exposed on `window`. Implemented in
// src/preload/index.ts, consumed by the renderer.

export interface AtlasBridge {
  /** Subscribe to main-process navigation requests (e.g. Cmd+, → Settings). Returns an unsubscribe fn. */
  onNavigate(callback: (section: string) => void): () => void
}

/** Minimal tRPC-over-IPC transport (replaces electron-trpc, which is tRPC v10 only). */
export interface AtlasTrpcBridge {
  send(message: unknown): void
  subscribe(callback: (message: unknown) => void): () => void
}
