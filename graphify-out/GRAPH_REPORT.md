# Graph Report - /Users/Roman.Neganov/Projects/PersonalProjects/atlas-os  (2026-07-03)

## Corpus Check
- Large corpus: 368 files · ~281,134 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder, or use --no-semantic to run AST-only.

## Summary
- 1242 nodes · 1360 edges · 62 communities detected
- Extraction: 91% EXTRACTED · 9% INFERRED · 1% AMBIGUOUS · INFERRED: 118 edges (avg confidence: 0.78)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Session & Skill Tracking|Session & Skill Tracking]]
- [[_COMMUNITY_Benchmark & Productivity Analytics|Benchmark & Productivity Analytics]]
- [[_COMMUNITY_Knowledge Store & Compilation|Knowledge Store & Compilation]]
- [[_COMMUNITY_Code Import Resolution|Code Import Resolution]]
- [[_COMMUNITY_Code Graph & Maps|Code Graph & Maps]]
- [[_COMMUNITY_Settings & Configuration|Settings & Configuration]]
- [[_COMMUNITY_Run Aggregation & Analysis|Run Aggregation & Analysis]]
- [[_COMMUNITY_Infrastructure Change Detection|Infrastructure Change Detection]]
- [[_COMMUNITY_Graph Data Layer & DnD|Graph Data Layer & DnD]]
- [[_COMMUNITY_Benchmark Baseline Management|Benchmark Baseline Management]]
- [[_COMMUNITY_Graph Build Pipeline|Graph Build Pipeline]]
- [[_COMMUNITY_Benchmark Post-Run Experience|Benchmark Post-Run Experience]]
- [[_COMMUNITY_Marketplace & Updates|Marketplace & Updates]]
- [[_COMMUNITY_Chat Session Management|Chat Session Management]]
- [[_COMMUNITY_Chart Components|Chart Components]]
- [[_COMMUNITY_Atlas Maps Integration|Atlas Maps Integration]]
- [[_COMMUNITY_Session Schema Columns|Session Schema Columns]]
- [[_COMMUNITY_KPI Formatting Utilities|KPI Formatting Utilities]]
- [[_COMMUNITY_Graph Cluster & Export|Graph Cluster & Export]]
- [[_COMMUNITY_Chat Overlay Components|Chat Overlay Components]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 76|Community 76]]
- [[_COMMUNITY_Community 82|Community 82]]
- [[_COMMUNITY_Community 85|Community 85]]
- [[_COMMUNITY_Community 88|Community 88]]
- [[_COMMUNITY_Community 89|Community 89]]
- [[_COMMUNITY_Community 97|Community 97]]
- [[_COMMUNITY_Community 98|Community 98]]
- [[_COMMUNITY_Community 99|Community 99]]
- [[_COMMUNITY_Community 159|Community 159]]
- [[_COMMUNITY_Community 160|Community 160]]
- [[_COMMUNITY_Community 161|Community 161]]
- [[_COMMUNITY_Community 258|Community 258]]
- [[_COMMUNITY_Community 259|Community 259]]
- [[_COMMUNITY_Community 260|Community 260]]

## God Nodes (most connected - your core abstractions)
1. `db()` - 18 edges
2. `Multi-Source Graph Visualization Design Spec` - 18 edges
3. `Dashboard Processes Panel Design` - 13 edges
4. `runLoop()` - 12 edges
5. `DB Table: agent_sessions` - 12 edges
6. `graph_nodes table` - 12 edges
7. `Multi-Source Graph Visualization Implementation Plan` - 12 edges
8. `indexProject()` - 11 edges
9. `collectIngestRows()` - 11 edges
10. `graph_edges table` - 11 edges

## Surprising Connections (you probably didn't know these)
- `Graph Indexer (indexer.ts)` --references--> `agent_turns table (SQLite)`  [EXTRACTED]
  docs/superpowers/specs/2026-07-01-project-intelligence-layer-design.md → drizzle/0001_overrated_sir_ram.sql
- `graphifyRunner.ts (Deep-map runner)` --references--> `graph_edges table`  [EXTRACTED]
  docs/superpowers/specs/2026-07-01-project-intelligence-layer-design.md → drizzle/0009_happy_krista_starr.sql
- `getSubgraphContext (context.ts)` --references--> `graph_nodes table`  [EXTRACTED]
  docs/superpowers/specs/2026-07-01-project-intelligence-layer-design.md → drizzle/0009_happy_krista_starr.sql
- `Vertical slice: run agent -> stream -> save .md + DB row` --semantically_similar_to--> `tRPC streaming subscription (agent.run)`  [INFERRED] [semantically similar]
  docs/superpowers/plans/2026-05-22-atlas-os-starter.md → README.md
- `stats tRPC router (Phase 5)` --semantically_similar_to--> `Stats page`  [INFERRED] [semantically similar]
  docs/superpowers/plans/2026-05-22-atlas-os-starter.md → README.md

## Hyperedges (group relationships)
- **** — cqm_percentile_complexity, kpi1_kpi_formula, kpd_formula [INFERRED 0.80]
- **** — unifiedchatdrawer_chatdrawerstore, generalchat_chatdrawer_integration, skillimproverdrawer_chatdrawer_extension [EXTRACTED 0.90]
- **** — graph_indexer, graphify_runner, map_export [INFERRED 0.80]
- **Source Toggle System: SOURCE_KEYS + filterBySources + graphSources + CodeGraphTab** —  [INFERRED 0.90]
- **Graphify Layer Pipeline: mergeGraphifyGraph produces graphify-origin nodes + defined_in bridges persisted by graphifyRunner** —  [INFERRED 0.90]
- **Origin Color System: colorForNode + GRAPHIFY_COLOR + DEFINED_IN_EDGE_COLOR in graph-colors.ts** —  [INFERRED 0.88]

## Communities

### Community 0 - "Session & Skill Tracking"
Cohesion: 0.04
Nodes (68): agent_sessions table, agent_turns table, complexity_proxy heuristic (original stub), ConfigChange hook (settings edits), /done skill (score + summary), ecosystem_changes table, Ecosystem.tsx page/tab, FileChanged hook (skill edits) (+60 more)

### Community 1 - "Benchmark & Productivity Analytics"
Cohesion: 0.04
Nodes (54): summarizeRuns / buildAbSlice aggregation helpers, buildAnalysisPrompt / runAnalysis one-shot A/B analyzer, Analysis card + Discuss/Retry UI on Productivity page, benchmark batch run loop (phase, retry sweep, notification), benchmark_analysis DB table, benchmarkChat tRPC router (start/reply/cancel), startBenchmarkChat() streaming discussion driver, subscriptionEnv() shared OAuth env helper (+46 more)

### Community 2 - "Knowledge Store & Compilation"
Cohesion: 0.06
Nodes (54): Activity Panel Widget, ATLAS_KB_ROOT Env Var, Atlas Knowledge Store (~/atlas-knowledge), Compile-All Button, compileProject Function, daily-ai-news Skill, Dashboard Page, Dashboard Processes Panel Design (+46 more)

### Community 3 - "Code Import Resolution"
Cohesion: 0.08
Nodes (37): joinRel(), langForExt(), parseImports(), resolveImport(), docLinksFor(), indexProject(), knowledgeProjectName(), walkProject() (+29 more)

### Community 4 - "Code Graph & Maps"
Cohesion: 0.08
Nodes (38): ~/atlas-maps/_engine (session-start.py, query.py), cluster-anchors.ts helper, codeEdgeKindSchema, CodeGraphTab, codeNodeKindSchema, CodeGraphTab Component (Knowledge ./code-graph), colorForNode, DEFINED_IN_EDGE_COLOR (+30 more)

### Community 5 - "Settings & Configuration"
Cohesion: 0.08
Nodes (29): getSettings(), requireStore(), resetSettings(), setSettings(), ensureBaseline(), getActiveBaseline(), getScopedSessions(), rebaseline() (+21 more)

### Community 6 - "Run Aggregation & Analysis"
Cohesion: 0.07
Nodes (23): buildAbSlice(), summarizeRuns(), buildAnalysisPrompt(), runAnalysis(), runLoop(), startBatch(), canonicalInfra(), infraFingerprint() (+15 more)

### Community 7 - "Infrastructure Change Detection"
Cohesion: 0.11
Nodes (28): ecosystemId(), hash(), turnId(), change(), detectInfraChanges(), diffInfraState(), mcpStateOf(), readInfraState() (+20 more)

### Community 8 - "Graph Data Layer & DnD"
Cohesion: 0.07
Nodes (33): @dnd-kit/core dependency, getSubgraphContext (context.ts), graph_edges.id column, graph_edges.inferred column, graph_edges.kind column, graph_edges.meta column, graph_edges.origin column, graph_edges.project_path column (+25 more)

### Community 9 - "Benchmark Baseline Management"
Cohesion: 0.1
Nodes (23): baselineMarkerPath(), clearCompareBaseline(), getInfraCompareData(), readBaselineMarker(), wipeBenchmarkRuns(), buildChatSeed(), db(), initDb() (+15 more)

### Community 10 - "Graph Build Pipeline"
Cohesion: 0.08
Nodes (30): CodeGraphTab single Build button UI, graph.build subscription (renamed from deepMap), graphifyRunner four-stage full-cycle build (index/graphify/merge/export), mapExport.ts (mapIndexMarkdown + exportMap), mapStore.ts guarded ~/atlas-maps store paths, query.py on-demand subgraph query wrapper, session-start.py SessionStart Map-Index injector, roadmapChat router migrated onto ChatSessionRegistry (+22 more)

### Community 11 - "Benchmark Post-Run Experience"
Cohesion: 0.1
Nodes (27): Auto-Analysis Feature, benchmarkAnalysis Table, benchmarkChat Service, Benchmark Post-Run Experience Design, benchmark_runs Table, Benchmark Suite Feature, Benchmark Suite Design, Benchmark Suite Handoff (+19 more)

### Community 12 - "Marketplace & Updates"
Cohesion: 0.16
Nodes (23): addMarketplace(), browseMarketplace(), checkUpdates(), diffUpdate(), friendlyError(), installPlugin(), listPlugins(), mcpHealth() (+15 more)

### Community 13 - "Chat Session Management"
Cohesion: 0.1
Nodes (11): ChatSessionRegistry, append_score(), encode_cwd(), main(), Encode a cwd into the Claude Code projects dir name., Return the session_id of the newest transcript for this cwd, or None., resolve_session_id(), main() (+3 more)

### Community 14 - "Chart Components"
Cohesion: 0.14
Nodes (22): Chart Toolkit, ChartFrame Component, chartMeta.ts, ChartReadout Component, Charts Upgrade Design, DayDrawer Component, Session Difficulty Field, EcoMarkers Overlay (+14 more)

### Community 15 - "Atlas Maps Integration"
Cohesion: 0.15
Nodes (19): ~/atlas-maps/ map store, atlas-maps query.py on-demand query, atlas-maps SessionStart hook injection, SessionStart hook (lifecycle + config snapshot), trackedProjects allowlist setting, config.py env-based root resolution (ATLAS_KB_ROOT), ~/atlas-knowledge/_engine (shared per-project knowledge pipeline), flush.py session flush (spawns compile from engine) (+11 more)

### Community 16 - "Session Schema Columns"
Cohesion: 0.12
Nodes (17): Column: agent_sessions.difficulty, Column: agent_sessions.difficulty_source, Column: agent_sessions.distinct_dirs, Column: agent_sessions.distinct_files, Column: agent_sessions.distinct_skills, Column: agent_sessions.distinct_tools, Column: agent_turns.files_touched, Column: agent_sessions.subagent_count (+9 more)

### Community 17 - "KPI Formatting Utilities"
Cohesion: 0.15
Nodes (2): num(), tokenFmt()

### Community 18 - "Graph Cluster & Export"
Cohesion: 0.22
Nodes (9): clusterGraph(), summarizeClusters(), degrees(), exportMap(), mapIndexMarkdown(), shouldKeepArtifact(), assertInside(), mapsProjectDir() (+1 more)

### Community 19 - "Chat Overlay Components"
Cohesion: 0.18
Nodes (13): BenchmarkChatOverlay Component, chatDrawer store, GeneralChatHost Component, GeneralChatOverlay Component, generalChatRun store, RoadmapChatOverlay Component, SkillImproverOverlay Component, skillImproverRun store (+5 more)

### Community 20 - "Community 20"
Cohesion: 0.23
Nodes (12): Agent Productivity Tracker install guide, Agent Productivity Tracker, Atlas ingest service, config-change-hook.py, done.py helper script, /done skill, ~/agent-analytics/ecosystem-changes.jsonl, file-changed-hook.py (+4 more)

### Community 21 - "Community 21"
Cohesion: 0.2
Nodes (11): Atlas OS (macOS AI tools control panel), Electron pinned to ~38.x (better-sqlite3 ABI compatibility), Security baseline (contextIsolation, sandbox, no API key stored), Settings page, Stats page, tRPC streaming subscription (agent.run), tRPC over custom Electron IPC link, electron-trpc bridge (Phase 2 infrastructure) (+3 more)

### Community 22 - "Community 22"
Cohesion: 0.22
Nodes (11): JobIndicator refactored onto useJobs, JobRegistry extended with model/detail/tokens/resultPath/error, jobs.reveal mutation (open recent job output), JobView extended type, ProcessesPanel dashboard component, trackJob() with FinishMeta mapping, useJobs() shared renderer hook, JobIndicator top-bar component (initial) (+3 more)

### Community 23 - "Community 23"
Cohesion: 0.24
Nodes (4): compact(), handleKeyDown(), num(), start()

### Community 24 - "Community 24"
Cohesion: 0.24
Nodes (5): assembleGraph(), kindForFileType(), mergeGraphifyGraph(), codeEdgeId(), codeNodeId()

### Community 25 - "Community 25"
Cohesion: 0.44
Nodes (8): assertSafeId(), listSkills(), parseAllowedTools(), parseFrontmatter(), readSkill(), readSkillRaw(), toMeta(), writeSkill()

### Community 26 - "Community 26"
Cohesion: 0.25
Nodes (2): JobRegistry, trackJob()

### Community 27 - "Community 27"
Cohesion: 0.22
Nodes (9): Atlas OS app (com.atlas.os), src/renderer/index.html entry page, better-sqlite3 native module, builder-debug.yml (electron-builder debug output), @anthropic-ai/claude-agent-sdk module, electron-builder.yml config, electron-updater config (GitHub publish), Inter font (Google Fonts) (+1 more)

### Community 29 - "Community 29"
Cohesion: 0.29
Nodes (2): runUpdate(), updateAll()

### Community 30 - "Community 30"
Cohesion: 0.32
Nodes (3): replaceLayer(), saveGraphifyGraph(), saveStructuralGraph()

### Community 31 - "Community 31"
Cohesion: 0.43
Nodes (6): assignCommunities(), buildGraph(), computeGraph(), conceptId(), dailyId(), stripExt()

### Community 32 - "Community 32"
Cohesion: 0.52
Nodes (4): formatDate(), formatDateTime(), pad(), toDate()

### Community 33 - "Community 33"
Cohesion: 0.29
Nodes (2): Roadmap(), hideDoneFilter()

### Community 34 - "Community 34"
Cohesion: 0.33
Nodes (2): send(), handleOperation()

### Community 35 - "Community 35"
Cohesion: 0.33
Nodes (6): AppPaths interface (nested claude sub-namespace), ClaudePaths interface, computePaths() pure factory, AppPaths interface (0609 revision), ClaudePaths interface (0609 revision), computePaths() pure factory (0609 revision)

### Community 37 - "Community 37"
Cohesion: 0.4
Nodes (1): ErrorBoundary

### Community 38 - "Community 38"
Cohesion: 0.5
Nodes (2): num(), pct()

### Community 39 - "Community 39"
Cohesion: 0.4
Nodes (1): Graph3DBoundary

### Community 40 - "Community 40"
Cohesion: 0.5
Nodes (2): nodeRadius(), nodeValOf()

### Community 41 - "Community 41"
Cohesion: 0.5
Nodes (2): colorForKind(), colorForNode()

### Community 42 - "Community 42"
Cohesion: 0.7
Nodes (4): buildDateRange(), fillDailySeries(), pad(), toLocalDateString()

### Community 43 - "Community 43"
Cohesion: 0.5
Nodes (3): getSubgraphContext(), resolveSeed(), neighborsOf()

### Community 45 - "Community 45"
Cohesion: 0.4
Nodes (5): Auto-Update: GitHub Provider, Atlas OS App, CSS Bundle (index-BkKLQ_rn.css), JS Bundle (index-BDKHiglN.js), Root Mount Point (#root)

### Community 46 - "Community 46"
Cohesion: 0.83
Nodes (3): build_context(), main(), maps_root()

### Community 57 - "Community 57"
Cohesion: 0.67
Nodes (2): countInbound(), stripExt()

### Community 61 - "Community 61"
Cohesion: 0.5
Nodes (4): roadmap_items.category column, roadmap_items.claude_prompt column, roadmap_items.status column, roadmap_items table

### Community 62 - "Community 62"
Cohesion: 0.67
Nodes (4): generic ChatHost Component, createChatRunStore factory, ChatSessionRegistry (registry.ts), startResumableChat (resumableRun.ts)

### Community 63 - "Community 63"
Cohesion: 1.0
Nodes (2): main(), maps_root()

### Community 76 - "Community 76"
Cohesion: 1.0
Nodes (2): Baseline(), fmtNum()

### Community 82 - "Community 82"
Cohesion: 1.0
Nodes (2): createMainWindow(), registerWindowControls()

### Community 85 - "Community 85"
Cohesion: 1.0
Nodes (2): abortableTurn(), successResult()

### Community 88 - "Community 88"
Cohesion: 1.0
Nodes (2): createMailbox(), userMessage()

### Community 89 - "Community 89"
Cohesion: 1.0
Nodes (2): exists(), findSkillCreatorPath()

### Community 97 - "Community 97"
Cohesion: 0.67
Nodes (3): DB Index: idx_eco_ts, DB Index: idx_eco_type, DB Table: ecosystem_changes

### Community 98 - "Community 98"
Cohesion: 0.67
Nodes (3): generic ChatHost component (reattach-on-mount), createChatRunStore() persisted renderer store factory, SeqEnvelope + BaseChatEvent shared types

### Community 99 - "Community 99"
Cohesion: 0.67
Nodes (3): complexity.ts pure scope-based complexity helpers, agent_turns.filesTouched schema field, percentileRanks() mid-rank percentile helper

### Community 159 - "Community 159"
Cohesion: 1.0
Nodes (2): benchmark_analysis table (SQLite), benchmark_runs table (SQLite)

### Community 160 - "Community 160"
Cohesion: 1.0
Nodes (2): GSD skill suite bulk install (66 skills, one event), Infra-change timeline backfill (reconstructed from ~/.claude)

### Community 161 - "Community 161"
Cohesion: 1.0
Nodes (2): quality = user_rating ?? 7 metric definition, productivity.setRating mutation + Sessions-tab rating UI

### Community 258 - "Community 258"
Cohesion: 1.0
Nodes (1): DB Table: events

### Community 259 - "Community 259"
Cohesion: 1.0
Nodes (1): ecosystem_changes table (SQLite)

### Community 260 - "Community 260"
Cohesion: 1.0
Nodes (1): events table (SQLite)

## Ambiguous Edges - Review These
- `KPI = (score ?? 5.5) x complexity / (tokens/1M)` → `Quality = user_rating ?? 7 (manual rating UI)`  [AMBIGUOUS]
  docs/superpowers/plans/2026-05-23-kpi-efficiency-metric.md · relation: semantically_similar_to
- `Benchmark Suite implementation plan` → `Memory: no-push policy (user pushes, agent must not git push)`  [AMBIGUOUS]
  docs/superpowers/plans/2026-05-25-benchmark-suite.md · relation: references
- `Benchmark Suite implementation plan` → `Memory: git-commit-message skill misfires in atlas-os (wrong repo, Mako-targeted)`  [AMBIGUOUS]
  docs/superpowers/plans/2026-05-25-benchmark-suite.md · relation: references
- `Memory: git-commit-message skill misfires in atlas-os (wrong repo, Mako-targeted)` → `Charts Upgrade Phase 3 plan (DayDrawer drilldown)`  [AMBIGUOUS]
  docs/superpowers/plans/2026-05-25-charts-upgrade-phase3.md · relation: references
- `Charts Upgrade Phase 1 plan` → `Memory: recharts v3 overlay markers (async-paint quirk; keep EcoMarkers/ReferenceLine as-is)`  [AMBIGUOUS]
  docs/superpowers/plans/2026-05-24-charts-upgrade-phase1.md · relation: references
- `Memory: recharts v3 overlay markers (async-paint quirk; keep EcoMarkers/ReferenceLine as-is)` → `Charts Upgrade Phase 2 plan (brush + compare)`  [AMBIGUOUS]
  docs/superpowers/plans/2026-05-25-charts-upgrade-phase2.md · relation: references
- `Memory: recharts v3 overlay markers (async-paint quirk; keep EcoMarkers/ReferenceLine as-is)` → `Charts Upgrade Phase 3 plan (DayDrawer drilldown)`  [AMBIGUOUS]
  docs/superpowers/plans/2026-05-25-charts-upgrade-phase3.md · relation: references

## Knowledge Gaps
- **170 isolated node(s):** `Encode a cwd into the Claude Code projects dir name.`, `Return the session_id of the newest transcript for this cwd, or None.`, `DB Table: events`, `DB Table: kpi_baseline`, `Column: agent_sessions.difficulty` (+165 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `KPI Formatting Utilities`** (14 nodes): `dash()`, `enabled()`, `formatDate()`, `kpiFmt()`, `num()`, `onBrush()`, `onChartClick()`, `onLeave()`, `onMove()`, `onRefresh()`, `pct()`, `scoreLabel()`, `tokenFmt()`, `Productivity.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 26`** (9 nodes): `JobRegistry`, `.cancel()`, `.complete()`, `.getResultPath()`, `.onChange()`, `.register()`, `.snapshot()`, `trackJob()`, `registry.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 29`** (8 nodes): `hasUpdate()`, `runAdd()`, `runInstall()`, `runUninstall()`, `runUpdate()`, `Toggle()`, `updateAll()`, `Plugins.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 33`** (7 nodes): `Roadmap()`, `filterByCategory()`, `groupByStatus()`, `hideDoneFilter()`, `sortColumnItems()`, `board-utils.ts`, `Roadmap.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 34`** (6 nodes): `beginBrainstorm()`, `send()`, `ipc.ts`, `RoadmapChatOverlay.tsx`, `handleOperation()`, `registerTrpcIpc()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 37`** (5 nodes): `ErrorBoundary`, `.componentDidCatch()`, `.getDerivedStateFromError()`, `.render()`, `ErrorBoundary.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 38`** (5 nodes): `dash()`, `num()`, `onKey()`, `pct()`, `DayDrawer.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 39`** (5 nodes): `Graph3DBoundary`, `.componentDidCatch()`, `.getDerivedStateFromError()`, `.render()`, `Graph3DBoundary.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 40`** (5 nodes): `GraphTab()`, `idOf()`, `nodeRadius()`, `nodeValOf()`, `GraphTab.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 41`** (5 nodes): `colorForCommunity()`, `colorForKind()`, `colorForNode()`, `colorForProject()`, `graph-colors.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 57`** (4 nodes): `countInbound()`, `resolveWikilink()`, `stripExt()`, `knowledge.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 63`** (3 nodes): `main()`, `maps_root()`, `query.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 76`** (3 nodes): `Baseline()`, `fmtNum()`, `baseline.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 82`** (3 nodes): `createMainWindow()`, `registerWindowControls()`, `window.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 85`** (3 nodes): `abortableTurn()`, `successResult()`, `runner.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 88`** (3 nodes): `createMailbox()`, `userMessage()`, `mailbox.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 89`** (3 nodes): `exists()`, `findSkillCreatorPath()`, `skillCreator.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 159`** (2 nodes): `benchmark_analysis table (SQLite)`, `benchmark_runs table (SQLite)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 160`** (2 nodes): `GSD skill suite bulk install (66 skills, one event)`, `Infra-change timeline backfill (reconstructed from ~/.claude)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 161`** (2 nodes): `quality = user_rating ?? 7 metric definition`, `productivity.setRating mutation + Sessions-tab rating UI`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 258`** (1 nodes): `DB Table: events`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 259`** (1 nodes): `ecosystem_changes table (SQLite)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 260`** (1 nodes): `events table (SQLite)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `KPI = (score ?? 5.5) x complexity / (tokens/1M)` and `Quality = user_rating ?? 7 (manual rating UI)`?**
  _Edge tagged AMBIGUOUS (relation: semantically_similar_to) - confidence is low._
- **What is the exact relationship between `Benchmark Suite implementation plan` and `Memory: no-push policy (user pushes, agent must not git push)`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **What is the exact relationship between `Benchmark Suite implementation plan` and `Memory: git-commit-message skill misfires in atlas-os (wrong repo, Mako-targeted)`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **What is the exact relationship between `Memory: git-commit-message skill misfires in atlas-os (wrong repo, Mako-targeted)` and `Charts Upgrade Phase 3 plan (DayDrawer drilldown)`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **What is the exact relationship between `Charts Upgrade Phase 1 plan` and `Memory: recharts v3 overlay markers (async-paint quirk; keep EcoMarkers/ReferenceLine as-is)`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **What is the exact relationship between `Memory: recharts v3 overlay markers (async-paint quirk; keep EcoMarkers/ReferenceLine as-is)` and `Charts Upgrade Phase 2 plan (brush + compare)`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **What is the exact relationship between `Memory: recharts v3 overlay markers (async-paint quirk; keep EcoMarkers/ReferenceLine as-is)` and `Charts Upgrade Phase 3 plan (DayDrawer drilldown)`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._