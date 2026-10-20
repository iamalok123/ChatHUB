import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import type { Branch, TraceResponse } from '../../api/types'
import { useUiStore } from '../../store/ui'
import { TracePanel } from './TracePanel'

const branch: Branch = {
  id: 'b1',
  space_id: 's1',
  name: 'main',
  parent_branch_id: null,
  fork_commit_id: null,
  head_commit_id: 'a1',
  system_prompt: '',
  persona: '',
  model: null,
  thinking_level: 'medium',
  top_k: 6,
  memory_mode: 'review',
  color: '#C96442',
  archived: false,
  created_at: '2026-01-01T00:00:00.000Z',
  is_root: true,
  message_count: 2,
  memory_count: 1,
}

const traceResponse: TraceResponse = {
  commit_id: 'a1',
  branch_id: 'b1',
  trace_version: 1,
  trace: {
    version: 1,
    provider: 'mock',
    mock: true,
    model: 'mock',
    thinking_level: 'medium',
    thinking_summary: 'Context summary: one preference was selected.',
    thinking_source: 'synthetic_context',
    context: {
      system_tokens: 120,
      memory_tokens: 20,
      history_tokens: 80,
      current_tokens: 8,
      total_tokens: 228,
      history_messages: 2,
      dropped_turns: 0,
      memory_count: 1,
    },
    memory_mode: 'review',
    retrieval: {
      query: 'How should I answer?',
      query_tokens: 6,
      used_tokens: 20,
      top_k: 6,
      duration_ms: 8,
    },
    retrieved_memories: [
      {
        id: 'm1',
        content: 'Prefers short answers.',
        kind: 'preference',
        importance: 0.8,
        pinned: true,
        edited: false,
        inherited: true,
        origin_branch_name: 'main',
        source_commit_id: 'u0',
        similarity: 0.84,
        importance_score: 0.8,
        recency: 0.97,
        score: 0.91,
        reason: 'pinned',
        tokens: 20,
      },
    ],
    considered_memories: [
      {
        id: 'm2',
        content: 'An old project note.',
        kind: 'fact',
        importance: 0.3,
        pinned: false,
        edited: false,
        inherited: false,
        origin_branch_name: 'main',
        source_commit_id: 'u0',
        similarity: 0.2,
        importance_score: 0.3,
        recency: 0.4,
        score: 0.2,
        reason: 'below score threshold',
        tokens: 12,
      },
    ],
    excluded_memories: [],
    memory_operations: [
      {
        op: 'memory_auto_saved',
        memory_id: 'm3',
        content: 'Prefers examples first.',
      },
    ],
    warnings: [],
    usage: {
      prompt_token_count: 200,
      candidates_token_count: 28,
      total_token_count: 228,
    },
    finish_reason: 'STOP',
    steps: [
      { phase: 'retrieve', status: 'done', duration_ms: 8, payload: {} },
      { phase: 'generate', status: 'done', duration_ms: 2100, payload: {} },
    ],
    error: null,
    error_code: null,
    status: 'complete',
    generate_ms: 2100,
    completed_at: '2026-01-01T00:00:02.000Z',
  },
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('renders ranked memories, context, usage, and synthetic reasoning labels', async () => {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL) => ({
    ok: true,
    status: 200,
    json: async () => traceResponse,
  }))
  vi.stubGlobal('fetch', fetchMock)
  useUiStore.setState({ focusedCommitId: null })
  const browser = userEvent.setup()

  render(
    <TracePanel
      branch={branch}
      target={{ branchId: 'b1', commitId: 'a1' }}
    />,
  )

  expect(await screen.findByText('Why this answer')).toBeInTheDocument()
  expect(screen.getAllByText('Context summary').length).toBeGreaterThan(0)
  expect(
    screen.getByText('Mock mode. This is not live Gemini reasoning.'),
  ).toBeInTheDocument()
  expect(screen.getByText('Prefers short answers.')).toBeInTheDocument()
  expect(screen.getByText('pinned')).toBeInTheDocument()
  expect(screen.getByText('How should I answer?')).toBeInTheDocument()
  expect(screen.getAllByText('2.1s').length).toBeGreaterThan(0)
  expect(screen.getByText('Context composition')).toBeInTheDocument()
  expect(screen.getByText(/considered but skipped/i)).toBeInTheDocument()
  expect(screen.getByText('Memory auto saved')).toBeInTheDocument()
  expect(screen.getByText(/Prefers examples first/)).toBeInTheDocument()

  await browser.click(screen.getAllByRole('button', { name: /source/i })[0])
  expect(useUiStore.getState().focusedCommitId).toBe('u0')

  const [url] = fetchMock.mock.calls[0]
  expect(url).toBe('/api/branches/b1/messages/a1/trace')
})

it('asks for a reply before showing a trace', () => {
  render(<TracePanel branch={branch} target={null} />)

  expect(screen.getByText('No answer selected')).toBeInTheDocument()
})
