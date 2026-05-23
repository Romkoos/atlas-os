# Complexity & Quality Metrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the constant complexity stub with a real session-level scope-based complexity metric, and define quality as `user_rating ?? 7` with a manual rating UI.

**Architecture:** Transcript parser also records files touched per turn. Ingest aggregates five "scope" counts per session and stores them on `agent_sessions`. The tRPC layer computes complexity at read time as the percentile-composite of those counts across the session corpus (so it never goes stale), and exposes per-session complexity + components. Quality lives in `agent_sessions.score` (user-set via a new mutation); aggregates use rated sessions only and impute `7` only for fallback display.

**Tech Stack:** TypeScript, Electron, Drizzle ORM + better-sqlite3, drizzle-kit migrations, tRPC v11 over Electron IPC, React + Recharts, Vitest, Biome, Playwright (`_electron`).

**Spec:** `docs/superpowers/specs/2026-05-23-complexity-quality-metrics-design.md` — read it first.

**Project test reality (important):** `better-sqlite3` is an Electron-ABI native module and **cannot load under Vitest**. So pure functions (transcript parsing, complexity math, session aggregation) are unit-tested with Vitest; DB/router/UI changes are verified with `pnpm typecheck && pnpm lint`, the existing Vitest suite, and the Electron Playwright harness in `e2e/`. This mirrors the existing codebase pattern — do not try to put DB code in Vitest.

**Commands (run from repo root `/Users/Roman.Neganov/Projects/PersonalProjects/atlas-os`):**
- One test file: `pnpm exec vitest run src/main/services/productivity/<file>.test.ts`
- All tests: `pnpm test`
- Types: `pnpm typecheck`
- Lint (autofix): `pnpm lint:fix`
- Build (needed before e2e): `pnpm build`
- E2E: `pnpm exec playwright test e2e/<file>.spec.ts`
- Generate migration after schema edits: `pnpm db:generate`

**Commit convention:** `feat(productivity): …` / `test(productivity): …` / `refactor(productivity): …`. End commit messages with the trailer:
`Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`
Do NOT use the `git-commit-message` skill (it targets the Mako repo and misfires here).

**Do not stage unrelated files.** The working tree has unrelated WIP (`src/main/services/skills.ts`, `src/renderer/src/pages/Skills.tsx`, `src/shared/skills.ts`, `src/main/services/skills.test.ts`, `src/renderer/src/components/layout/PageHeader.tsx`, `src/renderer/src/index.css`). Stage only files named in each task.

---

## File Structure

**Modify:**
- `src/main/services/productivity/transcript.ts` — add `filesTouched` to `AgentTurn` + extract file paths (Task 1)
- `src/main/services/productivity/transcript.test.ts` — file-path extraction tests (Task 1)
- `src/main/services/productivity/complexity.ts` — replace stub with pure percentile helpers (Task 2)
- `src/main/services/productivity/complexity.test.ts` — rewrite for new helpers (Task 2)
- `src/main/services/productivity/ingest.ts` — scope-count aggregation, drop self-score import, drop per-turn complexity (Task 3, Task 5)
- `src/main/services/productivity/ingest.test.ts` — update expectations (Task 3, Task 5)
- `src/main/db/schema.ts` — `filesTouched` on turns; 5 scope-count columns on sessions (Task 4)
- `src/main/trpc/routers/productivity.ts` — read-time complexity helper; wire into `overview`/`sessions`; rated-only quality + counts; `setRating` mutation (Task 6, Task 7)
- `src/renderer/src/pages/Productivity.tsx` — Avg-score "n/m rated"; Sessions complexity column + rating control (Task 8, Task 9)

**Create:**
- `drizzle/0003_*.sql` + snapshot (generated, Task 4)

---

## Task 1: Transcript — record files touched per turn

**Files:**
- Modify: `src/main/services/productivity/transcript.ts`
- Test: `src/main/services/productivity/transcript.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `src/main/services/productivity/transcript.test.ts` (create the file if it does not exist; it does exist — append a new `describe`):

```ts
describe('parseTranscriptTurns — filesTouched', () => {
  const userLine = {
    type: 'user',
    sessionId: 's1',
    cwd: '/proj',
    timestamp: '2026-05-23T10:00:00Z',
    message: { content: [{ type: 'text', text: 'do it' }] },
  }
  const assistant = (content: unknown[]) => ({
    type: 'assistant',
    message: { usage: { input_tokens: 1, output_tokens: 1 }, content },
  })

  it('collects unique file paths from Read/Edit/Write/MultiEdit/NotebookEdit', () => {
    const turns = parseTranscriptTurns([
      userLine,
      assistant([
        { type: 'tool_use', name: 'Read', input: { file_path: '/proj/a.ts' } },
        { type: 'tool_use', name: 'Edit', input: { file_path: '/proj/a.ts' } }, // dup
        { type: 'tool_use', name: 'Write', input: { file_path: '/proj/b.ts' } },
        { type: 'tool_use', name: 'NotebookEdit', input: { notebook_path: '/proj/n.ipynb' } },
        { type: 'tool_use', name: 'Bash', input: { command: 'ls' } }, // no path
      ]),
    ])
    expect(turns[0].filesTouched).toEqual(['/proj/a.ts', '/proj/b.ts', '/proj/n.ipynb'])
  })

  it('defaults filesTouched to [] when no file tools are used', () => {
    const turns = parseTranscriptTurns([
      userLine,
      assistant([{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }]),
    ])
    expect(turns[0].filesTouched).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test — expect FAIL**

Run: `pnpm exec vitest run src/main/services/productivity/transcript.test.ts`
Expected: FAIL — `filesTouched` is `undefined` / not a property.

- [ ] **Step 3: Implement**

In `src/main/services/productivity/transcript.ts`:

3a. Add the field to the interface (after `skillsUsed: string[]`):
```ts
  skillsUsed: string[]
  filesTouched: string[]
```

3b. Initialize it in the new-turn object (after `skillsUsed: [],`):
```ts
          skillsUsed: [],
          filesTouched: [],
```

3c. Extend the tool_use loop. Replace the existing block:
```ts
          const b = block as { type?: string; name?: string; input?: { skill?: string } }
          if (b?.type !== 'tool_use') continue
          if (b.name === 'Skill') {
            const skill = b.input?.skill
            if (skill && !turn.skillsUsed.includes(skill)) turn.skillsUsed.push(skill)
          } else if (b.name && !turn.toolsUsed.includes(b.name)) {
            turn.toolsUsed.push(b.name)
          }
```
with:
```ts
          const b = block as {
            type?: string
            name?: string
            input?: { skill?: string; file_path?: string; notebook_path?: string }
          }
          if (b?.type !== 'tool_use') continue
          if (b.name === 'Skill') {
            const skill = b.input?.skill
            if (skill && !turn.skillsUsed.includes(skill)) turn.skillsUsed.push(skill)
          } else if (b.name && !turn.toolsUsed.includes(b.name)) {
            turn.toolsUsed.push(b.name)
          }
          // File-scope signal for complexity. Edit/Write/Read/MultiEdit use
          // file_path; NotebookEdit uses notebook_path.
          const path = b.input?.file_path ?? b.input?.notebook_path
          if (path && !turn.filesTouched.includes(path)) turn.filesTouched.push(path)
```

- [ ] **Step 4: Run the test — expect PASS**

Run: `pnpm exec vitest run src/main/services/productivity/transcript.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/productivity/transcript.ts src/main/services/productivity/transcript.test.ts
git commit -m "feat(productivity): record files touched per transcript turn" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Complexity — replace stub with percentile helpers

**Files:**
- Modify: `src/main/services/productivity/complexity.ts`
- Test: `src/main/services/productivity/complexity.test.ts` (full rewrite)

- [ ] **Step 1: Write the failing test (replace the whole file)**

Replace `src/main/services/productivity/complexity.test.ts` with:

```ts
import {
  complexityFromPercentiles,
  percentileRanks,
} from '@main/services/productivity/complexity'
import { describe, expect, it } from 'vitest'

describe('percentileRanks', () => {
  it('returns 0.5 for a single value', () => {
    expect(percentileRanks([42])).toEqual([0.5])
  })

  it('returns [] for empty input', () => {
    expect(percentileRanks([])).toEqual([])
  })

  it('uses mid-rank for ties', () => {
    // two equal values: each has countLess=0, countEqual=2 -> (0 + 0.5*2)/2 = 0.5
    expect(percentileRanks([5, 5])).toEqual([0.5, 0.5])
  })

  it('ranks distinct values by position', () => {
    // [10,20,30]: 10 -> (0+0.5)/3, 20 -> (1+0.5)/3, 30 -> (2+0.5)/3
    expect(percentileRanks([10, 20, 30])).toEqual([0.5 / 3, 1.5 / 3, 2.5 / 3])
  })
})

describe('complexityFromPercentiles', () => {
  it('maps mean percentile 0 -> 1 and 1 -> 10', () => {
    expect(complexityFromPercentiles([0, 0, 0])).toBe(1)
    expect(complexityFromPercentiles([1, 1, 1])).toBe(10)
  })

  it('maps mean percentile 0.5 -> 5.5', () => {
    expect(complexityFromPercentiles([0.5, 0.5])).toBe(5.5)
  })

  it('clamps and handles empty input as midpoint 1', () => {
    expect(complexityFromPercentiles([])).toBe(1)
  })
})
```

- [ ] **Step 2: Run the test — expect FAIL**

Run: `pnpm exec vitest run src/main/services/productivity/complexity.test.ts`
Expected: FAIL — `complexityFromPercentiles` / `percentileRanks` not exported.

- [ ] **Step 3: Implement (replace the whole file)**

Replace `src/main/services/productivity/complexity.ts` with:

```ts
// Session-level complexity from "scope" signals (files, dirs, tool types,
// skills, subagents). Each signal is percentile-ranked across the session
// corpus, then averaged and mapped to 1–10. Kept pure (no DB) so it is
// unit-testable; the tRPC layer supplies the corpus. See
// docs/superpowers/specs/2026-05-23-complexity-quality-metrics-design.md.

// Mid-rank percentile of each value within `values`, in [0,1].
// (countLess + 0.5*countEqual) / n. Single value -> 0.5. Empty -> [].
export function percentileRanks(values: number[]): number[] {
  const n = values.length
  if (n === 0) return []
  return values.map((v) => {
    let less = 0
    let equal = 0
    for (const o of values) {
      if (o < v) less++
      else if (o === v) equal++
    }
    return (less + 0.5 * equal) / n
  })
}

// Mean of the per-signal percentiles -> 1..10. Empty -> 1.
export function complexityFromPercentiles(percentiles: number[]): number {
  if (percentiles.length === 0) return 1
  const mean = percentiles.reduce((s, p) => s + p, 0) / percentiles.length
  const scaled = 1 + 9 * mean
  return Math.min(10, Math.max(1, scaled))
}
```

- [ ] **Step 4: Run the test — expect PASS**

Run: `pnpm exec vitest run src/main/services/productivity/complexity.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/productivity/complexity.ts src/main/services/productivity/complexity.test.ts
git commit -m "feat(productivity): replace complexity stub with percentile helpers" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Ingest — aggregate scope counts per session

**Files:**
- Modify: `src/main/services/productivity/ingest.ts`
- Test: `src/main/services/productivity/ingest.test.ts`

> This task only changes `aggregateBySession` + its type. Schema/row-building changes come in Task 4/5. After this task the package still type-checks because `buildTurnRows`/`buildSessionRows` are updated together here where they reference the type.

- [ ] **Step 1: Update the failing test**

In `src/main/services/productivity/ingest.test.ts`:

1a. The shared `turn(...)` factory lacks `filesTouched`. Add it (after `skillsUsed: [],`):
```ts
  skillsUsed: [],
  filesTouched: [],
```

1b. Replace the `aggregateBySession` test with:
```ts
describe('aggregateBySession', () => {
  it('sums tokens, counts turns, and unions scope signals per session', () => {
    const agg = aggregateBySession([
      turn({
        sessionId: 's1',
        turnIndex: 0,
        tokensIn: 100,
        tokensOut: 10,
        toolsUsed: ['Read', 'Edit'],
        skillsUsed: ['brainstorming'],
        filesTouched: ['/proj/a.ts', '/proj/sub/b.ts'],
      }),
      turn({
        sessionId: 's1',
        turnIndex: 1,
        tokensIn: 200,
        tokensOut: 20,
        toolsUsed: ['Edit', 'Task'], // Edit dup; Task = subagent
        skillsUsed: [],
        filesTouched: ['/proj/a.ts', '/proj/c.ts'], // a.ts dup
      }),
      turn({ sessionId: 's2', turnIndex: 0, tokensIn: 50, tokensOut: 5 }),
    ])

    expect(agg.get('s1')).toMatchObject({
      projectPath: '/proj',
      turnCount: 2,
      totalTokensIn: 300,
      totalTokensOut: 30,
      distinctFiles: 3, // a.ts, b.ts, c.ts
      distinctDirs: 2, // /proj, /proj/sub
      distinctTools: 3, // Read, Edit, Task
      distinctSkills: 1, // brainstorming
      subagentCount: 1, // one turn used Task
    })
    expect(agg.get('s2')).toMatchObject({ turnCount: 1, distinctFiles: 0, subagentCount: 0 })
  })
})
```

- [ ] **Step 2: Run the test — expect FAIL**

Run: `pnpm exec vitest run src/main/services/productivity/ingest.test.ts`
Expected: FAIL — `distinctFiles` etc. missing.

- [ ] **Step 3: Implement `aggregateBySession`**

In `src/main/services/productivity/ingest.ts`, replace the `SessionAggregate` interface and `aggregateBySession` function with:

```ts
export interface SessionAggregate {
  projectPath: string
  turnCount: number
  totalTokensIn: number
  totalTokensOut: number
  distinctFiles: number
  distinctDirs: number
  distinctTools: number
  distinctSkills: number
  subagentCount: number
}

// Parent dir of a path ("/a/b/c.ts" -> "/a/b"). No node:path needed.
function dirOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i <= 0 ? '/' : path.slice(0, i)
}

// Per-session rollup of transcript-derived turns, including the five "scope"
// signals used for complexity.
export function aggregateBySession(turns: AgentTurn[]): Map<string, SessionAggregate> {
  interface Acc {
    projectPath: string
    turnCount: number
    totalTokensIn: number
    totalTokensOut: number
    files: Set<string>
    dirs: Set<string>
    tools: Set<string>
    skills: Set<string>
    subagentCount: number
  }
  const agg = new Map<string, Acc>()
  for (const t of turns) {
    let a = agg.get(t.sessionId)
    if (!a) {
      a = {
        projectPath: t.projectPath,
        turnCount: 0,
        totalTokensIn: 0,
        totalTokensOut: 0,
        files: new Set(),
        dirs: new Set(),
        tools: new Set(),
        skills: new Set(),
        subagentCount: 0,
      }
      agg.set(t.sessionId, a)
    }
    a.turnCount++
    a.totalTokensIn += t.tokensIn
    a.totalTokensOut += t.tokensOut
    for (const f of t.filesTouched) {
      a.files.add(f)
      a.dirs.add(dirOf(f))
    }
    for (const tool of t.toolsUsed) a.tools.add(tool)
    for (const s of t.skillsUsed) a.skills.add(s)
    if (t.toolsUsed.includes('Task')) a.subagentCount++
  }
  const out = new Map<string, SessionAggregate>()
  for (const [id, a] of agg) {
    out.set(id, {
      projectPath: a.projectPath,
      turnCount: a.turnCount,
      totalTokensIn: a.totalTokensIn,
      totalTokensOut: a.totalTokensOut,
      distinctFiles: a.files.size,
      distinctDirs: a.dirs.size,
      distinctTools: a.tools.size,
      distinctSkills: a.skills.size,
      subagentCount: a.subagentCount,
    })
  }
  return out
}
```

> Note: this removes the old `avgComplexity`/`complexitySum` fields. `buildTurnRows`/`buildSessionRows` and the `complexityProxy` import are fixed in Task 5; the file will not type-check until then — that is expected within this task. Run only the targeted Vitest file in Step 4 (Vitest transpiles per-file and does not need the whole package to type-check).

- [ ] **Step 4: Run the test — expect PASS**

Run: `pnpm exec vitest run src/main/services/productivity/ingest.test.ts`
Expected: the `aggregateBySession` test PASSES. (The `buildTurnRows`/`buildSessionRows` tests may still reference old fields — they are fixed in Task 5. If they fail now, that is acceptable; do not commit until Task 5 makes the whole file green. Skip the commit here and proceed directly to Task 4 + Task 5, which form one logical change with this task.)

---

## Task 4: Schema — `filesTouched` on turns, scope counts on sessions

**Files:**
- Modify: `src/main/db/schema.ts`
- Create: `drizzle/0003_*.sql` (+ snapshot) via `pnpm db:generate`

- [ ] **Step 1: Edit `agent_turns`**

In `src/main/db/schema.ts`, inside the `agentTurns` column object, after the `skillsUsed` line, add:
```ts
    skillsUsed: text('skills_used', { mode: 'json' }).$type<string[]>().notNull(),
    filesTouched: text('files_touched', { mode: 'json' }).$type<string[]>().notNull().default('[]'),
    complexityProxy: real('complexity_proxy'),
```
(Keep `complexityProxy` for now — it becomes unused but dropping a column is a separate migration. The new `filesTouched` line is the only addition here.)

- [ ] **Step 2: Edit `agent_sessions`**

In the `agentSessions` column object, after `turnCount` and before/after `avgComplexity`, add the five scope-count columns:
```ts
    turnCount: integer('turn_count').notNull().default(0),
    avgComplexity: real('avg_complexity'), // DEPRECATED: complexity is computed at read time
    distinctFiles: integer('distinct_files').notNull().default(0),
    distinctDirs: integer('distinct_dirs').notNull().default(0),
    distinctTools: integer('distinct_tools').notNull().default(0),
    distinctSkills: integer('distinct_skills').notNull().default(0),
    subagentCount: integer('subagent_count').notNull().default(0),
```

- [ ] **Step 3: Generate the migration**

Run: `pnpm db:generate`
Expected: a new `drizzle/0003_*.sql` and matching `drizzle/meta/0003_snapshot.json` + updated `_journal.json` are created with `ALTER TABLE` statements adding the six columns.

- [ ] **Step 4: Sanity-check the migration SQL**

Run: `git status --short drizzle`
Expected: shows the new `0003_*.sql`, `meta/0003_snapshot.json`, and modified `meta/_journal.json`. Open the `.sql` and confirm it adds `files_touched`, `distinct_files`, `distinct_dirs`, `distinct_tools`, `distinct_skills`, `subagent_count`.

- [ ] **Step 5: Commit (schema only; ingest wiring in Task 5)**

```bash
git add src/main/db/schema.ts drizzle/0003_*.sql drizzle/meta/0003_snapshot.json drizzle/meta/_journal.json
git commit -m "feat(productivity): schema for files-touched + session scope counts" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Ingest — write scope counts, stop importing self-score, drop per-turn complexity

**Files:**
- Modify: `src/main/services/productivity/ingest.ts`
- Test: `src/main/services/productivity/ingest.test.ts`

- [ ] **Step 1: Update `buildTurnRows` + `buildSessionRows` tests**

In `src/main/services/productivity/ingest.test.ts`:

1a. Replace the `buildTurnRows` test with (no more `complexityProxy`; assert `filesTouched` passes through):
```ts
describe('buildTurnRows', () => {
  it('assigns deterministic id and passes through scope fields', () => {
    const rows = buildTurnRows([
      turn({ sessionId: 's1', turnIndex: 0, toolsUsed: ['Bash'], filesTouched: ['/p/x.ts'] }),
    ])
    expect(rows[0]).toMatchObject({
      id: turnId('s1', 0),
      sessionId: 's1',
      turnIndex: 0,
      toolsUsed: ['Bash'],
      filesTouched: ['/p/x.ts'],
    })
  })
})
```

1b. Replace the `buildSessionRows` block with (self-score NOT imported → always null; scope counts present):
```ts
describe('buildSessionRows', () => {
  const agg = aggregateBySession([
    turn({ sessionId: 's1', tokensIn: 100, tokensOut: 10, toolsUsed: ['Read'], filesTouched: ['/proj/a.ts'] }),
  ])

  it('merges transcript aggregates with buffer lifecycle, ignoring buffer score', () => {
    const rows = buildSessionRows(agg, [
      {
        sessionId: 's1',
        projectPath: '/proj',
        startedAt: new Date('2026-05-23T09:00:00Z'),
        endedAt: new Date('2026-05-23T10:00:00Z'),
        endReason: 'other',
        score: 8, // agent self-score — must be ignored now
        summary: 'done',
      },
    ])
    const s1 = rows.find((r) => r.sessionId === 's1')
    expect(s1).toMatchObject({
      projectPath: '/proj',
      endReason: 'other',
      summary: 'done',
      turnCount: 1,
      distinctFiles: 1,
      distinctTools: 1,
    })
    expect(s1?.score ?? null).toBeNull() // self-score dropped
  })

  it('includes a buffer-only session with zero turns and null score', () => {
    const rows = buildSessionRows(new Map(), [{ sessionId: 'sX', projectPath: '/p', score: 5 }])
    const sx = rows.find((r) => r.sessionId === 'sX')
    expect(sx).toMatchObject({ projectPath: '/p', turnCount: 0, totalTokensIn: 0, distinctFiles: 0 })
    expect(sx?.score ?? null).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests — expect FAIL**

Run: `pnpm exec vitest run src/main/services/productivity/ingest.test.ts`
Expected: FAIL — `buildTurnRows` still sets `complexityProxy`; `buildSessionRows` still imports `score` and lacks scope counts.

- [ ] **Step 3: Implement ingest changes**

In `src/main/services/productivity/ingest.ts`:

3a. Remove the now-unused import:
```ts
import { complexityProxy } from '@main/services/productivity/complexity'
```
(delete that line).

3b. Replace `buildTurnRows` with (no `complexityProxy`; add `filesTouched`):
```ts
export function buildTurnRows(turns: AgentTurn[]): NewAgentTurnRow[] {
  return turns.map((t) => ({
    id: turnId(t.sessionId, t.turnIndex),
    sessionId: t.sessionId,
    projectPath: t.projectPath,
    turnIndex: t.turnIndex,
    ts: t.ts,
    tokensIn: t.tokensIn,
    tokensOut: t.tokensOut,
    toolsUsed: t.toolsUsed,
    skillsUsed: t.skillsUsed,
    filesTouched: t.filesTouched,
  }))
}
```

3c. Replace `buildSessionRows` with (drop `score` import → null; add scope counts; `avgComplexity` always null):
```ts
// Unions transcript aggregates (token/turn rollups + scope counts) with buffer
// records (lifecycle only). Quality `score` is user-set via the UI, never from
// the buffer/agent self-rating, so it is left untouched here (null on insert).
export function buildSessionRows(
  aggregates: Map<string, SessionAggregate>,
  bufferRecords: SessionBufferRecord[],
): NewAgentSessionRow[] {
  const bufById = new Map(bufferRecords.map((r) => [r.sessionId, r]))
  const ids = new Set<string>([...aggregates.keys(), ...bufById.keys()])

  const rows: NewAgentSessionRow[] = []
  for (const id of ids) {
    const agg = aggregates.get(id)
    const buf = bufById.get(id)
    rows.push({
      sessionId: id,
      projectPath: agg?.projectPath ?? buf?.projectPath ?? '',
      startedAt: buf?.startedAt ?? null,
      endedAt: buf?.endedAt ?? null,
      endReason: buf?.endReason ?? null,
      score: null, // user rating only (set via productivity.setRating); never from buffer
      summary: buf?.summary ?? null,
      totalTokensIn: agg?.totalTokensIn ?? 0,
      totalTokensOut: agg?.totalTokensOut ?? 0,
      turnCount: agg?.turnCount ?? 0,
      avgComplexity: null, // deprecated; complexity computed at read time
      distinctFiles: agg?.distinctFiles ?? 0,
      distinctDirs: agg?.distinctDirs ?? 0,
      distinctTools: agg?.distinctTools ?? 0,
      distinctSkills: agg?.distinctSkills ?? 0,
      subagentCount: agg?.subagentCount ?? 0,
    })
  }
  return rows
}
```

3d. In `writeRows`, update the **turn** `onConflictDoUpdate.set` — remove `complexityProxy`, add `filesTouched`:
```ts
        set: {
          ts: row.ts,
          tokensIn: row.tokensIn,
          tokensOut: row.tokensOut,
          toolsUsed: row.toolsUsed,
          skillsUsed: row.skillsUsed,
          filesTouched: row.filesTouched,
        },
```

3e. In `writeRows`, update the **session** `onConflictDoUpdate.set` — REMOVE the `score` line (so re-ingest never clobbers a user rating) and ADD the scope counts:
```ts
        set: {
          projectPath: row.projectPath,
          startedAt: row.startedAt,
          endedAt: row.endedAt,
          endReason: row.endReason,
          summary: row.summary,
          totalTokensIn: row.totalTokensIn,
          totalTokensOut: row.totalTokensOut,
          turnCount: row.turnCount,
          avgComplexity: row.avgComplexity,
          distinctFiles: row.distinctFiles,
          distinctDirs: row.distinctDirs,
          distinctTools: row.distinctTools,
          distinctSkills: row.distinctSkills,
          subagentCount: row.subagentCount,
        },
```
(`score` is intentionally absent from the update set — it is set only on insert as null and otherwise preserved.)

- [ ] **Step 4: Run the tests — expect PASS**

Run: `pnpm exec vitest run src/main/services/productivity/ingest.test.ts`
Expected: PASS.

- [ ] **Step 5: Full type + lint + test**

Run: `pnpm typecheck && pnpm lint:fix && pnpm test`
Expected: typecheck clean, lint clean, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/main/services/productivity/ingest.ts src/main/services/productivity/ingest.test.ts
git commit -m "feat(productivity): aggregate session scope counts; stop importing self-score" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Router — read-time complexity, wired into overview/sessions

**Files:**
- Modify: `src/main/trpc/routers/productivity.ts`

> No Vitest (DB code). Verified via typecheck + e2e in Task 10.

- [ ] **Step 1: Add the complexity import + helper**

6a. At the top of `src/main/trpc/routers/productivity.ts`, add to the existing imports:
```ts
import { complexityFromPercentiles, percentileRanks } from '@main/services/productivity/complexity'
```

6b. After the existing helpers (e.g. after `turnFilter`), add a read-time complexity helper. It computes complexity for every tracked session once, so callers can look up by id:
```ts
interface SessionComplexity {
  complexity: number // 1..10
  distinctFiles: number
  distinctDirs: number
  distinctTools: number
  distinctSkills: number
  subagentCount: number
}

// Complexity = percentile-composite of five scope counts across the whole
// (tracked) session corpus. Computed at read time so it never goes stale.
function sessionComplexityMap(): Map<string, SessionComplexity> {
  const tracked = trackedProjects()
  const rows = db()
    .select({
      sessionId: agentSessions.sessionId,
      distinctFiles: agentSessions.distinctFiles,
      distinctDirs: agentSessions.distinctDirs,
      distinctTools: agentSessions.distinctTools,
      distinctSkills: agentSessions.distinctSkills,
      subagentCount: agentSessions.subagentCount,
    })
    .from(agentSessions)
    .where(tracked.length ? inArray(agentSessions.projectPath, tracked) : undefined)
    .all()

  const pFiles = percentileRanks(rows.map((r) => r.distinctFiles))
  const pDirs = percentileRanks(rows.map((r) => r.distinctDirs))
  const pTools = percentileRanks(rows.map((r) => r.distinctTools))
  const pSkills = percentileRanks(rows.map((r) => r.distinctSkills))
  const pSub = percentileRanks(rows.map((r) => r.subagentCount))

  const map = new Map<string, SessionComplexity>()
  rows.forEach((r, i) => {
    map.set(r.sessionId, {
      complexity: complexityFromPercentiles([pFiles[i], pDirs[i], pTools[i], pSkills[i], pSub[i]]),
      distinctFiles: r.distinctFiles,
      distinctDirs: r.distinctDirs,
      distinctTools: r.distinctTools,
      distinctSkills: r.distinctSkills,
      subagentCount: r.subagentCount,
    })
  })
  return map
}

const mean = (xs: number[]): number | null =>
  xs.length === 0 ? null : xs.reduce((s, x) => s + x, 0) / xs.length
```
(`trackedProjects`, `inArray`, `agentSessions`, `db` are already imported in this file.)

- [ ] **Step 2: Wire complexity into `overview`**

In the `overview` procedure:

2a. The output schema for `totals.avgComplexity` and `byProject[].avgComplexity` already exists (`z.number().nullable()`). Keep the names.

2b. After computing `scoped` / window data, build the complexity map and the set of windowed session ids. Replace the `avgComplexity: avg(agentTurns.complexityProxy)` usages:

- Remove `avgComplexity: avg(agentTurns.complexityProxy)` from the `totals` select and from the `byProject` select (and drop the now-unused `avg` import if nothing else uses it — check first; `avg` is still used for `avgScore`, so keep the import).

2c. Compute complexity aggregates in JS. Add before the `return`:
```ts
      const cmap = sessionComplexityMap()
      const windowIds = db()
        .select({ id: agentTurns.sessionId })
        .from(agentTurns)
        .where(scoped)
        .all()
        .map((r) => r.id)
      const windowIdSet = new Set(windowIds)
      const avgComplexity = mean(
        [...windowIdSet].map((id) => cmap.get(id)?.complexity).filter((c): c is number => c != null),
      )

      // Per-project complexity over the window.
      const projComplexity = new Map<string, number[]>()
      const projOfSession = db()
        .select({ id: agentSessions.sessionId, project: agentSessions.projectPath })
        .from(agentSessions)
        .all()
      const projById = new Map(projOfSession.map((r) => [r.id, r.project]))
      for (const id of windowIdSet) {
        const c = cmap.get(id)?.complexity
        const p = projById.get(id)
        if (c == null || p == null) continue
        const arr = projComplexity.get(p) ?? []
        arr.push(c)
        projComplexity.set(p, arr)
      }
```

2d. In the returned `totals`, replace `avgComplexity: toNum(totals?.avgComplexity ?? null)` with:
```ts
          avgComplexity,
```

2e. In the returned `byProject` map, replace `avgComplexity: toNum(p.avgComplexity)` with:
```ts
            avgComplexity: mean(projComplexity.get(p.projectPath) ?? []),
```
(and remove `avgComplexity` from the `byProject` SQL select so `p.avgComplexity` no longer exists).

- [ ] **Step 3: Wire complexity + components into `sessions`**

3a. Extend the `sessions` output schema: replace the `avgComplexity: z.number().nullable(),` line with:
```ts
          complexity: z.number().nullable(),
          distinctFiles: z.number(),
          distinctDirs: z.number(),
          distinctTools: z.number(),
          distinctSkills: z.number(),
          subagentCount: z.number(),
```

3b. In the `sessions` query, build the map and map rows. After fetching `rows`, replace the `return rows.map(...)` so each row includes complexity + components:
```ts
      const cmap = sessionComplexityMap()
      return rows.map((r) => {
        const c = cmap.get(r.sessionId)
        return {
          sessionId: r.sessionId,
          project: basename(r.projectPath) || r.projectPath,
          projectPath: r.projectPath,
          startedAt: r.startedAt,
          endedAt: r.endedAt,
          score: r.score,
          summary: r.summary,
          turnCount: r.turnCount,
          totalTokens: r.totalTokensIn + r.totalTokensOut,
          complexity: c?.complexity ?? null,
          distinctFiles: c?.distinctFiles ?? 0,
          distinctDirs: c?.distinctDirs ?? 0,
          distinctTools: c?.distinctTools ?? 0,
          distinctSkills: c?.distinctSkills ?? 0,
          subagentCount: c?.subagentCount ?? 0,
        }
      })
```

- [ ] **Step 4: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint:fix`
Expected: clean. (If `avg` import becomes unused, remove it; it is still used for `avgScore`, so it should remain.)

- [ ] **Step 5: Commit**

```bash
git add src/main/trpc/routers/productivity.ts
git commit -m "feat(productivity): compute session complexity at read time" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Router — rated-only quality + setRating mutation

**Files:**
- Modify: `src/main/trpc/routers/productivity.ts`

- [ ] **Step 1: Quality aggregate — rated only + counts**

In `overview`:

1a. Extend the `totals` output schema. After `avgScore: z.number().nullable(),` add:
```ts
          ratedCount: z.number(),
          totalCount: z.number(),
```

1b. The existing `scoreRow` computes `avg(agentSessions.score)` over windowed sessions; SQLite `avg` already ignores NULLs, so it is rated-only. Add counts. Replace the `scoreRow` query with:
```ts
      const scoreRow = db()
        .select({
          avgScore: avg(agentSessions.score),
          ratedCount: sql<number>`count(${agentSessions.score})`, // counts non-null
          totalCount: count(),
        })
        .from(agentSessions)
        .where(inArray(agentSessions.sessionId, windowSessionIds))
        .get()
```

1c. In the returned `totals`, add:
```ts
          avgScore: toNum(scoreRow?.avgScore ?? null),
          ratedCount: scoreRow?.ratedCount ?? 0,
          totalCount: scoreRow?.totalCount ?? 0,
```

- [ ] **Step 2: Add the `setRating` mutation**

Add a new procedure to the router (near `addNote`):
```ts
  // Set/clear the user quality rating (1–10) for a session. Quality is
  // user-only; null clears it (falls back to the imputed default in the UI).
  setRating: publicProcedure
    .input(z.object({ sessionId: z.string().min(1), score: z.number().int().min(1).max(10).nullable() }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(({ input }) => {
      db()
        .update(agentSessions)
        .set({ score: input.score })
        .where(eq(agentSessions.sessionId, input.sessionId))
        .run()
      return { ok: true }
    }),
```
(`eq`, `agentSessions`, `db`, `publicProcedure`, `z` are already imported.)

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint:fix`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/main/trpc/routers/productivity.ts
git commit -m "feat(productivity): rated-only quality aggregate + setRating mutation" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: UI — Avg score shows rated coverage

**Files:**
- Modify: `src/renderer/src/pages/Productivity.tsx`

- [ ] **Step 1: Replace the "Avg score" metric card**

In `OverviewTab`, the metric grid currently renders:
```tsx
        <MetricCard label="Avg score" value={dash(totals.avgScore)} />
```
Replace with a card that shows the rated coverage. First add a tiny helper near the other formatters (after `dash`):
```ts
const scoreLabel = (avg: number | null, rated: number, total: number): string =>
  rated === 0 ? '—' : `${avg == null ? '—' : avg.toFixed(1)} · ${rated}/${total} rated`
```
Then replace the card with:
```tsx
        <MetricCard
          label="Avg score (rated)"
          value={scoreLabel(totals.avgScore, totals.ratedCount, totals.totalCount)}
        />
```
(`totals.ratedCount` / `totals.totalCount` now exist from Task 7.)

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm typecheck:web && pnpm lint:fix`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/pages/Productivity.tsx
git commit -m "feat(productivity): show rated coverage on Avg score card" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: UI — Sessions tab: complexity column + rating control

**Files:**
- Modify: `src/renderer/src/pages/Productivity.tsx`

- [ ] **Step 1: Add a rating control component**

Near the top-level components (e.g. after `EcoBadge`), add a small editable rating control. A `<select>` keeps it dependency-free:
```tsx
function RatingControl({ sessionId, score }: { sessionId: string; score: number | null }) {
  const utils = trpc.useUtils()
  const setRating = trpc.productivity.setRating.useMutation({
    onSuccess: () => utils.productivity.invalidate(),
    onError: () => toast.error('Failed to save rating'),
  })
  return (
    <select
      aria-label="Quality rating"
      className="rounded border bg-background px-1 py-0.5 text-sm tabular-nums"
      value={score ?? ''}
      disabled={setRating.isPending}
      onChange={(e) => {
        const v = e.target.value === '' ? null : Number(e.target.value)
        setRating.mutate({ sessionId, score: v })
      }}
    >
      <option value="">— (7)</option>
      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
    </select>
  )
}
```

- [ ] **Step 2: Add a Complexity column + swap Score for the rating control**

In `SessionsTab`, the table header currently is:
```tsx
                <th className="py-2 pr-4 text-right font-medium">Tokens</th>
                <th className="py-2 pr-4 text-right font-medium">Score</th>
                <th className="py-2 font-medium">Summary</th>
```
Replace with:
```tsx
                <th className="py-2 pr-4 text-right font-medium">Tokens</th>
                <th className="py-2 pr-4 text-right font-medium">Complexity</th>
                <th className="py-2 pr-4 font-medium">Rating</th>
                <th className="py-2 font-medium">Summary</th>
```
And the body row currently has:
```tsx
                  <td className="py-2 pr-4 text-right tabular-nums">{num(s.totalTokens)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{dash(s.score, 0)}</td>
                  <td className="max-w-xs py-2">
```
Replace with:
```tsx
                  <td className="py-2 pr-4 text-right tabular-nums">{num(s.totalTokens)}</td>
                  <td
                    className="py-2 pr-4 text-right tabular-nums"
                    title={`files ${s.distinctFiles} · dirs ${s.distinctDirs} · tools ${s.distinctTools} · skills ${s.distinctSkills} · subagents ${s.subagentCount}`}
                  >
                    {dash(s.complexity, 1)}
                  </td>
                  <td className="py-2 pr-4">
                    <RatingControl sessionId={s.sessionId} score={s.score} />
                  </td>
                  <td className="max-w-xs py-2">
```
(The `title` exposes the complexity components on hover, satisfying spec §1 "components exposed".)

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm typecheck:web && pnpm lint:fix`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/pages/Productivity.tsx
git commit -m "feat(productivity): Sessions complexity column + manual rating control" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Backfill + full verification (e2e on real DB)

**Files:**
- Create (temporary): `e2e/_tmp_metrics.spec.ts` (deleted at the end)

- [ ] **Step 1: Full suite**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all green.

- [ ] **Step 2: Build (applies migration on launch; re-ingest backfills counts)**

Run: `pnpm build`
Expected: build succeeds. On next app launch, `runMigrations` adds the new columns and the startup `ingestProductivity()` re-ingests — because turn/session upserts use `onConflictDoUpdate`, existing rows get `filesTouched` and the scope counts backfilled automatically. No manual DB wipe needed.

- [ ] **Step 3: Write a temporary e2e to verify on the real DB**

Create `e2e/_tmp_metrics.spec.ts`:
```ts
import { _electron as electron, expect, test } from '@playwright/test'

test('complexity is non-constant and rating control works', async () => {
  const app = await electron.launch({ args: ['.'] })
  const window = await app.firstWindow()
  await expect(window.getByText('Atlas OS')).toBeVisible()

  // Trigger a re-ingest so scope counts are populated, then read metrics.
  await window.getByRole('button', { name: 'Productivity' }).click()
  await window.getByRole('button', { name: 'Refresh' }).click()
  await window.waitForTimeout(2500)

  // Avg complexity card should no longer read 3.0.
  const avgComplexity = await window.evaluate(() => {
    const cards = [...document.querySelectorAll('*')].filter(
      (e) => e.textContent?.trim() === 'Avg complexity',
    )
    const card = cards[0]?.closest('div')?.parentElement
    return card?.textContent ?? ''
  })

  // Sessions tab: complexity column + rating control present.
  await window.getByRole('tab', { name: 'Sessions' }).click()
  await window.waitForTimeout(1000)
  const ratings = await window.locator('select[aria-label="Quality rating"]').count()
  const complexityHeader = await window.getByText('Complexity', { exact: true }).count()

  console.log('METRICS', JSON.stringify({ avgComplexity, ratings, complexityHeader }))
  expect(ratings).toBeGreaterThan(0)
  expect(complexityHeader).toBeGreaterThan(0)
  await app.close()
})
```

- [ ] **Step 4: Run it**

Run: `pnpm exec playwright test e2e/_tmp_metrics.spec.ts`
Expected: PASS. In the `METRICS` log, `avgComplexity` text should contain a value other than `3.0` (real distribution), `ratings > 0`, `complexityHeader > 0`.

- [ ] **Step 5: Manually confirm a rating round-trips**

Run the app (`pnpm start` or your usual dev launch). On the Sessions tab, set a rating on one session via the dropdown, switch tabs and back: the value persists. On the Overview tab the "Avg score (rated)" card shows `… · n/total rated` with `n ≥ 1`.

- [ ] **Step 6: Remove the temporary e2e + final check**

```bash
rm -f e2e/_tmp_metrics.spec.ts
rm -rf test-results
pnpm typecheck && pnpm lint && pnpm test
```
Expected: green, no temp files left (`git status --short` shows only the intended changes).

- [ ] **Step 7: (No commit needed — temp file removed.)** Confirm the working tree is clean of plan artifacts:

Run: `git status --short`
Expected: only the pre-existing unrelated WIP (skills/chrome) remains unstaged; nothing from this plan is left uncommitted.

---

## Self-review notes (author)

- **Spec coverage:** complexity signal set + exclusions (Task 1–3, 6); percentile composite 1–10 (Task 2, 6); components exposed (Task 6 output, Task 9 `title`); session unit (Task 3, 6); `filesTouched` only new extraction (Task 1); `quality = score ?? 7` with imputed≠measured (Task 7 rated-only counts, Task 8 card, Task 9 `— (7)` option); manual rating UI + mutation (Task 7, 9); stop importing self-score (Task 5); deprecate `complexityProxy`/`avgComplexity` (Task 4 comments, Task 5/6). Out-of-scope items (model, residual, auto-signals, auto-prompt) are not implemented — correct.
- **Backfill:** handled by existing `onConflictDoUpdate` upserts (Task 5 set-clauses include the new columns) — no DELETE needed; spec §2.4 option (a) is therefore unnecessary.
- **Self-score clobber risk:** addressed by removing `score` from the session update set (Task 5, Step 3e).
- **Type consistency:** `complexity` (nullable) + the five `distinct*`/`subagentCount` names are identical across schema (Task 4), ingest (Task 3/5), router output (Task 6), and UI (Task 9).
```
