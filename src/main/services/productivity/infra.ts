import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AppDatabase } from '@main/db/client'
import { ecosystemChanges } from '@main/db/schema'
import { ecosystemId } from '@main/services/productivity/ids'
import type { EcosystemChange } from '@main/services/productivity/jsonl'

// Polling watcher for Claude Code infra changes. Each ingest run snapshots the
// live ~/.claude state (enabled plugins, MCP servers, user skills) and diffs it
// against the previously stored snapshot, writing one ecosystem_changes row per
// detected add/remove/enable/disable/edit. This is the producer the table was
// always missing — nothing else writes infra changes. See docs/agent-productivity-tracker.md.

export interface InfraState {
  plugins: Record<string, boolean> // settings.json enabledPlugins: name -> enabled
  mcpActive: string[] // ~/.claude.json mcpServers keys
  mcpDisabled: string[] // ~/.claude.json mcpServersDisabled keys
  skills: Record<string, number> // user skill name -> SKILL.md mtime (ms)
}

// ── Pure diff (unit-tested) ─────────────────────────────────────────────────

function change(type: string, target: string, tsMs: number, diff: string | null): EcosystemChange {
  const ts = new Date(tsMs)
  const iso = ts.toISOString()
  return {
    id: ecosystemId(iso, type, target, diff),
    ts,
    type,
    target,
    source: 'auto',
    diff,
    note: diff ? `${type.replace(/_/g, ' ')} (${diff})` : type.replace(/_/g, ' '),
  }
}

type McpState = 'active' | 'disabled' | 'none'
const mcpStateOf = (s: InfraState, name: string): McpState =>
  s.mcpActive.includes(name) ? 'active' : s.mcpDisabled.includes(name) ? 'disabled' : 'none'

// Diff two infra snapshots into ecosystem changes. `prev === null` means first
// run: seed silently (return []) so we never flood the timeline with the whole
// current state. Skill add/edit are dated by the file mtime; everything else by
// `nowMs` (Claude Code keeps no native change log, so detection time is best).
export function diffInfraState(
  prev: InfraState | null,
  curr: InfraState,
  nowMs: number,
): EcosystemChange[] {
  if (prev === null) return []
  const out: EcosystemChange[] = []

  // Plugins (enable flag).
  for (const name of new Set([...Object.keys(prev.plugins), ...Object.keys(curr.plugins)])) {
    const had = name in prev.plugins
    const has = name in curr.plugins
    if (has && !had) out.push(change('plugin_added', name, nowMs, null))
    else if (had && !has) out.push(change('plugin_removed', name, nowMs, null))
    else if (prev.plugins[name] !== curr.plugins[name])
      out.push(change(curr.plugins[name] ? 'plugin_enabled' : 'plugin_disabled', name, nowMs, null))
  }

  // MCP servers (active / disabled / absent).
  const mcpNames = new Set([
    ...prev.mcpActive,
    ...prev.mcpDisabled,
    ...curr.mcpActive,
    ...curr.mcpDisabled,
  ])
  for (const name of mcpNames) {
    const a = mcpStateOf(prev, name)
    const b = mcpStateOf(curr, name)
    if (a === b) continue
    if (a === 'none')
      out.push(change('mcp_added', name, nowMs, b === 'disabled' ? 'disabled' : null))
    else if (b === 'none') out.push(change('mcp_removed', name, nowMs, null))
    else if (b === 'disabled') out.push(change('mcp_disabled', name, nowMs, 'active→disabled'))
    else out.push(change('mcp_enabled', name, nowMs, 'disabled→active'))
  }

  // User skills (presence + mtime).
  for (const name of new Set([...Object.keys(prev.skills), ...Object.keys(curr.skills)])) {
    const a = prev.skills[name]
    const b = curr.skills[name]
    if (a == null && b != null) out.push(change('skill_added', name, b, null))
    else if (a != null && b == null) out.push(change('skill_removed', name, nowMs, null))
    else if (a != null && b != null && b > a) out.push(change('skill_edited', name, b, null))
  }

  return out
}

// ── Filesystem read (impure, thin) ──────────────────────────────────────────

export interface InfraPaths {
  settingsPath: string // ~/.claude/settings.json
  claudeJsonPath: string // ~/.claude.json
  skillsDir: string // ~/.claude/skills
}

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return null
  }
}

// Snapshot the live infra state. Every read is tolerant: a missing/corrupt file
// contributes nothing rather than throwing, so detection never breaks ingest.
export async function readInfraState(paths: InfraPaths): Promise<InfraState> {
  const settings = (await readJson(paths.settingsPath)) ?? {}
  const claude = (await readJson(paths.claudeJsonPath)) ?? {}
  const plugins: Record<string, boolean> = {}
  const ep = settings.enabledPlugins
  if (ep && typeof ep === 'object') {
    for (const [k, v] of Object.entries(ep)) plugins[k] = Boolean(v)
  }
  const keysOf = (o: unknown): string[] =>
    o && typeof o === 'object' ? Object.keys(o as Record<string, unknown>) : []

  const skills: Record<string, number> = {}
  let entries: string[] = []
  try {
    entries = (await readdir(paths.skillsDir, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name)
  } catch {
    entries = []
  }
  for (const name of entries) {
    try {
      const skillMd = join(paths.skillsDir, name, 'SKILL.md')
      const st = await stat(skillMd).catch(() => stat(join(paths.skillsDir, name)))
      skills[name] = Math.round(st.mtimeMs)
    } catch {
      // unreadable skill dir: skip
    }
  }

  return {
    plugins,
    mcpActive: keysOf(claude.mcpServers),
    mcpDisabled: keysOf(claude.mcpServersDisabled),
    skills,
  }
}

async function readSnapshot(path: string): Promise<InfraState | null> {
  return (await readJson(path)) as InfraState | null
}

async function writeSnapshot(path: string, state: InfraState): Promise<void> {
  try {
    await writeFile(path, JSON.stringify(state), 'utf8')
  } catch {
    // best-effort: a failed snapshot write just means we re-seed next run
  }
}

// Detect + persist infra changes. Reads current state, diffs against the stored
// snapshot, inserts new rows (idempotent via deterministic id), then saves the
// new snapshot. Returns the number of changes written. Never throws.
export async function detectInfraChanges(
  database: AppDatabase,
  paths: InfraPaths & { snapshotPath: string },
): Promise<number> {
  try {
    const curr = await readInfraState(paths)
    const prev = await readSnapshot(paths.snapshotPath)
    const changes = diffInfraState(prev, curr, Date.now())
    for (const row of changes) {
      database.insert(ecosystemChanges).values(row).onConflictDoNothing().run()
    }
    await writeSnapshot(paths.snapshotPath, curr)
    return changes.length
  } catch {
    return 0
  }
}
