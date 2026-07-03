import { homedir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'

// The engine dir under the store — never a project.
export const MAPS_RESERVED = '_engine'

// Store root: env override, else ~/atlas-maps. Mirrors knowledge storeRoot();
// never hardcode the abspath.
export function mapsRoot(): string {
  const store = process.env.ATLAS_MAPS_STORE
  return store && store !== 'undefined' ? store : join(homedir(), 'atlas-maps')
}

// Resolve `relPath` under `root` and assert it cannot escape (path traversal).
function assertInside(root: string, relPath: string): string {
  const base = resolve(root)
  const target = resolve(base, relPath)
  if (target !== base && !target.startsWith(base + sep)) {
    throw new Error(`path escapes root: ${relPath}`)
  }
  return target
}

// The per-project map dir: <mapsRoot>/<basename(projectPath)>. The basename is
// validated as a single safe segment so a hostile path can't escape the store
// root or collide with the engine dir.
export function mapsProjectDir(projectPath: string): string {
  const name = basename(projectPath)
  if (
    !name ||
    name === '.' ||
    name === '..' ||
    name === MAPS_RESERVED ||
    name.includes('/') ||
    name.includes('\\')
  ) {
    throw new Error(`invalid project for map store: ${name}`)
  }
  return assertInside(mapsRoot(), name)
}
