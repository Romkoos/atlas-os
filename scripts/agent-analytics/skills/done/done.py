#!/usr/bin/env python3
"""Helper for the /done skill of the Agent Productivity Tracker.

Resolves the current Claude Code session_id and appends a session_score
line to ~/agent-analytics/sessions.jsonl.

Usage:
    python3 done.py --score 8 --summary "Refactored auth into a service"

session_id resolution:
    The current session's transcript lives at
        ~/.claude/projects/<encoded-cwd>/<session_id>.jsonl
    where <encoded-cwd> is os.getcwd() with "/" and "." replaced by "-".
    The newest *.jsonl file in that dir is the current session; its
    filename (minus .jsonl) is the session_id.

Hard rules: stdlib only. Unlike the lifecycle hooks this is run
explicitly by the agent, so it prints a short confirmation to stdout and
uses a non-zero exit code on failure (so the agent can report it).
"""
import argparse
import glob
import json
import os
import sys
from datetime import datetime, timezone


def encode_cwd(cwd):
    """Encode a cwd into the Claude Code projects dir name."""
    return cwd.replace("/", "-").replace(".", "-")


def resolve_session_id(cwd=None):
    """Return the session_id of the newest transcript for this cwd, or None."""
    if cwd is None:
        cwd = os.getcwd()
    encoded = encode_cwd(cwd)
    proj_dir = os.path.join(
        os.path.expanduser("~/.claude/projects"), encoded
    )
    if not os.path.isdir(proj_dir):
        return None
    candidates = glob.glob(os.path.join(proj_dir, "*.jsonl"))
    if not candidates:
        return None
    newest = max(candidates, key=lambda p: os.path.getmtime(p))
    return os.path.splitext(os.path.basename(newest))[0]


def append_score(session_id, score, summary):
    line = {
        "event": "session_score",
        "session_id": session_id,
        "score": score,
        "summary": summary,
    }
    out_dir = os.path.expanduser("~/agent-analytics")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "sessions.jsonl")
    with open(out_path, "a", encoding="utf-8") as f:
        f.write(json.dumps(line) + "\n")
    return out_path


def main():
    parser = argparse.ArgumentParser(description="Append a session score.")
    parser.add_argument("--score", type=int, required=True,
                        help="Session score, integer 1-10.")
    parser.add_argument("--summary", type=str, required=True,
                        help="One-line summary of the session.")
    args = parser.parse_args()

    if args.score < 1 or args.score > 10:
        print(f"score must be an integer 1-10, got {args.score}",
              file=sys.stderr)
        sys.exit(1)

    session_id = resolve_session_id()
    if not session_id:
        print(
            "could not resolve session_id: no transcript found under "
            "~/.claude/projects for this cwd",
            file=sys.stderr,
        )
        sys.exit(1)

    try:
        append_score(session_id, args.score, args.summary)
    except Exception as exc:
        print(f"failed to write session_score: {exc}", file=sys.stderr)
        sys.exit(1)

    print(f"session finalized: session_id={session_id} score={args.score}")
    sys.exit(0)


if __name__ == "__main__":
    main()
