// Shared types for the Settings "Rebuild & Update" feature — a one-button
// version of the manual deploy protocol (build from prod `main` → swap the
// installed .app → relaunch), runnable from the packaged prod app itself.

// idle          — no run in flight
// running       — pipeline executing (git → install → dist)
// awaiting-confirm — build succeeded; waiting for the user to confirm the swap
// swapping      — detached swap script spawned; app is about to quit
// error         — a step failed (message is in the log)
export type RebuildState = 'idle' | 'running' | 'awaiting-confirm' | 'swapping' | 'error'

// A single streamed event: the (possibly unchanged) state, plus an optional new
// log line. State-only events fire on transitions; line-only events stream
// child stdout/stderr.
export interface RebuildEvent {
  state: RebuildState
  line?: string
}

// Full run state for reattach (query on modal mount).
export interface RebuildSnapshot {
  state: RebuildState
  log: string[]
  // The freshly-staged bundle path, once the build reaches awaiting-confirm.
  bundlePath: string | null
}
