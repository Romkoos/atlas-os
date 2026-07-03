import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CodeGraph } from '@shared/graph'
import { afterEach, describe, expect, it } from 'vitest'
import { exportMap, mapIndexMarkdown, shouldKeepArtifact } from './mapExport'
import { mapsProjectDir } from './mapStore'

const graph: CodeGraph = {
  nodes: [
    {
      id: 'p::code::a',
      projectPath: 'p',
      kind: 'code',
      label: 'a.ts',
      relPath: 'a.ts',
      meta: null,
      community: 0,
      origin: 'indexer',
    },
    {
      id: 'p::code::b',
      projectPath: 'p',
      kind: 'code',
      label: 'b.ts',
      relPath: 'b.ts',
      meta: null,
      community: 0,
      origin: 'indexer',
    },
    {
      id: 'p::doc::x',
      projectPath: 'p',
      kind: 'doc',
      label: 'x.md',
      relPath: 'x.md',
      meta: null,
      community: 1,
      origin: 'graphify',
    },
  ],
  edges: [
    {
      id: 'e1',
      projectPath: 'p',
      source: 'p::code::a',
      target: 'p::code::b',
      kind: 'imports',
      inferred: false,
      origin: 'indexer',
      meta: null,
    },
    {
      id: 'e2',
      projectPath: 'p',
      source: 'p::code::a',
      target: 'p::doc::x',
      kind: 'semantic',
      inferred: true,
      origin: 'graphify',
      meta: null,
    },
  ],
}

afterEach(() => {
  process.env.ATLAS_MAPS_STORE = undefined
})

describe('shouldKeepArtifact', () => {
  it('keeps real artifacts, drops intermediates and cache', () => {
    expect(shouldKeepArtifact('graph.json')).toBe(true)
    expect(shouldKeepArtifact('wiki')).toBe(true)
    expect(shouldKeepArtifact('.graphify_ast.json')).toBe(false)
    expect(shouldKeepArtifact('cache')).toBe(false)
  })
})

describe('mapIndexMarkdown', () => {
  it('reports counts, date, and the highest-degree key node first', () => {
    const md = mapIndexMarkdown('atlas-os', graph, new Date('2026-07-03T00:00:00Z'))
    expect(md).toContain('# Map Index — atlas-os')
    expect(md).toContain('3 nodes · 2 edges · built 2026-07-03')
    // a.ts has degree 2 (highest) → it leads community 0's key nodes.
    const row = md.split('\n').find((l) => l.startsWith('| 0 |'))
    expect(row).toContain('a.ts')
  })

  it('excludes session nodes (run-history telemetry) from counts and key nodes', () => {
    const withSession: CodeGraph = {
      nodes: [
        ...graph.nodes,
        {
          id: 'p::session::1fd98a43',
          projectPath: 'p',
          kind: 'session',
          label: '1fd98a43',
          relPath: null,
          meta: null,
          community: 0,
          origin: 'indexer',
        },
      ],
      edges: [
        ...graph.edges,
        // give the session node high degree so it would win the key-node ranking
        // if it were not filtered out.
        {
          id: 'e3',
          projectPath: 'p',
          source: 'p::session::1fd98a43',
          target: 'p::code::a',
          kind: 'session_touched',
          inferred: false,
          origin: 'indexer',
          meta: null,
        },
        {
          id: 'e4',
          projectPath: 'p',
          source: 'p::session::1fd98a43',
          target: 'p::code::b',
          kind: 'session_touched',
          inferred: false,
          origin: 'indexer',
          meta: null,
        },
      ],
    }
    const md = mapIndexMarkdown('atlas-os', withSession, new Date('2026-07-03T00:00:00Z'))
    // the opaque session-hash label must not pollute the injected architecture map
    expect(md).not.toContain('1fd98a43')
    // counts reflect the 3 architectural nodes + 2 architectural edges, not the
    // session node and its two session_touched edges.
    expect(md).toContain('3 nodes · 2 edges · built 2026-07-03')
  })

  it('escapes a pipe in a node label so it does not break the table row', () => {
    const pipeGraph: CodeGraph = {
      nodes: [
        {
          id: 'p::code::pipe',
          projectPath: 'p',
          kind: 'code',
          label: 'a|b.ts',
          relPath: 'a|b.ts',
          meta: null,
          community: 0,
          origin: 'indexer',
        },
      ],
      edges: [],
    }
    const md = mapIndexMarkdown('atlas-os', pipeGraph, new Date('2026-07-03T00:00:00Z'))
    const row = md.split('\n').find((l) => l.startsWith('| 0 |'))
    // the label's pipe must be escaped so a markdown renderer sees it as part
    // of the cell content, not as an unescaped extra column separator.
    expect(row).toContain('a\\|b.ts')
  })
})

describe('exportMap', () => {
  it('copies kept artifacts and writes index.md under the store', () => {
    process.env.ATLAS_MAPS_STORE = join('/tmp', `maps-test-${process.pid}`)
    rmSync(process.env.ATLAS_MAPS_STORE, { recursive: true, force: true })
    const src = join('/tmp', `gout-${process.pid}`)
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'graph.json'), '{}')
    writeFileSync(join(src, '.graphify_ast.json'), '{}')
    const dir = exportMap('/x/atlas-os', src, graph)
    expect(existsSync(join(dir, 'graphify-out', 'graph.json'))).toBe(true)
    expect(existsSync(join(dir, 'graphify-out', '.graphify_ast.json'))).toBe(false)
    expect(readFileSync(join(dir, 'index.md'), 'utf8')).toContain('# Map Index — atlas-os')
    rmSync(process.env.ATLAS_MAPS_STORE, { recursive: true, force: true })
    rmSync(src, { recursive: true, force: true })
  })

  it('clears stale artifacts from a prior build before copying the new ones', () => {
    process.env.ATLAS_MAPS_STORE = join('/tmp', `maps-test-stale-${process.pid}`)
    rmSync(process.env.ATLAS_MAPS_STORE, { recursive: true, force: true })
    const src = join('/tmp', `gout-stale-${process.pid}`)
    mkdirSync(src, { recursive: true })
    // no graph.json this time — simulates a build where the semantic pass failed
    writeFileSync(join(src, 'GRAPH_REPORT.md'), 'report')

    // pre-create a stale artifact from a prior successful build
    const dir = mapsProjectDir('/x/atlas-os')
    mkdirSync(join(dir, 'graphify-out'), { recursive: true })
    writeFileSync(join(dir, 'graphify-out', 'stale.json'), '{}')

    exportMap('/x/atlas-os', src, graph)
    expect(existsSync(join(dir, 'graphify-out', 'stale.json'))).toBe(false)

    rmSync(process.env.ATLAS_MAPS_STORE, { recursive: true, force: true })
    rmSync(src, { recursive: true, force: true })
  })
})
