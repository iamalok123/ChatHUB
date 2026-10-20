import {
  GitBranch,
  Lightbulb,
  LoaderCircle,
  Network,
  SlidersHorizontal,
  X,
} from 'lucide-react'
import { lazy, Suspense } from 'react'

import type { Branch } from '../../api/types'
import { cn } from '../../lib/cn'
import { useTraceStore } from '../../store/trace'
import type { InspectorTab } from '../../store/ui'
import { useUiStore } from '../../store/ui'
import {
  selectCurrentBranch,
  selectCurrentSpace,
  useWorkspaceStore,
} from '../../store/workspace'
import { BranchAdminPanel } from '../inspector/BranchAdminPanel'
import { PersonalizationPanel } from '../inspector/PersonalizationPanel'
import { TracePanel } from '../inspector/TracePanel'
import { IconButton } from '../ui/IconButton'

const BranchGraph = lazy(() =>
  import('../graph/BranchGraph').then((module) => ({
    default: module.BranchGraph,
  })),
)

const tabs: Array<{ id: InspectorTab; label: string; icon: typeof Lightbulb }> = [
  { id: 'why', label: 'Why', icon: Lightbulb },
  { id: 'graph', label: 'Graph', icon: Network },
  { id: 'settings', label: 'Settings', icon: SlidersHorizontal },
]

function GraphPanel({ branch }: { branch: Branch }) {
  return (
    <Suspense
      fallback={
        <div className="grid h-75 place-items-center rounded-xl border border-border bg-subtle/35 text-muted">
          <div className="flex items-center gap-2 text-[11px]">
            <LoaderCircle size={15} className="animate-spin" aria-hidden />
            Loading the branch graph…
          </div>
        </div>
      }
    >
      <BranchGraph spaceId={branch.space_id} />
    </Suspense>
  )
}

function SettingsPanel({ branch }: { branch: Branch }) {
  const space = useWorkspaceStore(selectCurrentSpace)

  if (!space) return null

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 px-1">
        <span
          className="size-2.5 rounded-full"
          style={{ backgroundColor: branch.color ?? 'var(--color-accent)' }}
          aria-hidden
        />
        <div className="min-w-0">
          <p className="truncate text-[11px] font-medium text-ink">{branch.name}</p>
          <p className="truncate text-[10px] text-muted">
            {space.name} / {branch.model ?? 'space default model'}
          </p>
        </div>
      </div>

      <PersonalizationPanel key={`${space.id}:${branch.id}`} branch={branch} space={space} />

      <BranchAdminPanel key={branch.id} branch={branch} />

      <p className="mt-4 flex items-center gap-1.5 rounded-lg bg-subtle px-2.5 py-2 text-[10px] leading-relaxed text-muted">
        <GitBranch size={12} aria-hidden />
        Settings apply to this branch. Profile context follows its space.
      </p>
    </div>
  )
}

export function Inspector({ drawer = false }: { drawer?: boolean }) {
  const branch = useWorkspaceStore(selectCurrentBranch)
  const tab = useUiStore((state) => state.inspectorTab)
  const setTab = useUiStore((state) => state.setInspectorTab)
  const setInspectorOpen = useUiStore((state) => state.setInspectorOpen)
  const traceTarget = useTraceStore((state) => state.target)

  if (!branch) return null

  return (
    <aside
      className={cn(
        'flex h-full min-h-0 flex-col bg-surface',
        drawer
          ? 'fixed inset-y-0 right-0 z-50 w-85 max-w-[90vw] animate-fade-in border-l border-border shadow-float'
          : 'w-85 shrink-0 border-l border-border',
      )}
      aria-label="Branch inspector"
    >
      <div className="flex h-14.5 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-semibold text-ink">Inspector</span>
          <span className="text-[10px] text-muted">{branch.name}</span>
        </div>
        {drawer && (
          <IconButton label="Close inspector" onClick={() => setInspectorOpen(false)}>
            <X size={16} aria-hidden />
          </IconButton>
        )}
      </div>

      <div
        role="tablist"
        aria-label="Inspector sections"
        className="grid shrink-0 grid-cols-3 gap-0.5 border-b border-border p-1.5"
      >
        {tabs.map((item) => {
          const Icon = item.icon
          const selected = tab === item.id
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`inspector-panel-${item.id}`}
              id={`inspector-tab-${item.id}`}
              onClick={() => setTab(item.id)}
              className={cn(
                'flex flex-col items-center gap-1 rounded-lg py-1.5 text-[9px] font-medium transition-colors',
                selected
                  ? 'bg-accent-soft text-accent-ink'
                  : 'text-muted hover:bg-hover hover:text-ink',
              )}
            >
              <Icon size={14} aria-hidden />
              {item.label}
            </button>
          )
        })}
      </div>

      <div
        role="tabpanel"
        id={`inspector-panel-${tab}`}
        aria-labelledby={`inspector-tab-${tab}`}
        className="min-h-0 flex-1 overflow-y-auto p-3"
      >
        {tab === 'why' && (
          <TracePanel
            key={`${branch.id}:${traceTarget?.commitId ?? 'none'}`}
            branch={branch}
            target={traceTarget}
          />
        )}
        {tab === 'graph' && <GraphPanel branch={branch} />}
        {tab === 'settings' && <SettingsPanel branch={branch} />}
      </div>
    </aside>
  )
}
