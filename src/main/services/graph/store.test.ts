import * as schema from '@main/db/schema'
import type { CodeGraph } from '@shared/graph'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { describe, expect, it } from 'vitest'
import { loadGraph, saveGraphifyGraph, saveStructuralGraph } from './store'

function testDb() {
  const sqlite = new Database(':memory:')
  const database = drizzle(sqlite, { schema })
  migrate(database, { migrationsFolder: 'drizzle' })
  return database
}

const P = '/repo'
const structural: CodeGraph = {
  nodes: [
    {
      id: `${P}::code::a.ts`,
      projectPath: P,
      kind: 'code',
      label: 'a.ts',
      relPath: 'a.ts',
      meta: null,
      community: 1,
      origin: 'indexer',
    },
    {
      id: `${P}::code::b.ts`,
      projectPath: P,
      kind: 'code',
      label: 'b.ts',
      relPath: 'b.ts',
      meta: null,
      community: 1,
      origin: 'indexer',
    },
  ],
  edges: [
    {
      id: `${P}::code::a.ts|${P}::code::b.ts|imports`,
      projectPath: P,
      source: `${P}::code::a.ts`,
      target: `${P}::code::b.ts`,
      kind: 'imports',
      inferred: false,
      origin: 'indexer',
      meta: null,
    },
  ],
}

describe('graph store', () => {
  it('saves and loads a project graph', () => {
    const database = testDb()
    saveStructuralGraph(database, P, structural)
    const g = loadGraph(database, P)
    expect(g.nodes).toHaveLength(2)
    expect(g.edges).toHaveLength(1)
    expect(g.edges[0].inferred).toBe(false)
  })

  it('structural rebuild replaces only the indexer layer, keeps graphify edges', () => {
    const database = testDb()
    saveStructuralGraph(database, P, structural)
    saveGraphifyGraph(database, P, {
      nodes: [],
      edges: [
        {
          id: `${P}::code::a.ts|${P}::code::b.ts|semantic`,
          projectPath: P,
          source: `${P}::code::a.ts`,
          target: `${P}::code::b.ts`,
          kind: 'semantic',
          inferred: true,
          origin: 'graphify',
          meta: { audit: 'INFERRED' },
        },
      ],
    })
    saveStructuralGraph(database, P, structural) // rebuild structural
    const g = loadGraph(database, P)
    expect(g.edges.some((e) => e.origin === 'graphify')).toBe(true)
    expect(g.edges.filter((e) => e.origin === 'indexer')).toHaveLength(1)
    expect(g.edges.find((e) => e.origin === 'graphify')?.meta).toEqual({ audit: 'INFERRED' })
  })

  it('scopes cleanup by project', () => {
    const database = testDb()
    saveStructuralGraph(database, P, structural)
    saveStructuralGraph(database, '/other', {
      nodes: [{ ...structural.nodes[0], id: '/other::code::a.ts', projectPath: '/other' }],
      edges: [],
    })
    expect(loadGraph(database, P).nodes).toHaveLength(2)
    expect(loadGraph(database, '__all__').nodes).toHaveLength(3)
  })
})
