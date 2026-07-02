import { describe, expect, it } from 'vitest'
import { buildGeneralChatSeed } from './seed'

describe('buildGeneralChatSeed', () => {
  it('frames the assistant and includes the user message', () => {
    const seed = buildGeneralChatSeed('what does this repo do?')
    expect(seed).toContain('atlas-os')
    expect(seed).toContain('read-only')
    expect(seed).toContain('what does this repo do?')
  })
})
