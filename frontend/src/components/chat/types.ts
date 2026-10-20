import type {
  ChatDoneEvent,
  ChatErrorEvent,
  Memory,
  MemoryProposal,
  TraceStep,
  TraceUsage,
} from '../../api/types'

export type LiveReply = {
  content: string
  thinking: string
  syntheticThinking: boolean
  steps: TraceStep[]
  usage: TraceUsage
  done: ChatDoneEvent | null
  error: ChatErrorEvent | null
  proposals: MemoryProposal[]
  autoSaved: Memory[]
  status: string
}

export function liveMemoryCount(live: LiveReply): number {
  const retrieve = live.steps.find((step) => step.phase === 'retrieve')
  const selected = retrieve?.payload.selected
  return typeof selected === 'number' ? selected : 0
}

export function liveDuration(live: LiveReply): number {
  if (live.done) return live.done.duration_ms
  const generate = [...live.steps].reverse().find((step) => step.phase === 'generate')
  const durations = live.steps.reduce((total, step) => total + step.duration_ms, 0)
  return generate?.duration_ms ?? durations
}
