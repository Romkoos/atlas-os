import { type ChatSessionType, useChats } from '@renderer/store/chats'
import { useMemo } from 'react'
import { EmptyCanvas } from './canvas/EmptyCanvas'
import { tabsForType } from './canvasTabs'

// Right-pane surface for the active chat. One tab strip; the tab set comes from
// the chat type. The selected tab is remembered per type in the chats store.
export function Canvas({ type }: { type: ChatSessionType }) {
  const tabs = useMemo(() => tabsForType(type), [type])
  const remembered = useChats((s) => s.canvasTabByType[type])
  const setCanvasTab = useChats((s) => s.setCanvasTab)

  if (tabs.length === 0) return <EmptyCanvas />

  const activeKey = tabs.some((t) => t.key === remembered) ? remembered : tabs[0].key
  const active = tabs.find((t) => t.key === activeKey) ?? tabs[0]
  const View = active.View

  return (
    <div className="canvas">
      <div className="canvas-tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={t.key === active.key}
            className={`canvas-tab${t.key === active.key ? ' on' : ''}`}
            onClick={() => setCanvasTab(type, t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="canvas-body">
        <View />
      </div>
    </div>
  )
}
