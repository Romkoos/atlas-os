import { ChatTranscript } from '@renderer/components/chat/ChatTranscript'
import { SessionTimelineView } from '@renderer/components/chat/SessionTimelineView'
import type { ChatEntry, SubagentRun } from '@renderer/store/createChatRunStore'
import type { TimelineEvent } from '@shared/timeline'
import { useState } from 'react'

// Drop-in replacement for <ChatTranscript> inside a drawer chat body: adds a
// per-chat "Transcript ⇄ Timeline" toggle. Toggle state is in-memory (resets on
// restart) — intentional, matches the design.
export function TimelineChatBody({
  sessionId,
  transcript,
  streaming,
  awaitingInput,
  timelineEvents,
  running,
  freshStart,
  onPickOption,
  subagents,
}: {
  sessionId: string | null
  transcript: ChatEntry[]
  streaming: string
  awaitingInput: boolean
  timelineEvents: TimelineEvent[]
  running: boolean
  freshStart: boolean
  onPickOption: (text: string) => void
  subagents?: Record<string, SubagentRun>
}) {
  const [view, setView] = useState<'transcript' | 'timeline'>('transcript')
  return (
    <div className="chat-view-wrap">
      <div className="chat-view-toggle" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={view === 'transcript'}
          className={view === 'transcript' ? 'active' : ''}
          onClick={() => setView('transcript')}
        >
          Transcript
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'timeline'}
          className={view === 'timeline' ? 'active' : ''}
          onClick={() => setView('timeline')}
        >
          Timeline
        </button>
      </div>
      {view === 'transcript' ? (
        <ChatTranscript
          transcript={transcript}
          streaming={streaming}
          awaitingInput={awaitingInput}
          onPickOption={onPickOption}
          subagents={subagents}
        />
      ) : (
        <SessionTimelineView
          sessionId={sessionId ?? ''}
          timelineEvents={timelineEvents}
          running={running}
          freshStart={freshStart}
        />
      )}
    </div>
  )
}
