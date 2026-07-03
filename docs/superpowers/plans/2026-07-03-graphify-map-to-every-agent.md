# Graphify Map → Every Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver each project's compact graphify Map Index to the main Claude Code session and to every subagent (general-purpose, custom, and the CLAUDE.md-skipping `Explore`/`Plan`), plus surface the on-demand `query.py` deep-lookup, via `SessionStart` + `SubagentStart` hooks.

**Architecture:** A shared stdlib-only `_context.py` builds the injection block (Map Index from `~/atlas-maps/<project>/index.md` + a `query.py` instruction line). Two thin hook wrappers (`session-start.py`, `subagent-start.py`) call it and emit `additionalContext`. Both are registered globally in `~/.claude/settings.json`. `query.py` is unchanged.

**Tech Stack:** Python 3 (stdlib only: `json`, `os`, `sys`, `pathlib`, `unittest`, `tempfile`, `subprocess`); Claude Code hooks (`SessionStart`, `SubagentStart`); JSON settings.

## Global Constraints

- **Not a git repo.** `~/atlas-maps/` and `~/.claude/` are unversioned local infra. There are **no `git commit` steps**; each task's gate is a passing test or verification run. (The design spec is already committed in the atlas-os repo.)
- **Stdlib only.** No third-party imports in any `_engine` script — hooks must run under plain `python3` with no venv/`uv`.
- **Never break a session.** Every hook path is wrapped so any error yields an empty `additionalContext`, never an exception into the session/subagent.
- **Store root:** `$ATLAS_MAPS_STORE` if set, else `~/atlas-maps`. Reserved dir name `_engine` is never a project.
- **Char cap:** Map Index body truncated to `MAX_CHARS = 8000`.
- **Absolute paths in config:** the user's home is `/Users/Roman.Neganov`; settings commands use absolute script paths.
- **Interpreter:** `python3` (system, currently 3.14). Invoke scripts as `python3 "<abs path>"` (script dir lands on `sys.path[0]`, so `import _context` resolves).

---

### Task 1: Shared context builder `_context.py`

**Files:**
- Create: `/Users/Roman.Neganov/atlas-maps/_engine/_context.py`
- Test: `/Users/Roman.Neganov/atlas-maps/_engine/test_context.py`

**Interfaces:**
- Produces:
  - `maps_root() -> pathlib.Path`
  - `resolve_project(payload: dict) -> str` — `basename(cwd)`; `""` for empty/`.`/`..`/`_engine`/paths containing a separator.
  - `build_context(payload: dict) -> str` — the full injection block, or `""` when no map exists. `payload` is the hook's parsed stdin JSON (uses key `"cwd"`, falls back to `os.getcwd()`).

- [ ] **Step 1: Write the failing test**

Create `/Users/Roman.Neganov/atlas-maps/_engine/test_context.py`:

```python
import json
import os
import tempfile
import unittest
from pathlib import Path

import _context


class BuildContextTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        os.environ["ATLAS_MAPS_STORE"] = self.tmp.name
        self.root = Path(self.tmp.name)

    def tearDown(self):
        os.environ.pop("ATLAS_MAPS_STORE", None)
        self.tmp.cleanup()

    def _write_index(self, project, body):
        d = self.root / project
        d.mkdir(parents=True, exist_ok=True)
        (d / "index.md").write_text(body, encoding="utf-8")

    def test_returns_map_block_with_query_hint(self):
        self._write_index("atlas-os", "# Map Index — atlas-os\n2193 nodes")
        out = _context.build_context({"cwd": "/somewhere/atlas-os"})
        self.assertIn("## Project Map", out)
        self.assertIn("# Map Index — atlas-os", out)
        self.assertIn("query.py", out)
        self.assertIn("--project atlas-os", out)

    def test_missing_index_returns_empty(self):
        self.assertEqual(_context.build_context({"cwd": "/x/no-such-project"}), "")

    def test_reserved_engine_returns_empty(self):
        self._write_index("_engine", "should never inject")
        self.assertEqual(_context.build_context({"cwd": "/x/_engine"}), "")

    def test_empty_payload_falls_back_to_cwd(self):
        # os.getcwd() during the test run is the _engine dir -> reserved -> ""
        self.assertEqual(_context.build_context({}), "")

    def test_body_truncated_to_max_chars(self):
        big = "# Map Index — big\n" + ("x" * 9000)
        self._write_index("big", big)
        out = _context.build_context({"cwd": "/x/big"})
        # the index body contribution must not exceed MAX_CHARS
        self.assertLessEqual(out.count("x"), _context.MAX_CHARS)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/Roman.Neganov/atlas-maps/_engine && python3 -m unittest test_context -v`
Expected: FAIL — `ModuleNotFoundError: No module named '_context'`.

- [ ] **Step 3: Write minimal implementation**

Create `/Users/Roman.Neganov/atlas-maps/_engine/_context.py`:

```python
#!/usr/bin/env python3
"""Shared context builder for atlas-maps hooks.

Resolves project = basename(cwd), reads <store>/<project>/index.md, and returns
a Map Index block (passive layer) plus a query.py instruction (active layer).
Never raises: callers get "" on any problem so a session/subagent never breaks.
"""
from __future__ import annotations

import os
from pathlib import Path

MAX_CHARS = 8000


def maps_root() -> Path:
    return Path(os.environ.get("ATLAS_MAPS_STORE") or (Path.home() / "atlas-maps"))


def resolve_project(payload: dict) -> str:
    cwd = payload.get("cwd") or os.getcwd()
    project = os.path.basename(os.path.normpath(cwd))
    if not project or project in (".", "..", "_engine") or "/" in project or "\\" in project:
        return ""
    return project


def build_context(payload: dict) -> str:
    project = resolve_project(payload)
    if not project:
        return ""
    root = maps_root()
    index = root / project / "index.md"
    if not index.is_file():
        return ""
    body = index.read_text(encoding="utf-8")[:MAX_CHARS]
    query = root / "_engine" / "query.py"
    return (
        f"## Project Map (from the map store {root / project}/)\n\n"
        f"{body}\n\n"
        "---\n"
        f'Deeper queries: run `python3 "{query}" "<question>" --project {project}` '
        "for a read-only lookup against the full graph."
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/Roman.Neganov/atlas-maps/_engine && python3 -m unittest test_context -v`
Expected: PASS — 5 tests OK.

---

### Task 2: Rewrite `session-start.py` to use `_context`

**Files:**
- Modify: `/Users/Roman.Neganov/atlas-maps/_engine/session-start.py` (full rewrite)
- Test: manual subprocess check (integration)

**Interfaces:**
- Consumes: `_context.build_context` (Task 1).
- Produces: stdout JSON `{"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": <str>}}`.

- [ ] **Step 1: Write the failing integration check**

Run (against the real store, which already has `atlas-os/index.md`):

```bash
cd /Users/Roman.Neganov/atlas-maps/_engine && \
echo '{"cwd":"/Users/Roman.Neganov/Projects/PersonalProjects/atlas-os"}' \
  | python3 session-start.py \
  | python3 -c "import sys,json; d=json.load(sys.stdin)['hookSpecificOutput']; print(d['hookEventName']); print('HINT' if 'query.py' in d['additionalContext'] else 'NO-HINT'); print('MAP' if '## Project Map' in d['additionalContext'] else 'NO-MAP')"
```

Expected BEFORE the rewrite: prints `SessionStart` but `NO-HINT` (current script injects the raw index with no `query.py` line).

- [ ] **Step 2: Rewrite the script**

Replace the entire contents of `/Users/Roman.Neganov/atlas-maps/_engine/session-start.py` with:

```python
#!/usr/bin/env python3
"""SessionStart hook — inject the current project's graphify Map Index.

Reads <store>/<basename(cwd)>/index.md via _context.build_context and emits it
as additionalContext. Never raises into the session: any error -> empty context.
"""
from __future__ import annotations

import json
import sys

from _context import build_context


def main() -> None:
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        payload = {}
    try:
        context = build_context(payload)
    except Exception:
        context = ""  # never break the session
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "additionalContext": context,
        }
    }))


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Run the integration check to verify it passes**

Run the same command from Step 1.
Expected: prints `SessionStart`, `HINT`, `MAP`.

- [ ] **Step 4: Confirm the no-map path stays silent**

Run:

```bash
cd /Users/Roman.Neganov/atlas-maps/_engine && \
echo '{"cwd":"/tmp/definitely-not-a-project-xyz"}' | python3 session-start.py
```

Expected: `{"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": ""}}`.

---

### Task 3: New `subagent-start.py`

**Files:**
- Create: `/Users/Roman.Neganov/atlas-maps/_engine/subagent-start.py`
- Test: manual subprocess check (integration)

**Interfaces:**
- Consumes: `_context.build_context` (Task 1).
- Produces: stdout JSON `{"hookSpecificOutput": {"hookEventName": "SubagentStart", "additionalContext": <str>}}`.

- [ ] **Step 1: Write the failing integration check**

Run:

```bash
cd /Users/Roman.Neganov/atlas-maps/_engine && \
echo '{"cwd":"/Users/Roman.Neganov/Projects/PersonalProjects/atlas-os"}' \
  | python3 subagent-start.py
```

Expected BEFORE creating the file: FAIL — `python3: can't open file '.../subagent-start.py': [Errno 2] No such file or directory`.

- [ ] **Step 2: Create the script**

Create `/Users/Roman.Neganov/atlas-maps/_engine/subagent-start.py`:

```python
#!/usr/bin/env python3
"""SubagentStart hook — inject the current project's graphify Map Index into
every spawned subagent (matcher "*"), including Explore/Plan which skip CLAUDE.md.

Identical to session-start.py except for the hookEventName. Reads
<store>/<basename(cwd)>/index.md via _context.build_context. Never raises.
"""
from __future__ import annotations

import json
import sys

from _context import build_context


def main() -> None:
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        payload = {}
    try:
        context = build_context(payload)
    except Exception:
        context = ""  # never break the subagent spawn
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "SubagentStart",
            "additionalContext": context,
        }
    }))


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Run the integration check to verify it passes**

```bash
cd /Users/Roman.Neganov/atlas-maps/_engine && \
echo '{"cwd":"/Users/Roman.Neganov/Projects/PersonalProjects/atlas-os"}' \
  | python3 subagent-start.py \
  | python3 -c "import sys,json; d=json.load(sys.stdin)['hookSpecificOutput']; print(d['hookEventName']); print('HINT' if 'query.py' in d['additionalContext'] else 'NO-HINT'); print('MAP' if '## Project Map' in d['additionalContext'] else 'NO-MAP')"
```

Expected: prints `SubagentStart`, `HINT`, `MAP`.

---

### Task 4: Register both hooks in `~/.claude/settings.json`

**Files:**
- Modify: `/Users/Roman.Neganov/.claude/settings.json`
- Backup: `/Users/Roman.Neganov/.claude/settings.json.bak-<date>`

**Interfaces:**
- Consumes: `session-start.py` (Task 2), `subagent-start.py` (Task 3).
- Produces: a `SessionStart` command entry and a `SubagentStart` (`matcher: "*"`) command entry, added idempotently alongside the existing `atlas-knowledge` hooks (which must remain untouched).

- [ ] **Step 1: Back up the current settings**

```bash
cp /Users/Roman.Neganov/.claude/settings.json \
   "/Users/Roman.Neganov/.claude/settings.json.bak-$(date +%Y%m%d-%H%M%S)"
```

Expected: a `.bak-…` file appears; no output.

- [ ] **Step 2: Verify the settings are valid JSON before editing**

```bash
python3 -c "import json;json.load(open('/Users/Roman.Neganov/.claude/settings.json'));print('valid')"
```

Expected: `valid`.

- [ ] **Step 3: Apply the idempotent patch**

Run:

```bash
python3 - <<'PY'
import json, pathlib
p = pathlib.Path("/Users/Roman.Neganov/.claude/settings.json")
s = json.loads(p.read_text())
hooks = s.setdefault("hooks", {})

SESSION_CMD = 'python3 "/Users/Roman.Neganov/atlas-maps/_engine/session-start.py"'
SUBAGENT_CMD = 'python3 "/Users/Roman.Neganov/atlas-maps/_engine/subagent-start.py"'

def has_cmd(arr, cmd):
    return any(hk.get("command") == cmd for m in arr for hk in m.get("hooks", []))

ss = hooks.setdefault("SessionStart", [])
if not has_cmd(ss, SESSION_CMD):
    ss.append({"hooks": [{"type": "command", "command": SESSION_CMD}]})

sa = hooks.setdefault("SubagentStart", [])
if not has_cmd(sa, SUBAGENT_CMD):
    sa.append({"matcher": "*", "hooks": [{"type": "command", "command": SUBAGENT_CMD}]})

p.write_text(json.dumps(s, indent=2) + "\n")
print("patched")
PY
```

Expected: `patched`.

- [ ] **Step 4: Verify the result**

```bash
python3 -c "
import json
h=json.load(open('/Users/Roman.Neganov/.claude/settings.json'))['hooks']
ss=[hk['command'] for m in h.get('SessionStart',[]) for hk in m.get('hooks',[])]
sa=[(m.get('matcher'),hk['command']) for m in h.get('SubagentStart',[]) for hk in m.get('hooks',[])]
assert any('atlas-maps/_engine/session-start.py' in c for c in ss), 'SessionStart missing'
assert any('atlas-knowledge/_engine/hooks/session-start.py' in c for c in ss), 'atlas-knowledge SessionStart lost!'
assert any(mt=='*' and 'subagent-start.py' in c for mt,c in sa), 'SubagentStart missing'
print('ok: maps + knowledge hooks both present')
"
```

Expected: `ok: maps + knowledge hooks both present`.

- [ ] **Step 5: Re-run the patch to confirm idempotency**

Run the Step 3 block again.
Expected: `patched`, and re-running Step 4 still prints `ok` with no duplicate entries (verify by eye: `SessionStart` has exactly one maps entry).

---

### Task 5: Live end-to-end verification (validates the `SubagentStart` cwd assumption)

**Files:** none (verification only).

**Interfaces:**
- Consumes: the registered hooks (Task 4). This is the task that resolves the spec's open risk — *does `SubagentStart` provide `cwd` such that the correct project resolves?*

- [ ] **Step 1: Reload hooks**

Start a **new** Claude Code session in `/Users/Roman.Neganov/Projects/PersonalProjects/atlas-os` (settings.json hook changes load at session start). In-session, run `/hooks` and confirm both `SessionStart` (maps) and `SubagentStart` (`*`, maps) are listed.

Expected: both entries visible.

- [ ] **Step 2: Confirm main-session injection**

In that session, ask the agent: *"Do you see a `## Project Map` block for atlas-os in your context? Quote its first line."*

Expected: it quotes `# Map Index — atlas-os` (or the current index's first line).

- [ ] **Step 3: Confirm subagent injection (general-purpose)**

Dispatch a `general-purpose` subagent with the prompt: *"Report verbatim the first line of any `## Project Map` block in your context, or output NONE if there is no such block. Do not read any files."*

Expected: the subagent reports the Map Index first line — proving `SubagentStart` injected and `cwd` resolved to `atlas-os`.

- [ ] **Step 4: Confirm the CLAUDE.md-skipping path (Explore)**

Dispatch an `Explore` subagent with the same prompt as Step 3.

Expected: the `Explore` subagent also reports the Map Index first line — proving coverage of the agents that skip CLAUDE.md (the core reason for using hooks).

- [ ] **Step 5: Confirm the deep-query path works**

From the main session, run:

```bash
python3 "/Users/Roman.Neganov/atlas-maps/_engine/query.py" "What are the top communities and their key nodes?" --project atlas-os
```

Expected: a non-error graphify answer grounded in `graph.json` (or, if `graphify` is not on PATH / no `graph.json`, the documented non-fatal stderr message — in which case note it for follow-up, but the injection layer is still complete).

- [ ] **Step 6: Confirm the no-map project stays clean**

Start a session in any directory with no store entry (e.g. a scratch dir) and confirm no `## Project Map` block appears and nothing errors.

Expected: no injection, no error.

---

## Self-Review

**Spec coverage:**
- Passive layer (Map Index always in context) → Tasks 1–4 (build + both hooks + registration). ✓
- Active layer (`query.py` awareness) → hint line in `_context.build_context` (Task 1), verified Task 5 Step 5. ✓
- Main-session coverage → `session-start.py` (Task 2), verified Task 5 Step 2. ✓
- Subagent coverage incl. Explore/Plan → `subagent-start.py` + `matcher:"*"` (Tasks 3–4), verified Task 5 Steps 3–4. ✓
- Per-project scoping / no-store silence → `resolve_project` + missing-index guard (Task 1), verified Task 5 Step 6. ✓
- Never-break error handling → try/except in both hooks (Tasks 2–3). ✓
- Token cost / 8000 cap → `MAX_CHARS` truncation (Task 1, `test_body_truncated_to_max_chars`). ✓
- Open risk (SubagentStart `cwd`) → explicitly validated in Task 5 Steps 3–4. ✓
- `query.py` unchanged → no task modifies it. ✓
- No CLAUDE.md edits → none in plan. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every command shows expected output. ✓

**Type consistency:** `build_context(payload: dict) -> str`, `resolve_project`, `maps_root`, and `MAX_CHARS` are named identically across Tasks 1–3 and the tests. Both hooks import `build_context` from `_context`. ✓
