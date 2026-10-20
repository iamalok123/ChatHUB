import {
  ArrowDown,
  ArrowUp,
  GitBranch,
  GitFork,
  GitMerge,
  Lock,
  RefreshCw,
  Sparkles,
  Square,
  TriangleAlert,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'

import type { Branch, Space } from '../../api/types'
import { cn } from '../../lib/cn'
import { plural, sentenceCase } from '../../lib/format'
import { useOperationsStore } from '../../store/operations'
import { useTraceStore } from '../../store/trace'
import { useUiStore } from '../../store/ui'
import { useWorkspaceStore } from '../../store/workspace'
import { LiveMessageItem, MessageItem } from '../chat/MessageItem'
import { useChatStream } from '../chat/useChatStream'
import { SyncBanner } from '../operations/SyncBanner'
import { Button } from '../ui/Button'
import { Spinner } from '../ui/Spinner'

function BranchChat({ branch, space }: { branch: Branch; space: Space }) {
  const branches = useWorkspaceStore((state) => state.branches)
  const {
    messages,
    live,
    error,
    loading,
    streaming,
    send,
    stop,
    reload,
    clearError,
  } = useChatStream(branch.id, branch.name, branch.head_commit_id)

  const openFork = useOperationsStore((state) => state.openFork)
  const openMerge = useOperationsStore((state) => state.openMerge)
  const [draft, setDraft] = useState('')
  const [stick, setStick] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const branchColors = new Map(branches.map((item) => [item.id, item.color]))
  const hasContent = Boolean(messages && messages.length > 0) || Boolean(live)
  const canWrite = !branch.archived && !loading && messages !== null

  useEffect(() => {
    useTraceStore.getState().clearTrace()
    useUiStore.getState().setInspectorTab('memory')
  }, [branch.id])

  useEffect(() => {
    if (!stick) return
    const frame = window.requestAnimationFrame(() => {
      const element = scrollRef.current
      if (element) element.scrollTop = element.scrollHeight
    })
    return () => window.cancelAnimationFrame(frame)
  }, [live?.content, live?.thinking, messages, stick])

  const openTrace = (commitId: string) => {
    useTraceStore.getState().selectTrace({ branchId: branch.id, commitId })
    useUiStore.getState().setInspectorTab('why')
    useUiStore.getState().setInspectorOpen(true)
  }

  const onScroll = () => {
    const element = scrollRef.current
    if (!element) return
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight
    setStick(distance < 72)
  }

  const jumpToLatest = () => {
    setStick(true)
    const element = scrollRef.current
    if (element) {
      element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' })
    }
  }

  const resizeComposer = () => {
    const element = textareaRef.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, 160)}px`
  }

  const submit = async () => {
    const message = draft.trim()
    if (!message || streaming || !canWrite) return
    setStick(true)
    setDraft('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    await send(message)
  }

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      void submit()
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="relative min-h-0 flex-1 overflow-y-auto"
      >
        <div className="mx-auto w-full max-w-[760px] px-5 pt-8 pb-6 sm:px-8">
          <div className="mb-7 flex items-center gap-3">
            <span
              className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent-ink"
              aria-hidden
            >
              <GitBranch size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-lg font-semibold tracking-tight text-ink">
                  {branch.name}
                </h1>
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: branch.color ?? 'var(--color-accent)' }}
                  aria-hidden
                />
              </div>
              <p className="mt-0.5 text-[11px] text-muted">
                {space.name} · {plural(branch.message_count, 'message')} ·{' '}
                {plural(branch.memory_count, 'memory', 'memories')}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button
                variant="secondary"
                size="sm"
                disabled={!branch.head_commit_id}
                onClick={() =>
                  branch.head_commit_id &&
                  openFork({ branchId: branch.id, commitId: branch.head_commit_id })
                }
                leadingIcon={<GitFork size={12} aria-hidden />}
              >
                Fork
              </Button>
              {branch.parent_branch_id && (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={branch.archived}
                  onClick={() => openMerge(branch.id)}
                  leadingIcon={<GitMerge size={12} aria-hidden />}
                >
                  Merge up
                </Button>
              )}
            </div>
          </div>

          {branch.archived && (
            <div className="mb-5 flex items-center gap-2 rounded-xl border border-warning/20 bg-warning-soft px-3.5 py-2.5 text-[11px] text-warning">
              <Lock size={13} aria-hidden />
              This branch is archived. Its history and memory stay available.
            </div>
          )}

          {!branch.archived && <SyncBanner branch={branch} />}

          {error && (
            <div className="mb-5 flex items-start gap-2 rounded-xl border border-danger/20 bg-danger-soft px-3.5 py-2.5 text-[11px] leading-relaxed text-danger">
              <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1">{error}</span>
              <button
                type="button"
                onClick={() => void reload()}
                className="inline-flex shrink-0 items-center gap-1 font-medium hover:underline"
              >
                <RefreshCw size={11} aria-hidden />
                Refresh
              </button>
              <button
                type="button"
                onClick={clearError}
                aria-label="Dismiss error"
                className="shrink-0 text-danger/70 hover:text-danger"
              >
                <X size={12} aria-hidden />
              </button>
            </div>
          )}

          {loading ? (
            <div className="flex justify-center py-16 text-muted">
              <Spinner className="size-5" />
            </div>
          ) : !hasContent && !error ? (
            <div className="flex flex-col items-center rounded-2xl border border-dashed border-border bg-subtle/35 px-6 py-16 text-center">
              <span className="mb-4 grid size-12 place-items-center rounded-2xl border border-border bg-surface text-accent shadow-soft">
                <Sparkles size={21} aria-hidden />
              </span>
              <h2 className="font-serif text-xl tracking-tight text-ink">
                This branch is ready
              </h2>
              <p className="mt-2 max-w-sm text-xs leading-relaxed text-muted">
                Ask a question or think out loud. Replies stream here with their
                reasoning, and durable memories are collected for review.
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                <span className="rounded-full border border-border bg-surface px-2.5 py-1 text-[10px] text-muted">
                  {plural(branch.memory_count, 'memory', 'memories')} available
                </span>
                <span className="rounded-full border border-border bg-surface px-2.5 py-1 text-[10px] text-muted">
                  {sentenceCase(branch.thinking_level)} thinking
                </span>
                <span className="rounded-full border border-border bg-surface px-2.5 py-1 text-[10px] text-muted">
                  {sentenceCase(branch.memory_mode)} memory
                </span>
              </div>
            </div>
          ) : hasContent ? (
            <div className="space-y-7" role="log" aria-label="Conversation messages">
              {messages?.map((message) => (
                <MessageItem
                  key={message.id}
                  message={message}
                  color={branchColors.get(message.branch_id)}
                  onOpenTrace={openTrace}
                  onFork={() =>
                    openFork({ branchId: branch.id, commitId: message.id })
                  }
                />
              ))}
              {live && <LiveMessageItem live={live} />}
            </div>
          ) : null}
        </div>

        {!stick && hasContent && (
          <div className="sticky bottom-3 z-10 flex justify-center">
            <button
              type="button"
              onClick={jumpToLatest}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-[10px] font-medium text-muted shadow-soft transition-colors hover:text-ink"
            >
              <ArrowDown size={11} aria-hidden />
              Jump to latest
            </button>
          </div>
        )}
      </div>

      <div className="shrink-0 px-4 pb-4 sm:px-6">
        <div className="mx-auto w-full max-w-[760px]">
          <div
            className={cn(
              'rounded-2xl border border-border bg-surface p-3 shadow-float transition-opacity',
              branch.archived && 'opacity-70',
            )}
          >
            <div className="flex items-end gap-2">
              <textarea
                ref={textareaRef}
                rows={1}
                value={draft}
                maxLength={8000}
                disabled={!canWrite}
                onChange={(event) => {
                  setDraft(event.target.value)
                  resizeComposer()
                }}
                onKeyDown={onComposerKeyDown}
                placeholder={
                  branch.archived
                    ? 'This branch is archived.'
                    : 'Ask anything. This branch will remember what matters.'
                }
                aria-label="Message this branch"
                className="max-h-40 min-h-[36px] flex-1 resize-none bg-transparent px-1 py-2 text-sm leading-relaxed text-ink placeholder:text-muted/70 focus:outline-none disabled:cursor-not-allowed"
              />
              {streaming ? (
                <button
                  type="button"
                  onClick={stop}
                  aria-label="Stop generating"
                  title="Stop generating"
                  className="grid size-9 shrink-0 place-items-center rounded-xl border border-border bg-subtle text-ink transition-colors hover:bg-hover"
                >
                  <Square size={13} fill="currentColor" aria-hidden />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void submit()}
                  disabled={!canWrite || !draft.trim()}
                  aria-label="Send message"
                  title="Send message"
                  className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent text-white transition-colors hover:bg-accent-strong disabled:opacity-35"
                >
                  <ArrowUp size={17} aria-hidden />
                </button>
              )}
            </div>
            <div className="mt-1 flex items-center justify-between gap-2 border-t border-border/70 px-1 pt-2">
              <div className="flex items-center gap-1.5">
                <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[9px] font-medium text-accent-ink">
                  {sentenceCase(branch.memory_mode)} memory
                </span>
                <span className="text-[9px] text-muted">
                  {plural(branch.memory_count, 'memory', 'memories')}
                </span>
                {streaming && (
                  <span className="animate-soft-pulse text-[9px] text-muted">
                    Generating
                  </span>
                )}
              </div>
              <span className="hidden text-[9px] text-muted sm:block">
                Ctrl / Cmd + Enter to send
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function BranchView() {
  const space = useWorkspaceStore((state) =>
    state.spaces.find((item) => item.id === state.currentSpaceId),
  )
  const branch = useWorkspaceStore((state) =>
    state.branches.find((item) => item.id === state.currentBranchId),
  )

  if (!branch || !space) return null
  return <BranchChat key={branch.id} branch={branch} space={space} />
}
