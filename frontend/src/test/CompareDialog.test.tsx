import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type { Branch, Memory, Message, Space, SpaceDiff } from '../api/types'
import { useOperationsStore } from '../store/operations'
import { useWorkspaceStore } from '../store/workspace'
import { CompareDialog } from '../components/operations/CompareDialog'

const space: Space = {
  id: 's1',
  name: 'Product',
  description: '',
  profile: {},
  created_at: '2026-01-01T00:00:00.000Z',
}

const root: Branch = {
  id: 'b1',
  space_id: 's1',
  name: 'main',
  parent_branch_id: null,
  fork_commit_id: null,
  head_commit_id: 'a0',
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
  message_count: 4,
  memory_count: 2,
}

const child: Branch = {
  ...root,
  id: 'b2',
  name: 'Feature',
  parent_branch_id: 'b1',
  fork_commit_id: 'a0',
  is_root: false,
  message_count: 2,
  memory_count: 2,
  color: '#5B7F67',
}

const memory: Memory = {
  id: 'm1',
  content: 'Decision: use SQLite WAL',
  kind: 'decision',
  importance: 0.8,
  pinned: false,
  edited: false,
  inherited: false,
  excluded: false,
  origin_branch_id: 'b2',
  origin_branch_name: 'Feature',
  source_commit_id: 'a1',
  supersedes_id: null,
  derived_from_id: null,
  has_embedding: true,
  stale_embedding: false,
  created_at: '2026-01-02T00:00:00.000Z',
}

const message: Message = {
  id: 'u1',
  role: 'user',
  content: 'Should we enable WAL?',
  parent_id: 'a0',
  branch_id: 'b2',
  origin_branch_name: 'Feature',
  is_inherited: false,
  status: 'complete',
  created_at: '2026-01-02T00:00:01.000Z',
}

const diff: SpaceDiff = {
  branch_id: 'b2',
  against_branch_id: 'b1',
  against_name: 'main',
  baseline_commit_id: 'abcdef123456',
  added: [memory],
  removed: [],
  changed: [],
  messages_added: [message],
  messages_upstream: [],
  added_count: 1,
  removed_count: 0,
  changed_count: 0,
  messages_added_count: 1,
  messages_upstream_count: 0,
}

beforeEach(() => {
  useWorkspaceStore.getState().reset()
  useWorkspaceStore.setState({
    spaces: [space],
    branches: [root, child],
    currentSpaceId: space.id,
    currentBranchId: child.id,
    loadingSpaces: false,
    loadingBranches: false,
    error: null,
  })
  useOperationsStore.setState({ compareBranchId: child.id })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('renders memory and message divergence against an ancestor', async () => {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => diff,
  }))
  vi.stubGlobal('fetch', fetchMock)

  render(<CompareDialog branchId={child.id} />)

  expect(await screen.findByText('Decision: use SQLite WAL')).toBeInTheDocument()
  expect(screen.getByText('Should we enable WAL?')).toBeInTheDocument()
  expect(screen.getByText('Memory divergence')).toBeInTheDocument()
  expect(screen.getByText('Shared history from abcdef1')).toBeInTheDocument()

  const [url] = fetchMock.mock.calls[0] as unknown as [string]
  expect(url).toBe('/api/branches/b2/diff?against=b1')
})
