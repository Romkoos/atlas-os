// Blank right pane for chat types with no Canvas content (worker & general chat
// in Phase 1, or any type before it produces output). Intentionally minimal — a
// bare chat's right pane stays empty; drag the divider to reclaim the width.
export function EmptyCanvas() {
  return <div className="canvas-empty" aria-hidden="true" />
}
