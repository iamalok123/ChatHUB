import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type { Branch, Message, Space } from '../../api/types'
import { useTraceStore } from '../../store/trace'
import { useUiStore } from '../../store/ui'
import { useWorkspaceStore } from '../../store/workspace'
import { BranchView } from './BranchView'

const space: Space = {
  id: 's1',
  name: 'Product thinking',
  description: '',
  profile: {},
  created_at: '2026-01-01T00:00:00.000Z',
}

const branch: Branch = {
  id: 'b1',
  space_id: 's1',
  name: 'main',
  parent_branch_id: null,
  fork_commit_id: null,
  head_commit_id: 'anchor-1',
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
  message_count: 0,
  memory_count: 2,
}

const transcript: Message[] = [
  {
    id: 'u1',
    role: 'user',
    content: 'Hello',
    parent_id: 'anchor-1',
    branch_id: 'b1',
    origin_branch_name: 'main',
    is_inherited: false,
    status: 'complete',
    created_at: '2026-01-01T00:00:01.000Z',
  },
  {
    id: 'a1',
    role: 'assistant',
    content: '**Mock answer** with a durable memory.',
    parent_id: 'u1',
    branch_id: 'b1',
    origin_branch_name: 'main',
    is_inherited: false,
    status: 'complete',
    created_at: '2026-01-01T00:00:02.000Z',
    trace_summary: {
      version: 1,
      provider: 'mock',
      mock: true,
      duration_ms: 1200,
      memory_count: 2,
      thinking_summary: 'Used two memories in mock mode.',
      thinking_source: 'model',
      usage: { total_token_count: 47 },
      status: 'complete',
    },
  },
]

const encoder = new TextEncoder()

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

function streamResponse(content: string): Response {
  const events = [
    sse('step', {
      phase: 'retrieve',
      status: 'done',
      duration_ms: 4,
      payload: { selected: 2, considered: 0, excluded: 0, tokens: 28, warnings: [] },
    }),
    sse('step', {
      phase: 'compose',
      status: 'done',
      duration_ms: 2,
      payload: { total_tokens: 120 },
    }),
    sse('step', {
      phase: 'generate',
      status: 'running',
      duration_ms: 0,
      payload: { provider: 'mock' },
    }),
    sse('thinking', { text: 'Used two memories in mock mode.', synthetic: false }),
    sse('token', { text: content }),
    sse('step', {
      phase: 'generate',
      status: 'done',
      duration_ms: 1200,
      payload: { provider: 'mock', usage: { total_token_count: 47 } },
    }),
    sse('step', {
      phase: 'extract',
      status: 'done',
      duration_ms: 3,
      payload: { mode: 'review', proposals: 1, auto_saved: 0, warnings: [] },
    }),
    sse('done', {
      user_commit_id: 'u1',
      assistant_commit_id: 'a1',
      head_commit_id: 'a1',
      usage: { total_token_count: 47 },
      duration_ms: 1200,
      trace_version: 1,
      status: 'complete',
      provider: 'mock',
    }),
  ].join('')
  const bytes = encoder.encode(events)
  let read = false
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () => {
          if (read) return { done: true, value: undefined }
          read = true
          return { done: false, value: bytes }
        },
      }),
    },
  } as unknown as Response
}

beforeEach(() => {
  useWorkspaceStore.getState().reset()
  useWorkspaceStore.setState({
    spaces: [space],
    branches: [branch],
    currentSpaceId: space.id,
    currentBranchId: branch.id,
    loadingSpaces: false,
    loadingBranches: false,
    error: null,
  })
  useUiStore.setState({
    theme: 'system',
    sidebarOpen: false,
    inspectorOpen: true,
    inspectorTab: 'memory',
    settingsOpen: false,
    newSpaceOpen: false,
    toasts: [],
  })
  useTraceStore.setState({ target: null })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('streams a reply, settles the transcript, and opens its trace', async () => {
  let chatStarted = false
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const path = String(input)
    if (path.endsWith('/branches/b1/chat')) {
      chatStarted = true
      return streamResponse('**Mock answer** with a durable memory.')
    }
    if (path.endsWith('/branches/b1/messages')) {
      return jsonResponse(chatStarted ? transcript : [])
    }
    if (path.endsWith('/branches/b1')) {
      return jsonResponse({ ...branch, head_commit_id: 'a1', message_count: 2 })
    }
    return jsonResponse({ error: { code: 'not_found', message: 'Not found' } }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  const browser = userEvent.setup()
  render(<BranchView />)

  expect(await screen.findByText(/this branch is ready/i)).toBeInTheDocument()
  await browser.type(screen.getByLabelText('Message this branch'), 'Hello')
  await browser.keyboard('{Control>}{Enter}{/Control}')

  expect(await screen.findByText('Hello')).toBeInTheDocument()
  expect(await screen.findByText('Mock answer')).toBeInTheDocument()
  expect(
    await screen.findByRole('button', { name: /reasoned for 1.2s.*2 memories/i }),
  ).toBeInTheDocument()

  await waitFor(() => {
    expect(useWorkspaceStore.getState().branches[0].message_count).toBe(2)
  })

  const [chatUrl, chatInit] = fetchMock.mock.calls.find(([input]) =>
    String(input).endsWith('/chat'),
  ) ?? [null, undefined]
  expect(chatUrl).toBe('/api/branches/b1/chat')
  const headers = new Headers(chatInit?.headers)
  expect(headers.get('X-BranchMind-Request')).toBe('1')
  expect(JSON.parse(String(chatInit?.body))).toEqual({
    message: 'Hello',
    expected_head_id: 'anchor-1',
  })

  await browser.click(screen.getByRole('button', { name: 'Why this answer' }))
  expect(useTraceStore.getState().target).toEqual({
    branchId: 'b1',
    commitId: 'a1',
  })
  expect(useUiStore.getState().inspectorTab).toBe('why')
})
