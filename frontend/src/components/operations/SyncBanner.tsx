import { ArrowDownToLine } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api } from '../../api/client'
import type { Branch, SyncPreview } from '../../api/types'
import { plural } from '../../lib/format'
import { useOperationsStore } from '../../store/operations'

export function SyncBanner({ branch }: { branch: Branch }) {
  const openSync = useOperationsStore((state) => state.openSync)
  const syncRevision = useOperationsStore((state) => state.syncRevision)
  const [preview, setPreview] = useState<SyncPreview | null>(null)

  useEffect(() => {
    if (!branch.parent_branch_id || branch.archived) return
    const controller = new AbortController()
    api
      .get<SyncPreview>(`/branches/${branch.id}/sync-preview`, controller.signal)
      .then((result) => setPreview(result))
      .catch(() => {
        if (!controller.signal.aborted) setPreview(null)
      })
    return () => controller.abort()
  }, [
    branch.archived,
    branch.head_commit_id,
    branch.id,
    branch.memory_count,
    branch.parent_branch_id,
    syncRevision,
  ])

  if (!preview) return null
  const duplicateIds = new Set(preview.duplicates.map((item) => item.memory_id))
  const newCount = preview.memories.filter(
    (memory) => !duplicateIds.has(memory.id),
  ).length
  if (newCount === 0) return null

  return (
    <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-accent/20 bg-accent-soft/55 px-3.5 py-2.5">
      <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-surface text-accent">
        <ArrowDownToLine size={14} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium text-ink">
          {plural(newCount, 'new memory', 'new memories')} upstream
        </p>
        <p className="text-[10px] text-muted">
          {preview.parent_name} learned something after this fork.
        </p>
      </div>
      <button
        type="button"
        onClick={() => openSync(branch.id)}
        className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[10px] font-medium text-ink shadow-soft transition-colors hover:bg-hover"
      >
        Review sync
      </button>
    </div>
  )
}
