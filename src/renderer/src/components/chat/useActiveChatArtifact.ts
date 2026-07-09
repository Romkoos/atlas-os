import { trpc } from '@renderer/lib/trpc'
import type { ChatSessionType } from '@renderer/store/chats'
import { useGeneralChatRun } from '@renderer/store/generalChatRun'
import { useRoadmapChatRun } from '@renderer/store/roadmapChatRun'
import { useSkillImproverRun } from '@renderer/store/skillImproverRun'
import { useWorkerChatRun } from '@renderer/store/workerChatRun'
import { useCallback } from 'react'
import { deriveArtifact } from './deriveArtifact'

// One chat type's run store hook (all four share BaseChatRunState).
type ChatRunHook = typeof useRoadmapChatRun
// Minimal shape of a `<type>.reply` tRPC mutation — we only ever call .mutate.
type ReplyMutation = { mutate: (input: { sessionId: string; text: string }) => void }

export interface ActiveChatArtifact {
  started: boolean
  streaming: string
  awaitingInput: boolean
  display: string
  options: string[]
  onPick: (text: string) => void
}

// Derives one type's artifact slice + a pick handler. A custom hook so it can be
// called unconditionally, once per chat type, keeping hook order stable.
function useOneArtifact(useStore: ChatRunHook, reply: ReplyMutation): ActiveChatArtifact {
  const status = useStore((s) => s.status)
  const sessionId = useStore((s) => s.sessionId)
  const transcript = useStore((s) => s.transcript)
  const streaming = useStore((s) => s.streaming)
  const awaitingInput = useStore((s) => s.awaitingInput)
  const pushUserReply = useStore((s) => s.pushUserReply)

  const { display, options } = deriveArtifact({ transcript, streaming, awaitingInput })

  // Mirrors each overlay's local `send`: only replies while a session is
  // awaiting input; optimistically pushes the user turn, then fires the mutation.
  const onPick = useCallback(
    (text: string) => {
      if (!sessionId || !awaitingInput) return
      pushUserReply(text)
      reply.mutate({ sessionId, text })
    },
    [sessionId, awaitingInput, pushUserReply, reply],
  )

  return { started: status !== 'idle', streaming, awaitingInput, display, options, onPick }
}

// Canvas-facing adapter: exposes the active chat type's pending options + a pick
// handler without threading props through Chats.tsx. Subscribes to all four run
// stores and instantiates all four reply mutations unconditionally (the same
// pattern Chats.tsx uses for its four cancel mutations), then selects by type.
export function useActiveChatArtifact(type: ChatSessionType): ActiveChatArtifact {
  const roadmapReply = trpc.roadmapChat.reply.useMutation()
  const skillReply = trpc.skillImprover.reply.useMutation()
  const generalReply = trpc.generalChat.reply.useMutation()
  const workerReply = trpc.workerChat.reply.useMutation()

  const byType: Record<ChatSessionType, ActiveChatArtifact> = {
    roadmap: useOneArtifact(useRoadmapChatRun, roadmapReply),
    skillImprover: useOneArtifact(useSkillImproverRun, skillReply),
    generalChat: useOneArtifact(useGeneralChatRun, generalReply),
    worker: useOneArtifact(useWorkerChatRun, workerReply),
  }
  return byType[type]
}
