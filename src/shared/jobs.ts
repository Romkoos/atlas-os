// Shared job types for the process indicator + dashboard panel. Plain
// structurally-cloneable shapes — they cross the electron-trpc IPC boundary
// with no transformer.

// 'error' is a genuine failure; 'cancelled' is a user-initiated abort (× on a
// chat tab / abort button). They render differently and only 'error' emits a Signal.
export type JobStatus = 'running' | 'done' | 'error' | 'cancelled'

// A job as seen by the renderer. Never carries the abort callback; `cancellable`
// is the derived boolean the UI uses to decide whether to render the abort button.
// The meta fields are null when not applicable to that process kind.
export interface JobView {
  id: string
  kind: string
  label: string
  status: JobStatus
  startedAt: number
  endedAt: number | null
  cancellable: boolean
  model: string | null
  detail: string | null
  tokens: number | null
  resultPath: string | null
  error: string | null
}

// Payload streamed over jobs.list. `running` first, then the most-recent-first
// ring buffer of completed jobs.
export interface JobsSnapshot {
  running: JobView[]
  recent: JobView[]
}
