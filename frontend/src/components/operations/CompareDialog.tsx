import {
  ArrowDownRight,
  ArrowUpRight,
  Brain,
  GitCompare,
  MessageSquare,
  RefreshCw,
} from 'lucide-react'
import { useEffect, useState } from 'react'

import { api, errorMessage } from '../../api/client'
import type { Memory, Message, SpaceDiff } from '../../api/types'
import { branchAncestors } from '../../lib/branchTree'
import { cn } from '../../lib/cn'
import { useOperationsStore } from '../../store/operations'
import { useWorkspaceStore } from '../../store/workspace'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { Spinner } from '../ui/Spinner'

function shortId(value: string): string {
  return value.slice(0, 7)
}

function MemoryLine({
  memory,
  tone,
  previous,
}: {
  memory: Memory
  tone: 'added' | 'removed' | 'changed'
  previous?: Memory
}) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2">
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            'rounded-full px-1.5 py-0.5 text-[8px] font-semibold tracking-wide uppercase',
            tone === 'added' && 'bg-success-soft text-success',
            tone === 'removed' && 'bg-danger-soft text-danger',
            tone === 'changed' && 'bg-accent-soft text-accent-ink',
          )}
        >
          {tone}
        </span>
        <span className="text-[9px] text-muted">{memory.kind}</span>
        <span className="ml-auto truncate text-[9px] text-muted">
          from {memory.origin_branch_name}
        </span>
      </div>
      {previous && (
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted line-through decoration-danger/40">
          {previous.content}
        </p>
      )}
      <p className="mt-1 text-[11px] leading-relaxed text-ink">{memory.content}</p>
    </div>
  )
}

function DiffMessages({
  messages,
  tone,
  description,
}: {
  messages: Message[]
  tone: 'added' | 'upstream'
  description: string
}) {
  const [expanded, setExpanded] = useState(false)
  if (messages.length === 0) return null
  const visible = expanded ? messages : messages.slice(0, 12)

  return (
    <section>
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wide text-muted uppercase">
          <MessageSquare size={11} aria-hidden />
          {tone === 'added' ? 'Messages on this branch' : 'Upstream messages'}
          <span className="font-normal tabular-nums">({messages.length})</span>
        </h3>
        {messages.length > 12 && (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="text-[10px] font-medium text-accent-ink hover:underline"
          >
            {expanded ? 'Show fewer' : `Show all ${messages.length}`}
          </button>
        )}
      </div>
      <p className="mt-0.5 text-[10px] text-muted">{description}</p>
      <div className="mt-2 space-y-1.5">
        {visible.map((message) => (
          <div
            key={message.id}
            className={cn(
              'rounded-lg border px-3 py-2',
              tone === 'added'
                ? 'border-success/15 bg-success-soft/35'
                : 'border-border bg-subtle/45',
            )}
          >
            <div className="flex items-center gap-1.5 text-[9px] text-muted">
              <span className="font-semibold tracking-wide uppercase">
                {message.role}
              </span>
              <span aria-hidden>·</span>
              <span className="truncate">{message.origin_branch_name}</span>
              {message.is_inherited && (
                <span className="rounded-full border border-border px-1.5 py-0.5 text-[8px]">
                  inherited
                </span>
              )}
            </div>
            <p className="mt-1 line-clamp-3 text-[11px] leading-relaxed whitespace-pre-wrap text-ink">
              {message.content}
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}

function SummaryChip({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone?: 'added' | 'removed' | 'changed'
}) {
  return (
    <div className="rounded-lg border border-border bg-surface px-2.5 py-2">
      <p
        className={cn(
          'text-base font-semibold tabular-nums',
          tone === 'added' && value > 0 && 'text-success',
          tone === 'removed' && value > 0 && 'text-danger',
          tone === 'changed' && value > 0 && 'text-accent-ink',
          !tone && 'text-ink',
        )}
      >
        {value}
      </p>
      <p className="mt-0.5 text-[9px] tracking-wide text-muted uppercase">{label}</p>
    </div>
  )
}

export function CompareDialog({ branchId }: { branchId: string }) {
  const close = useOperationsStore((state) => state.closeCompare)
  const branches = useWorkspaceStore((state) => state.branches)
  const source = branches.find((branch) => branch.id === branchId)
  const ancestors = branchAncestors(branches, branchId)
  const [targetId, setTargetId] = useState(ancestors[0]?.id ?? '')
  const [diff, setDiff] = useState<SpaceDiff | null>(null)
  const [loading, setLoading] = useState(Boolean(targetId))
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!targetId) return
    const controller = new AbortController()
    api
      .get<SpaceDiff>(
        `/branches/${branchId}/diff?against=${encodeURIComponent(targetId)}`,
        controller.signal,
      )
      .then((result) => {
        setDiff(result)
        setLoading(false)
        setError(null)
      })
      .catch((caught) => {
        if (controller.signal.aborted) return
        setError(errorMessage(caught))
        setLoading(false)
      })
    return () => controller.abort()
  }, [branchId, targetId, reloadKey])

  const changeTarget = (nextTargetId: string) => {
    setTargetId(nextTargetId)
    setDiff(null)
    setLoading(true)
    setError(null)
  }

  const retry = () => {
    setLoading(true)
    setError(null)
    setReloadKey((value) => value + 1)
  }

  const empty =
    diff !== null &&
    diff.added_count === 0 &&
    diff.removed_count === 0 &&
    diff.changed_count === 0 &&
    diff.messages_added_count === 0 &&
    diff.messages_upstream_count === 0

  return (
    <Dialog
      open
      onClose={close}
      title="Compare with an ancestor"
      description="See how memory and conversation diverged from an upstream branch at their shared history."
      size="lg"
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-[10px] text-muted">
            {diff
              ? `Shared history from ${shortId(diff.baseline_commit_id)}`
              : 'Memory and conversation divergence'}
          </span>
          <Button variant="secondary" size="sm" onClick={close}>
            Close
          </Button>
        </div>
      }
    >
      {ancestors.length === 0 ? (
        <div className="rounded-xl border border-border bg-subtle/55 p-6 text-center">
          <GitCompare size={20} className="mx-auto text-muted" aria-hidden />
          <p className="mt-2 text-xs font-medium text-ink">No ancestor to compare with</p>
          <p className="mt-1 text-[11px] text-muted">
            This is the root branch. Fork a branch to compare memory and conversation
            divergence.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[180px] flex-1">
              <label
                htmlFor="compare-target"
                className="mb-1.5 block text-[10px] font-medium tracking-wide text-muted uppercase"
              >
                Compare with
              </label>
              <select
                id="compare-target"
                value={targetId}
                onChange={(event) => changeTarget(event.target.value)}
                className="w-full rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm text-ink shadow-soft focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15"
              >
                {ancestors.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-border bg-subtle/55 px-3 py-2.5 text-[11px]">
              <span className="font-medium text-ink">{source?.name ?? 'This branch'}</span>
              <GitCompare size={13} className="text-accent" aria-hidden />
              <span className="font-medium text-ink">
                {diff?.against_name ??
                  ancestors.find((branch) => branch.id === targetId)?.name ??
                  'Ancestor'}
              </span>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-muted">
              <Spinner className="size-5" />
              <span className="text-[11px]">Computing divergence…</span>
            </div>
          ) : error ? (
            <div className="rounded-xl border border-border bg-subtle/45 py-10 text-center">
              <p className="text-[11px] text-danger">{error}</p>
              <Button
                variant="secondary"
                size="sm"
                className="mt-3"
                onClick={retry}
                leadingIcon={<RefreshCw size={12} aria-hidden />}
              >
                Try again
              </Button>
            </div>
          ) : diff ? (
            <div className="space-y-5">
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                <SummaryChip label="Added" value={diff.added_count} tone="added" />
                <SummaryChip label="Removed" value={diff.removed_count} tone="removed" />
                <SummaryChip label="Changed" value={diff.changed_count} tone="changed" />
                <SummaryChip label="New messages" value={diff.messages_added_count} />
                <SummaryChip label="Upstream" value={diff.messages_upstream_count} />
              </div>

              {empty ? (
                <div className="rounded-xl border border-dashed border-border bg-subtle/35 px-5 py-12 text-center">
                  <GitCompare size={22} className="mx-auto text-muted/70" aria-hidden />
                  <p className="mt-2 text-xs font-medium text-ink">
                    No divergence yet
                  </p>
                  <p className="mt-1 text-[11px] text-muted">
                    This branch and its ancestor currently share the same memories and
                    conversation baseline.
                  </p>
                </div>
              ) : (
                <>
                  {(diff.added_count > 0 || diff.removed_count > 0 || diff.changed_count > 0) && (
                    <section>
                      <h3 className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wide text-muted uppercase">
                        <Brain size={11} aria-hidden />
                        Memory divergence
                      </h3>
                      <div className="mt-2 space-y-1.5">
                        {diff.added.map((memory) => (
                          <MemoryLine key={memory.id} memory={memory} tone="added" />
                        ))}
                        {diff.removed.map((memory) => (
                          <MemoryLine key={memory.id} memory={memory} tone="removed" />
                        ))}
                        {diff.changed.map((change) => (
                          <MemoryLine
                            key={change.after.id}
                            memory={change.after}
                            previous={change.before}
                            tone="changed"
                          />
                        ))}
                      </div>
                    </section>
                  )}

                  <DiffMessages
                    messages={diff.messages_added}
                    tone="added"
                    description="Messages sent on this branch since the fork point."
                  />
                  <DiffMessages
                    messages={diff.messages_upstream}
                    tone="upstream"
                    description="Messages added to the ancestor after this branch forked."
                  />

                  {diff.messages_added_count > 0 && (
                    <p className="flex items-start gap-1.5 rounded-lg bg-subtle px-3 py-2.5 text-[10px] leading-relaxed text-muted">
                      {diff.messages_added_count > diff.messages_upstream_count ? (
                        <ArrowUpRight
                          size={12}
                          className="mt-0.5 shrink-0 text-accent"
                          aria-hidden
                        />
                      ) : (
                        <ArrowDownRight
                          size={12}
                          className="mt-0.5 shrink-0 text-accent"
                          aria-hidden
                        />
                      )}
                      Divergence is measured from shared history. Upstream messages after
                      the fork never become visible here.
                    </p>
                  )}
                </>
              )}
            </div>
          ) : null}
        </div>
      )}
    </Dialog>
  )
}
