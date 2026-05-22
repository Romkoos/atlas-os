import { trpc } from '@renderer/lib/trpc'
import type { Theme } from '@shared/settings'
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react'

type ResolvedTheme = 'light' | 'dark'

const ThemeContext = createContext<ResolvedTheme>('light')

export function useResolvedTheme(): ResolvedTheme {
  return useContext(ThemeContext)
}

function systemTheme(): ResolvedTheme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { data } = trpc.settings.get.useQuery()
  const theme: Theme = data?.theme ?? 'system'
  const [resolved, setResolved] = useState<ResolvedTheme>(() => systemTheme())

  useEffect(() => {
    const apply = () => {
      const next = theme === 'system' ? systemTheme() : theme
      setResolved(next)
      document.documentElement.classList.toggle('dark', next === 'dark')
    }
    apply()

    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      mq.addEventListener('change', apply)
      return () => mq.removeEventListener('change', apply)
    }
  }, [theme])

  return <ThemeContext.Provider value={resolved}>{children}</ThemeContext.Provider>
}
