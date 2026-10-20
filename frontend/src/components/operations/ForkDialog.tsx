import { ArrowLeft, ArrowRight, GitFork, Search } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api, errorMessage } from '../../api/client'
import type { Branch, ForkPreview } from '../../api/types'
import { cn } from '../../lib/cn'
import { plural, sentenceCase } from '../../lib/format'
import { useOperationsStore } from '../../store/operations'
import type { ForkTarget } from '../../store/operations'
import { useUiStore } from '../../store/ui'
import { useWorkspaceStore } from '../../store/workspace'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { Field, TextInput, Textarea } from '../ui/Field'
import { Spinner } from '../ui/Spinner'
import { MemoryChoice } from './MemoryChoice'

export function ForkDialog({ target }: { target: ForkTarget }) {
  const close = useOperationsStore((state) => state.closeFork)
  const branch = useWorkspaceStore((state) =>
    state.branches.find((item) => item.id === target.branchId),
  )
  const addAndSelectBranch = useWorkspaceStore((state) => state.addAndSelectBranch)
  const pushToast = useUiStore((state) => state.pushToast)
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [name, setName] = useState(
    target.nameHint ?? (branch ? `${branch.name} fork` : 'New branch'),
  )
  const [persona, setPersona] = useState(branch?.persona ?? '')
  const [preview, setPreview] = useState<ForkPreview | null>(null)
  const [kept, setKept] = useState<Set<string>>(new Set())
  const [pinned, setPinned] = useState<Set<string>>(new Set())
  const [initiallyPinned, setInitiallyPinned] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    api
      .get<ForkPreview>(
        `/branches/${target.branchId}/fork-preview?commit_id=${encodeURIComponent(target.commitId)}`,
        controller.signal,
      )
      .then((result) => {
        setPreview(result)
        setKept(new Set(result.memories.map((memory) => memory.id)))
        const pinnedIds = result.memories
          .filter((memory) => memory.pinned)
          .map((memory) => memory.id)
        setPinned(new Set(pinnedIds))
        setInitiallyPinned(new Set(pinnedIds))
        setLoading(false)
      })
      .catch((caught) => {
        if (controller.signal.aborted) return
        setLoadError(errorMessage(caught))
        setLoading(false)
      })
    return () => controller.abort()
  }, [reloadKey, target.branchId, target.commitId])

  const retryPreview = () => {
    setLoading(true)
    setLoadError(null)
    setReloadKey((value) => value + 1)
  }

  const stepName = step === 1 ? 'Branch' : step === 2 ? 'Memory' : 'Review'
  const memories = preview?.memories ?? []
  const normalizedQuery = query.trim().toLowerCase()
  const filtered = normalizedQuery
    ? memories.filter(
        (memory) =>
          memory.content.toLowerCase().includes(normalizedQuery) ||
          memory.kind.toLowerCase().includes(normalizedQuery),
      )
    : memories
  const keptCount = kept.size
  const pinnedCount = [...pinned].filter((id) => kept.has(id)).length

  const toggleKept = (memoryId: string) => {
    const removing = kept.has(memoryId)
    setKept((current) => {
      const next = new Set(current)
      if (removing) next.delete(memoryId)
      else next.add(memoryId)
      return next
    })
    if (removing) {
      setPinned((current) => {
        const next = new Set(current)
        next.delete(memoryId)
        return next
      })
    }
  }

  const togglePinned = (memoryId: string) => {
    setPinned((current) => {
      const next = new Set(current)
      if (next.has(memoryId)) next.delete(memoryId)
      else next.add(memoryId)
      return next
    })
    setKept((current) => new Set(current).add(memoryId))
  }

  const next = () => {
    setSubmitError(null)
    if (step === 1) {
      if (!name.trim()) {
        setSubmitError('Give the new branch a name.')
        return
      }
      setStep(2)
      return
    }
    if (step === 2) {
      setStep(3)
    }
  }

  const submit = async () => {
    if (!name.trim() || !preview) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const created = await api.post<Branch>(`/branches/${target.branchId}/fork`, {
        name: name.trim(),
        commit_id: target.commitId,
        persona,
        exclude_memory_ids: preview.memories
          .filter((memory) => !kept.has(memory.id))
          .map((memory) => memory.id),
        pin_memory_ids: [...pinned].filter((memoryId) => kept.has(memoryId)),
        unpin_memory_ids: [...initiallyPinned].filter(
          (memoryId) => kept.has(memoryId) && !pinned.has(memoryId),
        ),
      })
      addAndSelectBranch(created)
      useUiStore.getState().setSidebarOpen(false)
      pushToast(
        'success',
        'Branch forked',
        `${created.name} keeps ${plural(keptCount, 'memory', 'memories')}.`,
      )
      close()
    } catch (caught) {
      setSubmitError(errorMessage(caught))
    } finally {
      setSubmitting(false)
    }
  }

  const footer = (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[10px] text-muted">
        Step {step} of 3 · {stepName}
      </span>
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => (step === 1 ? close() : setStep((step - 1) as 1 | 2))}
        >
          {step === 1 ? 'Cancel' : 'Back'}
        </Button>
        {step < 3 ? (
          <Button
            size="sm"
            onClick={next}
            disabled={loading || Boolean(loadError)}
            trailingIcon={<ArrowRight size={13} aria-hidden />}
          >
            Continue
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={() => void submit()}
            loading={submitting}
            disabled={!preview}
            leadingIcon={<GitFork size={13} aria-hidden />}
          >
            Create fork
          </Button>
        )}
      </div>
    </div>
  )

  return (
    <Dialog
      open
      onClose={close}
      title="Fork this branch"
      description="Start a new thread at this point. Choose which inherited memories come with it."
      footer={footer}
      size="md"
    >
      <div className="mb-5 grid grid-cols-3 gap-1.5" aria-label="Fork steps">
        {(['Branch', 'Memory', 'Review'] as const).map((label, index) => {
          const value = index + 1
          return (
            <div key={label} className="flex items-center gap-1.5">
              <span
                className={cn(
                  'grid size-5 shrink-0 place-items-center rounded-full text-[9px] font-semibold',
                  step >= value
                    ? 'bg-accent text-white'
                    : 'bg-subtle text-muted',
                )}
              >
                {value}
              </span>
              <span
                className={cn(
                  'text-[10px]',
                  step === value ? 'font-medium text-ink' : 'text-muted',
                )}
              >
                {label}
              </span>
            </div>
          )
        })}
      </div>

      {step === 1 && (
        <div className="space-y-4">
          <Field label="Branch name" htmlFor="fork-name" hint="Forked branches keep their own name and settings.">
            <TextInput
              id="fork-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={120}
              required
              autoFocus
              data-autofocus
            />
          </Field>
          <Field
            label="Goal or persona"
            htmlFor="fork-persona"
            optional
            hint="Inherited from the source branch. Edit it to give this fork a different voice."
          >
            <Textarea
              id="fork-persona"
              value={persona}
              onChange={(event) => setPersona(event.target.value)}
              rows={3}
              maxLength={8000}
              placeholder="A focused branch for product decisions."
            />
          </Field>

          <div className="rounded-xl border border-border bg-subtle/55 p-3">
            <p className="text-[10px] font-medium tracking-wide text-muted uppercase">
              Fork point
            </p>
            {loading ? (
              <div className="mt-3 flex items-center gap-2 text-[11px] text-muted">
                <Spinner className="size-3.5" />
                Reading memories at this point…
              </div>
            ) : loadError ? (
              <div className="mt-2">
                <p className="text-[11px] text-danger">{loadError}</p>
                <button
                  type="button"
                  onClick={retryPreview}
                  className="mt-2 text-[11px] font-medium text-accent-ink hover:underline"
                >
                  Try again
                </button>
              </div>
            ) : preview ? (
              <div className="mt-2 flex items-center justify-between gap-3 text-[11px]">
                <div>
                  <p className="font-medium text-ink">
                    {branch?.name ?? 'Source branch'} · {sentenceCase(preview.commit_role)}
                  </p>
                  <p className="mt-0.5 text-muted">
                    {plural(memories.length, 'memory', 'memories')} available at the fork point
                  </p>
                </div>
                <GitFork size={18} className="shrink-0 text-accent/70" aria-hidden />
              </div>
            ) : null}
          </div>

          {submitError && (
            <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
              {submitError}
            </p>
          )}
        </div>
      )}

      {step === 2 && (
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-medium text-ink">
                Keeping {keptCount} of {memories.length}{' '}
                {memories.length === 1 ? 'memory' : 'memories'}
              </p>
              <p className="mt-0.5 text-[10px] text-muted">
                {plural(pinnedCount, 'memory', 'memories')} pinned for retrieval
              </p>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setKept(new Set(memories.map((memory) => memory.id)))}
                className="rounded-md px-1.5 py-1 text-[10px] font-medium text-muted hover:bg-hover hover:text-ink"
              >
                Keep all
              </button>
              <button
                type="button"
                onClick={() => {
                  setKept(new Set())
                  setPinned(new Set())
                }}
                className="rounded-md px-1.5 py-1 text-[10px] font-medium text-muted hover:bg-hover hover:text-ink"
              >
                Keep none
              </button>
              <button
                type="button"
                onClick={() => setKept(new Set(pinned))}
                className="rounded-md px-1.5 py-1 text-[10px] font-medium text-muted hover:bg-hover hover:text-ink"
              >
                Pinned only
              </button>
            </div>
          </div>

          <div className="relative mt-3">
            <Search
              size={13}
              className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted"
              aria-hidden
            />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search memories…"
              aria-label="Search inherited memories"
              className="h-8 w-full rounded-lg border border-border bg-bg/50 pr-3 pl-8 text-[11px] text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none"
            />
          </div>

          {loading ? (
            <div className="flex justify-center py-10 text-muted">
              <Spinner className="size-5" />
            </div>
          ) : loadError ? (
            <div className="py-8 text-center">
              <p className="text-[11px] text-danger">{loadError}</p>
              <button
                type="button"
                onClick={retryPreview}
                className="mt-2 text-[11px] font-medium text-accent-ink hover:underline"
              >
                Try again
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-10 text-center text-[11px] text-muted">
              {memories.length === 0
                ? 'No memories were available at this fork point.'
                : 'No memories match this search.'}
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              {filtered.map((memory) => (
                <MemoryChoice
                  key={memory.id}
                  memory={memory}
                  checked={kept.has(memory.id)}
                  pinned={pinned.has(memory.id)}
                  onToggle={() => toggleKept(memory.id)}
                  onPin={() => togglePinned(memory.id)}
                />
              ))}
            </div>
          )}

          <p className="mt-3 text-[10px] leading-relaxed text-muted">
            Excluded memories stay in the source branch. This fork can never read them
            unless you include them explicitly.
          </p>
          {submitError && (
            <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
              {submitError}
            </p>
          )}
        </div>
      )}

      {step === 3 && (
        <div>
          <div className="rounded-xl border border-border bg-subtle/55 p-4">
            <div className="flex items-start gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent-ink">
                <GitFork size={17} aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">{name.trim()}</p>
                <p className="mt-0.5 text-[10px] text-muted">
                  Forked from {branch?.name ?? 'this branch'} at{' '}
                  {preview ? sentenceCase(preview.commit_role) : 'the selected point'}
                </p>
              </div>
            </div>

            <dl className="mt-4 space-y-2 border-t border-border pt-3 text-[11px]">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">Memories kept</dt>
                <dd className="font-medium text-ink">
                  {keptCount} of {memories.length}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">Pinned</dt>
                <dd className="font-medium text-ink">{pinnedCount}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">Excluded</dt>
                <dd className="font-medium text-ink">{memories.length - keptCount}</dd>
              </div>
            </dl>
          </div>

          <div className="mt-3 flex items-start gap-2 rounded-lg bg-subtle px-3 py-2.5 text-[10px] leading-relaxed text-muted">
            <ArrowLeft size={12} className="mt-0.5 shrink-0 rotate-180" aria-hidden />
            Conversation history up to this point is inherited. Messages are not copied
            into a separate branch.
          </div>

          {submitError && (
            <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
              {submitError}
            </p>
          )}
        </div>
      )}
    </Dialog>
  )
}
