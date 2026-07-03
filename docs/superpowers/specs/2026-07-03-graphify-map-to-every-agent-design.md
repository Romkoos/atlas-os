# Graphify Map → Every Agent — Design

**Date:** 2026-07-03
**Status:** Approved (brainstorming), pending implementation plan

## Problem

Graphify already builds a per-project code/knowledge graph and merges it into a
per-project store at `~/atlas-maps/<project>/` (compact `index.md` "Map Index" +
full `graphify-out/graph.json`, wiki, report). An on-demand query wrapper
(`~/atlas-maps/_engine/query.py`) and a `SessionStart` injector
(`~/atlas-maps/_engine/session-start.py`) already exist.

But the useful data never reaches the agents that would benefit:

1. **`session-start.py` is not registered** in `~/.claude/settings.json`. Only the
   `atlas-knowledge` hooks are wired, so the Map Index is injected into *nothing*.
2. **`SessionStart` does not fire for subagents.** Even once wired, it would only
   reach the main session — not the subagents spawned via the Task tool, which is
   where much of the real work happens.

Net effect: the graph is built on every "Build" but is invisible during actual
work — "why bother building it".

## Goal

Make the graphify map available to **every agent** — the main session **and all
subagent types** (general-purpose, custom `.claude/agents`, and the built-in
`Explore`/`Plan` agents) — as a **hybrid** of:

- **Passive layer:** the compact Map Index is always present in context.
- **Active layer:** every agent knows it can run `query.py` for deeper, targeted
  lookups against the full graph.

Scope resolves automatically per project via `basename(cwd)`; projects without a
built store inject nothing and are unaffected.

## Key constraints / findings

Confirmed against Claude Code docs (via `claude-code-guide`):

- **`CLAUDE.md` reaches subagents** — *except* the built-in `Explore` and `Plan`
  agents, which skip `CLAUDE.md` by design with no override. So `CLAUDE.md`
  cannot satisfy "every agent".
- **`SubagentStart` hook exists**, fires when any subagent is spawned, supports a
  `matcher` by agent-type and an `additionalContext` output (like `SessionStart`).
  It **does** reach `Explore`/`Plan`.
- Therefore the correct mechanism for full coverage is **hooks**
  (`SessionStart` + `SubagentStart`), not `CLAUDE.md`. This also avoids editing
  every project's `CLAUDE.md` — all config lives in one global
  `~/.claude/settings.json`.

Decisions locked during brainstorming:

- Delivery model: **hybrid** (passive Map Index + on-demand `query.py`).
- Coverage: **main session + all subagents**.
- Subagent matcher: **all types** (`"*"`) — including `Explore`/`Plan`, since the
  community map helps them navigate code, and the cost is trivial.

## Architecture

Three thin pieces in `~/atlas-maps/_engine/`, plus one config edit.

### 1. Shared context builder — `_context.py` (new)

Extract the injection logic (currently inline in `session-start.py`) into a shared
helper so both hooks stay DRY.

`build_context(payload: dict) -> str`:

1. Read `cwd` from the hook stdin payload; fall back to `os.getcwd()`.
2. `project = basename(normpath(cwd))`; reject empty / `.` / `..` / `_engine`.
3. Read `<store>/<project>/index.md` (store root = `$ATLAS_MAPS_STORE` or
   `~/atlas-maps`). Missing file → return `""` (never break the session).
4. Truncate body to `MAX_CHARS` (keep existing 8000 cap).
5. Return a block:

   ```
   ## Project Map (from the map store ~/atlas-maps/<project>/)

   <index.md body>

   ---
   Deeper queries: run
   `python ~/atlas-maps/_engine/query.py "<question>" --project <project>`
   for a read-only lookup against the full graph.
   ```

The query-instruction line is the **active layer** — it is what makes every agent
aware of `query.py`.

### 2. Hook scripts (thin wrappers)

- **`session-start.py`** (rewrite): call `_context.build_context(payload)`, emit
  `{"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": ...}}`.
- **`subagent-start.py`** (new): identical, but `"hookEventName": "SubagentStart"`.

Both wrap the body in `try/except` → empty context on any error (never break a
session or subagent spawn).

### 3. Config — `~/.claude/settings.json`

Add alongside the existing `atlas-knowledge` hooks (do not disturb them):

- `SessionStart` → add a command entry running `session-start.py` via the same
  interpreter convention as the existing hooks.
- `SubagentStart` → new event, `matcher: "*"`, command running `subagent-start.py`.

### 4. Query layer — `query.py` (unchanged)

Already implemented and correct. No changes; it is surfaced via the injected
instruction line. Confirm the Bash permission for
`python ~/atlas-maps/_engine/query.py ...` does not hard-block agents (it is a
read-only command; a prompt is acceptable, an outright deny is not).

## Data flow

```
Build (existing) ──► ~/atlas-maps/<project>/index.md  +  graphify-out/graph.json
                                   │                              │
        ┌──────────────────────────┤                              │
        ▼                          ▼                              ▼
  SessionStart hook          SubagentStart hook            query.py (on demand)
  (main session)             (every subagent, "*")         graphify query graph.json
        │                          │                              │
        └────────► additionalContext: Map Index + query hint ◄────┘
```

## Coverage matrix

| Agent | Gets Map Index | Via |
|---|---|---|
| Main session | ✓ | `SessionStart` |
| general-purpose | ✓ | `SubagentStart "*"` |
| Custom `.claude/agents` | ✓ | `SubagentStart "*"` |
| Explore | ✓ | `SubagentStart "*"` (would be missed by CLAUDE.md) |
| Plan | ✓ | `SubagentStart "*"` (would be missed by CLAUDE.md) |
| Project without a store | — (empty) | resolves, finds no `index.md`, injects nothing |

## Error handling

- Any exception in a hook → empty `additionalContext`. A broken map must never
  break a session or a subagent spawn.
- Missing store / missing `index.md` → empty (silent, expected for unbuilt projects).
- `query.py` already handles: invalid project, missing `graph.json`, missing
  `graphify` binary, timeout — all non-fatal with clear stderr.

## Token cost

- `index.md` ≈ 1.2 KB. Injected once per agent as static prefix content → cached,
  no cache thrash. A 17-subagent run adds ≈ 20 KB input total. Negligible.

## Open risk to verify during implementation

- **Does `SubagentStart` provide `cwd` in its stdin payload** the same way
  `SessionStart` does? If the field is named differently or absent, the
  `os.getcwd()` fallback must still resolve the correct project (a subagent shares
  the parent's cwd, so the fallback is expected to be correct). This must be
  **tested against a real subagent spawn**, not assumed.

## Testing

- Unit: `build_context` returns the block for a known project; returns `""` for
  missing index, `_engine`, empty cwd, and traversal-y names.
- Integration: register hooks; start a session in `atlas-os` → confirm Map Index
  in context. Spawn a `general-purpose` and an `Explore` subagent → confirm both
  receive it (verifies the `cwd`/payload assumption).
- Negative: run in a project with no store → no injection, no error.

## Out of scope (YAGNI)

- No change to how the graph is built or merged (Build pipeline stays as-is).
- No `CLAUDE.md` edits (hooks supersede that need).
- No auto-rebuild / staleness detection — the map reflects the last Build, by design.
- No injection of the full `graph.json` (only the compact `index.md`).
