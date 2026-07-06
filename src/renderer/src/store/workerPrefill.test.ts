import { beforeEach, describe, expect, it } from 'vitest'
import { useWorkerPrefill } from './workerPrefill'

beforeEach(() => {
  useWorkerPrefill.setState({ pending: null })
})

describe('useWorkerPrefill', () => {
  it('starts empty', () => {
    expect(useWorkerPrefill.getState().pending).toBeNull()
  })

  it('setPrefill stores the pending prompt + model', () => {
    useWorkerPrefill.getState().setPrefill({ prompt: 'ship it', model: 'claude-opus-4-8' })
    expect(useWorkerPrefill.getState().pending).toEqual({
      prompt: 'ship it',
      model: 'claude-opus-4-8',
    })
  })

  it('clearPrefill resets pending to null', () => {
    useWorkerPrefill.getState().setPrefill({ prompt: 'ship it', model: null })
    useWorkerPrefill.getState().clearPrefill()
    expect(useWorkerPrefill.getState().pending).toBeNull()
  })
})
