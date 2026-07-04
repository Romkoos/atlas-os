import type { RoadmapItem } from '@shared/roadmap'
import { describe, expect, it } from 'vitest'
import { groupNextUp } from './next-up'

let seq = 0
function item(over: Partial<RoadmapItem>): RoadmapItem {
  seq += 1
  return {
    id: `id-${seq}`,
    title: `Item ${seq}`,
    description: '',
    category: 'wow',
    status: 'todo',
    priority: 'medium',
    claudePrompt: '',
    position: seq,
    createdAt: 1000 + seq,
    updatedAt: 1000 + seq,
    ...over,
  }
}

describe('groupNextUp', () => {
  it('splits items into inProgress / nextUp / done', () => {
    const items = [
      item({ status: 'in-progress', title: 'wip' }),
      item({ status: 'planned', title: 'plan' }),
      item({ status: 'todo', title: 'todo' }),
      item({ status: 'done', title: 'shipped' }),
    ]
    const g = groupNextUp(items)
    expect(g.inProgress.map((i) => i.title)).toEqual(['wip'])
    expect(g.nextUp.map((i) => i.title)).toEqual(['plan', 'todo'])
    expect(g.done.map((i) => i.title)).toEqual(['shipped'])
  })

  it('nextUp puts planned before todo, then sorts by priority (high first)', () => {
    const g = groupNextUp([
      item({ status: 'todo', priority: 'high', title: 'todo-high' }),
      item({ status: 'planned', priority: 'low', title: 'plan-low' }),
      item({ status: 'planned', priority: 'high', title: 'plan-high' }),
    ])
    expect(g.nextUp.map((i) => i.title)).toEqual(['plan-high', 'plan-low', 'todo-high'])
  })

  it('caps groups (3 in progress, 4 next up, 3 done) and sorts wip/done by recency', () => {
    const wip = [1, 2, 3, 4].map((n) =>
      item({ status: 'in-progress', updatedAt: n, title: `w${n}` }),
    )
    const next = [1, 2, 3, 4, 5].map((n) => item({ status: 'todo', title: `n${n}` }))
    const done = [1, 2, 3, 4].map((n) => item({ status: 'done', updatedAt: n, title: `d${n}` }))
    const g = groupNextUp([...wip, ...next, ...done])
    expect(g.inProgress.map((i) => i.title)).toEqual(['w4', 'w3', 'w2'])
    expect(g.nextUp).toHaveLength(4)
    expect(g.done.map((i) => i.title)).toEqual(['d4', 'd3', 'd2'])
  })

  it('ties inside one status+priority fall back to board position', () => {
    const g = groupNextUp([
      item({ status: 'planned', priority: 'high', position: 2, title: 'second' }),
      item({ status: 'planned', priority: 'high', position: 1, title: 'first' }),
    ])
    expect(g.nextUp.map((i) => i.title)).toEqual(['first', 'second'])
  })
})
