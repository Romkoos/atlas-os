import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  diffUpdate,
  parseMcpHealth,
  parsePluginList,
  readCatalog,
  readMarketplacePlugins,
  semverGt,
} from './cli'

describe('parsePluginList', () => {
  const sample = JSON.stringify([
    { id: 'a@mk', version: '1.0.0', scope: 'user', enabled: true },
    { id: 'b@mk', version: 'unknown', scope: 'user', enabled: false },
    { id: 'proj@mk', version: '2.0.0', scope: 'project', enabled: true },
    { id: 'a@mk', version: '1.0.0', scope: 'user', enabled: true }, // dupe
  ])

  it('keeps only user-scoped plugins', () => {
    const out = parsePluginList(sample)
    expect(out.map((p) => p.id)).toEqual(['a@mk', 'b@mk'])
  })

  it('dedupes by id', () => {
    const out = parsePluginList(sample)
    expect(out.filter((p) => p.id === 'a@mk')).toHaveLength(1)
  })

  it('splits name and marketplace from the id', () => {
    const [a] = parsePluginList(sample)
    expect(a.name).toBe('a')
    expect(a.marketplace).toBe('mk')
    expect(a.enabled).toBe(true)
  })

  it('defaults a missing version to unknown', () => {
    const out = parsePluginList(JSON.stringify([{ id: 'x@mk', scope: 'user' }]))
    expect(out[0].version).toBe('unknown')
    expect(out[0].enabled).toBe(false)
  })

  it('degrades to [] on malformed JSON', () => {
    expect(parsePluginList('not json')).toEqual([])
    expect(parsePluginList('{}')).toEqual([])
  })
})

describe('semverGt', () => {
  it('compares dotted numeric versions', () => {
    expect(semverGt('1.2.0', '1.1.9')).toBe(true)
    expect(semverGt('2.0.0', '1.9.9')).toBe(true)
    expect(semverGt('1.0.0', '1.0.0')).toBe(false)
    expect(semverGt('1.0.0', '1.0.1')).toBe(false)
  })

  it('tolerates a leading v and uneven segment counts', () => {
    expect(semverGt('v1.2', '1.1.9')).toBe(true)
    expect(semverGt('1.2.0', 'v1.2')).toBe(false)
  })

  it('returns false for non-numeric inputs (never a false positive)', () => {
    expect(semverGt('unknown', '1.0.0')).toBe(false)
    expect(semverGt('1.0.0', 'unknown')).toBe(false)
    expect(semverGt('84cc3c14fa1e', '1.0.0')).toBe(false)
  })
})

describe('diffUpdate', () => {
  // --- version-tracked plugins: the CLI compares by version number ---

  it('marks an update when the catalog has a higher semver version', () => {
    const r = diffUpdate({ sha: 'aaa', version: '5.1.0' }, { sha: 'bbb', version: '5.2.0' })
    expect(r).toEqual({ updateAvailable: true, latestVersion: '5.2.0' })
    expect(diffUpdate({ version: '1.0.0' }, { version: '1.1.0' })).toEqual({
      updateAvailable: true,
      latestVersion: '1.1.0',
    })
  })

  // Regression: superpowers reported "already at latest version (5.1.0)" yet we
  // re-flagged it forever because the marketplace pinned a newer COMMIT at the
  // SAME version. A sha drift on a versioned plugin must not be an update.
  it('does NOT mark a versioned plugin on same-version commit drift', () => {
    const r = diffUpdate({ sha: 'b557648', version: '5.1.0' }, { sha: '6fd4507' })
    expect(r.updateAvailable).toBe(false)
  })

  it('does not mark when the catalog version is equal or lower', () => {
    expect(diffUpdate({ version: '1.0.0' }, { version: '1.0.0' }).updateAvailable).toBe(false)
    expect(diffUpdate({ version: '2.0.0' }, { version: '1.9.0' }).updateAvailable).toBe(false)
  })

  // --- commit-tracked plugins (version "unknown" / a bare sha): compare sha ---

  it('marks an update when a commit-tracked plugin pins a different sha', () => {
    const r = diffUpdate({ sha: 'aaa', version: 'unknown' }, { sha: 'bbbbbbbbbbbbbb' })
    expect(r.updateAvailable).toBe(true)
    expect(r.latestVersion).toBe('bbbbbbbbbbbb')
  })

  it('does not mark a commit-tracked plugin when shas match', () => {
    expect(diffUpdate({ sha: 'aaa', version: 'unknown' }, { sha: 'aaa' }).updateAvailable).toBe(
      false,
    )
  })

  it('does not mark when nothing is determinable (no false positives)', () => {
    expect(diffUpdate({ version: 'unknown' }, {}).updateAvailable).toBe(false)
  })
})

describe('readCatalog', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'plugins-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  // Write a marketplace clone with its marketplace.json + optional per-plugin
  // plugin.json files, and register it in known_marketplaces.json.
  function marketplace(
    name: string,
    plugins: unknown[],
    manifests: Record<string, string> = {},
  ): void {
    const loc = join(dir, 'marketplaces', name)
    mkdirSync(join(loc, '.claude-plugin'), { recursive: true })
    writeFileSync(join(loc, '.claude-plugin', 'marketplace.json'), JSON.stringify({ plugins }))
    for (const [rel, version] of Object.entries(manifests)) {
      mkdirSync(join(loc, rel, '.claude-plugin'), { recursive: true })
      writeFileSync(join(loc, rel, '.claude-plugin', 'plugin.json'), JSON.stringify({ version }))
    }
    const knownPath = join(dir, 'known_marketplaces.json')
    const known: Record<string, unknown> = existsSync(knownPath)
      ? JSON.parse(readFileSync(knownPath, 'utf8'))
      : {}
    known[name] = { installLocation: loc }
    writeFileSync(knownPath, JSON.stringify(known))
  }

  it('takes the sha from an object source', () => {
    marketplace('off', [{ name: 'sp', source: { source: 'git-subdir', sha: 'deadbeef' } }])
    expect(readCatalog(dir).off.sp).toEqual({ sha: 'deadbeef', version: undefined })
  })

  it('prefers an explicit version on the marketplace entry', () => {
    marketplace('cm', [{ name: 'context-mode', version: '1.0.162', source: './' }], {
      '.': '9.9.9',
    })
    expect(readCatalog(dir).cm['context-mode'].version).toBe('1.0.162')
  })

  it('falls back to plugin.json version for a root single-repo source', () => {
    marketplace('fe', [{ name: 'fe-claude-infra', source: './' }], { '.': '1.0.5' })
    expect(readCatalog(dir).fe['fe-claude-infra']).toEqual({ sha: undefined, version: '1.0.5' })
  })

  it('falls back to plugin.json version for a subdir source', () => {
    marketplace('mg', [{ name: 'stratarts', source: './stratarts' }], { stratarts: '1.0.0' })
    expect(readCatalog(dir).mg.stratarts.version).toBe('1.0.0')
  })

  it('yields undefined version when no signal exists anywhere', () => {
    marketplace('x', [{ name: 'bare', source: './' }])
    expect(readCatalog(dir).x.bare).toEqual({ sha: undefined, version: undefined })
  })
})

describe('readMarketplacePlugins', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'plugins-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function marketplace(
    name: string,
    plugins: unknown[],
    manifests: Record<string, string> = {},
  ): void {
    const loc = join(dir, 'marketplaces', name)
    mkdirSync(join(loc, '.claude-plugin'), { recursive: true })
    writeFileSync(join(loc, '.claude-plugin', 'marketplace.json'), JSON.stringify({ plugins }))
    for (const [rel, version] of Object.entries(manifests)) {
      mkdirSync(join(loc, rel, '.claude-plugin'), { recursive: true })
      writeFileSync(join(loc, rel, '.claude-plugin', 'plugin.json'), JSON.stringify({ version }))
    }
    const knownPath = join(dir, 'known_marketplaces.json')
    const known: Record<string, unknown> = existsSync(knownPath)
      ? JSON.parse(readFileSync(knownPath, 'utf8'))
      : {}
    known[name] = { installLocation: loc }
    writeFileSync(knownPath, JSON.stringify(known))
  }

  it('returns [] when no marketplaces file exists', () => {
    expect(readMarketplacePlugins(dir)).toEqual([])
  })

  it('captures name, marketplace, description and builds the install id', () => {
    marketplace('mg', [
      { name: 'stratarts', source: './stratarts', description: '27 strategy skills' },
    ])
    expect(readMarketplacePlugins(dir)).toEqual([
      {
        id: 'stratarts@mg',
        name: 'stratarts',
        marketplace: 'mg',
        description: '27 strategy skills',
        version: null,
        installed: false,
      },
    ])
  })

  it('falls back to plugin.json version and defaults missing description to ""', () => {
    marketplace('fe', [{ name: 'fe-claude-infra', source: './' }], { '.': '1.0.5' })
    const [p] = readMarketplacePlugins(dir)
    expect(p.version).toBe('1.0.5')
    expect(p.description).toBe('')
  })

  it('sorts by id and tolerates a broken manifest', () => {
    marketplace('a', [{ name: 'zeta' }, { name: 'alpha' }])
    // broken marketplace: registered but no marketplace.json → contributes nothing
    const loc = join(dir, 'marketplaces', 'broken')
    mkdirSync(loc, { recursive: true })
    const known = JSON.parse(readFileSync(join(dir, 'known_marketplaces.json'), 'utf8'))
    known.broken = { installLocation: loc }
    writeFileSync(join(dir, 'known_marketplaces.json'), JSON.stringify(known))
    expect(readMarketplacePlugins(dir).map((p) => p.id)).toEqual(['alpha@a', 'zeta@a'])
  })
})

describe('parseMcpHealth', () => {
  const sample = [
    'Checking MCP server health…',
    '',
    'claude.ai Gmail: https://gmailmcp.googleapis.com/mcp/v1 - ! Needs authentication',
    'plugin:playwright:playwright: npx @playwright/mcp@latest - ✔ Connected',
    'plugin:atlassian:atlassian: https://mcp.atlassian.com/v1/mcp/authv2 (HTTP) - ✔ Connected',
    'pencil: /Applications/Pencil.app/mcp-server --agent x - ✔ Connected',
    'broken-one: npx broken - ✗ Failed to connect',
    'pend: https://x/mcp - ⏸ Pending approval',
  ].join('\n')

  it('skips the header/blank lines and parses one row per server', () => {
    const rows = parseMcpHealth(sample)
    expect(rows.map((r) => r.name)).toEqual([
      'claude.ai Gmail',
      'plugin:playwright:playwright',
      'plugin:atlassian:atlassian',
      'pencil',
      'broken-one',
      'pend',
    ])
  })

  it('maps status icons to statuses', () => {
    const byName = Object.fromEntries(parseMcpHealth(sample).map((r) => [r.name, r.status]))
    expect(byName['claude.ai Gmail']).toBe('auth')
    expect(byName['plugin:playwright:playwright']).toBe('ok')
    expect(byName['broken-one']).toBe('error')
    expect(byName.pend).toBe('pending')
  })

  it('classifies plugin vs standalone and extracts the plugin name', () => {
    const rows = parseMcpHealth(sample)
    const atlassian = rows.find((r) => r.name === 'plugin:atlassian:atlassian')
    expect(atlassian?.kind).toBe('plugin')
    expect(atlassian?.plugin).toBe('atlassian')
    const pencil = rows.find((r) => r.name === 'pencil')
    expect(pencil?.kind).toBe('standalone')
    expect(pencil?.plugin).toBeNull()
  })

  it('splits a trailing (HTTP) transport off the target', () => {
    const atlassian = parseMcpHealth(sample).find((r) => r.name === 'plugin:atlassian:atlassian')
    expect(atlassian?.transport).toBe('HTTP')
    expect(atlassian?.target).toBe('https://mcp.atlassian.com/v1/mcp/authv2')
  })

  it('keeps a URL target with a colon intact (no false name split)', () => {
    const gmail = parseMcpHealth(sample).find((r) => r.name === 'claude.ai Gmail')
    expect(gmail?.target).toBe('https://gmailmcp.googleapis.com/mcp/v1')
    expect(gmail?.detail).toBe('Needs authentication')
  })

  it('degrades to [] on empty / garbage input', () => {
    expect(parseMcpHealth('')).toEqual([])
    expect(parseMcpHealth('No MCP servers configured. Use `claude mcp add`')).toEqual([])
  })
})
