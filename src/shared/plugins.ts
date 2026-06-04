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
