// Shared job types for the global process indicator. Plain structurally-cloneable
// shapes — they cross the electron-trpc IPC boundary with no transformer.

// 'error' also represents user-aborted runs (the indicator shows status, not a
// distinct aborted state).
export type JobStatus = 'running' | 'done' | 'error'

// A job as seen by the renderer. Never carries the abort callback; `cancellable`
// is the derived boolean the UI uses to decide whether to render the abort button.
export interface JobView {
  id: string
  kind: string
  label: string
  status: JobStatus
  startedAt: number
  endedAt: number | null
  cancellable: boolean
}

// Payload streamed over jobs.list. `running` first, then the most-recent-first
// ring buffer of completed jobs.
export interface JobsSnapshot {
  running: JobView[]
  recent: JobView[]
}
