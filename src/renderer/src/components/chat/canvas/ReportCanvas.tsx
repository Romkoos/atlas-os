import { ImproverReportView } from '@renderer/components/ImproverReportView'
import { useSkillImproverExtra } from '@renderer/store/skillImproverRun'

// The improver's A/B report for the target skill, once produced. Reuses the
// existing native renderer (already used by SkillImproverOverlay) rather than
// re-deriving field-by-field markup or a raw JSON dump.
export function ReportCanvas() {
  const report = useSkillImproverExtra((s) => s.report)
  if (!report) return <div className="canvas-empty">No report yet.</div>
  return (
    <div className="canvas-list">
      <ImproverReportView report={report} />
    </div>
  )
}
