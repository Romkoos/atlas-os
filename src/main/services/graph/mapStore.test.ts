import { homedir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { mapsProjectDir, mapsRoot } from './mapStore'

afterEach(() => {
  process.env.ATLAS_MAPS_STORE = undefined
})

describe('mapsRoot', () => {
  it('defaults to ~/atlas-maps', () => {
    process.env.ATLAS_MAPS_STORE = undefined
    expect(mapsRoot()).toBe(join(homedir(), 'atlas-maps'))
  })
  it('honors the ATLAS_MAPS_STORE override', () => {
    process.env.ATLAS_MAPS_STORE = '/tmp/maps-x'
    expect(mapsRoot()).toBe('/tmp/maps-x')
  })
})

describe('mapsProjectDir', () => {
  it('joins basename under the store root', () => {
    process.env.ATLAS_MAPS_STORE = '/tmp/maps-x'
    expect(mapsProjectDir('/Users/me/Projects/atlas-os')).toBe('/tmp/maps-x/atlas-os')
  })
  it('rejects a path whose basename escapes or hits the engine dir', () => {
    process.env.ATLAS_MAPS_STORE = '/tmp/maps-x'
    expect(() => mapsProjectDir('/Users/me/..')).toThrow()
    expect(() => mapsProjectDir('/Users/me/_engine')).toThrow()
  })
})
