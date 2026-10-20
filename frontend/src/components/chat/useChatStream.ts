import { useCallback, useEffect, useRef, useState } from 'react'

import { api, errorMessage } from '../../api/client'
import { streamApi } from '../../api/sse'
import type {
  ChatDoneEvent,
  ChatErrorEvent,
  ChatProposalsEvent,
  ChatStepEvent,
  ChatThinkingEvent,
  ChatTokenEvent,
  Message,
  TraceStep,
} from '../../api/types'
import { useWorkspaceStore } from '../../store/workspace'
import type { LiveReply } from './types'

const STREAM_REFRESH_DELAY_MS = 240

function emptyLive(): LiveReply {
  return {
    content: '',
    thinking: '',
    syntheticThinking: false,
    steps: [],
    usage: {},
    done: null,
    error: null,
    proposals: [],
    autoSaved: [],
    status: 'streaming',
  }
}

function upsertStep(steps: TraceStep[], next: ChatStepEvent): TraceStep[] {
  const step: TraceStep = {
    phase: next.phase,
    status: next.status,
    duration_ms: next.duration_ms,
    payload: next.payload,
  }
  const index = steps.findIndex((item) => item.phase === next.phase)
  if (index === -1) return [...steps, step]
  return steps.map((item, position) => (position === index ? step : item))
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

function requestFrame(callback: FrameRequestCallback): number {
  if (typeof window.requestAnimationFrame === 'function') {
    return window.requestAnimationFrame(callback)
  }
  return window.setTimeout(() => callback(performance.now()), 16)
}

function cancelFrameHandle(handle: number): void {
  if (typeof window.cancelAnimationFrame === 'function') {
    window.cancelAnimationFrame(handle)
    return
  }
  window.clearTimeout(handle)
}

export function useChatStream(branchId: string, branchName: string, headId: string | null) {
  const [messages, setMessages] = useState<Message[] | null>(null)
  const [live, setLive] = useState<LiveReply | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [streaming, setStreaming] = useState(false)
  const mounted = useRef(true)
  const streamingRef = useRef(false)
  const controllerRef = useRef<AbortController | null>(null)
  const tokenBuffer = useRef('')
  const frame = useRef<number | null>(null)

  const cancelFrame = useCallback(() => {
    if (frame.current !== null) {
      cancelFrameHandle(frame.current)
      frame.current = null
    }
  }, [])

  const flushTokens = useCallback(() => {
    cancelFrame()
    const buffered = tokenBuffer.current
    tokenBuffer.current = ''
    if (!buffered) return
    setLive((current) =>
      current ? { ...current, content: current.content + buffered } : current,
    )
  }, [cancelFrame])

  const scheduleTokens = useCallback(() => {
    if (frame.current !== null) return
    frame.current = requestFrame(() => {
      frame.current = null
      const buffered = tokenBuffer.current
      tokenBuffer.current = ''
      if (!buffered) return
      setLive((current) =>
        current ? { ...current, content: current.content + buffered } : current,
      )
    })
  }, [])

  const loadMessages = useCallback(
    async (signal?: AbortSignal) => {
      const result = await api.get<Message[]>(`/branches/${branchId}/messages`, signal)
      if (!mounted.current) return
      setMessages(result)
      setLoading(false)
    },
    [branchId],
  )

  useEffect(() => {
    mounted.current = true
    const controller = new AbortController()
    loadMessages(controller.signal).catch((caught) => {
      if (controller.signal.aborted || !mounted.current) return
      setError(errorMessage(caught))
      setLoading(false)
    })
    return () => {
      controller.abort()
      controllerRef.current?.abort()
      cancelFrame()
      mounted.current = false
    }
  }, [cancelFrame, loadMessages])

  const reload = useCallback(async () => {
    setError(null)
    try {
      await loadMessages()
      await useWorkspaceStore.getState().refreshBranch(branchId)
    } catch (caught) {
      if (!mounted.current) return
      setError(errorMessage(caught))
    }
  }, [branchId, loadMessages])

  const finishStream = useCallback(
    async (streamError: ChatErrorEvent | null) => {
      flushTokens()
      if (!mounted.current) return
      try {
        const result = await api.get<Message[]>(`/branches/${branchId}/messages`)
        if (!mounted.current) return
        setMessages(result)
        await useWorkspaceStore.getState().refreshBranch(branchId)
        if (!mounted.current) return
        setLive(null)
        setStreaming(false)
        streamingRef.current = false
      } catch (caught) {
        if (!mounted.current) return
        setLive((current) =>
          current
            ? {
                ...current,
                status: streamError?.status ?? (current.content ? 'complete' : 'error'),
              }
            : current,
        )
        setStreaming(false)
        streamingRef.current = false
        if (!streamError) {
          setError(
            `The reply was saved, but the transcript could not refresh. ${errorMessage(caught)}`,
          )
        }
      }
    },
    [branchId, flushTokens],
  )

  const send = useCallback(
    async (text: string) => {
      const message = text.trim()
      if (!message || streamingRef.current || !headId) return

      streamingRef.current = true
      setStreaming(true)
      setError(null)
      const pendingId = `pending-${Date.now()}`
      const optimistic: Message = {
        id: pendingId,
        role: 'user',
        content: message,
        parent_id: headId,
        branch_id: branchId,
        origin_branch_name: branchName,
        is_inherited: false,
        status: 'complete',
        created_at: new Date().toISOString(),
      }
      setMessages((current) => [...(current ?? []), optimistic])
      setLive(emptyLive())

      const controller = new AbortController()
      controllerRef.current = controller
      let streamError: ChatErrorEvent | null = null

      try {
        await streamApi(`/branches/${branchId}/chat`, {
          body: { message, expected_head_id: headId },
          signal: controller.signal,
          onEvent: (event) => {
            if (!mounted.current) return
            if (event.event === 'token') {
              const data = event.data as ChatTokenEvent
              tokenBuffer.current += data.text
              scheduleTokens()
              return
            }
            if (event.event === 'thinking') {
              const data = event.data as ChatThinkingEvent
              setLive((current) =>
                current
                  ? {
                      ...current,
                      thinking: current.thinking + data.text,
                      syntheticThinking:
                        current.syntheticThinking || data.synthetic,
                    }
                  : current,
              )
              return
            }
            if (event.event === 'step') {
              const data = event.data as ChatStepEvent
              setLive((current) =>
                current
                  ? { ...current, steps: upsertStep(current.steps, data) }
                  : current,
              )
              return
            }
            if (event.event === 'proposals') {
              const data = event.data as ChatProposalsEvent
              setLive((current) =>
                current
                  ? {
                      ...current,
                      proposals: data.proposals,
                      autoSaved: data.auto_saved,
                    }
                  : current,
              )
              return
            }
            if (event.event === 'done') {
              const data = event.data as ChatDoneEvent
              flushTokens()
              setLive((current) =>
                current
                  ? {
                      ...current,
                      done: data,
                      usage: data.usage,
                      status: data.status,
                    }
                  : current,
              )
              setMessages((current) =>
                current?.map((item) =>
                  item.id === pendingId && data.user_commit_id
                    ? { ...item, id: data.user_commit_id }
                    : item,
                ) ?? current,
              )
              return
            }
            if (event.event === 'error') {
              const data = event.data as ChatErrorEvent
              streamError = data
              flushTokens()
              setLive((current) =>
                current ? { ...current, error: data, status: data.status } : current,
              )
              setError(data.message)
            }
          },
        })
        await finishStream(streamError)
      } catch (caught) {
        if (!mounted.current) return
        if (isAbortError(caught)) {
          flushTokens()
          setLive((current) =>
            current ? { ...current, status: current.content ? 'partial' : 'error' } : current,
          )
          await delay(STREAM_REFRESH_DELAY_MS)
          if (!mounted.current) return
          try {
            const result = await api.get<Message[]>(`/branches/${branchId}/messages`)
            if (!mounted.current) return
            setMessages(result)
            await useWorkspaceStore.getState().refreshBranch(branchId)
            if (!mounted.current) return
            setLive(null)
          } catch {
            return
          } finally {
            if (mounted.current) {
              setStreaming(false)
              streamingRef.current = false
            }
          }
          return
        }

        flushTokens()
        setError(errorMessage(caught))
        setLive((current) =>
          current ? { ...current, status: current.content ? 'partial' : 'error' } : current,
        )
        setStreaming(false)
        streamingRef.current = false
        try {
          const result = await api.get<Message[]>(`/branches/${branchId}/messages`)
          if (!mounted.current) return
          setMessages(result)
          setLive(null)
          void useWorkspaceStore.getState().refreshBranch(branchId)
        } catch {
          return
        }
      } finally {
        controllerRef.current = null
      }
    },
    [
      branchId,
      branchName,
      finishStream,
      flushTokens,
      headId,
      scheduleTokens,
    ],
  )

  const stop = useCallback(() => {
    controllerRef.current?.abort()
  }, [])

  return {
    messages,
    live,
    error,
    loading,
    streaming,
    send,
    stop,
    reload,
    clearError: () => setError(null),
  }
}
