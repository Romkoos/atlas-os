import type { CSSProperties } from 'react'
import { Toaster as Sonner, type ToasterProps } from 'sonner'

function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="system"
      className="toaster group"
      style={
        {
          '--normal-bg': 'var(--panel)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--line)',
        } as CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: 'font-mono! rounded-none! shadow-[0_8px_32px_oklch(0_0_0/0.36)]!',
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
