import {
  Brain,
  EyeOff,
  GitBranch,
  Lightbulb,
  Network,
  Pin,
  RefreshCw,
  SlidersHorizontal,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import { api, errorMessage } from '../../api/client'
import type { Branch, Memory, MemoryList } from '../../api/types'
import { cn } from '../../lib/cn'
import { plural, sentenceCase } from '../../lib/format'
import { useUiStore } from '../../store/ui'
import {
  selectCurrentBranch,
  selectCurrentSpace,
  useWorkspaceStore,
} from '../../store/workspace'
import { IconButton } from '../ui/IconButton'
import { Spinner } from '../ui/Spinner'

type Tab = 'memory' | 'why' | 'graph' | 'settings'

const tabs: Array<{ id: Tab; label: string; icon: typeof Brain }> = [
  { id: 'memory', label: 'Memory', icon: Brain },
  { id: 'why', label: 'Why', icon: Lightbulb },
  { id: 'graph', label: 'Graph', icon: Network },
  { id: 'settings', label: 'Settings', icon: SlidersHorizontal },
]

function EmptyPanel({
  icon,
  title,
  body,
}: {
  icon: ReactNode
  title: string
  body: string
}) {
  return (
    <div className="flex flex-col items-center px-4 py-12 text-center">
      <span className="mb-3 grid size-10 place-items-center rounded-xl bg-subtle text-muted">
        {icon}
      </span>
      <h3 className="text-xs font-medium text-ink">{title}</h3>
      <p className="mt-1.5 max-w-[230px] text-[11px] leading-relaxed text-muted">{body}</p>
    </div>
  )
}

function MemoryCard({ memory, excluded = false }: { memory: Memory; excluded?: boolean }) {
  return (
    <article
      className={cn(
        'rounded-xl border border-border bg-surface p-3 shadow-soft',
        excluded && 'bg-subtle/60 opacity-80',
      )}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 rounded-md bg-accent-soft px-1.5 py-0.5 text-[9px] font-semibold tracking-wide text-accent-ink uppercase">
          {memory.kind}
        </span>
        <span className="min-w-0 flex-1" />
        {memory.pinned && <Pin size={12} className="mt-0.5 shrink-0 text-accent" aria-hidden />}
        {excluded && <EyeOff size={12} className="mt-0.5 shrink-0 text-muted" aria-hidden />}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-ink">{memory.content}</p>
      <div className="mt-2.5 flex items-center gap-2 text-[9px] text-muted">
        <span className="truncate">
          {memory.inherited ? `from ${memory.origin_branch_name}` : 'own memory'}
        </span>
        <span className="size-0.5 rounded-full bg-muted/50" aria-hidden />
        <span>{Math.round(memory.importance * 100)}%</span>
        {memory.edited && (
          <>
            <span className="size-0.5 rounded-full bg-muted/50" aria-hidden />
            <span>edited</span>
          </>
        )}
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-border/70">
        <div
          className="h-full rounded-full bg-accent/70"
          style={{ width: `${Math.max(4, Math.round(memory.importance * 100))}%` }}
        />
      </div>
    </article>
  )
}

function MemoryPanel({ branch }: { branch: Branch }) {
  const [data, setData] = useState<MemoryList | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    api
      .get<MemoryList>(`/branches/${branch.id}/memories`, controller.signal)
      .then((result) => {
        setData(result)
        setLoading(false)
      })
      .catch((caught) => {
        if (controller.signal.aborted) return
        setError(errorMessage(caught))
        setLoading(false)
      })
    return () => controller.abort()
  }, [branch.id, refreshKey])

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
            setRefreshKey((value) => value + 1)
          }}
          className="mt-3 text-[11px] font-medium text-accent-ink hover:underline"
        >
          Try again
        </button>
      </div>
    )
  }

  const memories = data?.memories ?? []
  const excluded = data?.excluded ?? []

  return (
    <div>
      <div className="mb-3 flex items-center justify-between px-1">
        <div>
          <p className="text-[11px] font-medium text-ink">Effective memory</p>
          <p className="text-[10px] text-muted">
            {plural(memories.length, 'memory', 'memories')} used on this branch
          </p>
        </div>
        <IconButton
          label="Refresh memories"
          onClick={() => {
            setLoading(true)
            setError(null)
            setRefreshKey((value) => value + 1)
          }}
        >
          <RefreshCw size={14} aria-hidden />
        </IconButton>
      </div>

      {memories.length === 0 ? (
        <EmptyPanel
          icon={<Brain size={18} aria-hidden />}
          title="No memories yet"
          body="Durable facts and preferences from conversations will collect here, ready to inspect."
        />
      ) : (
        <div className="space-y-2">
          {memories.map((memory) => (
            <MemoryCard key={memory.id} memory={memory} />
          ))}
        </div>
      )}

      {excluded.length > 0 && (
        <div className="mt-5">
          <div className="mb-2 flex items-center gap-1.5 px-1">
            <EyeOff size={12} className="text-muted" aria-hidden />
            <p className="text-[10px] font-medium tracking-wide text-muted uppercase">
              Excluded · {excluded.length}
            </p>
          </div>
          <div className="space-y-2">
            {excluded.map((memory) => (
              <MemoryCard key={memory.id} memory={memory} excluded />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function GraphPanel({ branch }: { branch: Branch }) {
  const branches = useWorkspaceStore((state) => state.branches)
  const selectBranch = useWorkspaceStore((state) => state.selectBranch)

  const byParent = new Map<string | null, Branch[]>()
  for (const item of branches) {
    const siblings = byParent.get(item.parent_branch_id) ?? []
    siblings.push(item)
    byParent.set(item.parent_branch_id, siblings)
  }

  return (
    <div>
      <div className="mb-3 px-1">
        <p className="text-[11px] font-medium text-ink">Branch graph</p>
        <p className="text-[10px] text-muted">
          {plural(branches.length, 'branch', 'branches')} in this space
        </p>
      </div>
      <div className="rounded-xl border border-border bg-surface p-3 shadow-soft">
        {branches.map((item) => {
          const siblings = byParent.get(item.parent_branch_id) ?? []
          const index = siblings.findIndex((sibling) => sibling.id === item.id)
          const active = item.id === branch.id
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => selectBranch(item.id)}
              className={cn(
                'relative flex w-full items-center gap-2 rounded-lg py-1.5 pr-2 text-left text-[11px] transition-colors',
                active ? 'bg-accent-soft text-accent-ink' : 'text-muted hover:bg-hover hover:text-ink',
              )}
              style={{ paddingLeft: 8 + (item.parent_branch_id ? 16 : 0) }}
            >
              {item.parent_branch_id && (
                <span
                  className="absolute top-0 bottom-0 left-[15px] w-px bg-border"
                  aria-hidden
                />
              )}
              <span
                className={cn(
                  'relative z-10 size-2.5 shrink-0 rounded-full ring-2 ring-surface',
                  active && 'ring-accent-soft',
                )}
                style={{ backgroundColor: item.color ?? 'var(--color-accent)' }}
                aria-hidden
              />
              <span className="truncate">{item.name}</span>
              {index === 0 && !item.parent_branch_id && (
                <span className="ml-auto text-[9px] text-muted/70">root</span>
              )}
            </button>
          )
        })}
      </div>
      <p className="mt-3 px-1 text-[10px] leading-relaxed text-muted">
        Fork points, merges, and checkpoints will appear as edges in the interactive graph.
      </p>
    </div>
  )
}

function SettingsPanel({ branch }: { branch: Branch }) {
  const space = useWorkspaceStore(selectCurrentSpace)
  const rows = [
    ['Thinking', sentenceCase(branch.thinking_level)],
    ['Memory mode', sentenceCase(branch.memory_mode)],
    ['Memory strength', `Top ${branch.top_k}`],
    ['Model', branch.model ?? 'Space default'],
  ]

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 px-1">
        <span
          className="size-2.5 rounded-full"
          style={{ backgroundColor: branch.color ?? 'var(--color-accent)' }}
          aria-hidden
        />
        <div>
          <p className="text-[11px] font-medium text-ink">{branch.name}</p>
          <p className="text-[10px] text-muted">{space?.name}</p>
        </div>
      </div>

      <dl className="overflow-hidden rounded-xl border border-border bg-surface shadow-soft">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="flex items-center justify-between gap-3 border-b border-border px-3 py-2.5 last:border-b-0"
          >
            <dt className="text-[10px] text-muted">{label}</dt>
            <dd className="text-right text-[10px] font-medium text-ink">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-4 space-y-3">
        <div>
          <p className="mb-1 px-1 text-[10px] font-medium tracking-wide text-muted uppercase">
            Persona
          </p>
          <div className="rounded-xl border border-border bg-subtle/70 p-3 text-[10px] leading-relaxed text-muted">
            {branch.persona || 'No persona set. The space profile and default voice apply.'}
          </div>
        </div>
        <div>
          <p className="mb-1 px-1 text-[10px] font-medium tracking-wide text-muted uppercase">
            System prompt
          </p>
          <div className="rounded-xl border border-border bg-subtle/70 p-3 font-mono text-[10px] leading-relaxed text-muted">
            {branch.system_prompt || 'No branch-specific system prompt.'}
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-1.5 rounded-lg bg-subtle px-2.5 py-2 text-[10px] text-muted">
        <GitBranch size={12} aria-hidden />
        Settings editing arrives with the branch workflow.
      </div>
    </div>
  )
}

export function Inspector({ drawer = false }: { drawer?: boolean }) {
  const branch = useWorkspaceStore(selectCurrentBranch)
  const [tab, setTab] = useState<Tab>('memory')
  const setInspectorOpen = useUiStore((state) => state.setInspectorOpen)

  if (!branch) return null

  return (
    <aside
      className={cn(
        'flex h-full min-h-0 flex-col bg-surface',
        drawer
          ? 'fixed inset-y-0 right-0 z-50 w-[340px] max-w-[90vw] animate-fade-in border-l border-border shadow-float'
          : 'w-[340px] shrink-0 border-l border-border',
      )}
      aria-label="Branch inspector"
    >
      <div className="flex h-[58px] shrink-0 items-center justify-between border-b border-border px-4">
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
        className="grid shrink-0 grid-cols-4 gap-0.5 border-b border-border p-1.5"
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
        {tab === 'memory' && <MemoryPanel key={branch.id} branch={branch} />}
        {tab === 'why' && (
          <EmptyPanel
            icon={<Lightbulb size={18} aria-hidden />}
            title="No answer selected"
            body="Every assistant reply stores a trace. Select one in the chat to see the memories and context behind it."
          />
        )}
        {tab === 'graph' && <GraphPanel branch={branch} />}
        {tab === 'settings' && <SettingsPanel branch={branch} />}
      </div>
    </aside>
  )
}
