import NumberFlow, { type Format } from '@number-flow/react'

/** Animated numeric readout (digits roll on data change). Tabular figures
 * come from the CSS token layer; reduced-motion handled by NumberFlow. */
export function Ticker({
  value,
  format,
  className,
}: {
  value: number
  format?: Format
  className?: string
}) {
  return <NumberFlow value={value} format={format} className={className} />
}
