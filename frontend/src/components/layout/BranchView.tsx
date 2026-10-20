import { ArrowUp, Bot, GitBranch, Lock, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { api, errorMessage } from '../../api/client'
import type { Message } from '../../api/types'
import { cn } from '../../lib/cn'
import { plural, sentenceCase } from '../../lib/format'
import {
  selectCurrentBranch,
  selectCurrentSpace,
  useWorkspaceStore,
} from '../../store/workspace'
import { Spinner } from '../ui/Spinner'

function MessageItem({
  message,
  color,
}: {
  message: Message
  color?: string | null
}) {
  const inherited = message.is_inherited
  const assistant = message.role === 'assistant'

  if (!assistant) {
    return (
      <div className="flex justify-end">
        <div
          className={cn(
            'max-w-[86%] rounded-2xl rounded-br-md border border-border bg-sidebar px-4 py-3 text-sm leading-relaxed text-ink shadow-soft',
            inherited && 'border-l-2',
          )}
          style={inherited ? { borderLeftColor: color ?? 'var(--color-accent)' } : undefined}
        >
          {inherited && (
            <p className="mb-1 text-[9px] font-medium tracking-wide text-muted uppercase">
              from {message.origin_branch_name}
            </p>
          )}
          <p className="message-text">{message.content}</p>
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn('flex gap-3', inherited && 'border-l-2 pl-4')}
      style={inherited ? { borderLeftColor: color ?? 'var(--color-accent)' } : undefined}
    >
      <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent-ink">
        <Bot size={15} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-2 text-[10px] text-muted">
          <span className="font-medium text-ink">Assistant</span>
          {inherited && <span>from {message.origin_branch_name}</span>}
          {message.status !== 'complete' && (
            <span className="rounded-full bg-warning-soft px-1.5 py-0.5 text-[9px] font-medium text-warning">
              {sentenceCase(message.status)}
            </span>
          )}
        </div>
        <div className="message-text font-serif text-[15px] leading-[1.75] text-ink">
          {message.content}
        </div>
      </div>
    </div>
  )
}

export function BranchView() {
  const space = useWorkspaceStore(selectCurrentSpace)
  const branch = useWorkspaceStore(selectCurrentBranch)
  const branches = useWorkspaceStore((state) => state.branches)
  const [messages, setMessages] = useState<Message[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const branchId = branch?.id

  useEffect(() => {
    if (!branchId) return
    const controller = new AbortController()
    api
      .get<Message[]>(`/branches/${branchId}/messages`, controller.signal)
      .then((result) => setMessages(result))
      .catch((caught) => {
        if (controller.signal.aborted) return
        setError(errorMessage(caught))
      })
    return () => controller.abort()
  }, [branchId])

  useEffect(() => {
    if (messages && messages.length > 0) {
      endRef.current?.scrollIntoView({ block: 'nearest' })
    }
  }, [messages])

  if (!branch || !space) return null

  const branchById = new Map(branches.map((item) => [item.id, item.color]))

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[760px] px-5 pt-8 pb-6 sm:px-8">
          <div className="mb-7 flex items-center gap-3">
            <span
              className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent-ink"
              aria-hidden
            >
              <GitBranch size={18} />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-lg font-semibold tracking-tight text-ink">
                  {branch.name}
                </h1>
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: branch.color ?? 'var(--color-accent)' }}
                  aria-hidden
                />
              </div>
              <p className="mt-0.5 text-[11px] text-muted">
                {space.name} · {plural(branch.message_count, 'message')} ·{' '}
                {plural(branch.memory_count, 'memory', 'memories')}
              </p>
            </div>
          </div>

          {branch.archived && (
            <div className="mb-5 flex items-center gap-2 rounded-xl border border-warning/20 bg-warning-soft px-3.5 py-2.5 text-[11px] text-warning">
              <Lock size={13} aria-hidden />
              This branch is archived. Its history and memory stay available.
            </div>
          )}

          {error ? (
            <div className="rounded-xl border border-danger/20 bg-danger-soft px-4 py-4 text-xs text-danger">
              {error}
            </div>
          ) : messages === null ? (
            <div className="flex justify-center py-16 text-muted">
              <Spinner className="size-5" />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center rounded-2xl border border-dashed border-border bg-subtle/35 px-6 py-16 text-center">
              <span className="mb-4 grid size-12 place-items-center rounded-2xl border border-border bg-surface text-accent shadow-soft">
                <Sparkles size={21} aria-hidden />
              </span>
              <h2 className="font-serif text-xl tracking-tight text-ink">
                This branch is ready
              </h2>
              <p className="mt-2 max-w-sm text-xs leading-relaxed text-muted">
                Its history and inherited memories are in place. The streaming composer
                joins in the next build, then every reply will arrive with its own trace.
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                <span className="rounded-full border border-border bg-surface px-2.5 py-1 text-[10px] text-muted">
                  {plural(branch.memory_count, 'memory', 'memories')} inherited
                </span>
                <span className="rounded-full border border-border bg-surface px-2.5 py-1 text-[10px] text-muted">
                  {sentenceCase(branch.thinking_level)} thinking
                </span>
                <span className="rounded-full border border-border bg-surface px-2.5 py-1 text-[10px] text-muted">
                  {sentenceCase(branch.memory_mode)} memory
                </span>
              </div>
            </div>
          ) : (
            <div className="space-y-7" role="log" aria-label="Conversation messages">
              {messages.map((message) => (
                <MessageItem
                  key={message.id}
                  message={message}
                  color={branchById.get(message.branch_id)}
                />
              ))}
              <div ref={endRef} />
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 px-4 pb-4 sm:px-6">
        <div className="mx-auto w-full max-w-[760px]">
          <div className="rounded-2xl border border-border bg-surface p-3 opacity-80 shadow-float">
            <div className="flex items-end gap-2">
              <textarea
                rows={1}
                disabled
                placeholder="The chat composer arrives in the next build."
                aria-label="Chat composer unavailable"
                className="max-h-32 min-h-[36px] flex-1 resize-none bg-transparent px-1 py-2 text-sm text-ink placeholder:text-muted/70 focus:outline-none disabled:cursor-not-allowed"
              />
              <button
                type="button"
                disabled
                aria-label="Send message"
                className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent text-white disabled:opacity-40"
              >
                <ArrowUp size={17} aria-hidden />
              </button>
            </div>
            <div className="mt-1 flex items-center justify-between gap-2 border-t border-border/70 px-1 pt-2">
              <div className="flex items-center gap-1.5">
                <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[9px] font-medium text-accent-ink">
                  {sentenceCase(branch.memory_mode)} memory
                </span>
                <span className="text-[9px] text-muted">
                  {plural(branch.memory_count, 'memory', 'memories')}
                </span>
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
