import { trpc } from '@renderer/lib/trpc'
import { type Section, useUiStore } from '@renderer/store/ui'
import type { SignalView } from '@shared/signals'

// Open a signal: mark it read, then either navigate to its in-app section or
// reveal its recorded path in Finder. Shared by the dashboard feed and the
// Signals page so both behave identically. Invalidates the history query so the
// page's read state refreshes (the live list is a subscription, auto-updated).
export function useOpenSignal(): (sig: SignalView) => void {
  const go = useUiStore((s) => s.setSection)
  const utils = trpc.useUtils()
  const markRead = trpc.signals.markRead.useMutation({
    onSuccess: () => utils.signals.history.invalidate(),
  })
  const reveal = trpc.signals.revealPath.useMutation()

  return (sig: SignalView) => {
    if (sig.readAt === null) markRead.mutate({ id: sig.id })
    if (sig.linkKind === 'path' && sig.link) reveal.mutate({ id: sig.id })
    else if (sig.linkKind === 'section' && sig.link) go(sig.link as Section)
  }
}
