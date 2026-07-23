import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { claudeConfigDir, claudeExecutable } from '@main/paths'
import { subscriptionEnv } from '@main/services/llm/subscriptionEnv'
import {
  isSemver,
  type MarketplacePlugin,
  type McpHealth,
  type McpHealthStatus,
  type OpResult,
  type Plugin,
  type PluginDetails,
  type UpdateInfo,
  type UpdateResult,
} from '@shared/plugins'

const execFileAsync = promisify(execFile)

// ~/.claude-private/plugins (PRIVATE subscription) — holds installed_plugins.json
// + known_marketplaces.json. The app manages the private subscription's plugins,
// never the work subscription's (~/.claude/plugins).
function pluginsDir(): string {
  return join(claudeConfigDir(), 'plugins')
}

// Env for every shelled-out `claude` command below: pins CLAUDE_CONFIG_DIR to the
// private subscription (and strips API keys) so plugin/MCP operations read and
// mutate the private config, matching pluginsDir() above.
function cliEnv(): Record<string, string> {
  return subscriptionEnv()
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

// Browse source for the Marketplace tab: every plugin advertised by every
// configured marketplace, with its description. Reads known_marketplaces.json +
// each marketplace's marketplace.json. Tolerant of missing/odd files (those
// marketplaces just yield no entries). `installed` is left false here — the
// impure `browseMarketplace()` joins it against the user's installed plugins.
export function readMarketplacePlugins(dir: string): MarketplacePlugin[] {
  const out: MarketplacePlugin[] = []
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
    for (const p of plugins) {
      if (!p || typeof p !== 'object') continue
      const pe = p as Record<string, unknown>
      const name = typeof pe.name === 'string' ? pe.name : null
      if (!name) continue
      const version =
        typeof pe.version === 'string'
          ? pe.version
          : (readPluginManifestVersion(loc, pe.source) ?? null)
      out.push({
        id: `${name}@${mk}`,
        name,
        marketplace: mk,
        description: typeof pe.description === 'string' ? pe.description : '',
        version,
        installed: false,
      })
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

// Classify one `claude mcp list` status tail (e.g. "✔ Connected",
// "! Needs authentication", "⏸ Pending approval", "✗ Failed to connect").
function mcpStatusOf(tail: string): McpHealthStatus {
  const t = tail.toLowerCase()
  if (tail.includes('✔') || /connected/.test(t)) return 'ok'
  if (tail.includes('⏸') || /pending/.test(t)) return 'pending'
  if (tail.includes('!') || /auth/.test(t)) return 'auth'
  if (
    tail.includes('✗') ||
    tail.includes('✘') ||
    tail.includes('×') ||
    /fail|error|disconnect/.test(t)
  )
    return 'error'
  return 'unknown'
}

// Parse `claude mcp list` text output into per-server health rows.
// Each server line looks like:  `<name>: <target>[ (HTTP)] - <icon> <text>`
// The status tail is after the LAST ` - `; the name is before the FIRST `: `.
// Non-server lines (the "Checking…" header, blanks, "No MCP servers…") are
// skipped. Malformed input degrades to [] / dropped lines rather than throwing.
export function parseMcpHealth(raw: string): McpHealth[] {
  const out: McpHealth[] = []
  for (const line of raw.split('\n')) {
    const s = line.trim()
    if (!s) continue
    const sep = s.lastIndexOf(' - ')
    if (sep < 0) continue // header / summary line without a status tail
    const head = s.slice(0, sep).trim()
    const tail = s.slice(sep + 3).trim()
    const colon = head.indexOf(': ')
    if (colon < 0) continue
    const name = head.slice(0, colon).trim()
    if (!name) continue
    let target = head.slice(colon + 2).trim()
    let transport: string | null = null
    const tm = /\s*\(([^)]+)\)\s*$/.exec(target)
    if (tm) {
      transport = tm[1]
      target = target.slice(0, tm.index).trim()
    }
    const isPlugin = name.startsWith('plugin:')
    out.push({
      name,
      kind: isPlugin ? 'plugin' : 'standalone',
      plugin: isPlugin ? (name.split(':')[1] ?? null) : null,
      transport,
      target,
      status: mcpStatusOf(tail),
      detail: tail.replace(/^[^A-Za-z0-9]+/, '').trim() || tail,
    })
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
    const { stdout } = await execFileAsync(claudeExecutable(), ['plugin', 'list', '--json'], {
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024,
      env: cliEnv(),
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
      claudeExecutable(),
      ['plugin', enabled ? 'enable' : 'disable', id, '--scope', 'user'],
      {
        timeout: 30_000,
        env: cliEnv(),
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
    await execFileAsync(claudeExecutable(), ['plugin', 'marketplace', 'update'], {
      timeout: 120_000,
      env: cliEnv(),
    })
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
    const { stdout } = await execFileAsync(
      claudeExecutable(),
      ['plugin', 'update', id, '--scope', 'user'],
      {
        timeout: 120_000,
        maxBuffer: 10 * 1024 * 1024,
        env: cliEnv(),
      },
    )
    return { id, ok: true, message: stdout.trim() || 'updated' }
  } catch (err) {
    return { id, ok: false, message: friendlyError(err, 'update failed').message }
  }
}

// Marketplace catalog joined with the user's installed plugins so the UI can
// show an "installed" badge / disable the install button. Reads catalogs off
// disk (fast) and lists installed plugins via the CLI.
export async function browseMarketplace(): Promise<MarketplacePlugin[]> {
  const catalog = readMarketplacePlugins(pluginsDir())
  let installedIds: Set<string>
  try {
    installedIds = new Set((await listPlugins()).map((p) => p.id))
  } catch {
    // If the CLI can't list installed plugins we still show the catalog; the
    // install button simply won't know something is already installed.
    installedIds = new Set()
  }
  return catalog.map((p) => ({ ...p, installed: installedIds.has(p.id) }))
}

export async function installPlugin(id: string): Promise<OpResult> {
  try {
    const { stdout } = await execFileAsync(
      claudeExecutable(),
      ['plugin', 'install', id, '--scope', 'user'],
      {
        timeout: 120_000,
        maxBuffer: 10 * 1024 * 1024,
        env: cliEnv(),
      },
    )
    return { ok: true, message: stdout.trim() || `installed ${id}` }
  } catch (err) {
    return { ok: false, message: friendlyError(err, 'install failed').message }
  }
}

export async function uninstallPlugin(id: string): Promise<OpResult> {
  try {
    const { stdout } = await execFileAsync(
      claudeExecutable(),
      ['plugin', 'uninstall', id, '--scope', 'user', '--yes'],
      { timeout: 60_000, maxBuffer: 10 * 1024 * 1024, env: cliEnv() },
    )
    return { ok: true, message: stdout.trim() || `uninstalled ${id}` }
  } catch (err) {
    return { ok: false, message: friendlyError(err, 'uninstall failed').message }
  }
}

export async function addMarketplace(source: string): Promise<OpResult> {
  try {
    const { stdout } = await execFileAsync(
      claudeExecutable(),
      ['plugin', 'marketplace', 'add', source, '--scope', 'user'],
      { timeout: 120_000, maxBuffer: 10 * 1024 * 1024, env: cliEnv() },
    )
    return { ok: true, message: stdout.trim() || `added ${source}` }
  } catch (err) {
    return { ok: false, message: friendlyError(err, 'marketplace add failed').message }
  }
}

// Lazy per-card component inventory (skills / MCP servers / commands + token
// cost) via `claude plugin details`. Shown verbatim, so failures return their
// text rather than throwing.
export async function pluginDetails(id: string): Promise<PluginDetails> {
  try {
    const { stdout } = await execFileAsync(claudeExecutable(), ['plugin', 'details', id], {
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024,
      env: cliEnv(),
    })
    return { id, ok: true, output: stdout.trim() || 'no details reported' }
  } catch (err) {
    return { id, ok: false, output: friendlyError(err, 'details failed').message }
  }
}

// Ping every configured MCP server. `claude mcp list` performs the health check
// itself and prints one line per server; we parse those into structured rows.
export async function mcpHealth(): Promise<McpHealth[]> {
  try {
    const { stdout } = await execFileAsync(claudeExecutable(), ['mcp', 'list'], {
      timeout: 60_000,
      maxBuffer: 10 * 1024 * 1024,
      env: cliEnv(),
    })
    return parseMcpHealth(stdout)
  } catch (err) {
    // A non-zero exit still often carries the listing on stdout (some servers
    // failing the health check). Parse whatever we got; only ENOENT is fatal.
    const e = err as NodeJS.ErrnoException & { stdout?: string }
    if (e.code === 'ENOENT') throw friendlyError(err, 'mcp list failed')
    if (typeof e.stdout === 'string' && e.stdout.trim()) return parseMcpHealth(e.stdout)
    throw friendlyError(err, 'mcp list failed')
  }
}
