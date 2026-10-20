import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Branch, Space } from '../../api/types'
import { useUiStore } from '../../store/ui'
import { useWorkspaceStore } from '../../store/workspace'
import { PersonalizationPanel } from './PersonalizationPanel'

const space: Space = {
  id: 's1',
  name: 'Product',
  description: '',
  profile: { tone: 'direct', timezone: 'Asia/Kolkata' },
  created_at: '2026-01-01T00:00:00.000Z',
}

const branch: Branch = {
  id: 'b1',
  space_id: space.id,
  name: 'main',
  parent_branch_id: null,
  fork_commit_id: null,
  head_commit_id: 'head0001',
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
  message_count: 2,
  memory_count: 1,
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
    spaces: [space],
    branches: [branch],
    currentSpaceId: space.id,
    currentBranchId: branch.id,
    loadingSpaces: false,
    loadingBranches: false,
    error: null,
  })
  useUiStore.setState({ toasts: [] })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('personalization', () => {
  it('saves profile context while preserving custom fields', async () => {
    let body: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const parsed = JSON.parse(String(init?.body)) as Record<string, unknown>
      body = parsed
      return jsonResponse({
        ...space,
        profile: parsed.profile,
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const browser = userEvent.setup()
    render(<PersonalizationPanel branch={branch} space={space} />)

    expect(screen.getByLabelText('Preferred tone')).toHaveValue('direct')
    await browser.type(
      screen.getByLabelText('About you'),
      'I build local-first tools.',
    )
    await browser.clear(screen.getByLabelText('Preferred tone'))
    await browser.type(screen.getByLabelText('Preferred tone'), 'warm')
    await browser.click(screen.getByRole('button', { name: 'Save profile' }))

    await waitFor(() =>
      expect(body).toEqual({
        profile: {
          tone: 'warm',
          timezone: 'Asia/Kolkata',
          about: 'I build local-first tools.',
        },
      }),
    )
    expect(useWorkspaceStore.getState().spaces[0].profile.tone).toBe('warm')
  })

  it('saves branch persona, thinking, memory mode, and retrieval strength', async () => {
    let body: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const parsed = JSON.parse(String(init?.body)) as Record<string, unknown>
      body = parsed
      return jsonResponse({
        ...branch,
        persona: parsed.persona,
        system_prompt: parsed.system_prompt,
        thinking_level: parsed.thinking_level,
        top_k: parsed.top_k,
        memory_mode: parsed.memory_mode,
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const browser = userEvent.setup()
    render(<PersonalizationPanel branch={branch} space={space} />)

    const persona = screen.getByLabelText('Branch persona')
    await browser.clear(persona)
    await browser.type(persona, 'A direct product partner.')
    await browser.selectOptions(screen.getByLabelText('Thinking level'), 'high')
    await browser.selectOptions(screen.getByLabelText('Memory mode'), 'auto')
    fireEvent.change(screen.getByLabelText(/memory strength/i), {
      target: { value: '4' },
    })
    await browser.click(screen.getByRole('button', { name: 'Save branch voice' }))

    await waitFor(() =>
      expect(body).toEqual({
        persona: 'A direct product partner.',
        system_prompt: '',
        thinking_level: 'high',
        top_k: 4,
        memory_mode: 'auto',
      }),
    )
    expect(useWorkspaceStore.getState().branches[0].top_k).toBe(4)
  })
})
