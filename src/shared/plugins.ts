import { z } from 'zod'

// A user-scoped Claude Code plugin as shown on the Plugins page. `id` is the
// canonical `name@marketplace` handle the `claude` CLI expects. `version` is
// raw as reported by the CLI (may be "unknown" for plugins whose plugin.json
// declares no version); `commit` is the installed git sha, when known.
export const pluginSchema = z.object({
  id: z.string(),
  name: z.string(),
  marketplace: z.string(),
  version: z.string(),
  commit: z.string().nullable(),
  enabled: z.boolean(),
})
export type Plugin = z.infer<typeof pluginSchema>

const SEMVER_RE = /^v?\d+(?:\.\d+)*(?:[-+].*)?$/

// True iff `version` is a real dotted-numeric version (not "unknown" or a bare
// git sha). Distinguishes version-tracked plugins from commit-tracked ones.
export function isSemver(version: string): boolean {
  const v = version.trim()
  return v !== '' && v !== 'unknown' && SEMVER_RE.test(v)
}

// Human-friendly version label for a plugin row. Semver → "v1.2.3"; a bare
// commit sha (or version="unknown" with a known install sha) → "#abc1234";
// otherwise "unversioned". Avoids rendering an ugly "vunknown".
export function formatVersion(version: string, commit: string | null): string {
  const v = version.trim()
  if (isSemver(v)) return `v${v.replace(/^v/, '')}`
  const sha = v && v !== 'unknown' ? v : commit
  return sha ? `#${sha.slice(0, 7)}` : 'unversioned'
}

// Result of an update check for a single plugin. `latestVersion` is the catalog
// version (or short sha) we'd move to; null when undetermined / already current.
export const updateInfoSchema = z.object({
  id: z.string(),
  updateAvailable: z.boolean(),
  latestVersion: z.string().nullable(),
})
export type UpdateInfo = z.infer<typeof updateInfoSchema>

// Per-plugin outcome of an `update` / `update all` run.
export const updateResultSchema = z.object({
  id: z.string(),
  ok: z.boolean(),
  message: z.string(),
})
export type UpdateResult = z.infer<typeof updateResultSchema>

// A plugin advertised by a configured marketplace, for the Marketplace tab.
// `id` is the canonical `name@marketplace` handle `claude plugin install` takes.
// `installed` is joined from the user's installed plugins.
export const marketplacePluginSchema = z.object({
  id: z.string(),
  name: z.string(),
  marketplace: z.string(),
  description: z.string(),
  version: z.string().nullable(),
  installed: z.boolean(),
})
export type MarketplacePlugin = z.infer<typeof marketplacePluginSchema>

// Generic outcome of a fire-once CLI op (install / uninstall / marketplace add).
// Never throws to the UI — failures surface as `{ ok: false, message }`.
export const opResultSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
})
export type OpResult = z.infer<typeof opResultSchema>

// Raw `claude plugin details <id>` output, shown verbatim when a card expands.
export const pluginDetailsSchema = z.object({
  id: z.string(),
  ok: z.boolean(),
  output: z.string(),
})
export type PluginDetails = z.infer<typeof pluginDetailsSchema>

// One MCP server as reported (and health-checked) by `claude mcp list`.
// `kind` distinguishes plugin-provided servers (name `plugin:<plugin>:<server>`)
// from standalone ones. `status` is the pinged health at snapshot time.
export const mcpHealthStatus = z.enum(['ok', 'auth', 'error', 'pending', 'unknown'])
export type McpHealthStatus = z.infer<typeof mcpHealthStatus>

export const mcpHealthSchema = z.object({
  name: z.string(),
  kind: z.enum(['plugin', 'standalone']),
  plugin: z.string().nullable(),
  transport: z.string().nullable(),
  target: z.string(),
  status: mcpHealthStatus,
  detail: z.string(),
})
export type McpHealth = z.infer<typeof mcpHealthSchema>
