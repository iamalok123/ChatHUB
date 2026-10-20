import {
  ChevronRight,
  Command,
  Menu,
  PanelLeft,
  PanelRight,
  Settings2,
} from 'lucide-react'

import { branchLineage } from '../../lib/branchTree'
import { plural } from '../../lib/format'
import { useUiStore } from '../../store/ui'
import {
  selectCurrentBranch,
  selectCurrentSpace,
  useWorkspaceStore,
} from '../../store/workspace'
import { IconButton } from '../ui/IconButton'

export function WorkspaceHeader({ isMobile }: { isMobile: boolean }) {
  const space = useWorkspaceStore(selectCurrentSpace)
  const branch = useWorkspaceStore(selectCurrentBranch)
  const branches = useWorkspaceStore((state) => state.branches)
  const selectBranch = useWorkspaceStore((state) => state.selectBranch)
  const setSidebarOpen = useUiStore((state) => state.setSidebarOpen)
  const sidebarCollapsed = useUiStore((state) => state.sidebarCollapsed)
  const setSidebarCollapsed = useUiStore((state) => state.setSidebarCollapsed)
  const setPaletteOpen = useUiStore((state) => state.setPaletteOpen)
  const inspectorOpen = useUiStore((state) => state.inspectorOpen)
  const setInspectorOpen = useUiStore((state) => state.setInspectorOpen)
  const setSettingsOpen = useUiStore((state) => state.setSettingsOpen)

  const chain = branch ? branchLineage(branches, branch.id) : []
  const ancestors = chain.slice(0, -1)

  return (
    <header className="flex h-[58px] shrink-0 items-center gap-2 border-b border-border bg-bg/90 px-3 backdrop-blur sm:px-4">
      {isMobile && (
        <IconButton label="Open sidebar" onClick={() => setSidebarOpen(true)}>
          <Menu size={18} aria-hidden />
        </IconButton>
      )}

      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        {space && (
          <>
            <span className="hidden max-w-[150px] truncate text-xs text-muted sm:block">
              {space.name}
            </span>
            {branch && (
              <ChevronRight size={12} className="hidden shrink-0 text-muted/60 sm:block" aria-hidden />
            )}
          </>
        )}

        {ancestors.slice(-2).map((ancestor) => (
          <div key={ancestor.id} className="hidden items-center gap-1 lg:flex">
            <button
              type="button"
              onClick={() => selectBranch(ancestor.id)}
              className="max-w-[130px] truncate text-xs text-muted transition-colors hover:text-ink"
              title={`Switch to ${ancestor.name}`}
            >
              {ancestor.name}
            </button>
            <ChevronRight size={12} className="shrink-0 text-muted/60" aria-hidden />
          </div>
        ))}

        {branch ? (
          <div className="flex min-w-0 items-center gap-2">
            <span
              className="size-2.5 shrink-0 rounded-full ring-4 ring-accent-soft/60"
              style={{ backgroundColor: branch.color ?? 'var(--color-accent)' }}
              aria-hidden
            />
            <span className="truncate text-sm font-medium tracking-tight text-ink">
              {branch.name}
            </span>
            {branch.is_root && (
              <span className="hidden rounded-full border border-border bg-surface px-1.5 py-0.5 text-[9px] font-medium tracking-wide text-muted uppercase sm:inline">
                root
              </span>
            )}
            {branch.archived && (
              <span className="rounded-full bg-warning-soft px-1.5 py-0.5 text-[9px] font-medium text-warning">
                archived
              </span>
            )}
            <span className="hidden text-[11px] text-muted md:inline">
              {plural(branch.message_count, 'message')} · {plural(branch.memory_count, 'memory', 'memories')}
            </span>
          </div>
        ) : (
          <span className="text-sm font-medium tracking-tight text-ink">
            {space?.name ?? 'ChatHUB'}
          </span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        {!isMobile && (
          <IconButton
            label={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          >
            <PanelLeft size={17} aria-hidden />
          </IconButton>
        )}
        <IconButton
          label="Open command palette"
          onClick={() => setPaletteOpen(true)}
        >
          <Command size={17} aria-hidden />
        </IconButton>
        <IconButton
          label="Open settings"
          onClick={() => setSettingsOpen(true)}
          className="hidden sm:grid"
        >
          <Settings2 size={17} aria-hidden />
        </IconButton>
        {branch && (
          <IconButton
            label={inspectorOpen ? 'Hide inspector' : 'Show inspector'}
            active={inspectorOpen}
            onClick={() => setInspectorOpen(!inspectorOpen)}
          >
            <PanelRight size={17} aria-hidden />
          </IconButton>
        )}
      </div>
    </header>
  )
}
