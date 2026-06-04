# ClaudePaths Namespace Extraction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the four Claude-ecosystem paths (`claudeDir`, `claudeJson`, `claudeProjectsDir`, `infraSnapshot`) out of the flat `AppPaths` interface into a dedicated `ClaudePaths` sub-namespace (`AppPaths.claude`), with a testable pure-factory helper alongside the existing Electron-bound `appPaths()`.

**Architecture:** Add `ClaudePaths` interface + extract `computePaths()` (no Electron import, safe to unit-test); nest `ClaudePaths` as `AppPaths.claude`; `appPaths()` keeps its public signature but delegates to `computePaths()`; migrate all four consumer files guided by TypeScript compile errors.

**Tech Stack:** TypeScript, Electron (main process only), Vitest.

> **Note:** This supersedes `2026-05-26`, `2026-05-28`, and `2026-05-30` plans. The codebase is unchanged from the 05-30 plan — all call-site analysis and code is still accurate.

---

## Updated Type Signatures

```typescript
// ── NEW: owned by paths.ts ───────────────────────────────────────────────────

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
   * Physically lives in Electron userData, but is logically owned
   * by the Claude infra-watcher; grouped here intentionally.
   */
  infraSnapshot: string
}

// ── UPDATED: AppPaths ────────────────────────────────────────────────────────

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

// ── NEW: pure factory (Electron-free, unit-testable) ─────────────────────────

/**
 * Pure factory — no Electron dependency.
 *
 * Inject from appPaths() in production; pass fixed strings in tests.
 *
 * @param userData       Electron app.getPath('userData')
 * @param home           Electron app.getPath('home')
 * @param migrationsRoot Project root in dev; process.resourcesPath when packaged
 */
export function computePaths(userData: string, home: string, migrationsRoot: string): AppPaths

// ── UNCHANGED signature: must be called after app is ready ───────────────────
export function appPaths(): AppPaths
```

### Field name rationale

| Old (flat on AppPaths)  | New (nested on AppPaths.claude) | Why shorter? |
|-------------------------|---------------------------------|--------------|
| `claudeDir`             | `claude.dir`                    | Namespace already says "claude" |
| `claudeJson`            | `claude.json`                   | Same — redundant prefix dropped |
| `claudeProjectsDir`     | `claude.projectsDir`            | Same |
| `infraSnapshot`         | `claude.infraSnapshot`          | No prefix to drop — kept as-is |

`analyticsBufferDir` **stays on `AppPaths`** — it lives at `~/agent-analytics` (not inside `~/.claude`) and is Atlas-owned, not Claude Code-owned.

---

## File Map

| Action | Path | What changes |
|--------|------|--------------|
| **Modify** | `src/main/paths.ts` | Add `ClaudePaths`, add `computePaths()`, update `AppPaths`, delegate `appPaths()` |
| **Create** | `src/main/paths.test.ts` | 5 unit tests for `computePaths()` (no Electron mock needed) |
| **Modify** | `src/main/index.ts` | Flat destructure → `{ analyticsBufferDir, claude }` |
| **Modify** | `src/main/trpc/routers/productivity.ts` | Same destructure update |
| **Modify** | `src/main/services/benchmark/batch.ts` | `p.claudeDir` → `p.claude.dir`, `p.claudeJson` → `p.claude.json` |
| **Modify** | `src/main/services/benchmark/compare.ts` | Same dot-path updates |
| **No change** | `src/main/services/productivity/ingest.ts` | Owns its own `IngestPaths` DTO; callers update the mapping, not the interface |
| **No change** | `src/main/db/client.ts`, `db/migrate.ts`, `store.ts` | Only access non-Claude fields |

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
   * Physically lives in Electron userData, but is logically owned
   * by the Claude infra-watcher; grouped here intentionally.
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

- [ ] **Step 2: Run TypeScript to surface all broken call sites**

```bash
npx tsc --noEmit --project tsconfig.node.json 2>&1 | grep "error TS"
```

Expected: errors in exactly **4 files** — `index.ts`, `productivity.ts`, `batch.ts`, `compare.ts` — on references to `.claudeDir`, `.claudeJson`, `.claudeProjectsDir`, `.infraSnapshot` that no longer exist on `AppPaths`. Zero errors in `paths.ts` itself. `ingest.ts`, `db/`, `store.ts` emit no errors.

- [ ] **Step 3: Commit**

```bash
git add src/main/paths.ts
git commit -m "refactor: extract ClaudePaths namespace, add computePaths() pure factory"
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
  migrationsRoot: '/mr',
}

describe('computePaths', () => {
  it('builds Atlas-owned paths from userData', () => {
    const p = computePaths(FAKE.userData, FAKE.home, FAKE.migrationsRoot)
    expect(p.userData).toBe('/ud')
    expect(p.db).toBe('/ud/atlas.db')
    expect(p.defaultOutputDir).toBe('/ud/outputs')
    expect(p.migrations).toBe('/mr/drizzle')
    expect(p.analyticsBufferDir).toBe('/hm/agent-analytics')
  })

  it('nests all Claude paths under the .claude property', () => {
    const p = computePaths(FAKE.userData, FAKE.home, FAKE.migrationsRoot)
    expect(p.claude.dir).toBe('/hm/.claude')
    expect(p.claude.json).toBe('/hm/.claude.json')
    expect(p.claude.projectsDir).toBe('/hm/.claude/projects')
  })

  it('infraSnapshot lives in userData but is accessible via claude namespace', () => {
    const p = computePaths(FAKE.userData, FAKE.home, FAKE.migrationsRoot)
    expect(p.claude.infraSnapshot).toBe('/ud/infra-snapshot.json')
    expect(p.claude.infraSnapshot).toContain(FAKE.userData)
  })

  it('AppPaths has no flat claude* fields at the top level', () => {
    const p = computePaths(FAKE.userData, FAKE.home, FAKE.migrationsRoot)
    // TypeScript prevents this at compile time; runtime belt-and-suspenders
    // guard against accidental re-introduction of the old flat fields.
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

Expected: **5 passing**, no failures, no Electron mock required.

- [ ] **Step 3: Commit**

```bash
git add src/main/paths.test.ts
git commit -m "test: unit-test computePaths() without Electron dependency"
```

---

## Task 3 — Migrate `src/main/index.ts`

**Files:**
- Modify: `src/main/index.ts` (function `ingestProductivity`, line 16)

- [ ] **Step 1: Update the destructure**

Old (line 16):
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

New:
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

Note: `IngestPaths` in `ingest.ts` still uses the old field names (`claudeDir?`, `claudeJson?`, `infraSnapshotPath?`). The mapping just changes what we pass in — the DTO interface itself is **not touched**.

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit --project tsconfig.node.json 2>&1 | grep "index.ts"
```

Expected: no errors for `index.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/main/index.ts
git commit -m "refactor: use AppPaths.claude in index.ts ingestProductivity"
```

---

## Task 4 — Migrate `src/main/trpc/routers/productivity.ts`

**Files:**
- Modify: `src/main/trpc/routers/productivity.ts` (`refresh` mutation, lines 149–157)

- [ ] **Step 1: Update the destructure**

Old (lines 149–157):
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

New:
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

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit --project tsconfig.node.json 2>&1 | grep "productivity.ts"
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/main/trpc/routers/productivity.ts
git commit -m "refactor: use AppPaths.claude in productivity tRPC router"
```

---

## Task 5 — Migrate benchmark services

**Files:**
- Modify: `src/main/services/benchmark/batch.ts` (inside `runLoop`, lines 70–75)
- Modify: `src/main/services/benchmark/compare.ts` (inside `loadCompareResult`, lines 98–103)

Both files access only `claudeDir` and `claudeJson` (no `claudeProjectsDir` / `infraSnapshot`).

- [ ] **Step 1: Update `batch.ts`**

Old (lines 70–75):
```typescript
const p = appPaths()
const infra = await readInfraState({
  settingsPath: join(p.claudeDir, 'settings.json'),
  claudeJsonPath: p.claudeJson,
  skillsDir: join(p.claudeDir, 'skills'),
})
```

New:
```typescript
const p = appPaths()
const infra = await readInfraState({
  settingsPath: join(p.claude.dir, 'settings.json'),
  claudeJsonPath: p.claude.json,
  skillsDir: join(p.claude.dir, 'skills'),
})
```

- [ ] **Step 2: Update `compare.ts`**

Old (lines 98–103):
```typescript
const p = appPaths()
const live = await readInfraState({
  settingsPath: join(p.claudeDir, 'settings.json'),
  claudeJsonPath: p.claudeJson,
  skillsDir: join(p.claudeDir, 'skills'),
})
```

New:
```typescript
const p = appPaths()
const live = await readInfraState({
  settingsPath: join(p.claude.dir, 'settings.json'),
  claudeJsonPath: p.claude.json,
  skillsDir: join(p.claude.dir, 'skills'),
})
```

- [ ] **Step 3: Full TypeScript build — must be zero errors**

```bash
npx tsc --noEmit --project tsconfig.node.json 2>&1
```

Expected: **zero output**. Any remaining error is a missed call site — grep for it and add a step.

- [ ] **Step 4: Confirm no stale flat references remain**

```bash
grep -rn '\.\(claudeDir\|claudeJson\|claudeProjectsDir\)\b' src --include='*.ts' | grep -v '\.claude\.'
```

Expected: no output. Any match is a missed site.

- [ ] **Step 5: Run full test suite**

```bash
npx vitest run
```

Expected: all pre-existing tests pass **plus** the 5 new `paths.test.ts` tests.

- [ ] **Step 6: Commit**

```bash
git add src/main/services/benchmark/batch.ts src/main/services/benchmark/compare.ts
git commit -m "refactor: use AppPaths.claude in benchmark batch and compare services"
```

---

## Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| **Missed call site** — a file accesses `.claudeDir` / `.claudeJson` / `.claudeProjectsDir` and wasn't in the grep survey | Medium | TypeScript deletes those fields from `AppPaths` in Task 1. Every stale reference becomes a compile error at Task 1 Step 2, surfaced before any consumer is edited. No silent runtime failure possible. |
| **`infraSnapshot` straddles two concerns** — physically in `userData`, logically Claude-owned | Low | Documented with a JSDoc note in `ClaudePaths`. `computePaths()` receives `userData` and builds the path correctly. Task 2 test explicitly asserts `claude.infraSnapshot` contains `userData`, making the data-flow visible. |
| **`migrations` path regression** — old code used `app.getAppPath()` directly; now injected as `migrationsRoot` | Low | `appPaths()` passes `app.isPackaged ? process.resourcesPath : app.getAppPath()` — identical to the original conditional. Task 2 test verifies `migrations = join(migrationsRoot, 'drizzle')` for both dev and prod roots. |
| **`IngestPaths` interface drift** — `ingest.ts` owns its own `claudeDir?`, `claudeJson?` fields; a future developer might think they're aliases of `ClaudePaths` | Low | These are structurally separate APIs. The field names deliberately differ (`infraSnapshotPath` vs `infraSnapshot`; `claudeDir` vs `claude.dir`). The `IngestPaths` interface already has a comment clarifying it's a DTO for the infra-watcher call; no change required. |
| **Dynamic property access** — code does `paths[key]` and TypeScript misses it | None | Confirmed all accesses are static dot-notation. No dynamic indexing anywhere in the consumer set. |
| **`analyticsBufferDir` inconsistency** — left in `AppPaths` while other tracker-related paths move | Intentional | It lives at `~/agent-analytics` (not `~/.claude`), is Atlas-owned (written by Atlas hooks, not Claude Code), and was explicitly excluded from the extraction list. Keeping it in `AppPaths` is the correct call. |
