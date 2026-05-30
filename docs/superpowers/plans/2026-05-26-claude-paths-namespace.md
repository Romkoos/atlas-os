# ClaudePaths Namespace Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract `claudeDir`, `claudeJson`, `claudeProjectsDir`, `infraSnapshot` out of `AppPaths` into a dedicated `ClaudePaths` interface, nested as `AppPaths.claude`.

**Architecture:** Add `ClaudePaths` interface to `paths.ts`, nest it under the `claude` key in `AppPaths`, update `appPaths()` return value, then update all four call sites that dereference those fields. No new files. No new functions. `appPaths()` signature stays `(): AppPaths`.

**Tech Stack:** TypeScript, Electron/Node `path.join`. No runtime deps change.

---

## Type Signatures (reference for every task)

### Before

```typescript
export interface AppPaths {
  userData: string
  db: string
  defaultOutputDir: string
  migrations: string
  claudeProjectsDir: string   // moves to ClaudePaths
  analyticsBufferDir: string
  claudeDir: string           // moves to ClaudePaths
  claudeJson: string          // moves to ClaudePaths
  infraSnapshot: string       // moves to ClaudePaths
}
```

### After

```typescript
export interface ClaudePaths {
  claudeDir: string         // ~/.claude — infra watcher root (settings.json, skills/)
  claudeJson: string        // ~/.claude.json — MCP server config
  claudeProjectsDir: string // ~/.claude/projects — Claude Code transcripts
  infraSnapshot: string     // userData/infra-snapshot.json — last seen infra state
}

export interface AppPaths {
  userData: string
  db: string
  defaultOutputDir: string
  migrations: string
  analyticsBufferDir: string // ~/agent-analytics — hook JSONL buffer
  claude: ClaudePaths
}
```

---

## File Map

| File | Change |
|---|---|
| `src/main/paths.ts` | Add `ClaudePaths`; update `AppPaths`; update `appPaths()` |
| `src/main/index.ts` | Destructuring: `{ analyticsBufferDir, claude: { ... } }` |
| `src/main/trpc/routers/productivity.ts` | Same destructuring update |
| `src/main/services/benchmark/batch.ts` | `p.claudeDir` → `p.claude.claudeDir`, `p.claudeJson` → `p.claude.claudeJson` |
| `src/main/services/benchmark/compare.ts` | Same dot-path updates |
| `src/main/services/benchmark/tasks.ts` | **No change** — assert regexes still match |
| `src/main/services/productivity/ingest.ts` | **No change** — has its own `IngestPaths` type |
| `src/main/services/productivity/infra.ts` | **No change** — has its own `InfraPaths` type |
| `src/main/db/client.ts` | **No change** — only accesses `db` |
| `src/main/db/migrate.ts` | **No change** — only accesses `migrations` |
| `src/main/store.ts` | **No change** — only accesses `defaultOutputDir` |

---

## Task 1: Rewrite `src/main/paths.ts`

**Files:**
- Modify: `src/main/paths.ts`

- [ ] **Step 1: Replace the file content**

```typescript
import { join } from 'node:path'
import { app } from 'electron'

export interface ClaudePaths {
  claudeDir: string         // ~/.claude — infra watcher root (settings.json, skills/)
  claudeJson: string        // ~/.claude.json — MCP server config
  claudeProjectsDir: string // ~/.claude/projects — Claude Code transcripts
  infraSnapshot: string     // userData/infra-snapshot.json — last seen infra state
}

export interface AppPaths {
  userData: string
  db: string
  defaultOutputDir: string
  migrations: string
  analyticsBufferDir: string // ~/agent-analytics — hook JSONL buffer
  claude: ClaudePaths
}

// Must be called after app is ready (depends on app.getPath).
export function appPaths(): AppPaths {
  const userData = app.getPath('userData')
  const home = app.getPath('home')
  return {
    userData,
    db: join(userData, 'atlas.db'),
    defaultOutputDir: join(userData, 'outputs'),
    // Dev: ./drizzle in the project root. Packaged: bundled via extraResources.
    migrations: app.isPackaged
      ? join(process.resourcesPath, 'drizzle')
      : join(app.getAppPath(), 'drizzle'),
    analyticsBufferDir: join(home, 'agent-analytics'),
    claude: {
      claudeDir: join(home, '.claude'),
      claudeJson: join(home, '.claude.json'),
      claudeProjectsDir: join(home, '.claude', 'projects'),
      infraSnapshot: join(userData, 'infra-snapshot.json'),
    },
  }
}
```

- [ ] **Step 2: Run TypeScript to see all broken call sites**

```bash
cd /Users/Roman.Neganov/Projects/PersonalProjects/atlas-os
npx tsc --noEmit 2>&1 | grep "error TS"
```

Expected: errors in `index.ts`, `productivity.ts`, `batch.ts`, `compare.ts` referencing `claudeDir`, `claudeJson`, `claudeProjectsDir`, `infraSnapshot` on `AppPaths`. No errors in `infra.ts`, `ingest.ts`, `db/`, `store.ts`.

- [ ] **Step 3: Commit paths.ts only**

```bash
git add src/main/paths.ts
git commit -m "refactor: extract ClaudePaths namespace from AppPaths"
```

---

## Task 2: Update `src/main/index.ts`

**Files:**
- Modify: `src/main/index.ts` (function `ingestProductivity`, ~line 16)

- [ ] **Step 1: Replace the destructuring line**

Old line (~16):
```typescript
const { claudeProjectsDir, analyticsBufferDir, claudeDir, claudeJson, infraSnapshot } = appPaths()
```

New line:
```typescript
const { analyticsBufferDir, claude: { claudeDir, claudeJson, claudeProjectsDir, infraSnapshot } } = appPaths()
```

The body of `ingestProductivity` below it (`projectsDir: claudeProjectsDir`, `bufferDir: analyticsBufferDir`, etc.) is unchanged — same local variable names.

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit 2>&1 | grep "index.ts"
```

Expected: no errors for `index.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/main/index.ts
git commit -m "refactor: update index.ts to destructure AppPaths.claude"
```

---

## Task 3: Update `src/main/trpc/routers/productivity.ts`

**Files:**
- Modify: `src/main/trpc/routers/productivity.ts` (~line 193)

- [ ] **Step 1: Replace the destructuring line**

Old (~line 193):
```typescript
const { claudeProjectsDir, analyticsBufferDir, claudeDir, claudeJson, infraSnapshot } =
  appPaths()
```

New:
```typescript
const { analyticsBufferDir, claude: { claudeDir, claudeJson, claudeProjectsDir, infraSnapshot } } =
  appPaths()
```

The `ingestAll(db(), { ... })` call below is unchanged — same local variable names.

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit 2>&1 | grep "productivity.ts"
```

Expected: no errors for `productivity.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/main/trpc/routers/productivity.ts
git commit -m "refactor: update productivity router to destructure AppPaths.claude"
```

---

## Task 4: Update `src/main/services/benchmark/batch.ts`

**Files:**
- Modify: `src/main/services/benchmark/batch.ts` (~line 70, inside `runLoop`)

- [ ] **Step 1: Replace the three property accesses**

Old (inside `readInfraState({...})`):
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
  settingsPath: join(p.claude.claudeDir, 'settings.json'),
  claudeJsonPath: p.claude.claudeJson,
  skillsDir: join(p.claude.claudeDir, 'skills'),
})
```

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit 2>&1 | grep "batch.ts"
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/main/services/benchmark/batch.ts
git commit -m "refactor: update benchmark/batch.ts to use AppPaths.claude"
```

---

## Task 5: Update `src/main/services/benchmark/compare.ts`

**Files:**
- Modify: `src/main/services/benchmark/compare.ts` (~line 98, inside the infra-state fetch)

- [ ] **Step 1: Replace the three property accesses**

Old:
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
  settingsPath: join(p.claude.claudeDir, 'settings.json'),
  claudeJsonPath: p.claude.claudeJson,
  skillsDir: join(p.claude.claudeDir, 'skills'),
})
```

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit 2>&1 | grep "compare.ts"
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/main/services/benchmark/compare.ts
git commit -m "refactor: update benchmark/compare.ts to use AppPaths.claude"
```

---

## Task 6: Full type-check and confirm clean

**Files:** none created/modified

- [ ] **Step 1: Full clean check**

```bash
npx tsc --noEmit 2>&1
```

Expected: zero output (zero errors).

- [ ] **Step 2: Confirm no stale references remain**

```bash
grep -rn 'appPaths()\.' src --include='*.ts' | grep -E '\.claudeDir|\.claudeJson|\.claudeProjectsDir|\.infraSnapshot' | grep -v '\.claude\.'
```

Expected: no output. Any line here is a missed call site — fix before proceeding.

- [ ] **Step 3: Confirm benchmark assert regexes still match**

The `app-paths` task assert (`userData|claudeDir|migrations`) still matches because `claudeDir` appears as a property name inside `ClaudePaths` in the refactored file. The `verbose-paths` assert (`userData|migrations|claude`) still matches because `claude:` is now a top-level key in `AppPaths`. No change to `tasks.ts` needed — verify with eyes on the file.

```bash
grep -n 'assert' src/main/services/benchmark/tasks.ts
```

Expected output includes:
```
assert: { type: 'regex', value: 'userData|claudeDir|migrations' },
assert: { type: 'regex', value: 'userData|migrations|claude' },
```

Both still valid. No edit needed.

---

## Risks and Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| **Missed call site** — a file accesses `appPaths().claudeDir` that wasn't caught by grep | Low | TypeScript deletes the old fields from `AppPaths` → compile error at Task 1 Step 2 surface all broken sites before any caller is edited |
| **`tasks.ts` benchmark assert drift** — LLM output about `paths.ts` no longer matches assert regex | None | `claudeDir` still appears as a field name inside `ClaudePaths` in the refactored file; any LLM describing the file will still mention it; `claude` as a key matches the `verbose-paths` assert as well or better |
| **Dynamic property access** — code does `paths[key]` with a string key and TypeScript misses it | None | Grep confirmed all accesses are static dot-notation; no dynamic indexing anywhere |
| **`analyticsBufferDir` not moved** — inconsistency: it's a Claude-adjacent path but stays in `AppPaths` | Intentional | It lives in `~/agent-analytics` (not inside `~/.claude`), the user's explicit list of 4 fields to extract excludes it, and its conceptual owner is the analytics buffer system not the Claude install |
| **No test file for `paths.ts`** | Known | No test regressions possible; TypeScript is the sole safety net — relied upon at every step |
