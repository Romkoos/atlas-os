import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import type { ArticleDoc } from '@shared/knowledge'
import { load as parseYaml } from 'js-yaml'

export const RESERVED = '_engine'

// Store root: env override, else ~/atlas-knowledge. Never hardcode the abspath.
export function storeRoot(): string {
  return process.env.ATLAS_KB_STORE || join(homedir(), 'atlas-knowledge')
}

// Split a leading `---\n…\n---` YAML block from the markdown body. Malformed or
// absent frontmatter degrades to `{}` — never throws.
export function parseFrontmatter(raw: string): ArticleDoc {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw)
  if (!m) return { frontmatter: {}, body: raw }
  let frontmatter: Record<string, unknown> = {}
  try {
    const parsed = parseYaml(m[1])
    if (parsed && typeof parsed === 'object') frontmatter = parsed as Record<string, unknown>
  } catch {
    frontmatter = {}
  }
  return { frontmatter, body: m[2] }
}

// A store dir is visible iff its abspath (from projects.json) is tracked.
// Empty allowlist ⇒ show all.
export function isTracked(
  name: string,
  projects: Record<string, string>,
  tracked: ReadonlySet<string>,
): boolean {
  if (tracked.size === 0) return true
  const abspath = projects[name]
  return abspath ? tracked.has(abspath) : false
}

// Resolve `relPath` under `root` and assert it cannot escape (path traversal).
export function assertInside(root: string, relPath: string): string {
  const base = resolve(root)
  const target = resolve(base, relPath)
  if (target !== base && !target.startsWith(base + sep)) {
    throw new Error(`path escapes root: ${relPath}`)
  }
  return target
}
