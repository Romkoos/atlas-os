# Global Session-Knowledge Store — Design Spec

**Date:** 2026-05-30
**Status:** Approved design, ready for implementation plan
**Author:** brainstormed with Roman

## Goal

Lift the **personal memory / knowledge-compilation pipeline** from `mako3.0`
(the `claude-memory/` "System 2", a Python pipeline modeled on Karpathy's LLM-KB
design) into a **global, per-project knowledge store** that works for *every*
project automatically, with hooks and rules defined once globally — no
per-project configuration.

Working on `mako3.0` → knowledge lands in `~/atlas-knowledge/mako3.0/`.
Working on `atlas-os` → `~/atlas-knowledge/atlas-os/`. And so on, for any cwd,
with zero setup.

**The pipeline's knowledge logic does not change.** Only the path-resolution
layer (where data is read/written, and how the target project is determined)
changes. Everything else — the LLM prompts in `flush.py`/`compile.py`, the
extraction format, the `AGENTS.md` schema, the index/log/state mechanics — is
copied verbatim.

## What this is NOT

- Not the atlas-os productivity pipeline. That is a *separate*, complementary
  TS/SQLite system that ingests transcripts into **metrics** (tokens,
  efficiency, complexity). This feature is about **knowledge extraction**
  (lessons, concepts, connections → a queryable markdown wiki). They coexist;
  neither replaces the other.
- Not a rewrite. We keep the Python scripts as-is (decision below).

## Locked Decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Pipeline implementation | **Python scripts as-is, global.** Copy mako's pipeline; change only path-resolution. Requires `uv`/python on the machine (same as mako today). |
| 2 | Data location | **`~/atlas-knowledge/<project>/`** — separate, visible folder (backup-friendly, Obsidian-viewable). |
| 3 | Engine location | **`~/atlas-knowledge/_engine/`** — scripts live next to data, one folder for everything. |
| 4 | Hook registration | **Merged idempotently into `~/.claude/settings.json`** (existing-hook-aware; never overwrite). |
| 5 | Project key | **`basename(cwd)`** with a collision fallback (`<basename>-<hash6(abspath)>`). |
| 6 | mako migration | **Disable mako's local memory hooks** so the global ones are the single source. |
| 7 | atlas UI | **Out of scope this session.** Delegated to a follow-up agent — see "Next: UI". |

## Directory Layout

```
~/atlas-knowledge/
├── _engine/                       # the pipeline (copied once from mako, path layer edited)
│   ├── hooks/
│   │   ├── session-start.py       # injects THIS project's index + recent daily into context
│   │   ├── session-end.py         # extracts transcript → spawns flush.py (background)
│   │   └── pre-compact.py         # same as session-end, fires before auto-compaction
│   ├── scripts/
│   │   ├── flush.py               # LLM: transcript → daily/<date>.md  (logic unchanged)
│   │   ├── compile.py             # LLM: daily logs → knowledge/*       (logic unchanged)
│   │   ├── query.py               # retrieval over a project's KB        (logic unchanged)
│   │   ├── lint.py                # KB health checks                     (logic unchanged)
│   │   ├── config.py              # CHANGED: resolves paths per-project from injected ROOT
│   │   └── utils.py               # copied verbatim
│   ├── AGENTS.md                  # KB schema (copied verbatim)
│   ├── pyproject.toml + uv.lock   # copied verbatim
│   └── projects.json             # collision registry: { basename: abspath }
│
├── mako3.0/                       # one folder per project (auto-created on first session)
│   ├── daily/YYYY-MM-DD.md
│   ├── knowledge/
│   │   ├── index.md
│   │   ├── log.md
│   │   ├── concepts/*.md
│   │   ├── connections/*.md
│   │   └── qa/*.md
│   └── state/
│       ├── state.json             # per-project compile state (hash/timestamp/cost)
│       └── last-flush.json        # per-project flush dedup
│
├── atlas-os/
│   └── ...
└── <any-project>/...
```

**Reserved name:** `_engine` (underscore prefix) is never treated as a project.
The project resolver must skip it.

**Note on state/logs:** in mako, `state.json`/`last-flush.json`/`*.log` live in
`scripts/`. Because scripts are now shared/global, **per-project state must move
under each project** (`<project>/state/`). Logs (`flush.log`, `compile.log`)
also become per-project (`<project>/state/*.log`) so concurrent projects don't
interleave. This is part of the config.py path change.

## Project Resolution

A hook fires with a working context. Resolve the project folder name as follows:

1. **Get the absolute project path.** Primary: `cwd` field from the hook's
   stdin JSON. Fallback: decode it from `transcript_path`
   (`~/.claude/projects/<encoded-cwd>/<session>.jsonl` — the encoded segment is
   the cwd with `/` → `-`, same scheme atlas-os productivity already decodes).
   **VERIFY during implementation** that `cwd` is present in stdin for
   `SessionStart`, `SessionEnd`, and `PreCompact` — if any event lacks it, use
   the transcript_path fallback for that event.
2. **Derive name** = `basename(abspath)`.
3. **Collision check** against `_engine/projects.json` (`{ basename: abspath }`):
   - name unseen → claim it (`projects.json[name] = abspath`), use `name`.
   - name maps to *this same* abspath → use `name`.
   - name maps to a *different* abspath → use `name-<hash6(abspath)>` and
     register that.
4. `ROOT = ~/atlas-knowledge/<resolved-name>/`. Create `ROOT/{daily,knowledge/{concepts,connections,qa},state}` lazily if missing (first session on a new project just works — no config).

`hash6` = first 6 hex chars of a stable hash (e.g. sha1) of the abspath.

## How ROOT flows through the pipeline

> **Mechanism refinement (post-brainstorm, locked in the plan):** ROOT is
> carried through the process chain via an **`ATLAS_KB_ROOT` environment
> variable**, not by threading a `resolve(root)` argument through every
> function. The hook resolves the project from stdin `cwd`, sets
> `ATLAS_KB_ROOT` on spawned subprocesses, and `config.py` reads it at import.
> This keeps `utils.py` and the four scripts in their existing
> module-constant style with minimal edits. `config.py` remains the single
> chokepoint — it just resolves from the env instead of from `__file__`.

mako derives `ROOT` from `__file__` (script location). That breaks once engine
and data are separate folders. New scheme:

- **Hooks** compute `ROOT` via Project Resolution above, then:
  - `session-start.py`: read `ROOT/knowledge/index.md` + tail of recent
    `ROOT/daily/*.md`, emit as `additionalContext` (unchanged content logic,
    just ROOT-parameterized; if the project store doesn't exist yet, inject a
    minimal "fresh KB" context).
  - `session-end.py` / `pre-compact.py`: extract transcript to a temp context
    file (under `ROOT/state/` or system temp), then spawn `flush.py` passing
    `--root <ROOT>` (and existing `--session-id`, `--context-file` args).
- **`flush.py`**: accept `--root`; all path constants come from
  `config.resolve(root)` instead of module globals. End-of-day auto-trigger
  spawns `compile.py --root <ROOT>`.
- **`compile.py` / `query.py` / `lint.py`**: accept `--root` (or
  `--project <name>`), resolve paths via `config.resolve(...)`.
- **`config.py`**: replace module-level path constants with a
  `resolve(root: Path) -> Paths` function (a small dataclass/namedtuple holding
  `DAILY_DIR`, `KNOWLEDGE_DIR`, `CONCEPTS_DIR`, `CONNECTIONS_DIR`, `QA_DIR`,
  `INDEX_FILE`, `LOG_FILE`, `STATE_FILE`, `LAST_FLUSH_FILE`, `FLUSH_LOG`,
  `COMPILE_LOG`, `AGENTS_FILE`). `AGENTS_FILE` points into `_engine/`
  (shared schema); everything else points under `<project>/`. Keep `TIMEZONE`,
  `now_iso()`, `today_iso()` unchanged.

**Recursion guard stays:** the `CLAUDE_INVOKED_BY` env check at the top of each
hook is copied verbatim (flush/compile call the Claude SDK, which would
re-fire hooks otherwise).

## Hook Installation (merge into ~/.claude/settings.json)

atlas installs three hooks pointing at the global engine. Installation is
**idempotent and merge-safe** — the global settings already contains a `hooks`
block with gsd-* entries (2 under `SessionStart`, plus `PostToolUse`/`PreToolUse`).

Rules:
- **Append**, do not replace. For `SessionStart`, add our entry alongside the
  existing gsd entries. For `SessionEnd` and `PreCompact` (absent today), create
  the arrays.
- **Idempotency:** before adding, check whether an entry whose command contains
  our engine path is already present; if so, skip. Re-running install never
  duplicates.
- **Command form:** match mako's invocation — `uv run python <engine>/hooks/<x>.py`
  (resolve `uv` absolute path; document the `uv`/python requirement). Confirm the
  working directory / `uv` project resolution works when invoked from arbitrary
  cwd (engine has its own `pyproject.toml`).

Entries to add (illustrative shape; real JSON written by installer):

```jsonc
"SessionStart": [ /* existing gsd entries… */, {
  "hooks": [{ "type": "command",
    "command": "uv run --project /Users/<you>/atlas-knowledge/_engine python /Users/<you>/atlas-knowledge/_engine/hooks/session-start.py" }]
}],
"SessionEnd": [{
  "hooks": [{ "type": "command",
    "command": "uv run --project /Users/<you>/atlas-knowledge/_engine python /Users/<you>/atlas-knowledge/_engine/hooks/session-end.py" }]
}],
"PreCompact": [{
  "hooks": [{ "type": "command",
    "command": "uv run --project /Users/<you>/atlas-knowledge/_engine python /Users/<you>/atlas-knowledge/_engine/hooks/pre-compact.py" }]
}]
```

**Who runs the installer:** a small idempotent step. Default: atlas-os runs it
on app startup (so "no extra configuration" holds). Acceptable alternative: a
one-shot `install.py`/`make install` in `_engine/`. Pick during planning;
startup-merge is preferred to honor the "works everywhere, zero config" goal.
(atlas-os does **not** currently install any hooks, so there is no existing
installer to extend — this is net-new but small.)

## Bootstrap (laying down the store — this session's deliverable scope)

1. Copy `mako3.0/claude-memory/{hooks,scripts,AGENTS.md,pyproject.toml,uv.lock}`
   → `~/atlas-knowledge/_engine/`.
2. Apply the path-layer edits: `config.py` → `resolve(root)`; hooks → project
   resolution + `--root` passing; flush/compile/query/lint → accept `--root`;
   per-project state/log paths.
3. Create `_engine/projects.json` as `{}`.
4. Implement + run the hook installer (merge into `~/.claude/settings.json`).
5. Smoke test: open a Claude session in two different project dirs, confirm
   each gets its own `~/atlas-knowledge/<project>/` with a daily log, and that
   SessionStart injects that project's (possibly empty) index.

## mako Migration

- Disable mako's local memory hooks so the global pipeline is the only one
  writing knowledge. (mako has **no** active `claude-memory/.claude/settings.json`
  hook registration found — verify there's no project-level
  `settings.json`/`settings.local.json` re-registering them, and remove/neuter
  any that exist.)
- **Optional, ask before doing:** migrate existing mako knowledge —
  move `mako3.0/claude-memory/{daily,knowledge}` → `~/atlas-knowledge/mako3.0/`
  (and rewrite `sources:` wikilink paths if needed). Default: leave mako's
  history in place, start the global store fresh; migrate only if Roman wants
  continuity.

## Coexistence / Risks

- **gsd hooks** already occupy `SessionStart` — merge, don't clobber. Covered above.
- **atlas-os productivity hooks**: atlas expects a buffer at `~/agent-analytics`
  written by some hook. We do not touch it; our hooks are additive. Confirm no
  command-string collision during merge.
- **Double-firing for mako**: resolved by disabling mako's local hooks (decision 6).
- **uv/python availability** is a hard runtime dependency (same as mako). The
  hook must fail silently/fast (and log) if `uv` is missing, never block the session.
- **Cost**: unchanged from mako — flush ~\$0.02–0.05/session, compile ~\$0.5/day
  per active project. Now multiplied across active projects; acceptable, but
  note the end-of-day compile fans out per project.
- **Timezone**: mako hardcodes `Asia/Jerusalem`; keep as-is (the 6PM auto-compile
  trigger depends on it).

## Out of Scope

- Rewriting the pipeline in TypeScript.
- Embeddings/RAG (index-guided retrieval is sufficient at this scale).
- Cross-project knowledge linking.
- The atlas UI (next section).

## Next: UI (follow-up agent, separate session)

Surface the per-project knowledge base inside the atlas-os app. Sketch for the
follow-up agent (not part of this implementation):

- **Data source:** read `~/atlas-knowledge/<project>/knowledge/` markdown
  (index, concepts, connections, qa) — files are the source of truth; no DB
  needed for v1, or optionally index them into `atlas.db` for search.
- **Integration points (from atlas-os exploration):**
  - tRPC router (pattern: `src/main/trpc/routers/productivity.ts`) — add
    `knowledge.list(project)`, `knowledge.read(project, slug)`, optional
    `knowledge.query(project, q)` (shells out to `_engine/scripts/query.py`).
  - Renderer page/tab (pattern: `src/renderer/src/pages/Productivity.tsx`) —
    browse concepts/connections, render markdown + wikilinks, per-project
    selector (atlas already models `projectPath`).
  - Reuse `discoverProjects`/project-filter logic already present.
- **Scope to confirm with Roman:** read-only browser first; query/search later.

## Implementation Notes for the Plan

- Verify the exact hook stdin schema (`cwd` presence) before committing to the
  primary project-resolution path; transcript_path decode is the fallback.
- `config.resolve()` is the single chokepoint — get it right and the four
  scripts + three hooks all flow from it.
- Keep a clean diff between "copied verbatim" files and "path-layer edited"
  files so it's auditable that knowledge logic is unchanged.
- The `_engine` reserved-name guard must be in the resolver, not just docs.
