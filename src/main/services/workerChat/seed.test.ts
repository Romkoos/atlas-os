import { describe, expect, it } from 'vitest'
import { buildWorkerChatSeed } from './seed'

describe('buildWorkerChatSeed', () => {
  it('frames the worker and includes the user message', () => {
    const seed = buildWorkerChatSeed('add a button')
    expect(seed).toContain('atlas-os')
    expect(seed).toContain('full read/write access')
    expect(seed).toContain('add a button')
  })

  it('omits the autonomous directive by default', () => {
    const seed = buildWorkerChatSeed('add a button')
    expect(seed.toLowerCase()).not.toContain('autonomous')
    expect(seed).not.toContain('ditto')
  })

  it('omits the autonomous directive when autonomous is false', () => {
    const seed = buildWorkerChatSeed('add a button', { autonomous: false })
    expect(seed.toLowerCase()).not.toContain('autonomous')
  })

  describe('autonomous mode', () => {
    const seed = buildWorkerChatSeed('ship the feature', { autonomous: true })

    it('still includes the base framing and the user message', () => {
      expect(seed).toContain('full read/write access')
      expect(seed).toContain('ship the feature')
    })

    it('authorizes end-to-end completion without confirmation', () => {
      expect(seed.toLowerCase()).toContain('autonomous')
      expect(seed.toLowerCase()).toContain('without')
      // Overrides the default ask-before-push/merge/deploy convention.
      expect(seed.toLowerCase()).toMatch(/without (pausing|asking|stopping)/)
    })

    it('embeds the verbatim deploy sequence', () => {
      expect(seed).toContain('squash')
      expect(seed).toContain('PR')
      expect(seed).toContain('merge')
      expect(seed).toContain('main')
      expect(seed).toContain('pnpm dist')
      expect(seed).toContain('ditto')
      expect(seed).toContain('/Applications/Atlas OS.app')
      expect(seed).toContain('relaunch')
    })

    it('cites the knowledge-store deploy protocol article as source of truth', () => {
      expect(seed).toContain('no-push-user-pushes')
    })
  })
})
