import { trpc } from '@renderer/lib/trpc'
import { useGeneralChatRun } from '@renderer/store/generalChatRun'
import { skipToken } from '@tanstack/react-query'
import { useMemo } from 'react'
import { toast } from 'sonner'

// Always-mounted host for the general-chat subscription. Living above the page
// switch means leaving a tab does not unsubscribe → the session keeps going.
export function GeneralChatHost() {
  const running = useGeneralChatRun((s) => s.running)
  const requestId = useGeneralChatRun((s) => s.requestId)
  const message = useGeneralChatRun((s) => s.message)
  const appendToken = useGeneralChatRun((s) => s.appendToken)
  const flushTurn = useGeneralChatRun((s) => s.flushTurn)
  const pushTool = useGeneralChatRun((s) => s.pushTool)
  const setAwaiting = useGeneralChatRun((s) => s.setAwaiting)
  const finish = useGeneralChatRun((s) => s.finish)

  const subInput = useMemo(
    () => (running && requestId && message ? { requestId, message } : skipToken),
    [running, requestId, message],
  )

  trpc.generalChat.start.useSubscription(subInput, {
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
