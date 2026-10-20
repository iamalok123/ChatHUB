import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Branch, Memory, MemoryProposal } from '../../api/types'
import { useUiStore } from '../../store/ui'
import { useWorkspaceStore } from '../../store/workspace'
import { MemoryPanel } from './MemoryPanel'

const branch: Branch = {
  id: 'b1',
  space_id: 's1',
  name: 'main',
  parent_branch_id: null,
  fork_commit_id: null,
  head_commit_id: 'head0001',
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
  memory_count: 3,
}

function memory(
  id: string,
  content: string,
  overrides: Partial<Memory> = {},
): Memory {
  return {
    id,
    content,
    kind: 'preference',
    importance: 0.8,
    pinned: false,
    edited: false,
    inherited: false,
    excluded: false,
    origin_branch_id: branch.id,
    origin_branch_name: branch.name,
    source_commit_id: 'head0001',
    supersedes_id: null,
    derived_from_id: null,
    has_embedding: true,
    stale_embedding: false,
    created_at: '2026-01-01T00:00:01.000Z',
    ...overrides,
  }
}

const own = memory('m1', 'The user is building BranchMind.')
const inherited = memory('m2', 'The user prefers short answers.', {
  inherited: true,
  pinned: true,
  origin_branch_id: 'b0',
  origin_branch_name: 'library',
  source_commit_id: 'u12345678',
})
const excluded = memory('m3', 'The user uses tabs for indentation.', {
  inherited: true,
  excluded: true,
  origin_branch_id: 'b0',
  origin_branch_name: 'library',
  source_commit_id: 'u87654321',
})

const conflictProposal: MemoryProposal = {
  id: 'p1',
  branch_id: branch.id,
  commit_id: 'u55555555',
  content: 'The user lives in Bhubaneswar.',
  kind: 'fact',
  importance: 0.8,
  status: 'pending',
  reason: 'Conflicts with a stored fact',
  conflicts_with_memory_id: 'm9',
  conflict_content: 'The user lives in Delhi.',
  conflict_kind: 'fact',
  accepted_memory_id: null,
  resolution: null,
  created_at: '2026-01-01T00:00:02.000Z',
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

beforeEach(() => {
  useWorkspaceStore.getState().reset()
  useWorkspaceStore.setState({
    spaces: [
      {
        id: 's1',
        name: 'Product',
        description: '',
        profile: {},
        created_at: '2026-01-01T00:00:00.000Z',
      },
    ],
    branches: [branch],
    currentSpaceId: 's1',
    currentBranchId: branch.id,
    loadingSpaces: false,
    loadingBranches: false,
    error: null,
  })
  useUiStore.setState({ focusedCommitId: null, toasts: [] })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('memory panel', () => {
  it('groups memory and resolves a conflicting proposal', async () => {
    let acceptBody: Record<string, unknown> | null = null
    let proposals = [conflictProposal]
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input)
        if (path.endsWith('/branches/b1/memories')) {
          return jsonResponse({ memories: [own, inherited], excluded: [excluded] })
        }
        if (path.endsWith('/branches/b1/proposals')) {
          return jsonResponse(proposals)
        }
        if (path.endsWith('/proposals/p1/accept')) {
          acceptBody = JSON.parse(String(init?.body)) as Record<string, unknown>
          proposals = []
          return jsonResponse({ proposal: {}, memory: own })
        }
        if (path.endsWith('/branches/b1')) return jsonResponse(branch)
        return jsonResponse({ error: { code: 'not_found', message: 'Not found' } }, 404)
      },
    )
    vi.stubGlobal('fetch', fetchMock)
    const browser = userEvent.setup()
    render(<MemoryPanel branch={branch} />)

    expect(await screen.findByText('Pending proposals')).toBeInTheDocument()
    expect(screen.getByText('Own memories')).toBeInTheDocument()
    expect(screen.getByText('Inherited')).toBeInTheDocument()
    expect(screen.getByText('Excluded here')).toBeInTheDocument()
    expect(screen.getByText('The user lives in Delhi.')).toBeInTheDocument()
    expect(
      screen.getByText('The user prefers short answers.'),
    ).toBeInTheDocument()

    await browser.click(screen.getByRole('button', { name: 'Replace old' }))
    await waitFor(() => expect(acceptBody).toEqual({ resolution: 'replace' }))
  })

  it('overrides inherited memory and jumps to its source', async () => {
    let action: Record<string, unknown> | null = null
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input)
        if (path.endsWith('/branches/b1/memories')) {
          return jsonResponse({ memories: [inherited], excluded: [] })
        }
        if (path.endsWith('/branches/b1/proposals')) return jsonResponse([])
        if (path.endsWith('/override')) {
          action = JSON.parse(String(init?.body)) as Record<string, unknown>
          return jsonResponse(inherited)
        }
        if (path.endsWith('/branches/b1')) return jsonResponse(branch)
        return jsonResponse({ error: { code: 'not_found', message: 'Not found' } }, 404)
      },
    )
    vi.stubGlobal('fetch', fetchMock)
    const browser = userEvent.setup()
    render(<MemoryPanel branch={branch} />)

    const unpin = await screen.findByRole('button', {
      name: /unpin memory: the user prefers short answers/i,
    })
    await browser.click(unpin)
    await waitFor(() => expect(action).toEqual({ action: 'unpin' }))
    await waitFor(() => expect(unpin).not.toBeDisabled())

    await browser.click(
      screen.getByRole('button', {
        name: /edit memory: the user prefers short answers/i,
      }),
    )
    const editor = screen.getByLabelText('Memory content')
    await browser.clear(editor)
    await browser.type(editor, 'The user prefers brief, direct answers.')
    await browser.click(screen.getByRole('button', { name: 'Save here' }))

    await waitFor(() =>
      expect(action).toEqual({
        action: 'edit',
        content: 'The user prefers brief, direct answers.',
      }),
    )

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /Source u1234567/i }),
      ).toBeInTheDocument(),
    )
    await browser.click(screen.getByRole('button', { name: /Source u1234567/i }))
    expect(useUiStore.getState().focusedCommitId).toBe('u12345678')
  })

  it('adds a manual memory with a kind and importance', async () => {
    let createBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input)
        if (path.endsWith('/branches/b1/memories') && init?.method === 'POST') {
          createBody = JSON.parse(String(init.body)) as Record<string, unknown>
          return jsonResponse(own, 201)
        }
        if (path.endsWith('/branches/b1/memories')) {
          return jsonResponse({ memories: [], excluded: [] })
        }
        if (path.endsWith('/branches/b1/proposals')) return jsonResponse([])
        if (path.endsWith('/branches/b1')) return jsonResponse(branch)
        return jsonResponse({ error: { code: 'not_found', message: 'Not found' } }, 404)
      },
    )
    vi.stubGlobal('fetch', fetchMock)
    const browser = userEvent.setup()
    render(<MemoryPanel branch={branch} />)

    await browser.click(await screen.findByRole('button', { name: 'Add memory' }))
    await browser.type(
      screen.getByLabelText('Memory content'),
      'The user is building BranchMind.',
    )
    await browser.selectOptions(screen.getByLabelText('Memory kind'), 'decision')
    await browser.click(screen.getByRole('button', { name: 'Save memory' }))

    await waitFor(() =>
      expect(createBody).toEqual({
        content: 'The user is building BranchMind.',
        kind: 'decision',
        importance: 0.5,
      }),
    )
  })
})
