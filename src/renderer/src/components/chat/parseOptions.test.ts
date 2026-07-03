import { describe, expect, it } from 'vitest'
import { parseOptions } from './parseOptions'

describe('parseOptions', () => {
  it('returns the text unchanged with no options when there is no block', () => {
    expect(parseOptions('just a normal answer')).toEqual({
      display: 'just a normal answer',
      options: [],
    })
  })

  it('extracts options and strips the block from the display text', () => {
    const text = 'Which approach?\n\n```options\nRewrite in place\nNew module\nSkip\n```'
    expect(parseOptions(text)).toEqual({
      display: 'Which approach?',
      options: ['Rewrite in place', 'New module', 'Skip'],
    })
  })

  it('ignores blank lines and trims each option', () => {
    const text = 'Pick:\n```options\n  A  \n\n  B\n```'
    expect(parseOptions(text)).toEqual({ display: 'Pick:', options: ['A', 'B'] })
  })

  it('treats a block with no lines as no options', () => {
    expect(parseOptions('Hi\n```options\n```')).toEqual({ display: 'Hi', options: [] })
  })
})
