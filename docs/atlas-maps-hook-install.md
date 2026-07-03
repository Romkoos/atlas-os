# Atlas Maps — manual hook install

The map store `~/atlas-maps/` is populated by the Atlas **Build** button. To let
Claude use it, wire the SessionStart hook manually (hooks are never auto-installed).

## 1. SessionStart injection

Add this entry to the `hooks.SessionStart` array in `~/.claude/settings.json`
(alongside the existing atlas-knowledge entry):

```json
{
  "hooks": [
    {
      "type": "command",
      "command": "python3 \"/Users/Roman.Neganov/atlas-maps/_engine/session-start.py\""
    }
  ]
}
```

## 2. On-demand query pointer (per project CLAUDE.md)

Add to each tracked project's `CLAUDE.md`:

```md
## Architecture map (atlas-maps)
- A compact Map Index for this project is injected at session start (from
  `~/atlas-maps/<project>/`).
- For deeper questions, run:
  `python3 ~/atlas-maps/_engine/query.py "<question>"`
  (from the repo root; resolves the project from cwd).
```
