import {
  ArrowUpRight,
  Check,
  ChevronDown,
  Circle,
  LoaderCircle,
  Sparkles,
  TriangleAlert,
} from 'lucide-react'
import { useId, useState } from 'react'

import type { TraceStep, TraceUsage } from '../../api/types'
import { cn } from '../../lib/cn'
import { formatDuration, formatTokens, plural, sentenceCase } from '../../lib/format'

type ReasoningPillProps = {
  thinking: string | null | undefined
  synthetic?: boolean
  mock?: boolean
  durationMs: number
  memoryCount: number
  steps?: TraceStep[]
  usage?: TraceUsage
  streaming?: boolean
  failed?: boolean
  onOpenTrace?: () => void
}

const phaseLabels: Record<string, string> = {
  retrieve: 'Retrieved memories',
  compose: 'Composed context',
  generate: 'Generated answer',
  extract: 'Checked durable memory',
}

function StepIcon({ status }: { status: string }) {
  if (status === 'running') {
    return <LoaderCircle size={11} className="animate-spin text-accent" aria-hidden />
  }
  if (status === 'error' || status === 'failed') {
    return <TriangleAlert size={11} className="text-danger" aria-hidden />
  }
  if (status === 'done' || status === 'complete') {
    return <Check size={11} className="text-success" aria-hidden />
  }
  return <Circle size={7} className="text-muted/60" aria-hidden />
}

export function ReasoningPill({
  thinking,
  synthetic = false,
  mock = false,
  durationMs,
  memoryCount,
  steps = [],
  usage,
  streaming = false,
  failed = false,
  onOpenTrace,
}: ReasoningPillProps) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const totalTokens = usage?.total_token_count
  const hasDetails = Boolean(thinking || steps.length > 0 || onOpenTrace)

  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={panelId}
        disabled={!hasDetails}
        className={cn(
          'inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] transition-colors',
          failed
            ? 'border-danger/20 bg-danger-soft text-danger'
            : 'border-border bg-subtle/70 text-muted hover:border-accent/25 hover:text-ink',
          !hasDetails && 'cursor-default hover:border-border hover:text-muted',
        )}
      >
        <Sparkles size={11} className={streaming ? 'animate-soft-pulse text-accent' : 'text-accent'} aria-hidden />
        <span className="truncate">
          {streaming ? (
            'Reasoning'
          ) : (
            <>
              {synthetic ? 'Context summary' : 'Reasoned'} for {formatDuration(durationMs)}
            </>
          )}
        </span>
        <span className="text-muted/50" aria-hidden>
          ·
        </span>
        <span className="shrink-0">{plural(memoryCount, 'memory', 'memories')}</span>
        {mock && !streaming && (
          <span className="rounded-full bg-warning-soft px-1.5 py-0.5 text-[8px] font-semibold tracking-wide text-warning uppercase">
            Mock
          </span>
        )}
        {hasDetails && (
          <ChevronDown
            size={11}
            className={cn('ml-0.5 transition-transform duration-150', open && 'rotate-180')}
            aria-hidden
          />
        )}
      </button>

      {open && (
        <div
          id={panelId}
          className="mt-2 animate-fade-in rounded-xl border border-border bg-subtle/45 p-3"
        >
          {thinking && (
            <div>
              <p className="text-[9px] font-semibold tracking-wide text-muted uppercase">
                {synthetic || mock ? 'Context summary' : 'Thinking summary'}
              </p>
              <p className="mt-1.5 text-[11px] leading-relaxed whitespace-pre-wrap text-muted">
                {thinking}
              </p>
              {mock && (
                <p className="mt-2 text-[9px] text-warning">
                  Generated locally in mock mode, not by Gemini.
                </p>
              )}
            </div>
          )}

          {steps.length > 0 && (
            <div className={cn(thinking && 'mt-3 border-t border-border/70 pt-3')}>
              <div className="space-y-1.5">
                {steps.map((step) => (
                  <div
                    key={step.phase}
                    className="flex items-center gap-2 text-[10px] text-muted"
                  >
                    <StepIcon status={step.status} />
                    <span className="min-w-0 flex-1 truncate">
                      {phaseLabels[step.phase] ?? sentenceCase(step.phase)}
                    </span>
                    {step.duration_ms > 0 && (
                      <span className="font-mono text-[9px] text-muted/70">
                        {formatDuration(step.duration_ms)}
                      </span>
                    )}
                    <span className="w-10 text-right text-[9px] text-muted/70">
                      {sentenceCase(step.status)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div
            className={cn(
              'flex flex-wrap items-center gap-x-3 gap-y-1',
              (thinking || steps.length > 0) && 'mt-3 border-t border-border/70 pt-2.5',
            )}
          >
            {totalTokens !== undefined && (
              <span className="text-[9px] text-muted">
                {formatTokens(totalTokens)} tokens
              </span>
            )}
            {onOpenTrace && (
              <button
                type="button"
                onClick={onOpenTrace}
                className="ml-auto inline-flex items-center gap-1 text-[10px] font-medium text-accent-ink hover:underline"
              >
                Open full trace
                <ArrowUpRight size={10} aria-hidden />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
