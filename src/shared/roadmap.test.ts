import { describe, expect, it } from 'vitest'
import {
  IDEA_SENTINEL_END,
  IDEA_SENTINEL_START,
  parseRoadmapProposal,
  type RoadmapCreate,
  roadmapUpdateSchema,
} from './roadmap'

function wrap(json: string): string {
  return `Here you go!\n${IDEA_SENTINEL_START}\n${json}\n${IDEA_SENTINEL_END}\nSaved ✓`
}

const VALID = {
  title: 'Menu-bar HUD',
  description: 'A tray widget.',
  category: 'macos',
  priority: 'high',
  claudePrompt: 'Add an Electron Tray popover.',
}

describe('parseRoadmapProposal', () => {
  it('returns null when no sentinel block is present', () => {
    expect(parseRoadmapProposal('just chatting, no block yet')).toBeNull()
  })

  it('returns null when only the opening sentinel has streamed (incomplete)', () => {
    expect(parseRoadmapProposal(`${IDEA_SENTINEL_START}\n{ "title": "x"`)).toBeNull()
  })

  it('extracts and validates a well-formed block', () => {
    const parsed = parseRoadmapProposal(wrap(JSON.stringify(VALID)))
    expect(parsed).toMatchObject(VALID as Partial<RoadmapCreate>)
  })

  it('tolerates a ```json fence inside the block', () => {
    const fenced = `${IDEA_SENTINEL_START}\n\`\`\`json\n${JSON.stringify(VALID)}\n\`\`\`\n${IDEA_SENTINEL_END}`
    expect(parseRoadmapProposal(fenced)).toMatchObject(VALID as Partial<RoadmapCreate>)
  })

  it('applies defaults for optional fields', () => {
    const minimal = { title: 'X', category: 'wow' }
    const parsed = parseRoadmapProposal(wrap(JSON.stringify(minimal)))
    expect(parsed).toMatchObject({
      title: 'X',
      category: 'wow',
      status: 'idea',
      priority: 'medium',
      description: '',
      claudePrompt: '',
    })
  })

  it('rejects an invalid category', () => {
    const bad = { ...VALID, category: 'nonsense' }
    expect(parseRoadmapProposal(wrap(JSON.stringify(bad)))).toBeNull()
  })

  it('rejects a missing required title', () => {
    const bad = { category: 'macos' }
    expect(parseRoadmapProposal(wrap(JSON.stringify(bad)))).toBeNull()
  })

  it('rejects malformed JSON', () => {
    expect(parseRoadmapProposal(wrap('{ title: not json }'))).toBeNull()
  })
})

describe('roadmapUpdateSchema', () => {
  it('a status-only update carries ONLY id + status (no default-filled fields)', () => {
    // Regression: partial() over the create schema leaked '' / 'medium' defaults,
    // which then overwrote description/priority/claudePrompt on a status change.
    const parsed = roadmapUpdateSchema.parse({ id: 'x', status: 'planned' })
    expect(parsed).toEqual({ id: 'x', status: 'planned' })
    expect(parsed).not.toHaveProperty('description')
    expect(parsed).not.toHaveProperty('priority')
    expect(parsed).not.toHaveProperty('claudePrompt')
  })

  it('passes through only the fields provided', () => {
    const parsed = roadmapUpdateSchema.parse({ id: 'x', priority: 'high' })
    expect(parsed).toEqual({ id: 'x', priority: 'high' })
  })

  it('requires id', () => {
    expect(() => roadmapUpdateSchema.parse({ status: 'done' })).toThrow()
  })
})
