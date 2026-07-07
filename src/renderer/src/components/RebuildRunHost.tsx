import { trpc } from '@renderer/lib/trpc'
import { useRebuildRun } from '@renderer/store/rebuildRun'
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'

// Always-mounted host for the "Rebuild & Update" run. Owns the single persistent
// rebuild.stream subscription (living above the page switch so navigating away
// never drops the build) and renders the streaming-log modal when open.
export function RebuildRunHost() {
  const open = useRebuildRun((s) => s.open)
  const state = useRebuildRun((s) => s.state)
  const log = useRebuildRun((s) => s.log)
  const setOpen = useRebuildRun((s) => s.setOpen)
  const applyEvent = useRebuildRun((s) => s.applyEvent)

  const confirmSwap = trpc.rebuild.confirmSwap.useMutation({
    onError: (e) => toast.error(e.message),
  })
  const cancel = trpc.rebuild.cancel.useMutation({
    onError: (e) => toast.error(e.message),
  })

  trpc.rebuild.stream.useSubscription(undefined, {
    onData: (event) => applyEvent(event),
    onError: (e) => toast.error(e.message),
  })

  // Reattach: if a run is already active on mount (e.g. modal was closed while a
  // build kept going), surface the modal so the user can get back to it.
  const status = trpc.rebuild.status.useQuery(undefined, { refetchOnWindowFocus: false })
  const reattachedRef = useRef(false)
  useEffect(() => {
    if (reattachedRef.current || !status.data) return
    reattachedRef.current = true
    if (status.data.state !== 'idle') setOpen(true)
  }, [status.data, setOpen])

  // Auto-scroll the log to the bottom as lines stream in.
  const logRef = useRef<HTMLPreElement>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on new output
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [log])

  if (!open) return null

  const running = state === 'running'
  const awaiting = state === 'awaiting-confirm'
  const swapping = state === 'swapping'
  const errored = state === 'error'

  const title = running
    ? 'REBUILDING…'
    : awaiting
      ? 'BUILD READY'
      : swapping
        ? 'RELAUNCHING…'
        : errored
          ? 'REBUILD FAILED'
          : 'REBUILD & UPDATE'

  // Closing only hides the modal; a running build keeps going in the background.
  const closable = !swapping

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Rebuild and update"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 400,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(2px)',
      }}
      className="no-drag"
    >
      <div
        className="panel"
        style={{
          width: 'min(820px, 92vw)',
          maxHeight: '82vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
        }}
      >
        <div className="panel-head">
          <span className="ttl">{title}</span>
          <span className="meta">build → swap → relaunch</span>
        </div>

        <pre
          ref={logRef}
          style={{
            flex: 1,
            overflow: 'auto',
            margin: 0,
            padding: '12px 16px',
            fontFamily: 'var(--mono)',
            fontSize: 12,
            lineHeight: 1.5,
            color: 'var(--fg-2)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            background: 'var(--bg-2)',
          }}
        >
          {log.length === 0 ? 'Starting…' : log.join('\n')}
        </pre>

        <div
          style={{
            display: 'flex',
            gap: 10,
            padding: '12px 16px',
            borderTop: '1px solid var(--line-dim)',
            alignItems: 'center',
          }}
        >
          {awaiting ? (
            <>
              <span
                style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--fg-2)', flex: 1 }}
              >
                Build succeeded — replace the installed app & relaunch now?
              </span>
              <button
                type="button"
                className="btn primary"
                disabled={confirmSwap.isPending}
                onClick={() => confirmSwap.mutate()}
              >
                [ REPLACE & RELAUNCH ]
              </button>
              <button type="button" className="btn" onClick={() => setOpen(false)}>
                LATER
              </button>
            </>
          ) : running ? (
            <>
              <span
                style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--fg-4)', flex: 1 }}
              >
                Building from prod branch — this takes a few minutes.
              </span>
              <button
                type="button"
                className="btn"
                disabled={cancel.isPending}
                onClick={() => cancel.mutate()}
              >
                CANCEL BUILD
              </button>
              <button type="button" className="btn" onClick={() => setOpen(false)}>
                HIDE
              </button>
            </>
          ) : swapping ? (
            <span
              style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--amber)', flex: 1 }}
            >
              Swapping the app bundle and relaunching…
            </span>
          ) : (
            <>
              <span
                style={{
                  fontFamily: 'var(--mono)',
                  fontSize: 12,
                  color: errored ? 'var(--warn)' : 'var(--fg-4)',
                  flex: 1,
                }}
              >
                {errored ? 'The rebuild did not complete. See the log above.' : 'Done.'}
              </span>
              {closable ? (
                <button type="button" className="btn" onClick={() => setOpen(false)}>
                  CLOSE
                </button>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
