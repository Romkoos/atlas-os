// Shape of the narrow preload bridge exposed on `window.atlas`.
// Implemented in src/preload/index.ts, consumed by the renderer.
export interface AtlasBridge {
  /** Subscribe to main-process navigation requests (e.g. Cmd+, → Settings). Returns an unsubscribe fn. */
  onNavigate(callback: (section: string) => void): () => void
}
