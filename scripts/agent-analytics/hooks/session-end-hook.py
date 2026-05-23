#!/usr/bin/env python3
"""Claude Code SessionEnd hook for the Agent Productivity Tracker.

Appends one JSON line to ~/agent-analytics/sessions.jsonl finalizing a
session (ended_at + reason). Reads the hook payload from stdin.

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
        session_id = payload.get("session_id")
        reason = payload.get("reason")
        line = {
            "event": "session_end",
            "session_id": session_id,
            "ended_at": datetime.now(timezone.utc).isoformat(),
            "reason": reason,
        }
        out_dir = os.path.expanduser("~/agent-analytics")
        os.makedirs(out_dir, exist_ok=True)
        out_path = os.path.join(out_dir, "sessions.jsonl")
        with open(out_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(line) + "\n")
    except Exception as exc:  # never crash the session
        print(f"session-end-hook error: {exc}", file=sys.stderr)

    sys.exit(0)


if __name__ == "__main__":
    main()
