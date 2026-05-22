# Skills Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Skills" sidebar section that lists skills from the user's global `~/.claude/skills` folder and renders each skill's `SKILL.md` in-app.

**Architecture:** A main-process service reads `~/.claude/skills/*/SKILL.md` (a directory counts as a skill only if it contains `SKILL.md`, which excludes `*-workspace` eval dirs and naturally excludes plugin skills under `~/.claude/plugins`). Frontmatter is parsed with `js-yaml`. Two tRPC queries (`skills.list`, `skills.get`) expose the data over the existing IPC transport. The renderer adds a Zustand section plus a master-detail page: a card list on the left, the selected skill's `SKILL.md` rendered with `react-markdown` on the right.

**Tech Stack:** Electron + React 19, tRPC v11 over custom IPC, Zustand, Tailwind v4, Zod, Vitest. New deps: `js-yaml`, `@types/js-yaml`, `react-markdown`, `remark-gfm`.

**Reference spec:** `docs/superpowers/specs/2026-05-22-skills-section-design.md`

**Conventions to match (already verified in this codebase):**
- Path aliases: `@main/*`, `@shared/*`, `@renderer/*`.
- Biome: single quotes, no semicolons, trailing commas `all`, 2-space indent, width 100. `recommended` rules only (`console.warn` is allowed).
- `verbatimModuleSyntax: true` → use `import type { ... }` for type-only imports.
- Shared modules define a Zod schema and derive the TS type with `z.infer` (see `src/shared/settings.ts`).
- The skills service must NOT import `electron` or `electron-log`, so it stays unit-testable under the Vitest `node` environment (mirrors `src/main/services/stats.ts`).

---

### Task 1: Install dependencies

**Files:**
- Modify: `package.json` (via package manager)

- [ ] **Step 1: Add runtime + dev dependencies**

Run:
```bash
pnpm add js-yaml react-markdown remark-gfm
pnpm add -D @types/js-yaml
```
Expected: `package.json` gains `js-yaml`, `react-markdown`, `remark-gfm` under `dependencies` and `@types/js-yaml` under `devDependencies`. (The `postinstall` electron-rebuild step may run — that is normal.)

- [ ] **Step 2: Verify install + baseline still green**

Run:
```bash
pnpm typecheck && pnpm test
```
Expected: typecheck passes; existing `stats.test.ts` passes.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore(skills): add js-yaml + react-markdown deps"
```

---

### Task 2: Shared types & Zod schemas

**Files:**
- Create: `src/shared/skills.ts`

- [ ] **Step 1: Write the shared schema module**

Create `src/shared/skills.ts`:
```ts
import { z } from 'zod'

// One skill as shown in the list (parsed from SKILL.md frontmatter).
export const skillMetaSchema = z.object({
  id: z.string(), // folder name under ~/.claude/skills
  name: z.string(), // frontmatter `name`, falls back to id
  description: z.string(), // frontmatter `description`, '' if absent
  trigger: z.string().optional(), // frontmatter `trigger`, e.g. /graphify
  argumentHint: z.string().optional(), // frontmatter `argument-hint`
  allowedToolsCount: z.number(), // length of frontmatter `allowed-tools`
  path: z.string(), // absolute path to the skill directory
})

// A single skill plus its rendered body for the detail pane.
export const skillDetailSchema = z.object({
  meta: skillMetaSchema,
  content: z.string(), // markdown body, frontmatter stripped
})

export type SkillMeta = z.infer<typeof skillMetaSchema>
export type SkillDetail = z.infer<typeof skillDetailSchema>
```

- [ ] **Step 2: Verify it typechecks**

Run:
```bash
pnpm typecheck:node
```
Expected: PASS (file compiles under the node project which includes `src/shared/**/*`).

- [ ] **Step 3: Commit**

```bash
git add src/shared/skills.ts
git commit -m "feat(skills): shared SkillMeta/SkillDetail schemas"
```

---

### Task 3: Skills service (TDD)

**Files:**
- Test: `src/main/services/skills.test.ts`
- Create: `src/main/services/skills.ts`

- [ ] **Step 1: Write the failing test**

Create `src/main/services/skills.test.ts`:
```ts
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listSkills, readSkill } from '@main/services/skills'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let dir: string

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'atlas-skills-'))

  // alpha: full frontmatter, folded description, allowed-tools list of 3
  await mkdir(join(dir, 'alpha'), { recursive: true })
  await writeFile(
    join(dir, 'alpha', 'SKILL.md'),
    [
      '---',
      'name: Alpha Skill',
      'description: >',
      '  First line of the description',
      '  that folds onto one line.',
      'trigger: /alpha',
      'argument-hint: "<file>"',
      'allowed-tools:',
      '  - Read',
      '  - Write',
      '  - Bash',
      '---',
      '',
      '# Alpha',
      '',
      'Body content here.',
      '',
    ].join('\n'),
    'utf8',
  )

  // beta: minimal frontmatter, no name → falls back to id
  await mkdir(join(dir, 'beta'), { recursive: true })
  await writeFile(
    join(dir, 'beta', 'SKILL.md'),
    ['---', 'description: Just a description.', '---', '', 'Beta body.', ''].join('\n'),
    'utf8',
  )

  // gamma-workspace: no SKILL.md → must be excluded
  await mkdir(join(dir, 'gamma-workspace'), { recursive: true })
  await writeFile(join(dir, 'gamma-workspace', 'eval.py'), 'print(1)\n', 'utf8')

  // delta: empty dir, no SKILL.md → excluded
  await mkdir(join(dir, 'delta'), { recursive: true })
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('listSkills', () => {
  it('lists only directories containing SKILL.md, sorted by name', async () => {
    const skills = await listSkills(dir)
    expect(skills.map((s) => s.id)).toEqual(['alpha', 'beta'])
  })

  it('parses frontmatter fields', async () => {
    const skills = await listSkills(dir)
    const alpha = skills.find((s) => s.id === 'alpha')
    expect(alpha).toBeDefined()
    expect(alpha?.name).toBe('Alpha Skill')
    expect(alpha?.description).toBe('First line of the description that folds onto one line.')
    expect(alpha?.trigger).toBe('/alpha')
    expect(alpha?.argumentHint).toBe('<file>')
    expect(alpha?.allowedToolsCount).toBe(3)
  })

  it('falls back to folder id when name is absent', async () => {
    const skills = await listSkills(dir)
    const beta = skills.find((s) => s.id === 'beta')
    expect(beta?.name).toBe('beta')
    expect(beta?.allowedToolsCount).toBe(0)
  })

  it('returns [] when the directory does not exist', async () => {
    expect(await listSkills(join(dir, 'does-not-exist'))).toEqual([])
  })
})

describe('readSkill', () => {
  it('returns the markdown body with frontmatter stripped', async () => {
    const detail = await readSkill('alpha', dir)
    expect(detail.meta.name).toBe('Alpha Skill')
    expect(detail.content).toContain('# Alpha')
    expect(detail.content).toContain('Body content here.')
    expect(detail.content).not.toContain('name: Alpha Skill')
  })

  it('rejects path-traversal ids', async () => {
    await expect(readSkill('../beta', dir)).rejects.toThrow()
    await expect(readSkill('alpha/../beta', dir)).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
pnpm vitest run src/main/services/skills.test.ts
```
Expected: FAIL — cannot resolve `@main/services/skills` (module does not exist yet).

- [ ] **Step 3: Write the service implementation**

Create `src/main/services/skills.ts`:
```ts
import type { Dirent } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import type { SkillDetail, SkillMeta } from '@shared/skills'
import { load } from 'js-yaml'

export const SKILLS_DIR = join(homedir(), '.claude', 'skills')

// Captures the YAML between the leading `---` fence and the rest as the body.
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/

function parseFrontmatter(raw: string): { data: Record<string, unknown>; body: string } {
  const match = raw.match(FRONTMATTER)
  if (!match) return { data: {}, body: raw }
  const parsed = load(match[1])
  const data = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  return { data, body: match[2] }
}

function allowedToolsCount(value: unknown): number {
  if (Array.isArray(value)) return value.length
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean).length
  }
  return 0
}

function toMeta(id: string, dir: string, data: Record<string, unknown>): SkillMeta {
  const name = typeof data.name === 'string' && data.name.trim() ? data.name.trim() : id
  return {
    id,
    name,
    description: typeof data.description === 'string' ? data.description.trim() : '',
    trigger: typeof data.trigger === 'string' ? data.trigger : undefined,
    argumentHint: typeof data['argument-hint'] === 'string' ? data['argument-hint'] : undefined,
    allowedToolsCount: allowedToolsCount(data['allowed-tools']),
    path: join(dir, id),
  }
}

export async function listSkills(dir: string = SKILLS_DIR): Promise<SkillMeta[]> {
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return [] // directory missing → no skills
  }

  const skills: SkillMeta[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    let raw: string
    try {
      raw = await readFile(join(dir, entry.name, 'SKILL.md'), 'utf8')
    } catch {
      continue // no SKILL.md → not a skill (e.g. *-workspace dirs)
    }
    try {
      const { data } = parseFrontmatter(raw)
      skills.push(toMeta(entry.name, dir, data))
    } catch (error) {
      console.warn(`skills: skipping "${entry.name}" — failed to parse frontmatter`, error)
    }
  }

  skills.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
  return skills
}

function assertSafeId(id: string, dir: string): void {
  if (!id || id.includes('/') || id.includes('\\') || id.includes('..') || isAbsolute(id)) {
    throw new Error(`Invalid skill id: ${id}`)
  }
  // The resolved skill dir must be a direct child of `dir`.
  if (resolve(dir) !== resolve(dir, id, '..')) {
    throw new Error(`Invalid skill id: ${id}`)
  }
}

export async function readSkill(id: string, dir: string = SKILLS_DIR): Promise<SkillDetail> {
  assertSafeId(id, dir)
  const raw = await readFile(join(dir, id, 'SKILL.md'), 'utf8')
  const { data, body } = parseFrontmatter(raw)
  return { meta: toMeta(id, dir, data), content: body }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
pnpm vitest run src/main/services/skills.test.ts
```
Expected: PASS — all 6 tests green.

- [ ] **Step 5: Lint + typecheck**

Run:
```bash
pnpm lint && pnpm typecheck:node
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/services/skills.ts src/main/services/skills.test.ts
git commit -m "feat(skills): service to read global ~/.claude/skills"
```

---

### Task 4: Skills tRPC router

**Files:**
- Create: `src/main/trpc/routers/skills.ts`
- Modify: `src/main/trpc/router.ts`

- [ ] **Step 1: Write the router**

Create `src/main/trpc/routers/skills.ts`:
```ts
import { listSkills, readSkill } from '@main/services/skills'
import { publicProcedure, router } from '@main/trpc/trpc'
import { skillDetailSchema, skillMetaSchema } from '@shared/skills'
import { z } from 'zod'

export const skillsRouter = router({
  list: publicProcedure.output(z.array(skillMetaSchema)).query(() => listSkills()),

  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .output(skillDetailSchema)
    .query(({ input }) => readSkill(input.id)),
})
```

- [ ] **Step 2: Register the router**

In `src/main/trpc/router.ts`, add the import (keep imports alphabetical with the others) and the `skills` key:

Add to the import block:
```ts
import { skillsRouter } from '@main/trpc/routers/skills'
```

Change the `appRouter` definition to:
```ts
export const appRouter = router({
  health: healthRouter,
  settings: settingsRouter,
  agent: agentRouter,
  stats: statsRouter,
  skills: skillsRouter,
})
```

- [ ] **Step 3: Typecheck (verifies router + renderer type inference)**

Run:
```bash
pnpm typecheck
```
Expected: PASS — `AppRouter` now includes `skills`, available to the renderer via `trpc`.

- [ ] **Step 4: Commit**

```bash
git add src/main/trpc/routers/skills.ts src/main/trpc/router.ts
git commit -m "feat(skills): skills.list/get tRPC procedures"
```

---

### Task 5: Renderer navigation wiring

**Files:**
- Modify: `src/renderer/src/store/ui.ts`
- Modify: `src/renderer/src/components/layout/Sidebar.tsx`
- Modify: `src/renderer/src/App.tsx`

(The `Skills` page component is created in Task 6; this task wires routing to a placeholder first so each task stays self-contained. The placeholder is replaced in Task 6.)

- [ ] **Step 1: Add `skills` to the Section union**

In `src/renderer/src/store/ui.ts`, change line 3:
```ts
export type Section = 'dashboard' | 'stats' | 'skills' | 'settings'
```

- [ ] **Step 2: Add the sidebar nav item**

In `src/renderer/src/components/layout/Sidebar.tsx`:

Change the lucide import (line 3) to include `Sparkles`:
```ts
import {
  BarChart3,
  LayoutDashboard,
  type LucideIcon,
  Settings as SettingsIcon,
  Sparkles,
} from 'lucide-react'
```

Add the `skills` entry to `ITEMS` (place it before `settings`):
```ts
const ITEMS: ReadonlyArray<{ id: Section; label: string; icon: LucideIcon }> = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'stats', label: 'Stats', icon: BarChart3 },
  { id: 'skills', label: 'Skills', icon: Sparkles },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
]
```

- [ ] **Step 3: Create a temporary placeholder page**

Create `src/renderer/src/pages/Skills.tsx` (replaced in Task 6 — exists now so `App.tsx` compiles):
```tsx
import { PageHeader } from '@renderer/components/layout/PageHeader'

export function Skills() {
  return (
    <div className="flex flex-col">
      <PageHeader title="Skills" description="Skills in your global ~/.claude/skills folder." />
    </div>
  )
}
```

- [ ] **Step 4: Register the page in App.tsx**

In `src/renderer/src/App.tsx`, add the import (after the `Settings` import, keep grouping):
```ts
import { Skills } from '@renderer/pages/Skills'
```

Update the `PAGES` map:
```ts
const PAGES: Record<Section, ComponentType> = {
  dashboard: Dashboard,
  stats: Stats,
  skills: Skills,
  settings: Settings,
}
```

- [ ] **Step 5: Typecheck**

Run:
```bash
pnpm typecheck:web
```
Expected: PASS — `Record<Section, ComponentType>` is exhaustive (every Section has a page).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/store/ui.ts src/renderer/src/components/layout/Sidebar.tsx src/renderer/src/App.tsx src/renderer/src/pages/Skills.tsx
git commit -m "feat(skills): add Skills section to sidebar nav"
```

---

### Task 6: Skills page — master-detail + markdown viewer

**Files:**
- Modify: `src/renderer/src/pages/Skills.tsx`

- [ ] **Step 1: Replace the placeholder with the full page**

Overwrite `src/renderer/src/pages/Skills.tsx`:
```tsx
import { PageHeader } from '@renderer/components/layout/PageHeader'
import { trpc } from '@renderer/lib/trpc'
import { cn } from '@renderer/lib/utils'
import { skipToken } from '@tanstack/react-query'
import { useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// Tailwind descendant styling for rendered SKILL.md (no typography plugin needed).
const PROSE = cn(
  'max-w-3xl text-sm leading-relaxed',
  '[&_h1]:mt-6 [&_h1]:mb-3 [&_h1]:font-semibold [&_h1]:text-xl',
  '[&_h2]:mt-6 [&_h2]:mb-2 [&_h2]:font-semibold [&_h2]:text-lg',
  '[&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:font-medium [&_h3]:text-base',
  '[&_p]:my-3 [&_a]:text-primary [&_a]:underline',
  '[&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1',
  '[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs',
  '[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-4',
  '[&_pre_code]:bg-transparent [&_pre_code]:p-0',
  '[&_table]:my-3 [&_table]:w-full [&_table]:text-xs',
  '[&_th]:border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_td]:border [&_td]:px-2 [&_td]:py-1',
  '[&_blockquote]:border-l-2 [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground',
)

function Badge({ children, tone = 'muted' }: { children: string; tone?: 'muted' | 'primary' }) {
  return (
    <span
      className={cn(
        'shrink-0 rounded px-1.5 py-0.5 text-[10px]',
        tone === 'primary' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
      )}
    >
      {children}
    </span>
  )
}

export function Skills() {
  const skills = trpc.skills.list.useQuery()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const detail = trpc.skills.get.useQuery(selectedId ? { id: selectedId } : skipToken)

  const items = skills.data ?? []

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Skills"
        description="Skills in your global ~/.claude/skills folder."
        action={
          items.length > 0 ? (
            <span className="text-muted-foreground text-sm">{items.length} skills</span>
          ) : null
        }
      />

      <div className="flex min-h-0 flex-1">
        <div className="w-80 shrink-0 overflow-y-auto border-r p-3">
          {skills.isLoading ? (
            <p className="px-2 py-4 text-muted-foreground text-sm">Loading…</p>
          ) : skills.isError ? (
            <p className="px-2 py-4 text-destructive text-sm">Failed to load skills.</p>
          ) : items.length === 0 ? (
            <p className="px-2 py-4 text-muted-foreground text-sm">
              No skills found in ~/.claude/skills.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {items.map((skill) => (
                <li key={skill.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(skill.id)}
                    className={cn(
                      'w-full rounded-md px-3 py-2 text-left transition-colors',
                      selectedId === skill.id ? 'bg-accent' : 'hover:bg-accent/60',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-sm">{skill.name}</span>
                      {skill.allowedToolsCount > 0 ? (
                        <Badge>{`${skill.allowedToolsCount} tools`}</Badge>
                      ) : null}
                    </div>
                    {skill.description ? (
                      <p className="mt-0.5 line-clamp-2 text-muted-foreground text-xs">
                        {skill.description}
                      </p>
                    ) : null}
                    {skill.trigger || skill.argumentHint ? (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {skill.trigger ? <Badge tone="primary">{skill.trigger}</Badge> : null}
                        {skill.argumentHint ? <Badge>{skill.argumentHint}</Badge> : null}
                      </div>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="min-w-0 flex-1 overflow-y-auto p-8">
          {!selectedId ? (
            <p className="text-muted-foreground text-sm">Select a skill to read its SKILL.md.</p>
          ) : detail.isLoading ? (
            <p className="text-muted-foreground text-sm">Loading…</p>
          ) : detail.isError ? (
            <p className="text-destructive text-sm">Failed to load skill.</p>
          ) : detail.data ? (
            <article className={PROSE}>
              <Markdown remarkPlugins={[remarkGfm]}>{detail.data.content}</Markdown>
            </article>
          ) : null}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Lint + typecheck**

Run:
```bash
pnpm lint && pnpm typecheck:web
```
Expected: PASS. (If Biome reformats the long `PROSE` strings, accept its formatting.)

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/pages/Skills.tsx
git commit -m "feat(skills): master-detail Skills page with SKILL.md viewer"
```

---

### Task 7: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full gate**

Run:
```bash
pnpm lint && pnpm typecheck && pnpm test
```
Expected: all green.

- [ ] **Step 2: Manual smoke test in the running app**

Run:
```bash
pnpm dev
```
Then verify by hand:
- The sidebar shows a **Skills** item (Sparkles icon) between Stats and Settings.
- Clicking it opens the Skills page; the left pane lists global skills (e.g. `daily-ai-news`, `graphify`, `gsd-*`, `notebooklm`, `real-chrome`) sorted by name.
- `*-workspace` directories (e.g. `daily-ai-news-workspace`) do **not** appear.
- No `superpowers:*`, `caveman:*`, `chrome-devtools-mcp:*`, or other plugin skills appear (those live under `~/.claude/plugins`).
- Clicking a skill renders its `SKILL.md` (headings, lists, code blocks, tables) in the right pane.
- Trigger / argument-hint badges and the "N tools" badge appear where the frontmatter has them.

- [ ] **Step 3: Final confirmation**

Confirm the manual checks above all pass. No commit needed (no file changes in this task).

---

## Notes for the implementer

- **Why the service avoids `electron`/`electron-log`:** Vitest runs in the `node` environment; importing `electron` there fails. Keeping `skills.ts` electron-free (logging via `console.warn`) keeps it unit-testable, matching `stats.ts`.
- **Plugin exclusion is structural:** we only ever read `~/.claude/skills`. Plugin skills live under `~/.claude/plugins/...` and are never touched — no filtering logic required.
- **Folded YAML descriptions** (`>`/`|`) are exactly why `js-yaml` is used instead of a hand-rolled parser; the service `.trim()`s the result so the folded trailing newline is dropped.
- **`skipToken`** keeps `skills.get` from firing until a skill is selected (same pattern as `Dashboard.tsx`).
