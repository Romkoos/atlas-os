import { NAV } from '@renderer/components/layout/nav'
import { describe, expect, it } from 'vitest'
import { mergePersistedUi, SECTIONS, useUiStore } from './ui'

const base = useUiStore.getState()

describe('mergePersistedUi', () => {
  it('keeps a valid persisted section', () => {
    const out = mergePersistedUi({ section: 'knowledge' }, base)
    expect(out.section).toBe('knowledge')
  })

  it('falls back to dashboard for an unknown section', () => {
    const out = mergePersistedUi({ section: 'bogus' }, base)
    expect(out.section).toBe('dashboard')
  })

  it('falls back to dashboard when section is missing', () => {
    const out = mergePersistedUi({}, base)
    expect(out.section).toBe('dashboard')
  })

  it('preserves selectedProject and tabsBySection when present', () => {
    const out = mergePersistedUi(
      {
        section: 'knowledge',
        selectedProject: 'atlas-os',
        tabsBySection: { knowledge: 'graph' },
      },
      base,
    )
    expect(out.selectedProject).toBe('atlas-os')
    expect(out.tabsBySection).toEqual({ knowledge: 'graph' })
  })

  it('defaults selectedProject to null and tabsBySection to {} when absent or malformed', () => {
    const out = mergePersistedUi({ section: 'news', tabsBySection: 'nope' }, base)
    expect(out.selectedProject).toBeNull()
    expect(out.tabsBySection).toEqual({})
  })

  it('keeps action functions from current state (not from persisted blob)', () => {
    const out = mergePersistedUi({ section: 'stats', setSection: 'hacked' }, base)
    expect(typeof out.setSection).toBe('function')
  })

  it('SECTIONS contains the canonical pages', () => {
    expect(SECTIONS).toContain('dashboard')
    expect(SECTIONS).not.toContain('worker' as never) // sanity: worker is a chat type, not a section
  })

  it('defaults roadmapHideDone to false when absent', () => {
    const out = mergePersistedUi({ section: 'roadmap' }, base)
    expect(out.roadmapHideDone).toBe(false)
  })

  it('coerces a non-boolean roadmapHideDone to false', () => {
    const out = mergePersistedUi({ roadmapHideDone: 'yes' }, base)
    expect(out.roadmapHideDone).toBe(false)
  })

  it('preserves a true roadmapHideDone', () => {
    const out = mergePersistedUi({ roadmapHideDone: true }, base)
    expect(out.roadmapHideDone).toBe(true)
  })
})

describe('useUiStore actions', () => {
  it('setTab stores a per-section tab id', () => {
    useUiStore.getState().setTab('knowledge', 'graph')
    expect(useUiStore.getState().tabsBySection.knowledge).toBe('graph')
  })

  it('setSelectedProject updates the global project', () => {
    useUiStore.getState().setSelectedProject('mako3.0')
    expect(useUiStore.getState().selectedProject).toBe('mako3.0')
    useUiStore.getState().setSelectedProject(null)
    expect(useUiStore.getState().selectedProject).toBeNull()
  })
})

describe('graphSources', () => {
  it('defaults to all sources except session', () => {
    expect(useUiStore.getState().graphSources).toEqual([
      'code',
      'doc',
      'knowledge',
      'skill',
      'graphify',
    ])
  })

  it('setGraphSources replaces the enabled set', () => {
    useUiStore.getState().setGraphSources(['code', 'graphify'])
    expect(useUiStore.getState().graphSources).toEqual(['code', 'graphify'])
  })

  it('mergePersistedUi keeps a valid persisted array and defaults a bad one', () => {
    const cur = useUiStore.getState()
    expect(mergePersistedUi({ graphSources: ['doc'] }, cur).graphSources).toEqual(['doc'])
    expect(mergePersistedUi({ graphSources: 'nope' }, cur).graphSources).toEqual([
      'code',
      'doc',
      'knowledge',
      'skill',
      'graphify',
    ])
  })
})

describe('chats section', () => {
  it('is a known section', () => {
    expect(SECTIONS).toContain('chats')
  })
  it('has a nav item right after roadmap', () => {
    const ids = NAV.map((n) => n.id)
    expect(ids).toContain('chats')
    expect(ids.indexOf('chats')).toBe(ids.indexOf('roadmap') + 1)
  })
  it('keeps NAV keys as 1-based sequential [NN]', () => {
    NAV.forEach((n, i) => {
      expect(n.key).toBe(String(i + 1).padStart(2, '0'))
    })
  })
})
