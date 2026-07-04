import { trpc } from '@renderer/lib/trpc'
import { useGraphBuildRun } from '@renderer/store/graphBuildRun'
import { skipToken } from '@tanstack/react-query'
import { useMemo } from 'react'
import { toast } from 'sonner'

// Always-mounted host for the dashboard's BUILD MAP run. Living above the page
// switch means leaving the Dashboard no longer unsubscribes → no accidental
// cancel of the main-side graphify run. Renders nothing.
export function GraphBuildRunHost() {
  const utils = trpc.useUtils()
  const running = useGraphBuildRun((s) => s.running)
  const requestId = useGraphBuildRun((s) => s.requestId)
  const projectPath = useGraphBuildRun((s) => s.projectPath)
  const finish = useGraphBuildRun((s) => s.finish)

  const subInput = useMemo(
    () => (running && requestId && projectPath ? { requestId, projectPath } : skipToken),
    [running, requestId, projectPath],
  )

  trpc.graph.build.useSubscription(subInput, {
    onData: (event) => {
      switch (event.type) {
        case 'done':
          finish()
          toast.success(`Map built: +${event.nodesAdded} nodes, +${event.edgesAdded} edges`)
          void utils.graph.getGraph.invalidate()
          void utils.graph.listProjects.invalidate()
          break
        case 'error':
          finish()
          toast.error(event.message)
          break
        case 'aborted':
          finish()
          toast('Map build cancelled')
          break
        default:
          // tool/progress events are intentionally ignored — the Processes
          // strip already shows the live job; the button only needs start/end.
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
