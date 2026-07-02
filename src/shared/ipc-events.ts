import type { RoadmapItem } from '@shared/roadmap'
import type { ImproverReport } from '@shared/skillImprover'

// Common events shared by every drawer chat's transport layer.
export type BaseChatEvent =
  | { type: 'token'; text: string }
  | { type: 'tool'; name: string; summary: string }
  | { type: 'awaiting-input' }
  | { type: 'done' }
  | { type: 'error'; message: string }
  | { type: 'aborted' }

// Every chat event forwarded to the renderer is wrapped with a per-session
// monotonic sequence number so a reattaching client can replay only the gap.
export interface SeqEnvelope<E> {
  seq: number
  event: E
}

// Events streamed from main → renderer during an agent run (tRPC subscription).
export type AgentEvent =
  | { type: 'token'; text: string }
  | { type: 'done'; filePath: string; tokens: number; durationMs: number }
  | { type: 'error'; message: string }
  | { type: 'aborted' }

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
