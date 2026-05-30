import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import {
  type ArticleDoc,
  type ArticleKind,
  type ArticleMeta,
  countInbound,
  type DailyEntry,
  type KnowledgeProject,
} from '@shared/knowledge'
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
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {}
  } catch {
    return {}
  }
}

function asStr(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}
function asStrArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

// All article files for a project, paired with parsed frontmatter + raw body.
function readAllArticles(
  root: string,
  project: string,
): Array<{ relPath: string; kind: ArticleKind; doc: ArticleDoc }> {
  const kdir = assertInside(join(root, project), 'knowledge')
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

export function listArticles(root: string, project: string): ArticleMeta[] {
  const all = readAllArticles(root, project)
  const bodies = all.map((a) => ({ relPath: a.relPath, body: a.doc.body }))
  return all
    .map(({ relPath, kind, doc }) => ({
      relPath,
      kind,
      title: asStr(doc.frontmatter.title) ?? basename(relPath, '.md'),
      tags: asStrArray(doc.frontmatter.tags),
      aliases: asStrArray(doc.frontmatter.aliases),
      updated: asStr(doc.frontmatter.updated),
      inboundLinks: countInbound(relPath, bodies),
    }))
    .sort((a, b) => a.title.localeCompare(b.title))
}

export function listProjects(root: string, tracked: ReadonlySet<string>): KnowledgeProject[] {
  if (!existsSync(root)) return []
  const projects = loadProjectsJson(root)
  const out: KnowledgeProject[] = []
  for (const name of readdirSync(root)) {
    if (name === RESERVED) continue
    const dir = join(root, name)
    if (!statSync(dir).isDirectory()) continue
    if (!existsSync(join(dir, 'knowledge'))) continue
    if (!isTracked(name, projects, tracked)) continue
    const articles = listArticles(root, name)
    const daily = listDaily(root, name)
    const updates = articles.map((a) => a.updated).filter((u): u is string => u != null)
    out.push({
      name,
      path: dir,
      articleCount: articles.length,
      dailyCount: daily.length,
      lastUpdated: updates.length ? (updates.sort().at(-1) ?? null) : null,
    })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

export function readArticle(root: string, project: string, relPath: string): ArticleDoc {
  const abs = assertInside(join(root, project, 'knowledge'), relPath)
  if (!existsSync(abs)) return { frontmatter: {}, body: '' }
  return parseFrontmatter(readFileSync(abs, 'utf8'))
}

export function readIndex(root: string, project: string): string {
  const abs = assertInside(join(root, project, 'knowledge'), 'index.md')
  return existsSync(abs) ? readFileSync(abs, 'utf8') : ''
}

export function listDaily(root: string, project: string): DailyEntry[] {
  const abs = assertInside(join(root, project), 'daily')
  if (!existsSync(abs)) return []
  return readdirSync(abs)
    .filter((f) => f.endsWith('.md'))
    .map((f) => ({ date: f.replace(/\.md$/, ''), relPath: f }))
    .sort((a, b) => b.date.localeCompare(a.date))
}

export function readDaily(root: string, project: string, relPath: string): string {
  const abs = assertInside(join(root, project, 'daily'), relPath)
  return existsSync(abs) ? readFileSync(abs, 'utf8') : ''
}
