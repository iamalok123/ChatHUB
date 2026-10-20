import type { ButtonHTMLAttributes, ReactNode } from 'react'

import { cn } from '../../lib/cn'
import { Spinner } from './Spinner'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'soft' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  leadingIcon?: ReactNode
  trailingIcon?: ReactNode
}

const variants = {
  primary:
    'bg-accent text-white shadow-soft hover:bg-accent-strong disabled:hover:bg-accent',
  secondary:
    'border border-border bg-surface text-ink shadow-soft hover:bg-hover disabled:hover:bg-surface',
  ghost: 'text-muted hover:bg-hover hover:text-ink',
  soft: 'bg-accent-soft text-accent-strong hover:brightness-[0.97]',
  danger: 'bg-danger text-white hover:brightness-95',
}

const sizes = {
  sm: 'h-8 gap-1.5 rounded-lg px-2.5 text-xs',
  md: 'h-10 gap-2 rounded-xl px-4 text-sm',
  lg: 'h-11 gap-2 rounded-xl px-5 text-sm',
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  leadingIcon,
  trailingIcon,
  className,
  children,
  disabled,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-55',
        variants[variant],
        sizes[size],
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Spinner /> : leadingIcon}
      {children}
      {!loading && trailingIcon}
    </button>
  )
}
