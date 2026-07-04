# ATLAS.OS UI Redesign — "Mission Control 2.0" — Design Spec

Date: 2026-07-04
Status: approved by Roman (direction, palette, fonts, intensity, delivery all confirmed)

## 0. Summary

Full visual redesign of the atlas-os Electron app. The amber-terminal identity **evolves** into a
premium, cinematic "sci-fi mission control" design: retro-CRT artifacts are replaced by the 2026
instrument vocabulary (blueprint grid, corner ticks, ambient glow, dark glass), a real motion
system is introduced (Motion + GSAP + WebGL ambient), and every visual surface is reworked.
**Logic, stores, tRPC routers, data flow are untouched.** Delivery: one branch, one PR.

Decisions locked with the user:

| Question | Decision |
|---|---|
| Direction | Sci-fi Mission Control 2.0 (evolve identity, keep ATLAS.OS brand) |
| Intensity | Cinematic HUD with discipline: statement effects at key moments, Linear-fast (120–200ms) micro-interactions for frequent actions |
| Palette | Amber primary + cyan secondary; red = alerts only |
| Fonts | Geist Mono + Geist Sans (self-hosted), full "Technical Mono" |
| Animation stack | Motion v12 + GSAP (free) + WebGL extras (Paper Shaders) |
| Brand/e2e strings | May change; affected e2e assertions updated in the same branch |
| Delivery | One big-bang branch |

## 1. Design language

Keep the DNA: dark, amber, monospace, **zero border-radius everywhere** (`--radius: 0`), ATLAS.OS
brand, `NN LABEL` nav taxonomy, ASCII flavor (`//`, `▸`, `#`) where it carries information.

**Removed (retro-CRT vocabulary):** scanlines (`--crt-scanlines`), scan sweep (`atlas-scan`),
phosphor text-glow, CRT power-on flicker (`atlas-crt-on`), edge vignette.

**Added (2026 instrument vocabulary):**
- **Blueprint grid**: 1px hairline grid / dot-matrix background on the app canvas, 16/24px
  increments, 10–15% opacity ("barely subliminal").
- **Corner ticks**: small `+` registration marks at panel corners (replaces the current corner
  reticle) and at key grid intersections; hairline-thin; brighten on hover/focus.
- **Ambient glow (Linear-style)**: large-radius soft amber bloom behind primary/active panels;
  cyan bloom variant for data-focused surfaces.
- **Dark glass** for floating layers only (chat drawer, modals, popovers, toasts):
  `backdrop-filter: blur(12–16px)`, tint `white/5%`, **1px `white/10%` light-catch border**,
  subtle top-left alpha-gradient, shadow `0 8px 32px rgb(0 0 0 / .36)`. Never on in-flow panels.
- **Grain**: very low opacity, on opaque surfaces only (never under blur — artifacts).
- **Rule of truth**: every decorative label/readout shows real data (session ids, build times,
  versions, counts). No fake FUI clutter.

## 2. Color system (OKLCH)

Token names are preserved (inline `style={{color:'var(--amber)'}}` usages keep working);
values change. Background ramp goes deeper and cooler (hue ~250, away from today's warm 65):

```css
--bg:      oklch(0.14 0.010 250);   /* app canvas, near-black cool */
--bg-2:    oklch(0.17 0.010 250);
--panel:   oklch(0.185 0.010 250);
--panel-2: oklch(0.215 0.010 250);
--line:     oklch(0.30 0.012 250);
--line-dim: oklch(0.24 0.010 250);
--fg:   oklch(0.95 0.005 250);  --fg-2: oklch(0.80 0.008 250);
--fg-3: oklch(0.64 0.010 250);  --fg-4: oklch(0.50 0.010 250);
--amber:     oklch(0.80 0.17 75);   /* hotter, rarer */
--amber-2:   oklch(0.70 0.15 72);
--amber-dim: oklch(0.55 0.10 70);
--cyan:      oklch(0.80 0.13 210);  /* NEW second voice */
--cyan-2:    oklch(0.68 0.11 215);
--cyan-dim:  oklch(0.52 0.07 215);
--ok:   oklch(0.76 0.11 150);
--warn: oklch(0.65 0.19 25);        /* alerts only */
```

Usage split: **amber = system/state** (active nav, primary buttons, KPIs, running jobs, brand);
**cyan = data/info** (links, secondary chart series, info chips, graph highlights, citations);
neutrals for everything else. Max two accents visible per screen region. Amber occupies ≤ ~10%
of any screen.

Charts: `--color-chart-1..5` rebuilt as amber / cyan / fg-2 / amber-dim / cyan-dim.
Graph palette (`pages/knowledge/graph-colors.ts`): re-tune the 10 hues to the cool-dark
background (keep 10 distinct hues, harmonized chroma/lightness; amber & cyan stay slots 1–2).

## 3. Typography

- `--mono: "Geist Mono", ui-monospace, ...` (replaces JetBrains Mono) — self-hosted via
  `@fontsource/geist-mono` (no network fetch in Electron); weights 400/500/700.
- `--sans: "Geist Sans", system-ui, ...` (replaces Inter) via `@fontsource/geist-sans` —
  prose/markdown only (`.md-prose`, `.kb-md`, `.news-digest`).
- Full **Technical Mono**: headers, nav, tables, KPIs, chat all mono; hierarchy via weight +
  size, not family switches.
- `font-variant-numeric: tabular-nums` globally on numeric surfaces (KPIs, tables, tickers,
  title-bar clock).
- Scale: page title 32px/700; panel head 11px/500 uppercase, letter-spacing 0.08em;
  micro-labels 10px uppercase for corner annotations; body 13px; table rows 12.5px.

## 4. Layout & sizing

Structure preserved (title bar 30px / sidebar / main grid). Refinements:

- Sidebar 240px → **248px**; nav rows 36px; workspace + telemetry blocks framed by hairlines
  with corner ticks.
- **Dashboard → bento grid**: primary KPI in a 2× cell; uneven cell sizes by importance.
- 4px spacing scale; panel padding 20px; section gap 24px; tables 32px rows, hairline
  separators, no zebra.
- Page header: two-digit number becomes a **dot-matrix hero glyph**; title scramble-in;
  description in `--fg-3`.

## 5. Motion system

Tokens (in `index.css` + a `src/renderer/src/lib/motion.ts` for JS configs):

```
--dur-fast: 120ms   press, hover-in, nav pill
--dur-base: 180ms   tabs, popovers, dropdowns, exits
--dur-slow: 240ms   modals, section fade, card FLIP
--dur-ambient: 450ms  chart draw-in, counters, first-load stagger
--ease-out:    cubic-bezier(0.23, 1, 0.32, 1)     (default enter/exit)
--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)    (on-screen movement)
--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1)     (drawer, 500ms)
springSnappy  = { type:'spring', stiffness:380, damping:30 }   // indicators
springSurface = { type:'spring', duration:0.5, bounce:0.2 }    // drawers, drops
```

Rules: exits faster than enters; keyboard-initiated actions don't animate; stagger 30ms capped
at first 8 items, first mount only (never on filter/re-sort); transform/opacity only for
movement; Motion and GSAP never touch the same element.

Signature moves:

1. **Boot sequence** (new `components/fx/BootSequence.tsx`): <1.5s cascade of real mono log
   lines (app version, electron/node versions, DB row counts, backend health) +
   `ATLAS.OS` scramble-resolve; skippable by click/keypress; once per app launch (module flag,
   not persisted).
2. **Sidebar nav**: sliding amber pill (`layoutId="nav-active"`, springSnappy); page header
   title scramble-decrypt via GSAP ScrambleText (~300ms) on section switch.
3. **Section transitions**: fade-through 150ms — opacity + 4px translateY on enter, no exit
   animation (keyed `motion.div`; navigation never blocked).
4. **Tabs / segmented controls**: shared-layout underline/pill (`layoutId` per group).
5. **KPI tiles**: NumberFlow tickers (animate on data change; no re-roll on tab revisits);
   cursor-tracking **spotlight border** on hover; staggered first-mount entrance.
6. **Border Beam** on panels = "job running" indicator (JobIndicator, benchmark run, Build);
   **Shine Border** on interactive-card hover.
7. **Buttons**: global `:active` scale 0.97 @ 120ms; glint sweep only on `.btn.primary` hover.
8. **Chat drawer**: 500ms `--ease-drawer` slide, dark glass; FAB gets a subtle amber pulse when
   a session is live; messages enter 6px rise @180ms; tool-activity cards expand via Motion
   layout FLIP; streaming text not animated (the stream is the animation).
9. **Kanban (Roadmap board)**: dnd-kit `DragOverlay` — lift = scale 1.04 + 2° tilt + shadow
   (scale on an inner wrapper — known dnd-kit drop-misalign bug); source at 45% opacity; drop
   250ms ease-out; siblings FLIP.
10. **Charts (recharts 3)**: keep `isAnimationActive:'auto'` (free reduced-motion); entrance
    draw-in staggered per panel via `animationBegin = index*80ms`; live series use
    `animationMatchBy: matchAppend`.
11. **Toasts**: Sonner, re-themed to dark glass + hairline; CSS transitions (interruptible).
12. **Ambient WebGL background**: ONE Paper Shaders canvas (subtle GrainGradient/NeuroNoise,
    amber-tinted, low opacity) behind `.app`; DPR ≤ 2; `speed=0` under reduced-motion; paused
    when window hidden (visibility listener) and while Knowledge 3D galaxy tab is active
    (avoid two GL contexts fighting).
13. **Reduced motion**: `<MotionConfig reducedMotion="user">` at app root + CSS
    `@media (prefers-reduced-motion: reduce)` zeroing transform-based animation; feedback kept
    as opacity/color fades.

FX dials survive, renamed: `--fx-grid`, `--fx-glow`, `--fx-shader`, `--fx-boot`
(replace `--crt-*`, `--phosphor`, `--boot-reveal`; Settings page toggles updated accordingly).

## 6. Dependencies

Add: `motion` (^12), `gsap` + `@gsap/react`, `@number-flow/react`,
`@paper-design/shaders-react` (pin exact version — pre-1.0),
`@fontsource/geist-mono`, `@fontsource/geist-sans`.

Vendored (copy-paste, adapted to our tokens, no registry dependency) in
`src/renderer/src/components/fx/`: BorderBeam, ShineBorder, FlickeringGrid (sidebar/bg accent),
SpotlightCard (cursor-tracking border), ScrambleText wrapper (GSAP), Ticker (NumberFlow wrap),
AmbientShader, BootSequence. Shared transition wrappers in `components/motion/`
(SectionTransition, StaggerList, PressScale patterns as CSS).

Pitfalls honored: GSAP only via `useGSAP` (StrictMode-safe); Motion `AnimatePresence` children
keyed + no fragments; custom animation utilities/keyframes namespaced `fx-*`/`atlas-*` (Tailwind
v4 `@theme` — avoids the `mt-*`-style utility collision hit previously).

## 7. Scope of the sweep

- `src/renderer/src/index.css` rebuilt in place (~3.9k lines): same semantic class names
  (`.panel`, `.kpi`, `.tbl`, `.seg`, `.chip`, `.rm-*`, `.kb-*`, `.chat-*`, `.mkt-*`, `.info-*`)
  so TSX churn stays minimal; new token blocks; retro-CRT keyframes deleted; new fx layers.
- shadcn `components/ui/*` (8 files) re-skinned to tokens: radius 0, mono, hairline borders —
  kills the "rounded shadcn island".
- All 10 pages restyled: Dashboard (bento + tickers + sparkline glow), Roadmap (list/board/
  detail + kanban feel), Stats, Productivity (largest — KPIs/charts/benchmark), Knowledge
  (browse/daily/search/graph/3D chrome), News, Info, Skills, Plugins, Settings (+ FX dial
  toggles updated).
- Chat drawer + 5 overlays + `components/chat/*` (ChatComposer, ChatTranscript,
  ToolActivityGroup, OptionChips) re-skinned to glass.
- Title bar: keep 30px + traffic lights + breadcrumb; add live clock with tabular-nums; health
  dot pulse. Any new fixed/overlay element at top:0 sets `app-region: no-drag`
  (known Electron drag-region gotcha).
- Charts toolkit (`components/charts/*`) re-themed; `graph-colors.ts` re-tuned.
- E2E (`e2e/app.spec.ts`, `e2e/graph-crash.spec.ts`): brand strings intended to survive
  (`ATLAS.OS`, `NN LABEL` nav, `● ok`, `./graph` tabs, `.on` class, board column titles);
  any string that does change gets its assertion updated in this branch. Boot sequence must
  not break e2e waits (skippable + `--fx-boot: 0` escape hatch honored in test env).

**Not in scope:** any store/tRPC/DB/main-process logic change; Galaxy3D internals (already the
"one holographic object" — only surrounding chrome restyled); rewriting components' behavior.
Exception allowed by user: minimal logic touches where a component swap requires it and it is
low-risk.

## 8. Performance guardrails

Transform/opacity only for movement; never animate blur radius (fade pre-blurred layers);
spotlight vars registered `@property { inherits:false }`, listeners attached on hover only;
hover effects gated `@media (hover:hover) and (pointer:fine)`; looping effects pause off-screen
and on hidden window; `will-change` transient only; single ambient GL context, DPR ≤ 2,
`powerPreference:'low-power'`; theme/FX-dial switches disable transitions during swap.

## 9. Acceptance

- `pnpm build` + typecheck + lint pass; Playwright e2e suite green (with updated assertions).
- App boots with boot sequence ≤1.5s, skippable; all 10 sections render with new design;
  reduced-motion mode verified; FX dials in Settings functional.
- No regression in chat flows, kanban drag, graph views (manual smoke).
