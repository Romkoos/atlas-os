import type { RoadmapItem } from '@shared/roadmap'
import { beforeEach, describe, expect, it } from 'vitest'
import { useRoadmapSaved } from './roadmapChatRun'

const makeItem = (overrides: Partial<RoadmapItem> = {}): RoadmapItem => ({
  id: 'item-1',
  title: 'Some idea',
  description: 'A description',
  category: 'intelligence',
  status: 'todo',
  priority: 'medium',
  claudePrompt: 'Build the thing',
  position: 0,
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
})

beforeEach(() => {
  useRoadmapSaved.setState({ savedItem: null, savedItems: [] })
})

describe('useRoadmapSaved', () => {
  it('setSaved puts the item in savedItem and prepends it to savedItems', () => {
    const item = makeItem()
    useRoadmapSaved.getState().setSaved(item)
    const s = useRoadmapSaved.getState()
    expect(s.savedItem).toEqual(item)
    expect(s.savedItems).toEqual([item])
  })

  it('setSaved with a different id adds both to savedItems, newest first', () => {
    const first = makeItem({ id: 'item-1' })
    const second = makeItem({ id: 'item-2' })
    useRoadmapSaved.getState().setSaved(first)
    useRoadmapSaved.getState().setSaved(second)
    const s = useRoadmapSaved.getState()
    expect(s.savedItem).toEqual(second)
    expect(s.savedItems.map((x) => x.id)).toEqual(['item-2', 'item-1'])
  })

  it('setSaved with an existing id dedupes (no duplicate; moved to front)', () => {
    const first = makeItem({ id: 'item-1' })
    const second = makeItem({ id: 'item-2' })
    const firstUpdated = makeItem({ id: 'item-1', title: 'Updated title' })
    useRoadmapSaved.getState().setSaved(first)
    useRoadmapSaved.getState().setSaved(second)
    useRoadmapSaved.getState().setSaved(firstUpdated)
    const s = useRoadmapSaved.getState()
    expect(s.savedItem).toEqual(firstUpdated)
    expect(s.savedItems.map((x) => x.id)).toEqual(['item-1', 'item-2'])
    expect(s.savedItems[0]).toEqual(firstUpdated)
  })

  it('clearSaved empties both savedItem and savedItems', () => {
    useRoadmapSaved.getState().setSaved(makeItem())
    useRoadmapSaved.getState().clearSaved()
    const s = useRoadmapSaved.getState()
    expect(s.savedItem).toBeNull()
    expect(s.savedItems).toEqual([])
  })
})
