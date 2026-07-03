import { IDEA_SENTINEL_END, IDEA_SENTINEL_START, type RoadmapItem } from '@shared/roadmap'
import { describe, expect, it } from 'vitest'
import { buildRoadmapChatSeed } from './seed'

const existing: RoadmapItem[] = [
  {
    id: '1',
    title: 'Menu-bar mini-HUD',
    description: 'tray widget',
    category: 'macos',
    status: 'todo',
    priority: 'medium',
    claudePrompt: 'brief',
    position: 0,
    createdAt: 0,
    updatedAt: 0,
  },
]

describe('buildRoadmapChatSeed', () => {
  it('embeds the raw idea and the hand-off sentinels', () => {
    const seed = buildRoadmapChatSeed('a voice control panel', existing)
    expect(seed).toContain('a voice control panel')
    expect(seed).toContain(IDEA_SENTINEL_START)
    expect(seed).toContain(IDEA_SENTINEL_END)
  })

  it('states the English-only rule for the final card', () => {
    const seed = buildRoadmapChatSeed('idea', existing)
    expect(seed).toMatch(/ENGLISH/)
    expect(seed.toLowerCase()).toContain('same language')
  })

  it('lists categories and existing items to avoid duplicates', () => {
    const seed = buildRoadmapChatSeed('idea', existing)
    expect(seed).toContain('"macos"')
    expect(seed).toContain('Menu-bar mini-HUD')
  })

  it('handles an empty roadmap', () => {
    const seed = buildRoadmapChatSeed('idea', [])
    expect(seed).toContain('(none yet)')
  })
})
