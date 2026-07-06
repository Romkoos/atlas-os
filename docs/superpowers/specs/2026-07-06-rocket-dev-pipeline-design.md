# Rocket = autonomous plan → build → deploy pipeline

**Date:** 2026-07-06
**Status:** Design (awaiting review)
**Area:** Roadmap · Worker chat · Durable runs

## Problem

Today the ROADMAP "Start development" (rocket) button only prefills the single
worker chat with the item's `claudePrompt` on Opus and opens the drawer — the
user then drives everything manually, and the item's status (`todo` / `planned`
/ `in-progress` / `done`) is moved by hand.

We want the rocket to drive a real development lifecycle with status that tracks
where the work actually is:

```
 todo ──[rocket]──▶ planned ──[approve chip]──▶ in-progress ──[deploy sentinel]──▶ done
                    (brainstorm             (autonomous build,                  (merged
                     design + plan)          then awaits "deploy")               to main)
```

## Decisions (from brainstorming)

1. **Plan → build has a human gate.** The rocket does NOT build straight through.
   The plan is written first; the user approves before any code is written.
2. **Planning is an interactive brainstorm** in the worker chat drawer (asks
   questions, proposes approaches), not a hands-off spec generator.
3. **Approve is an option chip** at the brainstorm's turn boundary (reuses the
   existing ` ```options ` block / `OptionChips`).
4. **Deploy → done is an agent completion sentinel** detected server-side,
   mirroring the `roadmapChat` auto-save pattern.
5. **Development reuses the singleton worker chat**, bound to one item at a time.
   A second rocket while bound shows the existing "worker busy" error.
6. **Sentinel detection lives server-side** (worker router), for robustness
   across auto-continue / restart.
7. **A "stop development" control** clears the binding (frees the worker) but
   leaves the item's status untouched.

## Architecture

### Source of truth: the dev binding lives in **main**

A single authoritative binding, persisted in main (a `dev_binding` settings key
or a one-row table — implementation detail for the plan), exposed via tRPC so
both sides see one truth:

```ts
type DevBinding = { itemId: string; phase: 'planning' | 'building' } | null
```

- `roadmap.getDevBinding` — query (renderer reads it for the chip + guards).
- `roadmap.setDevBinding` — mutation `{ itemId, phase }`.
- `roadmap.clearDevBinding` — mutation (on `done` and on "stop development").

Persisted so a build that spans restarts keeps its item association; the worker
router's sentinel scan reads it, so an auto-continued deploy still lands on the
right item. Renderer keeps a light mirror via the query (invalidated on each
mutation) — it does not hold its own competing copy.

### Phase 1 — `todo → planned` (rocket click)

`startDevelopment(item)` in `Roadmap.tsx` changes:

1. Guard: if `getDevBinding()` is non-null (or the worker run status is busy) →
   toast "finish or stop the current development first" and open the drawer;
   do not clobber.
2. `roadmap.update({ id, status: 'planned' })`.
3. `roadmap.setDevBinding({ itemId, phase: 'planning' })`.
4. Prefill the worker with a **brainstorm seed** (new builder
   `buildDevPlanSeed(item)`), NOT the raw `claudePrompt`. The seed:
   - embeds the item title + `claudePrompt` as the feature brief;
   - instructs: brainstorm the design + implementation plan, ask one question at
     a time, propose approaches, superpowers-brainstorming style; **do not write
     code yet**;
   - instructs: when the plan is agreed, end the turn with an ` ```options `
     block whose **first** line is exactly `✓ Approve & start building`, followed
     by any refine options.
5. Prefill carries a new `autoStart: true` flag so `WorkerChatOverlay` calls
   `startSession` immediately instead of only seeding the intro draft.
6. Open the drawer worker session.

`WorkerPrefill` gains `autoStart?: boolean`; `WorkerChatOverlay`'s prefill effect
starts the session when `autoStart` is set (guarded to run once, only while
`status === 'idle'`).

### Phase 2 — `planned → in-progress` (approve chip)

The approve is a distinguished chip whose exact label is `✓ Approve & start
building` (the seed pins this label, so detection is a stable string match, not
fuzzy NLP). A thin wrapper around the worker `send`/`onPickOption` path:

```
if binding?.phase === 'planning' && pickedText === '✓ Approve & start building':
    roadmap.update({ id: binding.itemId, status: 'in-progress' })
    roadmap.setDevBinding({ itemId: binding.itemId, phase: 'building' })
    send(BUILD_CONTINUATION_PROMPT)   // NOT the literal chip text
else:
    send(pickedText)                  // normal refine — stays in 'planned'
```

`BUILD_CONTINUATION_PROMPT` (new builder `buildDevBuildPrompt()`): "Plan
approved. Implement it autonomously (TDD, follow the agreed plan). Do NOT push or
merge. Build until the feature is complete and verified, then stop and wait. When
I type `deploy`, do squash → PR → merge per the deploy protocol; once the merge
lands, emit `<<ATLAS_DEPLOYED>>` on its own line and nothing else after it."

The wrapper lives in a small hook (e.g. `useDevChipHandler`) so
`WorkerChatOverlay` stays thin; it composes with the plain `send`.

### Phase 3 — `in-progress → done` (deploy sentinel)

Mirror `roadmapChat.ts` exactly. In `workerChat.ts` `buildRun`, add a scan:

```ts
let flipped = false
const checkDeployed = (accumulated: string) => {
  if (flipped) return
  if (!parseDeploySentinel(accumulated)) return   // matches <<ATLAS_DEPLOYED>>
  const binding = getDevBinding()
  if (binding?.phase !== 'building') return
  flipped = true
  updateRoadmap(binding.itemId, { status: 'done' })
  clearDevBinding()
  push({ type: 'deployed', itemId: binding.itemId })
}
// wired via onAssistantText(_delta, acc) and onTurnComplete(acc)
```

- `parseDeploySentinel` is a pure, IO-free matcher in `@shared` (own-line token,
  tolerant of surrounding whitespace) — unit-testable like `parseOptions`.
- `BaseChatEvent` (or the worker event union) gains a `deployed` variant; the
  renderer clears its binding mirror + toasts "Shipped → done" when it arrives.
- Reads the binding from main directly (no itemId threaded through the
  subscription input), so it is correct even across an auto-continue where the
  renderer is not driving.

### Phase X — "stop development" (unbind)

A small control (in the worker drawer header when a binding is active, and/or a
per-card affordance in `planned` / `in-progress`):

- `roadmap.clearDevBinding()`; leaves the item's current status as-is.
- Frees the worker so another item can be rocketed. Does not cancel the worker
  run itself (user can finish/close it via existing controls).

## Components touched

| File | Change |
|---|---|
| `src/shared/roadmap.ts` | `parseDeploySentinel`; dev-binding types |
| `src/main/services/roadmap/store.ts` | binding get/set/clear (persisted) |
| `src/main/trpc/routers/roadmap*.ts` | `getDevBinding` / `setDevBinding` / `clearDevBinding` procedures |
| `src/main/trpc/routers/workerChat.ts` | sentinel scan → `updateRoadmap(done)` + `deployed` event |
| `src/main/services/workerChat/seed.ts` | `buildDevPlanSeed`, `buildDevBuildPrompt` |
| `src/renderer/src/store/workerPrefill.ts` | `autoStart?` |
| `src/renderer/src/components/WorkerChatOverlay.tsx` | auto-start on prefill; dev-chip wrapper |
| `src/renderer/src/pages/Roadmap.tsx` | new `startDevelopment` (guard + status + binding + seed) |
| new `useDevChipHandler` hook + binding query wiring | approve-chip interception, "stop development" |

## Edge cases

- **Refine loop:** any non-approve chip / free text keeps the item in `planned`.
- **Restart mid-build:** durable auto-continue resumes the worker; binding is
  persisted in main; the sentinel still flips the correct item.
- **Missing `claudePrompt`:** rocket stays hidden (unchanged).
- **Sentinel arrives but phase ≠ building:** ignored (idempotent guard +
  `flipped` latch).
- **Double approve:** binding already `building` → the chip label is gone from
  the transcript; guard on `phase === 'planning'` prevents a re-flip.

## Testing

Pure, IO-free units (following `stopClassifier.test.ts`):

- `parseDeploySentinel` — matches on own line, tolerates whitespace, ignores
  mentions inside prose / code fences that are not on their own line.
- `buildDevPlanSeed` / `buildDevBuildPrompt` — contain the pinned approve label /
  sentinel contract and the "no code / no push" instructions.
- approve-chip decision (`phase === 'planning' && text === label`).
- binding guard logic (busy / already-bound).

Wiring (status flips, auto-start, drawer) verified in `pnpm dev` with hot reload
per the "verify in dev before packaging" rule — before any `pnpm dist`.

## Out of scope (YAGNI)

- Parallel/multi-item development (single worker binding only).
- A dedicated `dev` chat type or per-item drawer tabs.
- Auto-reverting status on "stop development".
- Fully autonomous plan→build with no approval gate.
