import type { SignalSeverity } from '@shared/signals'
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react'
import type { ComponentType } from 'react'

type IconType = ComponentType<{ size?: number | string; color?: string; strokeWidth?: number }>

// Severity → icon + CSS-token color for the feed and Signals page. info uses a
// dim neutral; the rest map to the app's status tokens.
export const SEVERITY_META: Record<
  SignalSeverity,
  { icon: IconType; color: string; label: string }
> = {
  info: { icon: Info, color: 'var(--fg-3)', label: 'info' },
  success: { icon: CheckCircle2, color: 'var(--ok)', label: 'success' },
  warning: { icon: AlertTriangle, color: 'var(--amber)', label: 'warning' },
  error: { icon: XCircle, color: 'var(--warn)', label: 'error' },
}
