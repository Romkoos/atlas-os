import { db } from '@main/db/client'
import { revealInFinder } from '@main/services/files'
import {
  getSignalById,
  getSnapshot,
  historySignals,
  markAllSignalsRead,
  markSignalRead,
  signalRegistry,
} from '@main/services/signals/registry'
import { publicProcedure, router } from '@main/trpc/trpc'
import type { SignalsSnapshot } from '@shared/signals'
import { observable } from '@trpc/server/observable'
import { z } from 'zod'

// Live feed (dashboard SignalsPanel + nav unread badge + toasts). Emits a fresh
// snapshot on subscribe, then on every recordSignal / mark-read change.
const FEED_LIMIT = 50

export const signalsRouter = router({
  list: publicProcedure.subscription(() =>
    observable<SignalsSnapshot>((emit) => {
      const push = () => emit.next(getSnapshot(db(), FEED_LIMIT))
      push()
      return signalRegistry.onChange(push)
    }),
  ),

  // Filtered + paginated full history for the Signals page.
  history: publicProcedure
    .input(
      z.object({
        source: z.string().optional(),
        type: z.string().optional(),
        severity: z.enum(['info', 'success', 'warning', 'error']).optional(),
        search: z.string().optional(),
        limit: z.number().int().min(1).max(500).default(100),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(({ input }) => historySignals(db(), input)),

  markRead: publicProcedure
    .input(z.object({ id: z.number().int() }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(({ input }) => {
      markSignalRead(db(), input.id)
      signalRegistry.emit('change')
      return { ok: true }
    }),

  markAllRead: publicProcedure.output(z.object({ changed: z.number() })).mutation(() => {
    const changed = markAllSignalsRead(db())
    signalRegistry.emit('change')
    return { changed }
  }),

  // Reveal a signal's own recorded path in Finder. Takes an id (never a path) and
  // validates the row is a path-link, so the renderer can't reveal an arbitrary
  // location — same safety contract as jobs.reveal.
  revealPath: publicProcedure
    .input(z.object({ id: z.number().int() }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(({ input }) => {
      const row = getSignalById(db(), input.id)
      if (row?.linkKind === 'path' && row.link) {
        revealInFinder(row.link)
        return { ok: true }
      }
      return { ok: false }
    }),
})
