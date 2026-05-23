---
name: done
description: Finalize the current Claude Code session with a subjective score (1-10) and a one-line summary for the Agent Productivity Tracker. Use when the user runs `/done`, says "finish this session", "score this session", "wrap up and rate", "оцени сессию", "заверши сессию", or otherwise signals they want to close out and rate the work just done. Appends a session_score line to ~/agent-analytics/sessions.jsonl, which Atlas ingests.
---

# done — finalize and score a session

Terminal skill. The user explicitly ends a session and rates it. This is
the only place the subjective `score` and `summary` enter the analytics
pipeline; everything else (tokens, tools, skills) Atlas derives from the
transcript.

## What to do

1. Ask the user two things (one at a time is fine):
   - **score** — an integer from **1 to 10** (overall how well the session went).
   - **summary** — a single line describing what was accomplished.

   If the user already provided one or both in their message, do not
   re-ask — use what they gave. Re-prompt only if the score is missing
   or not an integer in 1–10.

2. Run the bundled helper, which resolves the current `session_id` from
   the newest transcript under `~/.claude/projects/<encoded-cwd>/` and
   appends the `session_score` line:

   ```bash
   python3 ~/.claude/skills/done/done.py --score <SCORE> --summary "<SUMMARY>"
   ```

   Substitute the real score and summary. Quote the summary so spaces and
   punctuation are passed as one argument.

3. Report the result to the user. On success the helper prints
   `session finalized: session_id=... score=...`. Relay a short
   confirmation (e.g. "session finalized, score 8"). If the helper exits
   non-zero, relay the stderr message — common cause is that no
   transcript exists yet for this working directory.

## Notes

- Do **not** ask for "complexity" — Atlas computes that heuristically
  from the transcript.
- The helper is stdlib-only Python 3; no dependencies to install.
- The line appended is exactly:
  `{"event":"session_score","session_id":<id>,"score":<int>,"summary":<str>}`
- The helper must run from the session's working directory (it uses
  `os.getcwd()` to locate the transcript). This is the normal case when
  the agent runs it.
