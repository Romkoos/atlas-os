import { useRoadmapSaved } from '@renderer/store/roadmapChatRun'

// Ideas the incubator committed this session, newest first. Empty until the
// chat saves its first card.
export function IdeasCanvas() {
  const items = useRoadmapSaved((s) => s.savedItems)
  if (items.length === 0) {
    return <div className="canvas-empty">No ideas saved yet — they'll appear here.</div>
  }
  return (
    <div className="canvas-list">
      {items.map((it) => (
        <div key={it.id} className="idea-card">
          <div className="idea-title">{it.title}</div>
          {it.description ? <div className="idea-desc">{it.description}</div> : null}
          <div className="idea-status">{it.status}</div>
        </div>
      ))}
    </div>
  )
}
