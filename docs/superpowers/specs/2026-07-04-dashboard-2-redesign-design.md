# Dashboard 2.0 — Redesign

**Date:** 2026-07-04
**Status:** Approved by user (layout, signals, processes, actions, widgets, and FX choices all confirmed interactively).

## Goal

Rework the Dashboard page: remove low-value blocks (prompt-runner, Recent Activity, most of Signals+System), compact the Processes panel, and add spectacle — a decorative 3D galaxy hero of the full multi-project graph, a kanban NEXT UP summary, a 4-up widget row, and page-level reveal FX. The dashboard should make people stare.

## Removals

### Quick Actions prompt-runner (the "chat")
- Delete the textarea, RUN/CANCEL buttons, streaming output area, and the `trpc.agent.run.useSubscription` wiring from `Dashboard.tsx`.
- If `agent.run` has no other renderer consumer (verify by grep), delete the backend subscription procedure and its now-dead service code. Keep `agent.openFile` (used by other toasts) and anything news/trending runs depend on.
- The launcher buttons row survives and grows (see Quick Actions below).

### Recent Activity
- Delete the `RecentActivity` component entirely. Keep `productivity.sessions` (Productivity page uses it).
- `timeAgo` helper stays (SIGNALS uses it).

### Signals + System → SIGNALS
- Delete the skills / plugins / ecosystem ("last change") rows and their three queries (`skills.list`, `plugins.list`, `productivity.ecosystem`) from the Dashboard.
- Keep AI NEWS + GITHUB TRENDING as two compact clickable signal rows (label + freshness + 1-line snippet, `digestSnippet` helper stays). New slim panel `SIGNALS` sits right of Activity.

## Processes → chip strip

Replace the two-table `ProcessesPanel` with a compact strip:

- One row: active jobs as live chips — `◐ label · elapsed · ✕(cancel)`. Chips animate (spinner/pulse) while running.
- Empty state: single mono line `// all systems idle`.
- `history ▾` control on the panel head toggles a collapsible list of the last 10 completed jobs: status icon (✓/✗), label, tokens, duration, ↗ open-result. Collapsed by default.
- Data source unchanged: `useJobs()` (`running`, `recent`, `now`) + `jobs.cancel` / `jobs.reveal` mutations.
- Rewrite `.proc-*` CSS for the new markup; prune classes the new markup no longer uses. `.fx-radar` stays (Productivity uses it).

## New: 3D Galaxy hero (decorative)

- Square canvas (~440–480 px) top-left under the KPI row.
- Data: `trpc.graph.getGraph({ scope: '__all__' })` — the unified multi-project graph — filtered through the user's persisted source selection (`graphSources` from `useUiStore`, same `filterBySources` as CodeGraphTab). Node colors via the existing `colorForNode`, cluster anchors via `clusterAnchors` + `communityKey`.
- Edge style: **pulse** comets, hardcoded (not read from settings).
- Scene: bloom pass, parallax starfield shells, nebula sprites, permanent slow auto-rotate.
- Zero interaction: `pointer-events: none` on the canvas wrapper; no labels, no hover, no click, no halo, no focus dimming.
- Implementation: extract reusable scene builders from `Galaxy3D.tsx` (`makeGlowTexture`, `makeStarLayer`, `makeNebula`, the comet Points system) into a shared module (e.g. `pages/knowledge/galaxy-fx.ts`); build a slim `DecorGalaxy3D` component from them. `Galaxy3D` behavior must not change. Lazy-load behind the existing `Graph3DBoundary`.
- HUD overlay (DOM, `pointer-events: none`): corner brackets, scanline sweep, slow rotating reticle ring, live mono readout `NODES <n> · EDGES <m>` (real counts of the rendered graph). Plus `BorderBeam` on the hero panel.
- Empty/missing graph: render starfield + HUD with `NODES 0` and a `// run build on Knowledge` note; never crash (boundary handles WebGL failures).

## New: NEXT UP (kanban summary)

Right column, next to the hero. From `trpc.roadmap.list`:

- **IN PROGRESS** — up to 3 items with `status === 'in-progress'`.
- **NEXT UP** — up to 4: `planned` first, then `todo`, sorted by priority.
- **DONE** — up to 3 most recently updated `done` items.
- Each row: title (1 line, ellipsis) + status glyph. Click on any row → `setSection('roadmap')` + `setTab('roadmap', 'board')`.
- Empty state: `// roadmap is empty — capture an idea`.

## Quick Actions (buttons only)

Compact panel below NEXT UP. Six launchers:

- `↻ AI NEWS` — existing `useNewsRun`.
- `↻ TRENDING` — existing `useTrendingRun`.
- `↻ KNOWLEDGE` — existing `knowledge.compileAll` mutation.
- `▶ BUILD MAP` — graph deep-map build for the active project. New small `graphBuildRun` zustand run store following the `newsRun` pattern (subscription hosted at App level so it survives navigation); reuses `graph.build` / `graph.cancelDeepMap`. If CodeGraphTab's local wiring can share the store without behavior change, migrate it; otherwise leave CodeGraphTab as is.
- `▶ BENCHMARK` — `benchmark.run` mutation (defaults), toast with batch id; progress lives on Productivity.
- `◈ ROADMAP IDEA` — `useChatDrawer.getState().openSession({ type: 'roadmap' })`.

Buttons disable while their run is in flight (same as today).

## New widget row (4-up)

Under Activity/Signals, four equal panels:

1. **Token heatmap** — GitHub-style contribution grid, ~13 weeks × 7 days, amber intensity scale by tokens/day. Data: `productivity.kpi({ days: 91 }).byDay`. Click → Productivity. Follow the dataviz skill for the intensity scale.
2. **Knowledge pulse** — from `knowledge.projects`: total article count, project count, freshest `lastUpdated`. Click → Knowledge.
3. **Benchmark** — from `benchmark.latest` + `benchmark.latestAnalysis`: current phase (or last batch status) + headline A/B delta (tokens/cost pct). Click → Productivity.
4. **Mission clock** — decorative: big mono local time (live), UTC, day-of-year, app version + mem from `health.ping`. No navigation.

## Page-level wow FX

- **Stagger reveal**: panels cascade in on mount (opacity/translate, ~40 ms stagger) with a CRT scan sweep line passing down the page once. Respect `prefers-reduced-motion`.
- **ScrambleText** on all panel titles (component exists in `fx/`).
- Keep: telemetry marquee, KPI bento + `fx-gauge`, `Ticker` count-ups, app-level `SpaceScene`.

## Layout

```
HEADER + telemetry marquee
KPI bento (unchanged)
[ 3D GALAXY hero (square) ][ NEXT UP  ]
[                         ][ ACTIONS  ]
[ ACTIVITY sparklines     ][ SIGNALS  ]
[ HEATMAP ][ KNOWLEDGE ][ BENCH ][ CLOCK ]
PROCESSES chip strip
```

Hero column: `minmax(400px, 480px)`; hero canvas is square (`aspect-ratio: 1`; add a utility class — none exists today). Right column stacks NEXT UP over ACTIONS and stretches to hero height. Widget row: 4 equal columns (wraps to 2×2 under ~1100 px).

## Non-goals / guardrails

- No changes to `Galaxy3D` behavior on the Knowledge page.
- No backend schema changes; all widgets read existing tRPC procedures.
- CSS deletions only for classes verified Dashboard-only AND belonging to removed markup (`.kv`, `.line-clamp-2`, `.caret`, `.label-block`, `.grid-2`, `.fx-radar`, `.proc-*` used elsewhere must survive; `.fx-marquee`, `.fx-gauge`, `.bento` stay — their widgets stay).
- All UI strings English.
- e2e brand assertions (heading role) must keep passing.

## Testing

- Unit: NEXT UP grouping/sorting logic (pure helper + vitest), heatmap bucketing helper.
- Existing tests must stay green (`source-filter`, `graph-colors`, `cluster-anchors`, jobs router).
- Manual smoke: dashboard renders with graph store present and absent; processes strip with 0/1/n jobs; all click-throughs land on the right sections.
