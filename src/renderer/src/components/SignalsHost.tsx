import { trpc } from '@renderer/lib/trpc'
import { useSignalsStore } from '@renderer/store/signals'
import { useRef } from 'react'
import { toast } from 'sonner'

// The app's single signals.list subscription. Mirrors every snapshot into the
// signals store (read by the dashboard feed + sidebar badge) and pops a sonner
// toast for each newly-arrived unread warning/error. Renders nothing.
export function SignalsHost() {
  const setSnapshot = useSignalsStore((s) => s.setSnapshot)
  // null until the first snapshot, so we seed the seen-set from the backlog
  // WITHOUT toasting historical signals on app start.
  const seenRef = useRef<Set<number> | null>(null)

  trpc.signals.list.useSubscription(undefined, {
    onData: (snap) => {
      if (seenRef.current === null) {
        seenRef.current = new Set(snap.signals.map((s) => s.id))
      } else {
        for (const sig of snap.signals) {
          if (seenRef.current.has(sig.id)) continue
          seenRef.current.add(sig.id)
          if (sig.readAt === null && (sig.severity === 'warning' || sig.severity === 'error')) {
            const fire = sig.severity === 'error' ? toast.error : toast.warning
            fire(sig.title, { description: sig.detail ?? undefined })
          }
        }
      }
      setSnapshot(snap)
    },
  })

  return null
}
