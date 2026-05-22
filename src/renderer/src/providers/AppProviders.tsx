import { queryClient } from '@renderer/lib/query'
import { trpc } from '@renderer/lib/trpc'
import { QueryClientProvider } from '@tanstack/react-query'
import { ipcLink } from 'electron-trpc/renderer'
import { type ReactNode, useState } from 'react'

export function AppProviders({ children }: { children: ReactNode }) {
  const [client] = useState(() => trpc.createClient({ links: [ipcLink()] }))

  return (
    <trpc.Provider client={client} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  )
}
