import { Check, Pin, PinOff } from 'lucide-react'

import type { Memory } from '../../api/types'
import { cn } from '../../lib/cn'

type MemoryChoiceProps = {
  memory: Memory
  checked: boolean
  pinned?: boolean
  onToggle: () => void
  onPin?: () => void
  duplicate?: boolean
}

export function MemoryChoice({
  memory,
  checked,
  pinned = false,
  onToggle,
  onPin,
  duplicate = false,
}: MemoryChoiceProps) {
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-xl border p-3 transition-colors',
        checked
          ? 'border-accent/35 bg-accent-soft/35'
          : 'border-border bg-surface hover:bg-subtle/45',
      )}
    >
      <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="peer sr-only"
        />
        <span
          className={cn(
            'mt-0.5 grid size-4 shrink-0 place-items-center rounded border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-accent/30',
            checked
              ? 'border-accent bg-accent text-white'
              : 'border-muted/40 bg-surface text-transparent',
          )}
          aria-hidden
        >
          <Check size={11} strokeWidth={3} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-md bg-surface px-1.5 py-0.5 text-[8px] font-semibold tracking-wide text-accent-ink uppercase">
              {memory.kind}
            </span>
            {duplicate && (
              <span className="rounded-md bg-warning-soft px-1.5 py-0.5 text-[8px] font-medium text-warning">
                near duplicate
              </span>
            )}
            {memory.inherited && (
              <span className="text-[9px] text-muted">
                from {memory.origin_branch_name}
              </span>
            )}
          </span>
          <span className="mt-1.5 block text-[11px] leading-relaxed text-ink">
            {memory.content}
          </span>
          <span className="mt-1 block text-[9px] text-muted">
            {Math.round(memory.importance * 100)}% importance
          </span>
        </span>
      </label>
      {onPin && (
        <button
          type="button"
          onClick={onPin}
          aria-label={pinned ? `Unpin memory: ${memory.content}` : `Pin memory: ${memory.content}`}
          title={pinned ? 'Unpin' : 'Pin'}
          className={cn(
            'grid size-7 shrink-0 place-items-center rounded-md transition-colors',
            pinned
              ? 'bg-accent text-white'
              : 'text-muted hover:bg-surface hover:text-ink',
          )}
        >
          {pinned ? <Pin size={12} aria-hidden /> : <PinOff size={12} aria-hidden />}
        </button>
      )}
    </div>
  )
}
