# ClaudePaths Namespace Extraction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract every Claude-related path from `AppPaths` into a dedicated `ClaudePaths` sub-namespace (`AppPaths.claude`) so the two concerns are separated at the type level without breaking consumers.

**Architecture:** Add a `ClaudePaths` interface with prefix-dropped field names; nest it as `AppPaths.claude`; extract a pure `computePaths()` factory (no Electron import) so the logic is unit-testable; migrate the four consumer files with TypeScript as the compiler-guided safety net.

**Tech Stack:** TypeScript, Electron, Vitest.

---

## Updated Type Signatures

```typescript
/** Paths owned by Claude Code's on-disk layout. */
export interface ClaudePaths {
  /** ~/.claude — root dir; contains settings.json, skills/, plugins/ */
  dir: string
  /** ~/.claude.json — MCP server + tool-permission config */
  json: string
  /** ~/.claude/projects — per-project transcript trees */
  projectsDir: string
  /**
   * userData/infra-snapshot.json — last-seen infra fingerprint.
   * Physically lives in Electron userData (an AppPaths root), but is
   * logically owned by the Claude infra-watcher; belongs here.
   */
  infraSnapshot: string
}

export interface AppPaths {
  userData: string
  db: string
  defaultOutputDir: string
  migrations: string
  /** ~/agent-analytics — Claude Code hook JSONL buffer */
  analyticsBufferDir: string
  /** All paths rooted at ~/.claude and related Claude config. */
  claude: ClaudePaths
}

/**
 * Pure factory — no Electron import. Inject from appPaths() in production;
 * supply fixed strings in tests.
 *
 * @param userData   Electron app.getPath('userData')
 * @param home       Electron app.getPath('home')
 * @param migrationsRoot  Project root (dev) or process.resourcesPath (packaged)
 * @param isPackaged app.isPackaged — kept only for documentation clarity; not
 *                   used inside, the caller resolves migrationsRoot already.
 */
export function computePaths(
  userData: string,
  home: string,
  migrationsRoot: string,
): AppPaths

/** Must be called after app is ready (depends on app.getPath). */
export function appPaths(): AppPaths
```

---

## File Map

| Action | Path | What changes |
|--------|------|--------------|
| Modify | `src/main/paths.ts` | Add `ClaudePaths`, nest as `AppPaths.claude`, extract `computePaths()` |
| Create | `src/main/paths.test.ts` | Unit tests for `computePaths()` (no Electron mock needed) |
| Modify | `src/main/index.ts` | `{ claudeDir, claudeJson, claudeProjectsDir, infraSnapshot }` → `{ claude }` |
| Modify | `src/main/trpc/routers/productivity.ts` | Same destructure update |
| Modify | `src/main/services/benchmark/compare.ts` | `p.claudeDir` → `p.claude.dir`, `p.claudeJson` → `p.claude.json` |
| Modify | `src/main/services/benchmark/batch.ts` | Same as compare.ts |

`src/main/services/productivity/ingest.ts` owns a **local** input-DTO interface (`IngestPaths`)
that is structurally separate from `AppPaths`. Its field names (`claudeDir?`, `claudeJson?`,
`infraSnapshotPath?`) are intentionally different. Only its callers change — they pass
`claude.dir` / `claude.json` / `claude.infraSnapshot` into the same existing slots.

---

## Task 1 — Rewrite `src/main/paths.ts`

**Files:**
- Modify: `src/main/paths.ts`

- [ ] **Step 1: Replace the entire file**

```typescript
import { join } from 'node:path'
import { app } from 'electron'

/** Paths owned by Claude Code's on-disk layout. */
export interface ClaudePaths {
  /** ~/.claude — root dir; contains settings.json, skills/, plugins/ */
  dir: string
  /** ~/.claude.json — MCP server + tool-permission config */
  json: string
  /** ~/.claude/projects — per-project transcript trees */
  projectsDir: string
  /**
   * userData/infra-snapshot.json — last-seen infra fingerprint.
   * Physically in Electron userData but logically owned by the
   * Claude infra-watcher; grouped here intentionally.
   */
  infraSnapshot: string
}

export interface AppPaths {
  userData: string
  db: string
  defaultOutputDir: string
  migrations: string
  /** ~/agent-analytics — Claude Code hook JSONL buffer */
  analyticsBufferDir: string
  /** All paths rooted at ~/.claude and related Claude config. */
  claude: ClaudePaths
}

/**
 * Pure factory — no Electron dependency; safe to call in unit tests.
 *
 * @param userData       Electron userData directory
 * @param home           User home directory
 * @param migrationsRoot Project root in dev; process.resourcesPath when packaged
 */
export function computePaths(
  userData: string,
  home: string,
  migrationsRoot: string,
): AppPaths {
  return {
    userData,
    db: join(userData, 'atlas.db'),
    defaultOutputDir: join(userData, 'outputs'),
    migrations: join(migrationsRoot, 'drizzle'),
    analyticsBufferDir: join(home, 'agent-analytics'),
    claude: {
      dir: join(home, '.claude'),
      json: join(home, '.claude.json'),
      projectsDir: join(home, '.claude', 'projects'),
      infraSnapshot: join(userData, 'infra-snapshot.json'),
    },
  }
}

/** Must be called after app is ready (depends on app.getPath). */
export function appPaths(): AppPaths {
  const userData = app.getPath('userData')
  const home = app.getPath('home')
  // Dev: <project-root>/drizzle. Packaged: <resources>/drizzle.
  const migrationsRoot = app.isPackaged ? process.resourcesPath : app.getAppPath()
  return computePaths(userData, home, migrationsRoot)
}
```

- [ ] **Step 2: TypeScript-check this file in isolation**

```bash
npx tsc --noEmit --project tsconfig.node.json 2>&1 | head -60
```

Expected: errors in the **four call-site files** (they still use the old flat field names). Zero errors inside `paths.ts` itself.

- [ ] **Step 3: Commit**

```bash
git add src/main/paths.ts
git commit -m "refactor: extract ClaudePaths namespace from AppPaths"
```

---

## Task 2 — Unit-test `computePaths()`

**Files:**
- Create: `src/main/paths.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
import { describe, expect, it } from 'vitest'
import { computePaths } from './paths'

const FAKE = {
  userData: '/ud',
  home: '/hm',
  migrations: '/mr',
}

describe('computePaths', () => {
  it('builds Atlas-owned paths from userData', () => {
    const p = computePaths(FAKE.userData, FAKE.home, FAKE.migrations)
    expect(p.userData).toBe('/ud')
    expect(p.db).toBe('/ud/atlas.db')
    expect(p.defaultOutputDir).toBe('/ud/outputs')
    expect(p.migrations).toBe('/mr/drizzle')
    expect(p.analyticsBufferDir).toBe('/hm/agent-analytics')
  })

  it('nests all Claude paths under the .claude property', () => {
    const p = computePaths(FAKE.userData, FAKE.home, FAKE.migrations)
    expect(p.claude.dir).toBe('/hm/.claude')
    expect(p.claude.json).toBe('/hm/.claude.json')
    expect(p.claude.projectsDir).toBe('/hm/.claude/projects')
  })

  it('infraSnapshot lives in userData but is accessible via claude namespace', () => {
    const p = computePaths(FAKE.userData, FAKE.home, FAKE.migrations)
    expect(p.claude.infraSnapshot).toBe('/ud/infra-snapshot.json')
    expect(p.claude.infraSnapshot).toContain(FAKE.userData)
  })

  it('AppPaths has no flat claude* fields at the top level', () => {
    const p = computePaths(FAKE.userData, FAKE.home, FAKE.migrations)
    // TypeScript prevents this at compile time; this is a belt-and-suspenders
    // runtime guard against accidental re-introduction.
    expect('claudeDir' in p).toBe(false)
    expect('claudeJson' in p).toBe(false)
    expect('claudeProjectsDir' in p).toBe(false)
    expect('infraSnapshot' in p).toBe(false)
  })

  it('migrations path uses the injected migrationsRoot', () => {
    const dev = computePaths(FAKE.userData, FAKE.home, '/project-root')
    const prod = computePaths(FAKE.userData, FAKE.home, '/resources')
    expect(dev.migrations).toBe('/project-root/drizzle')
    expect(prod.migrations).toBe('/resources/drizzle')
  })
})
```

- [ ] **Step 2: Run tests**

```bash
npx vitest run src/main/paths.test.ts
```

Expected: 5 passing tests, no Electron mock required.

- [ ] **Step 3: Commit**

```bash
git add src/main/paths.test.ts
git commit -m "test: unit-test computePaths() without Electron dependency"
```

---

## Task 3 — Migrate `src/main/index.ts`

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: Locate the destructure (line ~16)**

Current code:
```typescript
const { claudeProjectsDir, analyticsBufferDir, claudeDir, claudeJson, infraSnapshot } = appPaths()
ingestAll(db(), {
  projectsDir: claudeProjectsDir,
  bufferDir: analyticsBufferDir,
  claudeDir,
  claudeJson,
  infraSnapshotPath: infraSnapshot,
})
```

- [ ] **Step 2: Apply the new destructure**

```typescript
const { analyticsBufferDir, claude } = appPaths()
ingestAll(db(), {
  projectsDir: claude.projectsDir,
  bufferDir: analyticsBufferDir,
  claudeDir: claude.dir,
  claudeJson: claude.json,
  infraSnapshotPath: claude.infraSnapshot,
})
```

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit --project tsconfig.node.json 2>&1 | grep 'index.ts'
```

Expected: no errors in `index.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/main/index.ts
git commit -m "refactor: use AppPaths.claude in index.ts"
```

---

## Task 4 — Migrate `src/main/trpc/routers/productivity.ts`

**Files:**
- Modify: `src/main/trpc/routers/productivity.ts`

- [ ] **Step 1: Locate the destructure (lines ~193–200)**

Current code:
```typescript
const { claudeProjectsDir, analyticsBufferDir, claudeDir, claudeJson, infraSnapshot } =
  appPaths()
return await ingestAll(db(), {
  projectsDir: claudeProjectsDir,
  bufferDir: analyticsBufferDir,
  claudeDir,
  claudeJson,
  infraSnapshotPath: infraSnapshot,
})
```

- [ ] **Step 2: Apply identical pattern to Task 3**

```typescript
const { analyticsBufferDir, claude } = appPaths()
return await ingestAll(db(), {
  projectsDir: claude.projectsDir,
  bufferDir: analyticsBufferDir,
  claudeDir: claude.dir,
  claudeJson: claude.json,
  infraSnapshotPath: claude.infraSnapshot,
})
```

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit --project tsconfig.node.json 2>&1 | grep 'productivity.ts'
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/main/trpc/routers/productivity.ts
git commit -m "refactor: use AppPaths.claude in productivity router"
```

---

## Task 5 — Migrate benchmark services

**Files:**
- Modify: `src/main/services/benchmark/compare.ts`
- Modify: `src/main/services/benchmark/batch.ts`

Both files contain the same two-property access pattern: `p.claudeDir` and `p.claudeJson`.

- [ ] **Step 1: Update `compare.ts` (lines ~98–102)**

`baselineMarkerPath()` uses `appPaths().userData` — that path is unchanged; no edit needed.

The `readInfraState(...)` call block:

Old:
```typescript
const p = appPaths()
// ...
settingsPath: join(p.claudeDir, 'settings.json'),
claudeJsonPath: p.claudeJson,
skillsDir: join(p.claudeDir, 'skills'),
```

New:
```typescript
const p = appPaths()
// ...
settingsPath: join(p.claude.dir, 'settings.json'),
claudeJsonPath: p.claude.json,
skillsDir: join(p.claude.dir, 'skills'),
```

- [ ] **Step 2: Update `batch.ts` (lines ~70–74)**

Old:
```typescript
const p = appPaths()
// ...
settingsPath: join(p.claudeDir, 'settings.json'),
claudeJsonPath: p.claudeJson,
skillsDir: join(p.claudeDir, 'skills'),
```

New:
```typescript
const p = appPaths()
// ...
settingsPath: join(p.claude.dir, 'settings.json'),
claudeJsonPath: p.claude.json,
skillsDir: join(p.claude.dir, 'skills'),
```

- [ ] **Step 3: Full TypeScript build — must be clean**

```bash
npx tsc --noEmit --project tsconfig.node.json 2>&1
```

Expected: **zero errors**. If any remain they are in files not in this plan — investigate before merging.

- [ ] **Step 4: Full test suite**

```bash
npx vitest run
```

Expected: all pre-existing tests pass + 5 new `paths.test.ts` tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/benchmark/compare.ts src/main/services/benchmark/batch.ts
git commit -m "refactor: use AppPaths.claude in benchmark services"
```

---

## Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| **Missed call site** — a file accesses `paths.claudeDir` etc. and isn't in this plan | Medium | TypeScript strict mode catches every stale reference at the `tsc --noEmit` step in Task 5. No silent runtime failure possible. |
| **`infraSnapshot` straddles two concerns** — physically in `userData` (Electron), logically Claude-owned | Low | Documented with a JSDoc note in `ClaudePaths`. `computePaths` receives `userData` as a parameter so the path is built correctly. The test in Task 2 asserts `infraSnapshot` contains `userData`, making the relationship explicit. |
| **`IngestPaths` interface drift** — `ingest.ts` owns its own `claudeDir?`, `claudeJson?`, `infraSnapshotPath?` fields; a future developer might conflate them with `ClaudePaths` | Low | These are structurally separate APIs. The field names differ on purpose (`infraSnapshotPath` vs `infraSnapshot`). Add a one-line JSDoc to `IngestPaths` clarifying it is an input DTO, not an alias of `ClaudePaths`. |
| **Double `app.getPath()` call** if a file needs both `appPaths()` and (previously) `claudePaths()` | None | With nested design there is only ever one call to `appPaths()`. No overhead introduced. |
| **`appPaths()` called before `app.ready`** — pre-existing risk, not introduced here | Low | Unchanged from current code. `computePaths()` is a pure function safe to call anywhere; the guard comment on `appPaths()` remains. |
| **`migrations` path regression** — `computePaths` previously used `app.getAppPath()` for dev; now receives an injected `migrationsRoot` | Low | The injected value in `appPaths()` is `app.getAppPath()` in dev, `process.resourcesPath` when packaged — identical to original logic. The Task 2 test verifies the `join(migrationsRoot, 'drizzle')` construction. |
