import type { RoadmapCategory, RoadmapPriority } from '@shared/roadmap'

// The initial roadmap, distilled from the feature brainstorm. Seeded once into
// an empty table (guarded by a store flag) so deletions never re-seed. Order
// within each category defines `position`.
export interface RoadmapSeed {
  title: string
  description: string
  category: RoadmapCategory
  priority: RoadmapPriority
  // English brief handed to Claude Code to implement the idea.
  claudePrompt: string
}

export const ROADMAP_SEED: RoadmapSeed[] = [
  // ── Intelligence & Automation ──────────────────────────────────────────────
  {
    title: 'Agent Orchestrator (multi-agent workflows)',
    description:
      'A visual DAG canvas to wire subagents into pipelines (fan-out → verify → synthesize), run them, and watch live progress. A GUI over the Workflow pattern, saved as reusable .flow files.',
    category: 'intelligence',
    priority: 'high',
    claudePrompt:
      'Build a visual multi-agent workflow builder in Atlas OS. Add a new page + tRPC router. Let the user compose a DAG of Claude Agent SDK steps (fan-out, verify, synthesize) on a canvas, persist graphs as .flow JSON in SQLite (new Drizzle table + migration), and execute them by driving the Agent SDK per node. Reuse the streaming-input session pattern in src/main/services/benchmarkChat/run.ts and the job registry for live progress. Stream per-node status to the renderer over a tRPC subscription.',
  },
  {
    title: 'Ambient "Atlas Copilot"',
    description:
      'A global hotkey (⌘⇧Space) command palette that answers questions grounded on your own knowledge graph + current project, and can trigger any Atlas action by natural language.',
    category: 'intelligence',
    priority: 'medium',
    claudePrompt:
      'Add a global command palette to Atlas OS opened by a system-wide shortcut (Electron globalShortcut, e.g. Cmd+Shift+Space) that shows a floating input. Route natural-language queries to a Claude Agent SDK run grounded on the ~/atlas-knowledge index (see src/main/services/knowledge and src/main/trpc/routers/knowledge.ts), and let it invoke existing Atlas actions by mapping intents to tRPC procedures. Stream the answer into a small overlay. Keep the renderer sandboxed; do all Node work in main.',
  },
  {
    title: 'Self-improving skills loop',
    description:
      'A nightly cron that benchmarks each skill, detects regressions, and auto-proposes SKILL.md edits — extends the existing skill-improver into a scheduled, autonomous optimizer.',
    category: 'intelligence',
    priority: 'medium',
    claudePrompt:
      'Extend the existing skill-improver (src/main/services/skillImprover, src/main/trpc/routers/skillImprover.ts) into a scheduled, autonomous optimizer. Add a scheduler in main that periodically benchmarks each skill using the benchmark suite (src/main/services/benchmark), detects score regressions against a stored baseline, and runs the improver to draft SKILL.md edits as backups for review. Persist run history in a new Drizzle table. Surface proposed diffs on the Skills page for one-click accept/revert.',
  },
  {
    title: 'Cost / token forecaster',
    description:
      "Predict a task's token cost before running it (from historical benchmark data), with a live budget meter and a pre-flight 'this will cost ~X' estimate.",
    category: 'intelligence',
    priority: 'medium',
    claudePrompt:
      'Add token/cost forecasting to Atlas OS. Fit a simple estimator over historical benchmark_runs + agent_turns (see src/main/db/schema.ts) that maps task/difficulty signals to expected tokens and USD cost. Expose a tRPC query that returns a pre-flight estimate for a given prompt, and render a "this will cost ~X" chip plus a live budget meter in the agent run UI. Keep the model logic pure and unit-tested in a shared module.',
  },
  // ── Observability & Insight ────────────────────────────────────────────────
  {
    title: 'Live session timeline / flame view',
    description:
      'A real-time waterfall of tool calls, subagents, and token burn for the running agent — a profiler for Claude sessions.',
    category: 'observability',
    priority: 'high',
    claudePrompt:
      'Build a real-time "flame"/waterfall view of a running Claude session in Atlas OS. During an Agent SDK run (src/main/services/claude.ts + agent router), emit structured timeline events (tool_use start/end, subagent spawn, token deltas) over a tRPC subscription. Render a horizontal waterfall in the renderer (reuse the Recharts/terminal styling) showing each tool call duration and cumulative token burn. Also allow replaying a finished session from its stored transcript.',
  },
  {
    title: 'Knowledge freshness radar',
    description:
      'Detects stale wiki articles (source daily-log hash drift) and surfaces a "recompile these" queue.',
    category: 'observability',
    priority: 'medium',
    claudePrompt:
      'Add staleness detection to the Knowledge feature. For each compiled wiki article under ~/atlas-knowledge, compare a stored hash of its source daily-log set against the current sources (see the compilation pipeline referenced in src/main/services/knowledge). Expose a tRPC query listing stale articles and render a "recompile these" queue on the Knowledge page with a one-click recompile action. Store per-article source hashes so drift is cheap to check.',
  },
  {
    title: 'Semantic search over everything',
    description:
      'A local embeddings index across daily logs, transcripts, skills, and benchmarks; ask "when did I fix the flush ledger bug?" and jump to the exact log.',
    category: 'observability',
    priority: 'high',
    claudePrompt:
      'Add local semantic search across daily logs, Claude transcripts, skills, and benchmark data. Build an embeddings index in main (local model or a small on-device embedder), stored in SQLite with incremental updates on file change. Expose a tRPC query that returns ranked snippets with source + line, and add a search UI (extend the Knowledge search page) that deep-links to the exact file/location. Keep indexing off the UI thread and idempotent.',
  },
  // ── Native macOS Power ─────────────────────────────────────────────────────
  {
    title: 'Menu-bar mini-HUD',
    description:
      "A tray widget showing running jobs, today's KPI, and token spend without opening the app; click to expand.",
    category: 'macos',
    priority: 'medium',
    claudePrompt:
      "Add a macOS menu-bar (Tray) HUD to Atlas OS. In main, create an Electron Tray with a small popover window showing live running jobs (from the job registry, src/main/services/jobs), today's KPI, and token spend, updated via the same data the Dashboard uses. Clicking an item focuses/opens the main window on the relevant page. Handle app lifecycle so the tray persists when the window is closed.",
  },
  {
    title: 'Focus/DND-aware scheduling',
    description:
      'Run heavy benchmarks only when macOS is idle / on AC power (respecting the "benchmarks must stay sequential" constraint).',
    category: 'macos',
    priority: 'low',
    claudePrompt:
      'Add condition-aware scheduling for heavy jobs (benchmarks) in Atlas OS. In main, detect system idle time (powerMonitor.getSystemIdleTime) and AC-power state (powerMonitor on-ac/on-battery) and only start queued benchmark batches when idle and on power. IMPORTANT: benchmark runs must stay strictly sequential (parallelism breaks cache/wall-time metrics). Add settings toggles and expose the current scheduling state to the UI.',
  },
  {
    title: 'Local voice interface',
    description: 'Dictate a task, hear a spoken summary of results — on-device Whisper + TTS.',
    category: 'macos',
    priority: 'low',
    claudePrompt:
      'Add a voice interface to Atlas OS. Capture microphone audio, transcribe on-device (whisper.cpp or a bundled local model) in main, feed the text as a prompt to the Agent SDK, and speak a short summary of the result back via macOS TTS (say / a native binding). Add a push-to-talk control in the UI and a settings toggle. Keep all audio processing local; never send audio off device.',
  },
  // ── Connectivity & Data ────────────────────────────────────────────────────
  {
    title: 'Plugin / MCP marketplace panel',
    description: 'Browse, install, and health-check MCP servers and skills from inside Atlas.',
    category: 'connectivity',
    priority: 'medium',
    claudePrompt:
      'Extend the Plugins page (src/renderer/src/pages/Plugins.tsx, src/main/trpc/routers/plugins.ts, src/main/services/plugins) into a marketplace panel. Add browse/search of available MCP servers and skills, one-click install via the claude CLI, and a health-check that pings each configured MCP server and reports status. Reuse the existing job registry for install/update operations and the CLI-wrapping pattern already used for plugin updates.',
  },
  {
    title: 'Cross-project knowledge federation',
    description:
      'Opt-in aggregation across projects — a deliberate bridge over the current per-project knowledge isolation.',
    category: 'connectivity',
    priority: 'low',
    claudePrompt:
      'Add opt-in cross-project knowledge aggregation. Knowledge is currently isolated per project (loaded by cwd). Add a federated view that unions selected projects’ ~/atlas-knowledge indexes into one browsable/searchable graph, with clear provenance per node and a project filter. Extend the knowledge tRPC router with a multi-project mode; keep single-project isolation as the default. Guard all path handling against traversal.',
  },
  {
    title: 'Time-travel diff for knowledge',
    description: 'A slider to scrub how a concept article or the graph evolved over weeks.',
    category: 'connectivity',
    priority: 'low',
    claudePrompt:
      'Add a time-travel diff to the Knowledge feature. Use git history of the ~/atlas-knowledge repo (or stored snapshots) to reconstruct a concept article / the knowledge graph at past points in time. Add a date slider that scrubs versions and renders a diff (added/removed sections, new/removed graph edges). Do the git reads in main via a tRPC query returning the content at a given commit/date; render the diff in the renderer.',
  },
  // ── Wow-factor / Experimental ──────────────────────────────────────────────
  {
    title: '3D / VR knowledge graph',
    description: 'A WebGL galaxy view of your Louvain clusters you can fly through.',
    category: 'wow',
    priority: 'low',
    claudePrompt:
      'Add a 3D "galaxy" view of the knowledge graph. Reuse the existing graph data + Louvain communities (graphology) that power the 2D force graph on the Knowledge page, and render them in 3D with react-force-graph-3d / three.js: clusters as colored regions, articles as nodes you can fly through, click-to-open. Add it as an alternate view mode toggle next to the current ./graph tab. Keep it performant for hundreds of nodes.',
  },
  {
    title: '"Daily standup" auto-digest',
    description:
      'Each morning Atlas narrates what you did yesterday (from logs) and gives a prioritized plan for today.',
    category: 'wow',
    priority: 'medium',
    claudePrompt:
      'Add a "daily standup" digest to Atlas OS. On a morning schedule, run an Agent SDK summarization over yesterday’s daily logs + agent_sessions to produce (1) a recap of what was done and (2) a prioritized plan for today, optionally seeded by open roadmap items. Persist each digest, show it on the Dashboard, and send a native notification. Reuse the news/trending run-host pattern for the scheduled generation.',
  },
  {
    title: 'Anomaly alerts',
    description:
      'A statistical watcher that pings you when a KPI, token rate, or infra fingerprint suddenly deviates.',
    category: 'wow',
    priority: 'medium',
    claudePrompt:
      'Add a statistical anomaly watcher to Atlas OS. Periodically compute rolling baselines (median + MAD) over KPI, token rate, and infra fingerprint from agent_sessions/benchmark_runs, flag points that deviate beyond a threshold, and raise a native notification + an alerts feed in the UI. Make thresholds configurable in Settings and keep the detection logic in a pure, unit-tested shared module.',
  },
]
