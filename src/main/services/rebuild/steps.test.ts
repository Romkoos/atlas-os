import { describe, expect, it } from 'vitest'
import {
  capLog,
  isWorkingTreeDirty,
  pickStagedBundle,
  resolveRunningBundle,
  resolveTargetBundle,
  shellQuote,
  splitLines,
  swapScript,
} from './steps'

describe('isWorkingTreeDirty', () => {
  it('is false for an empty/whitespace porcelain output', () => {
    expect(isWorkingTreeDirty('')).toBe(false)
    expect(isWorkingTreeDirty('\n  \n')).toBe(false)
  })

  it('is true when any change is listed', () => {
    expect(isWorkingTreeDirty(' M src/main/index.ts\n')).toBe(true)
    expect(isWorkingTreeDirty('?? untracked.txt')).toBe(true)
  })
})

describe('resolveRunningBundle', () => {
  it('walks up to the enclosing .app', () => {
    expect(resolveRunningBundle('/Applications/Atlas OS.app/Contents/MacOS/Atlas OS')).toBe(
      '/Applications/Atlas OS.app',
    )
  })

  it('returns null outside a bundle (dev electron binary)', () => {
    expect(
      resolveRunningBundle('/repo/node_modules/electron/dist/Electron.app'.replace('.app', '')),
    ).toBeNull()
    expect(resolveRunningBundle('/usr/local/bin/node')).toBeNull()
  })
})

describe('resolveTargetBundle', () => {
  it('uses the running bundle when packaged', () => {
    expect(resolveTargetBundle('/Applications/Atlas OS.app/Contents/MacOS/Atlas OS')).toBe(
      '/Applications/Atlas OS.app',
    )
  })

  it('falls back to /Applications in dev', () => {
    expect(resolveTargetBundle('/repo/node_modules/electron/dist/electron')).toBe(
      '/Applications/Atlas OS.app',
    )
  })
})

describe('pickStagedBundle', () => {
  it('finds the mac-<arch> staging dir', () => {
    expect(pickStagedBundle('/repo/release', ['mac-arm64', 'builder-effective-config.yaml'])).toBe(
      '/repo/release/mac-arm64/Atlas OS.app',
    )
  })

  it('accepts a bare "mac" dir (x64 default)', () => {
    expect(pickStagedBundle('/repo/release', ['mac'])).toBe('/repo/release/mac/Atlas OS.app')
  })

  it('returns null when no mac staging dir exists', () => {
    expect(pickStagedBundle('/repo/release', ['Atlas OS-0.1.1-arm64.dmg'])).toBeNull()
  })
})

describe('shellQuote', () => {
  it('wraps in single quotes and escapes embedded quotes', () => {
    expect(shellQuote('/Applications/Atlas OS.app')).toBe("'/Applications/Atlas OS.app'")
    expect(shellQuote("weird'name")).toBe("'weird'\\''name'")
  })
})

describe('swapScript', () => {
  const script = swapScript({
    oldPid: 4242,
    staged: '/repo/release/mac-arm64/Atlas OS.app',
    target: '/Applications/Atlas OS.app',
  })

  it('waits on the old pid before swapping', () => {
    expect(script).toContain('while kill -0 4242 2>/dev/null; do sleep 0.3; done')
  })

  it('removes the target, dittos the staged bundle in, then reopens — in order', () => {
    const rm = script.indexOf('rm -rf')
    const ditto = script.indexOf('ditto')
    const open = script.indexOf('open ')
    expect(rm).toBeGreaterThan(-1)
    expect(ditto).toBeGreaterThan(rm)
    expect(open).toBeGreaterThan(ditto)
  })

  it('quotes both paths', () => {
    expect(script).toContain("'/repo/release/mac-arm64/Atlas OS.app'")
    expect(script).toContain("'/Applications/Atlas OS.app'")
  })
})

describe('splitLines', () => {
  it('emits whole lines and carries the partial remainder', () => {
    const a = splitLines('', 'one\ntwo\nthr')
    expect(a.lines).toEqual(['one', 'two'])
    expect(a.rest).toBe('thr')
    const b = splitLines(a.rest, 'ee\nfour\n')
    expect(b.lines).toEqual(['three', 'four'])
    expect(b.rest).toBe('')
  })
})

describe('capLog', () => {
  it('keeps the newest N lines', () => {
    expect(capLog(['a', 'b', 'c', 'd'], 2)).toEqual(['c', 'd'])
    expect(capLog(['a', 'b'], 5)).toEqual(['a', 'b'])
  })
})
