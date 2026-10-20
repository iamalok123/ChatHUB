import {
  ArrowUpRight,
  Brain,
  ChevronDown,
  GitBranch,
  Lightbulb,
  Pin,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react'
import { useEffect, useState } from 'react'

import { api, errorMessage } from '../../api/client'
import type {
  AssistantTrace,
  Branch,
  TraceMemory,
  TraceResponse,
  TraceStep,
} from '../../api/types'
import { cn } from '../../lib/cn'
import { formatDuration, formatTokens, plural, sentenceCase } from '../../lib/format'
import type { TraceTarget } from '../../store/trace'
import { useUiStore } from '../../store/ui'
import { Spinner } from '../ui/Spinner'

const phaseLabels: Record<string, string> = {
  retrieve: 'Retrieve memory',
  compose: 'Compose context',
  generate: 'Generate reply',
  extract: 'Extract memory',
}

function ScoreBar({ value, className }: { value: number | null; className?: string }) {
  const percent = Math.max(0, Math.min(100, Math.round((value ?? 0) * 100)))
  return (
    <div className="h-1 overflow-hidden rounded-full bg-border/70">
      <div
        className={cn('h-full rounded-full bg-accent/75', className)}
        style={{ width: `${percent}%` }}
      />
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 py-1.5">
      <p className="text-[8px] font-medium tracking-wide text-muted uppercase">{label}</p>
      <p className="mt-0.5 truncate font-mono text-[10px] text-ink">{value}</p>
    </div>
  )
}

function MemoryRow({ memory, ranked = false }: { memory: TraceMemory; ranked?: boolean }) {
  const focusCommit = useUiStore((state) => state.focusCommit)
  const similarity = memory.similarity === null ? '-' : memory.similarity.toFixed(2)
  const score = memory.score === null ? '-' : memory.score.toFixed(2)

  return (
    <div className="rounded-lg border border-border bg-surface p-2.5">
      <div className="flex items-start gap-1.5">
        <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[8px] font-semibold tracking-wide text-accent-ink uppercase">
          {memory.kind}
        </span>
        {memory.pinned && <Pin size={10} className="mt-0.5 text-accent" aria-hidden />}
        <span className="ml-auto flex min-w-0 items-center gap-2">
          {memory.inherited && (
            <span className="truncate text-[8px] text-muted">
              from {memory.origin_branch_name}
            </span>
          )}
          {memory.source_commit_id && (
            <button
              type="button"
              onClick={() => focusCommit(memory.source_commit_id as string)}
              title="Jump to the source message"
              className="inline-flex shrink-0 items-center gap-0.5 text-[8px] font-medium text-muted hover:text-accent-ink"
            >
              <ArrowUpRight size={9} aria-hidden />
              source
            </button>
          )}
        </span>
      </div>
      <p className="mt-1.5 text-[10px] leading-relaxed text-ink">{memory.content}</p>
      {ranked && (
        <>
          <div className="mt-2">
            <ScoreBar value={memory.score} />
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[8px] text-muted">
            <span>score {score}</span>
            <span>sim {similarity}</span>
            <span>imp {memory.importance_score.toFixed(2)}</span>
            <span>rec {memory.recency.toFixed(2)}</span>
            <span className="ml-auto rounded-full bg-subtle px-1.5 py-0.5">
              {memory.reason}
            </span>
          </div>
        </>
      )}
      {!ranked && (
        <p className="mt-1 text-[8px] text-muted">
          {memory.reason}
          {memory.score !== null ? ` - score ${score}` : ''}
        </p>
      )}
    </div>
  )
}

function ContextBar({ trace }: { trace: AssistantTrace }) {
  const context = trace.context
  const segments = [
    { label: 'System', value: context.system_tokens, color: 'bg-accent' },
    { label: 'Memory', value: context.memory_tokens, color: 'bg-success' },
    { label: 'History', value: context.history_tokens, color: 'bg-warning' },
    { label: 'Current', value: context.current_tokens, color: 'bg-muted' },
  ]
  const total = Math.max(1, segments.reduce((sum, item) => sum + item.value, 0))

  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <div className="flex items-center justify-between text-[10px]">
        <span className="font-medium text-ink">Context composition</span>
        <span className="font-mono text-[9px] text-muted">
          {formatTokens(context.total_tokens)} tokens
        </span>
      </div>
      <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-border/60">
        {segments.map((segment) => (
          <div
            key={segment.label}
            className={cn('h-full', segment.color)}
            style={{ width: `${(segment.value / total) * 100}%` }}
            title={`${segment.label}: ${segment.value} tokens`}
          />
        ))}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[8px] text-muted">
        {segments.map((segment) => (
          <span key={segment.label} className="flex items-center gap-1.5">
            <span className={cn('size-1.5 rounded-full', segment.color)} aria-hidden />
            {segment.label}
            <span className="ml-auto font-mono">{segment.value}</span>
          </span>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 border-t border-border/70 pt-2 text-[8px] text-muted">
        <span>{plural(context.history_messages, 'history message')}</span>
        {context.dropped_turns > 0 && <span>{context.dropped_turns} dropped</span>}
        <span>{plural(context.memory_count, 'memory', 'memories')}</span>
      </div>
    </div>
  )
}

function StepRow({ step }: { step: TraceStep }) {
  return (
    <div className="flex items-center gap-2 text-[9px] text-muted">
      <span
        className={cn(
          'size-1.5 shrink-0 rounded-full',
          step.status === 'error' || step.status === 'failed'
            ? 'bg-danger'
            : step.status === 'done' || step.status === 'complete'
              ? 'bg-success'
              : 'bg-warning',
        )}
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate">
        {phaseLabels[step.phase] ?? sentenceCase(step.phase)}
      </span>
      <span className="font-mono text-[8px] text-muted/70">
        {formatDuration(step.duration_ms)}
      </span>
    </div>
  )
}

function TraceBody({ trace }: { trace: AssistantTrace }) {
  const synthetic = trace.thinking_source === 'synthetic_context'
  const contextSummary = trace.mock || synthetic
  const usage = trace.usage ?? {}
  const retrieved = trace.retrieved_memories ?? []
  const considered = trace.considered_memories ?? []
  const excluded = trace.excluded_memories ?? []
  const operations = trace.memory_operations ?? []
  const warnings = trace.warnings ?? []
  const steps = trace.steps ?? []
  const summaryHeading = !trace.thinking_summary
    ? 'Reasoning unavailable'
    : contextSummary
      ? 'Context summary'
      : 'Thinking summary'

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border bg-surface p-3 shadow-soft">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent-ink">
            <Brain size={14} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-medium text-ink">{summaryHeading}</p>
            <p className="mt-0.5 text-[9px] text-muted">
              {trace.mock
                ? 'Mock mode. This is not live Gemini reasoning.'
                : `${trace.model} · ${sentenceCase(trace.thinking_level)} thinking`}
            </p>
          </div>
          <span
            className={cn(
              'shrink-0 rounded-full px-1.5 py-0.5 text-[8px] font-medium',
              trace.status === 'complete'
                ? 'bg-success-soft text-success'
                : 'bg-warning-soft text-warning',
            )}
          >
            {sentenceCase(trace.status)}
          </span>
        </div>
        <p className="mt-2 text-[10px] leading-relaxed whitespace-pre-wrap text-muted">
          {trace.thinking_summary || 'No thinking summary was recorded for this reply.'}
        </p>
        {synthetic && (
          <p className="mt-2 text-[8px] text-warning">
            Clearly labelled synthetic context summary, not model thoughts.
          </p>
        )}
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        <Stat label="Reasoned" value={formatDuration(trace.generate_ms)} />
        <Stat label="Memories" value={String(retrieved.length)} />
        <Stat label="Total" value={formatTokens(usage.total_token_count ?? 0)} />
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        <Stat label="Prompt" value={formatTokens(usage.prompt_token_count ?? 0)} />
        <Stat
          label="Candidates"
          value={formatTokens(usage.candidates_token_count ?? 0)}
        />
        <Stat label="Top K" value={String(trace.retrieval.top_k)} />
      </div>

      <ContextBar trace={trace} />

      <details className="group rounded-xl border border-border bg-surface">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-[10px] text-muted">
          <ChevronDown
            size={11}
            className="transition-transform group-open:rotate-180"
            aria-hidden
          />
          Retrieval query
          <span className="ml-auto text-[8px]">
            {formatDuration(trace.retrieval.duration_ms)} / top {trace.retrieval.top_k}
          </span>
        </summary>
        <div className="border-t border-border p-3">
          <p className="rounded-lg bg-subtle/70 px-2.5 py-2 font-mono text-[9px] leading-relaxed text-ink">
            {trace.retrieval.query || 'No retrieval query was recorded.'}
          </p>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[8px] text-muted">
            <span>{trace.retrieval.query_tokens} query tokens</span>
            <span>{trace.retrieval.used_tokens} memory tokens used</span>
            <span>{formatDuration(trace.retrieval.duration_ms)}</span>
          </div>
        </div>
      </details>

      <div>
        <div className="mb-2 flex items-center justify-between px-0.5">
          <p className="text-[10px] font-medium text-ink">Retrieved memories</p>
          <span className="text-[8px] text-muted">{retrieved.length} ranked</span>
        </div>
        {retrieved.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-subtle/40 px-3 py-4 text-center text-[9px] text-muted">
            No memories cleared the score threshold for this answer.
          </div>
        ) : (
          <div className="space-y-1.5">
            {retrieved.map((memory) => (
              <MemoryRow key={memory.id} memory={memory} ranked />
            ))}
          </div>
        )}
      </div>

      {excluded.length > 0 && (
        <div>
          <p className="mb-2 px-0.5 text-[10px] font-medium text-ink">
            Excluded on this branch
          </p>
          <div className="space-y-1.5">
            {excluded.map((memory) => (
              <MemoryRow key={memory.id} memory={memory} />
            ))}
          </div>
        </div>
      )}

      {considered.length > 0 && (
        <details className="group rounded-xl border border-border bg-surface">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-[10px] text-muted">
            <ChevronDown
              size={11}
              className="transition-transform group-open:rotate-180"
              aria-hidden
            />
            Considered but skipped
            <span className="ml-auto text-[8px]">{considered.length}</span>
          </summary>
          <div className="space-y-1.5 border-t border-border p-2">
            {considered.map((memory) => (
              <MemoryRow key={memory.id} memory={memory} />
            ))}
          </div>
        </details>
      )}

      {steps.length > 0 && (
        <details className="rounded-xl border border-border bg-surface">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-[10px] text-muted">
            <GitBranch size={11} aria-hidden />
            Execution steps
            <span className="ml-auto text-[8px]">{steps.length}</span>
          </summary>
          <div className="space-y-1.5 border-t border-border p-2.5">
            {steps.map((step) => (
              <StepRow key={step.phase} step={step} />
            ))}
          </div>
        </details>
      )}

      <div className="rounded-xl border border-border bg-surface p-3">
        <p className="text-[10px] font-medium text-ink">What changed in memory</p>
        {operations.length > 0 ? (
          <div className="mt-2 space-y-1.5">
            {operations.map((operation, index) => (
              <div
                key={`${operation.op}-${operation.memory_id ?? operation.proposal_id ?? index}`}
                className="rounded-lg bg-subtle/70 px-2 py-1.5 text-[9px] text-muted"
              >
                <span className="font-medium text-ink">{sentenceCase(operation.op)}</span>
                {operation.content ? ` — ${operation.content}` : ''}
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-1.5 text-[9px] leading-relaxed text-muted">
            No memories were added, updated, or proposed for this reply.
          </p>
        )}
      </div>

      {warnings.length > 0 && (
        <div className="rounded-xl border border-warning/20 bg-warning-soft px-3 py-2.5">
          <p className="text-[9px] font-medium text-warning">Warnings</p>
          <ul className="mt-1 space-y-1 text-[9px] leading-relaxed text-warning">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      {trace.error && (
        <div className="flex items-start gap-2 rounded-xl border border-danger/20 bg-danger-soft px-3 py-2.5 text-[9px] leading-relaxed text-danger">
          <TriangleAlert size={12} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            {trace.error.message}
            {trace.error.retryable ? ' This error can be retried.' : ''}
          </span>
        </div>
      )}
    </div>
  )
}

export function TracePanel({
  branch,
  target,
}: {
  branch: Branch
  target: TraceTarget | null
}) {
  const [trace, setTrace] = useState<AssistantTrace | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const commitId = target?.commitId ?? null
  const targetMatches = target?.branchId === branch.id

  useEffect(() => {
    if (!commitId || !targetMatches) return
    const controller = new AbortController()
    api
      .get<TraceResponse>(
        `/branches/${branch.id}/messages/${commitId}/trace`,
        controller.signal,
      )
      .then((response) => {
        setTrace(response.trace)
        setLoading(false)
      })
      .catch((caught) => {
        if (controller.signal.aborted) return
        setError(errorMessage(caught))
        setLoading(false)
      })
    return () => controller.abort()
  }, [branch.id, commitId, refreshKey, targetMatches])

  if (!target || !targetMatches) {
    return (
      <div className="flex flex-col items-center px-4 py-12 text-center">
        <span className="mb-3 grid size-10 place-items-center rounded-xl bg-subtle text-muted">
          <Lightbulb size={18} aria-hidden />
        </span>
        <h3 className="text-xs font-medium text-ink">No answer selected</h3>
        <p className="mt-1.5 max-w-[230px] text-[11px] leading-relaxed text-muted">
          Select an assistant reply and choose Why to see its memories, scores,
          context, and thinking summary.
        </p>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 px-1">
        <span className="grid size-7 place-items-center rounded-lg bg-accent-soft text-accent-ink">
          <Lightbulb size={14} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium text-ink">Why this answer</p>
          <p className="truncate font-mono text-[8px] text-muted">
            commit {target.commitId.slice(0, 8)}
          </p>
        </div>
        <button
          type="button"
          aria-label="Refresh trace"
          title="Refresh trace"
          onClick={() => {
            setLoading(true)
            setError(null)
            setRefreshKey((value) => value + 1)
          }}
          className="grid size-7 place-items-center rounded-lg text-muted hover:bg-hover hover:text-ink"
        >
          <RefreshCw size={13} aria-hidden />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted">
          <Spinner className="size-5" />
        </div>
      ) : error ? (
        <div className="px-3 py-10 text-center">
          <p className="text-[11px] leading-relaxed text-danger">{error}</p>
          <button
            type="button"
            onClick={() => {
              setLoading(true)
              setError(null)
              setRefreshKey((value) => value + 1)
            }}
            className="mt-3 text-[11px] font-medium text-accent-ink hover:underline"
          >
            Try again
          </button>
        </div>
      ) : trace ? (
        <TraceBody trace={trace} />
      ) : (
        <div className="rounded-xl border border-dashed border-border bg-subtle/40 px-3 py-6 text-center text-[10px] text-muted">
          No trace is stored for this reply.
        </div>
      )}
    </div>
  )
}
