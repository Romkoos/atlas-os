import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { basename, join, relative, sep } from 'node:path'
import type { AppDatabase } from '@main/db/client'
import { agentSessions, agentTurns } from '@main/db/schema'
import { projectNameForPath, readAllArticles, storeRoot } from '@main/services/knowledge/store'
import type { CodeGraph } from '@shared/graph'
import { eq } from 'drizzle-orm'
import { type AssembleInput, assembleGraph } from './assemble'
import { clusterGraph } from './cluster'
import { langForExt, parseImports, resolveImport } from './imports'

const IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  'out',
  'dist',
  'build',
  '.venv',
  '__pycache__',
  '.next',
  'coverage',
  'release',
  'test-results',
  '.turbo',
  '.cache',
])
const MAX_FILES = 5000
const MAX_FILE_BYTES = 512 * 1024

// Repo-relative POSIX paths, ignore-filtered, capped. fs walk only.
export function walkProject(projectPath: string): string[] {
  const out: string[] = []
  const visited = new Set<string>()
  const walk = (abs: string): void => {
    if (out.length >= MAX_FILES) return
    let real: string
    try {
      real = realpathSync(abs)
    } catch {
      return
    }
    if (visited.has(real)) return
    visited.add(real)
    let entries: string[]
    try {
      entries = readdirSync(abs)
    } catch {
      return
    }
    for (const name of entries) {
      if (out.length >= MAX_FILES) return
      if (IGNORE_DIRS.has(name) || name.startsWith('.')) continue
      const child = join(abs, name)
      let st: ReturnType<typeof statSync>
      try {
        st = statSync(child)
      } catch {
        continue
      }
      if (st.isDirectory()) walk(child)
      else if (st.isFile() && st.size <= MAX_FILE_BYTES) {
        out.push(relative(projectPath, child).split('\\').join('/'))
      }
    }
  }
  walk(projectPath)
  return out
}

const isDoc = (f: string): boolean => f.endsWith('.md')
const isSkill = (f: string): boolean => f.endsWith('/SKILL.md') || f === 'SKILL.md'

// Extract markdown links [text](target) that resolve to a repo file.
function docLinksFor(docRel: string, content: string, fileSet: ReadonlySet<string>): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const m of content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const raw = m[1].split('#')[0].trim()
    if (!raw || raw.startsWith('http') || raw.startsWith('mailto:')) continue
    const dir = docRel.includes('/') ? docRel.slice(0, docRel.lastIndexOf('/')) : ''
    const parts = dir ? dir.split('/') : []
    for (const seg of raw.split('/')) {
      if (seg === '' || seg === '.') continue
      if (seg === '..') parts.pop()
      else parts.push(seg)
    }
    const rel = parts.join('/')
    if (fileSet.has(rel) && !seen.has(rel)) {
      seen.add(rel)
      out.push(rel)
    }
  }
  return out
}

function knowledgeProjectName(projectPath: string): string | null {
  try {
    return projectNameForPath(storeRoot(), projectPath)
  } catch {
    return null
  }
}

// Full structural index: fs walk + import parse + docs + skills + knowledge
// articles + sessions → assembled + clustered CodeGraph (origin 'indexer').
export function indexProject(database: AppDatabase, projectPath: string): CodeGraph {
  const files = walkProject(projectPath)
  const fileSet = new Set(files)
  const codeFiles = files.filter((f) => langForExt(f) !== null)
  const docs = files.filter((f) => isDoc(f) && !isSkill(f))
  const skills = files.filter(isSkill)

  const imports: AssembleInput['imports'] = []
  for (const f of codeFiles) {
    const lang = langForExt(f)
    if (!lang) continue
    let content: string
    try {
      content = readFileSync(join(projectPath, f), 'utf8')
    } catch {
      continue
    }
    for (const spec of parseImports(content, lang)) {
      const to = resolveImport(f, spec, fileSet, lang)
      if (to) imports.push({ from: f, to })
    }
  }

  const docLinks: AssembleInput['docLinks'] = []
  for (const d of docs) {
    let content: string
    try {
      content = readFileSync(join(projectPath, d), 'utf8')
    } catch {
      continue
    }
    for (const to of docLinksFor(d, content, fileSet)) docLinks.push({ from: d, to })
  }

  const kp = knowledgeProjectName(projectPath)
  const articles: AssembleInput['articles'] = kp
    ? readAllArticles(storeRoot(), kp).map(({ relPath, doc }) => ({
        relPath,
        title:
          (typeof doc.frontmatter.title === 'string' && doc.frontmatter.title) ||
          basename(relPath, '.md'),
        body: doc.body,
      }))
    : []

  const sessionRows = database
    .select({ sessionId: agentSessions.sessionId, startedAt: agentSessions.startedAt })
    .from(agentSessions)
    .where(eq(agentSessions.projectPath, projectPath))
    .all()
  const sessions: AssembleInput['sessions'] = sessionRows.map((s) => {
    const turns = database
      .select({ filesTouched: agentTurns.filesTouched })
      .from(agentTurns)
      .where(eq(agentTurns.sessionId, s.sessionId))
      .all()
    const touched = new Set<string>()
    for (const t of turns) {
      for (const abs of t.filesTouched ?? []) {
        const rel =
          abs === projectPath || abs.startsWith(projectPath + sep)
            ? relative(projectPath, abs).split('\\').join('/')
            : abs
        touched.add(rel)
      }
    }
    return {
      sessionId: s.sessionId,
      label: s.startedAt
        ? new Date(s.startedAt).toISOString().slice(0, 10)
        : s.sessionId.slice(0, 8),
      filesTouched: [...touched],
    }
  })

  return clusterGraph(
    assembleGraph({ projectPath, codeFiles, imports, docs, docLinks, skills, articles, sessions }),
  )
}
