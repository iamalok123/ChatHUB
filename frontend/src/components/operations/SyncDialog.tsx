import { ArrowDownToLine, RefreshCw, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api, errorMessage } from '../../api/client'
import type { SyncPreview, SyncResult } from '../../api/types'
import { plural } from '../../lib/format'
import { useOperationsStore } from '../../store/operations'
import { useUiStore } from '../../store/ui'
import { useWorkspaceStore } from '../../store/workspace'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { Spinner } from '../ui/Spinner'
import { MemoryChoice } from './MemoryChoice'

export function SyncDialog({ branchId }: { branchId: string }) {
  const close = useOperationsStore((state) => state.closeSync)
  const branch = useWorkspaceStore((state) =>
    state.branches.find((item) => item.id === branchId),
  )
  const upsertBranch = useWorkspaceStore((state) => state.upsertBranch)
  const pushToast = useUiStore((state) => state.pushToast)
  const [preview, setPreview] = useState<SyncPreview | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    api
      .get<SyncPreview>(`/branches/${branchId}/sync-preview`, controller.signal)
      .then((result) => {
        setPreview(result)
        setSelected(new Set(result.memories.map((memory) => memory.id)))
        setLoading(false)
      })
      .catch((caught) => {
        if (controller.signal.aborted) return
        setLoadError(errorMessage(caught))
        setLoading(false)
      })
    return () => controller.abort()
  }, [branchId, reloadKey])

  const memories = preview?.memories ?? []
  const duplicateIds = new Set(preview?.duplicates.map((item) => item.memory_id) ?? [])

  const toggleSelected = (memoryId: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(memoryId)) next.delete(memoryId)
      else next.add(memoryId)
      return next
    })
  }

  const submit = async () => {
    if (!branch || !preview || selected.size === 0) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const result = await api.post<SyncResult>(`/branches/${branchId}/sync`, {
        memory_ids: [...selected],
        expected_head_id: branch.head_commit_id,
      })
      upsertBranch(result.branch)
      pushToast(
        'success',
        'Upstream memories synced',
        `${plural(result.copied_count, 'memory', 'memories')} pulled from ${preview.parent_name}.`,
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
        {selected.size} of {memories.length} selected
      </span>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={close}>
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={() => void submit()}
          loading={submitting}
          disabled={loading || Boolean(loadError) || selected.size === 0}
          leadingIcon={<ArrowDownToLine size={13} aria-hidden />}
        >
          Sync selected
        </Button>
      </div>
    </div>
  )

  return (
    <Dialog
      open
      onClose={close}
      title="Sync from upstream"
      description="Pull memories created on the parent branch after this fork. Messages stay where they are."
      footer={footer}
      size="sm"
    >
      {loading ? (
        <div className="flex justify-center py-12 text-muted">
          <Spinner className="size-5" />
        </div>
      ) : loadError ? (
        <div className="py-8 text-center">
          <p className="text-[11px] leading-relaxed text-danger">{loadError}</p>
          <button
            type="button"
            onClick={() => {
              setLoading(true)
              setLoadError(null)
              setReloadKey((value) => value + 1)
            }}
            className="mt-3 inline-flex items-center gap-1 text-[11px] font-medium text-accent-ink hover:underline"
          >
            <RefreshCw size={11} aria-hidden />
            Try again
          </button>
        </div>
      ) : (
        <div>
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-xs font-medium text-ink">
                From {preview?.parent_name ?? 'parent branch'}
              </p>
              <p className="mt-0.5 text-[10px] text-muted">
                {plural(memories.length, 'new memory', 'new memories')} upstream
              </p>
            </div>
            {memories.length > 0 && (
              <button
                type="button"
                onClick={() =>
                  setSelected(
                    selected.size === memories.length
                      ? new Set()
                      : new Set(memories.map((memory) => memory.id)),
                  )
                }
                className="text-[10px] font-medium text-accent-ink hover:underline"
              >
                {selected.size === memories.length ? 'Select none' : 'Select all'}
              </button>
            )}
          </div>

          {memories.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-border bg-subtle/45 px-4 py-8 text-center">
              <ArrowDownToLine size={19} className="mx-auto text-muted" aria-hidden />
              <p className="mt-2 text-[11px] font-medium text-ink">Already up to date</p>
              <p className="mt-1 text-[10px] text-muted">
                No parent memories are waiting to be synced.
              </p>
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              {memories.map((memory) => (
                <MemoryChoice
                  key={memory.id}
                  memory={memory}
                  checked={selected.has(memory.id)}
                  duplicate={duplicateIds.has(memory.id)}
                  onToggle={() => toggleSelected(memory.id)}
                />
              ))}
            </div>
          )}

          {duplicateIds.size > 0 && (
            <p className="mt-2 text-[10px] text-muted">
              Near-duplicate memories are marked and skipped during the sync.
            </p>
          )}

          {(preview?.warnings.length ?? 0) > 0 && (
            <div className="mt-3 space-y-1.5">
              {preview?.warnings.map((warning) => (
                <p
                  key={warning}
                  className="flex items-start gap-1.5 rounded-lg bg-warning-soft px-2.5 py-2 text-[10px] leading-relaxed text-warning"
                >
                  <TriangleAlert size={11} className="mt-0.5 shrink-0" aria-hidden />
                  {warning}
                </p>
              ))}
            </div>
          )}

          <p className="mt-4 rounded-lg bg-subtle px-3 py-2.5 text-[10px] leading-relaxed text-muted">
            Sync copies only selected memories into this branch. It never copies parent
            messages or changes the parent branch.
          </p>

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
