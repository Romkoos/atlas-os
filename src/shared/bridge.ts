// Shape of the preload bridges exposed on `window`. Implemented in
// src/preload/index.ts, consumed by the renderer.

/** Frameless-window controls driven by the custom terminal title bar. */
export interface AtlasWindowControls {
  minimize(): void
  toggleMaximize(): void
  close(): void
}

/** Menu-bar HUD → main controls (navigate to a page, open/quit the app, hide the popover). */
export interface AtlasTrayControls {
  navigate(section: string): void
  openMain(): void
  quit(): void
  hide(): void
}

export interface AtlasBridge {
  /** Subscribe to main-process navigation requests (e.g. Cmd+, → Settings). Returns an unsubscribe fn. */
  onNavigate(callback: (section: string) => void): () => void
  /** Window controls — the app is frameless, so the title bar drives these. */
  window: AtlasWindowControls
  /** Menu-bar HUD controls — the tray popover drives these. */
  tray: AtlasTrayControls
}

/** Minimal tRPC-over-IPC transport (replaces electron-trpc, which is tRPC v10 only). */
export interface AtlasTrpcBridge {
  send(message: unknown): void
  subscribe(callback: (message: unknown) => void): () => void
}
