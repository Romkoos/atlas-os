import type { RoadmapItem } from '@shared/roadmap'
import type { ImproverReport } from '@shared/skillImprover'

// Common events shared by every drawer chat's transport layer.
export type BaseChatEvent =
  | { type: 'token'; text: string }
  | {
      type: 'tool'
      name: string
      summary: string
      toolId: string
      ts?: number
      subagentType?: string
    }
  | { type: 'tool-result'; toolId: string; resultText: string; isError: boolean; ts?: number }
  // Cumulative-to-date token totals, harvested from each assistant message's
  // usage. Feeds the timeline's token-burn line. See docs/.../session-flame-waterfall.
  | { type: 'usage'; ts: number; inputTokens: number; outputTokens: number }
  | { type: 'awaiting-input' }
  | { type: 'done' }
  | { type: 'error'; message: string }
  | { type: 'aborted' }
  // Durability signals (see docs/superpowers/specs/2026-07-05-durable-chat-runs-design.md):
  // the SDK is auto-retrying a dropped API connection (e.g. after sleep).
  | { type: 'reconnecting'; attempt: number; maxRetries: number; delayMs: number }
  // Live subscription rate-limit info; feeds the usage gauge and limit handling.
  | {
      type: 'rate-limit'
      status: 'allowed' | 'allowed_warning' | 'rejected'
      utilization?: number
      resetsAt?: number
      rateLimitType?: string
    }
  // The run is paused until the subscription window resets, then auto-continues.
  | { type: 'limited'; resetsAt?: number; rateLimitType?: string; resumesInMs?: number }
  // An interrupted run is being auto-continued via resume + a continuation turn.
  | { type: 'resuming'; attempt: number }

// Last-known subscription rate-limit snapshot cached in main + shown in the gauge.
export interface RateLimitInfo {
  status: 'allowed' | 'allowed_warning' | 'rejected'
  utilization?: number
  resetsAt?: number
  rateLimitType?: string
}

// One subscription limit window (5h session, 7d week, 7d per-model) as shown in
// the usage widget. `utilization` is a 0–1 fraction (may exceed 1 in overage);
// `resetsAt` is epoch ms. `label` is a display string, e.g. 'session', 'week',
// 'week · Fable'.
export interface UsageWindow {
  label: string
  status: 'allowed' | 'allowed_warning' | 'rejected'
  utilization: number
  resetsAt?: number
}

// Full multi-window usage snapshot shown by the gauge, plus when it was captured.
// `source` distinguishes a full `/usage` poll from a single-window live
// rate_limit_event harvested during a chat run.
export interface UsageSnapshot {
  windows: UsageWindow[]
  fetchedAt: number
  source: 'poll' | 'event'
}

// Every chat event forwarded to the renderer is wrapped with a per-session
// monotonic sequence number so a reattaching client can replay only the gap.
export interface SeqEnvelope<E> {
  seq: number
  event: E
}

// Events streamed from main → renderer during a news-digest run (tRPC
// subscription). The skill owns the file write, so `done` only reports the path.
export type NewsEvent =
  | { type: 'token'; text: string }
  | { type: 'done'; filePath: string }
  | { type: 'error'; message: string }
  | { type: 'aborted' }

// Events streamed from main → renderer during an interactive skill-improver
// session (tRPC subscription). `awaiting-input` marks a turn boundary where the
// agent paused for the user's reply; `report` carries the parsed final A/B report.
export type ImproverEvent =
  | { type: 'token'; text: string }
  | { type: 'tool'; name: string; summary: string }
  | { type: 'awaiting-input' }
  | { type: 'report'; report: ImproverReport }
  // `done`/`aborted` carry the session's totals so the router can log a stats
  // event row (the run consumed tokens/time whether or not it was applied).
  | { type: 'done'; tokens: number; durationMs: number }
  | { type: 'error'; message: string }
  | { type: 'aborted'; tokens: number; durationMs: number }

// Events streamed from main → renderer during a benchmark-discussion chat
// (tRPC subscription). Mirrors the improver shape minus accept/reject/report.
export type BenchmarkChatEvent = BaseChatEvent

// Events streamed from main → renderer during a general free-form chat.
export type GeneralChatEvent = BaseChatEvent

// Events streamed from main → renderer during a roadmap brainstorming chat
// (tRPC subscription). `saved` fires when the agent's finished idea has been
// parsed from the stream and persisted; it carries the created item.
export type RoadmapChatEvent = BaseChatEvent | { type: 'saved'; item: RoadmapItem }

// Events streamed from main → renderer during a graphify deep-map run (tRPC
// subscription). `done` carries how many graphify nodes/edges were merged.
export type GraphDeepMapEvent =
  | { type: 'tool'; name: string; summary: string }
  | { type: 'progress'; message: string }
  | { type: 'done'; nodesAdded: number; edgesAdded: number }
  | { type: 'error'; message: string }
  | { type: 'aborted' }
