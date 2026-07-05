import { popoverPosition, trayIconBitmap } from '@main/tray.helpers'
import { describe, expect, it } from 'vitest'

const workArea = { x: 0, y: 25, width: 1440, height: 875 }

describe('popoverPosition', () => {
  it('centers the popover horizontally under the tray icon', () => {
    const tray = { x: 700, y: 0, width: 24, height: 24 }
    const { x } = popoverPosition(tray, { width: 340, height: 480 }, workArea)
    // center of icon (712) minus half width (170) = 542
    expect(x).toBe(542)
  })

  it('places the popover just below the menu bar', () => {
    const tray = { x: 700, y: 0, width: 24, height: 24 }
    const { y } = popoverPosition(tray, { width: 340, height: 480 }, workArea, 8)
    // tray bottom (24) + margin (8) = 32
    expect(y).toBe(32)
  })

  it('clamps to the right work-area edge when the icon is near the corner', () => {
    const tray = { x: 1420, y: 0, width: 20, height: 24 }
    const { x } = popoverPosition(tray, { width: 340, height: 480 }, workArea, 8)
    // maxX = 0 + 1440 - 340 - 8 = 1092
    expect(x).toBe(1092)
  })

  it('never positions left of the work-area left edge', () => {
    const tray = { x: 0, y: 0, width: 10, height: 24 }
    const offset = { x: 200, y: 25, width: 1440, height: 875 }
    const { x } = popoverPosition(tray, { width: 340, height: 480 }, offset, 8)
    expect(x).toBe(offset.x + 8)
  })
})

describe('trayIconBitmap', () => {
  it('returns a square BGRA buffer with a 2x scale factor', () => {
    const bmp = trayIconBitmap()
    expect(bmp.width).toBe(bmp.height)
    expect(bmp.scaleFactor).toBe(2)
    expect(bmp.data.length).toBe(bmp.width * bmp.height * 4)
  })

  it('draws an opaque black glyph on a transparent field', () => {
    const bmp = trayIconBitmap()
    let opaque = 0
    for (let i = 0; i < bmp.data.length; i += 4) {
      if (bmp.data[i + 3] === 255) {
        opaque++
        // Template images are black; premultiplied color channels stay 0.
        expect(bmp.data[i]).toBe(0)
        expect(bmp.data[i + 1]).toBe(0)
        expect(bmp.data[i + 2]).toBe(0)
      }
    }
    expect(opaque).toBeGreaterThan(0)
    // The corners are outside the ring — fully transparent.
    expect(bmp.data[3]).toBe(0)
  })
})
