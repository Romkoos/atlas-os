# Subscription Usage Gauge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a radial arc gauge to the dashboard KPI row showing real-time Claude subscription token usage for the current 5-hour rolling window, with a live countdown to reset.

**Architecture:** Read token sums from the existing `agentTurns` SQLite table (already populated by `ingest.ts`), expose a new `productivity.subscriptionWindow` tRPC query, render a 270° SVG arc gauge component in a new KPI tile, and add a plan-selector to Settings.

**Tech Stack:** Drizzle ORM (SQLite), tRPC + Zod, React, SVG (no extra deps)

## Global Constraints

- No new npm dependencies
- All UI strings English only
- SVG arc uses `stroke-dasharray` / `strokeDashoffset` — no canvas, no chart library
- Countdown updates client-side every second via `setInterval` — no server round-trip per tick
- Settings mutations use `trpc.settings.set.useMutation` + `utils.settings.get.invalidate()`
- Run `pnpm typecheck && pnpm lint` before every commit; fix all errors

---

## File Map

| File | Role |
|---|---|
| `src/shared/settings.ts` | Add `subscriptionPlan` enum, `subscriptionLimitCustom`, `SUBSCRIPTION_LIMITS` constant, `subscriptionLimitTokens()` helper |
| `src/main/trpc/routers/productivity.ts` | Add `subscriptionWindow` query procedure |
| `src/renderer/src/components/dashboard/UsageGauge.tsx` | **Create** — SVG arc gauge + countdown component |
| `src/renderer/src/index.css` | Add `.kpi.hero-tall`, `.kpi.gauge-tile`, `.usage-gauge` block, `gauge-pulse-glow` keyframe |
| `src/renderer/src/pages/Dashboard.tsx` | Swap `kpi hero` → `kpi hero-tall`, insert `<UsageGauge>` tile |
| `src/renderer/src/pages/Settings.tsx` | Add `SubscriptionCard` component and render it |

---

## Task 1: Settings schema — subscription plan fields

**Files:**
- Modify: `src/shared/settings.ts`

**Interfaces:**
- Produces:
  - `SUBSCRIPTION_PLANS` — `readonly ['pro', 'max5x', 'max20x', 'custom']`
  - `SubscriptionPlan` — union type
  - `SUBSCRIPTION_LIMITS` — `Record<'pro'|'max5x'|'max20x', number>`
  - `subscriptionLimitTokens(s)` — `(s: Pick<AppSettings, 'subscriptionPlan' | 'subscriptionLimitCustom'>) => number`
  - Updated `AppSettings` — includes `subscriptionPlan` and `subscriptionLimitCustom`

- [ ] **Step 1: Write the failing test**

Create `src/shared/settings.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  SUBSCRIPTION_LIMITS,
  SUBSCRIPTION_PLANS,
  subscriptionLimitTokens,
} from './settings'

describe('subscriptionLimitTokens', () => {
  it('returns the lookup value for known plans', () => {
    expect(subscriptionLimitTokens({ subscriptionPlan: 'pro', subscriptionLimitCustom: 99 }))
      .toBe(SUBSCRIPTION_LIMITS.pro)
    expect(subscriptionLimitTokens({ subscriptionPlan: 'max5x', subscriptionLimitCustom: 99 }))
      .toBe(SUBSCRIPTION_LIMITS.max5x)
    expect(subscriptionLimitTokens({ subscriptionPlan: 'max20x', subscriptionLimitCustom: 99 }))
      .toBe(SUBSCRIPTION_LIMITS.max20x)
  })

  it('returns subscriptionLimitCustom when plan is custom', () => {
    expect(subscriptionLimitTokens({ subscriptionPlan: 'custom', subscriptionLimitCustom: 12345 }))
      .toBe(12345)
  })

  it('SUBSCRIPTION_PLANS contains all four values', () => {
    expect(SUBSCRIPTION_PLANS).toEqual(['pro', 'max5x', 'max20x', 'custom'])
  })
})
```

- [ ] **Step 2: Run test — verify it fails**

```bash
pnpm vitest run src/shared/settings.test.ts
```

Expected: FAIL — `subscriptionLimitTokens` is not exported.

- [ ] **Step 3: Implement the settings changes**

Replace the content of `src/shared/settings.ts` with:

```ts
import { z } from 'zod'
import { CLAUDE_MODEL_IDS, DEFAULT_MODEL_ID } from './models'

export const THEMES = ['system', 'light', 'dark'] as const
export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const
export const GALAXY_EDGE_STYLES = ['lines', 'particles', 'pulse'] as const
export const SUBSCRIPTION_PLANS = ['pro', 'max5x', 'max20x', 'custom'] as const

export type Theme = (typeof THEMES)[number]
export type LogLevel = (typeof LOG_LEVELS)[number]
export type GalaxyEdgeStyle = (typeof GALAXY_EDGE_STYLES)[number]
export type SubscriptionPlan = (typeof SUBSCRIPTION_PLANS)[number]

// Estimated token limits per 5-hour rolling window.
// Anthropic does not publish exact numbers — adjust via Custom if needed.
export const SUBSCRIPTION_LIMITS: Record<Exclude<SubscriptionPlan, 'custom'>, number> = {
  pro: 50_000,
  max5x: 250_000,
  max20x: 1_000_000,
}

// Single source of truth for the settings shape (main store + renderer form).
export const settingsSchema = z.object({
  model: z.enum(CLAUDE_MODEL_IDS),
  outputDir: z.string().min(1, 'Choose an output folder'),
  theme: z.enum(THEMES),
  logLevel: z.enum(LOG_LEVELS),
  trackedProjects: z.array(z.string()),
  estimateDifficulty: z.boolean(),
  galaxyEdgeStyle: z.enum(GALAXY_EDGE_STYLES),
  subscriptionPlan: z.enum(SUBSCRIPTION_PLANS).default('pro'),
  subscriptionLimitCustom: z.number().int().positive().default(50_000),
})

export type AppSettings = z.infer<typeof settingsSchema>

export const DEFAULT_SETTINGS: Omit<AppSettings, 'outputDir'> = {
  model: DEFAULT_MODEL_ID,
  theme: 'system',
  logLevel: 'info',
  trackedProjects: [],
  estimateDifficulty: false,
  galaxyEdgeStyle: 'lines',
  subscriptionPlan: 'pro',
  subscriptionLimitCustom: 50_000,
}

/** Returns the token limit for the given settings, respecting the custom override. */
export function subscriptionLimitTokens(
  s: Pick<AppSettings, 'subscriptionPlan' | 'subscriptionLimitCustom'>,
): number {
  if (s.subscriptionPlan === 'custom') return s.subscriptionLimitCustom
  return SUBSCRIPTION_LIMITS[s.subscriptionPlan]
}
```

- [ ] **Step 4: Run test — verify it passes**

```bash
pnpm vitest run src/shared/settings.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors. If the store or renderer imports `AppSettings`, the two new optional-with-default fields are backward-compatible.

- [ ] **Step 6: Commit**

```bash
git add src/shared/settings.ts src/shared/settings.test.ts
git commit -m "feat: add subscription plan fields to settings schema"
```

---

## Task 2: tRPC `subscriptionWindow` procedure

**Files:**
- Modify: `src/main/trpc/routers/productivity.ts` (add one procedure before the closing `})`)

**Interfaces:**
- Consumes: `subscriptionLimitTokens` from `@shared/settings`, `getSettings` from `@main/store`, `agentTurns` table, `gte` from drizzle-orm, `sql` from drizzle-orm
- Produces:
  - `trpc.productivity.subscriptionWindow` query → `{ tokensUsed: number, windowStart: Date, windowReset: Date, limitTokens: number, fillPct: number }`

- [ ] **Step 1: Add the import at the top of the router**

In `src/main/trpc/routers/productivity.ts`, find the existing import line:

```ts
import { getSettings } from '@main/store'
```

Add `subscriptionLimitTokens` to the shared import. Find:

```ts
import { expectedTokens, kpdByDay, medianAbsResidualPct, r2LogScale, sessionKpd } from '@shared/kpi'
```

Add a new line directly after it:

```ts
import { subscriptionLimitTokens } from '@shared/settings'
```

- [ ] **Step 2: Add the procedure**

In `src/main/trpc/routers/productivity.ts`, find the last procedure before the closing `})` of the router. It ends with:

```ts
    }),
})
```

Insert the new procedure **before** the final `})`:

```ts
  // Rolling 5-hour subscription window: tokens consumed and time until reset.
  // The window starts at the timestamp of the earliest turn in the last 5 hours.
  // If there are no recent turns, windowStart = now and the gauge shows 0 usage.
  subscriptionWindow: publicProcedure
    .output(
      z.object({
        tokensUsed: z.number(),
        windowStart: z.date(),
        windowReset: z.date(),
        limitTokens: z.number(),
        fillPct: z.number(),
      }),
    )
    .query(() => {
      const WINDOW_MS = 5 * 60 * 60 * 1000
      const now = Date.now()
      const cutoff = new Date(now - WINDOW_MS)

      const settings = getSettings()
      const limitTokens = subscriptionLimitTokens(settings)

      // Earliest turn in the rolling window — sets the window start clock.
      const earliest = db()
        .select({ ts: agentTurns.ts })
        .from(agentTurns)
        .where(gte(agentTurns.ts, cutoff))
        .orderBy(agentTurns.ts)
        .limit(1)
        .get()

      const windowStart = earliest?.ts ?? new Date(now)
      const windowReset = new Date(windowStart.getTime() + WINDOW_MS)

      const totals = db()
        .select({
          tokensUsed: sql<number>`coalesce(sum(${agentTurns.tokensIn} + ${agentTurns.tokensOut}), 0)`,
        })
        .from(agentTurns)
        .where(gte(agentTurns.ts, cutoff))
        .get()

      const tokensUsed = Number(totals?.tokensUsed ?? 0)
      const fillPct = Math.min(100, (tokensUsed / limitTokens) * 100)

      return { tokensUsed, windowStart, windowReset, limitTokens, fillPct }
    }),
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors. The `gte` and `sql` operators are already imported in the file.

- [ ] **Step 4: Commit**

```bash
git add src/main/trpc/routers/productivity.ts
git commit -m "feat: add subscriptionWindow tRPC procedure"
```

---

## Task 3: `UsageGauge` component + CSS

**Files:**
- Create: `src/renderer/src/components/dashboard/UsageGauge.tsx`
- Modify: `src/renderer/src/index.css`

**Interfaces:**
- Consumes: `trpc.productivity.subscriptionWindow` (from Task 2)
- Produces: `<UsageGauge />` — zero-prop component, self-contained

**SVG arc geometry (reference):**
```
SIZE = 140   cx = cy = 70   RADIUS = 52
C    = 2π × 52 ≈ 326.7    (full circumference)
ARC  = C × 0.75 ≈ 245.0   (270° visible arc)
GAP  = C × 0.25 ≈  81.7   (90° gap, sits at bottom)
rotation = "rotate(135, 70, 70)"
  → gap centred at 6 o'clock; arc runs from ~7:30 to ~4:30 clockwise
fill strokeDasharray = "${fillLen} ${C - fillLen}"
  where fillLen = (fillPct / 100) * ARC
track strokeDasharray = "${ARC} ${GAP}"   (fixed)
```

- [ ] **Step 1: Write failing tests for pure helpers**

Create `src/renderer/src/components/dashboard/UsageGauge.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { fmtCountdown, fmtTokens } from './UsageGauge'

describe('fmtCountdown', () => {
  it('formats zero as 00:00:00', () => {
    expect(fmtCountdown(0)).toBe('00:00:00')
  })
  it('formats 5 hours exactly', () => {
    expect(fmtCountdown(5 * 60 * 60 * 1000)).toBe('05:00:00')
  })
  it('formats 1h 2m 3s', () => {
    expect(fmtCountdown((1 * 3600 + 2 * 60 + 3) * 1000)).toBe('01:02:03')
  })
  it('clamps negative to 00:00:00', () => {
    expect(fmtCountdown(-5000)).toBe('00:00:00')
  })
})

describe('fmtTokens', () => {
  it('returns plain number for < 1000', () => {
    expect(fmtTokens(999)).toBe('999')
  })
  it('formats thousands as Xk', () => {
    expect(fmtTokens(42_300)).toBe('42.3k')
  })
  it('formats millions as XM', () => {
    expect(fmtTokens(1_200_000)).toBe('1.2M')
  })
})
```

- [ ] **Step 2: Run — verify failing**

```bash
pnpm vitest run src/renderer/src/components/dashboard/UsageGauge.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `UsageGauge.tsx`**

Create `src/renderer/src/components/dashboard/UsageGauge.tsx`:

```tsx
import { trpc } from '@renderer/lib/trpc'
import { type CSSProperties, useEffect, useState } from 'react'

// ── Geometry constants ──────────────────────────────────────────────────────
const SIZE = 140
const CX = SIZE / 2   // 70
const CY = SIZE / 2   // 70
const R = 52
const C = 2 * Math.PI * R          // ≈ 326.7 — full circumference
const ARC = C * 0.75               // ≈ 245.0 — 270° of arc
const GAP = C * 0.25               // ≈  81.7 — 90° gap at bottom
// Rotate so gap sits at 6 o'clock (135° from natural SVG start at 3 o'clock).
const ROTATION = `rotate(135, ${CX}, ${CY})`

// ── Pure helpers (exported for testing) ────────────────────────────────────
export function fmtCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms))
  const h = Math.floor(total / 3_600_000)
  const m = Math.floor((total % 3_600_000) / 60_000)
  const s = Math.floor((total % 60_000) / 1_000)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

// ── Component ───────────────────────────────────────────────────────────────
export function UsageGauge() {
  const { data } = trpc.productivity.subscriptionWindow.useQuery(undefined, {
    refetchInterval: 60_000,
  })

  const resetMs = data?.windowReset ? new Date(data.windowReset).getTime() : null

  const [remaining, setRemaining] = useState<number>(
    resetMs != null ? resetMs - Date.now() : 5 * 60 * 60 * 1000,
  )

  // Sync when resetMs changes (new data arrived), then tick every second.
  useEffect(() => {
    if (resetMs == null) return
    setRemaining(resetMs - Date.now())
    const id = setInterval(() => setRemaining(resetMs - Date.now()), 1_000)
    return () => clearInterval(id)
  }, [resetMs])

  const fillPct = data?.fillPct ?? 0
  const tokensUsed = data?.tokensUsed ?? 0
  const limitTokens = data?.limitTokens ?? 50_000
  const isHot = fillPct >= 80

  // Track: fixed 270° arc
  const trackDash = `${ARC} ${GAP}`
  // Fill: proportional slice of the arc, then invisible gap for the rest
  const fillLen = (fillPct / 100) * ARC
  const fillDash = `${fillLen} ${C - fillLen}`

  return (
    <div className={`usage-gauge${isHot ? ' usage-gauge--hot' : ''}`} aria-label="Subscription window usage">
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        aria-hidden
        overflow="visible"
      >
        <defs>
          <linearGradient id="ug-grad" gradientUnits="userSpaceOnUse" x1="20" y1="0" x2="120" y2="0">
            <stop offset="0%"   stopColor="var(--amber)" />
            <stop offset="55%"  stopColor="#F97316" />
            <stop offset="100%" stopColor="#EF4444" />
          </linearGradient>
        </defs>

        {/* Background track */}
        <circle
          cx={CX} cy={CY} r={R}
          fill="none"
          stroke="var(--line-dim)"
          strokeWidth={4}
          strokeDasharray={trackDash}
          strokeLinecap="round"
          transform={ROTATION}
        />

        {/* Fill arc */}
        <circle
          cx={CX} cy={CY} r={R}
          fill="none"
          stroke="url(#ug-grad)"
          strokeWidth={6}
          strokeLinecap="round"
          transform={ROTATION}
          className="usage-gauge__fill"
          style={{ strokeDasharray: fillDash } as CSSProperties}
        />
      </svg>

      <div className="usage-gauge__center">
        <div className="usage-gauge__countdown">{fmtCountdown(remaining)}</div>
        <div className="usage-gauge__tokens">
          {fmtTokens(tokensUsed)} / {fmtTokens(limitTokens)}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests — verify passing**

```bash
pnpm vitest run src/renderer/src/components/dashboard/UsageGauge.test.ts
```

Expected: PASS (7 tests).

- [ ] **Step 5: Add CSS**

In `src/renderer/src/index.css`, find the `.kpi.wide` block:

```css
  .kpi.wide {
    grid-column: span 2;
  }
```

Insert the following **directly after** that block:

```css
  /* Tall single-column hero tile (TODAY TOKENS after grid reorganisation). */
  .kpi.hero-tall {
    grid-column: span 1;
    grid-row: span 2;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 24px 18px;
  }
  .kpi.hero-tall .val {
    font-size: 36px;
    letter-spacing: -0.02em;
    color: var(--amber);
  }
  /* Gauge tile: same 1×2 footprint, centres the SVG gauge. */
  .kpi.gauge-tile {
    grid-column: span 1;
    grid-row: span 2;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 12px 8px 8px;
    gap: 0;
  }
  .kpi.gauge-tile .label {
    align-self: flex-start;
    margin-bottom: 0;
  }
```

Then find the `.fx-gauge` block (starts with `.fx-gauge {`) — insert the usage-gauge block **after** it (after the closing `}` of `.fx-gauge`):

```css
/* ── USAGE GAUGE ── radial arc for subscription window ─────────────────── */
.usage-gauge {
  position: relative;
  width: 140px;
  height: 140px;
  flex-shrink: 0;
  margin-top: 6px;
}
.usage-gauge__center {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  pointer-events: none;
}
.usage-gauge__countdown {
  font-family: var(--mono);
  font-size: 17px;
  font-weight: 700;
  color: var(--amber);
  letter-spacing: 0.04em;
  font-variant-numeric: tabular-nums;
}
.usage-gauge__tokens {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--fg-3);
  letter-spacing: 0.06em;
}
.usage-gauge__fill {
  transition: stroke-dasharray 0.8s ease;
}
@keyframes gauge-pulse-glow {
  0%, 100% { filter: drop-shadow(0 0 3px oklch(0.78 0.16 70 / 0.6)); }
  50%       { filter: drop-shadow(0 0 9px oklch(0.78 0.16 70 / 0.9)); }
}
@media (prefers-reduced-motion: no-preference) {
  .usage-gauge--hot .usage-gauge__fill {
    animation: gauge-pulse-glow 1.4s ease-in-out infinite;
  }
}
```

- [ ] **Step 6: Typecheck + lint**

```bash
pnpm typecheck && pnpm lint
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/dashboard/UsageGauge.tsx \
        src/renderer/src/components/dashboard/UsageGauge.test.ts \
        src/renderer/src/index.css
git commit -m "feat: add UsageGauge SVG component and CSS"
```

---

## Task 4: Dashboard KPI grid reorganization

**Files:**
- Modify: `src/renderer/src/pages/Dashboard.tsx`

**Interfaces:**
- Consumes: `<UsageGauge />` from `@renderer/components/dashboard/UsageGauge`
- Produces: updated `StatusRow` with 5 tiles in 4-column bento grid

- [ ] **Step 1: Add the import**

In `src/renderer/src/pages/Dashboard.tsx`, find the existing dashboard imports block. It currently has imports like:

```ts
import { BenchmarkWidget } from '@renderer/components/dashboard/BenchmarkWidget'
```

Add after the last dashboard component import:

```ts
import { UsageGauge } from '@renderer/components/dashboard/UsageGauge'
```

- [ ] **Step 2: Swap TODAY TOKENS tile class and insert GAUGE tile**

In `StatusRow`, find the `<div className="kpis bento">` block. Replace the entire `kpis bento` div:

**Before:**
```tsx
  return (
    <div className="kpis bento">
      <div className="kpi hero">
        <div className="label">
          <span className="id">[01]</span>TODAY TOKENS
        </div>
        <div className="val">{t ? <Ticker value={t.totalTokens} /> : '—'}</div>
        <div className="delta">
          {t ? `${num(t.turns)} turns · ${num(t.activeHours)} active hrs` : 'no activity yet'}
        </div>
      </div>

      <div className="kpi wide">
```

**After:**
```tsx
  return (
    <div className="kpis bento">
      <div className="kpi hero-tall">
        <div className="label">
          <span className="id">[01]</span>TODAY TOKENS
        </div>
        <div className="val">{t ? <Ticker value={t.totalTokens} /> : '—'}</div>
        <div className="delta">
          {t ? `${num(t.turns)} turns · ${num(t.activeHours)} active hrs` : 'no activity yet'}
        </div>
      </div>

      <div className="kpi gauge-tile">
        <div className="label">
          <span className="id">[05]</span>SUBSCRIPTION
        </div>
        <UsageGauge />
      </div>

      <div className="kpi wide">
```

- [ ] **Step 3: Typecheck + lint**

```bash
pnpm typecheck && pnpm lint
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/pages/Dashboard.tsx
git commit -m "feat: add UsageGauge tile to dashboard KPI row"
```

---

## Task 5: Settings UI — subscription plan card

**Files:**
- Modify: `src/renderer/src/pages/Settings.tsx`

**Interfaces:**
- Consumes:
  - `trpc.settings.get.useQuery()` — reads `subscriptionPlan`, `subscriptionLimitCustom`
  - `trpc.settings.set.useMutation()` — writes the fields
  - `TermSelect` from `@renderer/components/ui/select`
  - `SUBSCRIPTION_PLANS`, `SubscriptionPlan` from `@shared/settings`

- [ ] **Step 1: Add imports to Settings.tsx**

Find the existing shared import line:

```ts
import {
  type AppSettings,
  GALAXY_EDGE_STYLES,
  type GalaxyEdgeStyle,
  LOG_LEVELS,
  settingsSchema,
  THEMES,
} from '@shared/settings'
```

Replace it with:

```ts
import {
  type AppSettings,
  GALAXY_EDGE_STYLES,
  type GalaxyEdgeStyle,
  LOG_LEVELS,
  SUBSCRIPTION_PLANS,
  type SubscriptionPlan,
  settingsSchema,
  THEMES,
} from '@shared/settings'
```

- [ ] **Step 2: Add `SubscriptionCard` component**

Find the `GalaxyEdgeStyleCard` function (search for `function GalaxyEdgeStyleCard`). Insert the new component **directly before** it:

```tsx
function SubscriptionCard() {
  const utils = trpc.useUtils()
  const settingsQuery = trpc.settings.get.useQuery()
  const setSubscription = trpc.settings.set.useMutation({
    onSuccess: () => {
      void utils.settings.get.invalidate()
      // Invalidate subscriptionWindow so the gauge re-reads the new limit.
      void utils.productivity.subscriptionWindow.invalidate()
    },
    onError: (err) => toast.error(err.message),
  })

  const plan = settingsQuery.data?.subscriptionPlan ?? 'pro'
  const customLimit = settingsQuery.data?.subscriptionLimitCustom ?? 50_000

  const PLAN_LABELS: Record<SubscriptionPlan, string> = {
    pro: 'Pro',
    max5x: 'Max 5×',
    max20x: 'Max 20×',
    custom: 'Custom',
  }

  return (
    <div className="panel mt-16">
      <div className="panel-head">
        <span className="ttl">claude subscription</span>
        <span className="meta">usage gauge · 5h window</span>
      </div>
      <div className="panel-body">
        <div
          style={{
            fontFamily: 'var(--mono)',
            fontSize: 12,
            color: 'var(--fg-3)',
            marginBottom: 12,
          }}
        >
          Sets the token ceiling for the dashboard subscription gauge. Limits are
          Anthropic estimates — use Custom if your plan differs.
        </div>
        <div className="label-block" style={{ maxWidth: 420 }}>
          <label htmlFor="settings-subscriptionPlan">plan</label>
          <TermSelect
            id="settings-subscriptionPlan"
            value={plan}
            onValueChange={(v) =>
              setSubscription.mutate({ subscriptionPlan: v as SubscriptionPlan })
            }
            style={{ width: '100%' }}
            options={SUBSCRIPTION_PLANS.map((p) => ({ value: p, label: PLAN_LABELS[p] }))}
          />
        </div>
        {plan === 'custom' && (
          <div className="label-block" style={{ maxWidth: 420, marginTop: 12 }}>
            <label htmlFor="settings-subscriptionLimitCustom">
              tokens per 5-hour window
            </label>
            <input
              id="settings-subscriptionLimitCustom"
              type="number"
              min={1}
              defaultValue={customLimit}
              className="term-input"
              onBlur={(e) => {
                const v = parseInt(e.target.value, 10)
                if (v > 0) setSubscription.mutate({ subscriptionLimitCustom: v })
              }}
            />
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Render `SubscriptionCard` on the page**

Find where `GalaxyEdgeStyleCard` is rendered inside the Settings page JSX. It will look like:

```tsx
<GalaxyEdgeStyleCard />
```

Add `<SubscriptionCard />` **directly after** it:

```tsx
<GalaxyEdgeStyleCard />
<SubscriptionCard />
```

- [ ] **Step 4: Typecheck + lint**

```bash
pnpm typecheck && pnpm lint
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/pages/Settings.tsx
git commit -m "feat: add subscription plan selector to settings"
```

---

## Self-Review

**Spec coverage:**
- ✅ Data source: `agentTurns` table, 5-hour rolling window (Task 2)
- ✅ `subscriptionWindow` tRPC procedure with `tokensUsed`, `windowStart`, `windowReset`, `limitTokens`, `fillPct` (Task 2)
- ✅ Settings: `subscriptionPlan` enum + `subscriptionLimitCustom` + defaults (Task 1)
- ✅ `SUBSCRIPTION_LIMITS` constant with Pro/Max5x/Max20x values (Task 1)
- ✅ SVG arc gauge 270° sweep, amber→red gradient, countdown, token label (Task 3)
- ✅ `>80%` pulse glow animation (Task 3 CSS)
- ✅ `stroke-dasharray` fill transition 0.8s (Task 3 CSS)
- ✅ `refetchInterval: 60_000` on the query (Task 3 component)
- ✅ `setInterval(1000)` client-side countdown (Task 3 component)
- ✅ KPI grid: `hero` → `hero-tall` (1×2) + new `gauge-tile` (1×2) (Task 4)
- ✅ Settings UI: plan dropdown + custom number input + description (Task 5)
- ✅ `subscriptionWindow.invalidate()` after plan change (Task 5)

**No placeholder text detected.**

**Type consistency:**
- `subscriptionLimitTokens` defined in Task 1, imported in Task 2 ✓
- `SubscriptionPlan` defined in Task 1, used in Tasks 2 and 5 ✓
- `trpc.productivity.subscriptionWindow` defined in Task 2, consumed in Tasks 3 and 5 ✓
- `UsageGauge` created in Task 3, imported in Task 4 ✓
- `fmtCountdown` / `fmtTokens` exported in Task 3, tested in Task 3 ✓
