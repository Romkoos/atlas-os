# ATLAS.OS "Mission Control 2.0" UI Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Full visual redesign of the atlas-os renderer: amber-terminal identity evolved into a cinematic "mission control" design with a real motion system, without touching app logic.

**Architecture:** All styling lives in `src/renderer/src/index.css` (Tailwind v4 CSS-first, semantic classes) — it is rebuilt in place with the same class names so TSX churn stays minimal. New effect primitives go in `src/renderer/src/components/fx/`, shared motion wrappers in `src/renderer/src/components/motion/`, JS motion tokens in `src/renderer/src/lib/motion.ts`. Pages are then swept one group at a time.

**Tech Stack:** React 19, Tailwind CSS v4, Motion v12 (`motion/react`), GSAP 3.13+ + `@gsap/react` (ScrambleText now free), `@number-flow/react`, `@paper-design/shaders-react` (pinned), `@fontsource/geist-mono` + `@fontsource/geist-sans`, recharts 3, dnd-kit, sonner.

**Spec:** `docs/superpowers/specs/2026-07-04-ui-redesign-design.md` — read it first; token values and motion rules there are normative.

## Global Constraints

- Branch: `feat/ui-redesign-mission-control` (already created). Intermediate commits allowed; **never push / merge to main** — the user deploys.
- **No logic changes**: stores, tRPC hooks, data flow, main process are untouched. Only markup/classNames/styling/motion wrappers may change in TSX.
- Zero border-radius everywhere (`--radius: 0`). Dark glass only on floating layers (drawer/modals/popovers/toasts), never on in-flow panels.
- Token *names* are stable (`--amber`, `--fg-2`, …) — only values change; new tokens are additive (`--cyan*`, `--dur-*`, `--ease-*`, `--fx-*`).
- Semantic CSS class names are stable (`.panel`, `.kpi`, `.tbl`, `.seg`, `.chip`, `.rm-*`, `.kb-*`, `.chat-*`, `.mkt-*`, `.info-*`).
- Custom keyframes/utilities are namespaced `fx-*` or `atlas-*` (Tailwind v4 utility-collision gotcha).
- Motion and GSAP never animate the same element. GSAP only via `useGSAP` from `@gsap/react`.
- Movement animates transform/opacity only; exits faster than enters; stagger 30ms, first 8 items, first mount only; keyboard-initiated actions don't animate.
- Every fixed/absolutely-positioned overlay reaching `top: 0` sets `-webkit-app-region: no-drag` (Electron title-bar drag gotcha).
- All UI strings in English. e2e-asserted strings (`ATLAS.OS`, `NN LABEL` nav names, `● ok`/`● idle`/`● down`, `./graph`-style tab labels, board column titles, `.on` active class) are kept; if one must change, update the assertion in `e2e/` in the same task.
- Every task ends with: `pnpm lint && pnpm typecheck` green (pre-commit enforces it) and a commit. The 9 pre-existing `noExplicitAny` warnings in `Galaxy3D.tsx`/`d3-force-3d.d.ts` are not yours to fix — biome check still exits 0.
- Ignore the Mako `git-commit-message` skill; commit style here is conventional (`feat(ui): …`), trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## Canonical recipes (referenced by page-sweep tasks — defined once, DRY)

**R1 — Dark glass (floating layers only):**
```css
.fx-glass {
  background: color-mix(in oklab, var(--panel) 72%, transparent);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border: 1px solid oklch(1 0 0 / 0.1); /* light-catch */
  box-shadow: 0 8px 32px oklch(0 0 0 / 0.36);
}
```

**R2 — Corner ticks (replaces the corner reticle):** `+` marks drawn with two hairline gradients in `::before`/`::after` of `.panel` (and sidebar blocks):
```css
.panel { position: relative; }
.panel::before,
.panel::after {
  content: '';
  position: absolute;
  width: 9px;
  height: 9px;
  pointer-events: none;
  opacity: 0.55;
  transition: opacity 180ms var(--ease-out);
  background:
    linear-gradient(var(--line) 0 0) center / 100% 1px no-repeat,
    linear-gradient(var(--line) 0 0) center / 1px 100% no-repeat;
}
.panel::before { top: -5px; left: -5px; }
.panel::after { bottom: -5px; right: -5px; }
.panel:hover::before, .panel:hover::after { opacity: 1; }
```

**R3 — Ambient glow (active/primary surfaces):**
```css
.fx-glow-amber { box-shadow: 0 0 80px -30px oklch(from var(--amber) l c h / 0.35); }
.fx-glow-cyan  { box-shadow: 0 0 80px -30px oklch(from var(--cyan) l c h / 0.30); }
```

**R4 — Spotlight hover (cursor-tracking sheen, no TSX churn — delegated):** elements matched by `SPOTLIGHT_SELECTOR` get `--mx/--my` set by one global listener (Task 5). CSS per matched class:
```css
.kpi::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0;
  transition: opacity 180ms var(--ease-out);
  background: radial-gradient(220px circle at var(--mx, 50%) var(--my, 50%),
    oklch(1 0 0 / 0.06), transparent 60%);
}
@media (hover: hover) and (pointer: fine) {
  .kpi:hover::after { opacity: 1; }
}
```

**R4b — Shine border (quiet hover glow, CSS-only class):**
```css
.fx-shine {
  position: absolute;
  inset: 0;
  pointer-events: none;
  padding: 1px;
  background: radial-gradient(transparent, transparent, var(--amber), transparent, transparent);
  background-size: 300% 300%;
  mask: linear-gradient(#000, #000) content-box, linear-gradient(#000, #000);
  mask-composite: exclude;
  opacity: 0;
  transition: opacity 180ms var(--ease-out);
  animation: fx-shine 6s linear infinite;
}
@keyframes fx-shine {
  0% { background-position: 0% 0%; }
  50% { background-position: 100% 100%; }
  100% { background-position: 0% 0%; }
}
*:hover > .fx-shine { opacity: 1; }
```
Used on hero/interactive cards where R4's spotlight is too subtle (Dashboard hero KPI, marketplace cards). FlickeringGrid from the spec's vendored list is deliberately dropped — the blueprint grid + ambient shader already provide background texture (YAGNI).

**R5 — Press scale (global, CSS-only):**
```css
@media (prefers-reduced-motion: no-preference) {
  .btn, .seg button, .tabs button, .sb-nav button, .chip[onclick], .rm-card {
    transition: transform var(--dur-fast) var(--ease-out);
  }
  .btn:active, .seg button:active, .tabs button:active, .sb-nav button:active { transform: scale(0.97); }
}
```

**R6 — Enter stagger (first mount):** wrap lists/grids in `<StaggerList>` (Task 4) or use CSS `animation: fx-rise var(--dur-ambient) var(--ease-out) backwards` + `animation-delay: calc(var(--i) * 30ms)` with `--i` set inline (cap 8).

---

### Task 1: Dependencies + fonts

**Files:**
- Modify: `package.json` (deps), `src/renderer/src/index.css:1-2` (font imports), `:30-31` (font tokens)

**Interfaces:**
- Produces: importable `motion/react`, `gsap`, `@gsap/react`, `@number-flow/react`, `@paper-design/shaders-react`; fonts "Geist Mono"/"Geist Sans" available offline.

- [ ] **Step 1: Install**
```bash
pnpm add motion gsap @gsap/react @number-flow/react @fontsource/geist-mono @fontsource/geist-sans
pnpm add -E @paper-design/shaders-react
```
(`-E` pins the pre-1.0 shaders package exactly.)

- [ ] **Step 2: Wire fonts.** At the top of `index.css` (after the katex import) add:
```css
@import '@fontsource/geist-mono/400.css';
@import '@fontsource/geist-mono/500.css';
@import '@fontsource/geist-mono/700.css';
@import '@fontsource/geist-sans/400.css';
@import '@fontsource/geist-sans/500.css';
@import '@fontsource/geist-sans/700.css';
```
Change tokens:
```css
--mono: 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
--sans: 'Geist Sans', system-ui, -apple-system, sans-serif;
```

- [ ] **Step 3: Verify** — `pnpm dev`, confirm app renders with Geist (check devtools computed font). Run `pnpm lint && pnpm typecheck`.

- [ ] **Step 4: Commit** — `feat(ui): add motion/gsap/numberflow/shaders deps + Geist fonts`

---

### Task 2: Token rebuild (palette, motion tokens, FX dials)

**Files:**
- Modify: `src/renderer/src/index.css:13-80` (`:root` block), `:82-120` (`@theme inline`)

**Interfaces:**
- Produces: tokens `--cyan`, `--cyan-2`, `--cyan-dim`, `--dur-fast|base|slow|ambient`, `--ease-out|in-out|drawer`, `--fx-grid|glow|shader|boot`. All consumed by later tasks exactly under these names.

- [ ] **Step 1: Replace the palette** with the spec §2 values verbatim (cool hue 250 backgrounds, hotter amber, new cyan ramp, `--ok`, `--warn`). Keep the shadcn remap block, but change chart slots:
```css
--chart-1: var(--amber);
--chart-2: var(--cyan);
--chart-3: var(--fg-2);
--chart-4: var(--amber-dim);
--chart-5: var(--cyan-dim);
```

- [ ] **Step 2: Replace the FX dials block** (`--crt-scanlines`, `--crt-sweep`, `--phosphor`, `--boot-reveal`, `--grid-strength`) with:
```css
--fx-grid: 0.25;   /* blueprint grid strength (0 = off) */
--fx-glow: 1;      /* ambient panel glow (0 = off) */
--fx-shader: 0.5;  /* WebGL ambient background opacity (0 = off) */
--fx-boot: 1;      /* boot sequence (0 = off) */
```
Grep for old dial names across `src/` and `index.css` — every consumer is rewired or deleted in Task 3 (they are CSS-only; verified: no TS references).

- [ ] **Step 3: Add motion tokens** to `:root` (spec §5 values verbatim: `--dur-fast: 120ms` … `--ease-drawer`).

- [ ] **Step 4: Typography base**: `body` keeps `font-family: var(--sans)` for prose, but add `font-variant-numeric: tabular-nums` on `.kpi, .tbl, .sb-foot, .bar, .tb-right, .kv .v` (grep for numeric surfaces); page-title scale per spec §3 (32px/700 on `.page-head h2`; panel head 11px/500/0.08em).

- [ ] **Step 5: Visual smoke** — `pnpm dev`: app must be cool-dark with amber; nothing broken. `pnpm lint && pnpm typecheck`. Commit: `feat(ui): mission-control token system (cool bg, amber+cyan, motion tokens)`

---

### Task 3: Strip retro-CRT, add instrument layer

**Files:**
- Modify: `src/renderer/src/index.css` — ambient FX section (~lines 2126–2260), interaction-motion section (~2262–2463), panel reticle (~587–625)

- [ ] **Step 1: Delete** scanlines + scan-sweep (`.win::after`, `@keyframes atlas-scan`), phosphor text-glow (`text-shadow` rules driven by `--phosphor`), CRT power-on flicker (`atlas-crt-on`), edge vignette (`.win::before`), and their keyframes. Keep `atlas-rise`-style panel entrance (rename `fx-rise`) and telemetry pulse (rename `fx-pulse`), rewire to `--fx-glow`.

- [ ] **Step 2: Blueprint grid**: retune the existing grid on `.win` to the cool palette — 24px cells, 1px hairlines `oklch(1 0 0 / calc(var(--fx-grid) * 0.05))`, plus a 96px major grid at 1.5× opacity, plus corner `+` marks at major intersections via an extra `background-image` layer (two 9px gradients, `background-repeat: repeat`, `background-size: 96px 96px`).

- [ ] **Step 3: Panel corner ticks** — replace the reticle block with recipe **R2**. Add recipe **R3** classes and apply `fx-glow-amber` to `.panel.primary` / active-state panels (pick the Dashboard hero panel in Task 10).

- [ ] **Step 4: Add recipes R1 (`.fx-glass`), R4 (`@property --mx/--my` + `.kpi::after`), R5 (press scale), R6 keyframe (`fx-rise`)** to `index.css`:
```css
@property --mx { syntax: '<length-percentage>'; inherits: false; initial-value: 50%; }
@property --my { syntax: '<length-percentage>'; inherits: false; initial-value: 50%; }
@keyframes fx-rise { from { opacity: 0; transform: translateY(6px); } }
```

- [ ] **Step 5: Reduced-motion block**: one `@media (prefers-reduced-motion: reduce)` section zeroing transform animations/looping effects (keep opacity fades).

- [ ] **Step 6:** `pnpm dev` smoke (no scanlines, grid visible, panels have ticks), `pnpm lint && pnpm typecheck`, commit: `feat(ui): instrument ambient layer replaces CRT effects`

---

### Task 4: Motion scaffolding (tokens.ts, MotionConfig, section transitions, stagger)

**Files:**
- Create: `src/renderer/src/lib/motion.ts`, `src/renderer/src/components/motion/StaggerList.tsx`
- Modify: `src/renderer/src/App.tsx:77-87`

**Interfaces:**
- Produces: `springSnappy`, `springSurface`, `easeOut`, `DUR` from `lib/motion.ts`; `<StaggerList>` wrapper. Consumed by Tasks 5–15.

- [ ] **Step 1: `lib/motion.ts`:**
```ts
export const springSnappy = { type: 'spring', stiffness: 380, damping: 30 } as const
export const springSurface = { type: 'spring', duration: 0.5, bounce: 0.2 } as const
export const easeOut = [0.23, 1, 0.32, 1] as const
export const DUR = { fast: 0.12, base: 0.18, slow: 0.24, ambient: 0.45 } as const
```

- [ ] **Step 2: Section fade-through in `App.tsx`:** wrap the tree in `<MotionConfig reducedMotion="user">`; replace `<Page />` with:
```tsx
<main className="main">
  <motion.div
    key={section}
    className="page-anim"
    initial={{ opacity: 0, y: 4 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.15, ease: easeOut }}
  >
    <Page />
  </motion.div>
</main>
```
No `AnimatePresence`/exit — navigation must never block. CSS: `.page-anim { height: 100%; min-height: 0; display: flex; flex-direction: column; }` (verify each page's scroll container still scrolls).

- [ ] **Step 3: `StaggerList.tsx`:**
```tsx
import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import { DUR, easeOut } from '@renderer/lib/motion'

/** First-mount stagger for lists/grids. Never re-fires on filter/sort. */
export function StaggerList({ children, className }: { children: ReactNode[]; className?: string }) {
  return (
    <div className={className}>
      {children.map((child, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: order is the identity here
        <motion.div
          key={i}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: DUR.base, ease: easeOut, delay: Math.min(i, 8) * 0.03 }}
        >
          {child}
        </motion.div>
      ))}
    </div>
  )
}
```

- [ ] **Step 4:** `pnpm dev`: switch sections — fast fade-through, no scroll breakage. `pnpm e2e` must still pass (nav assertions unaffected). Commit: `feat(ui): motion system scaffolding + section fade-through`

---

### Task 5: FX primitives (`components/fx/`)

**Files:**
- Create: `src/renderer/src/components/fx/ScrambleText.tsx`, `Ticker.tsx`, `BorderBeam.tsx`, `AmbientShader.tsx`, `BootSequence.tsx`, `spotlight.ts`
- Modify: `src/renderer/src/index.css` (fx classes), `src/renderer/src/main.tsx` (init spotlight)

**Interfaces:**
- Produces: `<ScrambleText text className/>`, `<Ticker value format? className/>`, `<BorderBeam/>` (absolutely fills nearest positioned parent), `<AmbientShader/>`, `<BootSequence/>`, `initSpotlight()`.

- [ ] **Step 1: `ScrambleText.tsx`:**
```tsx
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { ScrambleTextPlugin } from 'gsap/ScrambleTextPlugin'
import { useRef } from 'react'

gsap.registerPlugin(useGSAP, ScrambleTextPlugin)

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Decrypt-style text reveal. Re-scrambles whenever `text` changes. */
export function ScrambleText({ text, className, duration = 0.35 }: {
  text: string
  className?: string
  duration?: number
}) {
  const ref = useRef<HTMLSpanElement>(null)
  useGSAP(
    () => {
      if (!ref.current || reduced) return
      gsap.to(ref.current, {
        duration,
        ease: 'none',
        scrambleText: { text, chars: 'upperCase', speed: 1.4 },
      })
    },
    { dependencies: [text], scope: ref },
  )
  return (
    <span ref={ref} className={className}>
      {text}
    </span>
  )
}
```

- [ ] **Step 2: `Ticker.tsx`:**
```tsx
import NumberFlow from '@number-flow/react'

/** Animated numeric readout; tabular figures come from the CSS token layer. */
export function Ticker({ value, format, className }: {
  value: number
  format?: Intl.NumberFormatOptions
  className?: string
}) {
  return <NumberFlow value={value} format={format} className={className} />
}
```

- [ ] **Step 3: `BorderBeam.tsx`** (Magic UI adaptation, "job running" indicator):
```tsx
import { motion } from 'motion/react'

/** Traveling light along the border of the nearest positioned parent. */
export function BorderBeam({ size = 56, duration = 5, color = 'var(--amber)' }: {
  size?: number
  duration?: number
  color?: string
}) {
  return (
    <div className="fx-border-beam-wrap" aria-hidden>
      <motion.div
        className="fx-border-beam"
        style={{ width: size, background: `linear-gradient(to left, ${color}, transparent)`, offsetPath: 'rect(0 auto auto 0)' }}
        animate={{ offsetDistance: ['0%', '100%'] }}
        transition={{ repeat: Number.POSITIVE_INFINITY, ease: 'linear', duration }}
      />
    </div>
  )
}
```
CSS:
```css
.fx-border-beam-wrap {
  pointer-events: none;
  position: absolute;
  inset: 0;
  border: 1px solid transparent;
  mask-image: linear-gradient(transparent, transparent), linear-gradient(#000, #000);
  mask-clip: padding-box, border-box;
  mask-composite: intersect;
}
.fx-border-beam { position: absolute; aspect-ratio: 1; }
```

- [ ] **Step 4: `spotlight.ts`** (delegated, zero TSX churn):
```ts
const SPOTLIGHT_SELECTOR = '.kpi, .rm-card, .mkt-card, .skill-item'

/** One passive listener drives all cursor-tracking hover sheens (recipe R4). */
export function initSpotlight(): void {
  if (window.matchMedia('(hover: none)').matches) return
  window.addEventListener(
    'pointermove',
    (e) => {
      const el = (e.target as Element).closest?.(SPOTLIGHT_SELECTOR) as HTMLElement | null
      if (!el) return
      const r = el.getBoundingClientRect()
      el.style.setProperty('--mx', `${e.clientX - r.left}px`)
      el.style.setProperty('--my', `${e.clientY - r.top}px`)
    },
    { passive: true },
  )
}
```
Call `initSpotlight()` once in `main.tsx`. Apply the R4 `::after` rule to each selector in the list.

- [ ] **Step 5: `AmbientShader.tsx`** — single WebGL ambient layer:
```tsx
import { GrainGradient } from '@paper-design/shaders-react'
import { useEffect, useState } from 'react'
import { useUiStore } from '@renderer/store/ui'

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** One app-wide shader background. Unmounts (frees the GL context) when the
 * window is hidden or the Knowledge section (3D galaxy = its own context) is active. */
export function AmbientShader() {
  const section = useUiStore((s) => s.section)
  const [visible, setVisible] = useState(!document.hidden)
  useEffect(() => {
    const on = () => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])
  if (!visible || section === 'knowledge') return null
  return (
    <div className="fx-ambient" aria-hidden>
      <GrainGradient
        style={{ width: '100%', height: '100%' }}
        colors={['#2a2418', '#101418', '#1a2228']}
        speed={reduced ? 0 : 0.15}
      />
    </div>
  )
}
```
Check the installed package's prop names (pre-1.0 API drift): color props, `speed`, any DPR/quality prop — adapt, keep amber-tinted-dark + cool-dark colors, very subtle. CSS:
```css
.fx-ambient {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  opacity: calc(var(--fx-shader) * 0.5);
}
.win { position: relative; z-index: 1; }
```
Mount `<AmbientShader />` in `App.tsx` before `.win`.

- [ ] **Step 6: `BootSequence.tsx`** — once per launch, non-blocking:
```tsx
import { useEffect, useState } from 'react'

let booted = false
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Cinematic boot overlay: real data, <1.5s, pointer-events none, once per launch. */
export function BootSequence() {
  const [gone, setGone] = useState(booted || reduced)
  const [step, setStep] = useState(0)
  useEffect(() => {
    if (gone) return
    booted = true
    const fxBoot = getComputedStyle(document.documentElement).getPropertyValue('--fx-boot').trim()
    if (fxBoot === '0') { setGone(true); return }
    const t1 = setInterval(() => setStep((s) => s + 1), 140)
    const t2 = setTimeout(() => setGone(true), 1400)
    const skip = () => setGone(true)
    window.addEventListener('keydown', skip)
    window.addEventListener('pointerdown', skip)
    return () => {
      clearInterval(t1)
      clearTimeout(t2)
      window.removeEventListener('keydown', skip)
      window.removeEventListener('pointerdown', skip)
    }
  }, [gone])
  if (gone) return null
  const ua = navigator.userAgent
  const electronV = /Electron\/([\d.]+)/.exec(ua)?.[1] ?? '—'
  const chromeV = /Chrome\/([\d.]+)/.exec(ua)?.[1] ?? '—'
  const lines = [
    'ATLAS.OS // boot',
    `electron ${electronV} · chromium ${chromeV}`,
    `renderer ready · ${new Date().toISOString().slice(0, 19)}Z`,
    'linking backend…',
  ]
  return (
    <div className="fx-boot" aria-hidden>
      <div className="fx-boot-brand">ATLAS.OS</div>
      <div className="fx-boot-log">
        {lines.slice(0, step + 1).map((l) => (
          <div key={l}>▸ {l}</div>
        ))}
      </div>
    </div>
  )
}
```
CSS: `.fx-boot { position: fixed; inset: 0; z-index: 100; background: var(--bg); pointer-events: none; -webkit-app-region: no-drag; font-family: var(--mono); animation: fx-boot-out 200ms var(--ease-out) 1.2s forwards; }` + `@keyframes fx-boot-out { to { opacity: 0; } }`; brand large amber with `fx-rise`; log lines `--fg-3` 12px. `pointer-events: none` guarantees e2e clicks pass through even during the 1.4s.
Mount `<BootSequence />` last inside `ErrorBoundary` in `App.tsx`.

- [ ] **Step 7:** `pnpm dev`: boot plays once, shader visible behind grid, no interaction blocked. `pnpm lint && pnpm typecheck`. Commit: `feat(ui): fx primitives (scramble, ticker, beam, shader bg, boot, spotlight)`

---

### Task 6: Shell restyle (Sidebar nav pill, TitleBar, PageHeader)

**Files:**
- Modify: `src/renderer/src/components/layout/Sidebar.tsx`, `TitleBar.tsx`, `PageHeader.tsx`, `index.css` (`.sidebar`, `.sb-*`, `.win-bar`, `.page-head`)

- [ ] **Step 1: Sidebar** — width 240→248px (grid template in `.app`), nav rows 36px. Sliding amber pill in `Sidebar.tsx`:
```tsx
{NAV.map((n) => (
  <button key={n.id} type="button" className={section === n.id ? 'active' : ''} onClick={() => setSection(n.id)}>
    {section === n.id && <motion.span layoutId="nav-pill" className="nav-pill" transition={springSnappy} />}
    <span className="k">{n.key}</span>
    <span>{n.label}</span>
    <span className="badge" />
  </button>
))}
```
CSS: buttons `position: relative`; `.nav-pill { position: absolute; inset: 2px 8px; background: color-mix(in oklab, var(--amber) 10%, transparent); border-left: 2px solid var(--amber); z-index: 0; }`; content spans `position: relative; z-index: 1`. Remove old `.active` background (pill replaces it) but keep an `.active` color change so the state exists without JS. Keep accessible names (`NN LABEL`) intact.
Workspace + telemetry blocks: hairline frames + R2 ticks; `tokens.today`/`turns.today` values become `<Ticker>`s (`format={{ notation: 'compact', maximumFractionDigits: 2 }}`).

- [ ] **Step 2: TitleBar** — hairline bottom border, clock `tabular-nums`, health dot gets `fx-pulse` when ok; JobIndicator panel gets `<BorderBeam size={40} duration={4}/>` while a job runs (it already knows running state — presentation only). Keep 30px height and traffic lights; `.win-bar` remains `app-region: drag`, interactive children `no-drag`.

- [ ] **Step 3: PageHeader** — restyle `.num` as dot-matrix badge: 40px square, dotted background (`radial-gradient(oklch(1 0 0/0.12) 1px, transparent 1px)` 4px grid), amber 700 mono digits, hairline border + tick corners. Title uses `<ScrambleText text={title} className=""/>` inside the `h2` (accessible name = full text immediately). Description in `--fg-3`.

- [ ] **Step 4:** `pnpm e2e` — nav-name and brand assertions must pass. Commit: `feat(ui): shell restyle (nav pill, titlebar, dot-matrix page header)`

---

### Task 7: Core primitives restyle in index.css

**Files:**
- Modify: `src/renderer/src/index.css` (`.btn`, `.seg`, `.tabs`, `.chip`, `.select`, `.input`, `.tbl`, `.kpis/.kpi`, `.barlist`, `.dot`, `.kv`, checkbox block)

- [ ] **Step 1:** `.btn`: hairline border, mono 12px/500, uppercase micro-tracking; `.btn.primary` amber fill (bg text) + glint sweep on hover only (keep existing `atlas-glint` renamed `fx-glint`). Press scale via R5.
- [ ] **Step 2:** `.seg`/`.tabs`: hairline container; `.on` = amber text + 2px underline (tabs) / filled cell (seg); transitions `--dur-base`. Keep `.on` class name (e2e asserts it).
- [ ] **Step 3:** `.kpi`: `position: relative` (needed by R4 `::after` and ticks), value 24px/700 tabular, label 10px uppercase `--fg-4`, hover lift `translateY(-1px)` + border brighten @120ms.
- [ ] **Step 4:** `.tbl`: 32px rows, hairline separators only, header 10px uppercase `--fg-4`, row hover `--panel-2` @120ms, numeric cells tabular.
- [ ] **Step 5:** inputs/select/checkbox: focus ring = 1px amber + `0 0 0 3px oklch(from var(--amber) l c h / 0.15)`, transition 120ms; checkbox keeps amber fill + SVG check.
- [ ] **Step 6:** `.dot` status dots get `fx-pulse` only for the "running/ok live" variant. `.chip` info-variant uses `--cyan`.
- [ ] **Step 7:** `pnpm dev` visual smoke across Dashboard/Settings; `pnpm lint && pnpm typecheck`; commit: `feat(ui): core primitive restyle (buttons, tabs, kpi, tables, inputs)`

---

### Task 8: shadcn ui/ re-skin (kill the rounded island)

**Files:**
- Modify: `src/renderer/src/components/ui/button.tsx`, `card.tsx`, `input.tsx`, `textarea.tsx`, `select.tsx`, `label.tsx`, `form.tsx`, `sonner.tsx`

- [ ] **Step 1:** In each, replace stock utility strings: `rounded-md|rounded-lg|shadow-xs|shadow-sm` → none (radius 0), `font-sans` → mono for controls; borders `border-border`; button variants map to the `.btn` look (default = amber primary, outline = hairline, ghost = text). Card = `.panel` look.
- [ ] **Step 2:** `sonner.tsx`: pass `toastOptions={{ classNames: { toast: 'fx-glass' } }}`-style theming; hairline + mono; keep `richColors closeButton`.
- [ ] **Step 3:** grep usages (`components/ui` imports) and visually verify each consumer (Settings forms, Roadmap modal). Commit: `feat(ui): reskin shadcn primitives to terminal tokens`

---

### Task 9: Chat drawer + chat components (glass)

**Files:**
- Modify: `index.css` (`.chat-drawer`, `.chat-fab`, `.chat-*`), `src/renderer/src/components/UnifiedChatDrawer.tsx`, `components/chat/ChatTranscript.tsx`, `ChatComposer.tsx`, `ToolActivityGroup.tsx`, `OptionChips.tsx`

- [ ] **Step 1:** `.chat-drawer`: apply R1 glass + left hairline; slide transition → `transform 500ms var(--ease-drawer)`; it reaches top 0 → verify `-webkit-app-region: no-drag` present (memory gotcha — it already sets it; keep).
- [ ] **Step 2:** `.chat-fab`: amber hairline circle-less square, subtle `fx-pulse` when any session is live (drawer store exposes sessions — presentation-only read).
- [ ] **Step 3:** message enter: in `ChatTranscript`, wrap new message row in `motion.div initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} transition={{duration:DUR.base, ease:easeOut}}` — keyed by message id; streaming text NOT animated.
- [ ] **Step 4:** `ToolActivityGroup` expand/collapse → `motion.div layout` FLIP (or CSS `grid-template-rows 0fr→1fr` if the markup fights FLIP).
- [ ] **Step 4b:** Drawer tab strip gets a **shared-layout underline**: inside the active tab button render `<motion.span layoutId="drawer-tab" className="tab-ink" transition={springSnappy} />`; CSS `.tab-ink { position: absolute; left: 8px; right: 8px; bottom: -1px; height: 2px; background: var(--amber); }` (buttons `position: relative`). Same pattern as the sidebar nav pill (Task 6). Apply the identical pattern (unique `layoutId` per strip, e.g. `"kb-tab"`) to the Knowledge tab strip in Task 13; all other `.seg`/`.tabs` strips keep the CSS underline from Task 7.
- [ ] **Step 5:** manual smoke: open each of the 5 chat types, send nothing, drag window by title bar, close. Commit: `feat(ui): glass chat drawer + chat motion`

---

### Task 10: Dashboard (bento + tickers)

**Files:**
- Modify: `src/renderer/src/pages/Dashboard.tsx`, `components/dashboard/Sparkline.tsx`, `index.css` (dashboard grid + `.kpi` adoption)

- [ ] **Step 1:** Convert the KPI grid to bento: CSS grid `grid-template-columns: repeat(4, 1fr)`, hero KPI `grid-column: span 2; grid-row: span 2` with bigger type + `fx-glow-amber`; pick the most important existing KPI as hero (tokens today).
- [ ] **Step 2:** KPI values → `<Ticker>`; first-mount stagger via R6/`StaggerList`.
- [ ] **Step 3:** Sparkline stroke → amber with soft glow (`filter: drop-shadow(0 0 4px oklch(from var(--amber) l c h / 0.4))` — static filter, not animated); processes panel keeps `'processes'` string (e2e), running job rows get `<BorderBeam/>`.
- [ ] **Step 4:** `pnpm e2e` (dashboard assertions), commit: `feat(ui): dashboard bento grid + live tickers`

---

### Task 11: Roadmap (list/board/detail + kanban feel)

**Files:**
- Modify: `src/renderer/src/pages/Roadmap.tsx`, `roadmap/RoadmapList.tsx`, `RoadmapBoard.tsx`, `RoadmapDetail.tsx`, `index.css` (`.rm-*`)

- [ ] **Step 1:** `.rm-*` restyle to new tokens: list rows 40px hairline; board columns hairline-framed with tick corners + column count badges; cards get R4 spotlight + hover lift.
- [ ] **Step 2:** Kanban drag: in `RoadmapBoard.tsx` add dnd-kit `DragOverlay` rendering the active card in a wrapper `<div style={{ transform: 'scale(1.04) rotate(2deg)' }}>` (scale on inner wrapper — dnd-kit drop-misalign bug) + shadow; source card 45% opacity while dragging; `dropAnimation={{ duration: 250, easing: 'cubic-bezier(0.23,1,0.32,1)' }}`. Column titles `To do/Planned/In progress/Done` unchanged (e2e).
- [ ] **Step 3:** Detail/modal (`.rm-backdrop`/`.rm-modal`): backdrop fade 200ms; modal R1 glass + `scale(0.96→1)` @200ms in / 150ms out (CSS).
- [ ] **Step 4:** `pnpm e2e` (roadmap/board tests), commit: `feat(ui): roadmap restyle + kanban drag physics`

---

### Task 12: Stats + Productivity (charts)

**Files:**
- Modify: `src/renderer/src/pages/Stats.tsx`, `Productivity.tsx`, `components/charts/*` (ChartFrame, LegendChips, ChartReadout, DayDrawer, InfoPopover), `index.css` (chart chrome)

- [ ] **Step 1:** Chart chrome: `ChartFrame` panel look with ticks; legends → hairline chips (amber/cyan series dots); tooltips/`DayDrawer` → R1 glass.
- [ ] **Step 2:** Series colors flow from `--color-chart-1..5` automatically (Task 2); verify every hardcoded hex in these pages/components is replaced by chart tokens (grep `#` in the charts dir and both pages; graph pages excluded).
- [ ] **Step 3:** Entrance stagger: where multiple charts render in a grid, pass `animationBegin={index * 80}` to the recharts series components; leave `isAnimationActive` untouched (`'auto'` = free reduced-motion).
- [ ] **Step 4:** KPI tiles in Productivity → `<Ticker>`; benchmark "running" panel → `<BorderBeam/>`; `./benchmark` tab string unchanged.
- [ ] **Step 5:** `pnpm e2e`, commit: `feat(ui): stats + productivity chart re-theme`

---

### Task 13: Knowledge + News

**Files:**
- Modify: `src/renderer/src/pages/Knowledge.tsx`, `knowledge/GraphTab.tsx`, `CodeGraphTab.tsx`, `NodeDetails.tsx`, `MarkdownView.tsx`, `ViewToggle.tsx`, `News.tsx`, `pages/knowledge/graph-colors.ts`, `index.css` (`.kb-*`, `.news-digest`, `.md-prose`)

- [ ] **Step 1:** `.kb-*` browse/daily/search restyle; markdown prose (`.kb-md`, `.md-prose`, `.news-digest`) → Geist Sans, cyan links, amber headings-marker.
- [ ] **Step 2:** Graph chrome: tab labels `./graph`, `./code-graph` unchanged; controls restyle; `NodeDetails` panel → glass-free `.panel` with ticks (in-flow).
- [ ] **Step 3:** `graph-colors.ts`: re-tune the 10-hue `PALETTE` to the cool background — keep 10 distinct hues, slot 1 = new `--amber` hex equivalent, slot 2 = new `--cyan` equivalent, harmonize chroma/lightness of the rest (convert via oklch picker). Per-kind colors adjusted the same way. Do NOT touch Galaxy3D internals.
- [ ] **Step 4:** News: GITHUB TRENDING string unchanged; digest cards hairline+ticks.
- [ ] **Step 5:** `pnpm e2e` (knowledge/graph-crash suites), commit: `feat(ui): knowledge + news restyle, graph palette re-tune`

---

### Task 14: Info + Skills + Plugins + Settings

**Files:**
- Modify: `src/renderer/src/pages/Info.tsx` + `info/*`, `Skills.tsx`, `Plugins.tsx`, `Settings.tsx`, `index.css` (`.info-*`, `.skill-item`, `.plugin-*`, `.mkt-*`, `.health-*`)

- [ ] **Step 1:** Info: `.info-*` typography pass (Geist, cyan links, katex blocks on `--panel`); TOC hairline rail.
- [ ] **Step 2:** Skills: `.skill-item` spotlight (already in `SPOTLIGHT_SELECTOR`) + hover lift; editor chrome hairline.
- [ ] **Step 3:** Plugins: `.plugin-row`/`.plugin-toggle`/`.mkt-*` restyle; toggle = amber terminal switch; marketplace cards R4.
- [ ] **Step 4:** Settings: forms via re-skinned shadcn (Task 8); `'default model'`/`'processes'` strings unchanged; health blocks hairline+ticks.
- [ ] **Step 5:** `pnpm e2e` full suite, commit: `feat(ui): info/skills/plugins/settings restyle`

---

### Task 15: Final sweep — e2e, reduced motion, perf, review

- [ ] **Step 1:** `pnpm lint && pnpm typecheck && pnpm build` — all green.
- [ ] **Step 2:** `pnpm e2e` — full suite; update any assertion that a changed string/class legitimately broke (list each change in the commit body).
- [ ] **Step 3:** Reduced-motion pass: toggle `System Settings → Accessibility → Display → Reduce motion` (or emulate via devtools rendering tab in the dev app): boot skipped, shader static/absent, sections still readable, feedback fades remain.
- [ ] **Step 4:** Perf smoke: Activity Monitor GPU/CPU with app idle on Dashboard < a few %; drag window; open chat drawer while a chart animates — no visible jank. Verify only ONE ambient GL context (`document.querySelectorAll('canvas')` audit on Dashboard).
- [ ] **Step 5:** Grep sweep for leftovers: `grep -rn 'crt-\|phosphor\|boot-reveal\|grid-strength\|JetBrains\|Inter' src/ && grep -n 'atlas-scan\|atlas-crt' src/renderer/src/index.css` → all empty.
- [ ] **Step 6:** Update `CLAUDE.md`/docs if they reference the old theme names (grep `scanline|CRT` in docs/). Commit: `feat(ui): final polish + e2e sync`
- [ ] **Step 7:** Request code review (superpowers:requesting-code-review) on the full branch diff; fix findings; leave branch local — the user decides deploy.
