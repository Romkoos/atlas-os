#!/usr/bin/env python3
"""SessionStart hook — inject the current project's graphify Map Index.

Resolves project = basename(cwd), reads <store>/<project>/index.md, and emits it
as additionalContext. Never raises into the session: any error → empty context.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

MAX_CHARS = 8000


def maps_root() -> Path:
    return Path(os.environ.get("ATLAS_MAPS_STORE") or (Path.home() / "atlas-maps"))


def build_context() -> str:
    try:
        data = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        data = {}
    cwd = data.get("cwd") or os.getcwd()
    project = os.path.basename(os.path.normpath(cwd))
    if not project or project in (".", "..", "_engine"):
        return ""
    index = maps_root() / project / "index.md"
    if not index.is_file():
        return ""
    body = index.read_text(encoding="utf-8")[:MAX_CHARS]
    return (
        f"## Project Map (from the map store {maps_root() / project}/)\n\n{body}"
    )


def main() -> None:
    try:
        context = build_context()
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
