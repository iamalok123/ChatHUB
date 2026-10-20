import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import type { Message } from '../api/types'
import { MessageItem } from '../components/chat/MessageItem'

const inheritedUser: Message = {
  id: 'u1',
  role: 'user',
  content: 'Inherited question',
  parent_id: 'anchor-1',
  branch_id: 'b0',
  origin_branch_name: 'main',
  is_inherited: true,
  status: 'complete',
  created_at: '2026-01-01T00:00:01.000Z',
}

const inheritedAssistant: Message = {
  id: 'a1',
  role: 'assistant',
  content: 'Inherited answer',
  parent_id: 'u1',
  branch_id: 'b0',
  origin_branch_name: 'main',
  is_inherited: true,
  status: 'partial',
  created_at: '2026-01-01T00:00:02.000Z',
}

afterEach(cleanup)

it('labels inherited turns with their origin branch and partial status', () => {
  render(
    <>
      <MessageItem message={inheritedUser} color="#C96442" onOpenTrace={vi.fn()} />
      <MessageItem message={inheritedAssistant} color="#C96442" onOpenTrace={vi.fn()} />
    </>,
  )

  expect(screen.getByText('Inherited question')).toBeInTheDocument()
  expect(screen.getByText('Inherited answer')).toBeInTheDocument()
  expect(screen.getAllByText('from main')).toHaveLength(2)
  expect(screen.getByText('Partial')).toBeInTheDocument()
  expect(
    screen.getByText(/ended before the provider finished/i),
  ).toBeInTheDocument()
})
