# Rocket Dev Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the ROADMAP rocket button drive a real lifecycle — `todo → planned` (interactive brainstorm), `planned → in-progress` (approve chip → autonomous build), `in-progress → done` (deploy sentinel) — with the worker chat bound to one item at a time.

**Architecture:** A pure `@shared` layer holds all the real logic (constants, sentinel parser, approve decision, prompt builders) and is fully unit-tested. Main owns the authoritative dev-binding (persisted via electron-store) and exposes it over tRPC; the worker router scans assistant text for the deploy sentinel server-side (mirroring `roadmapChat`) and flips the item to `done`. The renderer reads the binding via a tRPC query (single source of truth, no competing store), auto-starts the brainstorm on rocket, intercepts the approve chip, and shows a "developing / stop" banner.

**Tech Stack:** Electron + tRPC + Zod + Drizzle (better-sqlite3) + Zustand + React + Vitest + Biome.

## Global Constraints

- All UI strings and agent prompts are **English only** (`[[ui-strings-always-english]]`).
- Verify wiring in the running `pnpm dev` (hot reload) **before** any `pnpm dist` (`[[feedback-verify-in-dev-before-build]]`).
- Pure logic lives in `@shared` (importable by both main and renderer); the renderer must never import main modules.
- Follow existing patterns: sentinel hand-off mirrors `src/main/trpc/routers/roadmapChat.ts`; custom chat events flow through `ChatHost`'s `onEvent` (see the roadmap `saved` wiring in `App.tsx`).
- Commit after each task. Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Deploy protocol unchanged: the user types `deploy`; the agent does squash→PR→merge, then emits the sentinel (`[[no-push-user-pushes]]`).

---

### Task 1: Shared dev-pipeline logic (constants, parser, decision, prompt builders)

**Files:**
- Modify: `src/shared/roadmap.ts` (append a new "Dev pipeline" section near the existing "Agent proposal hand-off" block ~line 70)
- Create: `src/shared/roadmap-dev.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module). May import `z` (already imported in `roadmap.ts`) and the existing `RoadmapItem` type.
- Produces (all exported from `@shared/roadmap`):
  - `const APPROVE_BUILD_LABEL = '✓ Approve & start building'`
  - `const DEPLOY_SENTINEL = '<<ATLAS_DEPLOYED>>'`
  - `function parseDeploySentinel(text: string): boolean`
  - `const devBindingSchema` → `z.object({ itemId: z.string().min(1), phase: z.enum(['planning', 'building']) })`
  - `type DevBinding = z.infer<typeof devBindingSchema>`
  - `function shouldApproveBuild(binding: DevBinding | null, pickedText: string): boolean`
  - `function buildDevPlanKickoff(item: Pick<RoadmapItem, 'title' | 'claudePrompt'>): string`
  - `function buildDevBuildPrompt(): string`

- [ ] **Step 1: Write the failing tests**

Create `src/shared/roadmap-dev.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  APPROVE_BUILD_LABEL,
  DEPLOY_SENTINEL,
  buildDevBuildPrompt,
  buildDevPlanKickoff,
  parseDeploySentinel,
  shouldApproveBuild,
} from './roadmap'

describe('parseDeploySentinel', () => {
  it('matches the sentinel alone on its own line', () => {
    expect(parseDeploySentinel(`merged to main\n${DEPLOY_SENTINEL}`)).toBe(true)
  })
  it('tolerates surrounding whitespace on the line', () => {
    expect(parseDeploySentinel(`done\n   ${DEPLOY_SENTINEL}  \n`)).toBe(true)
  })
  it('ignores the token mentioned inside prose (not on its own line)', () => {
    expect(parseDeploySentinel(`I will emit ${DEPLOY_SENTINEL} when finished`)).toBe(false)
  })
  it('returns false when absent', () => {
    expect(parseDeploySentinel('still building')).toBe(false)
  })
})

describe('shouldApproveBuild', () => {
  it('is true only when planning AND the exact approve label was picked', () => {
    expect(shouldApproveBuild({ itemId: 'a', phase: 'planning' }, APPROVE_BUILD_LABEL)).toBe(true)
  })
  it('is false while building (already approved)', () => {
    expect(shouldApproveBuild({ itemId: 'a', phase: 'building' }, APPROVE_BUILD_LABEL)).toBe(false)
  })
  it('is false for any other picked text', () => {
    expect(shouldApproveBuild({ itemId: 'a', phase: 'planning' }, 'refine the plan')).toBe(false)
  })
  it('is false with no binding', () => {
    expect(shouldApproveBuild(null, APPROVE_BUILD_LABEL)).toBe(false)
  })
})

describe('prompt builders', () => {
  it('plan kickoff embeds the brief, forbids code, and pins the approve label', () => {
    const seed = buildDevPlanKickoff({ title: 'Widget', claudePrompt: 'Build a widget' })
    expect(seed).toContain('Widget')
    expect(seed).toContain('Build a widget')
    expect(seed).toContain(APPROVE_BUILD_LABEL)
    expect(seed.toLowerCase()).toContain('do not write code')
  })
  it('build prompt forbids push/merge until deploy and pins the sentinel contract', () => {
    const p = buildDevBuildPrompt()
    expect(p.toLowerCase()).toContain('do not push')
    expect(p).toContain('deploy')
    expect(p).toContain(DEPLOY_SENTINEL)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/shared/roadmap-dev.test.ts`
Expected: FAIL — imports (`APPROVE_BUILD_LABEL`, `parseDeploySentinel`, …) are not exported.

- [ ] **Step 3: Implement the shared logic**

Append to `src/shared/roadmap.ts` (after the existing agent proposal hand-off block):

```ts
// ── Dev pipeline (rocket → plan → build → deploy) ─────────────────────────────

// Pinned label the brainstorm agent must use as its approve option; the renderer
// matches it exactly to flip planned → in-progress and start the build.
export const APPROVE_BUILD_LABEL = '✓ Approve & start building'

// Own-line token the worker emits after a completed deploy (merge to main).
export const DEPLOY_SENTINEL = '<<ATLAS_DEPLOYED>>'

// True when the accumulated assistant text contains the sentinel alone on a line
// (tolerant of surrounding whitespace). A prose mention on a shared line does
// NOT count — mirrors the precision of the roadmap idea sentinel.
export function parseDeploySentinel(text: string): boolean {
  return text.split('\n').some((line) => line.trim() === DEPLOY_SENTINEL)
}

// The worker's binding to the roadmap item it is currently developing.
export const devBindingSchema = z.object({
  itemId: z.string().min(1),
  phase: z.enum(['planning', 'building']),
})
export type DevBinding = z.infer<typeof devBindingSchema>

// Whether a picked chip / typed reply should trigger the approve → build flip.
// Only while planning, and only for the exact pinned label.
export function shouldApproveBuild(binding: DevBinding | null, pickedText: string): boolean {
  return binding?.phase === 'planning' && pickedText === APPROVE_BUILD_LABEL
}

// First message for the PLANNING phase. Wrapped again by the worker seed on the
// server, so it only needs the feature brief + brainstorm contract. It forbids
// code and pins the approve-option label.
export function buildDevPlanKickoff(item: Pick<RoadmapItem, 'title' | 'claudePrompt'>): string {
  return [
    `We are planning a new Atlas OS feature: "${item.title}".`,
    'Feature brief:',
    item.claudePrompt,
    '',
    'This is the PLANNING phase. Brainstorm the design and implementation plan with me:',
    'ask one question at a time, propose 2-3 approaches with trade-offs, and converge on a plan.',
    'Do NOT write code, edit files, or run mutating commands yet.',
    'When the plan is agreed, end that turn with a fenced options block whose FIRST line is',
    `exactly "${APPROVE_BUILD_LABEL}", followed by any refine options. English only.`,
  ].join('\n')
}

// The continuation sent when the user approves the plan. Kicks off the
// autonomous build; the worker waits for the user's "deploy" before shipping and
// emits the sentinel only after the merge lands.
export function buildDevBuildPrompt(): string {
  return [
    'The plan is approved. Implement it autonomously now:',
    'follow the agreed plan, use TDD, and work until the feature is complete and verified.',
    'Do NOT push or merge. When you are done building, stop and wait for me.',
    'When I type "deploy", do squash → PR → merge per the deploy protocol; once the merge',
    `has landed on main, emit ${DEPLOY_SENTINEL} on its own line and write nothing after it.`,
  ].join('\n')
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/shared/roadmap-dev.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm typecheck
git add src/shared/roadmap.ts src/shared/roadmap-dev.test.ts
git commit -m "feat(roadmap): shared dev-pipeline logic — sentinel, approve decision, prompts

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Main-side persisted dev-binding + tRPC procedures

**Files:**
- Modify: `src/main/services/roadmap/store.ts` (add a dedicated electron-store + get/set/clear)
- Modify: `src/main/trpc/routers/roadmap.ts` (add three procedures)

**Interfaces:**
- Consumes: `DevBinding`, `devBindingSchema` from `@shared/roadmap` (Task 1); the existing `Store` (electron-store) import already in `store.ts`.
- Produces:
  - `getDevBinding(): DevBinding | null`
  - `setDevBinding(binding: DevBinding): void`
  - `clearDevBinding(): void`
  - tRPC: `roadmap.getDevBinding` (query → `DevBinding | null`), `roadmap.setDevBinding` (mutation, input `devBindingSchema` → `{ ok: boolean }`), `roadmap.clearDevBinding` (mutation → `{ ok: boolean }`).

> Note: electron-store persistence needs the Electron app and is not exercised by unit tests in this repo (mirrors the untested `meta()` store in the same file). Correctness of this task is verified in `pnpm dev` at the end of Task 6. The real decision logic is already unit-tested in Task 1.

- [ ] **Step 1: Add the persisted binding store to `store.ts`**

At the top, extend the imports:

```ts
import type { DevBinding, RoadmapCreate, RoadmapItem, RoadmapUpdate } from '@shared/roadmap'
```

Add after the `meta()` helper (~line 29):

```ts
// The worker's current development binding (which roadmap item it is building,
// and whether we are still planning or actively building). Its own store so it
// survives restart independently of the seed/meta flags.
interface DevBindingStore {
  binding: DevBinding | null
}
let devStore: Store<DevBindingStore> | null = null
function devBindingStoreInstance(): Store<DevBindingStore> {
  if (!devStore) {
    devStore = new Store<DevBindingStore>({
      name: 'roadmap-dev-binding',
      defaults: { binding: null },
    })
  }
  return devStore
}

export function getDevBinding(): DevBinding | null {
  return devBindingStoreInstance().get('binding')
}
export function setDevBinding(binding: DevBinding): void {
  devBindingStoreInstance().set('binding', binding)
}
export function clearDevBinding(): void {
  devBindingStoreInstance().set('binding', null)
}
```

- [ ] **Step 2: Add the tRPC procedures to `roadmap.ts`**

Extend the imports from the store:

```ts
import {
  clearDevBinding,
  createRoadmapItem,
  getDevBinding,
  listRoadmap,
  removeRoadmapItem,
  setDevBinding,
  updateRoadmapItem,
} from '@main/services/roadmap/store'
import { devBindingSchema, roadmapCreateSchema, roadmapItemSchema, roadmapUpdateSchema } from '@shared/roadmap'
```

Add these procedures inside `roadmapRouter` (after `remove`, before `copyText`):

```ts
  getDevBinding: publicProcedure
    .output(devBindingSchema.nullable())
    .query(() => getDevBinding()),

  setDevBinding: publicProcedure
    .input(devBindingSchema)
    .output(z.object({ ok: z.boolean() }))
    .mutation(({ input }) => {
      setDevBinding(input)
      return { ok: true }
    }),

  clearDevBinding: publicProcedure
    .output(z.object({ ok: z.boolean() }))
    .mutation(() => {
      clearDevBinding()
      return { ok: true }
    }),
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (no type errors; new procedures resolve `DevBinding`).

- [ ] **Step 4: Commit**

```bash
git add src/main/services/roadmap/store.ts src/main/trpc/routers/roadmap.ts
git commit -m "feat(roadmap): persisted dev-binding + tRPC get/set/clear

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Worker router deploy-sentinel scan → flip item to done

**Files:**
- Modify: `src/shared/ipc-events.ts` (add `WorkerChatEvent`)
- Modify: `src/main/trpc/routers/workerChat.ts` (scan assistant text; emit `deployed`)

**Interfaces:**
- Consumes: `parseDeploySentinel`, from Task 1; `getDevBinding`, `clearDevBinding`, `updateRoadmapItem` from the store; the existing `push`, `onAssistantText`, `onTurnComplete` hooks (see `roadmapChat.ts:52-96`).
- Produces: `WorkerChatEvent = BaseChatEvent | { type: 'deployed'; itemId: string }`; the worker subscription now emits `SeqEnvelope<WorkerChatEvent>`.

- [ ] **Step 1: Add the `WorkerChatEvent` type**

In `src/shared/ipc-events.ts`, next to the other chat event unions (e.g. after `RoadmapChatEvent` ~line 106):

```ts
export type WorkerChatEvent = BaseChatEvent | { type: 'deployed'; itemId: string }
```

- [ ] **Step 2: Wire the sentinel scan in `workerChat.ts`**

Extend imports:

```ts
import { clearDevBinding, getDevBinding, updateRoadmapItem } from '@main/services/roadmap/store'
import type { BaseChatEvent, SeqEnvelope, WorkerChatEvent } from '@shared/ipc-events'
import { parseDeploySentinel } from '@shared/roadmap'
```

Change the subscription's observable generic:

```ts
observable<SeqEnvelope<WorkerChatEvent>>((emit) => {
```

Inside `buildRun`, before `return startResumableChat({`, add the scan closure:

```ts
              let flipped = false
              const checkDeployed = (accumulated: string) => {
                if (flipped) return
                if (!parseDeploySentinel(accumulated)) return
                const binding = getDevBinding()
                if (binding?.phase !== 'building') return
                flipped = true
                try {
                  updateRoadmapItem({ id: binding.itemId, status: 'done' })
                  clearDevBinding()
                  push({ type: 'deployed', itemId: binding.itemId })
                } catch (error) {
                  logger.error(
                    'Dev deploy flip failed',
                    error instanceof Error ? error.message : String(error),
                  )
                }
              }
```

Add the `logger` import if not present:

```ts
import { logger } from '@main/logger'
```

In the `startResumableChat({ … })` options, add the two hooks (alongside `emit`):

```ts
                onAssistantText: (_delta, accumulated) => checkDeployed(accumulated),
                onTurnComplete: (accumulated) => checkDeployed(accumulated),
```

Update the final `emit` cast at the bottom of the subscription to the new type:

```ts
          (env) => emit.next(env as SeqEnvelope<WorkerChatEvent>),
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS. (`push` accepts the `deployed` variant because the registry's event type widens to the union — matching how `roadmapChat` pushes `saved`.)

- [ ] **Step 4: Commit**

```bash
git add src/shared/ipc-events.ts src/main/trpc/routers/workerChat.ts
git commit -m "feat(worker): flip roadmap item to done on deploy sentinel

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Prefill auto-start (rocket launches the brainstorm without a manual click)

**Files:**
- Modify: `src/renderer/src/store/workerPrefill.ts` (add `autoStart?`)
- Modify: `src/renderer/src/components/WorkerChatOverlay.tsx` (start the session when `autoStart` is set)

**Interfaces:**
- Consumes: existing `useWorkerPrefill`, `useWorkerChatRun` (`start`, `status`).
- Produces: `WorkerPrefill.autoStart?: boolean` — when true, the overlay calls `startSession(prompt, model)` on hand-off instead of only seeding the intro draft.

- [ ] **Step 1: Add `autoStart` to the prefill type**

In `src/renderer/src/store/workerPrefill.ts`, extend the interface:

```ts
export interface WorkerPrefill {
  prompt: string
  // Model to preselect. null → the global default model.
  model: ClaudeModelId | null
  // When true, the overlay starts the session immediately (used by the roadmap
  // rocket) instead of only seeding the intro composer draft.
  autoStart?: boolean
}
```

- [ ] **Step 2: Honor `autoStart` in the overlay's prefill effect**

In `src/renderer/src/components/WorkerChatOverlay.tsx`, replace the existing prefill effect (lines ~34-39) with:

```ts
  useEffect(() => {
    if (!pending || status !== 'idle') return
    if (pending.autoStart) {
      startSession(pending.prompt, pending.model)
    } else {
      setDraft(pending.prompt)
      setModel(pending.model)
    }
    clearPrefill()
  }, [pending, status, startSession, clearPrefill])
```

(`startSession` is already bound at line 18: `const startSession = useWorkerChatRun((s) => s.start)`.)

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/store/workerPrefill.ts src/renderer/src/components/WorkerChatOverlay.tsx
git commit -m "feat(worker): auto-start prefilled worker session (rocket hand-off)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Approve-chip interception + developing/stop banner

**Files:**
- Create: `src/renderer/src/components/DevBindingBanner.tsx`
- Modify: `src/renderer/src/components/WorkerChatOverlay.tsx` (intercept approve in `send`; render the banner)

**Interfaces:**
- Consumes: `trpc.roadmap.getDevBinding`, `trpc.roadmap.setDevBinding`, `trpc.roadmap.clearDevBinding`, `trpc.roadmap.update`, `trpc.roadmap.list`; `shouldApproveBuild`, `buildDevBuildPrompt` from `@shared/roadmap`.
- Produces: `<DevBindingBanner />` (self-contained); an approve-aware `send` in the worker overlay.

- [ ] **Step 1: Create the banner component**

`src/renderer/src/components/DevBindingBanner.tsx`:

```tsx
import { trpc } from '@renderer/lib/trpc'

// Shows which roadmap item the worker is currently developing and offers a
// "stop" that unbinds the worker (leaving the item's status untouched). Renders
// nothing when there is no active binding.
export function DevBindingBanner() {
  const utils = trpc.useUtils()
  const binding = trpc.roadmap.getDevBinding.useQuery()
  const list = trpc.roadmap.list.useQuery()
  const clear = trpc.roadmap.clearDevBinding.useMutation({
    onSuccess: () => utils.roadmap.getDevBinding.invalidate(),
  })

  const b = binding.data
  if (!b) return null
  const item = list.data?.find((i) => i.id === b.itemId)

  return (
    <div className="dev-binding-banner">
      <span className="dev-binding-label">
        ▸ Developing: {item?.title ?? b.itemId} · {b.phase}
      </span>
      <button type="button" className="btn" onClick={() => clear.mutate()}>
        stop development
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Intercept the approve chip in the worker overlay**

In `src/renderer/src/components/WorkerChatOverlay.tsx`:

Add imports:

```ts
import { DevBindingBanner } from '@renderer/components/DevBindingBanner'
import { buildDevBuildPrompt, shouldApproveBuild } from '@shared/roadmap'
```

Read the binding + the mutations near the other hooks:

```ts
  const utils = trpc.useUtils()
  const binding = trpc.roadmap.getDevBinding.useQuery()
  const setBinding = trpc.roadmap.setDevBinding.useMutation({
    onSuccess: () => utils.roadmap.getDevBinding.invalidate(),
  })
  const updateItem = trpc.roadmap.update.useMutation({
    onSuccess: () => utils.roadmap.list.invalidate(),
  })
```

Replace `send` (lines ~44-48) with an approve-aware version:

```ts
  const send = (text: string) => {
    if (!sessionId || !awaitingInput) return
    const b = binding.data ?? null
    if (shouldApproveBuild(b, text)) {
      // Approve → build: flip status + phase, then send the build prompt (not
      // the literal chip label). Guard on b for the type-narrowing.
      if (b) {
        updateItem.mutate({ id: b.itemId, status: 'in-progress' })
        setBinding.mutate({ itemId: b.itemId, phase: 'building' })
      }
      const buildPrompt = buildDevBuildPrompt()
      pushUserReply(buildPrompt)
      reply.mutate({ sessionId, text: buildPrompt })
      return
    }
    pushUserReply(text)
    reply.mutate({ sessionId, text })
  }
```

Render the banner at the top of the started view (inside `chat-body-flex`, above `TimelineChatBody`):

```tsx
    <div className="chat-body-flex">
      <DevBindingBanner />
      <TimelineChatBody
        …unchanged…
```

- [ ] **Step 3: Add minimal banner styles**

Append to the app's global stylesheet (`src/renderer/src/styles/` — put it near the other `.chat-*` rules; match the existing 0-radius amber terminal aesthetic):

```css
.dev-binding-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--line, #2a2a2a);
  font-size: 12px;
}
.dev-binding-label {
  opacity: 0.85;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

> Find the actual chat stylesheet first: `grep -rl "chat-body-flex" src/renderer/src/styles src/renderer/src/**/*.css` and add the rules there.

- [ ] **Step 4: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS (no new warnings beyond the 9 pre-existing Galaxy3D `any` ones).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/DevBindingBanner.tsx src/renderer/src/components/WorkerChatOverlay.tsx src/renderer/src/styles
git commit -m "feat(worker): approve-chip → build + developing/stop banner

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Rocket rewrite (`todo → planned` + bind + brainstorm) + deployed toast

**Files:**
- Modify: `src/renderer/src/pages/Roadmap.tsx` (`startDevelopment`)
- Modify: `src/renderer/src/App.tsx` (worker `ChatHost` `onEvent` handles `deployed`)

**Interfaces:**
- Consumes: `buildDevPlanKickoff` from `@shared/roadmap`; `trpc.roadmap.getDevBinding` / `setDevBinding` / `update`; `useWorkerPrefill.setPrefill` (with `autoStart`); `useChatDrawer.openSession`; `useWorkerChatRun` (`reset`, `status`).
- Produces: new rocket behavior; a `deployed` toast + list invalidation.

- [ ] **Step 1: Rewrite `startDevelopment` in `Roadmap.tsx`**

Add imports:

```ts
import { buildDevPlanKickoff } from '@shared/roadmap'
```

Replace the current `startDevelopment` (lines ~54-68) with:

```ts
  const setBinding = trpc.roadmap.setDevBinding.useMutation({
    onSuccess: () => utils.roadmap.getDevBinding.invalidate(),
  })

  // Rocket: begin the plan → build → deploy lifecycle for one item. Moves the
  // item to `planned`, binds the worker to it, and auto-starts an interactive
  // brainstorm. Refuses if the worker is already bound/busy (non-destructive).
  const BUSY_STATUSES = ['running', 'awaiting', 'reconnecting', 'limited']
  const startDevelopment = async (item: RoadmapItem) => {
    if (!item.claudePrompt) return
    const existing = await utils.roadmap.getDevBinding.fetch()
    const busy = BUSY_STATUSES.includes(useWorkerChatRun.getState().status)
    if (existing || busy) {
      useChatDrawer.getState().openSession({ type: 'worker' })
      toast.error('Worker is busy — finish or stop the current development first')
      return
    }
    update.mutate({ id: item.id, status: 'planned' })
    setBinding.mutate({ itemId: item.id, phase: 'planning' })
    useWorkerChatRun.getState().reset()
    useWorkerPrefill.getState().setPrefill({
      prompt: buildDevPlanKickoff(item),
      model: 'claude-opus-4-8',
      autoStart: true,
    })
    useChatDrawer.getState().openSession({ type: 'worker' })
  }
```

(`utils`, `update`, `useWorkerChatRun`, `useWorkerPrefill`, `useChatDrawer`, `toast` are all already imported/defined in this file.)

- [ ] **Step 2: Handle the `deployed` event in `App.tsx`**

Add `onEvent` to the worker `ChatHost` (lines ~106-110):

```tsx
        <ChatHost
          useRun={useWorkerChatRun}
          useOpenSubscription={trpc.workerChat.open.useSubscription}
          kickoff={workerKickoff}
          onEvent={(event) => {
            const e = event as { type: string; itemId?: string }
            if (e.type === 'deployed') {
              utils.roadmap.list.invalidate()
              utils.roadmap.getDevBinding.invalidate()
              toast.success('Shipped — moved to done')
            }
          }}
        />
```

Ensure `App.tsx` has `utils` + `toast` in scope (add if missing):

```ts
import { toast } from 'sonner'
// inside the component:
const utils = trpc.useUtils()
```

> Verify first: `grep -n "useUtils\|from 'sonner'" src/renderer/src/App.tsx`. Add only what's missing.

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS (only the 9 pre-existing Galaxy3D warnings).

- [ ] **Step 4: Full unit-test sweep**

Run: `pnpm vitest run`
Expected: PASS — all suites green, including `src/shared/roadmap-dev.test.ts` from Task 1.

- [ ] **Step 5: End-to-end verification in dev (before any build)**

Run: `pnpm dev`. Walk the full lifecycle on a `todo` item that has a `claudePrompt`:

1. Click the rocket → item flips to **planned**; the worker drawer opens and a brainstorm turn **auto-starts** (no manual "start worker" click). The banner reads `▸ Developing: <title> · planning`.
2. Converse until the agent ends a turn offering the **`✓ Approve & start building`** chip. Click a *different* refine option → item stays **planned** (no flip).
3. Click **`✓ Approve & start building`** → item flips to **in-progress**; banner shows `· building`; the composer shows the worker building autonomously (build prompt was sent, not the label text).
4. Rocket a *second* item while bound → toast "Worker is busy…", no clobber.
5. Simulate deploy: in the worker chat, tell it to emit the sentinel on its own line (or type `deploy` and let it finish) → item flips to **done**, banner disappears, toast "Shipped — moved to done".
6. Rocket again on another item, then hit **stop development** → banner clears, item status unchanged, worker free for a new binding.

Confirm each transition in the ROADMAP list/board. Only after this passes consider `pnpm dist`.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/pages/Roadmap.tsx src/renderer/src/App.tsx
git commit -m "feat(roadmap): rocket drives plan→build→deploy lifecycle

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- State machine `todo→planned→in-progress→done` → Tasks 6 (todo→planned), 5 (planned→in-progress), 3 (in-progress→done). ✓
- Binding authoritative in main, persisted, one item at a time → Task 2; guard in Task 6. ✓
- Interactive brainstorm seed, no code yet → `buildDevPlanKickoff` (Task 1), used in Task 6. ✓
- Approve option chip with pinned label → `APPROVE_BUILD_LABEL` + `shouldApproveBuild` (Task 1), interception (Task 5). ✓
- Build continuation prompt, no push until deploy → `buildDevBuildPrompt` (Task 1), sent on approve (Task 5). ✓
- Server-side deploy sentinel → done → Task 3, mirroring `roadmapChat`. ✓
- Auto-start on rocket → Task 4. ✓
- Stop development (unbind, status untouched) → banner (Task 5) + `clearDevBinding` (Task 2). ✓
- Restart mid-build → persisted binding (Task 2) + server-side scan reads it (Task 3). ✓
- Missing `claudePrompt` → rocket hidden (unchanged) + early return in Task 6. ✓
- `deployed` event surfaced in UI → Task 6 App.tsx handler. ✓

**Placeholder scan:** No TBD/TODO; every code step shows concrete code. The two `grep-first` notes (stylesheet path, App.tsx imports) are verification instructions, not deferred work — the code to add is fully specified.

**Type consistency:** `DevBinding` / `devBindingSchema` defined in Task 1, consumed identically in Tasks 2/3/5/6. `parseDeploySentinel`, `shouldApproveBuild`, `buildDevPlanKickoff`, `buildDevBuildPrompt`, `APPROVE_BUILD_LABEL`, `DEPLOY_SENTINEL` — names match across all references. `WorkerChatEvent` defined in Task 3, consumed in Task 3 (router) and read structurally in Task 6 (`{ type, itemId }`). `updateRoadmapItem` (store) vs `roadmap.update` (tRPC) used in their correct contexts.
