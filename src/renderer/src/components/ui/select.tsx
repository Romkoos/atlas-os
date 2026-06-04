import * as SelectPrimitive from '@radix-ui/react-select'
import { cn } from '@renderer/lib/utils'
import type * as React from 'react'

function Select(props: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />
}

function SelectValue(props: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />
}

function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn('tsel-trigger', className)}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <span className="tsel-chev" aria-hidden="true">
          ▾
        </span>
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  position = 'popper',
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        className={cn('tsel-content', className)}
        position={position}
        sideOffset={sideOffset}
        {...props}
      >
        <SelectPrimitive.Viewport className="tsel-viewport">{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      className={cn('tsel-label', className)}
      {...props}
    />
  )
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item data-slot="select-item" className={cn('tsel-item', className)} {...props}>
      <span className="tsel-item-indicator" aria-hidden="true">
        <SelectPrimitive.ItemIndicator>▸</SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

export type TermSelectOption = {
  value: string
  label: React.ReactNode
  disabled?: boolean
}

/**
 * Terminal-styled select with a fully themed dropdown list (Radix under the
 * hood, so the option list is real DOM we control — unlike a native <select>).
 * Extra props are forwarded to the trigger (id, style, aria-label, …).
 */
export function TermSelect({
  value,
  onValueChange,
  options,
  placeholder,
  disabled,
  contentClassName,
  ...triggerProps
}: {
  value: string
  onValueChange: (value: string) => void
  options: TermSelectOption[]
  placeholder?: string
  disabled?: boolean
  contentClassName?: string
} & Omit<React.ComponentProps<typeof SelectTrigger>, 'value' | 'onChange' | 'children'>) {
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger {...triggerProps}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className={contentClassName}>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export { Select, SelectContent, SelectItem, SelectLabel, SelectTrigger, SelectValue }
