import {
  AlertTriangle,
  Brain,
  GitBranch,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { errorMessage } from '../../api/client'
import { useMediaQuery } from '../../lib/useMediaQuery'
import { useUiStore } from '../../store/ui'
import {
  selectCurrentBranch,
  selectCurrentSpace,
  useWorkspaceStore,
} from '../../store/workspace'
import { Button } from '../ui/Button'
import { BranchView } from './BranchView'
import { CommandPalette } from './CommandPalette'
import { GlobalShortcuts } from './GlobalShortcuts'
import { HealthBanner } from './HealthBanner'
import { Inspector } from './Inspector'
import { OperationDialogs } from '../operations/OperationDialogs'
import { NewSpaceDialog } from './NewSpaceDialog'
import { SettingsDialog } from './SettingsDialog'
import { Sidebar } from './Sidebar'
import { WorkspaceHeader } from './WorkspaceHeader'

function EmptyWorkspace() {
  const setNewSpaceOpen = useUiStore((state) => state.setNewSpaceOpen)
  const pushToast = useUiStore((state) => state.pushToast)
  const createDemo = useWorkspaceStore((state) => state.createDemo)
  const [demoPending, setDemoPending] = useState(false)
  const features = [
    {
      icon: GitBranch,
      title: 'Branch naturally',
      body: 'Follow one thread without abandoning the others.',
    },
    {
      icon: Brain,
      title: 'Keep what matters',
      body: 'Turn durable facts and preferences into inspectable memory.',
    },
    {
      icon: ShieldCheck,
      title: 'Stay local',
      body: 'Your database, sessions, and exports stay on this machine.',
    },
  ]

  const loadDemo = async () => {
    setDemoPending(true)
    try {
      await createDemo()
      pushToast(
        'success',
        'Demo space loaded',
        'Three branches, five memories, one merge, and a pending proposal.',
      )
    } catch (error) {
      pushToast('error', 'Could not load the demo', errorMessage(error))
    } finally {
      setDemoPending(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[760px] flex-col justify-center px-6 py-12 sm:px-8">
      <div className="animate-fade-in">
        <span className="mb-5 grid size-12 place-items-center rounded-2xl border border-border bg-surface text-accent shadow-soft">
          <Sparkles size={21} aria-hidden />
        </span>
        <p className="text-xs font-medium text-accent">Your local mind</p>
        <h1 className="mt-2 max-w-xl font-serif text-[clamp(2rem,4vw,3rem)] leading-[1.08] tracking-[-0.03em] text-ink">
          Give your conversations a place to branch.
        </h1>
        <p className="mt-4 max-w-lg text-sm leading-relaxed text-muted">
          Create your first space. It starts with a main branch, its own memory, and a
          profile that shapes every reply.
        </p>
        <div className="mt-7 flex flex-wrap gap-2">
          <Button
            size="lg"
            onClick={() => setNewSpaceOpen(true)}
            leadingIcon={<Plus size={16} aria-hidden />}
          >
            Create a space
          </Button>
          <Button
            variant="secondary"
            size="lg"
            loading={demoPending}
            onClick={() => void loadDemo()}
            leadingIcon={!demoPending ? <Play size={15} aria-hidden /> : undefined}
          >
            Load demo space
          </Button>
        </div>

        <div className="mt-12 grid gap-3 sm:grid-cols-3">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="rounded-xl border border-border bg-surface/70 p-4 shadow-soft"
            >
              <feature.icon size={16} className="text-accent" aria-hidden />
              <h2 className="mt-3 text-xs font-medium text-ink">{feature.title}</h2>
              <p className="mt-1 text-[10px] leading-relaxed text-muted">{feature.body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function WorkspaceError() {
  const error = useWorkspaceStore((state) => state.error)
  const loadSpaces = useWorkspaceStore((state) => state.loadSpaces)
  const loadBranches = useWorkspaceStore((state) => state.loadBranches)

  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col items-center justify-center px-6 py-12 text-center">
      <span className="mb-4 grid size-11 place-items-center rounded-xl bg-danger-soft text-danger">
        <AlertTriangle size={20} aria-hidden />
      </span>
      <h1 className="text-lg font-semibold tracking-tight text-ink">
        Could not load your workspace
      </h1>
      <p className="mt-2 text-xs leading-relaxed text-muted">{error}</p>
      <div className="mt-5 flex gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void loadSpaces()}
          leadingIcon={<RefreshCw size={13} aria-hidden />}
        >
          Retry
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void loadBranches()}>
          Reload branches
        </Button>
      </div>
    </div>
  )
}

function CenterSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[760px] animate-pulse px-6 py-10 sm:px-8">
      <div className="flex items-center gap-3">
        <div className="size-10 rounded-xl bg-hover" />
        <div className="space-y-2">
          <div className="h-4 w-36 rounded bg-hover" />
          <div className="h-2.5 w-24 rounded bg-hover" />
        </div>
      </div>
      <div className="mt-10 space-y-3">
        <div className="h-3 w-2/3 rounded bg-hover" />
        <div className="h-3 w-5/6 rounded bg-hover" />
        <div className="h-3 w-1/2 rounded bg-hover" />
      </div>
      <div className="mt-8 flex justify-end">
        <div className="h-20 w-3/5 rounded-2xl bg-hover" />
      </div>
      <div className="mt-8 space-y-3">
        <div className="h-3 w-4/5 rounded bg-hover" />
        <div className="h-3 w-3/4 rounded bg-hover" />
      </div>
    </div>
  )
}

function WorkspaceCenter() {
  const spaces = useWorkspaceStore((state) => state.spaces)
  const space = useWorkspaceStore(selectCurrentSpace)
  const branch = useWorkspaceStore(selectCurrentBranch)
  const loadingSpaces = useWorkspaceStore((state) => state.loadingSpaces)
  const loadingBranches = useWorkspaceStore((state) => state.loadingBranches)
  const error = useWorkspaceStore((state) => state.error)

  if (loadingSpaces && spaces.length === 0) return <CenterSkeleton />
  if (error && spaces.length === 0) return <WorkspaceError />
  if (spaces.length === 0 || !space) return <EmptyWorkspace />
  if (loadingBranches && !branch) return <CenterSkeleton />
  if (error && !branch) return <WorkspaceError />
  if (!branch) return <EmptyWorkspace />
  return <BranchView key={branch.id} />
}

export function AppShell() {
  const loadSpaces = useWorkspaceStore((state) => state.loadSpaces)
  const branch = useWorkspaceStore(selectCurrentBranch)
  const isMobile = !useMediaQuery('(min-width: 900px)')
  const isWide = useMediaQuery('(min-width: 1280px)')
  const sidebarOpen = useUiStore((state) => state.sidebarOpen)
  const sidebarCollapsed = useUiStore((state) => state.sidebarCollapsed)
  const inspectorOpen = useUiStore((state) => state.inspectorOpen)
  const setSidebarOpen = useUiStore((state) => state.setSidebarOpen)
  const setInspectorOpen = useUiStore((state) => state.setInspectorOpen)
  const initialized = useRef(false)

  useEffect(() => {
    void loadSpaces()
  }, [loadSpaces])

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true
    if (!isWide) {
      setInspectorOpen(false)
    }
  }, [isWide, setInspectorOpen])

  const sidebarVisible = isMobile ? sidebarOpen : !sidebarCollapsed
  const inspectorVisible = Boolean(branch) && inspectorOpen
  const inspectorAsDrawer = !isWide && inspectorVisible

  return (
    <div className="flex h-svh min-h-0 overflow-hidden bg-bg text-ink">
      <GlobalShortcuts />
      {isMobile && sidebarOpen && (
        <button
          type="button"
          aria-label="Close sidebar"
          className="fixed inset-0 z-40 animate-fade-in bg-overlay backdrop-blur-[1px]"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {sidebarVisible && (
        <Sidebar
          mobile={isMobile}
          onNavigate={() => {
            if (isMobile) setSidebarOpen(false)
          }}
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <WorkspaceHeader isMobile={isMobile} />
        <HealthBanner />
        <div className="flex min-h-0 flex-1">
          <main className="min-h-0 min-w-0 flex-1 overflow-y-auto" id="main-content">
            <WorkspaceCenter />
          </main>

          {isWide && inspectorVisible && branch && <Inspector />}
          {inspectorAsDrawer && (
            <>
              <button
                type="button"
                aria-label="Close inspector"
                className="fixed inset-0 z-40 animate-fade-in bg-overlay backdrop-blur-[1px]"
                onClick={() => setInspectorOpen(false)}
              />
              <Inspector drawer />
            </>
          )}
        </div>
      </div>

      <CommandPalette />
      <NewSpaceDialog />
      <SettingsDialog />
      <OperationDialogs />
    </div>
  )
}
