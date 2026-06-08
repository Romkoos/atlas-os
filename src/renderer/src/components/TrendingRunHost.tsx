import { trpc } from '@renderer/lib/trpc'
import { useTrendingRun } from '@renderer/store/trendingRun'
import { skipToken } from '@tanstack/react-query'
import { useMemo } from 'react'
import { toast } from 'sonner'

// Always-mounted host for the github-trending subscription. Living above the page
// switch in App means leaving the NEWS tab no longer unsubscribes → the run keeps
// going on the main side and tokens keep filling the store. Renders nothing.
export function TrendingRunHost() {
  const utils = trpc.useUtils()
  const running = useTrendingRun((s) => s.running)
  const requestId = useTrendingRun((s) => s.requestId)
  const appendToken = useTrendingRun((s) => s.appendToken)
  const finish = useTrendingRun((s) => s.finish)

  const subInput = useMemo(
    () => (running && requestId ? { requestId } : skipToken),
    [running, requestId],
  )

  trpc.trending.run.useSubscription(subInput, {
    onData: (event) => {
      switch (event.type) {
        case 'token':
          appendToken(event.text)
          break
        case 'done':
          finish()
          void utils.trending.read.invalidate()
          toast.success('GitHub trends updated')
          break
        case 'error':
          finish()
          toast.error(event.message)
          break
        case 'aborted':
          finish()
          toast('Trends collection cancelled')
          break
      }
    },
    onError: (error) => {
      finish()
      toast.error(error.message)
    },
  })

  return null
}
