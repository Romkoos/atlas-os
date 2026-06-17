import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

// One row per AI action. Single source of truth for the Event type (re-used in
// the renderer via tRPC type inference — never imported at runtime there).
export const events = sqliteTable('events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  type: text('type').notNull(),
  model: text('model').notNull(),
  tokens: integer('tokens').notNull().default(0),
  filePath: text('file_path'),
  durationMs: integer('duration_ms').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
})

export type EventRow = typeof events.$inferSelect
export type NewEventRow = typeof events.$inferInsert

// ── Agent Productivity Tracker ──────────────────────────────────────────────
// See docs/agent-productivity-tracker.md. Distinct from `events` above (which
// tracks Atlas's own AI actions). These three tables are populated by the
// productivity ingest service: agent_turns from Claude Code transcripts,
// agent_sessions/ecosystem_changes from the ~/agent-analytics JSONL buffer.

// One turn of the agent, reconstructed from a Claude Code transcript.
// id is deterministic (hash of session_id + turn_index) so re-ingesting a
// growing transcript is idempotent via onConflictDoNothing.
export const agentTurns = sqliteTable(
  'agent_turns',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id').notNull(),
    projectPath: text('project_path').notNull(),
    turnIndex: integer('turn_index').notNull(),
    ts: integer('ts', { mode: 'timestamp_ms' }).notNull(),
    tokensIn: integer('tokens_in').notNull().default(0),
    tokensOut: integer('tokens_out').notNull().default(0),
    toolsUsed: text('tools_used', { mode: 'json' }).$type<string[]>().notNull(),
    skillsUsed: text('skills_used', { mode: 'json' }).$type<string[]>().notNull(),
    filesTouched: text('files_touched', { mode: 'json' }).$type<string[]>().notNull().default([]),
    complexityProxy: real('complexity_proxy'), // DEPRECATED: no longer written; remove in a future migration
  },
  (t) => [
    index('idx_turns_session').on(t.sessionId),
    index('idx_turns_project').on(t.projectPath),
    index('idx_turns_ts').on(t.ts),
  ],
)

// Per-session summary: lifecycle from hooks, score/summary from the /done skill,
// aggregates recomputed from agent_turns on each ingest.
export const agentSessions = sqliteTable(
  'agent_sessions',
  {
    sessionId: text('session_id').primaryKey(),
    projectPath: text('project_path').notNull(),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }),
    endedAt: integer('ended_at', { mode: 'timestamp_ms' }),
    endReason: text('end_reason'),
    score: integer('score'), // 1–10, user-set via setRating
    difficulty: integer('difficulty'), // 1–10 intrinsic task difficulty; null = unknown
    difficultySource: text('difficulty_source'), // 'llm' | 'manual' | null
    summary: text('summary'),
    totalTokensIn: integer('total_tokens_in').notNull().default(0),
    totalTokensOut: integer('total_tokens_out').notNull().default(0),
    turnCount: integer('turn_count').notNull().default(0),
    avgComplexity: real('avg_complexity'), // DEPRECATED: complexity is computed at read time
    distinctFiles: integer('distinct_files').notNull().default(0),
    distinctDirs: integer('distinct_dirs').notNull().default(0),
    distinctTools: integer('distinct_tools').notNull().default(0),
    distinctSkills: integer('distinct_skills').notNull().default(0),
    subagentCount: integer('subagent_count').notNull().default(0),
  },
  (t) => [
    index('idx_sessions_project').on(t.projectPath),
    index('idx_sessions_started').on(t.startedAt),
  ],
)

// One ecosystem change: settings (ConfigChange), skills (FileChanged), or a
// manual note added from the Atlas UI. id is deterministic for idempotency.
export const ecosystemChanges = sqliteTable(
  'ecosystem_changes',
  {
    id: text('id').primaryKey(),
    ts: integer('ts', { mode: 'timestamp_ms' }).notNull(),
    type: text('type').notNull(), // mcp_added | skill_edited | config_changed | manual_note | …
    target: text('target'),
    source: text('source'), // 'auto' | 'manual'
    diff: text('diff'),
    note: text('note'),
  },
  (t) => [index('idx_eco_ts').on(t.ts), index('idx_eco_type').on(t.type)],
)

// A frozen efficiency baseline per scope (project path or '__global__').
// `expectedTokens(difficulty)` is derived from `method` + `params`; the latest
// row per scope is active. New rows are written only on first use or explicit
// re-baseline, so historical Eff never mutates on its own.
export const kpiBaseline = sqliteTable(
  'kpi_baseline',
  {
    id: text('id').primaryKey(),
    scope: text('scope').notNull(), // projectPath or '__global__'
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    periodStart: integer('period_start', { mode: 'timestamp_ms' }),
    periodEnd: integer('period_end', { mode: 'timestamp_ms' }),
    method: text('method').notNull(), // 'loglinear' | 'global-median'
    params: text('params', { mode: 'json' })
      .$type<{ a?: number; b?: number; median?: number }>()
      .notNull(),
    sessionCount: integer('session_count').notNull(),
  },
  (t) => [index('idx_kpi_baseline_scope').on(t.scope)],
)

export type KpiBaselineRow = typeof kpiBaseline.$inferSelect
export type NewKpiBaselineRow = typeof kpiBaseline.$inferInsert

export type AgentTurnRow = typeof agentTurns.$inferSelect
export type NewAgentTurnRow = typeof agentTurns.$inferInsert
export type AgentSessionRow = typeof agentSessions.$inferSelect
export type NewAgentSessionRow = typeof agentSessions.$inferInsert
export type EcosystemChangeRow = typeof ecosystemChanges.$inferSelect
export type NewEcosystemChangeRow = typeof ecosystemChanges.$inferInsert

// One row per benchmark run (task × rep). Frozen-task token cost stamped with an
// infra fingerprint so cost is comparable across infra versions. See
// docs/superpowers/specs/2026-05-25-benchmark-suite-design.md.
export const benchmarkRuns = sqliteTable(
  'benchmark_runs',
  {
    id: text('id').primaryKey(),
    batchId: text('batch_id').notNull(),
    ts: integer('ts', { mode: 'timestamp_ms' }).notNull(),
    taskId: text('task_id').notNull(),
    rep: integer('rep').notNull(),
    infraHash: text('infra_hash').notNull(),
    infraSnapshot: text('infra_snapshot', { mode: 'json' })
      .$type<import('@main/services/productivity/infra').InfraState>()
      .notNull(),
    repoCommit: text('repo_commit').notNull(),
    model: text('model').notNull(),
    tokensIn: integer('tokens_in').notNull().default(0),
    tokensOut: integer('tokens_out').notNull().default(0),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    cacheCreationTokens: integer('cache_creation_tokens').notNull().default(0),
    totalCostUsd: real('total_cost_usd').notNull().default(0),
    numTurns: integer('num_turns').notNull().default(0),
    durationMs: integer('duration_ms').notNull().default(0),
    success: integer('success', { mode: 'boolean' }).notNull(),
    failReason: text('fail_reason'),
    transcriptPath: text('transcript_path'),
  },
  (t) => [
    index('idx_bench_task').on(t.taskId),
    index('idx_bench_infra').on(t.infraHash),
    index('idx_bench_batch').on(t.batchId),
    index('idx_bench_ts').on(t.ts),
  ],
)

// One row per completed batch's auto-analysis. The UI reads the newest row, so
// it behaves as "replaced each batch". `dataJson` is the A/B slice the summary
// was based on; it also seeds the discuss-chat. `summary` is null when the
// analysis call failed.
export const benchmarkAnalysis = sqliteTable(
  'benchmark_analysis',
  {
    id: text('id').primaryKey(),
    batchId: text('batch_id').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    model: text('model').notNull(),
    infraHash: text('infra_hash').notNull(),
    baselineInfraHash: text('baseline_infra_hash'),
    summary: text('summary'),
    dataJson: text('data_json', { mode: 'json' })
      .$type<import('@main/services/benchmark/aggregate').AbRow[]>()
      .notNull(),
  },
  (t) => [index('idx_bench_analysis_created').on(t.createdAt)],
)

export type BenchmarkAnalysisRow = typeof benchmarkAnalysis.$inferSelect
export type NewBenchmarkAnalysisRow = typeof benchmarkAnalysis.$inferInsert
