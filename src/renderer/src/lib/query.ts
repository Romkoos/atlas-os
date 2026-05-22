import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => console.error('[query error]', (error as Error).message),
  }),
  mutationCache: new MutationCache({
    onError: (error) => console.error('[mutation error]', (error as Error).message),
  }),
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 5_000 },
  },
})
