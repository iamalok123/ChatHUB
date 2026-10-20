import type { ButtonHTMLAttributes, ReactNode } from 'react'

import { cn } from '../../lib/cn'

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string
  children: ReactNode
  active?: boolean
  variant?: 'plain' | 'surface'
}

export function IconButton({
  label,
  children,
  active = false,
  variant = 'plain',
  className,
  type = 'button',
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'grid size-8 shrink-0 place-items-center rounded-lg transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'surface'
          ? 'border border-border bg-surface text-muted shadow-soft hover:bg-hover hover:text-ink'
          : 'text-muted hover:bg-hover hover:text-ink',
        active && 'bg-accent-soft text-accent-strong',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}
