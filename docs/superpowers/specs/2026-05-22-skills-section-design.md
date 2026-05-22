# Skills Section — Design

**Date:** 2026-05-22
**Status:** Approved (pending implementation)

## Goal

Add a new navigable section to atlas-os that lists all skills installed in the
user's **global** `~/.claude/skills` folder. Each skill is read from disk and
shown with its metadata; clicking a skill renders its full `SKILL.md` inside the
app.

Plugin-provided skills (installed under `~/.claude/plugins/`) are **not** shown.

## Data source

- Skills live at `~/.claude/skills/<id>/SKILL.md`.
- `<id>` is the folder name.
- A directory is treated as a skill **only if it contains a `SKILL.md` file**.
  This naturally drops eval/workspace directories such as
  `daily-ai-news-workspace` and `git-commit-message-workspace`, which contain
  no `SKILL.md`.
- Plugin skills are excluded **by construction**: we only ever read
  `~/.claude/skills`, never `~/.claude/plugins`.

### SKILL.md frontmatter

YAML frontmatter delimited by `---` … `---`. Fields used:

| Field           | Notes                                                         |
| --------------- | ------------------------------------------------------------- |
| `name`          | Display name. Falls back to folder `id` if missing.           |
| `description`   | May be a folded multi-line scalar (`>`), quoted, or plain.    |
| `trigger`       | Optional (e.g. `/graphify`).                                  |
| `argument-hint` | Optional.                                                     |
| `allowed-tools` | Optional list; we surface a **count**.                        |

Folded scalars and quoting are why we parse with a real YAML library rather than
hand-rolling.

## Architecture

Follows existing atlas-os patterns: Zustand store-based section switching, a
tRPC router over the custom IPC transport, a main-process service for disk I/O,
shared Zod-validated types.

### New dependencies

- `js-yaml` + `@types/js-yaml` — main process, parse SKILL.md frontmatter.
- `react-markdown` + `remark-gfm` — renderer, render SKILL.md body (GFM tables,
  code blocks, etc.).

### Shared types — `src/shared/skills.ts`

```ts
export interface SkillMeta {
  id: string                // folder name
  name: string              // frontmatter `name`, fallback to id
  description: string       // frontmatter `description`, '' if absent
  trigger?: string          // frontmatter `trigger`
  argumentHint?: string     // frontmatter `argument-hint`
  allowedToolsCount: number // length of frontmatter `allowed-tools`, 0 if absent
  path: string              // absolute path to the skill directory
}

export interface SkillDetail {
  meta: SkillMeta
  content: string           // markdown body, frontmatter stripped
}
```

Plus matching Zod schemas (`skillMetaSchema`, `skillDetailSchema`) for tRPC
`.output(...)` validation.

### Service — `src/main/services/skills.ts`

```ts
const SKILLS_DIR = path.join(os.homedir(), '.claude', 'skills')

listSkills(): Promise<SkillMeta[]>
readSkill(id: string): Promise<SkillDetail>
```

- `listSkills`:
  - `fs.readdir(SKILLS_DIR, { withFileTypes: true })`; if the directory does not
    exist, return `[]` (do not throw).
  - Keep entries that are directories **and** contain a readable `SKILL.md`.
  - Parse frontmatter with `js-yaml`. If a single skill's frontmatter fails to
    parse, **skip that skill** (log via electron-log) rather than failing the
    whole list.
  - Map to `SkillMeta`; `name` falls back to `id`; `allowedToolsCount` from the
    `allowed-tools` array length.
  - Sort by `name` (case-insensitive).
- `readSkill(id)`:
  - **Path-traversal guard**: reject any `id` containing `/`, `\`, or `..`, or
    where the resolved path is not a direct child of `SKILLS_DIR`. Throw a tRPC
    error on violation.
  - Read `SKILL.md`, split frontmatter from body, return `{ meta, content }`
    where `content` is the markdown after the closing `---`.

Frontmatter splitting helper is shared between `listSkills` and `readSkill`
(single source of truth for the `---` delimiter logic).

### Router — `src/main/trpc/routers/skills.ts`

```ts
export const skillsRouter = router({
  list: publicProcedure
    .output(z.array(skillMetaSchema))
    .query(() => listSkills()),

  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .output(skillDetailSchema)
    .query(({ input }) => readSkill(input.id)),
})
```

Register in `src/main/trpc/router.ts`:

```ts
export const appRouter = router({
  health: healthRouter,
  settings: settingsRouter,
  agent: agentRouter,
  stats: statsRouter,
  skills: skillsRouter, // new
})
```

### Renderer

- `src/renderer/src/store/ui.ts` — add `'skills'` to the `Section` union.
- `src/renderer/src/components/layout/Sidebar.tsx` — add ITEMS entry
  `{ id: 'skills', label: 'Skills', icon: Sparkles }` (lucide-react).
- `src/renderer/src/App.tsx` — add `skills: Skills` to `PAGES`.
- `src/renderer/src/pages/Skills.tsx` — **Layout A, master-detail two-pane**:
  - `PageHeader` — title `"Skills"`, description
    `"Skills in your global ~/.claude/skills folder."`. Optional action: a count
    badge (`N skills`).
  - **Left pane** (scrollable list): cards from `trpc.skills.list.useQuery()`.
    Each card shows `name`, `description`, badges for `trigger` /
    `argumentHint` when present, and an allowed-tools count
    (e.g. `3 tools`). Clicking a card sets local `selectedId` state and
    highlights the active card.
  - **Right pane** (scrollable): `trpc.skills.get.useQuery({ id: selectedId })`
    (enabled only when `selectedId` is set), body rendered with
    `react-markdown` + `remark-gfm`. Basic Tailwind styling for headings, code,
    `pre`, tables. Default state (no selection): a hint to pick a skill.
  - **States**: loading (list and detail), empty (no skills found — friendly
    message), error.

## Error handling

- Missing `~/.claude/skills` directory → empty list, no crash.
- A skill with malformed frontmatter → skipped from the list, logged.
- Invalid / traversal `id` in `get` → tRPC error surfaced as a detail-pane error.

## Testing

`src/main/services/skills.test.ts` (vitest), using a temp fixture directory:

- Parses `name` / `description` / `trigger` / `argument-hint` /
  `allowed-tools` count from frontmatter (including a folded `>` description).
- `name` falls back to folder id when frontmatter `name` is absent.
- Directories without `SKILL.md` (e.g. a `*-workspace` fixture) are excluded.
- Missing `SKILLS_DIR` → returns `[]`.
- `readSkill` rejects path-traversal ids (`..`, `/`).
- `readSkill` returns body with frontmatter stripped.

(The service should accept the skills directory path as a parameter or via an
injectable constant so tests can point it at a fixture dir.)

## Out of scope (YAGNI)

- Reveal-in-Finder / open-in-editor buttons.
- Editing or creating skills.
- Plugin skills.
- Search / filter / sorting controls.
- Syntax highlighting in the markdown viewer (plain code blocks for now).

These can be added later if wanted.
