import { PageHeader } from '@renderer/components/layout/PageHeader'
import { CodeGraphTab } from '@renderer/pages/knowledge/CodeGraphTab'
import { useUiStore } from '@renderer/store/ui'

// Atlas Maps — the in-app viewer for the graphify code/knowledge graph. Hosts
// CodeGraphTab (its own project picker + source filters); this page is just the
// nav-mounted shell. Backend lives in trpc.graph.* / services/graph/*.
export function Maps() {
  const selectedProject = useUiStore((s) => s.selectedProject)
  return (
    <>
      <PageHeader num="04" title="MAPS" />
      <div className="kb-page">
        <CodeGraphTab project={selectedProject ?? ''} />
      </div>
    </>
  )
}
