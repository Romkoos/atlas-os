# Plugins section — design

**Date:** 2026-06-04
**Status:** Approved

## Goal

Add a new top-level **Plugins** section to atlas-os that lets the user:

- See their installed (user-global) Claude Code plugins and whether each is enabled.
- Enable / disable each plugin.
- Check for available plugin updates (marks plugins that have one).
- Update each plugin individually, and update all that have updates with one action.

Out of scope (not requested): installing new plugins, adding/removing marketplaces,
project- and local-scoped plugins.

## Approach

Shell out to the official `claude plugin …` CLI, mirroring the existing knowledge
service's `uv` shell-out pattern. This keeps behavior correct as Claude Code evolves
and avoids reimplementing the installer / config writer by hand.

Rejected alternative: directly editing `~/.claude/settings.json` (`enabledPlugins`)
and `installed_plugins.json` + driving git ourselves. More fragile and duplicates
Claude Code internals.

The one place we read files directly is **update detection**, because the CLI's
`list --available --json` does not reliably expose a per-plugin diff signal for
already-installed plugins. See "Update detection" below.

## Architecture / data flow

```
Plugins.tsx ──tRPC──> plugins router ──> services/plugins/cli.ts ──execFile──> `claude plugin …`
                                                       └────────── reads installed_plugins.json
                                                                   + refreshed marketplace.json catalogs
```

## Backend — `src/main/services/plugins/cli.ts`

All process spawning uses `execFile` (no shell), with generous timeouts. Every
exported function returns typed data or throws a normalized error.

- `listPlugins()`:
  - Runs `claude plugin list --json`.
  - Keeps `scope === 'user'` entries, dedupes by `id`.
  - Returns `Plugin[]`: `{ id, name, marketplace, version, enabled }`.
    (`name`/`marketplace` are split from `id` = `name@marketplace`.)

- `setEnabled(id, enabled)`:
  - Runs `claude plugin enable <id> --scope user` or `claude plugin disable <id> --scope user`.

- `checkUpdates()`:
  - Runs `claude plugin marketplace update` (refresh — network, slow). Failures of
    individual marketplaces are tolerated; we still diff what we can.
  - Reads `~/.claude/plugins/installed_plugins.json` for each user plugin's
    `gitCommitSha` + `version`.
  - Reads each marketplace's refreshed `.../marketplace.json` (location from
    `known_marketplaces.json`) for the plugin's catalog entry.
  - Diff signal per plugin (conservative — only mark on a confident diff):
    1. If catalog `source.sha` exists and differs from installed `gitCommitSha`
       → update available; `latestVersion` = short sha or catalog `version`.
    2. Else if catalog `version` exists and is semver-greater than installed
       `version` → update available; `latestVersion` = catalog `version`.
    3. Else → not marked (undetermined never shows a false positive).
  - Returns `UpdateInfo[]`: `{ id, updateAvailable, latestVersion }`.

- `updatePlugin(id)`:
  - Runs `claude plugin update <id> --scope user`.

## tRPC — `src/main/trpc/routers/plugins.ts`

- `list` — query → `Plugin[]`.
- `setEnabled` — mutation, input `{ id: string, enabled: boolean }`.
- `checkUpdates` — mutation (explicit; does network I/O) → `UpdateInfo[]`.
- `update` — mutation, input `{ id: string }`.

Registered on the root router as `plugins`. Shared zod schemas/types live in
`src/shared/plugins.ts` (`pluginSchema`, `updateInfoSchema`).

## UI — `src/renderer/src/pages/Plugins.tsx`

- Nav: insert `{ id: 'plugins', key: '07', label: 'PLUGINS' }` after SKILLS; SETTINGS
  becomes `08`. `Section` type, `PAGES` map, and the Cmd+N loop adapt automatically
  (shortcuts are 1-based index into `NAV`).
- `PageHeader` (num `07`, title `plugins`) with two action-slot buttons:
  - **Check for updates** — runs `checkUpdates`, shows a spinner while running.
  - **Update all** — enabled only when ≥1 update is available; updates them sequentially.
- Plugin list, one row each: name, marketplace, version, an **enable/disable toggle**,
  and — when an update is available — an **"update → vX" badge** + a per-row **Update** button.
- Footer note: *"Changes apply on Claude Code's next launch."*
- Styling: Tailwind + existing terminal-theme classes, consistent with Knowledge/Skills.

## State / behavior

- Page opens showing cached enable/version state instantly — no automatic network call.
- Enable/disable: optimistic toggle with rollback on error; invalidate `list` afterward.
- `checkUpdates`: populates per-row update badges (held in page state keyed by id).
- `Update all`: loops the available updates sequentially, reports per-plugin
  success/failure, then re-runs `list` + clears resolved update badges.

## Error handling

- `claude` missing or non-zero exit → inline/page-level error, never a crash.
- `Update all` reports per-plugin results rather than aborting on the first failure.

## Testing

Unit-test `cli.ts` against captured fixtures (mock `execFile` + temp JSON files),
following `store.test.ts`:

- `listPlugins`: parses `list --json`, filters to `scope=user`, dedupes by id,
  splits `name`/`marketplace`.
- `checkUpdates` diff logic: sha-differs → marked; semver-greater → marked;
  equal sha / equal version / undetermined → not marked (no false positives).
- `setEnabled` / `updatePlugin`: builds the correct argv.
