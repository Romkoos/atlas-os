import { initTRPC } from '@trpc/server'

// No data transformer: electron-trpc sends over Electron IPC, which uses the
// structured-clone algorithm — Date/Map/etc. survive natively.
export type TRPCContext = Record<string, never>

const t = initTRPC.context<TRPCContext>().create()

export const router = t.router
export const publicProcedure = t.procedure
