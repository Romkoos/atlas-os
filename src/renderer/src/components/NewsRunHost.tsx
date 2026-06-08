import { trpc } from '@renderer/lib/trpc'
import { useNewsRun } from '@renderer/store/newsRun'
import { skipToken } from '@tanstack/react-query'
import { useMemo } from 'react'
import { toast } from 'sonner'

// Always-mounted host for the news-digest subscription. Living above the page
// switch in App means leaving the NEWS tab no longer unsubscribes → the run
// keeps going on the main side and tokens keep filling the store. Renders
// nothing.
export function NewsRunHost() {
  const utils = trpc.useUtils()
  const running = useNewsRun((s) => s.running)
  const requestId = useNewsRun((s) => s.requestId)
  const appendToken = useNewsRun((s) => s.appendToken)
  const finish = useNewsRun((s) => s.finish)

  const subInput = useMemo(
    () => (running && requestId ? { requestId } : skipToken),
    [running, requestId],
  )

  trpc.news.run.useSubscription(subInput, {
    onData: (event) => {
      switch (event.type) {
        case 'token':
          appendToken(event.text)
          break
        case 'done':
          finish()
          void utils.news.read.invalidate()
          toast.success('News updated')
          break
        case 'error':
          finish()
          toast.error(event.message)
          break
        case 'aborted':
          finish()
          toast('News collection cancelled')
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
