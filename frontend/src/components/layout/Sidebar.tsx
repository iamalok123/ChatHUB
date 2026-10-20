import {
  Archive,
  Boxes,
  Check,
  ChevronDown,
  GitBranch,
  LogOut,
  Plus,
  Search,
  Settings2,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import type { Branch, Space } from '../../api/types'
import { cn } from '../../lib/cn'
import { initials, plural } from '../../lib/format'
import { useAuthStore } from '../../store/auth'
import { useUiStore } from '../../store/ui'
import {
  selectCurrentSpace,
  useWorkspaceStore,
} from '../../store/workspace'
import { BranchMenu } from '../operations/BranchMenu'
import { BrandMark } from '../ui/Brand'
import { IconButton } from '../ui/IconButton'
import { ThemeToggle } from '../ui/ThemeToggle'

type SidebarProps = {
  mobile: boolean
  onNavigate: () => void
}

function SpacePicker({
  spaces,
  currentSpace,
  onSelect,
  onNew,
}: {
  spaces: Space[]
  currentSpace: Space | null
  onSelect: (space: Space) => void
  onNew: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

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

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded-xl border border-border bg-surface px-3 py-2.5 text-left shadow-soft transition-colors hover:bg-hover"
      >
        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent-ink">
          <Boxes size={15} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] font-medium tracking-wide text-muted uppercase">
            Space
          </span>
          <span className="block truncate text-xs font-medium text-ink">
            {currentSpace?.name ?? 'Choose a space'}
          </span>
        </span>
        <ChevronDown
          size={15}
          className={cn('shrink-0 text-muted transition-transform', open && 'rotate-180')}
          aria-hidden
        />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Spaces"
          className="absolute top-full right-0 left-0 z-30 mt-1.5 animate-fade-in overflow-hidden rounded-xl border border-border bg-surface p-1 shadow-float"
        >
          <div className="max-h-64 overflow-y-auto">
            {spaces.map((space) => {
              const selected = space.id === currentSpace?.id
              return (
                <button
                  key={space.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  onClick={() => {
                    setOpen(false)
                    onSelect(space)
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-ink transition-colors hover:bg-hover"
                >
                  <span
                    className={cn(
                      'size-1.5 shrink-0 rounded-full',
                      selected ? 'bg-accent' : 'bg-border',
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">{space.name}</span>
                  {selected && <Check size={13} className="shrink-0 text-accent" aria-hidden />}
                </button>
              )
            })}
          </div>
          <div className="my-1 h-px bg-border" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onNew()
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-accent-ink transition-colors hover:bg-accent-soft"
          >
            <Plus size={14} aria-hidden />
            New space
          </button>
        </div>
      )}
    </div>
  )
}

function BranchItem({
  branch,
  depth,
  active,
  showParent,
  parentName,
  onSelect,
}: {
  branch: Branch
  depth: number
  active: boolean
  showParent: boolean
  parentName?: string
  onSelect: () => void
}) {
  return (
    <div
      className={cn(
        'group relative flex w-full items-center rounded-lg pr-1 text-xs transition-colors duration-150',
        active
          ? 'bg-surface font-medium text-ink shadow-soft ring-1 ring-border'
          : 'text-muted hover:bg-hover hover:text-ink',
        branch.archived && 'opacity-55',
      )}
      style={{ paddingLeft: 8 + depth * 14 }}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? 'page' : undefined}
        title={`${branch.name} · ${plural(branch.message_count, 'message')} · ${plural(branch.memory_count, 'memory', 'memories')}`}
        className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left"
      >
        <span
          className={cn(
            'size-2 shrink-0 rounded-full transition-transform group-hover:scale-110',
            active && 'ring-[3px] ring-accent-soft',
          )}
          style={{ backgroundColor: branch.color ?? 'var(--color-accent)' }}
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate">{branch.name}</span>
        {branch.archived && <Archive size={11} className="shrink-0" aria-hidden />}
        {showParent && parentName && (
          <span className="max-w-[64px] shrink-0 truncate text-[9px] text-muted/75">
            {parentName}
          </span>
        )}
        <span className="shrink-0 text-[9px] tabular-nums text-muted/65">
          {branch.message_count}
        </span>
      </button>
      <BranchMenu branch={branch} />
    </div>
  )
}

function BranchTree({
  branches,
  currentBranchId,
  filter,
  onSelect,
}: {
  branches: Branch[]
  currentBranchId: string | null
  filter: string
  onSelect: (branchId: string) => void
}) {
  if (branches.length === 0) {
    return (
      <div className="px-2 py-8 text-center">
        <GitBranch size={17} className="mx-auto mb-2 text-muted/60" aria-hidden />
        <p className="text-[11px] text-muted">No branches in this space yet.</p>
      </div>
    )
  }

  if (filter) {
    const query = filter.toLowerCase()
    const matches = branches
      .filter((branch) => branch.name.toLowerCase().includes(query))
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
    if (matches.length === 0) {
      return <p className="px-2 py-6 text-center text-[11px] text-muted">No matching branches.</p>
    }
    const byId = new Map(branches.map((branch) => [branch.id, branch]))
    return (
      <div className="space-y-0.5">
        {matches.map((branch) => (
          <BranchItem
            key={branch.id}
            branch={branch}
            depth={0}
            active={branch.id === currentBranchId}
            showParent
            parentName={
              branch.parent_branch_id
                ? byId.get(branch.parent_branch_id)?.name
                : undefined
            }
            onSelect={() => onSelect(branch.id)}
          />
        ))}
      </div>
    )
  }

  const byParent = new Map<string | null, Branch[]>()
  for (const branch of branches) {
    const siblings = byParent.get(branch.parent_branch_id) ?? []
    siblings.push(branch)
    byParent.set(branch.parent_branch_id, siblings)
  }
  for (const siblings of byParent.values()) {
    siblings.sort((a, b) => a.created_at.localeCompare(b.created_at))
  }

  const seen = new Set<string>()
  const renderNodes = (parentId: string | null, depth: number): ReactNode[] => {
    const nodes = byParent.get(parentId) ?? []
    return nodes.flatMap((branch) => {
      if (seen.has(branch.id)) return []
      seen.add(branch.id)
      return [
        <BranchItem
          key={branch.id}
          branch={branch}
          depth={depth}
          active={branch.id === currentBranchId}
          showParent={false}
          onSelect={() => onSelect(branch.id)}
        />,
        ...renderNodes(branch.id, depth + 1),
      ]
    })
  }

  const roots = renderNodes(null, 0)
  const rendered = new Set(branches.filter((branch) => seen.has(branch.id)).map((branch) => branch.id))
  const orphans = branches.filter((branch) => !rendered.has(branch.id))

  return (
    <div className="space-y-0.5">
      {roots}
      {orphans.map((branch) => (
        <BranchItem
          key={branch.id}
          branch={branch}
          depth={0}
          active={branch.id === currentBranchId}
          showParent={false}
          onSelect={() => onSelect(branch.id)}
        />
      ))}
    </div>
  )
}

export function Sidebar({ mobile, onNavigate }: SidebarProps) {
  const space = useWorkspaceStore(selectCurrentSpace)
  const spaces = useWorkspaceStore((state) => state.spaces)
  const branches = useWorkspaceStore((state) => state.branches)
  const currentBranchId = useWorkspaceStore((state) => state.currentBranchId)
  const loadingBranches = useWorkspaceStore((state) => state.loadingBranches)
  const loadingSpaces = useWorkspaceStore((state) => state.loadingSpaces)
  const selectSpace = useWorkspaceStore((state) => state.selectSpace)
  const selectBranch = useWorkspaceStore((state) => state.selectBranch)
  const user = useAuthStore((state) => state.user)
  const health = useAuthStore((state) => state.health)
  const logout = useAuthStore((state) => state.logout)
  const setSidebarOpen = useUiStore((state) => state.setSidebarOpen)
  const setSettingsOpen = useUiStore((state) => state.setSettingsOpen)
  const setNewSpaceOpen = useUiStore((state) => state.setNewSpaceOpen)
  const [filter, setFilter] = useState('')

  const chooseBranch = (branchId: string) => {
    selectBranch(branchId)
    onNavigate()
  }

  const chooseSpace = (next: Space) => {
    void selectSpace(next.id).finally(onNavigate)
  }

  const providerReady = health?.gemini.configured && health.gemini.reachable !== false
  const providerLabel =
    health?.llm_mode === 'mock' ? 'Mock AI' : providerReady ? 'Gemini AI' : 'AI offline'

  return (
    <aside
      className={cn(
        'flex h-svh w-[278px] shrink-0 flex-col border-r border-border bg-sidebar',
        mobile && 'fixed inset-y-0 left-0 z-50 w-[300px] shadow-float',
      )}
      aria-label="Workspace sidebar"
    >
      <div className="flex h-[58px] shrink-0 items-center justify-between px-4">
        <div className="flex items-center gap-2.5">
          <BrandMark className="size-8 rounded-[10px]" />
          <span className="text-[15px] font-semibold tracking-[-0.02em] text-ink">
            BranchMind
          </span>
        </div>
        {mobile && (
          <IconButton label="Close sidebar" onClick={() => setSidebarOpen(false)}>
            <X size={17} aria-hidden />
          </IconButton>
        )}
      </div>

      <div className="flex items-center gap-1.5 px-3 pt-1 pb-3">
        <div className="min-w-0 flex-1">
          <SpacePicker
            spaces={spaces}
            currentSpace={space}
            onSelect={chooseSpace}
            onNew={() => setNewSpaceOpen(true)}
          />
        </div>
        <IconButton
          label="Create a new space"
          variant="surface"
          className="size-10"
          onClick={() => setNewSpaceOpen(true)}
        >
          <Plus size={17} aria-hidden />
        </IconButton>
      </div>

      <div className="px-3 pb-2">
        <div className="relative">
          <Search
            size={14}
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted/70"
            aria-hidden
          />
          <input
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter branches…"
            aria-label="Filter branches"
            className="h-8 w-full rounded-lg border border-transparent bg-bg/55 pr-2 pl-8 text-[11px] text-ink placeholder:text-muted/65 focus:border-border focus:bg-surface focus:outline-none"
          />
        </div>
      </div>

      <div className="flex items-center justify-between px-4 pt-3 pb-1.5">
        <span className="text-[10px] font-semibold tracking-[0.12em] text-muted uppercase">
          Branches
        </span>
        <span className="text-[10px] tabular-nums text-muted/70">{branches.length}</span>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3" aria-label="Branches">
        {loadingSpaces || loadingBranches ? (
          <div className="space-y-1.5 px-1" aria-label="Loading branches">
            {[76, 92, 64, 84].map((width, index) => (
              <div
                key={index}
                className="h-7 animate-pulse rounded-lg bg-hover"
                style={{ width: `${width}%`, marginLeft: index % 2 === 0 ? 0 : 14 }}
              />
            ))}
          </div>
        ) : (
          <BranchTree
            branches={branches}
            currentBranchId={currentBranchId}
            filter={filter}
            onSelect={chooseBranch}
          />
        )}
      </nav>

      {user && (
        <div className="shrink-0 border-t border-border px-3 py-3">
          <div className="flex items-center gap-2.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-[10px] font-semibold text-accent-ink">
              {initials(user.display_name)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-ink">{user.display_name}</p>
              <p className="truncate text-[10px] text-muted">{user.email}</p>
            </div>
          </div>
          <div className="mt-2.5 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[10px] text-muted">
              <span
                className={cn(
                  'size-1.5 rounded-full',
                  providerReady ? 'bg-success' : health?.llm_mode === 'mock' ? 'bg-warning' : 'bg-danger',
                )}
              />
              {providerLabel}
            </span>
            <div className="flex items-center gap-0.5">
              <IconButton
                label="Settings"
                onClick={() => {
                  setSettingsOpen(true)
                  if (mobile) setSidebarOpen(false)
                }}
              >
                <Settings2 size={15} aria-hidden />
              </IconButton>
              <ThemeToggle />
              <IconButton label="Sign out" onClick={() => void logout()}>
                <LogOut size={15} aria-hidden />
              </IconButton>
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}
