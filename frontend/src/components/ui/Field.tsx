import type {
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from 'react'

import { cn } from '../../lib/cn'

const fieldClass =
  'w-full rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm text-ink placeholder:text-muted/70 shadow-soft transition-colors duration-150 hover:border-muted/45 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15 disabled:cursor-not-allowed disabled:bg-subtle disabled:text-muted'

type FieldProps = {
  label: string
  htmlFor: string
  hint?: string
  error?: string
  children: ReactNode
  optional?: boolean
  className?: string
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  optional = false,
  className,
}: FieldProps) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={htmlFor} className="text-xs font-medium text-ink">
          {label}
        </label>
        {optional && <span className="text-[11px] text-muted">Optional</span>}
      </div>
      {children}
      {error ? (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[11px] leading-relaxed text-muted">{hint}</p>
      ) : null}
    </div>
  )
}

export function TextInput({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(fieldClass, className)} {...props} />
}

export function Textarea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(fieldClass, 'resize-none', className)} {...props} />
}
