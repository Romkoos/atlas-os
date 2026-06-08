import type { ImproverReport } from '@shared/skillImprover'

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
  | { type: 'done' }
  | { type: 'error'; message: string }
  | { type: 'aborted' }
