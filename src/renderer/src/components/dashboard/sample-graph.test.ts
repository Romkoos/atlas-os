import { describe, expect, it } from 'vitest'
import { sampleGraph } from './sample-graph'

describe('sampleGraph', () => {
  it('returns the graph untouched when under the cap, with true totals', () => {
    const nodes = [{ id: 'a' }, { id: 'b' }]
    const edges = [{ source: 'a', target: 'b' }]
    const g = sampleGraph(nodes, edges, 10)
    expect(g.nodes).toHaveLength(2)
    expect(g.links).toHaveLength(1)
    expect(g.totalNodes).toBe(2)
    expect(g.totalEdges).toBe(1)
  })

  it('drops edges whose endpoints were not both kept', () => {
    const nodes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    const edges = [
      { source: 'a', target: 'b' },
      { source: 'a', target: 'x' }, // dangling — x is not a node
    ]
    const g = sampleGraph(nodes, edges, 10)
    expect(g.links).toEqual([{ source: 'a', target: 'b' }])
  })

  it('caps to maxNodes, keeping the highest-degree nodes', () => {
    // hub connects to b,c,d; e is isolated. cap=3 → keep hub + two neighbors.
    const nodes = [{ id: 'hub' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }]
    const edges = [
      { source: 'hub', target: 'b' },
      { source: 'hub', target: 'c' },
      { source: 'hub', target: 'd' },
    ]
    const g = sampleGraph(nodes, edges, 3)
    expect(g.nodes).toHaveLength(3)
    expect(g.nodes.map((n) => n.id)).toContain('hub')
    expect(g.nodes.map((n) => n.id)).not.toContain('e')
    // Totals still report the full graph.
    expect(g.totalNodes).toBe(5)
    expect(g.totalEdges).toBe(3)
  })

  it('is deterministic on degree ties (breaks by id)', () => {
    const nodes = [{ id: 'z' }, { id: 'y' }, { id: 'x' }]
    const edges: Array<{ source: string; target: string }> = []
    const g = sampleGraph(nodes, edges, 2)
    // All degree 0 → id ascending → x, y kept.
    expect(g.nodes.map((n) => n.id)).toEqual(['x', 'y'])
  })
})
