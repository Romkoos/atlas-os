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
        section: 'productivity',
        selectedProject: 'atlas-os',
        tabsBySection: { productivity: 'sessions' },
      },
      base,
    )
    expect(out.selectedProject).toBe('atlas-os')
    expect(out.tabsBySection).toEqual({ productivity: 'sessions' })
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
    expect(SECTIONS).not.toContain('benchmark' as never) // sanity: benchmark is a tab, not a section
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
