# Infra-change timeline (reconstructed from ~/.claude)

Backfill source for the empty `ecosystem_changes` table. Reconstructed 2026-05-25
from `~/.claude` (no git history there, so derived from file births/mtimes,
`plugins/installed_plugins.json`, `backups/`, and `file-history/` snapshots).

Enter manually via the Atlas UI. Columns map to `ecosystem_changes`:
`ts` (date) · `type` · `target` · `note`. Suggested `type` values reuse the
existing vocabulary: `mcp_added` · `skill_edited` · `config_changed` · `manual_note`.

## Reliability legend
- **strong** = file birth / install dir / installed_plugins.json (trustworthy)
- **precise** = exact edit time from `file-history` snapshot mtime
- **approx** = mtime/birthtime that may be reset by copy/migration
- ⚠️ = bulk/automated event, not a hand edit

---

## Plugins installed (type: `config_changed`, target: plugin name)

| ts | target | scope | reliability |
|----|--------|-------|-------------|
| 2026-03-25 | skill-creator | user | strong |
| 2026-03-25 | frontend-design | user | strong |
| 2026-03-25 | playwright | user | strong |
| 2026-03-29 | startup (startup-skill) | project | strong |
| 2026-03-29 | stratarts (maigent) | project | strong |
| 2026-04-22 | caveman | user | strong |
| 2026-05-03 | context-mode | user | strong |
| 2026-05-05 | superpowers (mako3.0) | project | strong |
| 2026-05-20 | chrome-devtools-mcp | user | strong |
| 2026-05-10 ⚠️ | mass plugin cache update (CC refresh) | — | skip unless you care |

## User skills created (type: `skill_edited`, target: skill name)

| ts | target | reliability |
|----|--------|-------------|
| 2026-04-15 | git-commit-message-workspace | approx |
| 2026-04-29 | git-commit-message | approx |
| 2026-04-30 | yuliya-review | approx |
| 2026-05-01 | graphify | approx |
| 2026-05-02 | notebooklm | approx |
| 2026-05-02 | real-chrome (created + edited same day) | precise (edit 08:22) |
| 2026-05-02 | daily-ai-news (+ workspace) | approx |
| 2026-05-03 | github-trending | approx |
| 2026-05-21 ⚠️ | GSD suite — 66 `gsd-*` skills, bulk install/migration | strong (one event, not 66) |

## settings.json changes (type: `config_changed`, target: settings.json)

| ts | reliability |
|----|-------------|
| 2026-03-22 | approx (.orig/.bak present) |
| 2026-05-06 | precise (file-history) |
| 2026-05-22 | precise (file-history) |
| 2026-05-25 | approx (current mtime) |

## MCP servers (type: `mcp_added` / config)

Current live state (`~/.claude.json`):
- **active:** notebooklm
- **disabled:** context7, pencil, Railway
- **per-project:** mako3.0 → atlassian-bitbucket · survivor → ai-game-developer

Datable MCP events (limited):
- 2026-04-29 → 04-30: Railway MCP churn (only window covered by `backups/`)
- ~2026-05-02: notebooklm MCP likely added (its skill created that day)
- ~2026-05-03: context-mode MCP arrived with its plugin install

---

## Removals / deletions (type: `skill_edited` or `config_changed`, note: "removed")

### startup / stratarts — NOT removed (rechecked)
Both plugins are present on disk (`installDir: OK`) and **project-scoped** to
`~/Projects/PersonalProjects/startup`. They don't load in other projects (e.g.
atlas-os), which is why they look absent — but they are not deleted. No deletion
event to log.

### Precisely dated deletions (from `skills/.trash`, mtime = delete time)
| ts | target | note |
|----|--------|------|
| 2026-04-29 06:24 | nexus-smoke-… | throwaway test skill, removed |
| 2026-04-29 06:59 | roman-skill-… | throwaway test skill, removed |

### Inferred deletions (no exact date — only last-used from `skillUsage`)
Removed sometime AFTER the date shown; exact removal time not recorded anywhere.
| last active | target | note |
|-------------|--------|------|
| 2026-03-28 | `wf-*` suite (~22: wf-init/ideation/research/enrichment/product-design/visual-design/design-review/planning/architecture/contracts/review/scaffolding/implement/status/git/deploy/qa/ship) | old workflow framework, replaced by GSD |
| 2026-04-06 | trend-discovery, script-generation, script-validator | trending pipeline, replaced by github-trending |
| 2026-03-30 | git-setup, railway-deploy, git, railway | project setup helpers |
| 2026-03-29 | tech-spec | — |

False positives in the ghost list (still available via builtin/plugin/another
project — do NOT log as deleted): statusline, update-config, brainstorming,
skill-creator, init, schedule, claude-api, ip, player-mako-lookup (mako-scoped).

## Plugin / MCP enable-disable (state only, no native log)
- Plugin on/off lives in `settings.json` → `enabledPlugins {name: true|false}`.
  Current: all 7 user plugins `true` — **nothing disabled**. Disabling = flip to `false`.
- MCP on/off lives in `~/.claude.json` → `mcpServersDisabled`. Current disabled:
  context7, pencil, Railway (current state only, no timestamp).
- No native toggle log. `file-history` keeps only 2 settings.json snapshots and
  their mtimes are unreliable → historical disable events are not recoverable.
- `plugins/blocklist.json` = marketplace policy blocks (test entries), NOT user toggles.
- A watcher diffing `enabledPlugins` + `mcpServersDisabled` would date toggles precisely going forward.

## NOT recoverable (gaps — be aware)
- **Precise MCP enable/disable dates.** CC does not version `~/.claude.json` in
  `file-history`; `backups/` only covers 2026-04-29→30. Everything else is
  current-state only.
- **Skill edits after creation.** `file-history` mostly holds memory/agent files,
  not skill bodies — so per-skill edit history is thin (only real-chrome surfaced).
- **Anything before ~2026-03-22** (earliest artifact retained).

## Next step (stop doing this by hand)
`ecosystem_changes` is empty because nothing auto-captures these events. The
ingest service has the table + types wired but no producer writing rows. Wire a
watcher (skills dir mtimes + `~/.claude.json` mcpServers diff + settings.json) so
future infra changes log themselves — then this manual backfill is one-time.
