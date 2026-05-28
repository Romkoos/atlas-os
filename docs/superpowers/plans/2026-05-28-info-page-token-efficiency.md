# INFO page — Token Efficiency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new INFO page in Atlas explaining the Token Efficiency metric (formulas, data sources, live baseline diagnostics) to a mathematically literate external reader.

**Architecture:** New nav slot `04 · INFO` between PRODUCTIVITY and SKILLS. Page renders 12 sections (KaTeX formulas + 3 live data cards) backed by a single new tRPC endpoint `productivity.kpiDiagnostics`. No DB migrations; the metric formulas are NOT changed — only described.

**Tech Stack:** TypeScript, React, Electron renderer, tRPC, Drizzle SQLite, KaTeX (new), Recharts (existing, unused on this page for now), Vitest.

**Spec:** `docs/superpowers/specs/2026-05-28-info-page-token-efficiency-design.md` — authoritative source for Russian prose, formulas, and section structure. This plan does NOT re-paste full Russian content; the executing agent COPIES from the spec.

---

## File Structure

**Backend (main):**

- Modify `src/shared/kpi.ts` — add `r2LogScale`, `medianAbsResidualPct`.
- Modify `src/shared/kpi.test.ts` — tests for new helpers.
- Modify `src/main/services/productivity/baseline.ts` — export `getScopedSessions(projectPath?) → ScopedSession[]` (gathers + sorts; reused by router and new endpoint).
- Modify `src/main/trpc/routers/productivity.ts` — add `kpiDiagnostics` procedure; refactor existing `scopedKpdRows` to call `getScopedSessions`.

**Frontend (renderer):**

- Modify `src/renderer/src/store/ui.ts` — add `'info'` to `Section` union.
- Modify `src/renderer/src/components/layout/nav.ts` — insert `info` at index 3 (slot `04`), shift `skills→05`, `settings→06`.
- Modify `src/renderer/src/App.tsx` — register `Info` in `PAGES`.
- Modify `src/renderer/src/index.css` — `@import 'katex/dist/katex.min.css'`.
- Create `src/renderer/src/pages/Info.tsx` — page parent: layout + secondary nav + section assembly.
- Create `src/renderer/src/pages/info/Section.tsx` — section wrapper (anchor id, h3 heading).
- Create `src/renderer/src/pages/info/Formula.tsx` — KaTeX inline/block wrapper.
- Create `src/renderer/src/pages/info/DataCard.tsx` — key-value card for live data.
- Create `src/renderer/src/pages/info/sections/intro.tsx` (§4.1)
- Create `src/renderer/src/pages/info/sections/data-sources.tsx` (§4.2)
- Create `src/renderer/src/pages/info/sections/storage.tsx` (§4.3)
- Create `src/renderer/src/pages/info/sections/baseline.tsx` (§4.4 — LIVE)
- Create `src/renderer/src/pages/info/sections/per-session.tsx` (§4.5)
- Create `src/renderer/src/pages/info/sections/daily.tsx` (§4.6)
- Create `src/renderer/src/pages/info/sections/reliability.tsx` (§4.7 — LIVE)
- Create `src/renderer/src/pages/info/sections/out-of-scope.tsx` (§4.8)
- Create `src/renderer/src/pages/info/sections/caveats.tsx` (§4.9)
- Create `src/renderer/src/pages/info/sections/data-inventory.tsx` (§4.10 — LIVE)
- Create `src/renderer/src/pages/info/sections/code-refs.tsx` (§4.11)
- Create `src/renderer/src/pages/info/sections/coming-soon.tsx` (§4.12)

**Package:**

- Modify `package.json` + `pnpm-lock.yaml` — add `katex`, `react-katex`, `@types/react-katex` (dev).

---

## Notes for the executing agent

- **Russian prose.** All user-facing strings in `pages/info/**` are in Russian. Translate freely from the spec's `§4.x` blocks; the spec is authoritative for content. Code identifiers stay English.
- **Math identifiers.** Eff, baseline, scope, files, dirs, expected, actual — use English in formulas and code, Russian only in surrounding prose.
- **Style.** Reuse existing CSS variables (`--color-fg`, `--color-muted-fg`, `--color-border`, `--color-chart-1..4`) and classes (`.panel`, `.kv`, `.page-head`). No new design tokens.
- **DO NOT** change `src/shared/kpi.ts` formulas — only ADD new helpers.
- **DO NOT** touch `src/renderer/src/pages/Productivity.tsx` token efficiency chart.

---

## Task 1: Math helper — `r2LogScale`

**Files:**
- Modify: `src/shared/kpi.ts`
- Test: `src/shared/kpi.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/shared/kpi.test.ts` (after existing `describe` blocks):

```typescript
import { medianAbsResidualPct, r2LogScale } from '@shared/kpi'

describe('r2LogScale', () => {
  it('returns null when fewer than 3 samples', () => {
    const m = fitBaseline(
      Array.from({ length: 10 }, (_, i) => sample(i + 1, 1, 5000 * (i + 1))),
    ) as BaselineModel
    expect(r2LogScale([], m)).toBeNull()
    expect(r2LogScale([sample(1, 1, 100), sample(2, 1, 200)], m)).toBeNull()
  })

  it('returns null for global-median method (no log-scale predictor)', () => {
    const m: BaselineModel = { method: 'global-median', params: { median: 1000 } }
    const samples = Array.from({ length: 10 }, () => sample(2, 1, 1000))
    expect(r2LogScale(samples, m)).toBeNull()
  })

  it('approaches 1 for tokens generated from the same scope model', () => {
    // Generate samples that perfectly fit a chosen (a, bFiles, bDirs).
    const a = 5
    const bF = 1.2
    const bD = 0.4
    const samples: BaselineSample[] = []
    for (let i = 1; i <= 12; i++) {
      const files = i
      const dirs = 1 + (i % 4)
      const tokens = Math.exp(a + bF * Math.log1p(files) + bD * Math.log1p(dirs))
      samples.push({ files, dirs, tokens })
    }
    const m = fitBaseline(samples) as BaselineModel
    expect(m.method).toBe('scope')
    const r2 = r2LogScale(samples, m) as number
    expect(r2).toBeGreaterThan(0.999)
  })

  it('reports a low R² when tokens are essentially noise', () => {
    // Same scope for every sample → predictors carry zero information.
    const tokens = [100, 5000, 200, 800, 3000, 50, 7000, 120, 4500, 230]
    const samples = tokens.map((t) => sample(2, 1, t))
    const m = fitBaseline(samples)
    // With no scope variation we get global-median; verify the null contract.
    expect(m?.method).toBe('global-median')
    expect(r2LogScale(samples, m as BaselineModel)).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/shared/kpi.test.ts`
Expected: FAIL with `r2LogScale is not a function` (or `undefined is not a function`).

- [ ] **Step 3: Implement `r2LogScale`**

Append to `src/shared/kpi.ts` (after `rollingMedian`, before `KpdDaySession` interface):

```typescript
// In-sample R² on log(actual tokens) for the scope model. Returns null when:
// - method is global-median (no log-scale linear predictor exists);
// - fewer than 3 valid samples;
// - the model is missing scope params.
// Formula: 1 − Σ(yᵢ − ŷᵢ)² / Σ(yᵢ − ȳ)²
// where yᵢ = log(tokensᵢ) and ŷᵢ = a + bFiles·log1p(filesᵢ) + bDirs·log1p(dirsᵢ).
export function r2LogScale(samples: BaselineSample[], model: BaselineModel): number | null {
  if (model.method !== 'scope') return null
  const { a, bFiles, bDirs } = model.params
  if (a == null || bFiles == null || bDirs == null) return null
  const valid = samples.filter((s) => s.tokens > 0)
  if (valid.length < 3) return null
  const ys = valid.map((s) => Math.log(s.tokens))
  const yBar = ys.reduce((acc, y) => acc + y, 0) / ys.length
  let ssRes = 0
  let ssTot = 0
  for (let i = 0; i < valid.length; i++) {
    const s = valid[i]
    const yHat = a + bFiles * log1p(s.files) + bDirs * log1p(s.dirs)
    ssRes += (ys[i] - yHat) ** 2
    ssTot += (ys[i] - yBar) ** 2
  }
  if (ssTot === 0) return null
  return 1 - ssRes / ssTot
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/shared/kpi.test.ts`
Expected: all `r2LogScale` tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/kpi.ts src/shared/kpi.test.ts
git commit -m "feat(kpi): add r2LogScale for scope-baseline goodness-of-fit"
```

---

## Task 2: Math helper — `medianAbsResidualPct`

**Files:**
- Modify: `src/shared/kpi.ts`
- Test: `src/shared/kpi.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/shared/kpi.test.ts`:

```typescript
describe('medianAbsResidualPct', () => {
  it('returns null when no valid samples or expected is non-positive', () => {
    const m = fitBaseline(
      Array.from({ length: 10 }, (_, i) => sample(i + 1, 1, 5000 * (i + 1))),
    ) as BaselineModel
    expect(medianAbsResidualPct([], m)).toBeNull()
    expect(medianAbsResidualPct([sample(1, 1, 0)], m)).toBeNull()
  })

  it('returns 0 when actual == expected for every sample (perfect fit)', () => {
    const a = 5
    const bF = 1.2
    const bD = 0.4
    const samples: BaselineSample[] = []
    for (let i = 1; i <= 12; i++) {
      const files = i
      const dirs = 1 + (i % 4)
      const tokens = Math.exp(a + bF * Math.log1p(files) + bD * Math.log1p(dirs))
      samples.push({ files, dirs, tokens })
    }
    const m = fitBaseline(samples) as BaselineModel
    const med = medianAbsResidualPct(samples, m) as number
    expect(med).toBeLessThan(0.01)
  })

  it('reports the median of |actual − expected| / expected × 100', () => {
    // expected for every sample = stored median (global-median model).
    const m: BaselineModel = { method: 'global-median', params: { median: 1000 } }
    const samples = [
      sample(0, 0, 800),   // 20%
      sample(0, 0, 1500),  // 50%
      sample(0, 0, 900),   // 10%
      sample(0, 0, 1200),  // 20%
      sample(0, 0, 1100),  // 10%
    ]
    const med = medianAbsResidualPct(samples, m) as number
    // sorted absolute residual %: [10, 10, 20, 20, 50] → median = 20
    expect(med).toBeCloseTo(20, 6)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/shared/kpi.test.ts`
Expected: FAIL with `medianAbsResidualPct is not a function`.

- [ ] **Step 3: Implement `medianAbsResidualPct`**

Append to `src/shared/kpi.ts` directly after `r2LogScale`:

```typescript
// Median absolute residual as a percentage of expected: median(|actual − expected| / expected × 100).
// "Typical fit error" in linear token space — easier to interpret than R² on logs.
// Returns null on empty input or when no sample has positive actual + expected.
export function medianAbsResidualPct(
  samples: BaselineSample[],
  model: BaselineModel,
): number | null {
  const pcts: number[] = []
  for (const s of samples) {
    if (!(s.tokens > 0)) continue
    const expected = expectedTokens(model, { files: s.files, dirs: s.dirs })
    if (expected == null || expected <= 0) continue
    pcts.push((Math.abs(s.tokens - expected) / expected) * 100)
  }
  if (pcts.length === 0) return null
  return medianOf(pcts)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/shared/kpi.test.ts`
Expected: all `medianAbsResidualPct` tests PASS, prior tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/shared/kpi.ts src/shared/kpi.test.ts
git commit -m "feat(kpi): add medianAbsResidualPct (typical baseline error %)"
```

---

## Task 3: Expose `getScopedSessions` helper

`scopedKpdRows` in the productivity router currently inlines the SQL aggregation that builds `ScopedSession[]`. The new `kpiDiagnostics` endpoint needs the same list (for `selectBaselineSamples` and `dataInventory`). Extract the SQL-touching helper into the baseline service.

**Files:**
- Modify: `src/main/services/productivity/baseline.ts`
- Modify: `src/main/trpc/routers/productivity.ts`

- [ ] **Step 1: Add `getScopedSessions` to baseline service**

Append to `src/main/services/productivity/baseline.ts`:

```typescript
import { agentSessions, agentTurns } from '@main/db/schema'
import { db } from '@main/db/client'
import { getSettings } from '@main/store'
import { eq, inArray, sql } from 'drizzle-orm'

// Tracked-projects filter. Mirrors the helper in productivity router.
function trackedProjects(): string[] {
  return getSettings().trackedProjects ?? []
}

// All scope-filtered agent sessions, with derived `lastTs` from agent_turns and
// `tokens = totalTokensIn + totalTokensOut`. Sorted ASCENDING by lastTs (the
// order baseline freezing and rolling-window logic depend on).
// Sessions with no recorded turns are excluded.
export function getScopedSessions(projectPath?: string): ScopedSession[] {
  const tracked = trackedProjects()
  const scopeFilter = projectPath
    ? eq(agentSessions.projectPath, projectPath)
    : tracked.length
      ? inArray(agentSessions.projectPath, tracked)
      : undefined

  const turnAgg = db()
    .select({
      id: agentTurns.sessionId,
      lastTs: sql<number>`max(${agentTurns.ts})`,
    })
    .from(agentTurns)
    .groupBy(agentTurns.sessionId)
    .all()
  const aggById = new Map(turnAgg.map((r) => [r.id, r]))

  const sessRows = db()
    .select({
      id: agentSessions.sessionId,
      difficulty: agentSessions.difficulty,
      files: agentSessions.distinctFiles,
      dirs: agentSessions.distinctDirs,
      score: agentSessions.score,
      tin: agentSessions.totalTokensIn,
      tout: agentSessions.totalTokensOut,
    })
    .from(agentSessions)
    .where(scopeFilter)
    .all()

  const rows: ScopedSession[] = sessRows.flatMap((r) => {
    const agg = aggById.get(r.id)
    if (!agg) return []
    return [
      {
        id: r.id,
        difficulty: r.difficulty,
        files: r.files,
        dirs: r.dirs,
        tokens: r.tin + r.tout,
        score: r.score,
        lastTs: Number(agg.lastTs),
      },
    ]
  })
  rows.sort((a, b) => a.lastTs - b.lastTs)
  return rows
}
```

- [ ] **Step 2: Use the helper from the router**

In `src/main/trpc/routers/productivity.ts`, replace the SQL-touching block inside `scopedKpdRows` with a call to `getScopedSessions`. Keep the per-row `day` derivation (compute `day` from `lastTs` locally — the helper doesn't return it):

```typescript
import { ensureBaseline, getScopedSessions, rebaseline as refitBaseline, type ScopedSession } from '@main/services/productivity/baseline'

// existing imports stay

function scopedKpdRows(projectPath?: string): KpdRow[] {
  const rows = getScopedSessions(projectPath)
  const model = ensureBaseline(rows, projectPath)
  return rows.map((r) => {
    const day = new Date(r.lastTs).toLocaleDateString('sv-SE') // 'YYYY-MM-DD' local
    const expected = model ? expectedTokens(model, { files: r.files, dirs: r.dirs }) : null
    const kpd = sessionKpd(expected, r.tokens)
    return { ...r, day, expected, kpd }
  })
}
```

> **Note for the agent:** Verify the original `day` derivation was a SQLite `date(... 'localtime')` string in `YYYY-MM-DD` format. The replacement uses `toLocaleDateString('sv-SE')` which produces the same `YYYY-MM-DD` shape in any locale (`sv-SE` is the ISO-date-friendly trick). If you find a project-local helper for "local day from ms epoch", prefer that.

Remove the inline SQL gathering code that the new helper replaces.

- [ ] **Step 3: Run typecheck + tests**

Run: `pnpm typecheck && pnpm test`
Expected: both green.

- [ ] **Step 4: Commit**

```bash
git add src/main/services/productivity/baseline.ts src/main/trpc/routers/productivity.ts
git commit -m "refactor(productivity): extract getScopedSessions helper for reuse"
```

---

## Task 4: tRPC procedure — `productivity.kpiDiagnostics`

**Files:**
- Modify: `src/main/trpc/routers/productivity.ts`

- [ ] **Step 1: Add the procedure**

Add the following procedure to `productivityRouter` in `src/main/trpc/routers/productivity.ts` (place it directly after the existing `kpi` procedure for locality):

```typescript
import {
  expectedTokens,
  kpdByDay,
  medianAbsResidualPct,
  r2LogScale,
  sessionKpd,
} from '@shared/kpi'
import { agentSessions, agentTurns, ecosystemChanges } from '@main/db/schema'
import { selectBaselineSamples, getActiveBaseline, scopeKey } from '@main/services/productivity/baseline'
import { count, max, min, sum, sql } from 'drizzle-orm'

// existing imports stay; only add what's missing above

  kpiDiagnostics: publicProcedure
    .input(
      z
        .object({ projectPath: z.string().optional() })
        .optional()
        .default({}),
    )
    .output(
      z.object({
        baseline: z
          .object({
            scope: z.string(),
            method: z.enum(['scope', 'global-median']),
            params: z.object({
              a: z.number().optional(),
              bFiles: z.number().optional(),
              bDirs: z.number().optional(),
              median: z.number().optional(),
            }),
            periodStart: z.number().nullable(),
            periodEnd: z.number().nullable(),
            sessionCount: z.number(),
            createdAt: z.number(),
          })
          .nullable(),
        fit: z.object({
          r2LogScale: z.number().nullable(),
          samplesUsed: z.number(),
          medianAbsResidualPct: z.number().nullable(),
          samplesPreview: z.array(
            z.object({
              files: z.number(),
              dirs: z.number(),
              actualTokens: z.number(),
              expectedTokens: z.number(),
            }),
          ),
        }),
        dataInventory: z.object({
          sessionsTotal: z.number(),
          sessionsWithScope: z.number(),
          sessionsWithScore: z.number(),
          sessionsWithDifficulty: z.number(),
          turnsTotal: z.number(),
          tokensInTotal: z.number(),
          tokensOutTotal: z.number(),
          ecosystemChangesTotal: z.number(),
          earliestSessionTs: z.number().nullable(),
          latestSessionTs: z.number().nullable(),
        }),
      }),
    )
    .query(({ input }) => {
      const projectPath = input?.projectPath
      const sessions = getScopedSessions(projectPath)
      const model = ensureBaseline(sessions, projectPath)
      const used = selectBaselineSamples(sessions)
      const usedSamples = used.map((s) => ({ files: s.files, dirs: s.dirs, tokens: s.tokens }))

      let baselineOut: {
        scope: string
        method: 'scope' | 'global-median'
        params: { a?: number; bFiles?: number; bDirs?: number; median?: number }
        periodStart: number | null
        periodEnd: number | null
        sessionCount: number
        createdAt: number
      } | null = null
      if (model) {
        const row = db()
          .select()
          .from(kpiBaseline)
          .where(eq(kpiBaseline.scope, scopeKey(projectPath)))
          .orderBy(desc(kpiBaseline.createdAt))
          .limit(1)
          .get()
        if (row) {
          baselineOut = {
            scope: row.scope,
            method: row.method as 'scope' | 'global-median',
            params: row.params,
            periodStart: row.periodStart ? row.periodStart.getTime() : null,
            periodEnd: row.periodEnd ? row.periodEnd.getTime() : null,
            sessionCount: row.sessionCount,
            createdAt: row.createdAt.getTime(),
          }
        }
      }

      const fit = {
        r2LogScale: model ? r2LogScale(usedSamples, model) : null,
        samplesUsed: used.length,
        medianAbsResidualPct: model ? medianAbsResidualPct(usedSamples, model) : null,
        samplesPreview: used.slice(0, 50).map((s) => {
          const exp = model ? expectedTokens(model, { files: s.files, dirs: s.dirs }) : null
          return {
            files: s.files,
            dirs: s.dirs,
            actualTokens: s.tokens,
            expectedTokens: exp ?? 0,
          }
        }),
      }

      // Data inventory — counted over the same scope filter (or all tracked).
      const tracked = (getSettings().trackedProjects ?? []) as string[]
      const scopeWhere = projectPath
        ? eq(agentSessions.projectPath, projectPath)
        : tracked.length
          ? inArray(agentSessions.projectPath, tracked)
          : undefined

      const inv = db()
        .select({
          sessionsTotal: count(agentSessions.sessionId),
          sessionsWithScope: sql<number>`sum(case when ${agentSessions.distinctFiles} > 0 or ${agentSessions.distinctDirs} > 0 then 1 else 0 end)`,
          sessionsWithScore: sql<number>`sum(case when ${agentSessions.score} is not null then 1 else 0 end)`,
          sessionsWithDifficulty: sql<number>`sum(case when ${agentSessions.difficulty} is not null then 1 else 0 end)`,
          turnsTotal: sql<number>`sum(${agentSessions.turnCount})`,
          tokensInTotal: sql<number>`sum(${agentSessions.totalTokensIn})`,
          tokensOutTotal: sql<number>`sum(${agentSessions.totalTokensOut})`,
        })
        .from(agentSessions)
        .where(scopeWhere)
        .get()

      // Earliest / latest from sessions list (already gathered above with lastTs).
      const earliestSessionTs = sessions.length ? sessions[0].lastTs : null
      const latestSessionTs = sessions.length ? sessions[sessions.length - 1].lastTs : null

      const ecoTotal =
        db()
          .select({ n: count(ecosystemChanges.id) })
          .from(ecosystemChanges)
          .get()?.n ?? 0

      return {
        baseline: baselineOut,
        fit,
        dataInventory: {
          sessionsTotal: Number(inv?.sessionsTotal ?? 0),
          sessionsWithScope: Number(inv?.sessionsWithScope ?? 0),
          sessionsWithScore: Number(inv?.sessionsWithScore ?? 0),
          sessionsWithDifficulty: Number(inv?.sessionsWithDifficulty ?? 0),
          turnsTotal: Number(inv?.turnsTotal ?? 0),
          tokensInTotal: Number(inv?.tokensInTotal ?? 0),
          tokensOutTotal: Number(inv?.tokensOutTotal ?? 0),
          ecosystemChangesTotal: Number(ecoTotal),
          earliestSessionTs,
          latestSessionTs,
        },
      }
    }),
```

> **Note for the agent:** `kpiBaseline` is already imported in the file (it's referenced by other procedures). If not, import it from `@main/db/schema`.

- [ ] **Step 2: Verify typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both green. If lint complains about import order, run `pnpm exec biome check --write src/main/trpc/routers/productivity.ts`.

- [ ] **Step 3: Smoke-test the endpoint in dev**

Run: `pnpm dev`
In the Electron window, open DevTools (`Cmd+Opt+I`), and in the console run:

```javascript
// tRPC client is available via window.atlas or via the trpc react hook tree;
// the simplest smoke: navigate to the Productivity page so the existing kpi
// query fires, then call the new endpoint via the existing trpc client:
window.__trpcClient?.productivity.kpiDiagnostics.query()
  .then((r) => console.log('diagnostics', r))
```

If `__trpcClient` isn't exposed, skip the console smoke and rely on the next task's UI to validate. Verify in the renderer's React Query DevTools (or just open the Info page in Task 12) that the response shape matches the spec §3 interface.

Expected: response contains `baseline` (probably non-null on your dev DB), `fit.r2LogScale` a number in [0, 1], `dataInventory.sessionsTotal > 0`.

- [ ] **Step 4: Commit**

```bash
git add src/main/trpc/routers/productivity.ts
git commit -m "feat(productivity): add kpiDiagnostics tRPC procedure"
```

---

## Task 5: Nav slot + empty `Info` page

**Files:**
- Modify: `src/renderer/src/store/ui.ts`
- Modify: `src/renderer/src/components/layout/nav.ts`
- Modify: `src/renderer/src/App.tsx`
- Create: `src/renderer/src/pages/Info.tsx`

- [ ] **Step 1: Extend `Section` type**

In `src/renderer/src/store/ui.ts`, update:

```typescript
export type Section = 'dashboard' | 'stats' | 'productivity' | 'info' | 'skills' | 'settings'
```

- [ ] **Step 2: Insert nav item**

In `src/renderer/src/components/layout/nav.ts`, update `NAV`:

```typescript
export const NAV: ReadonlyArray<NavItem> = [
  { id: 'dashboard', key: '01', label: 'DASHBOARD' },
  { id: 'stats', key: '02', label: 'STATS' },
  { id: 'productivity', key: '03', label: 'PRODUCTIVITY' },
  { id: 'info', key: '04', label: 'INFO' },
  { id: 'skills', key: '05', label: 'SKILLS' },
  { id: 'settings', key: '06', label: 'SETTINGS' },
]
```

- [ ] **Step 3: Create empty Info page**

Create `src/renderer/src/pages/Info.tsx`:

```tsx
import { PageHeader } from '@renderer/components/layout/PageHeader'

export function Info() {
  return (
    <div className="page">
      <PageHeader num="04" title="info" description="Token Efficiency — методика, данные, формулы" />
      <div className="panel mt-16">
        <div className="panel-body">
          <p style={{ color: 'var(--color-muted-fg)' }}>Страница в сборке.</p>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Register the page in App.tsx**

In `src/renderer/src/App.tsx`, update the imports and `PAGES`:

```tsx
import { Info } from '@renderer/pages/Info'

const PAGES: Record<Section, ComponentType> = {
  dashboard: Dashboard,
  stats: Stats,
  productivity: Productivity,
  info: Info,
  skills: Skills,
  settings: Settings,
}
```

- [ ] **Step 5: Run typecheck + dev smoke**

Run: `pnpm typecheck`
Expected: green.

Run: `pnpm dev`
Expected: sidebar shows 6 items, `04 · INFO` is visible, clicking it opens the placeholder page; `Cmd+4` opens INFO, `Cmd+5` opens SKILLS, `Cmd+6` opens SETTINGS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/store/ui.ts src/renderer/src/components/layout/nav.ts src/renderer/src/App.tsx src/renderer/src/pages/Info.tsx
git commit -m "feat(info): nav slot 04 + placeholder Info page"
```

---

## Task 6: Install KaTeX + create `Formula` and `DataCard` components

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml`
- Modify: `src/renderer/src/index.css`
- Create: `src/renderer/src/pages/info/Formula.tsx`
- Create: `src/renderer/src/pages/info/DataCard.tsx`

- [ ] **Step 1: Add dependencies**

Run:

```bash
pnpm add katex react-katex
pnpm add -D @types/react-katex
```

Verify `package.json` now lists `katex`, `react-katex` under `dependencies` and `@types/react-katex` under `devDependencies`.

- [ ] **Step 2: Import KaTeX CSS once**

In `src/renderer/src/index.css`, add at the top (after any reset, before app rules):

```css
@import 'katex/dist/katex.min.css';
```

- [ ] **Step 3: Create the Formula component**

Create `src/renderer/src/pages/info/Formula.tsx`:

```tsx
import { BlockMath, InlineMath } from 'react-katex'

// Inline:  <Formula tex="E = mc^2" />
// Block:   <Formula display tex="\\sum_{i=1}^n x_i" />
export function Formula({ tex, display = false }: { tex: string; display?: boolean }) {
  return display ? <BlockMath math={tex} /> : <InlineMath math={tex} />
}
```

- [ ] **Step 4: Create the DataCard component**

Create `src/renderer/src/pages/info/DataCard.tsx`:

```tsx
import type { ReactNode } from 'react'

export interface DataCardRow {
  label: string
  value: ReactNode
  hint?: string
}

// Reuses the existing .panel + .kv styles from sidebar/Settings.
// `loading` and `empty` are rendered as muted single-line messages.
export function DataCard({
  title,
  rows,
  loading,
  empty,
}: {
  title: string
  rows: DataCardRow[]
  loading?: boolean
  empty?: string | null
}) {
  return (
    <div className="panel mt-16">
      <div className="panel-head">
        <span className="ttl">{title}</span>
      </div>
      <div className="panel-body">
        {loading ? (
          <p style={{ color: 'var(--color-muted-fg)' }}>загружается…</p>
        ) : empty ? (
          <p style={{ color: 'var(--color-muted-fg)' }}>{empty}</p>
        ) : (
          <div className="kv" style={{ gridTemplateColumns: '220px 1fr' }}>
            {rows.map((r) => (
              <Fragment key={r.label}>
                <div className="k" title={r.hint}>
                  {r.label}
                </div>
                <div className="v tabular-nums">{r.value}</div>
              </Fragment>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
```

> Add `import { Fragment } from 'react'` at the top.

- [ ] **Step 5: Wire the Formula into the placeholder for a visual check**

In `src/renderer/src/pages/Info.tsx`, temporarily replace the body with:

```tsx
import { Formula } from '@renderer/pages/info/Formula'
import { PageHeader } from '@renderer/components/layout/PageHeader'

export function Info() {
  return (
    <div className="page">
      <PageHeader num="04" title="info" description="Token Efficiency — методика, данные, формулы" />
      <div className="panel mt-16">
        <div className="panel-body">
          <Formula display tex="\\text{Eff} = \\frac{\\text{expected}}{\\text{actual}} \\times 100\\%" />
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Run typecheck + dev**

Run: `pnpm typecheck && pnpm dev`
Expected: typecheck green. In the Info page, the formula renders via KaTeX (italic math font, proper fraction bar). If the formula renders as raw LaTeX, the CSS import is wrong — verify Step 2.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml src/renderer/src/index.css src/renderer/src/pages/info/Formula.tsx src/renderer/src/pages/info/DataCard.tsx src/renderer/src/pages/Info.tsx
git commit -m "feat(info): KaTeX + Formula + DataCard primitives"
```

---

## Task 7: Page layout + `Section` wrapper + intro + data-sources

**Files:**
- Create: `src/renderer/src/pages/info/Section.tsx`
- Create: `src/renderer/src/pages/info/sections/intro.tsx`
- Create: `src/renderer/src/pages/info/sections/data-sources.tsx`
- Modify: `src/renderer/src/pages/Info.tsx`

- [ ] **Step 1: Create Section wrapper**

Create `src/renderer/src/pages/info/Section.tsx`:

```tsx
import type { ReactNode } from 'react'

// Wrapper with anchor id + heading. The id is what the secondary-nav scrolls to.
export function Section({
  id,
  title,
  children,
}: {
  id: string
  title: string
  children: ReactNode
}) {
  return (
    <section id={id} className="info-section">
      <h3 className="info-h">
        <span style={{ color: 'var(--color-muted-fg)', marginRight: 8 }}>{`§ ${title.split('.')[0]}`}</span>
        {title.split('.').slice(1).join('.').trim()}
      </h3>
      {children}
    </section>
  )
}
```

(Spacing/CSS is handled in Step 4 below.)

- [ ] **Step 2: Create intro section**

Create `src/renderer/src/pages/info/sections/intro.tsx`. Use the Russian prose from spec §4.1:

```tsx
import { Section } from '@renderer/pages/info/Section'

export function Intro() {
  return (
    <Section id="intro" title="1. Зачем эта метрика">
      <p>
        Token Efficiency (Eff) измеряет, становится ли AI-агент эффективнее по мере того как
        пользователь меняет свою экосистему — плагины, MCP-серверы, скиллы, prompt'ы. Это
        отношение «сколько токенов вы потратили на задачу» к «сколько ожидали потратить на задачу
        такой же сложности по замороженному бейзлайну». 100% = на уровне бейзлайна. Выше — экономнее.
      </p>
    </Section>
  )
}
```

- [ ] **Step 3: Create data-sources section**

Create `src/renderer/src/pages/info/sections/data-sources.tsx`. Translate spec §4.2:

```tsx
import { Section } from '@renderer/pages/info/Section'

export function DataSources() {
  return (
    <Section id="data-sources" title="2. Источники данных">
      <p>Atlas собирает данные из трёх независимых источников:</p>
      <div className="kv mt-8" style={{ gridTemplateColumns: '220px 1fr', rowGap: 12 }}>
        <div className="k">Транскрипты Claude Code</div>
        <div className="v">
          <code>~/.claude/projects/**/*.jsonl</code> — источник истины для токенов, использованных
          тулз, файлов и скиллов. Парсер: <code>src/main/services/productivity/transcript.ts</code>.
        </div>
        <div className="k">JSONL-буфер хуков</div>
        <div className="v">
          <code>~/agent-analytics/sessions/&lt;id&gt;.jsonl</code> — лайфцикл сессий (start / end),
          пользовательская оценка score и summary через <code>/done</code>.
          Парсер: <code>src/main/services/productivity/jsonl.ts</code>.
        </div>
        <div className="k">Watcher экосистемы</div>
        <div className="v">
          Диффит <code>~/.claude/settings.json</code> (enabledPlugins), <code>~/.claude.json</code>{' '}
          (mcpServers / mcpServersDisabled) и mtimes файлов в <code>~/.claude/skills/</code>{' '}
          относительно сохранённого snapshot. Источник:{' '}
          <code>src/main/services/productivity/infra.ts</code>.
        </div>
      </div>
      <p className="mt-12" style={{ color: 'var(--color-muted-fg)' }}>
        Транскрипты — источник истины. При расхождении они выигрывают.
      </p>
    </Section>
  )
}
```

- [ ] **Step 4: Build Info page layout**

Replace `src/renderer/src/pages/Info.tsx` with:

```tsx
import { PageHeader } from '@renderer/components/layout/PageHeader'
import { Intro } from '@renderer/pages/info/sections/intro'
import { DataSources } from '@renderer/pages/info/sections/data-sources'

interface NavAnchor {
  id: string
  label: string
}

const ANCHORS: NavAnchor[] = [
  { id: 'intro', label: '1. Зачем эта метрика' },
  { id: 'data-sources', label: '2. Источники данных' },
  // remaining anchors appended in later tasks
]

export function Info() {
  return (
    <div className="page info-page">
      <PageHeader num="04" title="info" description="Token Efficiency — методика, данные, формулы" />
      <div className="info-grid">
        <nav className="info-nav">
          <ul>
            {ANCHORS.map((a) => (
              <li key={a.id}>
                <a href={`#${a.id}`}>{a.label}</a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="info-content">
          <Intro />
          <DataSources />
        </div>
      </div>
    </div>
  )
}
```

Add the page styles to `src/renderer/src/index.css`:

```css
.info-grid {
  display: grid;
  grid-template-columns: 240px 1fr;
  gap: 32px;
  align-items: start;
  margin-top: 16px;
}
.info-nav {
  position: sticky;
  top: 16px;
  align-self: start;
}
.info-nav ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.info-nav a {
  display: block;
  padding: 4px 8px;
  color: var(--color-muted-fg);
  text-decoration: none;
  border-left: 2px solid transparent;
  font-size: 13px;
}
.info-nav a:hover {
  color: var(--color-fg);
  border-left-color: var(--color-chart-1);
}
.info-content {
  max-width: 720px;
  display: flex;
  flex-direction: column;
  gap: 32px;
  line-height: 1.55;
}
.info-h {
  margin: 0 0 8px;
  font-weight: 600;
}
.info-section p { margin: 8px 0; }
.info-section code {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 0.92em;
  background: var(--color-border);
  padding: 1px 4px;
  border-radius: 3px;
}
.mt-8 { margin-top: 8px; }
.mt-12 { margin-top: 12px; }
```

- [ ] **Step 5: Verify**

Run: `pnpm dev`
Expected: INFO page shows two sections (intro + data sources) with the secondary nav on the left; clicking a nav item scrolls to that section.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/pages/info/Section.tsx src/renderer/src/pages/info/sections/intro.tsx src/renderer/src/pages/info/sections/data-sources.tsx src/renderer/src/pages/Info.tsx src/renderer/src/index.css
git commit -m "feat(info): page layout, secondary nav, intro + data-sources sections"
```

---

## Task 8: Storage section (§4.3)

**Files:**
- Create: `src/renderer/src/pages/info/sections/storage.tsx`
- Modify: `src/renderer/src/pages/Info.tsx`

- [ ] **Step 1: Create the section**

Create `src/renderer/src/pages/info/sections/storage.tsx`. Translate spec §4.3 (the table of tables). Structure:

```tsx
import { Section } from '@renderer/pages/info/Section'

export function Storage() {
  return (
    <Section id="storage" title="3. Что мы храним">
      <p>
        Все данные — в локальной SQLite по адресу{' '}
        <code>~/Library/Application Support/atlas-os/atlas.db</code>. Схема Drizzle:{' '}
        <code>src/main/db/schema.ts</code>.
      </p>

      <table className="info-table mt-12">
        <thead>
          <tr>
            <th>Таблица</th>
            <th>Что в ней</th>
            <th>Ключевые поля</th>
            <th>Источник</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>agent_turns</code></td>
            <td>один turn агента</td>
            <td><code>sessionId, ts, tokensIn, tokensOut, toolsUsed[], skillsUsed[], filesTouched[]</code></td>
            <td>транскрипт</td>
          </tr>
          <tr>
            <td><code>agent_sessions</code></td>
            <td>одна сессия (агрегат)</td>
            <td><code>score 1–10, difficulty 1–10, totalTokensIn/Out, turnCount, distinctFiles, distinctDirs, distinctTools, distinctSkills, subagentCount</code></td>
            <td>агрегат turns + хуки + ручной ввод</td>
          </tr>
          <tr>
            <td><code>ecosystem_changes</code></td>
            <td>одно изменение экосистемы</td>
            <td><code>ts, type, target, diff, note</code></td>
            <td>watcher + ручной ввод</td>
          </tr>
          <tr>
            <td><code>kpi_baseline</code></td>
            <td>замороженный бейзлайн per scope</td>
            <td><code>scope, method, params (JSON), periodStart/End, sessionCount, createdAt</code></td>
            <td>derived, freeze-on-first-use</td>
          </tr>
        </tbody>
      </table>

      <p className="mt-12" style={{ color: 'var(--color-muted-fg)' }}>
        id транскриптных turn'ов детерминированы (hash от sessionId + turnIndex). Повторный
        парсинг растущего файла идемпотентен — повторных строк не возникает.
      </p>
    </Section>
  )
}
```

Add table styles to `src/renderer/src/index.css`:

```css
.info-table {
  border-collapse: collapse;
  width: 100%;
  font-size: 13px;
}
.info-table th,
.info-table td {
  text-align: left;
  vertical-align: top;
  padding: 6px 10px;
  border-bottom: 1px solid var(--color-border);
}
.info-table th {
  color: var(--color-muted-fg);
  font-weight: 600;
}
.info-table code { font-size: 0.92em; }
```

- [ ] **Step 2: Add to Info page**

In `src/renderer/src/pages/Info.tsx`:
- Import: `import { Storage } from '@renderer/pages/info/sections/storage'`
- Append `{ id: 'storage', label: '3. Что мы храним' }` to `ANCHORS`
- Render `<Storage />` after `<DataSources />` in `info-content`

- [ ] **Step 3: Verify**

Run: `pnpm dev`
Expected: storage section visible, table renders cleanly, anchor scrolls correctly.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/pages/info/sections/storage.tsx src/renderer/src/pages/Info.tsx src/renderer/src/index.css
git commit -m "feat(info): storage section (DB tables overview)"
```

---

## Task 9: Baseline section (§4.4) with LIVE model card

**Files:**
- Create: `src/renderer/src/pages/info/sections/baseline.tsx`
- Modify: `src/renderer/src/pages/Info.tsx`

- [ ] **Step 1: Create the section**

Create `src/renderer/src/pages/info/sections/baseline.tsx`:

```tsx
import { trpc } from '@renderer/lib/trpc'
import { DataCard } from '@renderer/pages/info/DataCard'
import { Formula } from '@renderer/pages/info/Formula'
import { Section } from '@renderer/pages/info/Section'

const fmtDate = (ts: number | null): string => (ts == null ? '—' : new Date(ts).toISOString().slice(0, 10))
const fmtNum = (n: number | undefined, digits = 4): string => (n == null ? '—' : n.toFixed(digits))

export function Baseline() {
  const q = trpc.productivity.kpiDiagnostics.useQuery()
  const b = q.data?.baseline ?? null

  return (
    <Section id="baseline" title="4. Бейзлайн: модель ожидаемого">
      <h4 className="mt-12">(а) Постановка задачи</h4>
      <p>
        Прямое сравнение «токенов на сессию» бесполезно — токены растут с объёмом задачи. Нужна
        модель ожидаемого расхода <Formula tex="E[\text{tokens} \mid \text{task}]" />, и тогда
        Eff = ожидаемое / фактическое.
      </p>

      <h4 className="mt-12">(б) Выбор предикторов</h4>
      <ul>
        <li><b>Используются:</b> <code>files</code> — distinct files touched в сессии, <code>dirs</code> — distinct dirs touched.</li>
        <li><b>НЕ используются:</b> turns, tools used, skills used. Это эндогенные предикторы (поведение агента); нормализация по ним стёрла бы тот сигнал, который мы хотим измерять.</li>
        <li><b>НЕ используется difficulty (1–10):</b> оставлено как описательное поле сессии. Историческая loglinear по difficulty не работала — покрытие меньше 5% сессий.</li>
        <li><b>Эмпирически:</b> <code>files + dirs</code> объясняют ≈73% дисперсии <code>log(tokens)</code> на бейзлайн-периоде.</li>
      </ul>

      <h4 className="mt-12">(в) Формула регрессии</h4>
      <Formula
        display
        tex={String.raw`\log(\text{expected}_i) = a + b_{\text{files}} \cdot \log(1 + \text{files}_i) + b_{\text{dirs}} \cdot \log(1 + \text{dirs}_i)`}
      />
      <p>
        Подгонка — OLS на 3×3 нормальных уравнениях (метод Гаусса–Жордана), реализация —{' '}
        <code>ols2</code> в <code>src/shared/kpi.ts</code>. При сингулярной матрице (нулевая
        вариация предикторов или коллинеарность) подгонка отвергается, и срабатывает fallback.
      </p>

      <h4 className="mt-12">(г) Заморозка</h4>
      <ul>
        <li>
          Кандидаты: первые <Formula tex={String.raw`n^* = \max(15,\ \lceil 0.25 \cdot n \rceil)`} />{' '}
          сессий скоупа, отсортированные по <code>lastTs</code> возрастанию.
        </li>
        <li>Требуется <Formula tex={String.raw`n^* \geq 8`} /> для scope-метода, иначе fallback.</li>
        <li>После заморозки коэффициенты НЕ обновляются автоматически. Перезапись — только через явный rebaseline.</li>
      </ul>

      <h4 className="mt-12">(д) Fallback: глобальная медиана</h4>
      <Formula display tex={String.raw`\text{expected} = \mathrm{median}(\text{tokens}_i \mid i \in \text{baseline period})`} />
      <p>
        Скоуп игнорируется. Используется в первые дни проекта (n &lt; 8 или нет вариации scope) и
        для сессий без записанной информации о scope.
      </p>

      <h4 className="mt-12">(е) Актуальная модель</h4>
      <DataCard
        title="frozen baseline (live)"
        loading={q.isLoading}
        empty={b == null ? 'Бейзлайн ещё не зафиксирован — недостаточно сессий в скоупе.' : null}
        rows={
          b
            ? [
                { label: 'scope', value: <code>{b.scope}</code> },
                { label: 'method', value: <code>{b.method}</code> },
                { label: 'period', value: `${fmtDate(b.periodStart)} … ${fmtDate(b.periodEnd)}` },
                { label: 'sessions used (n*)', value: b.sessionCount },
                { label: 'a (intercept)', value: fmtNum(b.params.a) },
                { label: 'b_files', value: fmtNum(b.params.bFiles) },
                { label: 'b_dirs', value: fmtNum(b.params.bDirs) },
                { label: 'stored median (tokens)', value: b.params.median == null ? '—' : b.params.median.toFixed(0) },
                { label: 'frozen at', value: fmtDate(b.createdAt) },
              ]
            : []
        }
      />
    </Section>
  )
}
```

- [ ] **Step 2: Add to Info page**

In `src/renderer/src/pages/Info.tsx`:
- Import: `import { Baseline } from '@renderer/pages/info/sections/baseline'`
- Append `{ id: 'baseline', label: '4. Бейзлайн' }` to `ANCHORS`
- Render `<Baseline />` after `<Storage />` in `info-content`

- [ ] **Step 3: Verify**

Run: `pnpm dev`
Expected: baseline section renders, all formulas are typeset (no raw `\log`), and the "frozen baseline (live)" card shows real numbers from your DB. If the DB hasn't enough sessions yet, you'll see the empty-state message.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/pages/info/sections/baseline.tsx src/renderer/src/pages/Info.tsx
git commit -m "feat(info): baseline section with live frozen-model card"
```

---

## Task 10: Per-session + Daily sections (§4.5, §4.6)

**Files:**
- Create: `src/renderer/src/pages/info/sections/per-session.tsx`
- Create: `src/renderer/src/pages/info/sections/daily.tsx`
- Modify: `src/renderer/src/pages/Info.tsx`

- [ ] **Step 1: Create per-session section**

Create `src/renderer/src/pages/info/sections/per-session.tsx`. Translate spec §4.5:

```tsx
import { Formula } from '@renderer/pages/info/Formula'
import { Section } from '@renderer/pages/info/Section'

export function PerSession() {
  return (
    <Section id="per-session" title="5. Per-session Eff">
      <Formula display tex={String.raw`\mathrm{Eff}_i = \frac{\mathrm{expected}_i}{\mathrm{actual}_i} \times 100\%`} />
      <p>
        Min-work floor:{' '}
        <Formula tex={String.raw`\mathrm{Eff}_i = \text{null} \quad \text{если}\ \mathrm{actual}_i < \tfrac{1}{3} \cdot \mathrm{expected}_i`} />
      </p>
      <h4 className="mt-12">Зачем нужен floor</h4>
      <ul>
        <li>
          Без floor одна 17-токенная сессия даёт Eff ≈ 1 200 000% — это выбрасывает шкалу графика.
        </li>
        <li>
          Floor фракционный, не абсолютный — адаптируется под скоуп и сложность через{' '}
          <code>expected</code>.
        </li>
        <li>
          Floor математически бьёт потолок:{' '}
          <Formula tex={String.raw`\mathrm{Eff}_{\max} = \frac{1}{1/3} \times 100\% = 300\%`} />.
        </li>
        <li>
          Trade-off: ≈½ всех сессий имеют{' '}
          <Formula tex={String.raw`\mathrm{actual} < \mathrm{expected}/3`} /> и отбрасываются с
          графика Eff (но остаются на графике tokens per day).
        </li>
      </ul>
      <h4 className="mt-12">Edge cases</h4>
      <ul>
        <li><code>expected ≤ 0</code> или <code>actual ≤ 0</code> → null</li>
        <li>сессия без <code>files</code>/<code>dirs</code> → expected подсчитывается по сохранённому median (внутренний fallback scope-модели)</li>
      </ul>
      <p style={{ color: 'var(--color-muted-fg)' }}>
        Реализация: <code>sessionKpd</code> в <code>src/shared/kpi.ts</code>.
      </p>
    </Section>
  )
}
```

- [ ] **Step 2: Create daily section**

Create `src/renderer/src/pages/info/sections/daily.tsx`. Translate spec §4.6:

```tsx
import { Formula } from '@renderer/pages/info/Formula'
import { Section } from '@renderer/pages/info/Section'

export function Daily() {
  return (
    <Section id="daily" title="6. Дневной Eff и сглаживание">
      <p>
        Дневная агрегация <b>токен-взвешенная</b>, не среднее по сессиям:
      </p>
      <Formula
        display
        tex={String.raw`\mathrm{Eff}_d = \frac{\sum_{i \in d} \mathrm{expected}_i}{\sum_{i \in d} \mathrm{actual}_i} \times 100\%`}
      />
      <h4 className="mt-12">Почему не среднее ratio</h4>
      <ul>
        <li>Per-session Eff — это ratio с маленьким знаменателем. Несколько микросессий могут дать <Formula tex={String.raw`\mathrm{mean}(\mathrm{Eff}_i)`} /> = 800–58 000% на реальных данных.</li>
        <li>Токен-взвешивание делает вклад микросессии пропорциональным её размеру: 17-токенная сессия добавляет 17 в знаменатель и <code>expected(17)</code> в числитель.</li>
        <li>Проверено на реальной БД: 2026-05-03 58 240% → 92%, 2026-05-22 13 493% → 41%.</li>
      </ul>

      <h4 className="mt-12">Сглаживание</h4>
      <p>Главная линия графика — 7-day <b>trailing</b> median дневного Eff:</p>
      <Formula display tex={String.raw`\mathrm{EffSmooth}_d = \mathrm{median}\bigl(\mathrm{Eff}_{d-6},\ \ldots,\ \mathrm{Eff}_d\bigr)`} />
      <p>
        Окно усекается у начала истории. Сырая дневная линия рисуется тонкой/полупрозрачной фоном,
        smooth — главная. При фиксированном scope per-task token cost варьируется ≈×2.5 (irreducible
        noise — режим thinking, cache, разная глубина рассуждений). Trailing median (а не
        центрированный) сохраняет каузальность: сегодняшняя точка не зависит от будущего.
      </p>
      <p style={{ color: 'var(--color-muted-fg)' }}>
        Реализация: <code>kpdByDay</code>, <code>rollingMedian</code> в{' '}
        <code>src/shared/kpi.ts</code>.
      </p>
    </Section>
  )
}
```

- [ ] **Step 3: Add to Info page**

In `src/renderer/src/pages/Info.tsx`:
- Imports for both sections.
- Append anchors: `{ id: 'per-session', label: '5. Per-session Eff' }`, `{ id: 'daily', label: '6. Дневной Eff' }`.
- Render both after `<Baseline />`.

- [ ] **Step 4: Verify**

Run: `pnpm dev`
Expected: both sections render, all formulas typeset, anchors scroll.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/pages/info/sections/per-session.tsx src/renderer/src/pages/info/sections/daily.tsx src/renderer/src/pages/Info.tsx
git commit -m "feat(info): per-session + daily Eff sections"
```

---

## Task 11: Reliability section (§4.7) — LIVE goodness-of-fit + coverage

**Files:**
- Create: `src/renderer/src/pages/info/sections/reliability.tsx`
- Modify: `src/renderer/src/pages/Info.tsx`

- [ ] **Step 1: Create the section**

Create `src/renderer/src/pages/info/sections/reliability.tsx`. Translate spec §4.7:

```tsx
import { trpc } from '@renderer/lib/trpc'
import { DataCard } from '@renderer/pages/info/DataCard'
import { Section } from '@renderer/pages/info/Section'

const pct = (x: number | null): string => (x == null ? '—' : `${x.toFixed(2)}%`)
const r2Fmt = (x: number | null): string => (x == null ? '—' : x.toFixed(3))
const fmtCovPct = (num: number, denom: number): string =>
  denom === 0 ? '—' : `${num} / ${denom} (${((num / denom) * 100).toFixed(0)}%)`

export function Reliability() {
  const q = trpc.productivity.kpiDiagnostics.useQuery()
  const fit = q.data?.fit
  const inv = q.data?.dataInventory

  return (
    <Section id="reliability" title="7. Надёжность">
      <h4>(а) Качество подгонки</h4>
      <DataCard
        title="goodness-of-fit (live)"
        loading={q.isLoading}
        empty={fit == null ? 'нет данных' : null}
        rows={
          fit
            ? [
                {
                  label: 'R² (in-sample, log scale)',
                  value: r2Fmt(fit.r2LogScale),
                  hint: 'R² на обучающем периоде. Это не predictive R²; показывает, насколько модель описала свой бейзлайн.',
                },
                {
                  label: 'Median |residual| / expected',
                  value: pct(fit.medianAbsResidualPct),
                  hint: 'Типичная ошибка модели в линейном масштабе токенов.',
                },
                { label: 'Samples used (n*)', value: fit.samplesUsed },
              ]
            : []
        }
      />

      <h4 className="mt-16">(б) Покрытие данных</h4>
      <DataCard
        title="coverage (live)"
        loading={q.isLoading}
        empty={inv == null ? 'нет данных' : null}
        rows={
          inv
            ? [
                { label: 'sessions with score', value: fmtCovPct(inv.sessionsWithScore, inv.sessionsTotal) },
                { label: 'sessions with difficulty', value: fmtCovPct(inv.sessionsWithDifficulty, inv.sessionsTotal) },
                { label: 'sessions with scope (files+dirs > 0)', value: fmtCovPct(inv.sessionsWithScope, inv.sessionsTotal) },
              ]
            : []
        }
      />
      <p className="mt-8" style={{ color: 'var(--color-muted-fg)' }}>
        Сессии без записанной информации о scope получают expected по сохранённой median —
        иначе линия Eff схлопывалась бы только на скоуп-тегнутых днях.
      </p>

      <h4 className="mt-16">(в) Irreducible noise</h4>
      <ul>
        <li>
          <b>Cache hits/misses.</b> Eff считает суммарные <code>tokensIn + tokensOut</code>,
          кэш не различается. Холодный/горячий старт даёт ×2 разницу при одинаковом scope.
        </li>
        <li>
          <b>Extended thinking.</b> Thinking-токены входят в <code>tokensOut</code>. Сессии с
          thinking «дороже» при том же scope.
        </li>
        <li>
          <b>Autocompact.</b> Длинная сессия может включать autocompact, который мы не различаем
          в транскрипте.
        </li>
        <li>
          <b>Разные модели.</b> Модель сессии в схеме <code>agent_sessions</code> сейчас не
          сохраняется (см. <code>src/main/db/schema.ts</code>) — Eff трактует Opus и Haiku
          взаимозаменяемо, что неверно по факту.
        </li>
      </ul>

      <h4 className="mt-16">(г) Что НЕ входит в расчёт Eff</h4>
      <ul>
        <li><code>cacheReadTokens</code> / <code>cacheCreationTokens</code> — есть только в <code>benchmark_runs</code>, не в <code>agent_turns</code>.</li>
        <li><code>durationMs</code> / latency.</li>
        <li><code>score</code> (1–10) — отдельная guardrail-линия рядом, не мультипликатор.</li>
        <li>Ошибки агента, прерывания, rollback'и.</li>
      </ul>
    </Section>
  )
}
```

- [ ] **Step 2: Add to Info page**

In `src/renderer/src/pages/Info.tsx`:
- Import.
- Append `{ id: 'reliability', label: '7. Надёжность' }` to anchors.
- Render after `<Daily />`.

Also add a `.mt-16 { margin-top: 16px; }` rule to `src/renderer/src/index.css` if not already present.

- [ ] **Step 3: Verify**

Run: `pnpm dev`
Expected: reliability section renders, R² and coverage cards show real numbers. Check that R² is a value in [0, 1] (or `—` if `global-median`).

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/pages/info/sections/reliability.tsx src/renderer/src/pages/Info.tsx src/renderer/src/index.css
git commit -m "feat(info): reliability section with live R² + coverage"
```

---

## Task 12: Out-of-scope + Caveats sections (§4.8, §4.9)

**Files:**
- Create: `src/renderer/src/pages/info/sections/out-of-scope.tsx`
- Create: `src/renderer/src/pages/info/sections/caveats.tsx`
- Modify: `src/renderer/src/pages/Info.tsx`

- [ ] **Step 1: Create out-of-scope section**

Create `src/renderer/src/pages/info/sections/out-of-scope.tsx`. Translate spec §4.8:

```tsx
import { Section } from '@renderer/pages/info/Section'

export function OutOfScope() {
  return (
    <Section id="out-of-scope" title="8. Что мы НЕ измеряем">
      <ul>
        <li>
          <b>Качество вывода.</b> Eff не знает, был ли результат правильным. Для этого есть
          отдельная линия <code>quality</code> на графике — среднее <code>score</code> 1–10 за день,
          только по rated-сессиям.
        </li>
        <li>
          <b>Стоимость в долларах.</b> Atlas хранит <code>total_cost_usd</code> только для
          бенчмарка, не для агентских сессий.
        </li>
        <li>
          <b>Latency / human-time.</b> Время сессии не учитывается. Сессия 5 минут и 5 часов с
          одинаковыми токенами имеют одинаковый Eff.
        </li>
        <li>
          <b>Side-effects.</b> Eff не знает, сломал ли агент CI, прошли ли тесты, был ли rollback.
        </li>
        <li>
          <b>Cross-task transfer.</b> Eff усреднён по типам задач — типовой Slack-вопрос и
          месячный рефакторинг идут в одну корзину, если scope похож.
        </li>
      </ul>
    </Section>
  )
}
```

- [ ] **Step 2: Create caveats section**

Create `src/renderer/src/pages/info/sections/caveats.tsx`. Translate spec §4.9:

```tsx
import { Section } from '@renderer/pages/info/Section'

export function Caveats() {
  return (
    <Section id="caveats" title="9. Известные ограничения">
      <ul>
        <li>
          <b>Эндогенность.</b> Установка нового скилла может ↓ tokens не потому что агент стал
          эффективнее, а потому что задачи стали проще, или агент стал предпочитать короткие решения.
          Eff не различает «стал умнее» и «стал отговариваться». Бенчмарк-сьют — отдельная
          exogenous-проверка (раздел в разработке).
        </li>
        <li>
          <b>Замороженный бейзлайн стареет.</b> Atlas не обновляет бейзлайн автоматически. Если
          задачи за полгода систематически выросли по сложности, Eff будет дрейфовать вверх не
          из-за эффективности, а из-за выхода за пределы обучающего распределения. Рекомендация:
          rebaseline раз в N месяцев или при крупных изменениях характера работы.
        </li>
        <li>
          <b>Сезонность.</b> День недели / время суток в модели не учитываются.
        </li>
        <li>
          <b>Small-sample tail.</b> Per-session floor отбрасывает половину сессий из Eff-графика.
          Не баг: эти сессии слишком короткие, чтобы дать осмысленный ratio.
        </li>
        <li>
          <b>Difficulty.</b> Поле существует, но в формуле сейчас не участвует. Историческая
          причина — низкое покрытие.
        </li>
      </ul>
    </Section>
  )
}
```

- [ ] **Step 3: Add both to Info page**

In `src/renderer/src/pages/Info.tsx`:
- Imports for both.
- Append anchors: `{ id: 'out-of-scope', label: '8. Что мы НЕ измеряем' }`, `{ id: 'caveats', label: '9. Известные ограничения' }`.
- Render both after `<Reliability />`.

- [ ] **Step 4: Verify**

Run: `pnpm dev`
Expected: both sections render and scroll properly.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/pages/info/sections/out-of-scope.tsx src/renderer/src/pages/info/sections/caveats.tsx src/renderer/src/pages/Info.tsx
git commit -m "feat(info): out-of-scope + caveats sections"
```

---

## Task 13: Data inventory (§4.10, LIVE) + Code refs (§4.11) + Coming soon (§4.12)

**Files:**
- Create: `src/renderer/src/pages/info/sections/data-inventory.tsx`
- Create: `src/renderer/src/pages/info/sections/code-refs.tsx`
- Create: `src/renderer/src/pages/info/sections/coming-soon.tsx`
- Modify: `src/renderer/src/pages/Info.tsx`

- [ ] **Step 1: Create data-inventory section**

Create `src/renderer/src/pages/info/sections/data-inventory.tsx`:

```tsx
import { trpc } from '@renderer/lib/trpc'
import { DataCard } from '@renderer/pages/info/DataCard'
import { Section } from '@renderer/pages/info/Section'

const fmtInt = (n: number): string => n.toLocaleString('ru-RU')
const fmtDate = (ts: number | null): string => (ts == null ? '—' : new Date(ts).toISOString().slice(0, 10))

export function DataInventory() {
  const q = trpc.productivity.kpiDiagnostics.useQuery()
  const inv = q.data?.dataInventory

  return (
    <Section id="data-inventory" title="10. Полная инвентаризация данных">
      <DataCard
        title="inventory (live)"
        loading={q.isLoading}
        empty={inv == null ? 'нет данных' : null}
        rows={
          inv
            ? [
                { label: 'sessions total', value: fmtInt(inv.sessionsTotal) },
                { label: 'turns total', value: fmtInt(inv.turnsTotal) },
                { label: 'tokens in total', value: fmtInt(inv.tokensInTotal) },
                { label: 'tokens out total', value: fmtInt(inv.tokensOutTotal) },
                { label: 'period (earliest … latest)', value: `${fmtDate(inv.earliestSessionTs)} … ${fmtDate(inv.latestSessionTs)}` },
                { label: 'sessions with scope', value: fmtInt(inv.sessionsWithScope) },
                { label: 'sessions with user score', value: fmtInt(inv.sessionsWithScore) },
                { label: 'sessions with difficulty', value: fmtInt(inv.sessionsWithDifficulty) },
                { label: 'ecosystem changes total', value: fmtInt(inv.ecosystemChangesTotal) },
              ]
            : []
        }
      />
    </Section>
  )
}
```

- [ ] **Step 2: Create code-refs section**

Create `src/renderer/src/pages/info/sections/code-refs.tsx`. Translate spec §4.11:

```tsx
import { Section } from '@renderer/pages/info/Section'

const REFS: { path: string; what: string }[] = [
  { path: 'src/shared/kpi.ts', what: 'чистая математика: fitBaseline, expectedTokens, sessionKpd, kpdByDay, rollingMedian, r2LogScale, medianAbsResidualPct' },
  { path: 'src/main/services/productivity/baseline.ts', what: 'заморозка, активный бейзлайн, rebaseline, getScopedSessions' },
  { path: 'src/main/services/productivity/transcript.ts', what: 'парсинг транскриптов Claude Code' },
  { path: 'src/main/services/productivity/jsonl.ts', what: 'парсинг хуков (~/agent-analytics/sessions/)' },
  { path: 'src/main/services/productivity/infra.ts', what: 'watcher экосистемы (~/.claude/* diff vs snapshot)' },
  { path: 'src/main/trpc/routers/productivity.ts', what: 'tRPC эндпоинты: kpi, kpiDiagnostics, ecosystemImpact, rebaseline' },
]

export function CodeRefs() {
  return (
    <Section id="code-refs" title="11. Ссылки на код">
      <table className="info-table mt-8">
        <thead>
          <tr>
            <th>Файл</th>
            <th>Что внутри</th>
          </tr>
        </thead>
        <tbody>
          {REFS.map((r) => (
            <tr key={r.path}>
              <td><code>{r.path}</code></td>
              <td>{r.what}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  )
}
```

- [ ] **Step 3: Create coming-soon section**

Create `src/renderer/src/pages/info/sections/coming-soon.tsx`. Translate spec §4.12:

```tsx
import { Section } from '@renderer/pages/info/Section'

export function ComingSoon() {
  return (
    <Section id="coming-soon" title="12. В разработке">
      <p>Другие разделы инфостраницы будут добавлены позже:</p>
      <ul>
        <li>Tokens per day — что и как считаем по токенам в день, источники, надёжность.</li>
        <li>Today by hour — дневной профиль активности.</li>
        <li>
          Benchmark suite — независимая exogenous-проверка эффективности на замороженных задачах,
          параллельно к Token Efficiency.
        </li>
      </ul>
    </Section>
  )
}
```

- [ ] **Step 4: Add all three to Info page**

In `src/renderer/src/pages/Info.tsx`:
- Imports for `DataInventory`, `CodeRefs`, `ComingSoon`.
- Append anchors: `{ id: 'data-inventory', label: '10. Инвентаризация' }`, `{ id: 'code-refs', label: '11. Код' }`, `{ id: 'coming-soon', label: '12. В разработке' }`.
- Render all three after `<Caveats />`.

The full `ANCHORS` should now have 12 entries (1–12, matching spec §4 ids).

- [ ] **Step 5: Verify all sections render**

Run: `pnpm dev`
Expected: all 12 sections are visible, secondary nav has 12 items, anchor scroll works, all live cards (baseline, reliability ×2, data inventory) are populated.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/pages/info/sections/data-inventory.tsx src/renderer/src/pages/info/sections/code-refs.tsx src/renderer/src/pages/info/sections/coming-soon.tsx src/renderer/src/pages/Info.tsx
git commit -m "feat(info): data-inventory + code-refs + coming-soon sections"
```

---

## Task 14: Acceptance smoke + edge-case check

**Files:**
- Modify (if needed): any of the above files to fix issues found.

- [ ] **Step 1: Cold-start the app and walk the page**

Run: `pnpm dev`

Verify each acceptance item from spec §9:
1. Sidebar has 6 items. `04 · INFO` opens. `Cmd+1..6` jump correctly to dashboard/stats/productivity/info/skills/settings.
2. All 12 sections rendered, formulas KaTeX-correct (italic math font, proper fraction bars, no raw `\log`).
3. Live cards in §4.4(e), §4.7(a-b), §4.10 show real numbers from your DB.
4. Click each item in the secondary nav — it scrolls to the section.
5. No console errors (`Cmd+Opt+I`).

- [ ] **Step 2: Empty-DB edge case**

In a separate terminal, temporarily move the dev DB aside to simulate first launch:

```bash
mv "$HOME/Library/Application Support/atlas-os/atlas.db" "$HOME/Library/Application Support/atlas-os/atlas.db.bak"
```

Restart `pnpm dev`. Open the INFO page.

Expected:
- Baseline card shows "Бейзлайн ещё не зафиксирован".
- Reliability cards show — (em-dash) or "нет данных".
- Data inventory shows 0 / —.
- No JS errors.

Restore:

```bash
mv "$HOME/Library/Application Support/atlas-os/atlas.db.bak" "$HOME/Library/Application Support/atlas-os/atlas.db"
```

- [ ] **Step 3: Final typecheck + lint + tests**

Run:

```bash
pnpm lint && pnpm typecheck && pnpm test
```

Expected: all green.

- [ ] **Step 4: Commit any fixes**

If any issues were found and fixed:

```bash
git add -A
git commit -m "fix(info): address acceptance issues found in manual UAT"
```

If no fixes were needed, skip this step.

- [ ] **Step 5: Done**

Plan complete. Ready to present to the mathematician.
