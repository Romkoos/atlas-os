#!/usr/bin/env python3
"""On-demand map query — wraps `graphify query` against the stored map.

Usage: query.py "<question>" [--project <name>] [--budget N]
Resolves project = --project or basename(cwd); runs `graphify query` inside
<store>/<project>/ (which holds graphify-out/graph.json). Read-only.
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path


def maps_root() -> Path:
    return Path(os.environ.get("ATLAS_MAPS_STORE") or (Path.home() / "atlas-maps"))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("question")
    ap.add_argument("--project", default=None)
    ap.add_argument("--budget", type=int, default=1200)
    args = ap.parse_args()

    project = args.project or os.path.basename(os.path.normpath(os.getcwd()))
    if (
        not project
        or project in (".", "..", "_engine")
        or "/" in project
        or "\\" in project
    ):
        print(f"query: invalid project '{project}'", file=sys.stderr)
        return 2
    proj_dir = maps_root() / project
    if not (proj_dir / "graphify-out" / "graph.json").is_file():
        print(f"query: no map for '{project}' (run Build in Atlas first)", file=sys.stderr)
        return 1
    try:
        proc = subprocess.run(
            ["graphify", "query", args.question, "--budget", str(args.budget)],
            cwd=str(proj_dir),
            capture_output=True,
            text=True,
            timeout=120,
        )
    except FileNotFoundError:
        print("query: graphify binary not found on PATH", file=sys.stderr)
        return 1
    except subprocess.TimeoutExpired:
        print("query: graphify query timed out", file=sys.stderr)
        return 1
    sys.stdout.write(proc.stdout)
    if proc.returncode != 0:
        sys.stderr.write(proc.stderr)
    return proc.returncode


if __name__ == "__main__":
    raise SystemExit(main())
