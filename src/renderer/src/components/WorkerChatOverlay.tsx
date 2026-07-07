import { AutonomousBanner } from '@renderer/components/AutonomousBanner'
import { ChatComposer } from '@renderer/components/chat/ChatComposer'
import { ChatModelSelect } from '@renderer/components/chat/ChatModelSelect'
import { TimelineChatBody } from '@renderer/components/chat/TimelineChatBody'
import { DevBindingBanner } from '@renderer/components/DevBindingBanner'
import { trpc } from '@renderer/lib/trpc'
import { useWorkerChatRun } from '@renderer/store/workerChatRun'
import { useWorkerPrefill } from '@renderer/store/workerPrefill'
import type { ClaudeModelId } from '@shared/models'
import { buildDevBuildPrompt, shouldApproveBuild } from '@shared/roadmap'
import { useEffect, useState } from 'react'

// Body of the worker chat session — a full-access coding agent. Same shape as
// GeneralChatOverlay but with write access framed in the intro.
export function WorkerChatOverlay() {
  const status = useWorkerChatRun((s) => s.status)
  const sessionId = useWorkerChatRun((s) => s.sessionId)
  const transcript = useWorkerChatRun((s) => s.transcript)
  const streaming = useWorkerChatRun((s) => s.streaming)
  const awaitingInput = useWorkerChatRun((s) => s.awaitingInput)
  const startSession = useWorkerChatRun((s) => s.start)
  const pushUserReply = useWorkerChatRun((s) => s.pushUserReply)
  const timelineEvents = useWorkerChatRun((s) => s.timelineEvents)
  const running = useWorkerChatRun((s) => s.running)
  const freshStart = useWorkerChatRun((s) => s.freshStart)
  const autonomous = useWorkerChatRun((s) => s.autonomous)
  const subagents = useWorkerChatRun((s) => s.subagents)

  const reply = trpc.workerChat.reply.useMutation()
  const utils = trpc.useUtils()
  const binding = trpc.roadmap.getDevBinding.useQuery()
  const setBinding = trpc.roadmap.setDevBinding.useMutation({
    onSuccess: () => utils.roadmap.getDevBinding.invalidate(),
  })
  const updateItem = trpc.roadmap.update.useMutation({
    onSuccess: () => utils.roadmap.list.invalidate(),
  })
  const [draft, setDraft] = useState('')
  // null → the global default model (resolved in ChatModelSelect / on the server).
  const [model, setModel] = useState<ClaudeModelId | null>(null)
  // Autonomous mode for the session about to be started. Off by default; captured
  // at start() and immutable thereafter (mirrors `model`).
  const [autonomousDraft, setAutonomousDraft] = useState(false)

  // One-shot hand-off from callers like the Roadmap "start development" button:
  // seed the intro composer with the idea's prompt + preselected model, then
  // consume it. Runs only while the intro is shown (status === 'idle').
  const pending = useWorkerPrefill((s) => s.pending)
  const clearPrefill = useWorkerPrefill((s) => s.clearPrefill)
  useEffect(() => {
    if (!pending || status !== 'idle') return
    if (pending.autoStart) {
      startSession(pending.prompt, pending.model)
    } else {
      setDraft(pending.prompt)
      setModel(pending.model)
    }
    clearPrefill()
  }, [pending, status, startSession, clearPrefill])

  const started = status !== 'idle'
  const startWorker = () => draft.trim() && startSession(draft.trim(), model, autonomousDraft)

  const send = (text: string) => {
    if (!sessionId || !awaitingInput) return
    const b = binding.data ?? null
    if (shouldApproveBuild(b, text)) {
      // Approve → build: flip status + phase, then send the build prompt (not
      // the literal chip label). Guard on b for the type-narrowing.
      if (b) {
        updateItem.mutate({ id: b.itemId, status: 'in-progress' })
        setBinding.mutate({ itemId: b.itemId, phase: 'building' })
      }
      const buildPrompt = buildDevBuildPrompt()
      pushUserReply(buildPrompt)
      reply.mutate({ sessionId, text: buildPrompt })
      return
    }
    pushUserReply(text)
    reply.mutate({ sessionId, text })
  }

  if (!started) {
    return (
      <div className="rm-chat-intro">
        <span className="rm-field-label">New worker</span>
        <textarea
          className="input"
          rows={5}
          value={draft}
          placeholder="Describe the change to make…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              startWorker()
            }
          }}
          // biome-ignore lint/a11y/noAutofocus: focus the message field when a new worker opens
          autoFocus
        />
        <div className="rm-chat-hint">The worker can read and modify this repo. ⌘↵ to start.</div>
        <ChatModelSelect value={model} onChange={setModel} />
        <label className="autonomous-toggle">
          <input
            type="checkbox"
            checked={autonomousDraft}
            onChange={(e) => setAutonomousDraft(e.target.checked)}
          />
          <span className="autonomous-toggle-label">Autonomous mode</span>
          <span className="autonomous-toggle-hint">
            Finish end-to-end — commit, push, merge & deploy without asking.
          </span>
        </label>
        <div className="rm-chat-intro-foot">
          <button
            type="button"
            className="btn primary"
            onClick={startWorker}
            disabled={!draft.trim()}
          >
            start worker
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="chat-body-flex">
      <AutonomousBanner autonomous={autonomous} />
      <DevBindingBanner />
      <TimelineChatBody
        sessionId={sessionId}
        transcript={transcript}
        streaming={streaming}
        awaitingInput={awaitingInput}
        timelineEvents={timelineEvents}
        running={running}
        freshStart={freshStart}
        onPickOption={send}
        subagents={subagents}
      />
      <ChatComposer
        disabled={!awaitingInput}
        placeholder={awaitingInput ? 'Reply…' : 'Worker is working…'}
        onSend={send}
      />
    </div>
  )
}
