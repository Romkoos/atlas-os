import { trpc } from '@renderer/lib/trpc'
import { useRoadmapChatRun } from '@renderer/store/roadmapChatRun'
import { skipToken } from '@tanstack/react-query'
import { useMemo } from 'react'
import { toast } from 'sonner'

// Always-mounted host for the roadmap brainstorming subscription. Living above
// the page switch means leaving the Roadmap tab does not unsubscribe → the
// session keeps going. Renders nothing.
export function RoadmapChatHost() {
  const utils = trpc.useUtils()
  const running = useRoadmapChatRun((s) => s.running)
  const requestId = useRoadmapChatRun((s) => s.requestId)
  const idea = useRoadmapChatRun((s) => s.idea)
  const appendToken = useRoadmapChatRun((s) => s.appendToken)
  const flushTurn = useRoadmapChatRun((s) => s.flushTurn)
  const pushTool = useRoadmapChatRun((s) => s.pushTool)
  const setAwaiting = useRoadmapChatRun((s) => s.setAwaiting)
  const setSaved = useRoadmapChatRun((s) => s.setSaved)
  const finish = useRoadmapChatRun((s) => s.finish)

  const subInput = useMemo(
    () => (running && requestId && idea ? { requestId, idea } : skipToken),
    [running, requestId, idea],
  )

  trpc.roadmapChat.start.useSubscription(subInput, {
    onData: (event) => {
      switch (event.type) {
        case 'token':
          appendToken(event.text)
          break
        case 'tool':
          pushTool(event.summary)
          break
        case 'awaiting-input':
          flushTurn()
          setAwaiting(true)
          break
        case 'saved':
          setSaved(event.item)
          utils.roadmap.list.invalidate()
          toast.success(`Idea saved to ${event.item.category}: ${event.item.title}`)
          break
        case 'done':
          flushTurn()
          finish('done')
          break
        case 'error':
          finish('error')
          toast.error(event.message)
          break
        case 'aborted':
          finish('aborted')
          break
      }
    },
    onError: (error) => {
      finish('error')
      toast.error(error.message)
    },
  })

  return null
}
