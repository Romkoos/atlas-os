export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

// Center a popover of `win` size horizontally under the tray icon, dropped just
// below the menu bar. Both axes are clamped into the display work area (minus a
// small margin) so the popover never renders off-screen on any menu-bar layout.
export function popoverPosition(
  tray: Rect,
  win: { width: number; height: number },
  workArea: Rect,
  margin = 8,
): { x: number; y: number } {
  const idealX = Math.round(tray.x + tray.width / 2 - win.width / 2)
  const minX = workArea.x + margin
  const maxX = workArea.x + workArea.width - win.width - margin
  const x = Math.max(minX, Math.min(idealX, maxX))

  const idealY = Math.round(tray.y + tray.height + margin)
  const minY = workArea.y
  const maxY = workArea.y + workArea.height - win.height - margin
  const y = Math.max(minY, Math.min(idealY, maxY))

  return { x, y }
}

export interface TrayBitmap {
  data: Buffer
  width: number
  height: number
  scaleFactor: number
}

// Procedural menu-bar glyph: a ring with a center dot, drawn as a black-on-alpha
// BGRA bitmap (premultiplied). Marked as a template image by the caller so macOS
// tints it for light/dark menu bars. Built at 2x for crisp Retina rendering.
export function trayIconBitmap(): TrayBitmap {
  const size = 36
  const scaleFactor = 2
  const center = (size - 1) / 2
  const outer = 15.5
  const band = 3.5 // ring thickness
  const dot = 3.5 // center dot radius

  const data = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - center
      const dy = y - center
      const d = Math.sqrt(dx * dx + dy * dy)
      const on = (d <= outer && d >= outer - band) || d <= dot
      const i = (y * size + x) * 4
      // BGRA, premultiplied black: color channels 0, alpha carries the shape.
      data[i] = 0
      data[i + 1] = 0
      data[i + 2] = 0
      data[i + 3] = on ? 255 : 0
    }
  }
  return { data, width: size, height: size, scaleFactor }
}
