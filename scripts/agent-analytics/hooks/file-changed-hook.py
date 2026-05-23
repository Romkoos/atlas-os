#!/usr/bin/env python3
"""Claude Code FileChanged hook for the Agent Productivity Tracker.

Registered with NO matcher (fires on every file change). Self-filters:
only appends a line when the changed path is a skill file (path contains
"/skills/"). Otherwise it writes nothing and exits 0.

Writes to ~/agent-analytics/ecosystem-changes.jsonl:
  {"ts":..,"type":"skill_edited","target":<file_path>,"source":"auto","diff":null,"note":null}

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
        # Self-filter: only skill files are interesting here.
        if not isinstance(file_path, str) or "/skills/" not in file_path:
            sys.exit(0)

        line = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "type": "skill_edited",
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
        print(f"file-changed-hook error: {exc}", file=sys.stderr)

    sys.exit(0)


if __name__ == "__main__":
    main()
