import {
  Archive,
  ArchiveRestore,
  Bookmark,
  BookmarkPlus,
  GitFork,
  Pencil,
  TriangleAlert,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'

import { api, errorMessage } from '../../api/client'
import type { Branch, Checkpoint } from '../../api/types'
import { plural } from '../../lib/format'
import { useOperationsStore } from '../../store/operations'
import { useUiStore } from '../../store/ui'
import { useWorkspaceStore } from '../../store/workspace'
import { Button } from '../ui/Button'
import { Spinner } from '../ui/Spinner'

function shortDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function BranchAdminPanel({ branch }: { branch: Branch }) {
  const openRename = useOperationsStore((state) => state.openRename)
  const openFork = useOperationsStore((state) => state.openFork)
  const upsertBranch = useWorkspaceStore((state) => state.upsertBranch)
  const pushToast = useUiStore((state) => state.pushToast)
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([])
  const [checkpointName, setCheckpointName] = useState('')
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    api
      .get<Checkpoint[]>(`/branches/${branch.id}/checkpoints`, controller.signal)
      .then((result) => {
        setCheckpoints(result)
        setLoading(false)
      })
      .catch((caught) => {
        if (controller.signal.aborted) return
        setError(errorMessage(caught))
        setLoading(false)
      })
    return () => controller.abort()
  }, [branch.id])

  const createCheckpoint = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!checkpointName.trim() || branch.archived) return
    setCreating(true)
    setError(null)
    try {
      const created = await api.post<Checkpoint>(
        `/branches/${branch.id}/checkpoints`,
        { name: checkpointName.trim() },
      )
      setCheckpoints((current) => [created, ...current])
      setCheckpointName('')
      pushToast('success', 'Checkpoint saved', created.name)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setCreating(false)
    }
  }

  const toggleArchive = async () => {
    setArchiving(true)
    setError(null)
    try {
      const updated = await api.patch<Branch>(`/branches/${branch.id}`, {
        archived: !branch.archived,
      })
      upsertBranch(updated)
      setConfirmArchive(false)
      pushToast(
        'success',
        updated.archived ? 'Branch archived' : 'Branch restored',
        updated.archived
          ? `${updated.name} is read-only. Its memory stays inspectable.`
          : `${updated.name} can accept messages again.`,
      )
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setArchiving(false)
    }
  }

  return (
    <div className="mt-4 space-y-4">
      <section>
        <p className="mb-1.5 px-1 text-[10px] font-medium tracking-wide text-muted uppercase">
          Branch actions
        </p>
        <div className="rounded-xl border border-border bg-surface p-2 shadow-soft">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="flex-1 justify-start"
              onClick={() => openRename(branch.id)}
              leadingIcon={<Pencil size={12} aria-hidden />}
            >
              Rename
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="flex-1 justify-start"
              disabled={!branch.head_commit_id}
              onClick={() =>
                branch.head_commit_id &&
                openFork({ branchId: branch.id, commitId: branch.head_commit_id })
              }
              leadingIcon={<GitFork size={12} aria-hidden />}
            >
              Fork
            </Button>
          </div>
          {!branch.is_root && (
            <div className="mt-1 border-t border-border/70 pt-1">
              {confirmArchive ? (
                <div className="rounded-lg bg-warning-soft px-2.5 py-2">
                  <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-warning">
                    <TriangleAlert size={11} className="mt-0.5 shrink-0" aria-hidden />
                    {branch.archived
                      ? 'Restore this branch so it can accept messages again?'
                      : 'Archive this branch? It becomes read-only, but history and memory stay available.'}
                  </p>
                  <div className="mt-2 flex justify-end gap-1.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirmArchive(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant={branch.archived ? 'secondary' : 'danger'}
                      size="sm"
                      loading={archiving}
                      onClick={() => void toggleArchive()}
                    >
                      {branch.archived ? 'Restore' : 'Archive'}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start"
                  onClick={() => setConfirmArchive(true)}
                  leadingIcon={
                    branch.archived ? (
                      <ArchiveRestore size={12} aria-hidden />
                    ) : (
                      <Archive size={12} aria-hidden />
                    )
                  }
                >
                  {branch.archived ? 'Restore branch' : 'Archive branch'}
                </Button>
              )}
            </div>
          )}
        </div>
      </section>

      <section>
        <div className="mb-1.5 flex items-center justify-between px-1">
          <p className="text-[10px] font-medium tracking-wide text-muted uppercase">
            Checkpoints
          </p>
          <span className="text-[9px] tabular-nums text-muted/70">
            {checkpoints.length}
          </span>
        </div>
        <div className="rounded-xl border border-border bg-surface p-2.5 shadow-soft">
          <form onSubmit={createCheckpoint} className="flex items-center gap-1.5">
            <div className="relative min-w-0 flex-1">
              <BookmarkPlus
                size={12}
                className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted"
                aria-hidden
              />
              <input
                value={checkpointName}
                onChange={(event) => setCheckpointName(event.target.value)}
                placeholder="Name this point…"
                aria-label="Checkpoint name"
                maxLength={120}
                disabled={branch.archived}
                className="h-8 w-full rounded-lg border border-border bg-bg/45 pr-2 pl-7 text-[11px] text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
              />
            </div>
            <Button
              type="submit"
              size="sm"
              variant="secondary"
              loading={creating}
              disabled={!checkpointName.trim() || branch.archived}
            >
              Save
            </Button>
          </form>

          <p className="mt-2 text-[9px] leading-relaxed text-muted">
            Checkpoints mark this branch&apos;s current head. Fork from one to reopen
            that exact moment with the full memory checklist.
          </p>

          {loading ? (
            <div className="flex justify-center py-4 text-muted">
              <Spinner className="size-4" />
            </div>
          ) : checkpoints.length === 0 ? (
            <p className="mt-2 rounded-lg bg-subtle/55 px-2.5 py-3 text-center text-[10px] text-muted">
              No checkpoints yet.
            </p>
          ) : (
            <div className="mt-2 space-y-1.5">
              {checkpoints.map((checkpoint) => (
                <div
                  key={checkpoint.id}
                  className="rounded-lg border border-border/80 bg-bg/35 px-2.5 py-2"
                >
                  <div className="flex items-start gap-2">
                    <Bookmark size={11} className="mt-0.5 shrink-0 text-accent" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[10px] font-medium text-ink">
                        {checkpoint.name}
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-[9px] leading-relaxed text-muted">
                        {checkpoint.preview}
                      </p>
                      <p className="mt-1 text-[8px] text-muted/75">
                        {shortDate(checkpoint.created_at)} · {checkpoint.commit_role}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        openFork({
                          branchId: branch.id,
                          commitId: checkpoint.commit_id,
                          nameHint: checkpoint.name,
                        })
                      }
                      aria-label={`Fork from checkpoint ${checkpoint.name}`}
                      title="Fork from checkpoint"
                      className="grid size-6 shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-surface hover:text-ink"
                    >
                      <GitFork size={12} aria-hidden />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-[10px] text-danger">
          {error}
        </p>
      )}

      {!branch.archived && checkpoints.length > 0 && (
        <p className="px-1 text-[9px] leading-relaxed text-muted">
          {plural(checkpoints.length, 'checkpoint')} on this branch.
        </p>
      )}
    </div>
  )
}
