# Dashboard Redesign — Design

**Date:** 2026-06-08
**Status:** Approved

## Goal

Turn the Dashboard (`01`) from an ad-hoc agent runner into a true
**mission-control overview** of the whole Atlas system: a read-only, at-a-glance
state screen with quick actions and entry points into the deeper pages. The
current "run a prompt → stream output → save to file" feature is demoted to a
small quick-action widget; the page's primary job becomes *showing system state*,
not *doing work*.

## Why the current page is wrong

- It is a one-off agent scratchpad, not a dashboard — it shows nothing about the
  system on entry.
- It duplicates the specialized runners (News / Trending / Knowledge `query`),
  which already stream and write files via the same RunHost pattern.
- The "session" panel is a static placeholder (started / model / output dir /
  version), not a live summary.

Meanwhile the system is rich in aggregatable data (`stats`, `productivity`,
`news`, `trending`, `skills`, `plugins`, `health`) scattered across 8 other pages.

## Decisions (from discussion)

- **Role:** mission control **and** light control panel (read-only overview +
  quick actions like refresh news/trending, quick prompt). Not a pure read-only
  board.
- **Run-agent:** demoted to a small quick-action widget on the dashboard. Not a
  separate Console page, not removed.
- **No new backend logic.** Every widget reads from an existing procedure. No new
  routers, no new aggregation services.
- **Scope = whole system.** The dashboard shows the cross-project aggregate with
  **no filters**. Per-period / per-project filtering stays in Productivity.

## Dashboard vs Productivity — the boundary

The two pages answer different questions and must not duplicate widgets.

| | **Dashboard** | **Productivity** |
|---|---|---|
| Question | "what's happening **right now**, system-wide?" | "**why** / **how did** productivity change?" |
| Mode | glance for 5s, then leave / jump deeper | sit and dig for 10 min |
| Scope | everything, aggregate, **no filters** | period × project, **filtered** |
| Period | fixed (today + one trend) | switchable 1/7/30d + compare |
| Data | **read-only**, headline numbers | read + **mutations** (rating, baseline, notes) |
| Depth | one number + one sparkline per metric | full charts, tables, drilldown, co-occurrence |
| Breadth | whole system (news, knowledge, plugins, health…) | agent analytics **only** |

Concrete rules:

1. **No filtered widgets on the Dashboard.** by-project table, tool/skill
   frequency, co-occurrence, change-impact, brush/compare all depend on
   `days × projectPath` — they are the heart of Productivity and never appear here.
2. **KPI/tokens overlap is a deliberate teaser, not a copy.** Productivity shows
   5 KPI tiles + 3 interactive charts with ecosystem markers; the Dashboard shows
   **one** KPI number (overall) + **one** mute `kpiSmooth` sparkline + today's
   tokens. No axes, tooltips, brush, or re-baseline. *Dashboard shows the value;
   Productivity shows the behavior.*
3. **Sessions: "last 3" vs "registry."** Dashboard shows 3 newest, read-only,
   preview. Productivity paginates 25/page with rating/difficulty controls.
4. **Every Dashboard action is a navigation or a launch, never an edit.** No
   rating/baseline/notes here — that work lives in Productivity.
5. **Each widget links into exactly one section** (its "drill deeper" target).

One-liner: **Productivity = agent analytics in depth (filters + edits).
Dashboard = whole-system state in breadth (read-only, headlines, entry points).**

## Layout

```
┌─ PageHeader: DASHBOARD ───────────────── health badge ─┐

┌─ STATUS ROW (4 KPI tiles) ─────────────────────────────┐
│ Today tokens │ KPI %       │ Total runs │ Backend       │
│ + turns/hrs  │ + Δ trend   │ avg dur    │ uptime / mem  │
└────────────────────────────────────────────────────────┘

┌─ ACTIVITY (2/3) ───────────┐ ┌─ QUICK ACTIONS (1/3) ───┐
│ KPI spark (kpiSmooth, 30d) │ │ quick prompt → run      │
│ daily tokens 30d (mini)    │ │ ↻ refresh AI News       │
│ today by-hour (mini bars)  │ │ ↻ refresh Trending      │
│ → Productivity             │ │ ↻ compile knowledge     │
└────────────────────────────┘ └─────────────────────────┘

┌─ RECENT SESSIONS (1/2) ────┐ ┌─ SIGNALS + SYSTEM (1/2) ─┐
│ 3 newest sessions:         │ │ AI News — 2h ago + snip  │
│ project · score · cplx     │ │ Trending — 1d ago + snip │
│ → Productivity             │ │ skills N on · plugins +  │
│                            │ │ update badge             │
│                            │ │ last infra change        │
└────────────────────────────┘ └──────────────────────────┘
```

## Widget → data source map

All read-only queries unless noted. No new procedures.

| Widget | Procedure(s) | Fields used | Drill-into |
|---|---|---|---|
| Today tokens tile | `productivity.today` | `totals.totalTokens`, `turns`, `activeHours` | Productivity |
| KPI % tile + Δ | `productivity.kpi` (no project) | `overall`, last vs prev `kpiSmooth` for arrow | Productivity |
| Total runs tile | `stats.summary` | `count`, `avgDurationMs` | Stats |
| Backend tile | `health.ping` | `ok`, `version`, `uptimeMs`, `memMB` | — |
| KPI sparkline | `productivity.kpi` | `byDay[].kpiSmooth` | Productivity |
| Tokens sparkline | `stats.daily` | `[{date,count}]` | Stats |
| Today by-hour mini | `productivity.today` | `hours[].tokensIn/Out` | Productivity |
| Recent sessions | `productivity.sessions` (no project, default range) | first 3: `project`, `score`, `complexity`, `summary` | Productivity |
| AI News card | `news.read` | `updatedAt`, first lines of `raw` | News |
| Trending card | `trending.read` | `updatedAt`, first lines of `raw` | News |
| Skills count | `skills.list` | count where `enabled` | Skills |
| Plugins + updates | `plugins.list` | count + any `updateAvailable` badge | Plugins |
| Last infra change | `productivity.ecosystem` (small `days`) | newest `{ts,type,target}` | Productivity |
| Quick prompt | `agent.run` subscription (existing) | unchanged | — |
| Refresh News/Trending | `news.run` / `trending.run` (existing) | unchanged | — |
| Compile knowledge | `knowledge.compileAll` (existing) | unchanged | — |

## Architecture

### Renderer only — no backend changes

The whole redesign is a renderer rewrite of `Dashboard.tsx` plus small widget
components. No router, service, or shared-type changes are required, because
every data point already has a procedure.

### 1. `src/renderer/src/pages/Dashboard.tsx` — rewrite

- Replace the prompt/output/session layout with the widget grid above.
- Keep the existing `HealthBadge` (move into the header action, as today).
- Compose from small local widget components (or co-located files under
  `components/dashboard/` if they grow): `StatusRow`, `ActivityPanel`,
  `QuickActions`, `RecentSessions`, `SignalsSystem`.
- Navigation: clicking a widget header / "→" calls the existing UI store section
  setter (same mechanism the sidebar uses) to switch to the target page. No deep
  links / query params needed for v1 — just switch the section.

### 2. Sparklines — reuse the recharts toolkit

Use the existing chart toolkit (ChartFrame / chartMeta and the recharts setup
already used by Productivity). Sparklines are **mute**: no axes, no tooltips, no
brush — a single `Line`/`Bar` in a short fixed-height container. Do not pull in a
new charting dependency.

### 3. Quick actions — reuse existing run machinery

- **Quick prompt:** keep the current `agent.run` subscription flow, shrunk to a
  compact card (prompt input + RUN + inline streaming/last-result). This is the
  demoted version of today's page.
- **Refresh News / Trending:** trigger the existing `news.run` / `trending.run`
  subscriptions (the same ones the News page uses). Reuse `NewsRunHost` /
  `TrendingRunHost` if they can be driven headlessly, or call the subscription
  directly with a toast on `done`. "Updated N ago" comes from
  `news.read().updatedAt` / `trending.read().updatedAt`, refetched on `done`.
- **Compile knowledge:** call `knowledge.compileAll` with a toast.

### 4. Loading & empty states

- Each widget renders its own skeleton/`// loading…` line independently — the
  dashboard never blocks on the slowest query.
- Fresh-system empty states must be graceful (no sessions, no digests, no infra
  changes) — a mono `// …` hint, not an empty panel, matching the Productivity
  `NoteLine` style.
- Prefer already-aggregated procedures (`today`, `summary`, `kpi.overall`) over
  heavy breakdowns (`overview`, `toolSkillUsage`) to keep first paint cheap; the
  heavy ones stay on Productivity.

## Affected files

**Edited:** `src/renderer/src/pages/Dashboard.tsx` (rewrite)

**New (optional, if widgets are extracted):**
`src/renderer/src/components/dashboard/*.tsx`

**Unchanged:** all backend routers/services, `nav.ts`, `ui.ts` (Dashboard keeps
slot `01`).

## Testing

- Manual: open Dashboard on a populated system — every tile/sparkline/card shows
  live data; each "→" navigates to the right page; quick prompt still streams and
  saves; refresh News/Trending updates the "updated N ago" stamp; compile
  knowledge runs.
- Manual: open Dashboard on a fresh system (no sessions / digests / infra
  changes) — every widget shows a graceful empty state, no broken panels.
- Manual: kill the backend — Backend tile shows offline, other widgets degrade
  independently without crashing the page.

## Out of scope

- New backend procedures or aggregation services (everything reuses existing).
- A separate Console / Scratchpad page (quick prompt stays inline as a widget).
- Deep-linking into a pre-filtered Productivity view (v1 just switches section;
  scoped drill-down can come later).
- Customizable / draggable widget layout.
