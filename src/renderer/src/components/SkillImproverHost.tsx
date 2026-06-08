import { trpc } from '@renderer/lib/trpc'
import { useSkillImproverRun } from '@renderer/store/skillImproverRun'
import { skipToken } from '@tanstack/react-query'
import { useMemo } from 'react'
import { toast } from 'sonner'

// Always-mounted host for the skill-improver subscription. Living above the page
// switch in App means leaving the SKILLS tab does not unsubscribe → the session
// keeps going. Renders nothing. The model is resolved server-side (settings), so
// the subscription input only needs the run identity.
export function SkillImproverHost() {
  const utils = trpc.useUtils()
  const running = useSkillImproverRun((s) => s.running)
  const requestId = useSkillImproverRun((s) => s.requestId)
  const skillId = useSkillImproverRun((s) => s.skillId)
  const appendToken = useSkillImproverRun((s) => s.appendToken)
  const flushTurn = useSkillImproverRun((s) => s.flushTurn)
  const pushTool = useSkillImproverRun((s) => s.pushTool)
  const setAwaiting = useSkillImproverRun((s) => s.setAwaiting)
  const setReport = useSkillImproverRun((s) => s.setReport)
  const finish = useSkillImproverRun((s) => s.finish)

  const subInput = useMemo(
    () => (running && requestId && skillId ? { requestId, skillId } : skipToken),
    [running, requestId, skillId],
  )

  trpc.skillImprover.start.useSubscription(subInput, {
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
        case 'report':
          flushTurn()
          setReport(event.report)
          break
        case 'done':
          finish('done')
          void utils.skills.list.invalidate()
          void utils.stats.invalidate()
          if (skillId) void utils.skills.getRaw.invalidate({ id: skillId })
          toast.success('Skill improvement applied')
          break
        case 'error':
          finish('error')
          toast.error(event.message)
          break
        case 'aborted':
          finish('aborted')
          void utils.stats.invalidate()
          if (skillId) void utils.skills.getRaw.invalidate({ id: skillId })
          toast('Skill improvement reverted')
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
