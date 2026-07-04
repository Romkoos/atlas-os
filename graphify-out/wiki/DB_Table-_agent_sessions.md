# DB Table: agent_sessions

> God node · 12 connections · `release/mac-arm64/Atlas OS.app/Contents/Resources/drizzle/0001_overrated_sir_ram.sql`

## Connections by Relation

### conceptually_related_to
- [[DB Table: kpi_baseline]] `INFERRED`
- [[DB Table: benchmark_runs]] `INFERRED`

### references
- [[DB Table: agent_turns]] `EXTRACTED`
- [[Column: agent_sessions.difficulty]] `EXTRACTED`
- [[Column: agent_sessions.difficulty_source]] `EXTRACTED`
- [[DB Index: idx_sessions_project]] `EXTRACTED`
- [[DB Index: idx_sessions_started]] `EXTRACTED`
- [[Column: agent_sessions.distinct_files]] `EXTRACTED`
- [[Column: agent_sessions.distinct_dirs]] `EXTRACTED`
- [[Column: agent_sessions.distinct_tools]] `EXTRACTED`
- [[Column: agent_sessions.distinct_skills]] `EXTRACTED`
- [[Column: agent_sessions.subagent_count]] `EXTRACTED`

---

*Part of the graphify knowledge wiki. See [[index]] to navigate.*