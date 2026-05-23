# Agent Productivity Tracker — install (data-collection edge)

These are the **data-collection** artifacts for the Agent Productivity
Tracker (design: `docs/agent-productivity-tracker.md`). They are thin,
dependency-free Claude Code hooks plus a `/done` skill. They write
append-only JSONL to `~/agent-analytics/`, which the Atlas ingest service
reads separately.

> **You install these yourself.** Nothing here mutates your global config
> automatically. Copy the files, then add the hooks snippet to
> `~/.claude/settings.json` by hand.

## What gets written

- `~/agent-analytics/sessions.jsonl` — session lifecycle (`session_start`,
  `session_end`) and `session_score` from `/done`.
- `~/agent-analytics/ecosystem-changes.jsonl` — settings changes
  (`config_changed` / `claude_md_edited`) and skill edits (`skill_edited`).

Both files are append-only. The hooks create `~/agent-analytics/` if it
does not exist.

## Requirements

- Python 3 on `PATH` (the scripts use a `#!/usr/bin/env python3` shebang).
  Stdlib only — no `pip install`.

## 1. Copy the hook scripts

```bash
mkdir -p "${HOME}/.claude/hooks"
cp scripts/agent-analytics/hooks/session-start-hook.py "${HOME}/.claude/hooks/"
cp scripts/agent-analytics/hooks/session-end-hook.py   "${HOME}/.claude/hooks/"
cp scripts/agent-analytics/hooks/config-change-hook.py "${HOME}/.claude/hooks/"
cp scripts/agent-analytics/hooks/file-changed-hook.py  "${HOME}/.claude/hooks/"

chmod +x "${HOME}/.claude/hooks/session-start-hook.py"
chmod +x "${HOME}/.claude/hooks/session-end-hook.py"
chmod +x "${HOME}/.claude/hooks/config-change-hook.py"
chmod +x "${HOME}/.claude/hooks/file-changed-hook.py"
```

## 2. Copy the `/done` skill

```bash
mkdir -p "${HOME}/.claude/skills/done"
cp scripts/agent-analytics/skills/done/SKILL.md "${HOME}/.claude/skills/done/"
cp scripts/agent-analytics/skills/done/done.py  "${HOME}/.claude/skills/done/"
chmod +x "${HOME}/.claude/skills/done/done.py"
```

After this, `/done` is available in Claude Code. It asks for a score
(1–10) and a one-line summary, resolves the current `session_id` from the
newest transcript under `~/.claude/projects/<encoded-cwd>/`, and appends a
`session_score` line.

## 3. Register the hooks in `~/.claude/settings.json`

Merge the following into your existing `~/.claude/settings.json`. If you
already have a `"hooks"` object, add these keys into it (do not replace
the whole object). Commands use `${HOME}` so they resolve per-user.

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume",
        "hooks": [
          { "type": "command", "command": "${HOME}/.claude/hooks/session-start-hook.py" }
        ]
      }
    ],
    "SessionEnd": [
      {
        "matcher": "prompt_input_exit|clear|logout|other",
        "hooks": [
          { "type": "command", "command": "${HOME}/.claude/hooks/session-end-hook.py" }
        ]
      }
    ],
    "ConfigChange": [
      {
        "matcher": "project_settings|local_settings|user_settings",
        "hooks": [
          { "type": "command", "command": "${HOME}/.claude/hooks/config-change-hook.py" }
        ]
      }
    ],
    "FileChanged": [
      {
        "hooks": [
          { "type": "command", "command": "${HOME}/.claude/hooks/file-changed-hook.py" }
        ]
      }
    ]
  }
}
```

### Matcher notes

- **SessionStart** `startup|resume` — fires on fresh start and resume.
- **SessionEnd** `prompt_input_exit|clear|logout|other` — finalizes the
  session row with `ended_at` + `reason`.
- **ConfigChange** `project_settings|local_settings|user_settings` —
  audits settings edits. `ConfigChange.source` never carries skills, so
  skill edits are caught by FileChanged instead.
- **FileChanged** has **no matcher** — it fires on all file changes and
  the script self-filters: it writes only when the changed path contains
  `/skills/`, otherwise it exits 0 writing nothing.

## 4. Restart Claude Code

Restart so the new hooks and skill are picked up.

## Verify

Start a session and check that a line appears:

```bash
cat ~/agent-analytics/sessions.jsonl
```

Edit any `CLAUDE.md` or a skill file and check:

```bash
cat ~/agent-analytics/ecosystem-changes.jsonl
```

Run `/done`, give a score and summary, then re-check `sessions.jsonl` for
a `session_score` line.

## Safety

- All hooks wrap everything in `try/except` and **always exit 0** — they
  can never crash a Claude Code session.
- Hooks print nothing to stdout (stdout from a hook can inject context);
  errors go to stderr only.
- No network, no dependencies, no global-config mutation by these scripts.
```
