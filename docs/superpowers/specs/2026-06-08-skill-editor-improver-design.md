# Skill Editor + Improver — Design

**Date:** 2026-06-08
**Status:** Approved for planning
**Page:** Skills (`src/renderer/src/pages/Skills.tsx`)

## Problem

The Skills tab currently shows a read-only rendered preview of each skill's
`SKILL.md`. Users want to (1) edit a skill's source in place and (2) run an
AI-driven "improver" that wraps the `skill-creator` skill to iteratively improve
a selected skill, surfacing a full A/B benchmark report inside Atlas.

## Decisions (locked)

- **Improver mode:** interactive — a two-way streaming session. The agent
  streams output and asks clarifying questions; the user answers in-app and the
  reply is fed back into the same SDK session.
- **Applying the result:** auto-apply + revert. The agent edits the real
  `SKILL.md` in place during the session; the original is backed up first.
  Accept keeps it and deletes temp files; Reject/Cancel restores the backup and
  deletes temp files.
- **Editor scope:** `SKILL.md` only (the whole raw file, frontmatter + body).
- **Report depth:** full — per-version benchmark table, per-eval breakdown,
  before/after `SKILL.md` diff, analyst summary.
- **Layout:** editor and preview side by side, divided by a **vertical**
  separator, sharing **one** scrollbar. Each column is collapsible; collapsing
  one gives its width to the other.

## Scope: two phases, one spec

Phase A and Phase B are nearly independent. Phase A is the foundation (the
right-pane layout that hosts the Improve button) and ships value on its own.
Implement and commit them separately.

- **Phase A — Editor + Preview split** (no SDK).
- **Phase B — Skill Improver** (interactive SDK session + report + apply/revert).

---

## Phase A — Editor + Preview split

### Layout

The right pane changes from a single rendered preview to a two-column split:

```
┌─ right pane ───────────────────────────────────────────────┐
│ EDITOR · SKILL.md   ● [Save ⌘S] [✦ Improve]  │  PREVIEW     │  ← headers
│ ┌───────────────────────────────┬────────────────────────┐ │
│ │ raw SKILL.md (mono, auto-grow)│ tools chips + rendered  │ │
│ │                               │ markdown                │ │
│ └───────────────────────────────┴────────────────────────┘ │
│   one shared scrollbar scrolls both columns together        │
└─────────────────────────────────────────────────────────────┘
```

- **Side-by-side, vertical divider, shared scroll.** The outer right-pane
  container is the scroll container. The editor `<textarea>` auto-grows to its
  content height (no internal scrollbar); the preview renders at full height.
  Both sit in a 2-column grid so they scroll together under one scrollbar.
- **Collapsible columns.** Each column header has a chevron toggle. When a
  column is collapsed, the grid becomes single-column and the other expands to
  full width. On small screens the user collapses one to reclaim space.
- The editor holds the **entire raw `SKILL.md`** (frontmatter + body), because
  that is what is written to disk and lets the user edit `description`/tools.

### Live preview

The preview is driven by the **local editor buffer**, not the server query, so
it updates immediately on every keystroke:

- Split the buffer on the leading `---` frontmatter fence on the client (reuse
  the same regex shape as `parseFrontmatter` in `skills.ts`).
- Render the body with the existing `Markdown` + `remarkGfm` +
  `formatSkillMarkdown` path.
- Derive the tools chips from the parsed frontmatter `allowed-tools` live.

### Save

- **Cmd+S** (keydown handler on the editor region, `preventDefault`) and a
  **Save** button in the editor header trigger the same save.
- A dirty indicator `●` shows unsaved changes; Save is disabled when not dirty.
- On success: invalidate `skills.list` and `skills.get` (name/description may
  have changed), clear dirty, toast confirmation.
- Switching the selected skill with unsaved changes: keep it simple — the buffer
  is keyed by skill id; selecting another skill loads its content. (No
  cross-skill unsaved-changes guard in this phase; note as possible extension.)

### Backend (Phase A)

- `src/main/services/skills.ts`:
  - `readSkillRaw(id, dir?)` → the whole raw `SKILL.md` string (reuses
    `assertSafeId`).
  - `writeSkill(id, content, dir?)` → writes the raw string to
    `<dir>/<id>/SKILL.md` after `assertSafeId` and confirming the resolved path
    stays inside `SKILLS_DIR`.
- `src/main/trpc/routers/skills.ts`:
  - `getRaw` query: input `{ id }` → `{ content: string }`.
  - `save` mutation: input `{ id, content }` → `{ ok: true }`.

### Tests (Phase A)

- `writeSkill` then `readSkillRaw` round-trips content in a tmp dir.
- `writeSkill`/`readSkillRaw` reject traversal ids (`../`, absolute, slashes).

---

## Phase B — Skill Improver

### Overview

Clicking **✦ Improve** on the selected skill opens an improver overlay over the
right-pane area and starts an interactive `skill-creator` session targeting that
skill. The agent runs the draft → test → A/B → improve loop, asking the user
questions in-app, editing the real `SKILL.md` in place (with a backup), and
finishing by writing a structured report that Atlas renders natively. The user
then Accepts (keep) or Rejects (revert).

### Service: `src/main/services/skillImprover.ts`

Manages one interactive session at a time, keyed by `requestId`.

- **Wrapper prompt** instructs the model to:
  - Follow the `skill-creator` process. Reference its `SKILL.md` by **absolute
    path** (resolved from the plugin cache) so it does not depend on fragile
    plugin slash-command discovery.
  - Improve the target skill at `<skillPath>`.
  - **Not open browser viewers.** Where the skill-creator process would run
    `generate_review.py`, instead write `benchmark.json` into `<workspace>` and
    post a concise summary into the chat.
  - Ask clarifying questions directly in the chat; the user will answer inline.
  - Keep all working files under `<workspace>` (a temp dir Atlas controls), not
    a sibling of the skill dir.
  - At the very end, write a final structured report as JSON to `<reportPath>`
    matching the agreed schema, and apply the improved `SKILL.md` in place.
- **Streaming input (mailbox).** The SDK `query()` is called with an
  `AsyncIterable<SDKUserMessage>` prompt. A mailbox async generator yields the
  initial wrapper message, then awaits user replies pushed via the `reply`
  mutation and yields them as subsequent user messages. A per-turn `result`
  message from the SDK signals "turn complete → agent awaiting input".
- **Backup + auto-apply.** At session start, copy the target `SKILL.md` to
  `<workspace>/backup/SKILL.md`. The agent edits the real file during the run.
  - **Accept:** delete `<workspace>` (incl. backup).
  - **Reject / Cancel:** copy backup back over `SKILL.md`, then delete
    `<workspace>`.
- **SDK options:** `allowedTools: [Skill, Read, Write, Edit, Bash, Glob, Grep,
  TodoWrite, WebSearch, WebFetch]`, `permissionMode: 'bypassPermissions'` (the
  user is in the loop only for the agent's substantive questions, not for
  tool-permission prompts — mirrors `news.ts`), `settingSources: ['user']`,
  `includePartialMessages: true`, `cwd: homedir()`, `env: subscriptionEnv()`,
  `abortController`.
- Single active run guard (mirrors the news run pattern).

### Events: `ImproverEvent` (in `src/shared/ipc-events.ts`)

- `{ type: 'token'; text }` — streamed assistant text delta.
- `{ type: 'tool'; name; summary }` — compact tool-use line for the transcript.
- `{ type: 'awaiting-input' }` — turn complete; enable the reply box.
- `{ type: 'report'; report }` — parsed final structured report.
- `{ type: 'done' }`
- `{ type: 'error'; message }`
- `{ type: 'aborted' }`

### Router: `src/main/trpc/routers/skillImprover.ts`

- `start` subscription: input `{ requestId, skillId }` → `ImproverEvent` stream.
- `reply` mutation: input `{ requestId, text }` → pushes into the mailbox.
- `accept` mutation: input `{ requestId }` → cleanup temp, keep new `SKILL.md`.
- `reject` mutation: input `{ requestId }` → restore backup, cleanup temp.
- `cancel` mutation: input `{ requestId }` → abort run (treated as reject:
  restore backup + cleanup).

### Report schema: `improverReportSchema` (zod)

Fields are mostly optional — the model generates the JSON, so validate loosely
and degrade gracefully in the UI:

```
skillName: string
iterations: Array<{
  n: number
  passRate?: number
  tokens?: number
  durationMs?: number
  perEval?: Array<{ name: string; passed: boolean; notes?: string }>
}>
beforeDescription?: string
afterDescription?: string
diffSummary?: string      // human-readable summary of SKILL.md changes
analystSummary?: string   // why the new version is better
```

Lives in `src/shared/skillImprover.ts` (schema + `ImproverReport` type), to keep
`shared/skills.ts` focused.

### Renderer

- **Store** `src/renderer/src/store/skillImproverRun.ts` (zustand, mirrors
  `newsRun`): `running, requestId, skillId, transcript[], awaitingInput, report,
  status`, plus actions (`start`, `appendToken`, `pushTool`, `setAwaiting`,
  `setReport`, `finish`).
- **Host** `src/renderer/src/components/SkillImproverHost.tsx` (mirrors
  `NewsRunHost`): always mounted above the page switch so leaving the Skills tab
  does not unsubscribe / kill the session. Subscribes to `start` while running,
  routes events into the store, fires toasts on done/error/aborted.
- **Overlay** on the Skills page, shown when a run is active for the selected
  skill: a streamed transcript (assistant text + compact tool-use lines), a
  reply input enabled on `awaiting-input` (otherwise shows "thinking…"), a Stop
  button, and — once the report arrives — the full report view with Accept /
  Reject buttons.

### Full report view

Rendered natively from the JSON report:

- **Benchmark table:** one row per version (baseline → iteration-N) with
  pass-rate, tokens, time.
- **Per-eval breakdown:** per test case, pass/fail per version with notes.
- **Diff:** before/after `SKILL.md` (from the backup vs the current file, or
  `diffSummary` text when a full diff is unavailable).
- **Analyst summary:** the model's prose on why the new version is better.

### Error handling / edge cases

- Save errors (path/write) → toast.
- Improver stream error → toast + status. Cancel = treated as Reject (restore
  backup, cleanup).
- One improver run at a time.
- **Known limitation:** if the app is closed mid-run, the temp workspace and
  backup remain and the skill may be partially modified. A startup orphan sweep
  is out of scope (possible extension).
- All UI strings are **English**; only generated content may be non-English.
- Honor the Tailwind `@layer` `mt-*` trap and spacing standards (20px top, 60px
  bottom), mono fonts, and `var(--*)` tokens.

### Tests (Phase B)

Pure pieces only (the live SDK call is not unit-tested, consistent with
`news.ts`/`claude.ts`):

- Wrapper-prompt construction (contains skill path, workspace, report path,
  no-browser instruction).
- Backup → edit → restore and backup → accept → cleanup on a tmp fs.
- Report JSON parsing/validation (valid, partial, malformed).
- Mailbox generator: yields initial message, then yields pushed replies in
  order, completes on close.
