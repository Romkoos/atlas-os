import type { RoadmapItem, RoadmapStatus } from '@shared/roadmap'
import { describe, expect, it } from 'vitest'
import { filterByCategory, groupByStatus, hideDoneFilter, sortColumnItems } from './board-utils'

function item(over: Partial<RoadmapItem>): RoadmapItem {
  return {
    id: 'id',
    title: 't',
    description: '',
    category: 'wow',
    status: 'todo',
    priority: 'medium',
    claudePrompt: '',
    position: 0,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }
}

describe('hideDoneFilter', () => {
  it('drops done items only when hideDone is true', () => {
    const items = [item({ id: 'a', status: 'done' }), item({ id: 'b', status: 'todo' })]
    expect(hideDoneFilter(items, true).map((i) => i.id)).toEqual(['b'])
    expect(hideDoneFilter(items, false).map((i) => i.id)).toEqual(['a', 'b'])
  })
})

describe('filterByCategory', () => {
  it("returns all items for 'all'", () => {
    const items = [item({ category: 'wow' }), item({ category: 'macos' })]
    expect(filterByCategory(items, 'all')).toHaveLength(2)
  })
  it('filters to a single category', () => {
    const items = [item({ id: 'a', category: 'wow' }), item({ id: 'b', category: 'macos' })]
    expect(filterByCategory(items, 'macos').map((i) => i.id)).toEqual(['b'])
  })
})

describe('sortColumnItems', () => {
  it('orders by priority High→Low then most-recently-updated', () => {
    const items = [
      item({ id: 'lowNew', priority: 'low', updatedAt: 100 }),
      item({ id: 'highOld', priority: 'high', updatedAt: 1 }),
      item({ id: 'highNew', priority: 'high', updatedAt: 50 }),
      item({ id: 'medMid', priority: 'medium', updatedAt: 10 }),
    ]
    expect(sortColumnItems(items).map((i) => i.id)).toEqual([
      'highNew',
      'highOld',
      'medMid',
      'lowNew',
    ])
  })
  it('does not mutate its input', () => {
    const items = [item({ id: 'a', priority: 'low' }), item({ id: 'b', priority: 'high' })]
    const before = items.map((i) => i.id)
    sortColumnItems(items)
    expect(items.map((i) => i.id)).toEqual(before)
  })
})

describe('groupByStatus', () => {
  it('buckets items into all four status keys', () => {
    const grouped = groupByStatus([item({ status: 'todo' }), item({ status: 'done' })])
    expect(grouped.todo).toHaveLength(1)
    expect(grouped.done).toHaveLength(1)
    expect(grouped.planned).toEqual([])
    expect(grouped['in-progress']).toEqual([])
  })

  it('silently drops items with an unknown status instead of throwing', () => {
    const items = [
      item({ id: 'a', status: 'todo' }),
      item({ id: 'bogus', status: 'bogus' as RoadmapStatus }),
    ]
    expect(() => groupByStatus(items)).not.toThrow()
    const grouped = groupByStatus(items)
    expect(grouped.todo.map((i) => i.id)).toEqual(['a'])
    expect(
      Object.values(grouped)
        .flat()
        .map((i) => i.id),
    ).toEqual(['a'])
  })
})
