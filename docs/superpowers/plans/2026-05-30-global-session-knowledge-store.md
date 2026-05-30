# Global Session-Knowledge Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lift mako3.0's `claude-memory` Python pipeline into a global, per-project knowledge store at `~/atlas-knowledge/<project>/`, driven by hooks merged once into `~/.claude/settings.json`, so it works for every project with zero per-project configuration.

**Architecture:** Pipeline scripts are copied verbatim into a shared engine at `~/atlas-knowledge/_engine/`. The project's data root is carried through the hook→flush→compile process chain via an `ATLAS_KB_ROOT` environment variable. Hooks resolve the project name from the session's `cwd` (basename + collision-hash, registered in `_engine/projects.json`); `config.py` reads `ATLAS_KB_ROOT` at import and derives all per-project paths. Knowledge-extraction logic (LLM prompts, schema, compile/flush behaviour) is unchanged — only the path-resolution layer changes.

**Tech Stack:** Python 3.11+, `uv` (project manager, already used by mako), `claude-agent-sdk` (already a mako dep), `pytest` (new dev dep). Spec: `docs/superpowers/specs/2026-05-30-global-session-knowledge-store-design.md`.

**Source of truth for copied files:** `/Users/Roman.Neganov/Projects/KeshetProjects/mako3.0/claude-memory/`.

**Target engine dir:** `~/atlas-knowledge/_engine/` (written below as `$ENGINE`). Home is `/Users/Roman.Neganov`.

---

## File Map

**Created (new code):**
- `~/atlas-knowledge/_engine/scripts/project.py` — project-name resolution + registry
- `~/atlas-knowledge/_engine/install.py` — idempotent hook merge into `~/.claude/settings.json`
- `~/atlas-knowledge/_engine/tests/test_project.py`
- `~/atlas-knowledge/_engine/tests/test_config.py`
- `~/atlas-knowledge/_engine/tests/test_install.py`

**Copied verbatim, then edited (path-layer only):**
- `$ENGINE/scripts/config.py` — env-based root resolution (rewritten; full code below)
- `$ENGINE/hooks/session-start.py` — resolve project + inject that project's KB (rewritten; full code below)
- `$ENGINE/hooks/session-end.py`, `$ENGINE/hooks/pre-compact.py` — resolve project, set env, spawn flush (mapping table)
- `$ENGINE/scripts/flush.py` — import root from config, project-scoped logs/state, spawn compile from engine (mapping table)
- `$ENGINE/scripts/compile.py`, `query.py`, `lint.py` — import root from config (mapping table)

**Copied verbatim, NO edits:**
- `$ENGINE/scripts/utils.py` (keeps `from config import …` — works unchanged under env-based config)
- `$ENGINE/AGENTS.md`, `pyproject.toml`, `uv.lock`

**Data (auto-created at runtime):** `~/atlas-knowledge/<project>/{daily,knowledge/{concepts,connections,qa},state}/`

---

## Task 0: Bootstrap the engine + test harness

**Files:**
- Create: `~/atlas-knowledge/_engine/` (copied tree)
- Create: `~/atlas-knowledge/_engine/tests/__init__.py`
- Modify: `~/atlas-knowledge/_engine/pyproject.toml` (add pytest dev dep)

- [ ] **Step 1: Copy the mako pipeline into the engine**

```bash
SRC="/Users/Roman.Neganov/Projects/KeshetProjects/mako3.0/claude-memory"
ENGINE="$HOME/atlas-knowledge/_engine"
mkdir -p "$ENGINE"
cp -R "$SRC/hooks" "$ENGINE/hooks"
cp -R "$SRC/scripts" "$ENGINE/scripts"
cp "$SRC/AGENTS.md" "$ENGINE/AGENTS.md"
cp "$SRC/pyproject.toml" "$ENGINE/pyproject.toml"
cp "$SRC/uv.lock" "$ENGINE/uv.lock"
# Drop copied runtime cruft (state/logs/caches belong per-project, not in engine)
rm -rf "$ENGINE/scripts/__pycache__"
rm -f "$ENGINE/scripts/state.json" "$ENGINE/scripts/last-flush.json" \
      "$ENGINE/scripts/flush.log" "$ENGINE/scripts/compile.log"
mkdir -p "$ENGINE/tests"
touch "$ENGINE/tests/__init__.py"
ls -la "$ENGINE" "$ENGINE/scripts" "$ENGINE/hooks"
```

Expected: `hooks/` has `session-start.py`, `session-end.py`, `pre-compact.py`; `scripts/` has `flush.py compile.py query.py lint.py config.py utils.py` (and NO `state.json`/`*.log`); `AGENTS.md`, `pyproject.toml`, `uv.lock` present.

- [ ] **Step 2: Add pytest as a dev dependency**

Edit `~/atlas-knowledge/_engine/pyproject.toml`. Add (or extend) a dev group with pytest. Append this block if no `[dependency-groups]` exists:

```toml
[dependency-groups]
dev = ["pytest>=8.0"]

[tool.pytest.ini_options]
pythonpath = ["scripts"]
testpaths = ["tests"]
```

(`pythonpath = ["scripts"]` lets tests `import config`, `import project` directly.)

- [ ] **Step 3: Sync the env and verify pytest runs**

Run:
```bash
cd ~/atlas-knowledge/_engine && uv sync && uv run pytest -q
```
Expected: `uv sync` succeeds; pytest reports "no tests ran" (exit 5) — that is fine, tests come next.

- [ ] **Step 4: Commit**

```bash
cd ~/atlas-knowledge/_engine
git init -q 2>/dev/null || true   # engine is its own dir, optional; see note
```

> **Note on VCS:** `~/atlas-knowledge/` is outside the atlas-os repo (decision: lives in storage). It does not need to be a git repo for the feature to work. If you want history, `git init` it once. The atlas-os repo only tracks the spec/plan docs. Do NOT commit `~/atlas-knowledge/` into atlas-os.

---

## Task 1: `project.py` — project resolution + registry

**Files:**
- Create: `~/atlas-knowledge/_engine/scripts/project.py`
- Test: `~/atlas-knowledge/_engine/tests/test_project.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_project.py`:

```python
import json
import os
from pathlib import Path

import pytest


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setenv("ATLAS_KB_STORE", str(tmp_path))
    import importlib
    import project as project_mod
    importlib.reload(project_mod)  # re-read ATLAS_KB_STORE
    return tmp_path, project_mod


def test_basename_is_claimed_for_new_path(store):
    tmp, project = store
    name = project.resolve_name("/Users/me/work/mako3.0")
    assert name == "mako3.0"
    reg = json.loads((tmp / "_engine" / "projects.json").read_text())
    assert reg["mako3.0"] == "/Users/me/work/mako3.0"


def test_same_path_resolves_to_same_name(store):
    _, project = store
    a = project.resolve_name("/Users/me/work/mako3.0")
    b = project.resolve_name("/Users/me/work/mako3.0")
    assert a == b == "mako3.0"


def test_collision_gets_hash_suffix(store):
    _, project = store
    first = project.resolve_name("/Users/me/work/mako3.0")
    second = project.resolve_name("/Users/me/personal/mako3.0")
    assert first == "mako3.0"
    assert second.startswith("mako3.0-")
    assert second != first


def test_reserved_engine_name_is_suffixed(store):
    _, project = store
    name = project.resolve_name("/somewhere/_engine")
    assert name != "_engine"
    assert name.startswith("_engine-")


def test_resolve_root_creates_structure(store):
    tmp, project = store
    root = project.resolve_root("/Users/me/work/atlas-os")
    assert root == tmp / "atlas-os"
    for sub in ("daily", "knowledge/concepts", "knowledge/connections", "knowledge/qa", "state"):
        assert (root / sub).is_dir()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/atlas-knowledge/_engine && uv run pytest tests/test_project.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'project'`.

- [ ] **Step 3: Write `scripts/project.py`**

```python
"""Resolve a session's working directory to a stable per-project store name.

The store lives at $ATLAS_KB_STORE (default ~/atlas-knowledge). Each project
gets a folder named by basename(cwd); collisions (two different absolute paths
sharing a basename) are disambiguated with a short hash suffix. The mapping is
persisted in _engine/projects.json so a given path always resolves the same.
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

STORE_ROOT = Path(os.environ.get("ATLAS_KB_STORE", str(Path.home() / "atlas-knowledge")))
ENGINE_DIR = STORE_ROOT / "_engine"
REGISTRY = ENGINE_DIR / "projects.json"
RESERVED = {"_engine"}

_SUBDIRS = ("daily", "knowledge/concepts", "knowledge/connections", "knowledge/qa", "state")


def _hash6(abspath: str) -> str:
    return hashlib.sha1(abspath.encode("utf-8")).hexdigest()[:6]


def _load_registry() -> dict[str, str]:
    if REGISTRY.exists():
        try:
            return json.loads(REGISTRY.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return {}
    return {}


def _save_registry(reg: dict[str, str]) -> None:
    REGISTRY.parent.mkdir(parents=True, exist_ok=True)
    REGISTRY.write_text(json.dumps(reg, indent=2), encoding="utf-8")


def resolve_name(abspath: str) -> str:
    """Return the stable store folder name for an absolute project path."""
    abspath = str(Path(abspath).expanduser().resolve())
    base = Path(abspath).name
    reg = _load_registry()

    for name, path in reg.items():            # exact reverse lookup wins
        if path == abspath:
            return name

    if base not in reg and base not in RESERVED:
        reg[base] = abspath
        _save_registry(reg)
        return base

    suffixed = f"{base}-{_hash6(abspath)}"     # basename taken by another path
    reg[suffixed] = abspath
    _save_registry(reg)
    return suffixed


def resolve_root(cwd: str | None, transcript_path: str | None = None) -> Path:
    """Resolve the project data root, creating its directory structure."""
    abspath = cwd or _decode_transcript(transcript_path)
    root = STORE_ROOT / resolve_name(abspath)
    for sub in _SUBDIRS:
        (root / sub).mkdir(parents=True, exist_ok=True)
    return root


def _decode_transcript(transcript_path: str | None) -> str:
    """Fallback when cwd is absent: derive a key from the transcript path.

    Claude Code stores transcripts at ~/.claude/projects/<encoded-cwd>/<id>.jsonl
    where <encoded-cwd> is the cwd with '/' replaced by '-'. Full decode is
    lossy, so we use the encoded folder name itself as a stable key.
    """
    if not transcript_path:
        return str(Path.cwd())
    return str(Path(transcript_path).parent.name) or str(Path.cwd())
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/atlas-knowledge/_engine && uv run pytest tests/test_project.py -q`
Expected: PASS (5 passed).

- [ ] **Step 5: Commit** (only if engine is a git repo — see Task 0 note)

```bash
cd ~/atlas-knowledge/_engine && git add -A && git commit -q -m "feat: project resolution + registry" || true
```

---

## Task 2: `config.py` — env-based root resolution

**Files:**
- Modify: `~/atlas-knowledge/_engine/scripts/config.py` (full replacement below)
- Test: `~/atlas-knowledge/_engine/tests/test_config.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_config.py`:

```python
import importlib
from pathlib import Path

import pytest


def _reload_config(monkeypatch, root: Path):
    monkeypatch.setenv("ATLAS_KB_ROOT", str(root))
    import config
    return importlib.reload(config)


def test_paths_derive_from_env_root(tmp_path, monkeypatch):
    config = _reload_config(monkeypatch, tmp_path / "mako3.0")
    assert config.ROOT_DIR == tmp_path / "mako3.0"
    assert config.DAILY_DIR == tmp_path / "mako3.0" / "daily"
    assert config.INDEX_FILE == tmp_path / "mako3.0" / "knowledge" / "index.md"
    assert config.STATE_FILE == tmp_path / "mako3.0" / "state" / "state.json"
    assert config.FLUSH_LOG == tmp_path / "mako3.0" / "state" / "flush.log"


def test_agents_file_lives_in_engine(tmp_path, monkeypatch):
    config = _reload_config(monkeypatch, tmp_path / "mako3.0")
    # AGENTS.md is the shared schema in the engine, not per-project
    assert config.AGENTS_FILE.name == "AGENTS.md"
    assert config.ENGINE_DIR.name == "_engine" or config.AGENTS_FILE.parent == config.ENGINE_DIR


def test_missing_env_raises(monkeypatch):
    monkeypatch.delenv("ATLAS_KB_ROOT", raising=False)
    import sys
    sys.modules.pop("config", None)  # force a fresh import regardless of test order
    with pytest.raises(RuntimeError):
        importlib.import_module("config")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/atlas-knowledge/_engine && uv run pytest tests/test_config.py -q`
Expected: FAIL — current `config.py` derives paths from `__file__`, has no `ROOT_DIR`/`FLUSH_LOG`/env behaviour.

- [ ] **Step 3: Replace `scripts/config.py` entirely**

```python
"""Path constants for the per-project knowledge base.

The active project's data root is provided by the ATLAS_KB_ROOT environment
variable (set by the hook that started this process). The engine dir (this
file's grandparent) holds the shared AGENTS.md schema. Per-project state and
logs live under <root>/state/.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path

# ── Engine (shared, location of this file) ─────────────────────────────
ENGINE_DIR = Path(__file__).resolve().parent.parent
AGENTS_FILE = ENGINE_DIR / "AGENTS.md"

# ── Project data root (per-process, from env) ──────────────────────────
_env_root = os.environ.get("ATLAS_KB_ROOT")
if not _env_root:
    raise RuntimeError(
        "ATLAS_KB_ROOT is not set. This process must be launched by an "
        "atlas-knowledge hook, or run with ATLAS_KB_ROOT=~/atlas-knowledge/<project>."
    )
ROOT_DIR = Path(_env_root)

DAILY_DIR = ROOT_DIR / "daily"
KNOWLEDGE_DIR = ROOT_DIR / "knowledge"
CONCEPTS_DIR = KNOWLEDGE_DIR / "concepts"
CONNECTIONS_DIR = KNOWLEDGE_DIR / "connections"
QA_DIR = KNOWLEDGE_DIR / "qa"
REPORTS_DIR = ROOT_DIR / "reports"

STATE_DIR = ROOT_DIR / "state"
INDEX_FILE = KNOWLEDGE_DIR / "index.md"
LOG_FILE = KNOWLEDGE_DIR / "log.md"
STATE_FILE = STATE_DIR / "state.json"
LAST_FLUSH_FILE = STATE_DIR / "last-flush.json"
FLUSH_LOG = STATE_DIR / "flush.log"
COMPILE_LOG = STATE_DIR / "compile.log"

# ── Timezone (unchanged from mako) ─────────────────────────────────────
TIMEZONE = "Asia/Jerusalem"


def now_iso() -> str:
    """Current time in ISO 8601 format."""
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def today_iso() -> str:
    """Current date in YYYY-MM-DD."""
    return datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%d")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/atlas-knowledge/_engine && uv run pytest tests/test_config.py tests/test_project.py -q`
Expected: PASS (8 passed total).

- [ ] **Step 5: Commit**

```bash
cd ~/atlas-knowledge/_engine && git add -A && git commit -q -m "feat: env-based config root resolution" || true
```

---

## Task 3: Verify `utils.py` is unaffected

`utils.py` imports `STATE_FILE, INDEX_FILE, DAILY_DIR, …` from `config`. All of those still exist after Task 2 (now env-derived). No edit needed — just prove it imports cleanly.

**Files:** none modified.

- [ ] **Step 1: Prove utils imports under an env root**

Run:
```bash
cd ~/atlas-knowledge/_engine && \
ATLAS_KB_ROOT="$HOME/atlas-knowledge/_smoketest" uv run python -c "import sys; sys.path.insert(0,'scripts'); import utils; print('utils OK:', utils.slugify('Hello World'))"
```
Expected: `utils OK: hello-world`. If it raises ImportError for a missing config symbol, add that symbol back to `config.py` (it should already be present — `REPORTS_DIR`, `STATE_FILE`, etc. all exist).

- [ ] **Step 2: Clean up the smoke dir**

```bash
rm -rf "$HOME/atlas-knowledge/_smoketest"
```

---

## Task 4: `session-start.py` — inject the current project's KB

The original derives paths from `__file__`. Rewrite it to resolve the project from the hook's stdin `cwd` and read that project's index + recent daily log.

**Files:**
- Modify: `~/atlas-knowledge/_engine/hooks/session-start.py` (full replacement below)

- [ ] **Step 1: Replace `hooks/session-start.py` entirely**

```python
"""SessionStart hook — inject the current project's knowledge base context.

Resolves the project from the session cwd, then injects that project's KB
index + recent daily log so Claude "remembers" what it learned on THIS project.
Never raises into the session: on any error it emits empty context.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

MAX_CONTEXT_CHARS = 20_000
MAX_LOG_LINES = 30


def _resolve_root() -> Path | None:
    try:
        data = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        data = {}
    cwd = data.get("cwd")
    transcript = data.get("transcript_path")
    if not cwd and not transcript:
        return None
    from project import resolve_root
    return resolve_root(cwd, transcript)


def _recent_log(daily_dir: Path) -> str:
    today = datetime.now(timezone.utc).astimezone()
    for offset in range(2):
        date = today - timedelta(days=offset)
        log_path = daily_dir / f"{date.strftime('%Y-%m-%d')}.md"
        if log_path.exists():
            lines = log_path.read_text(encoding="utf-8").splitlines()
            recent = lines[-MAX_LOG_LINES:] if len(lines) > MAX_LOG_LINES else lines
            return "\n".join(recent)
    return "(no recent daily log)"


def _build_context(root: Path) -> str:
    parts = []
    today = datetime.now(timezone.utc).astimezone()
    parts.append(f"## Today\n{today.strftime('%A, %B %d, %Y')}")

    index_file = root / "knowledge" / "index.md"
    if index_file.exists():
        parts.append(f"## Knowledge Base Index\n\n{index_file.read_text(encoding='utf-8')}")
    else:
        parts.append("## Knowledge Base Index\n\n(empty - no articles compiled yet)")

    parts.append(f"## Recent Daily Log\n\n{_recent_log(root / 'daily')}")

    context = "\n\n---\n\n".join(parts)
    if len(context) > MAX_CONTEXT_CHARS:
        context = context[:MAX_CONTEXT_CHARS] + "\n\n...(truncated)"
    return context


def main() -> None:
    try:
        root = _resolve_root()
        context = _build_context(root) if root else ""
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

- [ ] **Step 2: Manually verify it resolves and injects**

Run (simulates the hook's stdin):
```bash
cd ~/atlas-knowledge/_engine && \
echo '{"cwd":"/Users/Roman.Neganov/Projects/KeshetProjects/mako3.0","transcript_path":""}' \
  | uv run python hooks/session-start.py | python3 -m json.tool
```
Expected: JSON with `hookSpecificOutput.additionalContext` containing "## Today" and "## Knowledge Base Index". Side effect: `~/atlas-knowledge/mako3.0/` directory tree is created.

- [ ] **Step 3: Commit**

```bash
cd ~/atlas-knowledge/_engine && git add -A && git commit -q -m "feat: project-scoped session-start injection" || true
```

---

## Task 5: `session-end.py` + `pre-compact.py` — resolve project, spawn flush with env

Both hooks currently: read `transcript_path` from stdin, derive paths from `__file__`, write a temp context file, and spawn `flush.py`. Edit both identically: resolve the project root from stdin `cwd`, route temp file + logs under `<root>/state/`, and spawn the engine's `flush.py` with `ATLAS_KB_ROOT` in its environment.

**Files:**
- Modify: `~/atlas-knowledge/_engine/hooks/session-end.py`
- Modify: `~/atlas-knowledge/_engine/hooks/pre-compact.py`

- [ ] **Step 1: Apply this edit to BOTH hooks**

Read each hook, then make these exact substitutions (the recursion guard `if os.environ.get("CLAUDE_INVOKED_BY"): sys.exit(0)` at the top stays):

1. After the existing imports, add the scripts dir to the path and import the resolver:
```python
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
from project import resolve_root  # noqa: E402
```

2. Read `cwd` alongside `transcript_path` from the stdin JSON, and resolve the root. Find where the hook does `data = json.load(...)` / reads `transcript_path`, and right after it add:
```python
root = resolve_root(data.get("cwd"), data.get("transcript_path"))
state_dir = root / "state"
state_dir.mkdir(parents=True, exist_ok=True)
```

3. Replace the `__file__`-derived path block:
```python
# OLD
ROOT = Path(__file__).resolve().parent.parent
DAILY_DIR = ROOT / "daily"
SCRIPTS_DIR = ROOT / "scripts"
STATE_DIR = SCRIPTS_DIR
```
```python
# NEW — engine for the flush script, project state for logs/temp
ENGINE_DIR = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = ENGINE_DIR / "scripts"   # where flush.py lives
# DAILY_DIR / STATE_DIR are now derived from `root` (computed in main, step 2)
```

4. Point `logging.basicConfig(filename=...)` at the project state log:
```python
# logging must be configured AFTER root is known; move basicConfig into main()
# OR use force=True. Simplest: in main(), after resolving root:
logging.basicConfig(
    filename=str(root / "state" / "flush.log"),
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [hook] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    force=True,
)
```

5. Write the temp context file under the project state dir (not the engine):
```python
# OLD: context_file = SCRIPTS_DIR / f"session-flush-{session_id}-{ts}.md"
context_file = root / "state" / f"session-flush-{session_id}-{ts}.md"
```

6. Spawn `flush.py` from the engine, passing `ATLAS_KB_ROOT` so the spawned process resolves the same project. Find the `subprocess.Popen([... "flush.py" ...])` call and ensure:
```python
flush_script = SCRIPTS_DIR / "flush.py"   # engine scripts dir
cmd = ["uv", "run", "--directory", str(ENGINE_DIR), "python", str(flush_script),
       str(context_file), session_id]
env = {**os.environ, "ATLAS_KB_ROOT": str(root)}
# add env=env to the existing Popen(...) call (keep start_new_session / detach flags)
subprocess.Popen(cmd, env=env, start_new_session=True, ...)
```

> If `cwd` is absent from the stdin payload for this event, `resolve_root` falls back to the transcript path. Verify in Task 9 that real session-end payloads include `cwd`.

- [ ] **Step 2: Syntax-check both hooks**

Run:
```bash
cd ~/atlas-knowledge/_engine && uv run python -m py_compile hooks/session-end.py hooks/pre-compact.py && echo "compile OK"
```
Expected: `compile OK`.

- [ ] **Step 3: Dry-run session-end against a transcript (no real API spend in the hook)**

The hook itself does no API calls; it only extracts context and spawns flush. Feed it a minimal payload pointing at any existing transcript:
```bash
TRANSCRIPT=$(ls -t ~/.claude/projects/*/*.jsonl | head -1)
cd ~/atlas-knowledge/_engine && \
echo "{\"cwd\":\"$PWD\",\"transcript_path\":\"$TRANSCRIPT\",\"session_id\":\"smoke-1\"}" \
  | uv run python hooks/session-end.py
sleep 2
cat ~/atlas-knowledge/_engine/state/flush.log 2>/dev/null || cat "$HOME/atlas-knowledge/$(basename $PWD)/state/flush.log"
```
Expected: a `flush.log` under the resolved project's `state/` shows "flush.py started". (flush.py then runs the SDK in the background — that part is exercised end-to-end in Task 9.)

- [ ] **Step 4: Commit**

```bash
cd ~/atlas-knowledge/_engine && git add -A && git commit -q -m "feat: project-scoped session-end/pre-compact + env spawn" || true
```

---

## Task 6: `flush.py` — root from config, project state/logs, spawn compile from engine

`flush.py` (line refs from the mako original) defines `ROOT = Path(__file__)...` (26), `DAILY_DIR = ROOT/"daily"` (27), `SCRIPTS_DIR = ROOT/"scripts"` (28), logs to `SCRIPTS_DIR/"compile.log"` and a module-level `logging.basicConfig` to a flush log, reads/writes `last-flush.json`, and spawns `compile.py` via `uv run --directory str(ROOT)` (177). Rewire all of these to the env-based config.

**Files:**
- Modify: `~/atlas-knowledge/_engine/scripts/flush.py`

- [ ] **Step 1: Apply this mapping (grep each token, replace)**

| Find (mako original) | Replace with |
|---|---|
| `ROOT = Path(__file__).resolve().parent.parent` | `from config import ROOT_DIR as ROOT` (and remove the line; ensure `config` imported) |
| `DAILY_DIR = ROOT / "daily"` | `from config import DAILY_DIR` |
| `SCRIPTS_DIR = ROOT / "scripts"` | (delete; add `from config import ENGINE_DIR, FLUSH_LOG, COMPILE_LOG, LAST_FLUSH_FILE`) |
| `logging.basicConfig(filename=str(SCRIPTS_DIR / "flush.log"), ...)` | `logging.basicConfig(filename=str(FLUSH_LOG), ...)` |
| `last-flush.json` path (in `load_flush_state`/`save_flush_state`) | use `LAST_FLUSH_FILE` |
| `compile_script = SCRIPTS_DIR / "compile.py"` | `compile_script = ENGINE_DIR / "scripts" / "compile.py"` |
| `cmd = ["uv", "run", "--directory", str(ROOT), "python", str(compile_script)]` | `cmd = ["uv", "run", "--directory", str(ENGINE_DIR), "python", str(compile_script)]` |
| `open(str(SCRIPTS_DIR / "compile.log"), "a")` | `open(str(COMPILE_LOG), "a")` |
| `cwd=str(ROOT)` (in the compile Popen, line ~187) | `cwd=str(ROOT)` — keep (ROOT is now the project root from config; correct working dir for the SDK) |

Notes:
- The compile spawn (line ~187) needs no explicit `env=`: it inherits flush's environment, which already carries `ATLAS_KB_ROOT` (set by the session-end hook). Leave the existing Popen flags; just fix `--directory` and the script path/logs.
- Keep `today_log`/hash dedup logic and `COMPILE_AFTER_HOUR` unchanged.
- The SDK `run_flush` call's `cwd=str(ROOT)` (line ~123) — keep; ROOT is now the project root.

- [ ] **Step 2: Syntax-check**

Run: `cd ~/atlas-knowledge/_engine && uv run python -m py_compile scripts/flush.py && echo "compile OK"`
Expected: `compile OK`.

- [ ] **Step 3: Smoke-run flush directly with a tiny context file**

```bash
ROOT="$HOME/atlas-knowledge/_smoketest"
mkdir -p "$ROOT/state" "$ROOT/daily"
printf '## User\nHow do I center a div?\n\n## Assistant\nUse flexbox.\n' > "$ROOT/state/ctx.md"
cd ~/atlas-knowledge/_engine && \
ATLAS_KB_ROOT="$ROOT" uv run python scripts/flush.py "$ROOT/state/ctx.md" smoke-flush-1
echo "--- daily ---"; ls "$ROOT/daily"; echo "--- log ---"; cat "$ROOT/state/flush.log"
```
Expected: flush makes a real (small, ~$0.03) SDK call, appends to `~/atlas-knowledge/_smoketest/daily/<today>.md`, and `flush.log` shows "Flush complete". If `ANTHROPIC_API_KEY`/auth is needed and absent, the log shows the SDK error — fix auth, not the code.

- [ ] **Step 4: Clean up + commit**

```bash
rm -rf "$HOME/atlas-knowledge/_smoketest"
cd ~/atlas-knowledge/_engine && git add -A && git commit -q -m "feat: flush.py uses env-based config + engine compile" || true
```

---

## Task 7: `compile.py`, `query.py`, `lint.py` — root from config

Each defines `ROOT_DIR = Path(__file__).resolve().parent.parent` and imports specific path constants from `config`. After relocation, `__file__` points at the engine, but the data root must be the project. Switch their `ROOT_DIR` to the config's project root and confirm their `cwd=str(ROOT_DIR)` SDK calls use it.

**Files:**
- Modify: `~/atlas-knowledge/_engine/scripts/compile.py`
- Modify: `~/atlas-knowledge/_engine/scripts/query.py`
- Modify: `~/atlas-knowledge/_engine/scripts/lint.py`

- [ ] **Step 1: In all three, replace the `__file__`-derived root**

In each file replace:
```python
ROOT_DIR = Path(__file__).resolve().parent.parent
```
with:
```python
from config import ROOT_DIR
```
(They already `from config import …` other names — extend that import or add this line near the top. Remove the now-unused `Path(__file__)` line.)

Their existing `cwd=str(ROOT_DIR)` SDK calls and `target = ROOT_DIR / args.file` (compile.py line ~182) then correctly point at the project root. `lint.py` uses `REPORTS_DIR` from config — already exported in Task 2. No other path edits needed.

- [ ] **Step 2: Syntax-check all three**

Run: `cd ~/atlas-knowledge/_engine && uv run python -m py_compile scripts/compile.py scripts/query.py scripts/lint.py && echo "compile OK"`
Expected: `compile OK`.

- [ ] **Step 3: Smoke-run lint (no API spend, pure file checks) against a project**

```bash
# Use a project that session-start already created (mako3.0 from Task 4)
cd ~/atlas-knowledge/_engine && \
ATLAS_KB_ROOT="$HOME/atlas-knowledge/mako3.0" uv run python scripts/lint.py || true
```
Expected: lint runs and reports (likely "empty KB" / no errors) — proves config wiring resolves to the project, not the engine.

- [ ] **Step 4: Commit**

```bash
cd ~/atlas-knowledge/_engine && git add -A && git commit -q -m "feat: compile/query/lint use env-based config root" || true
```

---

## Task 8: `install.py` — idempotent hook merge into `~/.claude/settings.json`

The global settings already has a `hooks` block (gsd-* entries, incl. 2 under `SessionStart`). Merge our three hooks in without clobbering, idempotently.

**Files:**
- Create: `~/atlas-knowledge/_engine/install.py`
- Test: `~/atlas-knowledge/_engine/tests/test_install.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_install.py`:

```python
import importlib
import json
from pathlib import Path


def _load_install(monkeypatch, settings_path: Path, engine: Path):
    monkeypatch.setenv("ATLAS_KB_SETTINGS", str(settings_path))
    monkeypatch.setenv("ATLAS_KB_ENGINE", str(engine))
    import install
    return importlib.reload(install)


def test_merge_into_empty_settings(tmp_path, monkeypatch):
    settings = tmp_path / "settings.json"
    settings.write_text("{}", encoding="utf-8")
    install = _load_install(monkeypatch, settings, tmp_path / "_engine")
    install.main()
    data = json.loads(settings.read_text())
    assert "SessionStart" in data["hooks"]
    assert "SessionEnd" in data["hooks"]
    assert "PreCompact" in data["hooks"]


def test_preserves_existing_hooks(tmp_path, monkeypatch):
    settings = tmp_path / "settings.json"
    settings.write_text(json.dumps({
        "hooks": {"SessionStart": [{"hooks": [{"type": "command", "command": "gsd-thing.js"}]}]}
    }), encoding="utf-8")
    install = _load_install(monkeypatch, settings, tmp_path / "_engine")
    install.main()
    data = json.loads(settings.read_text())
    cmds = [h["command"] for e in data["hooks"]["SessionStart"] for h in e["hooks"]]
    assert any("gsd-thing.js" in c for c in cmds)         # kept
    assert any("session-start.py" in c for c in cmds)     # added


def test_idempotent(tmp_path, monkeypatch):
    settings = tmp_path / "settings.json"
    settings.write_text("{}", encoding="utf-8")
    install = _load_install(monkeypatch, settings, tmp_path / "_engine")
    install.main()
    install.main()
    data = json.loads(settings.read_text())
    starts = [h["command"] for e in data["hooks"]["SessionStart"] for h in e["hooks"]]
    assert sum("session-start.py" in c for c in starts) == 1   # no duplicate


def test_makes_backup(tmp_path, monkeypatch):
    settings = tmp_path / "settings.json"
    settings.write_text('{"model":"x"}', encoding="utf-8")
    install = _load_install(monkeypatch, settings, tmp_path / "_engine")
    install.main()
    assert (tmp_path / "settings.json.atlas-bak").exists()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/atlas-knowledge/_engine && uv run pytest tests/test_install.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'install'`.

- [ ] **Step 3: Write `install.py`**

```python
"""Idempotently merge atlas-knowledge hooks into ~/.claude/settings.json.

Adds SessionStart / SessionEnd / PreCompact entries that invoke the engine's
hook scripts via `uv run`. Existing hooks (e.g. gsd-*) are preserved. Running
twice never duplicates. A one-time backup is written next to settings.json.
"""

from __future__ import annotations

import json
import os
import shutil
from pathlib import Path

SETTINGS_PATH = Path(os.environ.get("ATLAS_KB_SETTINGS", str(Path.home() / ".claude" / "settings.json")))
ENGINE_DIR = Path(os.environ.get("ATLAS_KB_ENGINE", str(Path.home() / "atlas-knowledge" / "_engine")))

_UV = shutil.which("uv") or "uv"

_EVENTS = {
    "SessionStart": "session-start.py",
    "SessionEnd": "session-end.py",
    "PreCompact": "pre-compact.py",
}


def _command_for(script: str) -> str:
    hook = ENGINE_DIR / "hooks" / script
    return f'"{_UV}" run --directory "{ENGINE_DIR}" python "{hook}"'


def _entry_for(script: str) -> dict:
    return {"hooks": [{"type": "command", "command": _command_for(script)}]}


def _already_present(entries: list, script: str) -> bool:
    for entry in entries:
        for h in entry.get("hooks", []):
            if script in h.get("command", ""):
                return True
    return False


def main() -> None:
    if SETTINGS_PATH.exists():
        data = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
        backup = SETTINGS_PATH.with_suffix(SETTINGS_PATH.suffix + ".atlas-bak")
        if not backup.exists():
            shutil.copy2(SETTINGS_PATH, backup)
    else:
        data = {}
        SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)

    hooks = data.setdefault("hooks", {})
    added = []
    for event, script in _EVENTS.items():
        entries = hooks.setdefault(event, [])
        if not _already_present(entries, script):
            entries.append(_entry_for(script))
            added.append(event)

    SETTINGS_PATH.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    print(f"atlas-knowledge hooks installed. Added: {added or 'none (already present)'}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/atlas-knowledge/_engine && uv run pytest tests/test_install.py -q`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
cd ~/atlas-knowledge/_engine && git add -A && git commit -q -m "feat: idempotent hook installer" || true
```

---

## Task 9: Install hooks + end-to-end smoke test

**Files:** modifies `~/.claude/settings.json` (real).

- [ ] **Step 1: Back up real settings and run the installer**

```bash
cp ~/.claude/settings.json ~/.claude/settings.json.manual-bak
cd ~/atlas-knowledge/_engine && uv run python install.py
python3 -m json.tool ~/.claude/settings.json >/dev/null && echo "settings.json valid JSON"
```
Expected: "Added: ['SessionStart', 'SessionEnd', 'PreCompact']" and valid JSON. The existing gsd `SessionStart` entries are still present (check by eye).

- [ ] **Step 2: Verify idempotency on the real file**

```bash
cd ~/atlas-knowledge/_engine && uv run python install.py
grep -c "session-start.py" ~/.claude/settings.json
```
Expected: "Added: none (already present)" and the grep count is `1`.

- [ ] **Step 3: Confirm `cwd` is present in real hook payloads**

Open a NEW Claude Code session in two different project dirs (e.g. `mako3.0` and `atlas-os`). In each, do one small exchange, then end the session. Then:
```bash
ls -la ~/atlas-knowledge/
cat ~/atlas-knowledge/_engine/projects.json
ls ~/atlas-knowledge/mako3.0/daily/ ~/atlas-knowledge/atlas-os/daily/ 2>/dev/null
cat ~/atlas-knowledge/*/state/flush.log
```
Expected: a folder per project under `~/atlas-knowledge/`, `projects.json` maps basenames to abspaths, each project's `daily/<today>.md` got a flush entry, and `flush.log` shows no "ATLAS_KB_ROOT not set" / no resolution errors. **If `flush.log` shows the root resolved to the wrong place,** `cwd` was absent from the payload — adjust the hooks to prefer the transcript fallback (the resolver already supports it).

- [ ] **Step 4: Verify SessionStart injection is project-scoped**

Start a session in `mako3.0`; confirm (via the model's awareness or by inspecting the hook output) that the injected "Knowledge Base Index" is mako's, not atlas's. The injection content comes from `~/atlas-knowledge/mako3.0/knowledge/index.md`.

- [ ] **Step 5: (If anything failed) roll back**

```bash
cp ~/.claude/settings.json.manual-bak ~/.claude/settings.json   # only if needed
```

---

## Task 10: mako migration — disable local hooks (+ optional data move)

The exploration found **no active hook registration** for mako's `claude-memory` (no project `settings.json` registers them). Confirm and neutralize any that exist so the global hooks are the single source.

**Files:** possibly `mako3.0/.claude/settings.json` / `settings.local.json` (if present).

- [ ] **Step 1: Confirm no local registration re-fires the pipeline**

```bash
cd /Users/Roman.Neganov/Projects/KeshetProjects/mako3.0
grep -rn "session-end\|session-start\|pre-compact\|flush.py\|compile.py" \
  .claude/settings.json .claude/settings.local.json claude-memory/.claude 2>/dev/null || echo "no local hook registration found"
```
Expected: "no local hook registration found". If any registration is found, remove those hook entries (the global ones now cover mako).

- [ ] **Step 2: (Optional, ASK ROMAN FIRST) migrate mako's existing knowledge**

Default is to start the global mako store fresh (the global hooks already created `~/atlas-knowledge/mako3.0/`). Only if Roman wants history continuity:
```bash
SRC="/Users/Roman.Neganov/Projects/KeshetProjects/mako3.0/claude-memory"
DST="$HOME/atlas-knowledge/mako3.0"
cp -Rn "$SRC/daily/." "$DST/daily/" 2>/dev/null
cp -Rn "$SRC/knowledge/." "$DST/knowledge/" 2>/dev/null
ls "$DST/daily" "$DST/knowledge"
```
(Source `sources:` wikilinks in articles still reference `daily/...` relative paths, which remain valid under the new root.)

- [ ] **Step 3: Done — no commit (changes are outside atlas-os, or none)**

---

## Task 11 (optional): auto-install on atlas-os startup ("zero config")

To honor "works for all projects with no setup" beyond the first manual install, have the atlas-os app run the installer on startup if the engine exists. Small, idempotent, non-blocking.

**Files:**
- Modify: `src/main/index.ts` (atlas-os; near the existing `ingestAll()` startup call ~line 15-26)

- [ ] **Step 1: Add a fire-and-forget installer call on startup**

In `src/main/index.ts`, alongside the existing startup ingest, add:

```typescript
import { homedir } from 'node:os'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

function ensureKnowledgeHooks(): void {
  const engine = join(homedir(), 'atlas-knowledge', '_engine')
  if (!existsSync(join(engine, 'install.py'))) return // engine not bootstrapped; skip
  try {
    const p = spawn('uv', ['run', '--directory', engine, 'python', join(engine, 'install.py')], {
      detached: true,
      stdio: 'ignore',
    })
    p.unref()
  } catch {
    /* never block startup on hook install */
  }
}
```
Call `ensureKnowledgeHooks()` next to the existing startup `ingest` invocation.

- [ ] **Step 2: Typecheck + lint**

Run: `cd /Users/Roman.Neganov/Projects/PersonalProjects/atlas-os && pnpm lint && pnpm typecheck`
Expected: clean (matches repo's pre-commit gate).

- [ ] **Step 3: Commit (atlas-os repo, feature branch)**

```bash
cd /Users/Roman.Neganov/Projects/PersonalProjects/atlas-os
git add src/main/index.ts
git commit -q -m "feat(knowledge): auto-install global session-knowledge hooks on startup

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Out of Scope (follow-up agent)

- **atlas-os UI** for browsing the per-project KB — see the spec's "Next: UI" section (tRPC router `knowledge.*` + a renderer page reading `~/atlas-knowledge/<project>/knowledge/`).
- TypeScript rewrite of the pipeline, embeddings/RAG, cross-project linking.

## Notes / Risks (from spec)

- `uv`/python is a hard runtime dependency; hooks fail fast + log, never block the session.
- Cost is per active project: flush ~$0.02–0.05/session, compile ~$0.5/day. The 6PM auto-compile fans out per project.
- Timezone is hardcoded `Asia/Jerusalem` (drives the 6PM compile trigger) — unchanged.
- `~/atlas-knowledge/` is NOT committed into atlas-os; only `docs/` (spec + this plan) are.
