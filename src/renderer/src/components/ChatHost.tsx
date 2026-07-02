import type { BaseChatRunState } from '@renderer/store/createChatRunStore'
import { skipToken } from '@tanstack/react-query'
import { useEffect, useMemo, useRef } from 'react'
import { toast } from 'sonner'
import type { StoreApi, UseBoundStore } from 'zustand'

interface OpenInput {
  sessionId: string
  lastSeq: number
  kickoff?: string
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
    if (s.sessionId && (s.status === 'running' || s.status === 'awaiting') && !s.running) {
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
    return { sessionId, lastSeq: s.lastSeq, kickoff: isFreshStart ? kickoff : undefined }
  }, [running, sessionId, kickoff, useRun])

  useOpenSubscription(subInput, {
    onData: ({ seq, event }) => {
      const store = useRun.getState()
      store.bumpSeq(seq)
      const e = event as { type: string; text?: string; summary?: string; message?: string }
      switch (e.type) {
        case 'token':
          store.appendToken(e.text ?? '')
          break
        case 'tool':
          store.pushTool(e.summary ?? '')
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
