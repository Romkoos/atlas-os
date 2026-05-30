# Knowledge UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only top-level `Knowledge` page to atlas-os that browses the global per-project knowledge base at `~/atlas-knowledge/<project>/`, with concept/connection articles, raw daily logs, and a gated `query.py` search.

**Architecture:** A thin file-reading tRPC router (`knowledge`) backed by a pure, unit-tested store service (`src/main/services/knowledge/store.ts`). Frontmatter parsed in main with `js-yaml`; markdown rendered in the renderer with the already-present `react-markdown` + `remark-gfm`. Pure article-graph helpers (`resolveWikilink`, `countInbound`) live in `@shared/knowledge` so main and renderer share one implementation. No DB, no new dependencies, no writes to the KB.

**Tech Stack:** Electron + React 19 + TypeScript + Tailwind 4 + tRPC 11 + Zod + Vitest. Biome lint (no semicolons, single quotes, 2-space).

---

## Background the implementer needs

**Source-of-truth layout (verified on disk):**
```
~/atlas-knowledge/<project>/
├── daily/*.md            # per-project raw logs (e.g. 2026-05-30.md)
├── knowledge/
│   ├── index.md          # markdown table landing view
│   ├── log.md            # build log (NOT surfaced)
│   ├── concepts/*.md     # frontmatter + body + [[wikilinks]]
│   ├── connections/*.md
│   └── qa/*.md
└── state/                # NOT surfaced
~/atlas-knowledge/_engine/projects.json   # { "<basename>": "<abspath>", ... }
~/atlas-knowledge/_engine/scripts/query.py
```
- **All `knowledge/` dirs are currently empty** (freshly bootstrapped) — only daily logs exist. Empty states must render cleanly.
- Article frontmatter keys: `title, aliases[], tags[], sources[], created, updated`.
- Wikilinks look like `[[concepts/shorts-scroll]]` or bare `[[shorts-scroll]]`; some are dangling.

**Store root resolution:** `process.env.ATLAS_KB_STORE || join(homedir(), 'atlas-knowledge')`. Never hardcode the abspath.

**Project filter (`trackedProjects`):** settings store absolute project paths (e.g. `/Users/.../atlas-os`); `basename` is the store dir name. A store dir is shown iff its abspath (from `projects.json`) is in `trackedProjects`. **Empty `trackedProjects` ⇒ show all** (mirrors `trackedCondition()` in `productivity.ts:59`). This filters the self-referential `atlas-os-aa778f` dir automatically.

**Existing patterns to follow:**
- tRPC router: `src/main/trpc/routers/productivity.ts`; register in `src/main/trpc/router.ts`.
- Settings access: `getSettings()` from `@main/store` (`getSettings().trackedProjects ?? []`).
- Renderer tRPC client: `trpc` from `@renderer/lib/trpc` (`trpc.knowledge.projects.useQuery()`).
- Nav: `src/renderer/src/store/ui.ts` (`Section` union), `src/renderer/src/components/layout/nav.ts` (`NAV`), `src/renderer/src/App.tsx` (`PAGES`).
- Page chrome: `PageHeader` from `@renderer/components/layout/PageHeader`; `.panel`/`.panel-body` CSS classes; terminal-style empty hint pattern (`Productivity.tsx:84`).
- Tests: Vitest, `*.test.ts` next to source. Run `pnpm test`.

---

## File Structure

- Create `src/shared/knowledge.ts` — Zod schemas, inferred types, pure graph helpers (`resolveWikilink`, `countInbound`).
- Create `src/main/services/knowledge/store.ts` — FS reads + frontmatter parsing + traversal guard + `query.py` spawn.
- Create `src/main/services/knowledge/store.test.ts` — unit + temp-fixture integration tests.
- Create `src/main/trpc/routers/knowledge.ts` — thin tRPC router.
- Modify `src/main/trpc/router.ts` — register `knowledge`.
- Create `src/renderer/src/pages/Knowledge.tsx` — page: picker + Browse/Daily/Search tabs.
- Create `src/renderer/src/pages/knowledge/MarkdownView.tsx` — markdown + wikilink renderer + frontmatter header.
- Modify `src/renderer/src/store/ui.ts` — add `'knowledge'` to `Section`.
- Modify `src/renderer/src/components/layout/nav.ts` — add Knowledge nav item.
- Modify `src/renderer/src/App.tsx` — wire `Knowledge` into `PAGES`.

---

## Task 1: Shared types & pure graph helpers

**Files:**
- Create: `src/shared/knowledge.ts`
- Test: `src/shared/knowledge.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/shared/knowledge.test.ts
import { describe, expect, it } from 'vitest'
import { type ArticleMeta, countInbound, resolveWikilink } from './knowledge'

const meta = (relPath: string, aliases: string[] = []): ArticleMeta => ({
  relPath,
  kind: relPath.startsWith('connections/') ? 'connection' : 'concept',
  title: relPath,
  tags: [],
  aliases,
  updated: null,
  inboundLinks: 0,
})

const ARTICLES: ArticleMeta[] = [
  meta('concepts/shorts-scroll.md', ['shorts']),
  meta('connections/player-mako.md'),
]

describe('resolveWikilink', () => {
  it('resolves a full path link', () => {
    expect(resolveWikilink('concepts/shorts-scroll', ARTICLES)).toBe('concepts/shorts-scroll.md')
  })
  it('resolves a bare slug by filename', () => {
    expect(resolveWikilink('player-mako', ARTICLES)).toBe('connections/player-mako.md')
  })
  it('resolves by alias', () => {
    expect(resolveWikilink('shorts', ARTICLES)).toBe('concepts/shorts-scroll.md')
  })
  it('returns null for a dangling link', () => {
    expect(resolveWikilink('concepts/nope', ARTICLES)).toBeNull()
  })
})

describe('countInbound', () => {
  it('counts other articles linking to the target, never itself', () => {
    const bodies = [
      { relPath: 'concepts/a.md', body: 'see [[concepts/shorts-scroll]] and [[shorts]]' },
      { relPath: 'concepts/shorts-scroll.md', body: 'links to [[concepts/shorts-scroll]] self' },
    ]
    expect(countInbound('concepts/shorts-scroll.md', bodies)).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/shared/knowledge.test.ts`
Expected: FAIL — cannot find module `./knowledge`.

- [ ] **Step 3: Write the implementation**

```ts
// src/shared/knowledge.ts
import { z } from 'zod'

export const articleKindSchema = z.enum(['concept', 'connection', 'qa'])
export type ArticleKind = z.infer<typeof articleKindSchema>

export const articleMetaSchema = z.object({
  relPath: z.string(),
  kind: articleKindSchema,
  title: z.string(),
  tags: z.array(z.string()),
  aliases: z.array(z.string()),
  updated: z.string().nullable(),
  inboundLinks: z.number(),
})
export type ArticleMeta = z.infer<typeof articleMetaSchema>

export const knowledgeProjectSchema = z.object({
  name: z.string(),
  path: z.string(),
  articleCount: z.number(),
  dailyCount: z.number(),
  lastUpdated: z.string().nullable(),
})
export type KnowledgeProject = z.infer<typeof knowledgeProjectSchema>

export const articleDocSchema = z.object({
  frontmatter: z.record(z.string(), z.unknown()),
  body: z.string(),
})
export type ArticleDoc = z.infer<typeof articleDocSchema>

export const dailyEntrySchema = z.object({ date: z.string(), relPath: z.string() })
export type DailyEntry = z.infer<typeof dailyEntrySchema>

// Strip the .md suffix: 'concepts/x.md' -> 'concepts/x'.
const stripExt = (relPath: string): string => relPath.replace(/\.md$/, '')

// Resolve a wikilink target ('concepts/x' or bare 'x') to an article relPath,
// or null if dangling. Match order: exact path, filename slug, alias.
export function resolveWikilink(link: string, articles: ArticleMeta[]): string | null {
  const target = link.trim()
  const byPath = articles.find((a) => stripExt(a.relPath) === target)
  if (byPath) return byPath.relPath
  const bySlug = articles.find((a) => stripExt(a.relPath).split('/').pop() === target)
  if (bySlug) return bySlug.relPath
  const byAlias = articles.find((a) => a.aliases.includes(target))
  return byAlias ? byAlias.relPath : null
}

// Count articles (excluding the target itself) whose body wikilinks the target,
// either by full path ([[concepts/x]]) or bare slug ([[x]]).
export function countInbound(
  relPath: string,
  bodies: ReadonlyArray<{ relPath: string; body: string }>,
): number {
  const path = stripExt(relPath)
  const slug = path.split('/').pop() ?? path
  let n = 0
  for (const b of bodies) {
    if (b.relPath === relPath) continue
    if (b.body.includes(`[[${path}]]`) || b.body.includes(`[[${slug}]]`)) n++
  }
  return n
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/shared/knowledge.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/knowledge.ts src/shared/knowledge.test.ts
git commit -m "feat(knowledge): shared types and article-graph helpers"
```

---

## Task 2: Store service — pure parsing & traversal guard

**Files:**
- Create: `src/main/services/knowledge/store.ts`
- Test: `src/main/services/knowledge/store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/main/services/knowledge/store.test.ts
import { describe, expect, it } from 'vitest'
import { assertInside, isTracked, parseFrontmatter } from './store'

describe('parseFrontmatter', () => {
  it('splits YAML frontmatter from body', () => {
    const raw = '---\ntitle: Foo\ntags: [a, b]\n---\n# Foo\nbody text'
    const doc = parseFrontmatter(raw)
    expect(doc.frontmatter.title).toBe('Foo')
    expect(doc.frontmatter.tags).toEqual(['a', 'b'])
    expect(doc.body).toBe('# Foo\nbody text')
  })
  it('returns empty frontmatter when none present', () => {
    const doc = parseFrontmatter('# No frontmatter\ntext')
    expect(doc.frontmatter).toEqual({})
    expect(doc.body).toBe('# No frontmatter\ntext')
  })
  it('degrades to empty frontmatter on malformed YAML', () => {
    const doc = parseFrontmatter('---\ntitle: : :\n  bad\n---\nbody')
    expect(doc.frontmatter).toEqual({})
    expect(doc.body).toBe('body')
  })
})

describe('isTracked', () => {
  const projects = { 'atlas-os': '/abs/atlas-os', 'atlas-os-aa778f': '/home/atlas-knowledge/atlas-os' }
  it('shows all when allowlist empty', () => {
    expect(isTracked('atlas-os', projects, new Set())).toBe(true)
  })
  it('shows tracked basename', () => {
    expect(isTracked('atlas-os', projects, new Set(['/abs/atlas-os']))).toBe(true)
  })
  it('hides untracked basename', () => {
    expect(isTracked('atlas-os-aa778f', projects, new Set(['/abs/atlas-os']))).toBe(false)
  })
  it('hides basename missing from projects.json when allowlist non-empty', () => {
    expect(isTracked('ghost', projects, new Set(['/abs/atlas-os']))).toBe(false)
  })
})

describe('assertInside', () => {
  it('returns the resolved path when inside root', () => {
    expect(assertInside('/root', 'concepts/x.md')).toBe('/root/concepts/x.md')
  })
  it('throws on traversal', () => {
    expect(() => assertInside('/root', '../escape')).toThrow(/escapes/)
  })
  it('throws on absolute escape', () => {
    expect(() => assertInside('/root', '/etc/passwd')).toThrow(/escapes/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/main/services/knowledge/store.test.ts`
Expected: FAIL — cannot find module `./store`.

- [ ] **Step 3: Write the implementation (pure parts only for now)**

```ts
// src/main/services/knowledge/store.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/main/services/knowledge/store.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/services/knowledge/store.ts src/main/services/knowledge/store.test.ts
git commit -m "feat(knowledge): store service pure helpers"
```

---

## Task 3: Store service — filesystem reads (temp-fixture integration test)

**Files:**
- Modify: `src/main/services/knowledge/store.ts`
- Test: `src/main/services/knowledge/store.test.ts`

- [ ] **Step 1: Write the failing test (append to store.test.ts)**

```ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll } from 'vitest'
import { listArticles, listDaily, listProjects, readArticle, readIndex } from './store'

let root: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'kb-'))
  // _engine/projects.json maps basename -> abspath
  mkdirSync(join(root, '_engine'), { recursive: true })
  writeFileSync(
    join(root, '_engine', 'projects.json'),
    JSON.stringify({ proj: '/abs/proj' }),
  )
  // proj/knowledge/{index.md,concepts,connections}
  const k = join(root, 'proj', 'knowledge')
  mkdirSync(join(k, 'concepts'), { recursive: true })
  mkdirSync(join(k, 'connections'), { recursive: true })
  writeFileSync(join(k, 'index.md'), '# Index\n| link | summary |')
  writeFileSync(
    join(k, 'concepts', 'alpha.md'),
    '---\ntitle: Alpha\ntags: [x]\naliases: [a]\nupdated: 2026-05-01\n---\n# Alpha\nlinks [[connections/beta]]',
  )
  writeFileSync(
    join(k, 'connections', 'beta.md'),
    '---\ntitle: Beta\nupdated: 2026-05-02\n---\n# Beta\nbody',
  )
  // proj/daily
  mkdirSync(join(root, 'proj', 'daily'), { recursive: true })
  writeFileSync(join(root, 'proj', 'daily', '2026-05-30.md'), '# Daily')
})

afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('listProjects', () => {
  it('lists tracked projects, skips _engine, counts articles + daily', () => {
    const projects = listProjects(root, new Set(['/abs/proj']))
    expect(projects.map((p) => p.name)).toEqual(['proj'])
    expect(projects[0].articleCount).toBe(2)
    expect(projects[0].dailyCount).toBe(1)
  })
  it('hides untracked projects', () => {
    expect(listProjects(root, new Set(['/abs/other']))).toEqual([])
  })
})

describe('listArticles', () => {
  it('returns metadata with kind, tags, aliases, and inbound counts', () => {
    const arts = listArticles(root, 'proj')
    const beta = arts.find((a) => a.relPath === 'connections/beta.md')
    expect(beta?.kind).toBe('connection')
    expect(beta?.title).toBe('Beta')
    expect(beta?.inboundLinks).toBe(1) // alpha links to it
    const alpha = arts.find((a) => a.relPath === 'concepts/alpha.md')
    expect(alpha?.tags).toEqual(['x'])
    expect(alpha?.aliases).toEqual(['a'])
  })
})

describe('readArticle / readIndex / listDaily', () => {
  it('reads an article doc', () => {
    expect(readArticle(root, 'proj', 'concepts/alpha.md').frontmatter.title).toBe('Alpha')
  })
  it('reads the raw index', () => {
    expect(readIndex(root, 'proj')).toContain('# Index')
  })
  it('lists daily entries newest-first', () => {
    expect(listDaily(root, 'proj')).toEqual([{ date: '2026-05-30', relPath: '2026-05-30.md' }])
  })
  it('rejects traversal in readArticle', () => {
    expect(() => readArticle(root, 'proj', '../../_engine/projects.json')).toThrow(/escapes/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/main/services/knowledge/store.test.ts`
Expected: FAIL — `listProjects` etc. not exported.

- [ ] **Step 3: Add the FS functions to store.ts**

```ts
// add imports at top of store.ts:
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename } from 'node:path'
import {
  type ArticleKind,
  type ArticleMeta,
  countInbound,
  type DailyEntry,
  type KnowledgeProject,
} from '@shared/knowledge'

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
      lastUpdated: updates.length ? updates.sort().at(-1) ?? null : null,
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/main/services/knowledge/store.test.ts`
Expected: PASS (all suites).

- [ ] **Step 5: Commit**

```bash
git add src/main/services/knowledge/store.ts src/main/services/knowledge/store.test.ts
git commit -m "feat(knowledge): store service filesystem reads"
```

---

## Task 4: Store service — gated `query.py` runner

**Files:**
- Modify: `src/main/services/knowledge/store.ts`

- [ ] **Step 1: Add the runner (no unit test — it spawns a real subprocess; covered manually in Task 10)**

```ts
// add imports at top of store.ts:
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

// Shell out to the engine's query.py (read-only: NO --file-back). Spends API
// tokens — callers must gate this behind an explicit user action. ATLAS_KB_ROOT
// points at the per-project root; the engine resolves knowledge/ from there.
export async function runQuery(root: string, project: string, q: string): Promise<string> {
  const engine = join(root, RESERVED)
  const projectRoot = assertInside(root, project)
  try {
    const { stdout } = await execFileAsync(
      'uv',
      ['run', '--directory', engine, 'python', 'scripts/query.py', q],
      {
        env: { ...process.env, ATLAS_KB_ROOT: projectRoot },
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
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm typecheck:node`
Expected: PASS (no errors).

- [ ] **Step 3: Commit**

```bash
git add src/main/services/knowledge/store.ts
git commit -m "feat(knowledge): gated query.py runner"
```

---

## Task 5: tRPC `knowledge` router

**Files:**
- Create: `src/main/trpc/routers/knowledge.ts`
- Modify: `src/main/trpc/router.ts`

- [ ] **Step 1: Write the router**

```ts
// src/main/trpc/routers/knowledge.ts
import {
  listArticles,
  listDaily,
  listProjects,
  readArticle,
  readDaily,
  readIndex,
  runQuery,
  storeRoot,
} from '@main/services/knowledge/store'
import { getSettings } from '@main/store'
import { publicProcedure, router } from '@main/trpc/trpc'
import {
  articleDocSchema,
  articleMetaSchema,
  dailyEntrySchema,
  knowledgeProjectSchema,
} from '@shared/knowledge'
import { z } from 'zod'

const tracked = (): Set<string> => new Set(getSettings().trackedProjects ?? [])
const projectInput = z.object({ project: z.string() })

export const knowledgeRouter = router({
  projects: publicProcedure
    .output(z.array(knowledgeProjectSchema))
    .query(() => listProjects(storeRoot(), tracked())),

  index: publicProcedure
    .input(projectInput)
    .output(z.object({ raw: z.string() }))
    .query(({ input }) => ({ raw: readIndex(storeRoot(), input.project) })),

  list: publicProcedure
    .input(projectInput)
    .output(z.array(articleMetaSchema))
    .query(({ input }) => listArticles(storeRoot(), input.project)),

  article: publicProcedure
    .input(projectInput.extend({ relPath: z.string() }))
    .output(articleDocSchema)
    .query(({ input }) => readArticle(storeRoot(), input.project, input.relPath)),

  daily: publicProcedure
    .input(projectInput)
    .output(z.array(dailyEntrySchema))
    .query(({ input }) => listDaily(storeRoot(), input.project)),

  dailyArticle: publicProcedure
    .input(projectInput.extend({ relPath: z.string() }))
    .output(z.object({ raw: z.string() }))
    .query(({ input }) => ({ raw: readDaily(storeRoot(), input.project, input.relPath) })),

  query: publicProcedure
    .input(projectInput.extend({ q: z.string().min(1) }))
    .output(z.object({ answer: z.string() }))
    .mutation(async ({ input }) => ({
      answer: await runQuery(storeRoot(), input.project, input.q),
    })),
})
```

- [ ] **Step 2: Register the router in `src/main/trpc/router.ts`**

Add the import (alphabetical with the others) and the `knowledge` key:

```ts
import { knowledgeRouter } from '@main/trpc/routers/knowledge'
```

```ts
export const appRouter = router({
  health: healthRouter,
  settings: settingsRouter,
  agent: agentRouter,
  stats: statsRouter,
  skills: skillsRouter,
  productivity: productivityRouter,
  benchmark: benchmarkRouter,
  knowledge: knowledgeRouter,
})
```

- [ ] **Step 3: Verify it compiles**

Run: `pnpm typecheck:node`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/main/trpc/routers/knowledge.ts src/main/trpc/router.ts
git commit -m "feat(knowledge): tRPC knowledge router"
```

---

## Task 6: Markdown view component (frontmatter header + wikilinks)

**Files:**
- Create: `src/renderer/src/pages/knowledge/MarkdownView.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/renderer/src/pages/knowledge/MarkdownView.tsx
import { type ArticleMeta, resolveWikilink } from '@shared/knowledge'
import { type ComponentPropsWithoutRef, useMemo } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const WIKI = /\[\[([^\]]+)\]\]/g

// Rewrite [[target]] tokens: resolvable -> markdown link with a #wiki: href the
// <a> override turns into navigation; dangling -> inline code (rendered muted).
function preprocess(body: string, articles: ArticleMeta[]): string {
  return body.replace(WIKI, (_m, raw: string) => {
    const target = raw.trim()
    const rel = resolveWikilink(target, articles)
    return rel ? `[${target}](#wiki:${encodeURIComponent(rel)})` : `\`${target}\``
  })
}

export function MarkdownView({
  body,
  frontmatter,
  articles,
  onNavigate,
}: {
  body: string
  frontmatter?: Record<string, unknown>
  articles: ArticleMeta[]
  onNavigate: (relPath: string) => void
}) {
  const processed = useMemo(() => preprocess(body, articles), [body, articles])
  const tags = Array.isArray(frontmatter?.tags) ? (frontmatter?.tags as string[]) : []
  const sources = Array.isArray(frontmatter?.sources) ? (frontmatter?.sources as string[]) : []
  const updated = typeof frontmatter?.updated === 'string' ? frontmatter.updated : null

  const anchor = (props: ComponentPropsWithoutRef<'a'>) => {
    const href = props.href ?? ''
    if (href.startsWith('#wiki:')) {
      const rel = decodeURIComponent(href.slice('#wiki:'.length))
      return (
        <button
          type="button"
          className="wikilink"
          onClick={() => onNavigate(rel)}
        >
          {props.children}
        </button>
      )
    }
    return <a {...props} target="_blank" rel="noreferrer" />
  }

  return (
    <div className="kb-article">
      {(tags.length > 0 || updated || sources.length > 0) && (
        <div className="kb-fm">
          {tags.map((t) => (
            <span key={t} className="kb-chip">
              #{t}
            </span>
          ))}
          {updated && <span className="kb-fm-meta">updated {updated}</span>}
          {sources.length > 0 && <span className="kb-fm-meta">sources: {sources.join(', ')}</span>}
        </div>
      )}
      <div className="kb-md">
        <Markdown remarkPlugins={[remarkGfm]} components={{ a: anchor }}>
          {processed}
        </Markdown>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm typecheck:web`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/pages/knowledge/MarkdownView.tsx
git commit -m "feat(knowledge): markdown view with wikilink navigation"
```

---

## Task 7: Wire the Knowledge nav entry

**Files:**
- Modify: `src/renderer/src/store/ui.ts`
- Modify: `src/renderer/src/components/layout/nav.ts`
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Add `'knowledge'` to the `Section` union (`src/renderer/src/store/ui.ts`)**

```ts
export type Section = 'dashboard' | 'stats' | 'productivity' | 'knowledge' | 'info' | 'skills' | 'settings'
```

- [ ] **Step 2: Add the nav item (`src/renderer/src/components/layout/nav.ts`)**

Insert Knowledge after Productivity and renumber the `key` prefixes so they stay sequential (they drive Cmd+N):

```ts
export const NAV: ReadonlyArray<NavItem> = [
  { id: 'dashboard', key: '01', label: 'DASHBOARD' },
  { id: 'stats', key: '02', label: 'STATS' },
  { id: 'productivity', key: '03', label: 'PRODUCTIVITY' },
  { id: 'knowledge', key: '04', label: 'KNOWLEDGE' },
  { id: 'info', key: '05', label: 'INFO' },
  { id: 'skills', key: '06', label: 'SKILLS' },
  { id: 'settings', key: '07', label: 'SETTINGS' },
]
```

- [ ] **Step 3: Wire the page into `PAGES` (`src/renderer/src/App.tsx`)**

Add the import (with the other page imports) and the map entry:

```ts
import { Knowledge } from '@renderer/pages/Knowledge'
```

```ts
const PAGES: Record<Section, ComponentType> = {
  dashboard: Dashboard,
  stats: Stats,
  productivity: Productivity,
  knowledge: Knowledge,
  info: Info,
  skills: Skills,
  settings: Settings,
}
```

- [ ] **Step 4: Verify it compiles (will fail until Task 8 creates the page)**

Run: `pnpm typecheck:web`
Expected: FAIL — cannot find module `@renderer/pages/Knowledge`. (Resolved in Task 8. Do NOT commit yet.)

---

## Task 8: Knowledge page — shell, project picker, Browse tab

**Files:**
- Create: `src/renderer/src/pages/Knowledge.tsx`

- [ ] **Step 1: Write the page**

```tsx
// src/renderer/src/pages/Knowledge.tsx
import { PageHeader } from '@renderer/components/layout/PageHeader'
import { trpc } from '@renderer/lib/trpc'
import { MarkdownView } from '@renderer/pages/knowledge/MarkdownView'
import type { ArticleKind, ArticleMeta } from '@shared/knowledge'
import { useMemo, useState } from 'react'

type Tab = 'browse' | 'daily' | 'search'

const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: 'browse', label: './browse' },
  { id: 'daily', label: './daily' },
  { id: 'search', label: './search' },
]

const KIND_LABEL: Record<ArticleKind, string> = {
  concept: 'CONCEPTS',
  connection: 'CONNECTIONS',
  qa: 'Q&A',
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="panel mt-16">
      <div className="panel-body">
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--fg-3)' }}>
          <span style={{ color: 'var(--amber-dim)' }}>{'// '}</span>
          {children}
        </div>
      </div>
    </div>
  )
}

export function Knowledge() {
  const projects = trpc.knowledge.projects.useQuery()
  const [project, setProject] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('browse')

  // Default to the first project once loaded.
  const active = project ?? projects.data?.[0]?.name ?? null

  return (
    <>
      <PageHeader
        num="04"
        title="knowledge"
        description="Per-project knowledge base — read-only."
        action={
          projects.data && projects.data.length > 0 ? (
            <select
              className="select"
              value={active ?? ''}
              onChange={(e) => setProject(e.target.value)}
            >
              {projects.data.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name} ({p.articleCount})
                </option>
              ))}
            </select>
          ) : null
        }
      />

      {!projects.data || projects.data.length === 0 ? (
        <Empty>no tracked projects with a knowledge base yet.</Empty>
      ) : !active ? null : (
        <>
          <div className="tabs">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={tab === t.id ? 'tab tab-active' : 'tab'}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          {tab === 'browse' && <BrowseTab project={active} />}
          {tab === 'daily' && <DailyTab project={active} />}
          {tab === 'search' && <SearchTab project={active} />}
        </>
      )}
    </>
  )
}

function BrowseTab({ project }: { project: string }) {
  const list = trpc.knowledge.list.useQuery({ project })
  const index = trpc.knowledge.index.useQuery({ project })
  const [selected, setSelected] = useState<string | null>(null)
  const article = trpc.knowledge.article.useQuery(
    { project, relPath: selected ?? '' },
    { enabled: selected != null },
  )

  const articles: ArticleMeta[] = list.data ?? []
  const groups = useMemo(() => {
    const by: Record<ArticleKind, ArticleMeta[]> = { concept: [], connection: [], qa: [] }
    for (const a of articles) by[a.kind].push(a)
    return by
  }, [articles])

  if (articles.length === 0) {
    return (
      <Empty>
        this knowledge base is empty. It compiles from your Claude Code sessions — check the
        ./daily tab for raw logs.
      </Empty>
    )
  }

  return (
    <div className="kb-layout">
      <nav className="kb-list">
        {(['concept', 'connection', 'qa'] as ArticleKind[]).map((kind) =>
          groups[kind].length === 0 ? null : (
            <div key={kind} className="kb-group">
              <div className="kb-group-title">{KIND_LABEL[kind]}</div>
              {groups[kind].map((a) => (
                <button
                  key={a.relPath}
                  type="button"
                  className={selected === a.relPath ? 'kb-item kb-item-active' : 'kb-item'}
                  onClick={() => setSelected(a.relPath)}
                >
                  <span className="kb-item-title">{a.title}</span>
                  {a.inboundLinks > 0 && <span className="kb-item-meta">←{a.inboundLinks}</span>}
                </button>
              ))}
            </div>
          ),
        )}
      </nav>
      <section className="kb-pane">
        {selected && article.data ? (
          <MarkdownView
            body={article.data.body}
            frontmatter={article.data.frontmatter}
            articles={articles}
            onNavigate={setSelected}
          />
        ) : (
          <MarkdownView body={index.data?.raw ?? ''} articles={articles} onNavigate={setSelected} />
        )}
      </section>
    </div>
  )
}

function DailyTab({ project }: { project: string }) {
  const daily = trpc.knowledge.daily.useQuery({ project })
  const [selected, setSelected] = useState<string | null>(null)
  const doc = trpc.knowledge.dailyArticle.useQuery(
    { project, relPath: selected ?? '' },
    { enabled: selected != null },
  )

  const entries = daily.data ?? []
  if (entries.length === 0) return <Empty>no daily logs for this project yet.</Empty>

  const active = selected ?? entries[0].relPath
  return (
    <div className="kb-layout">
      <nav className="kb-list">
        {entries.map((d) => (
          <button
            key={d.relPath}
            type="button"
            className={active === d.relPath ? 'kb-item kb-item-active' : 'kb-item'}
            onClick={() => setSelected(d.relPath)}
          >
            <span className="kb-item-title">{d.date}</span>
          </button>
        ))}
      </nav>
      <section className="kb-pane">
        <MarkdownView body={doc.data?.raw ?? ''} articles={[]} onNavigate={() => {}} />
      </section>
    </div>
  )
}

function SearchTab({ project }: { project: string }) {
  const [q, setQ] = useState('')
  const query = trpc.knowledge.query.useMutation()

  return (
    <div className="kb-search">
      <div className="kb-search-warn">
        <span style={{ color: 'var(--amber-dim)' }}>{'// '}</span>
        runs the engine and spends API tokens. Fires only on submit.
      </div>
      <form
        className="kb-search-bar"
        onSubmit={(e) => {
          e.preventDefault()
          if (q.trim()) query.mutate({ project, q: q.trim() })
        }}
      >
        <input
          className="input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ask the knowledge base…"
        />
        <button type="submit" className="btn" disabled={query.isPending || !q.trim()}>
          {query.isPending ? 'running…' : 'search'}
        </button>
      </form>
      {query.error && (
        <div className="panel mt-16">
          <div className="panel-body" style={{ color: 'var(--red, #e66)' }}>
            {query.error.message}
          </div>
        </div>
      )}
      {query.data && (
        <section className="kb-pane mt-16">
          <MarkdownView body={query.data.answer} articles={[]} onNavigate={() => {}} />
        </section>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify the renderer compiles**

Run: `pnpm typecheck:web`
Expected: PASS.

- [ ] **Step 3: Commit (nav + page together — they depend on each other)**

```bash
git add src/renderer/src/store/ui.ts src/renderer/src/components/layout/nav.ts src/renderer/src/App.tsx src/renderer/src/pages/Knowledge.tsx
git commit -m "feat(knowledge): Knowledge page with browse, daily, and search tabs"
```

---

## Task 9: Minimal styling for the Knowledge layout

**Files:**
- Modify: the renderer global stylesheet (find it: `grep -rl "panel-body\|kb-\|\.tab " src/renderer/src/**/*.css` — the file defining `.panel`/`.tab`; likely `src/renderer/src/assets/*.css` or `index.css`).

- [ ] **Step 1: Locate the stylesheet that defines `.panel` and `.tabs`**

Run: `grep -rln "\.panel-body" src/renderer/src`
Use that file. If `.tabs`/`.tab` live there too, append the block below to it.

- [ ] **Step 2: Append the Knowledge layout rules**

```css
/* Knowledge page */
.kb-layout {
  display: grid;
  grid-template-columns: 240px 1fr;
  gap: 16px;
  margin-top: 16px;
}
.kb-list {
  border-right: 1px solid var(--color-border);
  padding-right: 8px;
  overflow-y: auto;
  max-height: calc(100vh - 220px);
}
.kb-group-title {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--amber-dim);
  margin: 12px 0 4px;
}
.kb-item {
  display: flex;
  justify-content: space-between;
  width: 100%;
  text-align: left;
  padding: 4px 6px;
  background: none;
  border: none;
  color: var(--fg-2);
  font-size: 12px;
  cursor: pointer;
}
.kb-item:hover { background: var(--color-muted, rgba(255,255,255,0.04)); }
.kb-item-active { color: var(--fg-1); background: var(--color-muted, rgba(255,255,255,0.06)); }
.kb-item-meta { color: var(--fg-4); font-size: 10px; }
.kb-pane { overflow-y: auto; max-height: calc(100vh - 220px); }
.kb-fm { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 12px; }
.kb-chip {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--amber-dim);
  border: 1px solid var(--color-border);
  padding: 1px 5px;
}
.kb-fm-meta { font-size: 10px; color: var(--fg-4); }
.kb-md { font-size: 13px; line-height: 1.6; }
.kb-md h1, .kb-md h2, .kb-md h3 { margin: 16px 0 8px; }
.kb-md table { border-collapse: collapse; }
.kb-md th, .kb-md td { border: 1px solid var(--color-border); padding: 4px 8px; }
.wikilink {
  background: none;
  border: none;
  padding: 0;
  color: var(--amber, #e0a030);
  cursor: pointer;
  text-decoration: underline;
  font: inherit;
}
.kb-search { margin-top: 16px; }
.kb-search-warn { font-family: var(--mono); font-size: 11px; color: var(--fg-3); margin-bottom: 8px; }
.kb-search-bar { display: flex; gap: 8px; }
.kb-search-bar .input { flex: 1; }
```

> Note: reuse existing `.select`, `.input`, `.btn`, `.tabs`, `.tab`, `.tab-active` classes if the codebase already defines them. If any is missing, mirror the closest existing control's styles. Check with `grep -rn "\.tab-active\|\.btn\b\|\.input\b\|\.select\b" src/renderer/src` before adding duplicates.

- [ ] **Step 3: Verify lint passes**

Run: `pnpm lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A src/renderer/src
git commit -m "feat(knowledge): layout styling"
```

---

## Task 10: Full verification & manual smoke test

**Files:** none (verification only).

- [ ] **Step 1: Run the full gate**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: all PASS.

- [ ] **Step 2: Manual smoke test**

Run: `pnpm dev` (or the project's run command). Then:
- Open the **Knowledge** nav item (Cmd+4).
- Confirm the project picker lists only tracked projects (not `atlas-os-aa778f`). If `trackedProjects` is empty, all real projects appear.
- **Browse:** with an empty KB, the empty-state hint renders. (Optionally drop a fixture `concepts/x.md` with a `[[concepts/x]]` self-link under `~/atlas-knowledge/<proj>/knowledge/concepts/` to confirm rendering, frontmatter chips, and that a dangling `[[nope]]` renders muted/non-clickable — then remove it.)
- **Daily:** select `2026-05-30` and confirm the raw log renders.
- **Search:** type a question, submit, confirm a loading state then a rendered answer (or a readable error if `uv` is absent). Confirm it does **not** fire on typing.

- [ ] **Step 3: Confirm no KB writes occurred**

Run: `git -C ~/atlas-knowledge status` (if it is a git repo) or compare `ls -R ~/atlas-knowledge/<proj>/knowledge` before/after — the UI must not have created/modified files (only `query.py` with `--file-back` would, and we never pass it).

- [ ] **Step 4: Final commit (if any cleanup was needed)**

```bash
git add -A
git commit -m "chore(knowledge): verification cleanup"
```

---

## Self-Review notes

- **Spec coverage:** projects/index/list/article/daily/dailyArticle/query procedures (Task 5) ↔ spec procedure table. trackedProjects filter via projects.json (Task 2 `isTracked`, Task 3 `listProjects`). Wikilink resolve + dangling-disabled (Task 1 + Task 6). Empty states (Task 8). Path-traversal guard (Task 2 `assertInside`, used in Task 3/4). query.py without `--file-back` (Task 4). No new deps; Biome gate (Task 10).
- **Type consistency:** `ArticleMeta` carries `aliases` (added vs. the spec table) because `resolveWikilink` needs them; the schema in Task 1, the producer in Task 3, and the consumers in Task 6/8 all agree.
- **Daily uses `articles={[]}`** in `MarkdownView` — daily logs have no wikilink graph, so resolution is a no-op (tokens render as inline code), which is acceptable.
