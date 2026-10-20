import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'

import { cn } from '../../lib/cn'
import { useUiStore } from '../../store/ui'
import { IconButton } from './IconButton'

const icons = {
  info: Info,
  success: CheckCircle2,
  error: AlertCircle,
}

const accents = {
  info: 'text-accent',
  success: 'text-success',
  error: 'text-danger',
}

export function Toaster() {
  const toasts = useUiStore((state) => state.toasts)
  const dismiss = useUiStore((state) => state.dismissToast)

  return (
    <div
      className="pointer-events-none fixed right-4 bottom-4 z-[200] flex w-[min(92vw,360px)] flex-col gap-2"
      aria-live="polite"
      aria-atomic="false"
    >
      {toasts.map((toast) => {
        const Icon = icons[toast.kind]
        return (
          <div
            key={toast.id}
            role={toast.kind === 'error' ? 'alert' : 'status'}
            className="pointer-events-auto flex animate-toast-in items-start gap-3 rounded-xl border border-border bg-surface p-3.5 shadow-float"
          >
            <Icon size={18} className={cn('mt-0.5 shrink-0', accents[toast.kind])} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink">{toast.title}</p>
              {toast.description && (
                <p className="mt-0.5 text-xs leading-relaxed text-muted">{toast.description}</p>
              )}
            </div>
            <IconButton label="Dismiss notification" onClick={() => dismiss(toast.id)}>
              <X size={15} aria-hidden />
            </IconButton>
          </div>
        )
      })}
    </div>
  )
}
