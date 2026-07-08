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

// ── Roadmap ─────────────────────────────────────────────────────────────────
// One candidate feature for Atlas OS, shown on the ROADMAP page. Seeded once
// from the brainstorm list (guarded by a store flag), then user-editable.
export const roadmapItems = sqliteTable(
  'roadmap_items',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    category: text('category').notNull(), // intelligence | observability | macos | connectivity | wow
    status: text('status').notNull().default('todo'), // todo | planned | in-progress | done
    priority: text('priority').notNull().default('medium'), // low | medium | high
    // English implementation brief for Claude Code — what the idea is, briefly.
    claudePrompt: text('claude_prompt').notNull().default(''),
    position: integer('position').notNull().default(0), // manual order within a category
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('idx_roadmap_category').on(t.category), index('idx_roadmap_status').on(t.status)],
)

export type RoadmapItemRow = typeof roadmapItems.$inferSelect
export type NewRoadmapItemRow = typeof roadmapItems.$inferInsert

// ── Project Intelligence Layer ──────────────────────────────────────────────
// A code/project graph per Atlas-tracked repo. `origin` separates the two build
// passes: 'indexer' (fast structural) and 'graphify' (LLM-inferred semantic),
// so each can be rebuilt without wiping the other. See
// docs/superpowers/specs/2026-07-01-project-intelligence-layer-design.md.
export const graphNodes = sqliteTable(
  'graph_nodes',
  {
    id: text('id').primaryKey(),
    projectPath: text('project_path').notNull(),
    kind: text('kind').notNull(), // code | doc | skill | knowledge | session
    label: text('label').notNull(),
    relPath: text('rel_path'),
    meta: text('meta', { mode: 'json' }).$type<Record<string, unknown>>(),
    community: integer('community'),
    origin: text('origin').notNull(), // indexer | graphify
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index('idx_graph_nodes_project').on(t.projectPath),
    index('idx_graph_nodes_kind').on(t.kind),
  ],
)

export const graphEdges = sqliteTable(
  'graph_edges',
  {
    id: text('id').primaryKey(),
    projectPath: text('project_path').notNull(),
    source: text('source').notNull(),
    target: text('target').notNull(),
    kind: text('kind').notNull(), // imports | doc_link | session_touched | mentions_knowledge | semantic
    inferred: integer('inferred', { mode: 'boolean' }).notNull(),
    origin: text('origin').notNull(), // indexer | graphify
    meta: text('meta', { mode: 'json' }).$type<Record<string, unknown>>(),
  },
  (t) => [
    index('idx_graph_edges_project').on(t.projectPath),
    index('idx_graph_edges_source').on(t.source),
    index('idx_graph_edges_target').on(t.target),
  ],
)

export type GraphNodeRow = typeof graphNodes.$inferSelect
export type NewGraphNodeRow = typeof graphNodes.$inferInsert
export type GraphEdgeRow = typeof graphEdges.$inferSelect
export type NewGraphEdgeRow = typeof graphEdges.$inferInsert

// ── Unified Signals Event Log ───────────────────────────────────────────────
// One row per notable cross-subsystem event (job finished, benchmark batch done,
// infra/ecosystem change, roadmap edit, chat error). Written via
// recordSignal() (src/main/services/signals/registry.ts) — services never insert
// here directly. Drives the dashboard SignalsPanel feed and the Signals page.
// See docs/superpowers/specs/2026-07-06-unified-signals-event-log-design.md.
export const signals = sqliteTable(
  'signals',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    source: text('source').notNull(), // jobs | infra | roadmap | chat | news
    type: text('type').notNull(), // namespaced source.event, e.g. job.completed
    severity: text('severity').notNull(), // info | success | warning | error
    title: text('title').notNull(),
    detail: text('detail'),
    // Navigation target. linkKind='section' → an in-app Section id (SPA nav);
    // linkKind='path' → a filesystem path revealed in Finder. Both nullable.
    link: text('link'),
    linkKind: text('link_kind'), // 'section' | 'path' | null
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    readAt: integer('read_at', { mode: 'timestamp_ms' }),
  },
  (t) => [index('idx_signals_created').on(t.createdAt), index('idx_signals_source').on(t.source)],
)

export type SignalRow = typeof signals.$inferSelect
export type NewSignalRow = typeof signals.$inferInsert
