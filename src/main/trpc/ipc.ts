import { appRouter } from '@main/trpc/router'
import { callTRPCProcedure, getErrorShape, getTRPCErrorFromUnknown } from '@trpc/server'
import type { Unsubscribable } from '@trpc/server/observable'
import { ipcMain } from 'electron'

// Minimal tRPC-over-IPC transport for tRPC v11 (electron-trpc 0.7 is tRPC v10 only).
// Renderer ipcLink sends operations on this channel; we resolve them against the
// router and reply on the same channel keyed by the operation id. Electron IPC uses
// structured clone, so inputs/outputs (incl. Date) survive without a transformer.
const CHANNEL = 'atlas-trpc'

type OpType = 'query' | 'mutation' | 'subscription'

interface IncomingMessage {
  id: number
  kind: 'op' | 'stop'
  op?: { type: OpType; path: string; input: unknown }
}

interface SubscriptionObservable {
  subscribe(observer: {
    next: (value: unknown) => void
    error: (err: unknown) => void
    complete: () => void
  }): Unsubscribable
}

export function registerTrpcIpc(): void {
  const subscriptions = new Map<string, Unsubscribable>()

  ipcMain.on(CHANNEL, (event, message: IncomingMessage) => {
    const sender = event.sender
    const key = `${sender.id}:${message.id}`

    if (message.kind === 'stop') {
      subscriptions.get(key)?.unsubscribe()
      subscriptions.delete(key)
      return
    }

    if (message.op) {
      void handleOperation(sender, message.id, message.op, subscriptions, key)
    }
  })
}

async function handleOperation(
  sender: Electron.WebContents,
  id: number,
  op: { type: OpType; path: string; input: unknown },
  subscriptions: Map<string, Unsubscribable>,
  key: string,
): Promise<void> {
  const send = (payload: unknown) => {
    if (!sender.isDestroyed()) sender.send(CHANNEL, payload)
  }

  const errorShape = (cause: unknown) =>
    getErrorShape({
      config: appRouter._def._config,
      error: getTRPCErrorFromUnknown(cause),
      type: op.type,
      path: op.path,
      input: op.input,
      ctx: {},
    })

  try {
    const result = await callTRPCProcedure({
      router: appRouter,
      ctx: {},
      path: op.path,
      type: op.type,
      getRawInput: async () => op.input,
      signal: undefined,
      batchIndex: 0,
    })

    if (op.type === 'subscription') {
      const sub = (result as SubscriptionObservable).subscribe({
        next: (data) => send({ id, ok: true, kind: 'data', data }),
        error: (err) => {
          send({ id, ok: false, error: errorShape(err) })
          subscriptions.delete(key)
        },
        complete: () => {
          send({ id, ok: true, kind: 'stopped' })
          subscriptions.delete(key)
        },
      })
      subscriptions.set(key, sub)
      sender.once('destroyed', () => {
        sub.unsubscribe()
        subscriptions.delete(key)
      })
    } else {
      send({ id, ok: true, kind: 'data', data: result })
    }
  } catch (cause) {
    send({ id, ok: false, error: errorShape(cause) })
  }
}
