import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import type { ArticleDoc, ArticleKind } from '@shared/knowledge'
import { load as parseYaml } from 'js-yaml'

export const RESERVED = '_engine'

// Store root: env override, else ~/atlas-knowledge. Never hardcode the abspath.
// The KB compiler pipeline is gone; this root now only backs the graphify
// indexer/preview (article bodies for the code graph) and the news/trending
// digests (which write under news/).
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
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      frontmatter = parsed as Record<string, unknown>
    }
  } catch {
    frontmatter = {}
  }
  return { frontmatter, body: m[2] }
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

// Validate `project` is a single safe dir segment and return its guarded abs
// path. Rejects separators and `.`/`..` so a crafted project can't escape root.
export function projectRoot(root: string, project: string): string {
  if (
    !project ||
    project === '.' ||
    project === '..' ||
    project.includes('/') ||
    project.includes('\\')
  ) {
    throw new Error(`invalid project: ${project}`)
  }
  return assertInside(root, project)
}

const KINDS: ReadonlyArray<{ dir: string; kind: ArticleKind }> = [
  { dir: 'concepts', kind: 'concept' },
  { dir: 'connections', kind: 'connection' },
  { dir: 'qa', kind: 'qa' },
]

function loadProjectsJson(root: string): Record<string, string> {
  const f = join(root, RESERVED, 'projects.json')
  if (!existsSync(f)) return {}
  try {
    const parsed = JSON.parse(readFileSync(f, 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, string>)
      : {}
  } catch {
    return {}
  }
}

// Map a real filesystem project path (as stored in agent_sessions.projectPath)
// to its store project name, via _engine/projects.json. Null if the path isn't
// a registered project.
export function projectNameForPath(root: string, projectPath: string): string | null {
  const projects = loadProjectsJson(root)
  for (const [name, abspath] of Object.entries(projects)) {
    if (abspath === projectPath) return name
  }
  return null
}

// All article files for a project, paired with parsed frontmatter + raw body.
// Consumed by the graphify indexer (article nodes) and preview (body text).
export function readAllArticles(
  root: string,
  project: string,
): Array<{ relPath: string; kind: ArticleKind; doc: ArticleDoc }> {
  const kdir = assertInside(projectRoot(root, project), 'knowledge')
  const out: Array<{ relPath: string; kind: ArticleKind; doc: ArticleDoc }> = []
  for (const { dir, kind } of KINDS) {
    const abs = join(kdir, dir)
    if (!existsSync(abs)) continue
    for (const file of readdirSync(abs)) {
      if (!file.endsWith('.md')) continue
      const relPath = `${dir}/${file}`
      out.push({ relPath, kind, doc: parseFrontmatter(readFileSync(join(abs, file), 'utf8')) })
    }
  }
  return out
}

export function readArticle(root: string, project: string, relPath: string): ArticleDoc {
  const abs = assertInside(join(projectRoot(root, project), 'knowledge'), relPath)
  if (!existsSync(abs)) return { frontmatter: {}, body: '' }
  return parseFrontmatter(readFileSync(abs, 'utf8'))
}
