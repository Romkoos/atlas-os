// src/main/services/benchmark/types.ts

export interface Assertion {
  type: 'includes' | 'regex'
  value: string
}

// Cognitive / I/O archetype the task probes. Used to surface which infra wins
// in which genre — caveman-style compression helps `output-heavy` and `dialog`
// but pays only overhead in `lookup`/`enumerate`, etc.
export type TaskCategory =
  | 'lookup' // find one fact, ~1-line answer
  | 'extract' // pull a fact out of a file, short answer
  | 'enumerate' // list / structure data from a file
  | 'explain' // explain a system in prose
  | 'reason' // diagnose, trade-off, decision
  | 'synthesize' // generate new code / API / schema
  | 'navigate' // search across many files
  | 'dialog' // long multi-turn session (amortized cost)
  | 'output-heavy' // dominated by output tokens — compression matters here
  | 'honesty' // model must refuse / admit absence; tests hallucination resistance
  | 'tool-diversity' // exercises a tool beyond Read/Grep/Glob

export interface BenchmarkTask {
  id: string
  // Human-friendly label shown in the UI (falls back to `id` if absent). `id`
  // stays the stable machine key — DB rows reference it forever.
  name?: string
  // One-paragraph plain-language explanation of what the task probes — shown on
  // hover via the info icon next to the name in the results table.
  description?: string
  // Cognitive/IO archetype — used to group results by genre. Required for new
  // tasks; older rows without one render as 'uncategorized'.
  category?: TaskCategory
  prompt: string
  // Additional user turns sent IN THE SAME SESSION (via SDK `resume`), so the
  // prefix is created once and read across turns — models a real coding session
  // and lets us measure amortized cost. Assertion is checked against the final
  // turn's response. If absent, the task is a single-turn (current behavior).
  followUps?: string[]
  // Per-task tool allowlist override. Defaults to ['Read', 'Grep', 'Glob']
  // (read-only). Tasks that legitimately need Bash (read-only git inspection,
  // for example) can widen the set here — but keep it read-only (no Edit/Write).
  allowedTools?: string[]
  assert: Assertion
}

export type FailReason = 'sdk_error' | 'assertion_failed' | 'timeout' | 'rate_limited'

export interface RunResult {
  taskId: string
  model: string
  tokensIn: number
  tokensOut: number
  cacheReadTokens: number
  cacheCreationTokens: number
  totalCostUsd: number
  numTurns: number
  durationMs: number
  success: boolean
  failReason: FailReason | null
  sessionId: string | null
  // Final-turn assistant text. NOT persisted to DB (would balloon the row);
  // exists only so debug / rerun scripts can inspect why an assertion failed.
  resultText?: string
}
