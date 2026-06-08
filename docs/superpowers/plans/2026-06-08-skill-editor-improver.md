# Skill Editor + Improver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-app `SKILL.md` editor with live preview to the Skills tab, plus an interactive "improver" that wraps the `skill-creator` skill via the Claude Agent SDK to iteratively improve a selected skill and render a full A/B report natively.

**Architecture:** Phase A adds raw-file read/write to the skills service + router and rebuilds the Skills right pane as a side-by-side editor|preview (vertical divider, one shared scroll, each column collapsible), with live client-side frontmatter parsing and Cmd+S save. Phase B adds an interactive SDK session service (streaming-input mailbox + bypassPermissions), an `ImproverEvent` tRPC subscription, a backup/auto-apply/revert lifecycle, and a renderer overlay (transcript + reply box + native report). The session keeps running across tab switches via an always-mounted host (mirrors `NewsRunHost`).

**Tech Stack:** Electron + tRPC (observable subscriptions) + zustand + React + `@anthropic-ai/claude-agent-sdk` (dynamic ESM import from CJS main) + vitest + sonner toasts.

**Spec:** `docs/superpowers/specs/2026-06-08-skill-editor-improver-design.md`

**Conventions:** All UI strings English. Mono font via `var(--mono)`, colors via `var(--*)` tokens. Honor the Tailwind `@layer` `mt-*` trap (custom spacing utilities stay top-level). Run `pnpm typecheck` and `pnpm test` to verify. Commit messages end with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer. Do NOT use the `git-commit-message` skill (it targets Mako/KESHET, wrong repo). Do NOT push.

---

# Phase A — Editor + Preview split

## Task A1: `readSkillRaw` + `writeSkill` service functions

**Files:**
- Modify: `src/main/services/skills.ts`
- Test: `src/main/services/skills.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/main/services/skills.test.ts` (after the `readSkill` describe block):

```ts
import { readSkillRaw, writeSkill } from '@main/services/skills'

describe('readSkillRaw', () => {
  it('returns the entire raw SKILL.md including frontmatter', async () => {
    const raw = await readSkillRaw('beta', dir)
    expect(raw).toContain('description: Just a description.')
    expect(raw).toContain('Beta body.')
    expect(raw.startsWith('---')).toBe(true)
  })

  it('rejects path-traversal ids', async () => {
    await expect(readSkillRaw('../beta', dir)).rejects.toThrow()
    await expect(readSkillRaw('alpha/../beta', dir)).rejects.toThrow()
  })
})

describe('writeSkill', () => {
  it('round-trips content through readSkillRaw', async () => {
    const next = '---\nname: Beta\ndescription: Edited.\n---\n\nNew body.\n'
    await writeSkill('beta', next, dir)
    expect(await readSkillRaw('beta', dir)).toBe(next)
  })

  it('rejects path-traversal ids', async () => {
    await expect(writeSkill('../escape', 'x', dir)).rejects.toThrow()
    await expect(writeSkill('a/b', 'x', dir)).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test src/main/services/skills.test.ts`
Expected: FAIL — `readSkillRaw`/`writeSkill` are not exported.

- [ ] **Step 3: Implement the functions**

In `src/main/services/skills.ts`, add `writeFile` to the existing `node:fs/promises` import:

```ts
import { readdir, readFile, writeFile } from 'node:fs/promises'
```

Then append at the end of the file:

```ts
// The full raw SKILL.md (frontmatter + body) for the editor. Unlike readSkill,
// nothing is parsed or stripped — the editor saves back exactly what it shows.
export async function readSkillRaw(id: string, dir: string = SKILLS_DIR): Promise<string> {
  assertSafeId(id, dir)
  return readFile(join(dir, id, 'SKILL.md'), 'utf8')
}

// Overwrite a skill's SKILL.md with raw editor content. assertSafeId already
// guarantees the id is a direct child of `dir`, so the resolved path stays inside.
export async function writeSkill(
  id: string,
  content: string,
  dir: string = SKILLS_DIR,
): Promise<void> {
  assertSafeId(id, dir)
  await writeFile(join(dir, id, 'SKILL.md'), content, 'utf8')
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test src/main/services/skills.test.ts`
Expected: PASS (all describes green).

- [ ] **Step 5: Commit**

```bash
git add src/main/services/skills.ts src/main/services/skills.test.ts
git commit -m "feat(skills): add readSkillRaw + writeSkill service functions

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task A2: `getRaw` query + `save` mutation on the skills router

**Files:**
- Modify: `src/main/trpc/routers/skills.ts`

- [ ] **Step 1: Add the procedures**

Replace the contents of `src/main/trpc/routers/skills.ts` with:

```ts
import { listSkills, readSkill, readSkillRaw, writeSkill } from '@main/services/skills'
import { publicProcedure, router } from '@main/trpc/trpc'
import { skillDetailSchema, skillMetaSchema } from '@shared/skills'
import { z } from 'zod'

export const skillsRouter = router({
  list: publicProcedure.output(z.array(skillMetaSchema)).query(() => listSkills()),

  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .output(skillDetailSchema)
    .query(({ input }) => readSkill(input.id)),

  getRaw: publicProcedure
    .input(z.object({ id: z.string() }))
    .output(z.object({ content: z.string() }))
    .query(async ({ input }) => ({ content: await readSkillRaw(input.id) })),

  save: publicProcedure
    .input(z.object({ id: z.string(), content: z.string() }))
    .output(z.object({ ok: z.literal(true) }))
    .mutation(async ({ input }) => {
      await writeSkill(input.id, input.content)
      return { ok: true as const }
    }),
})
```

- [ ] **Step 2: Verify it typechecks**

Run: `pnpm typecheck`
Expected: PASS (no errors).

- [ ] **Step 3: Commit**

```bash
git add src/main/trpc/routers/skills.ts
git commit -m "feat(skills): add getRaw query and save mutation to router

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task A3: client-side `splitFrontmatter` helper

A pure helper so the live preview can parse the editor buffer without a server round-trip. Lives in `shared/skills.ts` alongside the other shared skill helpers.

**Files:**
- Modify: `src/shared/skills.ts`
- Test: `src/shared/skills.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/shared/skills.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { splitFrontmatter } from '@shared/skills'

describe('splitFrontmatter', () => {
  it('splits leading --- frontmatter from the body', () => {
    const raw = '---\nname: X\nallowed-tools:\n  - Read\n  - Write\n---\n\n# Body\ntext\n'
    const { frontmatter, body } = splitFrontmatter(raw)
    expect(frontmatter).toContain('name: X')
    expect(body).toBe('# Body\ntext\n')
  })

  it('returns empty frontmatter and the whole string as body when no fence', () => {
    const raw = '# Just a body\nno frontmatter\n'
    expect(splitFrontmatter(raw)).toEqual({ frontmatter: '', body: raw })
  })

  it('handles CRLF line endings', () => {
    const raw = '---\r\nname: X\r\n---\r\nbody\r\n'
    const { frontmatter, body } = splitFrontmatter(raw)
    expect(frontmatter).toContain('name: X')
    expect(body).toBe('body\r\n')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/shared/skills.test.ts`
Expected: FAIL — `splitFrontmatter` not exported.

- [ ] **Step 3: Implement the helper**

Append to `src/shared/skills.ts`:

```ts
// Mirrors the server-side FRONTMATTER regex in main/services/skills.ts so the
// editor can render a live preview from its own buffer without a round-trip.
// Returns the raw YAML (without the --- fences) and the body after the fence.
const FRONTMATTER_FENCE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?([\s\S]*)$/

export function splitFrontmatter(raw: string): { frontmatter: string; body: string } {
  const match = raw.match(FRONTMATTER_FENCE)
  if (!match) return { frontmatter: '', body: raw }
  return { frontmatter: match[1], body: match[2] }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/shared/skills.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/skills.ts src/shared/skills.test.ts
git commit -m "feat(skills): add splitFrontmatter helper for live preview

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task A4: CSS for the editor/preview split

**Files:**
- Modify: `src/renderer/src/index.css` (skills section)

- [ ] **Step 1: Find the existing skills CSS**

Run: `grep -n "SPLIT PANE\|.split-pane\|@layer components" src/renderer/src/index.css`
Expected: `@layer components {` opens around line 160; the `/* ===== SPLIT PANE / MD ===== */` section with `.split-pane`/`.pane-head`/`.pane-body` lives inside that layer (~line 967). Read that section so the new rules match its style.

- [ ] **Step 2: Add the split-editor CSS**

Add these rules **inside the `@layer components { … }` block**, right after the SPLIT PANE / MD section, so they share specificity with `.split-pane`/`.btn`/`.input` (all of which live in that layer). The class names are new component classes (not utilities), so the `mt-*` `@layer` trap does not apply. Indent two spaces to match the surrounding rules.

```css
/* Skills editor: side-by-side editor|preview under ONE shared scroll. The
   outer .skill-split is the scroll container; columns auto-grow so they scroll
   together. Collapsing a column drops it from the grid. */
.skill-split-head {
  display: flex;
  align-items: stretch;
  border-bottom: 1px solid var(--line-dim);
  font-family: var(--mono);
  font-size: 11px;
  color: var(--fg-4);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.skill-split-head .col-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  cursor: pointer;
  user-select: none;
  background: none;
  border: none;
  color: inherit;
  font: inherit;
  letter-spacing: inherit;
  text-transform: inherit;
}
.skill-split-head .col-head.editor-head {
  flex: 1;
  border-right: 1px solid var(--line-dim);
  justify-content: space-between;
}
.skill-split-head .col-head.preview-head {
  flex: 1;
}
.skill-split-head .head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.skill-split {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: grid;
  grid-template-columns: 1fr 1fr;
}
.skill-split.editor-only {
  grid-template-columns: 1fr;
}
.skill-split.preview-only {
  grid-template-columns: 1fr;
}
.skill-split .editor-col {
  border-right: 1px solid var(--line-dim);
  min-width: 0;
}
.skill-split .skill-editor {
  width: 100%;
  min-height: 100%;
  box-sizing: border-box;
  padding: 16px 18px;
  background: none;
  border: none;
  outline: none;
  resize: none;
  overflow: hidden; /* auto-grown to content; outer .skill-split scrolls */
  font-family: var(--mono);
  font-size: 12px;
  line-height: 1.6;
  color: var(--fg-1);
  white-space: pre;
}
.skill-split .preview-col {
  min-width: 0;
}
.dirty-dot {
  color: var(--amber);
}
```

- [ ] **Step 3: Verify the app still builds**

Run: `pnpm typecheck`
Expected: PASS (CSS-only change; typecheck just confirms nothing else broke).

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/index.css
git commit -m "feat(skills): add CSS for editor/preview split pane

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task A5: Rebuild the Skills right pane (editor | preview)

Replace the read-only preview with the side-by-side editor + live preview, Cmd+S save, dirty indicator, collapsible columns. The improve button is added as a disabled placeholder here and wired up in Phase B.

**Files:**
- Modify: `src/renderer/src/pages/Skills.tsx`

- [ ] **Step 1: Add editor state + the right-pane component**

In `src/renderer/src/pages/Skills.tsx`, update the imports at the top:

```ts
import { PageHeader } from '@renderer/components/layout/PageHeader'
import { trpc } from '@renderer/lib/trpc'
import { groupByPrefix, type SkillMeta, splitFrontmatter } from '@shared/skills'
import { skipToken } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { toast } from 'sonner'
```

Add a small frontmatter-tools parser and the editor pane component (place above `export function Skills`). It parses `allowed-tools` from the live buffer using a forgiving line scan (avoids pulling in a YAML lib on the renderer):

```ts
// Pull allowed-tools from raw frontmatter for the live preview chips. Supports
// both the inline list ("Read, Write") and the YAML block list (- Read).
function parseToolsFromFrontmatter(frontmatter: string): string[] {
  const lines = frontmatter.split(/\r?\n/)
  const idx = lines.findIndex((l) => /^allowed-tools\s*:/.test(l))
  if (idx === -1) return []
  const inline = lines[idx].replace(/^allowed-tools\s*:/, '').trim()
  if (inline) {
    return inline
      .replace(/^\[|\]$/g, '')
      .split(',')
      .map((s) => s.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean)
  }
  const tools: string[] = []
  for (let i = idx + 1; i < lines.length; i++) {
    const m = lines[i].match(/^\s*-\s*(.+?)\s*$/)
    if (!m) break
    tools.push(m[1].replace(/^["']|["']$/g, ''))
  }
  return tools
}

function SkillEditorPane({ skillId }: { skillId: string }) {
  const utils = trpc.useUtils()
  const raw = trpc.skills.getRaw.useQuery({ id: skillId })
  const save = trpc.skills.save.useMutation()

  const [buffer, setBuffer] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [editorOpen, setEditorOpen] = useState(true)
  const [previewOpen, setPreviewOpen] = useState(true)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Load the buffer whenever the fetched content changes (new skill selected or
  // refetch). Keying the component by skillId (see caller) guarantees a remount,
  // so this also resets editorOpen/previewOpen per skill.
  useEffect(() => {
    if (raw.data) {
      setBuffer(raw.data.content)
      setSavedContent(raw.data.content)
    }
  }, [raw.data])

  // Auto-grow the textarea so the OUTER container owns the single shared scroll.
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [buffer, editorOpen])

  const dirty = buffer !== savedContent

  function doSave() {
    if (!dirty || save.isPending) return
    save.mutate(
      { id: skillId, content: buffer },
      {
        onSuccess: () => {
          setSavedContent(buffer)
          void utils.skills.list.invalidate()
          void utils.skills.get.invalidate({ id: skillId })
          toast.success('Skill saved')
        },
        onError: (err) => toast.error(err.message),
      },
    )
  }

  // Cmd/Ctrl+S saves. Scoped to the editor region so it does not fight global keys.
  function onKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault()
      doSave()
    }
  }

  const { frontmatter, body } = splitFrontmatter(buffer)
  const tools = parseToolsFromFrontmatter(frontmatter)

  const splitClass = !previewOpen ? 'editor-only' : !editorOpen ? 'preview-only' : ''

  return (
    <div className="split-pane">
      <div className="skill-split-head">
        {editorOpen ? (
          <div className="col-head editor-head">
            <button
              type="button"
              className="col-head"
              style={{ padding: 0 }}
              onClick={() => setEditorOpen(false)}
            >
              <ChevronDown style={{ width: 10, height: 10 }} />
              editor · SKILL.md {dirty ? <span className="dirty-dot">●</span> : null}
            </button>
            <span className="head-actions">
              <button
                type="button"
                className="btn"
                disabled={!dirty || save.isPending}
                onClick={doSave}
              >
                Save ⌘S
              </button>
              <button type="button" className="btn" disabled title="Coming in Phase B">
                <Sparkles style={{ width: 11, height: 11 }} /> Improve
              </button>
            </span>
          </div>
        ) : (
          <button type="button" className="col-head editor-head" onClick={() => setEditorOpen(true)}>
            <ChevronRight style={{ width: 10, height: 10 }} /> editor
          </button>
        )}
        <button
          type="button"
          className="col-head preview-head"
          onClick={() => setPreviewOpen((v) => !v)}
        >
          {previewOpen ? (
            <ChevronDown style={{ width: 10, height: 10 }} />
          ) : (
            <ChevronRight style={{ width: 10, height: 10 }} />
          )}
          preview · rendered
        </button>
      </div>

      <div className={`skill-split ${splitClass}`}>
        {editorOpen ? (
          <div className="editor-col">
            {raw.isLoading ? (
              <div style={{ ...hintStyle, padding: '16px 18px' }}>{'// loading…'}</div>
            ) : (
              <textarea
                ref={textareaRef}
                className="skill-editor"
                spellCheck={false}
                value={buffer}
                onChange={(e) => setBuffer(e.target.value)}
                onKeyDown={onKeyDown}
              />
            )}
          </div>
        ) : null}
        {previewOpen ? (
          <div className="preview-col">
            {tools.length > 0 ? (
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  gap: 6,
                  padding: '16px 24px 0',
                }}
              >
                <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--fg-4)' }}>
                  Tools:
                </span>
                {tools.map((tool) => (
                  <span
                    key={tool}
                    style={{
                      fontFamily: 'var(--mono)',
                      fontSize: 10,
                      color: 'var(--amber)',
                      border: '1px solid var(--amber-dim)',
                      padding: '1px 6px',
                    }}
                  >
                    {tool}
                  </span>
                ))}
              </div>
            ) : null}
            <div className="md-prose">
              <Markdown remarkPlugins={[remarkGfm]}>{formatSkillMarkdown(body)}</Markdown>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Use the new pane in the Skills component**

In `export function Skills()`, the `detail` query is no longer needed (the pane fetches its own raw content). Remove this line:

```ts
  const detail = trpc.skills.get.useQuery(selectedId ? { id: selectedId } : skipToken)
```

Replace the entire RIGHT pane block (the `<div className="split-pane">…</div>` that starts at the `{/* RIGHT: rendered preview */}` comment) with:

```tsx
        {/* RIGHT: editor + live preview */}
        {selectedId ? (
          <SkillEditorPane key={selectedId} skillId={selectedId} />
        ) : (
          <div className="split-pane">
            <div className="pane-head">
              <span className="ttl">editor · preview</span>
              <span className="meta">no selection</span>
            </div>
            <div className="pane-body">
              <div style={{ ...hintStyle, padding: '20px 24px' }}>
                {'// select a skill to edit its SKILL.md'}
              </div>
            </div>
          </div>
        )}
```

`skipToken` may now be unused — if `pnpm typecheck` reports it, remove it from the `@tanstack/react-query` import.

- [ ] **Step 3: Verify it typechecks**

Run: `pnpm typecheck`
Expected: PASS. Fix any unused-import errors it surfaces (`skipToken`).

- [ ] **Step 4: Confirm the `.btn` class exists**

Run: `grep -n "\.btn {" src/renderer/src/index.css`
Expected: a `.btn` rule already exists (line ~392, inside `@layer components`) — used across other pages. No new button CSS is needed; the markup above reuses it. (`.input` likewise exists at ~line 472.)

- [ ] **Step 5: Manually verify in the app**

Run: `pnpm dev`
Then: select a skill → confirm the right pane shows editor (left) and preview (right) under one scrollbar; type in the editor and confirm the preview updates immediately and the `●` dirty dot appears; press Cmd+S and confirm the toast + dot clears; collapse each column via its header chevron and confirm the other expands to full width. Close with Ctrl+C.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/pages/Skills.tsx src/renderer/src/index.css
git commit -m "feat(skills): editor + live preview split pane with Cmd+S save

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

**Phase A is complete and shippable here.**

---

# Phase B — Skill Improver

## Task B1: shared report schema + event types

**Files:**
- Create: `src/shared/skillImprover.ts`
- Create: `src/shared/skillImprover.test.ts`
- Modify: `src/shared/ipc-events.ts`

- [ ] **Step 1: Write the failing test**

Create `src/shared/skillImprover.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { improverReportSchema, parseImproverReport } from '@shared/skillImprover'

describe('improverReportSchema', () => {
  it('accepts a full report', () => {
    const report = {
      skillName: 'graphify',
      iterations: [
        {
          n: 0,
          passRate: 0.5,
          tokens: 1000,
          durationMs: 12000,
          perEval: [{ name: 'extracts entities', passed: false, notes: 'missed two' }],
        },
        { n: 1, passRate: 0.9, tokens: 1200, durationMs: 14000, perEval: [] },
      ],
      beforeDescription: 'old desc',
      afterDescription: 'new desc',
      diffSummary: 'tightened the trigger language',
      analystSummary: 'iteration 1 fixed entity coverage',
    }
    expect(improverReportSchema.parse(report).skillName).toBe('graphify')
  })

  it('accepts a minimal report (only required fields)', () => {
    const report = { skillName: 'x', iterations: [{ n: 0 }] }
    expect(improverReportSchema.parse(report).iterations[0].n).toBe(0)
  })

  it('parseImproverReport returns null on malformed JSON', () => {
    expect(parseImproverReport('not json{')).toBeNull()
  })

  it('parseImproverReport returns null when schema does not match', () => {
    expect(parseImproverReport(JSON.stringify({ skillName: 'x' }))).toBeNull()
  })

  it('parseImproverReport parses a valid JSON string', () => {
    const json = JSON.stringify({ skillName: 'x', iterations: [{ n: 0 }] })
    expect(parseImproverReport(json)?.skillName).toBe('x')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/shared/skillImprover.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the schema + parser**

Create `src/shared/skillImprover.ts`:

```ts
import { z } from 'zod'

// One eval's result within an iteration. The model fills these from its A/B runs.
const evalResultSchema = z.object({
  name: z.string(),
  passed: z.boolean(),
  notes: z.string().optional(),
})

// One benchmarked version: n=0 is the baseline (original skill), n>=1 the
// successive improved iterations. Metrics are optional — degrade in the UI.
const iterationSchema = z.object({
  n: z.number(),
  passRate: z.number().optional(),
  tokens: z.number().optional(),
  durationMs: z.number().optional(),
  perEval: z.array(evalResultSchema).optional(),
})

// The full A/B report the improver writes at the end of a session. Fields beyond
// skillName + iterations are optional because the model generates this JSON.
export const improverReportSchema = z.object({
  skillName: z.string(),
  iterations: z.array(iterationSchema),
  beforeDescription: z.string().optional(),
  afterDescription: z.string().optional(),
  diffSummary: z.string().optional(),
  analystSummary: z.string().optional(),
})

export type ImproverReport = z.infer<typeof improverReportSchema>

// Tolerant parse for report JSON read off disk: returns null on bad JSON or a
// shape mismatch so the caller can fall back to a "report unavailable" state.
export function parseImproverReport(raw: string): ImproverReport | null {
  try {
    return improverReportSchema.parse(JSON.parse(raw))
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/shared/skillImprover.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the `ImproverEvent` type**

Append to `src/shared/ipc-events.ts`:

```ts
import type { ImproverReport } from '@shared/skillImprover'

// Events streamed from main → renderer during an interactive skill-improver
// session (tRPC subscription). `awaiting-input` marks a turn boundary where the
// agent paused for the user's reply; `report` carries the parsed final A/B report.
export type ImproverEvent =
  | { type: 'token'; text: string }
  | { type: 'tool'; name: string; summary: string }
  | { type: 'awaiting-input' }
  | { type: 'report'; report: ImproverReport }
  | { type: 'done' }
  | { type: 'error'; message: string }
  | { type: 'aborted' }
```

- [ ] **Step 6: Verify + commit**

Run: `pnpm test src/shared/skillImprover.test.ts && pnpm typecheck`
Expected: PASS.

```bash
git add src/shared/skillImprover.ts src/shared/skillImprover.test.ts src/shared/ipc-events.ts
git commit -m "feat(improver): add report schema, parser, and ImproverEvent type

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task B2: skill-creator path resolver + wrapper prompt builder

**Files:**
- Create: `src/main/services/skillImprover/prompt.ts`
- Create: `src/main/services/skillImprover/prompt.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/main/services/skillImprover/prompt.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { REPORT_SENTINEL, buildImproverPrompt } from '@main/services/skillImprover/prompt'

describe('buildImproverPrompt', () => {
  const args = {
    skillCreatorPath: '/plugins/skill-creator/SKILL.md',
    skillPath: '/home/u/.claude/skills/graphify',
    skillName: 'graphify',
    workspace: '/tmp/atlas-improver-abc',
    reportPath: '/tmp/atlas-improver-abc/report.json',
  }

  it('includes the skill path, workspace, report path, and sentinel', () => {
    const p = buildImproverPrompt(args)
    expect(p).toContain('/home/u/.claude/skills/graphify')
    expect(p).toContain('/tmp/atlas-improver-abc')
    expect(p).toContain('/tmp/atlas-improver-abc/report.json')
    expect(p).toContain(REPORT_SENTINEL)
  })

  it('references the skill-creator skill by absolute path', () => {
    expect(buildImproverPrompt(args)).toContain('/plugins/skill-creator/SKILL.md')
  })

  it('forbids opening browser viewers', () => {
    expect(buildImproverPrompt(args).toLowerCase()).toContain('do not open')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/main/services/skillImprover/prompt.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the prompt builder**

Create `src/main/services/skillImprover/prompt.ts`:

```ts
// Printed by the agent on its own line right after it writes the report JSON.
// The service watches streamed text for this exact token, then reads + parses
// the report file. Keep it unusual so it never collides with normal output.
export const REPORT_SENTINEL = '<<ATLAS_REPORT_READY>>'

export interface ImproverPromptArgs {
  skillCreatorPath: string // absolute path to skill-creator's SKILL.md
  skillPath: string // absolute path to the skill dir being improved
  skillName: string
  workspace: string // temp dir the agent must confine all working files to
  reportPath: string // where the agent writes the final report JSON
}

// The wrapper prompt that drives an interactive skill-creator session inside
// Atlas. It keeps the agent autonomous on tooling (bypassPermissions) but in the
// loop with the user for substantive questions, redirects the browser-based eval
// viewer to a JSON report we render natively, and confines temp files so we can
// clean them up afterward.
export function buildImproverPrompt(args: ImproverPromptArgs): string {
  return `You are improving an existing Claude Code skill, running inside the Atlas desktop app (not a normal terminal). Follow the skill-creator process described in this file — read it first:

  ${args.skillCreatorPath}

The skill you are improving is at:

  ${args.skillPath}

(name: ${args.skillName})

## How this environment differs from normal skill-creator usage

1. There is NO browser and NO display. DO NOT open browser viewers. Specifically, do NOT run eval-viewer/generate_review.py or open any HTML. Where the skill-creator process tells you to open the viewer, instead write the benchmark data as JSON into the workspace and post a short plain-text summary into the chat for me to read.

2. Talk to me directly in the chat. When the skill-creator process says to ask the user something (intent, test cases, which baseline, whether results look good), just ask me here in plain text and wait for my reply. Keep questions concise.

3. Confine ALL working files (workspace, iterations, eval outputs, snapshots, benchmark.json) to this directory:

  ${args.workspace}

  Do NOT create a sibling <skill-name>-workspace next to the skill. Use the path above instead.

4. You MAY edit the real SKILL.md at ${args.skillPath} in place as your final improved version — its original has already been backed up by the app, so it is safe to overwrite. Apply your best final version there.

## Running the A/B comparison

Do real A/B runs as the skill-creator process describes (spawn subagents for with-skill vs baseline, grade them, aggregate). Run successive improvement iterations until you are satisfied or I tell you to stop. The baseline (n=0) is the original version of the skill.

## Finishing: the report

When you are done, write a final report as a single JSON file to:

  ${args.reportPath}

It MUST match this shape exactly (extra fields are ignored, but use these keys):

{
  "skillName": "${args.skillName}",
  "iterations": [
    { "n": 0, "passRate": 0.0, "tokens": 0, "durationMs": 0,
      "perEval": [ { "name": "what the eval checks", "passed": false, "notes": "..." } ] },
    { "n": 1, "passRate": 0.0, "tokens": 0, "durationMs": 0, "perEval": [] }
  ],
  "beforeDescription": "the original frontmatter description",
  "afterDescription": "the improved frontmatter description",
  "diffSummary": "human-readable summary of what changed in SKILL.md and why",
  "analystSummary": "why the new version is better, with the key evidence"
}

n=0 is the baseline; n=1, n=2, ... are your successive improved iterations. passRate is 0..1. Include one perEval entry per test case per iteration where you have data.

IMMEDIATELY after the file is written, output EXACTLY this line on its own, with nothing else on the line:

${REPORT_SENTINEL}

Then stop and wait. I will review the report in the app and either accept or reject your changes.

Begin by reading the skill-creator file and the target skill, then tell me your plan and ask any questions you need.`
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/main/services/skillImprover/prompt.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/skillImprover/prompt.ts src/main/services/skillImprover/prompt.test.ts
git commit -m "feat(improver): add wrapper prompt builder + report sentinel

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task B3: skill-creator path resolver

**Files:**
- Create: `src/main/services/skillImprover/skillCreator.ts`
- Create: `src/main/services/skillImprover/skillCreator.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/main/services/skillImprover/skillCreator.test.ts`:

```ts
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findSkillCreatorPath } from '@main/services/skillImprover/skillCreator'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'atlas-sc-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('findSkillCreatorPath', () => {
  it('finds the cached plugin SKILL.md under a version segment', async () => {
    const dir = join(root, 'cache/claude-plugins-official/skill-creator/1.0/skills/skill-creator')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'SKILL.md'), '# sc', 'utf8')
    const found = await findSkillCreatorPath(root)
    expect(found).toBe(join(dir, 'SKILL.md'))
  })

  it('falls back to the marketplace path', async () => {
    const dir = join(
      root,
      'marketplaces/claude-plugins-official/plugins/skill-creator/skills/skill-creator',
    )
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'SKILL.md'), '# sc', 'utf8')
    const found = await findSkillCreatorPath(root)
    expect(found).toBe(join(dir, 'SKILL.md'))
  })

  it('returns null when skill-creator is not installed', async () => {
    expect(await findSkillCreatorPath(root)).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/main/services/skillImprover/skillCreator.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the resolver**

Create `src/main/services/skillImprover/skillCreator.ts`:

```ts
import { access, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const PLUGINS_ROOT = join(homedir(), '.claude', 'plugins')

async function exists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

// Locate skill-creator's SKILL.md. The cache path has a volatile version segment
// (e.g. ".../skill-creator/<version>/skills/skill-creator/"), so scan it; fall
// back to the stable marketplace path. Returns null if not installed.
export async function findSkillCreatorPath(
  pluginsRoot: string = PLUGINS_ROOT,
): Promise<string | null> {
  const cacheBase = join(pluginsRoot, 'cache', 'claude-plugins-official', 'skill-creator')
  let versions: string[] = []
  try {
    versions = await readdir(cacheBase)
  } catch {
    versions = []
  }
  for (const v of versions) {
    const candidate = join(cacheBase, v, 'skills', 'skill-creator', 'SKILL.md')
    if (await exists(candidate)) return candidate
  }

  const marketplace = join(
    pluginsRoot,
    'marketplaces',
    'claude-plugins-official',
    'plugins',
    'skill-creator',
    'skills',
    'skill-creator',
    'SKILL.md',
  )
  if (await exists(marketplace)) return marketplace

  return null
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/main/services/skillImprover/skillCreator.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/skillImprover/skillCreator.ts src/main/services/skillImprover/skillCreator.test.ts
git commit -m "feat(improver): resolve skill-creator SKILL.md path

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task B4: session workspace lifecycle (backup / restore / cleanup)

**Files:**
- Create: `src/main/services/skillImprover/workspace.ts`
- Create: `src/main/services/skillImprover/workspace.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/main/services/skillImprover/workspace.test.ts`:

```ts
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSession, restoreBackup, cleanupSession } from '@main/services/skillImprover/workspace'

let skillsDir: string

beforeEach(async () => {
  skillsDir = await mkdtemp(join(tmpdir(), 'atlas-ws-skills-'))
  await mkdir(join(skillsDir, 'graphify'), { recursive: true })
  await writeFile(join(skillsDir, 'graphify', 'SKILL.md'), 'ORIGINAL\n', 'utf8')
})
afterEach(async () => {
  await rm(skillsDir, { recursive: true, force: true })
})

describe('skill-improver workspace', () => {
  it('createSession backs up the original SKILL.md and exposes paths', async () => {
    const s = await createSession('req-1', 'graphify', skillsDir)
    expect(s.skillPath).toBe(join(skillsDir, 'graphify'))
    expect(existsSync(s.workspace)).toBe(true)
    expect(await readFile(s.backupFile, 'utf8')).toBe('ORIGINAL\n')
    expect(s.reportPath.endsWith('report.json')).toBe(true)
    await cleanupSession(s)
  })

  it('restoreBackup copies the backup back over an edited SKILL.md', async () => {
    const s = await createSession('req-2', 'graphify', skillsDir)
    await writeFile(join(s.skillPath, 'SKILL.md'), 'EDITED\n', 'utf8')
    await restoreBackup(s)
    expect(await readFile(join(s.skillPath, 'SKILL.md'), 'utf8')).toBe('ORIGINAL\n')
    await cleanupSession(s)
  })

  it('cleanupSession removes the workspace', async () => {
    const s = await createSession('req-3', 'graphify', skillsDir)
    await cleanupSession(s)
    expect(existsSync(s.workspace)).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/main/services/skillImprover/workspace.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the lifecycle**

Create `src/main/services/skillImprover/workspace.ts`:

```ts
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SKILLS_DIR } from '@main/services/skills'

export interface ImproverSession {
  requestId: string
  skillId: string
  skillPath: string // <skillsDir>/<skillId>
  skillFile: string // <skillPath>/SKILL.md
  workspace: string // temp dir for all agent working files
  backupFile: string // <workspace>/backup/SKILL.md
  reportPath: string // <workspace>/report.json
}

// Create a temp workspace and snapshot the skill's current SKILL.md so the run
// can be reverted. The agent edits the real file in place; restoreBackup undoes
// that, cleanupSession deletes the workspace.
export async function createSession(
  requestId: string,
  skillId: string,
  skillsDir: string = SKILLS_DIR,
): Promise<ImproverSession> {
  const skillPath = join(skillsDir, skillId)
  const skillFile = join(skillPath, 'SKILL.md')
  const workspace = await mkdtemp(join(tmpdir(), 'atlas-improver-'))
  const backupDir = join(workspace, 'backup')
  await mkdir(backupDir, { recursive: true })
  const backupFile = join(backupDir, 'SKILL.md')
  await cp(skillFile, backupFile)
  return {
    requestId,
    skillId,
    skillPath,
    skillFile,
    workspace,
    backupFile,
    reportPath: join(workspace, 'report.json'),
  }
}

// Revert the skill to the backup taken at session start (reject/cancel path).
export async function restoreBackup(session: ImproverSession): Promise<void> {
  await cp(session.backupFile, session.skillFile)
}

// Remove the temp workspace (and the backup inside it). Safe to call twice.
export async function cleanupSession(session: ImproverSession): Promise<void> {
  await rm(session.workspace, { recursive: true, force: true })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/main/services/skillImprover/workspace.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/skillImprover/workspace.ts src/main/services/skillImprover/workspace.test.ts
git commit -m "feat(improver): add session workspace backup/restore/cleanup

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task B5: streaming-input mailbox

A small async queue that yields the initial wrapper message, then yields each pushed user reply as an `SDKUserMessage`, and completes when closed. This is the `prompt` iterable for the SDK in streaming-input mode.

**Files:**
- Create: `src/main/services/skillImprover/mailbox.ts`
- Create: `src/main/services/skillImprover/mailbox.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/main/services/skillImprover/mailbox.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createMailbox } from '@main/services/skillImprover/mailbox'

async function collect(mb: ReturnType<typeof createMailbox>): Promise<string[]> {
  const out: string[] = []
  for await (const msg of mb.stream) {
    const content = msg.message.content
    out.push(typeof content === 'string' ? content : JSON.stringify(content))
  }
  return out
}

describe('createMailbox', () => {
  it('yields the initial message then pushed replies in order, completing on close', async () => {
    const mb = createMailbox('first')
    const collected = collect(mb)
    mb.push('second')
    mb.push('third')
    mb.close()
    expect(await collected).toEqual(['first', 'second', 'third'])
  })

  it('each yielded message is a well-formed SDKUserMessage', async () => {
    const mb = createMailbox('hello')
    mb.close()
    const first = (await mb.stream[Symbol.asyncIterator]().next()).value
    expect(first.type).toBe('user')
    expect(first.message.role).toBe('user')
    expect(first.message.content).toBe('hello')
    expect(first.parent_tool_use_id).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/main/services/skillImprover/mailbox.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the mailbox**

Create `src/main/services/skillImprover/mailbox.ts`:

```ts
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'

export interface Mailbox {
  stream: AsyncIterable<SDKUserMessage>
  push: (text: string) => void
  close: () => void
}

function userMessage(text: string): SDKUserMessage {
  return {
    type: 'user',
    message: { role: 'user', content: text },
    parent_tool_use_id: null,
  }
}

// A single-consumer async queue used as the SDK's streaming-input `prompt`.
// Yields the initial message immediately, then yields each pushed reply as it
// arrives (awaiting when empty), and ends the iteration when close() is called.
export function createMailbox(initial: string): Mailbox {
  const queue: SDKUserMessage[] = [userMessage(initial)]
  let closed = false
  // Resolver for a consumer currently parked on an empty queue.
  let wake: (() => void) | null = null

  function signal() {
    if (wake) {
      const w = wake
      wake = null
      w()
    }
  }

  async function* gen(): AsyncGenerator<SDKUserMessage> {
    while (true) {
      if (queue.length > 0) {
        yield queue.shift() as SDKUserMessage
        continue
      }
      if (closed) return
      await new Promise<void>((resolve) => {
        wake = resolve
      })
    }
  }

  return {
    stream: gen(),
    push: (text: string) => {
      if (closed) return
      queue.push(userMessage(text))
      signal()
    },
    close: () => {
      closed = true
      signal()
    },
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/main/services/skillImprover/mailbox.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/skillImprover/mailbox.ts src/main/services/skillImprover/mailbox.test.ts
git commit -m "feat(improver): add streaming-input mailbox queue

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task B6: the improver run service

Ties the pieces together: create session → build prompt → start SDK streaming-input query → translate SDK messages into `ImproverEvent` callbacks → expose `reply`/`accept`/`reject`/`cancel`. Not unit-tested live (consistent with `news.ts`/`claude.ts`); verified by typecheck and the end-to-end manual run in Task B11.

**Files:**
- Create: `src/main/services/skillImprover/run.ts`
- Create: `src/main/services/skillImprover/index.ts`

- [ ] **Step 1: Implement the run service**

Create `src/main/services/skillImprover/run.ts`:

```ts
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename } from 'node:path'
import type { Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { logger } from '@main/logger'
import { createMailbox, type Mailbox } from '@main/services/skillImprover/mailbox'
import { buildImproverPrompt, REPORT_SENTINEL } from '@main/services/skillImprover/prompt'
import { findSkillCreatorPath } from '@main/services/skillImprover/skillCreator'
import {
  cleanupSession,
  createSession,
  type ImproverSession,
  restoreBackup,
} from '@main/services/skillImprover/workspace'
import type { ImproverEvent } from '@shared/ipc-events'
import { parseImproverReport } from '@shared/skillImprover'

const IMPROVER_TOOLS = [
  'Task',
  'Skill',
  'Read',
  'Write',
  'Edit',
  'Bash',
  'Glob',
  'Grep',
  'TodoWrite',
  'WebSearch',
  'WebFetch',
]

// Strip metered API keys so the spawned CLI uses the user's Pro/Max OAuth.
function subscriptionEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value
  }
  delete env.ANTHROPIC_API_KEY
  delete env.ANTHROPIC_AUTH_TOKEN
  return env
}

export interface ImproverRun {
  reply: (text: string) => void
  accept: () => Promise<void>
  reject: () => Promise<void>
  cancel: () => void
  done: Promise<void>
}

export interface StartImproverOptions {
  requestId: string
  skillId: string
  model: string
  emit: (event: ImproverEvent) => void
}

// Start an interactive skill-improver session. Returns handles to feed user
// replies and to finalize (accept = keep + cleanup; reject/cancel = restore +
// cleanup). The SDK runs in streaming-input mode so the session stays open
// across turns until the mailbox is closed by accept/reject/cancel.
export function startImproverRun(opts: StartImproverOptions): ImproverRun {
  const controller = new AbortController()
  let queryRef: Query | null = null
  let mailbox: Mailbox | null = null
  let session: ImproverSession | null = null
  let sentinelSeen = false
  let textSinceTurn = ''

  // Watch streamed text for the report sentinel; on a hit, read + parse the
  // report file and emit it. Guarded so it only fires once.
  async function checkSentinel() {
    if (sentinelSeen || !session) return
    if (!textSinceTurn.includes(REPORT_SENTINEL)) return
    sentinelSeen = true
    try {
      const raw = await readFile(session.reportPath, 'utf8')
      const report = parseImproverReport(raw)
      if (report) opts.emit({ type: 'report', report })
      else opts.emit({ type: 'error', message: 'Report file was malformed' })
    } catch {
      opts.emit({ type: 'error', message: 'Report file was not found' })
    }
  }

  const done = (async (): Promise<void> => {
    const skillCreatorPath = await findSkillCreatorPath()
    if (!skillCreatorPath) {
      opts.emit({
        type: 'error',
        message: 'skill-creator plugin not found in ~/.claude/plugins',
      })
      return
    }

    session = await createSession(opts.requestId, opts.skillId)
    const prompt = buildImproverPrompt({
      skillCreatorPath,
      skillPath: session.skillPath,
      skillName: basename(session.skillPath),
      workspace: session.workspace,
      reportPath: session.reportPath,
    })

    mailbox = createMailbox(prompt)

    const { query } = await import('@anthropic-ai/claude-agent-sdk')
    const q = query({
      prompt: mailbox.stream,
      options: {
        model: opts.model,
        allowedTools: IMPROVER_TOOLS,
        permissionMode: 'bypassPermissions',
        settingSources: ['user'],
        includePartialMessages: true,
        cwd: homedir(),
        env: subscriptionEnv(),
        abortController: controller,
      },
    })
    queryRef = q

    for await (const message of q as AsyncIterable<SDKMessage>) {
      if (message.type === 'stream_event') {
        const event = message.event
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          textSinceTurn += event.delta.text
          opts.emit({ type: 'token', text: event.delta.text })
          await checkSentinel()
        }
      } else if (message.type === 'assistant') {
        // Surface tool calls as compact transcript lines.
        for (const block of message.message.content) {
          if (typeof block === 'object' && block.type === 'tool_use') {
            opts.emit({ type: 'tool', name: block.name, summary: summarizeTool(block) })
          }
        }
      } else if (message.type === 'result') {
        // End of a turn → the agent is waiting for the next user reply.
        textSinceTurn = ''
        opts.emit({ type: 'awaiting-input' })
      }
    }
  })()
    .catch((error) => {
      const message = error instanceof Error ? error.message : 'Unknown error'
      logger.error('Improver run failed', message)
      opts.emit({ type: 'error', message })
    })

  return {
    reply: (text: string) => mailbox?.push(text),
    accept: async () => {
      mailbox?.close()
      controller.abort()
      queryRef?.interrupt().catch(() => {})
      await done
      if (session) await cleanupSession(session)
      opts.emit({ type: 'done' })
    },
    reject: async () => {
      mailbox?.close()
      controller.abort()
      queryRef?.interrupt().catch(() => {})
      await done
      if (session) {
        await restoreBackup(session)
        await cleanupSession(session)
      }
      opts.emit({ type: 'aborted' })
    },
    cancel: () => {
      mailbox?.close()
      controller.abort()
      queryRef?.interrupt().catch(() => {})
      void done.then(async () => {
        if (session) {
          await restoreBackup(session)
          await cleanupSession(session)
        }
        opts.emit({ type: 'aborted' })
      })
    },
    done,
  }
}

// A short human-readable label for a tool_use block, e.g. "Bash: python -m ...".
function summarizeTool(block: { name: string; input?: unknown }): string {
  const input = block.input as Record<string, unknown> | undefined
  if (!input) return block.name
  const hint =
    (typeof input.command === 'string' && input.command) ||
    (typeof input.file_path === 'string' && input.file_path) ||
    (typeof input.description === 'string' && input.description) ||
    (typeof input.skill === 'string' && input.skill) ||
    ''
  const text = String(hint).slice(0, 80)
  return text ? `${block.name}: ${text}` : block.name
}
```

Create `src/main/services/skillImprover/index.ts`:

```ts
export { startImproverRun } from '@main/services/skillImprover/run'
export type { ImproverRun, StartImproverOptions } from '@main/services/skillImprover/run'
```

- [ ] **Step 2: Verify it typechecks**

Run: `pnpm typecheck`
Expected: PASS. If the SDK's `assistant` message content block union does not narrow on `block.type === 'tool_use'`, adjust the guard to `block.type === 'tool_use' && 'name' in block`. If `permissionMode`/`settingSources` literals are rejected, match the exact union from `news.ts` (which already compiles with the same options).

- [ ] **Step 3: Commit**

```bash
git add src/main/services/skillImprover/run.ts src/main/services/skillImprover/index.ts
git commit -m "feat(improver): interactive SDK run service

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task B7: the `skillImprover` tRPC router

**Files:**
- Create: `src/main/trpc/routers/skillImprover.ts`
- Modify: `src/main/trpc/router.ts`

- [ ] **Step 1: Implement the router**

Create `src/main/trpc/routers/skillImprover.ts`:

```ts
import { type ImproverRun, startImproverRun } from '@main/services/skillImprover'
import { getSettings } from '@main/store'
import { publicProcedure, router } from '@main/trpc/trpc'
import type { ImproverEvent } from '@shared/ipc-events'
import { DEFAULT_MODEL_ID } from '@shared/models'
import { observable } from '@trpc/server/observable'
import { z } from 'zod'

// Active runs keyed by requestId so reply/accept/reject can reach them.
const runs = new Map<string, ImproverRun>()

export const skillImproverRouter = router({
  start: publicProcedure
    .input(
      z.object({
        requestId: z.string().min(1),
        skillId: z.string().min(1),
      }),
    )
    .subscription(({ input }) =>
      observable<ImproverEvent>((emit) => {
        // Model resolved server-side from settings, mirroring the news router.
        const model = getSettings().model ?? DEFAULT_MODEL_ID
        const run = startImproverRun({
          requestId: input.requestId,
          skillId: input.skillId,
          model,
          emit: (event) => emit.next(event),
        })
        runs.set(input.requestId, run)

        run.done.finally(() => {
          // Keep the entry until accept/reject finalizes; only drop on natural end
          // if it was never finalized. Safe: accept/reject also delete below.
        })

        // Teardown on unsubscribe: if the renderer drops the subscription without
        // an explicit accept/reject (e.g. window closed), cancel + revert.
        return () => {
          const r = runs.get(input.requestId)
          if (r) {
            r.cancel()
            runs.delete(input.requestId)
          }
        }
      }),
    ),

  reply: publicProcedure
    .input(z.object({ requestId: z.string().min(1), text: z.string().min(1) }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(({ input }) => {
      const run = runs.get(input.requestId)
      run?.reply(input.text)
      return { ok: Boolean(run) }
    }),

  accept: publicProcedure
    .input(z.object({ requestId: z.string().min(1) }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(async ({ input }) => {
      const run = runs.get(input.requestId)
      if (run) {
        await run.accept()
        runs.delete(input.requestId)
      }
      return { ok: Boolean(run) }
    }),

  reject: publicProcedure
    .input(z.object({ requestId: z.string().min(1) }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(async ({ input }) => {
      const run = runs.get(input.requestId)
      if (run) {
        await run.reject()
        runs.delete(input.requestId)
      }
      return { ok: Boolean(run) }
    }),

  cancel: publicProcedure
    .input(z.object({ requestId: z.string().min(1) }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(({ input }) => {
      const run = runs.get(input.requestId)
      run?.cancel()
      runs.delete(input.requestId)
      return { ok: Boolean(run) }
    }),
})
```

- [ ] **Step 2: Register the router**

In `src/main/trpc/router.ts`, add the import (alphabetical, after `skills`):

```ts
import { skillImproverRouter } from '@main/trpc/routers/skillImprover'
```

And add it to the `router({ ... })` object after `skills: skillsRouter,`:

```ts
  skillImprover: skillImproverRouter,
```

- [ ] **Step 3: Verify it typechecks**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/main/trpc/routers/skillImprover.ts src/main/trpc/router.ts
git commit -m "feat(improver): add skillImprover tRPC router

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task B8: renderer run store

**Files:**
- Create: `src/renderer/src/store/skillImproverRun.ts`

- [ ] **Step 1: Implement the store**

Create `src/renderer/src/store/skillImproverRun.ts`:

```ts
import type { ImproverReport } from '@shared/skillImprover'
import { create } from 'zustand'

export interface TranscriptEntry {
  kind: 'assistant' | 'tool' | 'user'
  text: string
}

// Improver-run state lives OUTSIDE the Skills page so a session survives tab
// switches. The subscription is hosted at the App level (SkillImproverHost);
// the page only reads/writes this store.
interface ImproverRunState {
  running: boolean
  requestId: string | null
  skillId: string | null
  transcript: TranscriptEntry[]
  streaming: string // text accumulating for the in-progress assistant turn
  awaitingInput: boolean
  report: ImproverReport | null
  status: 'idle' | 'running' | 'reviewing' | 'done' | 'error' | 'aborted'

  start: (skillId: string) => void
  appendToken: (text: string) => void
  pushTool: (summary: string) => void
  pushUserReply: (text: string) => void
  flushTurn: () => void
  setAwaiting: (v: boolean) => void
  setReport: (report: ImproverReport) => void
  finish: (status: 'done' | 'error' | 'aborted') => void
  reset: () => void
}

export const useSkillImproverRun = create<ImproverRunState>((set) => ({
  running: false,
  requestId: null,
  skillId: null,
  transcript: [],
  streaming: '',
  awaitingInput: false,
  report: null,
  status: 'idle',

  start: (skillId) =>
    set({
      running: true,
      requestId: crypto.randomUUID(),
      skillId,
      transcript: [],
      streaming: '',
      awaitingInput: false,
      report: null,
      status: 'running',
    }),

  appendToken: (text) => set((s) => ({ streaming: s.streaming + text, awaitingInput: false })),

  // Commit the streamed assistant text as a transcript entry (called at turn end).
  flushTurn: () =>
    set((s) =>
      s.streaming.trim()
        ? {
            transcript: [...s.transcript, { kind: 'assistant', text: s.streaming }],
            streaming: '',
          }
        : { streaming: '' },
    ),

  pushTool: (summary) =>
    set((s) => ({ transcript: [...s.transcript, { kind: 'tool', text: summary }] })),

  pushUserReply: (text) =>
    set((s) => ({
      transcript: [...s.transcript, { kind: 'user', text }],
      awaitingInput: false,
    })),

  setAwaiting: (v) => set({ awaitingInput: v }),

  setReport: (report) => set({ report, status: 'reviewing' }),

  finish: (status) => set({ running: false, awaitingInput: false, status }),

  reset: () =>
    set({
      running: false,
      requestId: null,
      skillId: null,
      transcript: [],
      streaming: '',
      awaitingInput: false,
      report: null,
      status: 'idle',
    }),
}))
```

- [ ] **Step 2: Verify it typechecks**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/store/skillImproverRun.ts
git commit -m "feat(improver): add renderer run store

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task B9: always-mounted subscription host

**Files:**
- Create: `src/renderer/src/components/SkillImproverHost.tsx`
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Implement the host**

Create `src/renderer/src/components/SkillImproverHost.tsx`:

```tsx
import { trpc } from '@renderer/lib/trpc'
import { useSkillImproverRun } from '@renderer/store/skillImproverRun'
import { skipToken } from '@tanstack/react-query'
import { useMemo } from 'react'
import { toast } from 'sonner'

// Always-mounted host for the skill-improver subscription. Living above the page
// switch in App means leaving the SKILLS tab does not unsubscribe → the session
// keeps going. Renders nothing. The model is resolved server-side (settings), so
// the subscription input only needs the run identity.
export function SkillImproverHost() {
  const utils = trpc.useUtils()
  const running = useSkillImproverRun((s) => s.running)
  const requestId = useSkillImproverRun((s) => s.requestId)
  const skillId = useSkillImproverRun((s) => s.skillId)
  const appendToken = useSkillImproverRun((s) => s.appendToken)
  const flushTurn = useSkillImproverRun((s) => s.flushTurn)
  const pushTool = useSkillImproverRun((s) => s.pushTool)
  const setAwaiting = useSkillImproverRun((s) => s.setAwaiting)
  const setReport = useSkillImproverRun((s) => s.setReport)
  const finish = useSkillImproverRun((s) => s.finish)

  const subInput = useMemo(
    () => (running && requestId && skillId ? { requestId, skillId } : skipToken),
    [running, requestId, skillId],
  )

  trpc.skillImprover.start.useSubscription(subInput, {
    onData: (event) => {
      switch (event.type) {
        case 'token':
          appendToken(event.text)
          break
        case 'tool':
          pushTool(event.summary)
          break
        case 'awaiting-input':
          flushTurn()
          setAwaiting(true)
          break
        case 'report':
          flushTurn()
          setReport(event.report)
          break
        case 'done':
          finish('done')
          void utils.skills.list.invalidate()
          if (skillId) void utils.skills.getRaw.invalidate({ id: skillId })
          toast.success('Skill improvement applied')
          break
        case 'error':
          finish('error')
          toast.error(event.message)
          break
        case 'aborted':
          finish('aborted')
          if (skillId) void utils.skills.getRaw.invalidate({ id: skillId })
          toast('Skill improvement reverted')
          break
      }
    },
    onError: (error) => {
      finish('error')
      toast.error(error.message)
    },
  })

  return null
}
```

- [ ] **Step 2: Mount the host in App**

In `src/renderer/src/App.tsx`, add the import next to the other hosts:

```ts
import { SkillImproverHost } from '@renderer/components/SkillImproverHost'
```

And mount it next to `<NewsRunHost />`:

```tsx
      <NewsRunHost />
      <TrendingRunHost />
      <SkillImproverHost />
```

- [ ] **Step 3: Verify it typechecks**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/SkillImproverHost.tsx src/renderer/src/App.tsx
git commit -m "feat(improver): always-mounted subscription host

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task B10: the improver report view component

**Files:**
- Create: `src/renderer/src/components/ImproverReportView.tsx`

- [ ] **Step 1: Implement the report view**

Create `src/renderer/src/components/ImproverReportView.tsx`:

```tsx
import type { ImproverReport } from '@shared/skillImprover'

function pct(v: number | undefined): string {
  return v === undefined ? '—' : `${Math.round(v * 100)}%`
}
function num(v: number | undefined): string {
  return v === undefined ? '—' : v.toLocaleString('en-US')
}
function secs(v: number | undefined): string {
  return v === undefined ? '—' : `${(v / 1000).toFixed(1)}s`
}

const cell = { padding: '4px 10px', borderBottom: '1px solid var(--line-dim)' } as const
const th = { ...cell, color: 'var(--fg-4)', textAlign: 'left' as const, fontWeight: 400 }

// Native render of the final A/B report: per-version benchmark table, per-eval
// breakdown, before/after description, and the analyst's prose summary.
export function ImproverReportView({ report }: { report: ImproverReport }) {
  const evalNames = [
    ...new Set(report.iterations.flatMap((it) => (it.perEval ?? []).map((e) => e.name))),
  ]

  function label(n: number): string {
    return n === 0 ? 'baseline' : `iter ${n}`
  }

  return (
    <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--fg-2)' }}>
      <div style={{ color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: 11, marginBottom: 8 }}>
        A/B report · {report.skillName}
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16 }}>
        <thead>
          <tr>
            <th style={th}>version</th>
            <th style={th}>pass rate</th>
            <th style={th}>tokens</th>
            <th style={th}>time</th>
          </tr>
        </thead>
        <tbody>
          {report.iterations.map((it) => (
            <tr key={it.n}>
              <td style={{ ...cell, color: it.n === 0 ? 'var(--fg-4)' : 'var(--amber)' }}>
                {label(it.n)}
              </td>
              <td style={cell}>{pct(it.passRate)}</td>
              <td style={cell}>{num(it.tokens)}</td>
              <td style={cell}>{secs(it.durationMs)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {evalNames.length > 0 ? (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16 }}>
          <thead>
            <tr>
              <th style={th}>eval</th>
              {report.iterations.map((it) => (
                <th key={it.n} style={th}>
                  {label(it.n)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {evalNames.map((name) => (
              <tr key={name}>
                <td style={cell}>{name}</td>
                {report.iterations.map((it) => {
                  const e = (it.perEval ?? []).find((x) => x.name === name)
                  return (
                    <td key={it.n} style={cell} title={e?.notes ?? ''}>
                      {e === undefined ? '—' : e.passed ? '✓' : '✗'}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {report.beforeDescription || report.afterDescription ? (
        <div style={{ marginBottom: 16 }}>
          <div style={{ color: 'var(--fg-4)', marginBottom: 4 }}>description</div>
          {report.beforeDescription ? (
            <div style={{ color: 'var(--fg-4)', textDecoration: 'line-through', marginBottom: 4 }}>
              {report.beforeDescription}
            </div>
          ) : null}
          {report.afterDescription ? (
            <div style={{ color: 'var(--amber)' }}>{report.afterDescription}</div>
          ) : null}
        </div>
      ) : null}

      {report.diffSummary ? (
        <div style={{ marginBottom: 16 }}>
          <div style={{ color: 'var(--fg-4)', marginBottom: 4 }}>changes</div>
          <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{report.diffSummary}</div>
        </div>
      ) : null}

      {report.analystSummary ? (
        <div>
          <div style={{ color: 'var(--fg-4)', marginBottom: 4 }}>analysis</div>
          <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{report.analystSummary}</div>
        </div>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/ImproverReportView.tsx
git commit -m "feat(improver): native A/B report view component

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task B11: improver overlay + wire up the Improve button

Add the overlay UI to the Skills page and enable the Improve button. The overlay shows the transcript, a reply box (enabled on `awaiting-input`), a Stop button while running, and the report + Accept/Reject once `reviewing`.

**Files:**
- Modify: `src/renderer/src/pages/Skills.tsx`
- Modify: `src/renderer/src/index.css`

- [ ] **Step 1: Add overlay CSS**

Append to `src/renderer/src/index.css`:

```css
/* Skill-improver overlay: covers the right-pane area while a session runs. */
.improver {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.improver-transcript {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 16px 18px;
  font-family: var(--mono);
  font-size: 12px;
  line-height: 1.6;
}
.improver-entry {
  margin-bottom: 12px;
  white-space: pre-wrap;
}
.improver-entry.tool {
  color: var(--fg-4);
}
.improver-entry.user {
  color: var(--amber);
}
.improver-entry.user::before {
  content: '› ';
}
.improver-foot {
  border-top: 1px solid var(--line-dim);
  padding: 10px 14px;
  display: flex;
  gap: 8px;
  align-items: center;
}
.improver-foot .input {
  flex: 1;
}
```

- [ ] **Step 2: Add the overlay component to Skills.tsx**

In `src/renderer/src/pages/Skills.tsx`, add imports:

```ts
import { ImproverReportView } from '@renderer/components/ImproverReportView'
import { useSkillImproverRun } from '@renderer/store/skillImproverRun'
```

Add this component above `export function Skills`:

```tsx
function ImproverOverlay({ skillId }: { skillId: string }) {
  const run = useSkillImproverRun()
  const reply = trpc.skillImprover.reply.useMutation()
  const accept = trpc.skillImprover.accept.useMutation()
  const reject = trpc.skillImprover.reject.useMutation()
  const cancel = trpc.skillImprover.cancel.useMutation()
  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  // Keep the transcript pinned to the latest output.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [run.transcript, run.streaming, run.report])

  function send() {
    const text = draft.trim()
    if (!text || !run.requestId) return
    run.pushUserReply(text)
    reply.mutate({ requestId: run.requestId, text })
    setDraft('')
  }

  return (
    <div className="split-pane">
      <div className="pane-head">
        <span className="ttl">improver · {skillId}</span>
        <span className="meta">
          {run.status === 'reviewing' ? 'awaiting your decision' : run.status}
        </span>
      </div>
      <div className="improver">
        <div className="improver-transcript" ref={scrollRef}>
          {run.transcript.map((e, i) => (
            <div key={i} className={`improver-entry ${e.kind}`}>
              {e.kind === 'tool' ? `⚙ ${e.text}` : e.text}
            </div>
          ))}
          {run.streaming ? <div className="improver-entry">{run.streaming}</div> : null}
          {run.report ? (
            <div style={{ marginTop: 16 }}>
              <ImproverReportView report={run.report} />
            </div>
          ) : null}
        </div>

        {run.status === 'reviewing' ? (
          <div className="improver-foot">
            <button
              type="button"
              className="btn"
              disabled={accept.isPending || reject.isPending || !run.requestId}
              onClick={() => run.requestId && accept.mutate({ requestId: run.requestId })}
            >
              Accept
            </button>
            <button
              type="button"
              className="btn"
              disabled={accept.isPending || reject.isPending || !run.requestId}
              onClick={() => run.requestId && reject.mutate({ requestId: run.requestId })}
            >
              Reject
            </button>
          </div>
        ) : run.running ? (
          <div className="improver-foot">
            <input
              className="input"
              placeholder={run.awaitingInput ? 'Type your reply…' : 'thinking…'}
              disabled={!run.awaitingInput}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send()
                }
              }}
            />
            <button type="button" className="btn" disabled={!run.awaitingInput} onClick={send}>
              Send
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => run.requestId && cancel.mutate({ requestId: run.requestId })}
            >
              Stop
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Enable the Improve button + render the overlay**

In `SkillEditorPane`, replace the disabled Improve button:

```tsx
              <button type="button" className="btn" disabled title="Coming in Phase B">
                <Sparkles style={{ width: 11, height: 11 }} /> Improve
              </button>
```

with a wired one. First add to `SkillEditorPane`'s body (near the top, after the hooks):

```ts
  const improver = useSkillImproverRun()
  function startImprove() {
    if (improver.running) {
      toast.error('An improvement is already running')
      return
    }
    improver.start(skillId)
  }
```

Then the button:

```tsx
              <button type="button" className="btn" onClick={startImprove}>
                <Sparkles style={{ width: 11, height: 11 }} /> Improve
              </button>
```

In `export function Skills()`, render the overlay instead of the editor when a session targets the selected skill. Replace the right-pane block from Task A5 step 2 with:

```tsx
        {/* RIGHT: editor + preview, or the improver overlay when active here */}
        {selectedId ? (
          <SelectedRight selectedId={selectedId} />
        ) : (
          <div className="split-pane">
            <div className="pane-head">
              <span className="ttl">editor · preview</span>
              <span className="meta">no selection</span>
            </div>
            <div className="pane-body">
              <div style={{ ...hintStyle, padding: '20px 24px' }}>
                {'// select a skill to edit its SKILL.md'}
              </div>
            </div>
          </div>
        )}
```

And add this small selector component above `export function Skills` (it picks overlay vs editor based on the store, and resets a finished session when you navigate away from its skill):

```tsx
function SelectedRight({ selectedId }: { selectedId: string }) {
  const status = useSkillImproverRun((s) => s.status)
  const runSkillId = useSkillImproverRun((s) => s.skillId)
  const reset = useSkillImproverRun((s) => s.reset)

  // Show the overlay only for the skill the session belongs to.
  const activeHere =
    runSkillId === selectedId && status !== 'idle'

  // Once a session for this skill has ended (done/error/aborted) and the user is
  // looking at it, clear it so the editor returns on next interaction.
  useEffect(() => {
    if (runSkillId === selectedId && (status === 'done' || status === 'aborted')) {
      // leave the report visible until the user selects another skill, then reset
    }
  }, [runSkillId, selectedId, status])

  if (activeHere && (status === 'running' || status === 'reviewing')) {
    return <ImproverOverlay skillId={selectedId} />
  }
  // Finished session: offer the editor again; reset stale terminal state.
  if (runSkillId === selectedId && (status === 'done' || status === 'error' || status === 'aborted')) {
    reset()
  }
  return <SkillEditorPane key={selectedId} skillId={selectedId} />
}
```

- [ ] **Step 4: Verify it typechecks**

Run: `pnpm typecheck`
Expected: PASS. Resolve any unused-variable warnings (e.g. remove the empty `useEffect` if Biome flags it).

Run: `pnpm lint`
Expected: PASS (no errors). Fix anything Biome reports.

- [ ] **Step 5: End-to-end manual verification**

Run: `pnpm dev`

Then:
1. Select a skill, click **Improve**. The overlay replaces the editor; the transcript streams the agent reading the skill and posting a plan/questions.
2. When the reply box enables ("Type your reply…"), answer a question (e.g. "yes, go ahead, keep it short"). Confirm your reply appears as a `›` line and the agent continues.
3. Let it run to completion (this is a real, possibly multi-minute session). Confirm the report renders (benchmark table + per-eval + summary) and Accept/Reject appear.
4. Click **Reject**. Confirm the toast "Skill improvement reverted", and that the skill's SKILL.md is unchanged (open the editor — content matches the original).
5. Run Improve again and click **Accept** at the report. Confirm "Skill improvement applied" and that the editor now shows the improved content.
6. Verify temp cleanup: `ls /tmp | grep atlas-improver` should show nothing left after accept/reject.
7. Switch tabs mid-run (e.g. to Dashboard and back) and confirm the session keeps streaming (host stays mounted).

Close with Ctrl+C.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/pages/Skills.tsx src/renderer/src/index.css
git commit -m "feat(improver): overlay UI + wire up Improve button

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task B12: full verification pass + finish the branch

**Files:** none (verification only)

- [ ] **Step 1: Run the full suite**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: all PASS.

- [ ] **Step 2: Review the diff against the spec**

Run: `git log --oneline main..HEAD`
Confirm every spec requirement maps to a commit (editor split, live preview, Cmd+S save, interactive improver, auto-apply + revert, full report, temp cleanup).

- [ ] **Step 3: Finish the branch**

Use the `superpowers:finishing-a-development-branch` skill to decide how to integrate (per the project's local fast-forward merge workflow; do NOT push — the user pushes himself).

---

# Self-Review (completed by plan author)

**Spec coverage:**
- Editor + preview split (side-by-side, vertical divider, shared scroll, collapsible) → A4, A5. ✓
- Live preview from buffer → A3 (`splitFrontmatter`), A5 (`parseToolsFromFrontmatter` + render). ✓
- Cmd+S + Save button + dirty indicator → A5. ✓
- Raw read/write backend → A1, A2. ✓
- Interactive improver session (streaming input, bypass perms) → B5 (mailbox), B6 (run). ✓
- skill-creator path resolution → B3. ✓
- Wrapper prompt (no browser, JSON report, sentinel, confine temp, apply in place) → B2. ✓
- Backup / auto-apply / revert / cleanup → B4, B6, B7. ✓
- ImproverEvent stream + router (start/reply/accept/reject/cancel) → B1, B6, B7. ✓
- Renderer store + always-mounted host (survives tab switch) → B8, B9. ✓
- Full A/B report view → B1 (schema), B10 (view), B11 (render in overlay). ✓
- Overlay UI (transcript + reply box + Stop) → B11. ✓
- English UI strings, mono/token styling, mt-* trap avoided (new class names) → A4, B11. ✓
- Tests for pure pieces (prompt, backup/restore/cleanup, report parse, mailbox, splitFrontmatter, raw read/write) → A1, A3, B1, B2, B3, B4, B5. ✓

**Known limitation (from spec):** app closed mid-run leaves an orphan workspace + possibly half-applied skill; startup sweep is out of scope. Documented, not implemented — intentional.

**Type consistency:** `ImproverSession` fields (`skillPath`, `skillFile`, `workspace`, `backupFile`, `reportPath`) are used identically in B4/B6. `ImproverEvent` variants match between B1 (definition), B6 (emit), B9 (consume). `ImproverReport` shape matches between B1 (schema), B10 (view). Store actions in B8 match their calls in B9/B11. Router procedure names (`start`/`reply`/`accept`/`reject`/`cancel`) match between B7 and B9/B11.

**Resolved during planning (verified against the codebase):** the CSS file is `src/renderer/src/index.css` (not `assets/`); `.btn`/`.input` already exist in `@layer components`; the model is resolved server-side from settings via `getSettings().model ?? DEFAULT_MODEL_ID` (mirroring the news router), so the renderer needs no model selector.

**Open verification point flagged inline for the implementer:** the SDK `assistant` content-block narrowing on `block.type === 'tool_use'` (B6 step 2) — has a concrete fallback if the union does not narrow.
