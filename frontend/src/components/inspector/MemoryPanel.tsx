import {
  ArrowUpRight,
  Brain,
  Check,
  EyeOff,
  Pencil,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  TriangleAlert,
  Undo2,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'

import { api, errorMessage } from '../../api/client'
import type { Branch, Memory, MemoryList, MemoryProposal } from '../../api/types'
import { cn } from '../../lib/cn'
import { plural, sentenceCase } from '../../lib/format'
import { useUiStore } from '../../store/ui'
import { useWorkspaceStore } from '../../store/workspace'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'
import { Spinner } from '../ui/Spinner'

const memoryKinds = [
  'fact',
  'preference',
  'decision',
  'profile',
  'summary',
  'task',
] as const

const fieldClass =
  'w-full rounded-lg border border-border bg-surface px-2.5 py-2 text-[11px] text-ink placeholder:text-muted/70 transition-colors focus:border-accent focus:outline-none'

type MemoryDraft = {
  content: string
  kind: string
  importance: number
}

type AcceptDraft = MemoryDraft & {
  resolution: 'replace' | 'keep_both'
}

function matchMemory(memory: Memory, query: string, kind: string): boolean {
  if (kind !== 'all' && memory.kind !== kind) return false
  if (!query) return true
  return memory.content.toLowerCase().includes(query)
}

function SourceButton({
  commitId,
  disabled,
}: {
  commitId: string | null
  disabled?: boolean
}) {
  const focusCommit = useUiStore((state) => state.focusCommit)
  if (!commitId) {
    return <span className="text-[9px] text-muted/70">No source</span>
  }
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => focusCommit(commitId)}
      title="Jump to the source message"
      className="inline-flex items-center gap-1 text-[9px] font-medium text-muted transition-colors hover:text-accent-ink disabled:cursor-not-allowed disabled:opacity-60"
    >
      <ArrowUpRight size={10} aria-hidden />
      Source {commitId.slice(0, 8)}
    </button>
  )
}

function MemoryEditor({
  initial,
  saving,
  submitLabel,
  contentOnly = false,
  onSave,
  onCancel,
}: {
  initial?: MemoryDraft
  saving: boolean
  submitLabel: string
  contentOnly?: boolean
  onSave: (draft: MemoryDraft) => void
  onCancel: () => void
}) {
  const [content, setContent] = useState(initial?.content ?? '')
  const [kind, setKind] = useState(initial?.kind ?? 'fact')
  const [importance, setImportance] = useState(initial?.importance ?? 0.5)

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!content.trim()) return
    onSave({
      content: content.trim(),
      kind,
      importance,
    })
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <textarea
        value={content}
        onChange={(event) => setContent(event.target.value)}
        rows={3}
        maxLength={4000}
        autoFocus
        aria-label="Memory content"
        placeholder="What should this branch remember?"
        className={cn(fieldClass, 'resize-none leading-relaxed')}
      />
      {!contentOnly && (
        <div className="grid grid-cols-[minmax(0,1fr)_104px] gap-2">
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value)}
            aria-label="Memory kind"
            className={fieldClass}
          >
            {memoryKinds.map((value) => (
              <option key={value} value={value}>
                {sentenceCase(value)}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2 text-[10px] text-muted">
            <span className="sr-only">Memory importance</span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={Math.round(importance * 100)}
              onChange={(event) => setImportance(Number(event.target.value) / 100)}
              aria-label="Memory importance"
              className="min-w-0 flex-1 accent-[var(--color-accent)]"
            />
            <span className="w-7 text-right font-mono text-[9px] text-ink">
              {Math.round(importance * 100)}
            </span>
          </label>
        </div>
      )}
      <div className="flex justify-end gap-1.5">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          size="sm"
          loading={saving}
          disabled={!content.trim()}
        >
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}

function CompactAction({
  label,
  disabled,
  active,
  danger,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  active?: boolean
  danger?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        'grid size-6 place-items-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-45',
        danger
          ? 'text-muted hover:bg-danger-soft hover:text-danger'
          : active
            ? 'bg-accent-soft text-accent-ink'
            : 'text-muted hover:bg-hover hover:text-ink',
      )}
    >
      {children}
    </button>
  )
}

function MemoryCard({
  memory,
  excluded = false,
  disabled,
  busy,
  editor,
  onPin,
  onEdit,
  onExclude,
  onInclude,
  onDelete,
}: {
  memory: Memory
  excluded?: boolean
  disabled: boolean
  busy: boolean
  editor?: ReactNode
  onPin: () => void
  onEdit: () => void
  onExclude: () => void
  onInclude: () => void
  onDelete: () => void
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const provenance = memory.inherited
    ? `from ${memory.origin_branch_name}`
    : 'created on this branch'

  return (
    <article
      className={cn(
        'memory-entry rounded-xl border border-border bg-surface p-2.5 shadow-soft',
        excluded && 'border-dashed bg-subtle/55',
      )}
    >
      <div className="flex items-start gap-1.5">
        <span className="rounded-md bg-accent-soft px-1.5 py-0.5 text-[8px] font-semibold tracking-wide text-accent-ink uppercase">
          {memory.kind}
        </span>
        {memory.pinned && !excluded && (
          <span className="inline-flex items-center gap-0.5 rounded-md bg-accent-soft px-1 py-0.5 text-[8px] font-medium text-accent-ink">
            <Pin size={8} aria-hidden /> pinned
          </span>
        )}
        {memory.edited && (
          <span className="rounded-md bg-subtle px-1 py-0.5 text-[8px] font-medium text-muted">
            edited here
          </span>
        )}
        {excluded && (
          <span className="inline-flex items-center gap-0.5 rounded-md bg-subtle px-1 py-0.5 text-[8px] font-medium text-muted">
            <EyeOff size={8} aria-hidden /> excluded
          </span>
        )}
        {memory.stale_embedding && (
          <span
            className="ml-auto inline-flex items-center gap-0.5 text-[8px] text-warning"
            title="This embedding is old. Similarity may be unreliable until embeddings are rebuilt."
          >
            <TriangleAlert size={9} aria-hidden /> stale vector
          </span>
        )}
      </div>

      <p
        className={cn(
          'mt-1.5 text-[11px] leading-relaxed text-ink',
          excluded && 'text-muted line-through decoration-border',
        )}
      >
        {memory.content}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[9px] text-muted">
        <span className="truncate">{provenance}</span>
        <span className="size-0.5 rounded-full bg-muted/50" aria-hidden />
        <span>{Math.round(memory.importance * 100)}% importance</span>
        <span className="ml-auto">
          <SourceButton commitId={memory.source_commit_id} />
        </span>
      </div>

      {!excluded && (
        <div className="mt-2 flex items-center gap-0.5 border-t border-border/70 pt-1.5">
          <CompactAction
            label={`${memory.pinned ? 'Unpin' : 'Pin'} memory: ${memory.content}`}
            disabled={disabled || busy}
            active={memory.pinned}
            onClick={onPin}
          >
            {memory.pinned ? <PinOff size={11} aria-hidden /> : <Pin size={11} aria-hidden />}
          </CompactAction>
          <CompactAction
            label={`Edit memory: ${memory.content}`}
            disabled={disabled || busy}
            onClick={onEdit}
          >
            <Pencil size={11} aria-hidden />
          </CompactAction>
          {memory.inherited ? (
            <CompactAction
              label={`Exclude memory from this branch: ${memory.content}`}
              disabled={disabled || busy}
              onClick={onExclude}
            >
              <EyeOff size={11} aria-hidden />
            </CompactAction>
          ) : confirmingDelete ? (
            <span className="ml-auto inline-flex items-center gap-1 text-[9px] text-danger">
              Delete everywhere?
              <button
                type="button"
                disabled={disabled || busy}
                onClick={onDelete}
                className="rounded bg-danger px-1.5 py-0.5 font-medium text-white disabled:opacity-50"
              >
                Delete
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                className="rounded px-1 py-0.5 text-muted hover:bg-hover hover:text-ink"
              >
                Cancel
              </button>
            </span>
          ) : (
            <CompactAction
              label={`Delete memory: ${memory.content}`}
              disabled={disabled || busy}
              danger
              onClick={() => setConfirmingDelete(true)}
            >
              <Trash2 size={11} aria-hidden />
            </CompactAction>
          )}
          <span className="ml-auto">
            {memory.inherited && !confirmingDelete && (
              <span className="text-[8px] text-muted/70">branch-local changes</span>
            )}
          </span>
        </div>
      )}

      {excluded && (
        <div className="mt-2 flex items-center gap-1 border-t border-border/70 pt-1.5">
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled || busy}
            onClick={onInclude}
            leadingIcon={<Undo2 size={11} aria-hidden />}
          >
            Restore here
          </Button>
        </div>
      )}

      {editor && <div className="mt-2 border-t border-border/70 pt-2">{editor}</div>}
    </article>
  )
}

function ProposalCard({
  proposal,
  disabled,
  saving,
  onAccept,
  onReject,
}: {
  proposal: MemoryProposal
  disabled: boolean
  saving: boolean
  onAccept: (draft: AcceptDraft) => void
  onReject: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [content, setContent] = useState(proposal.content)
  const [kind, setKind] = useState(proposal.kind)
  const [importance, setImportance] = useState(proposal.importance)
  const [resolution, setResolution] = useState<'replace' | 'keep_both'>('keep_both')
  const conflict = Boolean(proposal.conflicts_with_memory_id)

  const accept = (nextResolution: 'replace' | 'keep_both' = resolution) => {
    onAccept({
      content: editing ? content.trim() : proposal.content,
      kind: editing ? kind : proposal.kind,
      importance: editing ? importance : proposal.importance,
      resolution: conflict ? nextResolution : 'keep_both',
    })
  }

  if (editing) {
    return (
      <article className="rounded-xl border border-accent/35 bg-accent-soft/20 p-2.5">
        <p className="mb-2 text-[9px] font-medium tracking-wide text-accent-ink uppercase">
          Edit before accepting
        </p>
        <div className="space-y-2">
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            rows={3}
            maxLength={4000}
            aria-label="Proposal content"
            className={cn(fieldClass, 'resize-none leading-relaxed')}
          />
          <div className="grid grid-cols-[minmax(0,1fr)_104px] gap-2">
            <select
              value={kind}
              onChange={(event) => setKind(event.target.value)}
              aria-label="Proposal kind"
              className={fieldClass}
            >
              {memoryKinds.map((value) => (
                <option key={value} value={value}>
                  {sentenceCase(value)}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2 text-[10px] text-muted">
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={Math.round(importance * 100)}
                onChange={(event) => setImportance(Number(event.target.value) / 100)}
                aria-label="Proposal importance"
                className="min-w-0 flex-1 accent-[var(--color-accent)]"
              />
              <span className="w-7 text-right font-mono text-[9px] text-ink">
                {Math.round(importance * 100)}
              </span>
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {conflict && (
              <select
                value={resolution}
                onChange={(event) =>
                  setResolution(event.target.value as 'replace' | 'keep_both')
                }
                aria-label="Conflict resolution"
                className="h-8 rounded-lg border border-border bg-surface px-2 text-[10px] text-ink"
              >
                <option value="keep_both">Keep both</option>
                <option value="replace">Replace old</option>
              </select>
            )}
            <span className="ml-auto" />
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              loading={saving}
              disabled={disabled || !content.trim()}
              onClick={() => accept()}
            >
              Save & accept
            </Button>
          </div>
        </div>
      </article>
    )
  }

  return (
    <article className="rounded-xl border border-border bg-surface p-2.5 shadow-soft">
      <div className="flex items-start gap-1.5">
        <span className="rounded-md bg-accent-soft px-1.5 py-0.5 text-[8px] font-semibold tracking-wide text-accent-ink uppercase">
          {proposal.kind}
        </span>
        <span className="rounded-md bg-warning-soft px-1 py-0.5 text-[8px] font-medium text-warning">
          pending
        </span>
        {conflict && (
          <span className="inline-flex items-center gap-0.5 rounded-md bg-warning-soft px-1 py-0.5 text-[8px] font-medium text-warning">
            <TriangleAlert size={8} aria-hidden /> conflict
          </span>
        )}
        <span className="ml-auto text-[8px] text-muted">
          {Math.round(proposal.importance * 100)}%
        </span>
      </div>

      <p className="mt-1.5 text-[11px] leading-relaxed text-ink">{proposal.content}</p>

      {proposal.reason && (
        <p className="mt-1 text-[9px] text-muted">{proposal.reason}</p>
      )}

      {conflict && (
        <div className="mt-2 rounded-lg border border-warning/20 bg-warning-soft px-2 py-1.5">
          <p className="text-[8px] font-medium tracking-wide text-warning uppercase">
            Conflicts with an existing memory
          </p>
          <p className="mt-0.5 text-[9px] leading-relaxed text-warning">
            {proposal.conflict_content ?? 'The conflicting memory is no longer shown.'}
          </p>
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-border/70 pt-1.5">
        <span className="mr-auto inline-flex items-center gap-2">
          <SourceButton commitId={proposal.commit_id} />
        </span>
        <CompactAction
          label={`Edit proposal: ${proposal.content}`}
          disabled={disabled || saving}
          onClick={() => setEditing(true)}
        >
          <Pencil size={11} aria-hidden />
        </CompactAction>
        <CompactAction
          label={`Reject proposal: ${proposal.content}`}
          disabled={disabled || saving}
          danger
          onClick={onReject}
        >
          <X size={11} aria-hidden />
        </CompactAction>
        {conflict ? (
          <>
            <Button
              variant="secondary"
              size="sm"
              disabled={disabled || saving}
              onClick={() => accept('keep_both')}
            >
              Keep both
            </Button>
            <Button
              size="sm"
              disabled={disabled || saving}
              onClick={() => accept('replace')}
            >
              Replace old
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            loading={saving}
            disabled={disabled}
            onClick={() => accept()}
            leadingIcon={!saving ? <Check size={11} aria-hidden /> : undefined}
          >
            Accept
          </Button>
        )}
      </div>
    </article>
  )
}

function GroupHeading({
  label,
  count,
  hint,
}: {
  label: string
  count: number
  hint?: string
}) {
  return (
    <div className="mb-2 flex items-start justify-between gap-2 px-1">
      <div>
        <p className="text-[10px] font-medium tracking-wide text-muted uppercase">
          {label}
        </p>
        {hint && <p className="mt-0.5 text-[9px] leading-relaxed text-muted/80">{hint}</p>}
      </div>
      <span className="rounded-full bg-subtle px-1.5 py-0.5 font-mono text-[8px] text-muted">
        {count}
      </span>
    </div>
  )
}

export function MemoryPanel({ branch }: { branch: Branch }) {
  const refreshBranch = useWorkspaceStore((state) => state.refreshBranch)
  const pushToast = useUiStore((state) => state.pushToast)
  const [data, setData] = useState<MemoryList | null>(null)
  const [proposals, setProposals] = useState<MemoryProposal[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState('all')
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([
      api.get<MemoryList>(`/branches/${branch.id}/memories`, controller.signal),
      api.get<MemoryProposal[]>(`/branches/${branch.id}/proposals`, controller.signal),
    ])
      .then(([memories, pending]) => {
        setData(memories)
        setProposals(pending)
        setLoading(false)
      })
      .catch((caught) => {
        if (controller.signal.aborted) return
        setError(errorMessage(caught))
        setLoading(false)
      })
    return () => controller.abort()
  }, [branch.id, branch.message_count, branch.memory_count, reloadKey])

  const refresh = async () => {
    setRefreshing(true)
    try {
      const [memories, pending] = await Promise.all([
        api.get<MemoryList>(`/branches/${branch.id}/memories`),
        api.get<MemoryProposal[]>(`/branches/${branch.id}/proposals`),
      ])
      setData(memories)
      setProposals(pending)
      setError(null)
    } finally {
      setRefreshing(false)
    }
  }

  const mutate = async (
    key: string,
    action: () => Promise<void>,
    success: [string, string],
  ) => {
    setBusy(key)
    setActionError(null)
    try {
      await action()
      await refresh()
      void refreshBranch(branch.id)
      pushToast('success', success[0], success[1])
    } catch (caught) {
      const message = errorMessage(caught)
      setActionError(message)
      pushToast('error', 'Memory update failed', message)
    } finally {
      setBusy(null)
    }
  }

  const createMemory = (draft: MemoryDraft) => {
    void mutate(
      'create',
      async () => {
        await api.post<Memory>(`/branches/${branch.id}/memories`, draft)
        setAdding(false)
      },
      ['Memory saved', 'It will be considered on the next reply.'],
    )
  }

  const updateMemory = (memory: Memory, draft: MemoryDraft) => {
    void mutate(
      `edit:${memory.id}`,
      async () => {
        if (memory.inherited) {
          await api.post<Memory>(
            `/branches/${branch.id}/memories/${memory.id}/override`,
            { action: 'edit', content: draft.content },
          )
        } else {
          await api.patch<Memory>(
            `/branches/${branch.id}/memories/${memory.id}`,
            draft,
          )
        }
        setEditingId(null)
      },
      ['Memory updated', memory.inherited ? 'Only this branch was changed.' : 'The memory was updated.'],
    )
  }

  const togglePin = (memory: Memory) => {
    void mutate(
      `pin:${memory.id}`,
      async () => {
        await api.post<Memory>(
          `/branches/${branch.id}/memories/${memory.id}/override`,
          { action: memory.pinned ? 'unpin' : 'pin' },
        )
      },
      [
        memory.pinned ? 'Memory unpinned' : 'Memory pinned',
        memory.pinned
          ? 'It will be ranked normally.'
          : 'It will always be included when visible.',
      ],
    )
  }

  const override = (memory: Memory, action: 'exclude' | 'include') => {
    void mutate(
      `${action}:${memory.id}`,
      async () => {
        await api.post<Memory>(
          `/branches/${branch.id}/memories/${memory.id}/override`,
          { action },
        )
      },
      action === 'exclude'
        ? ['Memory excluded', 'Upstream memory was not changed.']
        : ['Memory restored', 'It is effective on this branch again.'],
    )
  }

  const deleteMemory = (memory: Memory) => {
    void mutate(
      `delete:${memory.id}`,
      async () => {
        await api.delete(`/branches/${branch.id}/memories/${memory.id}`)
      },
      ['Memory deleted', 'The memory was removed from this space.'],
    )
  }

  const acceptProposal = (proposal: MemoryProposal, draft: AcceptDraft) => {
    void mutate(
      `accept:${proposal.id}`,
      async () => {
        const body: Record<string, unknown> = {
          resolution: draft.resolution,
        }
        if (
          draft.content !== proposal.content ||
          draft.kind !== proposal.kind ||
          draft.importance !== proposal.importance
        ) {
          body.content = draft.content
          body.kind = draft.kind
          body.importance = draft.importance
        }
        await api.post(
          `/branches/${branch.id}/proposals/${proposal.id}/accept`,
          body,
        )
      },
      [
        'Memory accepted',
        draft.resolution === 'replace'
          ? 'The conflicting memory was superseded.'
          : 'The memory is now effective on this branch.',
      ],
    )
  }

  const rejectProposal = (proposal: MemoryProposal) => {
    void mutate(
      `reject:${proposal.id}`,
      async () => {
        await api.post(
          `/branches/${branch.id}/proposals/${proposal.id}/reject`,
        )
      },
      ['Proposal rejected', 'Nothing was added to memory.'],
    )
  }

  const memories = useMemo(() => data?.memories ?? [], [data])
  const excluded = useMemo(() => data?.excluded ?? [], [data])
  const normalizedQuery = query.trim().toLowerCase()
  const own = memories.filter(
    (memory) => !memory.inherited && matchMemory(memory, normalizedQuery, kind),
  )
  const inherited = memories.filter(
    (memory) => memory.inherited && matchMemory(memory, normalizedQuery, kind),
  )
  const visibleExcluded = excluded.filter((memory) =>
    matchMemory(memory, normalizedQuery, kind),
  )
  const visibleProposals = proposals.filter((proposal) => {
    if (kind !== 'all' && proposal.kind !== kind) return false
    return !normalizedQuery || proposal.content.toLowerCase().includes(normalizedQuery)
  })
  const noMatches =
    normalizedQuery.length > 0 || kind !== 'all'
      ? own.length === 0 &&
        inherited.length === 0 &&
        visibleExcluded.length === 0 &&
        visibleProposals.length === 0
      : false

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted">
        <Spinner className="size-5" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="px-3 py-10 text-center">
        <p className="text-[11px] leading-relaxed text-danger">{error}</p>
        <button
          type="button"
          onClick={() => {
            setLoading(true)
            setError(null)
            setReloadKey((value) => value + 1)
          }}
          className="mt-3 text-[11px] font-medium text-accent-ink hover:underline"
        >
          Try again
        </button>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-3 flex items-start justify-between gap-2 px-1">
        <div>
          <p className="text-[11px] font-medium text-ink">Effective memory</p>
          <p className="text-[10px] text-muted">
            {plural(memories.length, 'memory', 'memories')} used here
            {proposals.length > 0 ? ` / ${proposals.length} pending` : ''}
          </p>
        </div>
        <div className="flex items-center gap-0.5">
          {!branch.archived && (
            <IconButton
              label="Add memory"
              active={adding}
              onClick={() => {
                setAdding((value) => !value)
                setEditingId(null)
              }}
            >
              <Plus size={14} aria-hidden />
            </IconButton>
          )}
          <IconButton
            label="Refresh memories"
            disabled={refreshing}
            onClick={() => void refresh()}
          >
            <RefreshCw size={14} className={cn(refreshing && 'animate-spin')} aria-hidden />
          </IconButton>
        </div>
      </div>

      {branch.archived && (
        <p className="mb-3 rounded-lg border border-warning/20 bg-warning-soft px-2.5 py-2 text-[9px] leading-relaxed text-warning">
          This branch is archived. Memory is read-only; restore the branch to make changes.
        </p>
      )}

      {actionError && (
        <div className="mb-3 flex items-start gap-1.5 rounded-lg border border-danger/20 bg-danger-soft px-2.5 py-2 text-[9px] leading-relaxed text-danger">
          <TriangleAlert size={11} className="mt-0.5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">{actionError}</span>
          <button
            type="button"
            aria-label="Dismiss memory error"
            onClick={() => setActionError(null)}
            className="shrink-0 text-danger/70 hover:text-danger"
          >
            <X size={11} aria-hidden />
          </button>
        </div>
      )}

      {adding && !branch.archived && (
        <div className="mb-3 rounded-xl border border-accent/35 bg-accent-soft/20 p-2.5">
          <p className="mb-2 text-[9px] font-medium tracking-wide text-accent-ink uppercase">
            Add a memory
          </p>
          <MemoryEditor
            saving={busy === 'create'}
            submitLabel="Save memory"
            contentOnly={false}
            onSave={createMemory}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}

      {(proposals.length > 0 || memories.length > 0 || excluded.length > 0) && (
        <div className="mb-3 space-y-1.5">
          <div className="relative">
            <Search
              size={12}
              className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted"
              aria-hidden
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search memory"
              aria-label="Search memory"
              className={cn(fieldClass, 'h-8 pr-7 pl-7')}
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear memory search"
                className="absolute top-1/2 right-2 grid size-5 -translate-y-1/2 place-items-center rounded text-muted hover:bg-hover hover:text-ink"
              >
                <X size={10} aria-hidden />
              </button>
            )}
          </div>
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value)}
            aria-label="Filter memory kind"
            className={cn(fieldClass, 'h-8')}
          >
            <option value="all">All kinds</option>
            {memoryKinds.map((value) => (
              <option key={value} value={value}>
                {sentenceCase(value)}
              </option>
            ))}
          </select>
        </div>
      )}

      {visibleProposals.length > 0 && (
        <section className="mb-4">
          <GroupHeading
            label="Pending proposals"
            count={visibleProposals.length}
            hint="Review what the assistant wants to remember."
          />
          <div className="space-y-2">
            {visibleProposals.map((proposal) => (
              <ProposalCard
                key={proposal.id}
                proposal={proposal}
                disabled={branch.archived}
                saving={busy === `accept:${proposal.id}`}
                onAccept={(draft) => acceptProposal(proposal, draft)}
                onReject={() => rejectProposal(proposal)}
              />
            ))}
          </div>
        </section>
      )}

      {visibleProposals.length === 0 && proposals.length > 0 && noMatches && (
        <p className="mb-4 rounded-lg bg-subtle/55 px-2.5 py-2 text-[9px] text-muted">
          No pending proposals match this filter.
        </p>
      )}

      {own.length > 0 && (
        <section className="mb-4">
          <GroupHeading label="Own memories" count={own.length} />
          <div className="space-y-2">
            {own.map((memory) => (
              <MemoryCard
                key={memory.id}
                memory={memory}
                disabled={branch.archived}
                busy={Boolean(busy?.endsWith(`:${memory.id}`))}
                onPin={() => togglePin(memory)}
                onEdit={() => setEditingId(memory.id)}
                onExclude={() => override(memory, 'exclude')}
                onInclude={() => override(memory, 'include')}
                onDelete={() => deleteMemory(memory)}
                editor={
                  editingId === memory.id ? (
                    <MemoryEditor
                      initial={{
                        content: memory.content,
                        kind: memory.kind,
                        importance: memory.importance,
                      }}
                      saving={busy === `edit:${memory.id}`}
                      submitLabel="Save"
                      onSave={(draft) => updateMemory(memory, draft)}
                      onCancel={() => setEditingId(null)}
                    />
                  ) : undefined
                }
              />
            ))}
          </div>
        </section>
      )}

      {inherited.length > 0 && (
        <section className="mb-4">
          <GroupHeading
            label="Inherited"
            count={inherited.length}
            hint="Pin, edit, or exclude without changing the upstream memory."
          />
          <div className="space-y-2">
            {inherited.map((memory) => (
              <MemoryCard
                key={memory.id}
                memory={memory}
                disabled={branch.archived}
                busy={Boolean(busy?.endsWith(`:${memory.id}`))}
                onPin={() => togglePin(memory)}
                onEdit={() => setEditingId(memory.id)}
                onExclude={() => override(memory, 'exclude')}
                onInclude={() => override(memory, 'include')}
                onDelete={() => deleteMemory(memory)}
                editor={
                  editingId === memory.id ? (
                    <MemoryEditor
                      initial={{
                        content: memory.content,
                        kind: memory.kind,
                        importance: memory.importance,
                      }}
                      saving={busy === `edit:${memory.id}`}
                      submitLabel="Save here"
                      contentOnly
                      onSave={(draft) => updateMemory(memory, draft)}
                      onCancel={() => setEditingId(null)}
                    />
                  ) : undefined
                }
              />
            ))}
          </div>
        </section>
      )}

      {visibleExcluded.length > 0 && (
        <section className="mb-4">
          <GroupHeading
            label="Excluded here"
            count={visibleExcluded.length}
            hint="Hidden from this branch only."
          />
          <div className="space-y-2">
            {visibleExcluded.map((memory) => (
              <MemoryCard
                key={memory.id}
                memory={memory}
                excluded
                disabled={branch.archived}
                busy={Boolean(busy?.endsWith(`:${memory.id}`))}
                onPin={() => togglePin(memory)}
                onEdit={() => undefined}
                onExclude={() => undefined}
                onInclude={() => override(memory, 'include')}
                onDelete={() => undefined}
              />
            ))}
          </div>
        </section>
      )}

      {noMatches && (
        <div className="rounded-xl border border-dashed border-border bg-subtle/40 px-3 py-5 text-center">
          <p className="text-[10px] font-medium text-ink">No matching memory</p>
          <p className="mt-1 text-[10px] text-muted">
            Try another phrase or switch the kind filter.
          </p>
          <button
            type="button"
            onClick={() => {
              setQuery('')
              setKind('all')
            }}
            className="mt-2 text-[10px] font-medium text-accent-ink hover:underline"
          >
            Clear filters
          </button>
        </div>
      )}

      {memories.length === 0 && proposals.length === 0 && excluded.length === 0 && (
        <div className="flex flex-col items-center px-4 py-10 text-center">
          <span className="mb-3 grid size-10 place-items-center rounded-xl bg-subtle text-muted">
            <Brain size={18} aria-hidden />
          </span>
          <h3 className="text-xs font-medium text-ink">No memories yet</h3>
          <p className="mt-1.5 max-w-[230px] text-[11px] leading-relaxed text-muted">
            Durable facts and preferences from conversations will collect here. You can
            also add one directly.
          </p>
        </div>
      )}
    </div>
  )
}
