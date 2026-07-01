export interface Anchor {
  x: number
  y: number
  z: number
}

// Distribute one anchor per distinct cluster key evenly over a sphere using the
// Fibonacci-sphere method. Deterministic (no randomness), so layouts are stable
// across renders. Colored nodes pulled toward a shared anchor read as a "star
// cluster" region. 0 keys → empty; 1 key → centered at the origin.
export function clusterAnchors(keys: Array<string | number>, radius = 300): Map<string, Anchor> {
  const uniq = [...new Set(keys.map(String))]
  const out = new Map<string, Anchor>()
  const n = uniq.length
  if (n === 0) return out
  if (n === 1) {
    out.set(uniq[0], { x: 0, y: 0, z: 0 })
    return out
  }
  const golden = Math.PI * (3 - Math.sqrt(5)) // golden-angle increment
  uniq.forEach((key, i) => {
    const y = 1 - (i / (n - 1)) * 2 // 1 → -1
    const r = Math.sqrt(Math.max(0, 1 - y * y))
    const theta = golden * i
    out.set(key, {
      x: Math.cos(theta) * r * radius,
      y: y * radius,
      z: Math.sin(theta) * r * radius,
    })
  })
  return out
}
