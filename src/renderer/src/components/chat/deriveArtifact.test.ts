import type { ChatEntry } from '@renderer/store/createChatRunStore'
import { describe, expect, it } from 'vitest'
import { deriveArtifact } from './deriveArtifact'

const assistant = (text: string): ChatEntry => ({ kind: 'assistant', text })
const user = (text: string): ChatEntry => ({ kind: 'user', text })

const withOptions = 'Which approach?\n\n```options\nRewrite in place\nNew module\n```'

describe('deriveArtifact', () => {
  it('returns empty display and no options when there is no assistant entry', () => {
    expect(
      deriveArtifact({ transcript: [user('hi')], streaming: '', awaitingInput: false }),
    ).toEqual({ display: '', options: [] })
  })

  it('surfaces question text and options when awaiting input and not streaming', () => {
    expect(
      deriveArtifact({ transcript: [assistant(withOptions)], streaming: '', awaitingInput: true }),
    ).toEqual({ display: 'Which approach?', options: ['Rewrite in place', 'New module'] })
  })

  it('hides options while streaming, still stripping the block from the display', () => {
    expect(
      deriveArtifact({
        transcript: [assistant(withOptions)],
        streaming: 'partial…',
        awaitingInput: true,
      }),
    ).toEqual({ display: 'Which approach?', options: [] })
  })

  it('hides options when not awaiting input', () => {
    expect(
      deriveArtifact({ transcript: [assistant(withOptions)], streaming: '', awaitingInput: false }),
    ).toEqual({ display: 'Which approach?', options: [] })
  })

  it('returns display with no options for a free-form question', () => {
    expect(
      deriveArtifact({
        transcript: [assistant('Tell me more about your idea.')],
        streaming: '',
        awaitingInput: true,
      }),
    ).toEqual({ display: 'Tell me more about your idea.', options: [] })
  })

  it('uses the last assistant entry, ignoring earlier ones and later tool/user entries', () => {
    const transcript: ChatEntry[] = [
      assistant('first question'),
      user('an answer'),
      assistant(withOptions),
    ]
    expect(deriveArtifact({ transcript, streaming: '', awaitingInput: true })).toEqual({
      display: 'Which approach?',
      options: ['Rewrite in place', 'New module'],
    })
  })
})
