import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it } from 'vitest'

import type { Branch, Space } from '../api/types'
import { useOperationsStore } from '../store/operations'
import { useUiStore } from '../store/ui'
import { useWorkspaceStore } from '../store/workspace'
import { CommandPalette } from '../components/layout/CommandPalette'
import { GlobalShortcuts } from '../components/layout/GlobalShortcuts'

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
  message_count: 4,
  memory_count: 2,
}

const child: Branch = {
  ...root,
  id: 'b2',
  name: 'Focused child',
  parent_branch_id: 'b1',
  fork_commit_id: 'a1',
  is_root: false,
  message_count: 2,
  memory_count: 1,
  color: '#5B7F67',
}

beforeEach(() => {
  useWorkspaceStore.getState().reset()
  useWorkspaceStore.setState({
    spaces: [space],
    branches: [root, child],
    currentSpaceId: space.id,
    currentBranchId: root.id,
    loadingSpaces: false,
    loadingBranches: false,
    error: null,
  })
  useUiStore.setState({
    sidebarOpen: false,
    sidebarCollapsed: false,
    inspectorOpen: true,
    inspectorTab: 'memory',
    settingsOpen: false,
    newSpaceOpen: false,
    paletteOpen: false,
    focusedCommitId: null,
  })
  useOperationsStore.setState({
    forkTarget: null,
    mergeSourceId: null,
    syncBranchId: null,
    renameBranchId: null,
    compareBranchId: null,
  })
})

afterEach(() => {
  cleanup()
})

it('opens with the keyboard, filters branches, and switches branch', async () => {
  const user = userEvent.setup()
  render(
    <>
      <GlobalShortcuts />
      <CommandPalette />
    </>,
  )

  await user.keyboard('{Control>}k{/Control}')
  expect(await screen.findByRole('dialog', { name: 'Command palette' })).toBeInTheDocument()

  const input = screen.getByLabelText('Search commands')
  await user.type(input, 'focused child')
  const option = await screen.findByRole('option', { name: /switch to focused child/i })
  await user.click(option)

  expect(useWorkspaceStore.getState().currentBranchId).toBe(child.id)
  expect(useUiStore.getState().paletteOpen).toBe(false)
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

it('toggles the sidebar and inspector with global shortcuts', async () => {
  const user = userEvent.setup()
  render(<GlobalShortcuts />)

  await user.keyboard('{Control>}b{/Control}')
  expect(useUiStore.getState().sidebarCollapsed).toBe(true)

  await user.keyboard('{Control>}b{/Control}')
  expect(useUiStore.getState().sidebarCollapsed).toBe(false)

  await user.keyboard('{Control>}.{/Control}')
  expect(useUiStore.getState().inspectorOpen).toBe(false)
})
