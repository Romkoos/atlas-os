// Clamp a left/right split ratio so neither pane falls below `minPx`. When the
// container cannot hold two minimums, fall back to a centred 0.5.
export function clampSplitRatio(ratio: number, containerPx: number, minPx: number): number {
  if (!Number.isFinite(ratio) || containerPx <= 0) return 0.5
  if (containerPx < minPx * 2) return 0.5
  const min = minPx / containerPx
  const max = 1 - min
  return Math.min(max, Math.max(min, ratio))
}
