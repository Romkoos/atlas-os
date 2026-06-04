import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { diffUpdate, parsePluginList, readCatalog, semverGt } from './cli'

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
