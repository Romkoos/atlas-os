# Autonomous End-to-End Mode for Worker Chat — Design

Date: 2026-07-07
Status: approved

## Summary

Add a per-session **Autonomous mode** to the worker chat. When enabled, the
worker's seed authorizes it to complete the task end-to-end — including
committing, pushing, merging to `main`, and running the real deploy protocol —
without pausing for user confirmation. Off by default.

The worker chat already runs with `permissionMode: 'bypassPermissions'`
(`src/main/services/chat/resumableRun.ts`). This feature is therefore a
**prompt / behavior** change (removing the "ask before push/merge/deploy"
convention) plus UI surfacing — **not** a new tool-permission gate.

## Decisions (from brainstorming)

1. **Lifecycle: start-only.** The flag mirrors `model` — chosen on the intro
   "New worker" screen, captured at `start()`, immutable for the life of the
   session. No mid-session flip.
2. **Directive framing: hybrid.** The seed embeds the literal deploy sequence
   verbatim AND cites `[[no-push-user-pushes]]` as the authoritative source.
3. **Indicator: badge + banner.** A persistent `⚡ AUTONOMOUS` badge in the
   running chat header, plus an explanatory banner at the top of the transcript
   stating what autonomous authorizes.
4. **No confirmation gate.** Off-by-default + banner/badge is proportionate for
   a solo, single-operator app. Plain toggle.
5. **Flag home: shared base store.** Add `autonomous: boolean` (default
   `false`) to `createChatRunStore`'s base state, exactly as `model` already
   lives there. Only the worker UI ever sets it `true`; only `workerChat.open`
   reads it.

## Data flow (mirrors `model`)

```
Intro toggle → useWorkerChatRun.start(msg, model, autonomous)
   → persisted in base store (partialize)
   → ChatHost.subInput { …, autonomous }
   → workerChat.open input.autonomous
   → buildWorkerChatSeed(kickoff, { autonomous })   [seed built on fresh kickoff only]
```

On reattach / auto-continue the seed is **not** rebuilt, but the directive is
already in the resumed conversation history, so no extra wiring is needed.

## Changes by file

1. **`src/renderer/src/store/createChatRunStore.ts`**
   - Add `autonomous: boolean` to `BaseChatRunState` and the `Persisted` pick.
   - `start(message, model?, autonomous?)`: set `autonomous` (default to the
     current value when the arg is omitted, like `model`).
   - Initialize to `false`; `reset()` clears to `false`; `startBlank()` keeps
     the current value.
   - Bump persist `version` 1 → 2 with a migration defaulting `autonomous:false`.

2. **`src/renderer/src/components/ChatHost.tsx`**
   - Add `autonomous?: boolean` to `OpenInput`.
   - Include `autonomous: s.autonomous` in the memoized `subInput`.

3. **`src/main/trpc/routers/workerChat.ts`**
   - Add `autonomous: z.boolean().optional()` to the `open` input.
   - Pass into `buildWorkerChatSeed(kickoff, { autonomous: input.autonomous })`.

4. **`src/main/services/workerChat/seed.ts`**
   - `buildWorkerChatSeed(firstMessage, opts?: { autonomous?: boolean })`.
   - When `autonomous`, append a directive block: authorize end-to-end
     completion without confirmation; override the default ask-before-
     push/merge/deploy convention; embed the verbatim deploy sequence; cite
     `[[no-push-user-pushes]]`.

5. **`src/renderer/src/components/WorkerChatOverlay.tsx`**
   - Intro screen: `autonomous` state + a labeled toggle next to
     `<ChatModelSelect>`; pass to `startSession(draft, model, autonomous)`.
   - Running screen: read `autonomous` from the store → render the badge in the
     header + the explanatory banner at the top of the transcript.

6. **New small component** `AutonomousBanner` (badge + banner), English strings.

## Deploy protocol (embedded verbatim in the directive)

Source of truth: knowledge store `[[no-push-user-pushes]]` / MEMORY.md
"Deploy protocol". Canonical sequence:

> intermediate commits while working; on deploy: squash → push → PR → merge to
> `main`, THEN `pnpm dist` → quit the running app → `ditto`-replace
> `/Applications/Atlas OS.app` → relaunch.

## Testing

- **Unit — `buildWorkerChatSeed`:** default path unchanged; with
  `autonomous:true` the directive is present, contains the canonical deploy
  steps + the `[[no-push-user-pushes]]` citation, and the user message.
- **Unit — store:** `start()` sets `autonomous`; it defaults `false`;
  `partialize` includes it; migration from v1 defaults it `false`.
- **Manual smoke (`pnpm dev`, per "verify in dev before packaging"):** toggle
  on → badge + banner render → trivial end-to-end task; toggle off → seed
  identical to today.

## Out of scope (YAGNI)

Mid-session flipping, confirm / type-to-confirm gates, a global setting, any new
tool-permission gate.
