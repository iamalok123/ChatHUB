import { GitBranch } from 'lucide-react'

import { cn } from '../../lib/cn'

export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'grid size-9 shrink-0 place-items-center rounded-xl bg-accent text-white shadow-soft',
        className,
      )}
      aria-hidden
    >
      <GitBranch size={19} strokeWidth={2.2} />
    </span>
  )
}

export function Brand({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <BrandMark />
      <span className="text-[17px] font-semibold tracking-[-0.02em] text-ink">
        ChatHUB
      </span>
    </span>
  )
}
