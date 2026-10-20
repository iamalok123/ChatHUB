import {
  Archive,
  ArchiveRestore,
  GitCompare,
  GitFork,
  MoreHorizontal,
  Pencil,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { api, errorMessage } from '../../api/client'
import type { Branch } from '../../api/types'
import { branchAncestors } from '../../lib/branchTree'
import { cn } from '../../lib/cn'
import { useOperationsStore } from '../../store/operations'
import { useUiStore } from '../../store/ui'
import { useWorkspaceStore } from '../../store/workspace'

function MenuItem({
  icon,
  label,
  onClick,
  disabled = false,
  danger = false,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] transition-colors disabled:opacity-45',
        danger
          ? 'text-danger hover:bg-danger-soft'
          : 'text-ink hover:bg-hover',
      )}
    >
      {icon}
      {label}
    </button>
  )
}

export function BranchMenu({ branch }: { branch: Branch }) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const openFork = useOperationsStore((state) => state.openFork)
  const openRename = useOperationsStore((state) => state.openRename)
  const openCompare = useOperationsStore((state) => state.openCompare)
  const branches = useWorkspaceStore((state) => state.branches)
  const upsertBranch = useWorkspaceStore((state) => state.upsertBranch)
  const pushToast = useUiStore((state) => state.pushToast)
  const hasAncestor = branchAncestors(branches, branch.id).length > 0

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const setArchived = async (archived: boolean) => {
    setPending(true)
    try {
      const updated = await api.patch<Branch>(`/branches/${branch.id}`, { archived })
      upsertBranch(updated)
      pushToast(
        'success',
        archived ? 'Branch archived' : 'Branch restored',
        archived
          ? 'Its history and memories remain available in the sidebar.'
          : `${updated.name} can accept messages again.`,
      )
    } catch (caught) {
      pushToast(
        'error',
        archived ? 'Could not archive branch' : 'Could not restore branch',
        errorMessage(caught),
      )
    } finally {
      setPending(false)
      setOpen(false)
    }
  }

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        aria-label={`Actions for ${branch.name}`}
        title={`Actions for ${branch.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'grid size-6 place-items-center rounded-md text-muted transition-all hover:bg-surface hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/30 focus-visible:outline-none',
          open
            ? 'bg-surface text-ink opacity-100'
            : 'opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100',
        )}
      >
        <MoreHorizontal size={14} aria-hidden />
      </button>
      {open && (
        <div
          role="menu"
          aria-label={`Actions for ${branch.name}`}
          className="absolute top-full right-0 z-40 mt-1 w-40 animate-fade-in rounded-lg border border-border bg-surface p-1 shadow-float"
        >
          <MenuItem
            icon={<GitFork size={13} aria-hidden />}
            label="Fork branch"
            disabled={!branch.head_commit_id}
            onClick={() => {
              setOpen(false)
              if (branch.head_commit_id) {
                openFork({ branchId: branch.id, commitId: branch.head_commit_id })
              }
            }}
          />
          {hasAncestor && (
            <MenuItem
              icon={<GitCompare size={13} aria-hidden />}
              label="Compare with ancestor"
              onClick={() => {
                setOpen(false)
                openCompare(branch.id)
              }}
            />
          )}
          <MenuItem
            icon={<Pencil size={13} aria-hidden />}
            label="Rename"
            onClick={() => {
              setOpen(false)
              openRename(branch.id)
            }}
          />
          {!branch.is_root && (
            <MenuItem
              icon={
                branch.archived ? (
                  <ArchiveRestore size={13} aria-hidden />
                ) : (
                  <Archive size={13} aria-hidden />
                )
              }
              label={branch.archived ? 'Restore branch' : 'Archive branch'}
              disabled={pending}
              danger={!branch.archived}
              onClick={() => void setArchived(!branch.archived)}
            />
          )}
        </div>
      )}
    </div>
  )
}
