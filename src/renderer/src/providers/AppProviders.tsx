import { ipcLink } from '@renderer/lib/ipc-link'
import { queryClient } from '@renderer/lib/query'
import { trpc } from '@renderer/lib/trpc'
import { ThemeProvider } from '@renderer/providers/ThemeProvider'
import { QueryClientProvider } from '@tanstack/react-query'
import { type ReactNode, useState } from 'react'

export function AppProviders({ children }: { children: ReactNode }) {
  const [client] = useState(() => trpc.createClient({ links: [ipcLink()] }))

  return (
    <trpc.Provider client={client} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>{children}</ThemeProvider>
      </QueryClientProvider>
    </trpc.Provider>
  )
}
