import {
  Brain,
  GitBranch,
  GitCompare,
  GitFork,
  GitMerge,
  Network,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { branchAncestors } from '../../lib/branchTree'
import { cn } from '../../lib/cn'
import { plural } from '../../lib/format'
import { useOperationsStore } from '../../store/operations'
import { useUiStore } from '../../store/ui'
import {
  selectCurrentBranch,
  selectCurrentSpace,
  useWorkspaceStore,
} from '../../store/workspace'

type PaletteAction = {
  id: string
  label: string
  section: string
  hint?: string
  keywords?: string
  icon: LucideIcon
  disabled?: boolean
  run: () => void
}

export function CommandPalette() {
  const open = useUiStore((state) => state.paletteOpen)
  if (!open) return null
  return <PaletteContent />
}

function PaletteContent() {
  const setOpen = useUiStore((state) => state.setPaletteOpen)
  const branches = useWorkspaceStore((state) => state.branches)
  const spaces = useWorkspaceStore((state) => state.spaces)
  const space = useWorkspaceStore(selectCurrentSpace)
  const branch = useWorkspaceStore(selectCurrentBranch)
  const selectBranch = useWorkspaceStore((state) => state.selectBranch)
  const selectSpace = useWorkspaceStore((state) => state.selectSpace)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus())

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
        return
      }
      if (event.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      )
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      window.cancelAnimationFrame(frame)
      previousFocus?.focus()
    }
  }, [setOpen])

  const actions = useMemo<PaletteAction[]>(() => {
    const items: PaletteAction[] = []
    const runAction = (action: () => void) => () => {
      setOpen(false)
      action()
    }

    items.push({
      id: 'new-space',
      label: 'Create a new space',
      section: 'Workspace',
      icon: Plus,
      keywords: 'new project repository',
      run: runAction(() => useUiStore.getState().setNewSpaceOpen(true)),
    })

    if (space) {
      items.push({
        id: 'open-settings',
        label: 'Open settings',
        section: 'Workspace',
        hint: 'Account, AI status, appearance, data',
        icon: Settings2,
        keywords: 'preferences theme export import',
        run: runAction(() => useUiStore.getState().setSettingsOpen(true)),
      })
    }

    if (branch) {
      const ancestors = branchAncestors(branches, branch.id)
      items.push(
        {
          id: 'panel-memory',
          label: 'Open memory inspector',
          section: 'Current branch',
          icon: Brain,
          keywords: 'memories proposals personalization',
          run: runAction(() => {
            useUiStore.getState().setInspectorTab('memory')
            useUiStore.getState().setInspectorOpen(true)
          }),
        },
        {
          id: 'panel-why',
          label: 'Open Why this answer',
          section: 'Current branch',
          icon: Sparkles,
          keywords: 'trace reasoning retrieval context',
          run: runAction(() => {
            useUiStore.getState().setInspectorTab('why')
            useUiStore.getState().setInspectorOpen(true)
          }),
        },
        {
          id: 'panel-graph',
          label: 'Open branch graph',
          section: 'Current branch',
          icon: Network,
          keywords: 'map tree fork merge sync',
          run: runAction(() => {
            useUiStore.getState().setInspectorTab('graph')
            useUiStore.getState().setInspectorOpen(true)
          }),
        },
        {
          id: 'panel-settings',
          label: 'Open branch settings',
          section: 'Current branch',
          icon: SlidersHorizontal,
          keywords: 'persona model thinking memory mode',
          run: runAction(() => {
            useUiStore.getState().setInspectorTab('settings')
            useUiStore.getState().setInspectorOpen(true)
          }),
        },
        {
          id: 'fork-current',
          label: 'Fork this branch',
          section: 'Branch actions',
          hint: 'Choose which memories carry over',
          icon: GitFork,
          keywords: 'split child copy',
          disabled: !branch.head_commit_id,
          run: runAction(() => {
            if (!branch.head_commit_id) return
            useOperationsStore.getState().openFork({
              branchId: branch.id,
              commitId: branch.head_commit_id,
            })
          }),
        },
      )
      if (branch.parent_branch_id) {
        items.push(
          {
            id: 'merge-up',
            label: 'Merge memories up',
            section: 'Branch actions',
            icon: GitMerge,
            keywords: 'promote parent ancestor',
            disabled: branch.archived,
            run: runAction(() => useOperationsStore.getState().openMerge(branch.id)),
          },
          {
            id: 'sync-upstream',
            label: 'Sync from upstream',
            section: 'Branch actions',
            icon: RefreshCw,
            keywords: 'pull parent memories',
            run: runAction(() => useOperationsStore.getState().openSync(branch.id)),
          },
        )
      }
      if (ancestors.length > 0) {
        items.push({
          id: 'compare-ancestor',
          label: 'Compare with an ancestor',
          section: 'Branch actions',
          hint: branch.parent_branch_id ? 'See memory and message divergence' : undefined,
          icon: GitCompare,
          keywords: 'diff baseline divergence',
          run: runAction(() => useOperationsStore.getState().openCompare(branch.id)),
        })
      }
    }

    for (const item of branches) {
      items.push({
        id: `branch:${item.id}`,
        label: `Switch to ${item.name}`,
        section: 'Branches',
        hint:
          item.id === branch?.id
            ? 'Current branch'
            : `${plural(item.message_count, 'message')} · ${plural(item.memory_count, 'memory', 'memories')}`,
        icon: GitBranch,
        keywords: `${item.name} ${item.archived ? 'archived' : ''}`,
        run: runAction(() => selectBranch(item.id)),
      })
    }

    for (const item of spaces) {
      if (item.id === space?.id) continue
      items.push({
        id: `space:${item.id}`,
        label: `Switch to space ${item.name}`,
        section: 'Spaces',
        icon: GitBranch,
        keywords: item.name,
        run: runAction(() => void selectSpace(item.id)),
      })
    }

    return items
  }, [branch, branches, space, spaces, selectBranch, selectSpace, setOpen])

  const normalizedQuery = query.trim().toLowerCase()
  const filtered = useMemo(
    () =>
      normalizedQuery
        ? actions.filter((action) =>
            `${action.label} ${action.section} ${action.hint ?? ''} ${action.keywords ?? ''}`
              .toLowerCase()
              .includes(normalizedQuery),
          )
        : actions,
    [actions, normalizedQuery],
  )
  const visible = filtered.slice(0, 40)
  const safeActiveIndex = Math.min(activeIndex, Math.max(visible.length - 1, 0))
  const active = visible[safeActiveIndex]

  const runActive = () => {
    if (!active || active.disabled) return
    active.run()
  }

  return createPortal(
    <div
      className="fixed inset-0 z-120 flex items-start justify-center px-4 pt-[12vh] sm:pt-[16vh]"
      role="presentation"
      onKeyDown={(event) => {
        if (visible.length === 0) return
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          setActiveIndex((value) => Math.min(value + 1, visible.length - 1))
        } else if (event.key === 'ArrowUp') {
          event.preventDefault()
          setActiveIndex((value) => Math.max(value - 1, 0))
        } else if (event.key === 'Enter') {
          event.preventDefault()
          runActive()
        }
      }}
    >
      <div
        className="absolute inset-0 animate-fade-in bg-overlay backdrop-blur-[2px]"
        onClick={() => setOpen(false)}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="relative w-full max-w-xl animate-dialog-in overflow-hidden rounded-2xl border border-border bg-surface shadow-float"
      >
        <h2 id={titleId} className="sr-only">
          Command palette
        </h2>
        <p id={descriptionId} className="sr-only">
          Search branches, spaces, and actions.
        </p>

        <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
          <Search size={16} className="shrink-0 text-muted" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setActiveIndex(0)
            }}
            placeholder="Search branches, spaces, or actions…"
            aria-label="Search commands"
            role="combobox"
            aria-expanded="true"
            aria-controls="command-palette-results"
            aria-activedescendant={
              active ? `command-option-${active.id}` : undefined
            }
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent text-sm text-ink placeholder:text-muted/70 focus:outline-none"
          />
          <kbd className="rounded border border-border bg-subtle px-1.5 py-0.5 text-[9px] text-muted">
            Esc
          </kbd>
        </div>

        <div
          id="command-palette-results"
          role="listbox"
          aria-label="Commands"
          className="max-h-[min(56vh,440px)] overflow-y-auto p-1.5"
        >
          {visible.length === 0 ? (
            <div className="px-3 py-10 text-center">
              <Search size={18} className="mx-auto text-muted/60" aria-hidden />
              <p className="mt-2 text-[11px] text-muted">No commands match “{query}”.</p>
            </div>
          ) : (
            visible.map((action, index) => {
              const Icon = action.icon
              const previous = index > 0 ? visible[index - 1] : null
              const showSection = !previous || previous.section !== action.section
              const selected = index === safeActiveIndex
              return (
                <div key={action.id}>
                  {showSection && (
                    <p className="px-2.5 pt-2 pb-1 text-[9px] font-semibold tracking-[0.12em] text-muted uppercase">
                      {action.section}
                    </p>
                  )}
                  <button
                    id={`command-option-${action.id}`}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    aria-disabled={action.disabled}
                    disabled={action.disabled}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => {
                      if (action.disabled) return
                      action.run()
                    }}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors',
                      selected
                        ? 'bg-accent-soft text-accent-ink'
                        : 'text-ink hover:bg-hover',
                      action.disabled && 'opacity-45',
                    )}
                  >
                    <Icon
                      size={14}
                      className={cn(
                        'shrink-0',
                        selected ? 'text-accent-ink' : 'text-muted',
                      )}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11px] font-medium">
                        {action.label}
                      </span>
                      {action.hint && (
                        <span className="mt-0.5 block truncate text-[9px] text-muted">
                          {action.hint}
                        </span>
                      )}
                    </span>
                    {selected && (
                      <span className="shrink-0 rounded border border-accent/20 bg-surface/60 px-1.5 py-0.5 text-[8px] text-muted">
                        Enter
                      </span>
                    )}
                  </button>
                </div>
              )
            })
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border bg-subtle/55 px-4 py-2 text-[9px] text-muted">
          <span className="flex items-center gap-2">
            <span>↑↓ navigate</span>
            <span aria-hidden>·</span>
            <span>Enter run</span>
          </span>
          <span className="flex items-center gap-1">
            <GitBranch size={10} aria-hidden />
            {space?.name ?? 'ChatHUB'}
          </span>
        </div>
      </div>
    </div>,
    document.body,
  )
}
