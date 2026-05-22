// Events streamed from main → renderer during an agent run (tRPC subscription).
export type AgentEvent =
  | { type: 'token'; text: string }
  | { type: 'done'; filePath: string; tokens: number; durationMs: number }
  | { type: 'error'; message: string }
  | { type: 'aborted' }
