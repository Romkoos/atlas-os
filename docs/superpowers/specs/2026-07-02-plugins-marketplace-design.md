# Plugins Marketplace Panel — Design

Date: 2026-07-02
Status: Approved

## Goal

Extend the Plugins page into a marketplace panel with three tabs:
**Installed / Marketplace / Health**. Add browse/search of available plugins
(which deliver MCP servers and skills), one-click install/uninstall via the
`claude` CLI, marketplace add, and an MCP health-check that pings each
configured MCP server and reports status. Reuse the existing job registry for
install/update/health operations and the `execFile('claude', …)` CLI-wrapping
pattern already used for plugin updates.

## Reality of the Claude Code CLI (verified)

- MCP servers and skills are delivered **inside plugins**; the "marketplace" is
  a set of **plugin marketplaces**. There is no separate MCP/skill registry.
- CLI commands that exist and are used here:
  - `claude plugin install <id> --scope user`
  - `claude plugin uninstall <id> --scope user --yes`
  - `claude plugin marketplace add <source> --scope user`
  - `claude plugin details <name>` — component inventory + projected token cost
  - `claude mcp list` — **already health-checks** every configured server and
    prints one text line per server: `<name>: <target>[ (HTTP)] - <icon> <text>`
    where icon/text is `✔ Connected`, `! Needs authentication`, `⏸ Pending
    approval`, or a failure. Plugin-provided servers are named
    `plugin:<plugin>:<server>`.
- Browse source: `~/.claude/plugins/known_marketplaces.json` +
  each marketplace's `.claude-plugin/marketplace.json`
  (`{ name, owner, plugins: [{ name, source, description, version? }] }`).

## Architecture

Follow existing patterns exactly; add nothing new structurally.

### Shared types (`src/shared/plugins.ts`)
- `marketplacePluginSchema` — `{ id, name, marketplace, description, version: string|null, installed: boolean }`.
- `mcpHealthSchema` — `{ name, kind: 'plugin'|'standalone', plugin: string|null, transport: string|null, target, status: 'ok'|'auth'|'error'|'pending'|'unknown', detail }`.
- `pluginDetailsSchema` — `{ id, ok, output }` (raw CLI text, rendered mono).
- `opResultSchema` — `{ ok, message }` for install/uninstall/marketplace-add.

### Service (`src/main/services/plugins/cli.ts`)
Pure helpers (unit-tested):
- `readMarketplacePlugins(dir)` — parse known_marketplaces + each marketplace.json
  into `{ id, name, marketplace, description, version }[]`; tolerant of bad files.
- `parseMcpHealth(raw)` — parse `claude mcp list` text into `McpHealth[]`.
  Split each line on the **last** ` - ` for status; split the head on the first
  `': '` for name/target; strip a trailing ` (HTTP)`/`(SSE)` into `transport`;
  map icon/text → status; `plugin:` prefix → kind='plugin', plugin=2nd segment.

Impure (shell out, wrapped like `updatePlugin`):
- `browseMarketplace()` — `readMarketplacePlugins()` joined with `listPlugins()`
  to set `installed`.
- `installPlugin(id)` / `uninstallPlugin(id)` / `addMarketplace(source)` → `{ ok, message }`.
- `pluginDetails(id)` → `{ id, ok, output }`.
- `mcpHealth()` → `execFile('claude', ['mcp','list'], { timeout: 60_000 })` → `parseMcpHealth`.

### Router (`src/main/trpc/routers/plugins.ts`)
Add to `pluginsRouter`, wrapping slow/network ops in
`trackJob(jobRegistry, { kind: 'plugins', label, detail }, work)`:
- `browse` (query), `install` (mutation, job), `uninstall` (mutation, job),
  `addMarketplace` (mutation, job), `details` (query), `mcpHealth` (mutation, job).

### UI (`src/renderer/src/pages/Plugins.tsx`)
`.tabs` + `setTab('plugins', …)` (Knowledge.tsx pattern). Three tabs:
- **Installed** — existing rows (update/toggle) + an uninstall action.
- **Marketplace** — search box (client-side filter on name/description/marketplace)
  + "add marketplace" input (source → `addMarketplace`) + cards
  (name, marketplace, description, installed badge, install button; expand → lazy
  `details`).
- **Health** — rows from `mcpHealth()`: colored status badge
  (ok=--ok, auth=--amber, error=--warn, pending/unknown=--fg-4), transport +
  target, plugin/standalone grouping label, "re-check" button.

New CSS classes in `index.css` following `.plugin-row` (mkt-card, health-row,
status badge). Toasts via `sonner`; `useUtils` for cache invalidation.

### Tests (`cli.test.ts`)
Unit tests for `parseMcpHealth` (each status icon, plugin vs standalone,
`(HTTP)` transport, header/garbage lines) and `readMarketplacePlugins`
(description/version capture, missing/broken manifests).

## Non-goals
- No project/local scope UI (user scope only).
- No standalone `claude mcp add` form (browse is plugin-marketplace based, per
  chosen scope). Health tab still shows all configured servers incl. standalone.
- Health is an on-demand snapshot (no polling).
