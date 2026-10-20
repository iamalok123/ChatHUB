import { Bot, Check, Copy, GitFork, Lightbulb, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import type { ReactNode } from 'react'

import type { Message } from '../../api/types'
import { copyToClipboard } from '../../lib/clipboard'
import { cn } from '../../lib/cn'
import { sentenceCase } from '../../lib/format'
import { MarkdownMessage } from './MarkdownMessage'
import { ReasoningPill } from './ReasoningPill'
import type { LiveReply } from './types'
import { liveDuration, liveMemoryCount } from './types'

type MessageItemProps = {
  message: Message
  color?: string | null
  onOpenTrace: (commitId: string) => void
  onFork?: () => void
}

function ActionButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid size-7 place-items-center rounded-md text-muted/80 transition-colors hover:bg-hover hover:text-ink"
    >
      {children}
    </button>
  )
}

function MessageActions({
  content,
  commitId,
  assistant,
  onOpenTrace,
  onFork,
}: {
  content: string
  commitId: string
  assistant: boolean
  onOpenTrace: (commitId: string) => void
  onFork?: () => void
}) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    await copyToClipboard(content)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div className="mt-1.5 flex items-center gap-0.5 opacity-100 transition-opacity duration-150 sm:opacity-0 sm:group-hover/message:opacity-100 sm:group-focus-within/message:opacity-100">
      <ActionButton label={copied ? 'Copied' : 'Copy message'} onClick={() => void copy()}>
        {copied ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
      </ActionButton>
      {onFork && (
        <ActionButton label="Fork from here" onClick={onFork}>
          <GitFork size={13} aria-hidden />
        </ActionButton>
      )}
      {assistant && (
        <ActionButton label="Why this answer" onClick={() => onOpenTrace(commitId)}>
          <Lightbulb size={13} aria-hidden />
        </ActionButton>
      )}
    </div>
  )
}

export function MessageItem({
  message,
  color,
  onOpenTrace,
  onFork,
}: MessageItemProps) {
  const inherited = message.is_inherited
  const assistant = message.role === 'assistant'
  const summary = message.trace_summary
  const synthetic = summary?.thinking_source === 'synthetic_context'
  const failed = message.status === 'error' || message.status === 'partial'

  if (!assistant) {
    return (
      <article className="group/message flex flex-col items-end">
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
        <MessageActions
          content={message.content}
          commitId={message.id}
          assistant={false}
          onOpenTrace={onOpenTrace}
          onFork={onFork}
        />
      </article>
    )
  }

  return (
    <article
      className={cn(
        'group/message flex gap-3',
        inherited && 'border-l-2 pl-4',
      )}
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

        {summary && (
          <ReasoningPill
            thinking={summary.thinking_summary}
            synthetic={synthetic}
            mock={summary.mock}
            durationMs={summary.duration_ms}
            memoryCount={summary.memory_count}
            usage={summary.usage}
            failed={failed}
            onOpenTrace={() => onOpenTrace(message.id)}
          />
        )}

        <MarkdownMessage content={message.content} />

        {failed && message.status === 'partial' && (
          <p className="mt-2 text-[10px] text-warning">
            This reply ended before the provider finished. Its partial text was kept.
          </p>
        )}

        <MessageActions
          content={message.content}
          commitId={message.id}
          assistant
          onOpenTrace={onOpenTrace}
          onFork={onFork}
        />
      </div>
    </article>
  )
}

export function LiveMessageItem({ live }: { live: LiveReply }) {
  const streaming = live.status === 'streaming'
  const failed = live.status === 'error' || live.status === 'partial'
  const duration = liveDuration(live)

  return (
    <article className="group/message flex gap-3" aria-live="polite">
      <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent-ink">
        <Bot size={15} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-2 text-[10px] text-muted">
          <span className="font-medium text-ink">Assistant</span>
          {live.done?.provider === 'mock' && (
            <span className="rounded-full bg-warning-soft px-1.5 py-0.5 text-[8px] font-semibold tracking-wide text-warning uppercase">
              Mock mode
            </span>
          )}
          {streaming && <span className="animate-soft-pulse">Streaming</span>}
        </div>

        <ReasoningPill
          thinking={live.thinking || null}
          synthetic={live.syntheticThinking}
          mock={live.done?.provider === 'mock'}
          durationMs={duration}
          memoryCount={liveMemoryCount(live)}
          steps={live.steps}
          usage={live.usage}
          streaming={streaming}
          failed={failed}
        />

        {live.content ? (
          <MarkdownMessage content={live.content} streaming={streaming} />
        ) : streaming ? (
          <p className="text-[13px] text-muted italic">Composing a reply…</p>
        ) : null}

        {live.error && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-danger/20 bg-danger-soft px-3 py-2.5 text-[11px] leading-relaxed text-danger">
            <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden />
            <span>{live.error.message}</span>
          </div>
        )}
      </div>
    </article>
  )
}
