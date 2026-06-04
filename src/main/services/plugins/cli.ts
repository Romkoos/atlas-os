import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { isSemver, type Plugin, type UpdateInfo, type UpdateResult } from '@shared/plugins'

const execFileAsync = promisify(execFile)

// ~/.claude/plugins — holds installed_plugins.json + known_marketplaces.json.
function pluginsDir(): string {
  return join(homedir(), '.claude', 'plugins')
}

// ---- pure helpers (unit-tested) -------------------------------------------

// Parse `claude plugin list --json` into user-scoped Plugins, deduped by id.
// Malformed JSON / unexpected shape degrades to [] rather than throwing.
export function parsePluginList(raw: string): Plugin[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const seen = new Set<string>()
  const out: Plugin[] = []
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    if (e.scope !== 'user') continue
    const id = typeof e.id === 'string' ? e.id : null
    if (!id || seen.has(id)) continue
    seen.add(id)
    const at = id.lastIndexOf('@')
    out.push({
      id,
      name: at > 0 ? id.slice(0, at) : id,
      marketplace: at > 0 ? id.slice(at + 1) : '',
      version: typeof e.version === 'string' ? e.version : 'unknown',
      // The CLI list does not include the commit; listPlugins() enriches it
      // from installed_plugins.json so unversioned plugins still show identity.
      commit: null,
      enabled: e.enabled === true,
    })
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

// Compare dotted numeric versions. Returns true iff `a` is strictly greater.
// Non-numeric / unparseable inputs (e.g. "unknown", a git sha) return false so
// they never trigger a false "update available" via the version path.
export function semverGt(a: string, b: string): boolean {
  // Strict: the whole token must be a dotted-numeric version (optionally a
  // leading `v` and a `-`/`+` prerelease tail). Rejects git shas like
  // "84cc3c14fa1e" that merely start with digits — those must not look greater.
  const parse = (v: string): number[] | null => {
    const m = /^v?(\d+(?:\.\d+)*)(?:[-+].*)?$/.exec(v.trim())
    if (!m) return null
    return m[1].split('.').map(Number)
  }
  const pa = parse(a)
  const pb = parse(b)
  if (!pa || !pb) return false
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x !== y) return x > y
  }
  return false
}

// Update diff for one plugin, mirroring how `claude plugin update` itself
// decides — otherwise we'd flag updates the CLI then refuses to apply.
//
// - Version-tracked plugin (installed version is real semver, e.g. 5.1.0): the
//   CLI compares by version and IGNORES same-version commit drift. So we flag
//   only when the catalog advertises a strictly higher semver version. A bare
//   sha mismatch at the same version is NOT an update (the superpowers case:
//   marketplace pins a newer commit but it's still 5.1.0 → "already latest").
// - Commit-tracked plugin (version "unknown" or a bare sha): the CLI keys off
//   the pinned commit, so a differing catalog sha is a genuine update.
export function diffUpdate(
  installed: { sha?: string | null; version: string },
  catalog: { sha?: string | null; version?: string | null },
): { updateAvailable: boolean; latestVersion: string | null } {
  if (isSemver(installed.version)) {
    if (catalog.version && semverGt(catalog.version, installed.version)) {
      return { updateAvailable: true, latestVersion: catalog.version }
    }
    return { updateAvailable: false, latestVersion: null }
  }
  if (installed.sha && catalog.sha && installed.sha !== catalog.sha) {
    return { updateAvailable: true, latestVersion: catalog.version ?? catalog.sha.slice(0, 12) }
  }
  return { updateAvailable: false, latestVersion: null }
}

// Read the `version` from a plugin's own `.claude-plugin/plugin.json`. For
// single-repo / local marketplaces (`source: "./"` or `"./subdir"`) this is the
// ONLY place the catalog version lives — marketplace.json carries neither a
// `version` nor a `source.sha`. Returns undefined if absent/unreadable.
export function readPluginManifestVersion(loc: string, source: unknown): string | undefined {
  let rel: string | undefined
  if (typeof source === 'string') rel = source
  else if (source && typeof source === 'object') {
    const path = (source as Record<string, unknown>).path
    rel = typeof path === 'string' ? path : undefined
  }
  if (rel === undefined) return undefined
  const pj = join(loc, rel, '.claude-plugin', 'plugin.json')
  if (!existsSync(pj)) return undefined
  try {
    const v = (JSON.parse(readFileSync(pj, 'utf8')) as Record<string, unknown>).version
    return typeof v === 'string' ? v : undefined
  } catch {
    return undefined
  }
}

// Build the catalog lookup `{ marketplace -> { pluginName -> {sha, version} } }`
// from known_marketplaces.json + each marketplace's marketplace.json. Tolerant
// of missing files / odd shapes (those marketplaces just yield no entries).
export function readCatalog(
  dir: string,
): Record<string, Record<string, { sha?: string; version?: string }>> {
  const out: Record<string, Record<string, { sha?: string; version?: string }>> = {}
  const knownPath = join(dir, 'known_marketplaces.json')
  if (!existsSync(knownPath)) return out
  let known: Record<string, unknown>
  try {
    known = JSON.parse(readFileSync(knownPath, 'utf8'))
  } catch {
    return out
  }
  for (const [mk, infoRaw] of Object.entries(known)) {
    const info = infoRaw as Record<string, unknown>
    const loc = typeof info.installLocation === 'string' ? info.installLocation : null
    if (!loc) continue
    const mkPath = join(loc, '.claude-plugin', 'marketplace.json')
    if (!existsSync(mkPath)) continue
    let manifest: Record<string, unknown>
    try {
      manifest = JSON.parse(readFileSync(mkPath, 'utf8'))
    } catch {
      continue
    }
    const plugins = Array.isArray(manifest.plugins) ? manifest.plugins : []
    const byName: Record<string, { sha?: string; version?: string }> = {}
    for (const p of plugins) {
      if (!p || typeof p !== 'object') continue
      const pe = p as Record<string, unknown>
      const name = typeof pe.name === 'string' ? pe.name : null
      if (!name) continue
      const srcObj =
        pe.source && typeof pe.source === 'object' ? (pe.source as Record<string, unknown>) : {}
      // Version precedence: marketplace.json entry → the plugin's own
      // plugin.json (single-repo/local marketplaces keep it only there).
      const version =
        typeof pe.version === 'string' ? pe.version : readPluginManifestVersion(loc, pe.source)
      byName[name] = {
        sha: typeof srcObj.sha === 'string' ? srcObj.sha : undefined,
        version,
      }
    }
    out[mk] = byName
  }
  return out
}

// Read installed_plugins.json → `{ id -> { sha, version } }` for user scope.
function readInstalled(dir: string): Record<string, { sha?: string; version: string }> {
  const out: Record<string, { sha?: string; version: string }> = {}
  const p = join(dir, 'installed_plugins.json')
  if (!existsSync(p)) return out
  let data: Record<string, unknown>
  try {
    data = JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return out
  }
  const plugins =
    data.plugins && typeof data.plugins === 'object'
      ? (data.plugins as Record<string, unknown>)
      : {}
  for (const [id, versionsRaw] of Object.entries(plugins)) {
    const versions = Array.isArray(versionsRaw) ? versionsRaw : []
    const user = versions.find(
      (v) => v && typeof v === 'object' && (v as Record<string, unknown>).scope === 'user',
    )
    if (!user) continue
    const u = user as Record<string, unknown>
    out[id] = {
      sha: typeof u.gitCommitSha === 'string' ? u.gitCommitSha : undefined,
      version: typeof u.version === 'string' ? u.version : 'unknown',
    }
  }
  return out
}

// ---- impure operations (shell out to the `claude` CLI) --------------------

function friendlyError(err: unknown, fallback: string): Error {
  const e = err as NodeJS.ErrnoException & { stderr?: string }
  if (e.code === 'ENOENT') {
    return new Error('`claude` not found on PATH — Claude Code CLI is required to manage plugins.')
  }
  return new Error(e.stderr?.trim() || e.message || fallback)
}

export async function listPlugins(): Promise<Plugin[]> {
  try {
    const { stdout } = await execFileAsync('claude', ['plugin', 'list', '--json'], {
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024,
    })
    const installed = readInstalled(pluginsDir())
    return parsePluginList(stdout).map((p) => ({ ...p, commit: installed[p.id]?.sha ?? null }))
  } catch (err) {
    throw friendlyError(err, 'failed to list plugins')
  }
}

export async function setEnabled(id: string, enabled: boolean): Promise<void> {
  try {
    await execFileAsync(
      'claude',
      ['plugin', enabled ? 'enable' : 'disable', id, '--scope', 'user'],
      {
        timeout: 30_000,
      },
    )
  } catch (err) {
    throw friendlyError(err, `failed to ${enabled ? 'enable' : 'disable'} ${id}`)
  }
}

// Refresh marketplace catalogs (network, slow), then diff installed vs catalog.
// A failed refresh is tolerated — we still report against whatever is on disk.
export async function checkUpdates(): Promise<UpdateInfo[]> {
  try {
    await execFileAsync('claude', ['plugin', 'marketplace', 'update'], { timeout: 120_000 })
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    if (e.code === 'ENOENT') throw friendlyError(err, 'marketplace update failed')
    // Non-ENOENT: a marketplace may have failed to pull. Continue with cache.
  }
  const dir = pluginsDir()
  const installed = readInstalled(dir)
  const catalog = readCatalog(dir)
  const plugins = await listPlugins()
  return plugins.map((p) => {
    const inst = installed[p.id] ?? { sha: undefined, version: p.version }
    const cat = catalog[p.marketplace]?.[p.name] ?? {}
    const { updateAvailable, latestVersion } = diffUpdate(inst, cat)
    return { id: p.id, updateAvailable, latestVersion }
  })
}

export async function updatePlugin(id: string): Promise<UpdateResult> {
  try {
    const { stdout } = await execFileAsync('claude', ['plugin', 'update', id, '--scope', 'user'], {
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
    })
    return { id, ok: true, message: stdout.trim() || 'updated' }
  } catch (err) {
    return { id, ok: false, message: friendlyError(err, 'update failed').message }
  }
}
