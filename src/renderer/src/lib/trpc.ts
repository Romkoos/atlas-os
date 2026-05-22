import type { AppRouter } from '@main/trpc/router'
import { createTRPCReact } from '@trpc/react-query'

// Type-only import of AppRouter — erased at build time, so no main-process code
// (Drizzle, better-sqlite3, …) ever reaches the renderer bundle.
export const trpc = createTRPCReact<AppRouter>()
