# General Chat (generalChat) + FAB/"+" New-Chat — Design

Date: 2026-07-02

## Goal

Add a general free-form chat with the agent as a new `generalChat` session type
in the `UnifiedChatDrawer`, plus two entry points to start it: the floating
action button (FAB) opens a fresh general chat when there are no active
sessions, and a new "+" button in the drawer opens/focuses the general chat.

## Decisions (from brainstorming)

- **generalChat is a singleton** (`id === type`), like benchmark/roadmap/
  skillImprover. Only one general chat at a time.
- Its first user message is the seed (no domain context). Mirrors the
  benchmark/roadmap chat backends (headless Claude, streaming input, read-only
  tools).
- **"+" behavior** on an existing general chat. The general chat is a perpetual
  session (like the benchmark chat, the backend never emits `done` — it returns
  to `awaiting-input` between turns, so `status` stays `'running'`). So "reset
  only when finished" would never fire. Refined rule to honor "+" = new chat
  without interrupting an in-flight response: reset to a fresh blank intro
  UNLESS the model is **actively streaming** (`running && !awaitingInput`), in
  which case just focus. Resetting also cancels the open server run. If idle, it
  already shows the intro. FAB when zero sessions creates+opens a fresh general
  chat.

## Non-goals

- No multiple concurrent general chats (singleton, per decision).
- No changes to the benchmark/roadmap/skillImprover backends, hosts, or store
  lifecycles.
- No persistence of chat history across app restarts (in-memory, like the
  other chats).

## Architecture

### Backend (main)

1. **`src/shared/ipc-events.ts`** — add `GeneralChatEvent` (same shape as
   `BenchmarkChatEvent`):
   ```ts
   export type GeneralChatEvent =
     | { type: 'token'; text: string }
     | { type: 'tool'; name: string; summary: string }
     | { type: 'awaiting-input' }
     | { type: 'done' }
     | { type: 'error'; message: string }
     | { type: 'aborted' }
   ```

2. **`src/main/services/generalChat/seed.ts`** — `buildGeneralChatSeed(firstMessage: string): string`
   returns a short framing (assistant embedded in atlas-os, read-only repo
   access via Read/Grep/Glob) followed by the user's first message. Unit-tested
   for the framing + message.

3. **`src/main/services/generalChat/run.ts`** — `startGeneralChat({ requestId, seed, model, repoRoot, emit })`
   returning `{ reply, cancel, done }`. A direct copy of
   `benchmarkChat/run.ts` (mailbox streaming input via
   `createMailbox`, tools `['Read', 'Grep', 'Glob']`,
   `permissionMode: 'bypassPermissions'`, `subscriptionEnv()`), emitting
   `GeneralChatEvent`.

4. **`src/main/trpc/routers/generalChat.ts`** — `generalChatRouter` with:
   - `start(input: { requestId, message })` subscription: build
     `seed = buildGeneralChatSeed(message)`, register a `jobRegistry` job
     (`kind: 'general.chat'`, `label: 'General chat'`, `abort`), start the run,
     wire `emit` (finish the job on done/error/aborted), clean up on teardown.
     Mirrors `roadmapChat`/`benchmarkChat` router structure (minus the
     proposal/save path).
   - `reply(input: { requestId, text })` and `cancel(input: { requestId })`
     mutations, identical to the other chat routers.

5. **`src/main/trpc/router.ts`** — register `generalChat: generalChatRouter`.

### Renderer

6. **`src/renderer/src/store/generalChatRun.ts`** — a `zustand` store mirroring
   `roadmapChatRun` minus `savedItem`/proposal. State:
   `{ running, requestId, message, transcript, streaming, awaitingInput, status }`
   with `status: 'idle' | 'running' | 'done' | 'error' | 'aborted'`; actions
   `start(message)`, `appendToken`, `pushTool`, `pushUserReply`, `flushTurn`,
   `setAwaiting`, `finish`, `reset`. `start(message)` seeds
   `transcript: [{ kind: 'user', text: message }]`.

7. **`src/renderer/src/components/GeneralChatHost.tsx`** — always-mounted
   subscription host (App root), mirrors `RoadmapChatHost`: subscribes to
   `trpc.generalChat.start({ requestId, message })` gated by `skipToken`, maps
   token/tool/awaiting-input/done/error/aborted onto the store.

8. **`src/renderer/src/components/GeneralChatOverlay.tsx`** — headless drawer
   body mirroring `RoadmapChatOverlay` minus the saved-item block: an intro
   (textarea to type the first message → `start`) when not started, else the
   transcript + reply input footer. No chrome, no Stop (drawer owns close).

### Drawer

9. **`src/renderer/src/store/chatDrawer.ts`** — add `'generalChat'` to
   `ChatSessionType`; `DEFAULT_TITLES.generalChat = 'chat'`.

10. **`src/renderer/src/components/UnifiedChatDrawer.tsx`**:
    - `endSession` gains a `generalChat` branch: cancel via
      `trpc.generalChat.cancel` (guarded by `requestId && running`) +
      `useGeneralChatRun.getState().reset()`, then `closeSession`.
    - Body renders `<GeneralChatOverlay />` for the `generalChat` tab. Width
      stays 440px (not `wide`).
    - Add an `openGeneralChat()` helper: if the general chat exists and is not
      actively streaming (`streaming = running && !awaitingInput`), cancel its
      open server run (`trpc.generalChat.cancel` when it has a `requestId`) and
      `reset()` the store first (fresh conversation); then
      `openSession({ type: 'generalChat' })`. If actively streaming, skip the
      reset and just focus.
    - Add a **"+" button** to the tab strip (next to the collapse control) →
      `openGeneralChat()`.
    - **FAB** `onClick`: `sessions.length === 0 ? openGeneralChat() : setOpen(true)`
      (FAB is already hidden while the drawer is open, so it is always an
      open/create action).

11. **`src/renderer/src/App.tsx`** — mount `<GeneralChatHost />` alongside the
    other hosts.

### Styling

12. **`src/renderer/src/index.css`** — a `.chat-drawer-new` button style in the
    spirit of `.chat-drawer-collapse`.

## Testing / verification

- `chatDrawer.test.ts`: a case for `openSession({ type: 'generalChat' })`
  (default title `'chat'`, coexists as a tab).
- main: `buildGeneralChatSeed` unit test (framing present + message included).
- `pnpm build` + `pnpm lint` pass.
- Manual (Electron): FAB with no sessions opens a fresh `chat` tab; typing a
  first message streams a reply; "+" opens/focuses the general chat (resets a
  finished one, focuses a running one); reply works; tab `×` cancels + removes;
  benchmark/roadmap/skillImprover/generalChat can coexist as tabs.

## Notes

- `jobRegistry.register({ kind })` takes a free-form string, so `'general.chat'`
  needs no union change.
- `GeneralChatEvent` duplicates `BenchmarkChatEvent`'s shape intentionally (each
  chat type owns its event union, matching the existing pattern), so the two can
  diverge later.
