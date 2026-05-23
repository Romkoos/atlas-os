#!/usr/bin/env python3
"""Claude Code ConfigChange hook for the Agent Productivity Tracker.

Appends one JSON line to ~/agent-analytics/ecosystem-changes.jsonl when a
settings file changes. Reads the hook payload from stdin.

Type mapping:
  - "claude_md_edited" if file_path ends with "CLAUDE.md"
  - "config_changed"   otherwise

Hard rules: stdlib only, never crash a session, always exit 0, never
print to stdout. Errors may go to stderr only.
"""
import json
import os
import sys
from datetime import datetime, timezone


def main():
    try:
        raw = sys.stdin.read()
        payload = json.loads(raw) if raw.strip() else {}
    except Exception:
        payload = {}

    try:
        file_path = payload.get("file_path")
        if isinstance(file_path, str) and file_path.endswith("CLAUDE.md"):
            change_type = "claude_md_edited"
        else:
            change_type = "config_changed"

        line = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "type": change_type,
            "target": file_path,
            "source": "auto",
            "diff": None,
            "note": None,
        }
        out_dir = os.path.expanduser("~/agent-analytics")
        os.makedirs(out_dir, exist_ok=True)
        out_path = os.path.join(out_dir, "ecosystem-changes.jsonl")
        with open(out_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(line) + "\n")
    except Exception as exc:  # never crash the session
        print(f"config-change-hook error: {exc}", file=sys.stderr)

    sys.exit(0)


if __name__ == "__main__":
    main()
