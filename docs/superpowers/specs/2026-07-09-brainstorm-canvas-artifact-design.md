# Interactive Brainstorm Artifact in Canvas — Design (v1)

Date: 2026-07-09
Status: approved

## Goal

Render the model's pending `options` prompt as clickable **cards in the Canvas
right pane** instead of inline chips in the chat pane. Scope is deliberately
tight: a single active question only — no cross-question history, no decision
map, no persistence (all fast-follow).

## Background

- `Canvas` (`src/renderer/src/components/chat/Canvas.tsx`) is rendered in
  `Chats.tsx` as a *sibling* of the active chat overlay (inside `SplitPane`) and
  today receives only a `type` prop.
- Each of the four overlays (`RoadmapChatOverlay`, `SkillImproverOverlay`,
  `GeneralChatOverlay`, `WorkerChatOverlay`) reads its **own per-type run store**
  (`transcript`, `streaming`, `awaitingInput`, `sessionId`, `pushUserReply`) and
  defines its **own local `send`** that calls `pushUserReply(text)` +
  `trpc.<type>.reply.mutate({ sessionId, text })`.
- Options are **not stored** — they are derived on the fly inside
  `ChatTranscript` by running `parseOptions` on the last assistant entry, gated
  by `awaitingInput && !streaming`, and rendered via `OptionChips`.

## Decisions

1. **Wiring — Canvas is self-sufficient (adapter hook).** A new
   `useActiveChatArtifact(type)` hook subscribes to all four run stores and
   instantiates all four `reply` mutations unconditionally (the same pattern
   `Chats.tsx` already uses for its four `cancel` mutations), then selects the
   slice for the passed `type`. No new props threaded through `Chats.tsx`.
2. **Tab registration — append "Artifact" universally.** `tabsForType()` appends
   `{ key: 'artifact', label: 'Artifact', View: BrainstormCanvas }` to every
   type: `roadmap → [Ideas, Artifact]`, `skillImprover → [Report, Artifact]`,
   `worker → [Artifact]`, `generalChat → [Artifact]`. Existing types keep their
   current default (first) tab; worker/general default to Artifact.
3. **Empty states — situation-specific placeholders; question text above cards.**
   - Options present → question text (`display`) above clickable option cards.
   - Streaming → "Agent is thinking…"
   - Awaiting free-form (no options block) → "Waiting for your reply in chat."
   - Idle / not started → "No active brainstorm."
4. **Strip — clean removal, keep `OptionChips.tsx` on disk.** Remove the
   `OptionChips` render + `awaitingInput && !streaming` gate from
   `ChatTranscript`, and drop the now-dead `onPickOption` prop from
   `ChatTranscript` + `TimelineChatBody` (+ the `noop`) and the four overlay call
   sites. `parseOptions` stays in `ChatTranscript` (still strips the fenced block
   from displayed text). Each overlay's `send` stays (still wired to
   `ChatComposer.onSend`). `OptionChips.tsx` is left orphaned but present.
5. **Testing — pure-logic unit test + manual dev verify.** Extract the pure
   derivation into `deriveArtifact({ transcript, streaming, awaitingInput }) →
   { display, options }` and unit-test it (mirrors `parseOptions.test.ts`).
   Manually verify all four chat types in `pnpm dev`.

## New files

- `src/renderer/src/components/chat/deriveArtifact.ts` — pure helper: last
  assistant entry → `parseOptions` → `{ display, options }`, surfacing `options`
  only when `awaitingInput && !streaming`.
- `src/renderer/src/components/chat/deriveArtifact.test.ts` — unit tests for the
  four states.
- `src/renderer/src/components/chat/useActiveChatArtifact.ts` — adapter hook,
  returns `{ started, streaming, awaitingInput, display, options, onPick }`.
- `src/renderer/src/components/chat/canvas/BrainstormCanvas.tsx` — the Artifact
  view; consumes the hook and renders the four states.

## Edits

- `canvasTabs.ts` — append the Artifact tab to every type; drop the `default: []`
  branch. `CanvasTab.View` gains a `{ type }` prop so views are type-aware.
- `Canvas.tsx` — pass `type` into the rendered `View`. Signature stays `{ type }`.
- `ChatTranscript.tsx` — remove `OptionChips` render + gate + import; drop
  `onPickOption` prop + `noop`. Keep `parseOptions` for `display`.
- `TimelineChatBody.tsx` — drop the `onPickOption` prop it forwards.
- `RoadmapChatOverlay.tsx`, `SkillImproverOverlay.tsx`, `GeneralChatOverlay.tsx`,
  `WorkerChatOverlay.tsx` — remove `onPickOption={send}` from the
  `TimelineChatBody`/`ChatTranscript` call sites. Keep each `send`.
- `index.css` — add card styles (scaled reuse of `.chat-option`).

## Data flow

`run store` → `useActiveChatArtifact(type)` → `deriveArtifact` →
`BrainstormCanvas` cards → click → `onPick` → `pushUserReply` + `reply.mutate` →
store updates → `awaitingInput` flips → view transitions. Chat pane and Canvas
read the same store, so they stay in sync.

## Out of scope (fast-follow)

Cross-question history, decision map/tree, persistence, per-type custom card
styling, deleting `OptionChips.tsx`.
