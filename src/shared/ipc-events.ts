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
