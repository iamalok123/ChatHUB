import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  Branch,
  ForkPreview,
  Memory,
  MergePreview,
  MergeResult,
  MergeSummary,
  SyncPreview,
  SyncResult,
} from '../api/types'
import { useOperationsStore } from '../store/operations'
import { useUiStore } from '../store/ui'
import { useWorkspaceStore } from '../store/workspace'
import { BranchMenu } from '../components/operations/BranchMenu'
import { ForkDialog } from '../components/operations/ForkDialog'
import { MergeDialog } from '../components/operations/MergeDialog'
import { SyncDialog } from '../components/operations/SyncDialog'

const main: Branch = {
  id: 'b1',
  space_id: 's1',
  name: 'main',
  parent_branch_id: null,
  fork_commit_id: null,
  head_commit_id: 'head-main',
  system_prompt: '',
  persona: 'A careful assistant.',
  model: null,
  thinking_level: 'medium',
  top_k: 6,
  memory_mode: 'review',
  color: '#C96442',
  archived: false,
  created_at: '2026-01-01T00:00:00.000Z',
  is_root: true,
  message_count: 4,
  memory_count: 2,
}

const child: Branch = {
  ...main,
  id: 'b2',
  name: 'Feature',
  parent_branch_id: main.id,
  fork_commit_id: 'a-main',
  head_commit_id: 'head-child',
  is_root: false,
  message_count: 2,
  memory_count: 1,
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
    inherited: true,
    excluded: false,
    origin_branch_id: main.id,
    origin_branch_name: main.name,
    source_commit_id: 'a-main',
    supersedes_id: null,
    derived_from_id: null,
    has_embedding: true,
    stale_embedding: false,
    created_at: '2026-01-01T00:00:01.000Z',
    ...overrides,
  }
}

const shortAnswers = memory('m1', 'The user prefers short answers', { pinned: true })
const tabs = memory('m2', 'The user prefers tabs for indentation', { kind: 'fact' })

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

function setWorkspace(branches: Branch[], currentBranchId: string): void {
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
    branches,
    currentSpaceId: 's1',
    currentBranchId,
    loadingSpaces: false,
    loadingBranches: false,
    error: null,
  })
}

beforeEach(() => {
  useWorkspaceStore.getState().reset()
  setWorkspace([main, child], child.id)
  useUiStore.setState({ toasts: [] })
  useOperationsStore.setState({
    forkTarget: null,
    mergeSourceId: null,
    syncBranchId: null,
    renameBranchId: null,
    syncRevision: 0,
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('branch operations', () => {
  it('forks with excluded and pinned memories from the preview', async () => {
    const preview: ForkPreview = {
      source_branch_id: main.id,
      commit_id: 'a-main',
      commit_role: 'assistant',
      memories: [shortAnswers, tabs],
      pinned_count: 1,
    }
    const forked: Branch = {
      ...main,
      id: 'b3',
      name: 'Focused',
      parent_branch_id: main.id,
      fork_commit_id: 'a-main',
      is_root: false,
      memory_count: 1,
    }
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input)
      if (path.includes('/fork-preview')) return jsonResponse(preview)
      if (path.endsWith('/fork') && init?.method === 'POST') {
        requestBody = JSON.parse(String(init.body)) as Record<string, unknown>
        return jsonResponse(forked, 201)
      }
      return jsonResponse({ error: { code: 'not_found', message: 'Not found' } }, 404)
    })
    vi.stubGlobal('fetch', fetchMock)
    const browser = userEvent.setup()
    render(
      <ForkDialog target={{ branchId: main.id, commitId: 'a-main', nameHint: 'Focused' }} />,
    )

    expect(await screen.findByText(/2 memories available/i)).toBeInTheDocument()
    await browser.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText(/keeping 2 of 2 memories/i)).toBeInTheDocument()

    await browser.click(
      screen.getByRole('checkbox', { name: /prefers tabs for indentation/i }),
    )
    expect(screen.getByText(/keeping 1 of 2 memories/i)).toBeInTheDocument()
    await browser.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByText('Focused')).toBeInTheDocument()
    await browser.click(screen.getByRole('button', { name: 'Create fork' }))

    await waitFor(() => expect(requestBody).not.toBeNull())
    expect(requestBody).toMatchObject({
      name: 'Focused',
      commit_id: 'a-main',
      persona: 'A careful assistant.',
      exclude_memory_ids: ['m2'],
      pin_memory_ids: ['m1'],
    })
    await waitFor(() => {
      expect(useWorkspaceStore.getState().currentBranchId).toBe('b3')
      expect(useWorkspaceStore.getState().branches).toHaveLength(3)
    })
  })

  it('unpins an inherited memory explicitly when forking', async () => {
    const preview: ForkPreview = {
      source_branch_id: main.id,
      commit_id: 'head-main',
      commit_role: 'assistant',
      memories: [shortAnswers, tabs],
      pinned_count: 1,
    }
    const forked: Branch = {
      ...main,
      id: 'b4',
      name: 'Unpinned fork',
      parent_branch_id: main.id,
      fork_commit_id: 'head-main',
      is_root: false,
    }
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input)
      if (path.includes('/fork-preview')) return jsonResponse(preview)
      if (path.endsWith('/fork') && init?.method === 'POST') {
        requestBody = JSON.parse(String(init.body)) as Record<string, unknown>
        return jsonResponse(forked, 201)
      }
      return jsonResponse({ error: { code: 'not_found', message: 'Not found' } }, 404)
    })
    vi.stubGlobal('fetch', fetchMock)
    const browser = userEvent.setup()
    render(
      <ForkDialog
        target={{
          branchId: main.id,
          commitId: 'head-main',
          nameHint: 'Unpinned fork',
        }}
      />,
    )

    expect(await screen.findByText(/2 memories available/i)).toBeInTheDocument()
    await browser.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText(/keeping 2 of 2 memories/i)).toBeInTheDocument()
    await browser.click(
      screen.getByRole('button', {
        name: /unpin memory: the user prefers short answers/i,
      }),
    )
    expect(
      screen.getByRole('button', {
        name: /pin memory: the user prefers short answers/i,
      }),
    ).toBeInTheDocument()
    await browser.click(screen.getByRole('button', { name: 'Continue' }))
    await browser.click(screen.getByRole('button', { name: 'Create fork' }))

    await waitFor(() => expect(requestBody).not.toBeNull())
    expect(requestBody).toMatchObject({
      name: 'Unpinned fork',
      exclude_memory_ids: [],
      pin_memory_ids: [],
      unpin_memory_ids: ['m1'],
    })
  })

  it('generates a summary and merges selected memories into an ancestor', async () => {
    const preview: MergePreview = {
      source_branch_id: child.id,
      target_branch_id: main.id,
      target_name: main.name,
      target_head_commit_id: 'head-main',
      memories: [shortAnswers, tabs],
      duplicates: [
        { memory_id: tabs.id, duplicate_of_memory_id: 'm0', similarity: 0.93 },
      ],
      warnings: [],
    }
    const summary: MergeSummary = {
      summary: 'Carry forward the user preferences from Feature.',
      provider: 'mock',
      mock: true,
      warning: null,
    }
    const mergedTarget: Branch = {
      ...main,
      head_commit_id: 'merge-1',
      memory_count: 4,
    }
    const result: MergeResult = {
      source_branch_id: child.id,
      target_branch_id: main.id,
      merge_commit_id: 'merge-1',
      copied_count: 1,
      duplicates: preview.duplicates,
      warnings: [],
      target: mergedTarget,
    }
    let mergeBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input)
      if (path.includes('/merge-preview')) return jsonResponse(preview)
      if (path.endsWith('/merge-summary')) return jsonResponse(summary)
      if (path.endsWith('/merge') && init?.method === 'POST') {
        mergeBody = JSON.parse(String(init.body)) as Record<string, unknown>
        return jsonResponse(result)
      }
      return jsonResponse({ error: { code: 'not_found', message: 'Not found' } }, 404)
    })
    vi.stubGlobal('fetch', fetchMock)
    const browser = userEvent.setup()
    render(<MergeDialog sourceBranchId={child.id} />)

    expect(await screen.findByText(/near-duplicate memories are marked/i)).toBeInTheDocument()
    expect(screen.getByText(/messages are not copied/i)).toBeInTheDocument()
    await browser.click(screen.getByRole('button', { name: /generate summary/i }))
    await waitFor(() =>
      expect(screen.getByLabelText('Merge summary')).toHaveValue(summary.summary),
    )
    await browser.click(screen.getByRole('button', { name: 'Merge up' }))

    await waitFor(() => expect(mergeBody).not.toBeNull())
    expect(mergeBody).toMatchObject({
      target_branch_id: main.id,
      memory_ids: ['m1', 'm2'],
      summary: summary.summary,
      expected_head_id: 'head-main',
    })
    await waitFor(() => {
      const updated = useWorkspaceStore
        .getState()
        .branches.find((branch) => branch.id === main.id)
      expect(updated?.head_commit_id).toBe('merge-1')
    })
    expect(useOperationsStore.getState().syncRevision).toBe(1)
  })

  it('syncs selected upstream memories and updates the branch', async () => {
    const preview: SyncPreview = {
      branch_id: child.id,
      parent_branch_id: main.id,
      parent_name: main.name,
      parent_head_commit_id: 'head-main',
      memories: [tabs],
      duplicates: [],
      warnings: [],
    }
    const result: SyncResult = {
      branch_id: child.id,
      parent_branch_id: main.id,
      sync_commit_id: 'sync-1',
      copied_count: 1,
      duplicates: [],
      warnings: [],
      branch: { ...child, head_commit_id: 'sync-1', memory_count: 2 },
    }
    let syncBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input)
      if (path.endsWith('/sync-preview')) return jsonResponse(preview)
      if (path.endsWith('/sync') && init?.method === 'POST') {
        syncBody = JSON.parse(String(init.body)) as Record<string, unknown>
        return jsonResponse(result)
      }
      return jsonResponse({ error: { code: 'not_found', message: 'Not found' } }, 404)
    })
    vi.stubGlobal('fetch', fetchMock)
    const browser = userEvent.setup()
    render(<SyncDialog branchId={child.id} />)

    expect(await screen.findByText(/1 new memory upstream/i)).toBeInTheDocument()
    await browser.click(screen.getByRole('button', { name: /sync selected/i }))

    await waitFor(() => expect(syncBody).not.toBeNull())
    expect(syncBody).toMatchObject({
      memory_ids: ['m2'],
      expected_head_id: 'head-child',
    })
    await waitFor(() => {
      const updated = useWorkspaceStore
        .getState()
        .branches.find((branch) => branch.id === child.id)
      expect(updated?.head_commit_id).toBe('sync-1')
    })
  })

  it('archives a non-root branch from its action menu', async () => {
    let patchBody: Record<string, unknown> | null = null
    const archived = { ...child, archived: true }
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      patchBody = JSON.parse(String(init?.body)) as Record<string, unknown>
      return jsonResponse(archived)
    })
    vi.stubGlobal('fetch', fetchMock)
    const browser = userEvent.setup()
    render(<BranchMenu branch={child} />)

    await browser.click(screen.getByRole('button', { name: 'Actions for Feature' }))
    expect(screen.getByRole('menuitem', { name: 'Archive branch' })).toBeInTheDocument()
    await browser.click(screen.getByRole('menuitem', { name: 'Archive branch' }))

    await waitFor(() => expect(patchBody).toEqual({ archived: true }))
    await waitFor(() => {
      const updated = useWorkspaceStore
        .getState()
        .branches.find((branch) => branch.id === child.id)
      expect(updated?.archived).toBe(true)
    })
  })
})
