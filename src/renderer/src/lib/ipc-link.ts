import type { AppRouter } from '@main/trpc/router'
import { TRPCClientError, type TRPCLink } from '@trpc/client'
import { observable } from '@trpc/server/observable'

// Custom tRPC v11 link over the preload IPC bridge (window.atlasTrpc). Mirrors what
// electron-trpc's ipcLink did, but for the v11 client API. No transformer — Electron
// IPC structured clone carries inputs/outputs (incl. Date) directly.
interface ReplyMessage {
  id: number
  ok: boolean
  kind?: 'data' | 'stopped'
  data?: unknown
  error?: unknown
}

let counter = 0

export function ipcLink(): TRPCLink<AppRouter> {
  return () =>
    ({ op }) =>
      observable((observer) => {
        const id = ++counter

        const unsubscribe = window.atlasTrpc.subscribe((raw) => {
          const msg = raw as ReplyMessage
          if (msg.id !== id) return

          if (!msg.ok) {
            observer.error(TRPCClientError.from({ error: msg.error } as never))
            return
          }
          if (msg.kind === 'stopped') {
            observer.complete()
            return
          }
          observer.next({ result: { type: 'data', data: msg.data } } as never)
          if (op.type !== 'subscription') observer.complete()
        })

        window.atlasTrpc.send({
          id,
          kind: 'op',
          op: { type: op.type, path: op.path, input: op.input },
        })

        return () => {
          if (op.type === 'subscription') window.atlasTrpc.send({ id, kind: 'stop' })
          unsubscribe()
        }
      })
}
