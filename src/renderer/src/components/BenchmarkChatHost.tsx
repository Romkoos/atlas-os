import { trpc } from '@renderer/lib/trpc'
import { useBenchmarkChatRun } from '@renderer/store/benchmarkChatRun'
import { skipToken } from '@tanstack/react-query'
import { useMemo } from 'react'
import { toast } from 'sonner'

// Always-mounted host for the benchmark-discussion subscription. Living above
// the page switch means leaving the Productivity tab does not unsubscribe → the
// session keeps going. Renders nothing.
export function BenchmarkChatHost() {
  const running = useBenchmarkChatRun((s) => s.running)
  const requestId = useBenchmarkChatRun((s) => s.requestId)
  const batchId = useBenchmarkChatRun((s) => s.batchId)
  const appendToken = useBenchmarkChatRun((s) => s.appendToken)
  const flushTurn = useBenchmarkChatRun((s) => s.flushTurn)
  const pushTool = useBenchmarkChatRun((s) => s.pushTool)
  const setAwaiting = useBenchmarkChatRun((s) => s.setAwaiting)
  const finish = useBenchmarkChatRun((s) => s.finish)

  const subInput = useMemo(
    () => (running && requestId && batchId ? { requestId, batchId } : skipToken),
    [running, requestId, batchId],
  )

  trpc.benchmarkChat.start.useSubscription(subInput, {
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
