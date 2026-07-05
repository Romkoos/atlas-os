import type { BaseChatRunState } from '@renderer/store/createChatRunStore'
import { skipToken } from '@tanstack/react-query'
import { useEffect, useMemo, useRef } from 'react'
import { toast } from 'sonner'
import type { StoreApi, UseBoundStore } from 'zustand'

interface OpenInput {
  sessionId: string
  lastSeq: number
  kickoff?: string
  continueWork?: boolean
}

interface OpenHandlers {
  onData: (env: { seq: number; event: unknown }) => void
  onError: (e: { message: string }) => void
}

export interface ChatHostProps {
  useRun: UseBoundStore<StoreApi<BaseChatRunState>>
  // A tRPC subscription hook, e.g. trpc.generalChat.open.useSubscription.
  useOpenSubscription: (input: OpenInput | typeof skipToken, opts: OpenHandlers) => unknown
  // Kickoff for a brand-new session; the store's start() already seeded the transcript.
  kickoff?: string
  onEvent?: (event: unknown, store: BaseChatRunState) => void
}

// Always-mounted host for one chat type's subscription. Living above the page
// switch means leaving a tab does not unsubscribe. On mount it reattaches a
// persisted running/awaiting session; each envelope advances lastSeq so a later
// reattach replays only the gap.
export function ChatHost({ useRun, useOpenSubscription, kickoff, onEvent }: ChatHostProps) {
  const running = useRun((s) => s.running)
  const sessionId = useRun((s) => s.sessionId)

  // Reattach-on-mount: a persisted running/awaiting session re-subscribes.
  const reattachedRef = useRef(false)
  useEffect(() => {
    if (reattachedRef.current) return
    reattachedRef.current = true
    const s = useRun.getState()
    if (
      s.sessionId &&
      (s.status === 'running' ||
        s.status === 'awaiting' ||
        s.status === 'reconnecting' ||
        s.status === 'limited') &&
      !s.running
    ) {
      s.reattach()
    }
  }, [useRun])

  // The subscription input must be STABLE for the life of a session — lastSeq
  // increments on every token, so read it (and kickoff-eligibility) from a store
  // snapshot at (re)subscribe time rather than tracking them reactively.
  // Recomputes only when the session identity or running state changes.
  const subInput = useMemo<OpenInput | typeof skipToken>(() => {
    if (!running || !sessionId) return skipToken
    const s = useRun.getState()
    // kickoff is only sent while the transcript is fresh (new session, seq 0).
    const isFreshStart = s.status === 'running' && s.lastSeq === 0
    // A reattach whose last persisted status was mid-work should auto-continue.
    const continueWork = !isFreshStart && s.status !== 'awaiting'
    return {
      sessionId,
      lastSeq: s.lastSeq,
      kickoff: isFreshStart ? kickoff : undefined,
      continueWork,
    }
  }, [running, sessionId, kickoff, useRun])

  useOpenSubscription(subInput, {
    onData: ({ seq, event }) => {
      const store = useRun.getState()
      store.bumpSeq(seq)
      const e = event as {
        type: string
        text?: string
        name?: string
        summary?: string
        message?: string
        toolId?: string
        resultText?: string
        isError?: boolean
      }
      switch (e.type) {
        case 'token':
          store.appendToken(e.text ?? '')
          break
        case 'tool':
          store.pushTool(e.toolId ?? '', e.name ?? '', e.summary ?? '')
          break
        case 'tool-result':
          store.resolveTool(e.toolId ?? '', e.resultText ?? '', e.isError === true)
          break
        case 'awaiting-input':
          store.flushTurn()
          store.setAwaiting(true)
          break
        case 'done':
          store.flushTurn()
          store.finish('done')
          break
        case 'error':
          store.finish('error')
          if (e.message) toast.error(e.message)
          break
        case 'aborted':
          store.finish('aborted')
          break
        case 'reconnecting':
          store.setReconnecting()
          break
        case 'rate-limit':
          // Account-level info is cached in main for the gauge; nothing to do
          // in the per-chat store beyond ignoring the informational event.
          break
        case 'limited':
          store.flushTurn()
          store.setLimited((e as { resumesInMs?: number }).resumesInMs)
          break
        case 'resuming':
          store.setResuming()
          break
      }
      onEvent?.(event, useRun.getState())
    },
    onError: (error) => {
      useRun.getState().finish('error')
      toast.error(error.message)
    },
  })

  return null
}
