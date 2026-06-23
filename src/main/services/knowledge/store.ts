import { execFile } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import {
  type ArticleDoc,
  type ArticleKind,
  type ArticleMeta,
  type CompileResult,
  countInbound,
  type DailyEntry,
  type KnowledgeProject,
} from '@shared/knowledge'
import { load as parseYaml } from 'js-yaml'
import type { GraphArticleInput, GraphDailyInput } from './graph'

export const RESERVED = '_engine'

// Store-root dirs that are never knowledge projects and must never appear on the
// Knowledge page. `news/` holds the AI-news digest (its own NEWS tab), not a
// per-project knowledge base.
export const EXCLUDED: ReadonlySet<string> = new Set([RESERVED, 'news'])

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
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      frontmatter = parsed as Record<string, unknown>
    }
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

function asStr(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}
function asStrArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

// All article files for a project, paired with parsed frontmatter + raw body.
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
    if (EXCLUDED.has(name)) continue
    const dir = join(root, name)
    let st: ReturnType<typeof statSync> | null = null
    try {
      st = statSync(dir)
    } catch {
      continue
    }
    if (!st.isDirectory()) continue
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
  const abs = assertInside(join(projectRoot(root, project), 'knowledge'), relPath)
  if (!existsSync(abs)) return { frontmatter: {}, body: '' }
  return parseFrontmatter(readFileSync(abs, 'utf8'))
}

export function readIndex(root: string, project: string): string {
  const abs = assertInside(join(projectRoot(root, project), 'knowledge'), 'index.md')
  return existsSync(abs) ? readFileSync(abs, 'utf8') : ''
}

export function listDaily(root: string, project: string): DailyEntry[] {
  const abs = assertInside(projectRoot(root, project), 'daily')
  if (!existsSync(abs)) return []
  return readdirSync(abs)
    .filter((f) => f.endsWith('.md'))
    .map((f) => ({ date: f.replace(/\.md$/, ''), relPath: f }))
    .sort((a, b) => b.date.localeCompare(a.date))
}

export function readDaily(root: string, project: string, relPath: string): string {
  const abs = assertInside(join(projectRoot(root, project), 'daily'), relPath)
  return existsSync(abs) ? readFileSync(abs, 'utf8') : ''
}

const execFileAsync = promisify(execFile)

// Shell out to the engine's query.py (read-only: NO --file-back). Spends API
// tokens — callers must gate this behind an explicit user action. ATLAS_KB_ROOT
// points at the per-project root; the engine resolves knowledge/ from there.
export async function runQuery(root: string, project: string, q: string): Promise<string> {
  const engine = join(root, RESERVED)
  const projRoot = projectRoot(root, project)
  try {
    const { stdout } = await execFileAsync(
      'uv',
      ['run', '--directory', engine, 'python', 'scripts/query.py', q],
      {
        env: { ...process.env, ATLAS_KB_ROOT: projRoot },
        timeout: 120_000,
        maxBuffer: 10 * 1024 * 1024,
      },
    )
    return stdout.trim()
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string }
    if (e.code === 'ENOENT') {
      throw new Error('`uv` not found on PATH — install uv to use knowledge search.')
    }
    throw new Error(e.stderr?.trim() || e.message || 'query.py failed')
  }
}

// Classify compile.py stdout into a UI status + a one-line summary. compile.py
// prints "Nothing to compile..." when all logs are current, else "Compilation
// complete. Total cost: $X" on success. Pure so it can be unit-tested directly.
export function parseCompileOutput(stdout: string): {
  status: 'compiled' | 'nothing'
  summary: string
} {
  const lines = stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  if (stdout.includes('Nothing to compile')) {
    return { status: 'nothing', summary: 'up to date' }
  }
  // Prefer the trailing summary lines compile.py prints on completion.
  const tail = lines.filter((l) => /Compilation complete|Knowledge base:/.test(l)).join(' — ')
  return { status: 'compiled', summary: tail || 'compiled' }
}

// Shell out to the engine's compile.py for a single project (incremental: only
// new/changed daily logs, by hash). Spawns a nested Claude per changed log, so
// the timeout is generous. Never throws — failures map to an 'error' result so
// compileAll can isolate one project's failure from the rest.
export async function compileProject(root: string, project: string): Promise<CompileResult> {
  const engine = join(root, RESERVED)
  let projRoot: string
  try {
    projRoot = projectRoot(root, project)
  } catch (err) {
    return { project, status: 'error', summary: (err as Error).message }
  }
  try {
    const { stdout } = await execFileAsync(
      'uv',
      ['run', '--directory', engine, 'python', 'scripts/compile.py'],
      {
        env: { ...process.env, ATLAS_KB_ROOT: projRoot },
        timeout: 15 * 60_000,
        maxBuffer: 10 * 1024 * 1024,
      },
    )
    return { project, ...parseCompileOutput(stdout) }
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string }
    const summary =
      e.code === 'ENOENT'
        ? '`uv` not found on PATH — install uv to compile.'
        : e.stderr?.trim() || e.message || 'compile.py failed'
    return { project, status: 'error', summary }
  }
}

// Compile every visible (tracked) project in parallel. One process per project,
// each scoped by ATLAS_KB_ROOT; allSettled keeps a single failure from sinking
// the batch (compileProject already swallows its own errors as a guard).
export async function compileAll(
  root: string,
  tracked: ReadonlySet<string>,
): Promise<CompileResult[]> {
  const projects = listProjects(root, tracked).map((p) => p.name)
  const settled = await Promise.allSettled(projects.map((p) => compileProject(root, p)))
  return settled.map((s, i) =>
    s.status === 'fulfilled'
      ? s.value
      : { project: projects[i], status: 'error', summary: String(s.reason) },
  )
}

// Gather articles (with body) + daily entries across every visible project —
// the raw input computeGraph needs. fs glue; logic lives in the graph builder.
export function readGraphSources(
  root: string,
  tracked: ReadonlySet<string>,
): { articles: GraphArticleInput[]; daily: GraphDailyInput[] } {
  const articles: GraphArticleInput[] = []
  const daily: GraphDailyInput[] = []
  for (const { name: project } of listProjects(root, tracked)) {
    for (const { relPath, kind, doc } of readAllArticles(root, project)) {
      articles.push({
        project,
        relPath,
        kind,
        title: asStr(doc.frontmatter.title) ?? basename(relPath, '.md'),
        tags: asStrArray(doc.frontmatter.tags),
        aliases: asStrArray(doc.frontmatter.aliases),
        updated: asStr(doc.frontmatter.updated),
        sources: asStrArray(doc.frontmatter.sources),
        body: doc.body,
      })
    }
    for (const d of listDaily(root, project)) {
      daily.push({ project, date: d.date, relPath: d.relPath })
    }
  }
  return { articles, daily }
}
