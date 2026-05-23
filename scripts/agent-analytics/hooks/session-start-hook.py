#!/usr/bin/env python3
"""Claude Code SessionStart hook for the Agent Productivity Tracker.

Appends one JSON line to ~/agent-analytics/sessions.jsonl recording the
start of a session. Reads the hook payload from stdin.

Hard rules: stdlib only, never crash a session, always exit 0, never
print to stdout (stdout from a hook can inject context). Errors may go
to stderr only.
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
        session_id = payload.get("session_id")
        project_path = payload.get("cwd")
        line = {
            "event": "session_start",
            "session_id": session_id,
            "project_path": project_path,
            "started_at": datetime.now(timezone.utc).isoformat(),
        }
        out_dir = os.path.expanduser("~/agent-analytics")
        os.makedirs(out_dir, exist_ok=True)
        out_path = os.path.join(out_dir, "sessions.jsonl")
        with open(out_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(line) + "\n")
    except Exception as exc:  # never crash the session
        print(f"session-start-hook error: {exc}", file=sys.stderr)

    sys.exit(0)


if __name__ == "__main__":
    main()
